/**
 * /api/sessions/[id]/todos — read + scoped-delete the todo list (WP-66, 2026-05-06).
 *
 * GET: parsed `## Todos` section from SESSION.md. LiveOverlay calls on
 *   mount + on every `todos_updated` SSE event.
 *
 * DELETE: scoped exception to the single-writer rule. The user can prune
 *   COMPLETED todos via the trash-on-hover affordance in
 *   UnfinishedTodosPanel. Active queue (pending + in_progress) remains
 *   CD-only — this endpoint refuses non-completed deletions with 422.
 *
 *   Active write path remains MCP's `todo_write` tool (CD calls).
 */

import { NextResponse } from 'next/server'
import {
  deleteCompletedTodo,
  readTodos,
  seedDiscoveryTodosIfMissing,
} from '@/lib/runtime/todos-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await context.params
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  try {
    // First-read seed: if SESSION.md has no `## Todos` section yet, write
    // the canonical Phase 1 (Discovery) list. Idempotent — subsequent
    // reads see the section and no-op. Anchored in code at
    // `lib/runtime/discovery-seed.ts` per Ralph 2026-05-06.
    await seedDiscoveryTodosIfMissing(sessionId)
    const todos = await readTodos(sessionId)
    // Cache-control: no-store — every fetch must hit disk so a fresh
    // todos_updated event reflects within one render cycle.
    return NextResponse.json({ todos }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to read todos' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await context.params
  const url = new URL(req.url)
  const todoId = url.searchParams.get('todoId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!todoId) {
    return NextResponse.json({ error: 'todoId required' }, { status: 400 })
  }
  try {
    const result = await deleteCompletedTodo(sessionId, todoId)
    if (result.ok === false) {
      const status = result.reason === 'not_found' ? 404 : 422
      return NextResponse.json({ ok: false, reason: result.reason }, { status })
    }
    return NextResponse.json({ ok: true, remaining: result.remaining.length })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to delete todo' },
      { status: 500 },
    )
  }
}
