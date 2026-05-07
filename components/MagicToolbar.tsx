'use client'

import { useState } from 'react'
import { SelectedElement, TextQuickAction, ImageQuickAction } from '@/lib/types'

interface MagicToolbarProps {
  selectedElement: SelectedElement
  onQuickEdit: (action: TextQuickAction | ImageQuickAction) => void
  onCustomEdit: (instruction: string) => void
  onClose: () => void
  isProcessing?: boolean
}

export function MagicToolbar({
  selectedElement,
  onQuickEdit,
  onCustomEdit,
  onClose,
  isProcessing = false
}: MagicToolbarProps) {
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')

  const isText = selectedElement.elementType === 'text'
  const isImage = selectedElement.elementType === 'image'

  // Calculate position based on element rect
  const rect = selectedElement.rect
  const toolbarStyle: React.CSSProperties = rect ? {
    position: 'fixed',
    top: `${Math.max(60, rect.top - 60)}px`,
    left: `${Math.min(window.innerWidth - 320, Math.max(10, rect.left + rect.width / 2 - 150))}px`,
    zIndex: 10000
  } : {
    position: 'fixed',
    top: '100px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10000
  }

  const handleCustomSubmit = () => {
    if (customInstruction.trim()) {
      onCustomEdit(customInstruction)
      setCustomInstruction('')
      setShowCustomInput(false)
    }
  }

  const textActions: { action: TextQuickAction; label: string; icon: string }[] = [
    { action: 'punchier', label: 'Punchier', icon: '💥' },
    { action: 'shorter', label: 'Shorter', icon: '✂️' },
    { action: 'longer', label: 'Longer', icon: '📝' },
    { action: 'sarcastic', label: 'Sarcastic', icon: '😏' },
    { action: 'formal', label: 'Formal', icon: '🎩' },
    { action: 'casual', label: 'Casual', icon: '👋' }
  ]

  const imageActions: { action: ImageQuickAction; label: string; icon: string }[] = [
    { action: 'variations', label: 'Variations', icon: '🎨' },
    { action: 'zoom_out', label: 'Zoom Out', icon: '🔍' },
    { action: 'zoom_in', label: 'Zoom In', icon: '🔎' },
    { action: 'change_style', label: 'Style', icon: '✨' }
  ]

  const styles = {
    toolbar: {
      background: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '12px',
      padding: '0.5rem',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      minWidth: '300px',
      maxWidth: '400px'
    } as React.CSSProperties,
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0.25rem 0.5rem 0.5rem',
      borderBottom: '1px solid #333',
      marginBottom: '0.5rem'
    } as React.CSSProperties,
    elementType: {
      fontSize: '0.75rem',
      color: '#888'
    } as React.CSSProperties,
    closeBtn: {
      background: 'transparent',
      border: 'none',
      color: '#666',
      fontSize: '1.2rem',
      cursor: 'pointer',
      padding: 0,
      lineHeight: 1
    } as React.CSSProperties,
    quickActions: {
      display: 'flex',
      flexWrap: 'wrap' as const,
      gap: '0.35rem',
      marginBottom: '0.5rem'
    } as React.CSSProperties,
    actionBtn: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '0.4rem 0.6rem',
      background: '#252525',
      border: '1px solid #333',
      borderRadius: '8px',
      color: '#fff',
      fontSize: '0.75rem',
      cursor: 'pointer',
      transition: 'all 0.15s ease'
    } as React.CSSProperties,
    actionLabel: {
      color: '#ccc'
    } as React.CSSProperties,
    customBtn: {
      width: '100%',
      padding: '0.5rem',
      background: 'transparent',
      border: '1px dashed #444',
      borderRadius: '8px',
      color: '#888',
      fontSize: '0.75rem',
      cursor: 'pointer'
    } as React.CSSProperties,
    customInput: {
      display: 'flex',
      gap: '0.35rem'
    } as React.CSSProperties,
    input: {
      flex: 1,
      padding: '0.5rem',
      background: '#252525',
      border: '1px solid #444',
      borderRadius: '6px',
      color: '#fff',
      fontSize: '0.8rem',
      outline: 'none'
    } as React.CSSProperties,
    goBtn: {
      padding: '0.5rem 0.75rem',
      background: '#f97316',
      border: 'none',
      borderRadius: '6px',
      color: '#fff',
      fontSize: '0.8rem',
      cursor: 'pointer'
    } as React.CSSProperties,
    cancelBtn: {
      padding: '0.5rem 0.75rem',
      background: '#333',
      border: 'none',
      borderRadius: '6px',
      color: '#fff',
      fontSize: '0.8rem',
      cursor: 'pointer'
    } as React.CSSProperties,
    processing: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.5rem',
      padding: '0.75rem',
      color: '#888',
      fontSize: '0.8rem'
    } as React.CSSProperties
  }

  return (
    <div style={{ ...toolbarStyle, ...styles.toolbar }}>
      <div style={styles.header}>
        <span style={styles.elementType}>
          {isText ? '✏️' : '🖼️'} {selectedElement.tagName.toLowerCase()}
        </span>
        <button style={styles.closeBtn} onClick={onClose}>×</button>
      </div>

      {isProcessing ? (
        <div style={styles.processing}>
          <span style={{
            width: '16px',
            height: '16px',
            border: '2px solid #333',
            borderTopColor: '#f97316',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
          }}></span>
          <span>Processing...</span>
        </div>
      ) : showCustomInput ? (
        <div style={styles.customInput}>
          <input
            type="text"
            value={customInstruction}
            onChange={e => setCustomInstruction(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
            placeholder={isText ? "Make it more..." : "Change to..."}
            style={styles.input}
            autoFocus
          />
          <button onClick={handleCustomSubmit} style={styles.goBtn}>Go</button>
          <button onClick={() => setShowCustomInput(false)} style={styles.cancelBtn}>×</button>
        </div>
      ) : (
        <>
          <div style={styles.quickActions}>
            {isText && textActions.map(({ action, label, icon }) => (
              <button
                key={action}
                style={styles.actionBtn}
                onClick={() => {
                  console.log('🎬 Clicked action:', action)
                  onQuickEdit(action)
                }}
                title={label}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#333'
                  e.currentTarget.style.borderColor = '#f97316'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#252525'
                  e.currentTarget.style.borderColor = '#333'
                }}
              >
                <span style={{ fontSize: '0.85rem' }}>{icon}</span>
                <span style={styles.actionLabel}>{label}</span>
              </button>
            ))}
            {isImage && imageActions.map(({ action, label, icon }) => (
              <button
                key={action}
                style={styles.actionBtn}
                onClick={() => {
                  console.log('🎬 Clicked action:', action)
                  onQuickEdit(action)
                }}
                title={label}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#333'
                  e.currentTarget.style.borderColor = '#f97316'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#252525'
                  e.currentTarget.style.borderColor = '#333'
                }}
              >
                <span style={{ fontSize: '0.85rem' }}>{icon}</span>
                <span style={styles.actionLabel}>{label}</span>
              </button>
            ))}
          </div>

          <button
            style={styles.customBtn}
            onClick={() => setShowCustomInput(true)}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#f97316'
              e.currentTarget.style.color = '#f97316'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#444'
              e.currentTarget.style.color = '#888'
            }}
          >
            ✨ Custom instruction...
          </button>
        </>
      )}
    </div>
  )
}
