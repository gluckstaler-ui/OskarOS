'use client'

// ============================================================================
// CrmRightActions — CRM's `right` slot fill for <TopBar>.
//
// Per Ralph's spec 2026-06-09: the right slot is "goto Admin/CRM in Studio,
// Undo in CRM" — single placeholder, surface-specific content. NOTHING ELSE.
// Ralph 2026-06-09 — "Open App ↗" cross-link to Studio was carried over from
// the old hand-rolled CRM by mistake. Deleted. The right slot is Undo, full
// stop.
// ============================================================================

interface Props {
  /** The most recent undoable mutation, or null when nothing to undo. */
  undo: { label: string } | null
  /** Caller's "actually undo" handler — bound to the parent's undo stack. */
  onUndo: () => void
}

export function CrmRightActions({ undo, onUndo }: Props) {
  return (
    <button
      type="button"
      onClick={onUndo}
      disabled={!undo}
      title={undo ? `Undo: ${undo.label}` : 'Nothing to undo'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--border-card)',
        background: 'transparent',
        color: undo ? 'var(--text-main)' : 'var(--text-muted)',
        fontSize: 12,
        fontWeight: 700,
        cursor: undo ? 'pointer' : 'default',
        opacity: undo ? 1 : 0.45,
      }}
    >
      ↶ Undo
    </button>
  )
}
