/**
 * DesignSystemCard — Phase 4→5 sign-off (WP-77, Ralph 2026-05-10).
 *
 * Interactive vibe-selector card. CD pre-loads N vibes' design-system
 * payloads; user toggles between them via dropdown. CSS vars + textContent
 * swap client-side on dropdown change — no round-trip to CD.
 *
 * React-bypass: this card uses a single useEffect keyed on
 * selectedVibeIndex that batches all DOM writes (CSS vars + textContent).
 * This is intentional — React re-renders on dropdown change trigger the
 * effect, but the actual visual swap is imperative DOM for perf.
 *
 * Full-width: lifts the 540px chassis cap per §17 doctrine.
 */
'use client'

import * as React from 'react'
import { useState, useEffect, useRef, useMemo } from 'react'
import type { DesignSystemVibe } from '@/lib/types'

interface DesignSystemCardProps {
  vibes: DesignSystemVibe[]
  initialVibeIndex?: number
  onSubmit: (response: {
    action: 'select' | 'create-new'
    selectedVibeSlug: string | null
    freeformText: string
  }) => void
}

/**
 * Ralph 2026-05-12 — defensive normalize. The MCP route validates that
 * `system` is an object but doesn't enforce sub-field presence. When CD's
 * doctrine drifts from the validator schema (flat `{palette, ...}` instead
 * of nested `system: {palette, ...}` — see INSTITUTIONAL-MEMORY entry),
 * the card used to render `undefined · undefined` for typography and
 * inject the string `"undefined"` into CSS vars. Pad every required field
 * with a safe empty value so the chrome renders cleanly even on a
 * malformed payload, then the user can see WHICH fields the agent forgot.
 */
function normalizeVibe(v: DesignSystemVibe): DesignSystemVibe {
  const s = (v.system || {}) as Partial<DesignSystemVibe['system']>
  const p = (s.palette || {}) as Partial<DesignSystemVibe['system']['palette']>
  const t = (s.typography || {}) as Partial<DesignSystemVibe['system']['typography']>
  const b = (s.buttons || {}) as Partial<NonNullable<DesignSystemVibe['system']['buttons']>>
  return {
    ...v,
    vibeSlug: v.vibeSlug || '',
    label: v.label || '',
    system: {
      displayName: s.displayName || '',
      h2Sample: s.h2Sample || '',
      bodySample: s.bodySample || '',
      imageTreatment: s.imageTreatment || '',
      animationPosture: s.animationPosture || '',
      palette: {
        bg: p.bg || '#f5f5f5',
        surface: p.surface || '#ffffff',
        primary: p.primary || '#888888',
        ink: p.ink || '#111111',
        accent: p.accent || '#cccccc',
      },
      typography: {
        displayFont: t.displayFont || '',
        bodyFont: t.bodyFont || '',
        h1Caption: t.h1Caption || '',
        bodyCaption: t.bodyCaption || '',
      },
      buttons: { primaryLabel: b.primaryLabel || '', secondaryLabel: b.secondaryLabel || '' },
    },
  }
}

