/**
 * Tests for lib/providers/normalize.ts (Ralph 2026-05-04, Bug K).
 *
 * Locks the four pure-function contracts so the regressions they were
 * designed to catch can't sneak back in. Every assertion mirrors a real
 * scenario we've either already hit (orphan tool_use 400) or know is
 * coming (Anthropic adding new stop_reason values like pause_turn).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  normalizeStopReason,
  repairToolUseBlock,
  normalizeMessageChain,
  stripEagerInputStreaming,
} from './normalize'

beforeEach(() => {
  // Silence the warn logs in tests; we assert behavior, not console output
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ──────────────────────────────────────────────────────────────────────
// Fix #2: stop_reason
// ──────────────────────────────────────────────────────────────────────

describe('normalizeStopReason', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(normalizeStopReason(null)).toBeNull()
    expect(normalizeStopReason(undefined)).toBeNull()
    expect(normalizeStopReason('')).toBeNull()
    expect(normalizeStopReason('   ')).toBeNull()
  })

  it('passes Anthropic canonical values through unchanged', () => {
    expect(normalizeStopReason('end_turn')).toBe('end_turn')
    expect(normalizeStopReason('tool_use')).toBe('tool_use')
    expect(normalizeStopReason('max_tokens')).toBe('max_tokens')
    expect(normalizeStopReason('stop_sequence')).toBe('stop_sequence')
  })

  it('passes Anthropic newer values (pause_turn, refusal) through', () => {
    expect(normalizeStopReason('pause_turn')).toBe('pause_turn')
    expect(normalizeStopReason('refusal')).toBe('refusal')
  })

  it('maps Z.ai/GLM aliases to Anthropic canonical', () => {
    expect(normalizeStopReason('stop')).toBe('end_turn')
    expect(normalizeStopReason('STOP')).toBe('end_turn')
    expect(normalizeStopReason('tool_calls')).toBe('tool_use')
    expect(normalizeStopReason('function_call')).toBe('tool_use')
    expect(normalizeStopReason('length')).toBe('max_tokens')
    expect(normalizeStopReason('content_filter')).toBe('stop_sequence')
  })

  it('defaults unknown values to end_turn so the loop exits cleanly', () => {
    expect(normalizeStopReason('something_new_2026')).toBe('end_turn')
    expect(normalizeStopReason('garbage')).toBe('end_turn')
  })

  it('warns when remapping Z.ai aliases or unknown values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    normalizeStopReason('stop')
    expect(warn).toHaveBeenCalled()
    warn.mockClear()
    normalizeStopReason('garbage')
    expect(warn).toHaveBeenCalled()
    warn.mockClear()
    normalizeStopReason('end_turn')
    expect(warn).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────
// Fix #3: tool_use shape repair
// ──────────────────────────────────────────────────────────────────────

describe('repairToolUseBlock', () => {
  it('returns null for non-objects', () => {
    expect(repairToolUseBlock(null)).toBeNull()
    expect(repairToolUseBlock(undefined)).toBeNull()
    expect(repairToolUseBlock('text')).toBeNull()
    expect(repairToolUseBlock(42)).toBeNull()
  })

  it('returns null for non-tool_use blocks', () => {
    expect(repairToolUseBlock({ type: 'text', text: 'hi' })).toBeNull()
  })

  it('returns null when name is missing', () => {
    const r = repairToolUseBlock({ type: 'tool_use', id: 'tu_x', input: {} })
    expect(r).toBeNull()
  })

  it('returns null when name is empty string', () => {
    const r = repairToolUseBlock({ type: 'tool_use', id: 'tu_x', name: '', input: {} })
    expect(r).toBeNull()
  })

  it('passes well-formed blocks through unchanged structurally', () => {
    const block = { type: 'tool_use', id: 'tu_abc123', name: 'snackbar', input: { text: 'hi' } }
    const r = repairToolUseBlock(block)
    expect(r).toEqual({ type: 'tool_use', id: 'tu_abc123', name: 'snackbar', input: { text: 'hi' } })
  })

  it('generates a fallback id when missing', () => {
    const r = repairToolUseBlock({ type: 'tool_use', name: 'snackbar', input: {} })
    expect(r?.id).toMatch(/^tu_[a-z0-9]+$/)
    expect(r?.name).toBe('snackbar')
  })

  it('generates a fallback id when empty', () => {
    const r = repairToolUseBlock({ type: 'tool_use', id: '', name: 'snackbar', input: {} })
    expect(r?.id).toMatch(/^tu_[a-z0-9]+$/)
  })

  it('parses string input as JSON', () => {
    const r = repairToolUseBlock({
      type: 'tool_use',
      id: 'tu_x',
      name: 'snackbar',
      input: '{"text": "hello", "severity": "info"}',
    })
    expect(r?.input).toEqual({ text: 'hello', severity: 'info' })
  })

  it('falls back to {} when string input is invalid JSON', () => {
    const r = repairToolUseBlock({
      type: 'tool_use',
      id: 'tu_x',
      name: 'snackbar',
      input: 'not valid json {',
    })
    expect(r?.input).toEqual({})
  })

  it('falls back to {} when input is an array (parsed JSON but wrong shape)', () => {
    const r = repairToolUseBlock({
      type: 'tool_use',
      id: 'tu_x',
      name: 'snackbar',
      input: '[1, 2, 3]',
    })
    expect(r?.input).toEqual({})
  })

  it('coerces undefined input to {}', () => {
    const r = repairToolUseBlock({ type: 'tool_use', id: 'tu_x', name: 'snackbar' })
    expect(r?.input).toEqual({})
  })
})

// ──────────────────────────────────────────────────────────────────────
// Fix #8: message chain normalization
// ──────────────────────────────────────────────────────────────────────

describe('normalizeMessageChain', () => {
  it('returns empty for empty input', () => {
    expect(normalizeMessageChain([] as any[])).toEqual({ messages: [], changes: 0 })
  })

  it('passes a well-formed alternating chain through unchanged', () => {
    const messages = [
      { role: 'user' as const, content: 'A' },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'B' }] },
      { role: 'user' as const, content: 'C' },
    ]
    const r = normalizeMessageChain(messages)
    expect(r.changes).toBe(0)
    expect(r.messages).toEqual(messages)
  })

  it('drops empty-content user messages', () => {
    const r = normalizeMessageChain([
      { role: 'user' as const, content: '' },
      { role: 'user' as const, content: 'real' },
    ] as any[])
    expect(r.changes).toBe(1)
    expect(r.messages).toEqual([{ role: 'user', content: 'real' }])
  })

  it('drops messages whose content array is empty', () => {
    const r = normalizeMessageChain([
      { role: 'assistant' as const, content: [] },
      { role: 'user' as const, content: 'real' },
    ] as any[])
    expect(r.changes).toBe(1)
    expect(r.messages).toEqual([{ role: 'user', content: 'real' }])
  })

  it('drops messages with only empty text blocks', () => {
    const r = normalizeMessageChain([
      { role: 'assistant' as const, content: [{ type: 'text', text: '   ' }] },
      { role: 'user' as const, content: 'real' },
    ] as any[])
    expect(r.changes).toBe(1)
    expect(r.messages.length).toBe(1)
  })

  it('merges two consecutive user messages by content-array concat (Strategy A)', () => {
    const r = normalizeMessageChain([
      { role: 'user' as const, content: 'first' },
      { role: 'user' as const, content: 'second' },
    ] as any[])
    expect(r.changes).toBe(1)
    expect(r.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    ])
  })

  it('merges two consecutive assistant messages too', () => {
    const r = normalizeMessageChain([
      { role: 'assistant' as const, content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'tu_x', name: 'snackbar', input: {} }] },
    ] as any[])
    expect(r.changes).toBe(1)
    expect(r.messages.length).toBe(1)
    expect((r.messages[0].content as any[]).length).toBe(2)
  })

  it('preserves block order within merged messages (oldest first)', () => {
    const r = normalizeMessageChain([
      { role: 'user' as const, content: 'OLDEST' },
      { role: 'user' as const, content: 'middle' },
      { role: 'user' as const, content: 'NEWEST' },
    ] as any[])
    expect(r.changes).toBe(2)
    const merged = r.messages[0]
    expect((merged.content as any[])[0]).toEqual({ type: 'text', text: 'OLDEST' })
    expect((merged.content as any[])[2]).toEqual({ type: 'text', text: 'NEWEST' })
  })

  it('does NOT merge user→assistant→user chains (alternation preserved)', () => {
    const r = normalizeMessageChain([
      { role: 'user' as const, content: 'A' },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'B' }] },
      { role: 'user' as const, content: 'C' },
    ] as any[])
    expect(r.changes).toBe(0)
    expect(r.messages.length).toBe(3)
  })

  it('handles drop+merge interaction: empty middle message lets neighbors merge', () => {
    const r = normalizeMessageChain([
      { role: 'user' as const, content: 'A' },
      { role: 'user' as const, content: '' },  // empty — dropped first
      { role: 'user' as const, content: 'B' },
    ] as any[])
    // 1 drop + 1 merge = 2 changes
    expect(r.changes).toBe(2)
    expect(r.messages.length).toBe(1)
    expect((r.messages[0].content as any[]).length).toBe(2)
  })

  it('idempotent: running twice gives the same result', () => {
    const input = [
      { role: 'user' as const, content: 'A' },
      { role: 'user' as const, content: 'B' },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'C' }] },
    ]
    const once = normalizeMessageChain(input)
    const twice = normalizeMessageChain(once.messages)
    expect(twice.changes).toBe(0)
    expect(twice.messages).toEqual(once.messages)
  })

  it('does not mutate the input array', () => {
    const input = [
      { role: 'user' as const, content: 'A' },
      { role: 'user' as const, content: 'B' },
    ]
    const inputCopy = JSON.parse(JSON.stringify(input))
    normalizeMessageChain(input)
    expect(input).toEqual(inputCopy)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Fix #9: eager_input_streaming strip
// ──────────────────────────────────────────────────────────────────────

describe('stripEagerInputStreaming', () => {
  it('passes through bodies without the flag', () => {
    const body = { model: 'x', messages: [], tools: [{ name: 'snackbar' }] }
    const r = stripEagerInputStreaming(body)
    expect(r).toBe(body)  // same reference, no copy
  })

  it('passes through bodies without tools', () => {
    const body = { model: 'x', messages: [], eager_input_streaming: true } as any
    const r = stripEagerInputStreaming(body)
    expect(r).toBe(body)
    expect((r as any).eager_input_streaming).toBe(true)
  })

  it('strips the flag when both tools and eager_input_streaming are present', () => {
    const body = {
      model: 'x',
      messages: [],
      tools: [{ name: 'snackbar' }],
      eager_input_streaming: true,
    } as any
    const r = stripEagerInputStreaming(body)
    expect(r).not.toBe(body)  // returns a new object
    expect('eager_input_streaming' in r).toBe(false)
    expect((r as any).tools).toEqual([{ name: 'snackbar' }])
    // Original unmutated
    expect((body as any).eager_input_streaming).toBe(true)
  })

  it('idempotent', () => {
    const body = {
      tools: [{ name: 'x' }],
      eager_input_streaming: true,
    } as any
    const once = stripEagerInputStreaming(body)
    const twice = stripEagerInputStreaming(once)
    expect(twice).toBe(once)
  })

  it('handles empty tools array as "no tools" (does not strip)', () => {
    const body = {
      tools: [],
      eager_input_streaming: true,
    } as any
    const r = stripEagerInputStreaming(body)
    expect((r as any).eager_input_streaming).toBe(true)
  })
})
