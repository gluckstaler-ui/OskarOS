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
import { isVerdictTag, isVerdictTone, tagFromLegacyHeat, verdictTagTone, palateBand } from '@/lib/verdict'

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
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    // Unified keys (Ralph 2026-06-10) — a promote is a row move, zero field
    // translation: the same names land on intel_json. Legacy scout keys
    // (palate_choice/execution/verdict/heat) read-map here once.
    const who = txt(taste.who) ?? txt(taste.palate_choice)
    const subline = txt(taste.verdict_subline) ?? txt(taste.verdict)
    const buying = num(taste.buying) ?? num(taste.execution)
    const tag = txt(taste.verdict_tag) ??
      tagFromLegacyHeat(typeof taste.heat === 'string' ? taste.heat : null)
    // Tone: stored four-value wins; house tag derives; legacy heat maps last.
    const tone = isVerdictTone(taste.verdict_tone)
      ? taste.verdict_tone
      : isVerdictTag(tag) ? verdictTagTone(tag) : null
    // Green ("go now") is what the old 🔥 hot seeding keyed on.
    const hot = tone === 'good'
    const now = new Date().toISOString()
    // Design/photos 0–5 → kanban lamp tone (evidence lamp, 4-tier).
    const scoreTone = (n: number | null): string | null =>
      n == null ? null : n >= 4 ? 'good' : n === 3 ? 'mid' : n === 2 ? 'low' : 'bad'
    // Heads → the EMPLOYEES strip bucket (its buttons match bucket strings).
    const empBucket = (h: number | null): string | null =>
      h == null ? null : h <= 4 ? '1–4' : h <= 9 ? '5–9' : h <= 24 ? '10–24' : h <= 49 ? '25–49' : '50+'

    // Availability (Verfügbarkeit) — the pitch-argument selector (WP-21,
    // 2026-06-10): it lives on raw_payload (register scrape, e.g. FSP),
    // which promote never folded — confirmed lost before this fix. Lift it
    // to intel_json top-level. A queried-layer value (non-register verticals)
    // wins over the scrape payload.
    let payload: Record<string, unknown> = {}
    try { payload = JSON.parse(raw.raw_payload || '{}') } catch { /* keep {} */ }
    const q = (scout.queried ?? {}) as Record<string, unknown>
    const availStatus = txt(q.availability_status) ?? txt(payload.availability_status)
    const availLabel = txt(q.availability_label) ?? txt(payload.availability_label)
    const availChecked = txt(q.availability_checked_at) ?? txt(payload.availability_checked_at)

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
      // Fold the Scout's read into intel — ZERO field translation (Ralph
      // 2026-06-10): the unified keys are identical on both blobs. Extras
      // here: the derived budget band, the lamp renders for design/photos,
      // and the EMPLOYEES bucket from heads. verdict_close_pct is NEVER
      // seeded — it's Filippo's. Scout blobs stay underneath for provenance.
      intel_json: JSON.stringify({
        ...(who ? { who } : {}),
        ...(tag ? { verdict_tag: tag } : {}),
        ...(tone ? { verdict_tone: tone } : {}),
        ...(subline ? { verdict_subline: subline } : {}),
        ...(txt(taste.verdict_prose) ? { verdict_prose: txt(taste.verdict_prose) } : {}),
        ...(num(taste.chf_est) != null ? { chf_est: num(taste.chf_est) } : {}),
        ...(num(taste.heads) != null ? { heads: num(taste.heads) } : {}),
        ...(palateBand(num(taste.chf_est), num(taste.heads)) != null
          ? { verdict_budget: palateBand(num(taste.chf_est), num(taste.heads)) } : {}),
        ...(buying != null ? { buying } : {}),
        ...(txt(taste.switching_pain) ? { switching_pain: txt(taste.switching_pain) } : {}),
        ...(txt(taste.pitch) ? { pitch: txt(taste.pitch) } : {}),
        ...(empBucket(num(taste.heads)) ? { facts_employees: empBucket(num(taste.heads)) } : {}),
        ...(txt(q.sections) ? { sections: txt(q.sections) } : {}),
        ...(txt(q.sections_detail) ? { sections_detail: txt(q.sections_detail) } : {}),
        ...(availStatus ? { availability_status: availStatus } : {}),
        ...(availLabel ? { availability_label: availLabel } : {}),
        ...(availChecked ? { availability_checked_at: availChecked } : {}),
        ...(num(taste.design) != null ? {
          lamp_design_state: `${num(taste.design)}/5`,
          lamp_design_sub: txt(taste.design_cite) ?? '',
          lamp_design_tone: scoreTone(num(taste.design)),
        } : {}),
        ...(num(taste.photos) != null ? {
          lamp_photo_state: `${num(taste.photos)}/5`,
          lamp_photo_sub: txt(taste.photos_cite) ?? '',
          lamp_photo_tone: scoreTone(num(taste.photos)),
        } : {}),
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
      tags: hot ? 'scout, scout:persue' : 'scout',
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
    return NextResponse.json({ ok: true, prospectId: pid, verdict_tag: tag ?? null })
  } catch (err) {
    console.error('[raw-prospects/promote] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
