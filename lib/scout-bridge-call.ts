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
 * Heat derivation is server-side per §17 [SCOUT-J]:
 *
 *     gap  = palate − execution
 *     heat = gap ≥ +2 ? 'hot'  :
 *            gap >= +1 ? 'warm' :
 *            /* gap <= 0 *\/ 'cold'
 *
 * NEVER read `heat` or `gap` from the model — those fields are not on the
 * `submit_scout_verdict` schema. Only palate / palate_choice / execution /
 * verdict / photos are model-trusted; gap + heat are computed here.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { bridgeManager, type BridgeOptions, type BridgeEvent } from './bridge-process-manager'
import { SCOUT_ALLOWED_TOOLS } from './mcp-config'
import { makeToolCollector } from './mcp-tool-collector'
import type { ExecutionMode } from './session-config'

const SCOUT_AGENT_FILE = join(process.cwd(), 'agents', 'jedi-scout.md')
const SCOUT_SESSION_ID = '__scout__'

// Per-session mutex — even on an ephemeral worker, callers might fire
// overlapping taste-requests; the bridge can't interleave them on one stdio.
// This matches the discipline in consular-bridge-call.ts.
const inflight = new Map<string, Promise<unknown>>()
function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = inflight.get(sessionId) || Promise.resolve()
  const next = prev.then(() => fn(), () => fn())
  inflight.set(sessionId, next)
  next.finally(() => { if (inflight.get(sessionId) === next) inflight.delete(sessionId) })
  return next
}

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
export interface ScoutVerdict {
  palate: number          // 1-5 (model)
  palate_choice: string   // (model) — the visual decision the eye saw
  execution: number       // 1-5 (model)
  verdict: string         // one-line prose (model)
  photos: string          // 10-30 words on the imagery (model)
  gap: number             // palate − execution (server)
  heat: 'hot' | 'warm' | 'cold'  // banded server-side (server)
}

export interface ScoutCallResult {
  /** The structured verdict if the agent submitted one; null on a typeless reply. */
  verdict: ScoutVerdict | null
  /** The agent's prose reply (concatenated text blocks). */
  text: string
  events: BridgeEvent[]
  durationMs: number
}

/** Coerce the raw tool-call args into the typed verdict, server-deriving gap+heat. */
function deriveVerdict(raw: Record<string, unknown> | undefined): ScoutVerdict | null {
  if (!raw) return null
  const palate = Number(raw.palate)
  const execution = Number(raw.execution)
  if (!Number.isFinite(palate) || !Number.isFinite(execution)) return null
  if (palate < 1 || palate > 5 || execution < 1 || execution > 5) return null
  const palate_choice = String(raw.palate_choice ?? '').trim()
  const verdictText = String(raw.verdict ?? '').trim()
  const photos = String(raw.photos ?? '').trim()
  if (!palate_choice || !verdictText) return null
  // Locked three-tier band — gap ≥ +2 hot · ≥ +1 warm · ≤ 0 cold (§17 [SCOUT-J]).
  const gap = palate - execution
  const heat: 'hot' | 'warm' | 'cold' = gap >= 2 ? 'hot' : gap >= 1 ? 'warm' : 'cold'
  return { palate, palate_choice, execution, verdict: verdictText, photos, gap, heat }
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
    // ensure1M only when the resolved model carries the `[1m]` suffix —
    // a non-1M model (e.g. plain `claude-sonnet-4-6` on the api selector)
    // would otherwise trigger an infinite re-roll loop. The guard's purpose
    // is to defeat silent downgrade, not to force 1M where it wasn't asked.
    ensure1M: opts.model.endsWith('[1m]'),
  }
  const toolCollector = makeToolCollector(['submit_scout_verdict'])

  return withSessionLock(SCOUT_SESSION_ID, async () => {
    const start = Date.now()
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

    // Usage recording — mirrors the consular-bridge pattern (best-effort, never
    // breaks the taste reply). Records under the __scout__ session so spend
    // shows up against the Scout in db/USAGE.json.
    try {
      const result = events.find((e) => e.type === 'result')
      const u = result?.usage as {
        input_tokens?: number; output_tokens?: number
        cache_read_input_tokens?: number; cache_creation_input_tokens?: number
      } | undefined
      if (u) {
        const { appendUsage } = await import('./usage-tracker')
        const mu = result?.modelUsage as Record<string, { contextWindow?: number }> | undefined
        const wireKey = mu ? Object.keys(mu)[0] : undefined
        const contextWindow = (wireKey && mu?.[wireKey]?.contextWindow) || 0
        const cacheRead = u.cache_read_input_tokens || 0
        const cacheCreation = u.cache_creation_input_tokens || 0
        const input = u.input_tokens || 0
        const contextSize = input + cacheRead + cacheCreation
        const contextPct = contextWindow > 0 ? Math.round((contextSize / contextWindow) * 100) : 0
        const bridgeCumulativeCost = result?.total_cost_usd || 0
        await appendUsage(
          SCOUT_SESSION_ID,
          'CD',
          { inputTokens: contextSize, outputTokens: u.output_tokens || 0, cost: bridgeCumulativeCost },
          'Scout taste (bridge, useWorker)',
          { contextPct, contextWindow, contextSize },
          bridgeCumulativeCost,
          'cli',
        )
      }
    } catch (err) {
      console.warn('[scout-bridge] usage record failed (non-fatal):', err)
    }

    return { verdict, text, events, durationMs: Date.now() - start }
  })
}
