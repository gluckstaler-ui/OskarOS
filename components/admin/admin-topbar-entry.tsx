'use client'

// ============================================================================
// admin-topbar-entry — the React island entry point for admin.html.
//
// Mounts the SAME <TopBar> component Studio + React-CRM use into the
// `<div id="admin-topbar-root"></div>` element on admin.html. NOT a port —
// the actual component file is `components/TopBar.tsx`, imported directly.
// esbuild bundles this entry + TopBar + UsageBadge + Feather + transitive
// deps into `public/admin-topbar.js`; admin.html loads that bundle via a
// `<script type="module">` tag.
//
// State management
// ─────────────────
// Theme + billing persist in localStorage (same keys `_shell.js` uses, so
// admin.html's legacy chrome stays in sync). The model switch is server-truth:
// hydrated from the __crm__ session config, flips POST to the brain route —
// no localStorage mirror. Tab clicks call `window.switchView(key)` —
// admin.html's existing view router. Order 66 is owned by `_shell.js`
// (SSE + bloat polling); the island calls `window.triggerConsularOrder66()`
// and subscribes to the 'order66-status' / 'order66-bloat' CustomEvents.
//
// Why an island, not a full migration
// ───────────────────────────────────
// admin.html is 5000+ LOC of vanilla HTML/JS that drives sessions, kanban,
// analytics, settings. Migrating all of that to Next.js is a separate
// multi-week effort. The island gives us the TopBar reuse — single source
// of truth for chrome — without touching the body. When admin.html
// eventually migrates, this island just gets imported directly in the
// Next.js route and the bundle goes away.
// ============================================================================

import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { TopBar, type Order66Status } from '@/components/TopBar'
import { DEFAULT_BRAIN, switchFromConfig, type ModelSwitch } from '@/lib/models'
import { AdminLogo } from './AdminLogo'
import { AdminTabs, type AdminNavKey } from './AdminTabs'
import { AdminRightActions } from './AdminRightActions'

declare global {
  interface Window {
    switchView?: (key: string) => void
    /** Current active view, written by admin.html's switchView so the island can read it back. */
    __adminActiveView?: AdminNavKey
    /** Order 66 trigger — owned by _shell.js. The React island just calls it; _shell.js runs the SSE machine and broadcasts 'order66-status' / 'order66-bloat' CustomEvents the island subscribes to. */
    triggerConsularOrder66?: () => void
  }
}

function readActiveTab(): AdminNavKey {
  // URL ?view=X wins over localStorage (deep-links from Studio land here).
  try {
    const v = new URLSearchParams(window.location.search).get('view')
    if (v === 'sessions' || v === 'kanban' || v === 'overview' || v === 'analytics' || v === 'settings') return v
  } catch { /* SSR / missing window — fall through */ }
  if (window.__adminActiveView) return window.__adminActiveView
  return 'sessions'
}

function readLS<T extends string>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return (v as T) ?? fallback } catch { return fallback }
}
function writeLS(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* private mode / quota — silent */ }
}

