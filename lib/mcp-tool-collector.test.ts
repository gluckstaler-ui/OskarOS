/**
 * Unit tests for the MCP tool collector. Phase 2 foundation — every
 * Family-1 tool capture path depends on this working correctly.
 */
import { describe, it, expect } from 'vitest'
import {
  makeToolCollector,
  collectFromStreamJsonLines,
  collectFromStdout,
  stripMcpPrefix,
} from './mcp-tool-collector'
import type { BridgeEvent } from './bridge-process-manager'

// ── Fixtures ────────────────────────────────────────────────────────────────

function assistantEventWithToolUse(
  name: string,
  input: unknown,
  id: string = 'tool_01',
): BridgeEvent {
  return {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Some preface narrative.' },
        { type: 'tool_use', name, input, id },
      ],
    },
  } as BridgeEvent
}

function assistantEventWithText(text: string): BridgeEvent {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  } as BridgeEvent
}

// ── stripMcpPrefix ─────────────────────────────────────────────────────────

describe('stripMcpPrefix', () => {
  it('strips the mcp__server__ prefix the Claude CLI adds', () => {
    expect(stripMcpPrefix('mcp__orch__submit_critique')).toBe('submit_critique')
  })

  it('returns bare names unchanged', () => {
    expect(stripMcpPrefix('submit_critique')).toBe('submit_critique')
  })

  it('handles multi-segment tool names', () => {
    expect(stripMcpPrefix('mcp__server__build_done')).toBe('build_done')
  })
})

// ── makeToolCollector ──────────────────────────────────────────────────────

describe('makeToolCollector', () => {
  it('captures a single matched tool call', () => {
    const c = makeToolCollector(['submit_proofread'])
    const matched = c.consume(
      assistantEventWithToolUse('submit_proofread', {
        severity: 'pass',
        note: 'looks good',
      }),
    )
    expect(matched).toBe(true)
    expect(c.getToolCalls()).toEqual({
      submit_proofread: { severity: 'pass', note: 'looks good' },
    })
  })

  it('handles the prefixed CLI form', () => {
    const c = makeToolCollector(['submit_critique'])
    c.consume(
      assistantEventWithToolUse('mcp__orch__submit_critique', {
        target: 'vibe-1',
        scores: [],
      }),
    )
    expect(c.getToolCalls().submit_critique).toEqual({ target: 'vibe-1', scores: [] })
  })

  it('ignores tool calls not in the expected set', () => {
    const c = makeToolCollector(['submit_proofread'])
    c.consume(assistantEventWithToolUse('submit_image_verdict', { verdict: '✓' }))
    expect(c.getToolCalls()).toEqual({})
  })

  it('ignores text-only events', () => {
    const c = makeToolCollector(['submit_proofread'])
    const matched = c.consume(assistantEventWithText('## SEVERITY: pass\n## NOTE: ok'))
    expect(matched).toBe(false)
    expect(c.getToolCalls()).toEqual({})
  })

  it('ignores non-assistant events (system, user, result)', () => {
    const c = makeToolCollector(['submit_proofread'])
    expect(c.consume({ type: 'system', subtype: 'init' } as BridgeEvent)).toBe(false)
    expect(c.consume({ type: 'user', message: {} } as BridgeEvent)).toBe(false)
    expect(c.consume({ type: 'result', subtype: 'success', result: 'done' } as BridgeEvent)).toBe(false)
    expect(c.getToolCalls()).toEqual({})
  })

  it('last-write-wins when the same tool is called twice', () => {
    const c = makeToolCollector(['submit_proofread'])
    c.consume(assistantEventWithToolUse('submit_proofread', { severity: 'advisory' }))
    c.consume(assistantEventWithToolUse('submit_proofread', { severity: 'rewritten' }, 'tool_02'))
    expect(c.getToolCalls().submit_proofread).toEqual({ severity: 'rewritten' })
  })

  it('captures multiple distinct tools across events', () => {
    const c = makeToolCollector(['submit_image_verdict', 'submit_image_prompt'])
    c.consume(assistantEventWithToolUse('submit_image_verdict', { verdict: '≈' }))
    c.consume(assistantEventWithToolUse('submit_image_prompt', { prompt: 'darker' }))
    expect(c.getToolCalls()).toEqual({
      submit_image_verdict: { verdict: '≈' },
      submit_image_prompt: { prompt: 'darker' },
    })
  })

  it('survives malformed events without throwing', () => {
    const c = makeToolCollector(['submit_proofread'])
    expect(() => c.consume(null as unknown as BridgeEvent)).not.toThrow()
    expect(() => c.consume({ type: 'assistant' } as BridgeEvent)).not.toThrow()
    expect(() => c.consume({ type: 'assistant', message: { content: 'string' } } as unknown as BridgeEvent)).not.toThrow()
    expect(c.getToolCalls()).toEqual({})
  })
})

