/**
 * scout-bridge-call.ts — WP-SCOUT-3 (Ralph 2026-06-03).
 *
 * One-shot helper around `bridgeManager.sendMessage()` for the Jedi Scout.
 * Mirrors `lib/consular-bridge-call.ts` but with TWO key deviations:
 *
 *   1. `useWorker: true` — every call spawns a FRESH ephemeral CLI subprocess
 *      and exits when the tasting is done. There is no resumable session.
 *      The Scout's job is a one-shot taste per lead; we never want a turn N
 *      to be coloured by turn N-1's prospect. Distinct from the Consular,
 *      which holds the `__crm__` session warm for conversational continuity.
 *
 *   2. Session id `__scout__` — purely a routing key (the worker is
 *      ephemeral). It exists so the agent file (`agents/jedi-scout.md`) is
 *      loaded once and so MCP traffic from the worker is attributable.
 *
 * Verdict contract (Ralph 2026-06-10 · TASTED redesign — unified with Kanban):
 *
 *   - palate_choice = WHO, the portrait (reused field)
 *   - execution     = BUYING readiness 0–5 (reused field; 5 cited criteria)
 *   - chf_est/heads = the agent's CHF estimate + headcount; PALAT/BUDGET is
 *                     DERIVED from them (lib/verdict palateBand) — never stored
 *   - design/photos = 0–5 evidence lamps + one-line citations
 *   - verdict_tag   = PERSUE · WARMING UP · WATCH · SKIP (color derives from it)
 *
 * gap/heat are RETIRED — the old gap = palate − execution band is gone; the
 * verdict tag carries the heat. Legacy rows read-map via tagFromLegacyHeat.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { isVerdictTag, type VerdictTag } from './verdict'
import { bridgeManager, type BridgeOptions, type BridgeEvent } from './bridge-process-manager'
import { SCOUT_ALLOWED_TOOLS } from './mcp-config'
import { makeToolCollector } from './mcp-tool-collector'
import type { ExecutionMode } from './session-config'

const SCOUT_AGENT_FILE = join(process.cwd(), 'agents', 'jedi-scout.md')
const SCOUT_SESSION_ID = '__scout__'

// NO PER-SESSION LOCK (Ralph 2026-06-03, post-mortem).
//
// An earlier rev copied the `withSessionLock` discipline from
// consular-bridge-call.ts verbatim. That was wrong here:
//
//   - The Consular uses a WARM shared bridge (one stdio per `__crm__` session).
//     Concurrent turns there WOULD interleave on the shared transport, so the
//     lock is load-bearing for it.
//   - The Scout uses `useWorker: true` — every call spawns a FRESH CLI
//     subprocess (lib/bridge-process-manager.ts:spawnFreshWorker), each with
//     its own stdio. There is NO shared transport to protect.
//
// With the lock present, 32-row Scout batches serialized at the bridge step:
// the row-pipeline cap of 6 (in scout/taste/route.ts) parallelized capture,
// but every taste queued behind every other taste on `__scout__`, turning
// the bridge phase into ~32 × 12s = ~6.5 min serial. Removing the lock lets
// bridge calls run concurrently up to the bridge's MAX_WORKERS_PER_SESSION
// (32) — which in practice is bounded by the row-pipeline cap upstream.
//
// If you ever flip the Scout off `useWorker` (warm-bridge mode), put the
// lock BACK — the warm transport will need it for the same reason the
// Consular does.

/**
 * Build the system prompt for the Scout. Identity comes from
 * `agents/jedi-scout.md` (the persona). On a `useWorker:true` call the worker
 * is fresh every time, so this is always read — no warm-bridge skip path.
 */
function buildScoutPrompt(): string {
  try {
    return readFileSync(SCOUT_AGENT_FILE, 'utf-8')
  } catch {
    // Agent file missing — the bridge still runs, just unflavored. Logged so
    // the next maintainer can see why the taste sounds generic.
    console.warn('[scout-bridge] agents/jedi-scout.md not readable; persona will be unflavored')
    return ''
  }
}

