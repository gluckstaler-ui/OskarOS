/**
 * /api/mcp/replay-events — drain events from the per-session ring buffer.
 * Phase 3 (Ralph + CD 2026-04-30, late).
 *
 * Used by `replay_events()` MCP tool. Synchronous, deterministic, no
 * transport-stream timing — exactly what the order66 / bridge-respawn case
 * needs. The on-connect replay in app/api/mcp/server/route.ts is best-effort;
 * this is the belt-and-braces explicit poll the agent's polling rule fires
 * on every turn.
 */

import { NextResponse } from 'next/server'
import { replayRecent } from '@/lib/event-bus'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const sinceTs = typeof body.sinceTs === 'string' ? body.sinceTs : undefined
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  const events = replayRecent(sessionId, sinceTs)
  return NextResponse.json({ events, count: events.length })
}
