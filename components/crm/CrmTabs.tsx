'use client'

// ============================================================================
// CrmTabs — CRM's view-tab strip. Used as the `tabs` slot in <TopBar>.
//
// Sessions / Kanban / Scout render in-page (handled by the parent's setView);
// Overview / Analytics / Settings live on admin.html and the parent navigates
// across pages. The parent owns the active-key + click handler; this component
// is pure presentation.
// ============================================================================

export type CrmNavKey = 'sessions' | 'kanban' | 'scout' | 'overview' | 'analytics' | 'settings'

interface Props {
  active: CrmNavKey | 'overview'  // 'overview' is the default in-page view
  onSelect: (key: CrmNavKey) => void
}

const TABS: { key: CrmNavKey; label: string }[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'scout', label: 'Scout' },
  { key: 'overview', label: 'Overview' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'settings', label: 'Settings' },
]

export function CrmTabs({ active, onSelect }: Props) {
  return (
    <nav
      style={{
        display: 'flex',
        gap: 4,
        background: 'var(--bg-app)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        padding: 3,
      }}
    >
      {TABS.map((t) => {
        const isActive = active === t.key
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: isActive ? 'var(--bg-card)' : 'transparent',
              color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.2)' : 'none',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
