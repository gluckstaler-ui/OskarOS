// scripts/enrich-plz.ts — §18 cleanup
// Backfill raw_payload.plz from the address text for rows that lack it. FSP
// scraped the full address into `adr` (e.g. "Zollrain 2, 5000 Aarau") but did
// not always parse the PLZ into the `plz` key. We recover the real "NNNN City"
// PLZ from the text — NEVER guessed from a city name. Rows with no PLZ in their
// text are left untouched (the migration's region fallback, [MEDIA-B]) and listed.
//
// Event-sourced: patchRawProspect appends a raw_prospect.update event AND updates
// crm.db, so the change is replay-safe.
//
//   DRY RUN (default):  node_modules/.bin/tsx scripts/enrich-plz.ts
//   APPLY:              node_modules/.bin/tsx scripts/enrich-plz.ts --apply
import { readRawProspects, patchRawProspect } from '@/lib/crm-store'

const APPLY = process.argv.includes('--apply')
// PLZ = 4 digits followed by whitespace + a capital (the city) → "5000 Aarau".
// The "\s+[A-ZÄÖÜ]" guard skips street/house numbers ("Zollrain 2", "…strasse 37").
const PLZ_RE = /\b(\d{4})\s+[A-ZÄÖÜ]/

function findPlz(rp: Record<string, unknown>): { plz: string; src: string } | null {
  for (const k of ['adr', 'adresse', 'address', 'ort']) {
    const v = rp?.[k]
    if (typeof v === 'string') {
      const m = v.match(PLZ_RE)
      if (m) { const n = Number(m[1]); if (n >= 1000 && n <= 9999) return { plz: m[1], src: k } }
    }
  }
  return null
}

async function main() {
  const rows = readRawProspects()
  const missing = rows.filter((r) => {
    let rp: Record<string, unknown> = {}
    try { rp = JSON.parse(r.raw_payload || '{}') } catch { /* malformed → treat as missing */ }
    return String((rp as { plz?: unknown }).plz ?? '').trim() === ''
  })
  console.log(`live rows missing plz: ${missing.length}   mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  let recovered = 0
  const noText: string[] = []
  for (const r of missing) {
    let rp: Record<string, unknown> = {}
    try { rp = JSON.parse(r.raw_payload || '{}') } catch { /* skip */ }
    const hit = findPlz(rp)
    if (!hit) {
      noText.push(`${r.id}  ort=${rp.ort ?? '-'}  bezirk/region=${rp.bezirk ?? rp.region ?? '-'}  web=${String(r.website ?? '').slice(0, 26)}`)
      continue
    }
    recovered++
    console.log(`${APPLY ? '✓ wrote ' : '· would '}${r.id}  plz=${hit.plz}  ⟵ ${hit.src}: "${String(rp[hit.src]).slice(0, 46)}"`)
    if (APPLY) {
      rp.plz = hit.plz
      ;(rp as Record<string, unknown>).plz_source = `enriched:${hit.src}`
      await patchRawProspect(r.id, { raw_payload: JSON.stringify(rp) })
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${recovered} PLZ recovered · ${noText.length} have no PLZ in text → region fallback:`)
  noText.slice(0, 30).forEach((s) => console.log('  · ' + s))
  if (noText.length > 30) console.log(`  …and ${noText.length - 30} more`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
