import { test, expect } from '@playwright/test'

/**
 * MCP Smoke — cross-agent comms (Ralph 2026-05-04).
 *
 * CD reported agent communication "seems not to be working." Static audit
 * showed the agent_inbox / notify_agent chain intact. This test fires a
 * directed message via /api/mcp/notify-agent and reads it back via
 * /api/mcp/agent-inbox. If the round-trip succeeds, the bus is healthy.
 */

const SESSION_ID = `comms-smoke-${Date.now()}`

test.describe('MCP smoke: cross-agent comms', () => {
  test('notify_agent → agent_inbox roundtrip', async ({ request }) => {
    // Use a deterministic sessionId per run so the inbox state is clean.
    const senderRole = 'jedi-code'
    const targetRole = 'cd'
    const message = `ping-${Date.now()}`

    const sendResp = await request.post('/api/mcp/notify-agent', {
      data: {
        sessionId: SESSION_ID,
        target: targetRole,
        message,
        priority: 'normal',
        senderRole,
      },
    })
    expect(sendResp.ok()).toBe(true)
    const sendBody = await sendResp.json()
    expect(sendBody).toHaveProperty('messageId')

    // Drain the target's inbox.
    const drainResp = await request.post('/api/mcp/agent-inbox', {
      data: {
        sessionId: SESSION_ID,
        callerRole: targetRole,
      },
    })
    expect(drainResp.ok()).toBe(true)
    const drainBody = await drainResp.json()
    const messages = drainBody.messages || drainBody
    expect(Array.isArray(messages)).toBe(true)
    expect(messages.length).toBeGreaterThan(0)
    // Find the message we just sent (other test runs may share session if
    // SESSION_ID collides with a parallel worker — unlikely with the
    // timestamp suffix but defensive).
    const found = messages.find((m: any) => m.message === message || m.text === message)
    expect(found).toBeTruthy()
  })
})
