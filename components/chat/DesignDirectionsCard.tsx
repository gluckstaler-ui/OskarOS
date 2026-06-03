/**
 * DesignDirectionsCard — Phase 2 entry card / Phase 1 close.
 *
 * Source-of-truth mockup: docs/tc-design-directions-mockup.html (2026-05-21).
 * Agent contract: agents/creative-director-agent.md § "Strategic Bet" block +
 * § Canonical card payloads `tc_design_directions`.
 *
 * Per tile:
 *   - Convention↔Disruption axis with a 0..1 marker
 *   - bet_name rendered in the bet's display font (22px)
 *   - the_bet rendered in the bet's body font (13px)
 *   - bet_audience rendered in the body font (muted, smaller)
 *   - 4-swatch palette strip + role labels
 *   - mutex block ("MUTEX" label + sentence)
 *
 * Multi-select cap 4 (locked 2026-05-18). On submit the message payload
 * enriches with survivors / killed denorm so Phase 3 amplification can read
 * axis_hook and audience without re-looking up the seeds.
 *
 * TRACK-AGNOSTIC. See INSTITUTIONAL-MEMORY.md "Doctrine drift: track grafted
 * onto tc_design_directions (2nd time)" 2026-05-14.
 */
'use client'

import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesignDirection, Preamble } from '@/lib/types'

interface DesignDirectionsCardProps {
  directions: DesignDirection[]
  preamble?: Preamble
  /** @deprecated — flat-string preamble. Use `preamble: {label, body}` instead. */
  prompt?: string
  onSubmit: (response: {
    picks: string[]
    kill_why: string
    survivors: Array<{
      slug: string
      bet_name: string
      axis_hook: string
      axis_linear_position: number
      audience: string
    }>
    killed: Array<{ slug: string; bet_name: string }>
  }) => void
}

const CAP = 4

/**
 * Extract a Google-Fonts-loadable family name from a CSS font-family value.
 * Input examples:
 *   'Playfair Display'                      → 'Playfair Display'
 *   '"Space Mono", monospace'               → 'Space Mono'
 *   'Newsreader, serif'                     → 'Newsreader'
 *   'Manrope'                               → 'Manrope'
 * Generic families (serif / sans-serif / monospace / system-ui) are filtered
 * out by the caller — they don't need loading.
 */
function primaryFamily(cssFamily: string): string {
  const first = cssFamily.split(',')[0]?.trim() ?? ''
  return first.replace(/^["']|["']$/g, '')
}

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'inherit', 'initial', 'unset',
])

