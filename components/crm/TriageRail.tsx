'use client'

// TriageRail — left rail of the CRM overview. Re-emits public/crm.html
// crmRenderOverviewNav() VERBATIM (greeting + editorial pivot headline +
// triage bentos in 3 groups [urgency · channel · stage] + pipeline footer),
// using crm.html's REAL class names so it's styled by the shared crm.css
// (loaded in app/crm/layout.tsx) — pixel-identical, no CSS-module drift.
//
// Filtering lives in the sibling LeadList; this rail emits filter strings via
// onFilterChange and highlights the bento matching the active `filter`.

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Prospect } from '@/lib/crm-store' // type-only — erased at compile
import type { CrmActivity } from '@/app/crm/crm-data' // type-only — erased at compile

interface TriageRailProps {
  prospects: Prospect[]
  activities: CrmActivity[]
  filter: string
  onFilterChange: (f: string) => void
  loading: boolean
}

type Tone = 'all' | 'overdue' | 'today' | 'upcoming' | 'email' | 'wa' | 'stage'

interface NextAction {
  kind: 'overdue' | 'today' | 'upcoming' | 'static'
  days: number | null
}

// ── ported from crm.html ──────────────────────────────────────────────────

// crmIsTerminalStatus
function isTerminalStatus(status: string): boolean {
  return status === 'Won' || status === 'Lost' || status === 'Cancelled'
}

