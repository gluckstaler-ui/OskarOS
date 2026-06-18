'use client'

// ============================================================================
// AdminRightActions — admin.html's `right` slot fill for <TopBar>.
//
// "New Session" — admin-specific action. Clicking calls
// `window.createNewSession()` which is already defined inline in admin.html
// (kicks off the session-creation modal/flow). The island doesn't reimplement
// the creation logic; it fires the existing call.
//
// No back-link to Studio: navigation is one-way (Studio → admin), so admin
// doesn't link back. The old "Open App ↗" was deleted on this same pass.
// ============================================================================

declare global {
  interface Window {
    createNewSession?: () => void
  }
}

export function AdminRightActions() {
  return (
    <button
      type="button"
      onClick={() => window.createNewSession?.()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderRadius: 8,
        border: 'none',
        cursor: 'pointer',
        color: '#fff',
        fontWeight: 700,
        fontSize: 12,
        background: 'linear-gradient(135deg, #15B981, #0F766E)',
        transition: 'opacity 0.15s',
      }}
      onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
      onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
    >
      + New Session
    </button>
  )
}
