/**
 * Per-session in-memory event bus.
 *
 * Replaces both the chat-stream regex triggers (Layer 1) and the
 * `[SYSTEM:]`-into-chat injections (Layer 4) as the wire format between
 * the app and CD. API routes call `publish(sessionId, event)` after work
 * completes; the SSE endpoint at `/api/events` and the MCP notification
 * loop both consume this stream.
 *
 * Per-session isolation: subscribers to session A never see events for
 * session B. Backed by a Map<sessionId, Set<Listener>>; cleared on the last
 * unsubscribe so the map doesn't grow unbounded.
 *
 * 2026-04-30 (Phase 3 — Ralph + CD): per-session ring buffer added.
 * Holds the last RING_CAPACITY events per session. The HTTP MCP route
 * (app/api/mcp/server/route.ts) calls `replayRecent()` on every new
 * client connection to deliver any events that fired while the agent's
 * previous bridge was dead. Without this, a CD respawn after Order 66
 * would silently miss `vibe_built`, `image_ready`, `director_save`, etc.
 * that fired during the dead window — events that don't always reflect
 * cleanly on disk (director_save in particular).
 */

export type SessionEventKind =
  | 'connected'         // SSE handshake — emitted by /api/events on subscribe
  | 'vibe_built'
  | 'vibe_failed'
  | 'image_ready'
  | 'image_failed'
  | 'hotswap_complete'
  | 'hotswap_failed'
  | 'assets_updated'
  | 'build_started'
  | 'build_progress'   // Ralph 2026-05-06: per-stage transitions (queued→html→verify→done).
                       // Routes/runner publish at known boundaries; the BuildJobCard
                       // timeline flips its dots in real time. Payload: {target, stage,
                       // milestone?}. Optional milestone bullets piggy-back on the same
                       // event so the agent's free-form report_build_progress milestones
                       // and the route-level stage flips share one channel.
  | 'build_failed'
  | 'error'
  // Phase 2 Tier S (2026-04-30) — agent-initiated user-facing events
  | 'cd_snackbar'       // fire-and-forget snackbar from any agent
  | 'cd_ask_user'       // synchronous question modal from any agent
  // Phase 2 Tier B — Director Mode push (commit C)
  | 'director_save'
  // 2026-05-04 (Ralph) — discovery flow tools promoted from inline
  // /api/chat tools to MCP. Both `chat-stream` (CLI) and `chat` (API)
  // surface them via the same event-bus pipeline so the UI cards render
  // identically in both modes.
  | 'discovery_questions'  // CD asks the user N structured questions
  | 'confirm_understanding' // CD shows a summary; user clicks Build It
  // 2026-05-02 — every notify_agent enqueue also fires this push event so
  // any client with an open MCP transport (CD as MCP-server peer, future
  // sage/webdev peers) can see the message land BEFORE its own polling
  // cycle. Used today by the chat UI to push user messages to CD's inbox
  // mid-stream. CD-as-CLI doesn't reliably surface push notifications as
  // model-context, but the event is emitted regardless — when CD migrates
  // to MCP-server-peer per WP-F1b, the immediacy will work end-to-end.
  | 'agent_inbox_message'
  // WP-66 (2026-05-06): TodoWrite write → SESSION.md `## Todos` section
  // rewritten → broadcast. LiveOverlay (WP-22) subscribes and re-reads the
  // section so UnfinishedTodosPanel (WP-25) re-renders. Single-writer (CD);
  // user-add path flows through normal chat → CD encodes as a TodoWrite.
  | 'todos_updated'
  // WP-22 Phase 1 (2026-05-06): chat-card events for capability tools that
  // produce visible chat-surface artifacts. Each fires after the route's
  // primary work completes; page.tsx subscriber pushes a synthetic assistant
  // message with a `card` payload, ConversationPanel routes by `card.kind`.
  | 'screenshot_taken'        // /api/mcp/screenshot — Playwright capture done
  | 'apply_patch_complete'    // /api/mcp/apply-patch — surgical edit landed
  | 'notify_agent_sent'       // /api/mcp/notify-agent — peer-agent message enqueued
  // Ralph 2026-05-06: on-demand card render. CD calls `preview_card({kind,
  // payload})` when the user asks to "show me [a card]" so the user sees
  // a visual instance instead of pasted source. Route publishes this; page.tsx
  // pushes a synthetic assistant message with `card.__preview: true` so the
  // renderer can mark it as a sample (no real backend writes).
  | 'card_preview'

