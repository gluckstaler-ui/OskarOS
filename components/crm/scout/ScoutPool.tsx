'use client'
// ============================================================================
// ScoutPool — the in-page `scout` CrmView (WP-SCOUT-7, Ralph 2026-06-03).
//
// Container component for the Scout pool. State + data fetch + the orchestrator
// for select → Taste → Promote/Discard. The four spec'd children:
//   ScoutRow     — one row per lead (top contact line + the scout strip)
//   ScoutDossier — the per-lead expanded view (◐ Queried + ◓ Scouted)
//   DecisionDeck — the sticky bottom action bar (Taste · Promote · Discard)
//   ScoutMeter   — the 5-segment meter atom shared by ScoutRow + ScoutDossier
//
// Refactored out of the old 251-LOC monolith components/crm/ScoutPool.tsx —
// one row per lead from real data, click a card to open its dossier with
// the live Puppeteer screenshot (now wired via WP-SCOUT-2's captureUrl).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScoutRow } from './ScoutRow'
import { DecisionDeck } from './DecisionDeck'
import {
  type RawProspect, type FilterKey,
  scoutOf, stateOf, heatOf,
} from './types'

interface Props {
  /** Parent reloads CRM data (e.g. so the Kanban reflects a fresh promote). */
  onPromoted: () => void
  /** Parent flips the CrmView to 'kanban' — called from the post-Promote toast. */
  onViewKanban: () => void
}

