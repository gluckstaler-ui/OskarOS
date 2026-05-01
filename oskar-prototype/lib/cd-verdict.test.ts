/**
 * Tests for cd-verdict Phase 2 migration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CDCallResult } from './cd-bridge-call'

vi.mock('./cd-bridge-call', () => ({ callCDBridge: vi.fn() }))
vi.mock('./cd-context', () => ({
  buildCDContext: vi.fn(async () => ({ block: '', size: 0 })),
}))

const { runVerdict } = await import('./cd-verdict')
const { callCDBridge } = await import('./cd-bridge-call')

const mockCallCDBridge = callCDBridge as unknown as ReturnType<typeof vi.fn>

function bridgeReply(toolCalls: Record<string, unknown> = {}, text = ''): CDCallResult {
  return { text, events: [], toolCalls, durationMs: 42 }
}

beforeEach(() => mockCallCDBridge.mockReset())

describe('runVerdict — tool-capture', () => {
  it('returns ✓ when CD calls submit_image_verdict with verdict=✓', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({ submit_image_verdict: { verdict: '✓', note: 'ship it' } }),
    )
    const r = await runVerdict({
      sessionId: 's',
      filename: 'x.jpg',
      originalPrompt: 'p',
      mode: 'edit',
    })
    expect(r.verdict).toBe('✓')
    expect(r.note).toBe('ship it')
  })

  it('captures adjustedDescription when present', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({
        submit_image_verdict: {
          verdict: '≈',
          note: 'usable',
          adjustedDescription: 'a peregrine falcon on a wooden stand',
        },
      }),
    )
    const r = await runVerdict({
      sessionId: 's',
      filename: 'x.jpg',
      originalPrompt: 'p',
      mode: 'edit',
    })
    expect(r.adjustedDescription).toBe('a peregrine falcon on a wooden stand')
  })

  it('falls back to ≈ when CD does not call the tool', async () => {
    mockCallCDBridge.mockResolvedValue(bridgeReply({}, 'no tool here'))
    const r = await runVerdict({
      sessionId: 's',
      filename: 'x.jpg',
      originalPrompt: 'p',
      mode: 'edit',
    })
    expect(r.verdict).toBe('≈')
    expect(r.note).toContain('did not commit')
  })

  it('expectedTools=[submit_image_verdict] is passed', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({ submit_image_verdict: { verdict: '✓', note: '' } }),
    )
    await runVerdict({ sessionId: 's', filename: 'x.jpg', originalPrompt: 'p', mode: 'edit' })
    expect(mockCallCDBridge.mock.calls[0][2]?.expectedTools).toEqual(['submit_image_verdict'])
  })

  it('returns error for missing required field', async () => {
    const r = await runVerdict({
      sessionId: '',
      filename: 'x.jpg',
      originalPrompt: 'p',
      mode: 'edit',
    })
    expect(r.verdict).toBe('error')
    expect(mockCallCDBridge).not.toHaveBeenCalled()
  })

  it('does NOT extract verdict from `## VERDICT: ✓` in text reply', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({}, '## VERDICT: ✓\n## NOTE: looks fine\n## ADJUSTED_DESCRIPTION: foo'),
    )
    const r = await runVerdict({
      sessionId: 's',
      filename: 'x.jpg',
      originalPrompt: 'p',
      mode: 'edit',
    })
    // Phase 2 doctrine: text is dead, tool calls are the contract.
    expect(r.verdict).toBe('≈') // fallback default
    expect(r.adjustedDescription).toBeUndefined()
  })
})
