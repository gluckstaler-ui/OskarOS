// ============================================================================
// lib/crm-replay.ts — rebuild SQLite projection from the event log
// WP-CRM-F22 (Ralph 2026-05-25)
//
// Single code path used by:
//   - Boot (lib/crm-boot.ts) — incremental, from events_seen cursor.
//   - Manual recovery — `coldReplay()` wipes SQLite and replays from scratch.
//   - Test suite (F23) — same `applyEventsToDb` reducer, hand-built fixtures.
//
// The reducer's job is mechanical: dispatch on (entity, op), call the right
// INSERT / UPDATE / DELETE. NO derived field computation here — derived
// fields belong in the live-write path (crm-store.ts) AND must be re-emitted
// as events so replay sees them. F23's test 4 ("live writes converge to
// cold replay") enforces this.
// ============================================================================

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import type { Event } from './event-log'
import { getEventsDir, setLamportFromReplay } from './event-log'

export interface ReplayResult {
  appliedEventCount: number
  highestLamportPerNode: Record<string, number>
  malformedLineCount: number
}

// ─── Public entry points ────────────────────────────────────────────────────

/**
 * Drop ALL rows in the projection and rebuild from every event in the log.
 * Used by manual recovery and by the test suite. The boot path uses
 * `incrementalReplay` instead — same result, faster on large logs.
 */
export function coldReplay(db: Database.Database): ReplayResult {
  // FKs OFF during a full rebuild (Ralph 2026-06-03): the event log is the
  // source of truth, but replaying the *entire* history in lamport order can
  // transiently reference a not-yet-inserted / since-deleted / id-reused parent
  // (e.g. a contact whose prospect was deleted-then-recreated, or a reused
  // prospect id). The NET projection is consistent; enforcing per-statement FKs
  // mid-replay would crash recovery. Re-enabled after. Live writes keep FKs ON.
  db.pragma('foreign_keys = OFF')
  try {
    truncateProjection(db)
    const { events, malformedLineCount } = readAllEvents()
    const result = applyEventsToDb(db, events)
    return { ...result, malformedLineCount }
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

/**
 * Apply only events past the per-node cursor in events_seen. Idempotent:
 * if no new events have arrived since the last replay, this is a no-op
 * that completes in microseconds.
 */
export function incrementalReplay(db: Database.Database): ReplayResult {
  const cursors = readCursors(db)
  const { events, malformedLineCount } = readEventsAfterCursors(cursors)
  const result = applyEventsToDb(db, events)
  return { ...result, malformedLineCount }
}

/**
 * Apply a known set of events to SQLite. Sorts by (lamport, node) before
 * applying so callers don't have to. Wraps the whole sequence in a single
 * transaction — if any event fails, the entire batch rolls back.
 *
 * Exported so the test suite (F23) can call it directly with hand-built
 * fixtures without needing the JSONL files on disk.
 */
export function applyEventsToDb(
  db: Database.Database,
  events: Event[],
): ReplayResult {
  const sorted = [...events].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport
    return a.node.localeCompare(b.node)
  })

  let applied = 0
  const maxLamportPerNode: Record<string, number> = {}
  const lastEventIdPerNode: Record<string, string> = {}

  const tx = db.transaction(() => {
    for (const event of sorted) {
      applyOne(db, event)
      applied++
      maxLamportPerNode[event.node] = Math.max(maxLamportPerNode[event.node] ?? 0, event.lamport)
      lastEventIdPerNode[event.node] = event.id
    }
  })
  tx()

  // Update cursors. One row per node with highest_lamport seen so far.
  const cursorStmt = db.prepare(`
    INSERT INTO events_seen (node, highest_lamport, highest_event_id, applied_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(node) DO UPDATE SET
      highest_lamport = excluded.highest_lamport,
      highest_event_id = excluded.highest_event_id,
      applied_at = excluded.applied_at
  `)
  const now = new Date().toISOString()
  for (const [node, lamport] of Object.entries(maxLamportPerNode)) {
    cursorStmt.run(node, lamport, lastEventIdPerNode[node], now)
  }

  // Seed the in-memory lamport counter to the highest seen overall, so the
  // next live write gets a strictly-greater value.
  const overallMax = Math.max(0, ...Object.values(maxLamportPerNode))
  setLamportFromReplay(overallMax)

  return { appliedEventCount: applied, highestLamportPerNode: maxLamportPerNode, malformedLineCount: 0 }
}

