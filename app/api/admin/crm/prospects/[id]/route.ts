// ==========================================
// Admin CRM API: Update single prospect
// PATCH /api/admin/crm/prospects/[id]
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readSheet, writeSheet, appendActivity, removeProspect, type Prospect } from '@/lib/crm-store'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const patch = (await req.json()) as Partial<Prospect>
    const rows = readSheet()
    const idx = rows.findIndex(r => r.id === id)
    if (idx < 0) {
      return NextResponse.json({ error: `prospect ${id} not found` }, { status: 404 })
    }
    const before = rows[idx]
    const merged: Prospect = { ...before, ...patch, id: before.id }
    rows[idx] = merged
    await writeSheet(rows)

    // S13 fix · Auto-write a stage_changed activity when the stage actually
    // moved. Previously this was only written by the drag-drop frontend path
    // (crmDrop in admin.html), so any other code that PATCHed `stage` (bulk
    // ops, future API integrations, manual REST edits) silently broke the
    // stage-age computation in `lib/crm-store.ts:computeStageAgeMap` (which
    // anchors on the latest stage_changed timestamp and falls back to
    // created_at). With this hook, stage moves are tracked uniformly.
    // Non-fatal: if the activity append fails, the PATCH still succeeds —
    // stage-age will just fall back to the prospect's created_at for this
    // transition. We log a warning so it doesn't fail silently.
    if (typeof patch.stage === 'string' && patch.stage !== before.stage) {
      try {
        await appendActivity({
          prospect_id: id,
          type: 'stage_changed',
          icon: 'arrow-right',
          color: '#71717a',
          notes: `${before.stage} → ${patch.stage}`,
        })
      } catch (err) {
        console.warn(
          `[CRM] PATCH wrote stage ${before.stage} → ${patch.stage} for ${id} but stage_changed activity append failed:`,
          err,
        )
      }
    }

    return NextResponse.json({ prospect: merged })
  } catch (err) {
    console.error('[CRM] PATCH prospect failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}


// ─── WP-CRM-DELETE (Ralph 2026-05-24) ─────────────────────────────────
// Mode C cascade: drops prospect row, drops all activities for it,
// unlinks (but keeps) any session folders that referenced its prospect_id.
// UI confirms before calling this — backend just executes.
// ─────────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const result = await removeProspect(id)
    if (!result.prospect) {
      return NextResponse.json({ error: `prospect ${id} not found` }, { status: 404 })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[CRM] DELETE prospect failed:', err)
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('EBUSY') || msg.includes('resource busy')) {
      return NextResponse.json(
        { error: 'Excel file is currently open — please close it and try again' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
