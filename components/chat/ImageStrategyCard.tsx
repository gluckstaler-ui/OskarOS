/**
 * ImageStrategyCard — Phase 3/5 slot plan from CD's
 * `present_image_strategy` MCP tool (Ralph 2026-05-10).
 *
 * Two layouts:
 *   - webpage-vertical: vertical list of slot rows (6-10 typical)
 *   - keynote-multi-row: M×5 CSS grid of slide cells (15-40 typical)
 *
 * Both share: header (violet IS avatar), body copy, stats line, textarea,
 * conditional CTA row. Layout only affects the middle rendering.
 *
 * Slot states:
 *   assigned       → image preview (or gradient fallback) + filename caption
 *   generate       → dashed yellow border + "GENERATE IMAGE" placeholder
 *   optional-empty → dimmed (0.55 opacity), "—" / "Type only" caption
 *
 * Click targets:
 *   - generate-state row/cell: fires onAction({ action: 'generate-single', generatedSlotName })
 *   - Generate All Images (N): fires onAction({ action: 'generate-all' })
 *   - Approve Images: fires onAction({ action: 'approve' })
 *   All actions include freeformText from textarea.
 */
'use client'

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import type { ImageStrategySlot, Preamble } from '@/lib/types'

/**
 * Cross-component swap-flow channel (Ralph 2026-05-14).
 *
 * Two CustomEvents on `window` bridge ImageStrategyCard ↔ AssetsPanel
 * without a global store:
 *
 *   oskar:is-select-slot
 *     detail: {vibeSlug, slotName} | null
 *     fired by ImageStrategyCard when user clicks a slot to mark it as
 *     swap target (or null to clear). AssetsPanel listens — when set,
 *     renders a top banner and intercepts BentoTile clicks.
 *
 *   oskar:is-swap-slot
 *     detail: {vibeSlug, slotName, filename, path?}
 *     fired by AssetsPanel when user clicks an image while a slot is
 *     selected. ImageStrategyCard listens — if vibeSlug matches its own,
 *     updates local override map so the slot displays the new image and
 *     clears the selection.
 *
 * MVP: swap is LOCAL VISUAL only. The card carries the override in state
 * (`overrides[slotName] = filename`); CD persists when the user submits
 * via Approve Images (the swap deltas are appended to freeformText).
 * Hotswap MCP integration would be a follow-up if persistence-before-
 * approve is wanted.
 */
export const IS_SELECT_EVT = 'oskar:is-select-slot'
export const IS_SWAP_EVT = 'oskar:is-swap-slot'
export interface ISSelectDetail {
  vibeSlug: string
  slotName: string
}
export interface ISSwapDetail {
  vibeSlug: string
  slotName: string
  filename: string
  path?: string
}

interface ImageStrategyCardProps {
  vibeSlug: string
  vibeName: string
  layout: 'webpage-vertical' | 'keynote-multi-row'
  phaseLabel: string
  /** CD-speaking preamble — "How the image plan fits" cyan callout per mockup §image-strategy. */
  preamble?: Preamble
  slots: ImageStrategySlot[]
  sessionId: string
  onSubmit: (response: {
    action: 'generate-all' | 'approve' | 'generate-single'
    generatedSlotName?: string
    freeformText: string
  }) => void
}

// ── Webpage Vertical Layout ────────────────────────────────────────────────

