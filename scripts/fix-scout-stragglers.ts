// scripts/fix-scout-stragglers.ts — Ralph 2026-06-05
//
// The WP-129 migration matched captures to rows by `domainOf(meta.url) ===
// domainOf(row.website)`. Three rows slipped through the match because their
// captures resolved to a different domain than the row's website field:
//
//   R-aargau-086 / Michael Herkenrath — captured praxisbrugg.ch
//   R-aargau-106 / Silvia Köster      — captured zppb.ch
//   R282         / Cornelia Beck      — captured linkedin.com/authwall (redirect)
//
// The original PNGs under public/__scout__/<hash>/ were deleted by the migration's
// --delete-old pass, so the source bytes are lost. The DB still points at those
// dead URLs, which would 404 in the dossier.
//
// Fix: null `capture.fullPageUrl` + `capture.innerPageUrl` + drop the fs-path
// fields. The taste / queried / scanned_at blocks survive, so the dossier still
// renders the verdict + lamps; only the screenshot panel goes blank. A future
// Re-Taste will fill it back in through the new captureUrl pipeline.

import Database from 'better-sqlite3'
import { join } from 'path'
import { patchRawProspect } from '../lib/crm-store'

const DB_PATH = join(process.cwd(), 'db', 'crm.db')
const APPLY = process.argv.includes('--apply')

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true })
  const rows = db.prepare(
    `SELECT id, name, scout_json FROM raw_prospects WHERE scout_json LIKE '%/__scout__/%'`,
  ).all() as Array<{ id: string; name: string; scout_json: string }>
  db.close()

  console.log(`[fix-scout] found ${rows.length} stragglers with /__scout__/ refs`)
  for (const r of rows) console.log(`  ${r.id.padEnd(15)} ${r.name}`)

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to null the stale capture URLs.')
    return
  }

  let ok = 0
  for (const r of rows) {
    try {
      const sj = JSON.parse(r.scout_json || '{}') as Record<string, unknown>
      const cap = (sj.capture as Record<string, unknown> | undefined) ?? {}
      delete cap.fullPagePath
      delete cap.innerPagePath
      cap.fullPageUrl = null
      cap.innerPageUrl = null
      sj.capture = cap
      await patchRawProspect(r.id, { scout_json: JSON.stringify(sj) })
      ok++
      console.log(`  ✓ ${r.id} patched`)
    } catch (err) {
      console.error(`  ✗ ${r.id}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log(`\nDone. ${ok}/${rows.length} rows fixed.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
