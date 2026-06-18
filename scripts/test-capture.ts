// scripts/test-capture.ts — live e2e for WP-130: drive captureUrl exactly like
// the taste route does (real Puppeteer capture of a real site) and assert the
// JPEG lands at media/<plz>/<slug>/<firstname>.jpg. NOT a mock — hits the network.
//   tsx scripts/test-capture.ts <website> <plz> <name> [sharedCount]
import { existsSync, statSync } from 'fs'
import { captureUrl } from '@/lib/screenshot'
import { siteSlug, firstnameSlug, slugChunk, captureFile } from '@/lib/scout-paths'

async function main() {
  const [website, plz, name, shared] = process.argv.slice(2)
  if (!website || !plz || !name) {
    console.error('usage: test-capture <website> <plz> <name> [sharedCount]'); process.exit(1)
  }
  const slug = siteSlug(website)
  const firstname = firstnameSlug(name)
  const last = (name.trim().split(/\s+/).pop() || '')
  const tokens = [firstname, slugChunk(last)].filter((t) => t && t.length >= 3)
  const ctx = { plzOrRegion: plz, slug, firstname, sharedSiteCount: Number(shared || 1), nameTokens: tokens }
  console.log('ctx →', JSON.stringify(ctx))

  const t0 = Date.now()
  const r = await captureUrl(website, ctx)
  console.log(`\nresult (${Date.now() - t0} ms):`)
  console.log(JSON.stringify(r, null, 2))

  if (r.ok) {
    const main = captureFile(ctx, 'main')
    const prof = captureFile(ctx, 'profile')
    console.log(`\nmain    ${main}`)
    console.log(existsSync(main) ? `  → EXISTS ✓ (${statSync(main).size} B)` : '  → MISSING ✗')
    console.log(`profile ${prof}`)
    console.log(existsSync(prof) ? `  → EXISTS ✓ (${statSync(prof).size} B)` : '  → none (no matching profile link, or solo practice)')
  }
  process.exit(r.ok && existsSync(captureFile(ctx, 'main')) ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
