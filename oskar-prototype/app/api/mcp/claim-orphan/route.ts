/**
 * /api/mcp/claim-orphan — atomic orphan claim.
 * Commit 3 (Ralph 2026-05-01).
 *
 * The calling agent (role + instanceId from MCP context) claims a specific
 * orphan message. First-claimer-wins; subsequent claims for the same
 * message id return an error.
 *
 * On success, the orphan moves from the role-level orphan queue into the
 * claimer's inbox. The next `agent_inbox` from that instance returns it
 * as a normal drained message (and updates lastSeen for auto-replyTo).
 */

import { NextResponse } from 'next/server'
import { claimOrphan, type AgentRole } from '@/lib/agent-inbox-bus'

const VALID_ROLES = new Set<AgentRole>(['cd', 'webdev', 'sentinel', 'jedi-code'])

function isRole(v: unknown): v is AgentRole {
  return typeof v === 'string' && VALID_ROLES.has(v as AgentRole)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const claimer = body.claimer
  const claimerInstance = String(body.claimerInstance || '').trim()
  const messageId = String(body.messageId || '').trim()

  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (!isRole(claimer)) return NextResponse.json({ error: '`claimer` must be a valid agent role' }, { status: 400 })
  if (!claimerInstance) return NextResponse.json({ error: '`claimerInstance` required' }, { status: 400 })
  if (!messageId) return NextResponse.json({ error: '`messageId` required' }, { status: 400 })

  const r = claimOrphan({ sessionId, claimer, claimerInstance, messageId })
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
