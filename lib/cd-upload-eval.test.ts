/**
 * Tests for cd-upload-eval Phase 2 migration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CDCallResult } from './cd-bridge-call'

vi.mock('./cd-bridge-call', () => ({ callCDBridge: vi.fn() }))
vi.mock('./cd-context', () => ({
  buildCDContext: vi.fn(async () => ({ block: '', size: 0 })),
}))

const { runUploadEval } = await import('./cd-upload-eval')
const { callCDBridge } = await import('./cd-bridge-call')

const mockCallCDBridge = callCDBridge as unknown as ReturnType<typeof vi.fn>

function bridgeReply(toolCalls: Record<string, unknown> = {}, text = ''): CDCallResult {
  return { text, events: [], toolCalls, durationMs: 42 }
}

beforeEach(() => mockCallCDBridge.mockReset())

describe('runUploadEval — tool-capture', () => {
  it('returns structured result when CD calls submit_upload_eval', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({
        submit_upload_eval: {
          verdict: '✓',
          note: 'great hero candidate',
          suggestedUses: ['hero', 'gallery'],
        },
      }),
    )
    const r = await runUploadEval({ sessionId: 's', filename: 'photo.jpg' })
    expect(r.verdict).toBe('✓')
    expect(r.note).toBe('great hero candidate')
    expect(r.suggestedUses).toEqual(['hero', 'gallery'])
  })

  it('caps suggestedUses to 6 items', async () => {
    const longList = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({
        submit_upload_eval: { verdict: '≈', note: '', suggestedUses: longList },
      }),
    )
    const r = await runUploadEval({ sessionId: 's', filename: 'p.jpg' })
    expect(r.suggestedUses).toHaveLength(6)
    expect(r.suggestedUses).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('handles non-array suggestedUses safely', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply({
        submit_upload_eval: { verdict: '✗', note: 'bad', suggestedUses: 'hero, gallery' },
      }),
    )
    const r = await runUploadEval({ sessionId: 's', filename: 'p.jpg' })
    expect(r.suggestedUses).toEqual([])
  })

  it('falls back to ≈ when tool not called', async () => {
    mockCallCDBridge.mockResolvedValue(bridgeReply({}))
    const r = await runUploadEval({ sessionId: 's', filename: 'p.jpg' })
    expect(r.verdict).toBe('≈')
    expect(r.suggestedUses).toEqual([])
  })

  it('does NOT extract from `## VERDICT` text', async () => {
    mockCallCDBridge.mockResolvedValue(
      bridgeReply(
        {},
        '## VERDICT: ✓\n## NOTE: ok\n## SUGGESTED_USES: hero, gallery, b-roll',
      ),
    )
    const r = await runUploadEval({ sessionId: 's', filename: 'p.jpg' })
    expect(r.verdict).toBe('≈')
    expect(r.suggestedUses).toEqual([])
  })
})
