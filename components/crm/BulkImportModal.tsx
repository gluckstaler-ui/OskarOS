'use client'

// ============================================================================
// BulkImportModal — paste CSV/TSV/vCard/numbered-list or upload .csv/.tsv/.xlsx,
// map columns → fields, dedup-preview, bulk-insert. Port of crm.html crmBulk*.
// The parse/map/dedup logic is REUSED 1:1 from lib/crm-parsers (client-safe —
// it only type-imports Prospect). Server round-trips only for:
//   · POST /api/admin/crm/parse           — xlsx decode + existing identities
//   · POST /api/admin/crm/prospects/bulk  — the actual insert
// Styled by the shared crm.css .crm-bulk-* / .crm-modal-* classes; the few
// Tailwind-only bits from crm.html are inlined (the React app has no Tailwind).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, X, Paperclip } from 'lucide-react'
import {
  applyMapping,
  detectDuplicates,
  type ParseResult,
  type ProspectField,
  type DuplicateMatch,
} from '@/lib/crm-parsers'

interface Props {
  onClose: () => void
  /** Parent reloads CRM data after a successful import. */
  onImported: () => void
  /**
   * Where the import lands. WP-SCOUT-6 (Ralph 2026-06-03):
   *   - 'prospects' (default) — Kanban pipeline; the existing /prospects/bulk flow.
   *   - 'pool'                — Scout pre-Kanban pool (raw_prospects); goes through
   *                             /raw-prospects with the spec's dedup-vs-both guard.
   * The target can be flipped by the user inside the modal (see the picker
   * in the defaults row), or pinned by the parent (e.g. the Scout view
   * opens this modal pinned to 'pool').
   */
  initialTarget?: 'prospects' | 'pool'
}

type ImportTarget = 'prospects' | 'pool'

interface ExistingIdentity { id: string; phone: string; email: string }
type Candidate = Record<string, unknown>

