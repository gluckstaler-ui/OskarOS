'use client'

/**
 * Snackbar — 2026-05-03 v3 (adds Feather state icon inside the boxed
 * state pill per Ralph: "EACH OF THEM SHOULD HAVE A FEATHER ICON").
 *
 * Layout per state pill (left side):
 *   ┌──────────┐
 *   │ [icon]   │
 *   │ READY    │
 *   │ VIBE-1   │
 *   └──────────┘
 *
 * Right side: heading + message body, then outlined action(s) + dismiss.
 * WORKING uses a distinct outlined treatment (white fill / orange stroke
 * / orange text) — set in globals.css `.os-snackbar-progress .os-snackbar-state`.
 */

import { useState, useEffect } from 'react'
import { Feather, FeatherName } from './Feather'

export type SnackbarType = 'success' | 'info' | 'warning' | 'error' | 'progress'

export interface SnackbarAction {
  label: string
  onClick: () => void
}

export interface SnackbarProps {
  id: string
  type: SnackbarType
  message: string
  /** Optional heading line above the message body. */
  heading?: string
  /** Override the auto-derived state label (e.g. "VIBE READY"). */
  label?: string
  /** Optional event code under the state pill (e.g. "VIBE-1", "ITER 3/5"). */
  code?: string
  actions?: SnackbarAction[]
  duration?: number
  onDismiss: (id: string) => void
  isProgress?: boolean
}

const ICON_BY_TYPE: Record<SnackbarType, FeatherName> = {
  success: 'check-circle',
  info: 'info',
  warning: 'alert-triangle',
  error: 'x-octagon',
  progress: 'loader',
}

const DEFAULT_LABEL: Record<SnackbarType, string> = {
  success: 'Ready',
  info: 'Info',
  warning: 'Attention',
  error: 'Failed',
  progress: 'Working',
}

/** Heuristic: split a message on " — " into heading + body when neither
 *  is provided explicitly. Keeps existing callers visually richer without
 *  any API changes.
 *
 *  2026-05-03 (Ralph): if the auto-derived heading equals the state label
 *  ("Info" / "Success" / "Working" / etc.), skip the split entirely. The
 *  state pill already shows the label — duplicating it as the body
 *  heading puts the icon (in pill) and the name (in body) on the same
 *  horizontal line for no reason. */
function splitMessage(
  message: string,
  explicitHeading?: string,
  stateLabel?: string,
) {
  if (explicitHeading) return { heading: explicitHeading, body: message }
  const idx = message.indexOf(' — ')
  if (idx > 0 && idx < message.length - 4) {
    const candidate = message.slice(0, idx)
    if (
      stateLabel &&
      candidate.trim().toUpperCase() === stateLabel.trim().toUpperCase()
    ) {
      // Heading would duplicate the state pill — drop it, keep body only.
      return { heading: '', body: message.slice(idx + 3) }
    }
    return {
      heading: candidate,
      body: message.slice(idx + 3),
    }
  }
  return { heading: '', body: message }
}

export function Snackbar({
  id,
  type,
  message,
  heading,
  label,
  code,
  actions = [],
  duration = 5000,
  onDismiss,
  isProgress = false,
}: SnackbarProps) {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (duration > 0 && !isProgress) {
      const timer = setTimeout(() => {
        handleDismiss()
      }, duration)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, isProgress])

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(() => {
      onDismiss(id)
    }, 200)
  }

  const showProgressBar = isProgress || type === 'progress'
  const effectiveType: SnackbarType = showProgressBar ? 'progress' : type
  const stateClass = `os-snackbar-${effectiveType}`
  const stateLabel = (label ?? DEFAULT_LABEL[effectiveType]).toUpperCase()
  const iconName = ICON_BY_TYPE[effectiveType]
  const { heading: derivedHeading, body } = splitMessage(message, heading, stateLabel)

  return (
    <div
      className={`os-snackbar ${stateClass}${isExiting ? ' is-exiting' : ''}`}
      role="status"
    >
      <div className="os-snackbar-state">
        <div className="os-snackbar-state-icon">
          <Feather name={iconName} size={18} strokeWidth={2.25} />
        </div>
        <span className="os-snackbar-state-label">{stateLabel}</span>
        {code && <span className="os-snackbar-state-code">{code}</span>}
      </div>
      <div className="os-snackbar-body">
        {derivedHeading && (
          <span className="os-snackbar-heading">{derivedHeading}</span>
        )}
        <span className="os-snackbar-message">{body}</span>
      </div>
      <div className="os-snackbar-actions">
        {actions.map((action, index) => (
          <button
            key={index}
            type="button"
            className="os-snackbar-action"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          className="os-snackbar-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          <Feather name="x" size={12} strokeWidth={2.5} />
        </button>
      </div>
      {showProgressBar && <div className="os-snackbar-progress-bar" aria-hidden />}
    </div>
  )
}