// ─── Reducer (the only code that knows how to apply an event) ───────────────

function applyOne(db: Database.Database, e: Event): void {
  if (e.entity === 'prospect') {
    applyProspectEvent(db, e)
  } else if (e.entity === 'activity') {
    applyActivityEvent(db, e)
  } else if (e.entity === 'contact') {
    applyContactEvent(db, e)
  } else if (e.entity === 'raw_prospect') {
    applyRawProspectEvent(db, e)
  } else if (e.entity === 'merge_conflict') {
    applyMergeConflictEvent(db, e)
  }
  // Unknown entities silently skipped — forward-compat with future event types.
}

function applyProspectEvent(db: Database.Database, e: Event): void {
  if (e.op === 'insert') {
    const p = (e.payload ?? {}) as Record<string, unknown>
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
      id: e.entity_id,
      company: str(p.company),
      contact_name: str(p.contact_name),
      phone: str(p.phone),
      email: str(p.email),
      website: str(p.website),
      address_strasse: str(p.address_strasse),
      address_plz: str(p.address_plz),
      address_ort: str(p.address_ort),
      uid_number: str(p.uid_number),
      intel_json: str(p.intel_json) || '{}',
      stage: str(p.stage) || 'Incoming',
      status: str(p.status) || 'To do',
      amount_chf: num(p.amount_chf),
      confidence_pct: num(p.confidence_pct),
      next_action_date: str(p.next_action_date),
      next_action_label: str(p.next_action_label),
      tags: str(p.tags),
      starred: bool(p.starred) ? 1 : 0,
      owner: str(p.owner),
      notes: str(p.notes),
      created_at:
        str(p.historical_created_at) ||
        str(p.created_at) ||
        null,
      standby_plan: str(p.standby_plan),
      lost_reason: str(p.lost_reason),
      sub_stage: str(p.sub_stage),
    })
  } else if (e.op === 'update') {
    if (!e.field) return
    const allowed = ALLOWED_PROSPECT_UPDATE_FIELDS
    if (!allowed.has(e.field)) {
      console.warn(`[crm-replay] ignoring update to unknown prospect field "${e.field}"`)
      return
    }
    // Each field has its own typed column; use a parameterized stmt per field.
    const value = e.field === 'starred'
      ? (bool(e.next) ? 1 : 0)
      : (e.field === 'amount_chf' || e.field === 'confidence_pct')
        ? num(e.next)
        : (e.next === null || e.next === undefined ? null : String(e.next))
    db.prepare(`UPDATE prospects SET ${e.field} = ? WHERE id = ?`).run(value, e.entity_id)
  } else if (e.op === 'delete') {
    db.prepare(`DELETE FROM prospects WHERE id = ?`).run(e.entity_id)
  }
}

function applyActivityEvent(db: Database.Database, e: Event): void {
  if (e.op === 'insert') {
    const a = (e.payload ?? {}) as Record<string, unknown>
    db.prepare(`
      INSERT OR REPLACE INTO activities (
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
    `).run({
      id: e.entity_id,
      prospect_id: str(a.prospect_id),
      timestamp: str(a.timestamp) || e.ts,
      type: str(a.type),
      icon: str(a.icon),
      color: str(a.color),
      duration_min: a.duration_min == null ? null : num(a.duration_min),
      notes: str(a.notes),
      session_id: str(a.session_id),
      user_id: str(a.user_id),
      subject: str(a.subject),
      wa_message_id: str(a.wa_message_id),
      wa_status: str(a.wa_status),
      media_path: str(a.media_path),
      media_mime: str(a.media_mime),
    })
  } else if (e.op === 'update') {
    if (!e.field) return
    const allowed = ALLOWED_ACTIVITY_UPDATE_FIELDS
    if (!allowed.has(e.field)) {
      console.warn(`[crm-replay] ignoring update to unknown activity field "${e.field}"`)
      return
    }
    const value = e.field === 'duration_min'
      ? (e.next == null ? null : num(e.next))
      : (e.next === null || e.next === undefined ? null : String(e.next))
    db.prepare(`UPDATE activities SET ${e.field} = ? WHERE id = ?`).run(value, e.entity_id)
  } else if (e.op === 'soft_delete') {
    db.prepare(`UPDATE activities SET soft_deleted = 1 WHERE id = ?`).run(e.entity_id)
  } else if (e.op === 'delete') {
    db.prepare(`DELETE FROM activities WHERE id = ?`).run(e.entity_id)
  }
}

