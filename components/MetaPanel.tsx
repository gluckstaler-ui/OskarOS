'use client'

// ============================================================================
// MetaPanel — the META tab in the Assets panel.
//   • SEO        : page title, meta description, search terms (→ <meta keywords>)
//                  + a deep link into Google Search Console for this property.
//   • Translations: one accordion row per data-i18n element; expand to see/edit
//                  the languages. English is the indexed source (read-only here —
//                  edit it on the canvas via Director Mode); DE/HR/IT are the
//                  client-side "flavoring" and write back into the inline I18N
//                  block. All edits go through /api/director/meta (surgical,
//                  byte-stable writes).
// ============================================================================

import { useState, useEffect, useCallback, memo } from 'react'

interface Row { key: string; en: string; de: string | null; hr: string | null; it: string | null }
interface MetaData {
  seo: { title: string; description: string; keywords: string; canonical: string }
  languages: string[]
  sourceLang?: string
  rows: Row[]
}

const LANG_LABEL: Record<string, string> = { en: 'EN', de: 'DE', hr: 'HR', it: 'IT' }

export function MetaPanel({ sessionId, files }: { sessionId: string; files?: string[] }) {
  const [pages, setPages] = useState<string[]>(files && files.length ? files : [])
  const [file, setFile] = useState<string>('')
  const path = file ? `/${sessionId}/${file}` : ''

  // Discover the session's editable .html pages; default to index.html (or the first).
  useEffect(() => {
    let alive = true
    fetch(`/api/director/meta?session=${encodeURIComponent(sessionId)}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        const list: string[] = (d.files?.length ? d.files : (files ?? [])) as string[]
        setPages(list)
        setFile(prev => prev || list.find(f => /index\.html?$/i.test(f)) || list[0] || 'index.html')
      })
      .catch(() => { if (alive) setFile(prev => prev || 'index.html') })
    return () => { alive = false }
  }, [sessionId])

  const [data, setData] = useState<MetaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!path) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/director/meta?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) { setError(String((e as Error).message)) }
    setLoading(false)
  }, [path])

  useEffect(() => { load() }, [load])

  const patch = useCallback(async (body: Record<string, unknown>, tag: string) => {
    setSaving(tag)
    try {
      const res = await fetch('/api/director/meta', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ...body }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    } catch (e) { setError(String((e as Error).message)) }
    setSaving(null)
  }, [path])

  const saveSeo = (field: string, value: string) => {
    if (!data) return
    if (value === (data.seo as Record<string, string>)[field]) return
    setData({ ...data, seo: { ...data.seo, [field]: value } })
    patch({ op: 'seo', field, value }, `seo:${field}`)
  }
  // One schema-aware save path for every editable language cell — source AND flavor.
  // The server routes per file: flat .dc → flat-map / German-source write; legacy → DOM/nested.
  // Editing the German source of a flat text row renames its key (German IS the key),
  // so we re-key the row locally to keep subsequent edits targeting the right entry.
  const saveCell = (key: string, lang: string, value: string) => {
    if (!data) return
    const renames = sourceLang !== 'en' && lang === sourceLang && !key.startsWith('@')
    const newKey = renames ? value : key
    setData({ ...data, rows: data.rows.map(r => r.key === key ? { ...r, [lang]: value, key: newKey } : r) })
    if (newKey !== key) setExpanded(prev => {
      if (!prev.has(key)) return prev
      const n = new Set(prev); n.delete(key); n.add(newKey); return n
    })
    patch({ op: 'cell', key, lang, value }, `${key}:${lang}`)
  }

  const toggle = (key: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  const sourceLang = data?.sourceLang || 'en'
  const editableLangs = (data?.languages ?? ['en', 'de', 'hr', 'it']).filter(l => l !== sourceLang)
  const cell = (r: Row, l: string) => (r as unknown as Record<string, string | null>)[l]
  const gscDomain = (data?.seo.canonical || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const gscUrl = gscDomain
    ? `https://search.google.com/search-console?resource_id=sc-domain:${gscDomain}`
    : 'https://search.google.com/search-console'

  const rows = (data?.rows ?? []).filter(r => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return r.key.toLowerCase().includes(q) || (r.en || '').toLowerCase().includes(q)
  })
  const incomplete = (data?.rows ?? []).filter(r => editableLangs.some(l => !cell(r, l))).length

  const pageBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--border-card)', flexWrap: 'wrap', flexShrink: 0 }}>
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Page</span>
      {pages.length > 1 ? (
        <select value={file} onChange={e => setFile(e.target.value)}
          style={{ ...inputBase, width: 'auto', maxWidth: '62%', cursor: 'pointer', padding: '6px 8px' }}>
          {pages.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      ) : (
        <code style={{ fontSize: 12, color: 'var(--text-main)' }}>{file || '…'}</code>
      )}
      {saving && <span style={{ fontSize: 10, color: '#10b981' }}>saving…</span>}
      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)' }}>
        {sourceLang === 'de' ? 'DE source · EN flavoring' : 'EN indexed · DE/HR/IT flavoring'}
      </span>
    </div>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {pageBar}
      {loading ? (
        <Pad><Dim>Loading meta…</Dim></Pad>
      ) : error && !data ? (
        <Pad><Dim style={{ color: '#ef4444' }}>Error: {error}</Dim> <button onClick={load} style={btn}>Retry</button></Pad>
      ) : !data ? (
        <Pad><Dim>No page selected.</Dim></Pad>
      ) : (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {error && <div style={{ fontSize: 11, color: '#ef4444' }}>{error}</div>}

      {/* ── SEO ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>SEO</SectionTitle>
        <Field label="Page title" hint={`${data.seo.title.length} chars`}>
          <Input defaultValue={data.seo.title} onBlur={v => saveSeo('title', v)} />
        </Field>
        <Field label="Meta description" hint={`${data.seo.description.length} chars`}>
          <Area defaultValue={data.seo.description} onBlur={v => saveSeo('description', v)} />
        </Field>
        <Field label="Search terms" hint="→ meta keywords, comma-separated">
          <Area defaultValue={data.seo.keywords} onBlur={v => saveSeo('keywords', v)} />
        </Field>
        <a href={gscUrl} target="_blank" rel="noopener noreferrer" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6,
          fontSize: 11, fontWeight: 600, color: '#10b981', textDecoration: 'none',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          Open in Google Search Console{gscDomain ? ` — ${gscDomain}` : ''} →
        </a>
      </section>

      {/* ── Translations ────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>
          Translations <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
            · {data.rows.length} elements{incomplete > 0 ? ` · ${incomplete} incomplete` : ' · all complete'}
          </span>
        </SectionTitle>
        <input
          value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by text or key…"
          style={{ ...inputBase, marginBottom: 8 }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map(r => {
            const open = expanded.has(r.key)
            const complete = editableLangs.every(l => cell(r, l))
            const headText = cell(r, sourceLang) || r.en
            return (
              <div key={r.key} style={{ border: '1px solid var(--border-card)', borderRadius: 8, overflow: 'hidden' }}>
                <button onClick={() => toggle(r.key)} style={rowHead}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, backgroundColor: complete ? '#10b981' : '#f59e0b' }} />
                  <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-main)' }}
                    dangerouslySetInnerHTML={{ __html: headText || '<em style="opacity:.5">(empty)</em>' }} />
                  <span style={{ color: 'var(--text-dim)', flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>
                </button>
                {open && (
                  <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-card)', background: 'var(--bg-app)' }}>
                    {[sourceLang, ...editableLangs].map(l => (
                      <LangRow key={l} label={LANG_LABEL[l] || l.toUpperCase()}
                        sub={l === sourceLang ? 'source' : undefined}
                        value={cell(r, l) || ''}
                        saving={saving === `${r.key}:${l}`}
                        onBlur={v => saveCell(r.key, l, v)} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {rows.length === 0 && <Dim>No elements match “{filter}”.</Dim>}
        </div>
      </section>
      </div>
      )}
    </div>
  )
}

// ── small styled bits ──────────────────────────────────────────────────────
const inputBase: React.CSSProperties = {
  width: '100%', padding: '7px 9px', fontSize: 12, color: 'var(--text-main)',
  background: 'var(--bg-app)', border: '1px solid var(--border-card)', borderRadius: 6, outline: 'none', boxSizing: 'border-box',
}
const btn: React.CSSProperties = { ...inputBase, width: 'auto', cursor: 'pointer', marginTop: 8 }
const rowHead: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
  background: 'var(--bg-card)', border: 'none', cursor: 'pointer', fontSize: 12,
}

const Pad = ({ children }: { children: React.ReactNode }) => <div style={{ padding: 20 }}>{children}</div>
const Dim = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) =>
  <div style={{ fontSize: 12, color: 'var(--text-dim)', ...style }}>{children}</div>
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-main)', marginBottom: 10 }}>{children}</div>
)
const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-main)' }}>{label}</span>
      {hint && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{hint}</span>}
    </div>
    {children}
  </div>
)

const Input = memo(function Input({ defaultValue, onBlur }: { defaultValue: string; onBlur: (v: string) => void }) {
  const [v, setV] = useState(defaultValue)
  useEffect(() => setV(defaultValue), [defaultValue])
  return <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onBlur(v)} style={inputBase} />
})
const Area = memo(function Area({ defaultValue, onBlur }: { defaultValue: string; onBlur: (v: string) => void }) {
  const [v, setV] = useState(defaultValue)
  useEffect(() => setV(defaultValue), [defaultValue])
  return <textarea value={v} onChange={e => setV(e.target.value)} onBlur={() => onBlur(v)} rows={2} style={{ ...inputBase, resize: 'vertical', lineHeight: 1.4 }} />
})

function LangRow({ label, sub, value, readOnly, saving, onBlur }: {
  label: string; sub?: string; value: string; readOnly?: boolean; saving?: boolean; onBlur?: (v: string) => void
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ width: 64, flexShrink: 0, paddingTop: 6 }}>
        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, fontWeight: 700, color: readOnly ? 'var(--text-dim)' : 'var(--text-main)' }}>
          {label}{saving && <span style={{ color: '#10b981' }}> ●</span>}
        </div>
        {sub && <div style={{ fontSize: 8, color: 'var(--text-dim)', lineHeight: 1.2 }}>{sub}</div>}
      </div>
      <textarea
        value={v} onChange={e => setV(e.target.value)} onBlur={() => !readOnly && onBlur?.(v)}
        readOnly={readOnly} rows={2}
        style={{ ...inputBase, flex: 1, resize: 'vertical', lineHeight: 1.4, opacity: readOnly ? 0.6 : 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}
      />
    </div>
  )
}
