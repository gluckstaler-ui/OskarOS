'use client'

import { Logo } from '../Logo'
import { useEffect, useRef, useState } from 'react'

// ============================================================================
// StudioLogo — Studio's left-slot fill for <TopBar>.
//
// Wraps the shared <Logo suffix="FIRN" /> wordmark and appends Studio's
// project-name rename block (click-to-edit, Enter/blur commits, Esc cancels).
// CRM and Admin use the same <Logo> with a different suffix; they don't have
// the project rename because their session is canonical.
// ============================================================================

interface Props {
  sessionName: string | null
  onSessionRename?: (newName: string) => void | Promise<void>
}

export function StudioLogo({ sessionName, onSessionRename }: Props) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(sessionName ?? '')
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // Keep draft in sync with the prop while NOT editing — once the user
    // starts editing, the draft is theirs until commit/cancel.
    if (!isEditingName) setNameDraft(sessionName ?? '')
  }, [sessionName, isEditingName])

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [isEditingName])

  const commitName = () => {
    const next = nameDraft.trim()
    setIsEditingName(false)
    if (!next || next === (sessionName ?? '')) {
      setNameDraft(sessionName ?? '')
      return
    }
    onSessionRename?.(next)
  }
  const cancelName = () => {
    setNameDraft(sessionName ?? '')
    setIsEditingName(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
      <Logo suffix="FIRN" />

      {/* Divider */}
      <div style={{ height: '24px', width: '1px', backgroundColor: 'var(--border-card)' }} />

      {/* Session Info — Two lines. PROJECT label static; value is click-to-edit. */}
      {sessionName && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span
            style={{
              fontSize: '9px',
              color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              lineHeight: 1,
              marginBottom: '4px',
            }}
          >
            Project
          </span>
          {isEditingName ? (
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitName()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelName()
                }
              }}
              style={{
                fontSize: '16px',
                fontWeight: 700,
                letterSpacing: '-0.01em',
                lineHeight: 1,
                color: 'var(--text-main)',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--brand-green-bright)',
                outline: 'none',
                padding: '1px 0',
                fontFamily: 'inherit',
                width: `${Math.max(nameDraft.length, 4)}ch`,
                minWidth: '6ch',
              }}
            />
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={() => setIsEditingName(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setIsEditingName(true)
                }
              }}
              title="Click to rename project"
              style={{
                fontSize: '16px',
                color: 'var(--text-main)',
                fontWeight: 700,
                letterSpacing: '-0.01em',
                lineHeight: 1,
                cursor: 'text',
                borderBottom: '1px dashed transparent',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderBottomColor = 'var(--border-card)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderBottomColor = 'transparent'
              }}
            >
              {sessionName}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
