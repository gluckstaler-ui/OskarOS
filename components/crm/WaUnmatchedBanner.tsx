'use client'

// ============================================================================
// WaUnmatchedBanner — inbound WhatsApp from UNKNOWN numbers (no matching
// prospect).
//
// Ralph 2026-06-01 — two-level drill-down:
//   Outer "Show / Hide unmatched senders" lives in app/crm/page.tsx — when
//   the parent flips it on, THIS component is mounted. So this component's
//   job is only:
//     Level 1: list ALL senders grouped (all collapsed by default)
//     Level 2: per sender, expand to see that sender's messages
//
// Was: a 176px-scrolling strip that showed ~2 messages at a time and
// buried the rest. The new bundle-by-sender view fits dozens of senders
// without burial, and each sender opens on demand.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, UserPlus, X } from 'lucide-react'

// (Removed: an inner "Show / Hide" toggle that duplicated the outer one in
// app/crm/page.tsx. Ralph 2026-06-01.)

interface UnmatchedMessage {
  wa_message_id?: string | null
  phone?: string
  push_name?: string | null
  body?: string
  timestamp?: string
  media_path?: string | null
  media_mime?: string | null
}

interface SenderGroup {
  key: string
  phone: string
  displayName: string
  messages: UnmatchedMessage[]   // newest first
  latestTs: string
}

interface Props {
  /** Bumping this re-fetches the inbox (e.g. after the parent reloads data). */
  refreshKey?: number
  /** Create a lead from a message — parent POSTs the prospect, dismisses the
   *  message, reloads, and opens the new lead expanded. */
  onCreateLead: (phone: string, pushName: string, waMessageId: string) => Promise<void> | void
}

function senderKey(m: UnmatchedMessage): string {
  const phone = String(m.phone || '').replace(/\D+/g, '')
  if (phone) return 'p:' + phone
  const name = String(m.push_name || '').trim().toLowerCase()
  if (name) return 'n:' + name
  return 'unknown'
}

