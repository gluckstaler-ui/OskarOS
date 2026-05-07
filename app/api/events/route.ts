/**
 * /api/events — Server-Sent Events stream of session events.
 *
 * Subscribers (the Oskar MCP server, primarily) hold an open GET to this
 * endpoint with `?session=<id>`. Every event published to the per-session
 * event-bus by other API routes is forwarded as a `data: <json>\n\n` frame.
 *
 * Heartbeat: a `data: [heartbeat]` line every 25s keeps the connection
 * alive across proxies/load-balancers that drop idle TCP. The MCP loop
 * ignores those lines.
 *
 * Disconnect: client abort (or stream error) calls the unsubscribe fn
 * returned by `subscribe()` so the listener is removed from the bus.
 */

import { NextRequest } from 'next/server'
import { subscribe, type SessionEvent } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session')
  if (!sessionId) {
    return new Response('Missing ?session=', { status: 400 })
  }

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)) }
        catch { /* controller closed — ignore */ }
      }
      // 2026-04-30 (Ralph bug — JSON.parse on heartbeat). SSE spec: any
      // line starting with `:` is a comment and the EventSource browser
      // implementation drops it silently — no `onmessage` fires for it.
      // The previous heartbeat was sent as `data: [heartbeat]\n\n`, which
      // the frontend handed to JSON.parse, which threw; the try/catch
      // swallowed the throw but Next.js dev overlay still surfaced the
      // caught console.error as a runtime warning. Switch to comment.
      const sendComment = (text: string) => {
        try { controller.enqueue(encoder.encode(`: ${text}\n\n`)) }
        catch {}
      }

      // Initial hello so the client knows the channel is alive.
      send(JSON.stringify({ type: 'connected', ts: new Date().toISOString(), session: sessionId } satisfies SessionEvent))

      // Per-session subscription; events flow until unsubscribe.
      unsubscribe = subscribe(sessionId, (event) => send(JSON.stringify(event)))

      heartbeatTimer = setInterval(() => sendComment('heartbeat'), 25_000)

      req.signal.addEventListener('abort', () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        if (unsubscribe) unsubscribe()
        try { controller.close() } catch {}
      })
    },
    cancel() {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      if (unsubscribe) unsubscribe()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable Nginx-style buffering when running behind proxies.
      'X-Accel-Buffering': 'no',
    },
  })
}
