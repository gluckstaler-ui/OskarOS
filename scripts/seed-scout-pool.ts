// Scout v1 seed (Ralph 2026-06-03): import the canonical xlsx
// (intelligence/aargau-psyche-leadliste-200_2.xlsx, sheet "Alle Praxen") into
// the raw_prospects pool. The ~12 Aarau leads that appear in the v2 mockup are
// pre-scouted so every row-state renders; the rest land `raw` (has site) or
// `greenfield` (no site). Idempotent by id (INSERT OR REPLACE).
//
// Run: npx tsx scripts/seed-scout-pool.ts
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { ingestRawProspect } from '../lib/crm-store'

const HEAT = (g: number) => (g >= 2 ? 'hot' : g === 1 ? 'warm' : 'cold')

type Sc = { p: number; e: number; choice: string; v: string; age: string; stack: string; host: string; perf: string; seo: string; photos: string }
const CURATED: Record<string, Sc> = {
  'mviviani.ch':              { p: 5, e: 2, choice: 'a single art-photograph — light through water, a point of view, not a stethoscope', v: 'Taste way out front of the build — already wants what we sell.', age: '~2017 · aging', stack: 'WordPress', host: 'Infomaniak · CH', perf: 'mobile 44', seo: '66', photos: 'art-directed · the water photo' },
  'praxis-michalik.ch':       { p: 4, e: 2, choice: 'a hand-drawn logo mark, real warmth in the portraits', v: 'Genuine eye on a tired theme — strong displacement pain.', age: '~2016 · aging', stack: 'WordPress · old theme', host: 'Cyon · CH', perf: 'mobile 41', seo: '63', photos: 'real portraits · warm' },
  'cbacilieri.ch':            { p: 4, e: 2, choice: 'a child’s-drawing motif carried into the nav — warmth on purpose', v: 'Clear point of view, half-built. Hot.', age: '~2019 · ok', stack: 'WordPress', host: 'Hostpoint · CH', perf: 'mobile 49', seo: '68', photos: 'hand-drawn motif + real' },
  'praxisaare.ch':            { p: 3, e: 1, choice: 'a real photograph of the Aare tying the name to the place — then a flat layout drops it', v: 'One good instinct, no follow-through. Pursue.', age: '~2016 · aging', stack: 'WordPress · old', host: 'Hostpoint · CH', perf: 'mobile 40', seo: '61', photos: 'one Aare photo · rest stock' },
  'psychotherapie-alder.ch':  { p: 4, e: 3, choice: 'one honest portrait, generous whitespace, a real sentence not a slogan', v: 'Promising eye, mostly realized — a touch, not a rebuild.', age: '~2020 · ok', stack: 'Webflow', host: 'Webflow', perf: 'mobile 72', seo: '84', photos: 'one honest portrait' },
  'vt-aarau.ch':              { p: 3, e: 2, choice: 'a calm sage-green palette, not clinical white', v: 'A little eye, template execution. Warm.', age: '~2018 · ok', stack: 'WordPress', host: 'Hostpoint · CH', perf: 'mobile 54', seo: '71', photos: 'stock · sage-tinted' },
  'psy-suhr.ch':              { p: 3, e: 2, choice: 'one nice photograph of the park the practice is named for', v: 'A grounded choice on a thin build. Warm.', age: '~2019 · ok', stack: 'WordPress', host: 'Cyon · CH', perf: 'mobile 51', seo: '69', photos: 'one park photo · rest stock' },
  'psychotherapie-picard.ch': { p: 3, e: 3, choice: 'tidy and professional, but every choice is the safe one', v: 'Competent, no felt lack. Teach desire first.', age: '~2021 · ok', stack: 'Squarespace', host: 'Squarespace', perf: 'mobile 78', seo: '88', photos: 'tasteful stock' },
  'psychologie-lardieri.ch':  { p: 2, e: 2, choice: 'default Jimdo theme, stock lavender header — borrowed calm', v: 'Convention top to bottom. Cold.', age: '~2014 · stale', stack: 'Jimdo', host: 'Jimdo · DE', perf: 'mobile 38', seo: '55', photos: 'stock lavender' },
  'psychiater-aarau.ch':      { p: 1, e: 2, choice: 'keyword domain, blue gradient, a clip-art brain — pure convention', v: 'Plonk. No eye to work with.', age: '~2018 · ok', stack: 'WordPress', host: 'Hostpoint · CH', perf: 'mobile 58', seo: '74', photos: 'clip-art brain' },
  'therapie-reich.ch':        { p: 4, e: 4, choice: 'a confident wordmark, art-directed top to bottom — already knows good', v: 'The connoisseur. Beautiful, nothing to sell.', age: '~2023 · fresh', stack: 'Next.js · custom', host: 'Vercel', perf: 'mobile 94', seo: '97', photos: 'fully art-directed' },
  'schmidschueller.ch':       { p: 1, e: 1, choice: 'nothing chosen — a builder template with the demo text half-replaced', v: 'Raw template, no conviction. Cold.', age: '~2015 · stale', stack: 'Wix', host: 'Wix · US', perf: 'mobile 35', seo: '52', photos: 'demo stock left in' },
}

