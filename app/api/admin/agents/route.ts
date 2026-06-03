// ==========================================
// Admin · Agents — single-route surface
// GET /api/admin/agents                              → catalog
// GET /api/admin/agents?action=raw&id=<id>           → raw .md
// GET /api/admin/agents?action=preview&id=<id>       → rendered HTML (iframe)
// GET /api/admin/agents?action=messages&id=<id>      → live MCP messages
//
// Consolidated into one route after a dev-server route-cache snag with
// dynamic [id] subroutes — query params dodge the issue and keep the
// file count down. Single dispatcher; same behavior. (Ralph 2026-05-22.)
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { marked } from 'marked'
import {
  liveInstancesOf,
  pendingCount,
  pendingOrphansFor,
  type AgentRole,
} from '@/lib/agent-inbox-bus'
import { replayRecent } from '@/lib/event-bus'
import { AGENTS, AGENTS_DIR, findAgentById } from '@/lib/admin-agent-catalog'

const PUBLIC_DIR = join(process.cwd(), 'public')

const STYLE = `
  :root {
    --bg: #1e1e22; --bg-deeper: #09090b; --text: #f4f4f5;
    --muted: #a1a1aa; --dim: #52525b; --border: #2e2e33;
    --accent: #15B981; --teal: #5EEAD4; --code-bg: #09090b;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff; --bg-deeper: #f8fafc; --text: #0f172a;
      --muted: #64748b; --dim: #94a3b8; --border: #e2e8f0;
      --accent: #16ba81; --teal: #0F766E; --code-bg: #f1f5f9;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; line-height: 1.6; padding: 20px 28px 60px;
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 700; color: var(--text); margin: 1.4em 0 0.4em; }
  h1 { font-size: 22px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  h2 { font-size: 17px; color: var(--teal); margin-top: 1.6em; }
  h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; }
  h4 { font-size: 13px; color: var(--muted); }
  p, ul, ol { margin: 0.5em 0; }
  ul, ol { padding-left: 1.5em; }
  li { margin: 0.2em 0; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { color: var(--text); }
  em { color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
  blockquote { border-left: 3px solid var(--accent); margin: 1em 0; padding: 0.2em 1em; color: var(--muted); background: rgba(21, 185, 129, 0.04); border-radius: 0 6px 6px 0; }
  code { font-family: 'JetBrains Mono', 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; background: var(--code-bg); color: var(--teal); padding: 1px 5px; border-radius: 3px; }
  pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 12px; line-height: 1.5; }
  pre code { background: transparent; padding: 0; color: var(--muted); }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 12px; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
  th { background: var(--bg-deeper); color: var(--muted); font-weight: 700; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--dim); }
`

