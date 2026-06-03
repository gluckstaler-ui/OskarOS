// ============================================================================
// lib/event-log.ts — append-only event log, single source of truth
// WP-CRM-F22 (Ralph 2026-05-25)
//
// Every state mutation in the CRM goes through `appendEvent` BEFORE touching
// SQLite. If the SQLite write fails after a successful event append, the
// next boot's replay re-derives the row. Log is upstream of cache. See
// docs/Feature-X.md §15 [SYNC-L] for the invariant.
//
// Durability properties:
//   1. Atomicity — single appendFileSync writeSync call. On Linux, O_APPEND
//      writes ≤ ~4 KB to regular files are atomic in practice (artifact of
//      kernel page-cache implementation, NOT POSIX-mandated). Events stay
//      <4 KB by convention; appendEvent asserts on serialize.
//   2. Durability — fsync after every write. Cost ~5–10 ms on SSD.
//      Without this, kernel writeback delay (~30 s) would let "successful"
//      events vanish on power loss.
//   3. Multi-process safety — proper-lockfile around the entire open-write-
//      fsync-close sequence. Prevents log corruption when `npm run sync` or
//      `npm run backfill` runs concurrently with `next dev`.
//   4. Truncated-line tolerance — replay reads JSONL line-by-line; on a
//      malformed terminal line (typically a partial write from a process
//      kill mid-append), logs a warning and skips. Earlier lines are intact.
// ============================================================================

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, writeSync } from 'fs'
import { join } from 'path'
import * as lockfile from 'proper-lockfile'
import { ulid } from 'ulid'

const PROJECT_ROOT = process.cwd()
const EVENTS_DIR = join(PROJECT_ROOT, 'db', 'events')
const NODE_ID = process.env.OSKAR_NODE_ID || 'unknown'
const LOG_PATH = join(EVENTS_DIR, `events-${NODE_ID}.jsonl`)

mkdirSync(EVENTS_DIR, { recursive: true })

// ─── Event envelope (locked in WP-CRM-F21) ──────────────────────────────────

export type EventEntity = 'prospect' | 'activity' | 'contact' | 'raw_prospect' | 'merge_conflict'
export type EventOp = 'insert' | 'update' | 'delete' | 'soft_delete'
export type EventSource = 'live' | 'backfill' | 'sync' | 'manual_import' | 'wp-121-seed'

export interface Event {
  schema_version: 1
  id: string                         // 'evt_<ulid>'
  ts: string                         // ISO 8601, event-creation time (always known)
  lamport: number
  node: string                       // 'ralph-mac' | 'filippo-mac' | 'server'
  actor: string                      // 'ralph' | 'filippo' | 'scraper' | 'system' | 'import'
  entity: EventEntity
  entity_id: string
  op: EventOp
  field?: string                     // present iff op === 'update'
  prev?: unknown
  next?: unknown
  payload?: Record<string, unknown>  // for op === 'insert' carries the full row
  source: EventSource
}

const MAX_EVENT_BYTES = 4096   // events stay <4 KB to preserve append atomicity

function assertEnvelopeShape(event: Event): void {
  if (event.schema_version !== 1) {
    throw new Error(`event-log: invalid schema_version ${event.schema_version}`)
  }
  if (typeof event.id !== 'string' || !event.id.startsWith('evt_')) {
    throw new Error(`event-log: invalid id "${event.id}"`)
  }
  if (typeof event.ts !== 'string' || !event.ts) {
    throw new Error('event-log: event.ts required')
  }
  if (typeof event.lamport !== 'number' || !Number.isFinite(event.lamport)) {
    throw new Error('event-log: event.lamport required')
  }
  if (!event.node || !event.entity || !event.entity_id || !event.op) {
    throw new Error('event-log: node/entity/entity_id/op required')
  }
  if (event.op === 'update' && !event.field) {
    throw new Error(`event-log: op=update requires field (event ${event.id})`)
  }
}

// ─── Append (the only write path) ───────────────────────────────────────────

/**
 * Append a single event to the local log. Log-first, then caller updates
 * SQLite. If SQLite write fails after this returns, the next boot's
 * replay re-derives the row from the log.
 *
 * Async because of proper-lockfile.
 */
export async function appendEvent(event: Event): Promise<void> {
  assertEnvelopeShape(event)
  const line = JSON.stringify(event) + '\n'
  const byteLen = Buffer.byteLength(line, 'utf-8')
  if (byteLen > MAX_EVENT_BYTES) {
    throw new Error(
      `event-log: event ${event.id} is ${byteLen} bytes (>${MAX_EVENT_BYTES}). ` +
      `Split the payload or store large fields as separate files.`,
    )
  }
  // Ensure the file exists before locking (lockfile.lock on a non-existent
  // path can fail under some implementations).
  if (!existsSync(LOG_PATH)) {
    const fd = openSync(LOG_PATH, 'a')
    closeSync(fd)
  }
  const release = await lockfile.lock(LOG_PATH, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 250 },
    stale: 5_000,
  })
  try {
    const fd = openSync(LOG_PATH, 'a')
    try {
      writeSync(fd, line)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } finally {
    await release()
  }
}

// ─── Convenience: build a fresh event with sensible defaults ────────────────

export function makeEvent(
  partial: Omit<Event, 'schema_version' | 'id' | 'ts' | 'lamport' | 'node' | 'source'> &
    Partial<Pick<Event, 'source'>>,
): Event {
  return {
    schema_version: 1,
    id: `evt_${ulid()}`,
    ts: new Date().toISOString(),
    lamport: nextLamport(),
    node: NODE_ID,
    source: partial.source ?? 'live',
    actor: partial.actor,
    entity: partial.entity,
    entity_id: partial.entity_id,
    op: partial.op,
    field: partial.field,
    prev: partial.prev,
    next: partial.next,
    payload: partial.payload,
  }
}

// ─── Lamport counter ────────────────────────────────────────────────────────
//
// In-memory only. No separate persistence file — the log itself is the
// source of truth. At boot, lib/crm-replay.ts walks all log files, finds
// max(lamport), and calls setLamportFromReplay(maxSeen). Subsequent
// nextLamport() calls return monotonically-increasing values from there.

let _lamport = 0

export function nextLamport(): number {
  return ++_lamport
}

/** Bump on receipt of a sync-pulled event (Group A, Feature-X WP-106). */
export function bumpLamport(received: number): void {
  _lamport = Math.max(_lamport, received) + 1
}

/** Called by replay at boot to seed the counter from the log. */
export function setLamportFromReplay(maxSeen: number): void {
  _lamport = maxSeen
}

export function currentLamport(): number {
  return _lamport
}

// ─── Path accessors (for replay + diagnostics) ──────────────────────────────

export function getLogPath(): string {
  return LOG_PATH
}

export function getEventsDir(): string {
  return EVENTS_DIR
}

export function getNodeId(): string {
  return NODE_ID
}
