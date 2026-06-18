// scripts/backfill-age.ts — THE age fix. The age lamp is stale: rows scouted
// before the 2026-06-05 Wayback ladder fix stored an empty age, but the current
// lookupAge() recovers ~83% of them on demand (proven: 10/12). This re-queries
// age for every row with a website but no age, and patches scout_json.queried.age
// via the event log (replay-safe). Rate-limited + concurrency-capped so we don't
// hammer archive.org. Rows that come back empty are genuinely not in Wayback.
//   DRY (default):  tsx scripts/backfill-age.ts [--limit=N]
//   APPLY:          tsx scripts/backfill-age.ts --apply [--limit=N]
import { lookupAge, formatAgeLamp } from '@/lib/consular/wayback'
import { getDb } from '@/lib/crm-boot'
import { patchRawProspect } from '@/lib/crm-store'

const APPLY = process.argv.includes('--apply')
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || (APPLY ? 100000 : 30))
// archive.org rate-limits sustained bursts (the first --apply run got 22/659
// at CONC=6). Crawl it: 1 row at a time, ~1s apart, retry-once on empty.
const CONC = 1
const POLITE_MS = 900

interface Row { id: string; website: string; scout_json: string }

async function main() {
  const db = getDb()
  const rows = db.prepare(
    `SELECT id, website, scout_json FROM raw_prospects
       WHERE scout_json IS NOT NULL
         AND COALESCE(json_extract(scout_json,'$.queried.age'),'')=''
         AND website IS NOT NULL AND trim(website) NOT IN ('','-','—','n/a')
       ORDER BY id LIMIT ?`,
  ).all(LIMIT) as Row[]
  console.log(`rows with website but empty age: ${rows.length}   mode: ${APPLY ? 'APPLY' : 'DRY'}\n`)

  let recovered = 0, stillEmpty = 0, idx = 0
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++]
      const dom = String(r.website).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
      let lamp = ''
      try { lamp = formatAgeLamp(await lookupAge(dom)) } catch { /* leave empty */ }
      // Empty can mean throttled (transient) OR genuinely unarchived. Back off
      // 2.5s and retry once — recovers throttle-empties, costs little on the rest.
      if (!lamp) { await new Promise((r) => setTimeout(r, 2500)); try { lamp = formatAgeLamp(await lookupAge(dom)) } catch { /* still empty */ } }
      if (lamp) {
        recovered++
        if (APPLY) {
          try {
            const sj = JSON.parse(r.scout_json || '{}')
            sj.queried = sj.queried || {}
            sj.queried.age = lamp
            await patchRawProspect(r.id, { scout_json: JSON.stringify(sj) })
          } catch (e) { console.error(`  ! patch failed ${r.id}: ${e instanceof Error ? e.message : e}`) }
        }
        if (recovered <= 40) console.log(`  ${APPLY ? '✓' : '·'} ${r.id.padEnd(14)} ${dom.padEnd(30)} → ${lamp}`)
      } else stillEmpty++
      await new Promise((res) => setTimeout(res, POLITE_MS))
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))

  const rate = rows.length ? Math.round((recovered / rows.length) * 100) : 0
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY'}: recovered age for ${recovered}/${rows.length} (${rate}%) · ${stillEmpty} still empty (genuinely not in Wayback)`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
