/**
 * /api/mcp/agent-inbox — drain the calling agent's inbox.
 * Phase 3 (Ralph 2026-04-30, late).
 *
 * The calling agent's identity (role + instanceId) is passed by the
 * dispatcher, which got it from the MCP server context at call time.
 * Each instance reads its OWN inbox; you can't read another instance's
 * queue (Commit 1, 2026-05-01).
 */

import { NextResponse } from 'next/server'
import { drainInbox, type AgentRole } from '@/lib/agent-inbox-bus'

const VALID_ROLES = new Set<AgentRole>(['cd', 'webdev', 'sentinel', 'jedi-code'])

function isRole(v: unknown): v is AgentRole {
  return typeof v === 'string' && VALID_ROLES.has(v as AgentRole)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const agent = body.agent
  const instanceId = String(body.instanceId || '').trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (!isRole(agent)) return NextResponse.json({ error: '`agent` must be a valid agent role' }, { status: 400 })
  if (!instanceId) return NextResponse.json({ error: '`instanceId` required' }, { status: 400 })

  const messages = drainInbox(sessionId, agent, instanceId)
  return NextResponse.json({ messages, count: messages.length })
}
