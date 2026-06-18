// scripts/test-age.ts — pin down the AGE bug. Run the REAL lookupAge() on the
// age-unknown domains three ways: serial (one at a time), concurrent (all at
// once = what a batch scout does), and a CDX earliest-capture probe as a
// candidate replacement source. The serial-vs-concurrent gap IS the bug.
import { lookupAge, formatAgeLamp } from '@/lib/consular/wayback'
import { readFileSync } from 'fs'

async function cdxEarliest(domain: string): Promise<number | null> {
  const u = `http://web.archive.org/cdx/search/cdx?url=${domain}&output=json&fl=timestamp&limit=1&from=19960101`
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return null
    const j = (await r.json()) as string[][]
    const ts = j?.[1]?.[0]
    return ts ? Number(String(ts).slice(0, 4)) : null
  } catch { return null }
}

async function main() {
  const domains = readFileSync('/tmp/age-unknown.txt', 'utf-8').split('\n')
    .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')).filter(Boolean)

  console.log('=== SERIAL (one at a time, 400ms apart) — current lookupAge ===')
  let serialOk = 0
  const t0 = Date.now()
  for (const d of domains) {
    const a = await lookupAge(d)
    const lamp = formatAgeLamp(a)
    if (lamp) serialOk++
    console.log(`  ${d.padEnd(32)} ${(lamp || '(EMPTY)').padEnd(18)} failed=${a.failed}`)
    await new Promise((r) => setTimeout(r, 400))
  }
  console.log(`  → serial: ${serialOk}/${domains.length} got an age  (${Date.now() - t0}ms)\n`)

  console.log('=== CONCURRENT (all at once = batch scout) — current lookupAge ===')
  const t1 = Date.now()
  const conc = await Promise.all(domains.map((d) => lookupAge(d).then((a) => ({ d, lamp: formatAgeLamp(a), failed: a.failed }))))
  const concOk = conc.filter((x) => x.lamp).length
  conc.forEach((x) => console.log(`  ${x.d.padEnd(32)} ${(x.lamp || '(EMPTY)').padEnd(18)} failed=${x.failed}`))
  console.log(`  → concurrent: ${concOk}/${domains.length} got an age  (${Date.now() - t1}ms)\n`)

  console.log('=== CDX earliest (1 call) — candidate primary source ===')
  let cdxOk = 0
  for (const d of domains) { const y = await cdxEarliest(d); if (y) cdxOk++; console.log(`  ${d.padEnd(32)} ${y || '(none)'}`) }
  console.log(`  → cdx: ${cdxOk}/${domains.length}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
