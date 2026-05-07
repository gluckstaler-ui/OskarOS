/**
 * /api/mcp/list-assets — Phase 2 Tier A (rewritten 2026-04-30 per Ralph's spec).
 *
 * Doctrine: thumbnails are the rare case, metadata is the always case.
 * This route is a STATE INDEX, not an image viewer. Visual inspection is
 * `FileRead`'s job — Claude is multimodal and the actual file is strictly
 * better than a 160px WebP shrink-down.
 *
 * What's gone vs the v1:
 *   - thumbnailBase64 (deleted entirely; no Sharp pipeline at all here)
 *   - .cache/thumbs/ (no longer created or needed)
 *   - full IMAGES.md prose dumps (one-line cdNote replaces it)
 *
 * Per-asset shape:
 *   filename       string    "sultan.jpg"
 *   status         enum      HERO | USED | B-ROLL | READY | APPROVED | REDO | INGESTED | TRASH | UNTAGGED
 *   broken         bool      file referenced in IMAGES.md but missing on disk
 *   sizeKB         int       9
 *   dimensions     "WxH"     "1024x1536"
 *   aspectRatio    "W:H"     "2:3" (gcd-reduced)
 *   mtime          ISO       last-modified
 *   vibeUsage      string[]  ["vibe-3:hero", "vibe-7:portrait"] — built-HTML refs
 *   cdNote         string    ≤120 chars, one-line from CD Analysis / Evaluation
 *
 * Filters:
 *   tag    — exact tag match
 *   vibe   — vibe slug appears in any vibeUsage entry OR in suggestedVibes
 *   broken — true|false; isolate dead refs OR exclude them
 *   usedIn — true|false; usedIn=false → orphans (on disk, referenced by zero HTML)
 *
 * Pagination:
 *   limit  default 50, max 200
 *   offset default 0
 *   Response includes total + truncated.
 */

