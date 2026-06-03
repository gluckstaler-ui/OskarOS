'use client'

// ============================================================================
// React CRM (WP-CRM-REACT, Ralph 2026-05-29).
//
// Re-emits crm.html's real structure (top bar · 5 nav tabs · fp-grid overview)
// using crm.html's REAL class names, styled by the shared crm.css loaded in
// app/crm/layout.tsx — pixel-identical, no CSS-module drift. The Consular chat
// is the studio's <ConversationPanel/>, reused 1:1.
//
// Migration staging: /crm.html stays live until the swap (next.config rewrite
// + remove the static file) — that's the one un-pulled step.
// ============================================================================

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { ConversationPanel } from '@/components/ConversationPanel'
import { uploadChatImages } from '@/lib/chat-image-upload'
import { appendToSessionLogAction } from '@/lib/session-actions'
import type { ConversationMessage } from '@/lib/types'
import { useCrmData } from './crm-data'
import { TriageRail } from '@/components/crm/TriageRail'
import { LeadList } from '@/components/crm/LeadList'
import { WhatsAppMessageList } from '@/components/crm/WhatsAppMessageList'
import { LeadDetail } from '@/components/crm/LeadDetail'
import { NextMoveHero } from '@/components/crm/NextMoveHero'
import { FlightDeckHost } from '@/components/crm/FlightDeckHost'
import { deriveBaselineDeck } from './flight-deck-derive'
import { CompactionOverlay } from '@/components/CompactionOverlay'
import { KanbanBoard } from '@/components/crm/KanbanBoard'
// WP-SCOUT-7 (Ralph 2026-06-03): import from the new component split. The
// old monolithic components/crm/ScoutPool.tsx is retired; the container in
// components/crm/scout/ composes ScoutRow + ScoutDossier + DecisionDeck.
import { ScoutPool } from '@/components/crm/scout/ScoutPool'
import { CmdKPalette } from '@/components/crm/CmdKPalette'
import { WaComposeModal } from '@/components/crm/WaComposeModal'
import { WaUnmatchedBanner } from '@/components/crm/WaUnmatchedBanner'
import { BulkImportModal } from '@/components/crm/BulkImportModal'
import { CrmShortcutsModal } from '@/components/crm/CrmShortcutsModal'
import { UsageBadge } from '@/components/UsageBadge'

const CHAT_STORAGE_KEY = 'oskar-crm-react-chat-v1'

// The React CRM owns EXACTLY the views crm.html owns (OSKAR_OWN_VIEWS in
// public/_shell.js). Sessions/Analytics/Settings belong to admin.html — a
// deliberate two-page split. Clicking those tabs navigates cross-page (see
// handleNav), it never renders an in-page surface — mirrors crm.html's
// maybeNavigateAcrossPages. So in-page `view` state is only ever own-views.
type CrmView = 'overview' | 'kanban' | 'scout'
type NavKey = CrmView | 'sessions' | 'analytics' | 'settings'

