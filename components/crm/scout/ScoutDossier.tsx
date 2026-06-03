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
// The screenshots are real now (WP-SCOUT-2 ships `captureUrl`): when
// `scout_json.capture.{fullPageUrl,innerPageUrl}` is present we render the
// real images; pre-WP-5 rows (no capture yet) get the empty-state copy.
// ============================================================================

import { type ReactNode } from 'react'
import {
  type RawProspect, type Taste, type Queried, type Capture,
  scoutOf, stateOf, gapOf, heatOf, payloadOf, tone, QUERIED_SOURCES,
} from './types'
import { ScoutMeter } from './ScoutMeter'

interface Props {
  p: RawProspect
}

export function ScoutDossier({ p }: Props) {
  const pl = payloadOf(p)
  const sc = scoutOf(p)
  const t = sc.taste ?? {}
  const q = sc.queried ?? {}
  const cap = sc.capture ?? {}
  const st = stateOf(p)
  const g = gapOf(t)
  const h = heatOf(t)

  // ── Greenfield: no website → nothing to fetch, nothing to taste.
  if (st === 'greenfield') {
    return (
      <div className="scout-dgrid2">
        <div>
          <div className="scout-dlabel">◐ Queried — code fetches it · no LLM</div>
          <div className="scout-qline">
            No domain on record → nothing to fetch. The queried layer is empty
            by definition — there is no site yet.
          </div>
        </div>
        <div>
          <div className="scout-dlabel">◓ Scouted — the agent&apos;s read</div>
          <div className="scout-gfbig">◇ Greenfield — no site to taste</div>
          <div className="scout-gfnote2">{pl.adr || ''}</div>
          <div className="scout-qline">
            Nothing to displace — you set the first impression. Decision is
            pursue / skip.
          </div>
        </div>
      </div>
    )
  }

  // ── Raw (untasted): the queued state.
  if (st === 'raw') {
    return (
      <div className="scout-dgrid2">
        <div>
          <div className="scout-dlabel">◐ Queried — code fetches it · no LLM</div>
          <div className="scout-qline">
            Rides along free on Taste — Age · Stack · Hosting (and Perf · SEO · Traffic
            once the keys land), plus the screenshot the taste judges.
          </div>
        </div>
        <div>
          <div className="scout-dlabel">◓ Scouted — the agent tastes it</div>
          <div className="scout-qline">
            Not scouted yet. Select the card and press <b>Taste</b> — the agent
            returns Palate · Execution · the named choice · Verdict · Photos.
          </div>
        </div>
      </div>
    )
  }

  // ── Scouted: the full dossier.
  return (
    <div className="scout-dgrid2">
      <div>
        <div className="scout-dlabel">◐ Queried — code fetches it · deterministic, no LLM</div>
        <div className="scout-lamps2">
          <Lamp name="Age"       lkey="age"         val={q.age}         />
          <Lamp name="Stack"     lkey="stack"       val={q.stack}       />
          <Lamp name="Hosting"   lkey="hosting"     val={q.hosting}     />
          <Lamp name="Perf"      lkey="performance" val={q.performance} />
          <Lamp name="SEO"       lkey="seo"         val={q.seo}         />
          <Lamp name="Traffic"   lkey="traffic"     val={q.traffic}     />
          <Lamp name="Trackers"  lkey="trackers"    val={q.trackers}    />
          <Lamp name="Booking"   lkey="booking"     val={q.booking}     />
          <Lamp name="Langs"     lkey="languages"   val={q.languages}   />
        </div>
        {p.website ? <ScreenshotBlock cap={cap} /> : null}
      </div>
      <div>
        <div className="scout-dlabel">◓ Scouted — the agent tastes it · jedi-scout.md</div>
        <ScoutRows t={t} g={g} h={h} />
      </div>
    </div>
  )
}

// ── ◐ Queried lamp (one row in the 3×3 lamp grid) ────────────────────────

