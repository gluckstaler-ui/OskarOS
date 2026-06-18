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
// The runner now runs batches in PARALLEL (Ralph 2026-06-05 — the per-
// session withWebdevMutex was ripped; overlapping Taste requests fork
// concurrent cohorts because there's no shared resource that needs
// serialization). INSIDE
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
import { existsSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { enqueueBuild } from '@/lib/build-escrow'
import { readRawProspect, patchRawProspect } from '@/lib/crm-store'
import { researchQueried, type QueriedSignals } from '@/lib/consular/research-queried'
import { captureUrl, type CaptureResult } from '@/lib/screenshot'
import { callScoutBridge } from '@/lib/scout-bridge-call'
import { verdictTagTone } from '@/lib/verdict'
import { bridgeManager } from '@/lib/bridge-process-manager'
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
  cli:  'claude-sonnet-4-6',
  api:  'claude-sonnet-4-6',
}

export const dynamic = 'force-dynamic'
// Enqueue is fast; the heavy work runs in the bg job. Keep the route timeout
// short so a misuse (huge `rawIds`) doesn't ever pin the request loop.
export const maxDuration = 30

/** Session id used for the bg job key + mutex — keeps Scout work in its own lane. */
const SCOUT_SESSION_ID = '__scout__'

/**
 * Default concurrency cap for the per-row pipeline (Ralph 2026-06-03 follow-up).
 *
 * Earlier we fanned out 32 rows with `Promise.allSettled(rawIds.map(processRow))`
 * — 32 simultaneous Chromium pages on one shared Puppeteer browser singleton.
 * Result in the field: 24 of 32 rows failed with `capture failed: timeout
 * after 60000ms` because the pages starved each other. The fix is a sliding
 * window: start CAP workers, each picks the next id when its row finishes,
 * so at most CAP rows are doing capture+query+taste at any moment.
 *
 * 6 is the safe Chromium concurrency for a single-browser pool on a dev box.
 * Per-row total stays the same (~30-60s); batch wall-clock becomes
 * `ceil(N / CAP) * per_row` instead of `per_row` (best-case) or `∞`
 * (overload case). For 32 rows: ~6 × 60s = 6min worst-case capture wall-time,
 * matches the client poll budget.
 *
 * Caller can override via POST body `{concurrency: N}` (clamped 1..32) — no
 * hardwire, matches the project's no-hardwire rule.
 */
// Ralph 2026-06-05 — bumped 6 → 32. Each capture spawns its own Chromium
// (per-call isolation in lib/screenshot.ts), so the previous 6-slot cap
// was the real bottleneck: any 4 stalled sites choked the batch down to
// 2 productive workers. With 32 slots and the 50s outer timeout, even
// a handful of wedged sites can't pin throughput. Bridge pool sized to
// 64 (MAX_WORKERS_PER_SESSION), so there's headroom for the Sonnet calls
// to keep up.
const DEFAULT_CONCURRENCY = 32

