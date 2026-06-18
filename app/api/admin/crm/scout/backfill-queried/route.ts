// ============================================================================
// app/api/admin/crm/scout/backfill-queried/route.ts — Ralph 2026-06-05
//
// Backfill ONLY the ◐ Queried lamps (DNS / Wayback / PageSpeed + the 4 static
// detectors) for rows whose queried block is missing values or carries
// "failed" empty-strings. No capture, no Sonnet taste, no LLM cost.
//
// Two flows:
//   POST {rawIds: string[]}         → backfill exactly those rows
//   POST {rawIds: [], scopeAll: true} → backfill EVERY pool row that needs it
//
// Per Ralph's spec (this session):
//   - Don't re-fetch already-good lamp values; keep them.
//   - DO re-fetch lamps that are null / '' / start with 'failed'.
//   - Don't touch taste / capture / scanned_at — those are the expensive
//     scout output. Backfill is a separate enrichment pass.
//
// Sharing with the taste runner:
//   - Same SCOUT_SESSION_ID ('__scout__') but no mutex (Ralph 2026-06-05) —
//     a backfill and a taste batch can run interleaved without conflict.
//   - Same `enqueueBuild` + jobId pattern, so the existing STOP button
//     (which POSTs cancel-job for the active jobId) works unmodified.
//   - Same kind value as taste? No — distinct: 'scout_backfill'.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { enqueueBuild } from '@/lib/build-escrow'
import { readRawProspect, readRawProspects, patchRawProspect } from '@/lib/crm-store'
import { researchQueried, type QueriedSignals } from '@/lib/consular/research-queried'
import {
  initBackfillProgress,
  appendBackfillRow,
  finishBackfillProgress,
  type BackfillRowResult,
} from '@/lib/scout-backfill-progress'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SCOUT_SESSION_ID = '__scout__'
const DEFAULT_CONCURRENCY = 6
// Ralph 2026-06-06 — `trackers` split into `analytics` + `marketing`;
// `reviews` lamp added (DDG-backed Google Business lookup); `saas`,
// `industry`, `location` lamps added (HTML grep + JSON-LD parse). Backfill
// now checks 14 lamps instead of 9. Rows that already have the old
// `trackers` field but no analytics / marketing / reviews / saas /
// industry / location get refilled by this backfill (the "needsFilling"
// check below treats absence as missing).
const LAMP_KEYS = [
  'age', 'stack', 'hosting', 'performance', 'seo',
  'traffic', 'reviews', 'analytics', 'marketing', 'booking', 'languages',
  'saas', 'industry', 'location',
] as const
type LampKey = typeof LAMP_KEYS[number]

/**
 * A lamp "needs filling" when the existing scout_json.queried doesn't carry
 * a non-empty string for it. '' counts as failed (the formatter returns ''
 * on every leg-level failure) AND so does any string starting with 'failed'
 * (defensive — older runs may have stored an explicit marker).
 */
function lampNeedsFill(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v !== 'string') return false        // unexpected type → leave it
  const s = v.trim()
  if (s === '') return true
  if (s.toLowerCase().startsWith('failed')) return true
  return false
}

/** Pool-row → needs-backfill predicate. Used to compute the default batch. */
function rowNeedsBackfill(scoutJson: string | null | undefined, website: string | null | undefined): boolean {
  if (!website || !website.trim()) return false                            // greenfield never qualifies
  let parsed: { queried?: Record<string, unknown> } = {}
  try { parsed = JSON.parse(scoutJson || '{}') } catch { /* empty → needs */ }
  const q = parsed.queried || {}
  for (const k of LAMP_KEYS) {
    if (lampNeedsFill(q[k])) return true
  }
  return false
}

