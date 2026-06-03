import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { matchField } from '@/lib/markdown-fields'

/**
 * GET /api/sessions/[id]/gallery
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WP-78 implementation (Ralph 2026-05-12 — full rewrite from spec).
 * Doctrine source: docs/Feature-X.md §18.3 lines 2993-3210.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * **Every HTML becomes a card.** Sidecar `.md` files are best-effort
 * enrichment, hunted by name per HTML — not enumerated and bucketed.
 *
 * Algorithm (spec lines 3043-3169):
 *   1. RECURSIVE readdir of public/{sessionId}/
 *   2. Build filesByPath + filesByBase lookup maps over the full tree
 *   3. Filter to .html files (the ONLY gate)
 *   4. CLASSIFY filename via /^vibe-(\d+)(?:-(.+?))?(?:-v(\d+))?\.html$/i
 *      — matches → vibeIndex/slug/version captured.
 *      — no match → vibeIndex=null, slug=stem (non-vibe HTML, still a card).
 *   5. Hunt sidecar 3 tiers:
 *      - Tier 0 (exact-name, ALL HTMLs)
 *      - Tier 1 (slug-suffixed, vibe-shaped only)
 *      - Tier 2 (canonical vibe-N.md, vibe-shaped only)
 *      Hunt order per tier: session root → HTML's own dir → any subfolder.
 *   6. Read sidecar (whole file) and parse via matchField. Gallery Card
 *      block + Meta block + body prose are all in scope. Gallery Card's
 *      7 canonical fields win for fields it owns (Name, One-liner,
 *      Audience, Mood, Colors, Fonts, Hero) because matchField returns
 *      the FIRST occurrence top-to-bottom and CD writes Gallery Card
 *      before Meta. Voice + alternates ("Hero Image", "Who it's for") +
 *      per-line color/font fallbacks (Primary:/Headings:/Body:) are
 *      caught from Meta-and-below. `colorNames` is parsed in parallel
 *      with `colors` from `Colors: #hex (Friendly Name), ...` lines —
 *      the UI uses the friendly name as the swatch headline.
 *   7. Hero resolution chain — sidecar Hero → HTML scrape. If neither
 *      surfaces an image, `heroImage = null`. The endpoint surfaces TRUTH:
 *      if the card has no hero, it has no hero. The "every sidecar must
 *      declare Hero" rule is enforced upstream (sidecar backfill + Gallery
 *      Card schema), NOT by fabricating images here. (Ralph 2026-05-12:
 *      earlier spec said `heroImage: string` with a session-folder
 *      fallback chain — that fallback was Potemkin and is stripped.
 *      Cards without heroes render blank in the UI.)
 *   8. Sort: vibe-N (vibeIndex asc, version asc, mtime desc); non-vibe
 *      by mtime desc, appended.
 *
 * Earlier implementation (2026-05-09, retired): treated the vibe-regex
 * as a GATEKEEPER and used a flat readdir. Result: silently dropped
 * every subfolder HTML, every vibe-x- artifact, every business-cards
 * / brand-cards / design-system / decree page, every slugless
 * vibe-9.html, every keynote deck.html in falcamel/cliff-ledger/.
 * That implementation was ~25% of the spec wearing the WP-78 label.
 */

interface GalleryCard {
  filename: string
  htmlPath: string
  parentDir: string | null
  vibeIndex: number | null
  version: number
  slug: string
  name: string
  mtime: string
  size: number
  heroImage: string | null
  oneLiner?: string
  audience?: string
  mood?: string
  colors?: { primary?: string; secondary?: string; accent?: string; text?: string }
  /**
   * Friendly color names parsed from `Colors: #hex (Name), ...` lines.
   * Aligned by key with `colors` (primary/secondary/accent/text). The UI
   * renders the name as the swatch headline with hex as a subhead.
   */
  colorNames?: { primary?: string; secondary?: string; accent?: string; text?: string }
  fonts?: { heading?: string; body?: string }
  hasSidecar: boolean
  hasGalleryCard: boolean
  sidecarPath?: string
}

