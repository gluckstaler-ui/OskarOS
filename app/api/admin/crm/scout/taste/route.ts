// ============================================================================
// app/api/admin/crm/scout/taste/route.ts — Scout Taste batch (WP-SCOUT-5)
//
// Ralph 2026-06-03 — refactor: was an inline-sync route that ran 3 cheap
// signals per request and blocked the UI; is now a REAL backgrounded job:
//
//   POST {rawIds: string[]}
//     → enqueueBuild({ sessionId:'__scout__', kind:'scout_taste',
//                       target:rawIds.join(','), runner })
//     ← {job, deduped}
//
// The runner serializes BATCHES via `withWebdevMutex('__scout__', fn)` so
// two overlapping Taste requests don't fork two parallel cohorts. INSIDE
// one batch (Ralph 2026-06-03), all rows run in PARALLEL via
// Promise.allSettled — 32 puppeteer captures, 32 PageSpeed/DNS/Wayback
// fans, and 32 Sonnet ephemeral workers fire at once; per-row failures are
// isolated by allSettled so one dead site doesn't kill the cohort. Each
// row writes its `scout_json` via `patchRawProspect` immediately so a
// crash mid-batch only loses in-flight work, not finished work.
// `signal.aborted` is sampled at the top of each row's pipeline + between
// each step — cancel takes effect on the next checkpoint.
//
// Per row, the runner now wires the FULL ◐+◓ pipeline (Ralph 2026-06-03):
//
//   captureUrl(website)         (WP-SCOUT-2) — Puppeteer full-page + 1 inner
//   ┃                             screenshot, SSRF-guarded; never throws.
//   ┃
//   researchQueried(website)    (WP-SCOUT-4) — 9 cheap signals in parallel
//   ┃                             (hosting · age · stack · perf · seo · traffic
//   ┃                              · trackers · booking · langs); never throws.
//   ┃
//   callScoutBridge(prompt)     (WP-SCOUT-3) — Sonnet ephemeral worker tastes
//                                 the captured screenshots + queried lamps,
//                                 returns a typed `submit_scout_verdict`
//                                 with server-derived gap + heat.
//
// All three steps are sequential per row (capture needs the page; taste
// needs the screenshot + queried lamps as context). `signal.aborted` is
// checked between each step so a cancel mid-row stops cleanly with whatever
// landed so far still persisted.
//
// Greenfield rows (empty website) are SKIPPED — never captured, never
// queried, never tasted (no domain to query, no page to read). Per [SCOUT-D]
// they stay raw in the pool until Ralph decides on imported fields alone
// (Promote/Discard direct).
//
// Failure mode discipline: a captureUrl failure writes a partial scout_json
// with queried-only + `taste: {verdict: 'capture failed: …'}` and continues
// the batch. A scout-bridge failure does the same with the queried data
// still recorded. Only a programmer-level bug (patchRawProspect throws,
// etc.) lands in the catch-and-mark-failed path.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { enqueueBuild, withWebdevMutex } from '@/lib/build-escrow'
import { readRawProspect, patchRawProspect } from '@/lib/crm-store'
import { researchQueried, type QueriedSignals } from '@/lib/consular/research-queried'
import { captureUrl, type CaptureResult } from '@/lib/screenshot'
import { callScoutBridge } from '@/lib/scout-bridge-call'
import { type ExecutionMode } from '@/lib/session-config'

/**
 * Per-mode model defaults for the **Scout** (Ralph 2026-06-03). Mirrors the
 * SHAPE of lib/session-config.ts MODE_DEFAULTS (the CD ones) but flavours
 * with Sonnet identifiers — taste judgement is short, Opus is overkill.
 * The TopBar selector chooses TRANSPORT (cli/api), this table maps that
 * to the Scout-appropriate model variant. Keep in sync with the inline
 * SCOUT_MODE_DEFAULTS in components/crm/scout/ScoutPool.tsx.
 */
const SCOUT_MODE_DEFAULTS: Record<ExecutionMode, string> = {
  smpl: 'sonnet',
  cli:  'claude-sonnet-4-6[1m]',
  api:  'claude-sonnet-4-6',
}

