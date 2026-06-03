'use client'

// ============================================================================
// KanbanBoard — the CRM's Kanban view. Re-emits crm.html crmRender()'s 4-stage
// board + crmCardHtml() compact card, using crm.html's REAL class names
// (.crm-column / .crm-card / .crm-chip / .crm-avatar / channel icons) so it's
// styled by the shared crm.css (app/crm/layout.tsx). Drag a card to another
// column → PATCH stage → onReload. Tailwind-only chrome bits are inline-styled
// (the React app has no Tailwind). Deferred (need session/stage-history data
// not handed here): velocity strip, quick-add, phase pill, stage-age chip.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { Phone, MessageCircle, Mail, Star, Plus, Upload } from 'lucide-react'
import type { Prospect } from '@/lib/crm-store'
import type { CrmActivity } from '@/app/crm/crm-data'
import { LeadDetail } from './LeadDetail'

// Port of crm.html crmQuickAddParse — pull email + phone via regex, the rest is
// positional comma-split: "Company, Name, +4179…, a@b.ch" → {company, contact_name, phone, email}.
function quickAddParse(input: string): { company: string; contact_name: string; phone: string; email: string } {
  const out = { company: '', contact_name: '', phone: '', email: '' }
  let raw = input
  const emailMatch = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  if (emailMatch) { out.email = emailMatch[0]; raw = raw.replace(emailMatch[0], '').trim() }
  const phoneMatch = raw.match(/\+?\d[\d\s().-]{6,}\d/)
  if (phoneMatch) { out.phone = phoneMatch[0].trim(); raw = raw.replace(phoneMatch[0], '').trim() }
  const parts = raw.split(/[,|;]/).map((s) => s.trim()).filter(Boolean)
  out.company = parts[0] || raw || 'Unnamed'
  out.contact_name = parts[1] || ''
  return out
}

const CRM_STAGES = ['Incoming', 'Contacted', 'Demo done', 'Closing'] as const
const STAGE_KEY: Record<string, string> = {
  Incoming: 'incoming',
  Contacted: 'contacted',
  'Demo done': 'demo',
  Closing: 'closing',
}

function isTerminal(status: string): boolean {
  return status === 'Won' || status === 'Lost' || status === 'Cancelled'
}
function fmtCHF(n: number): string {
  return (Number(n) || 0).toLocaleString('de-CH').replace(/,/g, "'")
}

type NextAction = { label: string; days: number | null; kind: 'overdue' | 'today' | 'upcoming' | 'static' } | null
function computeNextAction(p: Prospect): NextAction {
  const date = (p.next_action_date || '').slice(0, 10)
  if (!date) return p.next_action_label ? { label: p.next_action_label, days: null, kind: 'static' } : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  if (!Number.isFinite(target.getTime())) return null
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, days, kind: 'overdue' }
  if (days === 0) return { label: 'TODAY', days, kind: 'today' }
  return { label: `${days}d upcoming`, days, kind: 'upcoming' }
}
// crmNextActionChipClass
function chipClass(na: NextAction): string {
  if (na && na.kind === 'overdue') return 'crm-chip-overdue'
  if (na && na.kind === 'today') return 'crm-chip-today'
  return 'crm-chip-upcoming'
}

// Urgency sort (overdue first → starred → weighted), mirrors crmCardCompare default.
function priorityTuple(p: Prospect): [number, number, number] {
  const na = computeNextAction(p)
  if (!na || na.kind === 'static') return [1, 0, 0]
  return [na.days as number, p.starred ? 0 : 1, -((p.amount_chf || 0) * (p.confidence_pct || 0))]
}
function urgencyCompare(a: Prospect, b: Prospect): number {
  const A = priorityTuple(a)
  const B = priorityTuple(b)
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return A[i] - B[i]
  return 0
}

// Sort modes — port of crm.html CRM_SORT_MODES. Pure comparators on prospect
// fields; selection persists to localStorage('crm-sort-mode').
const SORT_MODES: { value: string; label: string; cmp: (a: Prospect, b: Prospect) => number }[] = [
  { value: 'urgency', label: 'Urgency (overdue first)', cmp: urgencyCompare },
  { value: 'alpha', label: 'A → Z', cmp: (a, b) => (a.company || '').localeCompare(b.company || '') },
  { value: 'alpha-desc', label: 'Z → A', cmp: (a, b) => (b.company || '').localeCompare(a.company || '') },
  { value: 'amount-desc', label: 'CHF high → low', cmp: (a, b) => (b.amount_chf || 0) - (a.amount_chf || 0) },
  { value: 'confidence-desc', label: 'Confidence high → low', cmp: (a, b) => (b.confidence_pct || 0) - (a.confidence_pct || 0) },
  { value: 'weighted-desc', label: 'Weighted (CHF × %)', cmp: (a, b) => ((b.amount_chf || 0) * (b.confidence_pct || 0)) - ((a.amount_chf || 0) * (a.confidence_pct || 0)) },
  { value: 'next-action-asc', label: 'Next action (urgent)', cmp: (a, b) => (a.next_action_date || '9999-12-31').localeCompare(b.next_action_date || '9999-12-31') },
  { value: 'starred', label: 'Starred first', cmp: (a, b) => { const d = (a.starred ? 0 : 1) - (b.starred ? 0 : 1); return d !== 0 ? d : (a.company || '').localeCompare(b.company || '') } },
]

