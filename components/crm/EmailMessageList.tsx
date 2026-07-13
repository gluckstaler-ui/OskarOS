// ============================================================================
// EmailMessageList — middle-column view under the triage "Emails" filter.
// POSTMASTER PM-4 (spec §07). Mirrors WhatsAppMessageList exactly: E-mail
// In/Out activities grouped by prospect (the contacts table maps many
// addresses to one account), collapsible groups, all collapsed by default.
//
// POSTMASTER differences from the WA list:
//   · compose is at the TOP of an expanded group (the action leads, messages
//     follow), prefilled by the Consular's pending suggestion if one exists
//   · SEND EMAIL posts to /api/admin/crm/activities/email-outbound (PM-2)
//   · 📎 attach → uploads to media/{client}/ → rides the send
//   · DISCARD clears the pending suggestion (deleteSuggestion via the route)
//   · each message row is a <button> → onSelectProspect (opens LeadDetail)
//   · Enter = send, Shift+Enter = newline
//   · the EmailUnmatchedBanner (unknown senders) sits above the groups
// ============================================================================

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Mail, ChevronDown, ChevronRight, Paperclip, X, RefreshCw, Trash2 } from 'lucide-react'
import type { CrmActivity, Prospect } from '@/app/crm/crm-data'
import { EmailUnmatchedBanner } from './EmailUnmatchedBanner'

interface Props {
  activities: CrmActivity[]
  prospects: Prospect[]
  onSelectProspect: (id: string) => void
  onSent?: () => void          // parent reloads CRM data after a send
  loading?: boolean
}

interface Suggestion {
  prospect_id: string
  channel: string
  body: string
  subject?: string | null
  in_reply_to?: string | null
}

interface ClientGroup {
  prospectId: string
  company: string
  emails: string[]             // account identities (for the "N addresses" badge)
  messages: CrmActivity[]      // newest first
  latestTs: string
}

