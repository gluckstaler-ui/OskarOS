'use client'

// ============================================================================
// NextMoveHero — the MIDDLE-column "▸ NEXT MOVE" recommendation card.
// Re-emits crm.html's .fp-next-move chrome (styled by app/crm/crm.css) to
// match the territoryxfathom V3 mockup. Picks the single highest-priority
// OPEN lead via the prototype's heroPick tiers:
//   inbound WhatsApp → inbound email → overdue/today → highest weighted.
// The Consular chat stays the studio <ConversationPanel/> — this is the
// recommendation surface above the lead list, not a chat.
// ============================================================================

import { useMemo, useState } from 'react'
import { MessageCircle, Mail } from 'lucide-react'
import type { Prospect } from '@/lib/crm-store'
import type { CrmActivity } from '@/app/crm/crm-data'

interface Props {
  prospects: Prospect[]
  activities: CrmActivity[]
  onOpen: (id: string) => void
  onWhatsApp?: (id: string) => void
}

type Tone = 'wa' | 'email' | 'overdue' | 'today' | 'upcoming'

interface HeroPick {
  p: Prospect
  tone: Tone
  tier: string // tag tier label, e.g. "WhatsApp waiting"
  channel: string // meta channel token, e.g. "WhatsApp"
  snippet: string | null // last inbound message body (wa/email only)
  ts: string | null // latest activity timestamp → timeago
}

