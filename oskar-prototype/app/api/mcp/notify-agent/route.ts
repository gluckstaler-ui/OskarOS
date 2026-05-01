/**
 * /api/mcp/notify-agent — push a message onto target agent's inbox.
 * Phase 3 (Ralph 2026-04-30, late).
 *
 * `from` identity (role + instanceId) comes from the MCP server context
 * captured at request time — clients can't spoof. `target` and `message`
 * come from the tool args. `target` accepts either:
 *   - `<role>`               — fan-out to all live instances of that role
 *   - `<role>:<instanceId>`  — sticky to that specific instance (Commit 1)
 *
 * Permission table in `lib/agent-inbox-bus.ts` decides whether the call
 * is allowed.
 */

import { NextResponse } from 'next/server'
import { notifyAgent, type AgentRole, canNotify } from '@/lib/agent-inbox-bus'

const VALID_ROLES = new Set<AgentRole>(['cd', 'webdev', 'sentinel', 'jedi-code'])

function isRole(v: unknown): v is AgentRole {
  return typeof v === 'string' && VALID_ROLES.has(v as AgentRole)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const from = body.from
  const fromInstance = String(body.fromInstance || '').trim()
  const target = String(body.target || '').trim()
  const message = String(body.message || '').trim()
  const priority = body.priority
  // replyTo: preserve the three-state — present-undefined / null / string —
  // so the bus's auto-fill semantics work end-to-end.
  const replyTo: string | null | undefined = (() => {
    if (!('replyTo' in body)) return undefined
    if (body.replyTo === null) return null
    if (typeof body.replyTo === 'string') return body.replyTo
    return undefined
  })()

  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (!isRole(from)) return NextResponse.json({ error: '`from` must be a valid agent role' }, { status: 400 })
  if (!fromInstance) return NextResponse.json({ error: '`fromInstance` required' }, { status: 400 })
  if (!target) return NextResponse.json({ error: '`target` required' }, { status: 400 })
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const r = notifyAgent({
    sessionId, from, fromInstance, target, message, priority, replyTo,
  })
  if (!r.ok) {
    // Best-effort role parse for the permission-aware status code: pull
    // the role out of "role" or "role:instance" target strings.
    const targetRole = target.split(':')[0] as AgentRole
    const isPermissionRelated = isRole(targetRole) && !canNotify(from, targetRole)
    return NextResponse.json({ error: r.error }, { status: isPermissionRelated ? 403 : 400 })
  }
  return NextResponse.json({
    ok: true,
    messageId: r.messageId,
    threadId: r.threadId,
    delivered: r.delivered,
  })
}
