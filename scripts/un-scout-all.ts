// scripts/un-scout-all.ts — Ralph 2026-06-03 ·
// Reset every pool row's `scout_json` to '{}' so the next "Run Scout" batch
// starts from a clean slate. Uses `patchRawProspect` so the change is logged
// as a `raw_prospect.update` event — survives boot replay (a direct SQL
// UPDATE would be reverted on the next crm-replay rebuild).
//
// Run: npx tsx scripts/un-scout-all.ts

import { readRawProspects, patchRawProspect, type RawProspect } from '../lib/crm-store'

async function main(): Promise<void> {
  const pool: RawProspect[] = readRawProspects()
  // Only touch rows that have actually been scouted — leave raw '{}' alone
  // so we don't churn event-log entries for no reason.
  const scouted = pool.filter((p) => p.scout_json && p.scout_json !== '{}' && p.scout_json !== '')
  console.log(`Pool: ${pool.length} live rows · ${scouted.length} scouted · resetting…`)
  let ok = 0, fail = 0
  for (const p of scouted) {
    try {
      await patchRawProspect(p.id, { scout_json: '{}' })
      ok++
    } catch (err) {
      fail++
      console.error(`  ${p.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(`Done: ${ok} cleared, ${fail} failed.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
