/**
 * UploadEvalCard — chat toolcard for CD's evaluation of a user upload.
 *
 * Fires alongside the `cd.upload-evaluated` snackbar (Ralph 2026-05-06):
 *   - Snackbar: the moment-feedback (verdict + one-line note)
 *   - This card: the permanent chat-record (image + description + verdict
 *     + status/tag row + CD-suggested slot intents)
 *
 * Shape mirrors the mockup at `docs/toolcards-mockup.html` (search for
 * "submit_upload_eval"). Status/Tag share a single row; STAR/B-ROLL/TRASH
 * are the user-assignable triad. INGESTED is the system fallback for fresh
 * uploads with no user-curation yet.
 *
 * Migrated 2026-05-06 to the `.tool-card` chassis (app/globals.css) so
 * every toolcard in the chat surface speaks the same visual grammar.
 *
 * Mutating the tag fires `/api/mcp/update-image-metadata` (same gateway the
 * View-tab TagOverlay uses) so the asset library updates automatically via
 * the `assets_updated` event chain.
 */
'use client'

import * as React from 'react'
import { useState, useCallback } from 'react'
import type { UploadEvalCardPayload } from '@/lib/types'

type UserTag = 'STAR' | 'B-ROLL' | 'TRASH'

const FEATHER_STAR_POINTS =
  '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'

// Drop the `kind` discriminator — that's parent-level routing data, not
// something the component needs in its props.
interface UploadEvalCardProps extends Omit<UploadEvalCardPayload, 'kind'> {
  /** Session id — required to write the tag back via update-image-metadata. */
  sessionId: string
}

export function UploadEvalCard({
  filename,
  verdict,
  note,
  description,
  suggestedUses,
  status: initialStatus,
  sessionId,
}: UploadEvalCardProps) {
  // Ralph 2026-05-12 — images live in `/{sessionId}/` by definition (Next.js
  // serves `public/{sessionId}/` at the root). No `path` prop, no `/uploads/`
  // fallback. Both lied. If sessionId is missing the URL fails loud — that's
  // a config bug upstream, not something the card should silently mask.
  const safeFilename = typeof filename === 'string' && filename ? filename : 'upload.jpg'
  const src = `/${sessionId}/${safeFilename}`
  const safeSuggestedUses = Array.isArray(suggestedUses) ? suggestedUses : []
  const safeVerdict: '✓' | '≈' | '✗' = verdict === '✓' || verdict === '≈' || verdict === '✗' ? verdict : '≈'
  const safeNote = typeof note === 'string' ? note : ''
  const safeStatus: UserTag | 'INGESTED' = initialStatus ?? 'INGESTED'

  const [pendingTag, setPendingTag] = useState<UserTag | null>(null)
  const [isWriting, setIsWriting] = useState(false)
  const currentTag: UserTag | 'INGESTED' = pendingTag ?? safeStatus

  const setTag = useCallback(async (next: UserTag) => {
    if (isWriting) return
    // Toggle off if clicking active → fall back to INGESTED.
    const isClear = currentTag === next
    const target = isClear ? null : next
    setPendingTag(target)
    setIsWriting(true)
    try {
      await fetch('/api/mcp/update-image-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          filename,
          status: target ?? 'INGESTED',
        }),
      })
    } catch {
      // Optimistic stays on-screen.
    } finally {
      setIsWriting(false)
    }
  }, [currentTag, filename, isWriting, sessionId])

  const verdictColor = safeVerdict === '✓' ? 'var(--brand-green-bright, #10B981)'
    : safeVerdict === '✗' ? 'var(--brand-red, #EF4444)'
    : 'var(--brand-yellow, #FACC15)'

  return (
    <div
      className="tool-card upload-eval-card"
      role="region"
      aria-label={`Evaluated upload: ${safeFilename}`}
    >
      {/* HEAD ─────────────────────────────────────────── */}
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="cyan" aria-hidden>⬆</span>
        <span className="tool-card-title">Evaluated upload: {safeFilename}</span>
        <span className="tool-card-meta">just now</span>
      </div>

      {/* BODY ─────────────────────────────────────────── */}
      <div className="tool-card-body">
        <div className="tool-card-img-frame" data-aspect="16-9">
          <img
            src={src}
            alt={safeFilename}
            onError={(e) => {
              // File missing (common on previews with stub filenames).
              // Hide the broken-img icon + alt-text; leave the frame as a
              // clean gradient. Real uploads always resolve — this is a
              // preview-grace path, not a fallback URL.
              const t = e.currentTarget
              t.style.visibility = 'hidden'
            }}
          />
          <span className="tool-card-ratio-badge">
            {(safeFilename.split('.').pop() || 'JPG').toUpperCase()}
          </span>
        </div>

        {description && (
          <div className="tool-card-readout tool-card-readout--top">
            <span className="tool-card-readout-label">What it is</span>
            {description}
          </div>
        )}

        <div className="tool-card-readout tool-card-readout--bottom">
          <span className="tool-card-readout-label">Verdict</span>
          <span style={{ color: verdictColor, fontWeight: 700, marginRight: 4 }}>{safeVerdict}</span>
          {safeNote}
        </div>
      </div>

      {/* FOOT ─────────────────────────────────────────── */}
      <div className="tool-card-foot tool-card-foot-stack">
        {/* STATUS + TAG on one row */}
        <div className="tool-card-tag-row">
          <span className="tool-card-tag-label">Status</span>
          <span className="tool-card-chip" data-tone="ingested">INGESTED</span>
          <span className="tool-card-tag-sep" aria-hidden>|</span>
          <span className="tool-card-tag-label">Tag</span>
          <UserTagButton variant="STAR"   active={currentTag === 'STAR'}   onClick={() => setTag('STAR')}   disabled={isWriting} />
          <UserTagButton variant="B-ROLL" active={currentTag === 'B-ROLL'} onClick={() => setTag('B-ROLL')} disabled={isWriting} />
          <UserTagButton variant="TRASH"  active={currentTag === 'TRASH'}  onClick={() => setTag('TRASH')}  disabled={isWriting} />
        </div>

        {safeSuggestedUses.length > 0 && (
          <div className="tool-card-tag-row">
            <span className="tool-card-tag-label">Suggested uses</span>
            {safeSuggestedUses.map((use) => (
              <span
                key={use}
                className="tool-card-tag"
                style={{ cursor: 'default', textTransform: 'lowercase' }}
              >
                {use}
              </span>
            ))}
            <span style={{
              marginLeft: 'auto',
              color: 'var(--text-faint)',
              fontSize: 10,
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            }}>
              CD-suggested
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Internals ─────────────────────────────────────────────────────────────

function UserTagButton({
  variant,
  active,
  onClick,
  disabled,
}: {
  variant: UserTag
  active: boolean
  onClick: () => void
  disabled: boolean
}) {
  const isStar = variant === 'STAR'
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
      className="tool-card-tag"
      data-variant={variant}
      data-active={active ? 'true' : 'false'}
    >
      {isStar ? (
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
