/**
 * Tests for lib/providers/model-context.ts (Ralph 2026-05-04, Bug L).
 *
 * Locks the canonical Anthropic-doc-verified context windows so future
 * spec drift can't silently regress the badge percentage. Source for the
 * 1M assertions: https://platform.claude.com/docs/en/docs/build-with-claude/context-windows
 * "Claude Opus 4.7, Claude Opus 4.6, and Claude Sonnet 4.6 have a 1M-token
 *  context window."
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContextWindow } from './model-context'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('getContextWindow — Anthropic current generation', () => {
  it('Opus 4.8 returns 1M', () => {
    expect(getContextWindow('claude-opus-4-8')).toBe(1_000_000)
  })

  it('Opus 4.8 with [1m] CLI suffix returns 1M', () => {
    expect(getContextWindow('claude-opus-4-8[1m]')).toBe(1_000_000)
  })

  it('Opus 4.7 returns 1M', () => {
    expect(getContextWindow('claude-opus-4-7')).toBe(1_000_000)
  })

  it('Opus 4.7 with [1m] CLI suffix returns 1M', () => {
    expect(getContextWindow('claude-opus-4-7[1m]')).toBe(1_000_000)
  })

  it('Sonnet 4.6 returns 1M', () => {
    expect(getContextWindow('claude-sonnet-4-6')).toBe(1_000_000)
  })

  it('Opus 4.6 (legacy but still 1M) returns 1M', () => {
    expect(getContextWindow('claude-opus-4-6')).toBe(1_000_000)
  })
})

describe('getContextWindow — Anthropic 200K models', () => {
  it('Haiku 4.5 returns 200K', () => {
    expect(getContextWindow('claude-haiku-4-5')).toBe(200_000)
  })

  it('Sonnet 4.5 (legacy) returns 200K', () => {
    expect(getContextWindow('claude-sonnet-4-5')).toBe(200_000)
  })

  it('Opus 4.5 (legacy) returns 200K', () => {
    expect(getContextWindow('claude-opus-4-5')).toBe(200_000)
  })

  it('Opus 4.1 (legacy) returns 200K', () => {
    expect(getContextWindow('claude-opus-4-1')).toBe(200_000)
  })
})

describe('getContextWindow — non-Anthropic models', () => {
  it('Gemini 3.1 Pro returns 1M', () => {
    expect(getContextWindow('gemini-3.1-pro-preview')).toBe(1_000_000)
  })

  it('GLM 5.1 returns 200K', () => {
    expect(getContextWindow('glm-5.1')).toBe(200_000)
  })
})

describe('getContextWindow — fallbacks', () => {
  it('returns 200K default for null/undefined model', () => {
    expect(getContextWindow(null)).toBe(200_000)
    expect(getContextWindow(undefined)).toBe(200_000)
    expect(getContextWindow('')).toBe(200_000)
  })

  it('returns 200K default for unknown model and warns', () => {
    // Clear the beforeEach spy's call history first so we measure only
    // this test's invocation.
    vi.mocked(console.warn).mockClear()
    expect(getContextWindow('claude-future-model-2030')).toBe(200_000)
    expect(console.warn).toHaveBeenCalled()
  })

  it('does not warn for known models', () => {
    vi.mocked(console.warn).mockClear()
    getContextWindow('claude-opus-4-7')
    getContextWindow('claude-sonnet-4-6')
    expect(console.warn).not.toHaveBeenCalled()
  })
})

describe('getContextWindow — regression guard for Bug L', () => {
  it('does NOT return 200K for the two default API-mode models (the entire point of this fix)', () => {
    expect(getContextWindow('claude-opus-4-7')).not.toBe(200_000)
    expect(getContextWindow('claude-sonnet-4-6')).not.toBe(200_000)
  })

  it('UsageBadge percentage math: 100K used on Opus 4.7 should be 10%, not 50%', () => {
    const used = 100_000
    const window = getContextWindow('claude-opus-4-7')
    const pct = Math.round((used / window) * 100)
    expect(pct).toBe(10)
    // The pre-Bug-L state would have produced 50%, lighting up the badge red
    // for no reason. Locking against that regression.
  })
})
