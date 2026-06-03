// ============================================================================
// lib/media-store.ts — content-addressed media file store
// WP-CRM-F20 (Ralph 2026-05-25)
//
// Two write functions with different strictness contracts:
//
//   safeWriteMediaMigration  — used by scripts/migrate-media-to-content-hash.ts
//                              during the one-shot migration of pre-F20 media.
//                              BYTE-COMPARE on existing destination — strictest
//                              check, catches hash-wiring bugs and (impossibly)
//                              true SHA collisions at migration cost.
//
//   safeWriteMediaRuntime    — used by lib/wa-runtime.ts when downloading
//                              inbound WhatsApp media. SIZE-COMPARE on existing
//                              destination — cheap hot-path check; the
//                              comment is honest that this defends against a
//                              hash-wiring bug, NOT a crypto collision.
//
// Both functions return { stored, reason? } so callers can distinguish
// "wrote a new file" from "dedup — same content already on disk."
// ============================================================================

import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join, dirname, basename } from 'path'

export const MEDIA_DIR = join(process.cwd(), 'media')

mkdirSync(MEDIA_DIR, { recursive: true })

// ── Per-number bucketing (Ralph 2026-05-31) ────────────────────────────────
// Media is filed under media/<bucket>/<hash>.<ext> where bucket is the sender's
// phone number (matched leads) or `unmatched/<phone>` (unknown senders). On
// match, moveMediaBucket relocates the files. The stored media_path stays the
// content-hash URL /api/admin/media/<hash> — resolveMediaFile finds the bytes
// in whatever bucket they live in, so existing flat files keep working with no
// migration and the move-on-match needs no DB rewrite.

/** Sanitize a bucket path segment-by-segment — blocks path traversal, keeps
 *  phone-ish chars + the literal `unmatched`. Empty → flat root (back-compat). */
export function sanitizeBucket(bucket: string | undefined | null): string {
  if (!bucket) return ''
  return bucket
    .split('/')
    .map((seg) => seg.replace(/[^A-Za-z0-9+_-]/g, ''))
    .filter(Boolean)
    .join('/')
}

/** Find media/<…>/<hash>.<ext> — checks the flat root first, then subfolders
 *  (bounded depth 2, enough for `unmatched/<phone>`). Null if absent. */
export function resolveMediaFile(hash: string): string | null {
  const walk = (dir: string, depth: number): string | null => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return null }
    for (const name of entries) {
      if (name.startsWith(`${hash}.`)) return join(dir, name)
    }
    if (depth <= 0) return null
    for (const name of entries) {
      const full = join(dir, name)
      try { if (statSync(full).isDirectory()) { const hit = walk(full, depth - 1); if (hit) return hit } } catch { /* skip */ }
    }
    return null
  }
  return walk(MEDIA_DIR, 2)
}

/** Move the media files for the given content-hashes into media/<toBucket>/,
 *  wherever they currently live (flat root OR another bucket). This is the
 *  move-on-match primitive: it handles both pre-bucketing flat files and new
 *  media/unmatched/<phone>/ files. Returns the number of files relocated. */
export function moveMediaByHashes(hashes: string[], toBucket: string): number {
  const toDir = join(MEDIA_DIR, sanitizeBucket(toBucket))
  let moved = 0
  for (const hash of hashes) {
    if (!/^[a-f0-9]{64}$/i.test(hash)) continue
    const src = resolveMediaFile(hash)
    if (!src) continue
    const dest = join(toDir, basename(src))
    if (src === dest || existsSync(dest)) continue
    try {
      mkdirSync(toDir, { recursive: true })
      renameSync(src, dest)
      moved++
    } catch { /* skip one file, keep going */ }
  }
  return moved
}

export interface WriteResult {
  stored: boolean
  reason?: 'dedup'
  hash: string
  path: string
}

export function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Strict write — byte-compare on existence. Used during the F20 migration
 * because we have a few thousand files and the extra disk read per dedup
 * hit is irrelevant compared to the safety of catching a hash-wiring bug.
 *
 * Throws on (hash match, bytes differ). That's either a hash-wiring bug or
 * an actual SHA256 collision; either way, abort and don't overwrite.
 */
export function safeWriteMediaMigration(
  hash: string,
  ext: string,
  sourceBytes: Buffer,
): WriteResult {
  const dest = join(MEDIA_DIR, `${hash}.${ext}`)
  if (existsSync(dest)) {
    const existing = readFileSync(dest)
    if (existing.equals(sourceBytes)) {
      // Real dedup — content-addressed means same hash + same content = same file.
      return { stored: false, reason: 'dedup', hash, path: dest }
    }
    throw new Error(
      `Hash ${hash} maps to two different byte-strings.\n` +
      `  Existing: ${dest} (${existing.length} bytes)\n` +
      `  Incoming source: ${sourceBytes.length} bytes\n` +
      `Investigate before continuing — almost certainly a hash-wiring bug. ` +
      `(SHA256 collisions don't exist in practice.)`,
    )
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, sourceBytes)
  return { stored: true, hash, path: dest }
}

/**
 * Fast write — size-compare on existence. Used by the runtime when
 * downloading inbound WhatsApp media. Dedup hits should be rare in this
 * path (different inbound media → different hashes), so the extra cost of
 * a byte-compare on dedup isn't worth it.
 *
 * The size-compare is NOT defending against SHA256 collisions (those don't
 * exist). It's defending against a programming bug that wired up the hash
 * wrong (e.g. hashing the filename instead of bytes, or hashing only the
 * first N bytes). Such a bug would typically produce same-hash-different-size,
 * and the throw forces the operator to look at the code.
 */
export function safeWriteMediaRuntime(
  hash: string,
  ext: string,
  sourceBytes: Buffer,
  subdir = '',
): WriteResult {
  const dir = subdir ? join(MEDIA_DIR, subdir) : MEDIA_DIR
  const dest = join(dir, `${hash}.${ext}`)
  if (existsSync(dest)) {
    const destSize = statSync(dest).size
    if (destSize === sourceBytes.length) {
      // Trust the hash. Defense against hash-wiring bug (NOT crypto collision)
      // is the only reason we even peek at the existing file's size.
      return { stored: false, reason: 'dedup', hash, path: dest }
    }
    throw new Error(
      `Hash ${hash} collision suspected: existing file size=${destSize}, ` +
      `incoming bytes=${sourceBytes.length}. This indicates a hash-wiring bug, ` +
      `not a crypto collision. Investigate before continuing.`,
    )
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, sourceBytes)
  return { stored: true, hash, path: dest }
}

/**
 * Convenience helper for the runtime: combines hash + write in one call.
 * Returns the public URL the caller should use (the auth-gated route path,
 * NOT a direct static URL — direct static URLs were retired in F20).
 */
export function writeRuntimeMedia(
  bytes: Buffer,
  ext: string,
  bucket?: string,
): { hash: string; url: string; stored: boolean } {
  const hash = hashBytes(bytes)
  const result = safeWriteMediaRuntime(hash, ext, bytes, sanitizeBucket(bucket))
  return {
    hash,
    // URL stays content-hash-only — the file's bucket is a disk-layout detail;
    // the serve route resolves the hash wherever it lives (resolveMediaFile).
    url: `/api/admin/media/${hash}`,
    stored: result.stored,
  }
}
