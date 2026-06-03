#!/usr/bin/env node
// ============================================================================
// scripts/smoke-test-crm-boot.mjs
// Verify the F22 SQLite schema + first-boot bootstrap from xlsx works,
// without booting Next.js. Mirrors what lib/crm-boot.ts does on server boot.
//
// Run from project root: node scripts/smoke-test-crm-boot.mjs
// Safe to run repeatedly — deletes its own scratch DB before each run.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { read as readXlsx, utils as xlsxUtils } from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCRATCH_DB = join(ROOT, 'db', 'crm.smoke.db')
const XLSX_PATH = join(ROOT, 'docs', 'crm-feature', 'prospects.xlsx')

// Clean slate
if (existsSync(SCRATCH_DB)) unlinkSync(SCRATCH_DB)
const walPath = SCRATCH_DB + '-wal'
if (existsSync(walPath)) unlinkSync(walPath)
const shmPath = SCRATCH_DB + '-shm'
if (existsSync(shmPath)) unlinkSync(shmPath)
mkdirSync(dirname(SCRATCH_DB), { recursive: true })

console.log('=== F22 smoke test ===\n')

// ─── Step 1: Open DB + schema ───────────────────────────────────────────────

const db = new Database(SCRATCH_DB)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const schemaSql = `
  CREATE TABLE IF NOT EXISTS prospects (
    id TEXT PRIMARY KEY,
    company TEXT, contact_name TEXT, phone TEXT, email TEXT, website TEXT,
    stage TEXT NOT NULL DEFAULT 'Incoming',
    status TEXT NOT NULL DEFAULT 'To do',
    amount_chf REAL NOT NULL DEFAULT 0,
    confidence_pct INTEGER NOT NULL DEFAULT 0,
    next_action_date TEXT, next_action_label TEXT, tags TEXT,
    starred INTEGER NOT NULL DEFAULT 0, owner TEXT, notes TEXT,
    created_at TEXT, standby_plan TEXT, lost_reason TEXT,
    needs_analysis TEXT, solutions_bought TEXT, sub_stage TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_prospects_phone ON prospects(phone);
  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL, type TEXT NOT NULL, icon TEXT, color TEXT,
    duration_min INTEGER, notes TEXT, session_id TEXT, user_id TEXT,
    subject TEXT, wa_message_id TEXT, wa_status TEXT, media_path TEXT,
    media_mime TEXT, soft_deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_activities_prospect ON activities(prospect_id, timestamp DESC);
`
db.exec(schemaSql)
console.log('✓ Schema created')

// ─── Step 2: Read xlsx ──────────────────────────────────────────────────────

if (!existsSync(XLSX_PATH)) {
  console.log('  no xlsx found — skipping bootstrap test')
  process.exit(0)
}
const wb = readXlsx(readFileSync(XLSX_PATH), { type: 'buffer' })
const prospectRows = xlsxUtils.sheet_to_json(wb.Sheets['Prospects'])
const activityRows = xlsxUtils.sheet_to_json(wb.Sheets['Activities'])
console.log(`✓ XLSX loaded: ${prospectRows.length} prospects, ${activityRows.length} activities`)

// ─── Step 3: Direct-insert into SQLite (no event log; just shape check) ─────

const insertProspect = db.prepare(`
  INSERT OR REPLACE INTO prospects (
    id, company, contact_name, phone, email, website,
    stage, status, amount_chf, confidence_pct,
    next_action_date, next_action_label, tags, starred, owner,
    notes, created_at, standby_plan, lost_reason,
    needs_analysis, solutions_bought, sub_stage
  ) VALUES (
    @id, @company, @contact_name, @phone, @email, @website,
    @stage, @status, @amount_chf, @confidence_pct,
    @next_action_date, @next_action_label, @tags, @starred, @owner,
    @notes, @created_at, @standby_plan, @lost_reason,
    @needs_analysis, @solutions_bought, @sub_stage
  )
`)

