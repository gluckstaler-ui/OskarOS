'use client'

// ============================================================================
// components/crm/LeadDetail.tsx — the expanded opportunity dashboard, ported
// 1:1 from public/crm.html's crmRenderOpp(p) + crmRenderPeople + crmRenderTagEditor
// + crmRenderFeedRow (WP-CRM-REACT). The MIDDLE column's detail state: shown
// by app/crm/page.tsx when a prospect is selected.
//
// Data contract (matches crmRenderOpp exactly):
//   prospect.intel_json is a JSON *string* → parse once → the opp dashboard.
//   Keys read: verdict_{tag,tone,subline,prose,chf_est,close_pct,budget,buying},
//   intel_scan_at, lamp_<k>_{state,sub,tone} (k ∈ age|hosting|stack|photo|
//   performance|seo), strip_<k>_state/_tone (k ∈ traffic|analytics|marketing|
//   saas|booking) + strip_lang, prose_design, prose_seo, keywords ("kw#rank,…"),
//   facts_{reviews_state,reviews_sub,reviews_tone,employees}, pain, pitch.
//
// Writes (persist to disk, then onReload so the parent re-fetches):
//   · intel changes  → PATCH /api/admin/crm/prospects/{id} { intel_json: <restringified> }
//   · prospect field → PATCH /api/admin/crm/prospects/{id} { <field>: value }
//   · tags           → PATCH /api/admin/crm/prospects/{id} { tags: "a, b, c" }
//   · contacts       → GET/POST /api/admin/crm/prospects/{id}/contacts,
//                      PATCH/DELETE /api/admin/crm/contacts/{id}
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  RotateCw,
  Sparkles,
  Plus,
  Phone,
  Mail,
  Paperclip,
  DownloadCloud,
  ExternalLink,
  Lock,
  ChevronDown,
  Star,
  Trash2,
  Minimize2,
  X,
  MessageCircle as MessageCircleIcon,
} from 'lucide-react'
import type { Prospect } from '@/lib/crm-store'
import type { CrmActivity } from '@/app/crm/crm-data'
import styles from './LeadDetail.module.css'

interface LeadDetailProps {
  prospect: Prospect
  activities: CrmActivity[]
  onClose: () => void
  onReload: () => void
  registerUndo?: (label: string, action: () => void | Promise<void>) => void
  onWhatsApp?: (id: string) => void
}

// ─── Constants mirrored from crm.html ───────────────────────────────────────
type Tone = 'good' | 'mid' | 'bad' | 'info'
const CRM_TONES: Tone[] = ['info', 'good', 'mid', 'bad']
const CRM_BUDGETS = ['—', 'LOW', 'MID', 'HIGH']
const CRM_EMP_BUCKETS = ['1–4', '5–9', '10–24', '25–49', '50+']

// Role taxonomy — decisive bit drives the amber row styling (crmRoleIsDecisive).
const CRM_ROLE_OPTIONS: { value: string; label: string; decisive: boolean }[] = [
  { value: 'decision_maker', label: 'Decision Maker', decisive: true },
  { value: 'economic_buyer', label: 'Economic Buyer', decisive: true },
  { value: 'owner', label: 'Owner / Founder', decisive: true },
  { value: 'ceo', label: 'CEO', decisive: true },
  { value: 'cfo', label: 'CFO', decisive: true },
  { value: 'champion', label: 'Champion', decisive: false },
  { value: 'influencer', label: 'Influencer', decisive: false },
  { value: 'technical_buyer', label: 'Technical Buyer', decisive: false },
  { value: 'end_user', label: 'End User', decisive: false },
  { value: 'gatekeeper', label: 'Gatekeeper', decisive: false },
  { value: 'blocker', label: 'Blocker', decisive: false },
  { value: 'assistant', label: 'Assistant', decisive: false },
  { value: 'other', label: 'Other', decisive: false },
]
function roleIsDecisive(role: string): boolean {
  const def = CRM_ROLE_OPTIONS.find((r) => r.value === role)
  return !!(def && def.decisive)
}

interface Contact {
  id: string
  prospect_id: string
  name: string
  role: string
  phone: string
  email: string
  linkedin: string
  notes: string
  title: string
  is_decisive: boolean
}

// intel_json is a freeform string→unknown blob; index loosely as the vanilla does.
type Intel = Record<string, unknown>

function readIntel(p: Prospect): Intel {
  if (!p || !p.intel_json) return {}
  try {
    return (JSON.parse(p.intel_json) as Intel) || {}
  } catch {
    return {}
  }
}
function str(v: unknown): string {
  return v == null ? '' : String(v)
}

// Lucide icon name per activity type (crmActivityIcon).
function activityIcon(type: string): string {
  if (type === 'Call' || type === 'Qualification Call') return 'phone'
  if (type === 'Zoom Call') return 'video'
  if (type === 'Meeting') return 'handshake'
  if (type === 'Onsite Visit') return 'car'
  if (type === 'E-mail Out') return 'mail'
  if (type === 'E-mail In') return 'mail-open'
  if (type === 'WhatsApp Out' || type === 'WhatsApp In') return 'message-circle'
  if (type === 'Note') return 'sticky-note'
  if (type === 'Documents' || type === 'Proposal') return 'file-text'
  if (type === 'Started Discovery Session') return 'sparkles'
  if (type === 'session_archived') return 'archive'
  if (type === 'delivery_started') return 'truck'
  if (type === 'stage_changed' || type === 'status_changed') return 'settings-2'
  return 'circle'
}
const AUDIT_TYPES = new Set([
  'stage_changed',
  'status_changed',
  'delivery_started',
  'session_archived',
  'Started Discovery Session',
])

