// ============================================================================
// lib/crm-store.ts — CRM persistence (SQLite + append-only event log)
// WP-CRM-F22 (Ralph 2026-05-25)
//
// Replaces the prior xlsx-as-database model. After F22:
//   - Reads come from a local SQLite projection (db/crm.db). Indexed,
//     microsecond-fast.
//   - Writes follow the [SYNC-L] invariant: append event to the JSONL FIRST,
//     then update SQLite. If the SQLite write fails (process kill, disk
//     full), next boot's replay re-derives the row. Log is upstream of cache.
//
// All exported function signatures match the prior xlsx-backed surface so
// existing callers (API routes, wa-runtime.ts, wa-inbound-dispatch.ts)
// don't need to change.
//
// The xlsx file at docs/crm-feature/prospects.xlsx is no longer touched by
// this module. It exists only as a one-shot bootstrap source (lib/crm-boot.ts
// reads it on first boot to seed the event log). After F24 ships properly,
// the xlsx becomes import/export only via WP-CRM-F25.
// ============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { deriveSessionPhase } from './session-phase'
import { readSessionCostSync } from './usage-tracker'
import { appendEvent, makeEvent, type Event } from './event-log'
import { getDb } from './crm-boot'

// ─── Legacy exports kept for back-compat (not used as truth anymore) ────────

export const XLSX_PATH = join(process.cwd(), 'docs', 'crm-feature', 'prospects.xlsx')
export const PUBLIC_DIR = join(process.cwd(), 'public')

// ─── Types (unchanged) ──────────────────────────────────────────────────────

export type ProspectStage = 'Incoming' | 'Contacted' | 'Demo done' | 'Closing'
export type ProspectStatus = 'To do' | 'Standby' | 'Awaiting reply' | 'Won' | 'Lost' | 'Cancelled'

export interface Prospect {
  id: string
  company: string
  contact_name: string
  phone: string
  email: string
  website: string
  address_strasse: string
  address_plz: string
  address_ort: string
  uid_number: string
  /** WP-122 — opportunity dashboard data as a JSON blob. Keys: verdict_tag,
   *  verdict_subline, verdict_prose, verdict_chf_est, verdict_close_pct,
   *  verdict_budget, verdict_buying, lamp_<X>_state/sub/tone (X ∈
   *  age|hosting|stack|photo|performance|seo), strip_<X>_state/tone
   *  (X ∈ traffic|analytics|marketing|saas|booking), strip_lang,
   *  prose_design, prose_seo, keywords, facts_reviews_state/sub/tone,
   *  facts_employees, intel_scan_at. Stored as JSON string to keep schema
   *  flat — UI parses on read, serializes on write. */
  intel_json: string
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
  standby_plan: string
  lost_reason: string
  sub_stage: string
}

export type LostReason =
  | 'Price'
  | 'Competitor'
  | 'Timing'
  | 'No budget'
  | 'No response'
  | string

// Ralph 2026-05-25 · #8 · 'Documents' added (replaces manual 'Proposal' entry
// in the picker; old 'Proposal' rows still render via existing icon logic).
// 'Qualification Call' and 'Zoom Call' were removed from the picker but kept
// in the union so historical activities still type-check.
export type ActivityType =
  | 'Call'
  | 'Qualification Call'
  | 'Meeting'
  | 'Zoom Call'
  | 'Onsite Visit'
  | 'E-mail Out'
  | 'E-mail In'
  | 'WhatsApp Out'
  | 'WhatsApp In'
  | 'Proposal'
  | 'Documents'
  | 'Started Discovery Session'
  | 'stage_changed'
  | 'status_changed'
  | 'delivery_started'
  | 'session_archived'
  | 'Note'

export interface Activity {
  id: string
  prospect_id: string
  timestamp: string
  type: ActivityType
  icon: string
  color: string
  duration_min: number
  notes: string
  session_id: string
  user_id: string
  subject: string
  wa_message_id: string
  wa_status: string
  media_path: string
  media_mime: string
}

// ─── Row → Prospect / Activity coercion ─────────────────────────────────────

