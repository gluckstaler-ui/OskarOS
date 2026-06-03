// ============================================================================
// GET /api/admin/crm/xlsx-export — dump current SQLite state to xlsx
// WP-CRM-F25 (Ralph 2026-05-25)
//
// Permanent fallback per the Group B decision: this is NOT retired when the
// sync layer (Feature-X WP-104..108) ships. Two roles:
//   1. Pre-sync — the only way to move data between machines until sync is
//      live. Filippo exports, emails the file to Ralph, Ralph imports it.
//   2. Post-sync — manual escape hatch when sync is unavailable (server
//      unreachable, token expired, hosting outage, etc.).
//
// Output is a 3-sheet xlsx matching the original Prospects/Activities shape
// plus a _meta sheet with export timestamp + highest_lamport seen on this
// machine. The _meta sheet lets a future Import know what point in time the
// export was based on (useful for conflict diagnostics, not load-bearing).
// ============================================================================

import { NextResponse } from 'next/server'
import { utils as xlsxUtils, write as writeXlsx } from 'xlsx'
import { getDb } from '@/lib/crm-boot'
import { currentLamport, getNodeId } from '@/lib/event-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getDb()

    // Match the original xlsx column shape so an Import on the other side
    // produces the same row structure. Exclude soft-deleted activities.
    const prospects = db.prepare(`
      SELECT
        id, company, contact_name, phone, email, website,
        stage, status, amount_chf, confidence_pct,
        next_action_date, next_action_label, tags,
        CASE starred WHEN 1 THEN 'TRUE' ELSE 'FALSE' END AS starred,
        owner, notes, created_at, standby_plan, lost_reason, sub_stage,
        address_strasse, address_plz, address_ort, uid_number, intel_json
      FROM prospects
      ORDER BY id
    `).all()

    const activities = db.prepare(`
      SELECT
        id, prospect_id, timestamp, type, icon, color,
        duration_min, notes, session_id, user_id, subject,
        wa_message_id, wa_status, media_path, media_mime
      FROM activities
      WHERE soft_deleted = 0
      ORDER BY id
    `).all()

    const meta = [{
      exported_at: new Date().toISOString(),
      exported_by_node: getNodeId(),
      highest_lamport_at_export: currentLamport(),
      prospect_count: prospects.length,
      activity_count: activities.length,
      schema_version: 1,
      note: 'F25 export — manual fallback for machine-to-machine data transfer. ' +
            'Re-import via POST /api/admin/crm/xlsx-import.',
    }]

    const wb = xlsxUtils.book_new()
    xlsxUtils.book_append_sheet(wb, xlsxUtils.json_to_sheet(prospects), 'Prospects')
    xlsxUtils.book_append_sheet(wb, xlsxUtils.json_to_sheet(activities), 'Activities')
    xlsxUtils.book_append_sheet(wb, xlsxUtils.json_to_sheet(meta), '_meta')

    const buf = writeXlsx(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const filename = `oskar-export-${getNodeId()}-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[xlsx-export] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
