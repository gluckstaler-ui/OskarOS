'use client'

import { LayoutMode } from '@/lib/types'
import { UsageBadge } from './UsageBadge'
import { Feather } from './Feather'
import { useState, useEffect, useRef } from 'react'

// ============================================================================
// TOPBAR — 2026-05-03 redesign
// - Hand-rolled inline SVG icons replaced by <Feather name="..."> component
//   (zero new dependency; canonical Feather paths in components/Feather.tsx)
// - All color references move to brand tokens. No raw hex literals for
//   --brand-* / --warning / --error.
// - ORDER 65 (label "ORDER 75", soft) and ORDER 66 (hard) now use the
//   .os-order-pill class with .warn / .danger / .complete state — defined
//   in app/globals.css. Sibling administrative pills, distinct intensities.
// - Avatar gradient stripped of the off-palette purple (#a855f7); now
//   uses brand-green-bright → brand-teal-bright.
// ============================================================================

type WebDevModel = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'

export type Order66Status = 'idle' | 'running' | 'complete'

interface TopBarProps {
  sessionName: string | null
  sessionId: string | null
  layoutMode: LayoutMode
  onLayoutChange: (mode: LayoutMode) => void
  billingMode: 'smpl' | 'cli' | 'api'
  onBillingChange: (mode: 'smpl' | 'cli' | 'api') => void
  webDevModel: WebDevModel
  onModelChange: (model: WebDevModel) => void
  theme: 'onyx' | 'polar'
  onThemeChange: (theme: 'onyx' | 'polar') => void
  usageRefreshTrigger?: number
  contextPct?: number
  cachedInputTokens?: number
  realInputTokens?: number
  onOrder65?: () => void
  order65Status?: Order66Status
  onOrder66?: () => void
  order66Status?: Order66Status
  /** Persist a new project/business name. Called on blur or Enter when the
   *  editable title is committed. The handler is responsible for actually
   *  renaming the session on disk + updating sessionId. */
  onSessionRename?: (newName: string) => void | Promise<void>
}

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
  usageRefreshTrigger,
  contextPct,
  cachedInputTokens,
  realInputTokens,
  onOrder65,
  order65Status = 'idle',
  onOrder66,
  order66Status = 'idle',
  onSessionRename,
}: TopBarProps) {
  // Editable project title — click the value to edit, Enter / blur commits,
  // Esc cancels. Local draft state isolated from the prop so partial edits
  // don't propagate back into the session model until commit.
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(sessionName ?? '')
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    // Keep draft in sync with the prop while NOT editing — once the user
    // starts editing, the draft is theirs until they commit/cancel.
    if (!isEditingName) setNameDraft(sessionName ?? '')
  }, [sessionName, isEditingName])
  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [isEditingName])
  const commitName = () => {
    const next = nameDraft.trim()
    setIsEditingName(false)
    if (!next || next === (sessionName ?? '')) {
      setNameDraft(sessionName ?? '')
      return
    }
    onSessionRename?.(next)
  }
  const cancelName = () => {
    setNameDraft(sessionName ?? '')
    setIsEditingName(false)
  }

  // Pill group wrapper style — light bg in polar, dark in onyx.
  const pillGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px',
    backgroundColor: theme === 'polar' ? 'var(--bg-card)' : 'rgba(9, 9, 11, 0.5)',
    borderRadius: '8px',
    border: theme === 'polar' ? '1px solid var(--border-card)' : '1px solid rgba(39, 39, 42, 0.5)'
  }

  // Pill button base style — active = brand-green-bright, inactive = readable text.
  // NOTE: `transition` is scoped to box-shadow only — the active/inactive
  // background swap must be INSTANT. A `transition: all` here makes state
  // toggles (billing, model, theme) feel laggy because the color animates
  // over 200ms after the click.
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
    boxShadow: isActive ? '0 1px 3px color-mix(in srgb, var(--brand-green-bright) 30%, transparent)' : 'none'
  })

  // ORDER pill class derivation — lives in globals.css under `.os-order-pill`
  const orderClass = (severity: 'warn' | 'danger', status: Order66Status) =>
    `os-order-pill ${status === 'complete' ? 'complete' : severity}`

  return (
    <header style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      backgroundColor: 'var(--bg-card)',
      userSelect: 'none',
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
            <Feather name="box" size={16} />
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

        {/* Session Info — Two lines. The PROJECT label stays static; the
            value is click-to-edit. Enter or blur commits via onSessionRename;
            Escape cancels. */}
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
            {isEditingName ? (
              <input
                ref={nameInputRef}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitName()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelName()
                  }
                }}
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  lineHeight: 1,
                  color: 'var(--text-main)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--brand-green-bright)',
                  outline: 'none',
                  padding: '1px 0',
                  fontFamily: 'inherit',
                  width: `${Math.max(nameDraft.length, 4)}ch`,
                  minWidth: '6ch',
                }}
              />
            ) : (
              <span
                role="button"
                tabIndex={0}
                onClick={() => setIsEditingName(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setIsEditingName(true)
                  }
                }}
                title="Click to rename project"
                style={{
                  fontSize: '16px',
                  color: 'var(--text-main)',
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  lineHeight: 1,
                  cursor: 'text',
                  borderBottom: '1px dashed transparent',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderBottomColor = 'var(--border-card)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderBottomColor = 'transparent'
                }}
              >{sessionName}</span>
            )}
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
            <Feather name="columns" size={14} />
            BRIEF
          </button>
          <button
            onClick={() => onLayoutChange('3-panel')}
            style={getPillStyle(layoutMode === '3-panel')}
            title="Studio Mode (3-panel)"
          >
            <Feather name="grid" size={14} />
            STUDIO
          </button>
          <button
            onClick={() => onLayoutChange('image')}
            style={getPillStyle(layoutMode === 'image')}
            title="Image Mode (Advanced image editor)"
          >
            <Feather name="image" size={14} />
            IMAGE
          </button>
          <button
            onClick={() => onLayoutChange('gallery')}
            style={getPillStyle(layoutMode === 'gallery')}
            title="Gallery Mode (vibes grid)"
          >
            <Feather name="layers" size={14} />
            GALLERY
          </button>
        </div>

        {/* Usage Badge — Shows session cost. Bug N (Ralph 2026-05-04):
            billingMode prop makes the badge display mode-specific cost
            (CLI shows what Claude Code reported; API shows calculateCost
            cumulative). Toggling billing mode flips the displayed value
            AND the visible CLI/API label. */}
        <UsageBadge
          sessionId={sessionId}
          refreshTrigger={usageRefreshTrigger}
          theme={theme}
          contextPct={contextPct}
          cachedInputTokens={cachedInputTokens}
          realInputTokens={realInputTokens}
          billingMode={billingMode}
        />

        {/* Theme Switcher */}
        <div style={pillGroupStyle}>
          <button onClick={() => onThemeChange('onyx')} style={getPillStyle(theme === 'onyx')}>
            <Feather name="moon" size={10} />
            ONYX
          </button>
          <button onClick={() => onThemeChange('polar')} style={getPillStyle(theme === 'polar')}>
            <Feather name="sun" size={10} />
            POLAR
          </button>
        </div>

        {/* Billing Mode — 3-way: SMPL (tier alias → best model), CLI (Claude ID), API (Anthropic direct) */}
        <div style={pillGroupStyle}>
          <button onClick={() => onBillingChange('smpl')} style={getPillStyle(billingMode === 'smpl')}>
            SMPL
          </button>
          <button onClick={() => onBillingChange('cli')} style={getPillStyle(billingMode === 'cli')}>
            CLI
          </button>
          <button onClick={() => onBillingChange('api')} style={getPillStyle(billingMode === 'api')}>
            API
          </button>
        </div>

        {/* Model Switch — always shows all 3, Gemini disabled in CLI mode */}
        <div style={pillGroupStyle}>
          <button onClick={() => onModelChange('claude-opus-4-7')} style={getPillStyle(webDevModel === 'claude-opus-4-7')}>
            OPUS
          </button>
          <button onClick={() => onModelChange('claude-sonnet-4-6')} style={getPillStyle(webDevModel === 'claude-sonnet-4-6')}>
            SONNET
          </button>
          <button onClick={() => onModelChange('gemini-3.1-pro-preview')} style={getPillStyle(webDevModel === 'gemini-3.1-pro-preview')}>
            GEMINI
          </button>
        </div>

        {/* ORDER 75 — soft compaction (no bridge kill) — warning amber */}
        <button
          type="button"
          onClick={onOrder65}
          disabled={order65Status !== 'idle'}
          className={orderClass('warn', order65Status)}
          title="Soft compaction — keeps the bridge alive"
        >
          <Feather name="refresh-cw" size={12} strokeWidth={2.5} />
          {order65Status === 'idle' ? 'ORDER 75' :
           order65Status === 'complete' ? 'REJUVENATED' :
           'REJUVENATING…'}
        </button>

        {/* ORDER 66 — hard compaction (kills bridge) — error red. Icon is
            `zap` (Sith lightning) per Ralph 2026-05-03 — alert-triangle
            looked like a road-sign warning, not a kill order. */}
        <button
          type="button"
          onClick={onOrder66}
          disabled={order66Status !== 'idle'}
          className={orderClass('danger', order66Status)}
          title="Hard compaction — kills the bridge and wipes screenshots"
        >
          <Feather name="zap" size={12} strokeWidth={2.5} />
          {order66Status === 'idle' ? 'ORDER 66' :
           order66Status === 'complete' ? 'RESPAWNED' :
           'EXECUTING…'}
        </button>

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
          onMouseOver={(e) => (e.currentTarget.style.color = 'var(--text-main)')}
          onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <Feather name="shield" size={12} />
          ADMIN
        </a>

        {/* User Avatar — gradient from brand-green-bright to brand-teal-bright.
            (Old gradient ended in #a855f7 purple, off-palette.) */}
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: 'linear-gradient(to top right, var(--brand-green-bright), var(--brand-teal-bright))',
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