export function WaUnmatchedBanner({ refreshKey, onCreateLead }: Props) {
  const [messages, setMessages] = useState<UnmatchedMessage[]>([])
  // Per-sender expand state. The parent (app/crm/page.tsx) controls whether
  // this component is mounted at all via its outer Show/Hide button.
  const [expandedSenders, setExpandedSenders] = useState<Set<string>>(() => new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/crm/wa-unmatched', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setMessages(Array.isArray(data.messages) ? data.messages : [])
    } catch {
      /* offline / endpoint down — keep last */
    }
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])
  useEffect(() => {
    const id = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(id)
  }, [load])

  // Group messages by sender. Sort messages within each group newest-first;
  // sort groups by their newest-message timestamp.
  const groups = useMemo<SenderGroup[]>(() => {
    const map = new Map<string, SenderGroup>()
    for (const m of messages) {
      const k = senderKey(m)
      let g = map.get(k)
      if (!g) {
        g = {
          key: k,
          phone: m.phone || '',
          displayName: (m.push_name || m.phone || 'Unknown').toString(),
          messages: [],
          latestTs: '',
        }
        map.set(k, g)
      }
      g.messages.push(m)
    }
    const arr = Array.from(map.values()).map((g) => {
      const sorted = g.messages.slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      return { ...g, messages: sorted, latestTs: sorted[0]?.timestamp || '' }
    })
    arr.sort((a, b) => b.latestTs.localeCompare(a.latestTs))
    return arr
  }, [messages])

  const toggleSender = useCallback((k: string) => {
    setExpandedSenders((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])

  const dismissOne = useCallback(async (waMessageId: string) => {
    if (!waMessageId) return
    try {
      const res = await fetch(
        `/api/admin/crm/wa-unmatched?wa_message_id=${encodeURIComponent(waMessageId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error || `HTTP ${res.status}`)
      }
      void load()
    } catch (err) {
      console.error('[CRM] dismiss unmatched failed:', err)
      alert('Dismiss failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [load])

  const dismissAllFromSender = useCallback(async (g: SenderGroup) => {
    if (g.messages.length > 1 && !confirm(`Dismiss all ${g.messages.length} messages from ${g.displayName}?`)) return
    for (const m of g.messages) {
      if (m.wa_message_id) {
        try {
          await fetch(`/api/admin/crm/wa-unmatched?wa_message_id=${encodeURIComponent(m.wa_message_id)}`, { method: 'DELETE' })
        } catch (err) {
          console.warn('[CRM] bulk-dismiss failed for', m.wa_message_id, err)
        }
      }
    }
    void load()
  }, [load])

  const create = useCallback(async (g: SenderGroup) => {
    // Use the most recent message from the sender as the seed for the new lead.
    const latest = g.messages[0]
    if (!latest) return
    await onCreateLead(latest.phone || '', latest.push_name || '', latest.wa_message_id || '')
    void load()
  }, [onCreateLead, load])

  if (messages.length === 0) return null

  return (
    <div style={{ marginBottom: 12, border: '1px solid rgba(244,63,94,0.25)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
      {/* Count summary — static header (the outer Show/Hide lives in
          app/crm/page.tsx, so by the time this component mounts the user
          has already opted in to seeing the inbox). */}
      <div
        style={{
          padding: '8px 12px',
          background: 'rgba(244,63,94,0.10)',
          color: '#fb7185',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {messages.length} unmatched message{messages.length === 1 ? '' : 's'} from {groups.length} sender{groups.length === 1 ? '' : 's'}
      </div>

      {/* Sender list — all collapsed by default. */}
      <div>
          {groups.map((g) => {
            const isExpanded = expandedSenders.has(g.key)
            const latest = g.messages[0]
            const ts = (latest?.timestamp || '').slice(0, 16).replace('T', ' ')
            const body = latest?.body || ''
            const snippet = body.slice(0, 120) + (body.length > 120 ? '…' : '')
            const mediaCount = g.messages.filter((m) => m.media_path).length

            return (
              <div key={g.key} style={{ borderTop: '1px solid rgba(244,63,94,0.15)' }}>
                {/* Sender header — click toggles Level 2 (messages within) */}
                <div
                  className="crm-overview-row"
                  onClick={() => toggleSender(g.key)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="crm-overview-rail" style={{ background: '#ff6a4d' }} />
                  <div className="crm-overview-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
                        {isExpanded
                          ? <ChevronDown width={12} height={12} />
                          : <ChevronRight width={12} height={12} />}
                      </span>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fb7185', background: 'rgba(244,63,94,0.15)', padding: '1px 6px', borderRadius: 4 }}>
                        {g.messages.length}×
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>{g.displayName}</span>
                      {mediaCount > 0 && (
                        <span style={{ fontSize: 10, color: '#fbbf24', fontFamily: 'var(--font-mono, monospace)' }}>📎 {mediaCount}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {g.phone ? `+${g.phone} · ` : ''}latest {ts}
                    </div>
                    {!isExpanded && snippet.trim() && (
                      <div style={{ fontSize: 11, color: 'var(--text-main)', marginTop: 2, fontStyle: 'italic' }}>{`"${snippet}"`}</div>
                    )}
                  </div>
                  <div className="crm-overview-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="crm-overview-action-btn" title="Create new lead from this sender" onClick={() => { void create(g) }}>
                      <UserPlus width={14} height={14} />
                    </button>
                    <button type="button" className="crm-overview-action-btn" title="Dismiss all messages from this sender" onClick={() => { void dismissAllFromSender(g) }}>
                      <X width={14} height={14} />
                    </button>
                  </div>
                </div>

                {/* Level 2 — messages from this sender (only when sender expanded) */}
                {isExpanded && g.messages.map((m) => {
                  const mts = (m.timestamp || '').slice(0, 16).replace('T', ' ')
                  const mbody = m.body || ''
                  const mid = m.wa_message_id || ''
                  return (
                    <div
                      key={mid || `${g.key}-${mts}`}
                      className="crm-overview-row"
                      style={{ paddingLeft: 36, borderLeft: '2px solid rgba(255,106,77,0.15)', marginLeft: 14 }}
                    >
                      <div className="crm-overview-main">
                        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>
                          {mts}
                          {m.media_path && (
                            <span style={{ marginLeft: 6, color: '#fbbf24' }}>📎 {(m.media_mime || '').split('/')[0] || 'media'}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-main)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {mbody.trim() ? `"${mbody}"` : <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>(empty)</span>}
                        </div>
                      </div>
                      <div className="crm-overview-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="crm-overview-action-btn" title="Dismiss this message" onClick={() => { void dismissOne(mid) }}>
                          <X width={14} height={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
    </div>
  )
}