function Lamp({ name, lkey, val }: { name: string; lkey: string; val: string | null | undefined }) {
  return (
    <div className="scout-lamp2">
      <span className={`scout-ld ${tone(lkey, val)}`} />
      <span className="ln">{name}</span>
      <span className="lsrc">{QUERIED_SOURCES[lkey]}</span>
      <span className="lv">{val ?? '—'}</span>
    </div>
  )
}

// ── Puppeteer screenshot block (WP-SCOUT-2 wiring) ───────────────────────

function ScreenshotBlock({ cap }: { cap: Capture }) {
  // No capture yet: pre-WP-5 row, or the Taste hasn't been triggered.
  if (!cap.fullPageUrl) {
    return (
      <div className="scout-shot">
        <span className="lbl">Puppeteer · full-page + 1 inner</span>
        <span className="empty">— not yet captured — runs with Taste —</span>
      </div>
    )
  }
  // Capture failed (SSRF guard, timeout, unreachable host): surface the reason.
  if (cap.failed) {
    return (
      <div className="scout-shot failed">
        <span className="lbl">Puppeteer · capture failed</span>
        <span className="reason">{cap.fail_reason || 'unknown failure'}</span>
      </div>
    )
  }
  return (
    <div className="scout-shot ok">
      <span className="lbl">
        Puppeteer · full-page{cap.innerPageUrl ? ' + 1 inner' : ''}
        {cap.capturedAt ? <span className="ts"> · {new Date(cap.capturedAt).toLocaleString()}</span> : null}
      </span>
      <div className="scout-shot-imgs">
        <a href={cap.fullPageUrl} target="_blank" rel="noreferrer" className="scout-shot-img">
          {/* The full-page screenshot — clickable to open at native res. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cap.fullPageUrl} alt="full page" loading="lazy" />
        </a>
        {cap.innerPageUrl ? (
          <a href={cap.innerPageUrl} target="_blank" rel="noreferrer" className="scout-shot-img">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cap.innerPageUrl} alt="inner page" loading="lazy" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

// ── ◓ Scouted rows (the right column) ────────────────────────────────────

function ScoutRows({ t, g, h }: { t: Taste; g: number | null; h: ReturnType<typeof heatOf> }) {
  const hl = h === 'hot' ? '🔥 HOT' : h === 'warm' ? 'Warm' : h === 'cold' ? 'Cold' : '◐ Queried'
  const Row = ({ label, value, cls = '' }: { label: string; value: ReactNode; cls?: string }) => (
    <div className={`scout-sc-r ${cls}`}>
      <span className="scout-sc-l">{label}</span>
      <span className="scout-sc-v">{value}</span>
    </div>
  )
  return (
    <div className="scout-sc-rows">
      <Row label="Palate /5" value={
        <>
          <ScoutMeter cls="pal" n={t.palate} />
          <span className="scout-sc-note">Sip 1 — does the maker have an eye, a point of view</span>
        </>
      } />
      <Row label="Execution /5" value={
        <>
          <ScoutMeter cls="exe" n={t.execution} />
          <span className="scout-sc-note">Sip 2 — does it hold below the fold, or break</span>
        </>
      } />
      <Row label="Gap" value={
        <>
          <span className={`scout-gap ${h ?? 'cold'}`} style={{ fontSize: 16 }}>
            {g == null ? '—' : `${g > 0 ? '+' : ''}${g}`}
          </span>
          <span className={`scout-vchip ${h ?? 'pend'}`}>{hl}</span>
          <span className="scout-sc-note">palate − execution → heat band</span>
        </>
      } />
      <Row label="The choice" value={
        t.palate_choice
          ? <span className="scout-sc-quote">“{t.palate_choice}”</span>
          : <span style={{ color: 'var(--text-dim)' }}>—</span>
      } />
      <Row label="Photos" value={
        <>
          {t.photos ? <span className={`scout-ld ${tone('photos', t.photos)}`} style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : null}
          {' '}{t.photos || '—'}
          <span className="scout-sc-note">art-directed vs stock</span>
        </>
      } />
      <Row label="Verdict" cls="verdict" value={
        <span className="scout-sc-vline">{t.verdict || '—'}</span>
      } />
    </div>
  )
}
