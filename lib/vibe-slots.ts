/**
 * Vibe-Slot Mapping (WP-8, redesigned 2026-04-16 and widened 2026-04-17)
 *
 * Exposes a PAGE-centric view of the session for the "Assign to Vibe" drawer
 * and Director Mode iframe picker. Any HTML file with at least one <img> is a
 * swappable page — the old `data-slot` requirement was too restrictive (most
 * legacy vibes were generated before the contract existed).
 *
 * The shape:
 *   VibeGroup[]                 // one per vibe (or per standalone file)
 *     ├─ vibeKey                // e.g. "vibe-1"
 *     ├─ displayName            // "Vibe 1 — Grandma's Cliff"
 *     └─ pages: PageInfo[]      // hub first, then subpages
 *         ├─ filename
 *         ├─ displayName        // "Landing page" / "The Rooms"
 *         ├─ isHub
 *         ├─ parent             // parent filename if subpage
 *         └─ slots: SlotInfo[]
 *             ├─ slot            // "menu-bg"  or  "img:sultan.jpg"
 *             ├─ humanLabel      // "Menu background" / "Image 3"
 *             ├─ context         // "The Menu"  (nearest heading)
 *             ├─ currentImage    // src from HTML
 *             ├─ hasValidImage   // file exists on disk
 *             └─ isPlaceholder   // heuristic
 *
 * Slot identifiers come in two shapes:
 *   - `data-slot` name (legacy contract): "hero", "menu-bg", "gallery-3"
 *   - `img:<src>` (bare-image fallback):  "img:hero-night.jpeg"
 *     If the same src appears multiple times on a page, subsequent ones
 *     get a disambiguator: "img:hero-night.jpeg#2".
 *
 * Variant filtering: dropped 2026-04-17. All HTML files with any <img> tag
 * appear — including vibe-*-opus.html, vibe-*-sonnet.html, etc.
 *
 * Subpage detection priority:
 *   1. <meta name="parent" content="hub.html"> in the page's <head>
 *   2. [future] VIBE-N.md Site Structure declaration
 *   Otherwise: the page is a hub (top-level).
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises'
import path from 'path'
import { findAllSlots, inferSlotFromFilename } from './hot-swap'
import { updateBuildMd, formatLogTimestamp } from './session'

// ─────────────────────────────────────────────────────────────────────────────
// Types — the shape the drawer (and any future Studio picker) will consume.
// ─────────────────────────────────────────────────────────────────────────────

export interface SlotInfo {
  /** Raw slot name as written in HTML, e.g. "menu-bg" */
  slot: string
  /** Human-friendly label for the UI, e.g. "Menu background" */
  humanLabel: string
  /** Nearest heading text above the slot, e.g. "The Menu". null if none found. */
  context: string | null
  /** Current `src` value in the HTML */
  currentImage: string
  /** Whether `currentImage` resolves to a real file in the session folder */
  hasValidImage: boolean
  /** Heuristic: true if currentImage looks like a placeholder/empty */
  isPlaceholder: boolean
}

export interface PageInfo {
  /** HTML filename, e.g. "vibe-1-grandma-s-cliff.html" */
  filename: string
  /** Human name for the page, e.g. "Landing page", "The Rooms" */
  displayName: string
  /** True if this is the top-level page in its vibe (no parent) */
  isHub: boolean
  /** Parent page's filename if this is a subpage, else null */
  parent: string | null
  /** All assignable image slots found in the HTML */
  slots: SlotInfo[]
}

export interface VibeGroup {
  /** Canonical key for grouping pages — e.g. "vibe-1". Pages without a
   *  vibe-N prefix use their own filename as key (one-page group). */
  vibeKey: string
  /** Label for the group header, e.g. "Vibe 1 — Grandma's Cliff" */
  displayName: string
  /** Pages in this vibe. Hub always first (if detected); subpages after. */
  pages: PageInfo[]
}

// Back-compat alias (the old name) — kept so stale imports still compile.
export type VibeSlotGroup = VibeGroup

// ─────────────────────────────────────────────────────────────────────────────
// Slot → human label dictionary.
// Covers the common cases. Unknown slots fall back to title-cased slot name.
// ─────────────────────────────────────────────────────────────────────────────