// Velocity strip (crm.html crmComputeVelocity) — average days per stage
// transition, derived from stage_changed/status_changed activity rows whose
// notes carry a "from → to" marker. The last transition (Closing → Won) is a
// status change, not a stage move. Computed client-side from the activities prop.
const VELOCITY_TRANSITIONS: [string, string][] = [
  ['Incoming', 'Contacted'],
  ['Contacted', 'Demo done'],
  ['Demo done', 'Closing'],
  ['Closing', 'Won'],
]
function computeVelocity(activities: CrmActivity[]): { from: string; to: string; n: number; avgDays: number | null }[] {
  const byProspect: Record<string, CrmActivity[]> = {}
  for (const a of activities) {
    if (a.type !== 'stage_changed' && a.type !== 'status_changed') continue
    if (!byProspect[a.prospect_id]) byProspect[a.prospect_id] = []
    byProspect[a.prospect_id].push(a)
  }
  const buckets: Record<string, number[]> = {}
  for (const [from, to] of VELOCITY_TRANSITIONS) buckets[`${from}|${to}`] = []
  for (const pid of Object.keys(byProspect)) {
    const list = byProspect[pid].slice().sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]
      const cur = list[i]
      const m = (cur.notes || '').match(/(.+?)\s*[→\-]>\s*(.+)/)
      if (!m) continue
      const key = `${m[1].trim()}|${m[2].trim()}`
      if (!(key in buckets)) continue
      const dt = (new Date(cur.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 86_400_000
      if (dt >= 0 && dt < 365) buckets[key].push(dt)
    }
  }
  return VELOCITY_TRANSITIONS.map(([from, to]) => {
    const arr = buckets[`${from}|${to}`]
    const n = arr.length
    const avg = n > 0 ? arr.reduce((s, x) => s + x, 0) / n : null
    return { from, to, n, avgDays: avg }
  })
}

// Channel lighting (same as LeadList): is-active = ever, is-recent = ≤3d.
type Channel = 'Call' | 'WhatsApp' | 'Email'
function channelOf(type: string): Channel | null {
  if (type === 'Call' || type === 'Qualification Call' || type === 'Zoom Call') return 'Call'
  if (type === 'WhatsApp In' || type === 'WhatsApp Out') return 'WhatsApp'
  if (type === 'E-mail Out' || type === 'E-mail In') return 'Email'
  return null
}

interface ChannelState { active: Set<Channel>; recent: Set<Channel> }
const EMPTY_CH: ChannelState = { active: new Set(), recent: new Set() }

interface KanbanBoardProps {
  prospects: Prospect[]
  activities: CrmActivity[]
  onSelect: (id: string | null) => void
  onReload: () => void
  onToggleStar?: (id: string) => void
  onWhatsApp?: (id: string) => void
  registerUndo?: (label: string, action: () => void | Promise<void>) => void
  onNewLead?: () => void
  onBulk?: () => void
  loading: boolean
  /**
   * The currently-expanded lead, if any. When set, the matching card in the
   * kanban grid renders as <LeadDetail> IN PLACE of the small <KanbanCard>
   * — same pattern as crm.html's crmExpandCardInline. No overlay, no modal:
   * the detail expands inside its own stage column so the kanban context
   * stays visible. Ralph 2026-06-03.
   */
  selectedId?: string | null
}