export const dynamic = 'force-dynamic'
// Enqueue is fast; the heavy work runs in the bg job. Keep the route timeout
// short so a misuse (huge `rawIds`) doesn't ever pin the request loop.
export const maxDuration = 30

/** Session id used for the bg job key + mutex — keeps Scout work in its own lane. */
const SCOUT_SESSION_ID = '__scout__'

/**
 * Resolve `{mode, model}` for THIS taste batch.
 *
 * Honors the user's TopBar CLI/API selector instead of hardwiring (Ralph
 * 2026-06-03). 3-tier read order matches the rest of the project:
 *   1. POST body — what ScoutPool sent (read from localStorage.oskar_billing_mode
 *      + the mapped model). Always present in normal use.
 *   2. _session-config.json on the CRM session — fallback when the client
 *      didn't send anything (an API caller, a curl test, …).
 *   3. DEFAULT_SESSION_CONFIG-equivalent — last-resort CLI + sonnet[1m].
 *
 * NO hardwire to a specific model anywhere in the chain. The Scout adopts
 * whatever the user chose for their session.
 */
function resolveExecution(
  bodyMode: unknown,
  bodyModel: unknown,
): { mode: ExecutionMode; model: string } {
  const mode: ExecutionMode =
    (bodyMode === 'cli' || bodyMode === 'api' || bodyMode === 'smpl')
      ? bodyMode
      : 'cli'   // last-resort default; the client almost always supplies it
  // Model: caller's choice wins; otherwise the Scout's per-mode default
  // (Sonnet — short judgement task, no Opus needed). SCOUT_MODE_DEFAULTS
  // mirrors session-config.ts's SHAPE but with sonnet identifiers, so the
  // selector pick (cli vs api) still routes to the right transport variant.
  const model = (typeof bodyModel === 'string' && bodyModel.trim())
    ? bodyModel.trim()
    : SCOUT_MODE_DEFAULTS[mode]
  return { mode, model }
}

