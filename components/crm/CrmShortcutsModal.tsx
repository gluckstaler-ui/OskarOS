'use client'

// ============================================================================
// CrmShortcutsModal — the "?" keyboard-shortcuts cheat sheet. Port of crm.html
// #crm-shortcuts-overlay (crmShortcutsOpen/Close). Static content; Esc or
// backdrop-click closes. Styled inline (the original used Tailwind + kbd).
// ============================================================================

import { Fragment, useEffect } from 'react'
import { X } from 'lucide-react'

const SHORTCUTS: [string, string][] = [
  ['/', 'Focus search'],
  ['n', "Focus Incoming column's quick-add"],
  ['↑ ↓ ← →', 'Navigate between cards'],
  ['↵', 'Open focused card'],
  ['⌘ K', 'Quick switcher'],
  ['Esc', 'Close overlay / cancel edit'],
  ['f', 'Focus mode — collapse open card to feed'],
  ['?', 'This help'],
]

export function CrmShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 16 }}
    >
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 12, padding: 24, maxWidth: 420, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X width={16} height={16} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 8, fontSize: 12, alignItems: 'center' }}>
          {SHORTCUTS.map(([k, desc]) => (
            <Fragment key={k}>
              <kbd style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-main)', padding: '2px 8px', borderRadius: 4, background: 'var(--bg-app)', border: '1px solid var(--border-card)', textAlign: 'center', whiteSpace: 'nowrap' }}>{k}</kbd>
              <span style={{ color: 'var(--text-muted)' }}>{desc}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
