// ============================================================================
// AttachmentsView — middle-column view under the triage "Attachments" filter.
// POSTMASTER PM-6 (spec §09). All activities with media_path grouped by
// client, sorted by most recent attachment date. Expand a client to see the
// file list. Click a file to preview/download. Click the client name to open
// the client card (LeadDetail).
// ============================================================================

import { useMemo, useState, useCallback } from 'react'
import { Paperclip, ChevronDown, ChevronRight, Image, FileText, File, Film, Music } from 'lucide-react'
import type { CrmActivity, Prospect } from '@/app/crm/crm-data'

interface Props {
  activities: CrmActivity[]
  prospects: Prospect[]
  onSelectProspect: (id: string) => void
  loading?: boolean
}

interface AttachmentFile {
  activityId: string
  path: string
  mime: string
  filename: string
  channel: 'email' | 'whatsapp' | 'other'
  direction: 'in' | 'out'
  timestamp: string
  subject?: string
}

interface ClientAttachments {
  prospectId: string
  company: string
  files: AttachmentFile[]
  latestTs: string
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

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function channelFromType(type: string): 'email' | 'whatsapp' | 'other' {
  if (type === 'E-mail In' || type === 'E-mail Out') return 'email'
  if (type.startsWith('WhatsApp')) return 'whatsapp'
  return 'other'
}

function directionFromType(type: string): 'in' | 'out' {
  return type.includes('In') ? 'in' : 'out'
}

function fileUrl(path: string): string {
  if (path.startsWith('/api/')) return path
  return `/api/admin/media/file?path=${encodeURIComponent(path)}`
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <Image width={14} height={14} />
  if (mime === 'application/pdf') return <FileText width={14} height={14} />
  if (mime.startsWith('video/')) return <Film width={14} height={14} />
  if (mime.startsWith('audio/')) return <Music width={14} height={14} />
  return <File width={14} height={14} />
}

function extractFilename(path: string): string {
  const last = path.split('/').pop() || path
  if (/^[a-f0-9]{64}\./i.test(last)) return last.slice(0, 12) + '…' + last.slice(last.lastIndexOf('.'))
  return last
}

const CHANNEL_LABEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', other: '—' }
const CHANNEL_COLOR: Record<string, string> = { email: '#f97316', whatsapp: '#22c55e', other: 'var(--text-dim)' }

export function AttachmentsView({ activities, prospects, onSelectProspect, loading }: Props) {
  const byId = useMemo(() => {
    const m = new Map<string, Prospect>()
    for (const p of prospects) m.set(p.id, p)
    return m
  }, [prospects])

  const groups = useMemo<ClientAttachments[]>(() => {
    const map = new Map<string, ClientAttachments>()
    for (const a of activities || []) {
      if (!a.media_path || !a.prospect_id) continue
      let g = map.get(a.prospect_id)
      if (!g) {
        const p = byId.get(a.prospect_id)
        g = {
          prospectId: a.prospect_id,
          company: p?.company || a.prospect_id,
          files: [],
          latestTs: '',
        }
        map.set(a.prospect_id, g)
      }
      g.files.push({
        activityId: a.id,
        path: a.media_path,
        mime: a.media_mime || 'application/octet-stream',
        filename: extractFilename(a.media_path),
        channel: channelFromType(a.type),
        direction: directionFromType(a.type),
        timestamp: a.timestamp || '',
        subject: a.subject,
      })
      if ((a.timestamp || '') > g.latestTs) g.latestTs = a.timestamp || ''
    }
    const out = Array.from(map.values())
    out.sort((a, b) => (b.latestTs > a.latestTs ? 1 : -1))
    for (const g of out) g.files.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    return out
  }, [activities, byId])

  const totalFiles = useMemo(() => groups.reduce((s, g) => s + g.files.length, 0), [groups])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = useCallback((id: string) => {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const allExpanded = groups.length > 0 && groups.every((g) => expanded.has(g.prospectId))
  const expandAll = useCallback(() => setExpanded(new Set(groups.map((g) => g.prospectId))), [groups])
  const collapseAll = useCallback(() => setExpanded(new Set()), [])

  return (
    <div className="fp-list-card" aria-busy={loading}>
      {/* Filippo 2026-07-13: buttons RIGHT of the title, one line — polar's
          `.title { flex: 1 0 100% }` would wrap them below; inline overrides. */}
      <div className="fp-list-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'nowrap' }}>
        <div className="title" style={{ flex: '0 1 auto' }}>
          <Paperclip width={14} height={14} style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--brand-amber, #e89e16)' }} />
          Attachments · {groups.length} {groups.length === 1 ? 'client' : 'clients'} · {totalFiles} {totalFiles === 1 ? 'file' : 'files'}
        </div>
        {groups.length > 1 && (
          <button type="button" onClick={allExpanded ? collapseAll : expandAll}
            style={{ background: 'transparent', border: '1px solid var(--border-card)', color: 'var(--text-muted)', padding: '3px 10px', borderRadius: 6, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer' }}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      <div className="fp-list-scroll">
        {groups.length === 0 && (
          <div style={{ padding: '32px 18px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
            No attachments yet.
          </div>
        )}

        {groups.map((g) => {
          const isOpen = expanded.has(g.prospectId)
          const latest = g.files[0]

          return (
            <div key={g.prospectId} style={{ borderBottom: '1px solid var(--border-card)' }}>
              <button type="button" onClick={() => toggle(g.prospectId)}
                style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 12, alignItems: 'center', width: '100%', padding: '12px 18px', background: isOpen ? 'color-mix(in srgb, var(--brand-amber, #e89e16) 6%, transparent)' : 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text-main)', fontFamily: 'inherit' }}>
                <span style={{ display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  {isOpen ? <ChevronDown width={14} height={14} /> : <ChevronRight width={14} height={14} />}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.company}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--brand-amber, #e89e16)', background: 'rgba(249,115,22,0.10)', padding: '1px 6px', borderRadius: 4 }}>{pad(g.files.length)} files</span>
                  </div>
                  {!isOpen && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📎 {latest.filename}
                      <span style={{ marginLeft: 8, fontSize: 10, color: CHANNEL_COLOR[latest.channel] }}>{CHANNEL_LABEL[latest.channel]}</span>
                    </div>
                  )}
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)' }}>{timeAgo(g.latestTs)}</span>
              </button>

              {isOpen && (
                <div>
                  <div style={{ padding: '4px 18px 8px 30px' }}>
                    <button type="button" onClick={() => onSelectProspect(g.prospectId)}
                      style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.06em', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-card)', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}>
                      OPEN CLIENT CARD →
                    </button>
                  </div>

                  {g.files.map((f) => (
                    <a key={f.activityId} href={fileUrl(f.path)} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'grid', gridTemplateColumns: '20px 14px 1fr auto auto auto', gap: 8, alignItems: 'center', width: '100%', padding: '8px 18px 8px 30px', borderTop: '1px solid var(--border-card)', textDecoration: 'none', color: 'var(--text-main)', fontSize: 12, cursor: 'pointer' }}>
                      <span style={{ fontWeight: 700, color: f.direction === 'in' ? CHANNEL_COLOR[f.channel] : 'var(--text-dim)' }}>
                        {f.direction === 'in' ? '←' : '→'}
                      </span>
                      <span style={{ color: CHANNEL_COLOR[f.channel], display: 'inline-flex' }}>
                        {fileIcon(f.mime)}
                      </span>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                        {f.filename}
                      </span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: CHANNEL_COLOR[f.channel], opacity: 0.7 }}>
                        {CHANNEL_LABEL[f.channel]}
                      </span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {timeAgo(f.timestamp)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
