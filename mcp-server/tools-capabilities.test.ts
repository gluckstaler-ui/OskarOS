/**
 * Tier S capability tools dispatch tests — Phase 2 (2026-04-30).
 *
 * Stubs `postJson` so we don't need a running Next.js server — we test
 * arg validation + error mapping at the MCP server layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.OSKAR_SESSION_ID = 'test-session-tier-s'

vi.mock('./api-client.js', () => ({
  postJson: vi.fn(),
}))

const { callCapabilityTool: rawCallCapabilityTool, CAPABILITY_TOOL_DEFINITIONS } = await import('./tools-capabilities.js')

// Phase 3 (2026-04-30): tools take ctx{sessionId, agentRole}. Tests inject
// a CD-role test context.
const TEST_CTX = {
  sessionId: 'test-session-tier-s',
  agentRole: 'cd' as const,
  instanceId: 'test-instance-cap',
}
const callCapabilityTool = (name: string, args: Record<string, unknown>) =>
  rawCallCapabilityTool(name as never, args, TEST_CTX)
const { postJson } = await import('./api-client.js')
const mockPost = postJson as unknown as ReturnType<typeof vi.fn>

beforeEach(() => mockPost.mockReset())

describe('CAPABILITY_TOOL_DEFINITIONS', () => {
  it('exposes Tier S + A + B tools in declared order', () => {
    const names = CAPABILITY_TOOL_DEFINITIONS.map((t) => t.name)
    expect(names).toEqual([
      // Tier S
      'generate_image',
      'screenshot',
      'snackbar',
      'ask_user',
      // Tier A
      'session_meta',
      'list_assets',
      'find_assets',
      'lint_brand_compliance',
      'apply_patch',
      // Tier B
      'image_ops',
      'vibe_diff',
    ])
  })

  it('every tool has a non-trivial description and inputSchema', () => {
    for (const t of CAPABILITY_TOOL_DEFINITIONS) {
      expect(t.description.length).toBeGreaterThan(40)
      expect((t.inputSchema as { type: string }).type).toBe('object')
    }
  })
})

// ── generate_image ──────────────────────────────────────────────────────────

describe('generate_image', () => {
  it('rejects empty prompt', async () => {
    const r = await callCapabilityTool('generate_image', { prompt: '' })
    expect(r.isError).toBe(true)
    expect(mockPost).not.toHaveBeenCalled()
  })

  // 2026-04-30 (Ralph + CD): generate_image is now escrowed. The route
  // returns {status:'running', jobId, deduped, originalStartedAt}
  // immediately; CD polls job_status to get the filename. Test updated
  // to reflect the new contract — see the seam-bug entry in
  // docs/INSTITUTIONAL-MEMORY.md (2026-04-30).
  it('returns enqueue receipt when backend confirms job started', async () => {
    mockPost.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        status: 'running',
        jobId: 'abc-123',
        deduped: false,
      },
    })
    const r = await callCapabilityTool('generate_image', {
      prompt: 'a peregrine falcon at golden hour',
      ratio: '16:9',
    })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('enqueued')
    expect(r.text).toContain('abc-123')
    expect(r.text).toContain('job_status')
  })

  it('surfaces dedup transparency in the enqueue receipt', async () => {
    mockPost.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        status: 'running',
        jobId: 'existing-456',
        deduped: true,
        originalStartedAt: '2026-04-30T15:00:00Z',
      },
    })
    const r = await callCapabilityTool('generate_image', { prompt: 'x', ratio: '1:1' })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('deduped')
    expect(r.text).toContain('2026-04-30T15:00:00Z')
  })

  it('surfaces backend error', async () => {
    mockPost.mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      error: 'HTTP 500: nano timeout',
    })
    const r = await callCapabilityTool('generate_image', { prompt: 'x' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('failed')
  })
})

// ── screenshot ──────────────────────────────────────────────────────────────

describe('screenshot', () => {
  it('rejects empty target', async () => {
    const r = await callCapabilityTool('screenshot', { target: '' })
    expect(r.isError).toBe(true)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('returns saved path on success', async () => {
    mockPost.mockResolvedValue({
      ok: true,
      status: 200,
      body: { savedPath: '/sess/screenshots/vibe-3-desktop-2026-04-30T12-00-00.png' },
    })
    const r = await callCapabilityTool('screenshot', { target: 'vibe-3', frame: 'desktop' })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('Screenshot saved')
    expect(r.text).toContain('vibe-3-desktop')
  })

  it('errors when target is unresolvable', async () => {
    mockPost.mockResolvedValue({
      ok: false,
      status: 404,
      body: { error: 'Target not found' },
      error: 'HTTP 404',
    })
    const r = await callCapabilityTool('screenshot', { target: 'vibe-99' })
    expect(r.isError).toBe(true)
  })
})

// ── snackbar ────────────────────────────────────────────────────────────────

describe('snackbar', () => {
  it('rejects empty text', async () => {
    const r = await callCapabilityTool('snackbar', { text: '' })
    expect(r.isError).toBe(true)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('coerces invalid severity to info (default)', async () => {
    mockPost.mockResolvedValue({ ok: true, status: 200, body: { ok: true } })
    await callCapabilityTool('snackbar', { text: 'hello', severity: 'CRITICAL' })
    expect(mockPost.mock.calls[0][1]).toMatchObject({ severity: 'info' })
  })

  // 2026-04-30 (Ralph) — full 5-severity parity with the existing image
  // pipeline palette. `warn` is normalized to `warning` (the
  // SnackbarType the renderer expects).
  it('preserves all 5 canonical severities', async () => {
    mockPost.mockResolvedValue({ ok: true, status: 200, body: { ok: true } })
    for (const sev of ['info', 'success', 'progress', 'warning', 'error'] as const) {
      mockPost.mockClear()
      await callCapabilityTool('snackbar', { text: 'x', severity: sev })
      expect(mockPost.mock.calls[0][1]).toMatchObject({ severity: sev })
    }
  })

  it('normalizes legacy `warn` alias to `warning`', async () => {
    mockPost.mockResolvedValue({ ok: true, status: 200, body: { ok: true } })
    await callCapabilityTool('snackbar', { text: 'careful', severity: 'warn' })
    expect(mockPost.mock.calls[0][1]).toMatchObject({ severity: 'warning' })
  })

  it('forwards sticky:true to the route', async () => {
    mockPost.mockResolvedValue({ ok: true, status: 200, body: { ok: true } })
    await callCapabilityTool('snackbar', { text: 'pin me', severity: 'info', sticky: true })
    expect(mockPost.mock.calls[0][1]).toMatchObject({ severity: 'info', sticky: true })
  })

  it('forwards sticky:false to the route (override default for warning)', async () => {
    mockPost.mockResolvedValue({ ok: true, status: 200, body: { ok: true } })
    await callCapabilityTool('snackbar', { text: 'transient', severity: 'warning', sticky: false })
    expect(mockPost.mock.calls[0][1]).toMatchObject({ severity: 'warning', sticky: false })
  })

  it('returns ack on success — fire-and-forget shape', async () => {
    mockPost.mockResolvedValue({ ok: true, status: 200, body: { ok: true } })
    const r = await callCapabilityTool('snackbar', { text: 'hello' })
    expect(r.isError).toBe(false)
    expect(r.text).toContain('published')
  })
})

// ── ask_user ────────────────────────────────────────────────────────────────

describe('ask_user', () => {
  it('rejects missing question', async () => {
    const r = await callCapabilityTool('ask_user', {
      question: '',
      options: ['Yes', 'No'],
    })
    expect(r.isError).toBe(true)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects fewer than 2 options', async () => {
    const r = await callCapabilityTool('ask_user', {
      question: 'pick',
      options: ['only one'],
    })
    expect(r.isError).toBe(true)
  })

  it('returns the user choice on success', async () => {
    mockPost.mockResolvedValue({
      ok: true,
      status: 200,
      body: { choice: 'Iterate' },
    })
    const r = await callCapabilityTool('ask_user', {
      question: 'commit?',
      options: ['Commit', 'Iterate'],
    })
    expect(r.isError).toBe(false)
    expect(r.text).toBe('Iterate')
  })

  it('surfaces conflict (409) when another ask is already open', async () => {
    mockPost.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: 'Another ask_user is already open' },
      error: 'HTTP 409',
    })
    const r = await callCapabilityTool('ask_user', {
      question: 'q',
      options: ['A', 'B'],
    })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('failed')
  })
})

// ── Unknown capability tool ─────────────────────────────────────────────────

describe('callCapabilityTool — unknown tool', () => {
  it('returns isError for unknown name', async () => {
    const r = await callCapabilityTool('definitely_not_a_capability' as never, {})
    expect(r.isError).toBe(true)
    expect(r.text).toContain('Unknown')
  })
})
