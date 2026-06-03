// ============================================================================
// lib/test-helpers.ts — shared helpers for the CRM test suite
// WP-CRM-F23 (Ralph 2026-05-25)
//
// Used by lib/__tests__/crm-replay.test.ts (and any future test that needs
// to construct events, snapshot SQLite state, or open a throwaway DB).
// Kept in /lib so the test code can be co-located but the helpers aren't
// hidden in a test-only directory.
// ============================================================================

import Database from 'better-sqlite3'
import { ulid } from 'ulid'
import type { Event } from './event-log'

// ─── Fresh in-memory DB with the production schema ──────────────────────────

export function makeMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  // Same DDL as lib/crm-boot.ts ensureSchema (kept in sync by hand;
  // if it drifts, test 4 — live-vs-replay — catches the mismatch).
  db.exec(`
    CREATE TABLE prospects (
      id              TEXT PRIMARY KEY,
      company         TEXT,
      contact_name    TEXT,
      phone           TEXT,
      email           TEXT,
      website         TEXT,
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
      needs_analysis  TEXT,
      solutions_bought TEXT,
      sub_stage       TEXT
    );
    CREATE TABLE activities (
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
    CREATE TABLE raw_prospects (
      id              TEXT PRIMARY KEY,
      source          TEXT NOT NULL,
      scraped_at      TEXT NOT NULL,
      raw_payload     TEXT NOT NULL,
      name            TEXT, company TEXT, phone TEXT, email TEXT,
      website TEXT, country TEXT, industry TEXT,
      promoted_at TEXT, promoted_to TEXT, rejected_at TEXT, rejected_reason TEXT
    );
    CREATE TABLE merge_conflicts (
      id TEXT PRIMARY KEY, detected_ts TEXT NOT NULL, entity TEXT NOT NULL,
      entity_id TEXT NOT NULL, field TEXT NOT NULL,
      winner_value TEXT NOT NULL, winner_ts TEXT NOT NULL,
      winner_node TEXT NOT NULL, winner_actor TEXT NOT NULL,
      loser_value TEXT NOT NULL, loser_ts TEXT NOT NULL,
      loser_node TEXT NOT NULL, loser_actor TEXT NOT NULL,
      loser_event_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unreviewed',
      reviewed_ts TEXT, reviewed_by TEXT
    );
    CREATE TABLE events_seen (
      node TEXT PRIMARY KEY,
      highest_lamport INTEGER NOT NULL,
      highest_event_id TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
  return db
}

// ─── DB snapshot for cross-state comparison ─────────────────────────────────

export interface DbSnapshot {
  prospects: Record<string, unknown>[]
  activities: Record<string, unknown>[]
  raw_prospects: Record<string, unknown>[]
  merge_conflicts: Record<string, unknown>[]
  events_seen: Record<string, unknown>[]
}

/**
 * Returns a JSON-serializable representation of every row in every table,
 * ordered by primary key. Two snapshots compare equal iff the DBs are
 * structurally identical. Used by all four idempotency tests.
 *
 * Excludes `applied_at` from events_seen because that's a wall-clock
 * timestamp set during replay — it's expected to differ across runs.
 */
export function snapshotDb(db: Database.Database): DbSnapshot {
  return {
    prospects: db.prepare('SELECT * FROM prospects ORDER BY id').all() as Record<string, unknown>[],
    activities: db.prepare('SELECT * FROM activities ORDER BY id').all() as Record<string, unknown>[],
    raw_prospects: db.prepare('SELECT * FROM raw_prospects ORDER BY id').all() as Record<string, unknown>[],
    merge_conflicts: db.prepare('SELECT * FROM merge_conflicts ORDER BY id').all() as Record<string, unknown>[],
    events_seen: db.prepare(`
      SELECT node, highest_lamport, highest_event_id FROM events_seen ORDER BY node
    `).all() as Record<string, unknown>[],
  }
}

// ─── Event-fixture builders ─────────────────────────────────────────────────

interface MakeEventOpts {
  lamport: number
  node?: string
  actor?: string
  source?: Event['source']
  ts?: string
}

/**
 * Construct an event with deterministic id (so tests are reproducible).
 * Real `makeEvent` from lib/event-log uses ULID + Date.now() which is
 * fine for production but defeats test snapshotting.
 */
function ev(
  partial: Omit<Event, 'schema_version' | 'id' | 'ts' | 'lamport' | 'node' | 'actor' | 'source'>,
  opts: MakeEventOpts,
): Event {
  return {
    schema_version: 1,
    id: `evt_TEST_${String(opts.lamport).padStart(6, '0')}_${opts.node ?? 'ralph-mac'}`,
    ts: opts.ts ?? `2026-05-25T10:00:${String(opts.lamport).padStart(2, '0')}.000Z`,
    lamport: opts.lamport,
    node: opts.node ?? 'ralph-mac',
    actor: opts.actor ?? 'ralph',
    source: opts.source ?? 'live',
    ...partial,
  }
}

/**
 * 10 events that exercise the common reducer paths:
 *  - 3 prospect inserts with full payload
 *  - 5 activity inserts attached to the prospects
 *  - 2 prospect field updates (one to a string field, one to a numeric)
 */
export function fixtureEvents10(): Event[] {
  return [
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_1',
      op: 'insert',
      payload: {
        id: 'P_TEST_1',
        company: 'Acme Tessin',
        contact_name: 'Anna Bianchi',
        phone: '+41 78 111 11 11',
        stage: 'Incoming',
        status: 'To do',
        amount_chf: 5000,
        confidence_pct: 30,
        historical_created_at: '2026-05-01T08:00:00.000Z',
      },
    }, { lamport: 1 }),
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_2',
      op: 'insert',
      payload: {
        id: 'P_TEST_2',
        company: 'Beta Dental',
        contact_name: 'Bruno Conti',
        phone: '+41 79 222 22 22',
        stage: 'Contacted',
        status: 'To do',
        amount_chf: 12000,
        confidence_pct: 50,
        historical_created_at: '2026-05-05T08:00:00.000Z',
      },
    }, { lamport: 2 }),
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_3',
      op: 'insert',
      payload: {
        id: 'P_TEST_3',
        company: 'Caffè Olimpia',
        contact_name: 'Carla Rossi',
        phone: '+41 76 333 33 33',
        stage: 'Demo done',
        status: 'Standby',
        amount_chf: 8500,
        confidence_pct: 70,
        historical_created_at: '2026-05-10T08:00:00.000Z',
      },
    }, { lamport: 3 }),
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_1',
      op: 'insert',
      payload: {
        id: 'A_TEST_1',
        prospect_id: 'P_TEST_1',
        timestamp: '2026-05-12T09:00:00.000Z',
        type: 'Call',
        duration_min: 5,
        notes: 'Quick intro call',
        user_id: 'ralph',
      },
    }, { lamport: 4 }),
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_2',
      op: 'insert',
      payload: {
        id: 'A_TEST_2',
        prospect_id: 'P_TEST_1',
        timestamp: '2026-05-13T10:00:00.000Z',
        type: 'E-mail Out',
        subject: 'Follow up',
        notes: 'Sent the brochure',
        user_id: 'ralph',
      },
    }, { lamport: 5 }),
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_3',
      op: 'insert',
      payload: {
        id: 'A_TEST_3',
        prospect_id: 'P_TEST_2',
        timestamp: '2026-05-15T11:00:00.000Z',
        type: 'WhatsApp In',
        wa_message_id: 'wa_msg_test_1',
        notes: 'Asked about pricing',
        user_id: 'ralph',
      },
    }, { lamport: 6 }),
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_4',
      op: 'insert',
      payload: {
        id: 'A_TEST_4',
        prospect_id: 'P_TEST_3',
        timestamp: '2026-05-17T12:00:00.000Z',
        type: 'Meeting',
        duration_min: 60,
        notes: 'Demo done; positive',
        user_id: 'ralph',
      },
    }, { lamport: 7 }),
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_5',
      op: 'insert',
      payload: {
        id: 'A_TEST_5',
        prospect_id: 'P_TEST_3',
        timestamp: '2026-05-18T13:00:00.000Z',
        type: 'Note',
        notes: 'Send proposal next week',
        user_id: 'ralph',
      },
    }, { lamport: 8 }),
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_1',
      op: 'update',
      field: 'stage',
      prev: 'Incoming',
      next: 'Contacted',
    }, { lamport: 9 }),
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_2',
      op: 'update',
      field: 'amount_chf',
      prev: 12000,
      next: 14500,
    }, { lamport: 10 }),
  ]
}

/**
 * 10 more events that supersede / extend the first batch. Used by test 2
 * (incremental vs cold) and test 4 (live vs replay) to exercise updates
 * applied to non-empty DB state.
 */
export function fixtureEvents10More(): Event[] {
  return [
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_4',
      op: 'insert',
      payload: {
        id: 'P_TEST_4',
        company: 'Delta Studio',
        contact_name: 'Diego Ferrari',
        phone: '+41 78 444 44 44',
        stage: 'Closing',
        status: 'To do',
        amount_chf: 25000,
        confidence_pct: 85,
        historical_created_at: '2026-05-19T08:00:00.000Z',
      },
    }, { lamport: 11 }),
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_6',
      op: 'insert',
      payload: {
        id: 'A_TEST_6',
        prospect_id: 'P_TEST_4',
        timestamp: '2026-05-19T14:00:00.000Z',
        type: 'Call',
        duration_min: 25,
        user_id: 'ralph',
      },
    }, { lamport: 12 }),
    // Supersede P_TEST_1.stage: 'Contacted' → 'Demo done' (after test 1 already moved it to 'Contacted')
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_1',
      op: 'update',
      field: 'stage',
      prev: 'Contacted',
      next: 'Demo done',
    }, { lamport: 13 }),
    // Update P_TEST_2.confidence_pct
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_2',
      op: 'update',
      field: 'confidence_pct',
      prev: 50,
      next: 75,
    }, { lamport: 14 }),
    // Soft-delete an existing activity
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_2',
      op: 'soft_delete',
    }, { lamport: 15 }),
    // Another machine's event interleaved (different node).
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_7',
      op: 'insert',
      payload: {
        id: 'A_TEST_7',
        prospect_id: 'P_TEST_1',
        timestamp: '2026-05-20T15:00:00.000Z',
        type: 'Note',
        notes: 'Logged from another machine',
        user_id: 'filippo',
      },
    }, { lamport: 14, node: 'filippo-mac', actor: 'filippo' }),
    // Update a numeric field
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_3',
      op: 'update',
      field: 'amount_chf',
      prev: 8500,
      next: 9200,
    }, { lamport: 16 }),
    // Update a string field on the new prospect
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_4',
      op: 'update',
      field: 'sub_stage',
      prev: '',
      next: 'contract sent',
    }, { lamport: 17 }),
    // Update notes on an activity
    ev({
      entity: 'activity',
      entity_id: 'A_TEST_4',
      op: 'update',
      field: 'notes',
      prev: 'Demo done; positive',
      next: 'Demo done; very positive — follow up Friday',
    }, { lamport: 18 }),
    // Delete a prospect (will cascade-delete its activities via FK)
    ev({
      entity: 'prospect',
      entity_id: 'P_TEST_3',
      op: 'delete',
    }, { lamport: 19 }),
  ]
}

/**
 * Deterministic shuffle using a seeded PRNG. Same input always produces the
 * same shuffled output, so test 3 (order independence) is reproducible.
 */
export function shuffleDeterministically<T>(arr: T[], seed = 42): T[] {
  const out = [...arr]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}
