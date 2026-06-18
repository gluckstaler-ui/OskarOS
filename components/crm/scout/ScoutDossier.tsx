'use client'
// ============================================================================
// ScoutDossier — the per-lead expanded view (WP-SCOUT-7, Ralph 2026-06-03).
//
// Two-column layout per §17 [SCOUT-L]:
//
//   ◐ Queried (left)            ◓ Scouted (right)
//   nine code-fetched lamps     palate · execution · gap · the named choice
//   + Puppeteer screenshots     + photos read + verdict
//   (full-page + 1 inner)
//
// Ralph 2026-06-03 (edit pass) — every field in the dossier is now inline-
// editable. Click any value to edit; Enter or blur saves, Esc cancels. The
// dossier also gains a header strip with identity (name/website/phone/etc.)
// + a "↺ Re-Taste" button that un-scouts the row so the next batch run
// re-runs Scout on it (per Ralph's "toggle queried/not-queried" = "reset
// so Scout can run again").
//
// Saves split into two channels:
//   - identity (name/company/website/phone/email/country/industry) →
//     PATCH /api/admin/crm/raw-prospects/<id>  body {<field>: <value>}
//   - scout_json fields (taste.palate, taste.verdict, queried.age, …) →
//     same PATCH route, body {scout_json: <merged JSON string>}; for
//     taste.palate / taste.execution we re-derive gap+heat client-side to
//     match the server's deriveVerdict so the chip flips on save.
// ============================================================================

import { useEffect, useState, type ReactNode } from 'react'
import {
  type RawProspect, type Taste, type Queried, type Capture,
  scoutOf, stateOf, payloadOf, tone, QUERIED_SOURCES,
  verdictTagOf, verdictToneOf, whoOf, sublineOf, palatOf, buyingOf, photoScoreOf,
} from './types'
import { VERDICT_TONES } from '@/lib/verdict'
import { VerdictCard } from '@/components/crm/VerdictCard'
import { ScoutMeter } from './ScoutMeter'
import { normalizeWebUrl } from './ScoutRow'
import { firstnameSlug } from '@/lib/scout-paths'

interface Props {
  p: RawProspect
  /** Called after every successful PATCH/un-scout so the pool reloads. */
  onChanged?: () => void
  /** Distinct bezirks present in the pool — feeds the Region dropdown. */
  availableRegions?: string[]
}

/** Identity fields the dossier header lets you edit. */
type IdentityField = 'name' | 'company' | 'website' | 'phone' | 'email' | 'country' | 'industry'

