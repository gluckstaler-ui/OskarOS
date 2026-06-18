'use client'

// ============================================================================
// Logo — the shared OSKAR wordmark used by every surface's left slot.
//
// The icon + "OSKAR" bold + "." + light suffix is the SAME visual treatment
// in all three surfaces. Only the suffix differs:
//   Studio → OSKAR.FIRN     (StudioLogo)
//   CRM    → OSKAR.LOTSE    (CrmLogo)
//   Admin  → OSKAR.ADMIN    (AdminLogo)
// One component, three consumers. Per Ralph 2026-06-09.
// ============================================================================

import { Feather } from './Feather'

interface Props {
  /** The brand suffix that distinguishes this surface — e.g. "FIRN" / "LOTSE" / "ADMIN". Rendered in lighter weight after a dot. */
  suffix: string
}

export function Logo({ suffix }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
      <div
        style={{
          width: '32px',
          height: '32px',
          backgroundColor: 'var(--text-main)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--bg-card)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
        }}
      >
        <Feather name="box" size={16} />
      </div>
      <span
        style={{
          fontFamily: 'Inter Tight, var(--font-display), sans-serif',
          fontWeight: 700,
          fontSize: '18px',
          letterSpacing: '-0.02em',
          color: 'var(--text-main)',
        }}
      >
        OSKAR<span style={{ opacity: 0.5, fontWeight: 400 }}>.{suffix}</span>
      </span>
    </div>
  )
}