const HUMAN_LABELS: Record<string, string> = {
  hero: 'Opening image',
  portrait: 'Portrait',
  'menu-bg': 'Menu background',
  'menu-background': 'Menu background',
  icon: 'Icon',
  about: 'About section',
  'about-bg': 'About background',
  'footer-bg': 'Footer background',
  background: 'Background',
  gallery: 'Gallery',
  logo: 'Logo',
  location: 'Location',
  'location-bg': 'Location background',
  testimonial: 'Testimonial',
  residents: 'Residents',
  'resident-1': 'First resident',
  'resident-2': 'Second resident',
  'resident-3': 'Third resident',
  booking: 'Booking section',
  'booking-bg': 'Booking background',
  cta: 'Call-to-action',
  'cta-bg': 'CTA background',
  hook: 'Hook section',
}

function humanLabelForSlot(slot: string): string {
  // Exact match
  if (HUMAN_LABELS[slot]) return HUMAN_LABELS[slot]
  // gallery-N → "Gallery image N"
  const galleryMatch = slot.match(/^gallery[-_]?(\d+)$/i)
  if (galleryMatch) return `Gallery image ${galleryMatch[1]}`
  // resident-N handled above for 1-3; fallback:
  const residentMatch = slot.match(/^resident[-_]?(\d+)$/i)
  if (residentMatch) return `Resident ${residentMatch[1]}`
  // Title-case fallback: "some-slot-name" → "Some slot name"
  return slot
    .split(/[-_]/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase()))
    .join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant detection — "canonical twin exists" rule (Ralph's adjustment).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a list of HTML filenames, return the set of variant files (to be
 * hidden from the drawer). A file F is a variant iff there exists another
 * file G in the list whose stem + "-" is a prefix of F's stem.
 *
 * Examples:
 *   ["vibe-1.html", "vibe-1-opus.html", "vibe-1-sonnet.html"]
 *     canonical: vibe-1.html
 *     variants : vibe-1-opus.html, vibe-1-sonnet.html
 *
 *   ["vibe-1-grandma-s-cliff-opus.html", "vibe-1-grandma-s-cliff-sonnet.html"]
 *     no canonical twin → all three are canonical (user's explicit intent)
 *
 *   ["vibe-2-decompression-chamber.html", "vibe-2-the-decompression-chamber.html"]
 *     neither is a strict dash-prefix of the other → both canonical
 */
function detectVariants(files: string[]): Set<string> {
  const variants = new Set<string>()
  const stems = files.map((f) => ({ file: f, stem: f.replace(/\.html$/i, '') }))

  for (const { file, stem } of stems) {
    for (const { file: otherFile, stem: otherStem } of stems) {
      if (file === otherFile) continue
      // Is `otherStem` a strict dash-bounded prefix of `stem`?
      if (stem.length > otherStem.length && stem.startsWith(otherStem + '-')) {
        variants.add(file)
        break
      }
    }
  }

  return variants
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical vibe-key derivation for grouping.
// "vibe-1-grandma-s-cliff.html" → "vibe-1"
// "falcon-s-flight-1769606308431.html" → filename (own group)
// ─────────────────────────────────────────────────────────────────────────────

function vibeKeyForFile(filename: string): string {
  const m = filename.match(/^(vibe-\d+)[-.]/i)
  return m ? m[1].toLowerCase() : filename.replace(/\.html$/i, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// Display names — for both vibe groups and individual pages.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull the display name for a vibe group. Priority:
 *   1. First VIBE-N.md file's `# VIBE N: "NAME"` heading
 *   2. Slug derived from first hub filename in the group
 */
async function loadVibeDisplayName(
  sessionPath: string,
  vibeKey: string,
  fallbackFilename: string
): Promise<string> {
  // Try VIBE-N.md — vibeKey is like "vibe-1"
  const match = vibeKey.match(/^vibe-(\d+)$/i)
  if (match) {
    const num = match[1]
    const mdPath = path.join(sessionPath, `VIBE-${num}.md`)
    try {
      const md = await readFile(mdPath, 'utf-8')
      // Matches: # VIBE 1: "GRANDMA'S CLIFF"   or   # VIBE 1: NAME
      const heading = md.match(/^#\s*VIBE\s+\d+\s*[:\-—]\s*"?([^"\n]+?)"?\s*$/im)
      if (heading) {
        return `Vibe ${num} — ${titleCase(heading[1].trim())}`
      }
    } catch {
      // VIBE-N.md not present — fall through
    }
    // Fallback: "Vibe N — <slug from filename>"
    return `Vibe ${num} — ${slugToTitle(stripVibePrefix(fallbackFilename))}`
  }

  // No vibe-N prefix — use humanized filename
  return slugToTitle(fallbackFilename.replace(/\.html$/i, ''))
}

/**
 * Display name for a single page. Priority:
 *   1. <title> content (strip any " — SiteName" suffix)
 *   2. First <h1>
 *   3. Humanized filename with vibe prefix stripped
 */
function derivePageDisplayName(filename: string, html: string): string {
  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    const raw = stripTags(titleMatch[1]).trim()
    if (raw) {
      // Often "Page Name — Site Name" — keep the first segment
      const first = raw.split(/\s+[—–|]\s+/)[0].trim()
      if (first) return first
    }
  }

  // <h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match) {
    const raw = stripTags(h1Match[1]).trim()
    if (raw) return raw
  }

  // Humanized filename
  return slugToTitle(stripVibePrefix(filename).replace(/\.html$/i, ''))
}

function stripVibePrefix(filename: string): string {
  return filename.replace(/^vibe-\d+[-.]?/i, '')
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/\.html$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => (w.length === 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/\bS\b/g, "'s") // "grandma s" → "grandma's"
    .trim()
}

function titleCase(s: string): string {
  // Preserve existing punctuation, just normalize caps
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w) => (w.trim() ? w[0].toUpperCase() + w.slice(1) : w))
    .join('')
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' '))
}

