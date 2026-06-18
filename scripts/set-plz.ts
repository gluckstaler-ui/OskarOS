// scripts/set-plz.ts — manually set raw_payload.plz (+ optional ort) for ONE row,
// for cases the address text can't yield (looked up by hand / on the web).
// Event-sourced via patchRawProspect (append + DB update, replay-safe).
//   node_modules/.bin/tsx scripts/set-plz.ts <id> <plz> [ort] [source]
import { readRawProspect, patchRawProspect } from '@/lib/crm-store'

async function main() {
  const [id, plz, ort, source] = process.argv.slice(2)
  if (!id || !/^\d{4}$/.test(plz || '')) {
    console.error('usage: set-plz <id> <4-digit-plz> [ort] [source]'); process.exit(1)
  }
  const r = readRawProspect(id)
  if (!r) { console.error('no such raw_prospect: ' + id); process.exit(1) }
  let rp: Record<string, unknown> = {}
  try { rp = JSON.parse(r.raw_payload || '{}') } catch { /* start fresh */ }
  rp.plz = plz
  if (ort) rp.ort = ort
  rp.plz_source = source || 'manual'
  await patchRawProspect(id, { raw_payload: JSON.stringify(rp) })
  console.log(`set ${id}: plz=${plz}${ort ? ` ort=${ort}` : ''} source=${rp.plz_source}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
