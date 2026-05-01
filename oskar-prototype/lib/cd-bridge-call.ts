/**
 * cd-bridge-call.ts — WP-15 (built 2026-04-17, caps removed 2026-04-17)
 *
 * One-shot helper around `bridgeManager.sendMessage()`. Used by the
 * proofread, verdict, and ask-cd routes — every WP-15 CD interaction goes
 * through here so there is exactly ONE CD identity per session (the same
 * bridge that powers Briefing chat).
 *
 * Responsibilities:
 *   1. **Per-session serialization.** The bridge process has one stdin and
 *      one stdout; concurrent `sendMessage` calls would interleave events
 *      from different turns. We serialize via an in-memory mutex keyed by
 *      sessionId — second caller waits for the first to finish.
 *   2. **Collect to a single string.** Most callers want CD's full text
 *      reply, not the streaming events. We accumulate `block.type === 'text'`
 *      content from `assistant` events and return it as `{ text }`.
 *
 * NO TIMEOUT — removed per Ralph 2026-04-17. Caps lead to bugs and silent
 * failures. CD takes as long as it needs; Generate blocks on it. The user
 * sees a "CD reviewing…" state and waits. Real latency, real proofread.
 *
 * Call shape:
 *
 *   const result = await callCDBridge(sessionId, '[OSKAR-SYSTEM PROOFREAD]\n…')
 *   // CD's full text reply is in result.text
 */

import { bridgeManager, type BridgeOptions, type BridgeEvent } from './bridge-process-manager'
import { buildCDPrompt } from './cd-agent-prompt'
import { makeToolCollector, type ToolCalls } from './mcp-tool-collector'

// ─────────────────────────────────────────────────────────────────────────────
// Per-session mutex — prevents bridge stdin/stdout interleaving.
// ─────────────────────────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>()

function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = inflight.get(sessionId) || Promise.resolve()
  // Chain off the previous turn (ignore its result/error so one failure
  // doesn't reject the next caller — they get a fresh attempt).
  const next = prev.then(() => fn(), () => fn())
  inflight.set(sessionId, next)
  // Clean up the map entry once this call finishes — keeps inflight from
  // growing unbounded over a long-lived session.
  next.finally(() => {
    if (inflight.get(sessionId) === next) inflight.delete(sessionId)
  })
  return next
}

// ─────────────────────────────────────────────────────────────────────────────
// Public call helper
// ─────────────────────────────────────────────────────────────────────────────

export interface CallCDOptions extends Partial<BridgeOptions> {
  /** Override the default model — defaults to claude-opus-4-7[1m] (Big CD). */
  model?: string
  /**
   * Phase 2 (2026-04-30): structured-response migration. When the caller
   * expects CD to call a specific MCP tool (e.g. `submit_proofread`,
   * `submit_image_verdict`), pass the tool name(s) here. The bridge stream
   * is scanned for matching `tool_use` events; the typed args land in the
   * returned `result.toolCalls` map. The wrapping endpoint reads structured
   * data from there instead of regexing CD's text.
   *
   * Empty / omitted = behave like before, only collect text.
   */
  expectedTools?: readonly string[]
}

export interface CDCallResult {
  /** CD's full text reply (concatenation of all `text` blocks in `assistant` events). */
  text: string
  /** Raw events captured. Useful for debugging / downstream parsing. */
  events: BridgeEvent[]
  /**
   * Captured `tool_use` args, keyed by bare tool name (the MCP `mcp__server__`
   * prefix is stripped by lib/mcp-tool-collector). Populated only for tool
   * names listed in `opts.expectedTools`. Last-write-wins per tool.
   */
  toolCalls: ToolCalls
  /** Time spent waiting (ms). Pure measurement; no timeout policy attached. */
  durationMs: number
}

/**
 * Send a one-shot message to a session's Big CD bridge. Returns CD's full
 * text reply (or whatever events arrived before the optional timeout).
 *
 * Per WP-15: all CD interactions in Image Mode + Briefing share the same
 * bridge. Callers may not spawn anonymous models. This is the gateway.
 */
export async function callCDBridge(
  sessionId: string,
  content: string,
  opts: CallCDOptions = {}
): Promise<CDCallResult> {
  if (!sessionId) {
    return { text: '', events: [], toolCalls: {}, durationMs: 0 }
  }

  // BridgeOptions has required fields. If the caller didn't supply a
  // systemPrompt, build the standard CD prompt so a cold spawn (e.g. when
  // a WP-15 endpoint is the FIRST caller for this session — proofread
  // before any Briefing message) gives CD its identity. Without this,
  // an empty systemPrompt would leave CD as "an LLM with no instructions"
  // — worse than no agent identity.
  //
  // bridgeManager.getOrSpawn ignores systemPrompt when a process is already
  // running for this session, so this only matters on cold spawn / restart.
  const systemPrompt =
    opts.systemPrompt ||
    buildCDPrompt(
      [], // sourceImages empty; bridge boot doesn't need them
      sessionId,
      true, // isResume — the bridge will likely have history (or we're cold-resuming)
      undefined, // sessionFiles not loaded here; CD reads them via FileRead as needed
      false // bridgeResumed false because we don't know
    )

  const options: BridgeOptions = {
    model: opts.model || 'claude-opus-4-7[1m]',
    systemPrompt,
    cwd: opts.cwd || process.cwd(),
  }

  // Phase 2: optional tool-call collector. When the caller declares the
  // tools it expects (e.g. submit_proofread for the proofread endpoint),
  // we scan the stream for matching tool_use events and surface their args.
  const toolCollector = makeToolCollector(opts.expectedTools || [])

  return withSessionLock(sessionId, async () => {
    const start = Date.now()
    const events: BridgeEvent[] = []
    let text = ''

    // Wait for CD's full reply. No timeout — caps lead to silent failures.
    // If the bridge hangs, the request hangs; that's a real signal worth
    // surfacing, not papering over with a fake "passed" fallthrough.
    for await (const event of bridgeManager.sendMessage(sessionId, content, options)) {
      events.push(event)
      // Always feed the tool collector — it's a no-op when expectedTools is
      // empty (the internal Set is empty so nothing matches).
      toolCollector.consume(event)
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text
          }
        }
      }
      if (event.type === 'result') break
    }

    return {
      text,
      events,
      toolCalls: toolCollector.getToolCalls(),
      durationMs: Date.now() - start,
    }
  })
}
