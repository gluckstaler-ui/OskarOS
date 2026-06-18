'use client'

import { Feather } from '../Feather'

// ============================================================================
// StudioRightActions — Studio's `right` slot fill for <TopBar>.
//
// Per Ralph's spec 2026-06-09: right slot = "goto Admin/CRM in Studio, Undo
// in CRM." Single placeholder, surface-specific content. NOTHING ELSE.
//
// Navigation is one-way: Studio (parent) provides entry points TO its child
// surfaces (CRM, etc.). The child surfaces never link back. So this is the
// Admin/CRM entry — Studio→CRM only.
//
// Ralph 2026-06-09 — original carry-over included the user avatar from the
// old TopBar. Deleted: avatars aren't navigation and weren't requested.
// ============================================================================

export function StudioRightActions() {
  return (
    <a
      href="/admin.html"
      style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        color: 'var(--text-muted)',
        textDecoration: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        transition: 'color 0.2s',
      }}
      onMouseOver={(e) => (e.currentTarget.style.color = 'var(--text-main)')}
      onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
    >
      <Feather name="shield" size={12} />
      ADMIN
    </a>
  )
}
