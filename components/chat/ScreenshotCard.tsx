/**
 * ScreenshotCard — chat toolcard for CD's `screenshot` MCP tool result.
 *
 * Renders the captured PNG in a `.tool-card-img-frame` with reshoot buttons
 * for the other two frame sizes. Mockup: docs/toolcards-mockup.html
 * § Archetype 4 — Control cards.
 *
 * Reshoot buttons fire `/api/mcp/screenshot` directly with the same target
 * but a different frame; the route publishes a fresh `screenshot_taken`
 * event so a new card lands in chat.
 *
 * (Ralph 2026-05-06: WP-22 Phase 1.)
 */
'use client'

import * as React from 'react'
import { useState, useCallback } from 'react'
import type { ScreenshotCardPayload } from '@/lib/types'

interface ScreenshotCardProps extends Omit<ScreenshotCardPayload, 'kind'> {
  sessionId: string
}

const FRAMES: ReadonlyArray<{ id: 'desktop' | 'tablet' | 'mobile'; label: string }> = [
  { id: 'desktop', label: 'desktop' },
  { id: 'tablet', label: 'tablet' },
  { id: 'mobile', label: 'mobile' },
]

export function ScreenshotCard({ savedPath, target, frame, dims, sessionId }: ScreenshotCardProps) {
  const [reshooting, setReshooting] = useState<string | null>(null)

  const reshoot = useCallback(async (newFrame: 'desktop' | 'tablet' | 'mobile') => {
    if (reshooting) return
    setReshooting(newFrame)
    try {
      await fetch('/api/mcp/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, target, frame: newFrame }),
      })
      // Server publishes screenshot_taken — page.tsx subscriber pushes a fresh
      // card. Nothing to do here.
    } catch {
      // Best-effort; silent failure is OK — a fresh card just won't land.
    } finally {
      setReshooting(null)
    }
  }, [reshooting, sessionId, target])

  const aspect: '16-9' | '3-4' | '1-1' =
    frame === 'mobile' ? '3-4' : frame === 'tablet' ? '3-4' : '16-9'

  return (
    <div
      className="tool-card screenshot-card"
      role="region"
      aria-label={`Screenshot: ${target} / ${frame}`}
    >
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="cyan" aria-hidden>📷</span>
        <span className="tool-card-title">Screenshot: {target} / {frame}</span>
        <span className="tool-card-meta">{dims.width}×{dims.height}</span>
      </div>
      <div className="tool-card-body">
        <div className="tool-card-img-frame" data-aspect={aspect}>
          {/* The savedPath is rooted at /<session>/screenshots/<file>.png. */}
          <img src={savedPath} alt={`Screenshot of ${target}`} />
        </div>
      </div>
      <div className="tool-card-foot">
        <a
          href={savedPath}
          target="_blank"
          rel="noopener noreferrer"
          className="tool-card-btn"
          data-variant="primary"
        >
          Open full
        </a>
        {FRAMES.filter((f) => f.id !== frame).map((f) => (
          <button
            key={f.id}
            type="button"
            className="tool-card-btn"
            data-variant="ghost"
            onClick={() => reshoot(f.id)}
            disabled={reshooting !== null}
            aria-disabled={reshooting !== null}
          >
            {reshooting === f.id ? `Reshooting ${f.label}…` : `Reshoot ${f.label}`}
          </button>
        ))}
      </div>
    </div>
  )
}