interface GalleryResponse {
  sessionId: string
  cards: GalleryCard[]
  generatedAt: string
}

// Filename classifier — vibe-shape detection. NEVER a gatekeeper.
// Slug is OPTIONAL (covers slugless `vibe-9.html`). vibe-x- and other
// non-numeric prefixes fall through to the non-vibe path naturally.
const VIBE_HTML_RE = /^vibe-(\d+)(?:-(.+?))?(?:-v(\d+))?\.html$/i

// ─── walk recursively, return session-relative POSIX-style paths ────────
async function walkDir(root: string, sub: string = ''): Promise<string[]> {
  const dirPath = sub ? join(root, sub) : root
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
  const results: string[] = []
  for (const e of entries) {
    // Skip dot-dirs (.git, .DS_Store-ish) — session folders don't use them.
    const name = String(e.name)
    if (name.startsWith('.')) continue
    const rel = sub ? `${sub}/${name}` : name
    if (e.isDirectory()) {
      const nested = await walkDir(root, rel)
      results.push(...nested)
    } else if (e.isFile()) {
      results.push(rel)
    }
  }
  return results
}

// ─── concurrency limiter (avoids FD exhaustion on 200+ HTML sessions) ───
function createLimit(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []
  async function run<R>(fn: () => Promise<R>): Promise<R> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active++
    try {
      return await fn()
    } finally {
      active--
      const next = queue.shift()
      if (next) next()
    }
  }
  return run
}