function rowToProspect(r: Record<string, unknown>): Prospect {
  return {
    id: String(r.id ?? ''),
    company: String(r.company ?? ''),
    contact_name: String(r.contact_name ?? ''),
    phone: String(r.phone ?? ''),
    email: String(r.email ?? ''),
    website: String(r.website ?? ''),
    address_strasse: String(r.address_strasse ?? ''),
    address_plz: String(r.address_plz ?? ''),
    address_ort: String(r.address_ort ?? ''),
    uid_number: String(r.uid_number ?? ''),
    intel_json: String(r.intel_json ?? '{}'),
    stage: String(r.stage ?? 'Incoming') as ProspectStage,
    status: String(r.status ?? 'To do') as ProspectStatus,
    amount_chf: Number(r.amount_chf ?? 0),
    confidence_pct: Number(r.confidence_pct ?? 0),
    next_action_date: String(r.next_action_date ?? ''),
    next_action_label: String(r.next_action_label ?? ''),
    tags: String(r.tags ?? ''),
    starred: r.starred === 1 || r.starred === true,
    owner: String(r.owner ?? 'Filippo'),
    notes: String(r.notes ?? ''),
    created_at: String(r.created_at ?? ''),
    standby_plan: String(r.standby_plan ?? ''),
    lost_reason: String(r.lost_reason ?? ''),
    sub_stage: String(r.sub_stage ?? ''),
  }
}

function rowToActivity(r: Record<string, unknown>): Activity {
  return {
    id: String(r.id ?? ''),
    prospect_id: String(r.prospect_id ?? ''),
    timestamp: String(r.timestamp ?? ''),
    type: String(r.type ?? 'Note') as ActivityType,
    icon: String(r.icon ?? ''),
    color: String(r.color ?? ''),
    duration_min: Number(r.duration_min ?? 0),
    notes: String(r.notes ?? ''),
    session_id: String(r.session_id ?? ''),
    user_id: String(r.user_id ?? 'Filippo'),
    subject: String(r.subject ?? ''),
    wa_message_id: String(r.wa_message_id ?? ''),
    wa_status: String(r.wa_status ?? ''),
    media_path: String(r.media_path ?? ''),
    media_mime: String(r.media_mime ?? ''),
  }
}

// ─── Prospects: reads ───────────────────────────────────────────────────────

export function readSheet(): Prospect[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM prospects ORDER BY id').all() as Record<string, unknown>[]
  return rows.map(rowToProspect)
}

/**
 * Compute stage-age in days for each prospect by scanning Activities for
 * the latest `stage_changed` row per prospect. Falls back to `created_at`
 * when a lead has never been moved.
 */
export function computeStageAgeMap(): Record<string, number> {
  const db = getDb()
  const out: Record<string, number> = {}
  const stageChanges = db.prepare(`
    SELECT prospect_id, MAX(timestamp) AS latest_ts
    FROM activities
    WHERE type = 'stage_changed' AND soft_deleted = 0
    GROUP BY prospect_id
  `).all() as Array<{ prospect_id: string; latest_ts: string }>
  const latestChange = new Map(stageChanges.map(r => [r.prospect_id, r.latest_ts]))

  const prospects = db.prepare('SELECT id, created_at FROM prospects').all() as Array<{
    id: string; created_at: string | null
  }>
  const now = Date.now()
  for (const p of prospects) {
    const anchor = latestChange.get(p.id) || p.created_at
    if (!anchor) { out[p.id] = 0; continue }
    const t = new Date(anchor).getTime()
    if (!Number.isFinite(t)) { out[p.id] = 0; continue }
    out[p.id] = Math.max(0, Math.floor((now - t) / 86_400_000))
  }
  return out
}

// ─── Prospects: writes (event-first, SQLite-second) ─────────────────────────

const PROSPECT_FIELDS = [
  'company', 'contact_name', 'phone', 'email', 'website',
  'address_strasse', 'address_plz', 'address_ort', 'uid_number',
  'intel_json',
  'stage', 'status', 'amount_chf', 'confidence_pct',
  'next_action_date', 'next_action_label', 'tags', 'starred', 'owner',
  'notes', 'created_at', 'standby_plan', 'lost_reason',
  'sub_stage',
] as const

