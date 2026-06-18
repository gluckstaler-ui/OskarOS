'use client'
// ============================================================================
// ScoutRow — one card in the pool list (WP-SCOUT-7, Ralph 2026-06-03).
//
// One row per lead. Top line = imported contact (name · region · phone ·
// email · website). The "scout strip" beneath fills in once the row is
// tasted: Palate · Execution · the named choice · Gap/heat · the 5-dot
// Intel strip. States (derived):
//   raw         → "select then Taste →" placeholder
//   tasting     → spinner + transient `tasting <domain>…` line
//   scouted     → full strip
//   greenfield  → "no web presence" pursue/skip chip
//
// Pixel/CSS lives in app/crm/scout.css under .scout-lc* — kept consistent
// with the canonical mockup at docs/2026-06-03-scout-mockup/real-pool-2.html.
// ============================================================================

import type { ReactNode } from 'react'
import {
  type RawProspect, type Taste, type Queried,
  scoutOf, stateOf, verdictTagOf, verdictToneOf, payloadOf, tone, pursueOf,
} from './types'
import { ScoutDossier } from './ScoutDossier'
import { Feather } from '@/components/Feather'

interface Props {
  p: RawProspect
  selected: boolean
  open: boolean
  tasting: boolean
  onToggleSelect: (id: string) => void
  onToggleOpen: (id: string) => void
  /** Reload the pool after an inline edit / un-scout from the dossier. */
  onChanged?: () => void
  /** Distinct bezirks present in the pool — feeds the dossier's Region dropdown. */
  availableRegions?: string[]
  /** Ralph 2026-06-05 · Gemeinschaftspraxis flag computed pool-wide.
   *  `strong` = ≥2 pool rows share this row's domain (count = members in pool).
   *  `soft`   = text signal only (Praxisgem / Gruppen / Therapiezentrum etc.)
   *             — 1 member visible in the pool, others may exist but aren't here. */
  sharedPractice?: { tier: 'strong' | 'soft'; count: number } | null
}