export default function CrmPage() {
  // ── Consular chat (right column) ──────────────────────────────────────────
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const persistedOnce = useRef(false)
  // Flight Deck — the Consular AUTHORS the picks by writing db/flight-deck.json
  // (file-as-API, like db/SESSION.md — no MCP, no iframe). The chat route reads
  // that file after each turn and returns it as `data.deck`; we render it through
  // the React <FlightDeck/>. Absent → null → live overdue-queue baseline.
  const [deckData, setDeckData] = useState<{ pushed: unknown[]; queueCount: number } | null>(null)
  // Flight Deck collapse (Ralph 2026-06-03): the deck-header toggle (replaces
  // the old LIVE badge) flips this; collapsed → deck renders header-only → the
  // Consular chat below it grows. Stable callback so it doesn't churn the host.
  const [deckCollapsed, setDeckCollapsed] = useState(false)
  const toggleDeck = useCallback(() => setDeckCollapsed((c) => !c), [])
  // Initial load — the chat route only returns the deck AFTER a turn, so on a
  // fresh /crm (or reload) fetch the persisted db/flight-deck.json once, so the
  // Consular's last drive shows immediately instead of the baseline queue.
  useEffect(() => {
    fetch('/api/admin/crm/consular/deck', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.pushed)) {
          setDeckData({ pushed: d.pushed, queueCount: typeof d.queueCount === 'number' ? d.queueCount : 0 })
        }
      })
      .catch(() => { /* absent → baseline */ })
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setMessages(parsed)
      }
    } catch { /* absent or corrupt — start fresh */ }
  }, [])

  useEffect(() => {
    if (!persistedOnce.current) { persistedOnce.current = true; return }
    try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages)) } catch { /* quota — best-effort */ }
  }, [messages])

  // Theme — /crm has no toggle source of its own, so mirror the stored pref
  // ('oskar_theme'/'oskar-theme') + a sticky ?theme= override, matching
  // _shell.js. Without this the [data-theme="polar"] editorial rules in
  // crm.css never apply (the root cause of the old "/crm looks wrong"). Ralph.
  const [theme, setTheme] = useState<'onyx' | 'polar'>('onyx')
  const applyTheme = useCallback((t: string) => {
    const next = t === 'polar' ? 'polar' : 'onyx'
    if (next === 'polar') document.documentElement.setAttribute('data-theme', 'polar')
    else document.documentElement.removeAttribute('data-theme')
    setTheme(next)
  }, [])
  useEffect(() => {
    try {
      const q = new URL(window.location.href).searchParams.get('theme')
      if (q === 'polar' || q === 'onyx') {
        localStorage.setItem('oskar_theme', q)
        localStorage.setItem('oskar-theme', q)
        applyTheme(q)
        return
      }
      const stored = localStorage.getItem('oskar_theme') || localStorage.getItem('oskar-theme')
      applyTheme(stored === 'polar' ? 'polar' : 'onyx')
    } catch { /* SSR / incognito — onyx default */ }
  }, [applyTheme])
  const toggleTheme = useCallback(() => {
    const next = theme === 'polar' ? 'onyx' : 'polar'
    try {
      localStorage.setItem('oskar_theme', next)
      localStorage.setItem('oskar-theme', next)
    } catch { /* best-effort */ }
    applyTheme(next)
  }, [theme, applyTheme])

  // Consular chat — request/response (POST {message} → {reply}), history kept
  // server-side under __crm__. Pasted images upload to the session; the
  // Consular opens them with Read (agentRef rides on the message).
  const handleSend = useCallback(async (content: string, images?: File[]) => {
    const text = content.trim()
    if (!text && (!images || images.length === 0)) return
    setIsLoading(true)
    let agentRef = ''
    let thumbUrls: string[] | undefined
    if (images && images.length > 0) {
      const r = await uploadChatImages(images, '__crm__')
      thumbUrls = r.urls.length ? r.urls : undefined
      agentRef = r.agentRef
    }
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: new Date().toISOString(), ...(thumbUrls ? { images: thumbUrls } : {}) },
    ])
    try {
      const res = await fetch('/api/admin/crm/consular/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `${text}${agentRef}` }),
      })
      const data = await res.json().catch(() => ({}))
      // The Consular may have rewritten db/flight-deck.json this turn; the chat
      // route reads it back and returns it as `data.deck`. Render it through the
      // React <FlightDeck/> (file-as-API, no MCP, no iframe).
      if (data && data.deck && Array.isArray(data.deck.pushed)) {
        setDeckData({
          pushed: data.deck.pushed,
          queueCount: typeof data.deck.queueCount === 'number' ? data.deck.queueCount : 0,
        })
      }
      // Discovery card — the Consular fired tc_discovery. The card owns the
      // turn: render <DiscoveryQuestionsCard> (via ConversationPanel) instead
      // of a prose bubble. Its onSubmit routes the rep's answers straight back
      // through this same handleSend, so the thread continues. Ralph 2026-05-29.
      const card =
        data && typeof data.card === 'object' && data.card && typeof data.card.kind === 'string'
          ? (data.card as ConversationMessage['card'])
          : undefined
      if (card) {
        setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date().toISOString(), card }])
        try {
          await appendToSessionLogAction('__crm__', 'User', text)
          await appendToSessionLogAction('__crm__', 'Consular', `[discovery card — ${card.kind}]`)
        } catch { /* session-log append is best-effort */ }
      } else {
        const reply = typeof data.reply === 'string' && data.reply.trim() ? data.reply : data.error ? `⚠ ${data.error}` : '(no reply)'
        setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: reply, timestamp: new Date().toISOString() }])
        // Log the exchange to the Consular's session log — appendToSessionLog is
        // directory-aware (__crm__ → db/SESSION.md). Sequential awaits avoid a
        // read-modify-write race on the file. Best-effort: never break the chat.
        try {
          await appendToSessionLogAction('__crm__', 'User', text)
          await appendToSessionLogAction('__crm__', 'Consular', reply)
        } catch { /* session-log append is best-effort */ }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: `⚠ Chat failed: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date().toISOString() }])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ── CRM data + view/overview state ─────────────────────────────────────────
  const { prospects, activities, loading, reload } = useCrmData()
  const [view, setView] = useState<CrmView>('overview')
  // Honor an inbound ?view= deep-link. admin.html's Overview/Kanban pills now
  // navigate here (maybeNavigateAcrossPages → /crm?view=kanban) since the
  // foreign page changed from /crm.html to /crm. Only own-views apply; foreign
  // keys (sessions/analytics/settings) are ignored — they live on admin.html.
  // Done in an effect (not lazy initial state) to avoid an SSR hydration
  // mismatch: server + client both start on 'overview', then flip client-side.
  useEffect(() => {
    try {
      const v = new URL(window.location.href).searchParams.get('view')
      if (v === 'overview' || v === 'kanban' || v === 'scout') setView(v)
    } catch { /* SSR / malformed URL — keep the overview default */ }
  }, [])
  const [filter, setFilter] = useState<string>('overdue')
  const [search, setSearch] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [billingMode, setBillingMode] = useState<'cli' | 'api'>('cli')
  // Order 66 — hard compaction of the Consular's memory (__crm__ session:
  // db/SESSION.md + db/user.md). 'running' mounts CompactionOverlay, which
  // opens the /api/order66 SSE; onComplete flips to RESPAWNED, then resets.
  const [order66Status, setOrder66Status] = useState<'idle' | 'running' | 'complete'>('idle')
  // Bloat gauge — db/SESSION.md size relative to the Sage-240 cut line. The
  // ⚡ icon takes this color (green = fresh, amber = filling, red = cut due)
  // so the rep can see at a glance when Order 66 is overdue. Polls cheaply
  // every 30s (just a fs.stat under the hood).
  const [bloat, setBloat] = useState<{ color: 'green' | 'amber' | 'red'; pct: number; bytes: number; cutBytes: number }>({ color: 'green', pct: 0, bytes: 0, cutBytes: 245760 })
  useEffect(() => {
    const tick = () => {
      fetch('/api/admin/crm/consular/bloat', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return
          const color = d.color === 'red' ? 'red' : d.color === 'amber' ? 'amber' : 'green'
          setBloat({ color, pct: d.pct || 0, bytes: d.bytes || 0, cutBytes: d.cutBytes || 245760 })
        })
        .catch(() => { /* offline → keep last */ })
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])
  const selectedProspect = selectedId ? prospects.find((p) => p.id === selectedId) ?? null : null

  // ⌘K palette + Undo stack — page-level so Kanban drops AND detail edits both
  // feed one undo (crmRegisterUndo/crmUndoClick) + one global ⌘K (crmCmdK*).
  const [cmdkOpen, setCmdkOpen] = useState(false)
  // Bulk Import modal (paste CSV/TSV/vCard or upload .csv/.tsv/.xlsx → map → import).
  const [bulkOpen, setBulkOpen] = useState(false)
  // Keyboard-shortcuts cheat sheet (opened by the ? button or the ? key).
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Show/hide the unmatched-senders strip — only relevant in the WhatsApp view.
  const [showUnmatched, setShowUnmatched] = useState(true)
  // WhatsApp compose — page-level so EVERY WhatsApp affordance (the channel
  // icon on rows + kanban cards, the detail's Send button) opens the Baileys
  // compose modal (Oskar bridge), never a wa.me external link. Ralph 2026-05-29.
  const [waComposeId, setWaComposeId] = useState<string | null>(null)
  const waComposeProspect = waComposeId ? prospects.find((p) => p.id === waComposeId) ?? null : null
  const [undo, setUndo] = useState<{ label: string; action: () => void | Promise<void> } | null>(null)
  const registerUndo = useCallback(
    (label: string, action: () => void | Promise<void>) => setUndo({ label, action }),
    [],
  )
  const runUndo = useCallback(async () => {
    if (!undo) return
    const u = undo
    setUndo(null)
    try { await u.action() } catch (e) { console.error('[CRM] undo failed:', e) }
  }, [undo])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setCmdkOpen(true); return }
      // ? opens the shortcuts cheat sheet — but not while typing in a field.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null
        const tag = t?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
        e.preventDefault(); setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Star toggle — PATCH then reload (matches crm.html crmToggleStarId).
  const handleToggleStar = useCallback(async (id: string) => {
    const p = prospects.find((x) => x.id === id)
    if (!p) return
    try {
      await fetch(`/api/admin/crm/prospects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred: !p.starred }),
      })
    } catch { /* best-effort */ }
    reload()
  }, [prospects, reload])

  // New Lead — POST a default prospect, reload, then open it expanded so Filippo
  // can type the real name immediately. Mirrors crm.html crmNewLead() exactly:
  // same default payload + open-expanded flow. Switches to overview if fired
  // from elsewhere (e.g. Kanban toolbar). Ralph 2026-05-31.
  const handleNewLead = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/crm/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: 'New Lead',
          stage: 'Incoming',
          status: 'To do',
          amount_chf: 0,
          confidence_pct: 25,
          next_action_date: new Date().toISOString().slice(0, 10),
          next_action_label: 'TODAY',
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { prospect?: { id?: string } }
      const newId = data.prospect?.id
      if (!newId) throw new Error('server returned no prospect id')
      await reload()
      setView('overview')
      setSelectedId(newId)
    } catch (err) {
      console.error('[CRM] new lead failed:', err)
      alert('Failed to create lead: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [reload])

  // Create a lead from an UNMATCHED inbound WhatsApp message — POST a prospect
  // seeded with the sender's push-name + phone, dismiss the message from the
  // unmatched inbox (it's handled now), reload, and open it expanded to refine.
  // Port of crm.html crmWaCreateLead (which seeded the quick-add input; React
  // creates directly via the now-fixed POST and opens the card).
  const handleCreateLeadFromWa = useCallback(async (phone: string, pushName: string, waMessageId: string) => {
    try {
      const res = await fetch('/api/admin/crm/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: pushName || 'Unknown',
          phone: phone ? `+${phone}` : '',
          stage: 'Incoming',
          status: 'To do',
          amount_chf: 0,
          confidence_pct: 25,
          next_action_date: new Date().toISOString().slice(0, 10),
          next_action_label: 'TODAY',
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { prospect?: { id?: string } }
      const newId = data.prospect?.id
      if (waMessageId) {
        await fetch(`/api/admin/crm/wa-unmatched?wa_message_id=${encodeURIComponent(waMessageId)}`, { method: 'DELETE' }).catch(() => {})
      }
      await reload()
      setView('overview')
      if (newId) setSelectedId(newId)
    } catch (err) {
      console.error('[CRM] create lead from WA failed:', err)
      alert('Failed to create lead: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [reload])

  const navTabs: { key: NavKey; label: string }[] = [
    { key: 'sessions', label: 'Sessions' },
    { key: 'kanban', label: 'Kanban' },
    { key: 'scout', label: 'Scout' },
    { key: 'overview', label: 'Overview' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'settings', label: 'Settings' },
  ]
  // Own views render in-page; foreign views (Sessions/Analytics/Settings) live
  // on admin.html → navigate cross-page, exactly like crm.html's switchView →
  // maybeNavigateAcrossPages(view) → location.href = /admin.html?view=X.
  const handleNav = (key: NavKey) => {
    if (key === 'overview' || key === 'kanban' || key === 'scout') { setView(key); return }
    window.location.href = `/admin.html?view=${encodeURIComponent(key)}`
  }

  return (
    <>
      {/* ── TOP BAR ────────────────────────────────────────────────────────── */}
      <header
        className="bento-card"
        style={{ flexShrink: 0, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, background: 'linear-gradient(135deg, #15B981, #0F766E)' }}>O</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>OskarOS</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>Admin Dashboard</div>
            </div>
          </div>
          <nav style={{ display: 'flex', gap: 4, background: 'var(--bg-app)', border: '1px solid var(--border-card)', borderRadius: 10, padding: 3 }}>
            {navTabs.map((t) => {
              const active = view === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => handleNav(t.key)}
                  style={{
                    padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: active ? 'var(--bg-card)' : 'transparent',
                    color: active ? 'var(--text-main)' : 'var(--text-muted)',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.2)' : 'none',
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Usage gauge — $cost · MODE · ↻reset · ●ctx% · tokens/window for the
              __crm__ Consular session. The studio UsageBadge, reused 1:1. */}
          <UsageBadge sessionId="__crm__" billingMode={billingMode} theme={theme} />
          {/* Billing toggle */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-app)', border: '1px solid var(--border-card)', borderRadius: 10, padding: 3 }}>
            {(['cli', 'api'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setBillingMode(m)}
                style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', background: billingMode === m ? 'var(--bg-card)' : 'transparent', color: billingMode === m ? 'var(--text-main)' : 'var(--text-muted)' }}>
                {m}
              </button>
            ))}
          </div>
          {/* ↶ Undo — rolls back the last mutation (Kanban stage drag, status change). */}
          <button
            type="button"
            onClick={runUndo}
            disabled={!undo}
            title={undo ? `Undo: ${undo.label}` : 'Nothing to undo'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'transparent', color: undo ? 'var(--text-main)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: undo ? 'pointer' : 'default', opacity: undo ? 1 : 0.45 }}
          >
            ↶ Undo
          </button>
          {/* ⚡ ORDER 66 — hard compaction of the Consular's memory (__crm__).
              The ⚡ takes the bloat color (green/amber/red) so the rep sees how
              full db/SESSION.md is relative to the Sage-240 cut line; full
              bytes + pct in the hover title. */}
          <button
            type="button"
            className="os-order-pill danger"
            onClick={() => { if (order66Status === 'idle') setOrder66Status('running') }}
            disabled={order66Status !== 'idle'}
            title={`Order 66 — hard compaction of the Consular's memory (db/SESSION.md + db/user.md). Session log ${(bloat.bytes / 1024).toFixed(0)}KB of ${(bloat.cutBytes / 1024).toFixed(0)}KB (Sage-240 cut). Order 66 ${bloat.pct >= 100 ? 'overdue' : bloat.pct >= 60 ? 'due soon' : 'not needed'}.`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              style={{
                color: bloat.color === 'red' ? '#ef4444' : bloat.color === 'amber' ? '#f59e0b' : '#10b981',
                filter: bloat.color === 'red' ? `drop-shadow(0 0 3px ${'#ef4444'})` : 'none',
              }}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            {order66Status === 'idle'
              ? `ORDER 66 · ${bloat.pct}%`
              : order66Status === 'complete'
                ? 'RESPAWNED'
                : 'EXECUTING…'}
          </button>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textDecoration: 'none' }}>Open App ↗</a>
          <button type="button" onClick={toggleTheme} title="Toggle theme"
            style={{ padding: 8, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
            {theme === 'polar' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* ── MAIN ───────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 'var(--gap-app, 20px)' }}>
        {view === 'overview' ? (
          <div className={`fp-grid${selectedProspect ? ' is-card-open' : ''}`} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* LEFT — triage rail */}
            <TriageRail
              prospects={prospects}
              activities={activities}
              filter={filter}
              onFilterChange={(f) => { setFilter(f); setSelectedId(null) }}
              loading={loading}
            />

            {/* MIDDLE — NEXT MOVE hero + (list-mode ↔ detail-mode via .is-card-open) */}
            <div className="fp-middle">
              <NextMoveHero prospects={prospects} activities={activities} onOpen={setSelectedId} onWhatsApp={setWaComposeId} />
              <div className="fp-main-list-mode">
                {filter === 'activity:WhatsApp' ? (
                  // WhatsApp filter shows the MESSAGES (flat, newest first), not the
                  // prospect roster — plus the unmatched-senders strip (inbound from
                  // unknown numbers), which is toggleable here only.
                  <>
                    <button
                      type="button"
                      onClick={() => setShowUnmatched((s) => !s)}
                      title="Show or hide inbound WhatsApp from unknown numbers"
                      style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'var(--bg-app)', color: 'var(--text-dim)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                      {showUnmatched ? '▾' : '▸'} {showUnmatched ? 'Hide' : 'Show'} unmatched senders
                    </button>
                    {showUnmatched && <WaUnmatchedBanner onCreateLead={handleCreateLeadFromWa} />}
                    <WhatsAppMessageList
                      activities={activities}
                      prospects={prospects}
                      onSelectProspect={setSelectedId}
                      loading={loading}
                    />
                  </>
                ) : (
                  <LeadList
                    prospects={prospects}
                    activities={activities}
                    filter={filter}
                    search={search}
                    onSearchChange={setSearch}
                    onFilterChange={(f) => { setFilter(f); setSelectedId(null) }}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onToggleStar={handleToggleStar}
                    onWhatsApp={setWaComposeId}
                    onNewLead={handleNewLead}
                    onBulk={() => setBulkOpen(true)}
                    onShortcuts={() => setShortcutsOpen(true)}
                    loading={loading}
                  />
                )}
              </div>
              <div className="fp-main-detail-mode">
                <div id="crm-overview-context" className="fp-detail-host">
                  {selectedProspect && (
                    <LeadDetail
                      prospect={selectedProspect}
                      activities={activities.filter((a) => a.prospect_id === selectedProspect.id)}
                      onClose={() => setSelectedId(null)}
                      onReload={reload}
                      registerUndo={registerUndo}
                      onWhatsApp={setWaComposeId}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT — the Consular AUTHORS the deck picks (writes
                db/flight-deck.json; the chat route returns it as data.deck);
                rendered through the React <FlightDeck/> below — no iframe, no MCP.
                Falls back to the live overdue queue until the Consular drives one.
                The chat below stays the studio ConversationPanel. */}
            <div className="fp-right">
              {(() => {
                const activeDeck = deckData ?? deriveBaselineDeck(prospects)
                return (
                  <FlightDeckHost
                    pushed={activeDeck.pushed}
                    queueCount={activeDeck.queueCount}
                    theme={theme}
                    collapsed={deckCollapsed}
                    onToggleCollapse={toggleDeck}
                    onExecute={(a) => { if (a.leadId) setSelectedId(a.leadId) }}
                    onOpenLead={(id) => { if (id) setSelectedId(id) }}
                    onShowQueue={() => { setFilter('overdue'); setSelectedId(null) }}
                  />
                )
              })()}
              <div style={{ flex: 1, minHeight: 0 }}>
                <ConversationPanel
                  messages={messages}
                  onSendMessage={handleSend}
                  isLoading={isLoading}
                  layoutMode="2-panel"
                  streamingText=""
                />
              </div>
            </div>
          </div>
        ) : view === 'scout' ? (
          <ScoutPool onPromoted={() => reload()} onViewKanban={() => setView('kanban')} />
        ) : (
          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Ralph 2026-06-03 — detail no longer opens as an overlay/modal.
                When `selectedId` matches a card, KanbanBoard renders the full
                LeadDetail IN PLACE of that card's slot (its own stage column).
                Other columns + cards stay visible — same interaction pattern
                as crm.html's crmExpandCardInline. The dim-overlay backdrop is
                gone; closing happens via the Back button inside LeadDetail. */}
            <KanbanBoard
              prospects={prospects}
              activities={activities}
              onSelect={setSelectedId}
              onReload={reload}
              onToggleStar={handleToggleStar}
              registerUndo={registerUndo}
              onWhatsApp={setWaComposeId}
              onNewLead={handleNewLead}
              onBulk={() => setBulkOpen(true)}
              loading={loading}
              selectedId={selectedId}
            />
          </div>
        )}
      </div>

      {/* Order 66 cinematic — opens the /api/order66 SSE on the __crm__ session
          (kills the Consular bridge, runs the two Sages, signals respawn).
          Reused 1:1 from the studio. */}
      {order66Status === 'running' && (
        <CompactionOverlay
          sessionId="__crm__"
          endpoint="order66"
          onContinue={() => setOrder66Status('idle')}
          onComplete={() => {
            setOrder66Status('complete')
            setTimeout(() => setOrder66Status('idle'), 3000)
          }}
        />
      )}

      {/* ⌘K / Ctrl+K quick switcher — search the prospect corpus, ↵ to open. */}
      {cmdkOpen && (
        <CmdKPalette
          prospects={prospects}
          onPick={(id) => { setSelectedId(id); setView('overview') }}
          onClose={() => setCmdkOpen(false)}
        />
      )}

      {/* WhatsApp compose (Baileys via Oskar bridge) — opened by ANY WhatsApp
          affordance: channel icon on rows + kanban cards, detail Send button. */}
      {waComposeProspect && (
        <WaComposeModal
          prospectId={waComposeProspect.id}
          company={waComposeProspect.company || ''}
          phone={waComposeProspect.phone || ''}
          contactName={waComposeProspect.contact_name || ''}
          onClose={() => setWaComposeId(null)}
          onSent={reload}
        />
      )}

      {/* Bulk Import — paste CSV/TSV/vCard or upload .csv/.tsv/.xlsx → map → import. */}
      {bulkOpen && (
        <BulkImportModal
          onClose={() => setBulkOpen(false)}
          onImported={reload}
        />
      )}

      {/* Keyboard-shortcuts cheat sheet (? button / ? key). */}
      {shortcutsOpen && <CrmShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </>
  )
}