/**
 * `writeSheet` replaces the entire Prospects table with `rows`. Implemented
 * as a diff against current SQLite state — emits insert events for new
 * rows, update events for each changed field, delete events for rows
 * dropped from `rows`. This way the event log stays append-only and the
 * sync layer (Feature-X WP-106) can replicate the changes correctly.
 */
export async function writeSheet(rows: Prospect[]): Promise<void> {
  const db = getDb()
  const existing = readSheet()
  const existingById = new Map(existing.map(p => [p.id, p]))
  const incomingById = new Map(rows.map(p => [p.id, p]))

  // Inserts + updates
  for (const p of rows) {
    const prev = existingById.get(p.id)
    if (!prev) {
      // Insert
      const event = makeEvent({
        actor: 'system',
        entity: 'prospect',
        entity_id: p.id,
        op: 'insert',
        payload: { ...p, historical_created_at: p.created_at || null },
      })
      await appendEvent(event)
      writeProspectToDb(db, p)
    } else {
      // Update — emit one event per changed field
      for (const field of PROSPECT_FIELDS) {
        const before = (prev as unknown as Record<string, unknown>)[field]
        const after = (p as unknown as Record<string, unknown>)[field]
        if (eqField(field, before, after)) continue
        const event = makeEvent({
          actor: 'system',
          entity: 'prospect',
          entity_id: p.id,
          op: 'update',
          field,
          prev: before,
          next: after,
        })
        await appendEvent(event)
        updateProspectField(db, p.id, field, after)
      }
    }
  }

  // Deletes
  for (const prev of existing) {
    if (incomingById.has(prev.id)) continue
    const event = makeEvent({
      actor: 'system',
      entity: 'prospect',
      entity_id: prev.id,
      op: 'delete',
      prev,
    })
    await appendEvent(event)
    try {
      db.prepare('DELETE FROM prospects WHERE id = ?').run(prev.id)
    } catch (err) {
      console.warn('[crm-store] SQLite prospect delete failed; will recover on next boot replay:', err)
    }
  }
}

function eqField(field: string, a: unknown, b: unknown): boolean {
  if (field === 'starred') return Boolean(a) === Boolean(b)
  if (field === 'amount_chf' || field === 'confidence_pct') return Number(a ?? 0) === Number(b ?? 0)
  return String(a ?? '') === String(b ?? '')
}

