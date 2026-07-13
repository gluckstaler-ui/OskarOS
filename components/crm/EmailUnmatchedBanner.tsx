// ============================================================================
// EmailUnmatchedBanner — Inbox / Updates / Others tab body.
//
// Filippo 2026-07-13, corrected rules (previous versions lied about their behavior):
//   · emails are stored ONLY for clients. This tab reads the email_headers
//     cache (envelopes only) — no live IMAP per open
//   · default: click a sender → subjects list. Click a subject → body loads.
//   · when the parent's EXPAND ALL is on: opening a sender auto-loads every
//     body in parallel
//   · HTML rendered inline (sanitized server-side), NO iframe
//   · (x) on sender OR message = REAL delete: IMAP move-to-Trash + drop cache row
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'

interface Unmatched { id: string; path: string; from: string; subject: string; date: string; bucket?: 'inbox' | 'updates' | 'others' }
interface Body { text: string; html: string | null; from: string; to: string; subject: string; attachments: { name: string; size: number; contentId?: string; contentType?: string; dataUrl?: string }[] }

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from)
  return (m ? m[1] : from).trim().toLowerCase()
}
function nameOf(from: string): string {
  const before = from.split('<')[0].trim().replace(/^"|"$/g, '')
  return before || addressOf(from)
}
function dateTime(ts: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (!Number.isFinite(d.getTime())) return ''
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

interface SenderGroup {
  address: string
  displayName: string
  messages: Unmatched[]
  latestTs: string
}

// Inline HTML render (sanitized server-side). NO iframe.
function BodyView({ body }: { body: Body }) {
  if (body.html) {
    return (
      <div className="fp-mail-body"
        style={{ padding: '8px 4px', color: 'var(--text-main)', fontSize: 13, lineHeight: 1.5, overflowWrap: 'break-word', wordBreak: 'break-word' }}
        dangerouslySetInnerHTML={{ __html: body.html }} />
    )
  }
  return (
    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-main)' }}>
      {body.text || '(empty body)'}
    </pre>
  )
}