/** Decode the common named HTML entities we see in <title>/<h1> text.
 *  Not a full decoder — just enough for café, em-dashes, quotes. */
function decodeHtmlEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    eacute: 'é',
    Eacute: 'É',
    egrave: 'è',
    agrave: 'à',
    Agrave: 'À',
    ccedil: 'ç',
    Ccedil: 'Ç',
    uuml: 'ü',
    Uuml: 'Ü',
    ouml: 'ö',
    Ouml: 'Ö',
    auml: 'ä',
    Auml: 'Ä',
    szlig: 'ß',
    lsquo: '\u2018',
    rsquo: '\u2019',
    ldquo: '\u201C',
    rdquo: '\u201D',
  }
  return s
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
      if (body[0] === '#') {
        const isHex = body[1] === 'x' || body[1] === 'X'
        const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10)
        if (!Number.isNaN(code)) return String.fromCodePoint(code)
        return match
      }
      return named[body] !== undefined ? named[body] : match
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot context extraction — nearest heading / section label above the slot.
// Fallback chain per Ralph:
//   1. Nearest <h1>/<h2>/<h3> walking backwards from the slot
//   2. Nearest <section class="..."> or id="..." that's meaningful
//   3. null  (UI then shows just the human label alone)
// ─────────────────────────────────────────────────────────────────────────────