function writeProspectToDb(db: ReturnType<typeof getDb>, p: Prospect): void {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO prospects (
        id, company, contact_name, phone, email, website,
        address_strasse, address_plz, address_ort, uid_number,
        stage, status, amount_chf, confidence_pct,
        next_action_date, next_action_label, tags, starred, owner,
        notes, created_at, standby_plan, lost_reason,
        sub_stage, intel_json
      ) VALUES (
        @id, @company, @contact_name, @phone, @email, @website,
        @address_strasse, @address_plz, @address_ort, @uid_number,
        @stage, @status, @amount_chf, @confidence_pct,
        @next_action_date, @next_action_label, @tags, @starred, @owner,
        @notes, @created_at, @standby_plan, @lost_reason,
        @sub_stage, @intel_json
      )
    `).run({
      ...p,
      starred: p.starred ? 1 : 0,
      created_at: p.created_at || null,
      intel_json: p.intel_json || '{}',
      // Default the address/UID named params so an incomplete Prospect (e.g. from
      // the create-lead POST or bulk import, which historically omitted these)
      // never throws "Missing named parameter" — which the catch below would
      // SWALLOW, returning 200 while persisting nothing. The DB columns already
      // default to '' and the replay path (crm-replay) defaults via str(); this
      // makes the live write path consistent. Ralph 2026-05-31.
      address_strasse: p.address_strasse ?? '',
      address_plz: p.address_plz ?? '',
      address_ort: p.address_ort ?? '',
      uid_number: p.uid_number ?? '',
    })
  } catch (err) {
    console.warn('[crm-store] SQLite prospect insert/replace failed; will recover on next boot replay:', err)
  }
}

function updateProspectField(db: ReturnType<typeof getDb>, id: string, field: string, value: unknown): void {
  try {
    const coerced = field === 'starred'
      ? (value ? 1 : 0)
      : (field === 'amount_chf' || field === 'confidence_pct')
        ? Number(value ?? 0)
        : (value === null || value === undefined ? null : String(value))
    db.prepare(`UPDATE prospects SET ${field} = ? WHERE id = ?`).run(coerced, id)
  } catch (err) {
    console.warn(`[crm-store] SQLite prospect field update failed (${field}); will recover on next boot replay:`, err)
  }
}

// ─── Activities: reads ──────────────────────────────────────────────────────

export function readActivities(prospect_id?: string): Activity[] {
  const db = getDb()
  const stmt = prospect_id
    ? db.prepare(`
        SELECT * FROM activities
        WHERE prospect_id = ? AND soft_deleted = 0
        ORDER BY timestamp DESC
      `)
    : db.prepare(`
        SELECT * FROM activities
        WHERE soft_deleted = 0
        ORDER BY timestamp DESC
      `)
  const rows = prospect_id
    ? stmt.all(prospect_id) as Record<string, unknown>[]
    : stmt.all() as Record<string, unknown>[]
  return rows.map(rowToActivity)
}

// ─── Activities: writes ─────────────────────────────────────────────────────

function nextActivityId(db: ReturnType<typeof getDb>): string {
  const row = db.prepare(`
    SELECT id FROM activities
    WHERE id GLOB 'A[0-9][0-9][0-9][0-9]'
    ORDER BY id DESC LIMIT 1
  `).get() as { id?: string } | undefined
  if (!row?.id) return 'A0001'
  const m = row.id.match(/^A(\d+)$/)
  if (!m) return 'A0001'
  return `A${String(parseInt(m[1], 10) + 1).padStart(4, '0')}`
}

export async function appendActivity(input: {
  prospect_id: string
  type: ActivityType
  icon?: string
  color?: string
  duration_min?: number
  notes?: string
  session_id?: string
  timestamp?: string
  user_id?: string
  subject?: string
  wa_message_id?: string
  wa_status?: string
  media_path?: string
  media_mime?: string
}): Promise<Activity> {
  const db = getDb()

  // F19 dedup: if a row with this wa_message_id already exists for this
  // prospect, return it instead of creating a duplicate.
  if (input.wa_message_id) {
    const existing = db.prepare(`
      SELECT * FROM activities
      WHERE wa_message_id = ? AND prospect_id = ? AND soft_deleted = 0
      LIMIT 1
    `).get(input.wa_message_id, input.prospect_id) as Record<string, unknown> | undefined
    if (existing) return rowToActivity(existing)
  }

  const row: Activity = {
    id: nextActivityId(db),
    prospect_id: input.prospect_id,
    timestamp: input.timestamp || new Date().toISOString(),
    type: input.type,
    icon: input.icon || '',
    color: input.color || '',
    duration_min: input.duration_min || 0,
    notes: input.notes || '',
    session_id: input.session_id || '',
    user_id: input.user_id || 'Filippo',
    subject: input.subject || '',
    wa_message_id: input.wa_message_id || '',
    wa_status: input.wa_status || '',
    media_path: input.media_path || '',
    media_mime: input.media_mime || '',
  }

  // STEP 1 (log first): truth before cache.
  const event = makeEvent({
    actor: row.user_id || 'system',
    entity: 'activity',
    entity_id: row.id,
    op: 'insert',
    payload: row as unknown as Record<string, unknown>,
  })
  await appendEvent(event)

  // STEP 2 (cache): warn on failure, don't rethrow — replay rebuilds.
  try {
    db.prepare(`
      INSERT INTO activities (
        id, prospect_id, timestamp, type, icon, color,
        duration_min, notes, session_id, user_id, subject,
        wa_message_id, wa_status, media_path, media_mime,
        soft_deleted
      ) VALUES (
        @id, @prospect_id, @timestamp, @type, @icon, @color,
        @duration_min, @notes, @session_id, @user_id, @subject,
        @wa_message_id, @wa_status, @media_path, @media_mime,
        0
      )
    `).run(row)
  } catch (err) {
    console.warn('[crm-store] SQLite activity insert failed; will recover on next boot replay:', err)
  }

  return row
}

/**
 * F19 · Server-side phone normalizer. Pure function; no DB touch.
 */
export function normalizeWhatsAppNumber(phone: string | undefined | null): string | null {
  let digits = String(phone ?? '').replace(/\D+/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0') && digits.length === 10) digits = '41' + digits.slice(1)
  if (digits.length < 8) return null
  return digits
}

/**
 * F19 · Patch wa_status by wa_message_id. Never downgrades.
 */
export async function updateWaStatusByMessageId(
  wa_message_id: string,
  status: string,
): Promise<Activity | null> {
  if (!wa_message_id) return null
  const db = getDb()
  const existing = db.prepare(`
    SELECT * FROM activities
    WHERE wa_message_id = ? AND soft_deleted = 0
    LIMIT 1
  `).get(wa_message_id) as Record<string, unknown> | undefined
  if (!existing) return null

  const current = String(existing.wa_status ?? '')
  const order: Record<string, number> = { '': 0, sent: 1, delivered: 2, read: 3, failed: 99 }
  if ((order[status] ?? 0) < (order[current] ?? 0)) {
    return rowToActivity(existing)
  }

  const event = makeEvent({
    actor: 'system',
    entity: 'activity',
    entity_id: String(existing.id),
    op: 'update',
    field: 'wa_status',
    prev: current,
    next: status,
  })
  await appendEvent(event)
  try {
    db.prepare('UPDATE activities SET wa_status = ? WHERE id = ?').run(status, String(existing.id))
  } catch (err) {
    console.warn('[crm-store] SQLite wa_status update failed; will recover on next boot replay:', err)
  }
  return rowToActivity({ ...existing, wa_status: status })
}

/**
 * F19 · Patch media_path + media_mime by wa_message_id.
 */
export async function updateMediaByMessageId(
  wa_message_id: string,
  media_path: string,
  media_mime: string,
): Promise<Activity | null> {
  if (!wa_message_id) return null
  const db = getDb()
  const existing = db.prepare(`
    SELECT * FROM activities
    WHERE wa_message_id = ? AND soft_deleted = 0
    LIMIT 1
  `).get(wa_message_id) as Record<string, unknown> | undefined
  if (!existing) return null

  const id = String(existing.id)
  const nextPath = media_path || String(existing.media_path ?? '')
  const nextMime = media_mime || String(existing.media_mime ?? '')

  if (media_path) {
    const event = makeEvent({
      actor: 'system',
      entity: 'activity',
      entity_id: id,
      op: 'update',
      field: 'media_path',
      prev: existing.media_path,
      next: nextPath,
    })
    await appendEvent(event)
  }
  if (media_mime) {
    const event = makeEvent({
      actor: 'system',
      entity: 'activity',
      entity_id: id,
      op: 'update',
      field: 'media_mime',
      prev: existing.media_mime,
      next: nextMime,
    })
    await appendEvent(event)
  }

  try {
    db.prepare('UPDATE activities SET media_path = ?, media_mime = ? WHERE id = ?')
      .run(nextPath, nextMime, id)
  } catch (err) {
    console.warn('[crm-store] SQLite media update failed; will recover on next boot replay:', err)
  }

  return rowToActivity({ ...existing, media_path: nextPath, media_mime: nextMime })
}

export async function updateActivity(
  id: string,
  patch: Pick<Partial<Activity>, 'duration_min' | 'notes' | 'subject' | 'wa_status'>,
): Promise<Activity | null> {
  const db = getDb()
  const existing = db.prepare(`
    SELECT * FROM activities WHERE id = ? AND soft_deleted = 0 LIMIT 1
  `).get(id) as Record<string, unknown> | undefined
  if (!existing) return null

  const updates: Array<{ field: string; prev: unknown; next: unknown }> = []
  for (const field of ['duration_min', 'notes', 'subject', 'wa_status'] as const) {
    if (patch[field] === undefined) continue
    const prev = existing[field]
    const next = patch[field]
    if (String(prev ?? '') === String(next ?? '')) continue
    updates.push({ field, prev, next })
  }

  for (const u of updates) {
    const event = makeEvent({
      actor: 'system',
      entity: 'activity',
      entity_id: id,
      op: 'update',
      field: u.field,
      prev: u.prev,
      next: u.next,
    })
    await appendEvent(event)
  }

  if (updates.length > 0) {
    const setClause = updates.map(u => `${u.field} = ?`).join(', ')
    const values = updates.map(u => u.next === null || u.next === undefined ? null : (u.field === 'duration_min' ? Number(u.next) : String(u.next)))
    try {
      db.prepare(`UPDATE activities SET ${setClause} WHERE id = ?`).run(...values, id)
    } catch (err) {
      console.warn('[crm-store] SQLite activity update failed; will recover on next boot replay:', err)
    }
  }

  const merged = { ...existing }
  for (const u of updates) merged[u.field] = u.next as never
  return rowToActivity(merged)
}

export async function removeActivity(id: string): Promise<Activity | null> {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) return null

  // Hard delete (matches prior behavior). soft_delete is reserved for sync.
  const event = makeEvent({
    actor: 'system',
    entity: 'activity',
    entity_id: id,
    op: 'delete',
    prev: existing,
  })
  await appendEvent(event)
  try {
    db.prepare('DELETE FROM activities WHERE id = ?').run(id)
  } catch (err) {
    console.warn('[crm-store] SQLite activity delete failed; will recover on next boot replay:', err)
  }
  return rowToActivity(existing)
}

export async function removeProspect(id: string): Promise<{
  prospect: Prospect | null
  activitiesRemoved: number
  sessionsUnlinked: string[]
}> {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM prospects WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) return { prospect: null, activitiesRemoved: 0, sessionsUnlinked: [] }

  // Count activities about to cascade-delete (for the return shape).
  const activityCountRow = db.prepare(
    'SELECT COUNT(*) AS n FROM activities WHERE prospect_id = ?',
  ).get(id) as { n: number }
  const activitiesRemoved = activityCountRow.n

  // 1. Emit delete event for prospect (cascade in SQLite handles activities).
  const prospectEvent = makeEvent({
    actor: 'system',
    entity: 'prospect',
    entity_id: id,
    op: 'delete',
    prev: existing,
  })
  await appendEvent(prospectEvent)

  // 2. Emit delete events for each cascaded activity (so replay matches state).
  const acts = db.prepare('SELECT id FROM activities WHERE prospect_id = ?').all(id) as Array<{ id: string }>
  for (const a of acts) {
    const ev = makeEvent({
      actor: 'system',
      entity: 'activity',
      entity_id: a.id,
      op: 'delete',
    })
    await appendEvent(ev)
  }

  // 3. Apply to SQLite (cascade handles activities via FK ON DELETE CASCADE).
  try {
    db.prepare('DELETE FROM prospects WHERE id = ?').run(id)
  } catch (err) {
    console.warn('[crm-store] SQLite prospect delete failed; will recover on next boot replay:', err)
  }

  // 4. Unlink session configs (clear prospect_id, keep folder + content)
  const links = scanProspectSessions({ force: true })
  const sessionsUnlinked: string[] = []
  const linkedSessions = links[id] || []
  for (const link of linkedSessions) {
    try {
      const { readSessionConfig: readCfg, writeSessionConfig: writeCfg } = await import('./session-config')
      const cfg = readCfg(link.sessionId)
      if (cfg && cfg.prospect_id === id) {
        const { prospect_id: _drop, ...rest } = cfg
        await writeCfg(link.sessionId, rest)
        sessionsUnlinked.push(link.sessionId)
      }
    } catch (err) {
      console.warn(`[CRM] failed to unlink session ${link.sessionId} from prospect ${id}:`, err)
    }
  }

  invalidateLinksCache()

  return { prospect: rowToProspect(existing), activitiesRemoved, sessionsUnlinked }
}

// ─── Contacts: types ────────────────────────────────────────────────────────
// WP-121 People. 1:many per prospect. Supersedes prospects.contact_*
// (kept readable for back-compat; this is the source of truth).

export type ContactRole =
  | 'decision_maker'
  | 'economic_buyer'
  | 'owner'
  | 'ceo'
  | 'cfo'
  | 'champion'
  | 'influencer'
  | 'technical_buyer'
  | 'end_user'
  | 'gatekeeper'
  | 'blocker'
  | 'assistant'
  | 'other'

export interface Contact {
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

function rowToContact(r: Record<string, unknown>): Contact {
  return {
    id: String(r.id ?? ''),
    prospect_id: String(r.prospect_id ?? ''),
    name: String(r.name ?? ''),
    role: String(r.role ?? '') as Contact['role'],
    phone: String(r.phone ?? ''),
    email: String(r.email ?? ''),
    linkedin: String(r.linkedin ?? ''),
    notes: String(r.notes ?? ''),
    title: String(r.title ?? ''),
    is_decisive: r.is_decisive === 1 || r.is_decisive === true,
    created_at: String(r.created_at ?? ''),
  }
}

// ─── Contacts: reads ────────────────────────────────────────────────────────

export function readContacts(prospect_id: string): Contact[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM contacts
    WHERE prospect_id = ?
    ORDER BY is_decisive DESC, created_at ASC
  `).all(prospect_id) as Record<string, unknown>[]
  return rows.map(rowToContact)
}

