// ============================================================================
// scripts/migrate-whatsapp-media.ts — Ralph 2026-06-05
//
// One-shot rehome of the existing WhatsApp media into the new bucketing
// layout (lib/wa-bucketing.ts):
//
//   media/<digits>-<slug>/<hash>.<ext>           ← matched prospect
//   media/unmatched/<digits>-<slug>/<hash>.<ext> ← phone JID, no prospect yet
//   media/_non_phone/<digits>-<slug>/<hash>.<ext> ← @lid / @g.us / @broadcast
//   media/_invalid_phone/<safe>/<hash>.<ext>     ← JID didn't parse
//
// Source state (Ralph 2026-06-05):
//   - 62 flat files at media/ root
//   - 1 file at media/unmatched/ (orphan, no subdir)
//   - 55 files under 5 JID-shaped subdirs in media/unmatched/<jid>/
//
// Lookup strategy per file:
//   1. Hash from filename (sha256.<ext>)
//   2. Hash → activity row (LIKE %hash% on media_path). If matched → prospect
//      ID → prospect row → phone + company/contact_name. Bucket = matched.
//   3. Else hash → scan db/whatsapp/messages/<date>/*.json for any message
//      whose key.id maps to this hash. Read remoteJid + pushName. Bucket via
//      bucketFor(jid, pushName, null).
//   4. Else (no activity, no message) → quarantine to _invalid_phone/_orphan/.
//
// DB: NOT touched. media_path = '/api/admin/media/<hash>' is hash-keyed and
// bucket-agnostic — resolveMediaFile() walks every bucket.
//
// Idempotency: writes a manifest at db/whatsapp/media-migration-manifest.json
// (next to the existing one). Refuses to start if a manifest from this script
// already exists, unless --force.
//
// Run:
//   npx tsx scripts/migrate-whatsapp-media.ts            ← dry-run, prints plan
//   npx tsx scripts/migrate-whatsapp-media.ts --apply    ← does the moves
// ============================================================================

import { existsSync, readdirSync, readFileSync, statSync, renameSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import Database from 'better-sqlite3'
import { bucketFor, type Bucket } from '../lib/wa-bucketing'

const ROOT = process.cwd()
const MEDIA_DIR = join(ROOT, 'media')
const DB_PATH = join(ROOT, 'db', 'crm.db')
const MSG_DIR = join(ROOT, 'db', 'whatsapp', 'messages')
const MANIFEST = join(ROOT, 'db', 'whatsapp', 'media-migration-2026-06-05.json')
const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

interface FileInfo {
  src: string         // absolute fs path
  hash: string        // sha256 (extracted from basename)
  ext: string         // e.g. ".jpg"
  filename: string    // hash.ext
  currentBucket: string // 'flat' | 'unmatched' | 'unmatched/<jid>'
}

interface PlanEntry {
  file: FileInfo
  bucket: Bucket
  source: 'activity' | 'message' | 'orphan'
  jid?: string
  pushName?: string
  prospectId?: string
  prospectLabel?: string
}

// ── 1. Walk media/ and collect every file ──────────────────────────────────

function walkMedia(): FileInfo[] {
  const files: FileInfo[] = []
  const walk = (dir: string, currentBucket: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) {
        walk(full, currentBucket ? `${currentBucket}/${name}` : name)
        continue
      }
      const m = /^([a-f0-9]{64})\.([a-z0-9]+)$/i.exec(name)
      if (!m) continue
      files.push({
        src: full,
        hash: m[1].toLowerCase(),
        ext: '.' + m[2].toLowerCase(),
        filename: name,
        currentBucket: currentBucket || 'flat',
      })
    }
  }
  walk(MEDIA_DIR, '')
  return files
}

// ── 2. Build hash → activity map (matched messages) ─────────────────────────

interface ActivityHit {
  prospectId: string
  company: string
  contactName: string
  phone: string
}