export function ScoutPool({ onPromoted, onViewKanban }: Props) {
  const [pool, setPool] = useState<RawProspect[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [tasting, setTasting] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  // Snackbar stack — was a single nullable slot, but Scout's per-row failure
  // flashes (Ralph 2026-06-03) can land 5-20 in a single 30s window and we
  // want each one VISIBLE, not silently overwritten. Each entry has its own
  // id + linger timer; the renderer stacks them inside `.scout-toast-stack`.
  const [toasts, setToasts] = useState<{ id: string; msg: string; kill?: boolean; kanban?: boolean }[]>([])
  /**
   * Ralph 2026-06-03 · STOP-button pattern. Captured from the POST /scout/taste
   * response so the running button can morph "Run Scout (N)" → "STOP (M in flight)"
   * — single-button toggle. Used to call /api/mcp/cancel-job when the user wants
   * to halt a hung batch (not a true cancel; finished rows stay persisted).
   */
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/crm/scout/pool', { cache: 'no-store' })
      const j = (await r.json()) as { pool?: RawProspect[] }
      setPool(j.pool ?? [])
    } catch (e) {
      console.error('[ScoutPool] load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const flash = useCallback(
    (msg: string, opts: { kill?: boolean; kanban?: boolean; kind?: 'success' | 'error' } = {}) => {
      // `kind:'error'` maps to the existing `.kill` red-border style; `kind:
      // 'success'` falls through to the default (green border). The success
      // snackbar lingers a touch longer so the user can read the count.
      const kill = opts.kill || opts.kind === 'error'
      const linger = opts.kanban ? 5000 : opts.kind ? 4000 : 2600
      const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      setToasts((t) => [...t, { id, msg, kill, kanban: opts.kanban }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), linger)
    },
    [],
  )

  // ── Funnel counts: total · scouted · 🔥 hot · ◇ greenfield. Counts is
  //    a memo because the filter chips also display per-chip counts that
  //    need to stay in sync as the pool changes.
  const counts = useMemo(() => {
    let scouted = 0, hot = 0, warm = 0, cold = 0, green = 0, raw = 0
    for (const p of pool) {
      const s = stateOf(p)
      if (s === 'greenfield') green++
      else if (s === 'scouted') {
        scouted++
        const h = heatOf(scoutOf(p).taste ?? {})
        if (h === 'hot') hot++
        else if (h === 'warm') warm++
        else cold++
      } else raw++
    }
    return { scouted, hot, warm, cold, green, raw, total: pool.length }
  }, [pool])

  // ── Filter + search.
  const shown = useMemo(() => pool.filter((p) => {
    const s = stateOf(p)
    if (filter === 'raw' && s !== 'raw') return false
    if (filter === 'green' && s !== 'greenfield') return false
    if (filter === 'hot' || filter === 'warm' || filter === 'cold') {
      if (s !== 'scouted' || heatOf(scoutOf(p).taste ?? {}) !== filter) return false
    }
    if (query) {
      const hay = `${p.name} ${p.company} ${p.website} ${p.industry}`.toLowerCase()
      if (!hay.includes(query)) return false
    }
    return true
  }), [pool, filter, query])

  // ── Selection helpers.
  const togSel = useCallback((id: string) => setSel((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  }), [])
  const togOpen = useCallback((id: string) => setOpen((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  }), [])
  const allShownSelected = shown.length > 0 && shown.every((p) => sel.has(p.id))
  const toggleAll = () => setSel((s) => {
    const n = new Set(s)
    if (allShownSelected) shown.forEach((p) => n.delete(p.id))
    else shown.forEach((p) => n.add(p.id))
    return n
  })

  // The subset of selected ids that are RAW (tastable). Taste skips
  // greenfield/scouted rows — the deck shows this count for clarity.
  const rawSelected = useMemo(() => {
    return [...sel].filter((id) => {
      const p = pool.find((x) => x.id === id)
      return p && p.website && !scoutOf(p).scanned_at
    })
  }, [sel, pool])

  // ── Actions.

  // Ralph 2026-06-03: the Taste route enqueues a background job and returns
  // immediately with `{job, deduped}`. Awaiting only the POST would clear
  // the tasting state before any row finished. Poll the pool every 3s
  // until every fired id has `scanned_at` (the scout_json's "this row was
  // tasted" stamp) or 6 minutes have passed (32 rows × ~25-45s per row,
  // parallel — well inside the cap). Polling is cheaper than wiring
  // job-status here and lets the visible scout strip update progressively
  // as each row's patch lands.
  const POLL_INTERVAL_MS = 3_000
  const POLL_TIMEOUT_MS  = 6 * 60_000
  /**
   * Poll the pool until every fired raw id has a scanned_at, then return the
   * per-row breakdown for the post-batch snackbar:
   *   succeeded — Opus tasted the row (palate non-null)
   *   failed    — capture failed / outer catch / palate null after scan
   *   pending   — never landed within the timeout (or after a STOP)
   */
  const pollUntilTasted = useCallback(
    async (rawIds: string[]): Promise<{ total: number; succeeded: number; failed: number; pending: number }> => {
      const started = Date.now()
      const remaining = new Set(rawIds)
      let lastFresh: RawProspect[] = []
      while (remaining.size > 0 && Date.now() - started < POLL_TIMEOUT_MS) {
        try {
          const r = await fetch('/api/admin/crm/scout/pool', { cache: 'no-store' })
          const j = (await r.json()) as { pool?: RawProspect[] }
          const fresh = j.pool ?? []
          lastFresh = fresh
          setPool(fresh)
          for (const p of fresh) {
            if (remaining.has(p.id) && scoutOf(p).scanned_at) {
              // Row landed — drop it from tasting + remaining sets.
              remaining.delete(p.id)
              setTasting((s) => { const n = new Set(s); n.delete(p.id); return n })
              // Ralph 2026-06-03 · per-row failure snackbar. Fires the moment
              // the row's scout_json lands with a failure verdict — so the
              // user can SEE which lead broke (and how) while the batch is
              // still streaming, not just a summary count at the end.
              const s = scoutOf(p)
              const palate = s.taste?.palate
              const isFailure = s.failed === true || palate == null
              if (isFailure) {
                const v = String(s.taste?.verdict ?? '')
                let mode = 'failed'
                if (v.startsWith('capture failed: timeout'))       mode = 'capture timeout'
                else if (v.startsWith('capture failed: DNS'))      mode = 'DNS not found'
                else if (v.startsWith('capture failed: net::ERR_CERT')) mode = 'SSL cert invalid'
                else if (v.startsWith('capture failed: net::ERR_NAME')) mode = 'DNS unresolved'
                else if (v.startsWith('capture failed:'))          mode = 'capture failed'
                else if (v.includes('did not submit a verdict'))   mode = 'no verdict from agent'
                const label = (p.company || p.name || p.website || p.id).slice(0, 36)
                flash(`✕ ${label} · ${mode}`, { kind: 'error' })
              }
            }
          }
        } catch (e) {
          console.error('[ScoutPool] poll failed:', e)
        }
        if (remaining.size === 0) break
        await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS))
      }
      // Timeout (or STOP) fallback — clear tasting for anything still flying.
      if (remaining.size > 0) {
        setTasting((s) => { const n = new Set(s); for (const id of remaining) n.delete(id); return n })
      }
      // Tally for the post-batch snackbar. Source of truth: scout_json on each
      // row in the latest fetch (lastFresh). A row "succeeded" iff Opus gave it
      // a palate; "failed" iff the outer-catch failed flag is set OR a scan
      // landed without a palate (capture-fail / bridge-fail); "pending"
      // otherwise (still in flight at STOP/timeout).
      let succeeded = 0, failed = 0, pending = 0
      const byId = new Map(lastFresh.map((p) => [p.id, p]))
      for (const id of rawIds) {
        const p = byId.get(id)
        if (!p) { pending++; continue }
        const s = scoutOf(p)
        if (!s.scanned_at) { pending++; continue }
        const palate = s.taste?.palate
        if (s.failed === true || palate == null) { failed++; continue }
        succeeded++
      }
      return { total: rawIds.length, succeeded, failed, pending }
    },
    // `flash` is itself a stable useCallback ([], no closures over render
    // state), but we list it for hook-deps hygiene.
    [flash],
  )

  // Ralph 2026-06-03: the TopBar selector drives TRANSPORT (cli/api), but
  // the MODEL is Scout-specific — taste judgement is short (read ≤2 images,
  // name one visual decision, two 1-5 scores + a one-line verdict). Sonnet
  // handles that fine; we don't need Opus for it. Defaults here mirror the
  // SHAPE of lib/session-config.ts MODE_DEFAULTS but flavour with sonnet
  // identifiers — same per-mode variants, different model family. If a
  // future toggle wants Opus for Scout, override `model` in the POST body.
  type ExecutionMode = 'smpl' | 'cli' | 'api'
  const SCOUT_MODE_DEFAULTS: Record<ExecutionMode, string> = {
    smpl: 'sonnet',                  // CLI tier alias (resolves via settings.json)
    cli:  'claude-sonnet-4-6[1m]',   // CLI full identifier, 1M context
    api:  'claude-sonnet-4-6',       // Anthropic API model id
  }
  const readMode = (): { mode: ExecutionMode; model: string } => {
    if (typeof window === 'undefined') return { mode: 'cli', model: SCOUT_MODE_DEFAULTS.cli }
    const saved = window.localStorage.getItem('oskar_billing_mode')
    const mode: ExecutionMode =
      saved === 'smpl' || saved === 'cli' || saved === 'api' ? saved : 'cli'
    return { mode, model: SCOUT_MODE_DEFAULTS[mode] }
  }

  async function tasteSelected() {
    const rawIds = rawSelected
    if (!rawIds.length) return
    setTasting(new Set(rawIds))
    const { mode, model } = readMode()
    flash(`◐ tasting ${rawIds.length} site${rawIds.length > 1 ? 's' : ''} · ${mode}/${model}…`)
    try {
      await fetch('/api/admin/crm/scout/taste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawIds, mode, model }),
      })
    } catch (e) {
      console.error('[ScoutPool] taste failed:', e)
    }
    setSel(new Set())          // clear selection so the deck collapses
    await pollUntilTasted(rawIds)
  }

  // Persistent "Run Scout" button — fires the next BATCH_SIZE raw rows.
  // Visible without selection so a fresh pool can be processed in one
  // click (no "select-all" gesture needed).
  const BATCH_SIZE = 32
  const nextBatch = useMemo(() => {
    // Take the FIRST `BATCH_SIZE` raw rows AS SHOWN — so a filter or
    // search narrows the batch. The pool is already sorted by scraped_at
    // DESC by /pool, so this naturally takes the "next N" in queue order.
    return shown
      .filter((p) => stateOf(p) === 'raw' && !tasting.has(p.id))
      .slice(0, BATCH_SIZE)
      .map((p) => p.id)
  }, [shown, tasting])

  async function runScoutBatch() {
    if (nextBatch.length === 0) return
    const rawIds = nextBatch
    const { mode, model } = readMode()
    setTasting((s) => { const n = new Set(s); rawIds.forEach((id) => n.add(id)); return n })
    flash(`◐ launching ${rawIds.length} scout agent${rawIds.length > 1 ? 's' : ''} in parallel · ${mode}/${model}…`)
    try {
      const r = await fetch('/api/admin/crm/scout/taste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawIds, mode, model }),
      })
      // Capture jobId so the STOP button can call /api/mcp/cancel-job if the
      // batch hangs. `deduped:true` returns the in-flight job's id — same
      // semantics (one cancel reaches both callers).
      const j = (await r.json().catch(() => ({}))) as { job?: { jobId?: string } }
      setActiveJobId(j.job?.jobId ?? null)
    } catch (e) {
      console.error('[ScoutPool] runScoutBatch failed:', e)
    }
    // Block on the poller — it sets tasting → ∅ and returns per-row stats
    // for the post-batch snackbar.
    const stats = await pollUntilTasted(rawIds)
    setActiveJobId(null)
    // Snackbar at end. Green = "everything Opus-tasted"; red = "any failure
    // or any row still pending (STOP/timeout left work undone)".
    if (stats.failed === 0 && stats.pending === 0) {
      flash(`✓ scouted ${stats.succeeded}/${stats.total}`, { kind: 'success' })
    } else {
      const parts: string[] = []
      if (stats.succeeded > 0) parts.push(`${stats.succeeded} ok`)
      if (stats.failed > 0)    parts.push(`${stats.failed} failed`)
      if (stats.pending > 0)   parts.push(`${stats.pending} stopped`)
      flash(`✕ taste batch: ${parts.join(' · ')} (of ${stats.total})`, { kind: 'error' })
    }
  }

  /**
   * STOP-button handler — emergency-stop pattern (Ralph 2026-06-03). NOT a
   * cancel-style undo; this is "the batch is hung, get me out". Fires
   * /api/mcp/cancel-job with the active jobId — the runner's `signal.aborted`
   * check stops the next row before it starts (in-flight Puppeteer / Opus
   * calls run to their own internal timeouts; finished rows stay persisted).
   * Local tasting state clears immediately so the UI exits its spinner state
   * even if the server takes a moment to react.
   */
  async function stopBatch() {
    if (!activeJobId) return
    const jobId = activeJobId
    try {
      await fetch('/api/mcp/cancel-job', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, sessionId: '__scout__' }),
      })
    } catch (e) {
      console.error('[ScoutPool] stop failed:', e)
    }
    // Clear local in-flight state right away — the poller sees the cancel,
    // exits its loop on the next tick, and the post-batch snackbar fires
    // with the partial-results breakdown (pending count > 0).
    setTasting(new Set())
    setActiveJobId(null)
  }

  async function promoteSelected() {
    const ids = [...sel]
    if (!ids.length) return
    let n = 0
    for (const id of ids) {
      try {
        // Ralph 2026-06-03 · WP-SCOUT-8 path-rename: REST-shaped per §17 spec.
        // The id lives in the URL segment, no body needed.
        const r = await fetch(`/api/admin/crm/raw-prospects/${encodeURIComponent(id)}/promote`, {
          method: 'POST',
        })
        if (r.ok) n++
      } catch (e) { console.error('[ScoutPool] promote failed:', e) }
    }
    await load()
    setSel(new Set())
    onPromoted()
    flash(`→ ${n} promoted to Incoming`, { kanban: true })
  }

  async function discardSelected() {
    const ids = [...sel]
    if (!ids.length) return
    let n = 0
    for (const id of ids) {
      try {
        // Ralph 2026-06-03 · WP-SCOUT-8 path-rename: spec calls this `reject`
        // (the verb on the data) — "discard" was the UI label, kept that way
        // in the deck button. REST-shaped: id in URL, body optional for reason.
        const r = await fetch(`/api/admin/crm/raw-prospects/${encodeURIComponent(id)}/reject`, {
          method: 'POST',
        })
        if (r.ok) n++
      } catch (e) { console.error('[ScoutPool] discard failed:', e) }
    }
    await load()
    setSel(new Set())
    flash(`✕ ${n} discarded`, { kill: true })
  }

  // ── Render.
  return (
    <div className="scout-pool">
      {/* Funnel pills along the top — see app/crm/scout.css .scout-funnel */}
      <div className="scout-head">
        <div className="scout-funnel">
          <span className="scout-pill"><b>{counts.total}</b> in pool</span>
          <span className="scout-arw">→</span>
          <span className="scout-pill"><b>{counts.scouted}</b> scouted</span>
          <span className="scout-pill hot">🔥 <b>{counts.hot}</b> hot</span>
          <span className="scout-pill green">◇ <b>{counts.green}</b> greenfield</span>
        </div>
      </div>

      {/* Toolbar: search + 6 filter chips with live counts + persistent
          "Run Scout" button on the right. The button takes the next 32
          raw rows IN THE CURRENT VIEW (filter-aware) and fires the Taste
          job — 32 agents in parallel, each composing capture+query+taste.
          Visible without selection so a fresh pool processes in one click. */}
      <div className="scout-tools">
        <div className="scout-search">
          🔍 <input
            placeholder="Search leads…"
            value={query}
            onChange={(e) => setQuery(e.target.value.toLowerCase().trim())}
          />
        </div>
        <div className="scout-chips">
          {([
            ['all',   'All',         counts.total],
            ['hot',   '🔥 Hot',      counts.hot],
            ['warm',  'Warm',        counts.warm],
            ['cold',  'Cold',        counts.cold],
            ['raw',   'Not scouted', counts.raw],
            ['green', 'Greenfield',  counts.green],
          ] as const).map(([f, label, c]) => (
            <span
              key={f}
              className={`scout-chip${filter === f ? ' on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {label} <span className="c">{c}</span>
            </span>
          ))}
        </div>
        {/* Ralph 2026-06-03 · single-button morph: "Run Scout (N)" when idle,
            "STOP (M in flight)" while a batch is running. STOP is the emergency
            exit when the batch hangs — it cancels the bg-job (next-row check
            sees signal.aborted) and clears local spinners immediately. */}
        <button
          type="button"
          className={`scout-run${activeJobId ? ' scout-stop' : ''}`}
          disabled={!activeJobId && nextBatch.length === 0}
          onClick={() => (activeJobId ? void stopBatch() : void runScoutBatch())}
          title={
            activeJobId
              ? `Stop the running batch (${tasting.size} in flight). Already-tasted rows stay; in-flight rows clear.`
              : nextBatch.length === 0
                ? 'No untasted rows in the current view.'
                : `Launch ${nextBatch.length} scout agents in parallel — captures + queries + Opus tasting.`
          }
        >
          {activeJobId
            ? <>⏹ <span className="lbl">STOP ({tasting.size} in flight)</span></>
            : <>◐ <span className="lbl">Run Scout (next {nextBatch.length})</span></>}
        </button>
      </div>

      <div className="scout-wrap">
        <div className="scout-selall" onClick={toggleAll}>
          <span className={`scout-chk${allShownSelected ? ' on' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          {' '}select all shown · click a card to open its dossier
        </div>
        <div className="scout-cards">
          {loading
            ? <div className="scout-empty">loading the pool…</div>
            : shown.length === 0
              ? <div className="scout-empty">no leads match this filter</div>
              : shown.map((p) => (
                  <ScoutRow
                    key={p.id}
                    p={p}
                    selected={sel.has(p.id)}
                    open={open.has(p.id)}
                    tasting={tasting.has(p.id)}
                    onToggleSelect={togSel}
                    onToggleOpen={togOpen}
                  />
                ))
          }
        </div>
      </div>

      <div className="scout-foot">
        <b>One card per lead.</b> Click a card to open its dossier · check cards
        + <b>Taste</b> to enrich raw ones · then <b>Promote</b> → the real
        Kanban · Incoming, or <b>Discard</b>.
      </div>

      <DecisionDeck
        selectedCount={sel.size}
        rawSelectedCount={rawSelected.length}
        onTaste={() => void tasteSelected()}
        onPromote={() => void promoteSelected()}
        onDiscard={() => void discardSelected()}
      />

      {toasts.length > 0 ? (
        <div className="scout-toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`scout-toast${t.kill ? ' kill' : ''}`}>
              {t.msg}
              {t.kanban ? <a onClick={onViewKanban}>View in Kanban →</a> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