export function readContact(id: string): Contact | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToContact(row) : null
}

// ─── Contacts: writes (event-first, SQLite-second) ──────────────────────────

const CONTACT_FIELDS = [
  'name', 'role', 'phone', 'email', 'linkedin', 'notes', 'title', 'is_decisive',
] as const

function nextContactId(db: ReturnType<typeof getDb>): string {
  const row = db.prepare(`
    SELECT id FROM contacts
    WHERE id GLOB 'C[0-9][0-9][0-9][0-9]'
    ORDER BY id DESC LIMIT 1
  `).get() as { id?: string } | undefined
  if (!row?.id) return 'C0001'
  const m = row.id.match(/^C(\d+)$/)
  if (!m) return 'C0001'
  return `C${String(parseInt(m[1], 10) + 1).padStart(4, '0')}`
}

export async function addContact(input: {
  prospect_id: string
  name?: string
  role?: ContactRole | ''
  phone?: string
  email?: string
  linkedin?: string
  notes?: string
  title?: string
  is_decisive?: boolean
}): Promise<Contact> {
  const db = getDb()
  const row: Contact = {
    id: nextContactId(db),
    prospect_id: input.prospect_id,
    name: input.name ?? '',
    role: input.role ?? '',
    phone: input.phone ?? '',
    email: input.email ?? '',
    linkedin: input.linkedin ?? '',
    notes: input.notes ?? '',
    title: input.title ?? '',
    is_decisive: input.is_decisive ?? false,
    created_at: new Date().toISOString(),
  }

  // STEP 1: log first.
  const event = makeEvent({
    actor: 'Filippo',
    entity: 'contact',
    entity_id: row.id,
    op: 'insert',
    payload: { ...row, is_decisive: row.is_decisive },
  })
  await appendEvent(event)

  // STEP 2: project.
  try {
    db.prepare(`
      INSERT INTO contacts (
        id, prospect_id, name, role, phone, email, linkedin,
        notes, title, is_decisive, created_at
      ) VALUES (
        @id, @prospect_id, @name, @role, @phone, @email, @linkedin,
        @notes, @title, @is_decisive, @created_at
      )
    `).run({ ...row, is_decisive: row.is_decisive ? 1 : 0 })
  } catch (err) {
    console.warn('[crm-store] SQLite contact insert failed; will recover on next boot replay:', err)
  }
  return row
}

