'use client'

/**
 * BuildOverlayRow — compact live-mirror primitive for in-flight builds
 * (WP-22, 2026-05-06).
 *
 * Per Feature-X §2.3: "Tier 2 build cards render INLINE as receipts AND
 * clone a compact mirror row into overlay while `running`. Snaps out of
 * overlay on terminal state."
 *
 * Same fields as the inline Tier-2 build card, NO card chrome — this lives
 * inside `<LiveOverlay />` which provides the bento card itself. Keep the
 * row tight (≤ 32px tall in compact mode) so multiple in-flight builds
 * don't blow the overlay's vertical budget.
 *
 * Spec fields:
 *   - jobId    — used as React key; not visually surfaced
 *   - thumb    — small image preview (16×16) of the in-progress vibe, optional
 *   - id       — short build identifier (e.g. "vibe-3"), uppercase mono
 *   - label    — human label (e.g. "FalCaMel — Vibe 3"), optional
 *   - timeline — current step ("Layout 4/8", "Generate hero", etc.)
 *   - eta      — estimated seconds remaining, optional
 *
 * Status visuals derived from progress (running has a pulse on the dot).
 * On terminal state the parent <LiveOverlay /> drops the row; the inline
 * receipt in chat owns the durable record.
 */

import { useEffect, useState } from 'react'

export interface BuildOverlayRowProps {
  jobId: string
  thumb?: string
  id: string
  label?: string
  timeline?: string
  /** Seconds remaining (for ETA pill). Optional — when undefined we show
   *  the timeline only. */
  eta?: number
  /** Click handler for the row (e.g. open the inline receipt in chat). */
  onClick?: () => void
}

export function BuildOverlayRow({
  thumb,
  id,
  label,
  timeline,
  eta,
  onClick,
}: BuildOverlayRowProps) {
  // Tick the ETA down locally so the user sees motion without a server
  // re-emit on every second. Resets when the parent passes a new `eta`.
  const [localEta, setLocalEta] = useState<number | undefined>(eta)
  useEffect(() => {
    setLocalEta(eta)
  }, [eta])
  useEffect(() => {
    if (localEta === undefined || localEta <= 0) return
    const t = setInterval(() => {
      setLocalEta((v) => (v === undefined ? v : Math.max(0, v - 1)))
    }, 1000)
    return () => clearInterval(t)
  }, [localEta])

  return (
    <button
      type="button"
      onClick={onClick}
      title={label ? `${id} · ${label}` : id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'inherit',
        textAlign: 'left',
        minHeight: 28,
        maxWidth: 280,
      }}
    >
      {/* Pulsing run indicator */}
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--success, #10B981)',
          flexShrink: 0,
          animation: 'live-overlay-pulse 1.4s ease-in-out infinite',
        }}
      />

      {/* Thumb */}
      {thumb && (
        <img
          src={thumb}
          alt=""
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: 3,
            objectFit: 'cover',
            flexShrink: 0,
            border: '1px solid var(--border-card)',
          }}
        />
      )}

      {/* Identity column — id + (optional) label stacked */}
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          flex: 1,
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: 'var(--text-main)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textTransform: 'uppercase',
          }}
        >
          {id}
        </span>
        {timeline && (
          <span
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {timeline}
          </span>
        )}
      </span>

      {/* ETA pill */}
      {localEta !== undefined && localEta > 0 && (
        <span
          style={{
            padding: '2px 6px',
            borderRadius: 3,
            background: 'var(--pill-bg, rgba(255,255,255,0.06))',
            border: '1px solid var(--pill-border, rgba(255,255,255,0.10))',
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
            flexShrink: 0,
            letterSpacing: '0.04em',
          }}
        >
          {formatEta(localEta)}
        </span>
      )}

      {/* Pulse keyframes — scoped via :global so the parent stylesheet
          doesn't have to know about it. Repeated mounts share the same
          rule (browser dedupes). */}
      <style jsx global>{`
        @keyframes live-overlay-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.85); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes live-overlay-pulse {
            0%, 100% { opacity: 1; transform: none; }
            50%      { opacity: 1; transform: none; }
          }
        }
      `}</style>
    </button>
  )
}

function formatEta(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}
