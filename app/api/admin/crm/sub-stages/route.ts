// ============================================================================
// GET /api/admin/crm/sub-stages — distinct sub_stage values used across prospects
// WP-CRM-F8 follow-up (Ralph 2026-05-25)
//
// Powers the autocomplete dropdown on the sub-stage input. Returns the set
// of values Filippo has actually typed before (e.g. "contract sent",
// "invoiced", "discovery scheduled"), so as he types "c" he sees existing
// matches instead of inventing yet another spelling variant. Prevents the
// six-months-in problem of ["contract sent", "Contract sent", "contract-
// sent", "Kontrakt verschickt"] all coexisting in the column.
//
// Cheap on SQLite — DISTINCT scan of a 24-row table is microseconds.
// Would have been a full xlsx parse + map iteration on the prior xlsx model.
// ============================================================================

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/crm-boot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare(`
      SELECT DISTINCT sub_stage
      FROM prospects
      WHERE sub_stage IS NOT NULL AND sub_stage != ''
      ORDER BY sub_stage COLLATE NOCASE ASC
    `).all() as Array<{ sub_stage: string }>
    return NextResponse.json({
      values: rows.map(r => r.sub_stage),
    })
  } catch (err) {
    console.error('[sub-stages] GET failed:', err)
    return NextResponse.json({ values: [], error: String(err) }, { status: 500 })
  }
}
