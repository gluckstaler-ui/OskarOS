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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScoutRow } from './ScoutRow'
import { DecisionDeck } from './DecisionDeck'
import { DiscoverModal, type DiscoverCriteria } from './DiscoverModal'
import { ScoutJobsOverlay, type ScoutJobView } from './ScoutJobsOverlay'
import { useSnackbar } from '@/components/SnackbarProvider'
import {
  type RawProspect, type FilterKey,
  scoutOf, stateOf, verdictToneOf, isStaleTaste, FILTER_TONE, payloadOf,
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
  // Ralph 2026-06-05 · Discover — INPUT modal only. The running job's state
  // lives here (not in the modal) so on submit the modal closes and the user
  // keeps working with the pool; progress + recent rows + Stop render in the
  // bottom-right ScoutJobsOverlay alongside Re-scrape FSP + Backfill Queried.
  const [discoverOpen, setDiscoverOpen] = useState(false)
  interface DiscoverProgressShape {
    phase: 'init' | 'harvest' | 'fetch' | 'ingest' | 'done' | 'error'
    message: string
    harvested?: number
    fetched?: number
    matched?: number
    inserted?: number
    deduped?: number
    errors?: number
    insertedIds?: string[]
    error?: string
  }
  const [discoverJobId, setDiscoverJobId] = useState<string | null>(null)
  const [discoverCriteria, setDiscoverCriteria] = useState<DiscoverCriteria | null>(null)
  const [discoverProgress, setDiscoverProgress] = useState<DiscoverProgressShape | null>(null)
  const discoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Ralph 2026-06-05 · Re-scrape FSP — backfills profile_url + Verfügbarkeit
  // on the 265 XLSX-imported FSP rows that lack those fields. Stays running
  // in the background; the row strip refreshes as rows get patched.
  const [refspJobId, setRefspJobId] = useState<string | null>(null)
  const [refspProgress, setRefspProgress] = useState<{ processed: number; total: number; updated: number; unresolved: number; insertedIds?: string[] } | null>(null)
  // Ralph 2026-06-03 · switched from a bespoke `.scout-toast-stack` to the
  // canonical SnackbarProvider used everywhere else (chat, image ops, CD
  // verdicts). One visual surface for all app-wide flashes; the per-row Scout
  // failures now ride the same stack and styling as a chat error. The provider
  // caps auto-dismiss snackbars at 8, drops the oldest first — so a 32-row
  // batch with 20 failures degrades gracefully instead of flooding the screen.
  const snackbar = useSnackbar()
  /**
   * Ralph 2026-06-03 · STOP-button pattern. Captured from the POST /scout/taste
   * response so the running button can morph "Run Scout (N)" → "STOP (M in flight)"
   * — single-button toggle. Used to call /api/mcp/cancel-job when the user wants
   * to halt a hung batch (not a true cancel; finished rows stay persisted).
   */
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  // Ralph 2026-06-05 · Backfill-queried job state. Distinct from activeJobId
  // (the Sonnet taste batch) so the two can run interleaved if needed and the
  // toolbar button stays accurate. backfillTotal is captured at fire time
  // for the in-flight label ("backfilling · 12/45").
  const [backfillJobId, setBackfillJobId] = useState<string | null>(null)
  const [backfillDone, setBackfillDone] = useState(0)
  const [backfillTotal, setBackfillTotal] = useState(0)
  // Ralph 2026-06-05 spec-review B2 — STOP must break the poll loop NOW,
  // not in up-to-8-minutes when the timeout cap fires. The poll runs inside
  // runQueriedBackfill's closure; reading `backfillJobId` directly from
  // there gives the stale value at function-entry time. A ref mirror is
  // the React-clean fix: stopBackfill flips the ref + the state at the
  // same instant, and the poll's while-condition reads the ref every tick.
  const backfillStoppedRef = useRef(false)

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

  // Ralph 2026-06-03 · flash API rewrite. The previous adapter used opaque
  // `{kill, kanban, kind}` flags that routed through a nested ternary — and
  // somewhere in there `{kill:true}` on Discard was rendering as info-blue
  // instead of error-red. The fix is to delete the abstraction: every caller
  // now passes the type LITERALLY ('info' | 'success' | 'error'), and an
  // optional `addKanbanLink` for the Promote → View in Kanban affordance.
  // Errors are sticky (duration:0); the rest auto-dismiss at 5 s.
  const flash = useCallback(
    (msg: string, type: 'info' | 'success' | 'error' = 'info', addKanbanLink = false) => {
      const actions = addKanbanLink
        ? [{ label: 'View in Kanban →', onClick: onViewKanban }]
        : undefined
      const duration = type === 'error' ? 0 : 5000
      snackbar.show(type, msg, { duration, actions })
    },
    [snackbar, onViewKanban],
  )

  // Ralph 2026-06-03 · the Region dropdown in the dossier (Edit Region) is
  // populated from the distinct `bezirk` values already in the pool — that
  // way the dropdown reflects the actual data Ralph is working with (no
  // hardcoded 150-bezirk Swiss canton list). Sorted alphabetically so the
  // <select> is scannable; the dossier still allows a custom value when
  // the bezirk doesn't exist yet (a fresh import). Falls back to `region`
  // for imports that use that key instead of `bezirk`.
  const availableRegions = useMemo(() => {
    const set = new Set<string>()
    for (const p of pool) {
      try {
        const pl = JSON.parse(p.raw_payload || '{}') as Record<string, unknown>
        const r = (pl.bezirk ?? pl.region)
        if (typeof r === 'string' && r.trim()) set.add(r.trim())
      } catch { /* skip malformed payloads */ }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'de'))
  }, [pool])

  // ── Funnel counts: total · scouted · per verdict TONE · ◇ greenfield.
  //    Counts is a memo because the filter chips also display per-chip counts
  //    that need to stay in sync as the pool changes. Ralph 2026-06-10 —
  //    heat bands retired; counts key off the stored four-value tone (tags
  //    are the Consular's free text and can't be enumerated).
  const counts = useMemo(() => {
    let scouted = 0, persue = 0, warming = 0, watch = 0, skip = 0, green = 0, raw = 0, stale = 0
    for (const p of pool) {
      const s = stateOf(p)
      if (s === 'greenfield') green++
      else if (s === 'scouted') {
        scouted++
        const t = scoutOf(p).taste ?? {}
        // Stale era (Ralph 2026-06-11): tasted pre-redesign — old keys only,
        // none of the unified fields in the blob. Counted separately so the
        // upgrade backlog is visible; they still tone-bucket via legacy maps.
        if (isStaleTaste(t)) stale++
        const vt = verdictToneOf(t)
        if (vt === 'good') persue++
        else if (vt === 'mid') warming++
        else if (vt === 'low') watch++
        else if (vt === 'bad') skip++
      } else raw++
    }
    return { scouted, persue, warming, watch, skip, green, raw, stale, total: pool.length }
  }, [pool])

  // Ralph 2026-06-05 · Gemeinschaftspraxis flag per row. Two-tier signal:
  //   STRONG: ≥2 pool rows share the same website domain → confirmed shared
  //           practice (most reliable signal — N members already in the pool)
  //   SOFT:   only 1 row at the domain BUT the imported text (raw_payload.typ
  //           / company / name) carries "Gemeinschaft / Praxisgem / Gruppen /
  //           Kollektiv / Therapiezentrum / familienpraxis / *-team" — likely
  //           shared but we only have one member in the pool right now
  // The result feeds ScoutRow's header chip (so Ralph can scan the list and
  // see at a glance which rows belong to multi-practitioner sites).
  const sharedPractice = useMemo(() => {
    const TEXT_RE = /\b(gemeinschaft|praxisgemein|gruppenpraxis|kollektiv|therapiezentrum|gemeinsam|teamprax|praxen?team|familienpraxis|psy[- ]?team)\b/i
    const domainCount = new Map<string, number>()
    for (const p of pool) {
      const d = (p.website || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(/\s/)[0]
      if (d && d.includes('.')) domainCount.set(d, (domainCount.get(d) || 0) + 1)
    }
    const flag = new Map<string, { tier: 'strong' | 'soft'; count: number }>()
    for (const p of pool) {
      const d = (p.website || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(/\s/)[0]
      const n = d && d.includes('.') ? (domainCount.get(d) || 0) : 0
      if (n >= 2) {
        flag.set(p.id, { tier: 'strong', count: n })
        continue
      }
      // Soft signal — text-only. Searches typ/titel/company/name/quelle.
      const pl = payloadOf(p)
      const hay = [p.name, p.company, p.industry, pl.typ, pl.titel, pl.quelle]
        .filter(Boolean).join(' ')
      if (TEXT_RE.test(hay)) {
        flag.set(p.id, { tier: 'soft', count: 1 })
      }
    }
    return flag
  }, [pool])


  // ── Filter + search.
  const shown = useMemo(() => pool.filter((p) => {
    const s = stateOf(p)
    if (filter === 'raw' && s !== 'raw') return false
    if (filter === 'green' && s !== 'greenfield') return false
    // Ralph 2026-06-03 · 'scouted' filter = any row with scanned_at, regardless
    // of heat band. Backs the "124 scouted" funnel pill — clicking shows
    // every tasted row (hot + warm + cold + failed) in one view, instead of
    // forcing the user to flip through 3 heat chips to see them all.
    if (filter === 'scouted' && s !== 'scouted') return false
    // Stale-era filter (Ralph 2026-06-11) — rows tasted under the old
    // contract; the upgrade path is select-all → Taste.
    if (filter === 'stale' && !(s === 'scouted' && isStaleTaste(scoutOf(p).taste ?? {}))) return false
    // Tone filters (Ralph 2026-06-10) — chips key off the stored four-value
    // tone (tags are the Consular's free text); legacy rows read-map their
    // heat so old pools keep filtering sensibly without a re-taste.
    if (filter in FILTER_TONE) {
      if (s !== 'scouted') return false
      if (verdictToneOf(scoutOf(p).taste ?? {}) !== FILTER_TONE[filter]) return false
    }
    if (query) {
      // Ralph 2026-06-03 — the search hay-stack now ALSO includes the
      // imported raw_payload fields (adresse / bezirk / typ / region) and
      // the top-level country/phone/email. The original hay was just
      // name+company+website+industry, which meant "zurich" or "8001"
      // returned ZERO matches even though the regional info was right there
      // in raw_payload.bezirk='Zürich'. The pool now searches every visible
      // field the user can see on the row, lowercased.
      const pl = payloadOf(p)
      const hay = [
        p.name, p.company, p.website, p.industry, p.country, p.phone, p.email,
        pl.adresse, pl.bezirk, pl.region, pl.typ, pl.titel, pl.quelle,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(query.trim())) return false
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

  // The subset of selected ids that are TASTABLE: raw rows AND stale-era
  // scouted rows (tasted pre-redesign — old keys only; a re-taste upgrades
  // them to the unified contract; Ralph 2026-06-11). Greenfield and
  // current-contract rows are skipped — the deck count reflects that.
  const rawSelected = useMemo(() => {
    return [...sel].filter((id) => {
      const p = pool.find((x) => x.id === id)
      if (!p || !p.website) return false
      const sc = scoutOf(p)
      return !sc.scanned_at || isStaleTaste(sc.taste ?? {})
    })
  }, [sel, pool])

  // The subset of selected rows that have a website — the Consular can
  // research these (greenfield rows have no site to read). Research deepens
  // a row whether or not jedi-scout already tasted it. Ralph 2026-06-10.
  const researchSelected = useMemo(() => {
    return [...sel]
      .map((id) => pool.find((x) => x.id === id))
      .filter((p): p is RawProspect => !!p && !!p.website)
      .map((p) => ({ id: p.id, name: p.company || p.name || p.website }))
  }, [sel, pool])

  // ── Actions.

  // Ralph 2026-06-03: the Taste route enqueues a background job and returns
  // immediately with `{job, deduped}`. Awaiting only the POST would clear
  // the tasting state before any row finished. Poll the pool every 3s
  // until every fired id has `scanned_at` (the scout_json's "this row was
  // tasted" stamp) or POLL_TIMEOUT_MS have passed.
  //
  // Ralph 2026-06-03 (post-mortem). The earlier 6-min budget was set under
  // the assumption "32 rows ~25-45s parallel" — wrong on two counts:
  // (a) the server now caps capture concurrency at 6 to avoid Chromium
  //     starvation (which was killing 24/32 rows with timeout-after-60s),
  // (b) callScoutBridge serializes bridge calls per `__scout__` session
  //     via withSessionLock — so 32 × ~12s Sonnet tastes = ~6.5 min on
  //     their own, ignoring capture time entirely.
  // Realistic worst-case end-to-end: ~10 min (cap-6 captures overlapping
  // with serial bridge). 10 min cap leaves headroom without making STOP
  // feel sluggish. Polling cost is cheap (one HTTP every 3s).
  const POLL_INTERVAL_MS = 3_000
  // Ralph 2026-06-05 · bumped 10 → 20 min so the client doesn't give up
   // mid-batch when slow sites use the full 3 min server budget.
  const POLL_TIMEOUT_MS  = 20 * 60_000
  /**
   * Poll the pool until every fired raw id has a scanned_at, then return the
   * per-row breakdown for the post-batch snackbar:
   *   succeeded — a verdict tag landed (legacy rows: palate non-null)
   *   failed    — capture failed / outer catch / scan landed without a verdict
   *   pending   — never landed within the timeout (or after a STOP)
   */
  const pollUntilTasted = useCallback(
    // `sinceIso` (Ralph 2026-06-11): a row counts as LANDED only when its
    // scanned_at is fresher than the batch fire time. Stale-era rows being
    // re-tasted already carry an old scanned_at — without the baseline they
    // read as instantly done and the spinner/tally lie.
    async (rawIds: string[], sinceIso: string): Promise<{ total: number; succeeded: number; failed: number; pending: number }> => {
      const started = Date.now()
      const remaining = new Set(rawIds)
      const landed = (p: RawProspect): boolean => {
        const sa = scoutOf(p).scanned_at
        return !!sa && sa >= sinceIso
      }
      let lastFresh: RawProspect[] = []
      while (remaining.size > 0 && Date.now() - started < POLL_TIMEOUT_MS) {
        try {
          const r = await fetch('/api/admin/crm/scout/pool', { cache: 'no-store' })
          const j = (await r.json()) as { pool?: RawProspect[] }
          const fresh = j.pool ?? []
          lastFresh = fresh
          setPool(fresh)
          for (const p of fresh) {
            if (remaining.has(p.id) && landed(p)) {
              // Row landed — drop it from tasting + remaining sets.
              remaining.delete(p.id)
              setTasting((s) => { const n = new Set(s); n.delete(p.id); return n })
              // Ralph 2026-06-03 · per-row failure snackbar. Fires the moment
              // the row's scout_json lands with a failure verdict — so the
              // user can SEE which lead broke (and how) while the batch is
              // still streaming, not just a summary count at the end.
              // Ralph 2026-06-11 fix — success/failure keyed off the UNIFIED
              // contract: a row succeeded iff a verdict tag landed (legacy
              // rows: palate). The old `palate == null` test marked EVERY
              // new-contract success as a failure and toasted ✕ for good rows.
              const s = scoutOf(p)
              const tasteOk = s.taste?.verdict_tag != null || typeof s.taste?.palate === 'number'
              const isFailure = s.failed === true || !tasteOk
              if (isFailure) {
                const v = String(s.taste?.verdict_subline ?? s.taste?.verdict ?? '')
                // Categorise the failure for the toast prefix, but ALSO
                // include the raw reason so Ralph can see exactly what
                // Chromium reported. Without the raw tail, the toast
                // collapses every different failure into "capture failed"
                // and you can't tell "cert expired" from "Cloudflare 403"
                // from "Navigation timeout 30s". (Ralph 2026-06-05)
                let mode = 'failed'
                let detail = ''
                if (v.startsWith('capture failed: ')) {
                  const tail = v.slice('capture failed: '.length)
                  if (tail.startsWith('timeout'))               mode = 'capture timeout'
                  else if (tail.startsWith('DNS') || tail.startsWith('net::ERR_NAME')) mode = 'DNS unresolved'
                  else if (tail.startsWith('net::ERR_CERT'))    mode = 'SSL cert invalid'
                  else if (tail.startsWith('net::ERR_CONNECTION_REFUSED')) mode = 'connection refused'
                  else if (tail.startsWith('net::ERR_CONNECTION_RESET'))   mode = 'connection reset'
                  else if (tail.startsWith('net::ERR_TUNNEL'))   mode = 'proxy/tunnel failed'
                  else if (tail.startsWith('net::ERR_ABORTED')) mode = 'load aborted'
                  else if (tail.startsWith('Navigation timeout')) mode = 'navigation timeout'
                  else if (tail.startsWith('SSRF'))             mode = 'SSRF blocked'
                  else                                          mode = 'capture failed'
                  // Truncated raw reason for visibility — first 80 chars
                  // (snackbars wrap; longer than that gets cut off anyway).
                  detail = tail.length > 80 ? tail.slice(0, 77) + '…' : tail
                } else if (v.includes('did not submit a verdict')) {
                  mode = 'no verdict from agent'
                }
                const label = (p.company || p.name || p.website || p.id).slice(0, 36)
                flash(detail ? `✕ ${label} · ${mode} (${detail})` : `✕ ${label} · ${mode}`, 'error')
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
        if (!s.scanned_at || s.scanned_at < sinceIso) { pending++; continue }
        // Unified contract: success = a verdict tag landed (legacy: palate).
        const tasteOk = s.taste?.verdict_tag != null || typeof s.taste?.palate === 'number'
        if (s.failed === true || !tasteOk) { failed++; continue }
        succeeded++
      }
      return { total: rawIds.length, succeeded, failed, pending }
    },
    // `flash` is itself a stable useCallback ([], no closures over render
    // state), but we list it for hook-deps hygiene.
    [flash],
  )

  // Rehydrate in-flight taste state after a reload (Ralph 2026-06-11 — the
  // per-row spinner died on hard-refresh because `tasting` is client state;
  // the escrow job knows the truth). On mount: adopt any running scout_taste
  // job — STOP morph + per-row spinners — and resume the pool poll so rows
  // clear as they land. Runs once; tasteSelected/runScoutBatch own the
  // fresh-fire path as before.
  const rehydratedRef = useRef(false)
  useEffect(() => {
    if (rehydratedRef.current) return
    rehydratedRef.current = true
    void (async () => {
      try {
        const r = await fetch('/api/mcp/job-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: '__scout__' }),
        })
        const j = (await r.json()) as { jobs?: Array<{ jobId?: string; kind?: string; status?: string; target?: string }> }
        const running = (j.jobs ?? []).find((x) => x.kind === 'scout_taste' && x.status === 'running')
        if (!running?.jobId || !running.target) return
        const ids = running.target.split(',').map((s) => s.trim()).filter(Boolean)
        if (!ids.length) return
        setActiveJobId(running.jobId)
        setTasting((s) => new Set([...s, ...ids]))
        // Freshness baseline = the job's own start time (server clock).
        await pollUntilTasted(ids, (running as { startedAt?: string }).startedAt ?? '')
      } catch (e) {
        console.warn('[ScoutPool] taste rehydration failed:', e)
      }
    })()
  }, [pollUntilTasted])

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
    cli:  'claude-sonnet-4-6',       // bare — 1M verified at runtime by the bridge re-roll
    api:  'claude-sonnet-4-6',       // Anthropic API model id
  }
  const readMode = (): { mode: ExecutionMode; model: string } => {
    if (typeof window === 'undefined') return { mode: 'cli', model: SCOUT_MODE_DEFAULTS.cli }
    const saved = window.localStorage.getItem('oskar_billing_mode')
    const mode: ExecutionMode =
      saved === 'smpl' || saved === 'cli' || saved === 'api' ? saved : 'cli'
    return { mode, model: SCOUT_MODE_DEFAULTS[mode] }
  }

  // Re-scrape FSP runner (Ralph 2026-06-05). Walks pool rows with quelle=
  // "FSP-PsyFinder" or source=scrape:fsp that lack profile_url/availability,
  // resolves their canonical FSP slugs, fetches each profile, and merges
  // the new fields. Progress polls the same store as Discover.
  async function runRefspBackfill() {
    if (refspJobId) return                          // already in flight
    try {
      const r = await fetch('/api/admin/crm/scout/refsp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ concurrency: 32 }),
      })
      const j = (await r.json()) as { job?: { jobId?: string }; error?: string }
      if (!j.job?.jobId) {
        flash(`✕ refsp failed: ${j.error ?? 'no jobId'}`, 'error')
        return
      }
      const id = j.job.jobId
      setRefspJobId(id)
      flash('↺ refreshing FSP rows…', 'info')
      // Poll progress every 1.5s — same shape as DiscoverModal's poll.
      const timer = setInterval(async () => {
        try {
          const pr = await fetch(`/api/admin/crm/scout/discover/progress?jobId=${id}`)
          if (!pr.ok) return
          const pj = (await pr.json()) as { progress?: {
            phase?: string; fetched?: number; harvested?: number; inserted?: number; deduped?: number
          } }
          const p = pj.progress as ({
            phase?: string; fetched?: number; harvested?: number; inserted?: number; deduped?: number;
            insertedIds?: string[]
          } | undefined)
          if (!p) return
          setRefspProgress({
            processed: p.fetched ?? 0,
            total: p.harvested ?? 0,
            updated: p.inserted ?? 0,
            unresolved: p.deduped ?? 0,
            insertedIds: p.insertedIds,
          })
          // Reload pool incrementally so the user sees rows backfill in place.
          if ((p.inserted ?? 0) > 0) void load()
          if (p.phase === 'done' || p.phase === 'error') {
            clearInterval(timer)
            setRefspJobId(null)
            setRefspProgress(null)
            if (p.phase === 'done') {
              flash(`↺ FSP refresh complete · ${p.inserted ?? 0} updated · ${p.deduped ?? 0} unresolved`, 'success')
            } else {
              flash(`✕ FSP refresh failed`, 'error')
            }
            void load()
          }
        } catch { /* transient blip; next tick will retry */ }
      }, 1500)
    } catch (e) {
      flash(`✕ refsp failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  async function stopRefspBackfill() {
    const id = refspJobId
    if (!id) return
    setRefspJobId(null)
    setRefspProgress(null)
    flash('⏹ FSP refresh stop requested', 'info')
    try {
      await fetch('/api/mcp/cancel-job', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: id, sessionId: '__scout__' }),
      })
    } catch { /* runner sees signal.aborted on next checkpoint */ }
  }

  // Ralph 2026-06-05 · Discover runner — kicked off from the modal's onStart
  // callback. Modal closes immediately; the running job's progress + recent
  // rows + Stop button live in ScoutJobsOverlay. Polls every 1.5 s, reloads
  // the pool on inserts so the user sees new rows arrive in the list.
  async function startDiscover(register: string, criteria: DiscoverCriteria) {
    if (discoverJobId) return
    try {
      const r = await fetch('/api/admin/crm/scout/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ register, criteria }),
      })
      const j = (await r.json()) as { job?: { jobId?: string }; error?: string }
      if (!j.job?.jobId) {
        flash(`✕ discover failed: ${j.error ?? 'no jobId'}`, 'error')
        return
      }
      const id = j.job.jobId
      setDiscoverJobId(id)
      setDiscoverCriteria(criteria)
      setDiscoverProgress({ phase: 'init', message: 'Starting…' })
      flash(`✛ discover started · ${formatCriteria(criteria)}`, 'info')
      if (discoverPollRef.current) clearInterval(discoverPollRef.current)
      discoverPollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(`/api/admin/crm/scout/discover/progress?jobId=${id}`)
          if (!pr.ok) return
          const pj = (await pr.json()) as { progress?: DiscoverProgressShape }
          const p = pj.progress
          if (!p) return
          setDiscoverProgress(p)
          if ((p.inserted ?? 0) > (discoverProgress?.inserted ?? 0)) {
            // Mid-run pool reload so the new R### rows render in the list.
            void load()
          }
          if (p.phase === 'done' || p.phase === 'error') {
            if (discoverPollRef.current) { clearInterval(discoverPollRef.current); discoverPollRef.current = null }
            setDiscoverJobId(null)
            if (p.phase === 'done') {
              flash(`✛ discover complete · ${p.inserted ?? 0} new · ${p.deduped ?? 0} dup`, 'success')
            } else {
              flash(`✕ discover failed: ${p.error ?? 'unknown'}`, 'error')
            }
            void load()
          }
        } catch { /* transient — next tick retries */ }
      }, 1500)
    } catch (e) {
      flash(`✕ discover failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  async function stopDiscover() {
    const id = discoverJobId
    if (!id) return
    if (discoverPollRef.current) { clearInterval(discoverPollRef.current); discoverPollRef.current = null }
    setDiscoverJobId(null)
    flash('⏹ discover stop requested', 'info')
    try {
      await fetch('/api/mcp/cancel-job', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: id, sessionId: '__scout__' }),
      })
    } catch { /* runner sees signal.aborted on next checkpoint */ }
  }

  // Small util — compose a human-readable filter summary for the overlay header.
  function formatCriteria(c: DiscoverCriteria): string {
    const parts: string[] = []
    if (c.ort) parts.push(c.ort)
    if (c.canton) parts.push(c.canton)
    if (c.plz) parts.push(`PLZ ${c.plz}`)
    if (c.specialty) parts.push(c.specialty)
    if (c.language) parts.push(c.language)
    if (c.limit) parts.push(`limit ${c.limit}`)
    return parts.length ? parts.join(' · ') : 'all of FSP'
  }

  // Cleanup on unmount — clear the discover poll so a remount doesn't double-tick.
  useEffect(() => () => {
    if (discoverPollRef.current) clearInterval(discoverPollRef.current)
  }, [])

  // Ralph 2026-06-05 · Backfill the 9 ◐ Queried lamps for every pool row
  // missing data (no Sonnet taste, no capture — just the cheap HTTP signals:
  // DNS / Wayback / PageSpeed / static-HTML detectors). Re-fetch failed
  // lamps too per Ralph's policy ("fill empty + retry failed"). Polls the
  // pool counting completions via the scout_json.queried.__queried_at
  // stamp the server writes per row; exits when every fired id has
  // landed (or 8 min cap, or STOP).
  async function runQueriedBackfill() {
    if (backfillJobId) return
    // Reset the STOP signal at the start of every run (B2). A prior run that
    // ended via STOP would otherwise leave the ref true and short-circuit
    // the next run on its first poll tick.
    backfillStoppedRef.current = false
    try {
      const r = await fetch('/api/admin/crm/scout/backfill-queried', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopeAll: true, concurrency: 32 }),
      })
      const j = (await r.json()) as { job?: { jobId?: string }; pickedIds?: string[]; error?: string }
      if (!j.job?.jobId) {
        flash(`✕ backfill failed: ${j.error ?? 'no jobId'}`, 'error')
        return
      }
      const jobId = j.job.jobId
      const totalPicked = (j.pickedIds ?? []).length
      setBackfillJobId(jobId)
      setBackfillTotal(totalPicked)
      setBackfillDone(0)
      if (totalPicked === 0) {
        flash('◐ nothing to backfill — every row has its lamps', 'info')
        setBackfillJobId(null)
        return
      }
      flash(`◐ backfilling queried lamps · ${totalPicked} rows`, 'info')

      // Ralph 2026-06-05 spec-review M-iii — poll the PURPOSE-BUILT status
      // endpoint, not the full pool. ~50 bytes/row × 200 rows = ~10KB/tick
      // instead of ~150KB. Adaptive timeout (L-iv): 8 min floor, plus 30s
      // per worker-slot worth of rows so a slow PSI day on a 200-row batch
      // doesn't bail prematurely.
      const POLL_MS = 3_000
      const TIMEOUT_MS = Math.max(8 * 60_000, Math.ceil(totalPicked / 6) * 30_000)
      const started = Date.now()

      // Per-row results — populated incrementally as the status endpoint
      // returns them. Used for the L-ii lamp-level final snackbar.
      interface RowRes {
        id: string
        status: 'filled' | 'skipped' | 'failed' | 'cancelled'
        filledLamps?: string[]
        reason?: string
      }
      let lastProcessed = 0
      let finalPerRow: RowRes[] = []
      let finalLampsFilled = 0
      let terminal: 'complete' | 'cancelled' | 'failed' | 'stuck' | null = null
      // Cadence: refresh the visible pool only when new rows landed since the
      // previous tick (cheap signal that fresh lamps are persisted in SQLite).
      // Avoids hammering /scout/pool every 3s on a slow-PSI day where nothing
      // visible changed between ticks.
      while (
        Date.now() - started < TIMEOUT_MS &&
        !backfillStoppedRef.current
      ) {
        await new Promise((res) => setTimeout(res, POLL_MS))
        if (backfillStoppedRef.current) break
        try {
          const sr = await fetch(`/api/admin/crm/scout/backfill-queried/status?jobId=${jobId}`, { cache: 'no-store' })
          if (!sr.ok) continue        // transient — try the next tick
          const sj = (await sr.json()) as {
            progress?: {
              processed?: number
              total?: number
              perRow?: RowRes[]
              lampsFilled?: number
              finishedAt?: string
              jobStatus?: 'running' | 'complete' | 'cancelled' | 'failed' | 'stuck'
            }
          }
          const p = sj.progress
          if (!p) continue
          const processed = p.processed ?? 0
          if (processed !== lastProcessed) {
            setBackfillDone(processed)
            void load()   // refresh visible lamps — only on actual progress
            lastProcessed = processed
          }
          finalPerRow = p.perRow ?? []
          finalLampsFilled = p.lampsFilled ?? 0
          if (p.finishedAt) {
            terminal = (p.jobStatus ?? 'complete') as typeof terminal
            break
          }
        } catch { /* transient network blip; next tick retries */ }
      }

      // STOP path: stopBackfill already cleared backfillJobId + flashed the
      // toast; we just exit without overwriting its state.
      if (backfillStoppedRef.current) {
        void load()
        return
      }

      setBackfillJobId(null)

      // L-ii — surface the lamp-level breakdown the runner already computes.
      // "✓ 28 rows · 234 lamps filled · 5 had nothing to fill · 1 failed"
      // beats "✓ 28 rows refreshed". The runner-side console.log keeps the
      // same shape so dev logs and user toasts agree.
      const cFilled  = finalPerRow.filter(r => r.status === 'filled').length
      const cSkipped = finalPerRow.filter(r => r.status === 'skipped').length
      const cFailed  = finalPerRow.filter(r => r.status === 'failed').length
      if (terminal === 'complete') {
        const bits: string[] = []
        bits.push(`${cFilled} row${cFilled === 1 ? '' : 's'} filled`)
        bits.push(`${finalLampsFilled} lamp${finalLampsFilled === 1 ? '' : 's'}`)
        if (cSkipped) bits.push(`${cSkipped} nothing to fill`)
        if (cFailed)  bits.push(`${cFailed} failed`)
        flash(`✓ queried backfill · ${bits.join(' · ')}`, 'success')
      } else if (terminal === 'failed') {
        flash(`✕ queried backfill failed mid-run`, 'error')
      } else {
        // Timeout-without-finish (rare) — show partial progress.
        flash(`◐ queried backfill ended · ${lastProcessed}/${totalPicked} processed`, 'info')
      }
      void load()
    } catch (e) {
      setBackfillJobId(null)
      flash(`✕ backfill failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  async function stopBackfill() {
    const id = backfillJobId
    if (!id) return
    // B2 — flip the ref + clear state IMMEDIATELY so the UI exits the
    // running state on click instead of after up to 8 minutes. The poll
    // loop in runQueriedBackfill reads the ref each tick (and once after
    // its sleep) and bails on next observation.
    backfillStoppedRef.current = true
    setBackfillJobId(null)
    flash('⏹ backfill stop requested', 'info')
    try {
      // B3 — include sessionId in the cancel-job body. The /api/mcp/cancel-job
      // route mirrors job-status and requires both fields; taste's stopBatch
      // sends both, this path was missing it (silent reject otherwise).
      await fetch('/api/mcp/cancel-job', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: id, sessionId: '__scout__' }),
      })
    } catch (e) {
      flash(`✕ stop failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  async function tasteSelected() {
    const rawIds = rawSelected
    if (!rawIds.length) return
    // Freshness baseline minus a 60s clock-skew cushion — stale-era rows in
    // the batch carry an OLD scanned_at; only a write newer than this counts.
    const since = new Date(Date.now() - 60_000).toISOString()
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
    await pollUntilTasted(rawIds, since)
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
  // Ralph 2026-06-03 · also expose the FULL pool's raw count so the button
  // label can disambiguate "6 in view because of filter" from "6 left in the
  // whole pool". Without this the user thinks the worker pool is exhausted
  // when it's really the search/filter narrowing what's visible.
  const totalRawAvailable = useMemo(
    () => pool.filter((p) => stateOf(p) === 'raw' && !tasting.has(p.id)).length,
    [pool, tasting],
  )

  // Ralph 2026-06-05 · Queried-backfill candidacy. A row qualifies when it
  // has a website AND at least one of the 9 queried lamps is null / '' /
  // starts with 'failed'. Mirror of the server's `rowNeedsBackfill`.
  // Count is across the WHOLE pool (not filtered) — backfill is a global
  // hygiene op, not a view-scoped action. The button label shows the total
  // so the user can fire it from any view.
  const QUERIED_LAMPS: Array<keyof NonNullable<ReturnType<typeof scoutOf>['queried']>> =
    ['age', 'stack', 'hosting', 'performance', 'seo', 'traffic', 'trackers', 'booking', 'languages']
  const totalNeedsBackfill = useMemo(() => {
    let n = 0
    for (const p of pool) {
      if (!p.website || !p.website.trim()) continue
      const q = scoutOf(p).queried || {}
      for (const k of QUERIED_LAMPS) {
        const v = q[k as string]
        if (v === null || v === undefined) { n++; break }
        if (typeof v !== 'string') continue
        const s = v.trim()
        if (s === '' || s.toLowerCase().startsWith('failed')) { n++; break }
      }
    }
    return n
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool])

  async function runScoutBatch() {
    if (nextBatch.length === 0) return
    const rawIds = nextBatch
    const since = new Date(Date.now() - 60_000).toISOString()
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
    const stats = await pollUntilTasted(rawIds, since)
    setActiveJobId(null)
    // Snackbar at end. Green = "everything Opus-tasted"; red = "any failure
    // or any row still pending (STOP/timeout left work undone)".
    if (stats.failed === 0 && stats.pending === 0) {
      flash(`✓ scouted ${stats.succeeded}/${stats.total}`, 'success')
    } else {
      const parts: string[] = []
      if (stats.succeeded > 0) parts.push(`${stats.succeeded} ok`)
      if (stats.failed > 0)    parts.push(`${stats.failed} failed`)
      if (stats.pending > 0)   parts.push(`${stats.pending} stopped`)
      flash(`✕ taste batch: ${parts.join(' · ')} (of ${stats.total})`, 'error')
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

  // Hand the selected website-having rows to the Consular for the cold-lead
  // teardown (WP-23). One POST carries the batch; the route fans out one
  // escrow job per row and the Consular works through them FIFO on its
  // session lock. Findings land on each row's scout_json — the snackbars
  // (the Consular's voice on this chatless screen) report progress. Ralph
  // 2026-06-10.
  async function researchSelectedRows() {
    const items = researchSelected
    if (!items.length) return
    flash(`◎ handing ${items.length} to the Consular for research…`)
    try {
      await fetch('/api/admin/crm/consular/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items, surface: 'scout' }),
      })
    } catch (e) {
      console.error('[ScoutPool] research failed:', e)
      flash('research request failed', 'error', true)
    }
    setSel(new Set())
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
    flash(`→ ${n} promoted to Incoming`, 'success', true)
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
    // Ralph 2026-06-04 · discard is info (blue, auto-dismiss), not error
    // (red, sticky). Discarding a row is a neutral confirmation — it's an
    // intentional user action, not a failure. Sticky-red was reserved for
    // capture failures and other things the user needs to actually review.
    flash(`✕ ${n} discarded`, 'info')
  }

  // ── Job-view composition for the ambient overlay ────────────────────────
  // Each in-flight job becomes one ScoutJobView. The "recent" list pulls row
  // names from the latest pool snapshot — server-side per-row event streams
  // would be nicer (more granular) but this gets us "Sonja Blumenthal · …"
  // visibility today without a backend change.
  //
  // Backfill Queried polls its own status endpoint and tracks perRow.
  // We refresh its recent-row preview by reading the local pool to map ids → names.
  const [backfillRecent, setBackfillRecent] = useState<Array<{ id: string; name: string; detail?: string }>>([])
  useEffect(() => {
    if (!backfillJobId) { setBackfillRecent([]); return }
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`/api/admin/crm/scout/backfill-queried/status?jobId=${backfillJobId}`, { cache: 'no-store' })
        if (!r.ok) return
        const j = (await r.json()) as { progress?: { perRow?: Array<{ id: string; status: string; filledLamps?: string[]; reason?: string }> } }
        const perRow = j.progress?.perRow ?? []
        // Show the LAST 5, freshest first.
        const tail = perRow.slice(-5).reverse()
        setBackfillRecent(tail.map((r) => {
          const row = pool.find((p) => p.id === r.id)
          const name = row?.name || row?.company || r.id
          let detail = ''
          if (r.status === 'filled')   detail = (r.filledLamps?.length ?? 0) > 0 ? `+${(r.filledLamps as string[]).join(', ')}` : 'no new data'
          if (r.status === 'skipped')  detail = 'already filled'
          if (r.status === 'failed')   detail = `failed${r.reason ? ': ' + r.reason.slice(0, 40) : ''}`
          if (r.status === 'cancelled') detail = 'cancelled'
          return { id: r.id, name, detail }
        }))
      } catch { /* transient */ }
    }, 2500)
    return () => clearInterval(interval)
  }, [backfillJobId, pool])

  const scoutJobs: ScoutJobView[] = useMemo(() => {
    const out: ScoutJobView[] = []

    // Discover ─────────────────────────────────────────────────────────
    // Ralph 2026-06-05 — recent list now reads from `recentLeads` (server-
    // tracked per-lead outcomes: inserted / duplicate / failed). Full feed,
    // no cap; the overlay's container scrolls when long.
    if (discoverJobId && discoverProgress) {
      const p = discoverProgress as typeof discoverProgress & {
        recentLeads?: Array<{ id?: string; name: string; status?: 'inserted'|'duplicate'|'failed'; reason?: string; detail?: string }>
      }
      const recent = (p.recentLeads ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        reason: e.reason,
        detail: e.detail,
      }))
      // Sublabel shows the running totals so the user knows what's been
      // happening even before scrolling the activity feed.
      const inserted = p.inserted ?? 0
      const deduped = p.deduped ?? 0
      const matched = p.matched ?? 0
      const subParts: string[] = []
      if (discoverCriteria) subParts.push(formatCriteria(discoverCriteria))
      subParts.push(`${matched} matched`)
      subParts.push(`${inserted} new`)
      if (deduped) subParts.push(`${deduped} already known`)
      out.push({
        jobId: discoverJobId,
        kind: 'discover',
        label: 'Discover',
        sublabel: subParts.join(' · '),
        processed: p.fetched ?? 0,
        total: p.harvested ?? 0,
        phase: p.message || p.phase,
        recent,
        onStop: () => void stopDiscover(),
      })
    }

    // Re-scrape FSP ────────────────────────────────────────────────────
    if (refspJobId && refspProgress) {
      // refsp still uses the older insertedIds list — full set, not slice(-5).
      const recentNames = (refspProgress.insertedIds ?? []).slice().reverse().map((id) => {
        const row = pool.find((r) => r.id === id)
        return { id, name: row?.name || row?.company || id, status: 'inserted' as const }
      })
      out.push({
        jobId: refspJobId,
        kind: 'refsp',
        label: 'Re-scrape FSP',
        sublabel: `${refspProgress.updated} updated · ${refspProgress.unresolved} unresolved`,
        processed: refspProgress.processed,
        total: refspProgress.total,
        phase: `Processed ${refspProgress.processed} / ${refspProgress.total}`,
        recent: recentNames,
        onStop: () => void stopRefspBackfill(),
      })
    }

    // Backfill Queried ──────────────────────────────────────────────────
    if (backfillJobId) {
      out.push({
        jobId: backfillJobId,
        kind: 'backfill',
        label: 'Backfill Queried',
        sublabel: `${backfillDone} / ${backfillTotal} rows`,
        processed: backfillDone,
        total: backfillTotal,
        phase: `Filling ◐ lamps · concurrency 6`,
        recent: backfillRecent,
        onStop: () => void stopBackfill(),
      })
    }

    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    discoverJobId, discoverProgress, discoverCriteria,
    refspJobId, refspProgress,
    backfillJobId, backfillDone, backfillTotal, backfillRecent,
    pool,
  ])

  // ── Render.
  return (
    <div className="scout-pool">
      {/* Funnel pills along the top — Ralph 2026-06-03 · clickable filters.
          Each pill maps to a FilterKey; clicking applies the filter, clicking
          again ('on' state) toggles back to 'all'. The same FilterKey set
          drives the chip strip below — both surfaces share the `filter`
          state so a click in either updates both. */}
      <div className="scout-head">
        <div className="scout-funnel">
          <button
            type="button"
            className={`scout-pill clickable${filter === 'all' ? ' on' : ''}`}
            onClick={() => setFilter('all')}
            title="Show every row in the pool"
          ><b>{counts.total}</b> in pool</button>
          <span className="scout-arw">→</span>
          <button
            type="button"
            className={`scout-pill clickable${filter === 'scouted' ? ' on' : ''}`}
            onClick={() => setFilter(filter === 'scouted' ? 'all' : 'scouted')}
            title="Show only tasted rows (every verdict tag + failed)"
          ><b>{counts.scouted}</b> scouted</button>
          <button
            type="button"
            className={`scout-pill clickable hot${filter === 'persue' ? ' on' : ''}`}
            onClick={() => setFilter(filter === 'persue' ? 'all' : 'persue')}
            title="Show only PERSUE rows (verdict tag — green, go now)"
          ><b>{counts.persue}</b> persue</button>
          <button
            type="button"
            className={`scout-pill clickable green${filter === 'green' ? ' on' : ''}`}
            onClick={() => setFilter(filter === 'green' ? 'all' : 'green')}
            title="Show only greenfield rows (no website)"
          >◇ <b>{counts.green}</b> greenfield</button>
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
            onChange={(e) => setQuery(e.target.value.toLowerCase())}
          />
        </div>
        <div className="scout-chips">
          {([
            ['all',     'All',         counts.total],
            ['persue',  'Persue',      counts.persue],
            ['warming', 'Warming up',  counts.warming],
            ['watch',   'Watch',       counts.watch],
            ['skip',    'Skip',        counts.skip],
            ['stale',   'Stale taste', counts.stale],
            ['raw',     'Not scouted', counts.raw],
            ['green',   'Greenfield',  counts.green],
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
        {/* Ralph 2026-06-05 · "+ Discover" button — opens the directory-
            scraper modal so the user can populate the pool from official
            registers (FSP psyfinder first). Sits between the filter chips
            and the Run Scout button; the natural left-to-right flow is
            Discover → Run Scout → Promote. */}
        <button
          type="button"
          className="scout-discover-btn"
          onClick={() => setDiscoverOpen(true)}
          title="Add fresh leads from an official register (FSP, …)"
        >
          ✛ <span className="lbl">Discover</span>
        </button>
        {/* Ralph 2026-06-05 · "↺ Re-scrape FSP" button — backfills profile_url
            + Verfügbarkeit on the XLSX-imported FSP rows that were ingested
            before the FSP scraper added those fields. Runs in the background;
            label morphs to "running" while the job is in flight, snackbar
            announces the final count. Hidden when there's nothing left to
            backfill (every FSP row already enriched). */}
        <button
          type="button"
          className={`scout-refsp-btn${refspJobId ? ' running' : ''}`}
          onClick={() => void runRefspBackfill()}
          disabled={!!refspJobId}
          title={refspJobId
            ? `Backfilling ${refspProgress?.processed ?? 0}/${refspProgress?.total ?? '?'} · ${refspProgress?.updated ?? 0} updated · ${refspProgress?.unresolved ?? 0} unresolved`
            : 'Re-scrape every FSP row to backfill profile URL + Verfügbarkeit. Safe to re-run; only touches rows that lack the new fields.'}
        >
          {refspJobId
            ? <>↻ <span className="lbl">backfilling · {refspProgress?.updated ?? 0}/{refspProgress?.total ?? '?'}</span></>
            : <>↺ <span className="lbl">Re-scrape FSP</span></>}
        </button>
        {/* Ralph 2026-06-05 · "◐ Backfill Queried" button — runs the 9 queried
            lamps (DNS / Wayback / PageSpeed + static-HTML detectors) on every
            pool row whose lamps are missing or failed. No Sonnet taste, no
            capture; cheap HTTP only. Same STOP-morph as Run Scout below. The
            count shows how many rows in the WHOLE POOL (not filtered) still
            need any lamp filled — backfill is a global hygiene action. */}
        <button
          type="button"
          className={`scout-backfill-btn${backfillJobId ? ' running' : ''}`}
          disabled={!backfillJobId && totalNeedsBackfill === 0}
          onClick={() => (backfillJobId ? void stopBackfill() : void runQueriedBackfill())}
          title={backfillJobId
            ? `Stop the queried backfill (${backfillDone}/${backfillTotal} done).`
            : totalNeedsBackfill === 0
              ? 'Every row in the pool has its queried lamps filled — nothing to backfill.'
              : `Run the 9 queried lamps on ${totalNeedsBackfill} pool rows that need them. No Sonnet taste, just DNS/Wayback/PageSpeed/HTML.`}
        >
          {backfillJobId
            ? <>⏹ <span className="lbl">STOP backfill ({backfillDone}/{backfillTotal})</span></>
            : <>◐ <span className="lbl">Backfill Queried ({totalNeedsBackfill})</span></>}
        </button>
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
                ? totalRawAvailable === 0
                  ? 'Nothing left to scout — the whole pool has been tasted.'
                  : `${totalRawAvailable} raw rows exist but none match the current filter/search. Clear the filter to see them.`
                : nextBatch.length < totalRawAvailable
                  ? `Will scout ${nextBatch.length} rows from the current view. ${totalRawAvailable - nextBatch.length} more raw rows are hidden by the filter/search.`
                  : `Launch ${nextBatch.length} scout agents in parallel — captures + queries + Sonnet tasting.`
          }
        >
          {activeJobId
            ? <>⏹ <span className="lbl">STOP ({tasting.size} in flight)</span></>
            : nextBatch.length < totalRawAvailable
              // Filter is hiding raw rows — show BOTH numbers so the user
              // sees "6 in view of 148 raw" instead of misreading 6 as
              // "only 6 worker slots remain". Without this disambiguation
              // Ralph thought the bridge pool was exhausted when really
              // the filter was just narrowing the view.
              ? <>◐ <span className="lbl">Run Scout ({nextBatch.length} of {totalRawAvailable} raw)</span></>
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
                    onChanged={load}
                    availableRegions={availableRegions}
                    sharedPractice={sharedPractice.get(p.id) ?? null}
                  />
                ))
          }
        </div>
      </div>

      <div className="scout-foot">
        <b>One card per lead.</b> Click a card to open its dossier · check cards
        + <b>Scout</b> to enrich raw ones · then <b>Promote</b> → the real
        Kanban · Incoming, or <b>Discard</b>.
      </div>

      <DecisionDeck
        selectedCount={sel.size}
        rawSelectedCount={rawSelected.length}
        researchSelectedCount={researchSelected.length}
        onTaste={() => void tasteSelected()}
        onResearch={() => void researchSelectedRows()}
        onPromote={() => void promoteSelected()}
        onDiscard={() => void discardSelected()}
      />

      {/* Snackbars render via the global SnackbarProvider (app/layout.tsx);
          no local container needed here. */}

      {/* Ralph 2026-06-05 · Discover modal — opens via the toolbar's
          "+ Discover" button. Closed-by-default; reloads the pool both
          mid-run (every successful ingest batch) and on completion so the
          user sees rows arrive incrementally. */}
      <DiscoverModal
        open={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        onStart={startDiscover}
      />

      {/* Ralph 2026-06-05 · Ambient job overlay (bottom-right). One bento
          per in-flight job — Discover / Re-scrape FSP / Backfill Queried —
          each independently collapsible. Hidden when no jobs are running. */}
      <ScoutJobsOverlay jobs={scoutJobs} />
    </div>
  )
}
