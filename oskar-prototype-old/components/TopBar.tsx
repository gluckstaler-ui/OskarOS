'use client'

import { LayoutMode } from '@/lib/types'
import { UsageBadge } from './UsageBadge'

// ============================================================================
// TOPBAR - MATCHING BENTO.HTML REFERENCE EXACTLY
// ============================================================================

type WebDevModel = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'

interface TopBarProps {
  sessionName: string | null
  sessionId: string | null
  layoutMode: LayoutMode
  onLayoutChange: (mode: LayoutMode) => void
  billingMode: 'cli' | 'api'
  onBillingChange: (mode: 'cli' | 'api') => void
  webDevModel: WebDevModel
  onModelChange: (model: WebDevModel) => void
  theme: 'onyx' | 'polar'
  onThemeChange: (theme: 'onyx' | 'polar') => void
  usageRefreshTrigger?: number
}

// Simple SVG icons
const BoxIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
    <path d="m3.3 7 8.7 5 8.7-5"/>
    <path d="M12 22V12"/>
  </svg>
)

const ColumnsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
    <line x1="12" x2="12" y1="3" y2="21"/>
  </svg>
)

const GridIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="7" x="3" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="14" rx="1"/>
    <rect width="7" height="7" x="3" y="14" rx="1"/>
  </svg>
)

const GalleryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
)

const MoonIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
  </svg>
)

const SunIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2"/>
    <path d="M12 20v2"/>
    <path d="m4.93 4.93 1.41 1.41"/>
    <path d="m17.66 17.66 1.41 1.41"/>
    <path d="M2 12h2"/>
    <path d="M20 12h2"/>
    <path d="m6.34 17.66-1.41 1.41"/>
    <path d="m19.07 4.93-1.41 1.41"/>
  </svg>
)

export function TopBar({
  sessionName,
  sessionId,
  layoutMode,
  onLayoutChange,
  billingMode,
  onBillingChange,
  webDevModel,
  onModelChange,
  theme,
  onThemeChange,
  usageRefreshTrigger
}: TopBarProps) {

  // Pill group wrapper style - light bg in polar, dark in onyx
  const pillGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px',
    backgroundColor: theme === 'polar' ? '#ffffff' : 'rgba(9, 9, 11, 0.5)',
    borderRadius: '8px',
    border: theme === 'polar' ? '1px solid #e5e7eb' : '1px solid rgba(39, 39, 42, 0.5)'
  }

  // Pill button base style - active = emerald green, inactive = readable text
  const getPillStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.05em',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: isActive ? '#10b981' : 'transparent',
    color: isActive ? '#ffffff' : 'var(--text-main)',
    boxShadow: isActive ? '0 1px 3px rgba(16, 185, 129, 0.3)' : 'none'
  })

  // Icon button style - active = emerald green, inactive = readable
  const getIconBtnStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '6px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isActive ? '#10b981' : 'transparent',
    color: isActive ? '#ffffff' : 'var(--text-main)',
    boxShadow: isActive ? '0 1px 3px rgba(16, 185, 129, 0.3)' : 'none'
  })

  return (
    <header style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      backgroundColor: 'var(--bg-card)',
      userSelect: 'none',
      transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
    }}>
      {/* LEFT: Logo + Session */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <div style={{
            width: '32px',
            height: '32px',
            backgroundColor: 'var(--text-main)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--bg-card)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
          }}>
            <BoxIcon />
          </div>
          <span style={{
            fontFamily: 'Inter Tight, var(--font-display), sans-serif',
            fontWeight: 700,
            fontSize: '18px',
            letterSpacing: '-0.02em',
            color: 'var(--text-main)'
          }}>
            OSKAR<span style={{ opacity: 0.5, fontWeight: 400 }}>.OS</span>
          </span>
        </div>

        {/* Divider */}
        <div style={{ height: '24px', width: '1px', backgroundColor: 'var(--border-card)' }} />

        {/* Session Info - Two lines */}
        {sessionName && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{
              fontSize: '9px',
              color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              lineHeight: 1,
              marginBottom: '4px'
            }}>Project</span>
            <span style={{
              fontSize: '12px',
              color: 'var(--text-main)',
              fontWeight: 700,
              letterSpacing: '0.02em',
              lineHeight: 1
            }}>{sessionName}</span>
          </div>
        )}
      </div>

      {/* RIGHT: Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Layout Controls */}
        <div style={pillGroupStyle}>
          <button
            onClick={() => onLayoutChange('2-panel')}
            style={getPillStyle(layoutMode === '2-panel')}
            title="Brief Mode (2-panel)"
          >
            <ColumnsIcon />
            BRIEF
          </button>
          <button
            onClick={() => onLayoutChange('3-panel')}
            style={getPillStyle(layoutMode === '3-panel')}
            title="Studio Mode (3-panel)"
          >
            <GridIcon />
            STUDIO
          </button>
          <button
            onClick={() => onLayoutChange('gallery')}
            style={getPillStyle(layoutMode === 'gallery')}
            title="Gallery Mode (vibes grid)"
          >
            <GalleryIcon />
            GALLERY
          </button>
        </div>

        {/* Usage Badge - Shows session cost */}
        <UsageBadge sessionId={sessionId} refreshTrigger={usageRefreshTrigger} theme={theme} />

        {/* Theme Switcher */}
        <div style={pillGroupStyle}>
          <button
            onClick={() => onThemeChange('onyx')}
            style={getPillStyle(theme === 'onyx')}
          >
            <MoonIcon />
            ONYX
          </button>
          <button
            onClick={() => onThemeChange('polar')}
            style={getPillStyle(theme === 'polar')}
          >
            <SunIcon />
            POLAR
          </button>
        </div>

        {/* Billing Mode */}
        <div style={pillGroupStyle}>
          <button
            onClick={() => onBillingChange('cli')}
            style={getPillStyle(billingMode === 'cli')}
          >
            CLI
          </button>
          <button
            onClick={() => onBillingChange('api')}
            style={getPillStyle(billingMode === 'api')}
          >
            API
          </button>
        </div>

        {/* Model Switch — always shows all 3, Gemini disabled in CLI mode */}
        <div style={pillGroupStyle}>
          <button
            onClick={() => onModelChange('claude-opus-4-6')}
            style={getPillStyle(webDevModel === 'claude-opus-4-6')}
          >
            OPUS
          </button>
          <button
            onClick={() => onModelChange('claude-sonnet-4-6')}
            style={getPillStyle(webDevModel === 'claude-sonnet-4-6')}
          >
            SONNET
          </button>
          <button
            onClick={() => onModelChange('gemini-3.1-pro-preview')}
            style={getPillStyle(webDevModel === 'gemini-3.1-pro-preview')}
          >
            GEMINI
          </button>
        </div>

        {/* Admin Link */}
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
            transition: 'color 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-main)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
          </svg>
          ADMIN
        </a>

        {/* User Avatar with gradient border */}
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: 'linear-gradient(to top right, var(--accent, #3b82f6), #a855f7)',
          padding: '2px',
          cursor: 'pointer',
          transition: 'transform 0.2s'
        }}>
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--text-main)'
          }}>
            OS
          </div>
        </div>
      </div>
    </header>
  )
}
