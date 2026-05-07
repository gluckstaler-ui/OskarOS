'use client'

/**
 * LiveOverlay — top-right ambient strip (WP-22, 2026-05-06).
 *
 * Mounts inside ConversationPanel, anchored top-right. Holds auto-updating
 * panels: in-flight builds (live mirror via `BuildOverlayRow`) + the
 * TodoWrite queue (`UnfinishedTodosPanel`).
 *
 * Layout: horizontal-first wrap.
 *   - Newest card closest to the corner; older pushed left (flex-row-reverse).
 *   - flex-wrap: wrap so 4+ in-flight cards stack into a second row.
 *   - On wide desktop: builds + todos side-by-side.
 *   - On narrow viewport / many cards: wraps down naturally.
 *
 * Visibility rule: rendered only when ≥1 card has live content. Empty
 * state = nothing rendered (zero footprint, no card chrome flash).
 *
 * Subscriptions:
 *   - SSE listener for `todos_updated` → refetch /api/sessions/{id}/todos
 *     (full re-read; the event payload is just a notification).
 *   - SSE listener for `build_started` / `build_failed` / `vibe_built` →
 *     update local in-flight builds map (keyed by jobId).
 *
 * Persistence: uses /api/sessions/{id}/todos GET on mount so the panel
 * survives page reloads / agent respawns. State of truth = SESSION.md's
 * `## Todos` section (WP-66).
 *
 * Single-writer rule: this component never POSTs to /api/mcp/todo-write.
 * User input → normal chat → CD encodes as TodoWrite on next turn.
 */

import { useCallback, useEffect, useState } from 'react'
import type { TodoItem } from '@/lib/types/todos'
import {
  DELETE_TODO_EVENT,
  UnfinishedTodosPanel,
  type DeleteTodoEventDetail,
} from './UnfinishedTodosPanel'
import { BuildOverlayRow } from './BuildOverlayRow'

export interface LiveOverlayProps {
  sessionId: string | null
  /** Optional: in-flight builds tracked by the parent. Each one renders as
   *  a BuildOverlayRow inside its own bento card. Snaps out on terminal
   *  state — drop the entry from the array on `vibe_built`/`build_failed`. */
  builds?: BuildEntry[]
  /** Click handler for build rows (e.g. scroll inline receipt into view). */
  onBuildClick?: (jobId: string) => void
}

export interface BuildEntry {
  jobId: string
  thumb?: string
  id: string
  label?: string
  timeline?: string
  eta?: number
}

