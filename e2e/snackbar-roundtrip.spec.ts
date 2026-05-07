import { test, expect } from '@playwright/test'

/**
 * MCP Smoke — snackbar roundtrip (Ralph 2026-05-04).
 *
 * CD reported "all agent communication seems not to be working" while
 * static audit showed the snackbar chain intact end-to-end. This test
 * verifies the chain by firing snackbar via the MCP route directly +
 * subscribing to /api/events SSE in parallel and asserting the event
 * lands within 2 seconds. If this passes, CD's complaint was either
 * propagating from the api-client crash (Commit A fix) or a runtime
 * regression in a specific scenario this smoke doesn't cover.
 */

test.describe('MCP smoke: snackbar', () => {
  test('snackbar publish reaches /api/events SSE within 2s', async ({ request, page }) => {
    const sessionId = `snackbar-smoke-${Date.now()}`
    const text = `smoke-${Date.now()}`

    // Open SSE first so we don't miss the publish.
    const eventPromise = new Promise<{ type: string; text?: string } | null>((resolve) => {
      // Use the page context to open EventSource — Playwright's request
      // doesn't natively support SSE.
      page.evaluate(
        ({ sessionId, deadline }) =>
          new Promise<{ type: string; text?: string } | null>((res) => {
            const es = new EventSource(`/api/events?session=${encodeURIComponent(sessionId)}`)
            const timer = setTimeout(() => { es.close(); res(null) }, deadline)
            es.onmessage = (msg) => {
              try {
                const payload = JSON.parse(msg.data)
                if (payload.type === 'cd_snackbar') {
                  clearTimeout(timer)
                  es.close()
                  res(payload)
                }
              } catch { /* ignore */ }
            }
          }),
        { sessionId, deadline: 2500 },
      ).then((v) => resolve(v as any))
    })

    // Small delay to let the SSE handshake complete before publishing.
    await page.goto('/')
    await page.waitForTimeout(200)

    const r = await request.post('/api/mcp/snackbar', {
      data: { sessionId, text, severity: 'info' },
    })
    expect(r.ok()).toBe(true)

    const event = await eventPromise
    expect(event).not.toBeNull()
    expect(event!.type).toBe('cd_snackbar')
    expect(event!.text).toBe(text)
  })
})
