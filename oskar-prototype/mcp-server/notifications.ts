/**
 * notifications — App→CD push channel.
 *
 * The Next.js app publishes session events (vibe_built, image_ready,
 * hotswap_complete, error, image_failed, etc.) to an in-memory event-bus.
 * `/api/events?session=X` is a Server-Sent Events stream that emits each
 * event as a `data:` line.
 *
 * This module subscribes to that SSE stream from inside the MCP server
 * subprocess and forwards each event to CD as an MCP `notifications/message`.
 * That notification surfaces in CD's chat context as a system-message-style
 * delivery — replaces the legacy `[SYSTEM:]` user-message injection in
 * app/page.tsx.
 *
 * The connection auto-reconnects on disconnect with backoff, so a Next.js
 * dev-server reload doesn't permanently sever the channel.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

const BASE_URL = process.env.OSKAR_BASE_URL || 'http://localhost:3000'
const SESSION_ID = process.env.OSKAR_SESSION_ID || ''

export function startNotificationLoop(server: Server) {
  if (!SESSION_ID) {
    console.error('[mcp-notifications] OSKAR_SESSION_ID missing — notifications disabled')
    return
  }

  let attempt = 0
  const connect = async () => {
    const url = `${BASE_URL}/api/events?session=${encodeURIComponent(SESSION_ID)}`
    try {
      const res = await fetch(url, { headers: { Accept: 'text/event-stream' } })
      if (!res.ok || !res.body) {
        throw new Error(`SSE connect failed: HTTP ${res.status}`)
      }
      attempt = 0
      console.error(`[mcp-notifications] Connected to ${url}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
          if (!dataLine) continue
          const payload = dataLine.slice(5).trim()
          if (!payload || payload === '[heartbeat]') continue
          try {
            const event = JSON.parse(payload)
            // Forward to CD as an MCP notification. The Claude CLI surfaces
            // these in the model's context as logging messages.
            server.sendLoggingMessage({
              level: event.level || 'info',
              data: event,
            })
          } catch (err) {
            console.error('[mcp-notifications] Bad event payload:', payload.slice(0, 200), err)
          }
        }
      }

      // Stream closed cleanly — reconnect after a beat
      console.error('[mcp-notifications] Stream closed, reconnecting…')
    } catch (err) {
      attempt++
      console.error(`[mcp-notifications] Connect error (attempt ${attempt}):`, err)
    }

    // Backoff: 1s, 2s, 4s, … capped at 30s
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
    setTimeout(connect, delay)
  }

  // Fire-and-forget — the loop manages itself.
  void connect()
}