// Filippo 2026-07-13: full date-time always. Format is DD.MM.YYYY HH:MM in local
// time. No conditional short/long form — one rule everywhere in the CRM.
function dateTime(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (!Number.isFinite(d.getTime())) return ''
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export function EmailMessageList({ activities, prospects, onSelectProspect, onSent, loading }: Props) {
  const byId = useMemo(() => {
    const m = new Map<string, Prospect>()
    for (const p of prospects) m.set(p.id, p)
    return m
  }, [prospects])

  // Contacts per prospect — all email addresses from the contacts table.
  const [contactEmails, setContactEmails] = useState<Record<string, string[]>>({})

  const prospectIdsWithEmail = useMemo(() => {
    const ids = new Set<string>()
    for (const a of activities || []) {
      if (a.type === 'E-mail In' || a.type === 'E-mail Out') ids.add(a.prospect_id)
    }
    return Array.from(ids)
  }, [activities])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const result: Record<string, string[]> = {}
      await Promise.all(prospectIdsWithEmail.map(async (pid) => {
        try {
          const r = await fetch(`/api/admin/crm/prospects/${pid}/contacts`, { cache: 'no-store' })
          const d = (await r.json()) as { contacts?: { email?: string }[] }
          const emails = (d.contacts || []).map(c => c.email).filter(Boolean) as string[]
          if (emails.length) result[pid] = emails
        } catch { /* contacts unavailable — fall back to prospect.email */ }
      }))
      if (!cancelled) setContactEmails(result)
    }
    if (prospectIdsWithEmail.length) void load()
    return () => { cancelled = true }
  }, [prospectIdsWithEmail])

  const groups = useMemo<ClientGroup[]>(() => {
    const map = new Map<string, ClientGroup>()
    for (const a of activities || []) {
      if (a.type !== 'E-mail In' && a.type !== 'E-mail Out') continue
      let g = map.get(a.prospect_id)
      if (!g) {
        const p = byId.get(a.prospect_id)
        const ceEmails = contactEmails[a.prospect_id] || []
        const prospectEmail = p?.email ? [p.email] : []
        const allEmails = ceEmails.length > 0 ? ceEmails : prospectEmail
        const unique = [...new Set(allEmails)]
        g = {
          prospectId: a.prospect_id,
          company: p?.company || a.prospect_id,
          emails: unique,
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
  }, [activities, byId, contactEmails])

  const totalMessages = useMemo(() => groups.reduce((s, g) => s + g.messages.length, 0), [groups])

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  // EXPAND ALL is a shared toggle across ALL tabs. On the client tab it expands
  // every client group; on Inbox/Updates/Others it tells the banner to auto-
  // load every message body when a sender is opened. Same button, one truth.
  const [expandAllOn, setExpandAllOn] = useState(false)
  const allExpanded = expandAllOn
  const expandAll = useCallback(() => {
    setExpandAllOn(true)
    setExpanded(new Set(groups.map((g) => g.prospectId)))
  }, [groups])
  const collapseAll = useCallback(() => {
    setExpandAllOn(false)
    setExpanded(new Set())
  }, [])

  // CHECK EMAIL — manual sweep trigger (PM-10)
  const [sweepLabel, setSweepLabel] = useState('CHECK EMAIL')
  const [sweeping, setSweeping] = useState(false)
  const sweepTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const pollSweepStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/mail/status', { cache: 'no-store' })
      const d = (await r.json()) as { sweeping?: boolean; progress?: { phase?: string; folder?: string; done_n?: number; total_n?: number } }
      if (!d.sweeping) {
        setSweepLabel('✓ done')
        setSweeping(false)
        if (sweepTimer.current) { clearInterval(sweepTimer.current); sweepTimer.current = null }
        onSent?.()
        setTimeout(() => setSweepLabel('CHECK EMAIL'), 3000)
        return
      }
      const p = d.progress
      if (p?.phase === 'connecting') setSweepLabel('verbinde…')
      else if (p?.phase === 'listing') setSweepLabel(`${p.folder || 'INBOX'} listing…`)
      else if (p?.phase === 'downloading') setSweepLabel(`${p.folder || ''} ${p.done_n ?? 0}/${p.total_n ?? '?'}`)
      else if (p?.phase === 'filing') setSweepLabel('abgelegt…')
      else if (p?.phase === 'briefing') setSweepLabel('Consular liest…')
      else setSweepLabel('checking…')
    } catch { /* status unavailable — keep polling */ }
  }, [onSent])

  const triggerSweep = useCallback(async () => {
    if (sweeping) return
    setSweeping(true)
    setSweepLabel('verbinde…')
    try {
      fetch('/api/admin/mail/sweep', { method: 'POST' })
    } catch { /* fire-and-forget — status polling takes over */ }
    if (sweepTimer.current) clearInterval(sweepTimer.current)
    sweepTimer.current = setInterval(() => { void pollSweepStatus() }, 2000)
  }, [sweeping, pollSweepStatus])

  useEffect(() => () => { if (sweepTimer.current) clearInterval(sweepTimer.current) }, [])

  // Consular pending drafts, keyed by prospect_id (email channel).
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({})
  const loadSuggestions = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/crm/suggestions?channel=email', { cache: 'no-store' })
      const data = (await res.json()) as { suggestions?: Suggestion[] }
      const map: Record<string, Suggestion> = {}
      for (const s of data.suggestions || []) map[s.prospect_id] = s
      setSuggestions(map)
    } catch { /* prefill absent — compose starts empty */ }
  }, [])
  useEffect(() => { void loadSuggestions() }, [loadSuggestions])

  // Compose state per prospect. The textarea is controlled-with-default: its
  // effective value is the user's draft if they've touched it, else the
  // Consular's suggestion. NO seeding during render (that setState-in-render
  // is what caused the infinite re-render loop) — the fallback IS the seed.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [attachments, setAttachments] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState<Record<string, 'sending' | 'error'>>({})
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  // Effective compose value: user's edit wins (once defined, even ''), else the
  // suggestion body. `?? ` (not `||`) so a deliberately-cleared '' stays empty.
  const draftValue = useCallback(
    (id: string): string => drafts[id] ?? suggestions[id]?.body ?? '',
    [drafts, suggestions],
  )

  const latestThread = (g: ClientGroup) => {
    // most-recent inbound gives the in_reply_to + subject to thread on
    const lastIn = g.messages.find((m) => m.type === 'E-mail In')
    const sug = suggestions[g.prospectId]
    return {
      in_reply_to: sug?.in_reply_to || lastIn?.email_message_id || undefined,
      subject: sug?.subject || (lastIn?.subject ? (lastIn.subject.startsWith('Re:') ? lastIn.subject : `Re: ${lastIn.subject}`) : ''),
      to: g.emails[0] || '',
    }
  }

  const send = useCallback(async (g: ClientGroup) => {
    const id = g.prospectId
    const body = draftValue(id).trim()
    if (!body || busy[id] === 'sending') return
    const t = latestThread(g)
    if (!t.to) { alert('No email address on file for this client.'); return }
    setBusy((b) => ({ ...b, [id]: 'sending' }))
    try {
      const res = await fetch('/api/admin/crm/activities/email-outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: id, to: t.to, subject: t.subject, body,
          in_reply_to: t.in_reply_to, attachments: attachments[id] || [],
        }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error || `HTTP ${res.status}`)
      }
      setDrafts((d) => ({ ...d, [id]: '' }))
      setAttachments((a) => ({ ...a, [id]: [] }))
      setBusy((b) => { const n = { ...b }; delete n[id]; return n })
      await loadSuggestions()
      onSent?.()
    } catch (err) {
      setBusy((b) => ({ ...b, [id]: 'error' }))
      alert('Email send failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [draftValue, busy, attachments, suggestions, loadSuggestions, onSent])

  const discard = useCallback(async (id: string) => {
    setDrafts((d) => ({ ...d, [id]: '' }))
    try {
      await fetch('/api/admin/crm/suggestions/discard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: id, channel: 'email' }),
      })
      await loadSuggestions()
    } catch { /* best-effort */ }
  }, [loadSuggestions])

  // Delete one message — REAL delete on the mail server (Filippo 2026-07-13).
  // Server route looks up the message_id in the email_headers cache to find the
  // IMAP UID, moves the mail to Trash on the server, drops the cache row, AND
  // soft-deletes the activity so the CRM thread updates.
  // No confirm on single-message deletes; only bulk (thread) asks.
  const deleteMessage = useCallback(async (m: CrmActivity) => {
    try {
      const res = await fetch('/api/admin/mail/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: m.email_message_id || '', activityId: m.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSent?.()
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [onSent])

  // Delete the whole thread — every mail on the server + every activity row.
  const deleteThread = useCallback(async (g: ClientGroup) => {
    if (!window.confirm(`Delete all ${g.messages.length} emails on ${g.company}? They will be moved to your server's Trash.`)) return
    try {
      await Promise.all(g.messages.map(m =>
        fetch('/api/admin/mail/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: m.email_message_id || '', activityId: m.id }),
        })
      ))
      onSent?.()
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [onSent])

  const onPickFiles = useCallback(async (id: string, files: FileList | null) => {
    if (!files || !files.length) return
    const form = new FormData()
    form.append('prospect_id', id)
    for (const f of Array.from(files)) form.append('files', f)
    try {
      const res = await fetch('/api/admin/crm/attachments/upload', { method: 'POST', body: form })
      const data = (await res.json()) as { paths?: string[]; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setAttachments((a) => ({ ...a, [id]: [...(a[id] || []), ...(data.paths || [])] }))
    } catch (err) {
      alert('Attach failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  const base = (p: string) => p.split('/').pop() || p

  // ── Tabs: CLIENTS · INBOX · UPDATES · OTHERS ──
  // Filippo 2026-07-13: three-bucket split of unmatched senders.
  //   INBOX   — real 1:1 humans (needs your attention)
  //   UPDATES — transactional bulk (receipts, tickets, bookings, confirmations, invoices)
  //   OTHERS  — promotional bulk (newsletters, marketing, social digests)
  // Counts come from /api/admin/mail/status.
  const [tab, setTab] = useState<'clients' | 'inbox' | 'updates' | 'others'>('clients')
  const [inboxCount, setInboxCount] = useState<number>(0)
  const [updatesCount, setUpdatesCount] = useState<number>(0)
  const [othersCount, setOthersCount] = useState<number>(0)
  useEffect(() => {
    fetch('/api/admin/mail/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        if (typeof d.inbox_count === 'number') setInboxCount(d.inbox_count)
        if (typeof d.updates_count === 'number') setUpdatesCount(d.updates_count)
        if (typeof d.others_count === 'number') setOthersCount(d.others_count)
      })
      .catch(() => { /* counts stay 0 */ })
  }, [sweeping])

  const tabBtn = (key: 'clients' | 'inbox' | 'updates' | 'others', label: string) => (
    <button type="button" onClick={() => setTab(key)}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: '4px 2px', marginRight: 22,
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: tab === key ? 'var(--text-main)' : 'var(--text-dim)',
        borderBottom: tab === key ? '2px solid var(--brand-amber, #e89e16)' : '2px solid transparent',
      }}>
      {label}
    </button>
  )

  return (
    <div className="fp-list-card" aria-busy={loading}>
      {/* Filippo 2026-07-13: tabs REPLACE the "Email · N clients · M messages" title —
          Clients / Others live in the top row inline with CHECK EMAIL / EXPAND ALL. The
          polar theme's `.title { flex: 1 0 100% }` wraps children below — inline overrides. */}
      <div className="fp-list-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'nowrap' }}>
        <div className="title" style={{ flex: '0 1 auto', display: 'flex', alignItems: 'center', gap: 0 }}>
          <Mail width={14} height={14} style={{ marginRight: 12, color: '#f97316', flexShrink: 0 }} />
          {tabBtn('clients', `Clients ${groups.length ? `(${groups.length})` : ''}`)}
          {tabBtn('inbox',   `Inbox ${inboxCount ? `(${inboxCount})` : ''}`)}
          {tabBtn('updates', `Updates ${updatesCount ? `(${updatesCount})` : ''}`)}
          {tabBtn('others',  `Others ${othersCount ? `(${othersCount})` : ''}`)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={triggerSweep} disabled={sweeping}
            style={{ background: sweeping ? 'color-mix(in srgb, var(--brand-amber, #e89e16) 12%, transparent)' : 'transparent', border: '1px solid var(--brand-amber-dim, #7a6536)', color: 'var(--brand-amber, #e89e16)', padding: '3px 10px', borderRadius: 6, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', cursor: sweeping ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw width={10} height={10} style={sweeping ? { animation: 'spin 1s linear infinite' } : undefined} />
            {sweepLabel}
          </button>
          {/* Filippo 2026-07-13: shown on ALL tabs, not just when client groups exist.
              On unmatched tabs it gates the banner's auto-body-load behavior. */}
          <button type="button" onClick={allExpanded ? collapseAll : expandAll}
            style={{ background: 'transparent', border: '1px solid var(--border-card)', color: 'var(--text-muted)', padding: '3px 10px', borderRadius: 6, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer' }}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      {tab === 'inbox' ? (
        <div className="fp-list-scroll">
          <EmailUnmatchedBanner onChanged={onSent} bucket="inbox" expandAll={allExpanded} />
          {inboxCount === 0 && (
            <div style={{ padding: '32px 18px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              No unknown human senders.
            </div>
          )}
        </div>
      ) : tab === 'updates' ? (
        <div className="fp-list-scroll">
          <EmailUnmatchedBanner onChanged={onSent} bucket="updates" expandAll={allExpanded} />
          {updatesCount === 0 && (
            <div style={{ padding: '32px 18px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              No transactional mail.
            </div>
          )}
        </div>
      ) : tab === 'others' ? (
        <div className="fp-list-scroll">
          <EmailUnmatchedBanner onChanged={onSent} bucket="others" expandAll={allExpanded} />
          {othersCount === 0 && (
            <div style={{ padding: '32px 18px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              No newsletters or promo mail.
            </div>
          )}
        </div>
      ) : (
      <div className="fp-list-scroll">
        {groups.length === 0 && (
          <div style={{ padding: '32px 18px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
            No email yet. Configure the mailbox in Settings → Email, then Check Email.
          </div>
        )}

        {groups.map((g) => {
          const isOpen = expanded.has(g.prospectId)
          const latest = g.messages[0]
          const latestIn = latest?.type === 'E-mail In'
          const draft = draftValue(g.prospectId)
          const sending = busy[g.prospectId] === 'sending'
          const hasSuggestion = Boolean(suggestions[g.prospectId])
          const atts = attachments[g.prospectId] || []

          return (
            <div key={g.prospectId} style={{ borderBottom: '1px solid var(--border-card)' }}>
              {/* group header — grid with a delete (x) as a sibling of the expand-click. */}
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto 28px', gap: 12, alignItems: 'center', width: '100%', padding: '12px 18px', background: isOpen ? 'color-mix(in srgb, var(--brand-amber, #e89e16) 6%, transparent)' : 'transparent' }}>
                <button type="button" onClick={() => toggle(g.prospectId)}
                  style={{ display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                  {isOpen ? <ChevronDown width={14} height={14} /> : <ChevronRight width={14} height={14} />}
                </button>
                <button type="button" onClick={() => toggle(g.prospectId)}
                  style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text-main)', fontFamily: 'inherit', minWidth: 0, padding: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.company}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#f97316', background: 'rgba(249,115,22,0.10)', padding: '1px 6px', borderRadius: 4 }}>{g.messages.length}×</span>
                    {hasSuggestion && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--brand-amber, #e89e16)', border: '1px solid var(--brand-amber-dim, #7a6536)', padding: '1px 6px', borderRadius: 4 }}>draft ready</span>}
                  </div>
                  {!isOpen && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: latestIn ? '#f97316' : 'var(--text-dim)', marginRight: 6 }}>{latestIn ? '←' : '→'}</span>
                      {latest?.subject || (latest?.notes || '').slice(0, 80) || '(no subject)'}
                    </div>
                  )}
                </button>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)' }}>{dateTime(g.latestTs)}</span>
                <button type="button" onClick={() => void deleteThread(g)}
                  title={`Delete all ${g.messages.length} emails on ${g.company}`}
                  style={{ background: 'transparent', border: '1px solid var(--border-card)', color: 'var(--text-muted)', borderRadius: 4, width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                  <Trash2 width={12} height={12} />
                </button>
              </div>

              {isOpen && (
                <div>
                  {/* compose — at the TOP (the action leads) */}
                  <div style={{ padding: '10px 18px 14px 30px', borderTop: '1px dashed var(--border-card)' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.12em', color: hasSuggestion ? 'var(--brand-amber, #e89e16)' : 'var(--text-dim)', marginBottom: 6 }}>
                      {hasSuggestion ? 'CONSULAR PREFILLED THIS REPLY — discard, or edit & send' : 'REPLY'} · email · {g.company}
                    </div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [g.prospectId]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(g) } }}
                      placeholder="Write a reply…"
                      style={{ width: '100%', minHeight: 170, background: 'var(--bg-sunken, #13110d)', border: '1px solid var(--border-card)', borderRadius: 8, color: 'var(--text-main)', fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.55, padding: '10px 12px', resize: 'vertical' }}
                    />
                    {atts.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {atts.map((p, i) => (
                          <span key={p} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--brand-amber, #e89e16)', border: '1px solid var(--brand-amber-dim, #7a6536)', borderRadius: 5, padding: '1px 8px' }}>
                            📎 {base(p)}
                            <X width={10} height={10} style={{ cursor: 'pointer' }} onClick={() => setAttachments((a) => ({ ...a, [g.prospectId]: (a[g.prospectId] || []).filter((_, j) => j !== i) }))} />
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
                      <button type="button" onClick={() => void send(g)} disabled={sending}
                        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.06em', padding: '6px 14px', borderRadius: 7, border: '1px solid var(--brand-amber-dim, #7a6536)', color: 'var(--brand-amber, #e89e16)', background: 'transparent', cursor: 'pointer' }}>
                        {sending ? 'SENDING…' : '▶ SEND EMAIL'}
                      </button>
                      <input ref={(el) => { fileInputs.current[g.prospectId] = el }} type="file" multiple style={{ display: 'none' }}
                        onChange={(e) => { void onPickFiles(g.prospectId, e.target.files); e.currentTarget.value = '' }} />
                      <button type="button" onClick={() => fileInputs.current[g.prospectId]?.click()}
                        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border-card)', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Paperclip width={11} height={11} /> ATTACH
                      </button>
                      {hasSuggestion && (
                        <button type="button" onClick={() => void discard(g.prospectId)}
                          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border-card)', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}>
                          DISCARD
                        </button>
                      )}
                      <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--text-dim)' }}>Enter = send · Shift+Enter = newline</span>
                    </div>
                  </div>

                  {/* messages — each row opens the client card; (x) deletes just this row */}
                  {g.messages.map((m) => {
                    const inbound = m.type === 'E-mail In'
                    return (
                      <div key={m.id}
                        style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto 28px', gap: 12, width: '100%', padding: '9px 18px 9px 30px', borderTop: '1px solid var(--border-card)', color: 'var(--text-main)', fontSize: 12.5, alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 700, color: inbound ? '#f97316' : 'var(--text-dim)' }}>{inbound ? '←' : '→'}</span>
                        <button type="button" onClick={() => onSelectProspect(g.prospectId)}
                          title={`Open ${g.company}`}
                          style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: 12.5, padding: 0, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {m.subject && <b style={{ color: 'var(--text-main)', fontWeight: 600 }}>{m.subject}</b>}
                          {m.subject && m.notes ? <br /> : null}
                          {m.notes || ''}
                          {m.media_path && <span style={{ marginLeft: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--brand-amber, #e89e16)' }}>📎</span>}
                        </button>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{dateTime(m.timestamp)}</span>
                        <button type="button" onClick={() => void deleteMessage(m)}
                          title="Delete this email"
                          style={{ background: 'transparent', border: '1px solid var(--border-card)', color: 'var(--text-muted)', borderRadius: 4, width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                          <X width={12} height={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}
