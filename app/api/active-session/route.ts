/**
 * /api/active-session — sidecar pointer for the MCP stdio proxy.
 *
 * Problem (Ralph + JC, 2026-05-06): `.mcp.json` hardcodes OSKAR_SESSION
 * as an env var. env vars are spawn-time only — when the user switches
 * sessions in the app or renames a session directory, the MCP proxy
 * subprocess Claude Code spawned at startup is stranded on the old id.
 * Inbox messages route to a phantom session; cross-agent comms break.
 *
 * Fix (Option A): the app keeps a sidecar file `.runtime/active-session`
 * with the currently-active session id. Frontend POSTs here every time
 * the sessionId state changes; this route writes the file. The MCP
 * proxy reads the file before each MCP message and rebuilds its
 * orchestrator URL with the fresh id (and re-handshakes when it changes).
 *
 * No Claude Code restart needed for session switches. The env-var
 * `OSKAR_SESSION` in `.mcp.json` becomes a fallback default for the
 * "first read before the file exists" boot case only.
 *
 * Long-term: Option C — generate a stable UUID per session, store in
 * SESSION.md frontmatter, route the bus on UUID instead of directory
 * name. Survives renames at the bus layer too. Deferred to WP-1's
 * substrate work; tracked in FEATURE-X.md §10.1.
 */

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSidecarPath(): string {
  // Project root is `process.cwd()` under `next dev`. The sidecar lives at
  // `<root>/.runtime/active-session` — same directory the proxy reads from.
  return path.join(process.cwd(), '.runtime', 'active-session')
}

async function ensureRuntimeDir(): Promise<void> {
  const dir = path.dirname(getSidecarPath())
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    // Directory exists or cannot be created — write attempt below will surface either way.
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const sessionId = (await fs.readFile(getSidecarPath(), 'utf-8')).trim()
    return NextResponse.json(
      { sessionId },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    // File missing on first run — return null so the proxy uses its env fallback.
    return NextResponse.json({ sessionId: null }, { headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { sessionId?: string } | null
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: 'sessionId (non-empty string) required' },
      { status: 400 },
    )
  }
  // Lightweight format check — session ids are dir names like `2026-01-27-debug`,
  // never absolute paths or contain slashes. Block path-traversal upfront.
  if (sessionId.includes('/') || sessionId.includes('..') || sessionId.includes('\0')) {
    return NextResponse.json({ ok: false, error: 'invalid sessionId format' }, { status: 400 })
  }

  await ensureRuntimeDir()
  try {
    await fs.writeFile(getSidecarPath(), sessionId + '\n', 'utf-8')
    return NextResponse.json({ ok: true, sessionId })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'write failed' },
      { status: 500 },
    )
  }
}