function applyContactEvent(db: Database.Database, e: Event): void {
  if (e.op === 'insert') {
    const c = (e.payload ?? {}) as Record<string, unknown>
    db.prepare(`
      INSERT OR REPLACE INTO contacts (
        id, prospect_id, name, role, phone, email, linkedin,
        notes, title, is_decisive, created_at
      ) VALUES (
        @id, @prospect_id, @name, @role, @phone, @email, @linkedin,
        @notes, @title, @is_decisive, @created_at
      )
    `).run({
      id: e.entity_id,
      prospect_id: str(c.prospect_id),
      name: str(c.name),
      role: str(c.role),
      phone: str(c.phone),
      email: str(c.email),
      linkedin: str(c.linkedin),
      notes: str(c.notes),
      title: str(c.title),
      is_decisive: bool(c.is_decisive) ? 1 : 0,
      created_at: str(c.created_at) || e.ts,
    })
  } else if (e.op === 'update') {
    if (!e.field) return
    const allowed = ALLOWED_CONTACT_UPDATE_FIELDS
    if (!allowed.has(e.field)) {
      console.warn(`[crm-replay] ignoring update to unknown contact field "${e.field}"`)
      return
    }
    const value = e.field === 'is_decisive'
      ? (bool(e.next) ? 1 : 0)
      : (e.next === null || e.next === undefined ? null : String(e.next))
    db.prepare(`UPDATE contacts SET ${e.field} = ? WHERE id = ?`).run(value, e.entity_id)
  } else if (e.op === 'delete') {
    db.prepare(`DELETE FROM contacts WHERE id = ?`).run(e.entity_id)
  }
}

function applyRawProspectEvent(db: Database.Database, e: Event): void {
  // Scout v1 (Ralph 2026-06-03): the pre-Kanban pool. Mirrors applyProspectEvent.
  if (e.op === 'insert') {
    const p = (e.payload ?? {}) as Record<string, unknown>
    db.prepare(`
      INSERT OR REPLACE INTO raw_prospects (
        id, source, scraped_at, raw_payload,
        name, company, phone, email, website, country, industry,
        promoted_at, promoted_to, rejected_at, rejected_reason, scout_json
      ) VALUES (
        @id, @source, @scraped_at, @raw_payload,
        @name, @company, @phone, @email, @website, @country, @industry,
        @promoted_at, @promoted_to, @rejected_at, @rejected_reason, @scout_json
      )
    `).run({
      id: e.entity_id,
      source: str(p.source),
      scraped_at: str(p.scraped_at) || new Date(e.ts ?? Date.now()).toISOString(),
      raw_payload: str(p.raw_payload) || '{}',
      name: nul(p.name),
      company: nul(p.company),
      phone: nul(p.phone),
      email: nul(p.email),
      website: nul(p.website),
      country: nul(p.country),
      industry: nul(p.industry),
      // NULL (not '') preserved on the stamps — readRawProspects filters on IS NULL.
      promoted_at: nul(p.promoted_at),
      promoted_to: nul(p.promoted_to),
      rejected_at: nul(p.rejected_at),
      rejected_reason: nul(p.rejected_reason),
      scout_json: str(p.scout_json) || '{}',
    })
  } else if (e.op === 'update') {
    if (!e.field) return
    if (!ALLOWED_RAW_PROSPECT_UPDATE_FIELDS.has(e.field)) {
      console.warn(`[crm-replay] ignoring update to unknown raw_prospect field "${e.field}"`)
      return
    }
    const value = e.next === null || e.next === undefined ? null : String(e.next)
    db.prepare(`UPDATE raw_prospects SET ${e.field} = ? WHERE id = ?`).run(value, e.entity_id)
  } else if (e.op === 'delete') {
    db.prepare(`DELETE FROM raw_prospects WHERE id = ?`).run(e.entity_id)
  }
}

