/**
 * /api/mcp/echo-chat — COO/MCP-test bridge to surface MCP-injected chat
 * in the browser UI (Ralph 2026-05-10).
 *
 * The browser's chat state is updated by the page's input-submit handler,
 * which both POSTs to /api/chat-stream AND appends to React `messages[]`
 * synchronously. When the orchestrator's `send_user_input` POSTs to
 * chat-stream from the server side, only the orchestrator's caller (the
 * MCP proxy) consumes the response stream. The browser — listening on
 * /api/events — never sees that turn.
 *
 * This route closes the gap. After `send_user_input(mode='chat')`
 * collects `finalText`, it calls this endpoint with the user prompt + the
 * assistant text. The route publishes a `mcp_chat_echo` event; page.tsx
 * subscribes and appends both messages to `messages[]`. Real user typed
 * messages don't go through this path — only MCP-driven ones.
 *
 * Dev-only by convention. The orchestrator gates access via the test-
 * agent allowlist; production agents (CD/WebDev/Sentinel) don't have
 * `send_user_input` in their tool whitelist, so they can't reach this
 * route through the MCP layer.
 */
import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    sessionId?: string
    userText?: string
    assistantText?: string
  } | null

  if (!body?.sessionId || typeof body.sessionId !== 'string') {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  const userText = typeof body.userText === 'string' ? body.userText : ''
  const assistantText = typeof body.assistantText === 'string' ? body.assistantText : ''
  if (!userText && !assistantText) {
    return NextResponse.json({ ok: false, error: 'userText or assistantText required' }, { status: 400 })
  }

  publish(body.sessionId, {
    type: 'mcp_chat_echo',
    userText,
    assistantText,
  })

  return NextResponse.json({ ok: true })
}