export function ScoutDossier({ p, onChanged, availableRegions = [] }: Props) {
  const pl = payloadOf(p)
  const sc = scoutOf(p)
  const t = sc.taste ?? {}
  const q = sc.queried ?? {}
  const cap = sc.capture ?? {}
  const st = stateOf(p)

  // ── PATCH plumbing — both edit channels go through this PATCH route. ────
  // Identity: body has a single string field. scout_json: body has the
  // pre-merged JSON string (caller does the merge so the server stays dumb).
  const patchRow = async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const r = await fetch(`/api/admin/crm/raw-prospects/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.text()
        console.error(`[ScoutDossier] PATCH failed for ${p.id}:`, err)
        return false
      }
      onChanged?.()
      return true
    } catch (e) {
      console.error(`[ScoutDossier] PATCH threw for ${p.id}:`, e)
      return false
    }
  }

  const saveIdentity = (field: IdentityField) => async (value: string): Promise<boolean> =>
    patchRow({ [field]: value })

  // Ralph 2026-06-03 · Region edits live inside raw_payload (NOT a top-level
  // column — schema-stable). Parse the current payload, set bezirk, write
  // back. The Region dropdown's options come from availableRegions; the
  // user can also type a custom value via the "+ Other…" path inside
  // EditableSelect — that lands as a free-string bezirk and joins the
  // available set on the next pool refresh.
  const saveRegion = async (value: string): Promise<boolean> => {
    let payload: Record<string, unknown>
    try { payload = JSON.parse(p.raw_payload || '{}') } catch { payload = {} }
    payload.bezirk = value || null
    return patchRow({ raw_payload: JSON.stringify(payload) })
  }
  const currentRegion = (pl.bezirk || pl.region || '').trim()

  // scout_json merge: parse current → set [section][field] → re-derive gap/heat
  // if a taste meter changed → write back. The server's deriveVerdict uses the
  // same band (≥2 hot · ≥1 warm · else cold) — we mirror it here so the chip
  // updates instantly without a re-fetch round-trip.
  const saveScoutField = (
    section: 'taste' | 'queried',
    field: string,
  ) => async (raw: string): Promise<boolean> => {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(p.scout_json || '{}') } catch { parsed = {} }
    const next: Record<string, unknown> = { ...parsed }
    const sectionObj: Record<string, unknown> = { ...((next[section] as Record<string, unknown>) ?? {}) }

    // Numeric taste fields (Ralph 2026-06-10 redesign): buying, design +
    // photos are 0–5; chf_est and heads are positive integers. Everything
    // else is a free string (or null on blank). Blank-stringifies to "" so
    // we treat empty as a delete intent. gap/heat re-derivation is RETIRED —
    // the verdict tone carries the heat, nothing derived on save. Legacy
    // keys (execution/palate_choice/verdict) are never written again.
    const SCORE_FIELDS = ['buying', 'design', 'photos']
    if (section === 'taste' && SCORE_FIELDS.includes(field)) {
      const n = raw.trim() === '' ? null : Number(raw)
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 5)) return false
      sectionObj[field] = n
    } else if (section === 'taste' && (field === 'chf_est' || field === 'heads')) {
      const n = raw.trim() === '' ? null : Number(raw.replace(/[^\d.]/g, ''))
      if (n !== null && (!Number.isFinite(n) || n < 1)) return false
      sectionObj[field] = n === null ? null : Math.round(n)
    } else {
      sectionObj[field] = raw.trim() === '' ? null : raw
    }
    next[section] = sectionObj

    // Ralph 2026-06-10 · typing a number into the SECTIONS lamp computes the
    // CHF estimate (sections × 300) when none exists yet — it NEVER
    // overwrites an existing estimate. Same PATCH, atomic.
    if (section === 'queried' && field === 'sections') {
      const count = parseInt(raw, 10)
      const taste: Record<string, unknown> = { ...((next.taste as Record<string, unknown>) ?? {}) }
      const hasChf = typeof taste.chf_est === 'number' && Number.isFinite(taste.chf_est)
      if (Number.isFinite(count) && count > 0 && !hasChf) {
        taste.chf_est = count * 300
        next.taste = taste
      }
    }
    return patchRow({ scout_json: JSON.stringify(next) })
  }

  // Re-Taste = un-scout the row → it drops to 'raw' → next batch picks it up.
  // The button is disabled while the request is in flight to dodge the
  // double-click that would race two POSTs to the same id.
  const [reTasting, setReTasting] = useState(false)
  const reTaste = async () => {
    if (reTasting) return
    setReTasting(true)
    try {
      const r = await fetch(`/api/admin/crm/raw-prospects/${p.id}/un-scout`, { method: 'POST' })
      if (r.ok) onChanged?.()
      else console.error(`[ScoutDossier] un-scout failed for ${p.id}:`, await r.text())
    } catch (e) {
      console.error(`[ScoutDossier] un-scout threw for ${p.id}:`, e)
    } finally {
      setReTasting(false)
    }
  }

  // WP-23 (2026-06-10): ▸ Research — the Consular's door on the Scout
  // surface. POSTs the row to /api/admin/crm/consular/research, which
  // injects [OSKAR-SYSTEM RESEARCH-COMPANY] surface=scout into the __crm__
  // session. Async 60–120s; progress/failure arrive as snackbars; the
  // Consular writes scout_json.taste via SQL. Distinct from Re-Taste
  // (un-scout → next deterministic batch): Research is the deep single-row
  // teardown, Re-Taste is the cheap re-queue.
  const [researching, setResearching] = useState(false)
  const research = async () => {
    if (researching) return
    setResearching(true)
    try {
      const r = await fetch('/api/admin/crm/consular/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, name: p.company || p.name || p.website || p.id, surface: 'scout' }),
      })
      if (!r.ok) console.error(`[ScoutDossier] research trigger failed for ${p.id}:`, await r.text())
    } catch (e) {
      console.error(`[ScoutDossier] research trigger threw for ${p.id}:`, e)
    } finally {
      // The route returns immediately (escrow job); re-enable right away —
      // dedup on the server absorbs an accidental double-press.
      setResearching(false)
    }
  }

  // The header strip + identity edit row is always shown (every state). The
  // body below the header depends on state. canReTaste = the row already has
  // some scout output (scouted or failed) — re-tasting a 'raw' row would be a
  // no-op since it's already eligible for the next batch.
  const hasScoutData = !!sc.scanned_at || st === 'scouted' || (sc.failed === true)

  return (
    <div className="scout-dossier">
      <DossierHeader
        p={p}
        addr={pl.adr}
        currentRegion={currentRegion}
        availableRegions={availableRegions}
        onSaveRegion={saveRegion}
        onSaveIdentity={saveIdentity}
      />

      {/* ── Body — varies by state, identical structure to the prior dossier. ── */}
      {st === 'greenfield' ? (
        <div className="scout-dgrid2">
          <div>
            <div className="scout-dlabel">◐ Queried — code fetches it · no LLM</div>
            <div className="scout-qline">
              No domain on record → nothing to fetch. Add a website above to
              unlock the queried layer + the visual taste.
            </div>
          </div>
          <div>
            <div className="scout-dlabel">◓ Scouted — the agent&apos;s read</div>
            <div className="scout-gfbig">◇ Greenfield — no site to taste</div>
            <div className="scout-qline">
              Nothing to displace — you set the first impression. Decision is
              pursue / skip.
            </div>
          </div>
        </div>
      ) : st === 'raw' ? (
        <div className="scout-dgrid2">
          <div>
            <div className="scout-dlabel">◐ Queried — code fetches it · no LLM</div>
            <div className="scout-qline">
              Rides along free on Taste — Age · Stack · Hosting (and Perf · SEO ·
              Traffic once the keys land), plus the screenshot the taste judges.
            </div>
          </div>
          <div>
            <div className="scout-dlabel">◓ Scouted — the agent tastes it</div>
            <div className="scout-qline">
              Not scouted yet. Select the card and press <b>Taste</b> — the agent
              returns Who · Buying · CHF est · Switching pain · Design · Photos ·
              the Verdict tag.
            </div>
          </div>
        </div>
      ) : (
        // Scouted (incl. failed) — full editable dossier.
        // Ralph 2026-06-10 · major redesign, step 1 — QUERIED moved back up
        // to a full-width strip ABOVE the 2-col body (was: right-column top):
        //   01 / QUERIED  — full width, lamp strip in one row
        //   02 / EVIDENCE — left, big screenshots (as is)
        //   03 / TASTED   — right, Consular's read (as is)
        <>
          <section className="scout-d-section scout-d-queried">
            <SectionHead num="01" name="QUERIED" sub="CODE FETCHES · CLICK ANY VALUE TO OVERRIDE" />
            {/* Ralph 2026-06-04 · PERF / SEO / TRAFFIC moved out of QUERIED
                into the collapsed row strip (MiniScoreLamp in ScoutRow.tsx).
                QUERIED now hosts only the categorical lamps — Age, Stack,
                Hosting, Languages, Booking, Trackers. Editing happens here
                for those; the three numeric scores are read-only at row
                level and not currently editable post-move (they're Google's
                numbers — overriding them would lie about what PSI returned). */}
            <div className="scout-d-lampstrip">
              <DotLamp   name="AGE"        lkey="age"       val={q.age}        onSave={saveScoutField('queried', 'age')} />
              <DotLamp   name="STACK"      lkey="stack"     val={q.stack}      onSave={saveScoutField('queried', 'stack')} />
              <DotLamp   name="HOSTING"    lkey="hosting"   val={q.hosting}    onSave={saveScoutField('queried', 'hosting')} />
              <DotLamp   name="LANGS"      lkey="languages" val={q.languages}  onSave={saveScoutField('queried', 'languages')} />
              <DotLamp   name="BOOKING"    lkey="booking"   val={q.booking}    onSave={saveScoutField('queried', 'booking')} />
              {/* Ralph 2026-06-06 — trackers split into ANALYTICS + MARKETING,
                  + REVIEWS lamp added. The two tracker categories carry
                  different displacement reads (measurement-only vs
                  retargeting-pixel-no-CMP). REVIEWS comes from DDG-backed
                  `lookupReviews`; renders as "4.7★·87" or "—" when no
                  Google Business listing was found. */}
              <DotLamp   name="ANALYTICS"  lkey="analytics" val={q.analytics}  onSave={saveScoutField('queried', 'analytics')} />
              <DotLamp   name="MARKETING"  lkey="marketing" val={q.marketing}  onSave={saveScoutField('queried', 'marketing')} />
              <DotLamp   name="REVIEWS"    lkey="reviews"   val={q.reviews}    onSave={saveScoutField('queried', 'reviews')} />
              {/* SaaS is HTML grep across 8 CRM platforms; renders '—' / null
                  honestly when the data isn't there. Ralph 2026-06-10 —
                  INDUSTRY + LOCATION lamps removed: they duplicated the
                  identity meta in the dossier header (Industry · Adresse ·
                  PLZ · Ort · Region). The queried.industry/location fields
                  still land in scout_json; they're just not lamps anymore. */}
              <DotLamp   name="SAAS"       lkey="saas"      val={q.saas}       onSave={saveScoutField('queried', 'saas')} />
              {/* Ralph 2026-06-10 (TASTED redesign) — SECTIONS: code-counted
                  across the site's pages (homepage + same-origin crawl, see
                  research-queried countSiteSections). Anchors the agent's
                  CHF estimate; no per-page detail by design. */}
              <DotLamp   name="SECTIONS"   lkey="sections"  val={q.sections}   onSave={saveScoutField('queried', 'sections')} />
            </div>
          </section>

          <div className="scout-d-body">
            <section className="scout-d-section scout-d-evidence">
              <SectionHead num="02" name="EVIDENCE" sub={p.website || ''} />
              {p.website ? <ScreenshotBlock cap={cap} practitionerName={p.name || ''} /> : null}
            </section>

            <section className="scout-d-section scout-d-tasted">
              {/* Re-Taste + Research ride on the section-head row, top right.
                  Research = WP-23, the Consular's deep teardown on demand;
                  Re-Taste = cheap un-scout → next deterministic batch. */}
              <div className="scout-d-head-row">
                <SectionHead num="03" name="TASTED" sub="CONSULAR'S READ" />
                <button
                  type="button"
                  className="scout-retaste"
                  disabled={researching}
                  onClick={research}
                  title="Consular recherchiert diese Praxis — 1-2 Min, Befund landet hier."
                >
                  ▸ {researching ? 'sending…' : 'Research'}
                </button>
                <button
                  type="button"
                  className="scout-retaste"
                  disabled={!hasScoutData || reTasting}
                  onClick={reTaste}
                  title={hasScoutData ? 'Scout-Daten löschen — nächster Batch tastet neu.' : 'Bereits im Pool.'}
                >
                  ↺ {reTasting ? 'resetting…' : 'Re-Taste'}
                </button>
              </div>
              <ScoutTastedColumn t={t} sections={q.sections ?? null} sectionsDetail={q.sections_detail ?? null} saveScoutField={saveScoutField} />
            </section>
          </div>
        </>
      )}
    </div>
  )
}

// ── Dossier header — identity strip + Re-Taste button ────────────────────

function DossierHeader({
  p, addr, currentRegion, availableRegions, onSaveRegion,
  onSaveIdentity,
}: {
  p: RawProspect
  addr: string | undefined
  currentRegion: string
  availableRegions: string[]
  onSaveRegion: (v: string) => Promise<boolean>
  onSaveIdentity: (f: IdentityField) => (v: string) => Promise<boolean>
}) {
  // payload re-derived here (parent also does it; cheap parse, scoped use)
  const pl = payloadOf(p)
  // raw_payload array fields (services/languages/target_groups) render as a list.
  const arr = (v: unknown): string => (Array.isArray(v) ? v.join(' · ') : typeof v === 'string' ? v : '')
  return (
    <div className="scout-dhdr">
      <div className="scout-dhdr-grid">
        {/* Ralph 2026-06-09 · 3 Reihen × 5 Spalten.
            R1: Company · Name · FSP-Titel · Spezialisierung · Angebot
            R2: Industry · Adresse · PLZ · Ort · Region
            R3: Verfügbarkeit · Website · Email · Phone · FSP-Profil
            Re-Taste in die TASTED-Sektion verschoben (neben Palate/Exec). */}
        {/* ── R1 ── */}
        <Field label="Company"  value={p.company}  onSave={onSaveIdentity('company')}  placeholder="(unnamed)" />
        <Field label="Name"     value={p.name}     onSave={onSaveIdentity('name')}     placeholder="—" />
        {/* Ralph 2026-06-09 · FSP-Titel · Spezialisierung · Angebot in EINER Zelle
            über 3 Spalten (read-only): Titel fett · Spezialisierung kursiv · Angebot
            normal. Löst die gequetschten 3 schmalen Spalten bei langen Listen.
            Ralph 2026-06-11 · der Row-Key (z. B. R023) führt die Zelle FETT an —
            jedes Dossier nennt die id, die man in einem Bug-Report referenziert. */}
        <div className="scout-dhdr-f ro scout-dhdr-span3">
          <span className="scout-dhdr-l">FSP-Titel · Spezialisierung · Angebot</span>
          <span className="scout-dhdr-v ro scout-profil">
            <b>{p.id}</b>
            {(pl.fsp_title as string) ? <> · <b>{pl.fsp_title as string}</b></> : null}
            {(pl.specialization as string) ? <> · <i>{pl.specialization as string}</i></> : null}
            {arr(pl.services) ? <> · {arr(pl.services)}</> : null}
          </span>
        </div>
        {/* ── R2 ── */}
        <Field label="Industry" value={p.industry} onSave={onSaveIdentity('industry')} placeholder="—" />
        {/* Address/PLZ/Ort are raw_payload, read-only (promote to columns before editing). */}
        <div className="scout-dhdr-f ro">
          <span className="scout-dhdr-l">Adresse</span>
          <span className="scout-dhdr-v ro">{addr || '—'}</span>
        </div>
        <div className="scout-dhdr-f ro">
          <span className="scout-dhdr-l">PLZ</span>
          <span className="scout-dhdr-v ro">{(pl.plz as string) || '—'}</span>
        </div>
        <div className="scout-dhdr-f ro">
          <span className="scout-dhdr-l">Ort</span>
          <span className="scout-dhdr-v ro">{(pl.ort as string) || '—'}</span>
        </div>
        {/* Ralph 2026-06-03 · Region replaces Country — every lead is Swiss; the
            axis is the bezirk. Dropdown from pool values; saves raw_payload.bezirk. */}
        <div className="scout-dhdr-f">
          <span className="scout-dhdr-l">Region</span>
          <span className="scout-dhdr-v">
            <EditableSelect
              value={currentRegion}
              onSave={onSaveRegion}
              options={availableRegions}
              placeholder="—"
            />
          </span>
        </div>
        {/* ── R3 — Verfügbarkeit · Website · Email · Phone · FSP-Profil ── */}
        {/* Ralph 2026-06-05 · Verfügbarkeit + Verband-URL. Two field sources:
            - PREFERRED: `availability_status` (open/limited/closed/unknown)
              + `availability_label` (UI-ready text), populated by the FSP
              scraper (lib/scrapers/fsp.ts deriveAvailability + refsp backfill).
            - `availability` (raw FSP text) is the only remaining fallback.
            Ralph 2026-06-09: `verfuegbarkeit` RETIRED — it duplicated
            availability_label; stripped from every raw_payload + the import.
            The chip color follows the normalized status; raw text falls
            back to substring-matching the German wait-time phrase. */}
        {(() => {
          // Prefer the normalised pair when present; fall back to raw text.
          const status = (pl.availability_status as string) || ''
          const label = (pl.availability_label as string) || ''
          const raw = (pl.availability as string) || ''
          const display = label || raw
          if (!display) return (
            <div className="scout-dhdr-f ro">
              <span className="scout-dhdr-l">Verfügbarkeit</span>
              <span className="scout-dhdr-v ro">—</span>
            </div>
          )
          // Status → tone class. Legacy substring detection only runs when
          // the normalised status is absent (older rows).
          let tone = 'scout-verf-mid'
          if (status === 'open')         tone = 'scout-verf-on'
          else if (status === 'closed')  tone = 'scout-verf-off'
          else if (status === 'limited') tone = 'scout-verf-mid'
          else {
            const lower = display.toLowerCase()
            const accepting = lower.startsWith('verfügbar') || lower.startsWith('verfuegbar') ||
                              lower.startsWith('weniger als zwei') || lower.startsWith('neue kund')
            const closed = lower.startsWith('keine neuen')
            tone = accepting ? 'scout-verf-on' : closed ? 'scout-verf-off' : 'scout-verf-mid'
          }
          // Staleness (M3) — when was the availability last checked? FSP
          // availability changes weekly, so anything older than ~14 days is
          // a hint to re-scrape. Compact "Stand: 5.6." inline; full ISO in tooltip.
          const checkedAt = (pl.availability_checked_at as string) || (pl.fetched_at as string) || ''
          let stand = ''
          let stale = false
          if (checkedAt) {
            const d = new Date(checkedAt)
            if (!Number.isNaN(d.getTime())) {
              stand = `${d.getDate()}.${d.getMonth() + 1}.`
              stale = (Date.now() - d.getTime()) > 14 * 86_400_000
            }
          }
          return (
            <div className="scout-dhdr-f ro">
              <span className="scout-dhdr-l">Verfügbarkeit</span>
              <span className={`scout-dhdr-v scout-verf ${tone}`} title={raw && raw !== display ? raw : undefined}>
                {display}
                {stand
                  ? <span
                      className={`scout-verf-stand${stale ? ' stale' : ''}`}
                      title={`Last verified against FSP profile: ${checkedAt}`}
                    > · Stand {stand}</span>
                  : null}
              </span>
            </div>
          )
        })()}
        <Field
          label="Website"
          value={p.website}
          onSave={onSaveIdentity('website')}
          placeholder="https://…"
          decorate={(v) => v
            ? <>
                <span className="scout-edlink-text">{v}</span>
                <a href={normalizeWebUrl(v)} target="_blank" rel="noreferrer" className="scout-edlink-go" onClick={(e) => e.stopPropagation()} title="In neuem Tab öffnen">↗</a>
              </>
            : null}
        />
        <Field
          label="Email"
          value={p.email}
          onSave={onSaveIdentity('email')}
          placeholder="—"
          decorate={(v) => v
            ? <>
                <span className="scout-edlink-text">{v}</span>
                <a href={`mailto:${v}`} className="scout-edlink-go" onClick={(e) => e.stopPropagation()} title="E-Mail verfassen">✉</a>
              </>
            : null}
        />
        <Field
          label="Phone"
          value={p.phone}
          onSave={onSaveIdentity('phone')}
          placeholder="—"
          decorate={(v) => v
            ? <>
                <span className="scout-edlink-text">{v}</span>
                <a href={`tel:${v.replace(/\s+/g, '')}`} className="scout-edlink-go" onClick={(e) => e.stopPropagation()} title="Anrufen">☎</a>
              </>
            : null}
        />
        {(() => {
          // Prefer the canonical profile_url (set by the FSP scraper + refsp
          // backfill); fall back to the legacy verband_url field on rows that
          // haven't been backfilled.
          const vurl = ((pl.profile_url as string) || (pl.verband_url as string) || '').trim()
          return (
            <div className="scout-dhdr-f ro">
              <span className="scout-dhdr-l">FSP-Profil</span>
              <span className="scout-dhdr-v">
                {vurl
                  ? <a
                      href={vurl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="scout-verband-link"
                      onClick={(e) => e.stopPropagation()}
                      title="Open the FSP psyfinder profile in a new tab — source of truth for these fields"
                    >
                      {vurl.replace(/^https?:\/\/(www\.)?/, '')} ↗
                    </a>
                  : <span className="ro">—</span>}
              </span>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ── Section header — "01 / QUERIED · CODE FETCHES…" ────────────────────

function SectionHead({ num, name, sub }: { num: string; name: string; sub: string }) {
  return (
    <h4 className="scout-d-h">
      <span className="scout-d-num">{num}</span>
      <span className="scout-d-sep">/</span>
      <span className="scout-d-name">{name}</span>
      {sub ? <span className="scout-d-sub">{sub}</span> : null}
    </h4>
  )
}

// ── Score-bar lamp (PERF / SEO / TRAFFIC) ───────────────────────────────
// Numeric Lighthouse / LCP-derived score with a 4-tier color bar. Value is
// editable as raw text (override what Google reported). The bar fill width
// is derived from the displayed number; the color uses the same tone()
// function as the categorical lamps so a 62 looks orange whether it came
// from PageSpeed or a manual override.

export function ScoreLamp({
  name, val, onSave,
}: {
  name: string
  val: string | null | undefined
  onSave: (v: string) => Promise<boolean>
}) {
  const lkey = name.toLowerCase() === 'perf' ? 'performance'
    : name.toLowerCase() === 'seo' ? 'seo'
    : 'traffic'
  const t = tone(lkey, val)
  // Extract a 0-100 (or fallback) for the bar fill. PERF/SEO are 0-100 directly.
  // TRAFFIC label is "LCP 2.8s · ok" — map the suffix to a faux-percent for the bar.
  let pct: number | null = null
  let scoreText: string = '—'
  if (val) {
    const n = +(val.replace(/[^\d.]/g, '').split('.')[0] || '0')
    if (Number.isFinite(n) && n > 0) {
      if (lkey === 'traffic') {
        // Traffic doesn't have a natural 0-100 axis; map suffix → percentage for
        // the bar fill so "fast" stretches green and "poor" stays short red.
        pct = /fast/i.test(val) ? 95 : /·\s*ok\b/i.test(val) ? 75 : /slow/i.test(val) ? 55 : /poor/i.test(val) ? 25 : null
        scoreText = val.match(/(\d+\.?\d*s)/)?.[1] ?? val.slice(0, 8)
      } else {
        pct = Math.max(0, Math.min(100, n))
        scoreText = String(pct)
      }
    } else if (/thin|below CrUX/i.test(val)) {
      scoreText = 'thin'
    }
  }
  // Ralph 2026-06-04 (v3) · 2-row layout: NAME + VALUE share the top row,
  // bar lives below. Previously 3 rows (name / big number / bar) made the
  // strip very tall. Now compact: "PERF  85" then a colored fill bar.
  return (
    <div className="scout-d-sl">
      <span className="scout-d-sl-top">
        <span className="scout-d-sl-name">{name}</span>
        <span className="scout-d-sl-val">
          <EditableText
            value={val ?? ''}
            onSave={onSave}
            placeholder="—"
            decorate={(v) => v
              ? <span className="scout-d-sl-num"><b>{scoreText}</b></span>
              : null}
          />
        </span>
      </span>
      <span className={`scout-d-sl-bar ${t}`}>
        <span className="scout-d-sl-fill" style={{ width: pct == null ? 0 : `${pct}%` }} />
      </span>
    </div>
  )
}

// ── Dot lamp (AGE / STACK / HOSTING / LANGS / BOOKING / TRACKERS) ───────
// Categorical lamp — colored dot + value text. Editable. Mockup style:
// stacked column with NAME above and ● value below.

function DotLamp({
  name, lkey, val, onSave,
}: {
  name: string
  lkey: string
  val: string | null | undefined
  onSave: (v: string) => Promise<boolean>
}) {
  const t = tone(lkey, val)
  // Ralph 2026-06-04 (v3) · tone class on the cell container drives a
  // tinted BG so the lamp grid reads at a glance — orange WordPress cell,
  // green Hostpoint cell, grey "none" cells. The small dot inside is now
  // redundant with the cell color and removed.
  return (
    <div className={`scout-d-dl tone-${t || 'info'}`}>
      <span className="scout-d-dl-name">{name}</span>
      <span className="scout-d-dl-val">
        <EditableText value={val ?? ''} onSave={onSave} placeholder="—" />
      </span>
    </div>
  )
}

// ── ◐ Queried lamp (one row in the 3×3 lamp grid) — value is editable ────
//    (legacy — kept for backward compat with any external import; the
//    new dossier uses ScoreLamp + DotLamp above.)

function Lamp({
  name, lkey, val, onSave,
}: {
  name: string
  lkey: string
  val: string | null | undefined
  onSave: (v: string) => Promise<boolean>
}) {
  return (
    <div className="scout-lamp2">
      <span className={`scout-ld ${tone(lkey, val)}`} />
      <span className="ln">{name}</span>
      <span className="lsrc">{QUERIED_SOURCES[lkey]}</span>
      <span className="lv">
        <EditableText value={val ?? ''} onSave={onSave} placeholder="—" />
      </span>
    </div>
  )
}

// ── Puppeteer screenshot block (unchanged from prior rev) ────────────────

type ListedShot = { url: string; label: string; sizeBytes: number; mtime: number }

/** Parse slot (plz, slug) out of a capture serve URL. The prefix segment may
 *  be `_main-<sha8>` (shared-site content-addressed shot) — we don't trust
 *  it for the firstname; the caller passes the practitioner name and we
 *  derive prefix from it via the canonical firstnameSlug helper. */
function parseSlot(url: string): { plz: string; slug: string } | null {
  const m = url.match(/^\/api\/admin\/scout\/capture\/([a-z0-9_-]+)\/([a-z0-9_-]+)\/[a-z0-9_-]+\.(?:jpg|png|webp)$/)
  if (!m) return null
  return { plz: m[1], slug: m[2] }
}

function ScreenshotBlock({ cap, practitionerName }: { cap: Capture; practitionerName: string }) {
  // Ralph 2026-06-05 — "All screenshots are always displayed. Not only two.
  // ALL." A shared-site practitioner's dossier surfaces every site-level
  // shot the practice has (deduped at storage: `_main-<sha8>.jpg`) PLUS
  // this practitioner's own profile shot. Solo sites just render this row's
  // own `<firstname>.jpg` + `<firstname>-profile.jpg`. The list endpoint
  // does the matching server-side using a deterministic prefix.
  const [listed, setListed] = useState<ListedShot[] | null>(null)

  const slot = cap.fullPageUrl ? parseSlot(cap.fullPageUrl) : null
  const prefix = practitionerName ? firstnameSlug(practitionerName) : ''

  useEffect(() => {
    if (!slot || !prefix) { setListed(null); return }
    let cancelled = false
    fetch(`/api/admin/scout/capture-list/${slot.plz}/${slot.slug}/${prefix}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled && j?.shots) setListed(j.shots as ListedShot[]) })
      .catch(() => { /* fall back to scout_json URLs */ })
    return () => { cancelled = true }
  }, [slot?.plz, slot?.slug, prefix])

  if (!cap.fullPageUrl) {
    return (
      <div className="scout-shot">
        <span className="lbl">Puppeteer · full-page + profile</span>
        <span className="empty">— not yet captured — runs with Taste —</span>
      </div>
    )
  }
  if (cap.failed) {
    return (
      <div className="scout-shot failed">
        <span className="lbl">Puppeteer · capture failed</span>
        <span className="reason">{cap.fail_reason || 'unknown failure'}</span>
      </div>
    )
  }

  type Shot = { url: string; label: string; bust: string }
  let shots: Shot[]
  if (listed && listed.length > 0) {
    // Disk says: this is everything that belongs to this practitioner's
    // dossier — site-level + own. Per-file mtime bust catches re-Taste.
    shots = listed.map((s) => ({ url: s.url, label: s.label, bust: `?t=${s.mtime}` }))
  } else {
    // Fallback (list 404 / network) — render whatever scout_json knows.
    const tsBust = cap.capturedAt ? `?t=${encodeURIComponent(cap.capturedAt)}` : ''
    shots = []
    if (cap.profilePageUrl) shots.push({ url: cap.profilePageUrl, label: 'practitioner page', bust: tsBust })
    shots.push({ url: cap.fullPageUrl, label: 'main', bust: tsBust })
    if (cap.innerPageUrl)   shots.push({ url: cap.innerPageUrl,   label: 'inner page',        bust: tsBust })
  }

  return (
    <div className="scout-shot ok">
      <span className="lbl">
        Puppeteer · {shots.length} shot{shots.length === 1 ? '' : 's'}
        {cap.capturedAt ? <span className="ts"> · {new Date(cap.capturedAt).toLocaleString()}</span> : null}
      </span>
      <div className="scout-shot-imgs">
        {shots.map((s) => (
          <a key={s.url} href={`${s.url}${s.bust}`} target="_blank" rel="noreferrer" className="scout-shot-img" title={s.label}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${s.url}${s.bust}`} alt={s.label} loading="lazy" />
            <span className="scout-shot-cap">{s.label}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── ◓ Scouted rows (right column) — every value is editable ───────────────

// ── ◓ Tasted column (Ralph 2026-06-10 · TASTED redesign, mockup-exact) ───
//
// Layout per Ralph's mockup:
//   VERDICT card (shared VerdictCard) — left: kicker + tag headline + verdict
//     paragraph + › signal bullets (verdict_prose). Right stack: CHF EST.
//     (· N SECTIONS × 300, spans both columns) then PALAT·BUYING and
//     DESIGN·PHOTOS as bar-only meters (n/5 text hidden via scout.css).
//   WHO — full-width italic quote line.
//   PHOTO QUALITY · ART-DIRECTED VS STOCK | DESIGN QUALITY — 2-col prose.
//   WHAT TO PITCH — full-width › rows, trailing «· price» right-aligned green.
//   SWITCHING PAIN — full-width prose.
// Re-Taste lives on the section-head row (parent). gap/heat UI retired.

function ScoutTastedColumn({
  t, sections, sectionsDetail, saveScoutField,
}: {
  t: Taste
  /** The QUERIED sections lamp value ("18 · 5 pages") — feeds the CHF label. */
  sections: string | null
  /** Per-page breakdown ("/ 7 · /angebot 4 · /team 3") — the label's hover citation. */
  sectionsDetail: string | null
  saveScoutField: (section: 'taste' | 'queried', field: string) => (v: string) => Promise<boolean>
}) {
  const tag = verdictTagOf(t)
  const vtone = verdictToneOf(t)
  const palat = palatOf(t)
  const buying = buyingOf(t)
  const photoScore = photoScoreOf(t)
  const legacyPhotosProse = typeof t.photos === 'string' ? t.photos : null
  const chf = typeof t.chf_est === 'number' ? t.chf_est : null
  // Section count for the CHF label ("· 4 SECTIONS × 300") comes ONLY from
  // the QUERIED sections lamp — no derived fallback (Ralph 2026-06-10).
  // Typing a count into the lamp computes an empty estimate; see
  // saveScoutField's sections hook.
  const secCount = sections ? parseInt(sections, 10) : NaN
  // WP-22/21 · the RATE in the working label derives from the data —
  // chf_est ÷ sections, the implied per-section rate (the Consular writes
  // the total; 200–300 by build weight). × 300 is the house anchor until
  // an estimate exists.
  const rate = chf != null && Number.isFinite(secCount) && secCount > 0
    ? Math.round(chf / secCount)
    : 300
  const save = (field: string) => (v: string) => { void saveScoutField('taste', field)(v) }
  return (
    <div className="scout-d-tasted">
      {/* THE shared verdict card — same component Kanban renders. Tone from
          the stored four-value (tag/heat derivations are fallback); the tag
          is free text — the Consular's words. */}
      <VerdictCard
        tone={vtone ?? 'info'}
        onToneCycle={() => {
          // WP-22 tone setter — cycle the STORED four-value without a re-taste.
          const idx = vtone ? VERDICT_TONES.indexOf(vtone) : -1
          save('verdict_tone')(VERDICT_TONES[(idx + 1) % VERDICT_TONES.length])
        }}
        tag={tag ?? '—'}
        onTag={save('verdict_tag')}
        prose={sublineOf(t) ?? ''}
        onProse={save('verdict_subline')}
        prosePlaceholder="One line — what this lead means."
        proseKey={`sv-${sublineOf(t) ?? ''}`}
        proseExtra={
          <BulletRows
            value={t.verdict_prose ?? ''}
            onSave={saveScoutField('taste', 'verdict_prose')}
            placeholder="One bullet per line — scan findings, anything Filippo should see at a glance."
          />
        }
        stats={
          <>
            <div className="scout-d-stat-span">
              <span className="crm-opp-verdict-stat-label" title={sectionsDetail ?? sections ?? undefined}>
                CHF EST.{Number.isFinite(secCount) ? ` · ${secCount} SECTIONS × ${rate}` : ''}
              </span>
              <input
                className="crm-opp-edit crm-opp-verdict-stat-value"
                defaultValue={chf == null ? '' : chf.toLocaleString('de-CH')}
                key={`chf-${chf ?? ''}`}
                placeholder="—"
                onBlur={(e) => save('chf_est')(e.target.value)}
              />
            </div>
            <div title="Budget band — CHF estimate ÷ heads, derived (edit CHF EST.)">
              <span className="crm-opp-verdict-stat-label">PALAT</span>
              <ScoutMeter cls="pal" n={palat} />
            </div>
            <div title="Buying readiness — click a bar to set; Scout seeds from cited evidence, Kanban overrides with observed behaviour">
              <span className="crm-opp-verdict-stat-label">BUYING</span>
              <ScoutMeter cls="exe" n={buying} onSet={(n) => save('buying')(String(n))} />
            </div>
            <div title="Design quality — click a bar to set">
              <span className="crm-opp-verdict-stat-label">DESIGN</span>
              <ScoutMeter cls="pal" n={typeof t.design === 'number' ? t.design : null} onSet={(n) => save('design')(String(n))} />
            </div>
            <div title="Photos quality — click a bar to set">
              <span className="crm-opp-verdict-stat-label">PHOTOS</span>
              <ScoutMeter cls="exe" n={photoScore} onSet={(n) => save('photos')(String(n))} />
            </div>
          </>
        }
      />

      {/* WHO — the portrait, full-width italic quote line. Unified key;
          legacy rows read their palate_choice, writes go to `who`. */}
      <div className="scout-d-block scout-d-who">
        <div className="scout-d-block-l">WHO</div>
        <div className="scout-d-block-v">
          <EditableTextarea
            value={whoOf(t) ?? ''}
            onSave={saveScoutField('taste', 'who')}
            placeholder="—"
            rows={3}
          />
        </div>
      </div>

      {/* PHOTO QUALITY | DESIGN QUALITY — the citations as 2-col prose.
          Legacy rows show their old photos prose in the left column. */}
      <div className="scout-d-quality">
        <div className="scout-d-block">
          <div className="scout-d-block-l">PHOTO QUALITY · ART-DIRECTED VS STOCK</div>
          <div className="scout-d-block-v">
            <EditableTextarea
              value={legacyPhotosProse ?? t.photos_cite ?? ''}
              onSave={saveScoutField('taste', legacyPhotosProse != null ? 'photos' : 'photos_cite')}
              placeholder="—"
              rows={3}
            />
          </div>
        </div>
        <div className="scout-d-block">
          <div className="scout-d-block-l">DESIGN QUALITY</div>
          <div className="scout-d-block-v">
            <EditableTextarea
              value={t.design_cite ?? ''}
              onSave={saveScoutField('taste', 'design_cite')}
              placeholder="—"
              rows={3}
            />
          </div>
        </div>
      </div>

      {/* WHAT TO PITCH — full-width › rows; a trailing «· price» renders
          right-aligned in green (pitch rows carry CHF). Travels to Kanban's
          intel.pitch at promote. */}
      <div className="scout-d-block">
        <div className="scout-d-block-l">WHAT TO PITCH</div>
        <div className="scout-d-block-v">
          <BulletRows
            value={t.pitch ?? ''}
            onSave={saveScoutField('taste', 'pitch')}
            placeholder="One bullet per line — angle / solution / proof point · price"
            withPrice
          />
        </div>
      </div>

      {/* SWITCHING PAIN — how dug-in the incumbent is */}
      <div className="scout-d-block">
        <div className="scout-d-block-l">SWITCHING PAIN</div>
        <div className="scout-d-block-v">
          <EditableTextarea
            value={t.switching_pain ?? ''}
            onSave={saveScoutField('taste', 'switching_pain')}
            placeholder="—"
            rows={2}
          />
        </div>
      </div>
    </div>
  )
}

// ── › bullet rows — display as chevron rows, click to edit as a textarea ──
// (one bullet per line). With `withPrice`, a trailing « · 2'400» / « · 120/mo»
// segment splits off and renders right-aligned in green — pitch rows carry
// CHF (mockup). Same save contract as EditableTextarea.

function BulletRows({
  value, onSave, placeholder, withPrice = false,
}: {
  value: string
  onSave: (v: string) => Promise<boolean>
  placeholder?: string
  withPrice?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const start = () => { setDraft(value); setEditing(true) }
  const commit = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    const ok = await onSave(draft)
    setSaving(false)
    if (ok) setEditing(false)
  }
  const cancel = () => { setDraft(value); setEditing(false) }

  if (editing) {
    return (
      <textarea
        className="scout-edta"
        value={draft}
        rows={Math.max(3, draft.split('\n').length + 1)}
        autoFocus
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
      />
    )
  }
  // Split on real newlines AND literal "\n" sequences — the tool-arg
  // transport sometimes delivers escaped newlines (seen on R1069's pitch:
  // "· 1'400\nContent retainer" rendered as one fused row). Ralph 2026-06-11.
  const lines = value.split(/\n|\\n/).map((l) => l.trim()).filter(Boolean)
  return (
    <div className="scout-d-rows" onClick={start} title="click to edit · ⌘↵ to save">
      {lines.length === 0 ? (
        <span className="scout-edph">{placeholder ?? '—'}</span>
      ) : (
        lines.map((line, i) => {
          let text = line
          let price: string | null = null
          if (withPrice) {
            const m = line.match(/^(.*?)\s*·\s*((?:CHF\s*)?[\d'.,]+(?:\/\w+)?)\s*$/)
            if (m) { text = m[1]; price = m[2] }
          }
          return (
            <div className="scout-d-row" key={i}>
              <span className="scout-d-row-ch">›</span>
              <span className="scout-d-row-t">{text}</span>
              {price ? <span className="scout-d-row-price">{price}</span> : null}
            </div>
          )
        })
      )}
    </div>
  )
}

// ScoutRowsEditable (the pre-2026-06-10 6-row label/value table) was deleted
// with the TASTED redesign — it was already unreferenced after the mockup
// column landed, and it rendered the retired gap/heat band.

// ─────────────────────────────────────────────────────────────────────────
//  Inline-edit atoms — click value to edit · Enter or blur saves · Esc cancels
// ─────────────────────────────────────────────────────────────────────────

/** Field row in the dossier header — label · editable value. */
function Field({
  label, value, onSave, placeholder, decorate,
}: {
  label: string
  value: string | null | undefined
  onSave: (v: string) => Promise<boolean>
  placeholder?: string
  /** Display-mode decoration (e.g. wrap a website value in a clickable <a>).
      Edit mode is always a plain input. Return null to fall through to the
      default text rendering. */
  decorate?: (v: string) => ReactNode
}) {
  return (
    <div className="scout-dhdr-f">
      <span className="scout-dhdr-l">{label}</span>
      <span className="scout-dhdr-v">
        <EditableText value={value ?? ''} onSave={onSave} placeholder={placeholder ?? '—'} decorate={decorate} />
      </span>
    </div>
  )
}

/**
 * Single-line inline edit. Renders the value as plain text until clicked;
 * on click, swaps to an <input>; Enter or blur saves; Esc cancels. Saving
 * disables the input + shows ⌛; error reverts to the previous value and
 * stays in display mode (avoids trapping the user in a stuck edit).
 */
function EditableText({
  value, onSave, placeholder, decorate,
}: {
  value: string
  onSave: (v: string) => Promise<boolean>
  placeholder?: string
  /** Optional render fn for the DISPLAY mode (edit mode is always an input). */
  decorate?: (v: string) => ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  const start = () => {
    setDraft(value)
    setEditing(true)
  }
  const commit = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    const ok = await onSave(draft)
    setSaving(false)
    if (ok) setEditing(false)
    // On failure: stay in edit mode so the user can retry; the draft stays.
  }
  const cancel = () => { setDraft(value); setEditing(false) }

  if (editing) {
    return (
      <input
        className="scout-edin"
        type="text"
        value={draft}
        autoFocus
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
      />
    )
  }
  const shown = value || ''
  // decorate() may return null for empty values to opt into the default
  // placeholder rendering — keeps callers from having to repeat the
  // "if empty show placeholder" branch inside every decorate fn.
  const decorated = decorate ? decorate(shown) : null
  const fallback = shown || <span className="scout-edph">{placeholder ?? '—'}</span>
  return (
    <span className="scout-edsp" onClick={start} title="click to edit">
      {decorated ?? fallback}
    </span>
  )
}

/** Multi-line variant — same model, taller box for the verdict prose. */
function EditableTextarea({
  value, onSave, placeholder, rows = 3,
}: {
  value: string
  onSave: (v: string) => Promise<boolean>
  placeholder?: string
  rows?: number
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  const start = () => { setDraft(value); setEditing(true) }
  const commit = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    const ok = await onSave(draft)
    setSaving(false)
    if (ok) setEditing(false)
  }
  const cancel = () => { setDraft(value); setEditing(false) }

  if (editing) {
    return (
      <textarea
        className="scout-edta"
        value={draft}
        rows={rows}
        autoFocus
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Esc cancels. Enter is a real newline in textarea by default —
          // Cmd/Ctrl-Enter commits (matches most chat UIs).
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
      />
    )
  }
  return (
    <span className="scout-edsp scout-edsp-ml" onClick={start} title="click to edit · ⌘↵ to save">
      {value
        ? <span className="scout-sc-vline">{value}</span>
        : <span className="scout-edph">{placeholder ?? '—'}</span>}
    </span>
  )
}

/**
 * Dropdown variant of EditableText (Ralph 2026-06-03 · for the Region field).
 *
 * Display mode: same span-onClick-to-start pattern as EditableText.
 * Edit mode: renders a <select> populated from `options`. The list also
 * includes a "+ Other…" entry — picking it swaps to a plain text <input>
 * so the user can type a brand-new value not yet in the pool (a fresh
 * bezirk from a new import). Save (blur/Enter) writes the chosen string;
 * cancel (Esc) reverts.
 */
function EditableSelect({
  value, onSave, options, placeholder,
}: {
  value: string
  onSave: (v: string) => Promise<boolean>
  options: string[]
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [customMode, setCustomMode] = useState(false)

  const start = () => {
    setDraft(value)
    setEditing(true)
    setCustomMode(false)
  }
  const commit = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    const ok = await onSave(draft.trim())
    setSaving(false)
    if (ok) setEditing(false)
  }
  const cancel = () => { setDraft(value); setEditing(false); setCustomMode(false) }

  if (editing) {
    if (customMode) {
      // Custom-value path: free text. Pressing Enter commits, Esc cancels.
      return (
        <input
          className="scout-edin"
          type="text"
          value={draft}
          autoFocus
          disabled={saving}
          placeholder="new region name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
        />
      )
    }
    // Build the <select> with the current value forced into the list (even
    // if it's not in `options` — guards against orphan bezirks from old
    // imports that have since been edited out of the available set).
    const opts = [...options]
    if (draft && !opts.includes(draft)) opts.unshift(draft)
    return (
      <select
        className="scout-edsel"
        value={draft}
        autoFocus
        disabled={saving}
        onChange={(e) => {
          if (e.target.value === '__custom__') {
            setCustomMode(true)
            setDraft('')
          } else {
            setDraft(e.target.value)
          }
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
      >
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__custom__">+ Other…</option>
      </select>
    )
  }

  return (
    <span className="scout-edsp" onClick={start} title="click to choose">
      {value || <span className="scout-edph">{placeholder ?? '—'}</span>}
    </span>
  )
}

// EditableNumber (the "[n]" bracket editor) was deleted 2026-06-10 — the
// 0–5 scores are set by clicking the meter segments directly (ScoutMeter
// onSet, same interaction as Kanban's BUYING bars).