function applyMergeConflictEvent(_db: Database.Database, _e: Event): void {
  // Populated by Feature-X WP-106 sync. Schema present, replay stub.
}

// ─── Allowed update field whitelists (defense against malformed events) ─────

const ALLOWED_PROSPECT_UPDATE_FIELDS = new Set<string>([
  'intel_json',
  'company', 'contact_name', 'phone', 'email', 'website',
  'address_strasse', 'address_plz', 'address_ort', 'uid_number',
  'stage', 'status', 'amount_chf', 'confidence_pct',
  'next_action_date', 'next_action_label', 'tags', 'starred', 'owner',
  'notes', 'created_at', 'standby_plan', 'lost_reason',
  'sub_stage',
])

const ALLOWED_ACTIVITY_UPDATE_FIELDS = new Set<string>([
  'timestamp', 'type', 'icon', 'color', 'duration_min', 'notes',
  'session_id', 'user_id', 'subject', 'wa_message_id', 'wa_status',
  'media_path', 'media_mime',
])

const ALLOWED_CONTACT_UPDATE_FIELDS = new Set<string>([
  'name', 'role', 'phone', 'email', 'linkedin', 'notes', 'title', 'is_decisive',
])

const ALLOWED_RAW_PROSPECT_UPDATE_FIELDS = new Set<string>([
  'name', 'company', 'phone', 'email', 'website', 'country', 'industry',
  'scout_json', 'promoted_at', 'promoted_to', 'rejected_at', 'rejected_reason',
])

// ─── Log reading helpers ────────────────────────────────────────────────────

function readAllEvents(): { events: Event[]; malformedLineCount: number } {
  const dir = getEventsDir()
  if (!existsSync(dir)) return { events: [], malformedLineCount: 0 }
  const events: Event[] = []
  let malformed = 0
  for (const filename of readdirSync(dir)) {
    if (!filename.startsWith('events-') || !filename.endsWith('.jsonl')) continue
    const raw = readFileSync(join(dir, filename), 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line) continue
      try {
        events.push(JSON.parse(line) as Event)
      } catch {
        malformed++
        console.warn(`[crm-replay] malformed line in ${filename} (truncated tail?): ${line.slice(0, 80)}…`)
      }
    }
  }
  if (malformed > 0) console.warn(`[crm-replay] skipped ${malformed} malformed line(s) total`)
  return { events, malformedLineCount: malformed }
}

interface NodeCursor { node: string; highest_lamport: number }

function readCursors(db: Database.Database): NodeCursor[] {
  return db.prepare('SELECT node, highest_lamport FROM events_seen').all() as NodeCursor[]
}

function readEventsAfterCursors(cursors: NodeCursor[]): { events: Event[]; malformedLineCount: number } {
  const cursorMap = new Map(cursors.map(c => [c.node, c.highest_lamport]))
  const { events, malformedLineCount } = readAllEvents()
  return {
    events: events.filter(e => (cursorMap.get(e.node) ?? -1) < e.lamport),
    malformedLineCount,
  }
}

// ─── Projection truncation (for cold replay + tests) ────────────────────────

export function truncateProjection(db: Database.Database): void {
  db.exec(`
    DELETE FROM merge_conflicts;
    DELETE FROM activities;
    DELETE FROM contacts;
    DELETE FROM raw_prospects;
    DELETE FROM prospects;
    DELETE FROM events_seen;
  `)
}

// ─── Type coercion helpers ──────────────────────────────────────────────────

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}
function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === 'true' || v === '1' || v.toLowerCase() === 'yes'
  return false
}
/** Null-preserving string coercion — for nullable raw_prospects columns where
 *  IS NULL matters (promoted_at / rejected_at drive the live-pool filter). */
function nul(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return String(v)
}