function findSlotContext(html: string, slotTagIndex: number): string | null {
  const before = html.slice(0, slotTagIndex)

  // Walk backwards: find the LAST heading match in `before`.
  const headingMatches = [...before.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
  if (headingMatches.length > 0) {
    const last = headingMatches[headingMatches.length - 1]
    const text = stripTags(last[1]).trim()
    if (text && text.length <= 80) return text
  }

  // Fallback: last <section class="..."> or id="..."
  const sectionMatches = [...before.matchAll(/<section[^>]*(?:class|id)="([^"]+)"[^>]*>/gi)]
  if (sectionMatches.length > 0) {
    const last = sectionMatches[sectionMatches.length - 1]
    // Take the first meaningful class/id token
    const token = last[1].split(/\s+/).find((t) => t && !/^[\d-]+$/.test(t))
    if (token) return slugToTitle(token) + ' section'
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse all slots in a single HTML file, with context + label metadata.
// ─────────────────────────────────────────────────────────────────────────────

async function extractSlotsWithMetadata(
  sessionPath: string,
  _filename: string,
  html: string
): Promise<SlotInfo[]> {
  // Match any <img ...> that contains data-slot=... — regardless of attribute order
  const imgTagPattern = /<img\b[^>]*data-slot="([^"]+)"[^>]*>/gi
  // Also catch src-before-data-slot shape
  const altImgPattern = /<img\b[^>]*data-slot='([^']+)'[^>]*>/gi
  // CSS comment pattern: /* data-slot: hero */ url('...')
  const cssPattern = /\/\*\s*data-slot:\s*([\w-]+)\s*\*\/[^)]*url\(['"]?([^'"\)\s]+)['"]?\)/gi
  // Any <img src="…"> — used for the bare-image fallback (post-redesign 2026-04-17)
  const bareImgPattern = /<img\b[^>]*>/gi

  const found: Array<{
    slot: string
    src: string
    tagIndex: number
    kind: 'data-slot' | 'bare-img'
  }> = []

  // 1. Marked <img data-slot="X" ... src="Y"> (double-quoted)
  let match: RegExpExecArray | null
  while ((match = imgTagPattern.exec(html)) !== null) {
    const tag = match[0]
    const slot = match[1]
    const srcMatch = tag.match(/\bsrc="([^"]+)"/i) || tag.match(/\bsrc='([^']+)'/i)
    if (srcMatch) {
      found.push({ slot, src: srcMatch[1], tagIndex: match.index, kind: 'data-slot' })
    }
  }
  // 2. Marked <img data-slot='X' ... src='Y'> (single-quoted data-slot)
  while ((match = altImgPattern.exec(html)) !== null) {
    const tag = match[0]
    const slot = match[1]
    const srcMatch = tag.match(/\bsrc="([^"]+)"/i) || tag.match(/\bsrc='([^']+)'/i)
    if (srcMatch && !found.find((f) => f.tagIndex === match!.index)) {
      found.push({ slot, src: srcMatch[1], tagIndex: match.index, kind: 'data-slot' })
    }
  }
  // 3. CSS background-image with /* data-slot: X */ marker
  while ((match = cssPattern.exec(html)) !== null) {
    found.push({
      slot: match[1],
      src: match[2],
      tagIndex: match.index,
      kind: 'data-slot',
    })
  }

  // 4 (renumbered). Bare-img fallback: every <img> that DOESN'T already have a data-slot
  //    becomes a swappable pseudo-slot keyed by `img:<src>`. This is what
  //    makes legacy vibe HTMLs (written before the data-slot contract existed)
  //    appear in the drawer and Director mode.
  const markedIndices = new Set(
    found.filter((f) => f.kind === 'data-slot').map((f) => f.tagIndex)
  )
  const markedSrcs = new Set(
    found.filter((f) => f.kind === 'data-slot').map((f) => f.src)
  )
  const bareSrcCounts = new Map<string, number>() // per-src occurrence index
  while ((match = bareImgPattern.exec(html)) !== null) {
    if (markedIndices.has(match.index)) continue // this <img> already has data-slot
    const tag = match[0]
    const srcMatch = tag.match(/\bsrc="([^"]+)"/i) || tag.match(/\bsrc='([^']+)'/i)
    if (!srcMatch) continue
    const src = srcMatch[1]
    if (!isSwappableSrc(src)) continue // skip data: URIs, absolute URLs, empty
    if (markedSrcs.has(src)) continue // already surfaced under its data-slot name

    const occ = (bareSrcCounts.get(src) || 0) + 1
    bareSrcCounts.set(src, occ)
    // Disambiguate multiple <img> with the same src on one page
    const slot = occ === 1 ? `img:${src}` : `img:${src}#${occ}`

    found.push({ slot, src, tagIndex: match.index, kind: 'bare-img' })
  }

  // 5. WP-10A: Background-image pseudo-slots — inline style + <style> blocks
  //    Each unique background-image URL becomes a `bgimg:<src>` slot.
  const bgInlinePattern = /style="[^"]*background-image:\s*url\(['"]?([^'")\s]+)['"]?\)[^"]*"/gi
  while ((match = bgInlinePattern.exec(html)) !== null) {
    const src = match[1]
    if (!isSwappableSrc(src)) continue
    if (markedSrcs.has(src)) continue
    const slot = `bgimg:${src}`
    if (!found.find((f) => f.slot === slot)) {
      found.push({ slot, src, tagIndex: match.index, kind: 'bare-img' })
    }
  }
  // Scan <style> blocks
  const styleBlockPattern = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let styleMatch: RegExpExecArray | null
  while ((styleMatch = styleBlockPattern.exec(html)) !== null) {
    const block = styleMatch[1]
    const blockStart = styleMatch.index + styleMatch[0].indexOf(block)
    let bgMatch: RegExpExecArray | null
    const localBgPattern = /background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi
    while ((bgMatch = localBgPattern.exec(block)) !== null) {
      const src = bgMatch[1]
      if (!isSwappableSrc(src)) continue
      if (markedSrcs.has(src)) continue
      const slot = `bgimg:${src}`
      if (!found.find((f) => f.slot === slot)) {
        found.push({ slot, src, tagIndex: blockStart + bgMatch.index, kind: 'bare-img' })
      }
    }
  }

  // De-duplicate by slot name (keep first occurrence for context lookup)
  const seen = new Set<string>()
  const unique = found
    .sort((a, b) => a.tagIndex - b.tagIndex) // stable document order
    .filter((f) => {
      if (seen.has(f.slot)) return false
      seen.add(f.slot)
      return true
    })

  // Running counter for humanLabel on bare-img entries (“Image 1”, “Image 2”…)
  let bareIndex = 0

  // Build SlotInfo[] with metadata
  const out: SlotInfo[] = []
  for (const f of unique) {
    const hasValidImage = await imageExists(sessionPath, f.src)
    let humanLabel: string
    if (f.slot.startsWith('bgimg:')) {
      // WP-10A: Distinct label for background-image slots
      const basename = f.src.split('/').pop() || f.src
      const truncated = basename.length > 28 ? basename.slice(0, 25) + '…' : basename
      humanLabel = `Background (${truncated})`
    } else if (f.kind === 'bare-img') {
      bareIndex += 1
      humanLabel = `Image ${bareIndex}`
    } else {
      humanLabel = humanLabelForSlot(f.slot)
    }
    out.push({
      slot: f.slot,
      humanLabel,
      context: findSlotContext(html, f.tagIndex),
      currentImage: f.src,
      hasValidImage,
      isPlaceholder: looksLikePlaceholder(f.src),
    })
  }

  return out
}

