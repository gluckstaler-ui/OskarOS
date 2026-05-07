/**
 * Provider-side normalization (Ralph 2026-05-04, Bug K).
 *
 * Pure functions that defend Anthropic's strict request/response contract
 * against malformed inputs and outputs. All four fixes from the Z.ai-compat
 * list, applied to the Anthropic path because they catch real classes of
 * 400 errors we've already hit (tool_use orphans) or could hit (Anthropic
 * adding new stop_reason values like `pause_turn` without warning).
 *
 * Z.ai/GLM provider support comes later — when it lands, that adapter wraps
 * THESE same functions plus its own provider-specific quirks. The functions
 * are deliberately Anthropic-canonical; Z.ai's job is to map ITS shape
 * onto Anthropic-canonical before calling these.
 *
 * Design rules:
 * - Pure: no fs, no fetch, no I/O, no global state.
 * - Defensive: never throw. Every malformed input gets repaired or warned.
 * - Loud: log warnings on every detected anomaly so `console.warn` audit
 *   tells us which fixes are actually firing in production.
 * - Idempotent: applying twice is the same as once.
 */

// ──────────────────────────────────────────────────────────────────────
// Types — local to keep this module dep-free
// ──────────────────────────────────────────────────────────────────────

export type AnthropicStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'pause_turn'   // Anthropic added 2025+ — context too rich, expects continuation
  | 'refusal'      // Anthropic added 2025+ — model declined the request

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: unknown }
  | { type: 'document'; source: unknown }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: 'thinking'; thinking?: string; signature?: string }
  | { [k: string]: unknown }

// ──────────────────────────────────────────────────────────────────────
// Fix #2: stop_reason normalization
// ──────────────────────────────────────────────────────────────────────

/**
 * Map any stop_reason value to Anthropic's canonical set. Anthropic's
 * own values pass through. Future spec additions (`pause_turn`, `refusal`)
 * also pass through — our tool-use loop's `!== 'tool_use'` check treats
 * them as "we're done" by default, which is the safe default until we
 * add explicit handlers.
 *
 * Z.ai/GLM variants would map here too when that adapter lands:
 *   `stop`/`STOP` → `end_turn`, `tool_calls`/`function_call` → `tool_use`,
 *   `length` → `max_tokens`, `content_filter` → `stop_sequence`.
 *
 * Returns `null` only if the input was null/undefined; never throws.
 */
const ANTHROPIC_CANONICAL_STOP_REASONS = new Set<string>([
  'end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'pause_turn', 'refusal',
])

const KNOWN_ALIASES: Record<string, AnthropicStopReason> = {
  // Z.ai/GLM aliases — pre-wired so we don't have to touch this when the
  // adapter ships. Keying lowercase + matching exactly.
  'stop': 'end_turn',
  'tool_calls': 'tool_use',
  'function_call': 'tool_use',
  'length': 'max_tokens',
  'content_filter': 'stop_sequence',
  // OpenAI-shape aliases (defense-in-depth)
  'finish': 'end_turn',
}

export function normalizeStopReason(
  raw: string | null | undefined,
): AnthropicStopReason | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (ANTHROPIC_CANONICAL_STOP_REASONS.has(trimmed)) {
    return trimmed as AnthropicStopReason
  }
  const lower = trimmed.toLowerCase()
  const aliased = KNOWN_ALIASES[lower]
  if (aliased) {
    console.warn(
      `[normalize] stop_reason "${raw}" mapped → "${aliased}". ` +
      `Provider returned non-Anthropic-canonical value.`,
    )
    return aliased
  }
  // Unknown — log and default to `end_turn` so the caller's tool-use
  // loop exits cleanly rather than continuing forever.
  console.warn(
    `[normalize] stop_reason "${raw}" is not a known value. ` +
    `Defaulting to "end_turn". Add a mapping in lib/providers/normalize.ts ` +
    `if this becomes frequent.`,
  )
  return 'end_turn'
}

// ──────────────────────────────────────────────────────────────────────
// Fix #3: tool_use shape repair
// ──────────────────────────────────────────────────────────────────────

/**
 * Coerce a tool_use block into Anthropic's canonical shape:
 *   - `id` is a non-empty string (generate `tu_<random>` if missing)
 *   - `name` is a string (returns null if missing — caller drops the block)
 *   - `input` is an object (parse if string, default {} if invalid)
 *
 * Most failures here come from streaming reassembly when `input_json_delta`
 * fragments don't combine into valid JSON. `accumulateStreamedMessage`
 * already has try/catch on the parse, but `block.input` can land as a
 * pre-parsed string in the non-streaming path. This function catches both.
 *
 * Returns null if the block is unsalvageable (no name).
 */