const txP = db.transaction((rows) => {
  for (const r of rows) {
    insertProspect.run({
      id: String(r.id || ''),
      company: String(r.company || ''),
      contact_name: String(r.contact_name || ''),
      phone: String(r.phone || ''),
      email: String(r.email || ''),
      website: String(r.website || ''),
      stage: String(r.stage || 'Incoming'),
      status: String(r.status || 'To do'),
      amount_chf: Number(r.amount_chf || 0),
      confidence_pct: Number(r.confidence_pct || 0),
      next_action_date: String(r.next_action_date || ''),
      next_action_label: String(r.next_action_label || ''),
      tags: String(r.tags || ''),
      starred: r.starred === true || r.starred === 'TRUE' || r.starred === 1 ? 1 : 0,
      owner: String(r.owner || 'Filippo'),
      notes: String(r.notes || ''),
      created_at: r.created_at ? String(r.created_at) : null,
      standby_plan: String(r.standby_plan || ''),
      lost_reason: String(r.lost_reason || ''),
      needs_analysis: String(r.needs_analysis || ''),
      solutions_bought: String(r.solutions_bought || ''),
      sub_stage: String(r.sub_stage || ''),
    })
  }
})
txP(prospectRows)
const pCount = db.prepare('SELECT COUNT(*) AS n FROM prospects').get().n
console.log(`✓ Inserted ${pCount} prospects`)

const insertActivity = db.prepare(`
  INSERT OR REPLACE INTO activities (
    id, prospect_id, timestamp, type, icon, color,
    duration_min, notes, session_id, user_id, subject,
    wa_message_id, wa_status, media_path, media_mime, soft_deleted
  ) VALUES (
    @id, @prospect_id, @timestamp, @type, @icon, @color,
    @duration_min, @notes, @session_id, @user_id, @subject,
    @wa_message_id, @wa_status, @media_path, @media_mime, 0
  )
`)
const txA = db.transaction((rows) => {
  let skipped = 0
  for (const r of rows) {
    const pid = String(r.prospect_id || '')
    if (!pid) { skipped++; continue }
    // FK requires prospect to exist; skip activities whose prospect was filtered out
    const pExists = db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(pid)
    if (!pExists) { skipped++; continue }
    insertActivity.run({
      id: String(r.id || ''),
      prospect_id: pid,
      timestamp: String(r.timestamp || ''),
      type: String(r.type || 'Note'),
      icon: String(r.icon || ''),
      color: String(r.color || ''),
      duration_min: r.duration_min == null ? null : Number(r.duration_min),
      notes: String(r.notes || ''),
      session_id: String(r.session_id || ''),
      user_id: String(r.user_id || 'Filippo'),
      subject: String(r.subject || ''),
      wa_message_id: String(r.wa_message_id || ''),
      wa_status: String(r.wa_status || ''),
      media_path: String(r.media_path || ''),
      media_mime: String(r.media_mime || ''),
    })
  }
  return skipped
})
const skippedActivities = txA(activityRows) || 0
const aCount = db.prepare('SELECT COUNT(*) AS n FROM activities').get().n
console.log(`✓ Inserted ${aCount} activities (skipped ${skippedActivities} orphan refs)`)

// ─── Step 4: Sanity reads ───────────────────────────────────────────────────

const sample = db.prepare('SELECT id, company, contact_name, stage, created_at FROM prospects LIMIT 3').all()
console.log('\nSample prospects:')
sample.forEach(p => console.log(`  ${p.id} | ${p.company} | ${p.contact_name} | ${p.stage} | created_at=${p.created_at}`))

const filomax = db.prepare("SELECT * FROM prospects WHERE company LIKE '%Filomax%' LIMIT 1").get()
if (filomax) {
  console.log(`\n✓ Filomax found: ${filomax.id} ${filomax.contact_name} ${filomax.phone}`)
  const filomaxActs = db.prepare('SELECT COUNT(*) AS n FROM activities WHERE prospect_id = ?').get(filomax.id).n
  console.log(`  Activities for Filomax: ${filomaxActs}`)
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

db.close()
unlinkSync(SCRATCH_DB)
if (existsSync(walPath)) unlinkSync(walPath)
if (existsSync(shmPath)) unlinkSync(shmPath)
console.log('\n✓ Smoke test passed. Scratch DB cleaned up.\n')