export function DesignDirectionsCard({
  directions,
  preamble,
  prompt,
  onSubmit,
}: DesignDirectionsCardProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [killWhy, setKillWhy] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Web-font loading ─────────────────────────────────────────────────
  // Google Fonts is the redistributable baseline for the card — any
  // family CD names gets loaded via a single <link> on mount. Hosted
  // Linotype families (Univers, Sabon, etc.) resolve via the cascade
  // when hosted-fonts.css is already loaded in the panel; we don't gate.
  useEffect(() => {
    const families = new Set<string>()
    for (const dir of directions) {
      for (const css of [dir.fonts.display, dir.fonts.body]) {
        const fam = primaryFamily(css)
        if (fam && !GENERIC_FAMILIES.has(fam.toLowerCase())) families.add(fam)
      }
    }
    if (families.size === 0) return

    const param = Array.from(families)
      .map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`)
      .join('&')
    const href = `https://fonts.googleapis.com/css2?${param}&display=swap`

    // Dedupe by href — multiple cards in the same session shouldn't stack links.
    const existing = document.querySelector(`link[data-dd-fonts="${href}"]`)
    if (existing) return

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.ddFonts = href
    document.head.appendChild(link)
  }, [directions])

  function showWarning(msg: string) {
    setWarning(msg)
    if (warningTimer.current) clearTimeout(warningTimer.current)
    warningTimer.current = setTimeout(() => setWarning(null), 1400)
  }

  function toggle(slug: string) {
    if (submitted) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
      } else if (next.size < CAP) {
        next.add(slug)
      } else {
        showWarning('At cap (4). Deselect one to swap.')
        return prev
      }
      return next
    })
  }

  function handleSubmit() {
    if (submitted || selected.size !== CAP) return
    setSubmitted(true)
    const survivors = directions
      .filter((d) => selected.has(d.slug))
      .map((d) => ({
        slug: d.slug,
        bet_name: d.bet_name,
        axis_hook: d.axis_hook,
        axis_linear_position: d.axis_linear.position,
        audience: d.bet_audience,
      }))
    const killed = directions
      .filter((d) => !selected.has(d.slug))
      .map((d) => ({ slug: d.slug, bet_name: d.bet_name }))
    onSubmit({
      picks: Array.from(selected),
      kill_why: killWhy.trim(),
      survivors,
      killed,
    })
  }

  const counterStatus = useMemo<{ text: string; tone: 'warning' | 'ready' }>(() => {
    if (warning) return { text: warning, tone: 'warning' }
    if (selected.size === CAP) return { text: '✓ Ready to send to wireframes', tone: 'ready' }
    return { text: `Pick ${CAP - selected.size} more`, tone: 'warning' }
  }, [selected, warning])

  if (!Array.isArray(directions) || directions.length === 0) return null

  return (
    <div className="tool-card design-directions" data-style="design-directions">
      {/* Header */}
      <div className="tool-card-head">
        <span className="tool-card-icon" aria-hidden>DD</span>
        <div className="tool-card-head-text">
          <span className="tool-card-title">Strategic Bets</span>
          <span className="tool-card-meta">Opens Phase 2 — gates the wireframe build</span>
        </div>
        <span className="tool-card-pill">PICK 4</span>
      </div>

      {/* Preamble — CD speaking */}
      {preamble ? (
        <div className="dd-preamble">
          <span className="dd-preamble-label">{preamble.label}</span>
          <span className="dd-preamble-body">{preamble.body}</span>
        </div>
      ) : prompt ? (
        <div className="dd-preamble">
          <span className="dd-preamble-label">CD speaking</span>
          <span className="dd-preamble-body">{prompt}</span>
        </div>
      ) : null}

      {/* Grid */}
      <div className="dd-grid">
        {directions.map((dir) => {
          const isSelected = selected.has(dir.slug)
          const pct = Math.round(dir.axis_linear.position * 100)
          return (
            <div
              key={dir.slug}
              className={`dd-direction${isSelected ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => toggle(dir.slug)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggle(dir.slug)
                }
              }}
              data-slug={dir.slug}
            >
              <span className="dd-check" aria-hidden>✓</span>

              {/* 1. Convention ↔ Disruption axis */}
              <div className="axis-section">
                <div className="axis-spectrum">
                  <div className="marker" style={{ left: `${pct}%` }} />
                </div>
                <div className="axis-poles">
                  <span>{dir.axis_linear.poles[0]}</span>
                  <span>{dir.axis_linear.poles[1]}</span>
                </div>
              </div>

              {/* 2. bet_name in display font */}
              <h3 className="dd-title" style={{ fontFamily: dir.fonts.display }}>
                {dir.bet_name}
              </h3>

              {/* 3. the_bet in body font */}
              <p className="dd-bet" style={{ fontFamily: dir.fonts.body }}>
                {dir.the_bet}
              </p>

              {/* 4. bet_audience in body font, muted */}
              <p className="dd-bet dd-audience-line" style={{ fontFamily: dir.fonts.body }}>
                {dir.bet_audience}
              </p>

              {/* 5. Palette */}
              <div className="dd-palette-wrap">
                <div className="dd-palette">
                  {dir.palette.map((p, i) => (
                    <div key={i} className="dd-palette-bar" style={{ background: p.hex }} />
                  ))}
                </div>
                <div className="dd-palette-roles">
                  {dir.palette.map((p, i) => (
                    <span key={i} title={`${p.role} · ${p.hex}`}>{p.role}</span>
                  ))}
                </div>
              </div>

              {/* 6. Mutex */}
              <div className="dd-mutex">
                <span className="label">Mutex</span>
                {dir.mutex}
              </div>
            </div>
          )
        })}
      </div>

      {/* Counter */}
      <div className="dd-counter">
        <span className="dd-counter-left">Selected: {selected.size} / {CAP}</span>
        <span className={counterStatus.tone === 'ready' ? 'dd-counter-ready' : 'dd-counter-warning'}>
          {counterStatus.text}
        </span>
      </div>

      {/* Textarea */}
      <div className="dd-textarea-wrap">
        <label className="dd-textarea-label" htmlFor="dd-kill-why">
          Why did you kill the ones you killed?
          <span className="hint">— the why amplifies the survivors in Phase 3</span>
        </label>
        <textarea
          id="dd-kill-why"
          className="dd-textarea"
          placeholder="The Jaddah angle felt too sentimental for who we're filtering for. Night Majlis was good but redundant with The Arena."
          value={killWhy}
          onChange={(e) => setKillWhy(e.target.value)}
          disabled={submitted}
        />
      </div>

      {/* CTA */}
      <div className="tool-card-foot">
        <button
          type="button"
          className="tool-card-btn"
          disabled={submitted || selected.size !== CAP}
          onClick={handleSubmit}
        >
          {submitted ? 'Sent ✓' : 'Send 4 to Wireframes →'}
        </button>
      </div>

      <style>{`
        /* ── Yellow avatar + pill (kept) ─────────────────────────────── */
        .design-directions .tool-card-icon {
          width: 28px; height: 28px;
          border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700;
          font-family: monospace;
          background: rgba(245, 197, 66, 0.15);
          color: var(--brand-yellow, #f5c542);
          flex-shrink: 0;
        }
        .design-directions .tool-card-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .design-directions .tool-card-head-text {
          display: flex; flex-direction: column; gap: 2px;
          flex: 1; min-width: 0;
        }
        .design-directions .tool-card-title { font-weight: 600; font-size: 14px; }
        .design-directions .tool-card-meta {
          font-size: 11px;
          color: var(--text-secondary, #b3bcc7);
        }
        .design-directions .tool-card-pill {
          background: rgba(245, 197, 66, 0.15);
          color: var(--brand-yellow, #f5c542);
          font-family: monospace;
          font-size: 10px; font-weight: 700;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 4px;
        }

        /* ── Preamble ────────────────────────────────────────────────── */
        .design-directions .dd-preamble {
          display: flex; flex-direction: column; gap: 4px;
          margin: 0 0 14px;
          padding: 12px 14px;
          border-left: 2px solid var(--brand-cyan, #22d3ee);
          background: rgba(34, 211, 238, 0.04);
          border-radius: 0 8px 8px 0;
        }
        .design-directions .dd-preamble-label {
          font-size: 10px;
          color: var(--brand-cyan, #22d3ee);
          font-family: ui-monospace, SFMono-Regular, monospace;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }
        .design-directions .dd-preamble-body {
          font-size: 13px;
          color: var(--text-main, inherit);
          line-height: 1.55;
        }

        /* ── Grid ─────────────────────────────────────────────────────── */
        .design-directions .dd-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        @media (max-width: 860px) { .design-directions .dd-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 560px) { .design-directions .dd-grid { grid-template-columns: 1fr; } }

        /* ── Tile — single ring renderer (border itself) ──────────────── */
        .design-directions .dd-direction {
          position: relative;
          padding: 14px;
          border-radius: 8px;
          border: 2px solid var(--border-card, #2a2f37);
          background: var(--bg-card, #14181d);
          cursor: pointer;
          display: flex; flex-direction: column;
          gap: 10px;
          transition: border-color 120ms ease, background-color 120ms ease;
          contain: layout style paint;
        }
        .design-directions .dd-direction:hover {
          border-color: var(--text-muted, #7c8794);
          background: var(--surface-2, #1a1f26);
        }
        .design-directions .dd-direction.selected {
          border-color: var(--brand-green-bright, #22c55e);
          background: rgba(34, 197, 94, 0.04);
        }
        .design-directions .dd-check {
          position: absolute;
          top: 8px; right: 8px;
          z-index: 5;
          background: var(--brand-green-bright, #22c55e);
          color: #000;
          font-size: 11px; font-weight: 700;
          width: 18px; height: 18px;
          border-radius: 4px;
          display: flex; align-items: center; justify-content: center;
          opacity: 0;
          transform: scale(0.5);
          transition: opacity 120ms ease, transform 120ms ease;
          pointer-events: none;
        }
        .design-directions .dd-direction.selected .dd-check {
          opacity: 1;
          transform: scale(1);
        }

        /* ── Axis ──────────────────────────────────────────────────────
           Ralph 2026-05-18: when child loses row-flex sibling, audit every
           flex: rule on it. This is column-flex parent now. */
        .design-directions .axis-section { display: flex; flex-direction: column; gap: 4px; }
        .design-directions .axis-spectrum {
          position: relative;
          height: 5px;
          background: var(--border-card, #2a2f37);
          border-radius: 3px;
        }
        .design-directions .axis-spectrum .marker {
          position: absolute;
          top: 50%;
          width: 10px; height: 10px;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          border: 2px solid var(--bg-card, #14181d);
          background: var(--axis-risk, #ef4444);
        }
        .design-directions .axis-poles {
          display: flex; justify-content: space-between;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 9px;
          color: var(--text-secondary, #b3bcc7);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        /* ── Bet name & body — RENDERED in the vibe's actual fonts ─── */
        .design-directions .dd-title {
          font-size: 22px;
          line-height: 1.1;
          padding-right: 24px;
          margin: 0;
        }
        .design-directions .dd-bet {
          font-size: 13px;
          color: var(--text-secondary, #b3bcc7);
          line-height: 1.5;
          margin: 0;
        }
        .design-directions .dd-audience-line {
          color: var(--text-muted, #7c8794) !important;
          font-style: normal;
          font-size: 11.5px;
        }

        /* ── Palette — pushed to bottom via margin-top: auto ──────────
           Ralph 2026-05-18: gives palette + mutex fixed-offset-from-bottom
           layout so palettes align across all 6 tiles regardless of bet
           text length. Combined with .dd-mutex min-height. */
        .design-directions .dd-palette-wrap {
          display: flex; flex-direction: column; gap: 4px;
          margin-top: auto;
        }
        .design-directions .dd-palette {
          display: flex;
          height: 16px;
          border-radius: 3px;
          overflow: hidden;
        }
        .design-directions .dd-palette-bar { flex: 1; }
        .design-directions .dd-palette-roles {
          display: flex; gap: 2px;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 8.5px;
          color: var(--text-muted, #7c8794);
          text-transform: uppercase;
        }
        .design-directions .dd-palette-roles span {
          flex: 1; text-align: center;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        /* ── Mutex — min-height reserves vertical space so all 6 tiles
              are equal-height. See mockup notes Ralph 2026-05-18. ─────── */
        .design-directions .dd-mutex {
          font-size: 10.5px;
          color: var(--text-muted, #7c8794);
          padding-top: 8px;
          border-top: 1px dashed var(--border-card, #2a2f37);
          line-height: 1.45;
          min-height: 70px;
        }
        .design-directions .dd-mutex .label {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 8.5px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted, #7c8794);
          display: block;
          margin-bottom: 2px;
        }

        /* ── Counter ─────────────────────────────────────────────────── */
        .design-directions .dd-counter {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px 0 4px;
          font-family: monospace;
          font-size: 11px;
        }
        .design-directions .dd-counter-left {
          text-transform: uppercase;
          color: var(--text-secondary, #b3bcc7);
        }
        .design-directions .dd-counter-warning {
          color: var(--brand-yellow, #f5c542);
          font-weight: 600;
        }
        .design-directions .dd-counter-ready {
          color: var(--brand-green-bright, #22c55e);
          font-weight: 600;
        }

        /* ── Textarea ────────────────────────────────────────────────── */
        .design-directions .dd-textarea-wrap { padding: 4px 0 8px; }
        .design-directions .dd-textarea-label {
          display: block;
          font-size: 11px;
          color: var(--text-secondary, #b3bcc7);
          margin-bottom: 4px;
        }
        .design-directions .dd-textarea-label .hint {
          color: var(--text-muted, #7c8794);
          margin-left: 4px;
        }
        .design-directions .dd-textarea {
          width: 100%;
          background: var(--bg-card, #14181d);
          border: 1px solid var(--border-card, #2a2f37);
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 13px;
          color: var(--text-main, inherit);
          resize: vertical;
          font-family: inherit;
          min-height: 64px;
        }
        .design-directions .dd-textarea:focus {
          outline: none;
          border-color: var(--brand-yellow, #f5c542);
        }
        .design-directions .dd-textarea::placeholder {
          color: var(--text-muted, #7c8794);
        }

        /* ── CTA ─────────────────────────────────────────────────────── */
        .design-directions .tool-card-foot {
          display: flex; justify-content: flex-end;
          padding-top: 8px;
        }
        .design-directions .tool-card-btn {
          background: var(--brand-yellow, #f5c542);
          color: #1a1410;
          border: none;
          border-radius: 6px;
          padding: 10px 18px;
          font: inherit;
          font-size: 13px; font-weight: 600;
          cursor: pointer;
          transition: opacity 120ms;
        }
        .design-directions .tool-card-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .design-directions .tool-card-btn:not(:disabled):hover {
          opacity: 0.9;
        }
      `}</style>
    </div>
  )
}
