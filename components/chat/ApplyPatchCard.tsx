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
  // Ralph 2026-05-12 — defensive defaults. The live apply_patch_complete
  // handler in page.tsx coerces all fields, but the card_preview path
  // forwards payload opaquely AND the preview-card route's `apply_patch`
  // case currently validates `payload.file` (wrong field name) and skips
  // `diff` entirely. If CD fires preview_card({kind:'apply_patch',
  // payload:{file:'x.html'}}) the card receives `diff: undefined` and
  // crashes at `diff.split('\n')`. Default at the component boundary so
  // it never crashes regardless of upstream path.
  const safeFilename = typeof filename === 'string' && filename ? filename : 'unknown'
  const safeDiff = typeof diff === 'string' ? diff : ''
  const safeAffected = typeof affected === 'number' ? affected : 0
  const safeEditKind = typeof editKind === 'string' && editKind ? editKind : 'edit'
  const safeAnchor = typeof anchor === 'string' && anchor ? anchor : '(no-selector)'
  const lines = safeDiff.split('\n').filter((l) => l.length > 0)
  return (
    <div
      className="tool-card apply-patch-card"
      role="region"
      aria-label={`Patched ${safeFilename}`}
    >
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="violet" aria-hidden>✎</span>
        <span className="tool-card-title">Patched {safeFilename}</span>
        <span className="tool-card-meta">{safeAffected} affected</span>
      </div>
      <div className="tool-card-body">
        <div className="tool-card-readout tool-card-readout--top">
          <span className="tool-card-readout-label">{safeEditKind}</span>
          {safeAnchor}
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
