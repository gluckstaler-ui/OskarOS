// lib/scout-orphan-sweep.ts — kill the corpses (Ralph 2026-06-05).
//
// Why this exists
// ---------------
// Shared-site main shots are content-addressed: every captureUrl writes its
// JPEG to `media/_shared/<slug>/_main-<sha8>.jpg`. When the deep-link swap
// or REJECT-path branch fires, captureUrl writes the FIRST shot to
// `_main-<oldHash>.jpg`, then re-shoots root and writes the second shot to
// `_main-<newHash>.jpg`. Only `<newHash>` ends up in the row's
// scout_json.capture.fullPageUrl — `<oldHash>` is now an orphan unless some
// OTHER row's capture happens to hash to the same bytes.
//
// We can't safely delete the orphan from inside captureUrl (another row's
// scout_json might reference it). The truth lives in the DB. This sweep is
// the authoritative cleanup: read every row's scout_json, build the set of
// live URLs, then unlink any `_main-*.jpg` not in that set. Safe to call
// at the end of every Scout batch.

import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { MEDIA_ROOT } from './scout-paths'
import { readRawProspects } from './crm-store'

/** Result of one sweep. Numbers + the removed paths (for logging only). */
export interface OrphanSweepResult {
  scanned: number
  deleted: number
  bytesFreed: number
  removed: string[]
}

/**
 * Walk every `_shared/<slug>/` folder, find every `_main-*.jpg`, and unlink
 * any whose serve-URL is NOT referenced by any row's
 * scout_json.capture.{fullPageUrl|profilePageUrl|innerPageUrl}.
 *
 * Idempotent. Safe to call concurrently with captureUrl writes — a brand-new
 * file the DB hasn't been written for yet WILL look like an orphan, so this
 * MUST be invoked AFTER the batch's DB writes complete (Promise.allSettled
 * resolved + patchRawProspect awaited). The scout-batch caller already meets
 * that ordering.
 *
 * Returns counts + the relative paths removed (for one [orphan-sweep] log
 * line — the count goes to the route response, the paths stay server-side).
 */
export async function sweepSharedMainOrphans(): Promise<OrphanSweepResult> {
  const sharedRoot = join(MEDIA_ROOT, '_shared')
  if (!existsSync(sharedRoot)) {
    return { scanned: 0, deleted: 0, bytesFreed: 0, removed: [] }
  }

  // Build the live-set from every row's scout_json.capture.
  const live = new Set<string>()
  const rows = readRawProspects()
  for (const r of rows) {
    let scout: { capture?: Record<string, unknown> } | null
    try { scout = r.scout_json ? JSON.parse(r.scout_json) as typeof scout : null } catch { scout = null }
    const cap = scout?.capture
    if (!cap || typeof cap !== 'object') continue
    for (const k of ['fullPageUrl', 'profilePageUrl', 'innerPageUrl'] as const) {
      const v = cap[k]
      if (typeof v === 'string') live.add(v)
    }
  }

  // Walk every site-level shared image (`_*.jpg/png/webp`) in `_shared/`.
  // That covers both the legacy content-addressed scheme (`_main-<sha8>.jpg`,
  // no longer written but might exist from older runs) AND the current
  // fixed-name scheme (`_site-home.jpg`, `_site-team.jpg`, …). Anything
  // without a row pointing at it is dead bytes.
  const removed: string[] = []
  let scanned = 0
  let deleted = 0
  let bytesFreed = 0
  for (const slug of readdirSync(sharedRoot)) {
    const dir = join(sharedRoot, slug)
    let st
    try { st = statSync(dir) } catch { continue }
    if (!st.isDirectory()) continue
    for (const f of readdirSync(dir)) {
      if (!/^_.*\.(?:jpg|png|webp)$/.test(f)) continue
      scanned++
      const url = `/api/admin/scout/capture/_shared/${slug}/${f}`
      if (live.has(url)) continue
      const p = join(dir, f)
      try {
        bytesFreed += statSync(p).size
        unlinkSync(p)
        deleted++
        removed.push(`_shared/${slug}/${f}`)
      } catch {
        // race: another process deleted it; ignore
      }
    }
  }
  return { scanned, deleted, bytesFreed, removed }
}
