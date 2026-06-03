/**
 * /api/mcp/present-image-strategy — WP-70 + WP-71 (Ralph 2026-05-10).
 *
 * The CD agent calls `present_image_strategy(slug, vibeSlug, vibeName,
 * layout, phaseLabel, slots[])` via MCP to show the user a complete image
 * plan for one vibe. Publishes an `image_strategy` event-bus event;
 * page.tsx renders <ImageStrategyCard>. User response arrives as a normal
 * user message with { action, generatedSlotName?, freeformText }.
 *
 * Mirrors /api/mcp/ask-discovery-questions/route.ts shape.
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
    vibeSlug?: string
    vibeName?: string
    layout?: string
    phaseLabel?: string
    slots?: unknown[]
    preamble?: unknown
  } | null

  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!body.vibeSlug || !body.vibeName) {
    return NextResponse.json({ ok: false, error: 'vibeSlug and vibeName required' }, { status: 400 })
  }
  if (!body.layout || !['webpage-vertical', 'keynote-multi-row'].includes(body.layout)) {
    return NextResponse.json({ ok: false, error: 'layout must be webpage-vertical or keynote-multi-row' }, { status: 400 })
  }
  if (!Array.isArray(body.slots) || body.slots.length === 0) {
    return NextResponse.json({ ok: false, error: 'slots must be a non-empty array' }, { status: 400 })
  }

  const slots = body.slots.map((s: unknown) => {
    const slot = (s && typeof s === 'object') ? s as Record<string, unknown> : {}
    return {
      slotName: String(slot.slotName || ''),
      slotKind: String(slot.slotKind || ''),
      aspectRatio: String(slot.aspectRatio || ''),
      state: ['assigned', 'generate', 'optional-empty'].includes(String(slot.state))
        ? String(slot.state) as 'assigned' | 'generate' | 'optional-empty'
        : 'generate',
      filename: typeof slot.filename === 'string' ? slot.filename : undefined,
      promptPreview: typeof slot.promptPreview === 'string' ? slot.promptPreview : undefined,
      promptId: typeof slot.promptId === 'string' ? slot.promptId : undefined,
    }
  })

  publish(body.sessionId, {
    type: 'image_strategy',
    vibeSlug: body.vibeSlug,
    vibeName: body.vibeName,
    layout: body.layout as 'webpage-vertical' | 'keynote-multi-row',
    phaseLabel: body.phaseLabel || '',
    slots,
    preamble: parsePreamble(body.preamble),
  })

  return NextResponse.json({ ok: true, slotCount: slots.length })
}
