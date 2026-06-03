// ============================================================================
// lib/crm-boot.ts — boot wiring for the CRM SQLite + event log
// WP-CRM-F22 (Ralph 2026-05-25)
//
// Called by instrumentation.ts on Next.js server boot. Sequence:
//
//   1. Open SQLite connection at db/crm.db (creates file if absent).
//   2. Run schema DDL (idempotent via CREATE TABLE IF NOT EXISTS).
//   3. First-boot bootstrap: if both the SQLite projection is empty AND the
//      event log is empty AND public/_crm/prospects.xlsx exists, do a one-
//      shot inline backfill — read xlsx rows, emit backfill events to the
//      local log, then fall through to step 4 which replays them into
//      SQLite. This makes F22 non-destructive to Ralph's existing CRM data
//      without requiring F24 to ship first. The "real" F24 will replace
//      this one-shot with the full operator-runnable script (timestamped
//      backups, recovery procedure, etc.).
//   4. Incremental replay: apply any events past the events_seen cursor.
//      On first boot post-bootstrap this replays everything; on subsequent
//      boots it's a microseconds no-op.
//
// The SQLite connection is pinned to globalThis so it survives Next.js HMR
// without leaking file handles. Same pattern as lib/wa-runtime.ts.
// ============================================================================

import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { read as readXlsx, utils as xlsxUtils } from 'xlsx'
import { appendEvent, makeEvent } from './event-log'
import { applyEventsToDb, incrementalReplay } from './crm-replay'

const PROJECT_ROOT = process.cwd()
const DB_DIR = join(PROJECT_ROOT, 'db')
const DB_PATH = join(DB_DIR, 'crm.db')
const XLSX_LEGACY_PATH = join(PROJECT_ROOT, 'docs', 'crm-feature', 'prospects.xlsx')

declare global {
  // eslint-disable-next-line no-var
  var __crmDb: Database.Database | undefined
  // eslint-disable-next-line no-var
  var __crmBootDone: boolean | undefined
}

export function getDb(): Database.Database {
  if (globalThis.__crmDb) return globalThis.__crmDb
  mkdirSync(DB_DIR, { recursive: true })
  const fresh = new Database(DB_PATH)
  fresh.pragma('journal_mode = WAL')
  fresh.pragma('foreign_keys = ON')
  ensureSchema(fresh)
  globalThis.__crmDb = fresh
  return fresh
}

/**
 * Called once at server boot. Idempotent: if boot has already happened
 * (HMR triggered re-import), this is a no-op.
 */
export async function bootCrm(): Promise<void> {
  if (globalThis.__crmBootDone) return
  globalThis.__crmBootDone = true

  const db = getDb()
  console.log('[crm-boot] schema ready')

  // First-boot bootstrap from xlsx (one-shot, non-destructive).
  const bootstrapped = await maybeBootstrapFromXlsx(db)
  if (bootstrapped > 0) {
    console.log(`[crm-boot] bootstrapped ${bootstrapped} events from legacy xlsx`)
  }

  // Replay any events past the cursor (covers the bootstrap + any other
  // events that have been appended since the last boot).
  const result = incrementalReplay(db)
  if (result.appliedEventCount > 0) {
    console.log(
      `[crm-boot] replay applied ${result.appliedEventCount} events ` +
      `(lamport per node: ${JSON.stringify(result.highestLamportPerNode)})`,
    )
  } else {
    console.log('[crm-boot] no new events to replay')
  }

  // WP-121 People: one-shot seed. For every prospect with a contact_name
  // and zero rows in `contacts`, emit a synthetic contact.insert event
  // and replay it. Idempotent — gated on zero-row check, so subsequent
  // boots are no-ops.
  const seeded = await maybeSeedContactsFromProspects(db)
  if (seeded > 0) {
    console.log(`[crm-boot] WP-121 seeded ${seeded} contacts from legacy prospects.contact_*`)
    incrementalReplay(db)
  }
}

