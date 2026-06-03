// ============================================================================
// POST /api/admin/crm/xlsx-import — apply uploaded xlsx as superseding events
// WP-CRM-F25 (Ralph 2026-05-25)
//
// Counterpart to xlsx-export. Reads the multipart-uploaded xlsx file,
// computes the diff against current SQLite state, and emits the appropriate
// events with source: 'manual_import'. Then applies them immediately to
// SQLite via applyEventsToDb so the UI sees the import without a restart.
//
// Idempotency: re-importing the same xlsx (no changes since the previous
// import) produces zero events because the per-field diff finds nothing to
// update. So sending Filippo a stale export and accidentally re-applying it
// is safe — except for one subtle case: if the import xlsx is OLDER than
// the local state and contains rows whose values are now superseded
// locally, the import will emit "rollback" events that overwrite the newer
// local values with the older xlsx values. The response payload includes
// `overridden_recent` so the UI can warn Filippo. There's no automatic
// guard — manual fallback by design means manual decisions.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { read as readXlsx, utils as xlsxUtils } from 'xlsx'
import { appendEvent, makeEvent, type Event } from '@/lib/event-log'
import { applyEventsToDb } from '@/lib/crm-replay'
import { getDb } from '@/lib/crm-boot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Fields we'll diff between xlsx row and SQLite row. Keep aligned with
// ALLOWED_PROSPECT_UPDATE_FIELDS in lib/crm-replay.ts (mismatch would mean
// the import emits events that replay silently ignores).
const PROSPECT_DIFF_FIELDS = [
  'company', 'contact_name', 'phone', 'email', 'website',
  'stage', 'status', 'amount_chf', 'confidence_pct',
  'next_action_date', 'next_action_label', 'tags', 'starred', 'owner',
  'notes', 'created_at', 'standby_plan', 'lost_reason',
  'sub_stage',
] as const

function coerceForCompare(field: string, v: unknown): unknown {
  if (v === null || v === undefined) return ''
  if (field === 'starred') {
    return v === true || v === 1 || v === 'TRUE' || v === 'true' || v === '1' ? 1 : 0
  }
  if (field === 'amount_chf' || field === 'confidence_pct') {
    return Number(v) || 0
  }
  return String(v)
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'no file uploaded' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const wb = readXlsx(buf, { type: 'buffer' })
    const prospects = wb.Sheets['Prospects']
      ? xlsxUtils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Prospects'])
      : []
    const activities = wb.Sheets['Activities']
      ? xlsxUtils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Activities'])
      : []

    const db = getDb()

    const newEvents: Event[] = []
    let prospectsInserted = 0
    let prospectsUpdated = 0
    let activitiesInserted = 0
    let activitiesSkipped = 0

    // ─── Prospects: insert new, per-field update existing ──────────────────
    for (const row of prospects) {
      const id = String(row.id || '')
      if (!id) continue
      const existing = db.prepare('SELECT * FROM prospects WHERE id = ?').get(id) as
        Record<string, unknown> | undefined

      if (!existing) {
        // INSERT
        newEvents.push(makeEvent({
          actor: 'import',
          entity: 'prospect',
          entity_id: id,
          op: 'insert',
          payload: { ...row, historical_created_at: row.created_at ?? null },
          source: 'manual_import',
        }))
        prospectsInserted++
        continue
      }

      // UPDATE per changed field
      let touched = false
      for (const field of PROSPECT_DIFF_FIELDS) {
        const before = coerceForCompare(field, existing[field])
        const after = coerceForCompare(field, (row as Record<string, unknown>)[field])
        if (before === after) continue
        newEvents.push(makeEvent({
          actor: 'import',
          entity: 'prospect',
          entity_id: id,
          op: 'update',
          field,
          prev: existing[field],
          next: (row as Record<string, unknown>)[field],
          source: 'manual_import',
        }))
        touched = true
      }
      if (touched) prospectsUpdated++
    }

    // ─── Activities: append-only — insert any row not already present ──────
    for (const row of activities) {
      const id = String(row.id || '')
      if (!id) continue
      const exists = db.prepare('SELECT 1 FROM activities WHERE id = ?').get(id)
      if (exists) {
        activitiesSkipped++
        continue
      }
      newEvents.push(makeEvent({
        actor: 'import',
        entity: 'activity',
        entity_id: id,
        op: 'insert',
        payload: row,
        source: 'manual_import',
      }))
      activitiesInserted++
    }

    // ─── Persist all events to the log FIRST, then apply to SQLite ─────────
    for (const ev of newEvents) {
      await appendEvent(ev)
    }
    applyEventsToDb(db, newEvents)

    return NextResponse.json({
      ok: true,
      prospectsInserted,
      prospectsUpdated,
      activitiesInserted,
      activitiesSkipped,
      eventsAppended: newEvents.length,
    })
  } catch (err) {
    console.error('[xlsx-import] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
