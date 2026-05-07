/**
 * GET/POST /api/sessions/[id]/config
 *
 * Owns the session-scoped runtime config (Ralph 2026-05-04). The TopBar
 * pills POST here on every toggle, and `page.tsx` GETs on initial mount
 * to rehydrate. MCP build routes read the file directly via
 * `lib/session-config.ts` (they don't go through this endpoint).
 *
 * Cache-Control: no-store. The toggle has to feel instant; a stale read
 * would defeat the UX Ralph asked for.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  readSessionConfig,
  writeSessionConfig,
  DEFAULT_SESSION_CONFIG,
  type SessionConfig,
} from '@/lib/session-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400, headers: NO_CACHE })
    }
    const config = readSessionConfig(sessionId)
    return NextResponse.json(config, { headers: NO_CACHE })
  } catch (err) {
    console.error('[/api/sessions/[id]/config] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to read session config', ...DEFAULT_SESSION_CONFIG },
      { status: 500, headers: NO_CACHE },
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400, headers: NO_CACHE })
    }
    const body = (await req.json().catch(() => null)) as Partial<SessionConfig> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a partial SessionConfig object' }, { status: 400, headers: NO_CACHE })
    }
    // Strip unknown fields to avoid persisting noise. Allowed keys mirror
    // SessionConfig (minus updatedAt — we always overwrite that).
    const allowed: Partial<SessionConfig> = {}
    if (body.webDevModel !== undefined) allowed.webDevModel = body.webDevModel
    if (body.webDevMode !== undefined) allowed.webDevMode = body.webDevMode
    if (body.cdModel !== undefined) allowed.cdModel = body.cdModel
    if (body.billingMode !== undefined) allowed.billingMode = body.billingMode

    const updated = writeSessionConfig(sessionId, allowed)
    return NextResponse.json(updated, { headers: NO_CACHE })
  } catch (err) {
    console.error('[/api/sessions/[id]/config] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to write session config' },
      { status: 500, headers: NO_CACHE },
    )
  }
}
