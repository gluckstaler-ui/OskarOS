/**
 * /api/mcp/todo-write — TodoWrite persistence layer (WP-66, 2026-05-06).
 *
 * MCP-server forwards `todo_write({sessionId, todos})` here. We delegate to
 * the store at `lib/runtime/todos-store.ts` which handles the SESSION.md
 * find-replace AND the `todos_updated` event-bus broadcast. Frontend
 * LiveOverlay (WP-22) subscribes via /api/events SSE → re-reads via
 * /api/sessions/{id}/todos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { writeTodos } from '@/lib/runtime/todos-store'
import type { TodoItem, TodoStatus } from '@/lib/types/todos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TodoWriteBody {
  sessionId?: string
  todos?: unknown
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as TodoWriteBody | null
  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!Array.isArray(body.todos)) {
    return NextResponse.json({ ok: false, error: 'todos must be an array' }, { status: 400 })
  }

  // Loose-typed input → typed TodoItem[]. The store sanitizes again, but
  // we narrow here so a bad input fails fast with a clear 400.
  const items: TodoItem[] = body.todos
    .map((raw): TodoItem | null => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const content = typeof r.content === 'string' ? r.content : ''
      if (!content.trim()) return null
      const status: TodoStatus =
        r.status === 'completed' || r.status === 'in_progress' ? r.status : 'pending'
      return {
        id: typeof r.id === 'string' ? r.id : undefined,
        content,
        activeForm: typeof r.activeForm === 'string' ? r.activeForm : undefined,
        status,
      }
    })
    .filter((i): i is TodoItem => i !== null)

  try {
    const persisted = await writeTodos(body.sessionId, items)
    return NextResponse.json({ ok: true, count: persisted.length })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'todo write failed' },
      { status: 500 },
    )
  }
}
