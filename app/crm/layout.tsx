// ============================================================================
// /crm layout — loads crm.html's REAL stylesheet and scopes it (Ralph 2026-05-29).
//
// The "awful" /crm came from hand-porting a sliver of crm.html's 4,742-line
// <style> into CSS modules — every off-by-a-bit value read as "almost but
// wrong". The fix (Ralph's call): reuse crm.html's actual CSS. `crm.css` is
// that <style> block, extracted verbatim; its 3 theme-token blocks are the
// only globals, and they're scoped to `.crm-app` so they can't override the
// studio's globals.css. Everything else is `.crm-*`/`.fp-*` — inert outside /crm.
//
// The React components under /crm re-emit crm.html's EXACT class-based markup,
// so they're styled by THIS stylesheet — pixel-identical by construction, no
// drift. The .crm-app wrapper mirrors crm.html's <body> shell (full-screen
// flex column) and is the element the scoped theme vars resolve on.
// ============================================================================

import './crm.css'
import './scout.css'
import type { ReactNode } from 'react'

export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="crm-app"
      style={{
        height: '100vh',
        width: '100%',
        padding: 'var(--padding-app, 20px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--gap-app, 20px)',
        background: 'var(--bg-app)',
        color: 'var(--text-main)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}
