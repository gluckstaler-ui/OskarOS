/**
 * Dispatch tests for the MCP tool registry. Family-1 submit/report tools are
 * pure-ack: validate args, return success. Family-2 / Phase-1 orchestration
 * tools delegate to backend routes (mocked here via fetch stub).
 */
import { describe, it, expect, beforeEach } from 'vitest'

// Phase 3 (2026-04-30): tools take a ctx{sessionId, agentRole} parameter.
// Tests call through a small wrapper that injects a fake CD context.
const { TOOL_DEFINITIONS, callTool: rawCallTool } = await import('./tools.js')

const TEST_CTX = {
  sessionId: 'test-session-2026-04-30',
  agentRole: 'cd' as const,
  instanceId: 'test-instance-tools',
}
const callTool = (name: string, args: Record<string, unknown>) =>
  rawCallTool(name as never, args, TEST_CTX)

describe('TOOL_DEFINITIONS', () => {
  it('contains every Family 1 submit/report tool from the Phase 2 plan', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    // CD submit_*
    expect(names).toContain('submit_proofread')
    expect(names).toContain('submit_image_verdict')
    expect(names).toContain('submit_upload_eval')
    expect(names).toContain('submit_image_prompt')
    // WebDev report_*
    expect(names).toContain('report_build_complete')
    expect(names).toContain('report_build_failed')
    expect(names).toContain('report_build_progress')
    // Sentinel Ti
    expect(names).toContain('submit_critique')
  })

  it('preserves every Phase 1 orchestration tool', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name)
    expect(names).toContain('build_vibe')
    expect(names).toContain('build_all_vibes')
    expect(names).toContain('build_final')
    expect(names).toContain('hotswap')
    expect(names).toContain('images_needed')
    expect(names).toContain('refresh_assets')
  })

  it('every tool has a description and inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description).toBeTruthy()
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.inputSchema).toBeTruthy()
      expect((tool.inputSchema as { type: string }).type).toBe('object')
    }
  })
})

describe('callTool — Family 1 submit/report (pure ack)', () => {
  it('submit_proofread accepts severity=pass', async () => {
    const r = await callTool('submit_proofread', { severity: 'pass', note: 'fine' })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('submitted')
  })

  it('submit_proofread rejects unknown severity', async () => {
    const r = await callTool('submit_proofread', { severity: 'maybe', note: '...' })
    expect(r.isError).toBe(true)
  })

  it('submit_proofread requires rewrittenPrompt when severity=rewritten', async () => {
    const ok = await callTool('submit_proofread', {
      severity: 'rewritten',
      note: '...',
      rewrittenPrompt: 'new prompt',
    })
    expect(ok.isError).toBe(false)

    const bad = await callTool('submit_proofread', { severity: 'rewritten', note: '...' })
    expect(bad.isError).toBe(true)
  })

  it('submit_image_verdict acks valid args', async () => {
    const r = await callTool('submit_image_verdict', { verdict: '✓', note: 'ship it' })
    expect(r.isError).toBe(false)
  })

  it('submit_upload_eval acks valid args', async () => {
    const r = await callTool('submit_upload_eval', {
      verdict: '≈',
      note: 'usable',
      suggestedUses: ['hero', 'gallery'],
    })
    expect(r.isError).toBe(false)
  })

  it('submit_image_prompt acks valid args', async () => {
    const r = await callTool('submit_image_prompt', { prompt: 'darker, more dramatic' })
    expect(r.isError).toBe(false)
  })

  it('report_build_complete acks valid manifest', async () => {
    const r = await callTool('report_build_complete', {
      filename: 'vibe-3-the-deployment.html',
      vibeIndex: 3,
      vibeName: 'The Deployment',
      sectionsBuilt: ['hero', 'menu'],
      imagesUsed: ['hero.jpg'],
    })
    expect(r.isError).toBe(false)
  })

  it('report_build_complete rejects non-html filename', async () => {
    const r = await callTool('report_build_complete', {
      filename: 'vibe-3.txt',
      vibeIndex: 3,
      vibeName: 'X',
      sectionsBuilt: [],
      imagesUsed: [],
    })
    expect(r.isError).toBe(true)
  })

  it('report_build_complete rejects non-numeric vibeIndex', async () => {
    const r = await callTool('report_build_complete', {
      filename: 'vibe-3.html',
      vibeIndex: 'three',
      vibeName: 'X',
      sectionsBuilt: [],
      imagesUsed: [],
    })
    expect(r.isError).toBe(true)
  })

  it('report_build_failed requires error message', async () => {
    const ok = await callTool('report_build_failed', { error: 'Image hero.jpg missing' })
    expect(ok.isError).toBe(false)
    const bad = await callTool('report_build_failed', {})
    expect(bad.isError).toBe(true)
  })

  it('submit_critique requires non-empty scores array', async () => {
    const ok = await callTool('submit_critique', {
      target: 'vibe-3.html',
      scores: [{ dimension: 'craft', score: 8, note: 'tight' }],
      summary: 'Strong',
      recommendations: [],
    })
    expect(ok.isError).toBe(false)

    const bad = await callTool('submit_critique', {
      target: 'vibe-3.html',
      scores: [],
      summary: '',
      recommendations: [],
    })
    expect(bad.isError).toBe(true)
  })
})

describe('callTool — unknown tool', () => {
  it('returns isError for unknown tool name', async () => {
    const r = await callTool('definitely_not_a_tool' as never, {})
    expect(r.isError).toBe(true)
    expect(r.text).toContain('Unknown')
  })
})
