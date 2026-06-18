'use client'

// ============================================================================
// AdminTabs — admin.html's `tabs` slot fill for <TopBar>.
//
// Sessions / Kanban / Overview / Analytics / Settings. Click handler calls
// `window.switchView(key)` — the function already defined inline in admin.html
// for the legacy nav. The island doesn't reimplement view routing; it just
// fires the same call admin.html's hand-rolled buttons did.
// ============================================================================

export type AdminNavKey = 'sessions' | 'kanban' | 'overview' | 'analytics' | 'settings'

interface Props {
  active: AdminNavKey
  onSelect: (key: AdminNavKey) => void
}

const TABS: { key: AdminNavKey; label: string }[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'overview', label: 'Overview' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'settings', label: 'Settings' },
]

export function AdminTabs({ active, onSelect }: Props) {
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
