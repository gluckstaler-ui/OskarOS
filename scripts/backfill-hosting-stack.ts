// scripts/backfill-hosting-stack.ts — re-query hosting + stack for stale rows
// using the upgraded detectors (Cymru AS-name + generator/marker/framework
// stack). Data sources are Cymru DNS + the sites themselves (NOT archive.org),
// so no rate-limit wall. Event-sourced via patchRawProspect.
//   DRY:    tsx scripts/backfill-hosting-stack.ts [--limit=N]
//   APPLY:  tsx scripts/backfill-hosting-stack.ts --apply [--limit=N]
import { lookupHosting, formatHostingLamp } from '@/lib/consular/dns-lookup'
import { detectStack } from '@/lib/consular/research-queried'
import { getDb } from '@/lib/crm-boot'
import { patchRawProspect } from '@/lib/crm-store'

const APPLY = process.argv.includes('--apply')
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || (APPLY ? 100000 : 25))
const CONC = 8

interface Row { id: string; website: string; scout_json: string }
const domOf = (w: string) => String(w).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
const isBareAsn = (s: unknown) => typeof s === 'string' && /^AS[0-9]/.test(s)

async function fetchHtml(d: string): Promise<string | null> {
  try {
    const r = await fetch('https://' + d, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Mozilla/5.0 (OskarOS Scout backfill)' } })
    if (r.ok) return (await r.text()).slice(0, 300_000)
  } catch { /* null */ }
  return null
}

async function main() {
  const db = getDb()
  const rows = db.prepare(
    `SELECT id, website, scout_json FROM raw_prospects
       WHERE scout_json IS NOT NULL AND website IS NOT NULL AND trim(website) NOT IN ('','-','—','n/a')
         AND ( json_extract(scout_json,'$.queried.hosting') GLOB 'AS[0-9]*'
               OR COALESCE(json_extract(scout_json,'$.queried.stack'),'') IN ('','custom / unknown') )
       ORDER BY id LIMIT ?`,
  ).all(LIMIT) as Row[]
  console.log(`target rows (stale hosting and/or stack): ${rows.length}   mode: ${APPLY ? 'APPLY' : 'DRY'}\n`)

  let hostFixed = 0, stackFixed = 0, shown = 0, idx = 0
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++]
      const d = domOf(r.website)
      let sj: { queried?: Record<string, unknown> } = {}
      try { sj = JSON.parse(r.scout_json || '{}') } catch { /* skip */ }
      sj.queried = sj.queried || {}
      const needHost = isBareAsn(sj.queried.hosting)
      const curStack = sj.queried.stack as string | undefined
      const needStack = !curStack || curStack === 'custom / unknown'

      const [hosting, html] = await Promise.all([
        needHost ? lookupHosting(d).catch(() => null) : Promise.resolve(null),
        needStack ? fetchHtml(d) : Promise.resolve(null),
      ])

      let changed = false
      if (needHost && hosting) { const lamp = formatHostingLamp(hosting); if (lamp && !isBareAsn(lamp)) { sj.queried.hosting = lamp; hostFixed++; changed = true } }
      if (needStack && html) { const st = detectStack(html); if (st && st !== 'custom / unknown') { sj.queried.stack = st; stackFixed++; changed = true } }
      if (changed && shown++ < 30) console.log(`  ${r.id.padEnd(14)} ${d.padEnd(30)} host=${String(sj.queried.hosting || '-').padEnd(22)} stack=${sj.queried.stack || '-'}`)
      if (changed && APPLY) { try { await patchRawProspect(r.id, { scout_json: JSON.stringify(sj) }) } catch (e) { console.error(`  ! ${r.id}: ${e instanceof Error ? e.message : e}`) } }
      await new Promise((res) => setTimeout(res, 80))
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY'}: hosting names resolved ${hostFixed}, stack identified ${stackFixed}  (of ${rows.length})`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