export function repairToolUseBlock(
  block: unknown,
): { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | null {
  if (!block || typeof block !== 'object') {
    console.warn('[normalize] repairToolUseBlock: block is not an object — dropped')
    return null
  }
  const b = block as Record<string, unknown>
  if (b.type !== 'tool_use') {
    console.warn(`[normalize] repairToolUseBlock: block.type="${b.type}" not tool_use — passthrough caller's job`)
    return null
  }

  // id — generate if missing/empty.
  let id: string
  if (typeof b.id === 'string' && b.id.length > 0) {
    id = b.id
  } else {
    id = `tu_${Math.random().toString(36).slice(2, 14)}`
    console.warn(`[normalize] tool_use block missing id; generated "${id}"`)
  }

  // name — required; drop block if absent.
  if (typeof b.name !== 'string' || b.name.length === 0) {
    console.warn('[normalize] tool_use block missing name; block dropped')
    return null
  }
  const name = b.name

  // input — coerce to object.
  let input: Record<string, unknown>
  if (b.input && typeof b.input === 'object' && !Array.isArray(b.input)) {
    input = b.input as Record<string, unknown>
  } else if (typeof b.input === 'string') {
    try {
      const parsed = JSON.parse(b.input)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>
        console.warn(`[normalize] tool_use "${name}" had string input; parsed as JSON`)
      } else {
        console.warn(`[normalize] tool_use "${name}" string input parsed to non-object; using {}`)
        input = {}
      }
    } catch {
      console.warn(`[normalize] tool_use "${name}" string input was not valid JSON; using {}`)
      input = {}
    }
  } else {
    if (b.input !== undefined) {
      console.warn(`[normalize] tool_use "${name}" input is ${typeof b.input}, expected object; using {}`)
    }
    input = {}
  }

  return { type: 'tool_use', id, name, input }
}

// ──────────────────────────────────────────────────────────────────────
// Fix #8: message chain normalization
// ──────────────────────────────────────────────────────────────────────

interface NormalizeChainOptions {
  /** When true, log warnings for every fix applied. Default true. */
  verbose?: boolean
}

/**
 * Normalize a message chain to satisfy Anthropic's strict alternation
 * + non-empty-content requirements. Operates on a fresh copy; never
 * mutates the input array.
 *
 * Fixes:
 *   1. Drop messages whose content is empty (`''`, `[]`, or array of empty
 *      text blocks). Anthropic 400s on these.
 *   2. Merge consecutive same-role messages by concatenating their content
 *      arrays. Preserves block ordering. Strategy A from the design doc.
 *      Use case: user double-sent (queue race), localStorage duplicate
 *      writes, two browser tabs sharing a session.
 *
 * What it does NOT do:
 *   - Does NOT touch tool_use/tool_result pairing — that's
 *     `sanitizeMessagesForAnthropic`'s job. Run THIS first, sanitize after.
 *   - Does NOT append placeholder messages.
 *   - Does NOT change message ORDER. Oldest-first preserved.
 *
 * Idempotent: running twice gives the same result as once.
 */
export function normalizeMessageChain<M extends AnthropicMessage>(
  messages: M[],
  options: NormalizeChainOptions = {},
): { messages: M[]; changes: number } {
  const verbose = options.verbose !== false
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], changes: 0 }
  }

  let changes = 0

  // Pass 1: drop empty-content messages.
  const nonEmpty: M[] = []
  for (const m of messages) {
    if (isEmptyMessage(m)) {
      changes++
      if (verbose) {
        console.warn(`[normalize] dropped empty ${m.role} message`)
      }
      continue
    }
    nonEmpty.push(m)
  }

  // Pass 2: merge consecutive same-role messages.
  const merged: M[] = []
  for (const m of nonEmpty) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === m.role) {
      // Same role as previous — merge their content arrays.
      changes++
      if (verbose) {
        console.warn(
          `[normalize] merging consecutive ${m.role} messages (block-array concat). ` +
          `Most likely cause: queued message race, double-write, or tab sync collision.`,
        )
      }
      const prevBlocks = toContentBlocks(prev.content)
      const currBlocks = toContentBlocks(m.content)
      // Replace prev with the merged version. Preserves any other props.
      merged[merged.length - 1] = { ...prev, content: [...prevBlocks, ...currBlocks] } as M
    } else {
      merged.push(m)
    }
  }

  return { messages: merged, changes }
}

function isEmptyMessage(m: AnthropicMessage): boolean {
  if (!m || typeof m !== 'object') return true
  const c = m.content
  if (typeof c === 'string') return c.trim().length === 0
  if (!Array.isArray(c)) return true
  if (c.length === 0) return true
  // All blocks empty → message empty. A single non-empty block keeps it.
  return c.every(isEmptyBlock)
}

function isEmptyBlock(b: unknown): boolean {
  if (!b || typeof b !== 'object') return true
  const block = b as Record<string, unknown>
  if (block.type === 'text') {
    return typeof block.text !== 'string' || block.text.trim().length === 0
  }
  // image / document / tool_use / tool_result are never empty by structure
  return false
}

function toContentBlocks(content: AnthropicMessage['content']): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) {
    return content
  }
  return []
}

// ──────────────────────────────────────────────────────────────────────
// Fix #9: drop eager_input_streaming when tools are present
// ──────────────────────────────────────────────────────────────────────

/**
 * Strip the `eager_input_streaming` flag from a request body when `tools`
 * is non-empty. This is a Z.ai/Anthropic-compat-proxy regression that
 * doesn't affect Anthropic itself (Anthropic doesn't recognize the flag),
 * but we strip it defensively so:
 *   1. If we ever accidentally add the flag, it can't poison tool-use turns.
 *   2. The same code path stays valid when we add Z.ai support.
 *
 * Returns a new body if anything was changed; same reference if not.
 * Idempotent.
 */
export function stripEagerInputStreaming(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!body || typeof body !== 'object') return body
  const tools = body.tools
  const hasTools = Array.isArray(tools) && tools.length > 0
  if (!hasTools) return body
  if (!('eager_input_streaming' in body)) return body
  console.warn(
    '[normalize] stripping eager_input_streaming flag because tools are present. ' +
    'This flag is known to break Anthropic-compatible proxies (Z.ai et al.) ' +
    'when combined with tool-use loops.',
  )
  const next = { ...body }
  delete next.eager_input_streaming
  return next
}
