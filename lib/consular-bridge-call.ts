/**
 * consular-bridge-call.ts — WP-112 (2026-05-29)
 *
 * One-shot helper around `bridgeManager.sendMessage()` for the Consular,
 * modelled on `lib/cd-bridge-call.ts`. It reuses the SAME bridge as CD — the
 * only differences are the agent file (`agents/CONSULAR-agent.md`), the MCP
 * role (`'consular'` → the `crm_query` SQL tool, per `mcp-config.ts`), and the
 * session id (`__crm__`, the Order-66 session). No bespoke runtime, no
 * `runClaudeAgentLoop` fork.
 *
 * WP-111 is retired: callers pass a directive + the prospect id, NOT a
 * pre-assembled envelope. The Consular reads everything it needs about the
 * client itself via `crm_query` (agent-file doctrine), which is also where
 * the notes/amount_chf/lost_reason exclusion + voice-grounding live.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { brainSpec, DEFAULT_BRAIN, requires1M } from './models'
import { bridgeManager, type BridgeOptions, type BridgeEvent } from './bridge-process-manager'
import { CONSULAR_ALLOWED_TOOLS } from './mcp-config'
import { CRM_SESSION_ID, getUserMemoryPath } from './memory/paths'
import { makeToolCollector, type ToolCalls } from './mcp-tool-collector'
import { extractBridgeUsage } from './bridge-usage'
import { resolveConfig } from './session-config'

// The bridge-usage helper accepts a loose event shape; alias BridgeEvent
// to the helper's signature so the cast at the call site is explicit.
type AnyBridgeEvent = Parameters<typeof extractBridgeUsage>[0] extends (infer E)[] | undefined ? E : never

const CONSULAR_AGENT_FILE = join(process.cwd(), 'agents', 'CONSULAR-agent.md')

// Per-session mutex — the __crm__ bridge has one stdin/stdout; concurrent
// sends would interleave. Same pattern as cd-bridge-call.
const inflight = new Map<string, Promise<unknown>>()
function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = inflight.get(sessionId) || Promise.resolve()
  const next = prev.then(() => fn(), () => fn())
  inflight.set(sessionId, next)
  next.finally(() => { if (inflight.get(sessionId) === next) inflight.delete(sessionId) })
  return next
}

/**
 * System prompt = identity file + Filippo's portrait (db/user.md). The
 * per-turn directive rides in the message content; the agent SQL-reads the
 * rest. getOrSpawn ignores systemPrompt when the bridge is already warm, so
 * this only matters on a cold __crm__ spawn.
 */
function buildConsularPrompt(): string {
  let identity = ''
  try { identity = readFileSync(CONSULAR_AGENT_FILE, 'utf-8') } catch { /* agent file missing — bridge still runs, just unflavored */ }
  let portrait = ''
  try { portrait = readFileSync(getUserMemoryPath(CRM_SESSION_ID), 'utf-8') } catch { /* no portrait yet (fresh CRM) */ }
  return portrait
    ? `${identity}\n\n---\n# Filippo — current portrait (db/user.md)\n\n${portrait}`
    : identity
}

export interface ConsularCallResult {
  /** Full text reply (concatenated `text` blocks). */
  text: string
  events: BridgeEvent[]
  /** Captured tool_use args, keyed by bare tool name (e.g. `submit_image_prompt`). */
  toolCalls: ToolCalls
  durationMs: number
  /** Truth on the wire — the model that actually served this turn, read off the
   *  last assistant event's `message.model` (NOT the request alias). Feeds the
   *  ConversationPanel's Active Model badge, same doctrine as Studio. Null when
   *  the wire reported none. */
  model: string | null
}

/**
 * Send a one-shot message to the Consular bridge (`__crm__`). Mirrors
 * `callCDBridge`. Pass `expectedTools` (e.g. `['submit_image_prompt']`) to
 * capture typed tool args — that's how the /ask route gets the committed
 * draft back.
 *
 * Model defaults to `claude-fable-5` (same as CD); overridable, and the
 * Consular model is still an open decision (§16.7).
 */
export async function callConsularBridge(
  content: string,
  opts: { model?: string; expectedTools?: readonly string[] } = {},
): Promise<ConsularCallResult> {
  // Resolve the brain from the CRM session config (the FABLE/OPUS badge writes
  // it to __crm__) → registry default fallback. Bare id; the bridge re-roll
  // verifies the 1M window. Ralph 2026-06-10.
  const cdModel = opts.model || resolveConfig('cdModel', null, CRM_SESSION_ID, brainSpec(DEFAULT_BRAIN).id)
  const options: BridgeOptions = {
    model: cdModel,
    systemPrompt: buildConsularPrompt(),
    cwd: process.cwd(),
    agentRole: 'consular',
    allowedTools: CONSULAR_ALLOWED_TOOLS,
    // Refuse 200K models: the upstream sometimes serves a degraded window under
    // the 1M model name. ensure1M makes the bridge re-roll a fresh __crm__ spawn
    // until the wire-reported contextWindow is actually 1M. Ralph 2026-05-29.
    ensure1M: requires1M(cdModel),
  }
  const toolCollector = makeToolCollector(opts.expectedTools || [])

  return withSessionLock(CRM_SESSION_ID, async () => {
    const start = Date.now()
    const events: BridgeEvent[] = []
    let text = ''
    let wireModel: string | null = null
    for await (const event of bridgeManager.sendMessage(CRM_SESSION_ID, content, options)) {
      events.push(event)
      toolCollector.consume(event)
      if (event.type === 'assistant' && event.message?.content) {
        // Truth on the wire: assistant events carry the model that actually
        // served the turn (the same source bridge-process-manager trusts for
        // actualModel — init only echoes the request).
        if (typeof event.message.model === 'string' && event.message.model) wireModel = event.message.model
        for (const block of event.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') text += block.text
        }
      }
      if (event.type === 'result') break
    }

    // Record the Consular turn's context-window fill + cost to USAGE.json so
    // the CRM gauge can MEASURE how full the window is. Extraction is
    // centralised in `lib/bridge-usage.ts` — the formula was previously
    // duplicated here and in scout-bridge-call.ts, both with the same bug:
    // `result.usage` is the CUMULATIVE sum across every tool-use iteration,
    // not the final iteration. A Consular turn with 3 tool calls produced
    // 226% context fills against a 1M window (mathematically impossible).
    // The helper now reads the LAST assistant event's `message.usage`,
    // which is the actual per-iteration fill, bounded by the window.
    // Best-effort — never break the chat reply.
    try {
      const usage = extractBridgeUsage(events as AnyBridgeEvent[])
      if (usage) {
        const { appendUsage } = await import('./usage-tracker')
        await appendUsage(
          CRM_SESSION_ID,
          'CD',
          { inputTokens: usage.contextSize, outputTokens: usage.outputTokens, cost: usage.totalCostUsd },
          'Consular chat (bridge)',
          { contextPct: usage.contextPct, contextWindow: usage.contextWindow, contextSize: usage.contextSize },
          usage.totalCostUsd,
          'cli',
        )
      }
    } catch (err) {
      console.warn('[consular-bridge] usage record failed (non-fatal):', err)
    }

    return { text, events, toolCalls: toolCollector.getToolCalls(), durationMs: Date.now() - start, model: wireModel }
  })
}