function buildHashActivityMap(): Map<string, ActivityHit> {
  const db = new Database(DB_PATH, { readonly: true })
  // activities.media_path = '/api/admin/media/<hash>' — extract the hash
  const rows = db.prepare(`
    SELECT a.media_path, a.prospect_id, p.company, p.contact_name, p.phone
    FROM activities a
    LEFT JOIN prospects p ON p.id = a.prospect_id
    WHERE a.media_path LIKE '/api/admin/media/%'
  `).all() as Array<{ media_path: string; prospect_id: string; company: string; contact_name: string; phone: string }>
  db.close()
  const map = new Map<string, ActivityHit>()
  for (const r of rows) {
    const m = /\/api\/admin\/media\/([a-f0-9]{64})/i.exec(r.media_path)
    if (!m) continue
    const hash = m[1].toLowerCase()
    if (!map.has(hash)) {
      map.set(hash, {
        prospectId: r.prospect_id || '',
        company: r.company || '',
        contactName: r.contact_name || '',
        phone: r.phone || '',
      })
    }
  }
  return map
}

// ── 3. Build hash → message map (raw WA messages on disk) ───────────────────
//
// db/whatsapp/messages/<date>/<msg-id>.json — each carries remoteJid +
// pushName + possibly mediaKey / fileSha256 inside message.imageMessage etc.
// We extract anything that looks like a 64-hex hash from the message body.

interface MessageHit {
  jid: string
  pushName: string
  msgId: string
  date: string
}

/** digits-only prefix → full JID (with @suffix) — used to recover the
 *  kind ('@lid' vs '@s.whatsapp.net') for orphan files whose dir name is
 *  just digits with the suffix stripped. */
const jidByDigits = new Map<string, { jid: string; pushName: string }>()

