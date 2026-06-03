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
  // Ralph + CD 2026-05-06: Archetype 1 — build_vibe / build_wireframes
  // job card. ONE card kind ('build'); the rows[].state field carries
  // the build_progress / build_complete / build_failed lifecycle so
  // separate kinds aren't needed.
  'build',
  // WP-74 / WP-77 (Ralph 2026-05-10): Phase-2 toolcards. Tool's preview_card
  // schema (mcp-server/tools-cd.ts:572-574) lists both — the route gate
  // mirrors the enum so previews don't silently no-op with "unknown kind".
  'design_directions',
  'design_system',
  // Ralph 2026-05-14: Phase-3 + Phase-4→5 toolcards. CD's preview_card
  // schema covers all 5 tc_* toolcard types now.
  'descent_selection',
  'image_strategy',
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
      // Ralph 2026-05-12 — schema widened. Each entry is either a bare
      // string (text input) or a typed `DiscoveryQuestion` object with
      // `kind` ∈ {text, textarea, radio, checkbox, select}. The pre-2026-05-12
      // gate rejected anything that wasn't a string and pointed agents at
      // `["..."]`; that error message is now obsolete. New gate: accept
      // strings; accept objects that carry a recognised `kind` + non-empty
      // `prompt`; for radio/checkbox/select, require `options[]` non-empty.
      // Renderer also has defensive coerce so a slightly malformed object
      // still surfaces something — but the gate rejects loudly to give
      // the agent a clear retry signal.
      for (let i = 0; i < payload.questions.length; i++) {
        const q = payload.questions[i]
        if (typeof q === 'string') {
          if (!q.trim()) return `\`payload.questions[${i}]\` is an empty string`
          continue
        }
        if (!q || typeof q !== 'object') {
          return `\`payload.questions[${i}]\` must be a string or {kind, prompt, ...} object`
        }
        const qo = q as Record<string, unknown>
        const kind = String(qo.kind ?? 'text').toLowerCase()
        if (!['text', 'textarea', 'radio', 'checkbox', 'select'].includes(kind)) {
          return `\`payload.questions[${i}].kind\` must be one of: text, textarea, radio, checkbox, select (got "${qo.kind}")`
        }
        const promptRaw = qo.prompt ?? qo.question ?? qo.q ?? qo.text ?? qo.label
        if (typeof promptRaw !== 'string' || !promptRaw.trim()) {
          return `\`payload.questions[${i}].prompt\` (non-empty string) required`
        }
        if (['radio', 'checkbox', 'select'].includes(kind)) {
          if (!Array.isArray(qo.options) || qo.options.length === 0) {
            return `\`payload.questions[${i}].options\` (non-empty array) required for kind="${kind}"`
          }
        }
      }
      return null
    case 'confirm_understanding':
      // Ralph 2026-05-15 — unified single-state card. `readyToGenerate`
      // accepted for back-compat but no longer required (the component
      // derives readiness from inline-input state, not the prop).
      // Structured fields (distillation/weirdDetail/discoveryProgress/
      // stillNeed/phaseLabel) are optional; the card renders chrome
      // regardless and falls back to the prose summary when chips
      // are absent.
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
      // Ralph 2026-05-12 — field-name alignment. Live `screenshot_taken`
      // event handler (page.tsx ~1446) constructs the card with
      // `savedPath`, not `path`. Preview must require the same field name
      // or the card receives undefined `savedPath` and renders broken.
      // Also require dims so the card-head meta doesn't crash on
      // `dims.width`. Card component now defaults to {1280, 800} as a
      // belt-and-suspenders fallback.
      if (typeof payload.savedPath !== 'string' || !payload.savedPath.trim()) {
        return '`payload.savedPath` (image path string) required — note: field is `savedPath`, not `path`'
      }
      if (typeof payload.target !== 'string' || !payload.target.trim()) {
        return '`payload.target` (vibe/page identifier) required'
      }
      if (payload.frame !== 'desktop' && payload.frame !== 'tablet' && payload.frame !== 'mobile') {
        return '`payload.frame` must be one of: desktop, tablet, mobile'
      }
      if (!payload.dims || typeof payload.dims !== 'object') {
        return '`payload.dims` ({ width: number, height: number }) required'
      }
      return null
    case 'apply_patch':
      // Ralph 2026-05-12 — field-name alignment + completeness. The live
      // `apply_patch_complete` event handler (page.tsx ~1490) constructs
      // the card with `filename` + `diff` + editKind + anchor + affected.
      // Preview was previously gating `payload.file` (wrong name) and
      // skipping `diff` entirely — so the card landed with `diff: undefined`
      // and crashed at `diff.split('\n')`. Card now defaults defensively
      // as a fallback, but the gate is the right place to reject loudly.
      if (typeof payload.filename !== 'string' || !payload.filename.trim()) {
        return '`payload.filename` (string) required — note: field is `filename`, not `file`'
      }
      if (typeof payload.diff !== 'string' || !payload.diff.trim()) {
        return '`payload.diff` (unified diff string) required'
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
    case 'design_directions':
      // Doctrine: Design Directions are TRACK-AGNOSTIC. Never re-add a
      // `track` validator here — see INSTITUTIONAL-MEMORY.md 2026-05-14.
      //
      // Schema replaced 2026-05-21 to match docs/tc-design-directions-mockup.html.
      // Per-direction fields: slug, filename, bet_name, bet_audience,
      // axis_linear {poles, position}, axis_hook, the_bet, mutex,
      // palette [{hex, role}×4], fonts {display, display_label, body, body_label}.
      if (!Array.isArray(payload.directions) || payload.directions.length === 0) {
        return '`payload.directions` must be a non-empty array of strategic-bet objects'
      }
      for (let i = 0; i < payload.directions.length; i++) {
        const d = payload.directions[i]
        if (!d || typeof d !== 'object') {
          return `\`payload.directions[${i}]\` must be an object`
        }
        const dir = d as Record<string, unknown>
        if (typeof dir.slug !== 'string' || !dir.slug.trim()) {
          return `\`payload.directions[${i}].slug\` (non-empty string) required; React keys depend on it`
        }
        if (typeof dir.bet_name !== 'string' || !dir.bet_name.trim()) {
          return `\`payload.directions[${i}].bet_name\` (non-empty string) required`
        }
      }
      return null
    case 'design_system':
      if (!Array.isArray(payload.vibes) || payload.vibes.length === 0) {
        return '`payload.vibes` must be a non-empty array of {vibeSlug, label, system: {...}} objects'
      }
      // Light per-vibe shape gate — full DesignSystemVibe lives in lib/types.ts.
      for (const v of payload.vibes as Array<Record<string, unknown>>) {
        if (typeof v.vibeSlug !== 'string' || typeof v.label !== 'string' || !v.system || typeof v.system !== 'object') {
          return 'each vibe needs at least {vibeSlug: string, label: string, system: {...}}'
        }
      }
      return null
    case 'descent_selection':
      // Ralph 2026-05-14 — minimum shape gate. Full DescentSelectionPayload
      // lives in lib/types.ts; vibes need slug+name+heroImage at minimum
      // (palette/displayFont/tagline are optional cosmetic adds).
      if (typeof payload.slug !== 'string' || !payload.slug.trim()) {
        return '`payload.slug` (non-empty string) required'
      }
      if (typeof payload.cap !== 'number' || payload.cap < 1) {
        return '`payload.cap` (integer ≥1) required — radio if cap=1, multi-select if cap>1'
      }
      if (typeof payload.ctaLabel !== 'string' || !payload.ctaLabel.trim()) {
        return '`payload.ctaLabel` (non-empty string) required'
      }
      if (!Array.isArray(payload.vibes) || payload.vibes.length === 0) {
        return '`payload.vibes` must be a non-empty array of {slug, name, heroImage} objects'
      }
      for (let i = 0; i < (payload.vibes as unknown[]).length; i++) {
        const v = (payload.vibes as unknown[])[i] as Record<string, unknown>
        if (typeof v?.slug !== 'string' || typeof v?.name !== 'string' || typeof v?.heroImage !== 'string') {
          return `\`payload.vibes[${i}]\` needs at least {slug, name, heroImage}`
        }
      }
      return null
    case 'image_strategy':
      // Ralph 2026-05-14 — Phase-3 / Phase-4→5 image plan card.
      if (typeof payload.vibeSlug !== 'string' || !payload.vibeSlug.trim()) {
        return '`payload.vibeSlug` (non-empty string) required'
      }
      if (typeof payload.vibeName !== 'string' || !payload.vibeName.trim()) {
        return '`payload.vibeName` (non-empty string) required'
      }
      if (payload.layout !== 'webpage-vertical' && payload.layout !== 'keynote-multi-row') {
        return '`payload.layout` must be one of: webpage-vertical, keynote-multi-row'
      }
      if (!Array.isArray(payload.slots) || payload.slots.length === 0) {
        return '`payload.slots` must be a non-empty array of {slotName, slotKind, aspectRatio, state} objects'
      }
      for (let i = 0; i < (payload.slots as unknown[]).length; i++) {
        const s = (payload.slots as unknown[])[i] as Record<string, unknown>
        if (typeof s?.slotName !== 'string' || typeof s?.slotKind !== 'string' || typeof s?.aspectRatio !== 'string') {
          return `\`payload.slots[${i}]\` needs {slotName, slotKind, aspectRatio}`
        }
        if (s.state !== 'assigned' && s.state !== 'generate' && s.state !== 'optional-empty') {
          return `\`payload.slots[${i}].state\` must be one of: assigned, generate, optional-empty`
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
