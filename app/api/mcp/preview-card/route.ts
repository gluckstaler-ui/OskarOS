/**
 * /api/mcp/preview-card — on-demand card render (Ralph 2026-05-06).
 *
 * CD calls this via the MCP `preview_card` tool when the user asks to
 * "show me [a card]" so they get a visual instance instead of pasted
 * source code. Publishes a `card_preview` event; page.tsx subscribes and
 * pushes a synthetic assistant message with `card.__preview: true` so the
 * renderer can mark it as a sample (no real backend writes).
 *
 * Validates that `kind` is in the allowed enum. Payload is forwarded
 * loose — each card's component already has its own runtime guards.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mirror of the `card.kind` discriminator in lib/types.ts. Update both
// when adding a new card type — the validator here is the gate that
// prevents typos from silently no-op'ing the preview.
const ALLOWED_KINDS = new Set([
  'discovery_questions',
  'confirm_understanding',
  'upload_eval',
  'upload_eval_batch',
  'screenshot',
  'apply_patch',
  'diagnostic_chip',
  // Ralph + CD 2026-05-06: Archetype 1 — build_vibe / build_all_vibes
  // job card. ONE card kind ('build'); the rows[].state field carries
  // the build_progress / build_complete / build_failed lifecycle so
  // separate kinds aren't needed.
  'build',
])

interface PreviewCardBody {
  sessionId?: string
  kind?: string
  payload?: Record<string, unknown>
}

/**
 * Per-kind payload shape gate (Ralph + CD diagnosis 2026-05-06). The earlier
 * implementation forwarded `payload` opaquely; CD's preview_card calls with
 * missing fields rendered empty cards (silent no-op from the user's POV).
 * Each kind below declares its REQUIRED fields. Returns null when valid,
 * a string error otherwise (route turns it into a 400 with the message).
 *
 * Keep aligned with lib/types.ts AssistantCardPayload union shapes.
 */
function validatePerKindPayload(kind: string, payload: Record<string, unknown>): string | null {
  switch (kind) {
    case 'discovery_questions':
      if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
        return '`payload.questions` must be a non-empty array'
      }
      return null
    case 'confirm_understanding':
      if (typeof payload.summary !== 'string' || !payload.summary.trim()) {
        return '`payload.summary` (non-empty string) required'
      }
      return null
    case 'upload_eval':
      if (typeof payload.filename !== 'string' || typeof payload.verdict !== 'string') {
        return '`payload.filename` and `payload.verdict` required'
      }
      return null
    case 'upload_eval_batch':
      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        return '`payload.items` must be a non-empty array of {filename, path, verdict, note, status} objects (status ∈ STAR | B-ROLL | TRASH — INGESTED is system-only and not user-assignable in this card; CD directive 2026-05-06)'
      }
      return null
    case 'screenshot':
      if (typeof payload.path !== 'string' || !payload.path.trim()) {
        return '`payload.path` (image path string) required'
      }
      return null
    case 'apply_patch':
      if (typeof payload.file !== 'string') {
        return '`payload.file` (string) required'
      }
      return null
    case 'diagnostic_chip':
      if (typeof payload.label !== 'string' || !payload.label.trim()) {
        return '`payload.label` (non-empty string) required'
      }
      return null
    case 'build':
      if (typeof payload.title !== 'string' || !payload.title.trim()) {
        return '`payload.title` (non-empty string) required'
      }
      if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
        return '`payload.rows` must be a non-empty array of {id, label, state, ...} objects'
      }
      // Light per-row check — full BuildCardRow shape lives in lib/types.ts.
      for (const r of payload.rows as Array<Record<string, unknown>>) {
        if (typeof r.id !== 'string' || typeof r.label !== 'string' || typeof r.state !== 'string') {
          return 'each row needs at least {id: string, label: string, state: string}'
        }
      }
      return null
    default:
      return `unknown kind: ${kind}`
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as PreviewCardBody | null
  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!body.kind || !ALLOWED_KINDS.has(body.kind)) {
    return NextResponse.json(
      {
        ok: false,
        error: `kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`,
      },
      { status: 400 },
    )
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return NextResponse.json({ ok: false, error: 'payload object required' }, { status: 400 })
  }
  // Per-kind shape gate — clear error to the agent on malformed payload.
  const shapeError = validatePerKindPayload(body.kind, body.payload)
  if (shapeError) {
    return NextResponse.json(
      { ok: false, error: `preview_card kind=${body.kind}: ${shapeError}` },
      { status: 400 },
    )
  }

  publish(body.sessionId, {
    type: 'card_preview',
    kind: body.kind,
    payload: body.payload,
  } as Parameters<typeof publish>[1])

  return NextResponse.json({ ok: true, kind: body.kind })
}
