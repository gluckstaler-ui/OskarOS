/**
 * vibe-diff route — Phase 2 Tier B SPEC LOCK (2026-04-30).
 *
 * Locks the v1 `since` enum to ONLY accept `last-build`. Adding `last-cd-touch`
 * or `last-director` requires updating BOTH this test AND the route handler;
 * the test is intentional friction so spec creep gets reviewed.
 */
import { describe, it, expect } from 'vitest'
import { POST } from './route'

function makeReq(body: any): Request {
  return new Request('http://localhost/api/mcp/vibe-diff', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('vibe_diff — v1 spec lock on `since`', () => {
  it('rejects since=last-cd-touch with 400 (NOT in v1 enum)', async () => {
    const r = await POST(makeReq({ sessionId: 's1', target: 'vibe-1', since: 'last-cd-touch' }))
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toMatch(/last-build/)
  })

  it('rejects since=last-director with 400 (NOT in v1 enum)', async () => {
    const r = await POST(makeReq({ sessionId: 's1', target: 'vibe-1', since: 'last-director' }))
    expect(r.status).toBe(400)
  })

  it('rejects unknown values like since=yesterday', async () => {
    const r = await POST(makeReq({ sessionId: 's1', target: 'vibe-1', since: 'yesterday' }))
    expect(r.status).toBe(400)
  })

  it('accepts since=last-build (the only v1 value)', async () => {
    // This will return 404 because session is fake — but it should NOT
    // 400-on-since. We're locking the enum, not testing the diff math.
    const r = await POST(makeReq({ sessionId: 'nonexistent-session', target: 'vibe-1', since: 'last-build' }))
    expect(r.status).not.toBe(400)
  })

  it('defaults missing since to last-build (back-compat)', async () => {
    const r = await POST(makeReq({ sessionId: 'nonexistent-session', target: 'vibe-1' }))
    // Should not 400 on since — should fall through to session/file lookup.
    expect(r.status).not.toBe(400)
  })
})
