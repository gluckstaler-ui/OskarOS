/**
 * UnfinishedTodosPanel — overlay-only TodoWrite surface (WP-25, last rework 2026-05-06).
 *
 * Renders inside `<LiveOverlay />` (WP-22), top-right of ConversationPanel.
 * Two modes:
 *   - Full panel  — luxurious bento card, shows ALL items (no abridging).
 *   - Minimized   — single-line strip: "Task-Progress · 3 / 7 · on 2 / 7"
 *
 * Visual grammar (cowork.jpg reference + 2026-05-06 luxury pass):
 *   - Header: clipboard-check icon + "Task-Progress" title (16px Inter Tight 700).
 *     Chevron-down collapse on the right. Generous padding around everything.
 *   - Completed row: filled green pip (--success) with white check inside.
 *     Body line strikethrough at --text-faint.
 *   - In-progress row: filled orange pip (--warning) with the item's POSITION
 *     NUMBER inside (JetBrains Mono). Pulses gently. Tells the user "CD is
 *     on item N" at a glance. Bumped to 18px for legibility.
 *   - Pending row: hollow --text-muted ring.
 *   - On hover (non-completed rows): "recommend a change" chat-bubble button
 *     appears at the right. Click → dispatches a `cd-recommend-todo` window
 *     event; ConversationPanel listens, prefills the chat composer with
 *     `recommend on item N (content) — `, focuses input. User completes the
 *     sentence and sends; CD encodes the change as a TodoWrite next turn.
 *
 * Dismissal rule: minimize-only, never close. Shared visibility, single-writer
 * (CD writes; user reads + suggests via chat). No "+N more" abridging — the
 * panel shows the full queue. If it's tall, scroll the chat or minimize.
 *
 * Storage: backed by WP-66's persistence layer. Parent `LiveOverlay` passes
 * the current todos array; this component is presentational.
 */
'use client'

import * as React from 'react'
import { useState } from 'react'
import type { TodoItem } from '@/lib/types/todos'

/**
 * Window events the panel dispatches.
 *
 *   - RECOMMEND_TODO_EVENT — user clicked the chat-bubble button on a
 *     non-completed row. ConversationPanel listens, prefills the chat
 *     textarea + focuses. Read-only on the panel side; the write goes
 *     through chat → CD → next-turn TodoWrite.
 *
 *   - DELETE_TODO_EVENT — user clicked the trash button on a completed
 *     row. LiveOverlay listens (it has the sessionId) and calls
 *     `DELETE /api/sessions/{id}/todos?todoId=…`. Scoped exception to
 *     the single-writer rule: completed items are history, not
 *     commitments, so user pruning doesn't race CD. Active queue
 *     (pending + in_progress) remains CD-only.
 */
export const RECOMMEND_TODO_EVENT = 'cd-recommend-todo'
export const DELETE_TODO_EVENT = 'cd-delete-todo'

export interface RecommendTodoEventDetail {
  todo: TodoItem
  position: number
}
export interface DeleteTodoEventDetail {
  todoId: string
  content: string
}

export interface UnfinishedTodosPanelProps {
  todos: TodoItem[]
  minimized?: boolean
  onToggleMinimized?: () => void
}