export interface SessionEvent {
  type: SessionEventKind
  level?: 'info' | 'warn' | 'error'
  ts: string // ISO timestamp
  // Free-form payload — kind-specific. Loose typing here so producers can
  // emit without coupling to a giant discriminated union; consumers that
  // need typed access can narrow on `type`.
  [key: string]: unknown
}

type Listener = (event: SessionEvent) => void

/**
 * 2026-04-30 — pin subscribers to globalThis.
 *
 * Next.js dev compiles each route handler independently and can load
 * module files (this file included) multiple times within ONE Node
 * process. The in-memory `Map` lives in module scope, so each route
 * route ends up with its own Map. `publish()` from /api/mcp/snackbar
 * writes to one Map; `subscribe()` from /api/events listens on a
 * DIFFERENT Map; the event goes nowhere. SSE delivers `connected` (its
 * own handshake) but never any of the cross-route events.
 *
 * Pinning to globalThis dedupes across module instances and across HMR
 * reloads. Survival window = lifetime of the Node process.
 *
 * Smoke test: open SSE on session X, POST /api/mcp/snackbar with the
 * same session, confirm the snackbar payload arrives in the SSE stream.
 */
const GLOBAL_KEY = Symbol.for('oskar.event-bus.subscribers') as unknown as string
const RING_KEY = Symbol.for('oskar.event-bus.ring') as unknown as string
const g = globalThis as Record<string, unknown>
const subscribers: Map<string, Set<Listener>> =
  (g[GLOBAL_KEY] as Map<string, Set<Listener>>) ||
  ((g[GLOBAL_KEY] = new Map<string, Set<Listener>>()) as Map<string, Set<Listener>>)

/**
 * Per-session ring buffer of recent events. Bounded at RING_CAPACITY per
 * session; oldest dropped on overflow. Survives bridge respawns so a fresh
 * MCP connection can replay what it missed.
 */
const RING_CAPACITY = 100
const ring: Map<string, SessionEvent[]> =
  (g[RING_KEY] as Map<string, SessionEvent[]>) ||
  ((g[RING_KEY] = new Map<string, SessionEvent[]>()) as Map<string, SessionEvent[]>)

export function publish(sessionId: string, event: Omit<SessionEvent, 'ts'> & { ts?: string }): void {
  const enriched = {
    ...event,
    level: (event.level as SessionEvent['level']) || 'info',
    ts: event.ts || new Date().toISOString(),
  } as SessionEvent

  // Always record in the ring, regardless of whether anyone's listening
  // right now — that's the whole point. A respawning agent reads back
  // what it missed via replayRecent().
  const buf = ring.get(sessionId) || []
  buf.push(enriched)
  if (buf.length > RING_CAPACITY) buf.shift()
  ring.set(sessionId, buf)

  const set = subscribers.get(sessionId)
  if (!set || set.size === 0) {
    // No live subscribers — already in the ring; the next reconnect
    // gets it via replayRecent.
    return
  }
  for (const listener of set) {
    try { listener(enriched) }
    catch (err) { console.error('[event-bus] listener threw:', err) }
  }
}

/**
 * Return events from this session's ring buffer that arrived strictly
 * after `sinceTs` (an ISO timestamp), or all buffered events if `sinceTs`
 * is omitted. The returned events are NOT removed from the ring — multiple
 * agents may need to replay independently.
 *
 * Used by the HTTP MCP route on every new client connection: replay the
 * buffer, then `subscribe()` for live events. Net effect: an agent
 * respawning mid-build sees the build's `vibe_built` event the next time
 * it polls or the next time its transport delivers a logging notification.
 */
export function replayRecent(sessionId: string, sinceTs?: string): SessionEvent[] {
  const buf = ring.get(sessionId) || []
  if (!sinceTs) return [...buf]
  return buf.filter((e) => e.ts > sinceTs)
}

/**
 * Test helper: clear the ring for a session. NOT exposed via routes; only
 * used by tests that want to start fresh between scenarios.
 */
export function clearRing(sessionId: string): void {
  ring.delete(sessionId)
}

export function subscribe(sessionId: string, listener: Listener): () => void {
  let set = subscribers.get(sessionId)
  if (!set) {
    set = new Set()
    subscribers.set(sessionId, set)
  }
  set.add(listener)
  return () => {
    const s = subscribers.get(sessionId)
    if (!s) return
    s.delete(listener)
    if (s.size === 0) subscribers.delete(sessionId)
  }
}

/** Test/debug helper — current subscriber count for a session. */
export function subscriberCount(sessionId: string): number {
  return subscribers.get(sessionId)?.size ?? 0
}