export function DesignSystemCard({
  vibes: rawVibes,
  initialVibeIndex = 0,
  onSubmit,
}: DesignSystemCardProps) {
  const vibes = useMemo(
    () => (Array.isArray(rawVibes) ? rawVibes : []).map(normalizeVibe),
    [rawVibes],
  )

  const [selectedIdx, setSelectedIdx] = useState(
    Math.min(initialVibeIndex, Math.max(0, vibes.length - 1))
  )
  const [freeformText, setFreeformText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const vibe = vibes[selectedIdx]
  const sys = vibe?.system

  // Pre-load all Google Fonts on mount
  useEffect(() => {
    if (vibes.length === 0) return
    const fonts = new Set<string>()
    vibes.forEach((v) => {
      if (v.system.typography.displayFont) fonts.add(v.system.typography.displayFont)
      if (v.system.typography.bodyFont) fonts.add(v.system.typography.bodyFont)
    })
    if (fonts.size === 0) { setFontsLoaded(true); return }

    const families = Array.from(fonts)
      .map((f) => `family=${f.replace(/ /g, '+')}:wght@400;700;800`)
      .join('&')
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`
    link.onload = () => setFontsLoaded(true)
    link.onerror = () => setFontsLoaded(true) // proceed anyway
    document.head.appendChild(link)

    const timeout = setTimeout(() => setFontsLoaded(true), 3000)
    return () => clearTimeout(timeout)
  }, [vibes])

  // Apply CSS vars + textContent on vibe change
  useEffect(() => {
    if (!sys || !cardRef.current) return
    const el = cardRef.current
    const p = sys.palette

    el.style.setProperty('--ds-bg', p.bg)
    el.style.setProperty('--ds-surface', p.surface)
    el.style.setProperty('--ds-primary', p.primary)
    el.style.setProperty('--ds-ink', p.ink)
    el.style.setProperty('--ds-accent', p.accent)
    el.style.setProperty('--ds-display-font', sys.typography.displayFont)
    el.style.setProperty('--ds-body-font', sys.typography.bodyFont)

    const setText = (id: string, text: string) => {
      const node = el.querySelector(`#${id}`)
      if (node) node.textContent = text
    }
    setText('ds-display-name', sys.displayName)
    setText('ds-h2-sample', sys.h2Sample)
    setText('ds-body-sample', sys.bodySample)
    setText('ds-hex-bg', p.bg)
    setText('ds-hex-surface', p.surface)
    setText('ds-hex-primary', p.primary)
    setText('ds-hex-ink', p.ink)
    setText('ds-hex-accent', p.accent)
    setText('ds-typo-header', `${sys.typography.displayFont} · ${sys.typography.bodyFont}`)
    setText('ds-h1-caption', sys.typography.h1Caption)
    setText('ds-body-caption', sys.typography.bodyCaption)
    setText('ds-image-treatment', sys.imageTreatment)
    setText('ds-animation-posture', sys.animationPosture)
  }, [selectedIdx, sys])

  if (vibes.length === 0 || !sys) return null

  function handleAction(action: 'select' | 'create-new') {
    if (submitted) return
    setSubmitted(true)
    onSubmit({
      action,
      selectedVibeSlug: action === 'select' ? vibe.vibeSlug : null,
      freeformText: freeformText.trim(),
    })
  }

  return (
    <div
      ref={cardRef}
      className="tool-card design-system"
      data-style="design-system"
      id="ds-card"
      style={{
        '--ds-bg': sys.palette.bg,
        '--ds-surface': sys.palette.surface,
        '--ds-primary': sys.palette.primary,
        '--ds-ink': sys.palette.ink,
        '--ds-accent': sys.palette.accent,
        '--ds-display-font': sys.typography.displayFont,
        '--ds-body-font': sys.typography.bodyFont,
      } as React.CSSProperties}
    >
      {/* Body — porting docs/toolcards-mockup.html:2907-2998 (Ralph 2026-05-10).
          Single padded body block, NOT divided sections. */}
      <div className="ds-body">
        {/* Header row: DS chip · stacked title+subtitle · vibe-selector dropdown */}
        <div className="ds-header">
          <span className="ds-icon" aria-hidden>DS</span>
          <div className="ds-title-stack">
            <div className="ds-title">Design System</div>
            <div className="ds-subtitle">Phase 4 → 5 sign-off · pick the vibe</div>
          </div>
          <select
            className="ds-select"
            value={selectedIdx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            disabled={submitted}
            aria-label="Vibe selector"
          >
            {vibes.map((v, i) => (
              <option key={v.vibeSlug} value={i}>{v.label}</option>
            ))}
          </select>
        </div>

        {!fontsLoaded && <div className="ds-loading">Loading fonts…</div>}

        {/* Vibe sample — bordered card on the vibe's own bg; renders display
            name + atmosphere line + body sample IN the vibe's typefaces, plus
            live-preview component samples (buttons) at the bottom. The labels
            for these buttons come from sys.buttons and are BRAND-typical copy
            ("Reserve a seat" / "Read more"), distinct from the form CTAs. */}
        <div className="ds-vibe-sample">
          <div id="ds-display-name" className="ds-display-name">{sys.displayName}</div>
          <div id="ds-h2-sample" className="ds-h2">{sys.h2Sample}</div>
          <div id="ds-body-sample" className="ds-body-sample">{sys.bodySample}</div>
          <div className="ds-component-row">
            <button type="button" className="ds-live-btn ds-live-btn-primary" disabled>
              {sys.buttons?.primaryLabel || 'Reserve a seat'}
            </button>
            <button type="button" className="ds-live-btn ds-live-btn-secondary" disabled>
              {sys.buttons?.secondaryLabel || 'Read more'}
            </button>
          </div>
        </div>

        {/* Palette + Typography — 2-column grid */}
        <div className="ds-grid-2">
          <div className="ds-spec-card">
            <div className="ds-spec-label">Palette</div>
            <div className="ds-palette">
              {(['bg', 'surface', 'primary', 'ink', 'accent'] as const).map((key) => (
                <div
                  key={key}
                  className="ds-swatch"
                  style={{ backgroundColor: sys.palette[key] }}
                  aria-label={`${key} ${sys.palette[key]}`}
                />
              ))}
            </div>
            <div className="ds-hex-row">
              {(['bg', 'surface', 'primary', 'ink', 'accent'] as const).map((key) => (
                <span key={key} id={`ds-hex-${key}`} className="ds-hex">{sys.palette[key]}</span>
              ))}
            </div>
          </div>
          <div className="ds-spec-card">
            <div className="ds-spec-label">Typography</div>
            <div id="ds-typo-header" className="ds-typo-header">
              {sys.typography.displayFont} · {sys.typography.bodyFont}
            </div>
            <div className="ds-typo-stack">
              <div id="ds-h1-caption" className="ds-typo-caption">{sys.typography.h1Caption}</div>
              <div id="ds-body-caption" className="ds-typo-caption">{sys.typography.bodyCaption}</div>
            </div>
          </div>
        </div>

        {/* Image treatment + Animation — 2-column grid */}
        <div className="ds-grid-2">
          <div className="ds-spec-card">
            <div className="ds-spec-label">Image treatment</div>
            <div id="ds-image-treatment" className="ds-rule">{sys.imageTreatment}</div>
          </div>
          <div className="ds-spec-card">
            <div className="ds-spec-label">Animation</div>
            <div id="ds-animation-posture" className="ds-rule">{sys.animationPosture}</div>
          </div>
        </div>

        {/* Textarea — mono uppercase label above */}
        <div className="ds-textarea-wrap">
          <div className="ds-spec-label">Thoughts, comments, anything else?</div>
          <textarea
            className="ds-textarea"
            placeholder="e.g. lock Grandma's Cliff, but bump Accent saturation 5%."
            value={freeformText}
            onChange={(e) => setFreeformText(e.target.value)}
            disabled={submitted}
            rows={2}
          />
        </div>

        {/* Action row — primary fills, secondary is ghost.
            NO Cancel, NO Tweak (per spec). */}
        <div className="ds-action-row">
          <button
            type="button"
            className="ds-action-btn ds-action-btn-primary"
            disabled={submitted}
            onClick={() => handleAction('select')}
          >
            {submitted ? 'Submitted…' : 'Select Design System'}
          </button>
          <button
            type="button"
            className="ds-action-btn ds-action-btn-secondary"
            disabled={submitted}
            onClick={() => handleAction('create-new')}
          >
            Create New
          </button>
        </div>
      </div>

      <style>{`
        /* Lift the 540px chassis cap. Force onyx chassis (FormBubble can
           leak parent bg). The body padding is owned by .ds-body — the
           tool-card-head/body/foot scaffolding is unused for this card. */
        .design-system {
          max-width: 100% !important;
          background: var(--bg-card, #1e1e22) !important;
          color: var(--text-main, #e0e0e0);
        }

        .ds-body {
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        /* ── Header ──────────────────────────────────────────────── */
        .ds-header {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ds-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 8px;
          background: rgba(21, 185, 129, 0.12);
          color: var(--brand-green-bright, #15B981);
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 0.04em;
          flex-shrink: 0;
        }
        .ds-title-stack {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .ds-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main, #e0e0e0);
          letter-spacing: -0.005em;
        }
        .ds-subtitle {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 10px;
          color: var(--text-faint, #6b6b73);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        /* ── Vibe selector dropdown — theme-aware (Ralph 2026-05-12) ──
           Hardcoded #0d0d10 made the dropdown black on both themes.
           Switching to --bg-card resolves to #1e1e22 in onyx and #ffffff
           in polar; --bg-card-hover handles the hover state. */
        .ds-select {
          appearance: none;
          -webkit-appearance: none;
          background-color: var(--bg-card, #1e1e22);
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2315B981' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>");
          background-repeat: no-repeat;
          background-position: right 10px center;
          border: 1px solid var(--border-card, #2a2a2e);
          border-radius: 6px;
          padding: 6px 26px 6px 10px;
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          font-weight: 600;
          color: var(--text-main, #e0e0e0);
          cursor: pointer;
          min-width: 200px;
        }
        .ds-select:hover:not(:disabled) {
          border-color: var(--brand-green-bright, #15B981);
          background-color: var(--bg-card-hover, #15191c);
        }
        .ds-select:focus {
          outline: none;
          border-color: var(--brand-green-bright, #15B981);
          box-shadow: 0 0 0 2px rgba(21, 185, 129, 0.22);
        }
        .ds-select option {
          background: var(--bg-card, #1e1e22);
          color: var(--text-main, #e0e0e0);
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
        }

        /* ── Loading ──────────────────────────────────────────────── */
        .ds-loading {
          text-align: center;
          padding: 4px;
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          color: var(--text-faint, #6b6b73);
        }

        /* ── Vibe sample (the LIVE design system surface) ────────────
           Paints on var(--ds-bg) so the user feels the vibe, not just
           reads tokens. Bordered rounded card. */
        .ds-vibe-sample {
          padding: 16px 18px;
          background: var(--ds-bg);
          border: 1px solid var(--ds-surface);
          border-radius: 8px;
          position: relative;
        }
        .ds-display-name {
          font-family: var(--ds-display-font), system-ui;
          font-weight: 800;
          font-size: 28px;
          line-height: 1.05;
          color: var(--ds-primary);
          text-transform: uppercase;
          letter-spacing: -0.01em;
          margin-bottom: 6px;
        }
        .ds-vibe-sample .ds-h2 {
          font-family: var(--ds-display-font), system-ui;
          font-weight: 800;
          font-size: 18px;
          line-height: 1.2;
          color: var(--ds-ink);
          margin-bottom: 8px;
        }
        .ds-body-sample {
          font-family: var(--ds-body-font), system-ui;
          font-weight: 400;
          font-size: 12px;
          line-height: 1.55;
          color: var(--ds-ink);
          margin-bottom: 12px;
          max-width: 64ch;
        }

        /* ── Live preview component samples (buttons inside the vibe
              sample). Brand-typical labels (Reserve a seat / Read more)
              — distinct from the form CTAs at the bottom of the card. */
        .ds-component-row {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .ds-live-btn {
          padding: 9px 16px;
          border-radius: 6px;
          font-family: var(--ds-body-font), system-ui;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          cursor: default;
        }
        .ds-live-btn-primary {
          background: var(--ds-primary);
          color: var(--ds-bg);
          border: none;
        }
        .ds-live-btn-secondary {
          background: transparent;
          color: var(--ds-primary);
          border: 1px solid var(--ds-primary);
          font-weight: 600;
        }

        /* ── 2-column grids ──────────────────────────────────────── */
        .ds-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        /* ── Spec card (bordered subtle card used in the grids) ──── */
        .ds-spec-card {
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-card, #2a2a2e);
          border-radius: 6px;
        }
        .ds-spec-label {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-faint, #6b6b73);
          margin-bottom: 6px;
        }

        /* ── Palette ─────────────────────────────────────────────── */
        .ds-palette {
          display: flex;
          gap: 4px;
          margin-bottom: 4px;
        }
        .ds-swatch {
          flex: 1;
          height: 24px;
          border-radius: 3px;
          border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .ds-hex-row {
          display: flex;
          gap: 4px;
        }
        .ds-hex {
          flex: 1;
          text-align: center;
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 8px;
          color: var(--text-muted, #8b8b93);
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }

        /* ── Typography spec ─────────────────────────────────────── */
        .ds-typo-header {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          color: var(--text-main, #e0e0e0);
          line-height: 1.5;
        }
        .ds-typo-stack {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 4px;
        }
        .ds-typo-caption {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 9px;
          color: var(--text-faint, #6b6b73);
          line-height: 1.6;
        }

        /* ── Image treatment + Animation rule text ────────────────── */
        .ds-rule {
          font-family: var(--font-sans, 'Inter', system-ui, sans-serif);
          font-size: 11px;
          color: var(--text-muted, #a0a0a8);
          line-height: 1.45;
        }

        /* ── Textarea ─────────────────────────────────────────────── */
        .ds-textarea-wrap {
          border-top: 1px solid var(--border-card, #2a2a2e);
          padding-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ds-textarea {
          width: 100%;
          min-height: 56px;
          /* Ralph 2026-05-12: theme-aware vars — hardcoded #0d0d10 locked
             it dark in both themes. --bg-card resolves correctly. */
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, #2a2a2e);
          border-radius: 8px;
          padding: 9px 11px;
          font-family: var(--font-sans, 'Inter', system-ui, sans-serif);
          font-size: 12px;
          color: var(--text-main, #e0e0e0);
          resize: vertical;
          outline: none;
        }
        .ds-textarea:focus {
          border-color: var(--brand-green-bright, #15B981);
          box-shadow: 0 0 0 2px rgba(21, 185, 129, 0.18);
        }
        .ds-textarea::placeholder {
          color: var(--text-faint, #6b6b73);
          font-family: var(--font-sans, 'Inter', system-ui, sans-serif);
        }

        /* ── Action row — primary fills, secondary is ghost ────────── */
        .ds-action-row {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }
        .ds-action-btn {
          padding: 11px 18px;
          border-radius: 8px;
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 120ms ease;
        }
        .ds-action-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .ds-action-btn-primary {
          flex: 1;
          background: var(--brand-green-bright, #15B981);
          color: #0a0a0a;
          border: 1px solid var(--brand-green-bright, #15B981);
        }
        .ds-action-btn-primary:hover:not(:disabled) {
          background: #1FD09A;
          border-color: #1FD09A;
        }
        .ds-action-btn-secondary {
          background: transparent;
          color: var(--text-muted, #a0a0a8);
          border: 1px solid var(--border-card, #2a2a2e);
          font-weight: 600;
        }
        .ds-action-btn-secondary:hover:not(:disabled) {
          color: var(--brand-green-bright, #15B981);
          border-color: var(--brand-green-bright, #15B981);
        }
      `}</style>
    </div>
  )
}
