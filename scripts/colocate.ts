/**
 * scripts/colocate.ts — co-location WRITE pass (Ralph 2026-06-09, flag version).
 *
 * For every empty-website person at a shared street address, WRITE the shared
 * practice site into the `website` column AND set raw_payload.website_probably.
 * Writing the site makes the GROUP/SOLO domain-count see them (kills the SOLO-
 * on-a-group-practice bug); the flag carries "vermutlich" in the UI until scout
 * confirms it with a team-page screenshot (which clears the flag).
 *
 * Idempotent: computeCoLocation only proposes for still-empty rows, so a re-run
 * touches nothing already written. Run on demand + wired into the scout step.
 */
import { readRawProspects, patchRawProspect } from '@/lib/crm-store'
import { computeCoLocation } from '@/lib/scout-colocation'

async function main() {
  const rows = readRawProspects()
  const fills = computeCoLocation(rows)
  const byId = new Map(rows.map((r) => [r.id, r]))
  let n = 0
  for (const [id, v] of fills) {
    const r = byId.get(id); if (!r) continue
    let p: Record<string, unknown>; try { p = JSON.parse(r.raw_payload || '{}') } catch { p = {} }
    p.website_probably = true
    await patchRawProspect(id, { website: v.site, raw_payload: JSON.stringify(p) })
    n++
  }
  console.log(`co-location: wrote ${n} websites + website_probably flag`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