const EVENT_FILTERS: Partial<Record<AgentRole, Set<string>>> = {
  cd: new Set([
    'cd_snackbar', 'cd_ask_user',
    'discovery_questions', 'confirm_understanding',
    'design_directions', 'descent_selection',
    'image_strategy', 'design_system',
    'todos_updated', 'critique_submitted',
  ]),
  webdev: new Set([
    'build_started', 'build_progress',
    'vibe_built', 'vibe_failed', 'build_failed',
    'director_save', 'apply_patch_complete',
    'screenshot_taken',
  ]),
  sentinel: new Set(['critique_submitted', 'screenshot_taken']),
  'jedi-code': new Set(['notify_agent_sent', 'apply_patch_complete']),
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function listSessionIds(): Promise<string[]> {
  try {
    const entries = await readdir(PUBLIC_DIR, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map((e) => e.name)
  } catch (err) {
    console.error('[admin/agents] failed to list sessions:', err)
    return []
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = (searchParams.get('action') || 'catalog').trim()
  const id = (searchParams.get('id') || '').trim()

  // ── CATALOG (default — no params) ─────────────────────────
  if (action === 'catalog') {
    const agents = AGENTS.map((a) => ({
      ...a,
      exists: existsSync(join(AGENTS_DIR, a.file)),
    }))
    return NextResponse.json({ agents })
  }

  // All other actions need a valid id.
  const agent = findAgentById(id)
  if (!agent) {
    return NextResponse.json({ error: `unknown agent: ${id}` }, { status: 404 })
  }
  const fullPath = join(AGENTS_DIR, agent.file)

  // ── RAW .md ───────────────────────────────────────────────
  if (action === 'raw') {
    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: `file missing: ${agent.file}` }, { status: 404 })
    }
    try {
      const content = readFileSync(fullPath, 'utf-8')
      return new NextResponse(content, {
        status: 200,
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
      })
    } catch (err) {
      console.error('[admin/agents] raw read failed:', err)
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── PREVIEW (rendered HTML for iframe) ────────────────────
  if (action === 'preview') {
    if (!existsSync(fullPath)) {
      return new NextResponse(`file missing: ${escapeHtml(agent.file)}`, { status: 404 })
    }
    try {
      const md = readFileSync(fullPath, 'utf-8')
      const html = await marked.parse(md, { gfm: true, breaks: false })
      const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(agent.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>${html}</body>
</html>`
      return new NextResponse(page, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    } catch (err) {
      console.error('[admin/agents] preview render failed:', err)
      return new NextResponse('render failed: ' + String(err), { status: 500 })
    }
  }

  // ── MESSAGES (live inbox + bus events) ────────────────────
  if (action === 'messages') {
    if (!agent.inboxRole) {
      return NextResponse.json({
        id: agent.id,
        name: agent.name,
        inboxRole: null,
        liveInstances: 0,
        pendingTotal: 0,
        sessionsActive: 0,
        sessionsList: [],
        orphans: [],
        recent: [],
        events: [],
        fetchedAt: new Date().toISOString(),
      })
    }

    const role = agent.inboxRole
    const sessionIds = await listSessionIds()
    const eventKinds = EVENT_FILTERS[role] || new Set()

    let liveInstances = 0
    let pendingTotal = 0
    const sessionsActive: string[] = []
    const orphans: any[] = []
    const recent: any[] = []
    const events: any[] = []

    for (const sessionId of sessionIds) {
      const live = liveInstancesOf(sessionId, role).length
      const pending = pendingCount(sessionId, role)
      liveInstances += live
      pendingTotal += pending
      if (live > 0 || pending > 0) sessionsActive.push(sessionId)

      const sessionOrphans = pendingOrphansFor(sessionId, role)
      for (const o of sessionOrphans) {
        orphans.push({
          sessionId,
          messageId: o.id,
          threadId: o.threadId,
          from: o.from,
          fromInstance: o.fromInstance,
          message: o.message,
          priority: o.priority,
          sentAt: o.sentAt,
        })
      }

      const evs = replayRecent(sessionId)
      for (const ev of evs as any[]) {
        if (ev.type === 'agent_inbox_message') {
          const targetRole = ev.targetRole as AgentRole | undefined
          const fromRole = ev.from as AgentRole | undefined
          const isInbound = targetRole === role
          const isOutbound = fromRole === role
          if (!isInbound && !isOutbound) continue
          recent.push({
            sessionId,
            ts: ev.ts,
            messageId: ev.messageId,
            threadId: ev.threadId,
            from: ev.from,
            fromInstance: ev.fromInstance,
            targetRole: ev.targetRole,
            message: ev.message,
            priority: ev.priority,
            direction: isInbound ? 'inbound' : 'outbound',
          })
        } else if (eventKinds.has(ev.type)) {
          events.push({ sessionId, ...ev })
        }
      }
    }

    recent.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    events.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))

    return NextResponse.json({
      id: agent.id,
      name: agent.name,
      inboxRole: role,
      liveInstances,
      pendingTotal,
      sessionsActive: sessionsActive.length,
      sessionsList: sessionsActive,
      orphans: orphans.slice(0, 20),
      recent: recent.slice(0, 30),
      events: events.slice(0, 30),
      fetchedAt: new Date().toISOString(),
    })
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
}
