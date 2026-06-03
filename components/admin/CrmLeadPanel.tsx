'use client'

/**
 * CrmLeadPanel — content of the 3rd subtab (CRM) inside AssetsPanel.
 * WP-CRM-C1 (Ralph 2026-05-22).
 *
 * Renders the rich lead detail panel while Filippo is inside a session's
 * BRIEF or STUDIO view. The lead's `prospect_id` is detected by the parent
 * from `_session-config.json` and passed in. All edits PATCH to the
 * existing `/api/admin/crm/prospects/[id]` endpoint. History reads from
 * the new Activities API (WP-CRM-A2/A3). The "+ Log Activity" picker
 * persists rows (no more mock DOM-prepend from v1).
 *
 * Includes the "← back to CRM" button (WP-CRM-C2) that navigates to
 * /admin.html#view-crm with a hint about which card to focus.
 *
 * Visual chrome mirrors the existing AssetsPanel/SentinelTiPanel pattern.
 */

import { useEffect, useState, useCallback, useRef } from 'react'

// WP-CRM-DELETE (Ralph 2026-05-24) — activity types that represent
// automated audit-trail rows. The UI must NOT offer a delete button for
// these; their existence ties to filesystem state (sessions, deploys,
// archives) and removing the row leaves the history dishonest.
const AUDIT_TRAIL_TYPES = new Set<string>([
  'stage_changed',
  'status_changed',
  'delivery_started',
  'session_archived',
  'Started Discovery Session',
])
function isAuditTrailType(t: string): boolean { return AUDIT_TRAIL_TYPES.has(t) }

// ============================================================================
// TYPES (mirror lib/crm-store.ts shapes — kept local to avoid server-only imports)
// ============================================================================

export type ProspectStage = 'Incoming' | 'Contacted' | 'Demo done' | 'Closing'
export type ProspectStatus = 'To do' | 'Standby' | 'Awaiting reply' | 'Won' | 'Lost' | 'Cancelled'

interface Prospect {
  id: string
  company: string
  contact_name: string
  phone: string
  email: string
  website: string
  stage: ProspectStage
  status: ProspectStatus
  amount_chf: number
  confidence_pct: number
  next_action_date: string
  next_action_label: string
  tags: string
  starred: boolean
  owner: string
  notes: string
  created_at: string
}

interface Activity {
  id: string
  prospect_id: string
  timestamp: string
  type: string
  icon: string
  color: string
  duration_min: number
  notes: string
  session_id: string
  user_id: string
}

// WP-121 People: contact rows are 1:many per prospect. Mirrors
// lib/crm-store.ts:Contact (kept local — no server-only imports).
export type ContactRole =
  | 'decision_maker' | 'economic_buyer' | 'owner' | 'ceo' | 'cfo'
  | 'champion' | 'influencer' | 'technical_buyer' | 'end_user'
  | 'gatekeeper' | 'blocker' | 'assistant' | 'other'

interface Contact {
  id: string
  prospect_id: string
  name: string
  role: ContactRole | ''
  phone: string
  email: string
  linkedin: string
  notes: string
  title: string
  is_decisive: boolean
  created_at: string
}

// Role taxonomy — same order/labels as the mockup's <select>.
const CONTACT_ROLE_OPTIONS: { value: ContactRole; label: string }[] = [
  { value: 'decision_maker',   label: 'Decision Maker' },
  { value: 'economic_buyer',   label: 'Economic Buyer' },
  { value: 'owner',            label: 'Owner / Founder' },
  { value: 'ceo',              label: 'CEO' },
  { value: 'cfo',              label: 'CFO' },
  { value: 'champion',         label: 'Champion' },
  { value: 'influencer',       label: 'Influencer' },
  { value: 'technical_buyer',  label: 'Technical Buyer' },
  { value: 'end_user',         label: 'End User' },
  { value: 'gatekeeper',       label: 'Gatekeeper' },
  { value: 'blocker',          label: 'Blocker' },
  { value: 'assistant',        label: 'Assistant' },
  { value: 'other',            label: 'Other' },
]

