'use client'

/**
 * LiveOverlay — top-right ambient strip (WP-22, 2026-05-06).
 *
 * Mounts inside ConversationPanel, anchored top-right. Renders in-flight
 * builds as live-mirror `BuildOverlayRow` cards (also reused by Scout's
 * ScoutJobsOverlay). Rendered only when ≥1 build is live — empty state =
 * nothing rendered (zero footprint, no card chrome flash). Purely
 * presentational: the parent owns the `builds` array and drops entries on
 * terminal state (`vibe_built` / `build_failed`).
 *
 * NOTE: the TodoWrite / UnfinishedTodos panel that used to share this strip
 * was removed 2026-06-13 — it auto-rewrote SESSION.md's `## Todos` section
 * through a fragile splice and corrupted the surrounding log.
 */

import { BuildOverlayRow } from './BuildOverlayRow'

export interface LiveOverlayProps {
  /** Retained for caller API compatibility; the builds-only overlay does
   *  not read it. */
  sessionId?: string | null
  /** In-flight builds tracked by the parent. Each one renders as a
   *  BuildOverlayRow inside its own bento card. Snaps out on terminal
   *  state — drop the entry from the array on `vibe_built`/`build_failed`. */
  builds?: BuildEntry[]
  /** Click handler for build rows (e.g. scroll inline receipt into view). */
  onBuildClick?: (jobId: string) => void
}

export interface BuildEntry {
  jobId: string
  thumb?: string
  id: string
  label?: string
  timeline?: string
  eta?: number
}

export function LiveOverlay({ builds = [], onBuildClick }: LiveOverlayProps) {
  // Visibility rule — render only when at least one build is live.
  if (builds.length === 0) return null

  return (
    <div
      // Top-right anchor inside the ChatPanel. Pointer-events on children
      // only so the empty space around cards doesn't intercept clicks
      // meant for the chat scroll surface beneath.
      className="live-overlay"
      style={{
        position: 'absolute',
        top: 5,
        right: 12,
        // Bottom anchor so the panel never extends past the input box.
        bottom: 240,
        display: 'flex',
        flexDirection: 'row-reverse',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        gap: 8,
        maxWidth: 'calc(100% - 24px)',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {/* BUILD cards — one card per in-flight job. New jobs land at the
          right edge (closest to corner) per row-reverse direction. */}
      {builds.map((b) => (
        <OverlayCard key={b.jobId} pointerEnabled>
          <BuildOverlayRow
            jobId={b.jobId}
            thumb={b.thumb}
            id={b.id}
            label={b.label}
            timeline={b.timeline}
            eta={b.eta}
            onClick={onBuildClick ? () => onBuildClick(b.jobId) : undefined}
          />
        </OverlayCard>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * OverlayCard — bento-card wrapper used by every overlay slot. Same theme
 * tokens as `ToolCard` (theme-radius, border, padding) so visual rhythm
 * matches the inline cards in the chat scroll.
 */
function OverlayCard({
  children,
  pointerEnabled,
}: {
  children: React.ReactNode
  pointerEnabled?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-card, 12px)',
        padding: 0,
        boxShadow: 'var(--shadow-card, 0 4px 16px rgba(0,0,0,0.32))',
        backdropFilter: 'blur(6px)',
        pointerEvents: pointerEnabled ? 'auto' : 'none',
        maxWidth: 400,
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}
