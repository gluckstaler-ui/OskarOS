// ==========================================
// Admin API: Session Detail
// GET /api/admin/sessions/[id]
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { readSessionUsage, formatCost, formatTokens } from '@/lib/usage-tracker'
import { matchField, matchFieldMultiline } from '@/lib/markdown-fields'
import { invalidateLinksCache } from '@/lib/crm-store'
import { humanizeSessionId } from '@/lib/session'

// ==========================================
// Types
// ==========================================

interface SessionDetail {
  id: string
  name: string
  phase: number
  phaseName: string
  lastUpdated: string
  files: FileInfo[]
  images: ImageInfo[]
  htmlFiles: HtmlFileInfo[]  // All HTML files in session
  workflow: WorkflowState
  vibes: VibeInfo[]
  tokenBurn: TokenBurn
  hasBridgeMapping: boolean  // true = BRIDGE.json exists, can --resume
  rawFiles: {
    session?: string
    images?: string
    build?: string
    brief?: string
  }
}

interface FileInfo {
  name: string
  type: 'md' | 'html' | 'image' | 'pdf' | 'json' | 'other'
  size: string
  modified: string
}

interface HtmlFileInfo {
  name: string
  path: string
  vibeIndex?: number
  vibeName?: string
  heroImage?: string   // Extracted from HTML file's hero section
  title?: string       // Extracted from HTML <title> tag
}

interface ImageInfo {
  filename: string
  path: string
  size: string
  usedIn?: string[]
  slot?: string
  status?: 'pending' | 'ready' | 'redo'
}

interface WorkflowState {
  imagesUploaded: boolean
  imagesAnalyzed: boolean
  discoveryComplete: boolean
  vibesDeveloped: number
}

interface VibeInfo {
  index: number
  name: string
  slug: string
  status: 'pending' | 'building' | 'complete' | 'selected'
  htmlPath?: string
  oneLiner?: string
  voice?: string
  whoFor?: string
  // NEW: Gallery-specific fields (short format for UI display)
  audience?: string   // Short brand persona for gallery card
  mood?: string       // 3-5 adjectives for gallery card
  colors?: { primary: string; secondary: string; accent: string; text: string }
  fonts?: { headings: string; body: string }
  heroImage?: string
}

interface TokenBurn {
  inputTokens: number
  outputTokens: number
  cost: string
  formatted: { input: string; output: string }
}

