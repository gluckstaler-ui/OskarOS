/**
 * TodoWrite stream parser — LEGACY, OBSOLETE AS OF 2026-05-06.
 *
 * Originally ported from OD (Phase 2 Commit C, 2026-05-02). Read the
 * Claude Code built-in `TodoWrite` tool's `tool_use` events out of CD's
 * stream-json output and surfaced them in the chat UI.
 *
 * Why obsolete: the built-in `TodoWrite` is no longer in CD's allowlist
 * (lib/mcp-config.ts, 2026-05-06). The single write path is now the MCP
 * tool `todo_write` → lib/runtime/todos-store.ts → SESSION.md `## Todos`
 * section (WP-66). Persistence + UI both feed off that file via
 * /api/sessions/{id}/todos and the `todos_updated` event-bus message.
 *
 * Status: kept for offline replay of pre-2026-05-06 sessions whose stream
 * logs still contain `TodoWrite` events. No active consumers in the app
 * code (verified via grep). Do NOT wire new callers; reach for
 * `lib/runtime/todos-store.ts` instead.
 */

// WP-66 (2026-05-06): single source of truth for the TodoItem shape now
// lives at `lib/types/todos.ts`. Re-exported here so existing consumers
// (`@/lib/runtime/todos`) keep working unchanged.
export type { TodoItem, TodoStatus } from '@/lib/types/todos'
import type { TodoItem } from '@/lib/types/todos'

/**
 * Generic shape for an agent event; matches both OD's `AgentEvent` and
 * OskarOS's `DaemonAgentPayload`. Kept loose intentionally — consumers
 * pass whatever they have and the parser narrows.
 */
export interface ToolUseEventLike {
  kind?: string;
  type?: string;
  name?: string;
  input?: unknown;
}

export function parseTodoWriteInput(input: unknown): TodoItem[] {
  if (!input || typeof input !== 'object') return [];
  const obj = input as { todos?: unknown };
  if (!Array.isArray(obj.todos)) return [];
  return obj.todos
    .map((todo): TodoItem | null => {
      if (!todo || typeof todo !== 'object') return null;
      const record = todo as Record<string, unknown>;
      const content = typeof record.content === 'string' ? record.content : '';
      if (!content) return null;
      const status =
        record.status === 'completed' || record.status === 'in_progress'
          ? record.status
          : 'pending';
      return {
        content,
        status,
        activeForm: typeof record.activeForm === 'string' ? record.activeForm : undefined,
      };
    })
    .filter((todo): todo is TodoItem => todo !== null);
}

function isToolUseEvent(e: ToolUseEventLike | null | undefined): boolean {
  if (!e) return false;
  return e.kind === 'tool_use' || e.type === 'tool_use';
}

/**
 * Walk the events list backwards and return the most recent TodoWrite's
 * parsed `TodoItem[]`. Empty array if no TodoWrite has been emitted yet.
 *
 * Why backwards: a single agent turn may emit multiple TodoWrite calls
 * (initial → progress update → final state). The latest one is the
 * authoritative state of the checklist.
 */
export function latestTodosFromEvents(
  events: ToolUseEventLike[] | undefined,
): TodoItem[] {
  if (!events) return [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!isToolUseEvent(event)) continue;
    if (event!.name !== 'TodoWrite') continue;
    return parseTodoWriteInput(event!.input);
  }
  return [];
}

/**
 * Filter the latest TodoWrite to items the agent didn't finish — feeds
 * the `UnfinishedTodosPanel` "Continue remaining" affordance. Items with
 * status `completed` are dropped; `pending` and `in_progress` survive.
 */
export function unfinishedTodosFromEvents(
  events: ToolUseEventLike[] | undefined,
): TodoItem[] {
  return latestTodosFromEvents(events).filter((todo) => todo.status !== 'completed');
}
