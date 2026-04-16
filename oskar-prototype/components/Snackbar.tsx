'use client'

import { useState, useEffect, CSSProperties } from 'react'

export type SnackbarType = 'success' | 'info' | 'warning' | 'error' | 'progress'

export interface SnackbarAction {
  label: string
  onClick: () => void
}

export interface SnackbarProps {
  id: string
  type: SnackbarType
  message: string
  actions?: SnackbarAction[]
  duration?: number  // ms, 0 = no auto-dismiss
  onDismiss: (id: string) => void
  isProgress?: boolean  // Shows spinner instead of icon
}

const ICONS: Record<SnackbarType, string> = {
  success: '✅',
  info: '🖼️',
  warning: '⚠️',
  error: '❌',
  progress: '⏳',
}

// Color schemes for each snackbar type
const COLOR_SCHEMES: Record<SnackbarType, { bg: string; border: string }> = {
  success: { bg: 'rgba(20, 83, 45, 0.95)', border: 'rgba(34, 197, 94, 0.3)' },
  info: { bg: 'rgba(30, 58, 138, 0.95)', border: 'rgba(59, 130, 246, 0.3)' },
  warning: { bg: 'rgba(113, 63, 18, 0.95)', border: 'rgba(234, 179, 8, 0.3)' },
  error: { bg: 'rgba(127, 29, 29, 0.95)', border: 'rgba(239, 68, 68, 0.3)' },
  progress: { bg: 'rgba(39, 39, 42, 0.95)', border: 'rgba(113, 113, 122, 0.3)' },
}

export function Snackbar({
  id,
  type,
  message,
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
  }, [duration, isProgress])

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(() => {
      onDismiss(id)
    }, 200) // Match animation duration
  }

  const colors = COLOR_SCHEMES[type]

  const containerStyle: CSSProperties = {
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2)',
    padding: '12px 16px',
    minWidth: '300px',
    maxWidth: '400px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    transition: 'all 0.2s ease',
    opacity: isExiting ? 0 : 1,
    transform: isExiting ? 'translateX(16px)' : 'translateX(0)',
  }

  const iconStyle: CSSProperties = {
    fontSize: '18px',
    flexShrink: 0,
  }

  const spinnerStyle: CSSProperties = {
    ...iconStyle,
    animation: 'spin 1s linear infinite',
    display: 'inline-block',
  }

  const messageStyle: CSSProperties = {
    flex: 1,
    fontSize: '14px',
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: 500,
  }

  const actionsContainerStyle: CSSProperties = {
    display: 'flex',
    gap: '8px',
    flexShrink: 0,
  }

  const actionButtonStyle: CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.9)',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  }

  const dismissButtonStyle: CSSProperties = {
    color: 'rgba(255, 255, 255, 0.7)',
    background: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 500,
    padding: '4px 8px',
    marginLeft: '4px',
    transition: 'all 0.2s',
  }

  return (
    <>
      {/* Keyframe animation for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={containerStyle}>
        {/* Icon or Spinner */}
        <span style={isProgress ? spinnerStyle : iconStyle}>
          {isProgress ? '⏳' : ICONS[type]}
        </span>

        {/* Message */}
        <span style={messageStyle}>{message}</span>

        {/* Actions */}
        <div style={actionsContainerStyle}>
          {actions.map((action, index) => (
            <button
              key={index}
              onClick={action.onClick}
              style={actionButtonStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
              }}
            >
              {action.label}
            </button>
          ))}

          {/* Dismiss button - always visible */}
          <button
            onClick={handleDismiss}
            style={dismissButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </>
  )
}