/**
 * Sliding-window concurrency runner. Promise.allSettled-shaped semantics
 * (per-item failures isolated, never throws), bounded by `cap` in-flight.
 *
 * Each "slot" pulls the next item from the queue when its current one
 * resolves; this is the minimal version of `p-limit`/`p-map` without the
 * dep. Returns results in the SAME ORDER as the input array, which keeps
 * the existing `perRow` summary indexing correct.
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
  let body: { rawIds?: unknown; mode?: unknown; model?: unknown; concurrency?: unknown }
  try {
    body = (await req.json()) as { rawIds?: unknown; mode?: unknown; model?: unknown; concurrency?: unknown }
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
  // Concurrency: caller's choice wins; otherwise DEFAULT_CONCURRENCY (6).
  // Ralph 2026-06-05 — raised upper bound 32 → 64 to match the bridge
  // pool's new MAX_WORKERS_PER_SESSION=64. Anything outside 1..64 falls
  // back to the default (a sentinel against `concurrency: 0` deadlock or
  // `concurrency: 999` re-introducing the original starvation bug).
  const concurrency = (() => {
    const n = Number(body.concurrency)
    if (!Number.isFinite(n) || n < 1 || n > 64) return DEFAULT_CONCURRENCY
    return Math.floor(n)
  })()

  // Target string = the EXACT id-set (sorted for dedup determinism). Two
  // calls with the same selection re-find the in-flight job; a different
  // selection enqueues a fresh one. Sorting matters: ['a','b'] and ['b','a']
  // are the same batch — without sort they'd dedup-miss.
  const target = [...rawIds].sort().join(',')

  const result = enqueueBuild({
    sessionId: SCOUT_SESSION_ID,
    kind: 'scout_taste',
    target,
    runner: async ({ signal }) => {
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
            // ─── Step 1: ◐ Capture (WP-SCOUT-2 + §18 / WP-130). ─────────
            // Puppeteer full-page, SSRF-guarded. Never throws — returns
            // {ok:false, reason} on failure. We continue to the queried
            // layer even on capture failure (lamps still useful); the
            // taste step needs the screenshot, so it gets skipped.
            //
            // §18 / WP-130: pass prospect context so the file lands at
            // media/<plz>/<slug>/<firstname>.jpg (NOT public/__scout__/).
            // For shared-practice sites (≥2 pool rows on same domain),
            // captureUrl ALSO grabs the practitioner's profile page.
            const { siteSlug, firstnameSlug, plzOrRegion, slugChunk } = await import('@/lib/scout-paths')
            const rawPayloadObj: Record<string, unknown> = (() => {
              try { return JSON.parse(raw.raw_payload || '{}') as Record<string, unknown> } catch { return {} }
            })()
            const slug = siteSlug(raw.website)
            const firstname = firstnameSlug(raw.name || raw.company || '')
            const ctxPlz = plzOrRegion(rawPayloadObj)
            // Shared-site count: how many OTHER live pool rows hit the same domain.
            const sharedSiteCount = await (async () => {
              try {
                const { readRawProspects } = await import('@/lib/crm-store')
                const { domainOf } = await import('@/lib/scout-paths')
                const target = domainOf(raw.website)
                return readRawProspects().filter((p) => p.website && domainOf(p.website) === target).length
              } catch { return 1 }
            })()
            // Tokens for the profile-page heuristic — first + last name slugs
            // and any other name fragments. The link-graph matcher takes any
            // hit on text OR href path (case-insensitive, same-origin only).
            const tokens = [firstname]
            const lastTok = ((raw.name || '').trim().split(/\s+/).pop() || '')
            const lastSlug = slugChunk(lastTok)
            if (lastSlug && lastSlug !== firstname) tokens.push(lastSlug)

            const capture: CaptureResult = await captureUrl(raw.website, {
              plzOrRegion: ctxPlz,
              slug,
              firstname,
              sharedSiteCount,
              nameTokens: tokens,
            })
            if (signal.aborted) return { id, status: 'cancelled' }

            // ─── Step 2: ◐ Queried (WP-SCOUT-4). ───────────────────────────
            // 9 cheap signals in parallel within the row (DNS/Wayback/PSI/HTML);
            // each leg independently graceful. captureUrl already rendered the
            // homepage DOM — hand it over so the cookie/tracker detector sees
            // JS-injected consent banners instead of false-flagging the SPA
            // shell. Falls back to its own fetch/render when capture failed.
            const queried: QueriedSignals = await researchQueried(
              raw.website,
              capture.ok && capture.html ? { html: capture.html } : {},
            )
            if (signal.aborted) return { id, status: 'cancelled' }

            // ─── Step 3: ◓ Scouted — the visual taste (WP-SCOUT-3). ────────
            // Sonnet ephemeral worker reads the screenshot(s) + the queried
            // lamps + the lead identity, calls submit_scout_verdict once.
            // Skipped when capture failed — the taste block records WHY so
            // the UI shows "verdict: capture failed".
            // Ralph 2026-06-10 (TASTED redesign, unified keys): the taste blob
            // speaks the SAME language as Kanban's intel_json — who · buying ·
            // verdict_subline · verdict_tag · verdict_tone (stored explicitly,
            // derived from the house tag at write time) · chf_est/heads (the
            // derived PALAT band's inputs) · design/photos 0–5 + citations.
            // gap/heat and the legacy keys (palate_choice/execution/verdict)
            // are NEVER written again; old rows stay readable via the *Of
            // helpers in components/crm/scout/types.ts.
            let taste: {
              who: string | null
              buying: number | null
              chf_est: number | null
              heads: number | null
              switching_pain: string | null
              pitch: string | null
              design: number | null
              design_cite: string | null
              photos: number | null
              photos_cite: string | null
              verdict_subline: string
              verdict_tag: string | null
              verdict_tone: string | null
            }
            if (capture.ok === true) {
              // Availability (Verfügbarkeit) — the FSP register fields live on
              // raw_payload, not on queried. WP-20 beat 5: availability selects
              // which pitch argument exists, so the taster must SEE it. Honest
              // null when register + site gave nothing — never guessed.
              const avail = ((): string | null => {
                const lab = typeof rawPayloadObj.availability_label === 'string' && rawPayloadObj.availability_label.trim()
                  ? rawPayloadObj.availability_label.trim() : null
                const st = typeof rawPayloadObj.availability_status === 'string' && rawPayloadObj.availability_status.trim()
                  ? rawPayloadObj.availability_status.trim() : null
                return lab && st && lab.toLowerCase() !== st ? `${lab} · ${st}` : (lab ?? st)
              })()
              const prompt = buildScoutPrompt(raw, queried, capture, avail)
              // Ralph 2026-06-03 · callScoutBridge now requires explicit
              // Ralph 2026-06-03 (un-hardwire): use the RESOLVED selector
              // — POST body → session config → DEFAULT — not a literal.
              // The api-mode path inside callScoutBridge currently warns
              // and falls through to CLI; build it out when needed.
              const result = await callScoutBridge(prompt, { mode, model })
              const v = result.verdict
              if (v) {
                taste = {
                  who: v.who, buying: v.buying,
                  chf_est: v.chf_est, heads: v.heads,
                  switching_pain: v.switching_pain,
                  pitch: v.pitch,
                  design: v.design, design_cite: v.design_cite,
                  photos: v.photos, photos_cite: v.photos_cite,
                  verdict_subline: v.verdict_subline, verdict_tag: v.verdict_tag,
                  // The tone is the contract — stored, not derived at render.
                  // The interim agent speaks the house enum; once the Consular
                  // takes over (WP-23) it writes the tone itself.
                  verdict_tone: verdictTagTone(v.verdict_tag),
                }
              } else {
                // Bridge ran but the agent didn't call submit_scout_verdict.
                // Capture + queried still recorded so the row isn't a total loss.
                taste = {
                  who: null, buying: null, chf_est: null, heads: null,
                  switching_pain: null, pitch: null, design: null, design_cite: null,
                  photos: null, photos_cite: null, verdict_tag: null, verdict_tone: null,
                  verdict_subline: 'agent did not submit a verdict — no tool call',
                }
              }
            } else {
              taste = {
                who: null, buying: null, chf_est: null, heads: null,
                switching_pain: null, pitch: null, design: null, design_cite: null,
                photos: null, photos_cite: null, verdict_tag: null, verdict_tone: null,
                verdict_subline: `capture failed: ${capture.reason}`,
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
                reviews:     queried.reviews,
                analytics:   queried.analytics,
                marketing:   queried.marketing,
                booking:     queried.booking,
                languages:   queried.languages,
                saas:        queried.saas,
                industry:    queried.industry,
                location:    queried.location,
                sections:    queried.sections,
                // WP-21 (2026-06-10) — the per-page breakdown is the lamp's
                // citation; promote carries it onto intel_json.
                sections_detail: queried.sections_detail,
              },
              sources: queried.sources,
              capture: capture.ok === true
                ? {
                    finalUrl: capture.finalUrl,
                    resolvedIp: capture.resolvedIp,
                    fullPageUrl: capture.fullPageUrl,
                    // Ralph 2026-06-05 — was dropped here; dossier never saw it
                    // even when captureUrl produced a profile JPEG. Gemein-
                    // schaftspraxis practitioner shot lives on this key.
                    profilePageUrl: capture.profilePageUrl ?? null,
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

        // ── SLIDING-WINDOW FAN-OUT (Ralph 2026-06-03, post-mortem). ───────
        // Was: `Promise.allSettled(rawIds.map(processRow))` — 32-at-once.
        // The field result: 24/32 rows landed `capture failed: timeout
        // after 60000ms` because 32 concurrent Chromium pages on one
        // browser singleton starved each other (and SQLite single-writer
        // contention + 32 outbound HTTP fans piled on). Now: a sliding
        // window of `concurrency` workers (default 6) — each picks the
        // next id when its current row finishes, so at most CAP rows are
        // mid-pipeline at any moment. Order preserved.
        //
        // The BATCH is still serialized by withWebdevMutex(SCOUT_SESSION_ID)
        // — two overlapping Scout requests don't double-fan. The bridge step
        // ALSO serializes per `__scout__` session via withSessionLock in
        // scout-bridge-call.ts, so even at concurrency=6 only one bridge
        // call is in flight at a time (others wait their turn). Result:
        // capture+query overlap up to CAP, taste serializes — exactly the
        // throughput shape we want.
        console.log(
          `[scout/taste] batch start — ${rawIds.length} rows, concurrency=${concurrency}, mode=${mode}, model=${model}`,
        )
        let perRow: PerRow[] = []
        try {
          const settled = await mapWithConcurrency(rawIds, concurrency, (id) => processRow(id))
          perRow = settled.map((r, i) =>
            r.status === 'fulfilled'
              ? r.value
              : { id: rawIds[i], status: 'failed', reason: r.reason instanceof Error ? r.reason.message : String(r.reason) },
          )
        } finally {
          // ── BELT-AND-SUSPENDERS WORKER CLEANUP (Ralph 2026-06-03). ───────
          // Each row's bridge call SHOULD release its worker via the per-call
          // `finally { releaseWorker(...) }` in bridge-process-manager.ts.
          // In the wild Ralph found scout CLI subprocesses surviving 49+
          // minutes past the batch — workers "rotting like corpses" that ate
          // the per-session worker pool quota (MAX_WORKERS_PER_SESSION=32),
          // so the second click's button label collapsed from "Run Scout (32)"
          // toward "Run Scout (next 6)" as the pool filled with zombies.
          //
          // bridgeManager.kill(__scout__) is the nuclear option: tear down
          // the entire worker pool for this session in one call (SIGTERM
          // every worker, drop the pool from the map, reject any pending
          // waiters). It's safe here because:
          //   - withWebdevMutex(__scout__) serializes BATCHES → no other
          //     batch can be holding workers right now
          //   - mapWithConcurrency has resolved → every row's bridge call
          //     is fully consumed or settled → no in-flight calls to abort
          //   - __scout__ never spawns a main bridge (useWorker:true only),
          //     so kill() only nukes workers — nothing else to lose
          //
          // Runs in `finally` so the cleanup ALSO fires when mapWithConcurrency
          // throws (e.g. an early abort, a process-level error). Wrapping the
          // kill in its own try-catch keeps the route's return path stable
          // even if the kill itself errors.
          try {
            bridgeManager.kill(SCOUT_SESSION_ID)
            console.log(`[scout/taste] worker pool torn down for ${SCOUT_SESSION_ID}`)
          } catch (err) {
            console.error(`[scout/taste] worker teardown failed (non-fatal):`, err)
          }

          // ── ORPHAN SWEEP (Ralph 2026-06-05). ─────────────────────────────
          // Shared-site mains are content-addressed: when the deep-link or
          // REJECT branch re-shoots root, the FIRST `_main-<oldHash>.jpg`
          // we wrote becomes orphan (this row's fullPageUrl is now newHash).
          // We can't safely delete from inside captureUrl (another row's
          // scout_json might still reference oldHash). The sweep is the
          // authoritative cleanup — reads every row's scout_json, builds
          // the live set, unlinks every `_main-*.jpg` not in it. Runs in
          // its own try so a sweep failure never breaks the batch return.
          try {
            const sweep = (await import('@/lib/scout-orphan-sweep')).sweepSharedMainOrphans
            const swept = await sweep()
            if (swept.deleted > 0) {
              console.log(
                `[scout/taste] orphan-sweep — scanned=${swept.scanned} `
                + `deleted=${swept.deleted} kbFreed=${Math.round(swept.bytesFreed/1024)} — ${swept.removed.slice(0,5).join(', ')}${swept.removed.length > 5 ? ` (+${swept.removed.length-5} more)` : ''}`,
              )
            } else {
              console.log(`[scout/taste] orphan-sweep — clean (scanned=${swept.scanned})`)
            }
          } catch (err) {
            console.error(`[scout/taste] orphan-sweep failed (non-fatal):`, err)
          }
        }

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
      },
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
 * The agent has been instructed (in agents/jedi-scout.md + the tool schema)
 * to call submit_scout_verdict ONCE with the UNIFIED contract — who · buying ·
 * chf_est/heads · switching_pain · pitch (optional) · design/photos + cites ·
 * verdict_subline · verdict_tag. The tone is derived from the house tag at
 * write time; PALAT bands from chf_est ÷ heads at render. gap/heat are dead.
 *
 * `availability` (WP-20 beat 5 — Verfügbarkeit) comes from the FSP register
 * fields on raw_payload when present; it selects which pitch argument exists
 * (demand / right-customers / referrer-recruiter), so the taster sees it.
 */