import { NextResponse } from 'next/server'
import { join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import sharp from 'sharp'
import { parseImagesMd } from '@/lib/session'

const IMAGE_EXTS = /\.(jpg|jpeg|png|webp|gif|avif)$/i
const VIBE_HTML = /^vibe-.*\.html$/i

interface ListFilter {
  tag?: string
  vibe?: string
  broken?: boolean
  usedIn?: boolean
}

interface AssetRow {
  filename: string
  status: string
  broken: boolean
  sizeKB: number
  dimensions: string
  aspectRatio: string
  mtime: string
  vibeUsage: string[]
  cdNote: string
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function reduceAspect(w: number, h: number): string {
  if (!w || !h) return ''
  const d = gcd(w, h)
  return `${w / d}:${h / d}`
}

/**
 * One-line truncation for CD analysis. Drops paragraph breaks, collapses
 * whitespace, hard-caps at 120 chars with an ellipsis. ASCII so it doesn't
 * eat unicode-aware bytes in CD's context budget.
 */
function oneLineCdNote(raw?: string): string {
  if (!raw) return ''
  const flat = raw.replace(/\s+/g, ' ').trim()
  if (flat.length <= 120) return flat
  return flat.slice(0, 117).trimEnd() + '...'
}

/**
 * Scan vibe HTMLs for `<img src="X" data-slot="Y">` AND
 * `<elem style="background-image:url('X')" data-slot="Y">` references.
 * Returns Map<filename, ["vibe-3:hero", "vibe-7:portrait", ...]>.
 *
 * Slot resolution: prefer `data-slot` on the element. If absent, fall back
 * to `data-usage` if present. If neither, label the entry without a slot
 * suffix ("vibe-3").
 */
async function scanVibeUsage(sessionDir: string): Promise<Map<string, string[]>> {
  const usage = new Map<string, string[]>()
  let entries: string[]
  try {
    entries = await readdir(sessionDir)
  } catch {
    return usage
  }
  const htmls = entries.filter((f) => VIBE_HTML.test(f))
  // Tag pattern: capture src/url filename PLUS adjacent data-slot/data-usage if any.
  // Cheap parse: split on element boundaries, regex inside each tag.
  const elemRe = /<[^>]+>/g
  const srcRe = /(?:src|data-src)\s*=\s*["']([^"']+\.(?:jpg|jpeg|png|webp|avif|gif))["']/i
  const urlRe = /url\s*\(\s*['"]?([^'")]+\.(?:jpg|jpeg|png|webp|avif|gif))['"]?\s*\)/i
  const slotRe = /data-slot\s*=\s*["']([^"']+)["']/i
  const usageRe = /data-usage\s*=\s*["']([^"']+)["']/i
  for (const file of htmls) {
    const slug = file.match(/^(vibe-\d+)/i)?.[1]?.toLowerCase() || file.replace(/\.html$/i, '')
    let html: string
    try {
      html = await readFile(join(sessionDir, file), 'utf-8')
    } catch {
      continue
    }
    let match: RegExpExecArray | null
    elemRe.lastIndex = 0
    while ((match = elemRe.exec(html)) !== null) {
      const tag = match[0]
      const src = tag.match(srcRe)?.[1] || tag.match(urlRe)?.[1]
      if (!src) continue
      const filename = src.split(/[?#]/)[0].split('/').pop()
      if (!filename) continue
      const slot = tag.match(slotRe)?.[1] || tag.match(usageRe)?.[1] || ''
      const label = slot ? `${slug}:${slot}` : slug
      const list = usage.get(filename) || []
      if (!list.includes(label)) list.push(label)
      usage.set(filename, list)
    }
  }
  return usage
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const filter = (body.filter || {}) as ListFilter
  const limit = Math.max(1, Math.min(200, Number(body.limit) || 50))
  const offset = Math.max(0, Number(body.offset) || 0)
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const sessionDir = join(process.cwd(), 'public', sessionId)
  if (!existsSync(sessionDir)) {
    return NextResponse.json({ assets: [], total: 0, truncated: false })
  }

  const entries = await readdir(sessionDir)
  const imageFiles = entries.filter((f) => IMAGE_EXTS.test(f))

  // IMAGES.md metadata
  let parsed: Awaited<ReturnType<typeof parseImagesMd>>
  try {
    parsed = await parseImagesMd(sessionId)
  } catch {
    parsed = new Map()
  }

  // vibe usage from HTML files
  const usage = await scanVibeUsage(sessionDir)

  // Union of on-disk + IMAGES.md-only filenames so callers see broken refs.
  const allFilenames = new Set<string>([...imageFiles, ...parsed.keys()])

  // Build full row set first (no filtering yet — we need the unfiltered count
  // to decide whether to honor `vibe` filter against suggestedVibes too).
  const rows: AssetRow[] = []
  for (const filename of allFilenames) {
    const onDisk = imageFiles.includes(filename)
    const meta = parsed.get(filename)

    let sizeKB = 0
    let dims = ''
    let aspect = ''
    let mtimeIso = ''
    if (onDisk) {
      try {
        const st = await stat(join(sessionDir, filename))
        sizeKB = Math.round(st.size / 1024)
        mtimeIso = st.mtime.toISOString()
      } catch {
        // file vanished mid-scan; treat as broken
      }
      try {
        const m = await sharp(join(sessionDir, filename)).metadata()
        if (m.width && m.height) {
          dims = `${m.width}x${m.height}`
          aspect = reduceAspect(m.width, m.height)
        }
      } catch {
        // unreadable metadata — leave blank
      }
    }

    const status = (meta?.tag || (meta?.status ? meta.status.toUpperCase() : 'UNTAGGED'))
    rows.push({
      filename,
      status,
      broken: !onDisk,
      sizeKB,
      dimensions: dims,
      aspectRatio: aspect,
      mtime: mtimeIso,
      vibeUsage: usage.get(filename) || [],
      cdNote: oneLineCdNote(meta?.cdAnalysis),
    })
  }

  // Apply filters
  const filtered = rows.filter((r) => {
    if (filter.tag && r.status !== filter.tag) return false
    if (filter.vibe) {
      const want = filter.vibe.toLowerCase()
      // Match against vibeUsage labels (vibe-3:hero) OR meta suggestedVibes.
      const meta = parsed.get(r.filename)
      const inUsage = r.vibeUsage.some((u) => u.toLowerCase().startsWith(want))
      const inSuggested = meta?.suggestedVibes?.some((v) =>
        v.toLowerCase().includes(want),
      )
      if (!inUsage && !inSuggested) return false
    }
    if (typeof filter.broken === 'boolean' && r.broken !== filter.broken) return false
    if (typeof filter.usedIn === 'boolean') {
      const has = r.vibeUsage.length > 0
      if (filter.usedIn !== has) return false
    }
    return true
  })

  // Stable sort: on-disk first, then by mtime desc, then by filename.
  filtered.sort((a, b) => {
    if (a.broken !== b.broken) return a.broken ? 1 : -1
    if (a.mtime !== b.mtime) return a.mtime > b.mtime ? -1 : 1
    return a.filename.localeCompare(b.filename)
  })

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)
  const truncated = page.length < total

  return NextResponse.json({ assets: page, total, truncated })
}
