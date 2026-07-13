'use client'

import { UsageBadge } from './UsageBadge'
import { Feather } from './Feather'
import type { ReactNode } from 'react'
import { type ModelSwitch } from '@/lib/models'

// ============================================================================
// TOPBAR — 4-slot shared top bar (Ralph 2026-06-09 refactor)
// ----------------------------------------------------------------------------
// One component, used by Studio AND CRM. The chrome (gauge / billing / model /
// theme / Order 66) is OWNED INTERNALLY because it's identical in both surfaces.
// Everything else flows through 3 slot props:
//
//   left   — app identity (logo + project name). Different files per surface
//            because Studio shows "OSKAR.OS / PROJECT / <name>" with click-to-
//            rename while CRM shows "OskarOS / Admin Dashboard" static.
//   tabs   — view tab bar. Studio: BRIEF/STUDIO/IMAGE/GALLERY layout pills.
//            CRM: Sessions/Kanban/Scout/Overview/Analytics/Settings.
//   right  — surface-specific trailing actions. Studio: Admin link + avatar.
//            CRM: Undo button + Open App link.
//
// Owned-internal chrome — NEVER duplicated across surfaces:
//   - UsageBadge (the $cost · ↻ · ●ctx% · tokens gauge)
//   - Billing mode pills (CLI / API)
//   - Model selector — ONE switch (FABLE / OPUS / GEMINI), exactly one lit.
//     FABLE/OPUS switch the big-agent brain; GEMINI selects the WebDev model.
//   - Theme pills (ONYX / POLAR)
//   - Order 66 button (hard compaction)
//
// Order 65 (formerly labeled "ORDER 75") was deleted from this UI per Ralph
// 2026-06-09 — button gone, but `lib/` route + helpers are preserved in case
// it's revived later. The Order 65 props are no longer accepted; Studio's
// call site has stopped passing them.
//
// SMPL mode (the Z.AI compat-layer workaround) was deleted from this UI per
// Ralph 2026-06-09 — pill gone, billingMode narrowed to 'cli' | 'api'. The
// backend routes still accept 'smpl' for legacy compatibility but no surface
// emits it anymore.
// ============================================================================

export type Order66Status = 'idle' | 'running' | 'complete'

interface TopBarProps {
  /** Filled per surface — Studio's logo + project rename vs CRM's identity. */
  left: ReactNode
  /** Filled per surface — Studio's layout pills vs CRM's view tabs. */
  tabs: ReactNode
  /** Filled per surface — Studio's Admin+avatar vs CRM's Undo+Open App. */
  right: ReactNode
  /** Session whose USAGE.json the gauge reads. Studio passes its session id; CRM passes "__crm__". */
  sessionId: string | null
  billingMode: 'cli' | 'api'
  onBillingChange: (mode: 'cli' | 'api') => void
  /** The model selector — ONE switch, one position lit. 'fable'/'opus' switch the
   *  big-agent brain (CD/Consular); 'gemini' selects the WebDev build model. */
  modelSwitch: ModelSwitch
  onModelSwitch: (m: ModelSwitch) => void
  theme: 'onyx' | 'polar'
  onThemeChange: (theme: 'onyx' | 'polar') => void
  usageRefreshTrigger?: number
  contextPct?: number
  cachedInputTokens?: number
  realInputTokens?: number
  onOrder66?: () => void
  order66Status?: Order66Status
  /** Optional Consular session bloat percentage. When provided, the idle-state button label becomes "ORDER 66 · {bloatPct}%" — matches the original hand-rolled CRM button. Pass when the surface has a Consular session to track (CRM + Admin); omit on Studio. */
  bloatPct?: number
}

export function TopBar({
  left,
  tabs,
  right,
  sessionId,
  billingMode,
  onBillingChange,
  modelSwitch,
  onModelSwitch,
  theme,
  onThemeChange,
  usageRefreshTrigger,
  contextPct,
  cachedInputTokens,
  realInputTokens,
  onOrder66,
  order66Status = 'idle',
  bloatPct,
}: TopBarProps) {
  // Pill group wrapper style — light bg in polar, dark in onyx.
  const pillGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px',
    backgroundColor: theme === 'polar' ? 'var(--bg-card)' : 'rgba(9, 9, 11, 0.5)',
    borderRadius: '8px',
    border: theme === 'polar' ? '1px solid var(--border-card)' : '1px solid rgba(39, 39, 42, 0.5)',
  }

  // Pill button base — active = brand-green-bright, inactive = readable text.
  // `transition` scoped to box-shadow only — the active/inactive bg swap must
  // be INSTANT. A `transition: all` makes state toggles feel laggy.
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

  // ORDER pill class derivation — lives in globals.css under `.os-order-pill`.
  const orderClass = (severity: 'warn' | 'danger', status: Order66Status) =>
    `os-order-pill ${status === 'complete' ? 'complete' : severity}`

  return (
    <header
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        backgroundColor: 'var(--bg-card)',
        userSelect: 'none',
        gap: '24px',
      }}
    >
      {/* LEFT: identity slot + tabs slot, kept together so they pin to the left. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', minWidth: 0 }}>
        {left}
        {tabs}
      </div>

      {/* RIGHT: owned chrome (gauge + billing + model + theme + Order 66) + surface-specific right slot. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <UsageBadge
          sessionId={sessionId}
          refreshTrigger={usageRefreshTrigger}
          theme={theme}
          contextPct={contextPct}
          cachedInputTokens={cachedInputTokens}
          realInputTokens={realInputTokens}
          billingMode={billingMode}
        />

        {/* Theme — ONYX / POLAR */}
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

        {/* Billing — CLI (Claude ID via Claude Code subscription) vs API (Anthropic direct, out-of-pocket). */}
        <div style={pillGroupStyle}>
          <button onClick={() => onBillingChange('cli')} style={getPillStyle(billingMode === 'cli')}>CLI</button>
          <button onClick={() => onBillingChange('api')} style={getPillStyle(billingMode === 'api')}>API</button>
        </div>

        {/* THE model selector — ONE switch, exactly one position lit. FABLE / OPUS
            switch the BIG-AGENT brain (CD in Studio, Consular in CRM): a click
            SIGKILLs the bridge and the next turn respawns + re-rolls until the wire
            is 1M. GEMINI selects the WebDev build model (its path left untouched).
            SONNET ripped out. Single-select — never two lit. Ralph 2026-06-10. */}
        <div style={pillGroupStyle}>
          <button onClick={() => onModelSwitch('fable')} style={getPillStyle(modelSwitch === 'fable')}>FABLE</button>
          <button onClick={() => onModelSwitch('opus')} style={getPillStyle(modelSwitch === 'opus')}>OPUS</button>
          <button onClick={() => onModelSwitch('gemini')} style={getPillStyle(modelSwitch === 'gemini')}>GEMINI</button>
        </div>

        {/* ORDER 66 — hard compaction (kills bridge). Icon = `zap` (Sith lightning). */}
        <button
          type="button"
          onClick={onOrder66}
          disabled={order66Status !== 'idle'}
          className={orderClass('danger', order66Status)}
          title="Hard compaction — kills the bridge and wipes screenshots"
        >
          <Feather name="zap" size={12} strokeWidth={2.5} />
          {order66Status === 'idle' ? (typeof bloatPct === 'number' ? `ORDER 66 · ${bloatPct}%` : 'ORDER 66') :
           order66Status === 'complete' ? 'RESPAWNED' :
           'EXECUTING…'}
        </button>

        {right}
      </div>
    </header>
  )
}
