// One-time migration (Ralph 2026-06-15): normalize stale `cdModel` values in
// every session's _session-config.json to the canonical Opus 4.8 wire id.
//
// WHY: flipping DEFAULT_BRAIN to 'opus' in code only governs virgin sessions or
// ones whose stored value equalled the OLD default. Existing files persisted
// stale ids — `claude-fable-5` (suspended), the bare brain-key `"opus"`,
// `claude-opus-4-7[1m]`, `claude-opus-4-8[1m]` — and the resolver returns the
// file value over the default, so the bridge spawned those bad models. This
// rewrites only `cdModel`; webDevModel (e.g. a deliberate Gemini padawan) and
// every other field are preserved. `auto` is a legitimate "let the CLI decide"
// value and is left untouched. Atomic temp-file + rename per file. Idempotent.
//
// Usage:  node scripts/normalize-cdmodel.mjs           (dry run — prints plan)
//         node scripts/normalize-cdmodel.mjs --apply    (writes the changes)

import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import crypto from 'crypto'

const CANON = 'claude-opus-4-7'
const KEEP = new Set([CANON, 'auto']) // valid current values — never rewritten
const APPLY = process.argv.includes('--apply')
const publicDir = join(process.cwd(), 'public')

const sessions = readdirSync(publicDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) => existsSync(join(publicDir, name, 'logs', '_session-config.json')))
  .sort()

let migrated = 0
let keptAuto = 0
let ok = 0
for (const name of sessions) {
  const p = join(publicDir, name, 'logs', '_session-config.json')
  let cfg
  try {
    cfg = JSON.parse(readFileSync(p, 'utf-8'))
  } catch (err) {
    console.log(`  SKIP  ${name}  (unreadable: ${err.message})`)
    continue
  }
  const cur = cfg.cdModel
  if (cur === 'auto') { keptAuto++; console.log(`  AUTO  ${name}  (left as 'auto')`); continue }
  if (cur === undefined || cur === CANON) { ok++; continue }

  console.log(`  ${APPLY ? 'MIGRATE' : 'WOULD  '}  ${name}  "${cur}" -> "${CANON}"`)
  if (APPLY) {
    cfg.cdModel = CANON
    cfg.updatedAt = new Date().toISOString()
    const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8')
    renameSync(tmp, p)
  }
  migrated++
}

console.log(
  `\n${APPLY ? 'APPLIED' : 'DRY RUN'} — scanned ${sessions.length} session config(s): ` +
  `${migrated} ${APPLY ? 'migrated' : 'to migrate'}, ${ok} already Opus 4.8, ${keptAuto} on 'auto'.`,
)
if (!APPLY && migrated > 0) console.log("Re-run with --apply to write the changes.")
