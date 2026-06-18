// ============================================================================
// app/api/admin/crm/raw-prospects/[id]/route.ts — PATCH a single pool row.
//
// Ralph 2026-06-03 — every field in the Scout dossier is editable. The user
// fixes typos in the imported lead (wrong website, missing phone), overrides
// the queried lamps when DNS/Wayback returned junk, or rewrites the verdict
// prose / palate / execution sliders by hand.
//
//   PATCH /api/admin/crm/raw-prospects/<id>
//     body: {
//       // identity (top-line) — any subset
//       name?, company?, phone?, email?, website?, country?, industry?,
//       // scout_json patch — RAW JSON STRING (caller composes the merge)
//       scout_json?: string,
//     }
//
// Two layers of safety:
//   1. The route ALLOWS only the edit-safe fields above. promote/reject
//      stamps and scraped_at/source/raw_payload are read-only here — those
//      flow through the dedicated routes (/promote, /reject) or the ingest.
//   2. The body's `scout_json`, if present, is parsed-validated as JSON
//      before persisting. A malformed blob would corrupt every downstream
//      `JSON.parse(scout_json)` in the UI. Reject 400 on parse failure.
//
// No idempotency dance: a PATCH with the same body twice is the same write.
// readRawProspect → 404 if missing; otherwise patchRawProspect drives the
// merge (the helper's SQL is `INSERT OR REPLACE` so the patch is whole-row).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { readRawProspect, patchRawProspect, type RawProspect } from '@/lib/crm-store'

export const dynamic = 'force-dynamic'

/** Fields the user can edit from the Scout dossier. */
const EDITABLE_FIELDS = ['name', 'company', 'phone', 'email', 'website', 'country', 'industry'] as const
type EditableField = typeof EDITABLE_FIELDS[number]

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const raw = readRawProspect(id)
    if (!raw) return NextResponse.json({ error: 'pool row not found' }, { status: 404 })
    if (raw.promoted_at) return NextResponse.json({ error: 'cannot edit a promoted row' }, { status: 409 })
    if (raw.rejected_at) return NextResponse.json({ error: 'cannot edit a rejected row' }, { status: 409 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Partial<RawProspect> = {}

    // Identity fields — string-only, trimmed, untouched if absent in body.
    for (const f of EDITABLE_FIELDS) {
      const v = body[f]
      if (typeof v === 'string') {
        patch[f as EditableField] = v.trim()
      }
    }

    // scout_json: a complete replacement (the caller composed the merge).
    // Validate it parses or refuse — a corrupt blob breaks every UI consumer.
    if (typeof body.scout_json === 'string') {
      try {
        JSON.parse(body.scout_json)
      } catch {
        return NextResponse.json({ error: 'scout_json must be valid JSON' }, { status: 400 })
      }
      patch.scout_json = body.scout_json
    }

    // raw_payload: same pattern — the imported fields (bezirk / adresse /
    // typ / titel / quelle) live as JSON here. Editing the Region dropdown
    // in the dossier patches raw_payload.bezirk; caller does the merge,
    // route validates JSON shape and persists the full string.
    if (typeof body.raw_payload === 'string') {
      try {
        JSON.parse(body.raw_payload)
      } catch {
        return NextResponse.json({ error: 'raw_payload must be valid JSON' }, { status: 400 })
      }
      patch.raw_payload = body.raw_payload
    }

    // Ralph 2026-06-09 · the co-location "vermutlich" flag (raw_payload.website_probably)
    // is auto-cleared the moment the website is touched — a human edit (or, later,
    // a websearch confirm) IS the confirmation. Drop it from whatever raw_payload
    // we're about to persist.
    if (typeof patch.website === 'string') {
      let pl: Record<string, unknown>
      try { pl = JSON.parse((patch.raw_payload ?? raw.raw_payload) || '{}') } catch { pl = {} }
      if ('website_probably' in pl) {
        delete pl.website_probably
        patch.raw_payload = JSON.stringify(pl)
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'no editable fields in body' }, { status: 400 })
    }

    await patchRawProspect(id, patch)
    return NextResponse.json({ ok: true, patched: Object.keys(patch) })
  } catch (err) {
    console.error('[raw-prospects/PATCH] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