// ─── Schema (idempotent CREATE IF NOT EXISTS) ───────────────────────────────

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prospects (
      id              TEXT PRIMARY KEY,
      company         TEXT,
      contact_name    TEXT,
      phone           TEXT,
      email           TEXT,
      website         TEXT,
      address_strasse TEXT,
      address_plz     TEXT,
      address_ort     TEXT,
      uid_number      TEXT,
      stage           TEXT NOT NULL DEFAULT 'Incoming',
      status          TEXT NOT NULL DEFAULT 'To do',
      amount_chf      REAL NOT NULL DEFAULT 0,
      confidence_pct  INTEGER NOT NULL DEFAULT 0,
      next_action_date TEXT,
      next_action_label TEXT,
      tags            TEXT,
      starred         INTEGER NOT NULL DEFAULT 0,
      owner           TEXT,
      notes           TEXT,
      created_at      TEXT,
      standby_plan    TEXT,
      lost_reason     TEXT,
      sub_stage       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_prospects_phone           ON prospects(phone);
    CREATE INDEX IF NOT EXISTS idx_prospects_stage_status    ON prospects(stage, status);
    CREATE INDEX IF NOT EXISTS idx_prospects_owner           ON prospects(owner);
    CREATE INDEX IF NOT EXISTS idx_prospects_next_action_date ON prospects(next_action_date) WHERE next_action_date IS NOT NULL;

    CREATE TABLE IF NOT EXISTS activities (
      id              TEXT PRIMARY KEY,
      prospect_id     TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      timestamp       TEXT NOT NULL,
      type            TEXT NOT NULL,
      icon            TEXT,
      color           TEXT,
      duration_min    INTEGER,
      notes           TEXT,
      session_id      TEXT,
      user_id         TEXT,
      subject         TEXT,
      wa_message_id   TEXT,
      wa_status       TEXT,
      media_path      TEXT,
      media_mime      TEXT,
      soft_deleted    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_activities_prospect_id_timestamp ON activities(prospect_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_wa_message_id ON activities(wa_message_id) WHERE wa_message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);

    CREATE TABLE IF NOT EXISTS raw_prospects (
      id              TEXT PRIMARY KEY,
      source          TEXT NOT NULL,
      scraped_at      TEXT NOT NULL,
      raw_payload     TEXT NOT NULL,
      name            TEXT,
      company         TEXT,
      phone           TEXT,
      email           TEXT,
      website         TEXT,
      country         TEXT,
      industry        TEXT,
      promoted_at     TEXT,
      promoted_to     TEXT REFERENCES prospects(id),
      rejected_at     TEXT,
      rejected_reason TEXT,
      scout_json      TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_raw_prospects_source_scraped_at ON raw_prospects(source, scraped_at DESC);
    CREATE INDEX IF NOT EXISTS idx_raw_prospects_phone ON raw_prospects(phone);
    CREATE INDEX IF NOT EXISTS idx_raw_prospects_unpromoted ON raw_prospects(promoted_at, rejected_at);

    CREATE TABLE IF NOT EXISTS merge_conflicts (
      id              TEXT PRIMARY KEY,
      detected_ts     TEXT NOT NULL,
      entity          TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      field           TEXT NOT NULL,
      winner_value    TEXT NOT NULL,
      winner_ts       TEXT NOT NULL,
      winner_node     TEXT NOT NULL,
      winner_actor    TEXT NOT NULL,
      loser_value     TEXT NOT NULL,
      loser_ts        TEXT NOT NULL,
      loser_node      TEXT NOT NULL,
      loser_actor     TEXT NOT NULL,
      loser_event_id  TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'unreviewed',
      reviewed_ts     TEXT,
      reviewed_by     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_merge_conflicts_status_detected ON merge_conflicts(status, detected_ts DESC);

    CREATE TABLE IF NOT EXISTS events_seen (
      node            TEXT PRIMARY KEY,
      highest_lamport INTEGER NOT NULL,
      highest_event_id TEXT NOT NULL,
      applied_at      TEXT NOT NULL
    );

    -- WP-121 People: contacts are 1:many per prospect. Supersedes the
    -- single contact_name/phone/email columns on prospects (those remain
    -- readable for back-compat; contacts is the source of truth).
    CREATE TABLE IF NOT EXISTS contacts (
      id           TEXT PRIMARY KEY,
      prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      role         TEXT,
      phone        TEXT,
      email        TEXT,
      linkedin     TEXT,
      notes        TEXT,
      title        TEXT,
      is_decisive  INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_prospect ON contacts(prospect_id);
  `)

  // Migration: company billing fields (Ralph 2026-05-28). They were dropped
  // when the "Personal Information" block was retired; `crm.db` files created
  // before this predate the columns. CREATE TABLE IF NOT EXISTS won't add them
  // to an existing table, so ALTER each missing one in. Idempotent.
  const prospectCols = new Set(
    (db.prepare("PRAGMA table_info(prospects)").all() as Array<{ name: string }>).map(c => c.name),
  )
  for (const col of ['address_strasse', 'address_plz', 'address_ort', 'uid_number']) {
    if (!prospectCols.has(col)) {
      db.exec(`ALTER TABLE prospects ADD COLUMN ${col} TEXT DEFAULT ''`)
    }
  }

  // Migration: scout_json on raw_prospects (Scout v1, Ralph 2026-06-03). The
  // pool's prescreen result (taste + ◐ queried lamps) lives here as a blob.
  const rawCols = new Set(
    (db.prepare("PRAGMA table_info(raw_prospects)").all() as Array<{ name: string }>).map(c => c.name),
  )
  if (!rawCols.has('scout_json')) {
    db.exec(`ALTER TABLE raw_prospects ADD COLUMN scout_json TEXT DEFAULT '{}'`)
  }

  // Migration: drop the consolidated duplicate fields (Ralph 2026-05-28).
  // needs_analysis -> intel.pain and solutions_bought -> intel.pitch were
  // migrated into intel_json (scripts/migrate-needs-solutions-to-intel.ts);
  // the columns are now removed. Idempotent (drop only if present).
  const cols2 = new Set(
    (db.prepare("PRAGMA table_info(prospects)").all() as Array<{ name: string }>).map(c => c.name),
  )
  for (const col of ['needs_analysis', 'solutions_bought']) {
    if (cols2.has(col)) db.exec(`ALTER TABLE prospects DROP COLUMN ${col}`)
  }

  // WP-122 OPPORTUNITY DASHBOARD storage (Ralph 2026-05-28). The 7-component
  // intel block (verdict / 6 lamps / strip / 2 prose cards / keywords / lead
  // facts / pain+pitch) translates to ~42 sub-fields. Rather than 42 columns
  // we store the whole thing as a single JSON blob in `intel_json`. Trade-off:
  //   + atomic updates, single field to wire through replay + store
  //   + future fields are UI-only changes, no schema churn
  //   - can't SQL-filter on individual sub-fields (irrelevant — display data,
  //     no aggregation needed)
  // Default '{}' so reads against pre-WP-122 rows produce a valid empty intel.
  if (!prospectCols.has('intel_json')) {
    db.exec(`ALTER TABLE prospects ADD COLUMN intel_json TEXT DEFAULT '{}'`)
  }
}

// ─── First-boot bootstrap from legacy xlsx ──────────────────────────────────

async function maybeBootstrapFromXlsx(db: Database.Database): Promise<number> {
  // Skip if SQLite already has any data OR if any event has ever been logged.
  const prospectCount = (db.prepare('SELECT COUNT(*) AS n FROM prospects').get() as { n: number }).n
  const activityCount = (db.prepare('SELECT COUNT(*) AS n FROM activities').get() as { n: number }).n
  const eventsSeenCount = (db.prepare('SELECT COUNT(*) AS n FROM events_seen').get() as { n: number }).n
  if (prospectCount > 0 || activityCount > 0 || eventsSeenCount > 0) {
    return 0
  }

  if (!existsSync(XLSX_LEGACY_PATH)) {
    console.log(`[crm-boot] no legacy xlsx at ${XLSX_LEGACY_PATH} — nothing to bootstrap`)
    return 0
  }

  console.log(`[crm-boot] FIRST BOOT — bootstrapping from legacy xlsx: ${XLSX_LEGACY_PATH}`)

  const wb = readXlsx(readFileSync(XLSX_LEGACY_PATH), { type: 'buffer' })
  const prospects = (wb.Sheets['Prospects']
    ? xlsxUtils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Prospects'])
    : [])
  const activities = (wb.Sheets['Activities']
    ? xlsxUtils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Activities'])
    : [])

  // Tier-2 fallback table: earliest activity timestamp per prospect.
  const earliestActivityTs = new Map<string, string>()
  for (const a of activities) {
    const pid = String(a.prospect_id || '')
    const ts = String(a.timestamp || '')
    if (!pid || !ts) continue
    const existing = earliestActivityTs.get(pid)
    if (!existing || ts < existing) earliestActivityTs.set(pid, ts)
  }

  let appended = 0

  // Emit one insert event per prospect with tiered historical_created_at.
  for (const p of prospects) {
    const id = String(p.id || '')
    if (!id) continue
    let historicalCreatedAt: string | null = null
    if (p.created_at) historicalCreatedAt = String(p.created_at)
    else if (earliestActivityTs.has(id)) historicalCreatedAt = earliestActivityTs.get(id)!
    // Tier 3 (else): leave NULL — honest about "we don't know."

    const event = makeEvent({
      actor: 'system',
      entity: 'prospect',
      entity_id: id,
      op: 'insert',
      payload: { ...p, historical_created_at: historicalCreatedAt },
      source: 'backfill',
    })
    await appendEvent(event)
    appended++
  }

  // Emit one insert event per activity. Use the row's existing timestamp.
  for (const a of activities) {
    const id = String(a.id || '')
    if (!id) continue
    const event = makeEvent({
      actor: 'system',
      entity: 'activity',
      entity_id: id,
      op: 'insert',
      payload: a,
      source: 'backfill',
    })
    await appendEvent(event)
    appended++
  }

  return appended
}

// ─── WP-121 People: seed contacts from legacy prospects.contact_* ───────────
//
// Emits one contact.insert event per prospect that has a non-empty
// contact_name AND zero rows in contacts. Idempotent. Runs after the
// initial replay so we can see the projection.
async function maybeSeedContactsFromProspects(db: Database.Database): Promise<number> {
  const rows = db.prepare(`
    SELECT p.id, p.contact_name, p.phone, p.email, p.created_at
    FROM prospects p
    LEFT JOIN contacts c ON c.prospect_id = p.id
    WHERE p.contact_name IS NOT NULL AND p.contact_name != ''
    GROUP BY p.id
    HAVING COUNT(c.id) = 0
  `).all() as Array<{
    id: string
    contact_name: string
    phone: string | null
    email: string | null
    created_at: string | null
  }>

  if (rows.length === 0) return 0

  let seeded = 0
  for (const r of rows) {
    const event = makeEvent({
      actor: 'system',
      entity: 'contact',
      entity_id: `${r.id}:primary`,
      op: 'insert',
      payload: {
        prospect_id: r.id,
        name: r.contact_name,
        role: 'decision_maker',
        phone: r.phone ?? '',
        email: r.email ?? '',
        linkedin: '',
        notes: '',
        title: '',
        is_decisive: true,
        created_at: r.created_at ?? new Date().toISOString(),
      },
      source: 'wp-121-seed',
    })
    await appendEvent(event)
    seeded++
  }
  return seeded
}

// Optional: cold replay entry point for manual recovery.
export function recoverByColdReplay(): void {
  const db = getDb()
  const { coldReplay } = require('./crm-replay') as typeof import('./crm-replay')
  const result = coldReplay(db)
  console.log(`[crm-boot] cold replay applied ${result.appliedEventCount} events`)
}
