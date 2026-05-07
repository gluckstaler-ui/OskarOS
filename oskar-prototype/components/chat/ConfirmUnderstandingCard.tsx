/**
 * ConfirmUnderstandingCard — summary panel from CD's
 * `confirm_understanding` MCP tool (Ralph 2026-05-04).
 *
 * Render slot: assistant-message companion. Source styling: `.tool-card`
 * chassis (app/globals.css). Migrated 2026-05-06 from the agency-tracker
 * `.unfinished-todos` chassis — that look is reserved for the TodoWrite
 * panel where "agent narrating itself" needs HUD prominence. This card is
 * a milestone in the discovery conversation; it earns the same neutral
 * bento grammar as the rest of the toolcard surface.
 *
 * UX:
 *   - readyToGenerate=true  → summary + "Build it" button. Click fires
 *     `onBuild()` which the parent wires to the existing build_all_vibes
 *     trigger path (same as user typing "build all").
 *   - readyToGenerate=false → summary only. User can keep talking.
 *
 * Once submitted (Build clicked), the card disables itself so the user
 * can't double-fire. The build's own snackbar/progress UI takes over.
 */
'use client'

import * as React from 'react'
import { useState } from 'react'

interface ConfirmUnderstandingCardProps {
  summary: string
  readyToGenerate: boolean
  /** Called when the user clicks the "Build it" button. Parent wires
   * this to the existing build_all_vibes trigger path. */
  onBuild?: () => void
}

export function ConfirmUnderstandingCard({
  summary,
  readyToGenerate,
  onBuild,
}: ConfirmUnderstandingCardProps) {
  const [building, setBuilding] = useState(false)

  function handleBuild() {
    if (building || !onBuild) return
    setBuilding(true)
    try { onBuild() } catch (err) { console.error('[ConfirmUnderstandingCard] onBuild threw:', err) }
  }

  return (
    <div
      className="tool-card confirm-understanding"
      role="region"
      aria-label="Understanding confirmation"
    >
      <div className="tool-card-head">
        <span
          className="tool-card-icon"
          data-accent={readyToGenerate ? 'green' : 'cyan'}
          aria-hidden
        >
          {readyToGenerate ? '✓' : '◐'}
        </span>
        <span className="tool-card-title">
          {readyToGenerate ? 'Ready to build' : 'Where I am so far'}
        </span>
      </div>
      <div className="tool-card-body">
        <p className="tool-card-summary">{summary}</p>
      </div>
      {readyToGenerate && onBuild ? (
        <div className="tool-card-foot">
          <button
            type="button"
            className="tool-card-btn"
            data-variant="primary"
            onClick={handleBuild}
            disabled={building}
            aria-disabled={building}
          >
            {building ? 'Building…' : 'Looks right — build it'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
