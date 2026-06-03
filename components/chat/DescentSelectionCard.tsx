/**
 * DescentSelectionCard — Variable-cap vibe picker (WP-75, Ralph 2026-05-10).
 *
 * CD fires `present_descent_selection` with N candidate vibes + cap (1..N) +
 * ctaLabel. Examples:
 *   - cap=1, ctaLabel="Ship This Vibe"      (Phase 4→5 final-pick / radio)
 *   - cap=2, ctaLabel="Advance These 2"     (Phase 2→3 wireframe pick)
 *   - cap=3, ctaLabel="Narrow to Top 3"     (mid-funnel narrow)
 *   - cap=N, ctaLabel=anything              (any custom narrow)
 *
 * cap=1 renders as radio (single pick; clicking any candidate replaces the
 * current pick). cap>1 renders as multi-select with that maximum (clicking
 * a (cap+1)th candidate triggers the deselect-warning).
 *
 * Same yellow chassis as DesignDirectionsCard (.tool-card surface).
 *
 * Submission posts {type:'descent_selection', picks: string[]} via the
 * send_user_input dispatch case at mcp-server/tools-orchestrator.ts:856.
 */
'use client'

import * as React from 'react'
import { useState } from 'react'

export interface DescentVibe {
  slug: string
  name: string
  heroImage: string
  tagline?: string
  palette?: [string, string, string]
  displayFont?: string
}

interface DescentSelectionCardProps {
  /** Maximum number of vibes the user can pick. 1 = radio. 2+ = multi-select. */
  cap: number
  /** Primary CTA button label, verbatim from CD (e.g. "Ship This Vibe", "Advance These 2", "Narrow to Top 3"). */
  ctaLabel: string
  /** Optional sub-line in the card header for phase context (e.g. "Phase 2→3 wireframe pick"). */
  contextLabel?: string
  vibes: DescentVibe[]
  /** Session id used to resolve relative heroImage filenames to `/{sessionId}/{filename}`.
   *  If a vibe's heroImage is an absolute URL (`http*://`) or already an absolute path (`/...`),
   *  it is used verbatim. Otherwise prepended. Ralph 2026-05-14. */
  sessionId?: string
  /** CD-speaking preamble — "What to weigh" cyan callout per mockup §4 descent. */
  preamble?: import('@/lib/types').Preamble
  /** @deprecated — flat-string preamble. Use `preamble: {label, body}` instead. */
  prompt?: string
  /** Picks + freeform note. The note is the user's rationale ("picked X but only because of Y")
   *  per tc_* toolcard doctrine — every user-input toolcard carries a textarea regardless of
   *  whether CD asked for one (Ralph 2026-05-14). */
  onSubmit: (response: { picks: string[]; freeformText: string }) => void
}

/**
 * Resolve a heroImage value to a usable <img src>. If it's already an absolute
 * URL (http/https/data) or absolute path (/...), pass through. Otherwise treat
 * as a session-relative filename and prepend `/{sessionId}/`. Ralph 2026-05-14.
 */
function resolveHero(heroImage: string, sessionId: string | undefined): string {
  if (!heroImage) return ''
  if (/^(?:https?:|data:|\/)/i.test(heroImage)) return heroImage
  if (!sessionId) return heroImage
  return `/${sessionId}/${heroImage}`
}

