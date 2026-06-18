'use client'

import type { ReactNode } from 'react'

// ============================================================================
// VerdictCard — THE shared verdict card (Ralph 2026-06-10 · TASTED redesign).
//
// Kanban's opp-dashboard verdict anatomy, REUSED 1:1 by Scout's TASTED panel
// — same component file, not a port. Chrome (tone-tinted card, VERDICT kicker,
// editable tag headline, prose) is identical on both surfaces; the right-hand
// stat stack differs per surface and rides in through the `stats` slot:
//
//   Kanban: CHF est · Close % · BUDGET (0–5 bars) · BUYING (0–5 dots)
//   Scout:  CHF EST (· N SECTIONS × 300) · PALAT (derived band) · BUYING
//
// Tag → tone: lib/verdict (PERSUE=green · WARMING UP=yellow · WATCH=orange ·
// SKIP=red). Styling lives in crm.css under .crm-opp-verdict* — Scout renders
// inside the /crm route, so the classes resolve on both surfaces.
// ============================================================================

interface VerdictCardProps {
  /** 4-tier tone — crm-opp-verdict--<tone> (good|mid|low|bad|info). */
  tone: string
  /** WP-22 tone setter — clicking the VERDICT kicker cycles the stored tone
   *  (good → mid → low → bad → good) so it can be re-set by hand without a
   *  re-taste/re-scan. Same affordance on both surfaces. */
  onToneCycle?: () => void
  /** Headline — the verdict tag (PERSUE / WARMING UP / WATCH / SKIP). */
  tag: string
  onTag?: (v: string) => void
  /** Optional one-liner under the headline (Kanban's verdict_subline). */
  subline?: string
  onSubline?: (v: string) => void
  prose: string
  onProse: (v: string) => void
  prosePlaceholder?: string
  /** Remount key so the uncontrolled textarea refreshes on external change. */
  proseKey?: string
  /** Optional rendering below the prose editor (Kanban's parsed › rows). */
  proseExtra?: ReactNode
  /** Right-hand stat stack — per-surface. */
  stats: ReactNode
}

export function VerdictCard({
  tone, onToneCycle, tag, onTag, subline, onSubline,
  prose, onProse, prosePlaceholder, proseKey, proseExtra, stats,
}: VerdictCardProps) {
  return (
    <div className={`crm-opp-verdict crm-opp-verdict--${tone}`}>
      <div>
        <div className="crm-opp-verdict-head">
          <span
            className="crm-opp-verdict-tag"
            onClick={onToneCycle}
            style={onToneCycle ? { cursor: 'pointer' } : undefined}
            title={onToneCycle ? 'Click to cycle the verdict tone — green · phosphor · orange · red' : undefined}
          >
            VERDICT
          </span>
          <h3
            className="crm-opp-verdict-headline crm-opp-edit"
            contentEditable={!!onTag}
            suppressContentEditableWarning
            onBlur={(e) => onTag?.(e.currentTarget.textContent?.trim() ?? '')}
          >
            {tag}
          </h3>
        </div>
        {subline !== undefined ? (
          <div
            className="crm-opp-verdict-subline crm-opp-edit"
            contentEditable={!!onSubline}
            suppressContentEditableWarning
            onBlur={(e) => onSubline?.(e.currentTarget.textContent?.trim() ?? '')}
          >
            {subline}
          </div>
        ) : null}
        <textarea
          className="crm-opp-edit crm-opp-verdict-prose-edit"
          placeholder={prosePlaceholder}
          defaultValue={prose}
          key={proseKey}
          onBlur={(e) => onProse(e.target.value)}
        />
        {proseExtra}
      </div>
      <div className="crm-opp-verdict-stack">{stats}</div>
    </div>
  )
}
