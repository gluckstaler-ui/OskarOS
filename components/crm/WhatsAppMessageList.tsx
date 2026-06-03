'use client'

// ============================================================================
// WhatsAppMessageList — middle-column view under the triage "WhatsApp" filter.
//
// Ralph 2026-06-01 — renders messages BUNDLED BY SENDER (prospect/company)
// with collapsible groups. Was: flat one-row-per-message timeline that buried
// the second sender under 268 rows of the chattiest one. Now: each prospect
// is one collapsible block; click the header to expand/collapse; click any
// inner message to open that prospect's detail panel.
//
// Default state: all groups collapsed. The header shows count + latest snippet
// so triage is one-glance. Expanding shows every message from that sender,
// newest first.
// ============================================================================

import { useMemo, useState, useCallback } from 'react'
import { MessageCircle, ChevronRight, ChevronDown } from 'lucide-react'
import type { Prospect } from '@/lib/crm-store'
import type { CrmActivity } from '@/app/crm/crm-data'

interface Props {
  activities: CrmActivity[]
  prospects: Prospect[]
  onSelectProspect: (id: string) => void
  loading?: boolean
}

function timeAgo(ts: string | null | undefined): string {
  if (!ts) return ''
  const then = new Date(ts).getTime()
  if (!Number.isFinite(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
}

interface SenderGroup {
  prospectId: string
  company: string
  messages: CrmActivity[]   // newest first
  latestTs: string
}

export function WhatsAppMessageList({ activities, prospects, onSelectProspect, loading }: Props) {
  const byId = useMemo(() => {
    const m = new Map<string, Prospect>()
    for (const p of prospects) m.set(p.id, p)
    return m
  }, [prospects])

  // Group WhatsApp In/Out messages by prospect_id. Sort messages within each
  // group newest-first; then sort groups by their newest-message timestamp.
  const groups = useMemo<SenderGroup[]>(() => {
    const map = new Map<string, SenderGroup>()
    for (const a of activities || []) {
      if (a.type !== 'WhatsApp In' && a.type !== 'WhatsApp Out') continue
      let g = map.get(a.prospect_id)
      if (!g) {
        g = {
          prospectId: a.prospect_id,
          company: byId.get(a.prospect_id)?.company || a.prospect_id,
          messages: [],
          latestTs: '',
        }
        map.set(a.prospect_id, g)
      }
      g.messages.push(a)
    }
    const arr = Array.from(map.values()).map((g) => {
      const sorted = g.messages.slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      return { ...g, messages: sorted, latestTs: sorted[0]?.timestamp || '' }
    })
    arr.sort((a, b) => b.latestTs.localeCompare(a.latestTs))
    return arr
  }, [activities, byId])

  const totalMessages = useMemo(() => groups.reduce((s, g) => s + g.messages.length, 0), [groups])

  // expandedSenders is a Set of prospect_ids currently expanded.
  // Default: all collapsed (user clicks to drill in).
  const [expandedSenders, setExpandedSenders] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((prospectId: string) => {
    setExpandedSenders((prev) => {
      const next = new Set(prev)
      if (next.has(prospectId)) next.delete(prospectId)
      else next.add(prospectId)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    setExpandedSenders(new Set(groups.map((g) => g.prospectId)))
  }, [groups])

  const collapseAll = useCallback(() => {
    setExpandedSenders(new Set())
  }, [])

  return (
    <div className="fp-list-card" aria-busy={loading}>
      <div className="fp-list-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="title">
          <MessageCircle width={14} height={14} style={{ verticalAlign: '-2px', marginRight: 6, color: '#25D366' }} />
          WhatsApp · {groups.length} {groups.length === 1 ? 'sender' : 'senders'} · {totalMessages} {totalMessages === 1 ? 'message' : 'messages'}
        </div>
        {/* Bulk expand/collapse toggle */}
        {groups.length > 1 && (
          <button
            type="button"
            onClick={expandedSenders.size === groups.length ? collapseAll : expandAll}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-card)',
              color: 'var(--text-muted)',
              padding: '3px 10px',
              borderRadius: 6,
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              cursor: 'pointer',
            }}
            title={expandedSenders.size === groups.length ? 'Collapse all senders' : 'Expand all senders'}
          >
            {expandedSenders.size === groups.length ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      <div className="fp-list-scroll">
        {groups.length === 0 && (
          <div style={{ padding: '32px 18px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
            No WhatsApp messages yet.
          </div>
        )}
        {groups.map((g) => {
          const isExpanded = expandedSenders.has(g.prospectId)
          const latest = g.messages[0]
          const latestIsInbound = latest?.type === 'WhatsApp In'
          const latestBody = (latest?.notes || latest?.subject || '').trim() || '(empty)'

          return (
            <div key={g.prospectId} style={{ borderBottom: '1px solid var(--border-card)' }}>
              {/* Group header — click to toggle collapse */}
              <button
                type="button"
                onClick={() => toggle(g.prospectId)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  width: '100%',
                  padding: '12px 18px',
                  background: isExpanded ? 'color-mix(in srgb, var(--brand-amber, #e89e16) 6%, transparent)' : 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--text-main)',
                  fontFamily: 'inherit',
                  transition: 'background 0.12s ease',
                }}
              >
                {/* Disclosure arrow */}
                <span style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)' }}>
                  {isExpanded
                    ? <ChevronDown width={14} height={14} />
                    : <ChevronRight width={14} height={14} />}
                </span>

                {/* Sender name + meta */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text-main)',
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.company}</span>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: '#25D366',
                        background: 'rgba(37,211,102,0.10)',
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {g.messages.length}×
                    </span>
                  </div>
                  {/* Show latest snippet only when collapsed — once expanded, the
                      first row below IS the latest, so this would be duplication. */}
                  {!isExpanded && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontStyle: latestBody === '[empty message]' || latestBody === '(empty)' ? 'italic' : 'normal',
                      }}
                    >
                      <span style={{ color: latestIsInbound ? '#25D366' : 'var(--text-dim)', marginRight: 6 }}>
                        {latestIsInbound ? '←' : '→'}
                      </span>
                      {latestBody}
                    </div>
                  )}
                </div>

                {/* Time of latest message */}
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {timeAgo(g.latestTs)}
                </span>
              </button>

              {/* Expanded message rows — click any to open that prospect detail. */}
              {isExpanded && g.messages.map((m) => {
                const isInbound = m.type === 'WhatsApp In'
                const body = (m.notes || m.subject || '').trim() || '(empty)'
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelectProspect(m.prospect_id || g.prospectId)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '20px 32px 1fr auto',
                      gap: 12,
                      alignItems: 'start',
                      width: '100%',
                      padding: '10px 18px 10px 18px',
                      paddingLeft: 38,  // indent under the group's chevron
                      background: 'transparent',
                      border: 'none',
                      borderTop: '1px solid color-mix(in srgb, var(--border-card) 50%, transparent)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: 'var(--text-main)',
                      fontFamily: 'inherit',
                    }}
                  >
                    <span></span>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 14,
                        fontWeight: 700,
                        color: isInbound ? '#25D366' : 'var(--text-dim)',
                        textAlign: 'center',
                        lineHeight: 1.3,
                      }}
                      title={isInbound ? 'Inbound' : 'Outbound'}
                    >
                      {isInbound ? '←' : '→'}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-main)',
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontStyle: body === '[empty message]' || body === '(empty)' ? 'italic' : 'normal',
                        }}
                      >
                        {body}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: 'var(--text-dim)',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {timeAgo(m.timestamp)}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