function buildHashMessageMap(): Map<string, MessageHit> {
  const map = new Map<string, MessageHit>()
  if (!existsSync(MSG_DIR)) return map
  let dates: string[]
  try { dates = readdirSync(MSG_DIR) } catch { return map }
  for (const date of dates) {
    const dateDir = join(MSG_DIR, date)
    let files: string[]
    try { files = readdirSync(dateDir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      let raw: string
      try { raw = readFileSync(join(dateDir, f), 'utf-8') } catch { continue }
      let msg: { key?: { id?: string; remoteJid?: string }; pushName?: string } = {}
      try { msg = JSON.parse(raw) as typeof msg } catch { continue }
      const jid = msg.key?.remoteJid || ''
      const pushName = msg.pushName || ''
      const msgId = msg.key?.id || basename(f, '.json')
      // Index the digits-only form of every JID we encounter, so orphan dirs
      // can recover their classification (`@lid` vs `@s.whatsapp.net`).
      if (jid) {
        const digits = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
        if (digits && !jidByDigits.has(digits)) {
          jidByDigits.set(digits, { jid, pushName })
        }
      }
      // Pull every 64-hex string out of the raw JSON — covers fileSha256,
      // mediaKey-derived hashes, etc. without us having to know the exact
      // baileys schema for every message type.
      const matches = raw.match(/\b[a-f0-9]{64}\b/gi) || []
      for (const h of matches) {
        const hash = h.toLowerCase()
        // First message wins; don't overwrite with later identical jids.
        if (!map.has(hash)) map.set(hash, { jid, pushName, msgId, date })
      }
    }
  }
  return map
}

// ── 4. Build the plan ───────────────────────────────────────────────────────

function buildPlan(files: FileInfo[]): PlanEntry[] {
  const activityMap = buildHashActivityMap()
  const messageMap = buildHashMessageMap()
  console.log(`[plan] hash→activity: ${activityMap.size}  · hash→message: ${messageMap.size}`)

  const plan: PlanEntry[] = []
  for (const file of files) {
    const a = activityMap.get(file.hash)
    if (a && a.phone) {
      const bucket = bucketFor(
        // For matched activities the JID isn't in the DB — fake a phone JID
        // from the prospect's phone so the parser's phone branch fires.
        `${a.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`,
        '',
        { company: a.company, contact_name: a.contactName },
      )
      plan.push({
        file, bucket, source: 'activity',
        prospectId: a.prospectId,
        prospectLabel: a.company || a.contactName,
      })
      continue
    }
    const m = messageMap.get(file.hash)
    if (m) {
      const bucket = bucketFor(m.jid, m.pushName, null)
      plan.push({
        file, bucket, source: 'message',
        jid: m.jid, pushName: m.pushName,
      })
      continue
    }
    // Orphan — no hash-based hit. For files under media/unmatched/<digits>/
    // the dir is literally a remoteJid with its `@suffix` stripped. Recover
    // the suffix by cross-referencing against jidByDigits (built while we
    // scanned db/whatsapp/messages/): if any message used `<digits>@lid`
    // or `<digits>@s.whatsapp.net`, we get the original JID + pushName back
    // and bucketFor can classify it correctly (non_phone for @lid, etc.).
    if (file.currentBucket.startsWith('unmatched/')) {
      const dirDigits = file.currentBucket.slice('unmatched/'.length).replace(/[^0-9]/g, '')
      const recovered = jidByDigits.get(dirDigits)
      if (recovered) {
        const bucket = bucketFor(recovered.jid, recovered.pushName, null)
        plan.push({
          file, bucket, source: 'orphan',
          jid: recovered.jid, pushName: recovered.pushName,
        })
      } else {
        // No message references this dir's digits — best-guess as plain JID
        // input to bucketFor (which will tag as 'phone' or 'invalid' by length).
        const bucket = bucketFor(dirDigits, '', null)
        plan.push({ file, bucket, source: 'orphan', jid: dirDigits })
      }
    } else {
      plan.push({
        file,
        bucket: { kind: 'invalid', dir: '_invalid_phone/_orphan' },
        source: 'orphan',
      })
    }
  }
  return plan
}

// ── 5. Apply / dry-run ──────────────────────────────────────────────────────

function summarize(plan: PlanEntry[]): void {
  const byKind: Record<string, number> = {}
  const byBucket: Map<string, number> = new Map()
  const bySource: Record<string, number> = {}
  for (const e of plan) {
    byKind[e.bucket.kind] = (byKind[e.bucket.kind] || 0) + 1
    bySource[e.source] = (bySource[e.source] || 0) + 1
    byBucket.set(e.bucket.dir, (byBucket.get(e.bucket.dir) || 0) + 1)
  }
  console.log()
  console.log('=== plan summary ===')
  console.log('by kind:    ', byKind)
  console.log('by source:  ', bySource)
  console.log(`distinct destination buckets: ${byBucket.size}`)
  console.log()
  console.log('=== top 12 destination buckets ===')
  const sorted = [...byBucket.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  for (const [bucket, n] of sorted) {
    console.log(`  ${String(n).padStart(3)} files → media/${bucket}/`)
  }
}

function apply(plan: PlanEntry[]): { moved: number; skipped: number; failed: number } {
  let moved = 0, skipped = 0, failed = 0
  for (const e of plan) {
    const destDir = join(MEDIA_DIR, e.bucket.dir)
    const dest = join(destDir, e.file.filename)
    if (e.file.src === dest) { skipped++; continue }
    if (existsSync(dest)) {
      // Should be rare: same hash already in target. Skip — content is identical.
      skipped++
      continue
    }
    try {
      mkdirSync(destDir, { recursive: true })
      renameSync(e.file.src, dest)
      moved++
    } catch (err) {
      console.error(`[apply] FAIL ${e.file.filename}: ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }
  return { moved, skipped, failed }
}

function main(): void {
  console.log(`[migrate] media root: ${MEDIA_DIR}`)
  console.log(`[migrate] mode:       ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  if (APPLY && existsSync(MANIFEST) && !FORCE) {
    console.error(`[migrate] manifest already exists: ${MANIFEST}`)
    console.error(`           Refusing to re-apply without --force.`)
    process.exit(1)
  }

  const files = walkMedia()
  console.log(`[migrate] found ${files.length} media files`)

  const plan = buildPlan(files)
  summarize(plan)

  if (!APPLY) {
    console.log()
    console.log('Dry-run only. Re-run with --apply to perform the moves.')
    return
  }

  const { moved, skipped, failed } = apply(plan)
  console.log()
  console.log(`=== APPLY result ===`)
  console.log(`  moved:   ${moved}`)
  console.log(`  skipped: ${skipped}`)
  console.log(`  failed:  ${failed}`)

  // Persist the manifest for idempotency + audit.
  mkdirSync(join(ROOT, 'db', 'whatsapp'), { recursive: true })
  writeFileSync(MANIFEST, JSON.stringify({
    ran_at: new Date().toISOString(),
    moved, skipped, failed,
    entries: plan.map((e) => ({
      hash: e.file.hash,
      filename: e.file.filename,
      from: e.file.currentBucket,
      to: e.bucket.dir,
      kind: e.bucket.kind,
      source: e.source,
      jid: e.jid,
      pushName: e.pushName,
      prospectId: e.prospectId,
      prospectLabel: e.prospectLabel,
    })),
  }, null, 2), 'utf-8')
  console.log(`  manifest: ${MANIFEST}`)
}

main()
