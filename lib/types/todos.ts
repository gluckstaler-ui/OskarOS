/**
 * lib/types/todos.ts — TodoItem schema (WP-66, 2026-05-06).
 *
 * Single source of truth for the TodoWrite item shape. Used by:
 *   - lib/runtime/todos.ts             — agent-event parser (legacy path)
 *   - lib/runtime/todos-store.ts       — SESSION.md read/write (WP-66)
 *   - components/chat/UnfinishedTodosPanel.tsx — overlay UI (WP-25)
 *
 * Carved out so the type doesn't live next to the parser file (the parser
 * is a transient input-shape adapter; the type is the durable contract).
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  /** Stable id (CD-assigned). Optional — legacy items without ids fall
   *  back to content+index for keying. New writes should always set this. */
  id?: string
  /** Imperative phrasing — what needs to be done. */
  content: string
  /** Present-continuous — what's happening now. Shown when status === 'in_progress'. */
  activeForm?: string
  status: TodoStatus
}