// ── collectFromStreamJsonLines / collectFromStdout ─────────────────────────

describe('collectFromStreamJsonLines', () => {
  it('parses stream-json line by line and matches tools', () => {
    const lines = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"submit_proofread","input":{"severity":"pass","note":"ok"},"id":"t1"}]}}',
      '{"type":"result","subtype":"success","result":"done"}',
    ]
    expect(collectFromStreamJsonLines(lines, ['submit_proofread'])).toEqual({
      submit_proofread: { severity: 'pass', note: 'ok' },
    })
  })

  it('ignores non-JSON lines (CLI sometimes emits status text)', () => {
    const lines = [
      'not json',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"submit_critique","input":{"target":"v1"}}]}}',
      '',
      'more garbage',
    ]
    expect(collectFromStreamJsonLines(lines, ['submit_critique'])).toEqual({
      submit_critique: { target: 'v1' },
    })
  })

  it('returns empty map when no matched tools fired', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"## SEVERITY: pass"}]}}',
    ]
    expect(collectFromStreamJsonLines(lines, ['submit_proofread'])).toEqual({})
  })
})

describe('collectFromStdout', () => {
  it('splits a concatenated stdout buffer and extracts matched tool calls', () => {
    const stdout =
      '{"type":"system","subtype":"init"}\n' +
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"build_done","input":{"filename":"vibe-3.html","vibeIndex":3,"vibeName":"X","sectionsBuilt":[],"imagesUsed":[]}}]}}\n' +
      '{"type":"result","subtype":"success"}\n'
    expect(collectFromStdout(stdout, ['build_done'])).toEqual({
      build_done: {
        filename: 'vibe-3.html',
        vibeIndex: 3,
        vibeName: 'X',
        sectionsBuilt: [],
        imagesUsed: [],
      },
    })
  })

  it('returns empty when stdout is empty', () => {
    expect(collectFromStdout('', ['submit_proofread'])).toEqual({})
  })
})

// ── Phase 2 doctrine regression: text-output is NOT parsed ─────────────────

describe('Phase 2 doctrine: tool effects only fire from typed events', () => {
  it('does NOT extract structured args from `## SEVERITY` headers in text', () => {
    const c = makeToolCollector(['submit_proofread'])
    c.consume(
      assistantEventWithText(
        '## SEVERITY: rewritten\n## NOTE: that is bad\n## REWRITTEN_PROMPT: do better',
      ),
    )
    expect(c.getToolCalls()).toEqual({})
  })

  it('does NOT extract trailing JSON from text blocks', () => {
    const c = makeToolCollector(['build_done'])
    c.consume(
      assistantEventWithText(
        'Build complete.\n{"filename":"vibe-3.html","vibeIndex":3,"vibeName":"X"}',
      ),
    )
    expect(c.getToolCalls()).toEqual({})
  })

  it('does NOT match tools from prose mentioning the tool name', () => {
    const c = makeToolCollector(['submit_critique'])
    c.consume(
      assistantEventWithText(
        'I will call submit_critique({"target":"vibe-1","scores":[]}) now.',
      ),
    )
    expect(c.getToolCalls()).toEqual({})
  })
})
