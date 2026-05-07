/**
 * /api/mcp/confirm-understanding — Phase 2 (Ralph 2026-05-04).
 *
 * The CD agent calls `confirm_understanding(summary, readyToGenerate)`
 * right before recommending a build, summarizing direction. The MCP
 * server's tool handler POSTs here; this route publishes a
 * `confirm_understanding` event to the per-session event bus. The
 * frontend's /api/events SSE delivers it; <ConfirmUnderstandingCard>
 * renders the summary and (when readyToGenerate) a "Build it" button
 * that fires `build_all_vibes` via the existing trigger path.
 *
 * Mirrors /api/mcp/snackbar/route.ts shape.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { sessionId?: string; summary?: unknown; readyToGenerate?: unknown }
    | null
  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (typeof body.summary !== 'string' || body.summary.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: 'summary must be a non-empty string' },
      { status: 400 },
    )
  }
  // readyToGenerate is required by the schema but handle the bool coercion
  // defensively — agents occasionally pass strings 'true'/'false'.
  let readyToGenerate: boolean
  if (typeof body.readyToGenerate === 'boolean') {
    readyToGenerate = body.readyToGenerate
  } else if (body.readyToGenerate === 'true') {
    readyToGenerate = true
  } else if (body.readyToGenerate === 'false') {
    readyToGenerate = false
  } else {
    return NextResponse.json(
      { ok: false, error: 'readyToGenerate must be a boolean' },
      { status: 400 },
    )
  }

  publish(body.sessionId, {
    type: 'confirm_understanding',
    summary: body.summary,
    readyToGenerate,
  } as Parameters<typeof publish>[1])

  return NextResponse.json({ ok: true, readyToGenerate })
}
