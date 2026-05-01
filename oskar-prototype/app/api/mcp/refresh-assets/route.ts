/**
 * /api/mcp/refresh-assets — MCP-tool endpoint for `refresh_assets()`.
 *
 * Replaces the `## UPDATE ASSETS` magic word. Emits an `assets_updated`
 * event so the frontend re-reads IMAGES.md.
 *
 * Bug 16 fix (Ralph 2026-04-30): the previous response was always
 * "Assets panel refresh signal sent" regardless of whether anything
 * actually changed. Echo {parsedAt, entryCount} so the agent can verify
 * the refresh landed and reason about the catalog state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'
import { parseImagesMd } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { sessionId } = (await req.json()) as { sessionId?: string }
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  publish(sessionId, { type: 'assets_updated', reason: 'refresh_assets' })

  let entryCount = 0
  try {
    const parsed = await parseImagesMd(sessionId)
    entryCount = parsed.size
  } catch {
    // Empty session or no IMAGES.md — leave count at 0.
  }

  return NextResponse.json({
    ok: true,
    parsedAt: new Date().toISOString(),
    entryCount,
  })
}