export async function updateContactField(
  id: string,
  field: typeof CONTACT_FIELDS[number],
  next: unknown,
): Promise<Contact | null> {
  if (!CONTACT_FIELDS.includes(field)) {
    console.warn(`[crm-store] updateContactField rejected unknown field "${field}"`)
    return null
  }
  const db = getDb()
  const prev = readContact(id)
  if (!prev) return null
  const prevValue = (prev as unknown as Record<string, unknown>)[field]

  // Skip no-op writes.
  if (field === 'is_decisive') {
    if (Boolean(prevValue) === Boolean(next)) return prev
  } else if (String(prevValue ?? '') === String(next ?? '')) {
    return prev
  }

  const event = makeEvent({
    actor: 'Filippo',
    entity: 'contact',
    entity_id: id,
    op: 'update',
    field,
    prev: prevValue,
    next,
  })
  await appendEvent(event)

  try {
    const coerced = field === 'is_decisive'
      ? (next ? 1 : 0)
      : (next === null || next === undefined ? null : String(next))
    db.prepare(`UPDATE contacts SET ${field} = ? WHERE id = ?`).run(coerced, id)
  } catch (err) {
    console.warn(`[crm-store] SQLite contact field update failed (${field}); will recover on next boot replay:`, err)
  }
  return readContact(id)
}