export function EmailUnmatchedBanner({ bucket, expandAll = false }: { onChanged?: () => void; defaultOpen?: boolean; bucket?: 'inbox' | 'updates' | 'others'; expandAll?: boolean }) {
  const [items, setItems] = useState<Unmatched[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [openBodies, setOpenBodies] = useState<Set<string>>(() => new Set())
  const [bodies, setBodies] = useState<Record<string, Body | 'loading' | 'error'>>({})
  const [busyDelete, setBusyDelete] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/mail/unmatched', { cache: 'no-store' })
      const data = (await res.json()) as { unmatched?: Unmatched[] }
      setItems(data.unmatched || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const groups = useMemo<SenderGroup[]>(() => {
    const map = new Map<string, SenderGroup>()
    for (const u of items) {
      if (bucket && u.bucket !== bucket) continue
      const addr = addressOf(u.from)
      if (!addr) continue
      let g = map.get(addr)
      if (!g) {
        g = { address: addr, displayName: nameOf(u.from), messages: [], latestTs: '' }
        map.set(addr, g)
      }
      g.messages.push(u)
      if (g.displayName === addr) g.displayName = nameOf(u.from)
    }
    const arr = Array.from(map.values()).map(g => {
      const sorted = g.messages.slice().sort((a, b) => b.date.localeCompare(a.date))
      return { ...g, messages: sorted, latestTs: sorted[0]?.date || '' }
    })
    arr.sort((a, b) => b.latestTs.localeCompare(a.latestTs))
    return arr
  }, [items, bucket])

  const fetchBody = useCallback(async (path: string) => {
    setBodies((prev) => (prev[path] && prev[path] !== 'error' ? prev : { ...prev, [path]: 'loading' }))
    try {
      const res = await fetch(`/api/admin/mail/message?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Body
      setBodies((prev) => ({ ...prev, [path]: data }))
    } catch {
      setBodies((prev) => ({ ...prev, [path]: 'error' }))
    }
  }, [])

  // Click sender header. Only auto-loads bodies when expandAll is on.
  const toggleSender = useCallback((g: SenderGroup) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(g.address)) { next.delete(g.address); return next }
      next.add(g.address)
      if (expandAll) {
        setOpenBodies((ob) => {
          const nb = new Set(ob)
          for (const m of g.messages) nb.add(m.path)
          return nb
        })
        for (const m of g.messages) {
          const cached = bodies[m.path]
          if (!cached || cached === 'error') void fetchBody(m.path)
        }
      }
      return next
    })
  }, [expandAll, bodies, fetchBody])

  // Click a single subject → toggle body open/closed, load on first open.
  const toggleBody = useCallback((path: string) => {
    setOpenBodies((prev) => {
      const next = new Set(prev)
      if (next.has(path)) { next.delete(path); return next }
      next.add(path)
      const cached = bodies[path]
      if (!cached || cached === 'error') void fetchBody(path)
      return next
    })
  }, [bodies, fetchBody])

  // DELETE one message — real IMAP move-to-Trash + drop cache row.
  // No confirm on single-message deletes (Filippo 2026-07-13); only bulk asks.
  const deleteMessage = useCallback(async (u: Unmatched) => {
    setBusyDelete(u.id)
    try {
      const res = await fetch('/api/admin/mail/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      setItems((prev) => prev.filter(x => x.id !== u.id))
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally { setBusyDelete(null) }
  }, [])

  // DELETE every message from a sender — real IMAP move-to-Trash + drop cache rows.
  const deleteSender = useCallback(async (g: SenderGroup) => {
    if (!window.confirm(`Delete all ${g.messages.length} emails from ${g.displayName}? They will be moved to your server's Trash.`)) return
    setBusyDelete(g.address)
    try {
      const res = await fetch('/api/admin/mail/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: g.address }),
      })
      if (!res.ok) throw new Error(await res.text())
      const ids = new Set(g.messages.map(m => m.id))
      setItems((prev) => prev.filter(x => !ids.has(x.id)))
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally { setBusyDelete(null) }
  }, [])

  if (loading && groups.length === 0) {
    return <div style={{ padding: '20px 18px', color: 'var(--text-muted)', fontSize: 12 }}>Loading from cache…</div>
  }
  if (groups.length === 0) return null

  return (
    <div>
      {groups.map((g) => {
        const isOpen = expanded.has(g.address)
        return (
          <div key={g.address} style={{ borderBottom: '1px solid var(--border-card)' }}>
            {/* sender row */}
            <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto 28px', gap: 10, alignItems: 'center', width: '100%', padding: '10px 18px', background: isOpen ? 'color-mix(in srgb, var(--brand-amber, #e89e16) 5%, transparent)' : 'transparent' }}>
              <button type="button" onClick={() => toggleSender(g)}
                style={{ display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                {isOpen ? <ChevronDown width={14} height={14} /> : <ChevronRight width={14} height={14} />}
              </button>
              <button type="button" onClick={() => toggleSender(g)}
                style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text-main)', fontFamily: 'inherit', minWidth: 0, padding: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.displayName}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#f97316', background: 'rgba(249,115,22,0.10)', padding: '1px 6px', borderRadius: 4 }}>{g.messages.length}×</span>
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.address}</div>
              </button>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{dateTime(g.latestTs)}</span>
              <button type="button" onClick={() => void deleteSender(g)} disabled={busyDelete === g.address}
                title={`Delete all ${g.messages.length} mails from ${g.displayName} (moves to server Trash)`}
                style={{ background: 'transparent', border: '1px solid var(--border-card)', color: 'var(--text-muted)', borderRadius: 4, width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                <X width={12} height={12} />
              </button>
            </div>

            {/* expanded — subject list; body opens per-click OR auto if expandAll is on */}
            {isOpen && (
              <div>
                {g.messages.map((m) => {
                  const isBodyOpen = openBodies.has(m.path)
                  const body = bodies[m.path]
                  return (
                    <div key={m.path} style={{ borderTop: '1px solid var(--border-card)' }}>
                      {/* subject row — click subject to open body, (x) to delete */}
                      <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto 28px', gap: 10, padding: '8px 18px 8px 48px', fontSize: 12, alignItems: 'baseline' }}>
                        <span style={{ color: '#f97316', fontWeight: 700 }}>←</span>
                        <button type="button" onClick={() => toggleBody(m.path)}
                          style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0, whiteSpace: 'normal', wordBreak: 'break-word', minWidth: 0 }}>
                          {m.subject || <span style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontWeight: 400 }}>(no subject)</span>}
                        </button>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{dateTime(m.date)}</span>
                        <button type="button" onClick={() => void deleteMessage(m)} disabled={busyDelete === m.id}
                          title="Delete this email (moves to server Trash)"
                          style={{ background: 'transparent', border: '1px solid var(--border-card)', color: 'var(--text-muted)', borderRadius: 4, width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                          <X width={12} height={12} />
                        </button>
                      </div>

                      {/* body — opens only when the subject was clicked OR expandAll */}
                      {isBodyOpen && (
                        <div style={{ padding: '2px 18px 14px 48px', background: 'var(--bg-sunken, #13110d)', borderTop: '1px dashed var(--border-card)' }}>
                          {body === 'loading' && <div style={{ color: 'var(--text-dim)', padding: '10px 0', fontSize: 12 }}>Loading…</div>}
                          {body === 'error' && <div style={{ color: '#e88', padding: '10px 0', fontSize: 12 }}>Failed to load.</div>}
                          {body && body !== 'loading' && body !== 'error' && (
                            <>
                              <BodyView body={body} />
                              {body.attachments.filter(a => !a.contentId).length > 0 && (
                                <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--brand-amber, #e89e16)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {body.attachments.filter(a => !a.contentId).map((a, i) => (
                                    <span key={i} style={{ border: '1px solid var(--brand-amber-dim, #7a6536)', padding: '2px 8px', borderRadius: 5 }}>📎 {a.name} ({Math.round(a.size / 1024)}KB)</span>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
