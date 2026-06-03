#!/usr/bin/env node
// cleanup-duplicate-sidecars.mjs — removes the 72 unnecessary sidecars I created
// where a canonical UPPERCASE `VIBE-N.md` already exists for that index.
//
// Per Ralph's rule: "vibe-N.md covers all variations in html with the name
// vibe-N-(variation)". I violated this by generating exact-match lowercase
// sidecars for every HTML, even when the canonical UPPERCASE VIBE-N.md was
// already in place.
//
// This script lists every lowercase `vibe-N-slug.md` to delete. The
// canonical UPPERCASE `VIBE-N.md` / `VIBE-N-old.md` / `VIBE-N-slim.md`
// trio (and other curated catalog files) stay untouched.
//
// Targets:
//   - 2026-01-27-debug/ top folder: 66 files (lowercase only)
//   - 2026-05-07-5/: 3 files (the 3 lowercase ones I added)
//   - 2026-04-25-silke-lengler/: 3 files (the 3 vibe-5 variants I added)
//
// PRESERVES:
//   - All UPPERCASE VIBE-N.md / VIBE-N-old.md / VIBE-N-slim.md / VIBE-N-{SCHOOL}.md
//   - 2026-01-27-debug/backup/ subfolder (no canonical there — sidecars needed)
//   - All sessions where no canonical .md ever existed

import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const PUBLIC_DIR = '/Users/ralphlengler/OskarOS/oskar-prototype/public'
const DRY = process.argv.includes('--dry-run')

// Sessions that ALREADY had canonical UPPERCASE VIBE-N.md sidecars BEFORE
// my Wave 2 strict-coverage misadventure. Lowercase sidecars in these
// sessions' TOP folder (not subfolders) are duplicates and should die.
const SESSIONS_WITH_CANONICAL = [
  '2026-01-27-debug',
  '2026-05-07-5',
]

// Special case: silke session has vibe-5.md (lowercase) as canonical for index 5.
// The 3 vibe-5-oskar-* variants I added at the end are duplicates of that.
const SILKE_CANONICAL_INDEX = 5
const SILKE_SESSION = '2026-04-25-silke-lengler'

async function findToDelete() {
  const targets = []

  for (const session of SESSIONS_WITH_CANONICAL) {
    const sp = join(PUBLIC_DIR, session)
    const entries = await readdir(sp)
    // Find all UPPERCASE canonical indices in this session
    const canonicalIndices = new Set()
    for (const e of entries) {
      const m = e.match(/^VIBE-(\d+)(?:-[^.]*)?\.md$/)
      if (m) canonicalIndices.add(Number(m[1]))
      // 2026-05-07-5 uses uppercase too (VIBE-1.md not vibe-1.md)
      // Already captured by the regex above.
    }
    // Find lowercase sidecars whose index has a canonical
    for (const e of entries) {
      const m = e.match(/^vibe-(\d+)(?:-[^.]*)?\.md$/)  // lowercase only
      if (!m) continue
      const idx = Number(m[1])
      if (canonicalIndices.has(idx)) {
        targets.push(join(sp, e))
      }
    }
  }

  // Silke vibe-5 variants
  const silkePath = join(PUBLIC_DIR, SILKE_SESSION)
  const silkeEntries = await readdir(silkePath)
  for (const e of silkeEntries) {
    const m = e.match(/^vibe-(\d+)-[^.]+\.md$/i)
    if (!m) continue
    const idx = Number(m[1])
    if (idx === SILKE_CANONICAL_INDEX) {
      targets.push(join(silkePath, e))
    }
  }

  return targets
}

async function main() {
  const targets = await findToDelete()
  console.log(`${DRY ? 'WOULD DELETE' : 'DELETING'} ${targets.length} duplicate sidecars\n`)
  for (const t of targets) {
    const short = t.replace(PUBLIC_DIR + '/', '')
    if (DRY) {
      console.log(`  PLAN  ${short}`)
    } else {
      await unlink(t)
      console.log(`  DEL   ${short}`)
    }
  }
  console.log(`\n${DRY ? 'WOULD DELETE' : 'DELETED'}: ${targets.length}`)
}
main().catch(e => { console.error(e); process.exit(1) })
