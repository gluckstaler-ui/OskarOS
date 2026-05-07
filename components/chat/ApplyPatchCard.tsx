/**
 * ApplyPatchCard — chat toolcard for CD's `apply_patch` MCP tool result.
 *
 * Renders the typed-edit diff in `.diff` grammar (red/green per-line) per
 * mockup: docs/toolcards-mockup.html § Archetype 2 — Diff cards. The head
 * shows filename + edit-kind chip + anchor; the body shows the unified-style
 * diff string returned by html-patch-engine.
 *
 * (Ralph 2026-05-06: WP-22 Phase 1.)
 */
'use client'

import * as React from 'react'
import type { ApplyPatchCardPayload } from '@/lib/types'

interface ApplyPatchCardProps extends Omit<ApplyPatchCardPayload, 'kind'> {}

export function ApplyPatchCard({ filename, editKind, anchor, affected, diff }: ApplyPatchCardProps) {
  const lines = diff.split('\n').filter((l) => l.length > 0)
  return (
    <div
      className="tool-card apply-patch-card"
      role="region"
      aria-label={`Patched ${filename}`}
    >
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="violet" aria-hidden>✎</span>
        <span className="tool-card-title">Patched {filename}</span>
        <span className="tool-card-meta">{affected} affected</span>
      </div>
      <div className="tool-card-body">
        <div className="tool-card-readout tool-card-readout--top">
          <span className="tool-card-readout-label">{editKind}</span>
          {anchor}
        </div>
        <div className="apply-patch-diff" role="group" aria-label="Diff">
          {lines.map((line, i) => {
            const isAdd = line.startsWith('+')
            const isDel = line.startsWith('-')
            const klass = isAdd ? 'add' : isDel ? 'del' : 'ctx'
            return (
              <div key={i} className={`apply-patch-line apply-patch-line-${klass}`}>
                <span className="apply-patch-marker" aria-hidden>
                  {isAdd ? '+' : isDel ? '-' : ' '}
                </span>
                <span className="apply-patch-content">
                  {isAdd || isDel ? line.slice(1) : line}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
