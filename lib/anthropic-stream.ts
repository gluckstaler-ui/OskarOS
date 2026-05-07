/**
 * Anthropic Messages API streaming helper (Ralph 2026-05-03).
 *
 * Replaces the non-streaming fetch path in API mode with a real
 * stream:true call + SSE event parser. Each parsed Anthropic event is
 * yielded as a `StreamEvent` so the caller can:
 *   - forward to the WP-2.1 ChatSseEvent → client SSE pipe (live UI)
 *   - accumulate content blocks into a final assistant message for the
 *     tool-use loop continuation
 *   - extract usage (incl. cache_creation/cache_read tokens) at end
 *
 * Anthropic SSE event types we care about:
 *   message_start          — top-level message metadata + initial usage
 *   content_block_start    — a new block opens (text | tool_use | thinking)
 *   content_block_delta    — incremental content for the open block
 *   content_block_stop     — block closes; assemble it for the message
 *   message_delta          — top-level message updates (stop_reason, usage delta)
 *   message_stop           — message ends
 *   ping                   — keep-alive (ignored)
 *   error                  — fatal stream error (yielded then thrown)
 *
 * Pair with `lib/providers/sse.ts` (WP-2.2) on the client side: this
 * server-side helper produces the events; the client splitter consumes
 * the SSE frames produced from them.
 *
 * Bug K (Ralph 2026-05-04): normalizes stop_reason and tool_use shapes
 * via lib/providers/normalize.ts. Catches Anthropic's newer values
 * (`pause_turn`, `refusal`) and any malformed tool_use blocks before
 * they reach the chat loop's strict checks.
 */
import { normalizeStopReason, repairToolUseBlock } from './providers/normalize'

export type AnthropicStreamEvent =
  | { type: 'message_start'; message: any }
  | { type: 'content_block_start'; index: number; content_block: any }
  | { type: 'content_block_delta'; index: number; delta: any }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: any; usage?: any }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'error'; error: any }

/**
 * Final aggregated result of a streamed message — assembled from the events
 * for the tool-use loop continuation.
 */
