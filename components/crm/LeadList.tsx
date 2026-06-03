'use client'

// ============================================================================
// LeadList — the overview's middle column (lead queue). Re-emits crm.html's
// crmFpRowHtml() + the .fp-list-card chrome VERBATIM, using crm.html's REAL
// class names so it's styled by the shared crm.css (app/crm/layout.tsx).
//   crmOverviewList()  → useMemo filter+sort pipeline
//   crmFpRowHtml(p)    → <LeadRow/> (.fp-lead div: sched · subject · channels ·
//                        amt · pct, 5-tier date tone, lit channels from activity)
//   .fp-list-head      → title + search + #fp-filter-sel quick filter
// ============================================================================

import { useMemo } from 'react'
import { Star, Phone, MessageCircle, Mail, Plus, Upload, Keyboard, Download } from 'lucide-react'
import type { Prospect } from '@/lib/crm-store'
import type { CrmActivity } from '@/app/crm/crm-data'

interface LeadListProps {
  prospects: Prospect[]
  activities: CrmActivity[]
  filter: string
  search: string
  onSearchChange: (s: string) => void
  onFilterChange: (f: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleStar?: (id: string) => void
  onWhatsApp?: (id: string) => void
  onNewLead?: () => void
  onBulk?: () => void
  onShortcuts?: () => void
  loading: boolean
}

// ── Ported helpers (crm.html) ───────────────────────────────────────────────

function isTerminal(status: string): boolean {
  return status === 'Won' || status === 'Lost' || status === 'Cancelled'
}

function fmtCHF(n: number): string {
  return (Number(n) || 0).toLocaleString('de-CH').replace(/,/g, "'")
}

type NextAction =
  | { label: string; days: number | null; kind: 'static'; date?: string }
  | { label: string; days: number; kind: 'overdue' | 'today' | 'upcoming'; date: string }

function computeNextAction(p: Prospect): NextAction | null {
  const date = (p.next_action_date || '').slice(0, 10)
  if (!date) {
    return p.next_action_label ? { label: p.next_action_label, days: null, kind: 'static' } : null
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  if (!Number.isFinite(target.getTime())) return null
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, days, kind: 'overdue', date }
  if (days === 0) return { label: 'TODAY', days, kind: 'today', date }
  return { label: `${days}d upcoming`, days, kind: 'upcoming', date }
}

// crmFpSchedLabel — compact left chip (-3d / Today / Tmrw / +5d).
function schedLabel(na: NextAction | null): string {
  if (!na) return '—'
  if (na.kind === 'overdue') return `-${Math.abs(na.days as number)}d`
  if (na.kind === 'today') return 'Today'
  if (na.kind === 'upcoming') return na.days === 1 ? 'Tmrw' : `+${Math.abs(na.days as number)}d`
  return '—'
}

// crmFpRowHtml tone — 5-tier by exact day count.
function rowTone(na: NextAction | null): string {
  if (na && typeof na.days === 'number' && Number.isFinite(na.days)) {
    const d = na.days
    if (d <= -3) return 'overdue-deep'
    if (d <= -1) return 'overdue-recent'
    if (d === 0) return 'today'
    if (d <= 2) return 'upcoming-near'
    return 'upcoming-far'
  }
  return 'static'
}

function isOverdue(p: Prospect): boolean {
  if (isTerminal(p.status)) return false
  const today = new Date().toISOString().slice(0, 10)
  const date = (p.next_action_date || '').slice(0, 10)
  if (date && date < today) return true
  return /overdue/i.test(p.next_action_label || '')
}

function isThisWeek(p: Prospect): boolean {
  if (isTerminal(p.status)) return false
  const today = new Date()
  const in7 = new Date(today.getTime() + 7 * 86400 * 1000)
  const date = p.next_action_date ? new Date(p.next_action_date) : null
  if (!date || isNaN(date.getTime())) return false
  return date >= today && date <= in7
}

function priorityTuple(p: Prospect): [number, number, number] {
  const na = computeNextAction(p)
  if (!na || na.kind === 'static') return [1, 0, 0]
  const dayKey = na.days as number
  const starredKey = p.starred ? 0 : 1
  const weightKey = -((p.amount_chf || 0) * (p.confidence_pct || 0))
  return [dayKey, starredKey, weightKey]
}
function urgencyCompare(a: Prospect, b: Prospect): number {
  const A = priorityTuple(a)
  const B = priorityTuple(b)
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return A[i] - B[i]
  return 0
}

// crmChannelBucket — activity type → channel key (for the lit channel strip).
type Channel = 'Call' | 'WhatsApp' | 'Email'
function channelOf(type: string): Channel | null {
  if (type === 'Call' || type === 'Qualification Call' || type === 'Zoom Call') return 'Call'
  if (type === 'WhatsApp In' || type === 'WhatsApp Out') return 'WhatsApp'
  if (type === 'E-mail Out' || type === 'E-mail In') return 'Email'
  return null
}
const RECENT_DAYS = 3

// ── Row ──────────────────────────────────────────────────────────────────────

interface ChannelState { active: Set<Channel>; recent: Set<Channel> }

function LeadRow({
  p,
  selected,
  channels,
  onSelect,
  onToggleStar,
  onWhatsApp,
}: {
  p: Prospect
  selected: boolean
  channels: ChannelState
  onSelect: (id: string) => void
  onToggleStar?: (id: string) => void
  onWhatsApp?: (id: string) => void
}) {
  const na = computeNextAction(p)
  const tone = rowTone(na)
  const sched = schedLabel(na)
  const contact = (p.contact_name || '').trim() || '—'
  const stageTxt = (p.stage || '').trim()
  const lit = (c: Channel) =>
    `${channels.active.has(c) ? ' is-active' : ''}${channels.recent.has(c) ? ' is-recent' : ''}`

  return (
    <div
      className={`fp-lead${selected ? ' is-active' : ''}`}
      data-tone={tone}
      data-prospect-id={p.id}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(p.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(p.id)
        }
      }}
    >
      <span className="sched">{sched}</span>
      <div className="subject">
        <span className="name">{p.company || 'Untitled'}</span>
        <span className="meta">
          {contact}
          {stageTxt && (<><span className="sep">·</span>{stageTxt}</>)}
        </span>
      </div>
      <div className="fp-lead-channels">
        <button
          type="button"
          className={`fp-lead-star crm-star${p.starred ? ' is-on' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleStar?.(p.id) }}
          title="Star this lead"
        >
          <Star width={13} height={13} />
        </button>
        {p.phone ? (
          <a href={`tel:${p.phone}`} className={`crm-phone-icon${lit('Call')}`} onClick={(e) => e.stopPropagation()} title={`Call ${p.phone}`}>
            <Phone width={13} height={13} />
          </a>
        ) : (
          <span className="crm-phone-icon is-empty"><Phone width={13} height={13} /></span>
        )}
        {p.phone ? (
          <button type="button" className={`crm-whatsapp-icon${lit('WhatsApp')}`} onClick={(e) => { e.stopPropagation(); onWhatsApp?.(p.id) }} title={`WhatsApp ${p.phone} — compose via Oskar`} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}>
            <MessageCircle width={13} height={13} />
          </button>
        ) : (
          <span className="crm-whatsapp-icon is-empty"><MessageCircle width={13} height={13} /></span>
        )}
        {p.email ? (
          <a href={`mailto:${p.email}`} className={`crm-mail-icon${lit('Email')}`} onClick={(e) => e.stopPropagation()} title={`Email ${p.email}`}>
            <Mail width={13} height={13} />
          </a>
        ) : (
          <span className="crm-mail-icon is-empty"><Mail width={13} height={13} /></span>
        )}
      </div>
      <span className="amt">{p.amount_chf ? `CHF ${fmtCHF(p.amount_chf)}` : 'CHF —'}</span>
      <span className="pct">{p.confidence_pct || 0}%</span>
    </div>
  )
}

// ── List ───────────────────────────────────────────────────────────────────

const FILTER_LABELS: Record<string, string> = {
  all: 'All open',
  overdue: 'Overdue',
  today: 'Today',
  thisweek: 'This week',
  'stage:Incoming': 'Incoming',
  'stage:Contacted': 'Contacted',
  'stage:Demo done': 'Demo done',
  'stage:Closing': 'Closing',
  'activity:Call': 'Calls',
  'activity:Email': 'Emails',
  'activity:Meeting': 'Meetings',
  'activity:WhatsApp': 'WhatsApp new',
}

export function LeadList({
  prospects,
  activities,
  filter,
  search,
  onSearchChange,
  onFilterChange,
  selectedId,
  onSelect,
  onToggleStar,
  onWhatsApp,
  onNewLead,
  onBulk,
  onShortcuts,
  loading,
}: LeadListProps) {
  // Per-prospect channel activity (ever / recent ≤3d) — drives the lit strip.
  const channelsByProspect = useMemo(() => {
    const map = new Map<string, ChannelState>()
    const cutoff = Date.now() - RECENT_DAYS * 86_400_000
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

  const list = useMemo(() => {
    const open = (prospects || []).filter((p) => !isTerminal(p.status))
    let out: Prospect[]
    if (filter === 'today') {
      const today = new Date().toISOString().slice(0, 10)
      out = open.filter((p) => (p.next_action_date || '').slice(0, 10) === today)
    } else if (filter === 'overdue') {
      out = open.filter(isOverdue)
    } else if (filter === 'thisweek') {
      out = open.filter(isThisWeek)
    } else if (filter.startsWith('stage:')) {
      const stage = filter.slice('stage:'.length)
      out = open.filter((p) => p.stage === stage)
    } else {
      out = open
    }
    const q = (search || '').trim().toLowerCase()
    if (q) {
      out = out.filter((p) =>
        [p.company, p.contact_name, p.notes, p.tags].filter(Boolean).join(' ').toLowerCase().includes(q),
      )
    }
    return [...out].sort(urgencyCompare)
  }, [prospects, filter, search])

  const label = FILTER_LABELS[filter] || filter
  const EMPTY: ChannelState = { active: new Set(), recent: new Set() }

  return (
    <div className="fp-list-card">
      <div className="fp-list-head">
        <div className="title">
          <span>{label} · {list.length} lead{list.length === 1 ? '' : 's'}</span>
        </div>
        <div className="tools">
          <input
            id="fp-search"
            className="search"
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <select
            id="fp-filter-sel"
            className="filter-sel"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            title="Quick filter"
          >
            <option value="all">All open</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="thisweek">This week</option>
            <option value="stage:Incoming">Incoming</option>
            <option value="stage:Contacted">Contacted</option>
            <option value="stage:Demo done">Demo done</option>
            <option value="stage:Closing">Closing</option>
            <option value="activity:Call">Calls</option>
            <option value="activity:Email">Emails</option>
            <option value="activity:Meeting">Meetings</option>
            <option value="activity:WhatsApp">WhatsApp new</option>
          </select>
          {/* ? — keyboard shortcuts cheat sheet. */}
          {onShortcuts && (
            <button
              type="button"
              className="fp-list-action"
              onClick={onShortcuts}
              title="Keyboard shortcuts (?)"
            >
              <Keyboard width={12} height={12} /> ?
            </button>
          )}
          {/* Bulk — paste CSV/TSV/vCard or upload a file → map → import. */}
          {onBulk && (
            <button
              type="button"
              className="fp-list-action"
              onClick={onBulk}
              title="Bulk import — paste CSV / TSV / vCard or upload .csv .tsv .xlsx"
            >
              <Upload width={12} height={12} /> Bulk
            </button>
          )}
          {/* Export — download all prospects as .xlsx (plain download link). */}
          <a
            className="fp-list-action"
            href="/api/admin/crm/xlsx-export"
            download
            title="Export all leads to .xlsx"
          >
            <Download width={12} height={12} /> Export
          </a>
          {/* New Lead — POSTs a default prospect, reloads, opens it expanded.
              Mirrors crm.html crmNewLead() + the fp-list-head action group. */}
          {onNewLead && (
            <button
              type="button"
              className="fp-list-action fp-list-action-primary"
              onClick={onNewLead}
              title="Create a new lead"
            >
              <Plus width={12} height={12} /> New Lead
            </button>
          )}
        </div>
      </div>

      <div className="fp-list-scroll" id="crm-overview-list">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>Loading…</div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>No leads match this filter.</div>
        ) : (
          list.map((p) => (
            <LeadRow
              key={p.id}
              p={p}
              selected={p.id === selectedId}
              channels={channelsByProspect.get(p.id) || EMPTY}
              onSelect={onSelect}
              onToggleStar={onToggleStar}
              onWhatsApp={onWhatsApp}
            />
          ))
        )}
      </div>
    </div>
  )
}