function WebpageSlotRow({
  slot,
  sessionId,
  isSelected,
  effectiveFilename,
  onSelectToggle,
  onGenerateSingle,
}: {
  slot: ImageStrategySlot
  sessionId: string
  isSelected: boolean
  /** Override filename if user swapped this slot in; otherwise slot.filename. */
  effectiveFilename?: string
  onSelectToggle: (name: string) => void
  onGenerateSingle: (name: string) => void
}) {
  if (slot.state === 'optional-empty') {
    // Optional slots stay non-interactive — swapping into a "type only" slot
    // doesn't fit the UX (it would silently promote it to assigned). Keep
    // dimmed and skip the click handler.
    return (
      <div className="is-slot-row" data-state="optional" style={{ opacity: 0.55 }}>
        <div className="is-slot-thumb is-slot-thumb--empty">—</div>
        <div className="is-slot-info">
          <span className="is-slot-name">{slot.slotName}</span>
          <span className="is-slot-caption">no image needed · type-only section</span>
        </div>
      </div>
    )
  }

  // Treat slot as "assigned" if it was assigned originally OR has a swap-in
  // override filename. The override branch lets the local swap show up
  // immediately even when the original state was 'generate'.
  const displayFilename = effectiveFilename || slot.filename
  const treatAsAssigned = (slot.state === 'assigned' && slot.filename) || !!effectiveFilename

  if (treatAsAssigned && displayFilename) {
    return (
      <div
        className="is-slot-row"
        data-state="assigned"
        data-selected={isSelected ? 'true' : undefined}
        role="button"
        tabIndex={0}
        title="Click to select this slot, then click an image in Assets to swap"
        onClick={() => onSelectToggle(slot.slotName)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectToggle(slot.slotName) } }}
      >
        <div className="is-slot-thumb">
          <img
            src={`/${sessionId}/${displayFilename}`}
            alt={slot.slotName}
            onError={(e) => {
              const t = e.currentTarget
              t.style.display = 'none'
              if (t.parentElement) t.parentElement.classList.add('is-slot-thumb--missing')
            }}
          />
        </div>
        <div className="is-slot-info">
          <span className="is-slot-name">{slot.slotName}</span>
          <span className="is-slot-caption">
            {slot.aspectRatio} · {slot.slotKind} · {displayFilename}
            {effectiveFilename && effectiveFilename !== slot.filename ? ' · swapped' : ''}
          </span>
        </div>
        {isSelected && <span className="is-slot-select-pill">CLICK AN ASSET ↔</span>}
      </div>
    )
  }

  // generate — clicking acts as SELECT (swap target) by default; if user
  // wants to fire the Nano prompt they use the Generate-All / Generate-Single
  // button row below. Pre-2026-05-14 the click fired generate-single
  // directly; now it goes through the swap-flow so users can substitute an
  // uploaded asset INTO a generate slot before approving.
  return (
    <div
      className="is-slot-row"
      data-state="generate"
      data-selected={isSelected ? 'true' : undefined}
      role="button"
      tabIndex={0}
      title="Click to select — then click an image in Assets to fill this slot. (Use Generate All to fire Nano instead.)"
      onClick={() => onSelectToggle(slot.slotName)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectToggle(slot.slotName) } }}
    >
      <div className="is-slot-thumb is-slot-thumb--generate">
        GENERATE IMAGE
      </div>
      <div className="is-slot-info">
        <span className="is-slot-name">{slot.slotName}</span>
        <span className="is-slot-caption">
          {slot.aspectRatio} · {slot.slotKind}
        </span>
        {slot.promptPreview && (
          <span className="is-slot-prompt">{slot.promptPreview}</span>
        )}
      </div>
      {isSelected && <span className="is-slot-select-pill">CLICK AN ASSET ↔</span>}
      {/* Direct-fire affordance kept available as a small inline button so
          we don't lose the original "click → fire Nano" path entirely. */}
      <button
        type="button"
        className="is-slot-fire-btn"
        onClick={(e) => { e.stopPropagation(); onGenerateSingle(slot.slotName) }}
        title="Fire Nano on this slot"
      >
        ⚡
      </button>
    </div>
  )
}

// ── Keynote Multi-Row Layout ───────────────────────────────────────────────

function KeynoteSlideCell({
  slot,
  sessionId,
  isSelected,
  effectiveFilename,
  onSelectToggle,
}: {
  slot: ImageStrategySlot
  sessionId: string
  isSelected: boolean
  effectiveFilename?: string
  onSelectToggle: (name: string) => void
}) {
  const isOptional = slot.state === 'optional-empty'
  const displayFilename = effectiveFilename || slot.filename
  const isAssigned = ((slot.state === 'assigned' && slot.filename) || !!effectiveFilename) && !!displayFilename
  const clickable = !isOptional

  return (
    <div
      className="is-slide-cell"
      data-state={isOptional ? 'type-only' : (isAssigned ? 'assigned' : slot.state)}
      data-selected={isSelected ? 'true' : undefined}
    >
      <span className="is-slide-label">{slot.slotName}</span>
      <div
        className="is-slide-thumb"
        style={isOptional ? { opacity: 0.55 } : undefined}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        title={clickable ? 'Click to select — then click an image in Assets to swap' : undefined}
        onClick={clickable ? () => onSelectToggle(slot.slotName) : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectToggle(slot.slotName) } } : undefined}
      >
        {isAssigned && (
          <>
            <img
              src={`/${sessionId}/${displayFilename}`}
              alt={slot.slotName}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            <span className="is-slide-check">✓</span>
          </>
        )}
        {!isAssigned && slot.state === 'generate' && (
          <span className="is-slide-generate-label">GENERATE IMAGE</span>
        )}
        {isOptional && (
          <span className="is-slide-type-only">Type only</span>
        )}
        {isSelected && (
          <span className="is-slide-select-pill">↔</span>
        )}
      </div>
    </div>
  )
}

