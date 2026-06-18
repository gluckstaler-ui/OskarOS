// scripts/migrate-scout-media.ts — WP-129 (+ [MEDIA-H] content-vs-name dedup)
// Relocate Scout captures from public/__scout__/<hash>/{full,inner}.png into
// media/<plz-or-region>/<slug>/<firstname>.jpg and rewrite the DB pointers.
//
//   DRY RUN (default):        tsx scripts/migrate-scout-media.ts
//   APPLY (Phase A + B):      tsx scripts/migrate-scout-media.ts --apply
//   DELETE old (after check): tsx scripts/migrate-scout-media.ts --apply --delete-old
//
// Phase A (build media/) is additive; Phase B (pointer rewrite) is event-sourced
// (reversible via the log). public/__scout__ is only removed with --delete-old.
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import sharp from 'sharp'
import { getDb } from '@/lib/crm-boot'
import { patchRawProspect } from '@/lib/crm-store'
import {
  MEDIA_ROOT, domainOf, siteSlug, firstnameSlug, plzOrRegion,
  captureDir, captureFileName, captureServeUrl, type ScoutTarget,
} from '@/lib/scout-paths'

const APPLY = process.argv.includes('--apply')
const DELETE_OLD = process.argv.includes('--delete-old')
const SCOUT_DIR = path.join(process.cwd(), 'public', '__scout__')

interface Row { id: string; website: string; raw_payload: string; name: string }
interface Cand { rowId: string; name: string; t: ScoutTarget; srcFull: string; srcInner: string | null; hash: string }

function push<K, V>(m: Map<K, V[]>, k: K, v: V) { (m.get(k) ?? m.set(k, []).get(k)!).push(v) }

