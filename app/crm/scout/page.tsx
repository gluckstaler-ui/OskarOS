'use client'
// Scout v1 — the pool screen (Ralph 2026-06-03). React port of
// docs/2026-06-03-scout-mockup/real-pool-2.html, wired to the live pool.
// One row per lead · select → Taste · Promote/Discard · expand → dossier.
import { useCallback, useEffect, useMemo, useState } from 'react'
import './scout.css'

interface RawProspect {
  id: string; source: string; scraped_at: string; raw_payload: string
  name: string; company: string; phone: string; email: string; website: string
  country: string; industry: string
  promoted_at: string | null; promoted_to: string | null
  rejected_at: string | null; rejected_reason: string | null
  scout_json: string
}
type Taste = { palate?: number | null; execution?: number | null; gap?: number | null; heat?: string | null; palate_choice?: string | null; verdict?: string | null; photos?: string | null }
type Queried = Record<string, string | null>
type Scout = { scanned_at?: string; taste?: Taste; queried?: Queried; failed?: boolean }

const HEAT = (g: number) => (g >= 2 ? 'hot' : g === 1 ? 'warm' : 'cold')
const parseJSON = <T,>(s: string, fb: T): T => { try { return JSON.parse(s || '') as T } catch { return fb } }

function tone(key: string, v: string | null | undefined): string {
  if (v == null) return ''
  if (key === 'age') return /stale|201[0-5]|seen 200/.test(v) ? 'good' : /aging|201[6-9]/.test(v) ? 'mid' : 'bad'
  if (key === 'stack') return /old|jimdo|wix|table|static/i.test(v) ? 'good' : /wordpress/i.test(v) ? 'mid' : 'info'
  if (key === 'performance') { const n = +(v.replace(/\D/g, '')); return n && n < 50 ? 'good' : n < 75 ? 'mid' : 'bad' }
  if (key === 'seo') { const n = +(v.replace(/\D/g, '')); return n && n < 70 ? 'good' : 'info' }
  return 'info'
}

