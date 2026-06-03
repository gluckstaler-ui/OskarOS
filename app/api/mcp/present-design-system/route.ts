/**
 * /api/mcp/present-design-system — WP-77 (Ralph 2026-05-10).
 *
 * CD calls `present_design_system(slug, vibes[], prompt?)`
 * to present N candidate design systems for the user to pick one.
 * User selects a vibe or requests CREATE NEW; response arrives as
 * a user message with { action: 'select'|'create-new', selectedVibeSlug, freeformText }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    sessionId?: string
    slug?: string
    vibes?: unknown[]
    prompt?: unknown
  } | null

  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!Array.isArray(body.vibes) || body.vibes.length === 0) {
    return NextResponse.json({ ok: false, error: 'vibes must be a non-empty array' }, { status: 400 })
  }

  const vibes = body.vibes.map((v: unknown, i: number) => {
    const raw = (v && typeof v === 'object') ? v as Record<string, unknown> : {}
    const sys = (raw.system && typeof raw.system === 'object') ? raw.system as Record<string, unknown> : {}
    const pal = (sys.palette && typeof sys.palette === 'object') ? sys.palette as Record<string, unknown> : {}
    const typo = (sys.typography && typeof sys.typography === 'object') ? sys.typography as Record<string, unknown> : {}
    const btns = (sys.buttons && typeof sys.buttons === 'object') ? sys.buttons as Record<string, unknown> : {}

    return {
      vibeSlug: String(raw.vibeSlug || `vibe-${i + 1}`),
      label: String(raw.label || `Vibe ${i + 1}`),
      system: {
        displayName: String(sys.displayName || 'Untitled'),
        h2Sample: String(sys.h2Sample || 'Heading Sample'),
        bodySample: String(sys.bodySample || 'Body text sample for preview.'),
        palette: {
          bg: String(pal.bg || '#0a0a0a'),
          surface: String(pal.surface || '#1a1a1a'),
          primary: String(pal.primary || '#22c55e'),
          ink: String(pal.ink || '#e0e0e0'),
          accent: String(pal.accent || '#f59e0b'),
        },
        typography: {
          displayFont: String(typo.displayFont || 'System'),
          bodyFont: String(typo.bodyFont || 'System'),
          h1Caption: String(typo.h1Caption || 'Display font'),
          bodyCaption: String(typo.bodyCaption || 'Body font'),
        },
        buttons: {
          primaryLabel: String(btns.primaryLabel || 'Primary'),
          secondaryLabel: String(btns.secondaryLabel || 'Secondary'),
        },
        imageTreatment: String(sys.imageTreatment || 'Full-bleed hero, contained body images'),
        animationPosture: String(sys.animationPosture || 'Subtle fades, no motion sickness'),
      },
    }
  })

  publish(body.sessionId, {
    type: 'design_system',
    slug: typeof body.slug === 'string' ? body.slug : '',
    vibes,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
  })

  return NextResponse.json({ ok: true, vibeCount: vibes.length })
}
