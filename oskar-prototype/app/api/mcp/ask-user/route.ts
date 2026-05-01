/**
 * /api/mcp/ask-user — synchronous question (Phase 2 Tier S).
 *
 * Flow:
 *   1. The agent calls `ask_user({ question, options })`.
 *   2. The MCP server POSTs here.
 *   3. We register a pending Promise via `registerAsk()`, publish
 *      `cd_ask_user` event with {requestId, question, options}.
 *   4. Frontend renders modal, user clicks an option, frontend POSTs to
 *      /api/mcp/ask-user-response/{requestId} with {value}.
 *   5. That endpoint calls `deliverChoice(requestId, value)`, our pending
 *      Promise resolves.
 *   6. We return {choice} to the MCP server, which returns it to the agent.
 *
 * Timeout: 10 minutes. After that, the cancel sentinel `__cancelled__`
 * resolves and the modal auto-dismisses (frontend listens for that signal).
 *
 * Concurrency: at most one ask_user open per session. A second request
 * from the same session is rejected with a typed error so the agent
 * knows to wait.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'
import { registerAsk } from '@/lib/ask-user-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Allow this route to block for up to 10 minutes (matches the ask_user
// timeout). Without this, Next.js's default 30s would short-circuit.
export const maxDuration = 600

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { sessionId?: string; question?: string; options?: unknown }
    | null
  if (!body?.sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!body.question || typeof body.question !== 'string') {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }
  const options = Array.isArray(body.options)
    ? body.options.filter((o): o is string => typeof o === 'string')
    : []
  if (options.length < 2) {
    return NextResponse.json({ error: 'need at least 2 options' }, { status: 400 })
  }

  const reg = registerAsk({ sessionId: body.sessionId, question: body.question })
  if (reg.ok === false) {
    return NextResponse.json({ error: reg.error }, { status: 409 })
  }

  // Publish the modal-trigger event. Frontend renders via /api/events SSE.
  publish(body.sessionId, {
    type: 'cd_ask_user',
    requestId: reg.requestId,
    question: body.question,
    options,
  })

  // Block until the user picks (or 10-min timeout).
  const choice = await reg.promise
  return NextResponse.json({ choice })
}
