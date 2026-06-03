// Consolidate duplicated fields (Ralph 2026-05-28):
//   needs_analysis   -> intel.pain   (Opportunity "PAIN POINTS")
//   solutions_bought -> intel.pitch  (Opportunity "WHAT TO PITCH")
// Writes intel_json via the event-logged writeSheet path. Run this BEFORE the
// columns/code are removed. Lossless: appends if intel.pain/pitch already hold
// text (none do today, so it just sets them).
// Run: OSKAR_NODE_ID=ralph-mac npx tsx scripts/migrate-needs-solutions-to-intel.ts
import { readSheet, writeSheet } from '../lib/crm-store'

const merge = (existing: string | undefined, incoming: string) => {
  const a = (existing || '').trim()
  if (!a) return incoming
  if (a === incoming) return a
  return `${a}\n${incoming}`
}

async function main() {
  const rows = readSheet()
  let migrated = 0
  for (const p of rows) {
    // Legacy columns (dropped from the Prospect type 2026-05-28; may still
    // exist physically in un-migrated crm.db files). Cast to read them.
    const legacy = p as unknown as { needs_analysis?: string; solutions_bought?: string }
    const na = (legacy.needs_analysis || '').trim()
    const sb = (legacy.solutions_bought || '').trim()
    if (!na && !sb) continue
    let intel: Record<string, unknown> = {}
    try { intel = JSON.parse(p.intel_json || '{}') } catch { intel = {} }
    if (na) intel.pain = merge(intel.pain as string, na)
    if (sb) intel.pitch = merge(intel.pitch as string, sb)
    p.intel_json = JSON.stringify(intel)
    migrated++
    console.log(`${p.id} ${p.company}: pain<-${na ? na.slice(0, 30) : '—'} | pitch<-${sb ? sb.slice(0, 30) : '—'}`)
  }
  await writeSheet(rows)
  console.log(`\nMigrated ${migrated} prospects.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
