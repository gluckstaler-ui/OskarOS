#!/usr/bin/env node
// ============================================================================
// scripts/backfill-from-xlsx.mjs — convert legacy prospects.xlsx → events.jsonl
// WP-CRM-F24 (Ralph 2026-05-25)
//
// Companion to lib/crm-boot.ts's first-boot auto-bootstrap. The auto-
// bootstrap is the safety net that fires on first server boot when SQLite is
// empty and xlsx exists. This script is the explicit operator-runnable
// re-run path with timestamped backup + safe-guard against accidental
// double-runs.
//
// Run from the project root:
//   npm run backfill                 — refuses if events log is non-empty
//   npm run backfill -- --force      — overrides the safe-guard
//
// Recovery procedure (documented in docs/WP-CRM-001.md §6a, repeated here
// for ops convenience):
//
//   1. Stop Next.js dev server.
//   2. Inspect db/events/events-<thismachine>.jsonl. If it contains ONLY
//      backfill events, delete the file. Otherwise keep only the
//      non-backfill lines:
//        grep -v '"source":"backfill"' db/events/events-XXX.jsonl > /tmp/keep.jsonl
//        mv /tmp/keep.jsonl db/events/events-XXX.jsonl
//   3. Delete db/crm.db + db/crm.db-wal.
//   4. cp public/_crm/prospects.xlsx.pre-backfill.<stamp> public/_crm/prospects.xlsx
//   5. Fix the bug in this script.
//   6. npm run backfill -- --force
//   7. Restart Next.js. Boot replay rebuilds SQLite from the events.
// ============================================================================

import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ulid } from 'ulid'
import { read as readXlsx, utils as xlsxUtils } from 'xlsx'
import * as lockfile from 'proper-lockfile'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const XLSX_PATH    = join(ROOT, 'docs', 'crm-feature', 'prospects.xlsx')
const EVENTS_DIR   = join(ROOT, 'db', 'events')
const NODE_ID      = process.env.OSKAR_NODE_ID || 'unknown'
const LOG_PATH     = join(EVENTS_DIR, `events-${NODE_ID}.jsonl`)

const args = process.argv.slice(2)
const FORCE = args.includes('--force')

mkdirSync(EVENTS_DIR, { recursive: true })

// ─── Safe-guard: refuse to run if events log already has data ───────────────

function eventCountInLog() {
  if (!existsSync(LOG_PATH)) return 0
  const raw = readFileSync(LOG_PATH, 'utf-8')
  let count = 0
  for (const line of raw.split('\n')) if (line) count++
  return count
}

const existingCount = eventCountInLog()
if (existingCount > 0 && !FORCE) {
  console.error(`[backfill] REFUSING TO RUN — log ${LOG_PATH} already has ${existingCount} events.`)
  console.error('[backfill] If you intend to append backfill events on top of an existing log,')
  console.error('[backfill] re-run with --force. The recovery procedure (delete + re-run) is')
  console.error('[backfill] documented at the top of this script.')
  process.exit(2)
}

// ─── Step 0: timestamped backup of source xlsx ──────────────────────────────

if (!existsSync(XLSX_PATH)) {
  console.error(`[backfill] source xlsx not found at ${XLSX_PATH}`)
  process.exit(1)
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `${XLSX_PATH}.pre-backfill.${stamp}`
copyFileSync(XLSX_PATH, backupPath)
console.log(`[backfill] backed up source xlsx → ${backupPath}`)

// ─── Read the xlsx ──────────────────────────────────────────────────────────

const wb = readXlsx(readFileSync(XLSX_PATH), { type: 'buffer' })
const prospects = wb.Sheets['Prospects']
  ? xlsxUtils.sheet_to_json(wb.Sheets['Prospects'])
  : []
const activities = wb.Sheets['Activities']
  ? xlsxUtils.sheet_to_json(wb.Sheets['Activities'])
  : []
console.log(`[backfill] loaded ${prospects.length} prospects + ${activities.length} activities from xlsx`)

// ─── Tier-2 fallback: earliest activity timestamp per prospect ──────────────

const earliestActivityTs = new Map()
for (const a of activities) {
  const pid = String(a.prospect_id || '')
  const ts = String(a.timestamp || '')
  if (!pid || !ts) continue
  const existing = earliestActivityTs.get(pid)
  if (!existing || ts < existing) earliestActivityTs.set(pid, ts)
}

// ─── Lamport seed: continue past any existing events ────────────────────────

let lamport = existingCount  // FORCE mode keeps incrementing past whatever was there
function nextLamport() { return ++lamport }

// ─── appendEvent (mirrors lib/event-log.ts; duplicated for mjs isolation) ───

async function appendEvent(event) {
  // Touch file so lockfile can lock it.
  if (!existsSync(LOG_PATH)) {
    const fd = openSync(LOG_PATH, 'a')
    closeSync(fd)
  }
  const line = JSON.stringify(event) + '\n'
  if (Buffer.byteLength(line) > 4096) {
    throw new Error(`event ${event.id} too large (${Buffer.byteLength(line)} bytes)`)
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

function makeEvent(partial) {
  return {
    schema_version: 1,
    id: `evt_${ulid()}`,
    ts: new Date().toISOString(),
    lamport: nextLamport(),
    node: NODE_ID,
    actor: 'system',
    source: 'backfill',
    ...partial,
  }
}

// ─── Emit one insert event per prospect with tiered historical_created_at ──

let appended = 0
for (const p of prospects) {
  const id = String(p.id || '')
  if (!id) continue
  let historicalCreatedAt = null
  // Tier 1: xlsx has explicit created_at
  if (p.created_at) historicalCreatedAt = String(p.created_at)
  // Tier 2: earliest activity timestamp for this prospect
  else if (earliestActivityTs.has(id)) historicalCreatedAt = earliestActivityTs.get(id)
  // Tier 3: leave as null — honest about "we don't know"

  await appendEvent(makeEvent({
    entity: 'prospect',
    entity_id: id,
    op: 'insert',
    payload: { ...p, historical_created_at: historicalCreatedAt },
  }))
  appended++
}

// ─── Emit one insert event per activity (timestamp preserved verbatim) ─────

for (const a of activities) {
  const id = String(a.id || '')
  if (!id) continue
  await appendEvent(makeEvent({
    entity: 'activity',
    entity_id: id,
    op: 'insert',
    payload: a,  // includes the row's existing timestamp column
  }))
  appended++
}

// ─── Done ──────────────────────────────────────────────────────────────────

console.log(`[backfill] appended ${appended} backfill events to ${LOG_PATH}`)
console.log('[backfill] restart Next.js to trigger boot replay → SQLite repopulates from log')
