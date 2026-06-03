/**
 * ConfirmUnderstandingCard — Phase 1 → Phase 2 gate (unified, single-state).
 *
 * Rebuilt 2026-05-15 (Ralph): the prior two-case (READY vs CHECK-IN) split
 * was conceptual noise — they were the same card with different render
 * branches. Unified to ONE state where:
 *
 *   - All 9 fields render as editable inputs always (chips as textareas,
 *     conversion as toggle pills + textarea, weird/signature as textareas)
 *   - The card always carries the build CTA at the bottom
 *   - CTA is DISABLED until all 9 fields are populated (6 chips + at-least-one
 *     mechanism OR pricing + weirdDetail + signatureMoment)
 *   - When all fields filled, CTA enables → click fires the build path with
 *     the complete inline state
 *
 * `readyToGenerate` is accepted as a back-compat field but no longer
 * branches behavior. The route + page.tsx still pass it through; it's
 * ignored here.
 */
'use client'

import * as React from 'react'
import { useState } from 'react'
import type { ConversionMechanism, Preamble } from '@/lib/types'

interface ConfirmUnderstandingCardProps {
  summary: string
  /** Back-compat only. Branching behavior was removed 2026-05-15. */
  readyToGenerate?: boolean
  preamble?: Preamble
  distillation?: {
    business?: string
    location?: string
    whoWeAre?: string
    howItWorks?: string
    customers?: string
    voice?: string
  }
  conversion?: {
    mechanisms?: ConversionMechanism[]
    pricing?: string
  }
  weirdDetail?: string
  signatureMoment?: string
  discoveryProgress?: { done: number; total: number }
  stillNeed?: string[]
  phaseLabel?: string
  /**
   * Always fires the build path with the consolidated inline state.
   * Parent formats a structured message (chip values + mechanisms +
   * pricing + weird + signature + freeform) AND triggers the build.
   */
  onSubmit?: (response: {
    freeformText: string
    distillation: Record<string, string>
    mechanisms: ConversionMechanism[]
    pricing: string
    weirdDetail: string
    signatureMoment: string
  }) => void
}

const ALL_MECHANISMS: ConversionMechanism[] = ['PHONE', 'FORM', 'BOOK', 'SHOP']

/**
 * The 9 Discovery slots in canonical order.
 */
const SLOTS: Array<{ key: string; label: string; tooltip: string }> = [
  { key: 'business', label: 'Business', tooltip: 'Business' },
  { key: 'location', label: 'Location', tooltip: 'Location' },
  { key: 'whoWeAre', label: 'Who we are', tooltip: 'Who we are' },
  { key: 'howItWorks', label: 'How it works', tooltip: 'How it works' },
  { key: 'customers', label: 'Customer(s)', tooltip: 'Customer(s)' },
  { key: 'voice', label: 'Voice', tooltip: 'Voice' },
  { key: 'conversion', label: 'Conversion + Pricing', tooltip: 'Conversion + Pricing' },
  { key: 'weirdDetail', label: 'Weird detail', tooltip: 'Weird detail' },
  { key: 'signatureMoment', label: 'Signature moment', tooltip: 'Signature moment' },
]

const CHIP_KEYS = ['business', 'location', 'whoWeAre', 'howItWorks', 'customers', 'voice'] as const

