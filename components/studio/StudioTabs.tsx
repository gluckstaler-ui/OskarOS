'use client'

import { Feather } from '../Feather'
import type { LayoutMode } from '@/lib/types'

// ============================================================================
// StudioTabs — Studio's view-mode pill bar. Used as the `tabs` slot in
// <TopBar>. Pure presentational: takes the current layoutMode + onChange.
//
// Used to live INSIDE TopBar; lifted out 2026-06-09 because the four view
// modes (BRIEF / STUDIO / IMAGE / GALLERY) are a Studio-body concept, not
// shared session chrome. CRM has its own view-tab strip (CrmTabs) with
// completely different routes.
// ============================================================================

interface Props {
  layoutMode: LayoutMode
  onLayoutChange: (mode: LayoutMode) => void
  theme: 'onyx' | 'polar'
}

export function StudioTabs({ layoutMode, onLayoutChange, theme }: Props) {
  const pillGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px',
    backgroundColor: theme === 'polar' ? 'var(--bg-card)' : 'rgba(9, 9, 11, 0.5)',
    borderRadius: '8px',
    border: theme === 'polar' ? '1px solid var(--border-card)' : '1px solid rgba(39, 39, 42, 0.5)',
  }
  const getPillStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.05em',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    transition: 'box-shadow 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: isActive ? 'var(--brand-green-bright)' : 'transparent',
    color: isActive ? 'var(--text-on-brand)' : 'var(--text-main)',
    boxShadow: isActive ? '0 1px 3px color-mix(in srgb, var(--brand-green-bright) 30%, transparent)' : 'none',
  })

  return (
    <div style={pillGroupStyle}>
      <button onClick={() => onLayoutChange('2-panel')} style={getPillStyle(layoutMode === '2-panel')} title="Brief Mode (2-panel)">
        <Feather name="columns" size={14} />
        BRIEF
      </button>
      <button onClick={() => onLayoutChange('3-panel')} style={getPillStyle(layoutMode === '3-panel')} title="Studio Mode (3-panel)">
        <Feather name="grid" size={14} />
        STUDIO
      </button>
      <button onClick={() => onLayoutChange('image')} style={getPillStyle(layoutMode === 'image')} title="Image Mode (Advanced image editor)">
        <Feather name="image" size={14} />
        IMAGE
      </button>
      <button onClick={() => onLayoutChange('gallery')} style={getPillStyle(layoutMode === 'gallery')} title="Gallery Mode (vibes grid)">
        <Feather name="layers" size={14} />
        GALLERY
      </button>
    </div>
  )
}