/**
 * Bare-img swap only makes sense for session-local, relative image paths.
 * Skip data URIs, remote URLs, and empty srcs — they can't be swapped by
 * filename and would create confusing picker entries.
 */
function isSwappableSrc(src: string): boolean {
  if (!src) return false
  if (/^data:/i.test(src)) return false
  if (/^https?:\/\//i.test(src)) return false
  if (/^\/\//.test(src)) return false // protocol-relative
  return true
}

function looksLikePlaceholder(src: string): boolean {
  if (!src) return true
  const name = src.toLowerCase()
  return (
    name.includes('placeholder') ||
    name === '' ||
    name.endsWith('/placeholder.jpg') ||
    name.endsWith('/placeholder.png')
  )
}

async function imageExists(sessionPath: string, src: string): Promise<boolean> {
  if (!src || /^https?:\/\//i.test(src) || /^data:/i.test(src)) return false
  // Resolve relative paths against the session folder
  const resolved = path.isAbsolute(src) ? src : path.join(sessionPath, src)
  try {
    const s = await stat(resolved)
    return s.isFile()
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent/hub detection — <meta name="parent" content="hub.html">.
// ─────────────────────────────────────────────────────────────────────────────

function parseParentMeta(html: string): string | null {
  const m = html.match(/<meta\s+name=["']parent["']\s+content=["']([^"']+)["']/i)
  if (m) return m[1].trim()
  // Also accept content-first ordering
  const m2 = html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']parent["']/i)
  if (m2) return m2[1].trim()
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point — build the page-centric VibeGroup[] map.
// ─────────────────────────────────────────────────────────────────────────────

export async function getVibeSlotMap(sessionId: string): Promise<VibeGroup[]> {
  const sessionPath = path.join(process.cwd(), 'public', sessionId)

  // Fall out early if session folder doesn't exist
  let allFiles: string[]
  try {
    allFiles = await readdir(sessionPath)
  } catch {
    return []
  }

  const htmlFiles = allFiles.filter((f) => f.toLowerCase().endsWith('.html'))

  // Step 1: read every .html once, keep only those with ≥ 1 assignable slot.
  // Files without slots (darth-reaper.html, admin pages, empty scaffolds)
  // can't be swap targets and shouldn't influence variant detection.
  type PageDraft = PageInfo & { vibeKey: string; html: string }
  const withSlots: PageDraft[] = []

  for (const filename of htmlFiles) {
    let html: string
    try {
      html = await readFile(path.join(sessionPath, filename), 'utf-8')
    } catch {
      continue
    }
    const slots = await extractSlotsWithMetadata(sessionPath, filename, html)
    if (slots.length === 0) continue // not an assignable page

    const parent = parseParentMeta(html)
    const vibeKey = vibeKeyForFile(filename)

    withSlots.push({
      filename,
      displayName: derivePageDisplayName(filename, html),
      isHub: !parent,
      parent, // resolved to valid filename in step 3
      slots,
      vibeKey,
      html,
    })
  }

  // Step 2: no variant filtering (dropped 2026-04-17 per Ralph).
  // Every slot-bearing file is shown. With the bare-img fallback in
  // `extractSlotsWithMetadata`, that now means every HTML that has at least
  // one <img> tag appears in the drawer — including experimental variants
  // (vibe-*-opus.html, vibe-*-sonnet.html, etc.).
  const drafts = withSlots

  // Resolve parent references against the full set
  const canonicalNames = new Set(drafts.map((d) => d.filename))
  for (const d of drafts) {
    if (d.parent && !canonicalNames.has(d.parent)) {
      d.parent = null
      d.isHub = true
    }
  }

  // Step 3: group by vibeKey, sort pages hub-first
  const byKey = new Map<string, PageDraft[]>()
  for (const d of drafts) {
    const list = byKey.get(d.vibeKey) || []
    list.push(d)
    byKey.set(d.vibeKey, list)
  }

  const groups: VibeGroup[] = []
  for (const [vibeKey, pages] of byKey.entries()) {
    // Hubs first, subpages after; stable by filename within each bucket
    pages.sort((a, b) => {
      if (a.isHub !== b.isHub) return a.isHub ? -1 : 1
      return a.filename.localeCompare(b.filename)
    })
    const firstFilename = pages[0].filename
    const displayName = await loadVibeDisplayName(sessionPath, vibeKey, firstFilename)
    groups.push({
      vibeKey,
      displayName,
      pages: pages.map(({ html: _h, vibeKey: _k, ...rest }) => rest),
    })
  }

  // Sort groups by vibe number when possible, else by displayName
  groups.sort((a, b) => {
    const na = parseInt(a.vibeKey.replace(/^vibe-/, ''), 10)
    const nb = parseInt(b.vibeKey.replace(/^vibe-/, ''), 10)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    if (!Number.isNaN(na)) return -1
    if (!Number.isNaN(nb)) return 1
    return a.displayName.localeCompare(b.displayName)
  })

  return groups
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot inference for auto hot-swap (unchanged, preserved for compatibility).
// ─────────────────────────────────────────────────────────────────────────────

export async function inferSlotForImage(
  sessionId: string,
  imageFilename: string,
  explicitPurpose?: string
): Promise<string | null> {
  if (explicitPurpose && explicitPurpose.trim()) {
    return explicitPurpose.trim()
  }
  const fromName = inferSlotFromFilename(imageFilename)
  if (fromName) {
    const allSlots = await findAllSlots(sessionId)
    if (allSlots.some((s) => s.slot === fromName)) return fromName
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Targeted per-page swap (used by the drawer and, in future, Studio Mode).
// Signature unchanged — assign-slot route still works as-is.
// ─────────────────────────────────────────────────────────────────────────────

export interface AssignResult {
  success: boolean
  oldImage?: string
  newImage: string
  vibe: string
  slot: string
  error?: string
}

export async function hotSwapToVibe(
  sessionId: string,
  vibeFile: string,
  slot: string,
  newImage: string
): Promise<AssignResult> {
  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const filePath = path.join(sessionPath, vibeFile)

  try {
    const html = await readFile(filePath, 'utf-8')
    const { swapped, oldImage, newHtml } = swapSingleFile(html, slot, newImage)

    if (!swapped) {
      return {
        success: false,
        newImage,
        vibe: vibeFile,
        slot,
        error: `Slot "${slot}" not found in ${vibeFile}`,
      }
    }

    await writeFile(filePath, newHtml)
    await logAssignToBuildMd(sessionId, vibeFile, slot, oldImage || '(none)', newImage)

    return {
      success: true,
      oldImage: oldImage || undefined,
      newImage,
      vibe: vibeFile,
      slot,
    }
  } catch (error) {
    return {
      success: false,
      newImage,
      vibe: vibeFile,
      slot,
      error: `Swap failed: ${error}`,
    }
  }
}

function swapSingleFile(
  html: string,
  slot: string,
  newImage: string
): { swapped: boolean; oldImage: string | null; newHtml: string } {
  // WP-10A: Background-image swap (slot format: "bgimg:<src>")
  if (slot.startsWith('bgimg:')) {
    return swapBgImage(html, slot, newImage)
  }
  // Bare-image fallback (slot format: "img:<src>" or "img:<src>#<n>")
  if (slot.startsWith('img:')) {
    return swapBareImage(html, slot, newImage)
  }

  let oldImage: string | null = null
  let swapped = false
  let out = html

  // Pattern 1: <img data-slot="X" ... src="Y">
  const p1 = new RegExp(
    `(<img[^>]*data-slot="${escapeRegex(slot)}"[^>]*src=")([^"]+)("[^>]*>)`,
    'gi'
  )
  out = out.replace(p1, (_m, prefix, currentSrc, suffix) => {
    oldImage = currentSrc
    swapped = true
    return `${prefix}${newImage}${suffix}`
  })

  // Pattern 2: <img src="Y" ... data-slot="X">
  if (!swapped) {
    const p2 = new RegExp(
      `(<img[^>]*src=")([^"]+)("[^>]*data-slot="${escapeRegex(slot)}"[^>]*>)`,
      'gi'
    )
    out = out.replace(p2, (_m, prefix, currentSrc, suffix) => {
      oldImage = currentSrc
      swapped = true
      return `${prefix}${newImage}${suffix}`
    })
  }

  // Pattern 3: /* data-slot: X */ url('Y')
  if (!swapped) {
    const p3 = new RegExp(
      `(\\/\\*\\s*data-slot:\\s*${escapeRegex(slot)}\\s*\\*\\/[^)]*url\\(['"]?)([^'"\\)\\s]+)(['"]?\\))`,
      'gi'
    )
    out = out.replace(p3, (_m, prefix, currentSrc, suffix) => {
      oldImage = currentSrc
      swapped = true
      return `${prefix}${newImage}${suffix}`
    })
  }

  return { swapped, oldImage, newHtml: out }
}

/**
 * Swap a bare <img src="…"> identified by its current src. Scoped to <img>
 * tags only (never touches CSS url() or other occurrences). When the same
 * src appears multiple times on the page, the slot carries a `#N` suffix
 * and we replace only the Nth occurrence.
 */
function swapBareImage(
  html: string,
  slot: string,
  newImage: string
): { swapped: boolean; oldImage: string | null; newHtml: string } {
  // Parse "img:<src>" or "img:<src>#<n>"
  const rest = slot.slice(4)
  const hashIdx = rest.lastIndexOf('#')
  let targetSrc = rest
  let targetOccurrence = 1
  if (hashIdx >= 0) {
    const maybeN = parseInt(rest.slice(hashIdx + 1), 10)
    if (!Number.isNaN(maybeN) && maybeN >= 1) {
      targetSrc = rest.slice(0, hashIdx)
      targetOccurrence = maybeN
    }
  }

  if (!targetSrc) {
    return { swapped: false, oldImage: null, newHtml: html }
  }

  // Match every HTML <img> tag AND every SVG <image> element. Both can
  // carry the slot's targetSrc — HTML uses `src="..."`, SVG uses `href="..."`
  // (or legacy `xlink:href="..."`). We only rewrite the URL of the one
  // whose value equals targetSrc — and only at the right occurrence index.
  //
  // Ralph 2026-05-02: SVG <image> support added. Files like
  // business-cards-grandma-20-schools.html embed photos as
  // <image href="..."/> inside SVG cards; the previous IMG-only regex made
  // those slots invisible to hot-swap (the Director Mode click sent
  // "img:foo.jpeg" but no <img src="foo.jpeg"> existed on the page).
  const imgTagPattern = /<(img|image)\b[^>]*>/gi
  let occ = 0
  let swapped = false
  let oldImage: string | null = null

  const newHtml = html.replace(imgTagPattern, (tag) => {
    const isSvgImage = /^<image\b/i.test(tag)
    // HTML <img> uses `src=`; SVG <image> uses `href=` or `xlink:href=`.
    let srcMatch: RegExpMatchArray | null = null
    let attrName = 'src'
    if (isSvgImage) {
      srcMatch =
        tag.match(/\bhref="([^"]+)"/i) ||
        tag.match(/\bhref='([^']+)'/i) ||
        tag.match(/\bxlink:href="([^"]+)"/i) ||
        tag.match(/\bxlink:href='([^']+)'/i)
      // Pick whichever attribute we matched against.
      if (srcMatch) {
        attrName = srcMatch[0].toLowerCase().startsWith('xlink:') ? 'xlink:href' : 'href'
      }
    } else {
      srcMatch = tag.match(/\bsrc="([^"]+)"/i) || tag.match(/\bsrc='([^']+)'/i)
      attrName = 'src'
    }
    if (!srcMatch) return tag
    if (srcMatch[1] !== targetSrc) return tag

    occ += 1
    if (occ !== targetOccurrence) return tag

    oldImage = srcMatch[1]
    swapped = true
    // Replace ONLY the matched attribute value, preserve quoting + everything else.
    //
    // Ralph 2026-04-26 BUG FIX: previous version passed the new value as a
    // STRING to .replace(), which interprets `$1`, `$&`, `$'`, `$\``, `$$`
    // as backreferences. If `newImage` ever contained a `$` (e.g. composed
    // CDN URLs, or future filename schemes), the swap would silently corrupt
    // the HTML. Using a callback function disables `$`-substitution.
    const quote = srcMatch[0].includes('"') ? '"' : "'"
    // Build the right attribute-replacement regex based on attrName.
    const attrPattern =
      attrName === 'xlink:href'
        ? /\bxlink:href=(["'])[^"']+\1/i
        : attrName === 'href'
        ? /\bhref=(["'])[^"']+\1/i
        : /\bsrc=(["'])[^"']+\1/i
    let updated = tag.replace(
      attrPattern,
      () => `${attrName}=${quote}${newImage}${quote}`,
    )
    // SVG <image> with both href + xlink:href — keep them in sync. If the
    // tag carried an xlink:href that we didn't match (because we matched
    // href first), update it too so legacy renderers stay consistent.
    if (isSvgImage && attrName === 'href' && /\bxlink:href=/i.test(updated)) {
      updated = updated.replace(
        /\bxlink:href=(["'])[^"']+\1/i,
        () => `xlink:href=${quote}${newImage}${quote}`,
      )
    }
    return updated
  })

  return { swapped, oldImage, newHtml }
}

/**
 * WP-10A: Swap a background-image URL in inline styles or <style> blocks.
 * Slot format: "bgimg:<src>" — replaces the first url() occurrence that
 * matches the source. Preserves quote style (single, double, or none).
 */
function swapBgImage(
  html: string,
  slot: string,
  newImage: string
): { swapped: boolean; oldImage: string | null; newHtml: string } {
  const targetSrc = slot.slice(6)
  if (!targetSrc) {
    return { swapped: false, oldImage: null, newHtml: html }
  }

  let swapped = false
  let oldImage: string | null = null

  // Match url('src'), url("src"), or url(src) — preserve quote style
  const escaped = escapeRegex(targetSrc)
  const urlPattern = new RegExp(
    `(url\\()(['"]?)(${escaped})(['"]?)(\\))`,
    'g'
  )

  const newHtml = html.replace(urlPattern, (full, prefix, q1, src, q2, suffix) => {
    if (swapped) return full // only replace first occurrence
    oldImage = src
    swapped = true
    return `${prefix}${q1}${newImage}${q2}${suffix}`
  })

  return { swapped, oldImage, newHtml }
}

/** Escape a string for safe inclusion in a RegExp source. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function logAssignToBuildMd(
  sessionId: string,
  vibe: string,
  slot: string,
  oldImage: string,
  newImage: string
): Promise<void> {
  try {
    const sessionPath = path.join(process.cwd(), 'public', sessionId)
    const buildMdPath = path.join(sessionPath, 'BUILD.md')
    const buildMd = await readFile(buildMdPath, 'utf-8')
    const timestamp = formatLogTimestamp()
    const vibeName = vibe.replace(/^vibe-/, '').replace(/\.html$/, '')
    const newRow = `\n| ${timestamp} | ${vibeName} | ${slot} | ${oldImage} | ${newImage} |`

    const logSection = buildMd.match(
      /(## Hot-Swap Log[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|)/m
    )
    if (logSection) {
      const newContent = buildMd.replace(logSection[0], logSection[0] + newRow)
      await updateBuildMd(sessionId, newContent)
    }
  } catch (err) {
    console.error('[vibe-slots] logAssignToBuildMd failed:', err)
  }
}