export function KanbanBoard({ prospects, activities, onSelect, onReload, onToggleStar, onWhatsApp, registerUndo, onNewLead, onBulk, loading, selectedId }: KanbanBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const [busyStage, setBusyStage] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState('urgency')
  useEffect(() => {
    try { const v = localStorage.getItem('crm-sort-mode'); if (v && SORT_MODES.some((m) => m.value === v)) setSortMode(v) } catch { /* ignore */ }
  }, [])
  const changeSort = (v: string) => { setSortMode(v); try { localStorage.setItem('crm-sort-mode', v) } catch { /* ignore */ } }

  // Inline quick-add — type "Company, Name, Phone, Email" + Enter into a column
  // to create a lead already in that stage. Port of crm.html crmQuickAddKey.
  async function handleQuickAdd(e: React.KeyboardEvent<HTMLInputElement>, stage: string) {
    if (e.key !== 'Enter') return
    const inputEl = e.currentTarget
    const raw = (inputEl.value || '').trim()
    if (!raw) return
    const parsed = quickAddParse(raw)
    setBusyStage(stage)
    try {
      const res = await fetch('/api/admin/crm/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsed,
          stage,
          status: 'To do',
          amount_chf: 0,
          confidence_pct: 25,
          next_action_date: new Date().toISOString().slice(0, 10),
          next_action_label: 'TODAY',
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      inputEl.value = ''
      onReload()
      inputEl.focus()
    } catch (err) {
      console.error('[CRM] quick-add failed:', err)
      alert('Add failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusyStage(null)
    }
  }

  const channelsByProspect = useMemo(() => {
    const map = new Map<string, ChannelState>()
    const cutoff = Date.now() - 3 * 86_400_000
    for (const a of activities) {
      const c = channelOf(a.type)
      if (!c) continue
      let st = map.get(a.prospect_id)
      if (!st) { st = { active: new Set(), recent: new Set() }; map.set(a.prospect_id, st) }
      st.active.add(c)
      const ts = a.timestamp ? new Date(a.timestamp).getTime() : NaN
      if (Number.isFinite(ts) && ts >= cutoff) st.recent.add(c)
    }
    return map
  }, [activities])

  const byStage = useMemo(() => {
    const mode = SORT_MODES.find((m) => m.value === sortMode) || SORT_MODES[0]
    const map: Record<string, Prospect[]> = {}
    for (const stage of CRM_STAGES) {
      map[stage] = prospects.filter((p) => p.stage === stage).slice().sort(mode.cmp)
    }
    return map
  }, [prospects, sortMode])

  const velocity = useMemo(() => computeVelocity(activities), [activities])

  // Drag a card onto a column → PATCH stage → reload (crmDrop).
  const drop = async (stage: string) => {
    const id = dragId
    setDragId(null)
    setOverStage(null)
    if (!id) return
    const p = prospects.find((x) => x.id === id)
    if (!p || p.stage === stage) return
    const oldStage = p.stage
    const company = p.company || 'lead'
    try {
      await fetch(`/api/admin/crm/prospects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      })
    } catch { /* best-effort */ }
    onReload()
    // crmRegisterUndo — restore the prior stage.
    registerUndo?.(`move ${company} to ${stage}`, async () => {
      await fetch(`/api/admin/crm/prospects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: oldStage }),
      }).catch(() => {})
      onReload()
    })
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--gap-app, 20px)' }}>
      {/* Toolbar — New Lead (mirrors crm.html's kanban bar button). Undo lives in
          the top bar; Bulk Import is a follow-up. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
        {/* Sort mode — reorders cards in every column (crm.html crmSetSortMode). */}
        <select
          value={sortMode}
          onChange={(e) => changeSort(e.target.value)}
          title="Sort cards"
          style={{ fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'var(--bg-app)', color: 'var(--text-main)', cursor: 'pointer', marginRight: 'auto' }}
        >
          {SORT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        {onBulk && (
          <button
            type="button"
            onClick={onBulk}
            title="Bulk import — paste CSV / TSV / vCard or upload .csv .tsv .xlsx"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-card)', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, fontWeight: 700, background: 'var(--bg-app)' }}
          >
            <Upload width={13} height={13} /> Bulk
          </button>
        )}
        {onNewLead && (
          <button
            type="button"
            onClick={onNewLead}
            title="Create a new lead"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, background: 'linear-gradient(135deg, #15B981, #047857)' }}
          >
            <Plus width={14} height={14} /> New Lead
          </button>
        )}
      </div>
      {/* Velocity strip — avg days per stage transition (crm.html crmRenderVelocityStrip). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, flexShrink: 0 }}>
        {velocity.map((t) => (
          <div
            key={`${t.from}-${t.to}`}
            className="bento-card"
            title={`Average days from ${t.from} to ${t.to} across ${t.n} historical transitions`}
            style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 }}
          >
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.from} → {t.to}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>
              {t.avgDays != null ? `${t.avgDays.toFixed(1)}d` : '—'}
              {t.n > 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>· n={t.n}</span>}
            </div>
          </div>
        ))}
      </div>
      <div
        id="crm-board"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 'var(--gap-app, 20px)',
          overflow: 'hidden',
        }}
      >
        {CRM_STAGES.map((stage) => {
        const inStage = byStage[stage] || []
        const stageTotal = inStage.filter((p) => !isTerminal(p.status)).reduce((s, p) => s + (p.amount_chf || 0), 0)
        return (
          <div key={stage} className={`crm-column crm-stage-color-${STAGE_KEY[stage]}`}>
            <div className="crm-column-header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: 17, letterSpacing: '-0.01em' }}>{stage}</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>{inStage.length} leads</span>
              </div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--stage)' }}>CHF {fmtCHF(stageTotal)}</div>
            </div>
            <div
              className="crm-column-body"
              data-stage={stage}
              onDragOver={(e) => { e.preventDefault(); if (overStage !== stage) setOverStage(stage) }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => { e.preventDefault(); void drop(stage) }}
              style={overStage === stage ? { outline: '1px dashed var(--stage, var(--accent))', outlineOffset: -2 } : undefined}
            >
              {loading ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>Loading…</div>
              ) : inStage.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>No leads</div>
              ) : (
                inStage.map((p) => (
                  <KanbanCard
                    key={p.id}
                    p={p}
                    channels={channelsByProspect.get(p.id) || EMPTY_CH}
                    onSelect={onSelect}
                    onToggleStar={onToggleStar}
                    onWhatsApp={onWhatsApp}
                    onDragStart={() => setDragId(p.id)}
                    onDragEnd={() => { setDragId(null); setOverStage(null) }}
                  />
                ))
              )}
              {/* Inline quick-add — create a lead directly in this stage.
                  Port of crm.html .crm-quickadd input + crmQuickAddKey. */}
              <input
                type="text"
                className="crm-quickadd"
                data-stage={stage}
                disabled={busyStage === stage}
                placeholder="+ Add lead (Company, Name, Phone, Email)…"
                onKeyDown={(e) => { void handleQuickAdd(e, stage) }}
                style={{ marginTop: 8, width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border-card)', background: 'var(--bg-app)', color: 'var(--text-main)', fontSize: 11, outline: 'none' }}
              />
            </div>
          </div>
        )
      })}
        {/* Ralph 2026-06-03 · Port of crm.html crmRenderExpandedOverlay.
            When a card is selected, the LeadDetail is shown as an absolutely-
            positioned panel over the kanban board. The panel is TWO COLUMNS
            wide (so it has room for the opp dashboard's intel lamps, history,
            etc.) and starts at the column of the prospect's stage — clamped
            one column LEFT when the prospect is in the rightmost stage so the
            panel stays inside the board.

              Incoming  (idx 0) → starts at col 0, covers 0+1
              Contacted (idx 1) → starts at col 1, covers 1+2
              Demo done (idx 2) → starts at col 2, covers 2+3
              Closing   (idx 3) → CLAMPED to col 2,  covers 2+3

            The CSS for `.crm-expanded-overlay` lives in app/crm/crm.css
            (`position:absolute, top:0, bottom:0, width: 2*--col-width + gap`).
            `#crm-board` defines `--col-width = (100% - 3*gap) / 4`. */}
        {selectedId && (() => {
          const selectedProspect = prospects.find((p) => p.id === selectedId)
          if (!selectedProspect) return null
          const stageIdx = CRM_STAGES.indexOf(selectedProspect.stage as typeof CRM_STAGES[number])
          if (stageIdx < 0) return null
          const startCol = Math.min(stageIdx, CRM_STAGES.length - 2)
          return (
            <div
              className="crm-expanded-overlay"
              style={{ left: `calc(${startCol} * (var(--col-width) + var(--gap-app)))` }}
            >
              <LeadDetail
                prospect={selectedProspect}
                activities={activities.filter((a) => a.prospect_id === selectedProspect.id)}
                onClose={() => onSelect(null)}
                onReload={onReload}
                registerUndo={registerUndo}
                onWhatsApp={onWhatsApp}
              />
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// Stage-age chip (crm.html crmStageAgeChip) — silent < 7d, then progressive
// bands: faint grey 7-13, clear grey 14-20, amber 21-27, red 28+. Uses the
// stage_age_days the /prospects GET enriches onto each row.
const F8_STAGE_ORDER = ['Incoming', 'Contacted', 'Demo done', 'Closing']
function stageAgeDays(p: Prospect): number {
  return Number((p as Prospect & { stage_age_days?: number }).stage_age_days) || 0
}
function StageAgeChip({ p }: { p: Prospect }) {
  const days = stageAgeDays(p)
  if (days < 7) return null
  let color: string, bg: string, opacity: number
  if (days >= 28) { color = '#ef4444'; bg = 'rgba(239, 68, 68, 0.15)'; opacity = 1 }
  else if (days >= 21) { color = '#ffb84a'; bg = 'rgba(255, 184, 74, 0.12)'; opacity = 1 }
  else if (days >= 14) { color = '#a1a1aa'; bg = 'transparent'; opacity = 0.85 }
  else { color = '#71717a'; bg = 'transparent'; opacity = 0.55 }
  const tip = days >= 28
    ? `${days} days in ${p.stage} — RED ZONE, deal is dying`
    : days >= 21
      ? `${days} days in ${p.stage} — likely going stale, time to nudge or close`
      : `${days} days in ${p.stage}`
  return (
    <div title={tip} style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', marginTop: 4, color, background: bg, display: 'inline-block', padding: '1px 6px', borderRadius: 999, opacity }}>
      · {days}d in {p.stage}
    </div>
  )
}

// F8 phase bar (crm.html crmCrmPhaseBarHtml) — 4 segments for the 4 stages,
// filled up to the current stage, with an optional sub_stage suffix.
function PhaseBar({ p }: { p: Prospect }) {
  const idx = F8_STAGE_ORDER.indexOf(p.stage)
  if (idx < 0) return null
  const filled = idx + 1
  const sub = (p.sub_stage || '').trim()
  const label = sub ? `${p.stage} ${filled}/4 · ${sub}` : `${p.stage} ${filled}/4`
  return (
    <div className="crm-phase-crm" title="Sales stage progress">
      {[1, 2, 3, 4].map((n) => <span key={n} className={`crm-phase-seg${filled >= n ? ' is-on' : ''}`} />)}
      <span className="crm-phase-label">{label}</span>
    </div>
  )
}

function KanbanCard({
  p,
  channels,
  onSelect,
  onToggleStar,
  onWhatsApp,
  onDragStart,
  onDragEnd,
}: {
  p: Prospect
  channels: ChannelState
  onSelect: (id: string) => void
  onToggleStar?: (id: string) => void
  onWhatsApp?: (id: string) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const initial = (p.company || '?').trim().charAt(0).toUpperCase()
  const na = computeNextAction(p)
  const label = na ? na.label : ''
  const terminal = isTerminal(p.status)
  const lit = (c: Channel) =>
    `${channels.active.has(c) ? ' is-active' : ''}${channels.recent.has(c) ? ' is-recent' : ''}`
  const open = (e: React.MouseEvent) => { e.stopPropagation(); onSelect(p.id) }

  return (
    <div
      className={`crm-card crm-card-pre${terminal ? ` is-terminal terminal-${p.status.toLowerCase()}` : ''}`}
      draggable
      data-prospect-id={p.id}
      data-status={p.status}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); onDragStart() }}
      onDragEnd={onDragEnd}
    >
      <div className="crm-card-header-zone" onClick={open} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="crm-avatar">{initial}</div>
          <span style={{ fontWeight: 700, color: 'var(--text-main)', flex: 1, fontSize: 15, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.company || 'Untitled'}
          </span>
          {p.phone && (
            <a href={`tel:${p.phone}`} className={`crm-phone-icon${lit('Call')}`} onClick={(e) => e.stopPropagation()} title={`Call ${p.phone}`}><Phone width={13} height={13} /></a>
          )}
          {p.phone && (
            <button type="button" className={`crm-whatsapp-icon${lit('WhatsApp')}`} onClick={(e) => { e.stopPropagation(); onWhatsApp?.(p.id) }} title={`WhatsApp ${p.phone} — compose via Oskar`} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}><MessageCircle width={13} height={13} /></button>
          )}
          {p.email && (
            <a href={`mailto:${p.email}`} className={`crm-mail-icon${lit('Email')}`} onClick={(e) => e.stopPropagation()} title={`Email ${p.email}`}><Mail width={13} height={13} /></a>
          )}
          <button
            type="button"
            className={`crm-star${p.starred ? ' is-on' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleStar?.(p.id) }}
            title="Star this lead"
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}
          >
            <Star width={14} height={14} />
          </button>
        </div>
      </div>
      <div className="crm-card-body-zone" onClick={open} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, marginTop: 8 }}>
          <span style={{ fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono, monospace)' }}>CHF {fmtCHF(p.amount_chf || 0)}</span>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>{p.confidence_pct || 0}%</span>
          {label && <span className={`crm-chip ${chipClass(na)}`}>{label}</span>}
        </div>
        <PhaseBar p={p} />
        <StageAgeChip p={p} />
      </div>
    </div>
  )
}