function scoutJson(sc: Sc): string {
  const gap = sc.p - sc.e
  return JSON.stringify({
    scanned_at: new Date().toISOString(),
    taste: { palate: sc.p, execution: sc.e, gap, heat: HEAT(gap), palate_choice: sc.choice, verdict: sc.v, photos: sc.photos },
    queried: { age: sc.age, stack: sc.stack, hosting: sc.host, performance: sc.perf, seo: sc.seo },
    failed: false, fail_reason: null,
  })
}

async function main() {
  const wb = XLSX.readFile(join(process.cwd(), 'intelligence/aargau-psyche-leadliste-200_2.xlsx'))
  const ws = wb.Sheets['Alle Praxen']
  if (!ws) throw new Error('sheet "Alle Praxen" not found')
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })

  // Locate the header row (Region … Website-Status), then iterate data below it.
  let h = rows.findIndex((r) => r.map(String).includes('Region') && r.some((c) => /Website-Status/i.test(String(c))))
  if (h < 0) h = 1
  const header = rows[h].map((c) => String(c).trim().toLowerCase())
  const col = (name: string) => header.findIndex((c) => c.startsWith(name.toLowerCase()))
  const ci = { region: col('Region'), ort: col('Ort'), name: col('Name'), typ: col('Typ'), tel: col('Telefon'), email: col('E-Mail'), adr: col('Adresse'), web: col('Website') }

  let i = 0, scouted = 0, raw = 0, green = 0, skipped = 0
  for (let r = h + 1; r < rows.length; r++) {
    const row = (rows[r] || []).map((c) => String(c).trim())
    const name = row[ci.name] || ''
    if (!name || name.toLowerCase() === 'name') { skipped++; continue }
    const status = row[ci.web] || ''
    const isLead = /keine eigene website/i.test(status)
    const tief = /tief/i.test(status)
    const website = isLead ? '' : ((status.match(/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i)?.[0] ?? '').toLowerCase())
    const phone = row[ci.tel] === '—' ? '' : (row[ci.tel] || '')
    const email = row[ci.email] === '—' ? '' : (row[ci.email] || '')
    i += 1
    const id = `R-aargau-${String(i).padStart(3, '0')}`
    const sc = website ? CURATED[website] : undefined
    if (sc) scouted += 1; else if (website) raw += 1; else green += 1
    await ingestRawProspect({
      id, source: 'xlsx-import:aargau-psyche-leadliste-200_2.xlsx',
      name, company: name, phone, email, website,
      country: 'CH', industry: tief ? 'Psychologie (tief)' : 'Psychotherapie',
      raw_payload: JSON.stringify({ region: row[ci.region] || '', ort: row[ci.ort] || '', name, typ: row[ci.typ] || '', phone: row[ci.tel] || '', email: row[ci.email] || '', adr: row[ci.adr] || '', website_status: status }),
      scout_json: sc ? scoutJson(sc) : '{}',
    })
  }
  console.log(`Imported ${i} leads from xlsx (Alle Praxen): ${scouted} pre-scouted · ${raw} raw · ${green} greenfield · skipped ${skipped} non-data rows`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