// ── Main Card ──────────────────────────────────────────────────────────────

export function ImageStrategyCard({
  vibeSlug,
  vibeName,
  layout,
  phaseLabel,
  preamble,
  slots,
  sessionId,
  onSubmit,
}: ImageStrategyCardProps) {
  const [freeformText, setFreeformText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  // Swap-flow state: which slot (by name) is currently selected as swap target,
  // and the local override map of slotName → swapped-in filename. Overrides
  // shadow slot.filename for display + state-treatment.
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})

  /**
   * Dispatch a select-slot event so AssetsPanel knows we're in swap mode.
   * Passing null clears the mode. Wrapped in useCallback so the unmount
   * effect below can call it without restarting subscriptions every render.
   */
  const broadcastSelect = useCallback((slotName: string | null) => {
    if (typeof window === 'undefined') return
    const detail: ISSelectDetail | null = slotName ? { vibeSlug, slotName } : null
    window.dispatchEvent(new CustomEvent(IS_SELECT_EVT, { detail }))
  }, [vibeSlug])

  /**
   * Toggle a slot's selection. Clicking the already-selected slot deselects it
   * (and broadcasts null so AssetsPanel exits swap mode). Clicking a different
   * slot replaces selection (still one selected at a time — single swap
   * target). Submitted cards ignore clicks.
   */
  const handleSelectToggle = useCallback((slotName: string) => {
    if (submitted) return
    setSelectedSlot((prev) => {
      const next = prev === slotName ? null : slotName
      broadcastSelect(next)
      return next
    })
  }, [submitted, broadcastSelect])

  /**
   * Listen for swap-events fired by AssetsPanel. Only react when the event's
   * vibeSlug matches our own (multiple cards in the chat history could be
   * mounted at once; without scoping a swap intended for vibe-3 would update
   * vibe-5's state too).
   */
  useEffect(() => {
    function onSwap(e: Event) {
      const ce = e as CustomEvent<ISSwapDetail>
      const d = ce.detail
      if (!d || d.vibeSlug !== vibeSlug) return
      // Apply the override, clear selection, broadcast clear so the panel
      // returns to normal click behavior.
      setOverrides((prev) => ({ ...prev, [d.slotName]: d.filename }))
      setSelectedSlot(null)
      broadcastSelect(null)
    }
    window.addEventListener(IS_SWAP_EVT, onSwap as EventListener)
    return () => window.removeEventListener(IS_SWAP_EVT, onSwap as EventListener)
  }, [vibeSlug, broadcastSelect])

  // On unmount or vibeSlug change, broadcast clear so a re-fired card doesn't
  // leave AssetsPanel stuck in swap mode pointing at a card that's gone.
  useEffect(() => {
    return () => { broadcastSelect(null) }
  }, [broadcastSelect])

  // Compute effective state based on overrides — a swap-in flips a generate
  // slot to assigned for accounting purposes.
  const effectiveState = (s: ImageStrategySlot) =>
    overrides[s.slotName] ? 'assigned' : s.state

  const assigned = slots.filter((s) => effectiveState(s) === 'assigned').length
  const generate = slots.filter((s) => effectiveState(s) === 'generate').length
  const optional = slots.filter((s) => s.state === 'optional-empty').length
  const isKeynote = layout === 'keynote-multi-row'

  // Build a human-readable swap-deltas paragraph for the freeform payload.
  // When the user clicks Approve / Generate-All / Generate-Single, CD reads
  // these so the persisted vibe brief matches what the user saw.
  function buildSwapNote(): string {
    const entries = Object.entries(overrides)
    if (entries.length === 0) return ''
    const lines = entries.map(([slot, file]) => `- ${slot} → ${file}`)
    return `Slot swaps:\n${lines.join('\n')}`
  }

  function handleAction(action: 'generate-all' | 'approve' | 'generate-single', generatedSlotName?: string) {
    if (submitted) return
    setSubmitted(true)
    broadcastSelect(null)
    const swapNote = buildSwapNote()
    const combinedFreeform = [freeformText.trim(), swapNote].filter(Boolean).join('\n\n')
    onSubmit({ action, generatedSlotName, freeformText: combinedFreeform })
  }

  const rows = Math.ceil(slots.length / 5)

  return (
    <div className="tool-card image-strategy" data-style="image-strategy">
      {/* Header */}
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="violet" aria-hidden>IS</span>
        <div className="tool-card-head-text">
          <span className="tool-card-title">Image Strategy · {vibeName}</span>
          <span className="tool-card-meta">
            Layout: {layout}
            {isKeynote ? ` · ${slots.length} slides · ${rows} rows × 5` : ''} · {phaseLabel}
          </span>
        </div>
        <span className="tool-card-pill" data-accent="violet">REVIEW</span>
      </div>

      {/* Body copy */}
      <div className="tool-card-body">
        {/* CD-speaking preamble — cyan callout per mockup §image-strategy.
            When CD provides {label, body}, it replaces the canned body copy. */}
        {preamble ? (
          <div className="is-preamble">
            <span className="is-preamble-label">{preamble.label}</span>
            <span className="is-preamble-body">{preamble.body}</span>
          </div>
        ) : (
          <p className="is-body-copy">
            {isKeynote
              ? `${slots.length} slides, image plan per slide. Click any placeholder to swap in an asset from the Assets panel — or generate them all in one batch.`
              : 'Click any GENERATE IMAGE slot to fire it from the Assets panel — or generate them all at once. Optional sections are dimmed — they don\'t need an image.'}
          </p>
        )}

        {/* Layout-specific rendering */}
        {isKeynote ? (
          <div
            className="is-slide-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '8px',
            }}
          >
            {slots.map((slot, i) => (
              <KeynoteSlideCell
                key={`${i}-${slot.slotName}`}
                slot={slot}
                sessionId={sessionId}
                isSelected={selectedSlot === slot.slotName}
                effectiveFilename={overrides[slot.slotName]}
                onSelectToggle={handleSelectToggle}
              />
            ))}
          </div>
        ) : (
          <div className="is-slot-list">
            {slots.map((slot, i) => (
              <WebpageSlotRow
                key={`${i}-${slot.slotName}`}
                slot={slot}
                sessionId={sessionId}
                isSelected={selectedSlot === slot.slotName}
                effectiveFilename={overrides[slot.slotName]}
                onSelectToggle={handleSelectToggle}
                onGenerateSingle={(name) => handleAction('generate-single', name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Stats line */}
      <div className="is-stats">
        <span className="is-stats-assigned">✓ Assigned: {assigned}</span>
        <span className="is-stats-generate">⚠ Generate: {generate}</span>
        <span className="is-stats-optional">
          {isKeynote ? `Type-only: ${optional}` : `Optional: ${optional}`}
        </span>
      </div>

      {/* Textarea */}
      <div className="is-textarea-wrap">
        <textarea
          className="is-textarea"
          placeholder={isKeynote
            ? 'Slide 7 needs a bolder palette — push the contrast.'
            : 'hero is good, but the location prompt reads too dramatic — soften blue-hour to dawn.'}
          value={freeformText}
          onChange={(e) => setFreeformText(e.target.value)}
          disabled={submitted}
          rows={2}
        />
      </div>

      {/* Action row */}
      <div className="tool-card-foot">
        {generate > 0 && (
          <button
            type="button"
            className="tool-card-btn"
            data-variant="primary"
            disabled={submitted}
            onClick={() => handleAction('generate-all')}
          >
            {submitted ? 'Submitted…' : `Generate All Images (${generate})`}
          </button>
        )}
        <button
          type="button"
          className="tool-card-btn"
          data-variant={generate > 0 ? 'secondary' : 'primary'}
          disabled={submitted}
          onClick={() => handleAction('approve')}
        >
          {submitted ? 'Submitted…' : 'Approve Images'}
        </button>
      </div>

      <style>{`
        .image-strategy .is-body-copy {
          font-size: 13px;
          color: var(--text-secondary, #888);
          margin: 0 0 12px;
          line-height: 1.5;
        }
        /* CD-speaking preamble — cyan border-left, universal "CD speaking"
           channel per docs/toolcards-mockup.html §image-strategy. */
        .image-strategy .is-preamble {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 0 0 14px;
          padding: 12px 14px;
          border-left: 2px solid var(--brand-cyan, #22d3ee);
          background: rgba(34, 211, 238, 0.04);
          border-radius: 0 8px 8px 0;
        }
        .image-strategy .is-preamble-label {
          font-size: 10px;
          color: var(--brand-cyan, #22d3ee);
          font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }
        .image-strategy .is-preamble-body {
          font-size: 13px;
          color: var(--text-main, inherit);
          line-height: 1.55;
        }

        /* ── Webpage vertical slot list ─────────────────────────── */
        .is-slot-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .is-slot-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px;
          border-radius: 8px;
          border: 1px solid var(--border-card, #333);
          cursor: pointer;
          position: relative;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
        }
        .is-slot-row[data-state="assigned"]:hover {
          background: rgba(34,211,238,0.04);
          border-color: rgba(34,211,238,0.35);
        }
        .is-slot-row[data-state="generate"] {
          border-style: dashed;
          border-color: var(--brand-yellow, #f5c542);
        }
        .is-slot-row[data-state="generate"]:hover {
          background: rgba(245, 197, 66, 0.06);
        }
        /* SELECTED — cyan ring outline, matches the swap-flow visual language
           shared with the AssetsPanel banner (Ralph 2026-05-14). */
        .is-slot-row[data-selected="true"] {
          border-color: var(--brand-cyan, #22d3ee);
          background: rgba(34,211,238,0.08);
          box-shadow: 0 0 0 2px rgba(34,211,238,0.35);
        }
        .is-slot-select-pill {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(34,211,238,0.18);
          color: var(--brand-cyan, #22d3ee);
          font-family: monospace;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.1em;
          pointer-events: none;
        }
        .is-slot-fire-btn {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: transparent;
          border: 1px solid var(--brand-yellow, #f5c542);
          color: var(--brand-yellow, #f5c542);
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .is-slot-fire-btn:hover {
          background: rgba(245,197,66,0.12);
        }
        /* Hide the fire button while the row is the active swap target so
           the select-pill doesn't overlap with it. */
        .is-slot-row[data-selected="true"] .is-slot-fire-btn { display: none; }
        /* Keynote slide-cell select state */
        .is-slide-cell[data-selected="true"] .is-slide-thumb {
          outline: 2px solid var(--brand-cyan, #22d3ee);
          outline-offset: 2px;
          background: rgba(34,211,238,0.08);
        }
        .is-slide-select-pill {
          position: absolute;
          top: 4px;
          right: 4px;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(34,211,238,0.85);
          color: #000;
          font-family: monospace;
          font-size: 9px;
          font-weight: 700;
        }
        .is-slot-thumb {
          width: 96px;
          height: 54px;
          border-radius: 4px;
          overflow: hidden;
          flex-shrink: 0;
          background: var(--surface-2, #1a1a1a);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          font-family: monospace;
          text-transform: uppercase;
        }
        .is-slot-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .is-slot-thumb--empty {
          color: var(--text-muted, #666);
        }
        .is-slot-thumb--generate {
          border: 1px dashed var(--brand-yellow, #f5c542);
          color: var(--brand-yellow, #f5c542);
          font-size: 9px;
        }
        .is-slot-thumb--missing {
          background: linear-gradient(135deg, var(--surface-2, #1a1a1a), var(--surface-3, #222));
        }
        .is-slot-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .is-slot-name {
          font-weight: 600;
          font-size: 13px;
        }
        .is-slot-caption {
          font-size: 11px;
          font-family: monospace;
          color: var(--text-muted, #666);
        }
        .is-slot-prompt {
          font-size: 11px;
          font-style: italic;
          color: var(--text-secondary, #888);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* ── Keynote M×5 grid ────────────────────────────────────── */
        .is-slide-cell {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .is-slide-label {
          font-family: monospace;
          font-size: 9px;
          text-transform: uppercase;
          color: var(--text-muted, #666);
          /* Ralph 2026-05-12: abridge long slide titles so the grid cells
             don't overflow into siblings. ellipsis = "SLIDE 1 — TITLE..." */
          display: block;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .is-slide-thumb {
          aspect-ratio: 16 / 9;
          border-radius: 4px;
          overflow: hidden;
          position: relative;
          background: var(--surface-2, #1a1a1a);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .is-slide-thumb[data-state="generate"] {
          border: 1px dashed var(--brand-yellow, #f5c542);
          cursor: pointer;
        }
        .is-slide-thumb[data-state="generate"]:hover {
          background: rgba(245, 197, 66, 0.06);
        }
        .is-slide-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .is-slide-check {
          /* Ralph 2026-05-12: bumped from a 7px pill to a 22px badge.
             User feedback: selection state was too small to read at a glance. */
          position: absolute;
          top: 6px;
          right: 6px;
          background: var(--brand-green-bright, #22c55e);
          color: #fff;
          width: 22px;
          height: 22px;
          font-size: 14px;
          font-weight: 700;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .is-slide-generate-label {
          font-size: 7px;
          font-weight: 700;
          font-family: monospace;
          text-transform: uppercase;
          color: var(--brand-yellow, #f5c542);
          text-align: center;
          line-height: 1.4;
        }
        .is-slide-type-only {
          font-size: 8px;
          font-weight: 700;
          font-family: monospace;
          text-transform: uppercase;
          color: var(--text-muted, #666);
        }

        /* ── Stats line ─────────────────────────────────────────── */
        .is-stats {
          display: flex;
          gap: 16px;
          font-family: monospace;
          font-size: 11px;
          text-transform: uppercase;
          padding: 8px 0;
        }
        .is-stats-assigned { color: var(--brand-green-bright, #22c55e); }
        .is-stats-generate { color: var(--brand-yellow, #f5c542); }
        .is-stats-optional { color: var(--text-muted, #666); }

        /* ── Textarea ────────────────────────────────────────────── */
        .is-textarea-wrap {
          padding: 4px 0 8px;
        }
        .is-textarea {
          width: 100%;
          /* Ralph 2026-05-12: use theme-aware vars. --bg-card resolves
             #1e1e22 in onyx and #ffffff in polar — was previously hardcoded
             via --surface-2 which doesn't exist, so the fallback #1a1a1a
             locked it dark in both themes. */
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, #333);
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 13px;
          color: var(--text-main, inherit);
          resize: vertical;
          font-family: inherit;
        }
        .is-textarea:focus {
          outline: none;
          border-color: var(--brand-violet, #a78bfa);
        }
        .is-textarea::placeholder {
          color: var(--text-muted, #555);
        }

        /* ── Pill badge ─────────────────────────────────────────── */
        .tool-card-pill {
          font-family: monospace;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 4px;
        }
        .tool-card-pill[data-accent="violet"] {
          background: rgba(167, 139, 250, 0.12);
          color: var(--brand-violet, #a78bfa);
        }

        /* ── Violet icon ─────────────────────────────────────────── */
        .tool-card-icon[data-accent="violet"] {
          background: rgba(167, 139, 250, 0.12);
          color: var(--brand-violet, #a78bfa);
        }

        /* ── Head layout with pill ───────────────────────────────── */
        .image-strategy .tool-card-head {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .image-strategy .tool-card-head-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .image-strategy .tool-card-icon {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          font-family: monospace;
          flex-shrink: 0;
        }

        /* ── Secondary button ────────────────────────────────────── */
        .tool-card-btn[data-variant="secondary"] {
          background: transparent;
          border: 1px solid var(--border-card, #333);
          color: var(--text-primary, #e0e0e0);
        }
        .tool-card-btn[data-variant="secondary"]:hover:not(:disabled) {
          border-color: var(--brand-violet, #a78bfa);
        }
      `}</style>
    </div>
  )
}
