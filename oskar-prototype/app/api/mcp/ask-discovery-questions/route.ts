/**
 * /api/mcp/ask-discovery-questions — Phase 2 (Ralph 2026-05-04).
 *
 * The CD agent calls `ask_discovery_questions(questions[], context?)` via
 * MCP during initial brand discovery when ≥3 things still need
 * clarification. The MCP server's tool handler POSTs here; this route
 * publishes a `discovery_questions` event to the per-session event bus.
 * The frontend's /api/events SSE delivers it; <DiscoveryQuestionsCard>
 * renders one input per question. User submits → handleSend posts the
 * answers as a normal user message so CD picks them up next turn.
 *
 * Mirrors /api/mcp/snackbar/route.ts shape.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { sessionId?: string; questions?: unknown; context?: unknown }
    | null
  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!Array.isArray(body.questions) || body.questions.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'questions must be a non-empty array of strings' },
      { status: 400 },
    )
  }
  // Coerce to strings — agents sometimes pass nested shapes; flatten defensively.
  const questions = body.questions.map((q) => String(q ?? '').trim()).filter(Boolean)
  if (questions.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'questions array contains only empty strings' },
      { status: 400 },
    )
  }
  const context = typeof body.context === 'string' ? body.context : undefined

  publish(body.sessionId, {
    type: 'discovery_questions',
    questions,
    context,
  } as Parameters<typeof publish>[1])

  return NextResponse.json({ ok: true, questionCount: questions.length })
}