export async function removeContact(id: string): Promise<Contact | null> {
  const db = getDb()
  const existing = readContact(id)
  if (!existing) return null

  const event = makeEvent({
    actor: 'Filippo',
    entity: 'contact',
    entity_id: id,
    op: 'delete',
    prev: existing,
  })
  await appendEvent(event)

  try {
    db.prepare('DELETE FROM contacts WHERE id = ?').run(id)
  } catch (err) {
    console.warn('[crm-store] SQLite contact delete failed; will recover on next boot replay:', err)
  }
  return existing
}

// ============================================================================
// FILE-SYSTEM SESSION SCAN (unchanged from xlsx-era — does not touch the DB)
// ============================================================================

export interface SessionLink {
  sessionId: string
  createdAt: string
  outcome: 'won' | 'lost' | 'abandoned' | null
  phase?: number
  phaseName?: string
  staleDays?: number
  tokenBurn?: number
}

export type LinksMap = Record<string, SessionLink[]>

interface SessionConfig {
  prospect_id?: string
  createdAt?: string
  outcome?: 'won' | 'lost' | 'abandoned' | null
}

let linksCache: LinksMap | null = null
let lastScanAt = 0
const CACHE_TTL_MS = 5_000

export function invalidateLinksCache(): void {
  linksCache = null
  lastScanAt = 0
}

