// ==========================================
// Admin CRM API: Activity edit-in-place
// PATCH /api/admin/crm/activities/[id]   body: { duration_min?, notes? }
//
// Post-call edit path: Filippo logged "Call · 14:32" during the call;
// after he can patch the duration + add structured notes.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { updateActivity, removeActivity } from '@/lib/crm-store'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json()) as { duration_min?: number; notes?: string; subject?: string }
    const updated = await updateActivity(id, body)
    if (!updated) {
      return NextResponse.json({ error: `activity ${id} not found` }, { status: 404 })
    }
    return NextResponse.json({ activity: updated })
  } catch (err) {
    console.error('[CRM] PATCH activity failed:', err)
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


// ─── WP-CRM-DELETE (Ralph 2026-05-24) ────────────────────────────────
// Permanently removes a row from the Activities sheet. UI layer is
// responsible for confirming with the user before calling — backend just
// does the delete. Audit-trail types (stage_changed/status_changed/etc)
// are gated at the UI level, not here, so an admin script or curl can
// still clean up a corrupted row if needed.
// ─────────────────────────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const removed = await removeActivity(id)
    if (!removed) {
      return NextResponse.json({ error: `activity ${id} not found` }, { status: 404 })
    }
    return NextResponse.json({ removed })
  } catch (err) {
    console.error('[CRM] DELETE activity failed:', err)
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
