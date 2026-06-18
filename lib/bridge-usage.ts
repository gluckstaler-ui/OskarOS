// ============================================================================
// lib/bridge-usage.ts — single source of truth for "what tokens did the
// bridge actually use" extraction from a Claude Code stream-json event log.
// Ralph 2026-06-09.
//
// Why this exists
// ---------------
// Two callers (lib/consular-bridge-call.ts and lib/scout-bridge-call.ts) used
// to copy-paste the same `contextSize = input + cache_read + cache_creation`
// formula, both reading `result.usage`. The data on disk proves that's wrong:
// __crm__/logs/USAGE.json showed entries with contextSize = 2,257,491 against
// a 1,000,000 context window — 226%. That's impossible on a single API call
// (the model would reject 2.25M tokens against a 1M window).
//
// Root cause: in Claude Code's stream-json output, the `result` event's
// `usage` field is the **cumulative sum across every tool-use iteration**,
// not the final iteration's individual usage. A Consular turn that fires 3
// tool calls reports 4 iterations' worth of input + cache_read + cache_creation
// added together — which obviously exceeds the per-call context window.
//
// The correct read is the LAST `assistant` event's `message.usage`. That's
// the model's actual context fill on the iteration that produced the final
// response. `result.usage` stays useful for cost computation (cumulative
// dollars is what we want billed) but NOT for the "how full is the window"
// gauge.
//
// Both callers now consume `extractBridgeUsage(events)` and get this fix for
// free. No more porting; no more divergence.
// ============================================================================

// We type the events loosely because Claude Code's stream-json shape evolves
// faster than our type definitions and the safest thing is to defensively
// read the fields we care about.
interface AnyEvent {
  type?: string
  message?: {
    content?: unknown
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  modelUsage?: Record<string, { contextWindow?: number }>
  total_cost_usd?: number
}

export interface BridgeUsage {
  /** Tokens the model actually read on its final iteration (input + cache_read + cache_creation from the LAST assistant event). Bounded by the context window. */
  contextSize: number
  /** The model's declared context window, read off `result.modelUsage[wireKey].contextWindow`. 0 when the wire didn't report one. */
  contextWindow: number
  /** Rounded percentage `contextSize / contextWindow * 100`. 0 when `contextWindow == 0`. */
  contextPct: number
  /** Output tokens on the final iteration. */
  outputTokens: number
  /** Cumulative dollars spent across the WHOLE bridge call (sum of every iteration). This is the right number for billing — we keep it cumulative. */
  totalCostUsd: number
}

/**
 * Extract per-turn usage from a stream-json event log.
 *
 * Returns `null` when the events contain no usage data at all (e.g. the
 * bridge failed before the model emitted anything). Callers should treat
 * null as "don't write a USAGE.json entry for this call."
 */
export function extractBridgeUsage(events: AnyEvent[] | undefined): BridgeUsage | null {
  if (!events || events.length === 0) return null

  // Pull the `result` event for cumulative cost + the modelUsage map (the
  // wire's context-window declaration lives there, not on assistant events).
  const result = events.find((e) => e?.type === 'result')

  // Walk events in reverse to find the LAST `assistant` event with a usage
  // block. That's the model's final-iteration context fill — bounded by the
  // context window, unlike `result.usage` which is cumulative.
  let lastAssistantUsage: NonNullable<AnyEvent['message']>['usage'] | undefined
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e?.type === 'assistant' && e.message?.usage) {
      lastAssistantUsage = e.message.usage
      break
    }
  }

  // Prefer the assistant-event usage (the correct, per-iteration number).
  // Fall back to result.usage ONLY when there's no assistant event — this
  // path will still produce the buggy cumulative number, but the caller's
  // entry is better than nothing for a malformed event log.
  const u = lastAssistantUsage ?? result?.usage
  if (!u) return null

  const cacheRead = u.cache_read_input_tokens ?? 0
  const cacheCreation = u.cache_creation_input_tokens ?? 0
  const input = u.input_tokens ?? 0
  const contextSize = input + cacheRead + cacheCreation
  const outputTokens = u.output_tokens ?? 0

  // Context window is per-model and per-wire. Use whatever the bridge
  // reports; never guess from a hardcoded model→window table.
  const mu = result?.modelUsage
  const wireKey = mu ? Object.keys(mu)[0] : undefined
  const contextWindow = (wireKey ? mu?.[wireKey]?.contextWindow : 0) ?? 0
  const contextPct = contextWindow > 0 ? Math.round((contextSize / contextWindow) * 100) : 0

  // Cost stays cumulative — billing wants the total dollars across every
  // iteration. The usage-tracker derives per-turn cost by diffing against
  // the prior `lastBridgeCumulativeCost`, so the cumulative shape is right.
  const totalCostUsd = result?.total_cost_usd ?? 0

  return { contextSize, contextWindow, contextPct, outputTokens, totalCostUsd }
}