export function ScoutRow({ p, selected, open, tasting, onToggleSelect, onToggleOpen, onChanged, availableRegions, sharedPractice }: Props) {
  const st = stateOf(p)
  const pl = payloadOf(p)
  const showText = (v: string): ReactNode =>
    v ? <span className="scout-ct">{v}</span> : <span className="scout-ct none">—</span>

  return (
    <article className={`scout-lc ${st}${selected ? ' sel' : ''}${open ? ' open' : ''}`}>
      <div className="scout-lc-body" onClick={() => onToggleOpen(p.id)}>
        <div className="scout-lc-top">
          {/* Select checkbox — stopPropagation so the click doesn't bubble
              into the row's "open dossier" gesture. */}
          <span
            className={`scout-chk${selected ? ' on' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(p.id) }}
          >
            <CheckSvg />
          </span>
          {/* Ralph 2026-06-03 · single-line identity. Name (bold) + Company
              (regular) + Region pill + Industry, ALL inline — was two-line
              stack with the country code shown as the pill. The pill now
              reflects raw_payload.bezirk (the actual region: "Zürich" /
              "Baden" / "Dietikon" / "Freiamt"), falling back to .region for
              imports that use that key. Country ("CH") is intentionally
              dropped from the row — every imported lead is Swiss; the tag is
              dead pixels at row scale. */}
          <div className="scout-lc-id">
            {p.name ? <span className="scout-nm">{p.name}</span> : null}
            {p.company ? <span className="scout-co">{p.company}</span> : null}
            {!p.name && !p.company ? <span className="scout-nm">—</span> : null}
            {(pl.bezirk || pl.region) ? <span className="scout-reg">{pl.bezirk || pl.region}</span> : null}
            {/* Ralph 2026-06-05 · Gemeinschaftspraxis chip. STRONG (filled,
                amber) when ≥2 pool rows share this domain (shows the
                in-pool count); SOFT (outlined) when only a text signal
                fired ("Gruppenpraxis", "Praxisgem", "Therapiezentrum" …)
                without a 2nd member in the pool. Title shows the
                explanation for hover. */}
            {/* Ralph 2026-06-09 · Praxis-Typ-Chip. GROUP (gefüllt, amber) wenn
                ≥2 Pool-Zeilen die Domain teilen (zeigt den Count); SOLO
                (umrandet) sonst. Labels SOLO/GROUP bleiben Englisch (Ralph). */}
            {sharedPractice ? (
              <span
                className={`scout-prac-chip group ${sharedPractice.tier}`}
                title={sharedPractice.tier === 'strong'
                  ? `Gemeinschaftspraxis — ${sharedPractice.count} im Pool an dieser Adresse`
                  : 'Gemeinschaftspraxis (Text-Signal · nur 1 im Pool)'}
              >
                <span className="prac-n">{sharedPractice.tier === 'strong' ? sharedPractice.count : '?'}</span>
                GROUP
              </span>
            ) : (
              <span className="scout-prac-chip solo" title="Einzelpraxis">
                <span className="prac-n">1</span>
                SOLO
              </span>
            )}
            {/* Verfügbarkeit → in die Zeile-2-Statusanzeige verschoben (Ralph 2026-06-09). */}
            {(pl.typ || p.industry) ? <span className="scout-ind">{practiceCategory(p, pl)}</span> : null}
          </div>
          {/* Ralph 2026-06-09 · Kompaktkontakt. Telefon/E-Mail nur als Feather-
              Icon (wenn vorhanden) — die Nummer/Adresse lebt im Dossier. Adresse
              ganz aus der Zeile entfernt. Website = bereinigte Domain; bei nur
              vermuteter (ko-lozierter) Site "vermutlich" davor. */}
          <div className="scout-lc-contact">
            {p.phone ? <Feather name="phone" size={13} className="scout-ci" /> : null}
            {p.email ? <Feather name="mail" size={13} className="scout-ci" /> : null}
            {p.website
              ? <a
                  className={`scout-web${pl.website_probably ? ' probable' : ''}`}
                  href={normalizeWebUrl(p.website)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={pl.website_probably ? 'Kollokation — vermutete Praxis-Site, noch nicht per Websuche bestätigt' : p.website}
                ><Feather name="external-link" size={12} className="scout-ci" /> <span className="dom">{pl.website_probably ? 'vermutlich ' : ''}{displayDomain(p.website)}</span></a>
              : <span className={`scout-gftag${pursueOf(p) === 'low' ? ' low' : ''}`}>keine Website</span>}
          </div>
          <span className="scout-exp"><Feather name="chevron-down" size={14} /></span>
        </div>
        <ScoutStrip p={p} tasting={tasting} />
      </div>
      {open ? <div className="scout-lc-detail"><ScoutDossier p={p} onChanged={onChanged} availableRegions={availableRegions} /></div> : null}
    </article>
  )
}

// ── The scout strip — the second line on a card ───────────────────────────

function ScoutStrip({ p, tasting }: { p: RawProspect; tasting: boolean }) {
  if (tasting) {
    return (
      <div className="scout-lc-scout">
        <span className="scout-tasting">
          <span className="spin" /> tastet {p.website}…{' '}
          <span style={{ color: 'var(--text-dim)' }}>öffnen · lesen · den Gap halten</span>
        </span>
      </div>
    )
  }
  const pl = payloadOf(p)
  const sc = scoutOf(p)
  const t: Taste = sc.taste ?? {}
  const q: Queried = sc.queried ?? {}
  // Ralph 2026-06-10 (TASTED redesign) — the verdict tag replaces gap/heat.
  // Tag = free text (the Consular's words); color from the stored TONE.
  const vt = verdictTagOf(t)
  const vtone = verdictToneOf(t)
  const tasted = vt != null                          // ◓ hat ein Taste-Verdikt
  const hasWebsite = !!p.website
  // Verfügbarkeit → 3 Zustände (Helena-Mockup): OFFEN ● · Warteliste ◐ · VOLL ○.
  // Strukturiertes availability_status (1471 Zeilen) STATT des spärlichen
  // verfuegbarkeit-Texts (292): open → OFFEN · limited → Warteliste · closed → VOLL.
  // Dauer aus availability_label (z. B. "2–4 Wochen Wartezeit").
  const plx = pl as Record<string, unknown>
  const availStatus = String(plx.availability_status || '').toLowerCase()
  const verf = String(plx.availability_label || '').trim()
  let statusKind: 'open' | 'waitlist' | 'full' | null = null
  let waitDur = ''
  if (availStatus === 'closed') statusKind = 'full'
  else if (availStatus === 'open') statusKind = 'open'
  else if (availStatus === 'limited') {
    statusKind = 'waitlist'
    const m = verf.match(/(<\s*\d+|≥\s*\d+|\d+\s*[–-]\s*\d+|\d+\+?)/)
    if (m) waitDur = m[1].replace(/\s+/g, '')
  }
  return (
    <div className="scout-lc-scout">
      {tasted ? (
        <div className="scout-sc-verdict">
          {/* Verdict tag in the old heat chip's slot — free-text tag, color
              from the stored four-value tone. Gap number retired. */}
          <span className={`scout-vchip t-${vtone ?? 'pend'}`}>
            {vt ?? '—'}
          </span>
        </div>
      ) : null}
      {/* Helena-Mockup · Status (OFFEN ● / Warteliste ◐ / VOLL ○) · Alter ·
          Stack · Hosting. Ohne Website: "keine Seite · keine Seite". */}
      <div className="scout-q-facts">
        {statusKind === 'open' ? (
          <span className="scout-q-status open" title={verf}>● OFFEN <span className="sub">nimmt auf</span></span>
        ) : statusKind === 'waitlist' ? (
          <span className="scout-q-status wait" title={verf}>
            ◐ {waitDur ? <>{waitDur} Wo. <span className="sub">Warteliste</span></> : 'Warteliste'}
          </span>
        ) : statusKind === 'full' ? (
          <span className="scout-q-status full" title={verf}>○ VOLL <span className="sub">keine neuen</span></span>
        ) : null}
        {hasWebsite ? (
          <>
            <span className={`scout-q-fact${q.age ? '' : ' unknown'}`}>{q.age || 'Alter unbekannt'}</span>
            {q.stack ? <span className="scout-q-fact"><i className={`qdot tone-${tone('stack', q.stack)}`} /> {q.stack}</span> : null}
            {q.hosting ? <span className="scout-q-fact">{q.hosting}</span> : null}
            {/* WP-22 · sections show on the collapsed row once scanned; the
                full label ("18 · 5 pages") rides in the hover title. */}
            {q.sections ? <span className="scout-q-fact" title={q.sections}>{parseInt(q.sections, 10)} Sections</span> : null}
          </>
        ) : (
          <>
            <span className="scout-q-fact unknown">keine Seite</span>
            <span className="scout-q-fact unknown">keine Seite</span>
          </>
        )}
      </div>
      {/* PERF/SEO/TRAFFIC — unverändert (Google-Zahlen, read-only). */}
      <div className="scout-sc-intel">
        <ScoreSegMeter name="PERF"    lkey="performance" val={q.performance} />
        <ScoreSegMeter name="SEO"     lkey="seo"         val={q.seo} />
        <ScoreSegMeter name="TRAFFIC" lkey="traffic"     val={q.traffic} />
      </div>
    </div>
  )
}

// ── ScoreSegMeter — 5-segment meter for PERF / SEO / TRAFFIC (0-100) ─────
//
// Same visual atom as palate/exec ScoutMeter but for 0-100 scores. The
// score's tier (good/mid/low/bad/info per the tone() function) drives
// BOTH the count of lit segments AND their color — single color per
// meter, no gradient. Traffic is special: the LCP-based suffix word
// (fast/ok/slow/poor/thin) maps to a faux-percentage so the bar fill
// reflects the qualitative tier.
function ScoreSegMeter({ name, lkey, val }: { name: string; lkey: string; val: string | null | undefined }) {
  const t = tone(lkey, val)
  let score = 0
  let scoreText = '—'
  if (val) {
    const n = +(val.replace(/[^\d.]/g, '').split('.')[0] || '0')
    if (Number.isFinite(n) && n > 0) {
      if (lkey === 'traffic') {
        // Map the suffix word to a faux-percentage; show LCP seconds (e.g. "2.8s")
        // as the number so the user still sees the raw metric.
        score = /fast/i.test(val) ? 95 : /·\s*ok\b/i.test(val) ? 75 : /slow/i.test(val) ? 55 : /poor/i.test(val) ? 25 : 0
        scoreText = val.match(/(\d+\.?\d*s)/)?.[1] ?? String(Math.round(score))
      } else {
        score = Math.max(0, Math.min(100, n))
        scoreText = String(score)
      }
    } else if (/thin|below CrUX/i.test(val)) {
      scoreText = 'thin'
    }
  }
  // Map 0-100 → 0-5 segments using Google's Lighthouse-style tier boundaries.
  const segs = score >= 90 ? 5 : score >= 70 ? 4 : score >= 50 ? 3 : score >= 30 ? 2 : score > 0 ? 1 : 0
  return (
    <span className={`scout-ssm tone-${t || 'info'}`} title={val ?? '—'}>
      <span className="scout-ssm-name">{name}</span>
      <span className="scout-ssm-bottom">
        <span className="scout-ssm-segs">
          {[1, 2, 3, 4, 5].map((i) => (
            <i key={i} className={`scout-ssm-seg${i <= segs ? ' on' : ''}`} />
          ))}
        </span>
        <span className="scout-ssm-n">{scoreText}</span>
      </span>
    </span>
  )
}

// ── URL normalization — the imported websites can be scheme-less ("foo.ch")
//    or already-full ("https://foo.ch/path"). Same rule as the capture
//    pipeline uses (lib/screenshot.ts treats a no-scheme input as https://).
//    Keep this in lockstep with the dossier header's website field so the
//    two click paths resolve to the same URL.
export function normalizeWebUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s.replace(/^\/\//, '')}`
}

// ── Display-only domain — strip scheme, www., and any path/trailing slash so
//    the row shows "studiokyma.ch" not "https://www.studiokyma.ch/". The click
//    path still uses normalizeWebUrl. Client-safe (no node imports).
// Ralph 2026-06-09 · Ärzte sind PSYCHIATER, NICHT Psychotherapeuten. Ein
// "Dr. med." / "Facharzt"·"Fachärztin (FMH) Psychiatrie" ist Mediziner →
// Kategorie "Psychiatrie". Sonst die (germanisierte) Branche/FSP-Typ wie gehabt.
export function practiceCategory(
  p: { name?: string; industry?: string },
  pl: Record<string, unknown>,
): string {
  const blob = `${p.name ?? ''} ${String(pl.typ ?? '')} ${p.industry ?? ''}`.toLowerCase()
  if (/\bdr\.?\s*med\b|facharzt|fachärztin|\bfmh\b|psychiatr/.test(blob)) return 'Psychiatrie'
  return germanizeIndustry(String(pl.typ || p.industry || ''))
}

// Ralph 2026-06-09 · Branche auf Deutsch. Die Daten tragen "psychology" /
// "Psychotherapy" (Englisch, aus dem Import); anzeige-seitig germanisieren.
// Der FSP-Typ (pl.typ) ist bereits deutsch und bleibt unverändert.
export function germanizeIndustry(raw: string): string {
  const t = (raw || '').trim()
  if (/^psychology$/i.test(t)) return 'Psychologie'
  if (/^psychotherapy$/i.test(t)) return 'Psychotherapie'
  return t
}

export function displayDomain(raw: string): string {
  return (raw || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
}

// ── Inline check SVG — kept here so the row file is self-contained. ────

function CheckSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