function VibeCandidate({
  vibe,
  selected,
  onToggle,
  disabled,
  sessionId,
}: {
  vibe: DescentVibe
  selected: boolean
  onToggle: () => void
  disabled: boolean
  sessionId?: string
}) {
  return (
    <div
      className={`ds-vibe${selected ? ' ds-vibe--selected' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onToggle() }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      aria-disabled={disabled}
    >
      {selected && <span className="ds-check">✓</span>}
      <div className="ds-hero-wrap">
        <img
          src={resolveHero(vibe.heroImage, sessionId)}
          alt={vibe.name}
          className="ds-hero"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      </div>
      <span className="ds-name">{vibe.name}</span>
      {vibe.tagline && <span className="ds-tagline">{vibe.tagline}</span>}
      {vibe.palette && (
        <div className="ds-palette">
          {vibe.palette.map((hex, i) => (
            <div key={i} className="ds-palette-bar" style={{ backgroundColor: hex }} />
          ))}
        </div>
      )}
      {vibe.displayFont && <span className="ds-font">{vibe.displayFont}</span>}
    </div>
  )
}

export function DescentSelectionCard({
  cap,
  ctaLabel,
  contextLabel,
  vibes,
  sessionId,
  preamble,
  prompt,
  onSubmit,
}: DescentSelectionCardProps) {
  // Defensive: clamp cap to [1, vibes.length]. Server validates this too.
  const effectiveCap = Math.max(1, Math.min(Math.floor(cap), vibes.length || 1))
  const pillLabel = effectiveCap === 1 ? 'PICK 1' : `PICK ≤${effectiveCap}`
  const headerSubline = contextLabel ?? (effectiveCap === 1 ? 'Single pick' : `Pick up to ${effectiveCap}`)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [freeformText, setFreeformText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [showWarning, setShowWarning] = useState(false)

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
        setShowWarning(false)
        return next
      }
      if (effectiveCap === 1) {
        // Radio behavior — deselect everything else first.
        next.clear()
        next.add(slug)
        setShowWarning(false)
        return next
      }
      if (next.size < effectiveCap) {
        next.add(slug)
        setShowWarning(false)
        return next
      }
      setShowWarning(true)
      return prev
    })
  }

  function handleSubmit() {
    if (submitted) return
    // Require AT LEAST 1 pick. cap=1 → exactly 1. cap>1 → 1 to cap picks.
    // (Allowing partial fills under cap means CD can present "pick up to 3"
    // and accept 1-3 picks, which is what variable-cap means.)
    if (selected.size === 0) return
    if (selected.size > effectiveCap) return
    setSubmitted(true)
    onSubmit({ picks: Array.from(selected), freeformText: freeformText.trim() })
  }

  if (vibes.length === 0) return null

  const submitDisabled =
    submitted || selected.size === 0 || selected.size > effectiveCap

  return (
    <div className="tool-card descent-selection" data-style="descent">
      {/* Header */}
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="yellow" aria-hidden>DS</span>
        <div className="tool-card-head-text">
          <span className="tool-card-title">Descent Selection</span>
          <span className="tool-card-meta">{headerSubline}</span>
        </div>
        <span className="tool-card-pill" data-accent="yellow">{pillLabel}</span>
      </div>

      {/* Body copy */}
      <div className="tool-card-body">
        {/* CD-speaking preamble — cyan callout per mockup §4 descent.
            Structured {label, body} preferred; legacy flat-string `prompt` falls back. */}
        {preamble ? (
          <div className="ds-preamble">
            <span className="ds-preamble-label">{preamble.label}</span>
            <span className="ds-preamble-body">{preamble.body}</span>
          </div>
        ) : (
          prompt && <p className="ds-body-copy">{prompt}</p>
        )}

        {/* Candidate strip */}
        <div className="ds-grid" role={effectiveCap === 1 ? 'radiogroup' : 'group'} aria-label="Vibe candidates">
          {vibes.map((vibe) => (
            <VibeCandidate
              key={vibe.slug}
              vibe={vibe}
              selected={selected.has(vibe.slug)}
              onToggle={() => toggle(vibe.slug)}
              disabled={submitted}
              sessionId={sessionId}
            />
          ))}
        </div>
      </div>

      {/* Counter */}
      <div className="ds-counter">
        <span className="ds-counter-left">Selected: {selected.size} / {effectiveCap}</span>
        {showWarning && (
          <span className="ds-counter-warning">
            {effectiveCap === 1 ? 'Pick one to swap' : 'Deselect one to swap'}
          </span>
        )}
      </div>

      {/* Freeform — unconditional. Doctrine (Ralph 2026-05-14): every
          tc_* toolcard that asks the user something carries a
          "Thoughts, comments, anything else?" textarea. */}
      <div className="ds-textarea-wrap">
        <span className="ds-textarea-label">Thoughts, comments, anything else?</span>
        <textarea
          className="ds-textarea"
          placeholder="e.g. picked X but only because of Y — the typography on Z is closer to what we agreed."
          value={freeformText}
          onChange={(e) => setFreeformText(e.target.value)}
          disabled={submitted}
          rows={2}
        />
      </div>

      {/* CTA */}
      <div className="tool-card-foot">
        <button
          type="button"
          className="tool-card-btn"
          data-variant="primary"
          disabled={submitDisabled}
          onClick={handleSubmit}
        >
          {submitted ? 'Committed ✓' : ctaLabel}
        </button>
      </div>

      <style>{`
        /* ── Yellow avatar + pill (matches design_directions theme) ── */
        .descent-selection .tool-card-icon[data-accent="yellow"] {
          background: rgba(245, 197, 66, 0.15);
          color: var(--brand-yellow, #f5c542);
        }
        .descent-selection .tool-card-pill[data-accent="yellow"] {
          background: rgba(245, 197, 66, 0.15);
          color: var(--brand-yellow, #f5c542);
          font-family: monospace;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 4px;
        }
        .descent-selection .tool-card-head {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .descent-selection .tool-card-head-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .descent-selection .tool-card-icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          font-family: monospace;
          flex-shrink: 0;
        }

        /* CD-speaking preamble — cyan border-left, universal "CD speaking"
           channel per docs/toolcards-mockup.html §4 descent. */
        .ds-preamble {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 0 0 14px;
          padding: 12px 14px;
          border-left: 2px solid var(--brand-cyan, #22d3ee);
          background: rgba(34, 211, 238, 0.04);
          border-radius: 0 8px 8px 0;
        }
        .ds-preamble-label {
          font-size: 10px;
          color: var(--brand-cyan, #22d3ee);
          font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }
        .ds-preamble-body {
          font-size: 13px;
          color: var(--text-main, inherit);
          line-height: 1.55;
        }
        /* ── Body copy ───────────────────────────────────────────── */
        .ds-body-copy {
          font-size: 13px;
          color: var(--text-secondary, #888);
          margin: 0 0 12px;
          line-height: 1.5;
        }

        /* ── Horizontal candidate strip ──────────────────────────── */
        .ds-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
        }

        /* ── Per-vibe candidate ──────────────────────────────────── */
        .ds-vibe {
          position: relative;
          padding: 10px;
          border-radius: 8px;
          border: 1px solid var(--border-card, #333);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: border-color 0.15s;
        }
        .ds-vibe:hover { border-color: var(--text-muted, #555); }
        .ds-vibe[aria-disabled="true"] { cursor: not-allowed; opacity: 0.6; }
        .ds-vibe--selected {
          border-color: var(--brand-green-bright, #22c55e);
        }
        .ds-check {
          position: absolute;
          top: 6px;
          right: 6px;
          background: var(--brand-green-bright, #22c55e);
          color: #000;
          font-size: 11px;
          font-weight: 700;
          width: 18px;
          height: 18px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
        }
        .ds-hero-wrap {
          width: 100%;
          aspect-ratio: 4 / 3;
          border-radius: 6px;
          overflow: hidden;
          background: linear-gradient(135deg, rgba(80,80,80,0.2), rgba(40,40,40,0.4));
        }
        .ds-hero {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .ds-name {
          font-weight: 700;
          font-size: 13px;
          padding-right: 24px;
        }
        .ds-tagline {
          font-style: italic;
          font-size: 11px;
          color: var(--text-secondary, #999);
          line-height: 1.4;
        }
        .ds-palette {
          display: flex;
          height: 12px;
          border-radius: 3px;
          overflow: hidden;
        }
        .ds-palette-bar { flex: 1; }
        .ds-font {
          font-family: monospace;
          font-size: 9.5px;
          text-transform: uppercase;
          color: var(--text-muted, #777);
        }

        /* ── Counter ─────────────────────────────────────────────── */
        .ds-counter {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          font-family: monospace;
          font-size: 11px;
        }
        .ds-counter-left { text-transform: uppercase; }
        .ds-counter-warning {
          color: var(--brand-yellow, #f5c542);
          font-weight: 600;
        }
        /* Freeform textarea — same shape as DesignDirections .dd-textarea
           pattern. Block layout (not flex) so width:100% is honoured. */
        .ds-textarea-wrap {
          display: block;
          padding: 8px 0 4px;
        }
        .ds-textarea-label {
          display: block;
          margin-bottom: 6px;
          font-family: var(--font-mono, monospace);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted, rgba(255, 255, 255, 0.55));
        }
        .ds-textarea {
          display: block;
          width: 100%;
          box-sizing: border-box;
          min-width: 0;
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, rgba(255, 255, 255, 0.08));
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 13px;
          color: var(--text-main, inherit);
          font-family: inherit;
          resize: vertical;
          min-height: 50px;
        }
        .ds-textarea:focus {
          outline: none;
          border-color: var(--brand-yellow, #f5c542);
        }
        .ds-textarea::placeholder {
          color: var(--text-muted, rgba(255, 255, 255, 0.45));
        }
        /* Defeat Chrome autofill light-blue/yellow override — theme-aware
           via --bg-card. Black in Onyx, white in Polar. See
           INSTITUTIONAL-MEMORY.md 2026-05-14 autofill notes. */
        .ds-textarea:-webkit-autofill,
        .ds-textarea:-webkit-autofill:hover,
        .ds-textarea:-webkit-autofill:focus,
        .ds-textarea:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px var(--bg-card, #1e1e22) inset;
          box-shadow: 0 0 0 1000px var(--bg-card, #1e1e22) inset;
          -webkit-text-fill-color: var(--text-main, #f5f5f7);
          caret-color: var(--text-main, #f5f5f7);
          transition: background-color 600000s 0s, color 600000s 0s;
        }
      `}</style>
    </div>
  )
}
