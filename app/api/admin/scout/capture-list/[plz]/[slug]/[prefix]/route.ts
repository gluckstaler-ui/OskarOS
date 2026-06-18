// ============================================================================
// GET /api/admin/scout/capture-list/[plz]/[slug]/[prefix]
//
// Returns every screenshot that belongs to a single practitioner's dossier:
//
//   • this row's files          — anything starting with `<prefix>`
//                                  (e.g. `fabiana.jpg`, `fabiana-profile.jpg`)
//   • site-level shared shots   — anything starting with `_`
//                                  (e.g. `_main-<sha8>.jpg`). These exist in
//                                  `_shared/<slug>/` and are the same set
//                                  every practitioner of that praxis sees.
//
// Per Ralph 2026-06-05: "All screenshots are always displayed. Not only two.
// ALL." For a Gemeinschaftspraxis, the practice's content is shared across
// every practitioner — so every member's dossier shows the same site-level
// shots plus their own profile. The screenshot.ts capture pipeline stores
// shared shots content-addressed (`_main-<sha8>.jpg`), so duplicates can't
// be generated en masse anymore — the same bytes always land in the same
// filename.
//
// Defenses
// --------
//   • SEG_RE on every path component (no `.`, no `/`, no `..`)
//   • resolved path must stay inside MEDIA_DIR
//   • the prefix's own files match only an EXACT prefix join (so prefix
//     "sarai" doesn't pick up "sarai-a.jpg" left over from an older slug
//     scheme); shared shots match the literal `_` prefix only
//
// Response: { ok: true, shots: Array<{ url, label, sizeBytes, mtime }> }
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readdirSync, statSync } from 'fs'
import { join, resolve, sep } from 'path'
import { MEDIA_DIR } from '@/lib/media-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SEG_RE = /^[a-z0-9_-]+$/
const IMG_EXT = /\.(jpg|png|webp)$/i

type Shot = {
  url: string
  label: string
  sizeBytes: number
  mtime: number
  sortKey: number
}

function labelFor(prefix: string, filename: string): { label: string; sortKey: number } | null {
  if (!IMG_EXT.test(filename)) return null
  // Ralph 2026-06-05 — ALL screenshots displayed always. No prefix filter,
  // no closed vocab. Every JPEG in the slot folder reaches the dossier.
  // Order by relevance to THIS practitioner: their own files first, then
  // site-level shared shots, then other practitioners' files.
  //
  //   THIS row's profile        ← named glass, first
  //   THIS row's main           ← solo-site case
  //   THIS row's other variants
  //   _site-home.jpg            ← the house
  //   _site-<other>.jpg         ← other practice pages, alpha
  //   <other>-profile.jpg       ← other practitioners' profile pages
  //   <other>.jpg / variants    ← other practitioners' main shots
  const stemNoExt = filename.replace(IMG_EXT, '')

  if (stemNoExt === `${prefix}-profile`) return { label: 'practitioner page', sortKey: 10 }
  if (stemNoExt === prefix)              return { label: 'main',              sortKey: 20 }
  if (stemNoExt.startsWith(`${prefix}-`)) {
    const tail = stemNoExt.slice(prefix.length + 1)
    return { label: tail, sortKey: 30 }
  }
  if (stemNoExt === '_site-home')              return { label: 'home',              sortKey: 40 }
  if (stemNoExt.startsWith('_site-')) {
    return { label: stemNoExt.slice(6), sortKey: 50 }
  }
  if (stemNoExt.startsWith('_')) {
    return { label: stemNoExt.slice(1), sortKey: 55 }
  }
  if (stemNoExt.endsWith('-profile')) {
    return { label: `${stemNoExt.slice(0, -8)} (team member)`, sortKey: 60 }
  }
  return { label: stemNoExt, sortKey: 70 }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ plz: string; slug: string; prefix: string }> },
) {
  const { plz, slug, prefix } = await params
  if (!SEG_RE.test(plz) || !SEG_RE.test(slug) || !SEG_RE.test(prefix)) {
    return NextResponse.json({ error: 'malformed path component' }, { status: 400 })
  }
  const dirPath = join(MEDIA_DIR, plz, slug)
  const resolved = resolve(dirPath)
  if (resolved !== dirPath || !resolved.startsWith(MEDIA_DIR + sep)) {
    return NextResponse.json({ error: 'path escapes media root' }, { status: 400 })
  }
  if (!existsSync(resolved)) {
    return NextResponse.json({ error: 'slot folder not found' }, { status: 404 })
  }

  const entries = readdirSync(resolved)
  const shots: Shot[] = []
  for (const entry of entries) {
    const c = labelFor(prefix, entry)
    if (!c) continue
    try {
      const stat = statSync(join(resolved, entry))
      if (!stat.isFile()) continue
      shots.push({
        url: `/api/admin/scout/capture/${plz}/${slug}/${entry}`,
        label: c.label,
        sizeBytes: stat.size,
        mtime: stat.mtimeMs,
        sortKey: c.sortKey,
      })
    } catch { /* ignore */ }
  }
  shots.sort((a, b) => a.sortKey - b.sortKey || a.mtime - b.mtime)
  return NextResponse.json({
    ok: true,
    shots: shots.map(({ sortKey: _s, ...rest }) => rest),
  })
}
