'use client'

/**
 * DeliverablePicker — WP-B3
 *
 * 7-tile grid of brand deliverables. Pure presentation — parent owns the
 * "currently selected" state and the click handler. Each tile shows the
 * emoji + label + aspect ratio badge + one-line description.
 */

import { BRAND_DELIVERABLES, type DeliverableId } from '@/lib/brand-deliverables'

interface DeliverablePickerProps {
  selectedId: DeliverableId | null
  onSelect: (id: DeliverableId) => void
  disabled?: boolean
}

export function DeliverablePicker({
  selectedId,
  onSelect,
  disabled = false,
}: DeliverablePickerProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 10,
      }}
    >
      {BRAND_DELIVERABLES.map((d) => {
        const isSelected = d.id === selectedId
        return (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            disabled={disabled}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 6,
              padding: 12,
              borderRadius: 10,
              border: isSelected
                ? '2px solid var(--border-active)'
                : '1px solid var(--border-card)',
              background: isSelected ? 'var(--hover-overlay)' : 'var(--bg-card)',
              color: 'var(--text-main)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              textAlign: 'left',
              fontFamily: 'inherit',
              transition: 'all 0.12s',
              boxShadow: isSelected ? '0 0 12px rgba(59, 130, 246, 0.2)' : 'none',
            }}
            onMouseEnter={(e) => {
              if (!disabled && !isSelected) {
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border-active)'
              }
            }}
            onMouseLeave={(e) => {
              if (!disabled && !isSelected) {
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border-card)'
              }
            }}
            title={d.description}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>{d.thumbnailEmoji}</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: 'var(--text-dim)',
                  marginLeft: 'auto',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'var(--hover-overlay)',
                  fontFamily: 'monospace',
                }}
              >
                {d.aspectRatio}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{d.label}</div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                lineHeight: 1.4,
              }}
            >
              {d.description}
            </div>
          </button>
        )
      })}
    </div>
  )
}