// The verdict the Scout returns (the typed surface from submit_scout_verdict).
// Arg names = the UNIFIED blob keys (who/buying/…) — one language end-to-end.
export interface ScoutVerdict {
  who: string                    // WHO — the portrait (model)
  buying: number                 // BUYING readiness 0-5 (model, cited seed)
  chf_est: number                // realistic CHF redesign estimate (model)
  heads: number                  // headcount counted from the site, ≥1 (model)
  switching_pain: string | null  // how dug-in the incumbent is (model)
  pitch: string | null           // OPTIONAL — pitch rows, one per line, CHF-anchored (model)
  design: number                 // design quality 0-5 (model)
  design_cite: string | null     // one-line citation (model)
  photos: number                 // photos quality 0-5 (model)
  photos_cite: string | null     // one-line citation (model)
  verdict_subline: string        // one-line prose (model)
  verdict_tag: VerdictTag        // house enum for the interim agent; free text once the Consular writes (model)
}

export interface ScoutCallResult {
  /** The structured verdict if the agent submitted one; null on a typeless reply. */
  verdict: ScoutVerdict | null
  /** The agent's prose reply (concatenated text blocks). */
  text: string
  events: BridgeEvent[]
  durationMs: number
}

/** Coerce the raw tool-call args into the typed verdict. No derivation — the
 *  agent's output IS the contract; PALAT bands at render from chf_est/heads. */
function deriveVerdict(raw: Record<string, unknown> | undefined): ScoutVerdict | null {
  if (!raw) return null
  const score05 = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n) : null
  }
  const buying = score05(raw.buying)
  const design = score05(raw.design)
  const photos = score05(raw.photos)
  const chf_est = Number(raw.chf_est)
  const heads = Number(raw.heads)
  const who = String(raw.who ?? '').trim()
  const verdictText = String(raw.verdict_subline ?? '').trim()
  const tag = String(raw.verdict_tag ?? '').trim().toUpperCase()
  if (buying == null || design == null || photos == null) return null
  if (!Number.isFinite(chf_est) || chf_est <= 0 || !Number.isFinite(heads) || heads < 1) return null
  if (!who || !verdictText || !isVerdictTag(tag)) return null
  const line = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
  return {
    who, buying, chf_est: Math.round(chf_est), heads: Math.round(heads),
    switching_pain: line(raw.switching_pain),
    pitch: line(raw.pitch),
    design, design_cite: line(raw.design_cite),
    photos, photos_cite: line(raw.photos_cite),
    verdict_subline: verdictText, verdict_tag: tag,
  }
}

/**
 * Send a one-shot tasting message to the Scout. `content` is the per-lead
 * directive: the imported lead fields, the captured screenshot paths (full +
 * optional inner), the ◐ Queried code-signals if available. The Scout reads
 * those and calls `submit_scout_verdict` ONCE.
 *
 * Model + transport are REQUIRED params (Ralph 2026-06-03 — no hardwire).
 * The caller (the taste route) resolves them from:
 *   1. the request body (client passes localStorage.oskar_billing_mode +
 *      the Scout's per-mode model — SCOUT_MODE_DEFAULTS[mode], Sonnet),
 *   2. the route's SCOUT_MODE_DEFAULTS fallback (also Sonnet),
 *   3. caller default if neither — `cli` + `claude-sonnet-4-6[1m]`.
 *
 * Transports:
 *   - 'cli' / 'smpl' → Claude CLI subprocess via `bridgeManager.sendMessage`
 *     + `useWorker:true` (ephemeral worker, no --resume, no cross-lead bleed).
 *     This is the Max-plan path Ralph uses.
 *   - 'api'          → TODO: not yet wired. The selector arrives, the
 *     fallback warns + still uses the CLI. Building the direct-Anthropic-SDK
 *     path is a follow-on; for now the route SHOULD prevent 'api' from
 *     reaching here (better UX is a clear refuse than a silent fallback,
 *     but a silent fallback is still safer than a crash).
 *
 * Server-side derivation discipline: `gap` and `heat` are NEVER read from
 * the model — they're computed here from `palate` and `execution` after
 * the typed verdict comes back. Locked 3-tier band per §17 [SCOUT-J].
 *
 * @example
 *   const r = await callScoutBridge(prompt, {
 *     model: 'claude-sonnet-4-6[1m]',  // resolved from session config
 *     mode: 'cli',                      // resolved from session config
 *   })
 *   r.verdict  // { palate:4, execution:1, gap:3, heat:'hot', ... }
 */
