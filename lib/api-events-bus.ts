'use client'

/**
 * Shared per-session /api/events SSE multiplexer (Ralph 2026-06-02).
 *
 * ONE EventSource per sessionId, fanned out to N listeners — so the studio
 * page (app/page.tsx) and the LiveOverlay don't each open their OWN socket to
 * the same /api/events stream. On `next dev` (HTTP/1.1, ~6 connections per
 * origin) two always-on SSE + the HMR socket + the chat-stream reader
 * exhausted the pool, so chunk/API/worker fetches failed with
 * "Failed to fetch" / ChunkLoadError. Collapsing the duplicate /api/events
 * subscriptions onto one shared connection frees the pool.
 *
 * NOTE: distinct from lib/session-events.ts, which is the IN-APP event
 * emitter (emitImageReady / sessionEvents). This file owns the *network* SSE.
 *
 * Each subscriber receives the raw MessageEvent (the route sends default
 * `data: <json>\n\n` frames; heartbeats are SSE comments the browser drops)
 * and does its own JSON.parse + filtering — identical to the per-consumer
 * handlers that existed before, just over one socket.
 *
 * Ref-counted: the connection opens on first subscribe and closes when the
 * last subscriber unsubscribes.
 */

type ApiEventListener = (evt: MessageEvent) => void

interface Channel {
  es: EventSource
  listeners: Set<ApiEventListener>
}

const channels = new Map<string, Channel>()

export function subscribeApiEvents(
  sessionId: string,
  listener: ApiEventListener,
): () => void {
  if (!sessionId || typeof window === 'undefined') return () => {}

  let channel = channels.get(sessionId)
  if (!channel) {
    const es = new EventSource(`/api/events?session=${encodeURIComponent(sessionId)}`)
    const created: Channel = { es, listeners: new Set() }
    es.onmessage = (evt) => {
      // Snapshot the set so a listener that unsubscribes during dispatch
      // can't mutate what we're iterating.
      for (const l of Array.from(created.listeners)) {
        try {
          l(evt)
        } catch (err) {
          console.error('[api-events] listener threw', err)
        }
      }
    }
    es.onerror = (err) => {
      // EventSource auto-reconnects natively; just log (matches the prior
      // per-consumer behavior in app/page.tsx and LiveOverlay).
      console.warn('[/api/events] connection error (auto-retrying):', err)
    }
    channels.set(sessionId, created)
    channel = created
  }

  channel.listeners.add(listener)

  return () => {
    const ch = channels.get(sessionId)
    if (!ch) return
    ch.listeners.delete(listener)
    if (ch.listeners.size === 0) {
      ch.es.close()
      channels.delete(sessionId)
    }
  }
}
