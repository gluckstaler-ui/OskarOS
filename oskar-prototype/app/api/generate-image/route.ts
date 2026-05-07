import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { generateImage, AspectRatio, ImageSize } from '@/lib/gemini'
import { publish } from '@/lib/event-bus'
import { upsertImageMetadata } from '@/lib/images-md-writer'

export const maxDuration = 120 // 2 minutes for image generation

export interface ImageGenerationPayload {
  sessionId: string
  vibe: string
  purpose: string // hero, menu-bg, portrait, etc.
  prompt: string
  aspectRatio?: AspectRatio
  imageSize?: ImageSize
  referenceImages?: string[] // base64 encoded
  /**
   * Optional parent prompt block id (e.g. `img-goofy-v1`). When set, the
   * generated `#### filename` IMAGES.md entry nests under that `### img-N`
   * block instead of orphan-appending to the section. Same semantics as
   * /api/edit-image's `promptId` field. Ralph 2026-05-04.
   */
  promptId?: string
}

/**
 * Bug 5 fix (Ralph 2026-04-30): bound + sanitize the slug components so
 * we don't get 110-char filenames when the caller passes prose into
 * `purpose`. A previous Mickey Mouse generation produced
 * `mcp-test-not-assigned-to-any-production-vibe-test-prompt-verifies-track-2-panel-rendering-v1.jpg`.
 *
 * Rule: each component is slugified, lowercased, and capped at SLUG_MAX
 * chars. If the cap truncates, append a 6-char hash of the full slug so
 * different sources don't collide.
 */
const SLUG_MAX = 24
function safeSlug(input: string): string {
  const slug = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled'
  if (slug.length <= SLUG_MAX) return slug
  const head = slug.slice(0, SLUG_MAX).replace(/-+$/, '')
  const hash = crypto.createHash('sha1').update(slug).digest('hex').slice(0, 6)
  return `${head}-${hash}`
}

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== Image Generation API called [${requestId}] ===`)

  try {
    const body = await req.json() as ImageGenerationPayload
    const { sessionId, vibe, purpose, prompt, aspectRatio, imageSize, referenceImages, promptId } = body

    if (!sessionId || !vibe || !purpose || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, vibe, purpose, prompt' },
        { status: 400 }
      )
    }

    console.log(`[${requestId}] Generating image for ${vibe}/${purpose}`)
    console.log(`[${requestId}] Prompt: ${prompt.substring(0, 100)}...`)

    // Generate image via Gemini (returns image + self-description)
    const genResult = await generateImage({
      prompt,
      aspectRatio: aspectRatio || '16:9',
      imageSize: imageSize || '2K',
      referenceImages
    })

    // Determine version number by checking existing files
    const sessionDir = path.join(process.cwd(), 'public', sessionId)
    await mkdir(sessionDir, { recursive: true })

    // Bug 5: bound the components before assembling the filename.
    const safeVibe = safeSlug(vibe)
    const safePurpose = safeSlug(purpose)

    const fs = await import('fs')
    const existingFiles = fs.existsSync(sessionDir)
      ? fs.readdirSync(sessionDir).filter(f => f.startsWith(`${safeVibe}-${safePurpose}-v`))
      : []
    const version = existingFiles.length + 1

    const filename = `${safeVibe}-${safePurpose}-v${version}.jpg`
    const filePath = path.join(sessionDir, filename)

    const base64Data = genResult.imageUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    await writeFile(filePath, buffer)

    const publicPath = `/${sessionId}/${filename}`
    console.log(`[${requestId}] Image saved to: ${publicPath}`)

    // Bug 1 fix (Ralph 2026-04-30): ALWAYS write IMAGES.md entry for every
    // successful generation. Was previously only written for Tier-S MCP
    // calls with explicit slot:X, which left the user-initiated UI flow
    // and CD-direct b-roll generations missing from the catalog. The
    // Assets panel reads IMAGES.md — entries it can't find don't exist.
    //
    // Status: READY by default (eligible for hotswap). CD evaluates later
    // and either keeps or downgrades. The vibe field gets the literal
    // input vibe name (could be 'cd-direct' for tool-fired generations);
    // CD can patch via update_image_metadata.
    try {
      const evaluation = genResult.geminiText
        ? genResult.geminiText.replace(/\s+/g, ' ').trim().slice(0, 400)
        : undefined
      await upsertImageMetadata(sessionDir, filename, {
        status: 'READY',
        vibe: vibe || undefined,
        slot: purpose && purpose !== 'b-roll' ? purpose : undefined,
        evaluation,
        // Ralph 2026-05-04: nest under parent ### img-N when caller knows it.
        ...(promptId ? { parentPromptId: promptId } : {}),
      })
    } catch (err) {
      // Non-fatal — file is on disk, the agent can still see it via list_assets.
      console.warn(`[${requestId}] IMAGES.md write failed:`, err)
    }

    // Phase 2: server-side publish so the event-bus is the single source of
    // truth for `image_ready` notifications. Both the frontend (via
    // /api/events SSE → sessionEvents) and the MCP server (→ CD as a
    // logging notification) consume from here. Replaces the per-route
    // client-side emitImageReady(...) calls in app/page.tsx, which fired a
    // duplicate event on every successful generation.
    publish(sessionId, {
      type: 'image_ready',
      filename,
      imageName: filename,
      slot: purpose,
      vibe,
      version,
      htmlPath: publicPath,
      geminiText: genResult.geminiText || null,
      nanoText: genResult.geminiText || null,
    })

    return NextResponse.json({
      success: true,
      filename,
      path: publicPath,
      vibe,
      purpose,
      version,
      aspectRatio: aspectRatio || '16:9',
      imageSize: imageSize || '2K',
      geminiText: genResult.geminiText || null
    })

  } catch (error) {
    console.error(`[${requestId}] Image generation error:`, error)
    const sessionIdForFailure = (await req.clone().json().catch(() => ({}))).sessionId
    if (sessionIdForFailure) {
      publish(sessionIdForFailure, {
        type: 'image_failed',
        error: String(error),
        level: 'error',
      })
    }
    return NextResponse.json(
      { error: `Failed to generate image: ${error}` },
      { status: 500 }
    )
  }
}
