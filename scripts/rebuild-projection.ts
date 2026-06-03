// Rebuild the SQLite projection from the event log (Ralph 2026-06-03).
// Opens crm.db directly (schema intact) and runs the FK-safe coldReplay.
// Run: npx tsx scripts/rebuild-projection.ts
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { coldReplay } from '../lib/crm-replay'

const db = new Database(join(process.cwd(), 'db/crm.db'))
db.pragma('busy_timeout = 8000')
db.pragma('journal_mode = WAL')

const res = coldReplay(db)
const c = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c
const rawLive = (db.prepare("SELECT COUNT(*) AS c FROM raw_prospects WHERE promoted_at IS NULL AND rejected_at IS NULL").get() as { c: number }).c
console.log(`rebuilt from ${res.appliedEventCount} events`)
console.log(`prospects: ${c('prospects')} · activities: ${c('activities')} · contacts: ${c('contacts')} · raw_prospects total: ${c('raw_prospects')} · live pool: ${rawLive}`)
db.close()
process.exit(0)
