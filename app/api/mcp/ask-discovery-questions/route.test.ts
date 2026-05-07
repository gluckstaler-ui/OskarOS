/**
 * Tests for /api/mcp/ask-discovery-questions (Ralph 2026-05-04).
 *
 * Locks the publish contract: route validates input, publishes a
 * `discovery_questions` event with the right shape, returns ok.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock event-bus before importing the route — we want to capture publish()
// calls. Use vi.hoisted so the mock fn ref is available when vi.mock's
// factory runs (vi.mock factories are hoisted above the imports — without
// hoisted, the bare const isn't initialized yet).
const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({ publish: publishMock }))

import { POST } from './route'

function makeRequest(body: unknown) {
  return new Request('http://test/api/mcp/ask-discovery-questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  publishMock.mockReset()
})

describe('POST /api/mcp/ask-discovery-questions', () => {
  it('returns 400 when sessionId is missing', async () => {
    const r = await POST(makeRequest({ questions: ['Q1?'] }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns 400 when questions is missing', async () => {
    const r = await POST(makeRequest({ sessionId: 'sess-1' }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns 400 when questions is an empty array', async () => {
    const r = await POST(makeRequest({ sessionId: 'sess-1', questions: [] }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns 400 when all questions are empty strings', async () => {
    const r = await POST(makeRequest({ sessionId: 'sess-1', questions: ['', '   ', null] }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('publishes discovery_questions event with cleaned questions', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-1',
      questions: ['Who?', '  Where?  ', 'Why?'],
    }))
    expect(r.status).toBe(200)
    const json = await (r as Response).json()
    expect(json.ok).toBe(true)
    expect(json.questionCount).toBe(3)
    expect(publishMock).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      type: 'discovery_questions',
      questions: ['Who?', 'Where?', 'Why?'],
    }))
  })

  it('passes context through when provided', async () => {
    await POST(makeRequest({
      sessionId: 'sess-2',
      questions: ['Q1?'],
      context: 'A few quick things.',
    }))
    expect(publishMock).toHaveBeenCalledWith('sess-2', expect.objectContaining({
      context: 'A few quick things.',
    }))
  })

  it('omits context when not provided', async () => {
    await POST(makeRequest({ sessionId: 'sess-3', questions: ['Q1?'] }))
    const payload = publishMock.mock.calls[0][1]
    expect(payload.context).toBeUndefined()
  })
})