const PHASE_NAMES: Record<number, string> = {
  1: 'Discovery',
  2: 'Image Eval',
  3: 'Gen Vibes',
  4: 'User Select',
  5: 'Handoff',
  6: 'Archetype',
  7: 'Brief WD'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  try {
    const sessionPath = join(process.cwd(), 'public', sessionId)

    if (!existsSync(sessionPath)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // ==========================================
    // Get all files
    // ==========================================
    const fileNames = await readdir(sessionPath)
    const files: FileInfo[] = []
    const images: ImageInfo[] = []
    const htmlFiles: HtmlFileInfo[] = []

    for (const fileName of fileNames) {
      if (fileName.startsWith('.')) continue

      const filePath = join(sessionPath, fileName)
      const fileStat = await stat(filePath)

      if (!fileStat.isFile()) continue

      const ext = fileName.split('.').pop()?.toLowerCase() || ''
      let type: FileInfo['type'] = 'other'
      if (ext === 'md') type = 'md'
      else if (ext === 'html') type = 'html'
      // Ralph 2026-05-31 (weingut-barbazza session) · 'svg' added. The studio's
      // AssetsPanel rebuilds sourceImages from this response's `images[]` on
      // every page reload; without 'svg' here, uploaded SVGs (e.g. Logos-
      // Barbazza-*.svg, Plavac-Mali.svg) were classified as `type:'other'`,
      // excluded from `images[]`, and disappeared on refresh — even though
      // the upload handler accepted them and IMAGES.md had entries. The
      // "I saw them briefly" behavior was state from the upload's optimistic
      // setSourceImages, wiped on the next admin-route rehydration.
      // Browsers render SVG via <img> identically to raster, so no panel
      // changes are needed downstream. The lib/tool-executor.ts allowlist is
      // deliberately NOT extended — agents reading an .svg get the XML text
      // (more useful than a base64 mime-image of vector source).
      else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) type = 'image'
      // Ralph 2026-05-31 — 'pdf' added alongside 'svg' for the same reason: the
      // chat-paste path already accepts PDFs (uploadChatImages writes them to
      // the session folder) and the asset upload UIs now accept PDFs too, but
      // without a dedicated type they were lumped into 'other' and never
      // surfaced in the asset panel.
      else if (ext === 'pdf') type = 'pdf'
      else if (ext === 'json') type = 'json'

      files.push({
        name: fileName,
        type,
        size: formatFileSize(fileStat.size),
        modified: getRelativeTime(fileStat.mtime)
      })

      // Collect images - but skip generated images (pattern: {vibe}-{purpose}-v{n}-{timestamp}.jpg)
      // Generated images have format like: falcon-s-flight-sultan-action-v1-1769796516993.jpg
      //
      // Ralph 2026-05-31 — PDFs flow through this same array. They're not
      // raster/vector images, but the asset panel is functionally the "uploads"
      // surface, and we want the same drop/picker → tile experience parity. The
      // tile renderer detects .pdf and shows an icon tile (no broken <img>).
      // Generated-image filter is jpg/jpeg/png-only so PDFs sail past it.
      if (type === 'image' || type === 'pdf') {
        const isGeneratedImage = /^[a-z-]+-[a-z-]+-v\d+-\d+\.(jpg|jpeg|png)$/i.test(fileName)
        if (!isGeneratedImage) {
          images.push({
            filename: fileName,
            path: `/${sessionId}/${fileName}`,
            size: formatFileSize(fileStat.size)
          })
        }
      }

      // (HTML collection moved out of this flat top-level loop — see the
      // recursive walk after the loop. We need subdirectory HTML too.)
    }

    // ==========================================
    // Recursive HTML collection (subdirs included)
    // ==========================================
    // The flat readdir above only sees the session root. Director Mode wants
    // EVERY .html file in the session tree (mockups in subdirs, prototype
    // theme files, lazyblocks-migration HTML, etc.). Walk the tree and push
    // each one with a relative-path label so the picker can disambiguate
    // duplicates across subdirectories.
    async function walkHtml(dir: string, relPrefix: string): Promise<void> {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (entry.name === 'node_modules') continue
        const full = join(dir, entry.name)
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          await walkHtml(full, rel)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
          const vibeMatch = entry.name.match(/vibe-(\d+)-([^.]+)\.html/)

          // Read HTML to extract hero image + title (same heuristics as before)
          let heroImage: string | undefined
          let title: string | undefined
          try {
            const htmlContent = await readFile(full, 'utf-8')

            const titleMatch = htmlContent.match(/<title>([^<]*)<\/title>/i)
            if (titleMatch) {
              title = titleMatch[1].trim()
            }

            const heroUrlMatch = htmlContent.match(/\.hero\s*\{[^}]*url\(['"]?([^'")\s]+)['"]?\)/i)
              || htmlContent.match(/url\(['"]?([^'")\s]+)['"]?\)/)
            if (heroUrlMatch) {
              heroImage = `/${sessionId}/${heroUrlMatch[1]}`
            }
          } catch {
            // Ignore read errors
          }

          htmlFiles.push({
            name: rel,                      // include subdir in name so picker can disambiguate
            path: `/${sessionId}/${rel}`,   // public/ serves nested paths verbatim
            vibeIndex: vibeMatch ? parseInt(vibeMatch[1]) : undefined,
            vibeName: vibeMatch ? vibeMatch[2] : undefined,
            heroImage,
            title
          })
        }
      }
    }
    await walkHtml(sessionPath, '')

    // Sort files
    const typeOrder = { md: 0, html: 1, image: 2, json: 3, other: 4 }
    files.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])

    // ==========================================
    // Read raw file contents
    // ==========================================
    const rawFiles: SessionDetail['rawFiles'] = {}
    const sessionMdPath = join(sessionPath, 'SESSION.md')
    const imagesMdPath = join(sessionPath, 'IMAGES.md')
    const buildMdPath = join(sessionPath, 'BUILD.md')
    const briefPath = join(sessionPath, 'CREATIVE-BRIEF.md')

    let sessionContent = ''
    let briefContent = ''
    let buildContent = ''

    if (existsSync(sessionMdPath)) {
      try {
        sessionContent = await readFile(sessionMdPath, 'utf-8')
        rawFiles.session = sessionContent
      } catch {}
    }

    let imagesContent = ''
    if (existsSync(imagesMdPath)) {
      try {
        imagesContent = await readFile(imagesMdPath, 'utf-8')
        rawFiles.images = imagesContent
      } catch {}
    }

    if (existsSync(buildMdPath)) {
      try {
        buildContent = await readFile(buildMdPath, 'utf-8')
        rawFiles.build = buildContent
      } catch {}
    }

    const hasBrief = existsSync(briefPath)
    if (hasBrief) {
      try {
        briefContent = await readFile(briefPath, 'utf-8')
        rawFiles.brief = briefContent
      } catch {}
    }

    // Removed 2026-05-09:
    //   - parseVibesFromFiles + parseVibePreview population (block at ~298–407).
    //     admin.html only renders htmlPath, name, status, type — all derivable
    //     from htmlFiles[] (filename + content scrape). Parser-extracted
    //     audience/mood/colors/fonts/voice/whoFor were never rendered.
    //   - briefSummary {businessName, tagline, vibeCount, hasMenu, hasCharacters,
    //     recommendation}: built but consumed by zero callers (admin.html does
    //     not reference it; nothing else does either).
    //   - FalCaMel-keyword image-matching fallback: Potemkin that lied about
    //     hero images on non-FalCaMel sessions.
    // admin.html's existing `s.vibes || s.htmlFiles` fallback
    // (public/admin.html:572) handles the empty vibes[] via the htmlFiles-
    // derived block lower in this file.
    const vibes: VibeInfo[] = []

    // If no vibes from brief but HTML files exist, create vibes from HTML files
    if (vibes.length === 0 && htmlFiles.length > 0) {
      for (const html of htmlFiles) {
        vibes.push({
          index: html.vibeIndex || vibes.length + 1,
          name: html.vibeName || `Vibe ${html.vibeIndex}`,
          slug: html.vibeName || html.name.replace('.html', ''),
          status: 'complete',
          htmlPath: html.path,
          heroImage: images[0]?.path
        })
      }
    }

    // ==========================================
    // Detect Phase from content
    // ==========================================
    let phase = detectPhase(sessionContent, briefContent, vibes, images, htmlFiles, hasBrief)

    // Top-bar display name — deterministic from sessionId (Ralph 2026-06-01).
    // Was: regex-scan of SESSION.md / brief for `Business:` etc. That regex
    // got hijacked by CD's Confirm-Understanding cards which write a long
    // brand paragraph after `**Business:**`, producing a 500-char top-bar.
    // The sessionId IS the slug of the businessName by construction, so
    // reversing it is a pure transformation with no failure modes.
    const name = humanizeSessionId(sessionId)

    // ==========================================
    // Parse image usage from IMAGES.md
    // ==========================================
    if (imagesContent) {
      for (const img of images) {
        // Check vibe assignments
        const usedInVibes: string[] = []
        for (const vibe of vibes) {
          const vibeSection = imagesContent.match(new RegExp(`### Vibe:?\\s*${vibe.name}[\\s\\S]*?(?=### Vibe|$)`, 'i'))
          if (vibeSection && vibeSection[0].includes(img.filename)) {
            usedInVibes.push(vibe.name)
          }
        }
        img.usedIn = usedInVibes.length > 0 ? usedInVibes : undefined

        // Check slot
        const slotMatch = imagesContent.match(new RegExp(`${img.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^|]*\\|[^|]*\\|\\s*(hero|portrait|menu-bg|gallery|icon|background)`, 'i'))
        if (slotMatch) img.slot = slotMatch[1].toLowerCase()

        // Check status
        const imgLine = imagesContent.split('\n').find(l => l.includes(img.filename))
        if (imgLine) {
          if (imgLine.includes('✓') || imgLine.includes('ready')) img.status = 'ready'
          else if (imgLine.includes('✗') || imgLine.includes('redo')) img.status = 'redo'
          else img.status = 'pending'
        }
      }
    }

    // ==========================================
    // Build workflow state
    // ==========================================
    const workflow: WorkflowState = {
      imagesUploaded: images.length > 0,
      imagesAnalyzed: sessionContent.includes('Images analyzed') || sessionContent.includes('[x] Images analyzed'),
      discoveryComplete: sessionContent.includes('Discovery complete') || sessionContent.includes('[x] Discovery complete') || hasBrief,
      vibesDeveloped: vibes.filter(v => v.status === 'complete').length
    }

    // ==========================================
    // Get token usage
    // ==========================================
    const usage = await readSessionUsage(sessionId)
    const tokenBurn: TokenBurn = {
      inputTokens: usage.totals.inputTokens,
      outputTokens: usage.totals.outputTokens,
      cost: formatCost(usage.totals.cost),
      formatted: {
        input: formatTokens(usage.totals.inputTokens),
        output: formatTokens(usage.totals.outputTokens)
      }
    }

    // ==========================================
    // Get folder modified time
    // ==========================================
    const folderStat = await stat(sessionPath)
    const lastUpdated = getRelativeTime(folderStat.mtime)

    // Check if bridge mapping exists (for resume detection in frontend)
    const hasBridgeMapping = existsSync(join(sessionPath, 'logs', 'BRIDGE.json'))

    const sessionDetail: SessionDetail = {
      id: sessionId,
      name,
      phase,
      phaseName: PHASE_NAMES[phase] || 'Unknown',
      lastUpdated,
      files,
      images,
      htmlFiles,
      workflow,
      vibes,
      tokenBurn,
      rawFiles,
      hasBridgeMapping
    }

    return NextResponse.json(sessionDetail)

  } catch (error) {
    console.error(`[Admin] Failed to get session ${sessionId}:`, error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// ==========================================
// Detect Phase from Content
// ==========================================

function detectPhase(
  sessionContent: string,
  briefContent: string,
  vibes: VibeInfo[],
  images: ImageInfo[],
  htmlFiles: HtmlFileInfo[],
  hasBrief: boolean
): number {
  // Check for explicit phase in SESSION.md first
  const explicitPhase = sessionContent.match(/Status:\s*PHASE_(\d+)/i)
  if (explicitPhase) {
    return parseInt(explicitPhase[1])
  }

  const completeVibes = vibes.filter(v => v.status === 'complete').length
  const hasHtmlVibes = htmlFiles.length > 0
  const hasFinalHtml = htmlFiles.some(h => h.name.includes('final-'))

  // Check for actual selected vibe (not just template placeholder)
  const selectedVibeSection = briefContent.match(/## Selected Vibe\s*\n([\s\S]*?)(?=\n##|$)/i)
  const hasSelectedVibe = selectedVibeSection &&
    !selectedVibeSection[1].includes('pending') &&
    !selectedVibeSection[1].includes('To be') &&
    selectedVibeSection[1].trim().length > 20

  // Check for actual booking archetype content (not just template)
  const bookingSection = briefContent.match(/## Booking Archetype\s*\n([\s\S]*?)(?=\n##|$)/i)
  const hasBookingLogic = bookingSection &&
    !bookingSection[1].includes('To be') &&
    !bookingSection[1].includes('verified') &&
    bookingSection[1].trim().length > 30

  const hasVibesInBrief = vibes.length > 0

  // Phase 7: Final handoff complete
  if (hasFinalHtml && hasBookingLogic) return 7

  // Phase 6: Archetype/booking questions
  if (hasSelectedVibe && hasBookingLogic) return 6

  // Phase 5: Handoff (user selected, building final)
  if (hasSelectedVibe || hasFinalHtml) return 5

  // Phase 4: User selecting (all vibes built)
  if (hasHtmlVibes && completeVibes >= 4) return 4

  // Phase 3: Generating vibes (brief has vibes defined, or HTML exists)
  if (hasBrief && hasVibesInBrief) return 3
  if (hasHtmlVibes) return 3  // Any HTML files = at least Phase 3

  // Phase 2: Image evaluation (images exist but no substantive brief)
  if (images.length > 0 && (!hasBrief || !hasVibesInBrief)) return 2

  // Phase 1: Discovery
  return 1
}

function getRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  return date.toLocaleDateString()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}


// ─── WP-SESSION-DELETE (Ralph 2026-05-24) ─────────────────────────────
// Permanently removes the session folder + all content. Invalidates the
// CRM links cache because the deleted session may have carried a
// prospect_id that the kanban was rendering. UI confirms.
// ─────────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sessionPath = join(process.cwd(), 'public', id)
    if (!existsSync(sessionPath)) {
      return NextResponse.json({ error: `session ${id} not found` }, { status: 404 })
    }
    await rm(sessionPath, { recursive: true, force: true })
    invalidateLinksCache()
    return NextResponse.json({ removed: id })
  } catch (err) {
    console.error('[Sessions] DELETE failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
