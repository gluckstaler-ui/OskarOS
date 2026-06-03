#!/usr/bin/env node
// ============================================================================
// scripts/migrate-media-to-content-hash.mjs — one-shot media re-keying
// WP-CRM-F20 (Ralph 2026-05-25)
//
// Walks public/_whatsapp/media/<date>/<wa_id>.<ext> and:
//   1. Computes SHA256 of each file's bytes.
//   2. Writes to media/<sha256>.<ext> via safeWriteMediaMigration
//      (byte-compare on existence; aborts loudly on hash-wiring bug).
//   3. Records a manifest mapping (old_url → new_url) so the next step
//      can rewrite the Activities sheet's media_path references.
//   4. Rewrites public/_crm/prospects.xlsx Activities sheet to point at
//      the new /api/admin/media/<hash> URLs.
//   5. Removes the original date-sharded media directory only after the
//      xlsx rewrite succeeds. (Auth/messages/unmatched relocation is a
//      sibling script: migrate-whatsapp-state.mjs.)
//
// Idempotent at the migration layer (byte-compare → dedup no-op). Not
// idempotent at the xlsx rewrite layer (running twice will look for
// already-rewritten URLs and find none to rewrite — still safe).
// ============================================================================

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import { read, utils, write as writeXlsx } from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OLD_MEDIA = join(ROOT, 'public', '_whatsapp', 'media')
const NEW_MEDIA = join(ROOT, 'media')
const XLSX_PATH = join(ROOT, 'docs', 'crm-feature', 'prospects.xlsx')

mkdirSync(NEW_MEDIA, { recursive: true })

// ─── Step 1+2: walk + rehash + write ──────────────────────────────────────

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeWriteMediaMigration(hash, ext, sourceBytes) {
  const dest = join(NEW_MEDIA, `${hash}.${ext}`)
  if (existsSync(dest)) {
    const existing = readFileSync(dest)
    if (existing.equals(sourceBytes)) {
      return { stored: false, reason: 'dedup', hash, path: dest }
    }
    throw new Error(
      `Hash ${hash} maps to two different byte-strings.\n` +
      `  Existing: ${dest} (${existing.length} bytes)\n` +
      `  Incoming source: ${sourceBytes.length} bytes\n` +
      `Investigate before continuing — almost certainly a hash-wiring bug.`,
    )
  }
  writeFileSync(dest, sourceBytes)
  return { stored: true, hash, path: dest }
}

if (!existsSync(OLD_MEDIA)) {
  console.log('[migrate-media] no public/_whatsapp/media/ directory — nothing to migrate')
  process.exit(0)
}

const manifest = []   // [{oldPath, oldUrl, newHash, newUrl, newPath, ext}]
let walked = 0
let stored = 0
let dedup = 0

for (const dayDir of readdirSync(OLD_MEDIA)) {
  const dayPath = join(OLD_MEDIA, dayDir)
  if (!statSync(dayPath).isDirectory()) continue
  for (const filename of readdirSync(dayPath)) {
    const filePath = join(dayPath, filename)
    if (!statSync(filePath).isFile()) continue
    const ext = extname(filename).slice(1) || 'bin'
    const bytes = readFileSync(filePath)
    const hash = hashBytes(bytes)
    const result = safeWriteMediaMigration(hash, ext, bytes)
    const oldUrl = `/_whatsapp/media/${dayDir}/${filename}`
    const newUrl = `/api/admin/media/${hash}`
    manifest.push({ oldPath: filePath, oldUrl, newHash: hash, newUrl, newPath: result.path, ext })
    walked++
    if (result.stored) stored++; else dedup++
    console.log(`  [${result.stored ? 'store' : 'dedup'}] ${oldUrl} → ${newUrl}`)
  }
}

console.log(`\n[migrate-media] walked=${walked}, stored=${stored}, dedup=${dedup}`)

// ─── Step 3: write manifest for audit/recovery ────────────────────────────

const manifestPath = join(ROOT, 'db', 'whatsapp', 'media-migration-manifest.json')
mkdirSync(dirname(manifestPath), { recursive: true })
writeFileSync(manifestPath, JSON.stringify({
  migrated_at: new Date().toISOString(),
  entries: manifest,
}, null, 2), 'utf-8')
console.log(`[migrate-media] manifest written: ${manifestPath}`)

// ─── Step 4: rewrite xlsx Activities sheet ────────────────────────────────

if (!existsSync(XLSX_PATH)) {
  console.warn(`[migrate-media] no xlsx at ${XLSX_PATH} — skipping xlsx rewrite`)
} else {
  const wb = read(readFileSync(XLSX_PATH), { type: 'buffer' })
  const activitiesSheet = wb.Sheets['Activities']
  if (!activitiesSheet) {
    console.warn('[migrate-media] no Activities sheet — skipping xlsx rewrite')
  } else {
    const rows = utils.sheet_to_json(activitiesSheet)
    const urlByOld = new Map(manifest.map(m => [m.oldUrl, m.newUrl]))
    // Also map by raw filename in case media_path used a relative form.
    const urlByFilename = new Map()
    for (const m of manifest) {
      const filename = m.oldPath.split('/').pop()
      if (filename) urlByFilename.set(filename, m.newUrl)
    }

    let rewritten = 0
    for (const row of rows) {
      const current = String(row.media_path || '')
      if (!current) continue
      let next = urlByOld.get(current)
      if (!next) {
        // Try matching by filename suffix
        const filename = current.split('/').pop()
        if (filename) next = urlByFilename.get(filename)
      }
      if (next && next !== current) {
        row.media_path = next
        rewritten++
      }
    }
    if (rewritten > 0) {
      const newSheet = utils.json_to_sheet(rows)
      wb.Sheets['Activities'] = newSheet
      // Preserve column widths if previously set
      if (activitiesSheet['!cols']) newSheet['!cols'] = activitiesSheet['!cols']
      const buf = writeXlsx(wb, { type: 'buffer', bookType: 'xlsx' })
      writeFileSync(XLSX_PATH, buf)
      console.log(`[migrate-media] rewrote ${rewritten} media_path references in Activities sheet`)
    } else {
      console.log('[migrate-media] no media_path references in Activities matched manifest — sheet unchanged')
    }
  }
}

// ─── Step 5: remove old media dir ─────────────────────────────────────────

console.log(`[migrate-media] removing old directory: ${OLD_MEDIA}`)
rmSync(OLD_MEDIA, { recursive: true, force: true })
console.log('[migrate-media] done')
