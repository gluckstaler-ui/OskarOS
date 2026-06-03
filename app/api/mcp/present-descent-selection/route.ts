/**
 * /api/mcp/present-descent-selection — WP-75 (Ralph 2026-05-10).
 *
 * CD calls `present_descent_selection(slug, cap, ctaLabel, vibes[], prompt?,
 * contextLabel?)` to show the user a vibe picker with a CD-specified cap
 * (1 = radio / final-pick; 2+ = multi-select with that maximum).
 *
 * Examples:
 *   - cap=1, ctaLabel="Ship This Vibe"        (Phase 4→5 final-pick)
 *   - cap=2, ctaLabel="Advance These 2"       (Phase 2→3 wireframe pick)
 *   - cap=3, ctaLabel="Narrow to Top 3"       (mid-funnel narrow from N→3)
 *   - cap=N for any other narrow CD wants
 *
 * User picks N vibes; response arrives as a normal user message routed
 * through send_user_input with { type: 'descent_selection', picks: string[] }.
 * Orchestrator-side response handler at mcp-server/tools-orchestrator.ts:856.
 *
 * Mirrors /api/mcp/present-design-directions/route.ts shape; same yellow
 * chassis but vibe items + variable cap.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'
import { parsePreamble } from '@/lib/preamble'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    sessionId?: string
    slug?: string
    cap?: number
    ctaLabel?: string
    contextLabel?: string
    vibes?: unknown[]
    prompt?: unknown
    preamble?: unknown
  } | null

  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!Array.isArray(body.vibes) || body.vibes.length === 0) {
    return NextResponse.json({ ok: false, error: 'vibes must be a non-empty array' }, { status: 400 })
  }
  if (body.vibes.length > 6) {
    return NextResponse.json({ ok: false, error: 'vibes capped at 6 candidates' }, { status: 400 })
  }
  const cap = typeof body.cap === 'number' ? Math.floor(body.cap) : NaN
  if (!Number.isFinite(cap) || cap < 1 || cap > body.vibes.length) {
    return NextResponse.json(
      { ok: false, error: `cap must be an integer between 1 and ${body.vibes.length}; got ${body.cap}` },
      { status: 400 },
    )
  }
  const ctaLabel = typeof body.ctaLabel === 'string' ? body.ctaLabel.trim() : ''
  if (!ctaLabel) {
    return NextResponse.json({ ok: false, error: 'ctaLabel is required' }, { status: 400 })
  }

  const vibes = body.vibes.map((v: unknown) => {
    const vibe = (v && typeof v === 'object') ? v as Record<string, unknown> : {}
    const palette = Array.isArray(vibe.palette)
      ? vibe.palette.slice(0, 3).map(String)
      : undefined
    return {
      slug: String(vibe.slug || ''),
      name: String(vibe.name || ''),
      heroImage: String(vibe.heroImage || ''),
      tagline: typeof vibe.tagline === 'string' ? vibe.tagline : undefined,
      palette: palette as [string, string, string] | undefined,
      displayFont: typeof vibe.displayFont === 'string' ? vibe.displayFont : undefined,
    }
  })

  publish(body.sessionId, {
    type: 'descent_selection',
    slug: body.slug || 'descent-pick',
    cap,
    ctaLabel,
    contextLabel: typeof body.contextLabel === 'string' ? body.contextLabel : undefined,
    vibes,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    preamble: parsePreamble(body.preamble),
  })

  return NextResponse.json({ ok: true, vibeCount: vibes.length })
}
