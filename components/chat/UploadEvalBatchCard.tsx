/**
 * UploadEvalBatchCard — table-shaped chat card for batch upload evaluations.
 *
 * Renders when ≥3 user uploads land within the page-level debounce window
 * (lib/types.ts UploadEvalBatchCardPayload). Anti-pollution pattern locked
 * 2026-05-06 (Ralph): "if uploaded images >=3, we display a table similar
 * to the building 4 vibes card". Spec confirmed in chat:
 *
 *     PICTURE — identifier — verdict — tag pill-row
 *
 * Tag column (CD directive 2026-05-06): inline pill-row with the THREE
 * user-assignable tags — STAR · B-ROLL · TRASH. Active pill highlighted;
 * the other two clickable to switch. NO dropdown, NO select element. NO
 * INGESTED in this card (it's the system fallback for "not yet evaluated"
 * — invisible to the user; if a row is here, CD has already evaluated).
 *
 * Each row uses the same write-back path as UploadEvalCard
 * (`/api/mcp/update-image-metadata`).
 *
 * Card chassis: standard `.tool-card` with `.tool-card-body-tight` so the
 * row grid hugs the head/foot dividers (mirrors the BuildJobCard layout).
 */
'use client'

import * as React from 'react'
import { useState, useCallback } from 'react'
import type {
  UploadEvalBatchCardPayload,
  UploadEvalBatchRow,
  UploadEvalBatchTag,
} from '@/lib/types'

interface UploadEvalBatchCardProps extends Omit<UploadEvalBatchCardPayload, 'kind'> {
  sessionId: string
}

// CD-assignable triad in display order. INGESTED, HERO/USED/READY/APPROVED/REDO
// are NOT here — they're either system fallbacks or auto-derived elsewhere.
const TAG_VARIANTS: ReadonlyArray<UploadEvalBatchTag> = ['STAR', 'B-ROLL', 'TRASH']

const VERDICT_COLOR: Record<UploadEvalBatchRow['verdict'], string> = {
  '✓': 'var(--brand-green-bright, #10B981)',
  '≈': 'var(--brand-yellow, #FACC15)',
  '✗': 'var(--brand-red, #EF4444)',
}

// Five-pointed star (SVG points). Lifted from UploadEvalCard so the visual
// language between single-row and batch is identical — same star, same pill.
const FEATHER_STAR_POINTS = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26'

export function UploadEvalBatchCard({ items, sessionId }: UploadEvalBatchCardProps) {
  // Defensive: `items` can be missing/malformed when the card arrives via
  // `preview_card` — the route forwards the agent's payload loose. Normalize
  // to an array so downstream reads never crash.
  const safeItems: UploadEvalBatchRow[] = Array.isArray(items) ? items : []

  // Per-row optimistic-write state — keyed by filename so the active pill
  // reflects the user's last click without a server round-trip.
  const [pending, setPending] = useState<Record<string, UploadEvalBatchTag>>({})
  const [writing, setWriting] = useState<Set<string>>(new Set())

  const setTag = useCallback(
    async (filename: string, next: UploadEvalBatchTag) => {
      setPending((p) => ({ ...p, [filename]: next }))
      setWriting((s) => new Set(s).add(filename))
      try {
        await fetch('/api/mcp/update-image-metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, filename, status: next }),
        })
      } catch {
        // Optimistic UI stays; failure is tolerable in this surface.
      } finally {
        setWriting((s) => {
          const n = new Set(s)
          n.delete(filename)
          return n
        })
      }
    },
    [sessionId],
  )

  if (safeItems.length === 0) {
    return (
      <div
        className="tool-card upload-eval-batch-card"
        role="region"
        aria-label="Evaluated upload batch (empty)"
      >
        <div className="tool-card-head">
          <span className="tool-card-icon" data-accent="cyan" aria-hidden>⬆</span>
          <span className="tool-card-title">Upload batch</span>
          <span className="tool-card-meta">no items</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="tool-card upload-eval-batch-card"
      role="region"
      aria-label={`Evaluated upload batch: ${safeItems.length} images`}
    >
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="cyan" aria-hidden>⬆</span>
        <span className="tool-card-title">Evaluated {safeItems.length} uploads</span>
        <span className="tool-card-meta">just now</span>
      </div>

      <div className="tool-card-body tool-card-body-tight">
        {safeItems.map((item, i) => {
          const activeTag: UploadEvalBatchTag | null =
            pending[item.filename] ?? (
              item.status === 'STAR' || item.status === 'B-ROLL' || item.status === 'TRASH'
                ? item.status
                : null  // legacy / unknown value → no pill highlighted
            )
          const isWriting = writing.has(item.filename)
          // Ralph 2026-05-12 — images live in `/{sessionId}/` by definition
          // (Next.js serves `public/{sessionId}/` at the root). No `item.path`,
          // no `/uploads/` fallback. Both lied. If sessionId is missing the
          // URL fails loud upstream.
          const itemSrc = `/${sessionId}/${item.filename}`
          return (
            <div className="upload-eval-row" key={`${item.filename}-${i}`}>
              {/* PICTURE — small thumbnail */}
              <div className="upload-eval-row-thumb">
                <img
                  src={itemSrc}
                  alt={item.filename}
                  onError={(e) => {
                    // File missing (preview stubs, deleted assets). Hide the
                    // broken-img glyph; thumb cell becomes a flat grey.
                    const t = e.currentTarget
                    t.style.visibility = 'hidden'
                  }}
                />
              </div>

              {/* IDENTIFIER — filename in mono */}
              <div className="upload-eval-row-id">
                {item.filename}
              </div>

              {/* CD VERDICT — glyph + one-line note */}
              <div className="upload-eval-row-verdict">
                <span
                  className="upload-eval-row-verdict-glyph"
                  style={{ color: VERDICT_COLOR[item.verdict] }}
                  aria-label={`Verdict ${item.verdict}`}
                >
                  {item.verdict}
                </span>
                <span className="upload-eval-row-verdict-note">{item.note}</span>
              </div>

              {/* TAG PILL-ROW — STAR · B-ROLL · TRASH (CD-assignable triad).
                  NO dropdown, NO select. One-tap reassignment. */}
              <div
                className="upload-eval-row-tag-pillrow"
                role="radiogroup"
                aria-label={`Tag for ${item.filename}`}
              >
                {TAG_VARIANTS.map((variant) => (
                  <BatchTagPill
                    key={variant}
                    variant={variant}
                    active={activeTag === variant}
                    disabled={isWriting}
                    onClick={() => setTag(item.filename, variant)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BatchTagPill — visual lift from UploadEvalCard's UserTagButton so single-
// row and batch surfaces share an exact pill grammar. STAR gets the filled
// star icon when active. B-ROLL / TRASH render text-only.
// ─────────────────────────────────────────────────────────────────────────────

function BatchTagPill({
  variant,
  active,
  disabled,
  onClick,
}: {
  variant: UploadEvalBatchTag
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  const title =
    variant === 'STAR'   ? 'Mark as a great picture'
    : variant === 'B-ROLL' ? 'Keep as secondary / variant'
    : 'Cull this asset'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      role="radio"
      aria-checked={active}
      className="tool-card-tag"
      data-variant={variant}
      data-active={active ? 'true' : 'false'}
    >
      {variant === 'STAR' ? (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill={active ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points={FEATHER_STAR_POINTS}></polygon>
          </svg>
          STAR
        </>
      ) : (
        variant
      )}
    </button>
  )
}
