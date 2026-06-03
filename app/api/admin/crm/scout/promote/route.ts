// Scout v1 — Promote (Ralph 2026-06-03). Mints a real prospect at stage
// 'Incoming' from a pool row (carrying the heat), then atomically stamps the
// raw row promoted. WP-SCOUT-8.
import { NextRequest, NextResponse } from 'next/server'
import { readSheet, writeSheet, readRawProspect, patchRawProspect, type Prospect } from '@/lib/crm-store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { id } = (await req.json()) as { id: string }
    const raw = readRawProspect(id)
    if (!raw) return NextResponse.json({ error: 'pool row not found' }, { status: 404 })
    if (raw.promoted_at) return NextResponse.json({ error: 'already promoted', prospectId: raw.promoted_to }, { status: 409 })
    if (raw.rejected_at) return NextResponse.json({ error: 'already discarded' }, { status: 409 })

    const existing = readSheet()
    const used = new Set(existing.map((p) => p.id))
    let n = existing.length + 1
    let pid = `P${String(n).padStart(3, '0')}`
    while (used.has(pid)) { n += 1; pid = `P${String(n).padStart(3, '0')}` }

    const scout = JSON.parse(raw.scout_json || '{}') as { taste?: Record<string, unknown>; queried?: Record<string, unknown> }
    const taste = scout.taste ?? {}
    const hot = taste.heat === 'hot'
    const now = new Date().toISOString()

    const newProspect: Prospect = {
      id: pid,
      company: raw.company || raw.name || raw.website || pid,
      contact_name: raw.name || '',
      phone: raw.phone || '',
      email: raw.email || '',
      website: raw.website || '',
      address_strasse: '', address_plz: '', address_ort: '', uid_number: '',
      // Fold the Scout's read into intel for provenance.
      intel_json: JSON.stringify({ scout_taste: taste, scout_queried: scout.queried ?? {}, scout_source: raw.source }),
      stage: 'Incoming',
      status: 'To do',
      // Carry the heat: a 🔥 lead lands with a conservative seed, overrideable.
      amount_chf: hot ? 5000 : 0,
      confidence_pct: hot ? 15 : 0,
      next_action_date: now.slice(0, 10),
      next_action_label: 'From Scout — qualify',
      tags: hot ? 'scout, scout:hot' : 'scout',
      starred: false,
      owner: 'Filippo',
      notes: '',
      created_at: now,
      standby_plan: '', lost_reason: '', sub_stage: '',
    }

    await writeSheet([...existing, newProspect])
    await patchRawProspect(id, { promoted_at: now, promoted_to: pid })
    return NextResponse.json({ ok: true, prospectId: pid, heat: taste.heat ?? null })
  } catch (err) {
    console.error('[scout/promote] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