function titleCase(s: string): string {
  return s
    .split(/[-_/]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ─── sidecar hunt (spec lines 3072-3110) ────────────────────────────────
function lookupByName(
  name: string,
  htmlRelPath: string,
  filesByPath: Map<string, string>,
  filesByBase: Map<string, string[]>,
): string | null {
  const lname = name.toLowerCase()
  // 1. Session root
  if (filesByPath.has(lname)) return filesByPath.get(lname)!
  // 2. HTML's own directory
  const htmlDir = dirname(htmlRelPath)
  if (htmlDir && htmlDir !== '.') {
    const inHtmlDir = `${htmlDir}/${name}`.toLowerCase()
    if (filesByPath.has(inHtmlDir)) return filesByPath.get(inHtmlDir)!
  }
  // 3. Any subfolder — basename match anywhere; alphabetical path order
  const candidates = filesByBase.get(lname) ?? []
  if (candidates.length > 0) return [...candidates].sort()[0]
  return null
}

function huntSidecar(
  htmlRelPath: string,
  vibeIndex: number | null,
  slug: string,
  filesByPath: Map<string, string>,
  filesByBase: Map<string, string[]>,
): string | null {
  // Tier 0 — exact-name match. Works for ALL HTMLs including non-vibe
  // shapes (business-cards-*, design-system pages, decree pages, deck.html
  // keynote decks in subfolders, etc.).
  const exactName = basename(htmlRelPath).replace(/\.html$/i, '.md')
  const t0 = lookupByName(exactName, htmlRelPath, filesByPath, filesByBase)
  if (t0) return t0

  if (vibeIndex == null) return null

  // Tier 1 — slug-suffixed (e.g. vibe-8-pentagram.md for vibe-8-pentagram.html).
  if (slug) {
    const suffixed = `vibe-${vibeIndex}-${slug}.md`
    const t1 = lookupByName(suffixed, htmlRelPath, filesByPath, filesByBase)
    if (t1) return t1
  }

  // Tier 2 — canonical (vibe-N.md). Covers model-variant HTMLs that
  // all share one sidecar, and slugless vibe-N.html.
  const canonical = `vibe-${vibeIndex}.md`
  return lookupByName(canonical, htmlRelPath, filesByPath, filesByBase)
}

interface SidecarFields {
  name?: string
  oneLiner?: string
  audience?: string
  mood?: string
  heroField?: string
  colors?: GalleryCard['colors']
  colorNames?: GalleryCard['colorNames']
  fonts?: GalleryCard['fonts']
  hasGalleryCardBlock: boolean
}

/**
 * Parse the WHOLE sidecar — Gallery Card block + Meta blocks + body prose.
 *
 * Why not block-only:
 *   - The Gallery Card schema's 7 fixed fields (Name, One-liner, Audience,
 *     Mood, Colors, Fonts, Hero) live in the block.
 *   - BUT Voice, alternate Audience phrasing ("Who it's for"), alternate
 *     Hero phrasing ("Hero Image"), and per-line Color/Font overrides
 *     (Primary:/Secondary:/Headings:/Body:) often live in the Meta block
 *     below. The UI displays Voice and those richer color names.
 *
 * `matchField` finds the FIRST occurrence top-to-bottom. Because CD writes
 * `## Gallery Card` BEFORE `## Meta`, the Gallery Card values win for the
 * 7 canonical fields. Voice (not in the locked schema) falls through to
 * the Meta block where it lives.
 *
 * Length guard on Headings:/Body: per-line fallback — sidecars routinely
 * contain a `**Body:**` markdown section with prose. Without the < 80
 * char cap a paragraph would land as the body-font name.
 */
function parseSidecar(content: string): SidecarFields {
  const out: SidecarFields = {
    hasGalleryCardBlock: /^##\s+Gallery Card\s*$/m.test(content),
  }

  const name = matchField(content, 'Name')
  if (name) out.name = name

  const oneLiner = matchField(content, 'One-liner')
  if (oneLiner) out.oneLiner = oneLiner

  // Hero — Gallery Card schema uses `Hero:`; older brief style uses
  // `Hero Image:`. Strip backticks/quotes from table-cell forms.
  const heroField = matchField(content, 'Hero') || matchField(content, 'Hero Image')
  if (heroField) {
    const cleaned = heroField.trim().replace(/^[`"']|[`"']$/g, '').trim()
    if (cleaned && !/^(TBD|None|N\/A|-)$/i.test(cleaned)) {
      out.heroField = cleaned
    }
  }

  // Audience — two field-name conventions in the wild ("Audience" /
  // "Who it's for"). Also accepts "Voice" as a legacy alias: older
  // sidecars wrote audience-shape content under `Voice:`; the locked
  // Gallery Card schema renamed it to `Audience` (Ralph 2026-05-12 —
  // they're the same field, different names across schema versions).
  // 90-char word-boundary truncation for UI density — gallery cards
  // show a caption, not the full demographic profile.
  const audienceRaw =
    matchField(content, 'Audience') ||
    matchField(content, "Who it's for") ||
    matchField(content, 'Voice')
  if (audienceRaw) {
    out.audience = audienceRaw.length > 90
      ? audienceRaw.slice(0, 90).replace(/\s+\S*$/, '') + '…'
      : audienceRaw
  }

  const mood = matchField(content, 'Mood')
  if (mood) out.mood = mood

  // Colors — try single-line `Colors: #hex (Name), #hex (Name), ...` first,
  // then per-line `Primary:/Secondary:/Accent:/Text:`. The Gallery Card
  // convention bundles hex AND friendly name in parens; split into a
  // `colors` map (hex) and parallel `colorNames` map (display label) so
  // the UI can render the name prominently with hex as a subhead.
  const colorsLine = matchField(content, 'Colors')
  const colors: GalleryCard['colors'] = {}
  const colorNames: NonNullable<GalleryCard['colorNames']> = {}
  if (colorsLine) {
    const pairRe = /(#[A-Fa-f0-9]{6})\s*(?:\(\s*([^)]+?)\s*\))?/g
    const slots: ('primary' | 'secondary' | 'accent' | 'text')[] = [
      'primary',
      'secondary',
      'accent',
      'text',
    ]
    let i = 0
    let m: RegExpExecArray | null
    while ((m = pairRe.exec(colorsLine)) && i < slots.length) {
      const slot = slots[i++]
      colors[slot] = m[1]
      if (m[2]) colorNames[slot] = m[2]
    }
  }
  // Per-line overrides (win when present — older sessions sometimes have
  // stale single-line + correct per-line).
  const perLineRe = (label: string) =>
    new RegExp(
      `^\\s*(?:\\*+\\s*)?${label}(?:\\s*\\*+)?:\\s*\`?(#[A-Fa-f0-9]{6})\`?(?:\\s*\\(\\s*([^)]+?)\\s*\\))?`,
      'im',
    )
  for (const slot of ['primary', 'secondary', 'accent', 'text'] as const) {
    const label = slot.charAt(0).toUpperCase() + slot.slice(1)
    const lm = content.match(perLineRe(label))
    if (lm) {
      colors[slot] = lm[1]
      if (lm[2]) colorNames[slot] = lm[2]
    }
  }
  if (Object.keys(colors).length > 0) out.colors = colors
  if (Object.keys(colorNames).length > 0) out.colorNames = colorNames

  // Fonts — single-line `Fonts: Heading / Body / Mono` (modern Gallery Card)
  // is the canonical form. Per-line `Headings:` / `Body:` is the older
  // brief style — only fall through to it when the single-line form is
  // absent. The `< 80` char guard prevents a mistakenly-matched prose
  // `**Body:**` paragraph from polluting the body-font name.
  const fonts: GalleryCard['fonts'] = {}
  const fontsLine = matchField(content, 'Fonts')
  if (fontsLine) {
    const parts = fontsLine.split('/').map((s) => s.trim()).filter(Boolean)
    if (parts[0]) fonts.heading = parts[0]
    if (parts[1]) fonts.body = parts[1]
  } else {
    const headingsField = matchField(content, 'Headings')
    if (headingsField && headingsField.length < 80) fonts.heading = headingsField
    const bodyField = matchField(content, 'Body')
    if (bodyField && bodyField.length < 80) fonts.body = bodyField
  }
  if (Object.keys(fonts).length > 0) out.fonts = fonts

  return out
}

// ─── hero path resolution (spec lines 3128-3137) ────────────────────────
function resolveHeroPath(
  raw: string,
  sessionId: string,
  htmlDir: string,
  filesByPath: Map<string, string>,
  filesByBase: Map<string, string[]>,
): string | null {
  const v = raw.trim()
  if (!v) return null
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return v
  if (v.startsWith('/')) return v

  // Strip leading "./" — then any `..` segment rejects (no parent escape).
  const cleaned = v.replace(/^\.\/?/, '')
  if (cleaned.split('/').some((seg) => seg === '..')) return null

  // 1. Resolve relative to HTML's own dir
  if (htmlDir && htmlDir !== '.') {
    const inHtmlDir = `${htmlDir}/${cleaned}`.toLowerCase()
    const actual = filesByPath.get(inHtmlDir)
    if (actual) return `/${sessionId}/${encodeURI(actual)}`
  }
  // 2. Resolve relative to session root
  const atRoot = filesByPath.get(cleaned.toLowerCase())
  if (atRoot) return `/${sessionId}/${encodeURI(atRoot)}`
  // 3. Basename anywhere
  const baseHits = filesByBase.get(basename(cleaned).toLowerCase())
  if (baseHits && baseHits.length > 0) {
    return `/${sessionId}/${encodeURI([...baseHits].sort()[0])}`
  }
  return null
}

// ─── HTML hero scrape (spec step 7) ─────────────────────────────────────
function extractHeroFromHtml(
  html: string,
  sessionId: string,
  htmlDir: string,
  filesByPath: Map<string, string>,
  filesByBase: Map<string, string[]>,
): string | null {
  const snippet = html.slice(0, 32 * 1024)
  const resolve = (src: string) =>
    resolveHeroPath(src, sessionId, htmlDir, filesByPath, filesByBase)

  // 1. CSS `.hero { background: url(...) }` block
  const heroBlock = snippet.match(/\.hero\s*\{[^}]*\}/i)
  if (heroBlock) {
    const urlMatch = heroBlock[0].match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i)
    if (urlMatch) {
      const r = resolve(urlMatch[1])
      if (r) return r
    }
  }

  // 2. `<img class="hero">` (class in either position)
  const imgHeroClass = snippet.match(
    /<img\b[^>]*class\s*=\s*["'][^"']*\bhero\b[^"']*["'][^>]*>/i,
  )
  if (imgHeroClass) {
    const srcMatch = imgHeroClass[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)
    if (srcMatch) {
      const r = resolve(srcMatch[1])
      if (r) return r
    }
  }

  // 3. First `<img>` inside hero-shaped container
  const heroContainer =
    snippet.match(
      /<(?:section|div)\b[^>]*class\s*=\s*["'][^"']*\bhero\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div)>/i,
    ) || snippet.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)
  if (heroContainer) {
    const img = heroContainer[1].match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
    if (img) {
      const r = resolve(img[1])
      if (r) return r
    }
  }

  // 4. First `<img>` anywhere
  const anyImg = snippet.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
  if (anyImg) {
    const r = resolve(anyImg[1])
    if (r) return r
  }

  return null
}

// ─── handler ────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<GalleryResponse | { error: string }>> {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    const sessionPath = join(process.cwd(), 'public', sessionId)

    // ── Step 1: recursive walk ─────────────────────────────────────────
    let allFiles: string[]
    try {
      allFiles = await walkDir(sessionPath)
    } catch {
      return NextResponse.json({
        sessionId,
        cards: [],
        generatedAt: new Date().toISOString(),
      })
    }

    if (allFiles.length === 0) {
      return NextResponse.json({
        sessionId,
        cards: [],
        generatedAt: new Date().toISOString(),
      })
    }

    // ── Step 2: lookup maps ────────────────────────────────────────────
    const filesByPath = new Map<string, string>()
    const filesByBase = new Map<string, string[]>()
    for (const f of allFiles) {
      filesByPath.set(f.toLowerCase(), f)
      const base = basename(f).toLowerCase()
      const list = filesByBase.get(base) ?? []
      list.push(f)
      filesByBase.set(base, list)
    }

    // ── Step 3: filter to .html (the ONLY gate) ─────────────────────────
    const htmlFiles = allFiles.filter((f) => /\.html$/i.test(f))

    // ── Step 4: classify each filename ─────────────────────────────────
    interface HtmlMeta {
      file: string
      vibeIndex: number | null
      slug: string
      version: number
    }
    const htmlMetas: HtmlMeta[] = htmlFiles.map((f) => {
      const bn = basename(f)
      const m = bn.match(VIBE_HTML_RE)
      if (m) {
        return {
          file: f,
          vibeIndex: parseInt(m[1], 10),
          slug: m[2] || '',
          version: m[3] ? parseInt(m[3], 10) : 1,
        }
      }
      return {
        file: f,
        vibeIndex: null,
        slug: bn.replace(/\.html$/i, ''),
        version: 1,
      }
    })

    // ── Step 5-7: per-HTML pass (concurrency 16) ──────────────────────
    const limit = createLimit(16)
    const sidecarCache = new Map<string, SidecarFields | null>()

    interface PassResult {
      meta: HtmlMeta
      sidecarPath: string | null
      fields: SidecarFields | null
      heroImage: string | null
      mtime: string
      size: number
    }

    const pass1: PassResult[] = await Promise.all(
      htmlMetas.map((meta) =>
        limit(async () => {
          // Step 5: hunt sidecar
          const sidecarPath = huntSidecar(
            meta.file,
            meta.vibeIndex,
            meta.slug,
            filesByPath,
            filesByBase,
          )

          // Step 6: read + parse whole sidecar (cached per-sidecar so the
          // 5 model-variant HTMLs that share VIBE-1.md don't read it 5×).
          let fields: SidecarFields | null = null
          if (sidecarPath) {
            if (sidecarCache.has(sidecarPath)) {
              fields = sidecarCache.get(sidecarPath)!
            } else {
              const content = await readFile(
                join(sessionPath, sidecarPath),
                'utf-8',
              ).catch(() => null)
              fields = content ? parseSidecar(content) : null
              sidecarCache.set(sidecarPath, fields)
            }
          }

          // Step 6/7: hero — sidecar Hero first, then HTML scrape.
          // If neither, heroImage = null (UI shows blank slot; no Potemkin).
          const htmlDir = dirname(meta.file)
          let heroImage: string | null = null

          if (fields?.heroField) {
            heroImage = resolveHeroPath(
              fields.heroField,
              sessionId,
              htmlDir,
              filesByPath,
              filesByBase,
            )
          }

          if (!heroImage) {
            const html = await readFile(
              join(sessionPath, meta.file),
              'utf-8',
            ).catch(() => '')
            if (html) {
              heroImage = extractHeroFromHtml(
                html,
                sessionId,
                htmlDir,
                filesByPath,
                filesByBase,
              )
            }
          }

          const st = await stat(join(sessionPath, meta.file)).catch(() => null)

          return {
            meta,
            sidecarPath,
            fields,
            heroImage,
            mtime: (st?.mtime ?? new Date()).toISOString(),
            size: st?.size ?? 0,
          }
        }),
      ),
    )

    // ── Step 8: card assembly ──────────────────────────────────────────
    // Hero is either declared (sidecar) or scraped (HTML). If neither
    // surfaces an image, heroImage stays null and the UI renders a blank
    // hero slot — no Potemkin fallbacks. (Ralph 2026-05-12.)
    const cards: GalleryCard[] = pass1.map((r) => {
      const heroImage = r.heroImage  // already string | null from pass 1

      const htmlBase = basename(r.meta.file)
      const stem = htmlBase.replace(/\.html$/i, '')
      const name =
        r.fields?.name?.trim() ||
        (r.meta.slug ? titleCase(r.meta.slug) : titleCase(stem))

      const htmlDir = dirname(r.meta.file)
      const parentDir = htmlDir === '.' || !htmlDir ? null : htmlDir

      const card: GalleryCard = {
        filename: htmlBase,
        htmlPath: `/${sessionId}/${encodeURI(r.meta.file)}`,
        parentDir,
        vibeIndex: r.meta.vibeIndex,
        version: r.meta.version,
        slug: r.meta.slug,
        name,
        mtime: r.mtime,
        size: r.size,
        heroImage,
        hasSidecar: !!r.sidecarPath,
        hasGalleryCard: !!r.fields?.hasGalleryCardBlock,
      }

      if (r.fields?.oneLiner) card.oneLiner = r.fields.oneLiner
      if (r.fields?.audience) card.audience = r.fields.audience
      if (r.fields?.mood) card.mood = r.fields.mood
      if (r.fields?.colors) card.colors = r.fields.colors
      if (r.fields?.colorNames) card.colorNames = r.fields.colorNames
      if (r.fields?.fonts) card.fonts = r.fields.fonts
      if (r.sidecarPath) card.sidecarPath = r.sidecarPath

      return card
    })

    // ── Step 10: sort ──────────────────────────────────────────────────
    cards.sort((a, b) => {
      // Vibe-N cards group first
      if (a.vibeIndex != null && b.vibeIndex == null) return -1
      if (a.vibeIndex == null && b.vibeIndex != null) return 1
      if (a.vibeIndex != null && b.vibeIndex != null) {
        if (a.vibeIndex !== b.vibeIndex) return a.vibeIndex - b.vibeIndex
        if (a.version !== b.version) return a.version - b.version
        return b.mtime.localeCompare(a.mtime)
      }
      // Non-vibe: mtime desc
      return b.mtime.localeCompare(a.mtime)
    })

    return NextResponse.json(
      {
        sessionId,
        cards,
        generatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    )
  } catch (err) {
    console.error('[gallery] Failed to build gallery response:', err)
    return NextResponse.json(
      { error: 'Failed to build gallery response' },
      { status: 500 },
    )
  }
}