export function LiveOverlay({ sessionId, builds = [], onBuildClick }: LiveOverlayProps) {
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [todosLoaded, setTodosLoaded] = useState(false)
  const [todosMinimized, setTodosMinimized] = useState(false)

  // Read the persisted todos from disk (SESSION.md → ## Todos via WP-66 store).
  const refetchTodos = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/sessions/${sessionId}/todos`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { todos?: TodoItem[] }
      setTodos(Array.isArray(data.todos) ? data.todos : [])
      setTodosLoaded(true)
    } catch {
      // Best-effort — overlay shows empty if the read fails. SSE retry
      // will surface the next `todos_updated` event.
    }
  }, [sessionId])

  // On mount + sessionId change → fetch
  useEffect(() => {
    void refetchTodos()
  }, [refetchTodos])

  // SSE subscription: re-read on todos_updated; ignore other event types.
  useEffect(() => {
    if (!sessionId) return
    const url = `/api/events?sessionId=${encodeURIComponent(sessionId)}`
    const es = new EventSource(url)
    const onMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { type?: string }
        if (data?.type === 'todos_updated') {
          void refetchTodos()
        }
      } catch {
        // non-JSON heartbeat or malformed event — skip
      }
    }
    es.addEventListener('message', onMessage)
    return () => {
      es.removeEventListener('message', onMessage)
      es.close()
    }
  }, [sessionId, refetchTodos])

  // Window-event subscription for the panel's trash-on-hover affordance.
  // The panel dispatches `cd-delete-todo` with {todoId}; we own sessionId
  // here, so we issue the DELETE.
  //
  // Refresh strategy: TWO paths converge to refetch.
  //   1. Local explicit refetch on 200 — UI updates immediately, doesn't
  //      wait for SSE round-trip. Bug fix 2026-05-06 (Ralph: "server has
  //      delete action, but it is not deleted [in panel]"). Server
  //      action ran fine, but SSE delivery to the listener was missing
  //      the frame.
  //   2. SSE `todos_updated` listener above also fires from the server's
  //      writeTodos publish — kept as a safety net for cross-tab sync.
  //
  // Scoped exception to single-writer (Ralph 2026-05-06): only completed
  // items can land here (panel guards client-side; server enforces too).
  useEffect(() => {
    if (!sessionId) return
    const onDelete = async (e: Event) => {
      const detail = (e as CustomEvent<DeleteTodoEventDetail>).detail
      if (!detail?.todoId) return
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/todos?todoId=${encodeURIComponent(detail.todoId)}`
      try {
        await fetch(url, { method: 'DELETE' })
      } catch {
        // Network errors fall through to the finally — refetch still
        // reconciles UI with server truth.
      } finally {
        // ALWAYS refetch (Ralph 2026-05-06 bug fix). Earlier code only
        // refetched on res.ok, which left the UI showing phantom items
        // when the server returned 404 (already-deleted) or 422
        // (not-completed). Refetching unconditionally guarantees the
        // panel reflects whatever the server actually has.
        await refetchTodos()
      }
    }
    window.addEventListener(DELETE_TODO_EVENT, onDelete)
    return () => {
      window.removeEventListener(DELETE_TODO_EVENT, onDelete)
    }
  }, [sessionId, refetchTodos])

  // Don't render anything until we know the load result. Avoids a flash
  // of an empty bento card on first paint.
  if (!todosLoaded && todos.length === 0 && builds.length === 0) return null

  // Visibility rule — render only when at least one panel has live content.
  const hasTodos = todos.length > 0
  const hasBuilds = builds.length > 0
  if (!hasTodos && !hasBuilds) return null

  return (
    <div
      // Top-right anchor inside the ChatPanel. Pointer-events on children
      // only so the empty space around cards doesn't intercept clicks
      // meant for the chat scroll surface beneath.
      // `live-overlay` class is the scope hook for nested-panel CSS
      // overrides (see globals.css → `.live-overlay .unfinished-todos`,
      // which strips the inner bento so we don't render card-in-a-card).
      className="live-overlay"
      style={{
        position: 'absolute',
        // Vertically align the head row with the chat panel's "Briefing"
        // header (Ralph 2026-05-06: "Mission and Briefing need to be on
        // the same line"). Chat header is 56px; head row is ~46px. With
        // top:5, head spans y=5→y=51 — text baseline lines up with
        // "Briefing" at the header's vertical center (y=28).
        top: 5,
        right: 12,
        // Bottom anchor so the panel never extends past the input box
        // ("max length is the input box"). Chat input form is ~225px;
        // 16px buffer above so the card doesn't kiss the input.
        bottom: 240,
        display: 'flex',
        flexDirection: 'row-reverse',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        // Critical: default `align-items: stretch` would stretch every
        // OverlayCard to fill container height (12 → input-240). That's
        // what made the panel cover the chat. flex-start lets each card
        // size to natural content; the bottom:240 bound only kicks in
        // when content actually exceeds it, at which point the panel's
        // own max-height + overflow-y on the list takes over.
        alignItems: 'flex-start',
        gap: 8,
        maxWidth: 'calc(100% - 24px)',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {/* TODOS card — first slot, highest priority. */}
      {hasTodos && (
        <OverlayCard pointerEnabled>
          <UnfinishedTodosPanel
            todos={todos}
            minimized={todosMinimized}
            onToggleMinimized={() => setTodosMinimized((v) => !v)}
          />
        </OverlayCard>
      )}

      {/* BUILD cards — one card per in-flight job. New jobs land at the
          right edge (closest to corner) per row-reverse direction. */}
      {builds.map((b) => (
        <OverlayCard key={b.jobId} pointerEnabled>
          <BuildOverlayRow
            jobId={b.jobId}
            thumb={b.thumb}
            id={b.id}
            label={b.label}
            timeline={b.timeline}
            eta={b.eta}
            onClick={onBuildClick ? () => onBuildClick(b.jobId) : undefined}
          />
        </OverlayCard>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * OverlayCard — bento-card wrapper used by every overlay slot. Same theme
 * tokens as `ToolCard` (theme-radius, border, padding) so visual rhythm
 * matches the inline cards in the chat scroll.
 */
function OverlayCard({
  children,
  pointerEnabled,
}: {
  children: React.ReactNode
  pointerEnabled?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-card, 12px)',
        // Padding=0 — the inner panel owns all internal spacing per the
        // luxury pass (2026-05-06). This keeps OverlayCard a pure frame
        // and lets every card type tune its own breathing room.
        padding: 0,
        boxShadow: 'var(--shadow-card, 0 4px 16px rgba(0,0,0,0.32))',
        backdropFilter: 'blur(6px)',
        pointerEvents: pointerEnabled ? 'auto' : 'none',
        // Cap individual card width. Bumped 320 → 380 → 400 across the
        // luxury / bento pass — Territory grammar's tight 8/12 padding gets
        // 28/30 here because rounded corners need more space to feel
        // intentional than sharp ones do.
        maxWidth: 400,
        // Inherit overlay's bottom-bound height so the inner panel can
        // scroll its list when content exceeds available space. The panel
        // is structured as flex-col (head pinned, list scrollable).
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}