const FIELD_OPTIONS: { value: ProspectField | ''; label: string }[] = [
  { value: '', label: '— (skip) —' },
  { value: 'company', label: 'Company *' },
  { value: 'contact_name', label: 'Contact name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'E-mail' },
  { value: 'website', label: 'Website' },
  { value: 'amount_chf', label: 'Amount (CHF)' },
  { value: 'confidence_pct', label: 'Confidence %' },
  { value: 'notes', label: 'Notes' },
  { value: 'tags', label: 'Tags' },
]
const BULK_FIELDS: ProspectField[] = ['company', 'contact_name', 'phone', 'email', 'website', 'amount_chf', 'confidence_pct', 'notes', 'tags']

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

export function BulkImportModal({ onClose, onImported, initialTarget = 'prospects' }: Props) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [existing, setExisting] = useState<ExistingIdentity[]>([])
  const [vcardDups, setVcardDups] = useState<DuplicateMatch[] | null>(null)
  const [mapping, setMapping] = useState<Record<number, ProspectField | null>>({})
  const [skipDup, setSkipDup] = useState(true)
  const [stage, setStage] = useState('Incoming')
  const [status, setStatus] = useState('To do')
  const [confidence, setConfidence] = useState(25)
  const [batchTag, setBatchTag] = useState('')
  const [target, setTarget] = useState<ImportTarget>(initialTarget)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doParse = useCallback(async (payload: { text?: string; fileBase64?: string; fileType?: 'csv' | 'tsv' | 'xlsx' | 'html' }) => {
    setError('')
    try {
      const res = await fetch('/api/admin/crm/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error || `HTTP ${res.status}`) }
      const data = (await res.json()) as { result: ParseResult; existing: ExistingIdentity[]; vcardDuplicates: DuplicateMatch[] | null }
      setParsed(data.result)
      setExisting(data.existing || [])
      setVcardDups(data.vcardDuplicates)
      if (data.result.mode === 'tabular') {
        const m: Record<number, ProspectField | null> = {}
        for (const c of data.result.columns) m[c.index] = c.suggestedField
        setMapping(m)
      } else {
        setMapping({})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setParsed(null)
    }
  }, [])

  const onTextChange = useCallback((v: string) => {
    setText(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!v.trim()) { setParsed(null); return }
    debounceRef.current = setTimeout(() => { void doParse({ text: v }) }, 350)
  }, [doParse])

  const onFile = useCallback((file: File | undefined) => {
    if (!file) return
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    // WP-SCOUT-6 (Ralph 2026-06-03): .html / .htm route through the same
    // base64 → parse-route flow; the route's `fileType:'html'` branch
    // extracts the largest <table> via JSDOM before the existing tabular
    // parser sees it. No client-side DOMParser path — keeps the parser
    // module browser-safe (no JSDOM in the bundle).
    const fileType: 'csv' | 'tsv' | 'xlsx' | 'html' =
      ext === 'xlsx' ? 'xlsx' :
      ext === 'tsv'  ? 'tsv'  :
      (ext === 'html' || ext === 'htm') ? 'html' :
      'csv'
    const reader = new FileReader()
    reader.onload = () => {
      const out = typeof reader.result === 'string' ? reader.result : ''
      const base64 = out.includes(',') ? out.split(',')[1] : out
      void doParse({ fileBase64: base64, fileType })
    }
    reader.readAsDataURL(file)
  }, [doParse])

  const { candidates, dupSet, acceptedCount, rejectedCount, dupCount } = useMemo(() => {
    if (!parsed || parsed.mode === 'empty') {
      return { candidates: [] as Candidate[], dupSet: new Set<number>(), acceptedCount: 0, rejectedCount: 0, dupCount: 0 }
    }
    const cands: Candidate[] = parsed.mode === 'vcard'
      ? ((parsed.candidates || []) as Candidate[])
      : applyMapping(parsed.rows, mapping)
    const dups = parsed.mode === 'vcard' ? (vcardDups || []) : detectDuplicates(cands, existing)
    const dset = new Set(dups.map((d) => d.candidateIndex))
    // Pipeline accepts rows with a `company`; pool accepts any row with at
    // least one identifier (website / phone / email / name / company). The
    // server route enforces this too — the client-side count is just for
    // the preview's "ready / rejected" badge.
    let rejected = 0
    const hasAnyIdentifier = (c: Candidate): boolean =>
      !!(str(c.website) || str(c.phone) || str(c.email) || str(c.contact_name) || str(c.company))
    const isAcceptedRow = (c: Candidate): boolean =>
      target === 'pool' ? hasAnyIdentifier(c) : !!str(c.company)
    cands.forEach((c) => { if (!isAcceptedRow(c)) rejected++ })
    const accepted = cands.filter((c, i) => isAcceptedRow(c) && !(skipDup && dset.has(i))).length
    return { candidates: cands, dupSet: dset, acceptedCount: accepted, rejectedCount: rejected, dupCount: dset.size }
  }, [parsed, mapping, existing, vcardDups, skipDup, target])

  const doImport = useCallback(async () => {
    if (acceptedCount === 0) return
    setImporting(true); setError('')
    try {
      // WP-SCOUT-6: branch by target. Pool ingest uses a different route
      // (`/raw-prospects`), a different field-set (no amount/confidence —
      // those are pipeline concepts), and authoritative server-side dedup
      // against both pool AND prospects.
      if (target === 'pool') {
        // For the pool: pool rows are about WHO and WHERE, not pipeline metadata.
        // Map `contact_name` → `name` (the pool's parsed field).
        const toSend = candidates
          .filter((c) => {
            // Pool requires AT LEAST ONE identifier — website OR phone OR email OR name OR company.
            return str(c.website) || str(c.phone) || str(c.email) || str(c.contact_name) || str(c.company)
          })
          .map((c) => ({
            name: str(c.contact_name),
            company: str(c.company),
            phone: str(c.phone),
            email: str(c.email),
            website: str(c.website),
            // raw_payload defaults to the candidate itself — kept for re-parsing.
            raw_payload: c,
          }))
        const res = await fetch('/api/admin/crm/raw-prospects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidates: toSend,
            source: batchTag ? `html-import:${batchTag}` : `html-import:${new Date().toISOString().slice(0, 10)}`,
          }),
        })
        if (!res.ok) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error || `HTTP ${res.status}`) }
        onImported()
        onClose()
        return
      }
      const toSend = candidates
        .filter((c, i) => str(c.company) && !(skipDup && dupSet.has(i)))
        .map((c) => {
          const out: Record<string, unknown> = {}
          for (const f of BULK_FIELDS) if (c[f] !== undefined) out[f] = c[f]
          return out
        })
      const res = await fetch('/api/admin/crm/prospects/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates: toSend,
          defaults: { stage, status, confidence_pct: confidence, batchTag: batchTag || undefined },
        }),
      })
      if (!res.ok) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error || `HTTP ${res.status}`) }
      onImported()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }, [candidates, skipDup, dupSet, acceptedCount, target, stage, status, confidence, batchTag, onImported, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mode = parsed?.mode
  const labelHead: React.CSSProperties = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', marginTop: 16, marginBottom: 8 }

  return (
    <div className="crm-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="crm-modal crm-bulk-modal" style={{ position: 'relative' }}>
        <div className="crm-modal-header" style={{ borderTop: '3px solid #60a5fa' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Upload width={20} height={20} style={{ color: 'var(--accent)' }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-main)' }}>Bulk Import</div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>Paste CSV · TSV · vCard · numbered list — or upload .csv .tsv .xlsx</div>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" style={{ padding: 8, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}><X width={18} height={18} /></button>
        </div>

        <div className="crm-modal-body" style={{ padding: 20, overflow: 'auto' }}>
          <textarea
            className="crm-bulk-textarea"
            placeholder="Paste rows here (CSV / TSV / vCard block / numbered list)..."
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
          />
          <label className="crm-bulk-dropzone" style={{ display: 'block', cursor: 'pointer' }}>
            <Paperclip width={14} height={14} style={{ display: 'inline-block', verticalAlign: 'text-bottom' }} /> Drop a <span style={{ color: 'var(--text-main)' }}>.csv</span> · <span style={{ color: 'var(--text-main)' }}>.tsv</span> · <span style={{ color: 'var(--text-main)' }}>.xlsx</span> · <span style={{ color: 'var(--text-main)' }}>.html</span> file — or click to browse
            <input type="file" accept=".csv,.tsv,.xlsx,.html,.htm" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>

          {parsed && mode && mode !== 'empty' && (
            <>
              <div className="crm-bulk-meta" style={{ marginTop: 12 }}>
                <span><strong>{mode === 'vcard' ? (parsed.candidates?.length ?? 0) : parsed.rows.length}</strong> rows</span>
                <span><strong>{parsed.delimiter === '\t' ? 'TAB' : parsed.delimiter || '—'}</strong> delimiter</span>
                <span><strong>{parsed.hasHeaders ? 'yes' : 'no'}</strong> headers</span>
                <span><strong>{mode}</strong> mode</span>
              </div>

              {mode === 'tabular' && (
                <>
                  <div style={labelHead}>Column mapping</div>
                  <div className="crm-bulk-mapping">
                    {parsed.columns.map((col) => (
                      <div key={col.index} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-main)', fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.headerText || `Column ${col.index + 1}`}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.sampleValues.slice(0, 2).join(', ') || '—'}</div>
                        <select
                          value={mapping[col.index] || ''}
                          onChange={(e) => setMapping((m) => ({ ...m, [col.index]: (e.target.value || null) as ProspectField | null }))}
                          style={{ fontSize: 11, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border-card)', background: 'var(--bg-app)', color: 'var(--text-main)' }}
                        >
                          {FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={labelHead}>Defaults for missing fields</div>
              <div className="crm-bulk-defaults">
                <label>Target
                  {/* WP-SCOUT-6: pick the landing zone. Pool = Scout pre-Kanban
                      (raw_prospects, gets tasted before any stage assignment).
                      Pipeline = the existing Kanban prospects flow. */}
                  <select value={target} onChange={(e) => setTarget(e.target.value as ImportTarget)}>
                    <option value="prospects">Pipeline (Kanban)</option>
                    <option value="pool">Scout pool (pre-Kanban)</option>
                  </select>
                </label>
                {target === 'prospects' && (
                  <>
                    <label>Stage
                      <select value={stage} onChange={(e) => setStage(e.target.value)}>
                        <option>Incoming</option><option>Contacted</option><option>Demo done</option><option>Closing</option>
                      </select>
                    </label>
                    <label>Status
                      <select value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option>To do</option><option>Standby</option>
                      </select>
                    </label>
                    <label>Confidence %
                      <input type="number" min={0} max={100} value={confidence} onChange={(e) => setConfidence(Number(e.target.value) || 0)} style={{ width: 70 }} />
                    </label>
                  </>
                )}
                <label>Batch tag
                  <input type="text" placeholder={target === 'pool' ? 'html-import' : 'bulk-import'} value={batchTag} onChange={(e) => setBatchTag(e.target.value)} />
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>Preview</div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} /> Skip duplicates
                </label>
              </div>
              <div className="crm-bulk-preview">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '4px 8px', fontWeight: 600 }}>Company</th>
                      <th style={{ padding: '4px 8px', fontWeight: 600 }}>Contact</th>
                      <th style={{ padding: '4px 8px', fontWeight: 600 }}>Phone</th>
                      <th style={{ padding: '4px 8px', fontWeight: 600 }}>E-mail</th>
                      <th style={{ padding: '4px 8px', fontWeight: 600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.slice(0, 60).map((c, i) => {
                      const isDup = dupSet.has(i)
                      const noCompany = !str(c.company)
                      const muted = noCompany || (skipDup && isDup)
                      return (
                        <tr key={i} style={{ opacity: muted ? 0.4 : 1, borderTop: '1px solid var(--border-card)' }}>
                          <td style={{ padding: '4px 8px', color: 'var(--text-main)' }}>{str(c.company) || '—'}</td>
                          <td style={{ padding: '4px 8px' }}>{str(c.contact_name)}</td>
                          <td style={{ padding: '4px 8px' }}>{str(c.phone)}</td>
                          <td style={{ padding: '4px 8px' }}>{str(c.email)}</td>
                          <td style={{ padding: '4px 8px', color: noCompany ? '#fb7185' : isDup ? '#fbbf24' : '#34d399' }}>{noCompany ? 'no company' : isDup ? 'duplicate' : 'ready'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="crm-bulk-summary">
                <span><span className="count">{acceptedCount}</span> ready · {rejectedCount} rejected · {dupCount} duplicates flagged</span>
                {error && <span style={{ color: '#fb7185' }}>{error}</span>}
              </div>
            </>
          )}
          {error && !parsed && <div style={{ color: '#fb7185', fontSize: 12, marginTop: 12 }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', border: '1px solid var(--border-card)', background: 'transparent', cursor: 'pointer' }}>Cancel</button>
          <button
            type="button"
            onClick={() => { void doImport() }}
            disabled={acceptedCount === 0 || importing}
            style={{ padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none', cursor: acceptedCount === 0 || importing ? 'default' : 'pointer', color: '#fff', background: acceptedCount === 0 || importing ? 'var(--border-card)' : 'linear-gradient(135deg, #15B981, #047857)', opacity: acceptedCount === 0 || importing ? 0.5 : 1 }}
          >
            {importing ? 'Importing…' : `Import ${acceptedCount}`}
          </button>
        </div>
      </div>
    </div>
  )
}
