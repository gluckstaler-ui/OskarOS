/**
 * /api/mcp/confirm-understanding — Phase 2 (Ralph 2026-05-04).
 *
 * The CD agent calls `confirm_understanding(summary, ...)` once per
 * Discovery to surface what's been gathered. The card renders ALL 9
 * Discovery fields as inline-editable inputs; the build CTA at the
 * bottom is gated on completeness — disabled until all 9 are populated,
 * enabled when full → click fires the wireframe build.
 *
 * `readyToGenerate` was a two-state branching field that controlled
 * READY vs CHECK-IN rendering. Unified 2026-05-15 (Ralph): the field is
 * accepted for back-compat but no longer branches behavior — the
 * component derives readiness from inline-input state instead.
 *
 * Mirrors /api/mcp/snackbar/route.ts shape.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'
import { parsePreamble } from '@/lib/preamble'
import type { ConversionMechanism } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ConfirmBody {
  sessionId?: string
  summary?: unknown
  readyToGenerate?: unknown
  preamble?: unknown
  distillation?: unknown
  conversion?: unknown
  weirdDetail?: unknown
  signatureMoment?: unknown
  discoveryProgress?: unknown
  stillNeed?: unknown
  phaseLabel?: unknown
}

const VALID_MECHANISMS: ConversionMechanism[] = ['PHONE', 'FORM', 'BOOK', 'SHOP']

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ConfirmBody | null
  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (typeof body.summary !== 'string' || body.summary.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: 'summary must be a non-empty string' },
      { status: 400 },
    )
  }
  // readyToGenerate accepted for back-compat (Ralph 2026-05-15 unified the
  // two-state card into one). Coerces strings 'true'/'false' to bool,
  // defaults to false when absent. No longer required, no longer branches
  // behavior — the component derives readiness from inline-input state.
  let readyToGenerate = false
  if (typeof body.readyToGenerate === 'boolean') {
    readyToGenerate = body.readyToGenerate
  } else if (body.readyToGenerate === 'true') {
    readyToGenerate = true
  } else if (body.readyToGenerate === 'false') {
    readyToGenerate = false
  }

  // Ralph 2026-05-14: defense-in-depth for transport coercion. Some MCP
  // harnesses deliver object args as JSON-encoded STRINGS instead of native
  // objects (depends on JSON Schema coercion behavior). The dispatcher
  // already coerces, but a stale MCP server process can bypass it — so the
  // route parses too. If a field looks like a JSON object/array string,
  // we parse it; native objects pass through unchanged.
  const coerceField = (raw: unknown): unknown => {
    if (raw === null || raw === undefined) return raw
    if (typeof raw === 'object') return raw
    if (typeof raw === 'string') {
      const s = raw.trim()
      if (s.startsWith('{') || s.startsWith('[')) {
        try { return JSON.parse(s) } catch { return raw }
      }
    }
    return raw
  }
  body.preamble = coerceField(body.preamble)
  body.distillation = coerceField(body.distillation)
  body.conversion = coerceField(body.conversion)
  body.discoveryProgress = coerceField(body.discoveryProgress)
  body.stillNeed = coerceField(body.stillNeed)

  // Ralph 2026-05-14: 6-chip distillation per mockup §3.5.
  // Old 4-chip names (where/who/tone) are accepted as aliases for backward
  // compatibility with in-flight CD calls, then mapped to the new names
  // (location/whoWeAre/voice). New names take precedence on conflict.
  const distillation =
    body.distillation && typeof body.distillation === 'object'
      ? (() => {
          const d = body.distillation as Record<string, unknown>
          const get = (k: string) =>
            typeof d[k] === 'string' && (d[k] as string).trim() ? (d[k] as string).trim() : undefined
          const out: Record<string, string> = {}
          // New canonical keys first; old aliases supply fallback.
          const business = get('business')
          const location = get('location') ?? get('where')
          const whoWeAre = get('whoWeAre') ?? get('who')
          const howItWorks = get('howItWorks')
          const customers = get('customers')
          const voice = get('voice') ?? get('tone')
          if (business) out.business = business
          if (location) out.location = location
          if (whoWeAre) out.whoWeAre = whoWeAre
          if (howItWorks) out.howItWorks = howItWorks
          if (customers) out.customers = customers
          if (voice) out.voice = voice
          return Object.keys(out).length > 0 ? out : undefined
        })()
      : undefined

  const conversion =
    body.conversion && typeof body.conversion === 'object'
      ? (() => {
          const c = body.conversion as { mechanisms?: unknown; pricing?: unknown }
          const mechanisms = Array.isArray(c.mechanisms)
            ? (c.mechanisms as unknown[])
                .map((m) => String(m ?? '').trim().toUpperCase())
                .filter((m): m is ConversionMechanism =>
                  (VALID_MECHANISMS as string[]).includes(m),
                )
            : undefined
          const pricing =
            typeof c.pricing === 'string' && c.pricing.trim() ? c.pricing.trim() : undefined
          if ((!mechanisms || mechanisms.length === 0) && !pricing) return undefined
          return {
            mechanisms: mechanisms && mechanisms.length > 0 ? mechanisms : undefined,
            pricing,
          }
        })()
      : undefined

  const weirdDetail =
    typeof body.weirdDetail === 'string' ? body.weirdDetail.trim() || undefined : undefined

  const signatureMoment =
    typeof body.signatureMoment === 'string'
      ? body.signatureMoment.trim() || undefined
      : undefined

  const discoveryProgress =
    body.discoveryProgress && typeof body.discoveryProgress === 'object'
      ? (() => {
          const dp = body.discoveryProgress as Record<string, unknown>
          if (typeof dp.done === 'number' && typeof dp.total === 'number') {
            return { done: Math.max(0, Math.floor(dp.done)), total: Math.max(1, Math.floor(dp.total)) }
          }
          return undefined
        })()
      : undefined

  const stillNeed = Array.isArray(body.stillNeed)
    ? (body.stillNeed as unknown[])
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim())
    : undefined

  const preamble = parsePreamble(body.preamble)

  publish(body.sessionId, {
    type: 'confirm_understanding',
    summary: body.summary,
    readyToGenerate,
    preamble,
    distillation,
    conversion,
    weirdDetail,
    signatureMoment,
    discoveryProgress,
    stillNeed: stillNeed && stillNeed.length > 0 ? stillNeed : undefined,
    phaseLabel: typeof body.phaseLabel === 'string' ? body.phaseLabel.trim() || undefined : undefined,
  } as Parameters<typeof publish>[1])

  return NextResponse.json({ ok: true, readyToGenerate })
}
