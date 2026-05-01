/**
 * /api/mcp/thread-history — read full chronological message history for a
 * thread. Punch-list #2 (CD, 2026-05-01).
 *
 * Why: agents reasoning over multi-turn conversations need access to the
 * full thread, but `agent_inbox()` only returns CURRENTLY queued messages.
 * After drain, prior messages are gone from the inbox. messageLog retains
 * records (extended in this commit to carry full bodies); this endpoint
 * surfaces the reconstructed thread.
 *
 * Read-only. No state mutation. No permission scoping beyond session
 * isolation — any agent in the session can read any thread, since threads
 * are public conversation context.
 */

import { NextResponse } from 'next/server'
import { threadHistory } from '@/lib/agent-inbox-bus'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const threadId = String(body.threadId || '').trim()

  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 })

  const messages = threadHistory(sessionId, threadId)
  return NextResponse.json({ messages, count: messages.length })
}
