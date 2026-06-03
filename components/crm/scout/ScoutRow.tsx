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
  scoutOf, stateOf, gapOf, heatOf, payloadOf, tone, pursueOf,
} from './types'
import { ScoutMeter } from './ScoutMeter'
import { ScoutDossier } from './ScoutDossier'

interface Props {
  p: RawProspect
  selected: boolean
  open: boolean
  tasting: boolean
  onToggleSelect: (id: string) => void
  onToggleOpen: (id: string) => void
}

export function ScoutRow({ p, selected, open, tasting, onToggleSelect, onToggleOpen }: Props) {
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
          <div className="scout-lc-id">
            <div className="scout-nm">{p.name || p.company || '—'}</div>
            <div className="scout-typ">
              <span className="scout-reg">{pl.region || p.country}</span>
              {pl.typ || p.industry}
            </div>
          </div>
          <div className="scout-lc-contact">
            ☎&nbsp;{showText(p.phone)}<span className="dot">·</span>
            ✉&nbsp;{showText(p.email)}<span className="dot">·</span>
            ⌂&nbsp;<span className="adr">{pl.adr || '—'}</span><span className="dot">·</span>
            {p.website
              ? <a className="scout-web" onClick={(e) => e.stopPropagation()}>↗ {p.website}</a>
              : <span className={`scout-gftag${pursueOf(p) === 'low' ? ' low' : ''}`}>keine Website</span>}
          </div>
          <span className="scout-exp">⌄</span>
        </div>
        <ScoutStrip p={p} tasting={tasting} />
      </div>
      {open ? <div className="scout-lc-detail"><ScoutDossier p={p} /></div> : null}
    </article>
  )
}

// ── The scout strip — the second line on a card ───────────────────────────

function ScoutStrip({ p, tasting }: { p: RawProspect; tasting: boolean }) {
  if (tasting) {
    return (
      <div className="scout-lc-scout">
        <span className="scout-tasting">
          <span className="spin" /> tasting {p.website}…{' '}
          <span style={{ color: 'var(--text-dim)' }}>opening · reading · holding the gap</span>
        </span>
      </div>
    )
  }
  const st = stateOf(p)
  if (st === 'greenfield') {
    const pursue = pursueOf(p)
    return (
      <div className="scout-lc-scout green">
        <span className={`scout-pursue ${pursue}`}>{pursue === 'high' ? 'pursue ↑' : 'low priority'}</span>
        <span className="gfnote">No web presence — nothing to displace, you set the first impression.</span>
      </div>
    )
  }
  if (st === 'raw') {
    return (
      <div className="scout-lc-scout raw">
        <span className="rawmsg">— not scouted yet —</span>
        <span className="pickhint">select, then Taste →</span>
      </div>
    )
  }
  // st === 'scouted' — read the parsed scout_json once.
  const sc = scoutOf(p)
  const t: Taste = sc.taste ?? {}
  const q: Queried = sc.queried ?? {}
  const g = gapOf(t)
  const h = heatOf(t)
  const pending = typeof t.palate !== 'number'
  return (
    <div className="scout-lc-scout">
      <div className="scout-sc-verdict">
        <span className={`scout-vchip ${h ?? 'pend'}`}>
          {h === 'hot' ? '🔥 HOT' : h === 'warm' ? 'Warm' : h === 'cold' ? 'Cold' : '◐ Queried'}
        </span>
        <span className={`scout-gap ${h ?? 'cold'}`}>
          {g == null ? '—' : `${g > 0 ? '+' : ''}${g}`}
        </span>
      </div>
      <div className="scout-sc-meters">
        <span className="scout-m"><span className="scout-ml">Palate</span><ScoutMeter cls="pal" n={t.palate} /></span>
        <span className="scout-m"><span className="scout-ml">Exec</span><ScoutMeter cls="exe" n={t.execution} /></span>
      </div>
      <div className="scout-sc-choice">
        {t.palate_choice
          ? <><span className="q">“</span>{t.palate_choice}<span className="q">”</span></>
          : <span style={{ color: 'var(--text-dim)' }}>{pending ? 'visual taste pending' : '—'}</span>}
      </div>
      <div className="scout-sc-intel">
        <Lampstrip q={q} />
        <span className="il">intel</span>
      </div>
    </div>
  )
}

// ── Compact 5-dot Intel strip (Age · Stack · Host · Perf · SEO) ──────────

function Lampstrip({ q }: { q: Queried }) {
  return (
    <span className="scout-lampstrip" title="Age · Stack · Host · Perf · SEO">
      {(['age', 'stack', 'hosting', 'performance', 'seo'] as const).map((k) => (
        <span key={k} className={`scout-ld ${tone(k, q[k])}`} />
      ))}
    </span>
  )
}

// ── Inline check SVG — kept here so the row file is self-contained. ────

function CheckSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