export function ConfirmUnderstandingCard({
  summary,
  preamble,
  distillation,
  conversion,
  weirdDetail,
  signatureMoment,
  discoveryProgress,
  phaseLabel,
  onSubmit,
}: ConfirmUnderstandingCardProps) {
  const [freeformText, setFreeformText] = useState('')
  const [submitted, setSubmitted] = useState(false)

  // All 9 inline-input states. Chips initialized from props so the user
  // sees current values and can correct them inline. Empty slots show
  // placeholders that hint what content goes there.
  const [chipValues, setChipValues] = useState<Record<string, string>>({
    business: distillation?.business || '',
    location: distillation?.location || '',
    whoWeAre: distillation?.whoWeAre || '',
    howItWorks: distillation?.howItWorks || '',
    customers: distillation?.customers || '',
    voice: distillation?.voice || '',
  })
  const [inlinePricing, setInlinePricing] = useState(conversion?.pricing || '')
  const [inlineWeird, setInlineWeird] = useState(weirdDetail || '')
  const [inlineSignature, setInlineSignature] = useState(signatureMoment || '')
  const [inlineMechs, setInlineMechs] = useState<Set<ConversionMechanism>>(
    new Set(conversion?.mechanisms || []),
  )

  // Per-slot "is this filled?" map derived from LIVE inline state, not
  // props. Drives both dot color and CTA-enabled gate.
  const filled: Record<string, boolean> = {
    business: !!chipValues.business.trim(),
    location: !!chipValues.location.trim(),
    whoWeAre: !!chipValues.whoWeAre.trim(),
    howItWorks: !!chipValues.howItWorks.trim(),
    customers: !!chipValues.customers.trim(),
    voice: !!chipValues.voice.trim(),
    // Conversion slot is "filled" when at least one mechanism OR pricing
    // is provided. Both are acceptable forms of the same information.
    conversion: inlineMechs.size > 0 || !!inlinePricing.trim(),
    weirdDetail: !!inlineWeird.trim(),
    signatureMoment: !!inlineSignature.trim(),
  }
  const filledCount = Object.values(filled).filter(Boolean).length
  const allFilled = filledCount === 9

  const dp = discoveryProgress ?? { done: filledCount, total: 9 }
  const phase = phaseLabel ?? `Phase 1 · ${dp.done}/${dp.total} Discovery items`

  function handleSubmit() {
    if (submitted || !onSubmit || !allFilled) return
    setSubmitted(true)
    onSubmit({
      freeformText: freeformText.trim(),
      distillation: chipValues,
      mechanisms: Array.from(inlineMechs),
      pricing: inlinePricing.trim(),
      weirdDetail: inlineWeird.trim(),
      signatureMoment: inlineSignature.trim(),
    })
  }

  function toggleMech(m: ConversionMechanism) {
    setInlineMechs((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  return (
    <div
      className="cu-card"
      role="region"
      aria-label="Discovery understanding"
    >
      {/* HEAD */}
      <div className="cu-head">
        <span className="cu-icon" aria-hidden>◐</span>
        <div className="cu-head-text">
          <span className="cu-title">Where I am so far</span>
          <span className="cu-subline">{phase}</span>
        </div>
        <span className="cu-pill">{allFilled ? 'READY' : 'IN PROGRESS'}</span>
      </div>

      {/* 9-DOT DISCOVERY SIGNAL — green for filled, red for missing */}
      <div className="cu-dots-row">
        <span className="cu-dots-label">Discovery</span>
        <span className="cu-dots">
          {SLOTS.map(({ key, tooltip }, i) => {
            const isFilled = filled[key]
            return (
              <span
                key={key}
                title={tooltip}
                className={`cu-dot ${isFilled ? 'cu-dot--done' : 'cu-dot--missing'}`}
                aria-label={`${tooltip}: ${isFilled ? 'complete' : 'missing'}`}
                data-i={i}
              />
            )
          })}
        </span>
        <span className="cu-dots-count">{filledCount}/9</span>
      </div>

      {/* PREAMBLE — cyan callout */}
      {preamble && (
        <div className="cu-preamble">
          <span className="cu-preamble-label">{preamble.label}</span>
          <span className="cu-preamble-body">{preamble.body}</span>
        </div>
      )}

      {/* 6-CHIP DISTILLATION GRID (2×3) — all editable textareas */}
      <div className="cu-chips">
        {CHIP_KEYS.map((key) => {
          const label = SLOTS.find((s) => s.key === key)!.label
          return (
            <div
              className={`cu-chip cu-chip--input ${chipValues[key].trim() ? 'cu-chip--filled' : 'cu-chip--empty'}`}
              key={key}
            >
              <span className="cu-chip-label">{label}</span>
              <textarea
                className="cu-chip-input"
                value={chipValues[key]}
                onChange={(e) => setChipValues((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={`${label.toLowerCase()}…`}
                rows={2}
              />
            </div>
          )
        })}
      </div>

      {/* CONVERSION + PRICING — toggle pills + textarea, always editable */}
      <div className={`cu-conversion ${filled.conversion ? '' : 'cu-conversion--empty'}`}>
        <div className="cu-conversion-section">
          <span className="cu-conversion-label">Conversion Mechanisms</span>
          <div className="cu-conversion-pills">
            {ALL_MECHANISMS.map((m) => {
              const active = inlineMechs.has(m)
              return (
                <button
                  type="button"
                  key={m}
                  onClick={() => toggleMech(m)}
                  className={`cu-conv-pill cu-conv-pill--toggle ${active ? 'cu-conv-pill--active' : ''}`}
                >
                  {m}
                </button>
              )
            })}
          </div>
        </div>
        <div className="cu-conversion-section">
          <span className="cu-conversion-label">Pricing</span>
          <textarea
            className="cu-conversion-input"
            placeholder="e.g. €4 espresso · €6 cappuccino · €7 pour-over. Beans €18–€32 / bag. Cash, card."
            value={inlinePricing}
            onChange={(e) => setInlinePricing(e.target.value)}
            rows={2}
          />
        </div>
      </div>

      {/* WEIRD DETAIL — always inline-editable, green accent */}
      <div className={`cu-callout cu-callout--weird ${filled.weirdDetail ? '' : 'cu-callout--empty'}`}>
        <span className="cu-callout-label">The weird detail</span>
        <textarea
          className="cu-callout-input"
          placeholder={'The un-repeatable line that makes this brand sit apart. Not a feature — a quirk. (e.g. "Falcon and camel — Yemeni-Austrian roaster’s two homelands.")'}
          value={inlineWeird}
          onChange={(e) => setInlineWeird(e.target.value)}
          rows={2}
        />
      </div>

      {/* SIGNATURE MOMENT — always inline-editable, violet accent */}
      <div className={`cu-callout cu-callout--signature ${filled.signatureMoment ? '' : 'cu-callout--empty'}`}>
        <span className="cu-callout-label">The signature moment</span>
        <textarea
          className="cu-callout-input"
          placeholder='The scene that PROVES the brand, not describes it. Two or three sentences. (e.g. "Late-night tourist orders cappuccino at 23:30. He serves Sanaani-style mocha with cardamom…")'
          value={inlineSignature}
          onChange={(e) => setInlineSignature(e.target.value)}
          rows={2}
        />
      </div>

      {/* PROSE FALLBACK — only when literally NOTHING structured arrived */}
      {filledCount === 0 && !preamble && summary && (
        <div className="cu-prose">{summary}</div>
      )}

      {/* BOTTOM textarea + CTA. CTA is ALWAYS present, gated on completeness. */}
      <div className="cu-textarea-wrap">
        <span className="cu-textarea-label">Thoughts, comments, anything else?</span>
        <textarea
          className="cu-textarea"
          placeholder="Anything not in the fields above — e.g. skip the location question, customer is online-only."
          value={freeformText}
          onChange={(e) => setFreeformText(e.target.value)}
          disabled={submitted}
          rows={2}
        />
      </div>
      <div className="cu-foot">
        <button
          type="button"
          className={`cu-btn cu-btn--primary ${allFilled ? '' : 'cu-btn--locked'}`}
          onClick={handleSubmit}
          disabled={submitted || !onSubmit || !allFilled}
          title={
            allFilled
              ? 'Discovery complete — fires the wireframe build'
              : `Fill all 9 Discovery slots to enable (${filledCount}/9 done)`
          }
        >
          {submitted
            ? 'Building…'
            : allFilled
              ? 'Looks right — build wireframes →'
              : `Discovery in progress · ${filledCount}/9`}
        </button>
      </div>

      <style>{`
        .cu-card {
          border-radius: var(--radius-card, 12px);
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, #2a2a2e);
          overflow: hidden;
          border-color: rgba(34, 211, 238, 0.30);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(34, 211, 238, 0.08) inset;
          transition: border-color 200ms, box-shadow 200ms;
        }
        /* When ready: shift to green-accent treatment to signal "Discovery
           complete — the CTA below will fire." Subtle, not loud. */
        .cu-card:has(.cu-btn--primary:not(.cu-btn--locked):not(:disabled)) {
          border-color: rgba(21, 185, 129, 0.35);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(21, 185, 129, 0.12) inset;
        }
        /* HEAD */
        .cu-head {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 18px 10px;
          border-bottom: 1px solid var(--border-card, #2a2a2e);
        }
        .cu-icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 8px;
          font-family: var(--font-mono, monospace); font-weight: 700; font-size: 14px;
          flex-shrink: 0;
          background: rgba(34,211,238,0.14); color: var(--brand-cyan, #22d3ee);
        }
        .cu-card:has(.cu-btn--primary:not(.cu-btn--locked):not(:disabled)) .cu-icon {
          background: rgba(21,185,129,0.14);
          color: var(--brand-green-bright, #15B981);
        }
        .cu-head-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .cu-title { font-size: 13px; font-weight: 600; color: var(--text-main, #e0e0e0); }
        .cu-subline {
          font-size: 10px; color: var(--text-faint, #6b6b73);
          font-family: var(--font-mono, monospace); text-transform: uppercase; letter-spacing: 0.08em;
        }
        .cu-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: var(--radius-pill, 999px);
          font-family: var(--font-mono, monospace); font-weight: 700; font-size: 10px; letter-spacing: 0.1em;
          background: rgba(34,211,238,0.10); color: var(--brand-cyan, #22d3ee);
        }
        .cu-card:has(.cu-btn--primary:not(.cu-btn--locked):not(:disabled)) .cu-pill {
          background: rgba(21,185,129,0.10);
          color: var(--brand-green-bright, #15B981);
        }

        /* DOTS */
        .cu-dots-row { display: flex; align-items: center; gap: 6px; padding: 14px 18px 8px; }
        .cu-dots-label {
          font-size: 10px; color: var(--text-faint, #6b6b73);
          font-family: var(--font-mono, monospace); text-transform: uppercase; letter-spacing: 0.08em;
          margin-right: 4px;
        }
        .cu-dots { display: inline-flex; align-items: center; gap: 3px; }
        .cu-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--bg-card-hover, #2a2a2e);
          border: 1px solid var(--border-card, #2a2a2e);
          transition: background-color 150ms, border-color 150ms;
        }
        .cu-dot--done { background: var(--brand-green-bright, #15B981); border-color: var(--brand-green-bright, #15B981); }
        .cu-dot--missing { background: var(--brand-red, #ef4444); border-color: var(--brand-red, #ef4444); }
        .cu-dots-count {
          margin-left: auto; font-size: 10px;
          font-family: var(--font-mono, monospace); font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--text-muted, #888);
        }
        .cu-card:has(.cu-btn--primary:not(.cu-btn--locked):not(:disabled)) .cu-dots-count {
          color: var(--brand-green-bright, #15B981);
        }

        /* PREAMBLE */
        .cu-preamble {
          display: flex; flex-direction: column; gap: 4px;
          margin: 0 18px 14px; padding: 12px 14px;
          border-left: 2px solid var(--brand-cyan, #22d3ee);
          background: rgba(34,211,238,0.04);
          border-radius: 0 8px 8px 0;
        }
        .cu-preamble-label {
          font-size: 10px; color: var(--brand-cyan, #22d3ee);
          font-family: var(--font-mono, monospace);
          text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;
        }
        .cu-preamble-body { font-size: 13px; color: var(--text-main, #e0e0e0); line-height: 1.55; }

        /* CHIPS — all editable, 2×3 grid */
        .cu-chips {
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
          padding: 0 18px 12px;
        }
        .cu-chip {
          background: var(--bg-card-hover, #15191c);
          border: 1px solid var(--border-card, #2a2a2e);
          border-radius: 8px; padding: 8px 10px;
          transition: border-color 150ms, background-color 150ms;
        }
        .cu-chip--empty {
          border-style: dashed;
          border-color: var(--brand-cyan, #22d3ee);
          background: rgba(34, 211, 238, 0.03);
        }
        .cu-chip--filled {
          border-style: solid;
        }
        .cu-chip-label {
          display: block; font-size: 10px; color: var(--text-faint, #6b6b73);
          font-family: var(--font-mono, monospace);
          text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;
        }
        .cu-chip-input {
          display: block; width: 100%; box-sizing: border-box;
          background: var(--bg-card, #1e1e22);
          border: 1px dashed var(--border-card, #2a2a2e);
          border-radius: 6px;
          padding: 6px 8px;
          font-family: inherit; font-size: 13px;
          color: var(--text-main, #e0e0e0); line-height: 1.4;
          resize: vertical; outline: none; min-height: 32px;
          transition: border-color 120ms, background 120ms, box-shadow 120ms;
          cursor: text;
        }
        .cu-chip-input:hover { border-color: var(--text-muted, #888); background: var(--bg-card-hover, #2a2a2e); }
        .cu-chip-input:focus {
          border-style: solid; border-color: var(--brand-cyan, #22d3ee);
          box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.12);
        }
        .cu-chip-input::placeholder { color: var(--text-faint, #6b6b73); font-style: italic; }

        /* CONVERSION + PRICING — always editable; dashed when empty, solid when filled */
        .cu-conversion {
          margin: 0 18px 12px; padding: 10px 12px;
          background: var(--bg-card-hover, #15191c);
          border: 1px solid var(--border-card, #2a2a2e);
          border-radius: 8px;
          display: flex; flex-direction: column; gap: 10px;
          transition: border-color 150ms, background-color 150ms;
        }
        .cu-conversion--empty {
          border-style: dashed;
          border-color: var(--brand-cyan, #22d3ee);
          background: rgba(34, 211, 238, 0.03);
        }
        .cu-conversion-section { display: flex; flex-direction: column; gap: 6px; }
        .cu-conversion-label {
          font-size: 10px; color: var(--text-faint, #6b6b73);
          font-family: var(--font-mono, monospace);
          text-transform: uppercase; letter-spacing: 0.08em;
        }
        .cu-conversion--empty .cu-conversion-label { color: var(--brand-cyan, #22d3ee); }
        .cu-conversion-pills { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .cu-conv-pill {
          padding: 3px 8px; border-radius: var(--radius-pill, 999px);
          font-family: var(--font-mono, monospace); font-weight: 700; font-size: 10px; letter-spacing: 0.06em;
          border: 1px solid transparent;
        }
        .cu-conv-pill--toggle {
          background: var(--bg-card, #1e1e22);
          border-color: var(--border-card, #2a2a2e);
          color: var(--text-faint, #6b6b73);
          cursor: pointer;
        }
        .cu-conv-pill--toggle.cu-conv-pill--active {
          background: rgba(21,185,129,0.10);
          color: var(--brand-green-bright, #15B981);
          border-color: var(--brand-green-bright, #15B981);
          opacity: 1;
        }
        .cu-conversion-input {
          background: var(--bg-card, #1e1e22);
          border: 1px dashed var(--border-card, #2a2a2e);
          border-radius: 6px;
          padding: 6px 8px;
          outline: none;
          font-family: var(--font-body, inherit);
          font-size: 13px;
          color: var(--text-main, #e0e0e0);
          line-height: 1.55;
          font-variant-numeric: tabular-nums;
          resize: vertical;
          min-width: 0;
          width: 100%;
          box-sizing: border-box;
          min-height: 32px;
          transition: border-color 120ms, background 120ms, box-shadow 120ms;
          cursor: text;
        }
        .cu-conversion-input:hover { border-color: var(--text-muted, #888); background: var(--bg-card-hover, #2a2a2e); }
        .cu-conversion-input:focus {
          border-style: solid; border-color: var(--brand-cyan, #22d3ee);
          box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.12);
        }
        .cu-conversion-input::placeholder { color: var(--text-faint, #6b6b73); font-style: italic; }

        /* CALLOUTS — always editable; dashed border when empty, solid when filled */
        .cu-callout {
          margin: 0 18px 10px; padding: 12px 14px;
          border-radius: 0 8px 8px 0;
          display: flex; flex-direction: column; gap: 6px;
          transition: border-left-style 150ms, background-color 150ms;
        }
        .cu-callout--weird {
          border-left: 2px solid var(--brand-green-bright, #15B981);
          background: rgba(21,185,129,0.04);
        }
        .cu-callout--signature {
          margin-bottom: 14px;
          border-left: 2px solid var(--brand-violet, #a78bfa);
          background: rgba(167,139,250,0.04);
        }
        .cu-callout--empty { border-left-style: dashed; }
        .cu-callout-label {
          font-size: 10px; font-family: var(--font-mono, monospace);
          text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;
        }
        .cu-callout--weird .cu-callout-label { color: var(--brand-green-bright, #15B981); }
        .cu-callout--signature .cu-callout-label { color: var(--brand-violet, #a78bfa); }
        .cu-callout-input {
          background: var(--bg-card, #1e1e22);
          border: 1px dashed var(--border-card, #2a2a2e);
          border-radius: 6px;
          padding: 6px 8px;
          outline: none;
          font-family: var(--font-body, inherit);
          font-size: 14px; color: var(--text-main, #e0e0e0);
          font-style: italic; line-height: 1.5;
          resize: vertical; min-width: 0; width: 100%; box-sizing: border-box;
          min-height: 32px;
          transition: border-color 120ms, background 120ms, box-shadow 120ms;
          cursor: text;
        }
        .cu-callout-input:hover { border-color: var(--text-muted, #888); background: var(--bg-card-hover, #2a2a2e); }
        .cu-callout--weird .cu-callout-input:focus {
          border-style: solid; border-color: var(--brand-green-bright, #15B981);
          box-shadow: 0 0 0 2px rgba(21, 185, 129, 0.12);
        }
        .cu-callout--signature .cu-callout-input:focus {
          border-style: solid; border-color: var(--brand-violet, #a78bfa);
          box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.12);
        }
        .cu-callout-input::placeholder { color: var(--text-faint, #6b6b73); font-style: italic; }

        /* PROSE fallback (only when nothing structured at all) */
        .cu-prose {
          padding: 0 18px 14px; font-size: 13px;
          color: var(--text-main, #e0e0e0);
          line-height: 1.55; white-space: pre-wrap;
        }

        /* BOTTOM textarea + CTA */
        .cu-textarea-wrap {
          border-top: 1px solid var(--border-card, #2a2a2e);
          padding: 12px 18px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .cu-textarea-label {
          font-size: 11px; color: var(--text-faint, #6b6b73);
          font-family: var(--font-mono, monospace);
          text-transform: uppercase; letter-spacing: 0.08em;
        }
        .cu-textarea {
          width: 100%; min-width: 0; box-sizing: border-box;
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, #2a2a2e);
          border-radius: 8px; padding: 10px 12px;
          font-family: inherit; font-size: 13px;
          color: var(--text-main, #e0e0e0);
          resize: vertical; outline: none;
        }
        .cu-textarea:focus { border-color: var(--brand-green-bright, #15B981); }
        .cu-textarea::placeholder { color: var(--text-faint, #6b6b73); }
        .cu-textarea:-webkit-autofill,
        .cu-textarea:-webkit-autofill:hover,
        .cu-textarea:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px var(--bg-card, #1e1e22) inset;
          box-shadow: 0 0 0 1000px var(--bg-card, #1e1e22) inset;
          -webkit-text-fill-color: var(--text-main, #f5f5f7);
          caret-color: var(--text-main, #f5f5f7);
          transition: background-color 600000s 0s, color 600000s 0s;
        }
        .cu-foot { display: flex; gap: 8px; padding: 0 18px 16px; }
        .cu-btn {
          flex: 1; padding: 12px 18px; border-radius: 8px;
          font-family: var(--font-mono, monospace); font-weight: 700;
          font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
          cursor: pointer; border: 1px solid transparent;
          transition: opacity 200ms, background 200ms, color 200ms;
        }
        .cu-btn--primary {
          border-color: var(--brand-green-bright, #15B981);
          background: var(--brand-green-bright, #15B981);
          color: #0a0a0a;
        }
        .cu-btn--primary:hover:not(:disabled) { filter: brightness(1.08); }
        .cu-btn--locked {
          background: var(--bg-card-hover, #2a2a2e);
          border-color: var(--border-card, #2a2a2e);
          color: var(--text-faint, #6b6b73);
          cursor: not-allowed;
        }
        .cu-btn--locked:hover { filter: none; }
        .cu-btn:disabled { cursor: not-allowed; }
        .cu-btn--primary:disabled:not(.cu-btn--locked) { opacity: 0.5; }
      `}</style>
    </div>
  )
}