async function main() {
  const db = getDb()
  const rows = db.prepare(
    "SELECT id, website, raw_payload, name FROM raw_prospects WHERE website IS NOT NULL AND trim(website) NOT IN ('','—','-','n/a')",
  ).all() as Row[]
  const byDomain = new Map<string, Row[]>()
  for (const r of rows) push(byDomain, domainOf(r.website), r)

  const hashes = existsSync(SCOUT_DIR)
    ? readdirSync(SCOUT_DIR).filter((h) => existsSync(path.join(SCOUT_DIR, h, 'meta.json')))
    : []

  // group candidate captures by target slot (plz/slug/firstname)
  const slots = new Map<string, Cand[]>()
  let orphanCaptures = 0
  const matchedRows = new Set<string>()
  for (const h of hashes) {
    const dir = path.join(SCOUT_DIR, h)
    let meta: { url?: string; finalUrl?: string }
    try { meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf-8')) } catch { orphanCaptures++; continue }
    const url = meta.url || meta.finalUrl
    const srcFull = path.join(dir, 'full.png')
    if (!url || !existsSync(srcFull)) { orphanCaptures++; continue }
    const matches = byDomain.get(domainOf(url)) ?? []
    if (!matches.length) { orphanCaptures++; continue }
    const srcInner = existsSync(path.join(dir, 'inner.png')) ? path.join(dir, 'inner.png') : null
    for (const r of matches) {
      matchedRows.add(r.id)
      let rp: Record<string, unknown> = {}
      try { rp = JSON.parse(r.raw_payload || '{}') } catch { /* */ }
      const t: ScoutTarget = { plzOrRegion: plzOrRegion(rp), slug: siteSlug(r.website), firstname: firstnameSlug(r.name) }
      push(slots, `${t.plzOrRegion}/${t.slug}/${t.firstname}`, { rowId: r.id, name: r.name, t, srcFull, srcInner, hash: h })
    }
  }

  // resolve each slot → a write plan
  interface PlanItem { rowId: string; t: ScoutTarget; disambig: string; src: Cand; secondary: Cand[] }
  const plan: PlanItem[] = []
  let contentDeduped = 0, collisions = 0
  for (const cands of slots.values()) {
    const byRow = new Map<string, Cand[]>()
    for (const c of cands) push(byRow, c.rowId, c)
    const rowIds = [...byRow.keys()]
    rowIds.forEach((rid, idx) => {
      const cs = byRow.get(rid)!
      // [MEDIA-H] same-row multiple captures → content dedup (sha256 of source bytes)
      const byHash = new Map<string, Cand>()
      for (const c of cs) {
        const sha = createHash('sha256').update(readFileSync(c.srcFull)).digest('hex')
        if (!byHash.has(sha)) byHash.set(sha, c)
      }
      contentDeduped += cs.length - byHash.size
      const distinct = [...byHash.values()]
      // firstname collision: >1 distinct ROW in the same (plz,slug,firstname) slot → last-initial
      let disambig = ''
      if (rowIds.length > 1) {
        collisions++
        const ln = (cs[0].name || '').trim().split(/\s+/).pop() || ''
        disambig = firstnameSlug(ln)[0] || String(idx + 1)
      }
      plan.push({ rowId: rid, t: distinct[0].t, disambig, src: distinct[0], secondary: distinct.slice(1) })
    })
  }

  console.log(`captures on disk:                     ${hashes.length}`)
  console.log(`  orphan captures (no matching row):  ${orphanCaptures}`)
  console.log(`rows matched to a capture:            ${matchedRows.size}`)
  console.log(`media files to write:                 ${plan.length}`)
  console.log(`  content-deduped (identical bytes):  ${contentDeduped}`)
  console.log(`  firstname collisions disambiguated: ${collisions}`)
  console.log(`website rows with NO capture:         ${rows.length - matchedRows.size}`)
  console.log('\nsample targets:')
  for (const p of plan.slice(0, 12)) {
    console.log(`  ${p.rowId.padEnd(15)} → ${path.relative(process.cwd(), path.join(captureDir(p.t), captureFileName(p.t, 'main', p.disambig)))}`)
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written, no pointers changed. Re-run with --apply.'); return }

  // ── Phase A: convert PNG→JPEG into media/ ; Phase B: rewrite pointer (event-sourced) ──
  const manifest: unknown[] = []
  for (const p of plan) {
    const dir = captureDir(p.t)
    mkdirSync(dir, { recursive: true })
    const mainPath = path.join(dir, captureFileName(p.t, 'main', p.disambig))
    await sharp(p.src.srcFull).jpeg({ quality: 85 }).toFile(mainPath)
    let innerUrl: string | null = null
    if (p.src.srcInner) {
      const innerPath = path.join(dir, captureFileName(p.t, 'inner', p.disambig))
      await sharp(p.src.srcInner).jpeg({ quality: 85 }).toFile(innerPath)
      innerUrl = captureServeUrl(innerPath)
    }
    const secondary: string[] = []
    for (let i = 0; i < p.secondary.length; i++) {
      const sp = path.join(dir, captureFileName(p.t, 'main', `${p.disambig ? p.disambig + '-' : ''}${i + 2}`))
      await sharp(p.secondary[i].srcFull).jpeg({ quality: 85 }).toFile(sp)
      secondary.push(captureServeUrl(sp))
    }
    const mainUrl = captureServeUrl(mainPath)
    manifest.push({ rowId: p.rowId, hash: p.src.hash, main: mainUrl, inner: innerUrl, secondary })
    const cur = db.prepare('SELECT scout_json FROM raw_prospects WHERE id=?').get(p.rowId) as { scout_json?: string } | undefined
    const sj = JSON.parse(cur?.scout_json || '{}')
    if (sj.capture) {
      sj.capture.fullPageUrl = mainUrl
      sj.capture.innerPageUrl = innerUrl
      delete sj.capture.fullPagePath
      await patchRawProspect(p.rowId, { scout_json: JSON.stringify(sj) })
    }
  }
  mkdirSync(MEDIA_ROOT, { recursive: true })
  writeFileSync(path.join(MEDIA_ROOT, '_scout-migration.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nAPPLIED — ${plan.length} media files written, pointers rewritten, manifest at media/_scout-migration.json`)
  if (DELETE_OLD) { rmSync(SCOUT_DIR, { recursive: true, force: true }); console.log('public/__scout__ deleted.') }
  else console.log('public/__scout__ KEPT — run again with --delete-old once you have checked media/.')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
