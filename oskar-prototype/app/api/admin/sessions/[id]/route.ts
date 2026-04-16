// ==========================================
// Admin API: Session Detail
// GET /api/admin/sessions/[id]
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { readSessionUsage, formatCost, formatTokens } from '@/lib/usage-tracker'
import { parseVibesFromFiles, parseVibePreview } from '@/lib/creative-brief-parser'

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
  agents: AgentInfo[]
  imagePrompts: ImagePrompt[]  // Parsed from IMAGES.md Reprompt fields
  briefSummary?: BriefSummary
  tokenBurn: TokenBurn
  hasBridgeMapping: boolean  // true = BRIDGE.json exists, can --resume
  rawFiles: {
    session?: string
    images?: string
    build?: string
    brief?: string
  }
}

interface ImagePrompt {
  name: string        // Image filename
  prompt: string      // The reprompt text
  aspectRatio?: string
  status: 'pending' | 'approved' | 'generated'
  analysis?: string   // CD Analysis
  suggestedUses?: string
  suggestedVibes?: string
}

interface FileInfo {
  name: string
  type: 'md' | 'html' | 'image' | 'json' | 'other'
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

interface AgentInfo {
  name: string
  status: 'active' | 'building' | 'generating' | 'waiting' | 'idle'
  task?: string
}

interface BriefSummary {
  businessName?: string
  tagline?: string
  vibeCount: number
  hasMenu: boolean
  hasCharacters: boolean
  recommendation?: string
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
      else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image'
      else if (ext === 'json') type = 'json'

      files.push({
        name: fileName,
        type,
        size: formatFileSize(fileStat.size),
        modified: getRelativeTime(fileStat.mtime)
      })

      // Collect images - but skip generated images (pattern: {vibe}-{purpose}-v{n}-{timestamp}.jpg)
      // Generated images have format like: falcon-s-flight-sultan-action-v1-1769796516993.jpg
      if (type === 'image') {
        const isGeneratedImage = /^[a-z-]+-[a-z-]+-v\d+-\d+\.(jpg|jpeg|png)$/i.test(fileName)
        if (!isGeneratedImage) {
          images.push({
            filename: fileName,
            path: `/${sessionId}/${fileName}`,
            size: formatFileSize(fileStat.size)
          })
        }
      }

      // Collect ALL HTML files and extract hero image + title from each
      if (type === 'html') {
        const vibeMatch = fileName.match(/vibe-(\d+)-([^.]+)\.html/)

        // Read HTML file to extract hero image and title
        let heroImage: string | undefined
        let title: string | undefined
        try {
          const htmlContent = await readFile(filePath, 'utf-8')

          // Extract title from <title> tag
          const titleMatch = htmlContent.match(/<title>([^<]*)<\/title>/i)
          if (titleMatch) {
            title = titleMatch[1].trim()
          }

          // Extract hero image from CSS url() in .hero section
          // Look for the first url('...') which is typically the hero background
          const heroUrlMatch = htmlContent.match(/\.hero\s*\{[^}]*url\(['"]?([^'")\s]+)['"]?\)/i)
            || htmlContent.match(/url\(['"]?([^'")\s]+)['"]?\)/)
          if (heroUrlMatch) {
            heroImage = `/${sessionId}/${heroUrlMatch[1]}`
          }
        } catch {
          // Ignore read errors
        }

        htmlFiles.push({
          name: fileName,
          path: `/${sessionId}/${fileName}`,
          vibeIndex: vibeMatch ? parseInt(vibeMatch[1]) : undefined,
          vibeName: vibeMatch ? vibeMatch[2] : undefined,
          heroImage,
          title
        })
      }
    }

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

    // ==========================================
    // Parse vibes from CREATIVE-BRIEF.md
    // ==========================================
    const vibes: VibeInfo[] = []
    let briefSummary: BriefSummary | undefined