export default function ScoutPool() {
  const [pool, setPool] = useState<RawProspect[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [tasting, setTasting] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [polar, setPolar] = useState(false)
  const [toast, setToast] = useState<{ msg: string; kill?: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/crm/scout/pool', { cache: 'no-store' })
      const j = await r.json()
      setPool(j.pool ?? [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const flash = (msg: string, kill = false) => { setToast({ msg, kill }); setTimeout(() => setToast(null), 2600) }

  const scoutOf = (p: RawProspect) => parseJSON<Scout>(p.scout_json, {})
  const stateOf = (p: RawProspect): 'greenfield' | 'scouted' | 'raw' => {
    if (tasting.has(p.id)) return 'raw' // shown via tasting overlay
    if (!p.website) return 'greenfield'
    return scoutOf(p).scanned_at ? 'scouted' : 'raw'
  }
  const gapOf = (t: Taste): number | null =>
    typeof t.palate === 'number' && typeof t.execution === 'number' ? t.palate - t.execution : null
  const heatOf = (t: Taste): string | null => {
    if (t.heat) return t.heat
    const g = gapOf(t); return g == null ? null : HEAT(g)
  }
  const pursueOf = (p: RawProspect) => (/tief/i.test(p.industry) ? 'low' : 'high')

  const counts = useMemo(() => {
    let scouted = 0, hot = 0, green = 0, raw = 0
    for (const p of pool) {
      const s = stateOf(p)
      if (s === 'greenfield') green++
      else if (s === 'scouted') { scouted++; const h = heatOf(scoutOf(p).taste ?? {}); if (h === 'hot') hot++ }
      else raw++
    }
    return { scouted, hot, green, raw, total: pool.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, tasting])

  const shown = useMemo(() => pool.filter((p) => {
    const s = stateOf(p)
    if (filter === 'raw' && s !== 'raw') return false
    if (filter === 'green' && s !== 'greenfield') return false
    if ((filter === 'hot' || filter === 'warm' || filter === 'cold')) {
      if (s !== 'scouted') return false
      if (heatOf(scoutOf(p).taste ?? {}) !== filter) return false
    }
    if (query) {
      const hay = (p.name + ' ' + p.company + ' ' + p.website + ' ' + p.industry).toLowerCase()
      if (!hay.includes(query)) return false
    }
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pool, filter, query, tasting])

  const togSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togOpen = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const rawSelected = useMemo(() => [...sel].filter((id) => { const p = pool.find((x) => x.id === id); return p && p.website && !scoutOf(p).scanned_at }), [sel, pool])

  async function tasteSelected() {
    const rawIds = rawSelected
    if (!rawIds.length) return
    setTasting(new Set(rawIds)); flash(`◐ tasting ${rawIds.length} site${rawIds.length > 1 ? 's' : ''}…`)
    try {
      await fetch('/api/admin/crm/scout/taste', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawIds }) })
    } catch (e) { console.error(e) }
    await load(); setTasting(new Set()); setSel(new Set())
  }
  async function promoteSelected() {
    const ids = [...sel]; if (!ids.length) return; let n = 0
    for (const id of ids) {
      try { const r = await fetch('/api/admin/crm/scout/promote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); if (r.ok) n++ } catch (e) { console.error(e) }
    }
    await load(); setSel(new Set()); flash(`→ ${n} promoted to Kanban · Incoming`)
  }
  async function discardSelected() {
    const ids = [...sel]; if (!ids.length) return; let n = 0
    for (const id of ids) {
      try { const r = await fetch('/api/admin/crm/scout/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); if (r.ok) n++ } catch (e) { console.error(e) }
    }
    await load(); setSel(new Set()); flash(`✕ ${n} discarded`, true)
  }

  const seg = (cls: string, n: number | null | undefined) => (
    <div className={`meter ${cls}`}>
      <div className="segs">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={`seg${typeof n === 'number' && i <= n ? ' on' : ''}`} />)}</div>
      <span className="n">{typeof n === 'number' ? n : '—'}<span className="mx">/5</span></span>
    </div>
  )
  const lampstrip = (q: Queried) => (
    <div className="lampstrip" title="Age · Stack · Host · Perf · SEO">
      {['age', 'stack', 'hosting', 'performance', 'seo'].map((k) => <span key={k} className={`ld ${tone(k, q[k])}`} />)}
    </div>
  )

  function ScoutCells({ p }: { p: RawProspect }) {
    const sc = scoutOf(p); const t = sc.taste ?? {}; const q = sc.queried ?? {}
    const g = gapOf(t); const h = heatOf(t)
    const pending = typeof t.palate !== 'number'
    return (<>
      <td className="cpal">{seg('pal', t.palate)}</td>
      <td><div className="saw">{t.palate_choice || (pending ? <span className="dash">visual taste pending</span> : '—')}</div></td>
      <td className="cexe">{seg('exe', t.execution)}</td>
      <td className="cgap"><span className={`gap ${h ?? 'cold'}`}>{g == null ? '—' : `${g > 0 ? '+' : ''}${g}`}</span></td>
      <td><span className={`vchip ${h ?? 'pend'}`}>{h === 'hot' ? '🔥 HOT' : h === 'warm' ? 'Warm' : h === 'cold' ? 'Cold' : '◐ Queried'}</span>{t.verdict ? <div className="vline">{t.verdict}</div> : null}</td>
      <td className="cintel">{lampstrip(q)}</td>
    </>)
  }

  function Dossier({ p }: { p: RawProspect }) {
    const payload = parseJSON<Record<string, string>>(p.raw_payload, {})
    const sc = scoutOf(p); const t = sc.taste ?? {}; const q = sc.queried ?? {}
    const st = stateOf(p); const g = gapOf(t); const h = heatOf(t)
    const SRC: Record<string, string> = { age: 'Wayback', stack: 'HTML', hosting: 'DNS·ASN', performance: 'PageSpeed', seo: 'PageSpeed', traffic: 'CrUX', trackers: 'cookie+grep', booking: 'HTML', languages: 'HTML' }
    const Contact = (
      <div>
        <div className="dlabel">Contact · from import</div>
        <div className="kv"><span className="k">Region</span><span className="v">{payload.region || '—'}</span></div>
        <div className="kv"><span className="k">Adresse</span><span className="v">{payload.adr || '—'}</span></div>
        <div className="kv"><span className="k">Typ</span><span className="v">{payload.typ || p.industry}</span></div>
        <div className="kv"><span className="k">Website</span><span className={`v${p.website ? '' : ' none'}`}>{p.website || '— keine —'}</span></div>
        {p.website ? <div className="shot"><span className="lbl">Puppeteer · full-page + 1 inner (next)</span></div> : null}
      </div>
    )
    if (st === 'greenfield') return (
      <div className="dgrid3">{Contact}
        <div><div className="dlabel">◐ Queried — code fetches it · no LLM</div><div className="qline">No domain on record → nothing to fetch. The queried layer is empty by definition.</div></div>
        <div><div className="dlabel">◓ Scouted — the agent&apos;s read</div><div className="gfbig">◇ Greenfield — no site to taste</div><div className="qline">Nothing to displace — you set the first impression. Decision is pursue / skip.</div></div>
      </div>
    )
    if (st === 'raw') return (
      <div className="dgrid3">{Contact}
        <div><div className="dlabel">◐ Queried — code fetches it · no LLM</div><div className="qline">Rides along free on Taste — Age · Stack · Hosting (and Perf · SEO · Traffic once keys land).</div></div>
        <div><div className="dlabel">◓ Scouted — the agent tastes it</div><div className="qline">Not scouted yet. Select the row and press <b>Taste</b>.</div></div>
      </div>
    )
    const lamp = (name: string, key: string, val: string | null | undefined) => (
      <div className="lamp2"><span className={`ld ${tone(key, val)}`} /><span className="ln">{name}</span><span className="lv">{val ?? '—'}</span><span className="lsrc">{SRC[key]}</span></div>
    )
    return (
      <div className="dgrid3">{Contact}
        <div>
          <div className="dlabel">◐ Queried — code fetches it · deterministic, no LLM</div>
          <div className="lamps2">
            {lamp('Age', 'age', q.age)}{lamp('Stack', 'stack', q.stack)}
            {lamp('Hosting', 'hosting', q.hosting)}{lamp('Perf', 'performance', q.performance)}
            {lamp('SEO', 'seo', q.seo)}{lamp('Traffic', 'traffic', q.traffic)}
            {lamp('Trackers', 'trackers', q.trackers)}{lamp('Booking', 'booking', q.booking)}
            {lamp('Langs', 'languages', q.languages)}
          </div>
        </div>
        <div>
          <div className="dlabel">◓ Scouted — the agent tastes it · jedi-scout.md</div>
          <div className="scrow">
            <span className="scmini">Palate <b>{typeof t.palate === 'number' ? t.palate : '—'}</b>/5</span>
            <span className="scmini">Execution <b>{typeof t.execution === 'number' ? t.execution : '—'}</b>/5</span>
            <span className={`gap ${h ?? 'cold'}`} style={{ fontSize: 15 }}>{g == null ? '—' : `${g > 0 ? '+' : ''}${g}`}</span>
            <span className={`vchip ${h ?? 'pend'}`}>{h === 'hot' ? '🔥 HOT' : h === 'warm' ? 'Warm' : h === 'cold' ? 'Cold' : '◐ Queried'}</span>
          </div>
          <div className="kv"><span className="k">Photos</span><span className="v">{t.photos || '—'}</span></div>
          {t.palate_choice ? <div className="choiceq"><span className="cl">the specific choice it named — mandatory, no naming = it guessed</span>“{t.palate_choice}”</div> : null}
          {t.verdict ? <div className="vbig">{t.verdict}</div> : null}
        </div>
      </div>
    )
  }

  return (
    <div className={`scoutv1 app${polar ? ' polar' : ''}`}>
      <div className="top">
        <span className="logo">O</span>
        <div className="brand"><b>OskarOS</b><span className="sub">Scout</span></div>
        <nav className="nav"><a href="/crm">Overview</a><a href="/crm?view=kanban">Kanban</a><a className="active">Scout</a></nav>
        <span className="spacer" />
        <span className="src">source: intelligence/aargau-full-1.html</span>
        <button className="tbtn" onClick={() => setPolar((v) => !v)}>{polar ? '◑ Onyx' : '◐ Polar'}</button>
      </div>

      <div className="head">
        <h1>Pool — Praxen für Psyche, Kanton Aargau</h1>
        <div className="funnel">
          <span className="pill"><b>{counts.total}</b> in pool</span><span className="arw">→</span>
          <span className="pill"><b>{counts.scouted}</b> scouted</span>
          <span className="pill hot">🔥 <b>{counts.hot}</b> hot</span>
          <span className="pill green">◇ <b>{counts.green}</b> greenfield</span>
        </div>
      </div>

      <div className="tools">
        <div className="search">🔍 <input placeholder="Search leads…" value={query} onChange={(e) => setQuery(e.target.value.toLowerCase().trim())} /></div>
        <div className="chips">
          {([['all', 'All', counts.total], ['hot', '🔥 Hot', counts.hot], ['raw', 'Not scouted', counts.raw], ['green', 'Greenfield', counts.green]] as const).map(([f, label, c]) => (
            <span key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{label} <span className="c">{c}</span></span>
          ))}
        </div>
      </div>

      <div className="wrap">
        <table>
          <thead><tr>
            <th className="cx" /><th className="clead">Lead</th><th className="ctel">Telefon</th><th className="cmail">E-Mail</th>
            <th>Website</th><th className="cpal">Palate</th><th>The eye — what it saw</th><th className="cexe">Execution</th>
            <th className="cgap">Gap</th><th>Verdict</th><th className="cintel">Intel</th><th className="cexp" />
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={12} className="empty">loading the pool…</td></tr>
              : shown.length === 0 ? <tr><td colSpan={12} className="empty">no leads match this filter</td></tr>
                : shown.map((p) => {
                  const st = stateOf(p); const isTasting = tasting.has(p.id); const selected = sel.has(p.id); const isOpen = open.has(p.id)
                  return (
                    <tbody className={`lead${selected ? ' sel' : ''}${isOpen ? ' open' : ''}`} key={p.id}>
                      <tr className="r">
                        <td className="cx" onClick={() => togSel(p.id)}><span className={`chk${selected ? ' on' : ''}`}>{selected ? '✓' : ''}</span></td>
                        <td className="clead"><div className="nm">{p.name}</div><div className="typ">{parseJSON<Record<string, string>>(p.raw_payload, {}).typ || p.industry}</div><span className="reg">{parseJSON<Record<string, string>>(p.raw_payload, {}).region || p.country}</span></td>
                        <td className="ctel">{p.phone ? <span className="kontakt">{p.phone}</span> : <span className="none">—</span>}</td>
                        <td className="cmail">{p.email ? <a className="kontakt mail" title={p.email} onClick={(e) => e.stopPropagation()}>{p.email}</a> : <span className="none">—</span>}</td>
                        <td>{p.website ? <a className="web">{p.website} <span className="x">↗</span></a> : <span className={`gftag${pursueOf(p) === 'low' ? ' low' : ''}`}>KEINE WEBSITE</span>}</td>
                        {isTasting
                          ? <td colSpan={6}><span className="tasting"><span className="spin" /> tasting {p.website}… <span style={{ color: 'var(--dim)' }}>opening · reading · holding the gap</span></span></td>
                          : st === 'scouted' ? <ScoutCells p={p} />
                            : st === 'greenfield' ? <td colSpan={6}><span className="gfcell"><span className={`pursue ${pursueOf(p)}`}>{pursueOf(p) === 'high' ? 'pursue ↑' : 'low priority'}</span><span className="note">No web presence — nothing to displace, you set the first impression.</span></span></td>
                              : <td colSpan={6}><span className="raw"><span className="dash">— not scouted yet —</span><span className="pickhint">select → Taste</span></span></td>}
                        <td className="cexp"><span className="exp" onClick={() => togOpen(p.id)}>⌄</span></td>
                      </tr>
                      {isOpen ? <tr className="detail"><td colSpan={12}><Dossier p={p} /></td></tr> : null}
                    </tbody>
                  )
                })}
          </tbody>
        </table>
      </div>

      <div className="foot">
        <b>One row per lead.</b> Real data from <b>aargau-full-1.html</b>. Raw rows show «—» until scouted · select rows + <b>Taste</b> to enrich (v1 runs the real cheap ◐ Queried signals — Hosting · Age · Stack — the visual taste lands next) · then <b>Promote</b> (→ Kanban · Incoming) or <b>Discard</b>.
      </div>

      {sel.size > 0 ? (
        <div className="deck show">
          <span className="sum"><b>{sel.size}</b> selected</span>
          <span className="vr" />
          <button className="act taste" disabled={rawSelected.length === 0} onClick={tasteSelected}>◐ Taste {rawSelected.length}</button>
          <button className="act promote" onClick={promoteSelected}>→ Promote</button>
          <button className="act discard" onClick={discardSelected}>✕ Discard</button>
        </div>
      ) : null}

      {toast ? <div className={`toast show${toast.kill ? ' kill' : ''}`}>{toast.msg}</div> : null}
    </div>
  )
}
