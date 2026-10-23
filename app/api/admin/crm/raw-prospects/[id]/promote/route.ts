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
import { readSheet, writeSheet, readRawProspect, patchRawProspect, addContact, appendActivity, type Prospect } from '@/lib/crm-store'
import { isVerdictTag, isVerdictTone, tagFromLegacyHeat, verdictTagTone, palateBand } from '@/lib/verdict'
import { promoteUnmatchedForPhone } from '@/lib/wa-inbound-dispatch'
import { tone as queriedTone } from '@/components/crm/scout/types'

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

    // ── Queried facts → the card's OWN display slots (Ralph 2026-08-01) ──
    // The opp dashboard renders lamp_<k>_{state,sub,tone} and strip_<k>_state
    // (LeadDetail data contract) — burying queried in the provenance blob
    // means the card shows empty lamps for facts the Scout already has.
    // Tone comes from the Scout's canonical tone() — one truth, not a fork.
    //
    // Guard: queried describes capture.finalUrl. When that domain differs
    // from the row's website (cluster leakage, e.g. R1466 carrying another
    // practitioner's scan), the facts belong to the WRONG site — skip the
    // display mapping entirely; the provenance blob still keeps the record.
    const domainOf = (u: string | null): string | null => {
      if (!u) return null
      try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return null }
    }
    const capUrl = txt((scout as { capture?: { finalUrl?: unknown } }).capture?.finalUrl)
    const siteDomain = domainOf(txt(raw.website))
    const capDomain = domainOf(capUrl)
    const queriedTrusted = !(siteDomain && capDomain && siteDomain !== capDomain)

    // Lamp: "76 · ok" → state "76", sub "ok"; tone only when it says something.
    const lampOf = (key: string, v: string | null): Record<string, string> => {
      if (!v) return {}
      const [state, ...rest] = v.split(' · ')
      const t = queriedTone(key, v)
      return {
        [`lamp_${key}_state`]: state.trim(),
        ...(rest.length ? { [`lamp_${key}_sub`]: rest.join(' · ').trim() } : {}),
        ...(t && t !== 'info' ? { [`lamp_${key}_tone`]: t } : {}),
      }
    }
    // Strip: whole value as state (the strip row has no sub slot).
    const stripOf = (key: string, v: string | null): Record<string, string> => {
      if (!v) return {}
      const t = queriedTone(key, v)
      return { [`strip_${key}_state`]: v, ...(t && t !== 'info' ? { [`strip_${key}_tone`]: t } : {}) }
    }
    // Legacy scans carry the pre-split `trackers`; analytics wins when both exist.
    const analyticsVal = txt(q.analytics) ?? txt(q.trackers)
    const reviewsVal = txt(q.reviews)
    const queriedDisplay: Record<string, string> = queriedTrusted ? {
      ...lampOf('age', txt(q.age)),
      ...lampOf('hosting', txt(q.hosting)),
      ...lampOf('stack', txt(q.stack)),
      ...lampOf('performance', txt(q.performance)),
      ...lampOf('seo', txt(q.seo)),
      ...stripOf('traffic', txt(q.traffic)),
      ...stripOf('analytics', analyticsVal),
      ...stripOf('marketing', txt(q.marketing)),
      ...stripOf('saas', txt(q.saas)),
      ...stripOf('booking', txt(q.booking)),
      ...(txt(q.languages) ? { strip_lang: txt(q.languages)! } : {}),
      ...(reviewsVal ? {
        facts_reviews_state: reviewsVal,
        ...(queriedTone('reviews', reviewsVal) !== 'info'
          ? { facts_reviews_tone: queriedTone('reviews', reviewsVal) } : {}),
      } : {}),
    } : {}

    const newProspect: Prospect = {
      id: pid,
      company: raw.company || raw.name || raw.website || pid,
      contact_name: raw.name || '',
      phone: raw.phone || '',
      email: raw.email || '',
      website: raw.website || '',
      // Address — the FSP register scrape carries adr/plz/ort on raw_payload
      // (Ralph 2026-08-01: promote must carry ALL of what the Scout has).
      address_strasse: txt(payload.adr) ?? '',
      address_plz: txt(payload.plz) ?? '',
      address_ort: txt(payload.ort) ?? '',
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
        ...queriedDisplay,
        ...(!queriedTrusted && capUrl ? { scout_scan_mismatch: capUrl } : {}),
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
      auto_respond: false,
      auto_respond_goals: '',
    }

    await writeSheet([...existing, newProspect])
    await patchRawProspect(id, { promoted_at: now, promoted_to: pid })

    // Contacts table (WP-121) — the card's PEOPLE section reads ONLY from
    // contacts, so a promote without a contacts row lands as a card with no
    // reachable person (Ralph 2026-08-01). Seed the person the Scout found:
    // solo-practice register rows ARE the decision maker. fsp_title (register
    // scrape) becomes the professional title. Non-fatal — the prospect row
    // is already committed; a contact failure must not eat the promote.
    if (raw.name || raw.phone || raw.email) {
      try {
        const contact = await addContact({
          prospect_id: pid,
          name: raw.name || '',
          role: 'decision_maker',
          phone: raw.phone || '',
          email: raw.email || '',
          title: txt(payload.fsp_title) ?? '',
          notes: `From Scout ${raw.id}`,
          is_decisive: true,
        })
        // Same rescan as the contacts POST route: WhatsApp messages that
        // arrived from this mobile before the card existed sit in the
        // unmatched buffer — link them onto the new prospect's timeline.
        if (contact.phone) {
          await promoteUnmatchedForPhone(contact.phone, pid).catch(() => {})
        }
      } catch (err) {
        console.warn('[raw-prospects/promote] contact seed failed (non-fatal):', err)
      }
    }

    // One history entry per Scout register field (Ralph 2026-08-01): the FSP
    // extras have no card widget — the feed IS their home. FeedRow linkifies
    // URLs, so the Profil entry is clickable. Entries are listed in display
    // priority; timestamps stagger 1ms downward so the DESC feed keeps this
    // order (Profil on top). Legacy taste.photos is prose on old scans (txt()
    // yields null on the unified numeric shape, which already feeds the photo
    // lamp) and only trusted scans may speak. Non-fatal.
    try {
      const joinArr = (a: unknown): string | null =>
        Array.isArray(a) && a.length ? a.map((x) => String(x)).filter(Boolean).join(' · ') : null
      const entries = ([
        ['FSP · Profil', txt(payload.profile_url)],
        ['FSP · Spezialisierung', txt(payload.specialization)],
        ['FSP · Sprachen', joinArr(payload.languages)],
        ['FSP · Angebot', joinArr(payload.services)],
        ['FSP · Zielgruppen', joinArr(payload.target_groups)],
        ['FSP · Abrechnung', txt(payload.billing)],
        ['FSP · Online-Beratung', txt(payload.online_session)],
        ['Scout · Photos', queriedTrusted ? txt(taste.photos) : null],
      ] as Array<[string, string | null]>).filter((e): e is [string, string] => Boolean(e[1]))
      const base = Date.parse(now)
      for (let i = 0; i < entries.length; i++) {
        const [label, value] = entries[i]
        await appendActivity({
          prospect_id: pid,
          type: 'Note',
          icon: 'file-text',
          color: '#a1a1aa',
          notes: `${label}: ${value}`,
          timestamp: new Date(base - i - 1).toISOString(),
        })
      }
    } catch (err) {
      console.warn('[raw-prospects/promote] scout history entries failed (non-fatal):', err)
    }

    return NextResponse.json({ ok: true, prospectId: pid, verdict_tag: tag ?? null })
  } catch (err) {
    console.error('[raw-prospects/promote] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