/**
 * Sliding-window concurrency (lifted from scout/taste/route.ts — same shape).
 * Bounded by `cap`, returns results in input order.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  cap: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  const runOne = async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i], i) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  const slots = Math.max(1, Math.min(cap, items.length))
  await Promise.all(Array.from({ length: slots }, () => runOne()))
  return results
}

export async function POST(req: NextRequest) {
  let body: { rawIds?: unknown; scopeAll?: unknown; concurrency?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const explicitIds = Array.isArray(body.rawIds)
    ? (body.rawIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const scopeAll = body.scopeAll === true

  // Resolve the target set. Explicit ids win; otherwise auto-pick the pool
  // rows that need it. The auto-pick reads the live pool ONCE here so the
  // client doesn't need a second round-trip to find out what's qualifying.
  let rawIds: string[]
  if (explicitIds.length > 0) {
    rawIds = explicitIds
  } else if (scopeAll) {
    const pool = readRawProspects()
    rawIds = pool
      .filter((p) => rowNeedsBackfill(p.scout_json, p.website))
      .map((p) => p.id)
  } else {
    return NextResponse.json({ error: 'rawIds (string[]) or {scopeAll:true} required' }, { status: 400 })
  }
  if (rawIds.length === 0) {
    return NextResponse.json({ job: null, deduped: false, pickedIds: [] })
  }

  // Concurrency: caller's override, else default 6. 1..32 bounded.
  const concurrency = (() => {
    const n = Number(body.concurrency)
    if (!Number.isFinite(n) || n < 1 || n > 32) return DEFAULT_CONCURRENCY
    return Math.floor(n)
  })()

  // Same target-key discipline as taste — sorted, joined — so a re-fire with
  // the same id-set returns the in-flight job (build-escrow dedup).
  const target = `backfill:${[...rawIds].sort().join(',')}`

  const result = enqueueBuild({
    sessionId: SCOUT_SESSION_ID,
    kind: 'scout_backfill',
    target,
    runner: async ({ signal, jobId }) => {
        // M-iii — seed the shared progress entry so the client's status
        // poll has something to read from the first tick. processed=0,
        // total=rawIds.length, perRow=[]. The runner appends as each row
        // settles; the client polls status?jobId=... instead of the full pool.
        initBackfillProgress(jobId, rawIds.length)

        type PerRow =
          | { id: string; status: 'filled'; filledLamps: LampKey[] }
          | { id: string; status: 'skipped'; reason: string }
          | { id: string; status: 'failed'; reason: string }
          | { id: string; status: 'cancelled' }

        // Wraps processRow so EVERY return path also pushes into the shared
        // progress store. Centralised so we can't forget to record one of
        // the many early-exits below. The wrapper records the result then
        // returns it unchanged to the concurrency runner.
        const recordAndReturn = (r: PerRow): PerRow => {
          appendBackfillRow(jobId, r as BackfillRowResult)
          return r
        }

        const processRow = async (id: string): Promise<PerRow> => {
          if (signal.aborted) return recordAndReturn({ id, status: 'cancelled' })
          const raw = readRawProspect(id)
          if (!raw) return recordAndReturn({ id, status: 'failed', reason: 'pool row not found' })
          if (!raw.website || !raw.website.trim()) {
            return recordAndReturn({ id, status: 'skipped', reason: 'greenfield (no website)' })
          }

          // Parse existing scout_json. Preserve everything we don't touch:
          // taste, capture, scanned_at, failed flags. Only queried + sources
          // get refreshed.
          let prior: {
            scanned_at?: string | null
            taste?: unknown
            queried?: Record<string, unknown> | null
            sources?: unknown
            capture?: unknown
            failed?: boolean
            fail_reason?: string | null
          } = {}
          try { prior = JSON.parse(raw.scout_json || '{}') } catch { /* empty */ }
          const priorQueried = (prior.queried && typeof prior.queried === 'object')
            ? prior.queried as Record<string, unknown>
            : {}

          // Short-circuit: nothing to fill.
          const needs = LAMP_KEYS.filter((k) => lampNeedsFill(priorQueried[k]))
          if (needs.length === 0) {
            return recordAndReturn({ id, status: 'skipped', reason: 'all lamps already populated' })
          }

          try {
            const fresh: QueriedSignals = await researchQueried(raw.website)
            if (signal.aborted) return recordAndReturn({ id, status: 'cancelled' })

            // Merge: lamps that need filling get the fresh value (even if the
            // fresh value is also ''). Lamps that have a value stay.
            const mergedQueried: Record<string, string | null> = { ...priorQueried } as Record<string, string | null>
            const filled: LampKey[] = []
            for (const k of LAMP_KEYS) {
              if (lampNeedsFill(priorQueried[k])) {
                mergedQueried[k] = (fresh as unknown as Record<string, string | null>)[k] ?? ''
                if (mergedQueried[k] && (mergedQueried[k] as string).trim() !== '') filled.push(k)
              }
            }
            // Sources: replace wholesale with the fresh ones — they describe
            // WHICH lamp came from WHERE, and the lamp set just shifted.
            // Stamp __queried_at so the client poll can detect completion.
            mergedQueried.__queried_at = new Date().toISOString()

            const nextScoutJson = {
              ...prior,
              queried: mergedQueried,
              sources: fresh.sources,
            }
            await patchRawProspect(id, { scout_json: JSON.stringify(nextScoutJson) })
            return recordAndReturn({ id, status: 'filled', filledLamps: filled })
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            console.error(`[scout/backfill] row ${id} failed:`, reason)
            // Ralph 2026-06-05 spec-review B1 — stamp __queried_at on the
            // FAILURE path too. Without this, the client's poll loop never
            // sees the row complete (it watches for __queried_at to appear),
            // so a single broken site pins the progress bar at "27/28" until
            // the 8-min outer cap. Lamps stay in their prior null/''/failed
            // state — transparent failure, not a fabricated success. The
            // next backfill will re-pick this row because lampNeedsFill
            // still returns true.
            try {
              const stamped = {
                ...prior,
                queried: {
                  ...priorQueried,
                  __queried_at: new Date().toISOString(),
                },
              }
              await patchRawProspect(id, { scout_json: JSON.stringify(stamped) })
            } catch (writeErr) {
              // Don't let a write-side failure mask the original error.
              console.error(`[scout/backfill] row ${id} stamp-on-fail write failed:`, writeErr)
            }
            return recordAndReturn({ id, status: 'failed', reason })
          }
        }

        const settled = await mapWithConcurrency(rawIds, concurrency, processRow)
        const perRow = settled.map((r, i) =>
          r.status === 'fulfilled'
            ? r.value
            : ({ id: rawIds[i], status: 'failed', reason: String(r.reason) } as PerRow),
        )
        // Promise.all rejections bypass recordAndReturn — catch any orphaned
        // rows (worker threw synchronously after recordAndReturn-call site)
        // and stamp them into progress so processed reflects reality.
        const recordedIds = new Set(
          (perRow as PerRow[])
            .map((r) => r.id),
        )
        for (let i = 0; i < settled.length; i++) {
          if (settled[i].status !== 'rejected') continue
          const id = rawIds[i]
          if (recordedIds.has(id)) continue
          appendBackfillRow(jobId, {
            id,
            status: 'failed',
            reason: String((settled[i] as PromiseRejectedResult).reason),
          })
        }
        const cFilled    = perRow.filter(r => r.status === 'filled').length
        const cSkipped   = perRow.filter(r => r.status === 'skipped').length
        const cFailed    = perRow.filter(r => r.status === 'failed').length
        const cCancelled = perRow.filter(r => r.status === 'cancelled').length
        const lampsTotal = perRow.reduce(
          (n, r) => r.status === 'filled' ? n + r.filledLamps.length : n, 0)
        console.log(
          `[scout/backfill] done — ${perRow.length} rows · `
          + `filled=${cFilled} (${lampsTotal} lamps) · `
          + `skipped=${cSkipped} · failed=${cFailed} · cancelled=${cCancelled}`,
        )
        // Stamp the terminal status so the client poll sees the run end.
        // `cancelled` here only fires when EVERY row hit cancel; otherwise
        // the runner finishes normally and the escrow flips to 'complete'.
        finishBackfillProgress(jobId, signal.aborted ? 'cancelled' : 'complete')
        return { ok: true as const }
      },
  })

  return NextResponse.json({ job: result.job, deduped: result.deduped, pickedIds: rawIds })
}