export function UnfinishedTodosPanel({
  todos,
  minimized: minimizedProp,
  onToggleMinimized,
}: UnfinishedTodosPanelProps) {
  const [internalMinimized, setInternalMinimized] = useState(false)
  const minimized = minimizedProp ?? internalMinimized
  const handleToggle = () => {
    if (onToggleMinimized) onToggleMinimized()
    else setInternalMinimized((v) => !v)
  }

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  if (todos.length === 0) return null

  const total = todos.length
  const completed = todos.filter((t) => t.status === 'completed').length
  const inProgressIdx = todos.findIndex((t) => t.status === 'in_progress')

  const handleRecommend = (todo: TodoItem, position: number) => {
    if (typeof window === 'undefined') return
    const detail: RecommendTodoEventDetail = { todo, position }
    window.dispatchEvent(new CustomEvent(RECOMMEND_TODO_EVENT, { detail }))
  }

  const handleDelete = (todo: TodoItem) => {
    if (typeof window === 'undefined' || !todo.id) return
    const detail: DeleteTodoEventDetail = { todoId: todo.id, content: todo.content }
    window.dispatchEvent(new CustomEvent(DELETE_TODO_EVENT, { detail }))
  }

  // ── Unified head row — same size + padding in both states ───────────
  // The head is always rendered identically. Clicking it toggles
  // `minimized`. Expanded = head + list; collapsed = head only. Head
  // height never changes (Ralph 2026-05-06: "things cannot get bigger").
  // Summary line ("on N / M") removed 2026-05-06 — was getting truncated
  // at the locked 380px width. Active task is already indicated by the
  // in_progress pip in the expanded list; redundant in the head row.
  return (
    <div
      className="unfinished-todos"
      data-minimized={minimized ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={handleToggle}
        title={minimized ? 'Expand mission tasks' : 'Minimize mission tasks'}
        aria-label={minimized ? 'Expand mission tasks' : 'Minimize mission tasks'}
        aria-expanded={!minimized}
        className="unfinished-todos-head"
      >
        <span className="unfinished-todos-head-icon" aria-hidden>
          <TaskListIcon size={16} />
        </span>
        <span className="unfinished-todos-title">Mission · Tasks</span>
        <span className="unfinished-todos-head-sep" aria-hidden>·</span>
        <span className="unfinished-todos-head-count" aria-hidden>
          {completed} / {total}
        </span>
        {/* Spacer pushes the chevron to the right edge while keeping the
            title + count grouped left. Width is constant either way. */}
        <span className="unfinished-todos-head-spacer" aria-hidden />
        {/* Chevron flips: down when expanded (click to collapse), up
            when collapsed (click to expand). Same icon, rotation only. */}
        <ChevronDown
          size={14}
          className="unfinished-todos-head-chevron"
          rotate={minimized ? 180 : 0}
        />
      </button>
      {minimized ? null : (
        <ul className="unfinished-todos-list">
          {todos.map((todo, i) => {
          const position = i + 1
          const id = todo.id ?? `${todo.status}-${todo.content}-${i}`
          const isInProgress = todo.status === 'in_progress'
          const isCompleted = todo.status === 'completed'

          return (
            <li
              key={id}
              data-status={todo.status}
              onMouseEnter={() => setHoveredId(id)}
              onMouseLeave={() =>
                setHoveredId((h) => (h === id ? null : h))
              }
            >
              <span
                className="unfinished-todos-pip"
                data-status={todo.status}
                aria-hidden
              >
                {isCompleted ? (
                  <CheckPip />
                ) : isInProgress ? (
                  <NumberPip n={position} />
                ) : (
                  <RingPip />
                )}
              </span>
              <span className="unfinished-todos-text">
                {isInProgress && todo.activeForm
                  ? todo.activeForm
                  : todo.content}
              </span>
              {hoveredId === id ? (
                isCompleted ? (
                  <button
                    type="button"
                    className="unfinished-todos-row-action delete"
                    onClick={() => handleDelete(todo)}
                    title="Delete completed task"
                    aria-label="Delete completed task"
                    disabled={!todo.id}
                  >
                    <TrashIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="unfinished-todos-row-action recommend"
                    onClick={() => handleRecommend(todo, position)}
                    title="Recommend a change"
                    aria-label="Recommend a change"
                  >
                    <MessageCircle />
                  </button>
                )
              ) : null}
            </li>
          )
          })}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Glyphs — Feather-style SVGs, theme-aware via currentColor.
// ─────────────────────────────────────────────────────────────────────────────

/** Bigger pip — 18px now (was 14px) for breathing room + legibility. */
function CheckPip() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18">
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path
        d="M4.5 9.4 L7.6 12.3 L13.5 6"
        stroke="var(--bg-card)"
        strokeWidth="1.9"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NumberPip({ n }: { n: number }) {
  return (
    <span className="unfinished-todos-pip-number" aria-hidden>
      <svg viewBox="0 0 18 18" width="18" height="18" className="pip-bg">
        <circle cx="9" cy="9" r="9" fill="currentColor" />
      </svg>
      <span className="pip-num-label">{n}</span>
    </span>
  )
}

function RingPip() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18">
      <circle
        cx="9"
        cy="9"
        r="7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function ChevronDown({
  size = 14,
  rotate = 0,
  className,
}: {
  size?: number
  rotate?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      <path
        d="M3.5 6 L8 10.5 L12.5 6"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MessageCircle() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13">
      <path
        d="M14 7.5c0 3-2.7 5.5-6 5.5-1 0-2-.2-2.8-.6L2 14l1.2-3.2C2.5 9.8 2 8.7 2 7.5 2 4.5 4.7 2 8 2s6 2.5 6 5.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Feather-style trash icon — used for delete-completed-task hover affordance. */
function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13">
      <path
        d="M2.5 4.5 L13.5 4.5 M6.5 4.5 V3 a1 1 0 0 1 1 -1 h1 a1 1 0 0 1 1 1 V4.5 M4 4.5 L4.7 13 a1 1 0 0 0 1 1 h4.6 a1 1 0 0 0 1 -1 L12 4.5 M6.5 7.5 V11.5 M9.5 7.5 V11.5"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Task-list icon — three rows, top one checked, bottom two pending.
 * Reads as "tasks with progress" universally. Matches the panel's
 * own pip grammar (filled circle for done, hollow ring for pending).
 */
function TaskListIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size}>
      {/* Row 1 — done */}
      <circle cx="3" cy="4" r="2.4" fill="currentColor" />
      <path
        d="M1.7 4 L2.6 4.9 L4.3 3.1"
        stroke="var(--bg-card)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="7"
        y1="4"
        x2="16"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Row 2 — pending */}
      <circle
        cx="3"
        cy="9"
        r="1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line
        x1="7"
        y1="9"
        x2="16"
        y2="9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Row 3 — pending, slightly shorter */}
      <circle
        cx="3"
        cy="14"
        r="1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line
        x1="7"
        y1="14"
        x2="13.5"
        y2="14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  )
}