const CONFIG_RELATIVE_PATHS = ['logs/_session-config.json', '_session-config.json'] as const

function configFilePath(folderPath: string): string | null {
  for (const rel of CONFIG_RELATIVE_PATHS) {
    const p = join(folderPath, rel)
    if (existsSync(p)) return p
  }
  return null
}

function isSessionFolder(folderPath: string): boolean {
  try {
    return statSync(folderPath).isDirectory() && configFilePath(folderPath) !== null
  } catch {
    return false
  }
}

function readSessionConfig(folderPath: string): SessionConfig | null {
  const p = configFilePath(folderPath)
  if (!p) return null
  try {
    const buf = readFileSync(p, 'utf8')
    return JSON.parse(buf) as SessionConfig
  } catch {
    return null
  }
}

export function scanProspectSessions(opts?: { force?: boolean }): LinksMap {
  const now = Date.now()
  if (!opts?.force && linksCache && now - lastScanAt < CACHE_TTL_MS) {
    return linksCache
  }

  const out: LinksMap = {}
  if (!existsSync(PUBLIC_DIR)) {
    linksCache = out
    lastScanAt = now
    return out
  }

  try {
    const entries = readdirSync(PUBLIC_DIR)
    for (const entry of entries) {
      if (entry.startsWith('.') || entry.startsWith('_')) continue
      const fullPath = join(PUBLIC_DIR, entry)
      if (!isSessionFolder(fullPath)) continue
      const cfg = readSessionConfig(fullPath)
      if (!cfg?.prospect_id) continue
      const phaseInfo = deriveSessionPhase(fullPath)
      const sessionCost = readSessionCostSync(entry)
      const link: SessionLink = {
        sessionId: entry,
        createdAt: cfg.createdAt || '',
        outcome: cfg.outcome ?? null,
        phase: phaseInfo.phase,
        phaseName: phaseInfo.phaseName,
        staleDays: phaseInfo.staleDays,
        tokenBurn: sessionCost,
      }
      const list = out[cfg.prospect_id] ?? []
      list.push(link)
      out[cfg.prospect_id] = list
    }
    for (const pid of Object.keys(out)) {
      out[pid].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    }
  } catch (err) {
    console.error('[crm-store] scanProspectSessions failed:', err)
  }

  linksCache = out
  lastScanAt = now
  return out
}

// ============================================================================
// SLUGIFY (unchanged)
// ============================================================================

export function slugify(input: string): string {
  return (input || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}.\-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 50)
    || 'untitled'
}

// ─── Re-export types from event-log for callers that want them ──────────────

export type { Event }