function buildScoutPrompt(
  raw: { website: string; company?: string | null; name?: string | null; country?: string | null; industry?: string | null },
  queried: QueriedSignals,
  capture: CaptureResult & { ok: true },
  availability: string | null,
): string {
  const leadName = (raw.company || raw.name || '(unnamed)').trim()

  // Ralph 2026-06-05 — the prompt MUST point the agent at every JPEG that was
  // captured for this row. Before this fix the prompt only listed
  // fullPage + innerPage; the practitioner's own profile page AND every
  // `_site-*.jpg` from the multi-page sweep existed on disk but the agent
  // never knew they were there — so it tasted only the homepage even for
  // a Gemeinschaftspraxis where the practitioner-page is the named glass.
  //
  // Listing order matters: the practitioner page first (named glass for
  // shared-site palate), the homepage second (the house — execution), then
  // every additional site page captured. The agent's persona
  // (agents/jedi-scout.md) tells it to "Score palate from their page when
  // it exists" — but ONLY if it knows the path. We give it every path.
  const shotLines: string[] = []
  if (capture.profilePagePath) {
    shotLines.push(`- Practitioner page (the NAMED GLASS — score palate from here): ${capture.profilePagePath}`)
  }
  shotLines.push(`- Homepage / full page (the house — score execution from the whole site): ${capture.fullPagePath}`)
  if (capture.innerPagePath) {
    shotLines.push(`- Inner page: ${capture.innerPagePath}`)
  }
  // Pull every site-level `_*.jpg` in the slot folder (excluding any path
  // we've already listed above). For a Gemeinschaftspraxis these are
  // team/kontakt/kosten/angebot/whatever-the-practice-publishes — the
  // agent reads them to score execution on the whole site, not just the
  // first fold.
  try {
    const slotDir = dirname(capture.fullPagePath)
    if (existsSync(slotDir)) {
      const known = new Set([capture.fullPagePath, capture.profilePagePath, capture.innerPagePath].filter(Boolean) as string[])
      const siteFiles = readdirSync(slotDir)
        .filter((f) => /^_.*\.(?:jpg|png|webp)$/.test(f))
        .map((f) => join(slotDir, f))
        .filter((p) => !known.has(p))
        .sort()
      for (const p of siteFiles) {
        const name = p.split('/').pop() || p
        const label = name.replace(/^_site-/, '').replace(/^_/, '').replace(/\.(jpg|png|webp)$/, '')
        shotLines.push(`- Site page (${label}): ${p}`)
      }
    }
  } catch {
    // best-effort — if listing fails, agent still has the named paths above
  }

  const lines: string[] = [
    '[OSKAR-SYSTEM SCOUT-TASTE]',
    '',
    `Lead: ${leadName}`,
    `Website: ${raw.website}`,
    `Country: ${raw.country || '—'}`,
    `Industry: ${raw.industry || '—'}`,
    '',
    `Screenshots (open EVERY ONE with FileRead before judging — ${shotLines.length} shot${shotLines.length === 1 ? '' : 's'} captured for this row):`,
    ...shotLines,
    '',
    '◐ Queried lamps (cheap context — DNS/Wayback/PageSpeed/HTML, no LLM):',
    `- Age:         ${queried.age || '—'}`,
    `- Stack:       ${queried.stack || '—'}`,
    `- Hosting:     ${queried.hosting || '—'}`,
    `- Performance: ${queried.performance || '—'}`,
    `- SEO:         ${queried.seo || '—'}`,
    `- Traffic:     ${queried.traffic || '—'}`,
    `- Reviews:     ${queried.reviews || '—'}`,
    `- Analytics:   ${queried.analytics || '—'}`,
    `- Marketing:   ${queried.marketing || '—'}`,
    `- Booking:     ${queried.booking || '—'}`,
    `- Languages:   ${queried.languages || '—'}`,
    `- SaaS/CRM:    ${queried.saas || '—'}`,
    `- Industry:    ${queried.industry || '—'}`,
    `- Location:    ${queried.location || '—'}`,
    `- Sections:    ${queried.sections || '—'}${queried.sections_detail ? ` (${queried.sections_detail})` : ''}`,
    `- Availability: ${availability || '—'}${availability ? ' (register/site — are their books open?)' : ''}`,
    '',
    'Taste this site. Name the one discerning choice you actually SAW before you judge — it opens `who`, the portrait. ' +
    'Anchor `chf_est` on the Sections lamp (≈ CHF 300 per section; lean toward 200 where the sections are plain text) ' +
    'and count `heads` from the site. Then call submit_scout_verdict ONCE — the tool schema is the contract. ' +
    'The only failure state is no tool call.',
  ]
  return lines.join('\n')
}