function contactInitials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ─── Econ / next-action helpers (1:1 with crm.html) ──────────────────────────
// crmFmtCHF — Swiss thousands separator (apostrophe).
function fmtCHF(n: number): string {
  return (Number(n) || 0).toLocaleString('de-CH').replace(/,/g, "'")
}
// crmParseInt — tolerant int parse (strips formatting, keeps minus).
function parseIntLoose(s: unknown): number {
  const n = parseInt(String(s ?? '').replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}
// crmFmtDateHuman — "Sat 23 May" (falls back to ISO when unparseable).
function fmtDateHuman(iso: string): string {
  if (!iso) return ''
  const s = String(iso).slice(0, 10)
  const d = new Date(s + 'T00:00:00')
  if (!Number.isFinite(d.getTime())) return s
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
}

type NextAction =
  | { label: string; days: number | null; kind: 'static'; date?: undefined }
  | { label: string; days: number; kind: 'overdue' | 'today' | 'upcoming'; date: string }
  | null
// crmComputeNextAction — derive the NEXT MOVE strip state from next_action_date.
function computeNextAction(p: Prospect): NextAction {
  const date = (p.next_action_date || '').slice(0, 10)
  if (!date) {
    return p.next_action_label
      ? { label: p.next_action_label, days: null, kind: 'static' }
      : null
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  if (!Number.isFinite(target.getTime())) return null
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { label: Math.abs(days) + 'd overdue', days, kind: 'overdue', date }
  if (days === 0) return { label: 'TODAY', days, kind: 'today', date }
  return { label: days + 'd upcoming', days, kind: 'upcoming', date }
}

// CRM-phase bar — 4 segments for the 4 sales stages; --stage drives the
// filled-segment accent (set inline so the React detail matches the kanban
// column accent). crmCrmPhaseBarHtml + CRM_STAGE_KEY + the stage-color vars.
const F8_STAGE_ORDER = ['Incoming', 'Contacted', 'Demo done', 'Closing']
const CRM_STAGE_ACCENT: Record<string, string> = {
  Incoming: '#60a5fa',
  Contacted: '#a78bfa',
  'Demo done': '#f59e0b',
  Closing: '#15B981',
}

// crmWhatsAppNumber — normalize phone → international digits (null if too short).
function whatsAppNumber(phone: string): string | null {
  let digits = String(phone || '').replace(/\D+/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0') && digits.length === 10) digits = '41' + digits.slice(1)
  if (digits.length < 8) return null
  return digits
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')
const toneClass = (tone: Tone): string =>
  tone === 'good' ? "tone-good" : tone === 'mid' ? "tone-mid" : tone === 'bad' ? "tone-bad" : ""

export function LeadDetail({ prospect, activities, onClose, onReload, registerUndo, onWhatsApp }: LeadDetailProps) {
  // Local editable mirror of the prospect — seeded from props, re-synced when
  // the selected lead changes. Vanilla mutates the prospect in place + re-renders;
  // React needs state so blur edits show immediately before onReload lands.
  const [intel, setIntel] = useState<Intel>(() => readIntel(prospect))
  const [fields, setFields] = useState({
    company: prospect.company || '',
    address_strasse: prospect.address_strasse || '',
    address_plz: prospect.address_plz || '',
    address_ort: prospect.address_ort || '',
    website: prospect.website || '',
    uid_number: prospect.uid_number || '',
    notes: prospect.notes || '',
    sub_stage: prospect.sub_stage || '',
  })
  // Econ row mirror — kept separate so the parsed/clamped values + the live
  // confidence bar update on blur before onReload lands (crmPatchEcon path).
  const [amountChf, setAmountChf] = useState<number>(prospect.amount_chf || 0)
  const [confidencePct, setConfidencePct] = useState<number>(prospect.confidence_pct || 0)
  const [econSaved, setEconSaved] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>([])
  // Sub-stage autocomplete — DISTINCT existing sub_stage values feed a <datalist>.
  // Port of crm.html crmRefreshSubStageSuggestions (GET /api/admin/crm/sub-stages).
  const [subStageSuggestions, setSubStageSuggestions] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    fetch('/api/admin/crm/sub-stages')
      .then((r) => r.json())
      .then((d) => { if (alive && Array.isArray(d.values)) setSubStageSuggestions(d.values.filter(Boolean)) })
      .catch(() => { /* suggestions are comfort, not necessity */ })
    return () => { alive = false }
  }, [])

  // Ralph 2026-06-03 · Linked studio sessions for this prospect.
  // GET /api/admin/crm/sessions returns the FULL prospect→sessions map
  // (`scanProspectSessions()` — derived from public/<sessionId>/logs/_session-
  // config.json on disk). We pick out this prospect's entries on mount + on
  // id-change. Empty array on miss = no section rendered.
  interface SessionLink {
    sessionId: string
    createdAt: string
    outcome: string | null
    phase: number
    phaseName: string
    staleDays: number
    tokenBurn?: { input?: number; output?: number; cost?: string }
  }
  const [linkedSessions, setLinkedSessions] = useState<SessionLink[]>([])
  useEffect(() => {
    let alive = true
    fetch('/api/admin/crm/sessions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const map = d?.links as Record<string, SessionLink[]> | undefined
        const list = (map && prospect.id && map[prospect.id]) || []
        setLinkedSessions(Array.isArray(list) ? list : [])
      })
      .catch(() => { /* non-fatal — render without the section */ })
    return () => { alive = false }
  }, [prospect.id])

  // Re-seed when the selected prospect changes (id is the identity key).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setIntel(readIntel(prospect))
    setFields({
      company: prospect.company || '',
      address_strasse: prospect.address_strasse || '',
      address_plz: prospect.address_plz || '',
      address_ort: prospect.address_ort || '',
      website: prospect.website || '',
      uid_number: prospect.uid_number || '',
      notes: prospect.notes || '',
      sub_stage: prospect.sub_stage || '',
    })
    setAmountChf(prospect.amount_chf || 0)
    setConfidencePct(prospect.confidence_pct || 0)
  }, [prospect.id])

  // ── Persistence ────────────────────────────────────────────────────────────
  const patchProspect = useCallback(
    async (patch: Record<string, unknown>) => {
      try {
        const res = await fetch(`/api/admin/crm/prospects/${encodeURIComponent(prospect.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) throw new Error(await res.text())
        onReload()
      } catch (err) {
        console.error('[CRM] PATCH failed:', err)
      }
    },
    [prospect.id, onReload],
  )

  // Intel write: re-stringify the parsed object into intel_json (vanilla path).
  const persistIntel = useCallback(
    (next: Intel) => {
      setIntel(next)
      void patchProspect({ intel_json: JSON.stringify(next) })
    },
    [patchProspect],
  )
  // Field-level intel edit — skip no-op (matches crmPatchIntelDebounced's guard).
  const setIntelField = useCallback(
    (field: string, value: unknown) => {
      if ((intel[field] ?? '') === value) return
      persistIntel({ ...intel, [field]: value })
    },
    [intel, persistIntel],
  )

  // ── Econ row (CHF / Confidence) — crmPatchEcon: parse, clamp, PATCH ──────────
  const patchEcon = useCallback(
    (field: 'amount_chf' | 'confidence_pct', rawValue: string) => {
      const n = field === 'amount_chf' ? parseIntLoose(rawValue) : Number(rawValue)
      if (!Number.isFinite(n)) return
      const value =
        field === 'amount_chf'
          ? Math.max(0, Math.round(n))
          : Math.max(0, Math.min(100, Math.round(n)))
      if (field === 'amount_chf') setAmountChf(value)
      else setConfidencePct(value)
      if (prospect[field] === value) return // no-op (field is a numeric Prospect key)
      void patchProspect({ [field]: value })
      setEconSaved(true)
      window.setTimeout(() => setEconSaved(false), 1200)
    },
    [patchProspect, prospect],
  )

  // ── Scheduled follow-up (NEXT MOVE strip) — snooze / custom / done ───────────
  // crmFollowupSetCustom: write next_action_date + a derived label.
  const followupSetCustom = useCallback(
    (dateIso: string) => {
      if (!dateIso) return
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const target = new Date(dateIso)
      target.setHours(0, 0, 0, 0)
      const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000)
      const label = diff < 0 ? Math.abs(diff) + 'd overdue' : diff === 0 ? 'TODAY' : diff + 'd upcoming'
      void patchProspect({ next_action_date: dateIso, next_action_label: label })
    },
    [patchProspect],
  )
  // crmSnoozeFollowup: +N days from the CURRENT scheduled date (or today).
  const snoozeFollowup = useCallback(
    (days: number) => {
      const base = prospect.next_action_date ? new Date(prospect.next_action_date) : new Date()
      if (!Number.isFinite(base.getTime())) return
      base.setDate(base.getDate() + days)
      followupSetCustom(base.toISOString().slice(0, 10))
    },
    [prospect.next_action_date, followupSetCustom],
  )
  // crmClearFollowup: "Done" clears the scheduled action + logs a Note audit row.
  const clearFollowup = useCallback(() => {
    const previousDate = prospect.next_action_date
    void patchProspect({ next_action_date: '', next_action_label: '' })
    void fetch('/api/admin/crm/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prospect_id: prospect.id,
        type: 'Note',
        icon: 'check-circle',
        color: '#15B981',
        notes: previousDate
          ? `Scheduled follow-up (${previousDate}) marked done.`
          : 'Scheduled follow-up marked done.',
      }),
    }).catch((err) => console.warn('[CRM] follow-up done activity write failed (non-fatal):', err))
  }, [prospect.id, prospect.next_action_date, patchProspect])

  // SEND WHATSAPP via Oskar — opens the page-level Baileys compose modal (one
  // modal shared by the channel icons + this button, never a wa.me link). Ralph.
  const sendWhatsApp = useCallback(() => onWhatsApp?.(prospect.id), [onWhatsApp, prospect.id])

  // Start Discovery — POST /api/admin/crm/sessions {prospectId} → redirect to the
  // BRIEF (CD picks up the CRM notes as context). Port of crm.html crmStartSession
  // → crmStartSessionConfirmed; the confirm() carries the strip's explainer.
  const startDiscovery = useCallback(async () => {
    const ok = window.confirm(
      `Start discovery for ${prospect.company || 'this lead'}?\n\nCreates a session folder · CD picks up your CRM notes as context · redirects to BRIEF.`,
    )
    if (!ok) return
    try {
      const res = await fetch('/api/admin/crm/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId: prospect.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { redirectUrl?: string }
      if (data.redirectUrl) window.location.href = data.redirectUrl
    } catch (err) {
      console.error('[CRM] start discovery failed:', err)
      alert('Failed to start session: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [prospect.id, prospect.company])

  // ── Contacts (People) ────────────────────────────────────────────────────────
  const loadContacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/crm/prospects/${encodeURIComponent(prospect.id)}/contacts`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setContacts(Array.isArray(data.contacts) ? data.contacts : [])
    } catch (err) {
      console.warn('[CRM] load contacts failed:', err)
      setContacts([])
    }
  }, [prospect.id])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const addContact = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/crm/prospects/${encodeURIComponent(prospect.id)}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', role: '' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.contact) setContacts((prev) => [...prev, data.contact])
    } catch (err) {
      console.error('[CRM] add contact failed:', err)
    }
  }, [prospect.id])

  const patchContactField = useCallback(
    async (contactId: string, field: keyof Contact, next: unknown) => {
      const prev = contacts.find((c) => c.id === contactId)
      if (prev) {
        const same =
          field === 'is_decisive'
            ? Boolean(prev[field]) === Boolean(next)
            : String(prev[field] ?? '') === String(next ?? '')
        if (same) return
      }
      // Optimistic local apply.
      setContacts((cur) => cur.map((c) => (c.id === contactId ? { ...c, [field]: next } : c)))
      try {
        const res = await fetch(`/api/admin/crm/contacts/${encodeURIComponent(contactId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field, next }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        const data = await res.json()
        if (data.contact) setContacts((cur) => cur.map((c) => (c.id === contactId ? data.contact : c)))
      } catch (err) {
        console.error('[CRM] patch contact failed:', err)
        void loadContacts()
      }
    },
    [contacts, loadContacts],
  )

  // Role change — flips is_decisive when the role's decisive-ness changes
  // (crmSetContactRole). Two PATCHes, second only when the bit actually moves.
  const setContactRole = useCallback(
    async (contactId: string, nextRole: string) => {
      const prev = contacts.find((c) => c.id === contactId)
      const wasDecisive = !!(prev && prev.is_decisive)
      const willBeDecisive = roleIsDecisive(nextRole)
      await patchContactField(contactId, 'role', nextRole)
      if (wasDecisive !== willBeDecisive) {
        await patchContactField(contactId, 'is_decisive', willBeDecisive)
      }
    },
    [contacts, patchContactField],
  )

  const editLinkedIn = useCallback(
    async (contactId: string) => {
      const current = contacts.find((c) => c.id === contactId)?.linkedin || ''
      const next = window.prompt(
        current ? 'LinkedIn URL — edit or clear to remove:' : 'LinkedIn URL for this contact:',
        current,
      )
      if (next === null) return
      const trimmed = next.trim()
      await patchContactField(contactId, 'linkedin', trimmed)
      if (trimmed) {
        const href = trimmed.match(/^https?:/) ? trimmed : 'https://' + trimmed
        try {
          window.open(href, '_blank', 'noopener')
        } catch {
          /* popup blocked — best-effort */
        }
      }
    },
    [contacts, patchContactField],
  )

  const deleteContact = useCallback(async (contactId: string) => {
    if (!window.confirm('Delete this contact?')) return
    try {
      const res = await fetch(`/api/admin/crm/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setContacts((cur) => cur.filter((c) => c.id !== contactId))
    } catch (err) {
      console.error('[CRM] delete contact failed:', err)
    }
  }, [])


  // ── Keyword chips (intel.keywords, "kw#rank,…") ──────────────────────────────
  const keywordList = useMemo(
    () => str(intel.keywords).split(',').map((s) => s.trim()).filter(Boolean),
    [intel.keywords],
  )
  const keywordDelete = useCallback(
    (i: number) => {
      if (i < 0 || i >= keywordList.length) return
      const next = [...keywordList]
      next.splice(i, 1)
      setIntelField('keywords', next.join(','))
    },
    [keywordList, setIntelField],
  )
  const keywordAddRef = useRef<HTMLInputElement>(null)
  const keywordAdd = useCallback(
    (el: HTMLInputElement) => {
      const v = (el.value || '').trim().replace(/,/g, '')
      if (!v) return
      setIntelField('keywords', [...keywordList, v].join(','))
      el.value = ''
    },
    [keywordList, setIntelField],
  )

  // ── Click-cycle helpers (tone / budget / employees / buying) ─────────────────
  const cycleTone = useCallback(
    (field: string) => {
      const cur = (str(intel[field]) || 'info') as Tone
      const next = CRM_TONES[(CRM_TONES.indexOf(cur) + 1) % CRM_TONES.length]
      persistIntel({ ...intel, [field]: next })
    },
    [intel, persistIntel],
  )
  const cycleBudget = useCallback(() => {
    const cur = str(intel.verdict_budget) || '—'
    const next = CRM_BUDGETS[(CRM_BUDGETS.indexOf(cur) + 1) % CRM_BUDGETS.length]
    persistIntel({ ...intel, verdict_budget: next })
  }, [intel, persistIntel])
  const setBuying = useCallback(
    (n: number) => {
      const cur = Number(intel.verdict_buying) || 0
      const next = cur === n ? n - 1 : n
      persistIntel({ ...intel, verdict_buying: Math.max(0, Math.min(5, next)) })
    },
    [intel, persistIntel],
  )
  const setEmp = useCallback(
    (bucket: string) => persistIntel({ ...intel, facts_employees: bucket }),
    [intel, persistIntel],
  )
  const rescan = useCallback(
    () => persistIntel({ ...intel, intel_scan_at: new Date().toISOString().slice(0, 10) }),
    [intel, persistIntel],
  )

  // ── Derived display values (crmRenderOpp) ────────────────────────────────────
  const scan = str(intel.intel_scan_at)
  const verdictTag = str(intel.verdict_tag) || 'QUIET LEAD'
  const verdictSubline = str(intel.verdict_subline) || 'No strong signals yet. Worth a discovery call to qualify.'
  const verdictProse = str(intel.verdict_prose)
  const chf = intel.verdict_chf_est ?? ''
  const closePct = intel.verdict_close_pct ?? ''
  const budget = str(intel.verdict_budget) || '—'
  const buying = Math.max(0, Math.min(5, Number(intel.verdict_buying) || 0))
  const verdictTone = (str(intel.verdict_tone) || 'info') as Tone
  const budgetLevel = CRM_BUDGETS.indexOf(budget)
  const emp = str(intel.facts_employees)
  const industryHint = ((prospect.tags || '').split(',')[0] || '').trim().toUpperCase() || 'UNK'
  const proseRows = verdictProse ? verdictProse.split('\n').filter(Boolean) : []

  // Keyword chip tone: rank ≤5 good · ≤20 mid · else dim (no rank → dim).
  const keywordChips = keywordList.map((entry, i) => {
    const m = entry.match(/^(.*)#(\d+)$/)
    const kw = m ? m[1].trim() : entry
    const rank = m ? parseInt(m[2], 10) : null
    const rankToneCls =
      rank == null ? "tone-dim" : rank <= 5 ? "tone-good" : rank <= 20 ? "tone-mid" : "tone-dim"
    return { kw, rank, rankToneCls, i }
  })

  const webHref = prospect.website
    ? prospect.website.match(/^https?:/)
      ? prospect.website
      : 'https://' + prospect.website
    : ''

  // NEXT MOVE strip state (crmComputeNextAction).
  const nextAction = computeNextAction(prospect)
  // CRM-phase bar (crmCrmPhaseBarHtml): 4 segs, filled = stage index + 1.
  const phaseIdx = F8_STAGE_ORDER.indexOf(prospect.stage)
  const phaseFilled = phaseIdx + 1 // 1..4 (0 if unknown stage)
  const phaseSub = (prospect.sub_stage || '').trim()
  const phaseLabel = phaseIdx >= 0 ? `${prospect.stage} ${phaseFilled}/4${phaseSub ? ' · ' + phaseSub : ''}` : ''
  const stageAccent = CRM_STAGE_ACCENT[prospect.stage] || 'var(--accent)'
  // SEND WHATSAPP button gates on ANY phone (not mobile-only) — crm.html F19.
  const waNumber = whatsAppNumber(prospect.phone)
  const confFilled = Math.round(confidencePct / 10)

  // Header interactivity (crm-expanded-header): status buttons, star, focus
  // mode (body.crm-focus-mode hides [data-focus-hide] via crm.css), delete.
  const [focusMode, setFocusMode] = useState(false)
  const toggleFocus = useCallback(() => {
    setFocusMode((f) => {
      const next = !f
      document.body.classList.toggle('crm-focus-mode', next)
      return next
    })
  }, [])
  // Always strip the body class when the detail unmounts (back to queue).
  useEffect(() => () => { document.body.classList.remove('crm-focus-mode') }, [])
  const setStatus = useCallback((status: string) => {
    const oldStatus = prospect.status
    void patchProspect({ status })
    if (status !== oldStatus) registerUndo?.(`status → ${status}`, () => patchProspect({ status: oldStatus }))
  }, [patchProspect, prospect.status, registerUndo])
  const toggleStar = useCallback(() => { void patchProspect({ starred: !prospect.starred }) }, [patchProspect, prospect.starred])
  const deleteLead = useCallback(() => {
    if (!window.confirm(`Delete ${prospect.company || 'this lead'} permanently? This cannot be undone.`)) return
    void fetch(`/api/admin/crm/prospects/${encodeURIComponent(prospect.id)}`, { method: 'DELETE' })
      .then(() => { onClose(); onReload() })
      .catch((err) => console.error('[CRM] delete lead failed:', err))
  }, [prospect.id, prospect.company, onClose, onReload])

  const STATUS_BTNS: [string, string][] = [
    ['To do', 'TODO'], ['Standby', 'STANDBY'], ['Awaiting reply', 'AWAITING'], ['Won', 'WON'], ['Lost', 'LOST'],
  ]

  return (
    <div className={"crm-card is-expanded"} style={{ ['--stage' as string]: stageAccent } as React.CSSProperties}>
      {/* HEADER — crm-expanded-header: identity (back · star · name · trash) ·
          5 status buttons · tools (focus · close). Re-emits crm.html 1:1. */}
      <div className="crm-expanded-header">
        <div className="crm-hdr-identity">
          <button className="crm-hdr-back" onClick={onClose} title="Back to queue (Esc)">
            <ArrowLeft width={12} height={12} />
            BACK
          </button>
          <button
            className={cx('crm-star', prospect.starred && 'is-on')}
            onClick={toggleStar}
            title="Star this lead"
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}
          >
            <Star width={16} height={16} />
          </button>
          <input
            className="crm-hdr-name"
            value={fields.company}
            placeholder="Company"
            onChange={(e) => setFields((f) => ({ ...f, company: e.target.value }))}
            onBlur={(e) => { if (e.target.value !== (prospect.company || '')) void patchProspect({ company: e.target.value }) }}
          />
          <button
            className="crm-hdr-trash"
            onClick={deleteLead}
            title="Delete lead permanently"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex' }}
          >
            <Trash2 width={14} height={14} />
          </button>
        </div>
        <div className="crm-hdr-status">
          {STATUS_BTNS.map(([st, lbl]) => (
            <button
              key={st}
              className={cx('crm-hdr-status-btn', prospect.status === st && 'is-active')}
              data-status={st}
              onClick={() => setStatus(st)}
              title={st}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="crm-hdr-tools">
          <button
            onClick={toggleFocus}
            title="Focus mode (F) — hide everything except feed"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', color: focusMode ? 'var(--brand-amber)' : undefined }}
          >
            <Minimize2 width={14} height={14} />
          </button>
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex' }}>
            <X width={14} height={14} />
          </button>
        </div>
      </div>
      <div className={"crm-hdr-subline"}>
        <span>{prospect.id}</span>
        <span className={"sep"}>·</span>
        <span>{prospect.stage}</span>
        <span className={"sep"}>·</span>
        <span>{prospect.status}</span>
        {phaseIdx >= 0 && (
          <span className={"stage-bars"}>
            <span className={"crm-phase-crm"} title="Sales stage progress">
              {[1, 2, 3, 4].map((n) => (
                <span
                  key={n}
                  className={cx("crm-phase-seg", phaseFilled >= n && "is-on")}
                  style={phaseFilled >= n ? { background: stageAccent } : undefined}
                />
              ))}
              <span className={"crm-phase-label"}>{phaseLabel}</span>
            </span>
          </span>
        )}
      </div>

      {/* NEXT MOVE — urgency-coded hero strip (crmComputeNextAction). */}
      <div className={styles.focusHide} data-focus-hide="1">
        {!nextAction || nextAction.kind === 'static' ? (
          <div className={cx("crm-urgent-hero", "is-empty")}>
            <div className={"uh-main"}>
              <span className={"uh-label"}>Next move</span>
              <span className={"uh-action"} style={{ color: 'var(--text-dim)' }}>
                {nextAction ? nextAction.label : 'No scheduled follow-up'}
              </span>
            </div>
          </div>
        ) : (
          <div
            className={cx(
              "crm-urgent-hero",
              nextAction.kind === 'overdue'
                ? "is-overdue"
                : nextAction.kind === 'today'
                  ? "is-today"
                  : "is-upcoming",
            )}
          >
            <div className={"uh-main"}>
              <span className={"uh-label"}>
                {nextAction.kind === 'overdue' ? '⚠ OVERDUE' : nextAction.kind === 'today' ? '⏰ TODAY' : '📅 SCHEDULED'}
              </span>
              <span className={"uh-date"}>{fmtDateHuman(nextAction.date)}</span>
              <span className={"uh-action"}>· {nextAction.label}</span>
            </div>
            <div className={"uh-actions"}>
              <button onClick={() => snoozeFollowup(1)} title="Push to tomorrow">+1d</button>
              <button onClick={() => snoozeFollowup(3)} title="Push 3 days">+3d</button>
              <button onClick={() => snoozeFollowup(7)} title="Push 1 week">+1w</button>
              <input
                type="date"
                value={(prospect.next_action_date || '').slice(0, 10)}
                onChange={(e) => followupSetCustom(e.target.value)}
              />
              <button onClick={clearFollowup} title="Mark done — clears the scheduled action" style={{ fontWeight: 600 }}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MONEY hero — CHF amount · win confidence · sub-stage (crmPatchEcon). */}
      <div className={cx("crm-money-hero", styles.focusHide)} data-focus-hide="1">
        <label className={"mh-cell"} title="Deal amount (CHF). Click to edit, Enter or Tab to save.">
          <span className={"mh-label"}>CHF</span>
          <input
            type="text"
            inputMode="numeric"
            className={cx("mh-num", "mh-num-chf")}
            defaultValue={fmtCHF(amountChf)}
            key={`amt-${prospect.id}-${amountChf}`}
            onClick={(e) => {
              e.currentTarget.value = String(parseIntLoose(e.currentTarget.value))
              e.currentTarget.select()
            }}
            onFocus={(e) => {
              e.currentTarget.value = String(parseIntLoose(e.currentTarget.value))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onBlur={(e) => {
              patchEcon('amount_chf', e.target.value)
              e.target.value = fmtCHF(parseIntLoose(e.target.value))
            }}
          />
        </label>
        <span className={"mh-divider"} />
        <label className={"mh-cell"} title="Win confidence (0–100%). Click to edit, Enter or Tab to save.">
          <span className={"mh-label"}>Confidence</span>
          <input
            type="number"
            className={cx("mh-num", "mh-num-pct")}
            value={confidencePct}
            min={0}
            max={100}
            step={5}
            onChange={(e) => setConfidencePct(Number(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onBlur={(e) => patchEcon('confidence_pct', e.target.value)}
          />
          <span className={"mh-unit"}>%</span>
          <span className={"crm-conf-bar"} title={`${confidencePct}% win confidence`}>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className={cx("crm-conf-seg", i < confFilled && "is-on")} />
            ))}
          </span>
        </label>
        <span className={"mh-divider"} />
        <label className={"mh-cell"} title="Sub-stage: where this deal is WITHIN its sales stage.">
          <span className={"mh-label"}>Sub-stage</span>
          <span className={"mh-combo"}>
            <input
              className={"mh-combo-input"}
              list="crm-sub-stage-suggestions"
              value={fields.sub_stage}
              placeholder="e.g. contract sent, invoiced…"
              onChange={(e) => setFields((f) => ({ ...f, sub_stage: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              onBlur={(e) => {
                if (e.target.value !== (prospect.sub_stage || '')) void patchProspect({ sub_stage: e.target.value })
              }}
            />
            <datalist id="crm-sub-stage-suggestions">
              {subStageSuggestions.map((v) => <option key={v} value={v} />)}
            </datalist>
            <ChevronDown width={14} height={14} className={"mh-combo-chev"} />
          </span>
        </label>
        <span className={cx("mh-saved", econSaved && "is-visible")}>saved ✓</span>
      </div>

      {/* OPP DASHBOARD canvas (.crm-opp-card) — INTEL → PAIN/PITCH. */}
      <div className={cx("crm-opp-card", styles.focusHide)} data-focus-hide="1">
      {/* INTEL provenance bar */}
      <div className={"crm-opp-intel-bar"}>
        <span className={"crm-opp-intel-label"}>INTEL</span>
        <span className={"crm-opp-intel-sep"} />
        <span className={"crm-opp-intel-status"}>{scan ? 'scan ' + scan : 'no scan yet'}</span>
        <span className={"crm-opp-intel-spacer"} />
        <button className={"crm-opp-intel-btn-icon"} title="Re-scan" onClick={rescan}>
          <RotateCw width={11} height={11} />
        </button>
        <button className={"crm-opp-intel-btn-scan"} onClick={rescan}>
          <Sparkles width={10} height={10} /> {scan ? 'Re-scan' : 'Scan'}
        </button>
      </div>

      {/* VERDICT block */}
      <div className={cx("crm-opp-verdict", "crm-opp-verdict--" + verdictTone)}>
        <div>
          <div className={"crm-opp-verdict-head"}>
            <span className={"crm-opp-verdict-tag"}>VERDICT</span>
            <h3
              className={cx("crm-opp-verdict-headline", "crm-opp-edit")}
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => setIntelField('verdict_tag', e.currentTarget.textContent?.trim() ?? '')}
            >
              {verdictTag}
            </h3>
          </div>
          <div
            className={cx("crm-opp-verdict-subline", "crm-opp-edit")}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => setIntelField('verdict_subline', e.currentTarget.textContent?.trim() ?? '')}
          >
            {verdictSubline}
          </div>
          <textarea
            className={cx("crm-opp-edit", "crm-opp-verdict-prose-edit")}
            placeholder="One bullet per line — scan findings, signals, anything Filippo should see at a glance."
            defaultValue={verdictProse}
            key={`prose-${prospect.id}-${verdictProse}`}
            onBlur={(e) => setIntelField('verdict_prose', e.target.value)}
          />
          {proseRows.length > 0 && (
            <div className={"crm-opp-verdict-prose"}>
              {proseRows.map((line, i) => (
                <div className={"crm-opp-verdict-prose-row"} key={i}>
                  <span>›</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={"crm-opp-verdict-stack"}>
          <div>
            <span className={"crm-opp-verdict-stat-label"}>CHF est.</span>
            <input
              className={cx("crm-opp-edit", "crm-opp-verdict-stat-value")}
              defaultValue={str(chf)}
              key={`chf-${prospect.id}-${str(chf)}`}
              placeholder="—"
              onBlur={(e) => setIntelField('verdict_chf_est', e.target.value)}
            />
          </div>
          <div>
            <span className={"crm-opp-verdict-stat-label"}>Close %</span>
            <input
              className={cx("crm-opp-edit", "crm-opp-verdict-stat-value", "is-amber")}
              defaultValue={str(closePct)}
              key={`close-${prospect.id}-${str(closePct)}`}
              placeholder="—"
              onBlur={(e) => setIntelField('verdict_close_pct', e.target.value)}
            />
          </div>
          <div>
            <span className={"crm-opp-verdict-stat-label"}>BUDGET · {budget}</span>
            <div className={"crm-opp-verdict-budget"}>
              {[0, 1, 2].map((i) => (
                <button
                  key={i}
                  className={cx("crm-opp-verdict-budget-bar", i >= budgetLevel && "is-off")}
                  onClick={cycleBudget}
                  title="Click to cycle LOW → MID → HIGH"
                />
              ))}
            </div>
          </div>
          <div>
            <span className={"crm-opp-verdict-stat-label"}>BUYING · {buying}/5</span>
            <div className={"crm-opp-verdict-buying"}>
              {[0, 1, 2, 3, 4].map((i) => (
                <button
                  key={i}
                  className={cx("crm-opp-verdict-dot", i >= buying && "is-off")}
                  onClick={() => setBuying(i + 1)}
                  title={`${i + 1} of 5`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 6 big lamps */}
      <div className={"crm-opp-lamps"}>
        <div className={"crm-opp-lamps-row"}>
          <Lamp k="age" label="AGE" icon="refresh-cw" intel={intel} onState={setIntelField} onTone={cycleTone} />
          <Lamp k="hosting" label="HOSTING" icon="globe" intel={intel} onState={setIntelField} onTone={cycleTone} />
          <Lamp k="stack" label="STACK" icon="layers" intel={intel} onState={setIntelField} onTone={cycleTone} />
          <Lamp k="photo" label="PHOTO" icon="sparkles" intel={intel} onState={setIntelField} onTone={cycleTone} />
          <Lamp k="performance" label="PERFORMANCE" icon="zap" isScore intel={intel} onState={setIntelField} onTone={cycleTone} />
          <Lamp k="seo" label="SEO" icon="search" isScore intel={intel} onState={setIntelField} onTone={cycleTone} />
        </div>
      </div>

      {/* Small ledger strip */}
      <div className={"crm-opp-strip"}>
        <StripCell k="traffic" label="TRAF" intel={intel} onState={setIntelField} onTone={cycleTone} />
        <span className={"crm-opp-strip-sep"}>│</span>
        <StripCell k="lang" label="LANG" hasTone={false} intel={intel} onState={setIntelField} onTone={cycleTone} />
        <span className={"crm-opp-strip-sep"}>│</span>
        <StripCell k="analytics" label="STATS" intel={intel} onState={setIntelField} onTone={cycleTone} />
        <span className={"crm-opp-strip-sep"}>│</span>
        <StripCell k="marketing" label="ADS" intel={intel} onState={setIntelField} onTone={cycleTone} />
        <span className={"crm-opp-strip-sep"}>│</span>
        <StripCell k="saas" label="SAAS" intel={intel} onState={setIntelField} onTone={cycleTone} />
        <span className={"crm-opp-strip-sep"}>│</span>
        <StripCell k="booking" label="BOOK" intel={intel} onState={setIntelField} onTone={cycleTone} />
      </div>

      {/* DESIGN QUALITY + SEO prose */}
      <div className={"crm-opp-prose"}>
        <div className={"crm-opp-prose-card"}>
          <div className={"crm-opp-prose-label"}>DESIGN QUALITY</div>
          <textarea
            className={cx("crm-opp-edit", "crm-opp-prose-body-edit")}
            placeholder="One to two sentences on the site's visual register, recency, and displacement difficulty."
            defaultValue={str(intel.prose_design)}
            key={`pd-${prospect.id}-${str(intel.prose_design)}`}
            onBlur={(e) => setIntelField('prose_design', e.target.value)}
          />
        </div>
        <div className={"crm-opp-prose-card"}>
          <div className={"crm-opp-prose-label"}>SEO &amp; DISPLACEMENT PAIN</div>
          <textarea
            className={cx("crm-opp-edit", "crm-opp-prose-body-edit")}
            placeholder="One to two sentences on authority, rankings, and displacement difficulty."
            defaultValue={str(intel.prose_seo)}
            key={`ps-${prospect.id}-${str(intel.prose_seo)}`}
            onBlur={(e) => setIntelField('prose_seo', e.target.value)}
          />
        </div>
      </div>

      {/* TOP RANKED keywords / tags — REMOVED (Ralph 2026-06-03). The keyword
          chip editor + "+ add tag" input lived here; not part of the detail
          card anymore. Underlying state (intel.keywords, keywordList,
          keywordAdd, keywordDelete) is kept in place so the intel_json schema
          + future re-introduction stays painless. */}

      {/* Lead facts: reviews / industry / location / employees */}
      <div className={"crm-opp-facts"}>
        <span className={"crm-opp-facts-cell"}>
          <span
            className={cx("crm-opp-facts-label", "crm-opp-facts-label")}
            onClick={() => cycleTone('facts_reviews_tone')}
            title="Click to cycle tone"
          >
            REVIEWS
          </span>
          <input
            className={cx("crm-opp-edit", "crm-opp-facts-value")}
            defaultValue={str(intel.facts_reviews_state)}
            key={`rev-${prospect.id}-${str(intel.facts_reviews_state)}`}
            placeholder="UNK"
            onBlur={(e) => setIntelField('facts_reviews_state', e.target.value)}
          />
          <span
            className={cx("crm-opp-facts-sub", "crm-opp-edit")}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => setIntelField('facts_reviews_sub', e.currentTarget.textContent?.trim() ?? '')}
          >
            {str(intel.facts_reviews_sub)}
          </span>
        </span>
        <span className={"crm-opp-strip-sep"}>│</span>
        <span className={"crm-opp-facts-cell"}>
          <span className={"crm-opp-facts-label"}>INDUSTRY</span>
          <span className={"crm-opp-facts-value"}>{industryHint}</span>
        </span>
        <span className={"crm-opp-strip-sep"}>│</span>
        <span className={"crm-opp-facts-cell"}>
          <span className={"crm-opp-facts-label"}>LOCATION</span>
          <span className={"crm-opp-facts-value"}>{prospect.address_ort || '—'}</span>
        </span>
        <span className={"crm-opp-strip-sep"}>│</span>
        <span className={"crm-opp-facts-label"}>EMPLOYEES</span>
        <div className={"crm-opp-emp-row"}>
          {CRM_EMP_BUCKETS.map((b) => (
            <button key={b} className={cx("crm-opp-emp-btn", emp === b && "is-active")} onClick={() => setEmp(b)}>
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* PAIN POINTS / WHAT TO PITCH */}
      <div className={"crm-opp-pp"}>
        <div>
          <div className={cx("crm-opp-pp-label", "is-pain")}>PAIN POINTS</div>
          <textarea
            className={cx("crm-opp-edit", "crm-opp-pp-edit")}
            placeholder="One bullet per line — what's broken / latent need / fear."
            defaultValue={str(intel.pain)}
            key={`pain-${prospect.id}-${str(intel.pain)}`}
            onBlur={(e) => setIntelField('pain', e.target.value)}
          />
        </div>
        <div>
          <div className={cx("crm-opp-pp-label", "is-pitch")}>WHAT TO PITCH</div>
          <textarea
            className={cx("crm-opp-edit", "crm-opp-pp-edit")}
            placeholder="One bullet per line — angle / solution / proof point."
            defaultValue={str(intel.pitch)}
            key={`pitch-${prospect.id}-${str(intel.pitch)}`}
            onBlur={(e) => setIntelField('pitch', e.target.value)}
          />
        </div>
      </div>
      </div>
      {/* end .oppCard */}

      {/* PEOPLE — 1:many contacts */}
      <div className={cx("crm-people", styles.focusHide)} data-focus-hide="1">
        <div className={"crm-people-head"}>
          <span className={"crm-people-label"}>// People</span>
          <span className={"crm-people-count"}>
            {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'} ·{' '}
            {contacts.filter((c) => c.is_decisive).length} decisive
          </span>
          <button className={"crm-people-add"} onClick={addContact} title="Add a new contact">
            + Add Contact
          </button>
        </div>
        <div className={"crm-people-list"}>
          {contacts.length === 0 ? (
            <div className={"crm-people-empty"}>No contacts yet — click + Add Contact above.</div>
          ) : (
            contacts.map((c) => (
              <PersonRow
                key={c.id}
                contact={c}
                onField={patchContactField}
                onRole={setContactRole}
                onLinkedIn={editLinkedIn}
                onDelete={deleteContact}
              />
            ))
          )}
        </div>
      </div>

      {/* Private notes (Filippo-only) */}
      <div className={cx("crm-field crm-field-compact", styles.focusHide)} data-focus-hide="1">
        <span className={"crm-field-label"}>
          <Lock width={10} height={10} />
          Private notes (you only — never sent)
        </span>
        <textarea
          className={"crm-field-textarea"}
          rows={3}
          placeholder="Your private take on this lead — gut feel, pre-meeting prep, anything you'd whisper to a colleague. Never sent."
          value={fields.notes}
          onChange={(e) => setFields((f) => ({ ...f, notes: e.target.value }))}
          onBlur={(e) => {
            if (e.target.value !== (prospect.notes || '')) void patchProspect({ notes: e.target.value })
          }}
        />
      </div>

      {/* Company / Billing */}
      <div className={cx("crm-company-card", styles.focusHide)} data-focus-hide="1">
        <div className={"crm-company-row crm-company-row-1"}>
          <div className={"crm-company-field"}>
            <span className={"crm-company-label"}>Strasse</span>
            <CompanyInput
              value={fields.address_strasse}
              placeholder="—"
              onChange={(v) => setFields((f) => ({ ...f, address_strasse: v }))}
              onCommit={(v) => v !== (prospect.address_strasse || '') && patchProspect({ address_strasse: v })}
            />
          </div>
          <div className={"crm-company-plzort"}>
            <div className={"crm-company-field"}>
              <span className={"crm-company-label"}>PLZ</span>
              <CompanyInput
                value={fields.address_plz}
                placeholder="—"
                onChange={(v) => setFields((f) => ({ ...f, address_plz: v }))}
                onCommit={(v) => v !== (prospect.address_plz || '') && patchProspect({ address_plz: v })}
              />
            </div>
            <div className={"crm-company-field"}>
              <span className={"crm-company-label"}>Ort</span>
              <CompanyInput
                value={fields.address_ort}
                placeholder="—"
                onChange={(v) => setFields((f) => ({ ...f, address_ort: v }))}
                onCommit={(v) => v !== (prospect.address_ort || '') && patchProspect({ address_ort: v })}
              />
            </div>
          </div>
        </div>
        <div className={"crm-company-row crm-company-row-2"}>
          <div className={"crm-company-field"}>
            <span className={"crm-company-label"}>
              <span>Webpage</span>
              {prospect.website && (
                <a
                  className={"crm-company-label-link"}
                  href={webHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open"
                >
                  <ExternalLink width={11} height={11} />
                </a>
              )}
            </span>
            <CompanyInput
              accent
              value={fields.website}
              placeholder="example.ch"
              onChange={(v) => setFields((f) => ({ ...f, website: v }))}
              onCommit={(v) => v !== (prospect.website || '') && patchProspect({ website: v })}
            />
          </div>
          <div className={"crm-company-field"}>
            <span className={"crm-company-label"}>UID / MWSt.Nr · optional</span>
            <CompanyInput
              accent
              value={fields.uid_number}
              placeholder="CHE-XXX.XXX.XXX"
              onChange={(v) => setFields((f) => ({ ...f, uid_number: v }))}
              onCommit={(v) => v !== (prospect.uid_number || '') && patchProspect({ uid_number: v })}
            />
          </div>
        </div>
      </div>

      {/* History — the activities prop, day-ordered as delivered (DESC). */}
      <div className={styles.historyBlock}>
        <div className={styles.historyHeadRow}>
          <div className={styles.historyHead}>History</div>
          {/* Ralph 2026-06-03 · Session indicator replaces Start Discovery
              when at least one studio session is linked to this prospect.
              Mirrors crm.html's pattern: hide the "start a new one" affordance
              when there's already a session to resume — Filippo opens that
              instead of accidentally creating duplicates. */}
          {linkedSessions.length > 0 ? (
            linkedSessions.map((s) => (
              <a
                key={s.sessionId}
                href={`/?session=${encodeURIComponent(s.sessionId)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`Open ${s.sessionId} in the studio · Phase ${s.phase}/7${s.phaseName ? ` · ${s.phaseName}` : ''}${s.staleDays >= 7 ? ` · ${s.staleDays}d stale` : ''}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: 'var(--brand-amber, #e89e16)', padding: '4px 8px', borderRadius: 6,
                  border: '1px solid color-mix(in srgb, var(--brand-amber, #e89e16) 45%, var(--border-card))',
                  background: 'color-mix(in srgb, var(--brand-amber, #e89e16) 10%, transparent)',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                <Sparkles width={11} height={11} />
                {s.sessionId}
                <ExternalLink width={11} height={11} style={{ opacity: 0.7 }} />
              </a>
            ))
          ) : (
            /* Start Discovery — creates a session linked to this lead, hands CD the
               CRM notes as context, redirects to BRIEF. Port of crm.html crmStartSession. */
            <button
              type="button"
              onClick={startDiscovery}
              title="Start a discovery session linked to this lead"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: '#34d399', padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                border: '1px dashed rgba(21, 185, 129, 0.6)', background: 'transparent',
              }}
            >
              <Plus width={11} height={11} /> Start Discovery
            </button>
          )}
          {/* F19 · Send WhatsApp via Oskar — gated on ANY phone (not mobile). */}
          {waNumber && (
            <button
              className={styles.waBtn}
              onClick={sendWhatsApp}
              title="Send WhatsApp via Oskar — logged as WhatsApp Out activity"
            >
              <MessageCircleIcon width={11} height={11} />
              Send WhatsApp
            </button>
          )}
        </div>
        <div className={styles.feed}>
          {activities.length === 0 ? (
            <div className={"crm-feed-empty"}>No activity yet.</div>
          ) : (
            activities.map((a) => <FeedRow key={a.id} activity={a} onRedownload={onReload} />)
          )}
        </div>
      </div>

    </div>
  )
}

// ─── Lamp (one of the 6) ──────────────────────────────────────────────────────
function Lamp({
  k,
  label,
  icon,
  isScore = false,
  intel,
  onState,
  onTone,
}: {
  k: string
  label: string
  icon: string
  isScore?: boolean
  intel: Intel
  onState: (field: string, value: unknown) => void
  onTone: (field: string) => void
}) {
  const state = str(intel[`lamp_${k}_state`])
  const sub = str(intel[`lamp_${k}_sub`])
  // Score lamps derive tone from the number (<50 bad · <90 mid · ≥90 good);
  // categorical lamps use the stored tone (crmLampHtml).
  let tone: Tone
  if (isScore) {
    const n = parseInt(state, 10)
    tone = !Number.isFinite(n) ? 'info' : n < 50 ? 'bad' : n < 90 ? 'mid' : 'good'
  } else {
    tone = (str(intel[`lamp_${k}_tone`]) || 'info') as Tone
  }
  const toneCls = tone === 'good' ? "tone-good" : tone === 'mid' ? "tone-mid" : tone === 'bad' ? "tone-bad" : ''
  return (
    <div className={cx("crm-opp-lamp", isScore && "is-score", toneCls)}>
      <div className={"crm-opp-lamp-head"}>
        <span className={"crm-opp-lamp-label"}>{label}</span>
        <span className={"crm-opp-lamp-icon"} onClick={() => onTone(`lamp_${k}_tone`)} title="Click to cycle tone">
          <LucideGlyph name={icon} size={10} />
        </span>
      </div>
      <input
        className={cx("crm-opp-edit", "crm-opp-lamp-state")}
        defaultValue={state}
        key={`ls-${k}-${state}`}
        placeholder="—"
        onBlur={(e) => onState(`lamp_${k}_state`, e.target.value)}
      />
      <input
        className={cx("crm-opp-edit", "crm-opp-lamp-sub")}
        defaultValue={sub}
        key={`lsub-${k}-${sub}`}
        placeholder={isScore ? 'lighthouse' : 'sub'}
        onBlur={(e) => onState(`lamp_${k}_sub`, e.target.value)}
      />
    </div>
  )
}

// ─── Strip cell (ledger) ────────────────────────────────────────────────────────
function StripCell({
  k,
  label,
  hasTone = true,
  intel,
  onState,
  onTone,
}: {
  k: string
  label: string
  hasTone?: boolean
  intel: Intel
  onState: (field: string, value: unknown) => void
  onTone: (field: string) => void
}) {
  const field = `strip_${k}${hasTone ? '_state' : ''}`
  const value = str(intel[field])
  const tone = hasTone ? ((str(intel[`strip_${k}_tone`]) || 'info') as Tone) : null
  const toneCls = tone === 'good' ? "tone-good" : tone === 'mid' ? "tone-mid" : tone === 'bad' ? "tone-bad" : ''
  return (
    <span className={"crm-opp-strip-cell"}>
      <span
        className={"crm-opp-strip-label"}
        onClick={hasTone ? () => onTone(`strip_${k}_tone`) : undefined}
        title={hasTone ? 'Click label to cycle tone' : ''}
      >
        {label}
      </span>
      <input
        className={cx("crm-opp-edit", "crm-opp-strip-value", toneCls)}
        defaultValue={value}
        key={`sv-${field}-${value}`}
        placeholder="UNK"
        onBlur={(e) => onState(field, e.target.value)}
      />
    </span>
  )
}

// ─── Person row (one contact) ─────────────────────────────────────────────────
function PersonRow({
  contact: c,
  onField,
  onRole,
  onLinkedIn,
  onDelete,
}: {
  contact: Contact
  onField: (id: string, field: keyof Contact, next: unknown) => void
  onRole: (id: string, role: string) => void
  onLinkedIn: (id: string) => void
  onDelete: (id: string) => void
}) {
  const decisive = roleIsDecisive(c.role)
  const hasLi = !!c.linkedin
  return (
    <div className={cx("crm-person", decisive && "is-decisive")}>
      <button
        className={cx("crm-person-avatar", hasLi && "has-linkedin")}
        onClick={() => onLinkedIn(c.id)}
        title={hasLi ? `LinkedIn: ${c.linkedin} · click to edit` : `Click to link LinkedIn for ${c.name || 'this contact'}`}
      >
        {hasLi ? <LinkedInGlyph /> : contactInitials(c.name)}
      </button>

      <div className={"crm-person-stack"}>
        <input
          className={"crm-person-name-edit"}
          type="text"
          defaultValue={c.name}
          key={`name-${c.id}-${c.name}`}
          placeholder="Full name"
          onBlur={(e) => onField(c.id, 'name', e.target.value)}
        />
        <input
          className={"crm-person-detail-edit"}
          type="text"
          defaultValue={c.title}
          key={`title-${c.id}-${c.title}`}
          placeholder="Title · e.g. founding partner"
          onBlur={(e) => onField(c.id, 'title', e.target.value)}
        />
      </div>

      <div className={"crm-person-stack"}>
        <input
          className={"crm-person-notes-edit"}
          type="text"
          defaultValue={c.notes}
          key={`notes-${c.id}-${c.notes}`}
          placeholder="Notes · prefers WhatsApp after 16:00"
          onBlur={(e) => onField(c.id, 'notes', e.target.value)}
        />
      </div>

      <div className={"crm-person-stack"}>
        <input
          className={"crm-person-contact-line"}
          type="text"
          defaultValue={c.phone}
          key={`phone-${c.id}-${c.phone}`}
          placeholder="Phone"
          onBlur={(e) => onField(c.id, 'phone', e.target.value)}
        />
        <input
          className={cx("crm-person-contact-line", "is-email")}
          type="text"
          defaultValue={c.email}
          key={`email-${c.id}-${c.email}`}
          placeholder="Email"
          onBlur={(e) => onField(c.id, 'email', e.target.value)}
        />
      </div>

      <div className={"crm-person-role-wrap"}>
        <select className={"crm-person-role-select"} value={c.role || ''} onChange={(e) => onRole(c.id, e.target.value)}>
          <option value="">○ — role —</option>
          {CRM_ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {(o.decisive ? '● ' : '○ ') + o.label}
            </option>
          ))}
        </select>
        <span className={"crm-person-role-caret"}>▾</span>
      </div>

      <div className={"crm-person-actions"}>
        {/* Phone-icon-button entfernt (Ralph 2026-06-03) — die Telefonnummer
            steht weiter oben in der Row als editierbares Feld; das `tel:`-
            icon hier daneben war redundant. Email + delete bleiben. */}
        {c.email ? (
          <a href={`mailto:${c.email}`} title="Email">
            <Mail width={12} height={12} />
          </a>
        ) : (
          <button title="No email yet" style={{ opacity: 0.4, cursor: 'default' }}>
            <Mail width={12} height={12} />
          </button>
        )}
        <button className={"crm-person-rm"} onClick={() => onDelete(c.id)} title="Delete contact">
          ×
        </button>
      </div>
    </div>
  )
}

// ─── Feed row (one activity) ────────────────────────────────────────────────────
// WhatsApp media in the activity feed — image/audio/video/document, or a
// "Re-download media" button for inbound messages whose blob wasn't fetched.
// Port of crm.html waMediaBlock + waRedownloadMedia (POST /activities/wa-redownload).
function WaMediaBlock({ activity: a, onRedownload }: { activity: CrmActivity; onRedownload?: () => void }) {
  const [downloading, setDownloading] = useState(false)
  const path = a.media_path || ''
  const mime = a.media_mime || ''

  if (!path) {
    if (a.type === 'WhatsApp In' && a.wa_message_id && mime.length > 0) {
      const redownload = async () => {
        if (!a.wa_message_id) return
        setDownloading(true)
        try {
          const res = await fetch('/api/admin/crm/activities/wa-redownload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wa_message_id: a.wa_message_id }),
          })
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
          if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
          onRedownload?.()
        } catch (err) {
          alert('Re-download failed: ' + (err instanceof Error ? err.message : String(err)))
          setDownloading(false)
        }
      }
      return (
        <div style={{ marginTop: 6 }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); void redownload() }} disabled={downloading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--bg-app)', border: '1px solid var(--border-card)', color: 'var(--text-muted)', cursor: downloading ? 'default' : 'pointer' }}>
            <DownloadCloud width={11} height={11} /> {downloading ? 'Downloading…' : 'Re-download media'}
          </button>
        </div>
      )
    }
    return null
  }

  if (mime.startsWith('image/')) {
    return (
      <div style={{ marginTop: 6 }}>
        <a href={path} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={path} alt="WhatsApp image" loading="lazy" style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, border: '1px solid var(--border-card)', display: 'block', background: 'var(--bg-app)' }} />
        </a>
      </div>
    )
  }
  if (mime.startsWith('audio/')) {
    return <div style={{ marginTop: 6 }}><audio controls preload="metadata" style={{ height: 32, maxWidth: 280 }}><source src={path} type={mime} /></audio></div>
  }
  if (mime.startsWith('video/')) {
    return <div style={{ marginTop: 6 }}><video controls preload="metadata" style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6 }}><source src={path} type={mime} /></video></div>
  }
  const name = path.split('/').pop() || 'file'
  return (
    <div style={{ marginTop: 6 }}>
      <a href={path} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#34d399', textDecoration: 'underline' }}>
        <Paperclip width={11} height={11} /> {name}
      </a>
    </div>
  )
}

// Render a plain message string with URLs as clickable links. Feed message
// bodies are stored as plain text; http(s):// and www. URLs become <a>. Trailing
// punctuation is left outside the link; clicks don't bubble to the card.
const FEED_URL_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi
function linkify(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  FEED_URL_RE.lastIndex = 0
  while ((m = FEED_URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const rawUrl = m[0]
    const trail = rawUrl.match(/[.,;:!?)\]]+$/)?.[0] ?? ''
    const url = trail ? rawUrl.slice(0, -trail.length) : rawUrl
    const href = url.startsWith('http') ? url : `https://${url}`
    out.push(
      <a
        key={`lnk-${k++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="crm-feed-link"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    )
    if (trail) out.push(trail)
    last = m.index + rawUrl.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function FeedRow({ activity: a, onRedownload }: { activity: CrmActivity; onRedownload?: () => void }) {
  const isAudit = AUDIT_TYPES.has(a.type)
  const time = (a.timestamp || '').slice(11, 16) // HH:MM
  const iconName = activityIcon(a.type)

  if (isAudit) {
    let title: string = a.type
    if (a.notes && (a.type === 'stage_changed' || a.type === 'status_changed')) {
      title = `${a.type === 'stage_changed' ? 'Stage' : 'Status'}: ${a.notes}`
    } else if (a.type === 'Started Discovery Session') {
      title = a.session_id ? `Started discovery · ${a.session_id}` : 'Started discovery session'
    } else if (a.type === 'session_archived') {
      title = a.session_id ? `Archived session · ${a.session_id}` : 'Session archived'
    } else if (a.type === 'delivery_started') {
      title = 'Delivery started'
    }
    return (
      <div className={cx("crm-feed-row", "is-audit")}>
        <div className={"crm-feed-row-time"}>{time}</div>
        <div className={"crm-feed-row-main"}>
          <span className={"type-icon"}>
            <LucideGlyph name={iconName} size={12} />
          </span>
          <span className={"crm-feed-text"}>{title}</span>
        </div>
      </div>
    )
  }

  const isEmail = a.type === 'E-mail Out' || a.type === 'E-mail In'
  const isLong = (a.notes || '').length > 200
  let body: string
  if (a.notes) {
    body = isEmail || isLong ? (a.notes.length > 200 ? a.notes.slice(0, 200) + '…' : a.notes) : a.notes
  } else {
    body = ''
  }

  return (
    <div className={"crm-feed-row"}>
      <div className={"crm-feed-row-time"}>{time}</div>
      <div className={"crm-feed-row-main"}>
        <span className={"type-icon"}>
          <LucideGlyph name={iconName} size={12} />
        </span>
        <span className={"crm-feed-text"}>
          {a.subject && <span className={"crm-feed-subject"}>{a.subject}: </span>}
          {a.duration_min ? <span className={"crm-feed-duration"}>{a.duration_min} min · </span> : null}
          {body ? linkify(body) : <span className={"crm-feed-fallback"}>{a.type}</span>}
        </span>
        <WaMediaBlock activity={a} onRedownload={onRedownload} />
      </div>
    </div>
  )
}

// ─── Company input (controlled value, commit on blur) ──────────────────────────
function CompanyInput({
  value,
  placeholder,
  accent = false,
  onChange,
  onCommit,
}: {
  value: string
  placeholder: string
  accent?: boolean
  onChange: (v: string) => void
  onCommit: (v: string) => void
}) {
  return (
    <input
      className={cx("crm-company-input", accent && "is-accent")}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
    />
  )
}

// ─── Icons ──────────────────────────────────────────────────────────────────────
// The vanilla feed/lamp icons are lucide names rendered at runtime. Map the small
// set this component uses to lucide-react components; unknown names fall back to a
// neutral dot (matches the vanilla "circle" default).
import {
  RefreshCw,
  Globe,
  Layers,
  Zap,
  Search,
  Video,
  MailOpen,
  MessageCircle,
  StickyNote,
  FileText,
  Archive,
  Truck,
  Settings2,
  Circle,
  Handshake,
  Car,
} from 'lucide-react'

function LucideGlyph({ name, size }: { name: string; size: number }) {
  const map: Record<string, React.ComponentType<{ width?: number; height?: number }>> = {
    'refresh-cw': RefreshCw,
    globe: Globe,
    layers: Layers,
    zap: Zap,
    search: Search,
    sparkles: Sparkles,
    phone: Phone,
    video: Video,
    handshake: Handshake,
    car: Car,
    mail: Mail,
    'mail-open': MailOpen,
    'message-circle': MessageCircle,
    'sticky-note': StickyNote,
    'file-text': FileText,
    archive: Archive,
    truck: Truck,
    'settings-2': Settings2,
    circle: Circle,
  }
  const Cmp = map[name] || Circle
  return <Cmp width={size} height={size} />
}

function LinkedInGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="LinkedIn">
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
    </svg>
  )
}
