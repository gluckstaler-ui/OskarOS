/**
 * Tests for cd-proofread Phase 2 migration.
 * - submit_proofread tool capture replaces ## SEVERITY/NOTE/REWRITTEN_PROMPT regex
 * - Wrapper consumes structured args, falls through with advisory if tool not called
 * - Header strings in CD's text reply do NOT extract anything (parser is dead)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CDCallResult } from './cd-bridge-call'

// Mock callCDBridge BEFORE importing runProofread so the wrapper sees the stub.
vi.mock('./cd-bridge-call', () => ({
  callCDBridge: vi.fn(),
}))
vi.mock('./cd-context', () => ({
  buildCDContext: vi.fn(async () => ({ block: '', size: 0 })),
}))

const { runProofread } = await import('./cd-proofread')
const { callCDBridge } = await import('./cd-bridge-call')

const mockCallCDBridge = callCDBridge as unknown as ReturnType<typeof vi.fn>

function bridgeReply(toolCalls: Record<string, unknown> = {}, text = ''): CDCallResult {
  return { text, events: [], toolCalls, durationMs: 42 }
}

beforeEach(() => {
  mockCallCDBridge.mockReset()
})

describe('runProofread — Phase 2 tool-capture path', () => {
  it('returns severity=pass when CD calls submit_proofread with severity=pass', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({ submit_proofread: { severity: 'pass', note: 'looks good' } }),
    )
    const r = await runProofread({
      sessionId: 'sess-1',
      mode: 'edit',
      prompt: 'original prompt text',
    })
    expect(r.severity).toBe('pass')
    expect(r.note).toBe('looks good')
    expect(r.finalPrompt).toBe('original prompt text')
  })

  it('returns severity=rewritten with the new prompt when CD rewrites', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({
        submit_proofread: {
          severity: 'rewritten',
          note: 'too vague',
          rewrittenPrompt: 'darker, more dramatic, low key lighting',
        },
      }),
    )
    const r = await runProofread({
      sessionId: 'sess-1',
      mode: 'edit',
      prompt: 'make it good',
    })
    expect(r.severity).toBe('rewritten')
    expect(r.finalPrompt).toBe('darker, more dramatic, low key lighting')
  })

  it('falls back to advisory when CD does NOT call the tool', async () => {
    mockCallCDBridge.mockResolvedValue(bridgeReply({}, 'just chatting, no tool call'))
    const r = await runProofread({
      sessionId: 'sess-1',
      mode: 'edit',
      prompt: 'original',
    })
    expect(r.severity).toBe('advisory')
    expect(r.finalPrompt).toBe('original')
    expect(r.note).toContain('did not commit')
  })

  it('passes the prompt through when severity=advisory (no rewrittenPrompt)', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({ submit_proofread: { severity: 'advisory', note: 'flagged but ok' } }),
    )
    const r = await runProofread({
      sessionId: 'sess-1',
      mode: 'edit',
      prompt: 'original',
    })
    expect(r.severity).toBe('advisory')
    expect(r.finalPrompt).toBe('original')
  })

  it('expectedTools=[submit_proofread] is passed to callCDBridge', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({ submit_proofread: { severity: 'pass', note: '' } }),
    )
    await runProofread({ sessionId: 's', mode: 'edit', prompt: 'p' })
    const opts = mockCallCDBridge.mock.calls[0][2]
    expect(opts?.expectedTools).toEqual(['submit_proofread'])
  })
})

describe('runProofread — Phase 2 doctrine: text headers do NOT extract', () => {
  it('ignores `## SEVERITY: rewritten` in the text reply when no tool was called', async () => {
    // Phase 1's old behavior would have extracted severity=rewritten from this.
    mockCallCDBridge.mockResolvedValue(
      bridgeReply(
        {},
        '## SEVERITY: rewritten\n## NOTE: bad prompt\n## REWRITTEN_PROMPT: better one',
      ),
    )
    const r = await runProofread({
      sessionId: 'sess-1',
      mode: 'edit',
      prompt: 'original',
    })
    // Phase 2 doctrine: tool call is the contract. Text headers are inert.
    expect(r.severity).toBe('advisory')
    expect(r.finalPrompt).toBe('original')
    expect(r.finalPrompt).not.toContain('better one')
  })
})

describe('runProofread — input validation', () => {
  it('returns error for missing sessionId', async () => {
    const r = await runProofread({ sessionId: '', mode: 'edit', prompt: 'p' })
    expect(r.severity).toBe('error')
    expect(mockCallCDBridge).not.toHaveBeenCalled()
  })

  it('returns error for missing prompt', async () => {
    const r = await runProofread({ sessionId: 's', mode: 'edit', prompt: '' })
    expect(r.severity).toBe('error')
  })
})