function isTerminal(s: string): boolean {
  return s === 'Won' || s === 'Lost' || s === 'Cancelled'
}
function fmtCHF(n: number): string {
  return (Number(n) || 0).toLocaleString('de-CH').replace(/,/g, "'")
}
// positive = overdue, 0 = today, negative = upcoming, NaN-safe → 0
function overdueDays(p: Prospect): number {
  const d = (p.next_action_date || '').slice(0, 10)
  if (!d) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  if (!Number.isFinite(t.getTime())) return 0
  return Math.round((today.getTime() - t.getTime()) / 86_400_000)
}
function timeAgo(ts: string | null): string | null {
  if (!ts) return null
  const then = new Date(ts).getTime()
  if (!Number.isFinite(then)) return null
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function NextMoveHero({ prospects, activities, onOpen, onWhatsApp }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const pick = useMemo<HeroPick | null>(() => {
    const open = prospects.filter((p) => !isTerminal(p.status) && !dismissed.has(p.id))
    if (open.length === 0) return null

    // Latest activity per prospect (drives channel-waiting pools + snippet).
    const latest = new Map<string, CrmActivity>()
    for (const a of activities) {
      const prev = latest.get(a.prospect_id)
      if (!prev || (a.timestamp || '') > (prev.timestamp || '')) latest.set(a.prospect_id, a)
    }

    // urgencyScore — mirrors the prototype: overdue days dominate, starred
    // nudges, weighted value breaks ties.
    const score = (p: Prospect) =>
      Math.max(0, overdueDays(p)) * 5 +
      (p.starred ? 4 : 0) +
      ((p.amount_chf || 0) * ((p.confidence_pct || 0) / 100)) / 5000
    const byScore = (a: Prospect, b: Prospect) => score(b) - score(a)

    const mk = (p: Prospect, tone: Tone, tier: string, channel: string): HeroPick => {
      const a = latest.get(p.id)
      return { p, tone, tier, channel, snippet: a?.notes || a?.subject || null, ts: a?.timestamp || null }
    }

    // Pool 1 — last activity is inbound WhatsApp (needs reply).
    const wa = open.filter((p) => latest.get(p.id)?.type === 'WhatsApp In').sort(byScore)
    if (wa.length) return mk(wa[0], 'wa', 'WhatsApp waiting', 'WhatsApp')

    // Pool 2 — last activity is inbound email.
    const em = open.filter((p) => latest.get(p.id)?.type === 'E-mail In').sort(byScore)
    if (em.length) return mk(em[0], 'email', 'Email waiting', 'Email')

    // Pool 3 — overdue or due today (most urgent / highest weighted first).
    const overdueOrToday = open
      .filter((p) => (p.next_action_date || '').slice(0, 10) && overdueDays(p) >= 0)
      .sort(byScore)
    if (overdueOrToday.length) {
      const top = overdueOrToday[0]
      const days = overdueDays(top)
      return mk(
        top,
        days > 0 ? 'overdue' : 'today',
        days > 0 ? `${days}d overdue` : 'Due today',
        top.next_action_label || top.stage || 'Follow up',
      )
    }

    // Pool 4 — nothing urgent; surface the highest-weighted open lead.
    const top = open.slice().sort(byScore)[0]
    return mk(top, 'upcoming', 'Highest weighted', top.next_action_label || top.stage || 'Follow up')
  }, [prospects, activities, dismissed])

  if (!pick) return null
  const { p, tone, tier, channel, snippet, ts } = pick
  const ago = timeAgo(ts)
  const od = overdueDays(p)
  const dueTxt = p.next_action_date
    ? od > 0
      ? `${od}d overdue`
      : od === 0
        ? 'today'
        : `in ${Math.abs(od)}d`
    : null

  // Contextual CTA — when the hero surfaces a WhatsApp/email-waiting lead, the
  // matching channel button becomes the filled primary CTA and OPEN demotes to
  // outlined (only ONE primary per hero). Mirrors crm.html's heroTone→class
  // logic (crmRenderNextMove ~7942) so the React hero reads identically.
  const isWaTier = tone === 'wa'
  const isEmailTier = tone === 'email'
  const hasChannelCta = isWaTier || isEmailTier
  const waClass = isWaTier ? 'hero-action-btn is-cta is-wa' : 'hero-action-btn'
  const emailClass = isEmailTier ? 'hero-action-btn is-cta is-email' : 'hero-action-btn'
  const openClass = hasChannelCta ? 'open-btn is-secondary' : 'open-btn'

  return (
    <div className="fp-next-move" data-tone={tone}>
      <div className="body">
        <div className="tag">
          <span className="marker">▸</span>NEXT MOVE · {tier.toUpperCase()} · {p.id}
        </div>
        <div className="headline">{p.company || 'Untitled lead'}</div>
        <div className="meta">
          {p.contact_name && (
            <>
              {p.contact_name}
              <span className="sep">·</span>
            </>
          )}
          {p.stage}
          <span className="sep">·</span>
          {channel.toUpperCase()}
          {ago && (
            <>
              <span className="sep">·</span>
              {ago}
            </>
          )}
          {dueTxt && (
            <>
              <span className="sep">·</span>
              {od > 0 ? <span className="em-overdue">{dueTxt}</span> : dueTxt}
            </>
          )}
          <span className="sep">·</span>
          <span className="em">CHF {fmtCHF(p.amount_chf || 0)}</span>
          {p.confidence_pct ? (
            <span className="meta-pct">
              <span className="sep">·</span>
              {p.confidence_pct}%
            </span>
          ) : null}
        </div>
        {(tone === 'wa' || tone === 'email') &&
          snippet &&
          snippet.trim() &&
          snippet.trim() !== '[empty message]' && <div className="snippet">{snippet}</div>}
      </div>
      <div className="actions">
        {p.phone && (
          <button
            type="button"
            className={waClass}
            onClick={(e) => { e.stopPropagation(); onWhatsApp?.(p.id) }}
            title="Compose WhatsApp via Oskar"
          >
            <MessageCircle width={13} height={13} /> WhatsApp
          </button>
        )}
        {p.email && (
          <a className={emailClass} href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()}>
            <Mail width={13} height={13} /> Send Email
          </a>
        )}
        <button type="button" className={openClass} onClick={() => onOpen(p.id)}>
          Open →
        </button>
        <button
          type="button"
          className="dismiss-btn"
          title="Dismiss · show next priority"
          onClick={() => setDismissed((prev) => new Set(prev).add(p.id))}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
