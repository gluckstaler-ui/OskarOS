'use client'

/**
 * CrmLeadLinker — content of the CRM subtab when the current session has
 * no `prospect_id` in its `_session-config.json` yet. WP-CRM-C1 (Ralph
 * 2026-05-22).
 *
 * Typeahead-style picker: Filippo types a company fragment, the list of
 * prospects from the CRM Excel is filtered by case-insensitive substring
 * match against `company`. Clicking one POSTs to `/api/sessions/[id]/config`
 * to write `prospect_id`, then notifies the parent to refresh — at which
 * point the parent re-derives `prospectId` from the now-up-to-date scan
 * and renders <CrmLeadPanel/> in this same subtab.
 *
 * No new endpoint (per WP-C1 spec): GETs `/api/admin/crm/prospects`,
 * POSTs to the existing per-session config writer. The config writer was
 * extended to allow `prospect_id` in its allowed-fields list and to
 * invalidate the LinksMap cache on touch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface ProspectLite {
  id: string
  company: string
  contact_name?: string
  stage?: string
}

interface CrmLeadLinkerProps {
  sessionId: string
  /** Called after a successful link write so the parent re-fetches the
   *  scan and swaps this picker out for <CrmLeadPanel/>. */
  onLinked: (prospectId: string) => void
}

export function CrmLeadLinker({ sessionId, onLinked }: CrmLeadLinkerProps) {
  const [prospects, setProspects] = useState<ProspectLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [linking, setLinking] = useState<string | null>(null)

  // Load the full prospect list once on mount. ~50 rows is well within
  // the budget for a single fetch; no pagination needed.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/admin/crm/prospects')
      .then(r => r.json())
      .then((data: { prospects?: ProspectLite[] }) => {
        if (cancelled) return
        setProspects(data.prospects ?? [])
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Debounce isn't useful when filtering 50 rows in-memory; do it live.
  // Cap at 8 results so the list stays scannable.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return prospects.slice(0, 8)
    return prospects
      .filter(p =>
        p.company.toLowerCase().includes(q) ||
        (p.contact_name ?? '').toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [prospects, query])

  const link = useCallback(async (prospectId: string) => {
    setLinking(prospectId)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      onLinked(prospectId)
    } catch (err) {
      console.error('[CrmLeadLinker] link failed:', err)
      setError(err instanceof Error ? err.message : String(err))
      setLinking(null)
    }
  }, [sessionId, onLinked])

  return (
    <div style={{
      flex: 1, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      padding: '20px',
      overflowY: 'auto',
    }}>
      <div style={{ marginBottom: '14px' }}>
        <div style={{
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          fontWeight: 700,
          color: 'var(--text-main)',
          marginBottom: '6px',
        }}>
          Link to CRM lead
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          This session isn&rsquo;t tied to a CRM prospect yet. Pick one to
          enable the lead detail panel for the rest of the discovery.
        </div>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Type a company, contact, or P-id…"
        autoFocus
        style={{
          background: 'var(--bg-app)',
          border: '1px solid var(--border-card)',
          borderRadius: '5px',
          padding: '8px 10px',
          fontSize: '12px',
          color: 'var(--text-main)',
          width: '100%',
          fontFamily: 'var(--font-sans, system-ui)',
          marginBottom: '10px',
        }}
      />

      {loading && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Loading prospects…
        </div>
      )}

      {error && (
        <div style={{ fontSize: '11px', color: '#fb7185', fontFamily: 'var(--font-mono)' }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {query.trim()
            ? `No prospects match "${query.trim()}".`
            : 'No prospects in the CRM yet — add one via /admin.html.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {filtered.map(p => (
            <button
              key={p.id}
              onClick={() => link(p.id)}
              disabled={linking !== null}
              style={{
                background: 'var(--bg-app)',
                border: '1px solid var(--border-card)',
                borderRadius: '5px',
                padding: '8px 12px',
                fontSize: '12px',
                color: 'var(--text-main)',
                cursor: linking === null ? 'pointer' : 'default',
                opacity: linking !== null && linking !== p.id ? 0.5 : 1,
                textAlign: 'left',
                fontFamily: 'var(--font-sans, system-ui)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <span>
                <span style={{ fontWeight: 600 }}>{p.company || '(no company)'}</span>
                {p.contact_name && (
                  <span style={{ color: 'var(--text-muted)' }}>{' · '}{p.contact_name}</span>
                )}
              </span>
              <span style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                {linking === p.id ? 'linking…' : p.id}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{
        marginTop: '14px',
        fontSize: '10px',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
      }}>
        Showing {filtered.length} of {prospects.length} prospects
      </div>
    </div>
  )
}