function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// WP-CRM-D5: per-prospect cost rollup — sums `tokenBurn` from all session
// links for a prospect. Source of truth is `logs/USAGE.json` (sync read
// in scanProspectSessions via `readSessionCostSync`).
interface SessionLinkLite {
  sessionId: string
  tokenBurn?: number
  phase?: number
  phaseName?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_OPTIONS: { value: ProspectStatus; icon: string; color: string }[] = [
  { value: 'Awaiting reply', icon: 'inbox',    color: '#a78bfa' },  // Ralph 2026-05-25 · reply-snooze
  { value: 'To do',     icon: '○', color: '#a78bfa' },
  { value: 'Standby',   icon: '◐', color: '#fbbf24' },
  { value: 'Won',       icon: '✓', color: '#10b981' },
  { value: 'Lost',      icon: '✕', color: '#fb7185' },
  { value: 'Cancelled', icon: '–', color: '#71717a' },
]

// Ralph 2026-05-25 · #8 · pared down to the 6 manual entry points. Qualification
// Call / Zoom Call dropped; E-mail In / WhatsApp In dropped (arrive automatically
// via the dispatcher — manual entry implies outbound by definition). Proposal
// renamed to Documents. Internal types still 'E-mail Out' / 'WhatsApp Out' so
// direction stays distinguishable in the timeline.
const ACTIVITY_TYPES: { type: string; icon: string; color: string; label: string }[] = [
  { type: 'Call',         icon: '📞', color: '#a78bfa', label: 'Call' },
  { type: 'Meeting',      icon: '🤝', color: '#10b981', label: 'Meeting' },
  { type: 'Onsite Visit', icon: '🚗', color: '#10b981', label: 'Onsite Visit' },
  { type: 'E-mail Out',   icon: '✉',  color: '#a1a1aa', label: 'E-Mail' },
  { type: 'WhatsApp Out', icon: '💬', color: '#25D366', label: 'WhatsApp' },
  { type: 'Documents',    icon: '📄', color: '#ef4444', label: 'Documents' },
]

// WP-CRM-F13: WhatsApp launcher helpers. Match the admin.html implementation
// exactly so a prospect renders the same href in either context.
function waNumber(phone: string | undefined | null): string | null {
  let digits = String(phone ?? '').replace(/\D+/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0') && digits.length === 10) digits = '41' + digits.slice(1)
  if (digits.length < 8) return null
  return digits
}

// Ralph 2026-05-25 · WhatsApp only works on MOBILE numbers, not landlines.
// Swiss mobile prefixes after E.164 normalization: 4176, 4177, 4178, 4179.
// Non-Swiss numbers fall through (cannot reliably classify foreign prefixes).
// See admin.html crmIsMobileNumber for the long-form rationale.
function isMobileNumber(normalizedDigits: string | null): boolean {
  if (!normalizedDigits) return false
  if (!normalizedDigits.startsWith('41')) return true
  return /^(76|77|78|79)/.test(normalizedDigits.slice(2))
}

function waHref(p: Pick<Prospect, 'phone' | 'contact_name' | 'company'>): string | null {
  const num = waNumber(p.phone)
  if (!num) return null
  if (!isMobileNumber(num)) return null
  const first = (p.contact_name || '').trim().split(/\s+/)[0]
  const opener = first ? `Hi ${first}, ` : 'Hi, '
  const draft = `${opener}quick follow-up on ${p.company || 'your business'}.`
  return `https://wa.me/${num}?text=${encodeURIComponent(draft)}`
}

// ============================================================================
// PROPS
// ============================================================================

interface CrmLeadPanelProps {
  prospectId: string
}

// ============================================================================
// COMPONENT
// ============================================================================

export function CrmLeadPanel({ prospectId }: CrmLeadPanelProps) {
  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [sessions, setSessions] = useState<SessionLinkLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showActivityPicker, setShowActivityPicker] = useState(false)
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null)
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved'>('idle')

  // WP-CRM-D4: inline confirmation strip for Lost status. Won fires
  // automatically (additive — just an Activity row + a toast); Lost moves
  // files, so it requires an explicit second click inside the panel.
  const [archivePending, setArchivePending] = useState(false)
  const [terminalToast, setTerminalToast] = useState<string | null>(null)

  // Local-state mirror for textarea / inputs so typing is smooth.
  const [commentLocal, setCommentLocal] = useState('')
  const [tagsLocal, setTagsLocal] = useState('')

  // Debounce timer for autosave
  const saveTimer = useRef<NodeJS.Timeout | null>(null)

  // ---------------------------------------------------------------------------
  // LOAD
  // ---------------------------------------------------------------------------