// crmComputeNextAction — minus the label string we don't render here.
function computeNextAction(p: Prospect): NextAction | null {
  const date = (p.next_action_date || '').slice(0, 10)
  if (!date) {
    return p.next_action_label ? { kind: 'static', days: null } : null
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  if (!Number.isFinite(target.getTime())) return null
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { kind: 'overdue', days }
  if (days === 0) return { kind: 'today', days }
  return { kind: 'upcoming', days }
}

// crmActivityFilterBucket — last-activity type → rail filter key.
function activityFilterBucket(type: string | null): string | null {
  if (type === 'Call' || type === 'Qualification Call' || type === 'Zoom Call') return 'activity:Call'
  if (type === 'E-mail Out' || type === 'E-mail In') return 'activity:Email'
  if (type === 'Meeting' || type === 'Onsite Visit') return 'activity:Meeting'
  if (type === 'WhatsApp In') return 'activity:WhatsApp'
  return null
}

// crmFmtCHF — Swiss thousands with apostrophe separators.
function fmtCHF(n: number): string {
  return (Number(n) || 0).toLocaleString('de-CH').replace(/,/g, "'")
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

interface BentoItem {
  key: string
  label: string
  tone: Tone
  count: number
  sub: string
}

export function TriageRail({ prospects, activities, filter, onFilterChange, loading }: TriageRailProps) {
  // Live ticking clock — vanilla refreshes .fp-greet-clock every second.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Last-activity type per prospect (drives the channel-bucket counts).
  const lastTypeByProspect = useMemo(() => {
    const map = new Map<string, { type: string; ts: string }>()
    for (const a of activities) {
      const prev = map.get(a.prospect_id)
      if (!prev || (a.timestamp || '') > prev.ts) {
        map.set(a.prospect_id, { type: a.type, ts: a.timestamp || '' })
      }
    }
    return map
  }, [activities])

  // All count math — mirrors crmRenderOverviewNav + crmTriageCounts.
  const { groups, totalOpen, weighted, headline } = useMemo(() => {
    const open = prospects.filter((p) => !isTerminalStatus(p.status))

    let overdue = 0
    let today = 0
    let thisWeek = 0
    let stuckClosing = 0
    for (const p of open) {
      const na = computeNextAction(p)
      if (na && na.kind === 'overdue') overdue++
      if (na && na.kind === 'today') today++
      if (na && na.kind === 'upcoming' && na.days !== null && na.days <= 7) thisWeek++
      if (p.stage === 'Closing' && (!na || na.kind === 'overdue')) stuckClosing++
    }

    const totalOpen = open.reduce((s, p) => s + (p.amount_chf || 0), 0)
    const weighted = open.reduce(
      (s, p) => s + (p.amount_chf || 0) * ((p.confidence_pct || 0) / 100),
      0,
    )

    const incomingCount = open.filter((p) => p.stage === 'Incoming').length
    const contactedCount = open.filter((p) => p.stage === 'Contacted').length
    const demoDoneCount = open.filter((p) => p.stage === 'Demo done').length
    const closingCount = open.filter((p) => p.stage === 'Closing').length
    const lastType = (id: string) => lastTypeByProspect.get(id)?.type ?? null
    const emailsCount = open.filter(
      (p) => activityFilterBucket(lastType(p.id)) === 'activity:Email',
    ).length
    const whatsappCount = open.filter(
      (p) => activityFilterBucket(lastType(p.id)) === 'activity:WhatsApp',
    ).length

    const dayName = now.toLocaleDateString('en-US', { weekday: 'short' })
    const monthShort = now.toLocaleDateString('en-US', { month: 'short' })
    const dateBitsShort = `${dayName} ${now.getDate()} ${monthShort}`

    // Group order matches the vanilla: urgency → channel → stage.
    const groups: BentoItem[][] = [
      [
        { key: 'all', label: 'Open', tone: 'all', count: open.length, sub: 'All non-terminal leads' },
        { key: 'overdue', label: 'Overdue', tone: 'overdue', count: overdue, sub: 'Past their due date · prioritize first' },
        { key: 'today', label: 'Today', tone: 'today', count: today, sub: `On the docket for ${dateBitsShort}` },
        { key: 'thisweek', label: 'This week', tone: 'upcoming', count: thisWeek, sub: 'Due in the next 7 days' },
      ],
      [
        { key: 'activity:Email', label: 'Emails', tone: 'email', count: emailsCount, sub: 'Last activity was email' },
        { key: 'activity:WhatsApp', label: 'WhatsApp', tone: 'wa', count: whatsappCount, sub: 'Last activity was WhatsApp' },
      ],
      [
        { key: 'stage:Incoming', label: 'Incoming', tone: 'stage', count: incomingCount, sub: 'Stage 1 · first contact' },
        { key: 'stage:Contacted', label: 'Contacted', tone: 'stage', count: contactedCount, sub: 'Stage 2 · in dialogue' },
        { key: 'stage:Demo done', label: 'Demo Done', tone: 'stage', count: demoDoneCount, sub: 'Stage 3 · demo delivered' },
        { key: 'stage:Closing', label: 'Closing', tone: 'stage', count: closingCount, sub: 'Stage 4 · contract pending' },
      ],
    ]

    // Editorial pivot headline. No WhatsApp-unmatched source here (wamCount 0).
    const headlineTotal = overdue + today + stuckClosing
    let headline: { pre: string; em: string | null; post: string }
    if (headlineTotal === 0) {
      headline = { pre: 'Clear pipeline. Want me to scan the cold list?', em: null, post: '' }
    } else if (overdue > 0) {
      headline = { pre: `${headlineTotal} items need you. Start with the `, em: `${overdue} overdue`, post: '.' }
    } else if (today > 0) {
      headline = { pre: `${headlineTotal} items need you. Start with today's `, em: `${today}`, post: '.' }
    } else {
      headline = { pre: `${headlineTotal} items need you. Start with the ${stuckClosing} stuck in closing.`, em: null, post: '' }
    }

    return { groups, totalOpen, weighted, headline }
  }, [prospects, lastTypeByProspect, now])

  // Greeting / clock strings.
  const dayName = now.toLocaleDateString('en-US', { weekday: 'short' })
  const monthShort = now.toLocaleDateString('en-US', { month: 'short' })
  const dateLine = `${dayName} ${now.getDate()} ${monthShort} ${now.getFullYear()}`
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const clock = `${pad(hour)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

  const renderBento = (it: BentoItem) => {
    const active = filter === it.key
    const muted = it.count === 0 && !active
    return (
      <button
        key={it.key}
        type="button"
        className={`fp-triage${active ? ' is-active' : ''}${muted ? ' is-muted' : ''}`}
        data-tone={it.tone}
        onClick={() => onFilterChange(it.key)}
        aria-pressed={active}
      >
        <span className="num">{pad(it.count)}</span>
        <div className="body">
          <span className="lbl">{it.label}</span>
          <span className="sub">{it.sub}</span>
        </div>
        <span className="arr" aria-hidden="true">→</span>
      </button>
    )
  }

  return (
    <div className="fp-rail" aria-busy={loading}>
      <div className="fp-greet">
        <span className="fp-greet-hello">{greeting}</span>
        <span>
          <span className="fp-greet-date" suppressHydrationWarning>{dateLine}</span> ·{' '}
          <span className="fp-greet-clock" suppressHydrationWarning>{clock}</span>
        </span>
      </div>

      <div className="fp-headline">
        {headline.pre}
        {headline.em !== null && <em className="em-overdue">{headline.em}</em>}
        {headline.post}
      </div>

      {groups.map((g, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <div className="fp-rail-sep" />}
          {g.map(renderBento)}
        </Fragment>
      ))}

      <div className="fp-pipeline">
        <span className="line">
          <span className="k">Pipeline</span>
          <span className="v">CHF {fmtCHF(totalOpen)}</span>
          <span className="sep">·</span>
          <span className="k">Weighted</span>
          <span className="v">CHF {fmtCHF(Math.round(weighted))}</span>
        </span>
      </div>
    </div>
  )
}
