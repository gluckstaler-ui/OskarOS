/**
 * /api/mcp/present-design-directions — WP-74 (Ralph 2026-05-10).
 *
 * CD calls `present_design_directions(slug, directions[], prompt?)`
 * to show 6 candidate design directions at the end of Phase 1 Discovery.
 * User picks up to 4 (cap locked 2026-05-18, code-side fix 2026-05-20 —
 * see INSTITUTIONAL-MEMORY.md "design-directions cap drift"); response
 * arrives as a user message with
 * { picks: string[], freeformText: string }.
 *
 * Doctrine: Design Directions are TRACK-AGNOSTIC. Never re-introduce a
 * `track` field here — see INSTITUTIONAL-MEMORY.md "Doctrine drift: track
 * grafted onto tc_design_directions (2nd time)" 2026-05-14. The card
 * closes Discovery before the track has been committed; the track lives
 * on the Confirm Understanding card, not here.
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
    directions?: unknown[]
    prompt?: unknown
    preamble?: unknown
  } | null

  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!Array.isArray(body.directions) || body.directions.length === 0) {
    return NextResponse.json({ ok: false, error: 'directions must be a non-empty array' }, { status: 400 })
  }

  const directions = body.directions.map((d: unknown) => {
    const dir = (d && typeof d === 'object') ? d as Record<string, unknown> : {}

    // Palette — accept either the new {hex, role}[] shape or the legacy hex[]
    // shape (back-compat for any caller still passing flat hex strings).
    // Legacy shape gets a synthesized role label so the renderer never breaks.
    const rawPalette = Array.isArray(dir.palette) ? dir.palette : []
    const palette = rawPalette.slice(0, 4).map((p, i) => {
      if (p && typeof p === 'object') {
        const sw = p as Record<string, unknown>
        return {
          hex: typeof sw.hex === 'string' ? sw.hex : '#333',
          role: typeof sw.role === 'string' ? sw.role : `Swatch ${i + 1}`,
        }
      }
      // legacy: flat hex string
      return { hex: typeof p === 'string' ? p : '#333', role: `Swatch ${i + 1}` }
    })
    while (palette.length < 4) palette.push({ hex: '#333', role: `Swatch ${palette.length + 1}` })

    // Axis — Convention↔Disruption spectrum with 0..1 marker.
    const rawAxis = (dir.axis_linear && typeof dir.axis_linear === 'object')
      ? dir.axis_linear as Record<string, unknown> : {}
    const rawPoles = Array.isArray(rawAxis.poles) ? rawAxis.poles : ['Convention', 'Disruption']
    const poles: [string, string] = [
      String(rawPoles[0] ?? 'Convention'),
      String(rawPoles[1] ?? 'Disruption'),
    ]
    const rawPos = typeof rawAxis.position === 'number' ? rawAxis.position : 0.5
    const position = Math.max(0, Math.min(1, rawPos))

    // Fonts — {display, display_label, body, body_label}.
    const rawFonts = (dir.fonts && typeof dir.fonts === 'object')
      ? dir.fonts as Record<string, unknown> : {}
    const fonts = {
      display: String(rawFonts.display ?? 'system-ui'),
      display_label: String(rawFonts.display_label ?? rawFonts.display ?? 'System'),
      body: String(rawFonts.body ?? 'system-ui'),
      body_label: String(rawFonts.body_label ?? rawFonts.body ?? 'System'),
    }

    return {
      slug: String(dir.slug || ''),
      filename: String(dir.filename || ''),
      bet_name: String(dir.bet_name || ''),
      bet_audience: String(dir.bet_audience || ''),
      axis_linear: { poles, position },
      axis_hook: String(dir.axis_hook || ''),
      the_bet: String(dir.the_bet || ''),
      mutex: String(dir.mutex || ''),
      palette: palette as [
        { hex: string; role: string },
        { hex: string; role: string },
        { hex: string; role: string },
        { hex: string; role: string },
      ],
      fonts,
    }
  })

  publish(body.sessionId, {
    type: 'design_directions',
    directions,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    preamble: parsePreamble(body.preamble),
  })

  return NextResponse.json({ ok: true, directionCount: directions.length })
}