function AdminTopBarIsland() {
  // Persisted state — reads from the same localStorage keys _shell.js uses
  // so the legacy gauge/billing handlers stay in sync if either survives.
  const [theme, setTheme] = useState<'onyx' | 'polar'>(() => readLS('oskar-theme', 'onyx'))
  const [billingMode, setBillingMode] = useState<'cli' | 'api'>(() => readLS('oskar-billing', 'cli'))
  // THE model switch (one variable, one lit) — REAL wire, same as Studio/CRM:
  // hydrate from the __crm__ session config (server truth, no localStorage
  // mirror), flip → POST the position. The brain route writes the full preset
  // (cdModel + webDevModel) and group-SIGKILLs the Consular ONLY when the
  // brain actually changes. GEMINI = Opus brain + Gemini padawans. Ralph 2026-06-10.
  const [modelSwitch, setModelSwitch] = useState<ModelSwitch>(DEFAULT_BRAIN)
  useEffect(() => {
    fetch('/api/sessions/__crm__/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => { if (cfg && cfg.cdModel) setModelSwitch(switchFromConfig(cfg.cdModel, cfg.webDevModel)) })
      .catch(() => { /* config GET failed — switch shows default until a flip */ })
  }, [])
  const handleModelSwitch = (m: ModelSwitch) => {
    if (m === modelSwitch) return
    setModelSwitch(m)
    fetch('/api/sessions/__crm__/brain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m }),
    }).then((r) => r.json()).then((res) => console.log(`🧠 Consular switch → ${m} (cd=${res?.cdModel ?? '?'}, webdev=${res?.webDevModel ?? '?'}); bridge ${res?.killed ? "SIGKILL'd" : 'kept'}`)).catch((e) => console.warn('[admin-topbar] model switch failed:', e))
  }
  const [activeTab, setActiveTab] = useState<AdminNavKey>(() => readActiveTab())
  const [order66Status, setOrder66Status] = useState<Order66Status>('idle')
  // Bloat percentage — sourced from _shell.js's `refreshOrder66Gauge` which
  // polls /api/admin/crm/consular/bloat every 30s and broadcasts via the
  // 'order66-bloat' CustomEvent. No duplicate poller in the React island
  // (Ralph 2026-06-09: reuse the shared shell, don't port it).
  const [bloatPct, setBloatPct] = useState<number | undefined>(undefined)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ pct?: number }>).detail
      if (detail && typeof detail.pct === 'number') setBloatPct(detail.pct)
    }
    window.addEventListener('order66-bloat', handler)
    return () => window.removeEventListener('order66-bloat', handler)
  }, [])

  // Order 66 button state — _shell.js dispatches 'order66-status' on every
  // transition (idle → running → complete → idle). The React island just
  // subscribes; no parallel SSE wiring here.
  useEffect(() => {
    const handler = (e: Event) => {
      const state = (e as CustomEvent<Order66Status>).detail
      if (state === 'idle' || state === 'running' || state === 'complete') setOrder66Status(state)
    }
    window.addEventListener('order66-status', handler)
    return () => window.removeEventListener('order66-status', handler)
  }, [])

  // Apply theme to <html> the same way the React Studio + CRM do.
  useEffect(() => {
    if (theme === 'polar') document.documentElement.setAttribute('data-theme', 'polar')
    else document.documentElement.removeAttribute('data-theme')
    writeLS('oskar-theme', theme)
  }, [theme])

  useEffect(() => { writeLS('oskar-billing', billingMode) }, [billingMode])

  // Order 66 click → call _shell.js. It owns the confirm dialog, SSE
  // connection, error handling, the compaction-complete → crmChatClear
  // bridge, and the state-machine transitions. State updates flow back
  // into this island via the 'order66-status' event subscription above.
  const handleOrder66 = () => window.triggerConsularOrder66?.()

  const handleTabSelect = (key: AdminNavKey) => {
    setActiveTab(key)
    // Call admin.html's existing view router so the body content swaps.
    window.switchView?.(key)
  }

  return (
    <TopBar
      sessionId="__crm__"
      billingMode={billingMode}
      onBillingChange={setBillingMode}
      modelSwitch={modelSwitch}
      onModelSwitch={handleModelSwitch}
      theme={theme}
      onThemeChange={setTheme}
      onOrder66={handleOrder66}
      order66Status={order66Status}
      bloatPct={bloatPct}
      left={<AdminLogo />}
      tabs={<AdminTabs active={activeTab} onSelect={handleTabSelect} />}
      right={<AdminRightActions />}
    />
  )
}

// Mount — wait for DOM ready since admin.html loads this script in <head>
// or above the root div via type=module (defer-equivalent).
function mount() {
  const el = document.getElementById('admin-topbar-root')
  if (!el) {
    console.warn('[admin-topbar] mount element #admin-topbar-root not found')
    return
  }
  createRoot(el).render(<AdminTopBarIsland />)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
