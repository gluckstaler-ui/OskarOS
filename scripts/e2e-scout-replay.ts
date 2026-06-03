// Scout v1 e2e — durability probe (Ralph 2026-06-03). Runs the app's OWN cold
// recovery (coldReplay = truncate projection + re-apply EVERY event from the
// log) on the live db via the real getDb (WAL, foreign_keys=ON), then asserts
// the promoted prospect + the promote/discard stamps reconstruct from events
// alone. Proves WP-1's "survives a restart / cold replay". Idempotent — it
// rebuilds the live projection to exactly what the event log says.
//
// Run: npx tsx scripts/e2e-scout-replay.ts <prospectId> <scoutedRawId> <discardedRawId>
import { getDb } from '../lib/crm-boot'
import { coldReplay } from '../lib/crm-replay'

const [PID, SID, DID] = process.argv.slice(2)
if (!PID || !SID || !DID) { console.error('usage: <prospectId> <scoutedRawId> <discardedRawId>'); process.exit(2) }

const db = getDb()
const res = coldReplay(db) // truncate (FK-safe, children first) + replay the entire log
console.log(`cold-replayed ${res.appliedEventCount} events from the log`)

const prospect = db.prepare('SELECT id,stage,tags,amount_chf,confidence_pct FROM prospects WHERE id=?').get(PID) as { id: string; stage: string; tags: string; amount_chf: number; confidence_pct: number } | undefined
const sraw = db.prepare('SELECT promoted_at,promoted_to FROM raw_prospects WHERE id=?').get(SID) as { promoted_at: string | null; promoted_to: string | null } | undefined
const draw = db.prepare('SELECT rejected_at FROM raw_prospects WHERE id=?').get(DID) as { rejected_at: string | null } | undefined
const sInPool = !!db.prepare('SELECT 1 FROM raw_prospects WHERE id=? AND promoted_at IS NULL AND rejected_at IS NULL').get(SID)
const dInPool = !!db.prepare('SELECT 1 FROM raw_prospects WHERE id=? AND promoted_at IS NULL AND rejected_at IS NULL').get(DID)

console.log('PROMOTED prospect (rebuilt from events):', JSON.stringify(prospect))
console.log(`promoted raw ${SID}: promoted_to=${sraw?.promoted_to} · still in live pool? ${sInPool}`)
console.log(`discarded raw ${DID}: rejected_at=${draw?.rejected_at ? 'set' : 'null'} · still in live pool? ${dInPool}`)

const ok = !!prospect && prospect.stage === 'Incoming' && !!sraw?.promoted_at && sraw.promoted_to === PID
  && !!draw?.rejected_at && !sInPool && !dInPool
console.log(ok
  ? '✓ DURABLE — promote + discard reconstruct purely from the event log (survives cold replay)'
  : '✗ FAIL — funnel state did not survive cold replay')
process.exit(ok ? 0 : 1)