    if (briefContent) {
      // NEW: Try Vibe Preview section first (keyed by filename)
      // This gives us exact per-file metadata including audience/mood
      const vibePreviewMap = parseVibePreview(briefContent)

      // Also get traditional vibes for fallback data (reads VIBE-N.md files, falls back to CREATIVE-BRIEF.md)
      const parsedVibes = await parseVibesFromFiles(sessionPath)

      // Strategy: Create one vibe per HTML file, using Vibe Preview data if available
      console.log('🗺️ vibePreviewMap keys:', Array.from(vibePreviewMap.keys()))
      for (const html of htmlFiles) {
        const filename = html.name
        const preview = vibePreviewMap.get(filename)
        console.log(`🔍 Matching "${filename}":`, preview ? `FOUND → heroImage="${preview.heroImage}"` : 'NOT FOUND')

        // Find hero image for this vibe
        // PRIORITY: Use the hero image extracted from the HTML file itself (ground truth)
        let heroImage: string | undefined = html.heroImage

        // Fallback: keyword matching if HTML didn't have a hero image
        if (!heroImage) {
          const vibeKeywords: Record<string, string[]> = {
            'qahwa': ['dallah', 'coffee', 'grandmother', 'qahwa'],
            'jareen': ['highlands', 'asir', 'mountain', 'highland'],
            'race': ['haboob', 'sand', 'desert', 'adrenaline'],
            'majlis': ['falcon', 'royal', 'luxury', 'sultan', 'night'],
          }

          let matchedKeywords: string[] = []
          for (const [key, keywords] of Object.entries(vibeKeywords)) {
            if (filename.toLowerCase().includes(key)) {
              matchedKeywords = keywords
              break
            }
          }

          for (const img of images) {
            const imgLower = img.filename.toLowerCase()
            if (matchedKeywords.some(kw => imgLower.includes(kw))) {
              heroImage = img.path
              if (imgLower.includes('hero')) break
            }
          }
        }

        // Last resort: first hero image or any image
        if (!heroImage && images.length > 0) {
          const anyHero = images.find(i => i.filename.toLowerCase().includes('hero'))
          heroImage = anyHero ? anyHero.path : images[0].path
        }

        if (preview) {
          // Use Vibe Preview data (preferred - has audience/mood)
          // Use heroImage from preview if specified, otherwise fall back to keyword matching
          const resolvedHeroImage = preview.heroImage
            ? `/${sessionId}/${preview.heroImage}`
            : heroImage
          vibes.push({
            index: html.vibeIndex || vibes.length + 1,
            name: preview.name,
            slug: filename.replace('.html', ''),
            status: 'complete',
            htmlPath: html.path,
            audience: preview.audience,
            mood: preview.mood,
            colors: preview.colors,
            fonts: preview.fonts,
            heroImage: resolvedHeroImage
          })
        } else if (html.vibeIndex !== undefined) {
          // Fallback to traditional parsed vibe data
          // Match by slug first (more specific), then by index (less specific)
          const fileSlug = filename.replace('.html', '').replace(/^vibe-\d+-/, '')
          const matchedParsed = parsedVibes.find(pv => pv.slug === fileSlug)
            || parsedVibes.find(pv => {
              // Only match by index if this is the ONLY file with this vibeIndex
              const filesWithSameIndex = htmlFiles.filter(h => h.vibeIndex === html.vibeIndex)
              return filesWithSameIndex.length === 1 && pv.index === html.vibeIndex
            })

          vibes.push({
            index: html.vibeIndex,
            name: matchedParsed?.name || html.vibeName || `Vibe ${html.vibeIndex}`,
            slug: matchedParsed?.slug || filename.replace('.html', ''),
            status: 'complete',
            htmlPath: html.path,
            oneLiner: matchedParsed?.oneLiner,
            voice: matchedParsed?.voice,
            whoFor: matchedParsed?.whoFor,
            audience: matchedParsed?.audience || '',
            mood: matchedParsed?.mood || '',
            colors: matchedParsed?.colors,
            fonts: matchedParsed?.fonts,
            heroImage
          })
        }
      }

      // Debug log final vibes
      console.log('✅ Final vibes data:', vibes.map(v => ({
        name: v.name,
        heroImage: v.heroImage,
        audience: v.audience?.substring(0, 30) + '...'
      })))

      // Build brief summary
      const businessMatch = briefContent.match(/# Creative Brief: ([^\n]+)/i)
        || briefContent.match(/Business:\s*(.+)/i)
      const taglineMatch = briefContent.match(/One-sentence:\s*([^\n]+)/i)
        || briefContent.match(/Tagline:\s*(.+)/i)
      const recommendationMatch = briefContent.match(/## MY RECOMMENDATION[\s\S]*?(?=##|$)/i)

      briefSummary = {
        businessName: businessMatch ? businessMatch[1].trim() : undefined,
        tagline: taglineMatch ? taglineMatch[1].trim() : undefined,
        vibeCount: vibes.length,  // Now counts actual built vibes
        hasMenu: /## Menu/i.test(briefContent),
        hasCharacters: /## (?:The Residents|Characters|Residents)/i.test(briefContent),
        recommendation: recommendationMatch ? extractRecommendation(recommendationMatch[0]) : undefined
      }
    }

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
    // Detect agents from SESSION.md
    // ==========================================
    const agents: AgentInfo[] = []

    // Check if CD is mentioned as active
    if (sessionContent.includes('CD →') || sessionContent.includes('#### CD |')) {
      const isDiscoveryPhase = sessionContent.includes('PHASE_1_DISCOVERY') || sessionContent.includes('PHASE_2')
      const isVibePhase = sessionContent.includes('PHASE_2_VIBES') || sessionContent.includes('PHASE_3')
      agents.push({
        name: 'Creative Director',
        status: isDiscoveryPhase ? 'active' : isVibePhase ? 'active' : 'idle',
        task: isDiscoveryPhase ? 'Discovery questions' : isVibePhase ? 'Crafting vibes' : 'Waiting'
      })
    }

    // Check if WebDev is active (HTML files being built)
    if (buildContent && !buildContent.includes('*To be provided*')) {
      const isBuilding = vibes.some(v => v.status === 'pending') && vibes.some(v => v.status === 'complete')
      agents.push({
        name: 'WebDeveloper',
        status: htmlFiles.length > 0 ? (isBuilding ? 'building' : 'idle') : 'waiting',
        task: isBuilding ? `Building vibe HTML` : htmlFiles.length > 0 ? 'Vibes complete' : 'Waiting for brief'
      })
    }

    // ==========================================
    // Detect Phase from content
    // ==========================================
    let phase = detectPhase(sessionContent, briefContent, vibes, images, htmlFiles, hasBrief)

    // Extract name
    let name = sessionId
    const nameMatch = sessionContent.match(/Business:\s*(.+)/i)
      || sessionContent.match(/# Session: ([^\n]+)/i)
      || briefContent.match(/# Creative Brief: ([^\n]+)/i)
    if (nameMatch) name = nameMatch[1].trim()

    // ==========================================
    // Parse image prompts from IMAGES.md
    // ==========================================
    const imagePrompts = parseImagePrompts(imagesContent)

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
      agents,
      imagePrompts,
      briefSummary,
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

function extractRecommendation(section: string): string {
  const text = section.replace(/## MY RECOMMENDATION/i, '').trim()
  const firstPara = text.split('\n\n')[0].trim()
  return firstPara.length > 150 ? firstPara.substring(0, 150) + '...' : firstPara
}

// ==========================================
// Parse Image Prompts from IMAGES.md
// ==========================================

function parseImagePrompts(imagesContent: string): ImagePrompt[] {
  const prompts: ImagePrompt[] = []

  if (!imagesContent) return prompts

  // Split by image sections (### filename.ext)
  const imageBlocks = imagesContent.split(/(?=^### )/gm)

  for (const block of imageBlocks) {
    // Match image header: ### filename.jpg or ### 123-filename.jpg
    const headerMatch = block.match(/^### ([^\n]+)/m)
    if (!headerMatch) continue

    const filename = headerMatch[1].trim()

    // Skip if not an image file
    if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) continue

    // Extract Reprompt field
    const repromptMatch = block.match(/\*\*Reprompt:\*\*\s*([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i)
    if (!repromptMatch) continue

    const reprompt = repromptMatch[1].trim()

    // Skip empty or placeholder reprompts
    if (!reprompt || reprompt.length < 10) continue

    // Extract CD Analysis
    const analysisMatch = block.match(/\*\*CD Analysis:\*\*\s*([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i)
    const analysis = analysisMatch ? analysisMatch[1].trim() : undefined

    // Extract suggested uses
    const usesMatch = block.match(/\*\*Suggested uses:\*\*\s*([^\n]+)/i)
    const suggestedUses = usesMatch ? usesMatch[1].trim() : undefined

    // Extract suggested vibes
    const vibesMatch = block.match(/\*\*Suggested vibes:\*\*\s*([^\n]+)/i)
    const suggestedVibes = vibesMatch ? vibesMatch[1].trim() : undefined

    // Determine aspect ratio from prompt or default
    let aspectRatio = '16:9'
    if (/portrait|vertical|tall/i.test(reprompt)) aspectRatio = '9:16'
    else if (/square/i.test(reprompt)) aspectRatio = '1:1'

    // Determine status (for now, all parsed prompts are "pending")
    const status: ImagePrompt['status'] = 'pending'

    prompts.push({
      name: filename,
      prompt: reprompt,
      aspectRatio,
      status,
      analysis,
      suggestedUses,
      suggestedVibes
    })
  }

  return prompts
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
