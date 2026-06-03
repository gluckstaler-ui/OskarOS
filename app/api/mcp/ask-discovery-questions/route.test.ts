/**
 * Tests for /api/mcp/ask-discovery-questions (Ralph 2026-05-04).
 *
 * Locks the publish contract: route validates input, publishes a
 * `discovery_questions` event with the right shape, returns ok.
 *
 * v2 (Ralph 2026-05-12): added coverage for typed-question entries
 * (text/textarea/radio/checkbox/select) + the title/progress optional
 * fields. Legacy string[] callers still work.
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
  }) as unknown as Parameters<typeof POST>[0]
}

beforeEach(() => {
  publishMock.mockReset()
})

describe('POST /api/mcp/ask-discovery-questions — validation', () => {
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

  it('returns 400 when all entries are unsalvageable', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-1',
      questions: ['', '   ', null, { not_a_question: true }],
    }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns 400 when radio kind is missing options[]', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-1',
      questions: [{ kind: 'radio', prompt: 'Who comes?' }],
    }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns 400 when kind is unknown', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-1',
      questions: [{ kind: 'slider', prompt: 'How much?' }],
    }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/mcp/ask-discovery-questions — legacy string[]', () => {
  it('publishes cleaned strings as kind:"text" questions', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-1',
      questions: ['Who?', '  Where?  ', 'Why?'],
    }))
    expect(r.status).toBe(200)
    const json = await (r as Response).json()
    expect(json.ok).toBe(true)
    expect(json.questionCount).toBe(3)
    expect(publishMock).toHaveBeenCalledTimes(1)
    const payload = publishMock.mock.calls[0][1] as {
      type: string
      questions: Array<{ kind: string; prompt: string }>
    }
    expect(payload.type).toBe('discovery_questions')
    expect(payload.questions).toEqual([
      { kind: 'text', prompt: 'Who?' },
      { kind: 'text', prompt: 'Where?' },
      { kind: 'text', prompt: 'Why?' },
    ])
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
    const payload = publishMock.mock.calls[0][1] as { context?: unknown }
    expect(payload.context).toBeUndefined()
  })
})

describe('POST /api/mcp/ask-discovery-questions — typed-question shape', () => {
  it('accepts a mixed-input form and preserves each kind', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-mixed',
      questions: [
        { kind: 'text', prompt: "What's the business called?", required: true },
        { kind: 'textarea', prompt: "Who's the customer?", help: "Pick one person." },
        { kind: 'radio', prompt: 'Who comes here?', options: ['Locals', 'Tourists', 'Both'] },
        { kind: 'select', prompt: 'Price ceiling', options: ['under €5', '€5–€10'] },
      ],
    }))
    expect(r.status).toBe(200)
    expect(publishMock).toHaveBeenCalledTimes(1)
    const payload = publishMock.mock.calls[0][1] as {
      questions: Array<{ kind: string; prompt: string; options?: string[]; required?: boolean; help?: string }>
    }
    expect(payload.questions).toHaveLength(4)
    expect(payload.questions[0].kind).toBe('text')
    expect(payload.questions[0].required).toBe(true)
    expect(payload.questions[1].kind).toBe('textarea')
    expect(payload.questions[1].help).toBe('Pick one person.')
    expect(payload.questions[2].kind).toBe('radio')
    expect(payload.questions[2].options).toEqual(['Locals', 'Tourists', 'Both'])
    expect(payload.questions[3].kind).toBe('select')
  })

  it('drops unknown-kind entries and keeps the valid ones', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-mix',
      questions: [
        { kind: 'text', prompt: 'OK' },
        { kind: 'slider', prompt: 'Bad' },
        'string-ok',
      ],
    }))
    expect(r.status).toBe(200)
    const payload = publishMock.mock.calls[0][1] as {
      questions: Array<{ kind: string; prompt: string }>
    }
    expect(payload.questions.map((q) => q.prompt)).toEqual(['OK', 'string-ok'])
  })

  it('drops checkbox defaultValue entries that are not in options', async () => {
    await POST(makeRequest({
      sessionId: 'sess-cb',
      questions: [
        { kind: 'checkbox', prompt: 'Items', options: ['A', 'B'], defaultValue: ['A', 'Z'] },
      ],
    }))
    const payload = publishMock.mock.calls[0][1] as {
      questions: Array<{ defaultValue?: string[] }>
    }
    expect(payload.questions[0].defaultValue).toEqual(['A'])
  })

  it('passes title and progress through when provided', async () => {
    await POST(makeRequest({
      sessionId: 'sess-title',
      questions: ['Q?'],
      title: 'Discovery — about FalCaMel',
      progress: { current: 1, total: 3 },
    }))
    expect(publishMock).toHaveBeenCalledWith('sess-title', expect.objectContaining({
      title: 'Discovery — about FalCaMel',
      progress: { current: 1, total: 3 },
    }))
  })

  it('rejects malformed progress when current/total are not numbers', async () => {
    await POST(makeRequest({
      sessionId: 'sess-bad-progress',
      questions: ['Q?'],
      progress: { current: 'one', total: 'three' },
    }))
    const payload = publishMock.mock.calls[0][1] as { progress?: unknown }
    expect(payload.progress).toBeUndefined()
  })

  it('accepts the prompt-alias shapes ({question}, {q}, {text}, {label})', async () => {
    const r = await POST(makeRequest({
      sessionId: 'sess-alias',
      questions: [
        { question: 'Via question?' },
        { kind: 'text', q: 'Via q?' },
        { kind: 'text', text: 'Via text?' },
        { kind: 'text', label: 'Via label?' },
      ],
    }))
    expect(r.status).toBe(200)
    const payload = publishMock.mock.calls[0][1] as { questions: Array<{ prompt: string }> }
    expect(payload.questions.map((q) => q.prompt)).toEqual([
      'Via question?',
      'Via q?',
      'Via text?',
      'Via label?',
    ])
  })
})