  const loadProspect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/crm/prospects')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { prospects: Prospect[] }
      const found = data.prospects?.find(p => p.id === prospectId) ?? null
      setProspect(found)
      if (found) {
        setCommentLocal(found.notes || '')
        setTagsLocal(found.tags || '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [prospectId])

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/crm/activities?prospect_id=${encodeURIComponent(prospectId)}`)
      if (!res.ok) return
      const data = (await res.json()) as { activities: Activity[] }
      setActivities(data.activities || [])
    } catch (err) {
      console.warn('[CrmLeadPanel] load activities failed:', err)
    }
  }, [prospectId])

  // WP-121 People — read 1:many contacts for this prospect.
  const loadContacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/crm/prospects/${encodeURIComponent(prospectId)}/contacts`)
      if (!res.ok) return
      const data = (await res.json()) as { contacts: Contact[] }
      setContacts(data.contacts || [])
    } catch (err) {
      console.warn('[CrmLeadPanel] load contacts failed:', err)
    }
  }, [prospectId])

  // WP-CRM-D5: pull the prospect's session list from the same endpoint
  // that powers the CRM kanban. Each entry's `tokenBurn` is the per-session
  // production cost in CHF.
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/crm/sessions')
      if (!res.ok) return
      const data = (await res.json()) as {
        links?: Record<string, SessionLinkLite[]>
      }
      setSessions(data.links?.[prospectId] ?? [])
    } catch (err) {
      console.warn('[CrmLeadPanel] load sessions failed:', err)
    }
  }, [prospectId])

  useEffect(() => {
    loadProspect()
    loadActivities()
    loadContacts()
    loadSessions()
  }, [loadProspect, loadActivities, loadContacts, loadSessions])

  // ---------------------------------------------------------------------------
  // WP-121 People — CRUD handlers
  // ---------------------------------------------------------------------------

  const addContactRow = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/crm/prospects/${encodeURIComponent(prospectId)}/contacts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '', role: '' }),
        },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { contact: Contact }
      setContacts(prev => [...prev, data.contact])
    } catch (err) {
      console.error('[CrmLeadPanel] add contact failed:', err)
    }
  }, [prospectId])

  const patchContactField = useCallback(async (
    contactId: string,
    field: keyof Contact,
    next: unknown,
  ) => {
    // Optimistic local apply so contenteditable doesn't flicker.
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, [field]: next } as Contact : c))
    try {
      const res = await fetch(`/api/admin/crm/contacts/${encodeURIComponent(contactId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const data = (await res.json()) as { contact: Contact }
      setContacts(prev => prev.map(c => c.id === contactId ? data.contact : c))
    } catch (err) {
      console.error('[CrmLeadPanel] patch contact failed:', err)
      // Roll back by re-fetching authoritative state.
      loadContacts()
    }
  }, [loadContacts])

  const removeContactRow = useCallback(async (contactId: string) => {
    if (!confirm('Delete this contact?')) return
    try {
      const res = await fetch(`/api/admin/crm/contacts/${encodeURIComponent(contactId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setContacts(prev => prev.filter(c => c.id !== contactId))
    } catch (err) {
      console.error('[CrmLeadPanel] delete contact failed:', err)
    }
  }, [])

  const decisiveCount = contacts.filter(c => c.is_decisive).length

  // ---------------------------------------------------------------------------
  // PATCH
  // ---------------------------------------------------------------------------

  const patchProspect = useCallback(async (patch: Partial<Prospect>) => {
    if (!prospect) return
    setSaveIndicator('saving')
    try {
      const res = await fetch(
        `/api/admin/crm/prospects/${encodeURIComponent(prospect.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const data = (await res.json()) as { prospect: Prospect }
      setProspect(data.prospect)
      setSaveIndicator('saved')
      setTimeout(() => setSaveIndicator('idle'), 1500)
    } catch (err) {
      console.error('[CrmLeadPanel] patch failed:', err)
      setError(err instanceof Error ? err.message : String(err))
      setSaveIndicator('idle')
    }
  }, [prospect])

  // Debounced autosave for comment + tags
  const scheduleAutosave = useCallback((patch: Partial<Prospect>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => patchProspect(patch), 2000)
  }, [patchProspect])

  // ---------------------------------------------------------------------------
  // WP-CRM-D4 · Status terminals (Won + Lost)
  // ---------------------------------------------------------------------------
  //
  // Won at stage Closing → fire /api/admin/deploy (placeholder until
  // WP-DEPLOY ships). Lost → show inline confirmation, then archive the
  // session folder on second click.
  //
  // Standby is intentionally NOT a terminal — Filippo sees the board
  // daily; the kanban IS the reminder surface.

  const showToast = useCallback((msg: string) => {
    setTerminalToast(msg)
    setTimeout(() => setTerminalToast(null), 3500)
  }, [])

  const handleStatusClick = useCallback(async (next: ProspectStatus) => {
    if (!prospect) return

    // Lost requires the user to confirm via the inline strip below.
    // Clicking the pill once just patches the status; the strip then
    // appears and Filippo decides whether to actually move the folder.
    if (next === 'Lost') {
      await patchProspect({ status: 'Lost' })
      setArchivePending(true)
      return
    }

    // Patch first so the UI reflects the chosen status immediately.
    await patchProspect({ status: next })

    // Won + stage Closing fires the placeholder deploy endpoint.
    if (next === 'Won' && prospect.stage === 'Closing') {
      try {
        const latest = sessions[0]
        const res = await fetch('/api/admin/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prospect_id: prospect.id,
            session_id: latest?.sessionId ?? '',
            company: prospect.company,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        showToast(`Delivery workflow queued for ${prospect.company}`)
        loadActivities() // pick up the `delivery_started` row
      } catch (err) {
        console.error('[CrmLeadPanel] deploy failed:', err)
        showToast('Delivery queue failed — check the console')
      }
    }
  }, [prospect, sessions, patchProspect, showToast, loadActivities])

  const confirmArchive = useCallback(async () => {
    if (!prospect) return
    const latest = sessions[0]
    if (!latest?.sessionId) {
      // No session to archive — just keep the Lost status and dismiss
      // the strip; this is the "lead never got past Phase 1" case.
      setArchivePending(false)
      showToast('No session to archive — status saved.')
      return
    }
    try {
      const res = await fetch('/api/admin/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: prospect.id,
          session_id: latest.sessionId,
          company: prospect.company,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      setArchivePending(false)
      showToast(`Archived ${latest.sessionId}`)
      loadSessions()    // session disappears from the list
      loadActivities()  // pick up the `session_archived` row
    } catch (err) {
      console.error('[CrmLeadPanel] archive failed:', err)
      showToast(`Archive failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [prospect, sessions, loadSessions, loadActivities, showToast])

  const cancelArchive = useCallback(() => {
    setArchivePending(false)
    // Status stays at Lost — Filippo can still patch it back manually.
  }, [])

  // ---------------------------------------------------------------------------
  // LOG ACTIVITY
  // ---------------------------------------------------------------------------

  const logActivity = useCallback(async (type: string, icon: string, color: string) => {
    setShowActivityPicker(false)
    if (!prospect) return
    try {
      const res = await fetch('/api/admin/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospect.id, type, icon, color }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { activity: Activity }
      setActivities(prev => [data.activity, ...prev])
    } catch (err) {
      console.error('[CrmLeadPanel] log activity failed:', err)
    }
  }, [prospect])

  const updateActivity = useCallback(async (id: string, patch: { duration_min?: number; notes?: string }) => {
    try {
      const res = await fetch(`/api/admin/crm/activities/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return
      const data = (await res.json()) as { activity: Activity }
      setActivities(prev => prev.map(a => a.id === id ? data.activity : a))
    } catch (err) {
      console.warn('[CrmLeadPanel] update activity failed:', err)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
        Loading lead…
      </div>
    )
  }

  if (error || !prospect) {
    return (
      <div style={{ padding: '24px', color: '#fb7185', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
        {error || `Prospect ${prospectId} not found in CRM.`}
        <div style={{ marginTop: '12px' }}>
          <button onClick={loadProspect} style={btnSecondaryStyle}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '16px 20px' }}>

      {/* ← back to CRM (WP-CRM-C2) + Save indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <button
          onClick={() => {
            try { localStorage.setItem('crm-focus-prospect', prospect.id) } catch { /* ignore */ }
            window.location.href = `/admin.html#view-crm`
          }}
          style={{
            ...btnSecondaryStyle,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          ← back to CRM
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>
            {prospect.company}
          </span>
          {prospect.starred && <span style={{ color: '#fbbf24' }}>★</span>}
          {saveIndicator === 'saving' && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>saving…</span>
          )}
          {saveIndicator === 'saved' && (
            <span style={{ fontSize: '10px', color: '#10b981', fontFamily: 'var(--font-mono)' }}>saved ✓</span>
          )}
        </div>
      </div>

      {/* WP-CRM-D5: economics row — weighted pipeline value (amount × confidence%)
          alongside the rolled-up production cost across all linked sessions. */}
      <div style={{
        display: 'flex',
        gap: '14px',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: '14px',
        paddingBottom: '12px',
        borderBottom: '1px solid var(--border-card)',
      }}>
        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          CHF <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>{Math.round(prospect.amount_chf).toLocaleString('de-CH')}</span>
        </span>
        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {prospect.confidence_pct}% confidence
        </span>
        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#a78bfa' }}>
          weighted: CHF {Math.round(prospect.amount_chf * (prospect.confidence_pct / 100)).toLocaleString('de-CH')}
        </span>
        {sessions.length > 0 && (
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#fb7185' }}>
            production cost: ${sessions.reduce((s, x) => s + (x.tokenBurn ?? 0), 0).toFixed(2)}
            {sessions.length > 1 && (
              <span style={{ color: 'var(--text-muted)' }}> · {sessions.length} sessions</span>
            )}
          </span>
        )}
      </div>

      {/* Status row pills */}
      <div style={{ marginBottom: '18px' }}>
        <SectionLabel>Status</SectionLabel>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleStatusClick(opt.value)}
              style={{
                ...statusPillStyle,
                backgroundColor: prospect.status === opt.value ? opt.color : 'transparent',
                color: prospect.status === opt.value ? '#fff' : 'var(--text-main)',
                borderColor: prospect.status === opt.value ? opt.color : 'var(--border-card)',
              }}
            >
              <span style={{ fontSize: '10px', marginRight: '4px' }}>{opt.icon}</span>
              {opt.value}
            </button>
          ))}
        </div>

        {/* WP-CRM-D4: Lost confirmation strip — moves session folder to
            public/_archive/. Won doesn't need one because it's additive. */}
        {archivePending && sessions[0]?.sessionId && (
          <div style={{
            marginTop: '10px',
            padding: '10px 12px',
            borderRadius: '6px',
            border: '1px solid #fb7185',
            background: 'rgba(251, 113, 133, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <div style={{ fontSize: '12px', color: 'var(--text-main)' }}>
              ⚠ Archive {prospect.company}?
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Moves <code style={{ fontFamily: 'var(--font-mono)' }}>public/{sessions[0].sessionId}/</code> (vibes, brief, images, logs)
              to <code style={{ fontFamily: 'var(--font-mono)' }}>public/_archive/</code>. Cannot be undone easily.
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={cancelArchive} style={btnSecondaryStyle}>Cancel</button>
              <button
                onClick={confirmArchive}
                style={{ ...btnPrimaryStyle, background: 'linear-gradient(135deg, #fb7185, #e11d48)' }}
              >
                Archive
              </button>
            </div>
          </div>
        )}

        {/* WP-CRM-D4: toast for Won deploy queue + archive confirmation */}
        {terminalToast && (
          <div style={{
            marginTop: '10px',
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-card)',
            background: 'var(--bg-app)',
            fontSize: '11px',
            color: 'var(--text-main)',
            fontFamily: 'var(--font-mono)',
          }}>
            {terminalToast}
          </div>
        )}
      </div>

      {/* Company (website only — name/phone/email moved to People per WP-121) */}
      <div style={{ marginBottom: '18px' }}>
        <SectionLabel>Company</SectionLabel>
        <FieldRow label="Website">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <InlineInput
              value={prospect.website}
              onCommit={v => patchProspect({ website: v })}
              placeholder="example.ch"
            />
            {prospect.website && (
              <a href={prospect.website.startsWith('http') ? prospect.website : `https://${prospect.website}`}
                 target="_blank" rel="noopener noreferrer" title="Open website" style={iconBtnStyle}>↗</a>
            )}
          </div>
        </FieldRow>
      </div>

      {/* People (WP-121) — 1:many contacts per company. Supersedes the
          legacy single contact_name/phone/email fields on prospects (the
          columns remain readable for back-compat). */}
      <div style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <SectionLabel inline>// People</SectionLabel>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'} · {decisiveCount} decisive
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {contacts.map(c => (
            <ContactRow
              key={c.id}
              contact={c}
              prospectPhone={prospect.phone}
              prospectCompany={prospect.company}
              onPatch={(field, next) => patchContactField(c.id, field, next)}
              onDelete={() => removeContactRow(c.id)}
            />
          ))}
        </div>

        <button onClick={addContactRow} style={{ ...btnSecondaryStyle, marginTop: '10px', width: '100%' }}>
          + Add Contact
        </button>
      </div>

      {/* Comment (autosave) */}
      <div style={{ marginBottom: '18px' }}>
        <SectionLabel>Comment <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '6px', fontSize: '9px' }}>(autosaves)</span></SectionLabel>
        <textarea
          value={commentLocal}
          onChange={e => {
            setCommentLocal(e.target.value)
            scheduleAutosave({ notes: e.target.value })
          }}
          placeholder="Notes about this lead…"
          style={textareaStyle}
          rows={3}
        />
      </div>

      {/* Tags */}
      <div style={{ marginBottom: '18px' }}>
        <SectionLabel>Tags</SectionLabel>
        <InlineInput
          value={tagsLocal}
          onCommit={v => {
            setTagsLocal(v)
            patchProspect({ tags: v })
          }}
          placeholder="comma, separated, tags"
        />
        {tagsLocal && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
            {tagsLocal.split(',').map(t => t.trim()).filter(Boolean).map((t, i) => (
              <span key={i} style={tagChipStyle}>{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Owner (read-only) */}
      <div style={{ marginBottom: '18px' }}>
        <SectionLabel>Owner</SectionLabel>
        <div style={{ fontSize: '12px', color: 'var(--text-main)' }}>{prospect.owner || 'Filippo'}</div>
      </div>

      {/* Activity log */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <SectionLabel inline>History</SectionLabel>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowActivityPicker(v => !v)}
              style={{ ...btnPrimaryStyle, fontSize: '10px', padding: '4px 10px' }}
            >
              + Log Activity
            </button>
            {showActivityPicker && (
              <div style={activityPickerStyle}>
                {ACTIVITY_TYPES.map(at => (
                  <button
                    key={at.type}
                    onClick={() => logActivity(at.type, at.icon, at.color)}
                    style={activityPickerBtnStyle}
                  >
                    <span style={{ color: at.color, marginRight: '8px' }}>{at.icon}</span>
                    {at.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {activities.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No activities logged yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activities.map(a => (
              <ActivityRow
                key={a.id}
                activity={a}
                isEditing={editingActivityId === a.id}
                onClickEdit={() => setEditingActivityId(a.id === editingActivityId ? null : a.id)}
                onSave={patch => {
                  updateActivity(a.id, patch)
                  setEditingActivityId(null)
                }}
                onCancel={() => setEditingActivityId(null)}
                onDelete={isAuditTrailType(a.type) ? undefined : async () => {
                  // WP-CRM-DELETE (Ralph 2026-05-24) — destructive xlsx mutation.
                  // Audit-trail types are gated above (no button shown).
                  try {
                    const res = await fetch(`/api/admin/crm/activities/${encodeURIComponent(a.id)}`, { method: 'DELETE' })
                    if (!res.ok) {
                      const errBody = await res.json().catch(() => ({ error: res.statusText }))
                      throw new Error(errBody.error || `HTTP ${res.status}`)
                    }
                    setActivities(prev => prev.filter(x => x.id !== a.id))
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err)
                    showToast(`Delete failed: ${msg}`, 'error')
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function SectionLabel({ children, inline = false }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <div style={{
      fontSize: '10px',
      fontFamily: 'var(--font-mono)',
      textTransform: 'uppercase',
      letterSpacing: '0.12em',
      fontWeight: 700,
      color: 'var(--text-muted)',
      marginBottom: inline ? 0 : '8px',
    }}>
      {children}
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
      <div>{children}</div>
    </div>
  )
}

function InlineInput({
  value, onCommit, placeholder,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <input
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local) }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setLocal(value); (e.target as HTMLInputElement).blur() }
      }}
      placeholder={placeholder}
      style={inlineInputStyle}
    />
  )
}

// WP-121 People — single contact row. All fields are edit-on-blur except
// the role <select> (commits on change) and the decisive star + delete
// (commit on click).
function ContactRow({
  contact, prospectPhone, prospectCompany, onPatch, onDelete,
}: {
  contact: Contact
  prospectPhone: string
  prospectCompany: string
  onPatch: (field: keyof Contact, next: unknown) => void
  onDelete: () => void
}) {
  const decisive = contact.is_decisive
  const wa = waHref({ phone: contact.phone || prospectPhone, contact_name: contact.name, company: prospectCompany })
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '36px 1fr auto',
      gap: '10px',
      padding: '10px',
      borderRadius: '6px',
      border: `1px solid ${decisive ? '#fbbf24' : 'var(--border-card)'}`,
      background: 'var(--bg-app)',
    }}>
      {/* Avatar — initials. Spec: clicking opens LinkedIn (via the in button below). */}
      <div style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        background: decisive ? 'rgba(251, 191, 36, 0.15)' : 'var(--bg-card)',
        border: `1px solid ${decisive ? '#fbbf24' : 'var(--border-card)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontWeight: 700,
        color: 'var(--text-main)',
      }}>
        {contactInitials(contact.name)}
      </div>

      {/* Identity + role + contact lines + notes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <InlineInput
            value={contact.name}
            onCommit={v => onPatch('name', v)}
            placeholder="Name"
          />
          <select
            value={contact.role}
            onChange={e => onPatch('role', e.target.value)}
            style={{ ...inlineInputStyle, width: 'auto', minWidth: '140px', cursor: 'pointer' }}
          >
            <option value="">— role —</option>
            {CONTACT_ROLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <InlineInput
          value={contact.title}
          onCommit={v => onPatch('title', v)}
          placeholder="e.g. founding partner · 32yr"
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <InlineInput
              value={contact.phone}
              onCommit={v => onPatch('phone', v)}
              placeholder="+41 …"
            />
            {contact.phone && (
              <a href={`tel:${contact.phone}`} title={`Call ${contact.phone}`} style={iconBtnStyle}>📞</a>
            )}
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp" style={{ ...iconBtnStyle, color: '#25D366' }}>💬</a>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <InlineInput
              value={contact.email}
              onCommit={v => onPatch('email', v)}
              placeholder="name@example.ch"
            />
            {contact.email && (
              <a href={`mailto:${contact.email}`} title="Send email" style={iconBtnStyle}>✉</a>
            )}
          </div>
          <InlineInput
            value={contact.linkedin}
            onCommit={v => onPatch('linkedin', v)}
            placeholder="linkedin.com/in/…"
          />
        </div>

        <textarea
          value={contact.notes}
          onChange={e => onPatch('notes', e.target.value)}
          onBlur={e => onPatch('notes', e.target.value)}
          placeholder="Per-contact lore the Consular reads."
          style={{ ...textareaStyle, minHeight: '32px' }}
          rows={2}
        />
      </div>

      {/* Actions cluster: LinkedIn link · decisive ★ toggle · × delete */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
        {contact.linkedin ? (
          <a
            href={contact.linkedin.startsWith('http') ? contact.linkedin : `https://${contact.linkedin}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open LinkedIn"
            style={{ ...iconBtnStyle, fontWeight: 700, color: '#0a66c2' }}
          >
            in
          </a>
        ) : (
          <span style={{ ...iconBtnStyle, color: 'var(--text-muted)', opacity: 0.5 }} title="No LinkedIn">in</span>
        )}
        <button
          onClick={() => onPatch('is_decisive', !decisive)}
          title={decisive ? 'Decisive — click to unmark' : 'Mark as decisive for this deal'}
          style={{
            ...iconBtnStyle,
            background: 'transparent',
            border: 'none',
            color: decisive ? '#fbbf24' : 'var(--text-muted)',
            fontSize: '16px',
            lineHeight: 1,
          }}
        >
          {decisive ? '★' : '☆'}
        </button>
        <button
          onClick={onDelete}
          title="Delete contact"
          style={{
            ...iconBtnStyle,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '14px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}

function ActivityRow({
  activity, isEditing, onClickEdit, onSave, onCancel, onDelete,
}: {
  activity: Activity
  isEditing: boolean
  onClickEdit: () => void
  onSave: (patch: { duration_min?: number; notes?: string }) => void
  onCancel: () => void
  /** WP-CRM-DELETE: provided only for non-audit-trail rows. When absent
   *  (e.g. stage_changed, Started Discovery Session) the delete button
   *  doesn't render — guards the history's integrity. */
  onDelete?: () => Promise<void>
}) {
  const [duration, setDuration] = useState(String(activity.duration_min || ''))
  const [notes, setNotes] = useState(activity.notes || '')
  const [deleting, setDeleting] = useState(false)  // in-flight guard so a double-click doesn't double-fire
  useEffect(() => {
    setDuration(String(activity.duration_min || ''))
    setNotes(activity.notes || '')
  }, [activity.duration_min, activity.notes])

  const ts = activity.timestamp.slice(0, 16).replace('T', ' ')

  if (isEditing) {
    return (
      <div style={activityRowStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{ts}</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: activity.color || 'var(--text-main)' }}>{activity.type}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
          <input
            type="number"
            value={duration}
            onChange={e => setDuration(e.target.value)}
            placeholder="min"
            style={{ ...inlineInputStyle, width: '60px' }}
          />
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes from this activity"
            style={{ ...textareaStyle, flex: 1 }}
            rows={2}
          />
        </div>
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnSecondaryStyle}>Cancel</button>
          <button
            onClick={() => onSave({
              duration_min: parseInt(duration, 10) || 0,
              notes,
            })}
            style={btnPrimaryStyle}
          >
            Save
          </button>
        </div>
      </div>
    )
  }

  // Ralph 2026-05-25 · no inline confirm for log entries — trash button
  // directly fires onDelete (see button onClick handler below).

  return (
    <div
      className="crm-activity-row-with-delete"
      style={{ ...activityRowStyle, cursor: 'pointer', position: 'relative' }}
      onClick={onClickEdit}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{ts}</span>
        <span style={{ fontSize: '11px', fontWeight: 600, color: activity.color || 'var(--text-main)' }}>
          {activity.type}
        </span>
        {activity.duration_min > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            · {activity.duration_min}min
          </span>
        )}
      </div>
      {activity.notes && (
        <div style={{ fontSize: '11px', color: 'var(--text-main)', marginTop: '3px', lineHeight: 1.4 }}>
          {activity.notes}
        </div>
      )}
      {onDelete && (
        <button
          className="crm-activity-delete-corner"
          onClick={async (e) => {
            // Ralph 2026-05-25 · one-click delete for log entries (no confirm).
            e.stopPropagation()
            if (deleting) return
            setDeleting(true)
            try { await onDelete() } finally { setDeleting(false) }
          }}
          title="Delete activity"
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            padding: '2px 6px',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '12px',
            lineHeight: 1,
            borderRadius: '4px',
            opacity: 0.4,
            transition: 'opacity 0.15s, color 0.15s, background 0.15s',
          }}
        >✕</button>
      )}
    </div>
  )
}

// ============================================================================
// STYLES
// ============================================================================

const btnPrimaryStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #10b981, #059669)',
  color: '#fff',
  border: 'none',
  padding: '5px 12px',
  borderRadius: '5px',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
}

const btnSecondaryStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border-card)',
  padding: '4px 10px',
  borderRadius: '5px',
  fontSize: '10px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
}

const iconBtnStyle: React.CSSProperties = {
  fontSize: '14px',
  textDecoration: 'none',
  color: 'var(--text-main)',
  padding: '2px 4px',
  cursor: 'pointer',
}

const statusPillStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '5px 10px',
  border: '1px solid var(--border-card)',
  borderRadius: '5px',
  cursor: 'pointer',
  background: 'transparent',
}

const inlineInputStyle: React.CSSProperties = {
  background: 'var(--bg-app)',
  border: '1px solid var(--border-card)',
  borderRadius: '4px',
  padding: '4px 8px',
  fontSize: '11px',
  color: 'var(--text-main)',
  width: '100%',
  fontFamily: 'var(--font-sans, system-ui)',
}

const textareaStyle: React.CSSProperties = {
  background: 'var(--bg-app)',
  border: '1px solid var(--border-card)',
  borderRadius: '4px',
  padding: '6px 8px',
  fontSize: '11px',
  color: 'var(--text-main)',
  width: '100%',
  fontFamily: 'var(--font-sans, system-ui)',
  resize: 'vertical',
}

const tagChipStyle: React.CSSProperties = {
  fontSize: '10px',
  padding: '2px 8px',
  borderRadius: '4px',
  background: 'rgba(99, 102, 241, 0.15)',
  color: '#a78bfa',
  fontFamily: 'var(--font-mono)',
}

const activityRowStyle: React.CSSProperties = {
  background: 'var(--bg-app)',
  border: '1px solid var(--border-card)',
  borderRadius: '6px',
  padding: '8px 10px',
}

const activityPickerStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: '6px',
  padding: '4px',
  minWidth: '180px',
  boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
}

const activityPickerBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '6px 10px',
  textAlign: 'left',
  fontSize: '11px',
  color: 'var(--text-main)',
  cursor: 'pointer',
  borderRadius: '4px',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  fontFamily: 'var(--font-sans, system-ui)',
}
