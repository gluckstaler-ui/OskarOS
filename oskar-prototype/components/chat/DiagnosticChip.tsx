/**
 * DiagnosticChip — single-row ambient chrome for cross-agent comms.
 *
 * NOT a card chassis — renders as an inline chip per mockup:
 * docs/toolcards-mockup.html § Archetype 4 (diagnostic chips). Single row,
 * no head/body/foot, no card-card border. Shows: glyph · label · accent · ts.
 *
 * Currently fires from `notify_agent` (CD-originated only). Same shape can
 * absorb `claim_orphan` and reduced `thread_history` summaries later.
 *
 * (Ralph 2026-05-06: WP-22 Phase 1.)
 */
'use client'

import * as React from 'react'
import type { DiagnosticChipPayload } from '@/lib/types'

interface DiagnosticChipProps extends Omit<DiagnosticChipPayload, 'kind'> {}

export function DiagnosticChip({ glyph, label, accent, ts }: DiagnosticChipProps) {
  // Local, hh:mm:ss only — full ISO would cost too much horizontal space in
  // the chip row.
  const tsShort = (() => {
    try {
      const d = new Date(ts)
      return d.toLocaleTimeString(undefined, { hour12: false })
    } catch {
      return ts
    }
  })()

  return (
    <span className="diagnostic-chip" role="note">
      <span className="diagnostic-chip-glyph" aria-hidden>{glyph}</span>
      <span className="diagnostic-chip-label">{label}</span>
      {accent ? <span className="diagnostic-chip-accent">{accent}</span> : null}
      <span className="diagnostic-chip-ts">{tsShort}</span>
    </span>
  )
}
