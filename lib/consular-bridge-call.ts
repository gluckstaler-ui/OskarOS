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
import { bridgeManager, type BridgeOptions, type BridgeEvent } from './bridge-process-manager'
import { CONSULAR_ALLOWED_TOOLS } from './mcp-config'
import { CRM_SESSION_ID, getUserMemoryPath } from './memory/paths'
import { makeToolCollector, type ToolCalls } from './mcp-tool-collector'

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
}

/**
 * Send a one-shot message to the Consular bridge (`__crm__`). Mirrors
 * `callCDBridge`. Pass `expectedTools` (e.g. `['submit_image_prompt']`) to
 * capture typed tool args — that's how the /ask route gets the committed
 * draft back.
 *
 * Model defaults to `claude-opus-4-8[1m]` (same as CD); overridable, and the
 * Consular model is still an open decision (§16.7).
 */
export async function callConsularBridge(
  content: string,
  opts: { model?: string; expectedTools?: readonly string[] } = {},
): Promise<ConsularCallResult> {
  const options: BridgeOptions = {
    model: opts.model || 'claude-opus-4-8[1m]',
    systemPrompt: buildConsularPrompt(),
    cwd: process.cwd(),
    agentRole: 'consular',
    allowedTools: CONSULAR_ALLOWED_TOOLS,
    // Refuse 200K models: the upstream sometimes serves a degraded window under
    // the 1M model name. ensure1M makes the bridge re-roll a fresh __crm__ spawn
    // until the wire-reported contextWindow is actually 1M. Ralph 2026-05-29.
    ensure1M: true,
  }
  const toolCollector = makeToolCollector(opts.expectedTools || [])

  return withSessionLock(CRM_SESSION_ID, async () => {
    const start = Date.now()
    const events: BridgeEvent[] = []
    let text = ''
    for await (const event of bridgeManager.sendMessage(CRM_SESSION_ID, content, options)) {
      events.push(event)
      toolCollector.consume(event)
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') text += block.text
        }
      }
      if (event.type === 'result') break
    }

    // Record the Consular turn's context-window fill + cost to USAGE.json so
    // the CRM gauge can MEASURE how full the window is. We use the numbers
    // Anthropic reports DIRECTLY — no heuristics:
    //   · window  = result.modelUsage[model].contextWindow (wire truth; the CLI
    //               reports it per-turn — opus-4-8 = 1M). NO lookup table: if the
    //               wire doesn't report a window we record 0, never guess from a
    //               hardcoded model→window map. The agent's result IS the source.
    //   · fill    = result.usage.{input + cache_read + cache_creation} — the
    //               EXACT tokens the model read on the final iteration (the
    //               top-level `usage` IS that iteration, confirmed against
    //               usage.iterations + the assistant message). We deliberately
    //               do NOT use modelUsage.cacheReadInputTokens — that one is the
    //               cumulative roll-up across iterations and would over-count;
    //               and we do NOT divide by num_turns (that was a stale estimate
    //               for a cumulative field this one isn't).
    // Best-effort — never break the chat reply. Ralph 2026-05-29.
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
          CRM_SESSION_ID,
          'CD',
          { inputTokens: contextSize, outputTokens: u.output_tokens || 0, cost: bridgeCumulativeCost },
          'Consular chat (bridge)',
          { contextPct, contextWindow, contextSize },
          bridgeCumulativeCost,
          'cli',
        )
      }
    } catch (err) {
      console.warn('[consular-bridge] usage record failed (non-fatal):', err)
    }

    return { text, events, toolCalls: toolCollector.getToolCalls(), durationMs: Date.now() - start }
  })
}
