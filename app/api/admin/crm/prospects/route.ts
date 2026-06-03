// ==========================================
// Admin CRM API: List + Create Prospects
// GET  /api/admin/crm/prospects
// POST /api/admin/crm/prospects
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import {
  readSheet,
  writeSheet,
  computeStageAgeMap,
  type Prospect,
  type ProspectStage,
  type ProspectStatus,
} from '@/lib/crm-store'

export async function GET() {
  try {
    const prospects = readSheet()
    // Compute days-in-stage per prospect from the latest `stage_changed`
    // activity. Cards use this to whisper at 14 days, shout at 21.
    const ageMap = computeStageAgeMap()
    const enriched = prospects.map(p => ({ ...p, stage_age_days: ageMap[p.id] ?? 0 }))
    return NextResponse.json({ prospects: enriched, count: enriched.length })
  } catch (err) {
    console.error('[CRM] GET prospects failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<Prospect>
    const existing = readSheet()
    const usedIds = new Set(existing.map(p => p.id))
    let n = existing.length + 1
    let id = `P${String(n).padStart(3, '0')}`
    while (usedIds.has(id)) {
      n += 1
      id = `P${String(n).padStart(3, '0')}`
    }
    const now = new Date().toISOString()
    // NOTE: every field in the Prospect interface MUST be present — writeSheet →
    // writeProspectToDb binds them as named SQL params (@address_strasse, …) and
    // better-sqlite3 throws "Missing named parameter" on any absent key. That
    // throw was previously SWALLOWED in writeProspectToDb, so an incomplete row
    // here returned 200 but never persisted (the "can't create a lead" bug,
    // Ralph 2026-05-31). Keep this object in lockstep with the interface.
    const newRow: Prospect = {
      id,
      company: body.company ?? '',
      contact_name: body.contact_name ?? '',
      phone: body.phone ?? '',
      email: body.email ?? '',
      website: body.website ?? '',
      address_strasse: body.address_strasse ?? '',
      address_plz: body.address_plz ?? '',
      address_ort: body.address_ort ?? '',
      uid_number: body.uid_number ?? '',
      intel_json: body.intel_json ?? '{}',
      stage: (body.stage as ProspectStage) ?? 'Incoming',
      status: (body.status as ProspectStatus) ?? 'To do',
      amount_chf: Number(body.amount_chf ?? 0),
      confidence_pct: Number(body.confidence_pct ?? 0),
      next_action_date: body.next_action_date ?? now.slice(0, 10),
      next_action_label: body.next_action_label ?? 'TODAY',
      tags: body.tags ?? '',
      starred: Boolean(body.starred),
      owner: body.owner ?? 'Filippo',
      notes: body.notes ?? '',
      created_at: now,
      standby_plan: body.standby_plan ?? '',
      lost_reason: body.lost_reason ?? '',
      sub_stage: body.sub_stage ?? '',
    }
    await writeSheet([...existing, newRow])

    // Matching a number: if this new lead carries a phone that has buffered
    // inbound WhatsApp from an unknown sender, promote those messages onto the
    // lead AND move their media from media/unmatched/<phone>/ → media/<phone>/.
    // Best-effort — never blocks lead creation. Same hook the contacts route
    // uses. Ralph 2026-05-31.
    if (newRow.phone) {
      try {
        const { promoteUnmatchedForPhone } = await import('@/lib/wa-inbound-dispatch')
        await promoteUnmatchedForPhone(newRow.phone, id)
      } catch (err) {
        console.warn('[CRM] promoteUnmatchedForPhone on lead-create failed (non-fatal):', err)
      }
    }

    return NextResponse.json({ prospect: newRow })
  } catch (err) {
    console.error('[CRM] POST prospect failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