export async function callScoutBridge(
  content: string,
  opts: { model: string; mode: ExecutionMode },
): Promise<ScoutCallResult> {
  if (opts.mode === 'api') {
    // The bridge can only do CLI. Surface the gap loudly so the next debug
    // session knows where the user's selector got truncated; the fallback
    // keeps the batch running so a half-implemented selector doesn't 500
    // every Scout click. Replace with a real Anthropic-SDK path later.
    console.warn(
      '[scout-bridge] api mode selected but the API path is not wired yet — ' +
      'falling back to CLI. Switch the TopBar selector to CLI or build the ' +
      'API path in lib/scout-bridge-call.ts to remove this fallback.',
    )
  }
  const options: BridgeOptions = {
    model: opts.model,
    // PERSONA stays Scout — agents/jedi-scout.md is loaded regardless of the
    // MCP-identity role below. The wine/sommelier voice + 1-5 palate/execution
    // rubric live in the system prompt, decoupled from the role string.
    systemPrompt: buildScoutPrompt(),
    cwd: process.cwd(),
    // ROLE-AS-CD WORKAROUND (Ralph 2026-06-03). The proper role 'scout' is
    // currently rejected by 5 runtime VALID_ROLES sets (app/api/mcp/server/,
    // agent-inbox/, notify-agent/, claim-orphan/, lib/agent-inbox-bus.ts) —
    // every scout worker hit HTTP 400 "X-Oskar-Agent must be one of: cd,
    // webdev, sentinel, jedi-code, consular" before tools/list ran, so
    // submit_scout_verdict never reached the model and EVERY row came back
    // "agent did not submit a verdict". Identifying as 'cd' passes every
    // gate (cd is always valid) and inherits CD_ALLOWED, which now contains
    // submit_scout_verdict (commit 304eee3). The session id stays __scout__
    // so usage attribution + .cache file routing remain Scout-shaped.
    //
    // Proper fix later: register 'scout' as a first-class role across the
    // 5 VALID_ROLES sets + audit any other agentRole-keyed surfaces (usage
    // tracker, agent-status, MCP server's per-role tool filter).
    agentRole: 'cd',
    allowedTools: SCOUT_ALLOWED_TOOLS,
    // Ephemeral CLI worker, no --resume, no warm session. Each taste is
    // fresh, no cross-lead bleed. Worker route is CLI-only; the API path
    // (if/when built) would bypass bridgeManager entirely.
    useWorker: true,
  }
  // No per-session lock — see the file-top comment. Each useWorker:true call
  // spawns a fresh CLI subprocess via bridgeManager.spawnFreshWorker, so 6
  // concurrent rows (the row-pipeline cap) cleanly run 6 concurrent bridges.
  //
  // Ralph 2026-06-05 — RETRY-ONCE on missing-verdict. Sonnet has a residual
  // ~30-50% stochastic refusal-to-tool-call even when given a valid
  // screenshot (verified empirically on praxis-z.ch: 4 byte-identical
  // captures, 3 produced verdicts, 1 silent). The persona was updated to
  // say "the only failure state is no tool call" (agents/jedi-scout.md);
  // this retry catches the residue. Costs at most 1 extra Sonnet call per
  // silent failure. Fresh CLI subprocess each attempt (worker-pool pattern),
  // so no contamination between tries.
  const start = Date.now()
  const MAX_ATTEMPTS = 2

  async function runOneAttempt(): Promise<{ verdict: ScoutVerdict | null; text: string; events: BridgeEvent[] }> {
    const toolCollector = makeToolCollector(['submit_scout_verdict'])
    const events: BridgeEvent[] = []
    let text = ''
    for await (const event of bridgeManager.sendMessage(SCOUT_SESSION_ID, content, options)) {
      events.push(event)
      toolCollector.consume(event)
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') text += block.text
        }
      }
      if (event.type === 'result') break
    }
    const raw = toolCollector.getToolCalls().submit_scout_verdict as Record<string, unknown> | undefined
    const verdict = deriveVerdict(raw)
    return { verdict, text, events }
  }

  let attempt = 0
  let verdict: ScoutVerdict | null = null
  let text = ''
  // A wedged worker must fail the ROW, never pin the batch (Ralph 2026-06-11
  // post-mortem: 4 of 32 rows hung >1h with ZERO live worker processes — the
  // stream's `result` event never came, the for-await pended forever, and the
  // escrow job sat at "running" eternally). The deadline converts a hang into
  // a no-verdict attempt; the retry-once below then applies. A slow-but-alive
  // worker is abandoned, not killed — it exits on its own.
  const ATTEMPT_TIMEOUT_MS = 240_000

  let events: BridgeEvent[] = []
  while (attempt < MAX_ATTEMPTS) {
    attempt++
    const r = await Promise.race([
      runOneAttempt(),
      new Promise<{ verdict: null; text: string; events: BridgeEvent[] }>((resolve) =>
        setTimeout(
          () => resolve({
            verdict: null,
            text: `taste timeout after ${ATTEMPT_TIMEOUT_MS / 1000}s — worker stream never ended`,
            events: [],
          }),
          ATTEMPT_TIMEOUT_MS,
        ),
      ),
    ])
    verdict = r.verdict
    text = r.text
    events = r.events
    if (verdict) break
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[scout-bridge] attempt ${attempt} produced no verdict — retrying once`)
    }
  }
  if (!verdict && attempt > 1) {
    console.warn(`[scout-bridge] both attempts produced no verdict — giving up`)
  }

  // Usage recording — mirrors the consular-bridge pattern (best-effort, never
  // breaks the taste reply). Ralph 2026-06-05 — rolled up into __crm__
  // (Consular's USAGE.json), NOT __scout__. Reasoning: the user-facing
  // usage badge reads from Consular's session — scout work IS work done
  // on the user's behalf inside the CRM flow, so its tokens and dollars
  // should appear next to the rest of the consular spend. Keeping a
  // separate __scout__ usage file fragmented the ledger AND ran straight
  // into ENOENT because public/__scout__/logs/ doesn't exist (the dir is
  // a route key, not a real session directory). The bridge routing key
  // stays SCOUT_SESSION_ID (`__scout__`) — that's the worker-pool tag,
  // unrelated to where the meter ticks.
  try {
    // Ralph 2026-06-09 — extraction moved to lib/bridge-usage.ts (shared
    // with lib/consular-bridge-call.ts). The previous copy-pasted formula
    // used `result.usage` which is the cumulative sum across every
    // tool-use iteration — produced impossible 226% gauge readings.
    const { extractBridgeUsage } = await import('./bridge-usage')
    const usage = extractBridgeUsage(events as Parameters<typeof extractBridgeUsage>[0])
    if (usage) {
      const { appendUsage } = await import('./usage-tracker')
      await appendUsage(
        '__crm__',  // ← Consular's session; spend rolls up where the badge reads it
        'CD',
        { inputTokens: usage.contextSize, outputTokens: usage.outputTokens, cost: usage.totalCostUsd },
        'Scout taste (bridge, useWorker)',
        { contextPct: usage.contextPct, contextWindow: usage.contextWindow, contextSize: usage.contextSize },
        usage.totalCostUsd,
        'cli',
      )
    }
  } catch (err) {
    console.warn('[scout-bridge] usage record failed (non-fatal):', err)
  }

  return { verdict, text, events, durationMs: Date.now() - start }
}