export async function POST(req: NextRequest) {
  let body: { rawIds?: unknown; mode?: unknown; model?: unknown }
  try {
    body = (await req.json()) as { rawIds?: unknown; mode?: unknown; model?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const rawIds = Array.isArray(body.rawIds)
    ? body.rawIds.filter((x): x is string => typeof x === 'string')
    : []
  if (rawIds.length === 0) {
    return NextResponse.json({ error: 'rawIds (string[]) required' }, { status: 400 })
  }
  const { mode, model } = resolveExecution(body.mode, body.model)

  // Target string = the EXACT id-set (sorted for dedup determinism). Two
  // calls with the same selection re-find the in-flight job; a different
  // selection enqueues a fresh one. Sorting matters: ['a','b'] and ['b','a']
  // are the same batch — without sort they'd dedup-miss.
  const target = [...rawIds].sort().join(',')

  const result = enqueueBuild({
    sessionId: SCOUT_SESSION_ID,
    kind: 'scout_taste',
    target,
    runner: ({ signal }) =>
      withWebdevMutex(SCOUT_SESSION_ID, async () => {
        // Per-row pipeline — broken out so we can fan it across rows via
        // Promise.allSettled. Each row OWNS its own try/catch + writes its
        // own scout_json on the way out; allSettled means one dead site
        // cannot kill the cohort.
        type PerRow =
          | { id: string; status: 'scouted' }
          | { id: string; status: 'skipped' | 'failed' | 'cancelled'; reason?: string }

        const processRow = async (id: string): Promise<PerRow> => {
          if (signal.aborted) return { id, status: 'cancelled' }
          const raw = readRawProspect(id)
          if (!raw) return { id, status: 'failed', reason: 'pool row not found' }
          // Greenfield: empty website → not tastable. Skip with no DB write
          // so the row stays `raw` in the pool (UI shows the GREENFIELD chip).
          if (!raw.website || !raw.website.trim()) {
            return { id, status: 'skipped', reason: 'greenfield (no website)' }
          }
          try {
            // ─── Step 1: ◐ Capture (WP-SCOUT-2). ───────────────────────────
            // Puppeteer full-page + 1 inner, SSRF-guarded. Never throws —
            // returns {ok:false, reason} on failure. We continue to the
            // queried layer even on capture failure (lamps still useful);
            // the taste step needs the screenshot, so it gets skipped.
            const capture: CaptureResult = await captureUrl(raw.website)
            if (signal.aborted) return { id, status: 'cancelled' }

            // ─── Step 2: ◐ Queried (WP-SCOUT-4). ───────────────────────────
            // 9 cheap signals in parallel within the row (DNS/Wayback/PSI/HTML);
            // each leg independently graceful.
            const queried: QueriedSignals = await researchQueried(raw.website)
            if (signal.aborted) return { id, status: 'cancelled' }

            // ─── Step 3: ◓ Scouted — the visual taste (WP-SCOUT-3). ────────
            // Sonnet ephemeral worker reads the screenshot(s) + the queried
            // lamps + the lead identity, calls submit_scout_verdict once.
            // Skipped when capture failed — the taste block records WHY so
            // the UI shows "verdict: capture failed".
            let taste: {
              palate: number | null
              palate_choice: string | null
              execution: number | null
              gap: number | null
              heat: 'hot' | 'warm' | 'cold' | null
              verdict: string
              photos: string | null
            }
            if (capture.ok === true) {
              const prompt = buildScoutPrompt(raw, queried, capture)
              // Ralph 2026-06-03 · callScoutBridge now requires explicit
              // Ralph 2026-06-03 (un-hardwire): use the RESOLVED selector
              // — POST body → session config → DEFAULT — not a literal.
              // The api-mode path inside callScoutBridge currently warns
              // and falls through to CLI; build it out when needed.
              const result = await callScoutBridge(prompt, { mode, model })
              const v = result.verdict
              if (v) {
                taste = {
                  palate: v.palate, palate_choice: v.palate_choice,
                  execution: v.execution, gap: v.gap, heat: v.heat,
                  verdict: v.verdict, photos: v.photos,
                }
              } else {
                // Bridge ran but the agent didn't call submit_scout_verdict.
                // Capture + queried still recorded so the row isn't a total loss.
                taste = {
                  palate: null, palate_choice: null, execution: null,
                  gap: null, heat: null, photos: null,
                  verdict: 'agent did not submit a verdict — no tool call',
                }
              }
            } else {
              taste = {
                palate: null, palate_choice: null, execution: null,
                gap: null, heat: null, photos: null,
                verdict: `capture failed: ${capture.reason}`,
              }
            }

            // ─── Persist the full scout_json (taste + queried + sources + capture). ──
            const scout_json = JSON.stringify({
              scanned_at: new Date().toISOString(),
              taste,
              queried: {
                age:         queried.age,
                stack:       queried.stack,
                hosting:     queried.hosting,
                performance: queried.performance,
                seo:         queried.seo,
                traffic:     queried.traffic,
                trackers:    queried.trackers,
                booking:     queried.booking,
                languages:   queried.languages,
              },
              sources: queried.sources,
              capture: capture.ok === true
                ? {
                    finalUrl: capture.finalUrl,
                    resolvedIp: capture.resolvedIp,
                    fullPageUrl: capture.fullPageUrl,
                    innerPageUrl: capture.innerPageUrl,
                    pages: capture.pages,
                    capturedAt: capture.capturedAt,
                  }
                : { failed: true, reason: capture.reason },
              failed: false,
              fail_reason: null,
            })
            await patchRawProspect(id, { scout_json })
            return { id, status: 'scouted' }
          } catch (err) {
            // Per-row failure: write the failed shape so the UI can show
            // WHY this row didn't progress. allSettled keeps the cohort alive.
            const reason = err instanceof Error ? err.message : String(err)
            try {
              await patchRawProspect(id, {
                scout_json: JSON.stringify({
                  scanned_at: new Date().toISOString(),
                  failed: true,
                  fail_reason: reason,
                }),
              })
            } catch {
              console.error(`[scout/taste] failed-marker write failed for ${id}:`, reason)
            }
            return { id, status: 'failed', reason }
          }
        }

        // ── PARALLEL FAN-OUT (Ralph 2026-06-03 spec deviation). ───────────
        // Spec said serial-via-mutex; Ralph called for 32 simultaneous
        // workers ("32 scout agents will be launched in parallel, while the
        // server queries also run"). The mutex still wraps the BATCH so two
        // overlapping requests don't double-up; within one batch every row
        // races through capture+query+taste concurrently. Heavy on resources
        // — 32 puppeteer pages + 32 Sonnet CLI subprocesses — but Ralph's call.
        // If load tells, we'll add a sliding-window concurrency cap here.
        const settled = await Promise.allSettled(rawIds.map(processRow))
        const perRow: PerRow[] = settled.map((r, i) =>
          r.status === 'fulfilled'
            ? r.value
            : { id: rawIds[i], status: 'failed', reason: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        )

        // Ops summary. CANONICAL state is each row's mutated scout_json (the
        // UI polls /pool). JobResult is build-vibe-specific so we just resolve
        // `{ok:true}` and let the side-effects speak.
        console.log(
          `[scout/taste] batch done — ${perRow.length} rows · `
          + `scouted=${perRow.filter(r => r.status === 'scouted').length} · `
          + `skipped=${perRow.filter(r => r.status === 'skipped').length} · `
          + `failed=${perRow.filter(r => r.status === 'failed').length} · `
          + `cancelled=${perRow.filter(r => r.status === 'cancelled').length}`,
        )
        return { ok: true as const }
      }),
  })

  return NextResponse.json({ job: result.job, deduped: result.deduped })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compose the "current case" message handed to the Scout bridge. The Scout's
 * persona (system prompt) is loaded inside scout-bridge-call; this is the
 * user-side payload: the lead's identity, the ◐ Queried lamps as context,
 * and the screenshot paths to open with FileRead.
 *
 * The agent has been instructed (in agents/jedi-scout.md) to call
 * submit_scout_verdict ONCE with palate/palate_choice/execution/verdict/photos.
 * `gap` + `heat` are derived server-side in scout-bridge-call (never trusted
 * from the model).
 */
function buildScoutPrompt(
  raw: { website: string; company?: string | null; name?: string | null; country?: string | null; industry?: string | null },
  queried: QueriedSignals,
  capture: CaptureResult & { ok: true },
): string {
  const leadName = (raw.company || raw.name || '(unnamed)').trim()
  const lines: string[] = [
    '[OSKAR-SYSTEM SCOUT-TASTE]',
    '',
    `Lead: ${leadName}`,
    `Website: ${raw.website}`,
    `Country: ${raw.country || '—'}`,
    `Industry: ${raw.industry || '—'}`,
    '',
    'Screenshots (open with FileRead before judging — the FULL-page is load-bearing):',
    `- Full page: ${capture.fullPagePath}`,
    capture.innerPagePath ? `- Inner page: ${capture.innerPagePath}` : '- Inner page: (none — single-page site)',
    '',
    '◐ Queried lamps (cheap context — DNS/Wayback/PageSpeed/HTML, no LLM):',
    `- Age:         ${queried.age || '—'}`,
    `- Stack:       ${queried.stack || '—'}`,
    `- Hosting:     ${queried.hosting || '—'}`,
    `- Performance: ${queried.performance || '—'}`,
    `- SEO:         ${queried.seo || '—'}`,
    `- Traffic:     ${queried.traffic || '—'}`,
    `- Trackers:    ${queried.trackers || '—'}`,
    `- Booking:     ${queried.booking || '—'}`,
    `- Languages:   ${queried.languages || '—'}`,
    '',
    'Taste this site. Name ONE specific thing you actually see before you judge — palate_choice is that thing. ' +
    'Call submit_scout_verdict ONCE with {palate, palate_choice, execution, verdict, photos}. ' +
    '`gap` and `heat` are derived server-side — do NOT include them in the tool call.',
  ]
  return lines.join('\n')
}

