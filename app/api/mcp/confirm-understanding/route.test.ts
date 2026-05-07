/**
 * Tests for /api/mcp/confirm-understanding (Ralph 2026-05-04).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted mock — see ask-discovery-questions/route.test.ts for the
// rationale (vi.mock factory runs above imports, bare const wouldn't
// be initialized in time).
const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({ publish: publishMock }))

import { POST } from './route'

function makeRequest(body: unknown) {
  return new Request('http://test/api/mcp/confirm-understanding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  publishMock.mockReset()
})

describe('POST /api/mcp/confirm-understanding', () => {
  it('returns 400 when sessionId is missing', async () => {
    const r = await POST(makeRequest({ summary: 'x', readyToGenerate: true }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns 400 when summary is empty', async () => {
    const r = await POST(makeRequest({ sessionId: 's1', summary: '   ', readyToGenerate: true }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns 400 when readyToGenerate is missing', async () => {
    const r = await POST(makeRequest({ sessionId: 's1', summary: 'x' }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns 400 when readyToGenerate is a non-bool/non-coercible value', async () => {
    const r = await POST(makeRequest({ sessionId: 's1', summary: 'x', readyToGenerate: 'yes' }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('coerces "true"/"false" string values to boolean', async () => {
    await POST(makeRequest({ sessionId: 's1', summary: 'x', readyToGenerate: 'true' }))
    expect(publishMock).toHaveBeenCalledWith('s1', expect.objectContaining({
      readyToGenerate: true,
    }))
    publishMock.mockReset()
    await POST(makeRequest({ sessionId: 's1', summary: 'x', readyToGenerate: 'false' }))
    expect(publishMock).toHaveBeenCalledWith('s1', expect.objectContaining({
      readyToGenerate: false,
    }))
  })

  it('publishes confirm_understanding event with right payload', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-X',
      summary: 'A coffee bar in the 7th.',
      readyToGenerate: true,
    }))
    expect(r.status).toBe(200)
    const json = await (r as Response).json()
    expect(json.ok).toBe(true)
    expect(json.readyToGenerate).toBe(true)
    expect(publishMock).toHaveBeenCalledWith('sess-X', expect.objectContaining({
      type: 'confirm_understanding',
      summary: 'A coffee bar in the 7th.',
      readyToGenerate: true,
    }))
  })
})