export interface StreamedMessage {
  content: any[]
  stop_reason: string | null
  usage: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

/**
 * Make a streaming Anthropic request and return an async iterator of
 * parsed events. Caller is responsible for forwarding events to the
 * client SSE pipe AND for assembling the final message via
 * `accumulateStreamedMessage`.
 */
export async function* streamAnthropicMessages(
  apiKey: string,
  body: any,
  signal?: AbortSignal,
): AsyncGenerator<AnthropicStreamEvent, void, void> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // 2026-05-04 (Ralph): dropped `context-1m-2025-08-07` — the 1M
      // context window is invoked via the model identifier now, not a
      // beta header. `extended-cache-ttl-2025-04-11` stays for 1h cache.
      'anthropic-beta': 'extended-cache-ttl-2025-04-11',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '<no-body>')
    throw new Error(`Anthropic streaming HTTP ${response.status}: ${text}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Anthropic SSE frames are terminated by `\n\n`. Frame fields:
    //   event: <name>
    //   data: <json>
    let sepIdx = buffer.indexOf('\n\n')
    while (sepIdx !== -1) {
      const frame = buffer.slice(0, sepIdx)
      buffer = buffer.slice(sepIdx + 2)
      const ev = parseFrame(frame)
      if (ev) yield ev
      sepIdx = buffer.indexOf('\n\n')
    }
  }
  // Drain any trailing partial frame
  if (buffer.trim().length > 0) {
    const ev = parseFrame(buffer)
    if (ev) yield ev
  }
}

function parseFrame(frame: string): AnthropicStreamEvent | null {
  let eventName: string | null = null
  const dataLines: string[] = []
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('event: ')) {
      eventName = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6))
    }
  }
  if (!eventName || dataLines.length === 0) return null
  let data: any
  try {
    data = JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
  // Anthropic puts the type in the data payload too, but fall back to event name
  return { ...data, type: data.type || eventName } as AnthropicStreamEvent
}

/**
 * Consume a stream into a final StreamedMessage by accumulating delta
 * blocks. Use this when the caller wants the tool-use loop to continue
 * (needs the assembled assistant message for the next API call).
 *
 * The yielded events are also returned via the optional `onEvent` callback
 * so the caller can forward to the client SSE pipe in parallel.
 */
export async function accumulateStreamedMessage(
  iter: AsyncGenerator<AnthropicStreamEvent, void, void>,
  onEvent?: (e: AnthropicStreamEvent) => void,
): Promise<StreamedMessage> {
  const blocks: any[] = []
  // Per-block partial-state: track text deltas, tool_use input deltas (which
  // arrive as JSON-string fragments via input_json_delta).
  const partialJson: Record<number, string> = {}
  let stop_reason: string | null = null
  let usage: StreamedMessage['usage'] = {}

  for await (const ev of iter) {
    if (onEvent) {
      try { onEvent(ev) } catch {}
    }
    if (ev.type === 'message_start') {
      const m = (ev as any).message
      if (m?.usage) {
        usage.input_tokens = m.usage.input_tokens
        usage.output_tokens = m.usage.output_tokens
        usage.cache_creation_input_tokens = m.usage.cache_creation_input_tokens
        usage.cache_read_input_tokens = m.usage.cache_read_input_tokens
      }
    } else if (ev.type === 'content_block_start') {
      const e = ev as any
      blocks[e.index] = { ...e.content_block }
      if (e.content_block?.type === 'tool_use') {
        partialJson[e.index] = ''
      }
    } else if (ev.type === 'content_block_delta') {
      const e = ev as any
      const delta = e.delta
      const block = blocks[e.index]
      if (!block) continue
      if (delta?.type === 'text_delta') {
        block.text = (block.text || '') + (delta.text || '')
      } else if (delta?.type === 'thinking_delta') {
        block.thinking = (block.thinking || '') + (delta.thinking || '')
      } else if (delta?.type === 'input_json_delta') {
        partialJson[e.index] = (partialJson[e.index] || '') + (delta.partial_json || '')
      } else if (delta?.type === 'signature_delta') {
        block.signature = (block.signature || '') + (delta.signature || '')
      }
    } else if (ev.type === 'content_block_stop') {
      const e = ev as any
      const block = blocks[e.index]
      if (block && block.type === 'tool_use' && partialJson[e.index] !== undefined) {
        try {
          block.input = JSON.parse(partialJson[e.index] || '{}')
        } catch {
          block.input = {}
        }
        delete partialJson[e.index]
        // Bug K (Ralph 2026-05-04): repair the assembled tool_use shape.
        // Catches missing/empty id, missing name, non-object input. The
        // try/catch above already handles partial JSON; this catches the
        // OTHER class of malformed block (e.g., model emitted a tool_use
        // event without a name field, or input came back as a string).
        const repaired = repairToolUseBlock(block)
        if (repaired) {
          // Preserve any extra fields the model added; overwrite the three we coerce.
          blocks[e.index] = { ...block, ...repaired }
        }
        // If repair returned null (block unsalvageable), leave the original
        // in place — content_block_stop's caller decides what to do; better
        // to keep a known-bad block than silently drop it.
      }
    } else if (ev.type === 'message_delta') {
      const e = ev as any
      if (e.delta?.stop_reason) {
        // Bug K (Ralph 2026-05-04): normalize stop_reason on receipt.
        // Anthropic-canonical values pass through unchanged; new spec
        // additions (pause_turn, refusal) are recognized; provider-quirk
        // values get mapped before they reach the chat loop's
        // `=== 'tool_use'` checks.
        stop_reason = normalizeStopReason(e.delta.stop_reason)
      }
      if (e.usage) {
        // message_delta carries cumulative output_tokens only
        usage.output_tokens = e.usage.output_tokens ?? usage.output_tokens
      }
    } else if (ev.type === 'message_stop') {
      // nothing more; loop will exit on next iteration
    } else if (ev.type === 'error') {
      throw new Error(`Anthropic stream error: ${JSON.stringify((ev as any).error)}`)
    }
  }

  return { content: blocks.filter(Boolean), stop_reason, usage }
}
