'use client'
// ============================================================================
// DiscoverModal — Scout-pool register-scraper INPUT modal (Ralph 2026-06-05).
//
// SCOPE: just collect register + criteria, hand them to the host on submit,
// then close. The host (ScoutPool) owns the running job's state — its
// progress + recent rows + Stop button render in the ambient
// ScoutJobsOverlay so the user can keep working with the pool while the
// scrape proceeds in the background.
//
// Previous incarnation (this session): the modal held the polling loop
// AND the progress display — meant the user had to keep it open to watch
// the run. Ralph flagged the UX: "after I hit ok, I would like only see
// what is currently scraped, in an overlay I can collapse/uncollapse,
// like the todo list in studio." This is that rewrite.
//
// Backed by: POST /api/admin/crm/scout/discover  (no polling here anymore).
// The registered scrapers are read once on first open to populate the
// register dropdown.
// ============================================================================

import { useEffect, useState } from 'react'

interface ScraperListEntry {
  id: string
  label: string
  criteriaFields: string[]
}

/** Criteria shape the host accepts — mirrors ScraperCriteria from lib/scrapers/types. */
export interface DiscoverCriteria {
  canton?: string
  plz?: string
  ort?: string
  specialty?: string
  language?: string
  limit?: number
}

interface Props {
  open: boolean
  onClose: () => void
  /**
   * Host callback fired on submit. The host POSTs /scout/discover, captures
   * the jobId, kicks off polling, surfaces the job in ScoutJobsOverlay, and
   * triggers pool reloads on completion. The modal closes immediately after.
   */
  onStart: (register: string, criteria: DiscoverCriteria) => Promise<void> | void
}

export function DiscoverModal({ open, onClose, onStart }: Props) {
  const [scrapers, setScrapers] = useState<ScraperListEntry[]>([])
  const [register, setRegister] = useState<string>('fsp')
  // Criteria form
  const [canton, setCanton] = useState('')
  const [plz, setPlz] = useState('')
  const [ort, setOrt] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [language, setLanguage] = useState('')
  const [limit, setLimit] = useState<string>('')      // empty = no cap

  // Fetch the registry once when the modal first opens.
  useEffect(() => {
    if (!open || scrapers.length > 0) return
    let alive = true
    fetch('/api/admin/crm/scout/discover')
      .then((r) => r.json())
      .then((j: { scrapers?: ScraperListEntry[] }) => {
        if (alive && Array.isArray(j.scrapers)) setScrapers(j.scrapers)
      })
      .catch(() => { /* non-fatal — the UI degrades to the default FSP */ })
    return () => { alive = false }
  }, [open, scrapers.length])

  const run = async () => {
    const criteria: DiscoverCriteria = {}
    if (canton.trim()) criteria.canton = canton.trim().toUpperCase()
    if (plz.trim()) criteria.plz = plz.trim()
    if (ort.trim()) criteria.ort = ort.trim()
    if (specialty.trim()) criteria.specialty = specialty.trim()
    if (language.trim()) criteria.language = language.trim()
    const limN = parseInt(limit, 10)
    if (Number.isFinite(limN) && limN > 0) criteria.limit = limN
    await onStart(register, criteria)
    onClose()
  }

  if (!open) return null

  return (
    <div className="scout-discover-backdrop" onClick={onClose}>
      <div className="scout-discover-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scout-discover-head">
          <h3>Discover leads from an official register</h3>
          <button
            type="button"
            className="scout-discover-close"
            onClick={onClose}
            title="Close"
          >✕</button>
        </div>

        <div className="scout-discover-body">
          <div className="scout-discover-field">
            <label>Register</label>
            <select value={register} onChange={(e) => setRegister(e.target.value)}>
              {(scrapers.length > 0 ? scrapers : [{ id: 'fsp', label: 'FSP — Psychologinnen & Psychologen', criteriaFields: [] }]).map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="scout-discover-criteria">
            <div className="scout-discover-field">
              <label>Canton <span className="hint">ZH / BE / LU / …</span></label>
              <input type="text" value={canton} placeholder="ZH" maxLength={3} onChange={(e) => setCanton(e.target.value)} />
            </div>
            <div className="scout-discover-field">
              <label>PLZ <span className="hint">prefix ok (&quot;80&quot;)</span></label>
              <input type="text" value={plz} placeholder="8001 or 80" maxLength={4} onChange={(e) => setPlz(e.target.value)} />
            </div>
            <div className="scout-discover-field">
              <label>Ort / City <span className="hint">Stadt Zürich = &quot;Zürich&quot;</span></label>
              <input type="text" value={ort} placeholder="Zürich, Luzern…" onChange={(e) => setOrt(e.target.value)} />
            </div>
            <div className="scout-discover-field">
              <label>Specialty <span className="hint">substring</span></label>
              <input type="text" value={specialty} placeholder="Paartherapie, Kinder, Burnout…" onChange={(e) => setSpecialty(e.target.value)} />
            </div>
            <div className="scout-discover-field">
              <label>Language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">— any —</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="it">Italiano</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="scout-discover-field">
              <label>Limit <span className="hint">empty = all (~6k)</span></label>
              <input type="text" value={limit} placeholder="200" onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
        </div>

        <div className="scout-discover-foot">
          <div className="scout-discover-hint">
            On submit the modal closes and an ambient progress card appears in the bottom-right —
            collapse / uncollapse it while you keep working in the pool. Leads land incrementally
            so the list fills as the run proceeds.
          </div>
          <div className="scout-discover-actions">
            <button type="button" className="scout-discover-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="scout-discover-run" onClick={() => void run()}>
              ⟿ Start scraping
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
