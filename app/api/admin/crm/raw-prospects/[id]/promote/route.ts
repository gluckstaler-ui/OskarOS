// ============================================================================
// app/api/admin/crm/raw-prospects/[id]/promote/route.ts — WP-SCOUT-8
//
// Ralph 2026-06-03 — REST-shaped promote: `POST /api/admin/crm/raw-prospects/
// <id>/promote` mints a real `prospects` row at stage 'Incoming' from the
// pool row and atomically stamps the raw row promoted. The `id` lives in
// the URL segment (not the body) per the §17 spec.
//
// Replaces the older `POST /api/admin/crm/scout/promote` route (deleted in
// the same change — only ScoutPool referenced it, updated to call the
// REST path instead).
//
// Heat-carrying ([SCOUT-E]):
//   hot  → tags 'scout, scout:hot' · seeded confidence_pct 15 · amount_chf 5000
//   warm/cold → tags 'scout' · no seed (qualify from zero)
// The Scout's taste + queried fold into the new prospect's intel_json for
// provenance (so the Consular's later research can read what the Scout already
// found and avoid redundant work).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { readSheet, writeSheet, readRawProspect, patchRawProspect, type Prospect } from '@/lib/crm-store'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const raw = readRawProspect(id)
    if (!raw) return NextResponse.json({ error: 'pool row not found' }, { status: 404 })
    // Idempotent: a double-Promote returns the existing prospect id (200), not 409,
    // so the UI's optimistic-row-removal animation doesn't race with a "already
    // promoted" toast if the user double-taps. The pool-row → prospect mapping is
    // one-way and one-time, so re-reporting the existing prospect is the truth.
    if (raw.promoted_at) {
      return NextResponse.json({ ok: true, prospectId: raw.promoted_to, alreadyPromoted: true })
    }
    if (raw.rejected_at) return NextResponse.json({ error: 'already discarded' }, { status: 409 })

    const existing = readSheet()
    const used = new Set(existing.map((p) => p.id))
    // max(numeric id)+1, NOT count+1 — count+1 collides when ids have gaps
    // (deleted leads, P021/P029…), and a reused id tangles a cold replay.
    let n = existing.reduce(
      (m, p) => {
        const x = parseInt(p.id.replace(/\D/g, ''), 10)
        return Number.isFinite(x) && x > m ? x : m
      },
      0,
    ) + 1
    let pid = `P${String(n).padStart(3, '0')}`
    while (used.has(pid)) {
      n += 1
      pid = `P${String(n).padStart(3, '0')}`
    }

    const scout = JSON.parse(raw.scout_json || '{}') as {
      taste?: Record<string, unknown>
      queried?: Record<string, unknown>
    }
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
      address_strasse: '',
      address_plz: '',
      address_ort: '',
      uid_number: '',
      // Fold the Scout's read into intel for provenance — Consular's later
      // research can see what the Scout already tasted/queried.
      intel_json: JSON.stringify({
        scout_taste: taste,
        scout_queried: scout.queried ?? {},
        scout_source: raw.source,
      }),
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
      standby_plan: '',
      lost_reason: '',
      sub_stage: '',
    }

    await writeSheet([...existing, newProspect])
    await patchRawProspect(id, { promoted_at: now, promoted_to: pid })
    return NextResponse.json({ ok: true, prospectId: pid, heat: taste.heat ?? null })
  } catch (err) {
    console.error('[raw-prospects/promote] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
