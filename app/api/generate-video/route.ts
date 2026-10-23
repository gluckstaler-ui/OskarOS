// ==========================================
// /api/generate-video — the two VIDEO tabs of Image mode (2026-10-23).
// Gemini Omni Flash on Vertex (lib/omni.ts); rules in lib/omni-tasks.ts.
//
// POST: one generation.
//   { sessionId, prompt, kind: 'video' | 'extend' | 'edit',
//     first?, last?, ingredients[]   (VIDEO: frame images, ingredient images/videos; public paths)
//     source?                        (extend/edit: the video)
//     ingredients[]                  (extend/edit: images only)
//     continueFrom?, chain[]?        (a later part: the generation ID of the part before, all IDs so far)
//     part?: { index, total }        (1-based; parts before the last are kept in video-parts/)
//     tab: 'video' | 'vid2vid', recipe (recorded, so the tab can render the same take again)
//     aspectRatio?, resolution, duration?, seed, thinking, filename? }
//   A video longer than 10 s is several POSTs: part 1 as a new video, then
//   each part extends the previous one by its generation ID (the workshop
//   runs the loop). The finished video lands in public/{sessionId}/ and shows
//   up in the Assets panel; earlier parts go to public/{sessionId}/video-parts/
//   (kept, not listed) so a failed later part never loses a paid one.
//   Every generation is a LINEAGE.json record like Nano's images (mode
//   'video': the whole prompt in userPrompt, generation ID, seed, recipe…);
//   the finished video also gets its IMAGES.md entry with **Prompt:**.
// GET ?sessionId=: the session's video records by file — generation ID
//   (Vertex keeps it 14 days; extend/edit continue it instead of uploading),
//   mode, prompt, options, seed, parts, recipe.
// ==========================================
import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import path from 'path'
import { generateVideo, type VideoMedia } from '@/lib/omni'
import { appendLineage, newGenerationId, readLineage } from '@/lib/lineage-store'
import { upsertImageMetadata } from '@/lib/images-md-writer'
import type { GenerationRecord } from '@/lib/types'
import {
  VIDEO_RATIOS, VIDEO_RESOLUTIONS, THINKING_LEVELS, MAX_IMAGES, MAX_REF_VIDEOS, INTERACTION_KEPT_MS,
  videoModeFor, slotsProblem, type VideoMode, type VideoAspectRatio, type VideoThinking, type VideoApiTask,
} from '@/lib/omni-tasks'
import { VIDEO_TOKENS_PER_SECOND, USD_PER_M_VIDEO_OUT, type VideoResolution } from '@/lib/omni-pricing'

export const runtime = 'nodejs'
export const maxDuration = 900
export const dynamic = 'force-dynamic'

const PARTS_DIR = 'video-parts'

/** A video as the VIDEO tabs read it (GET): its LINEAGE.json record, by file. */
export interface VideoEntry {
  /** Generation ID (Vertex interaction); extend/edit continue it for 14 days. */
  interactionId: string
  createdAt: string
  mode: VideoMode
  tab: 'video' | 'vid2vid'
  /** This generation's own prompt (one ✂ part). */
  prompt: string
  /** The tab's whole prompt. */
  fullPrompt: string
  aspectRatio?: string
  resolution: string
  durationSeconds?: number
  seed?: number
  thinking?: string
  sources: string[]
  chain?: string[]
  part?: { index: number; total: number }
  recipe?: Record<string, unknown>
  estUsd: number
}

function mimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'webm') return 'video/webm'
  return 'image/jpeg'
}

const isVideoPath = (p: string) => /\.(mp4|mov|webm)$/i.test(p)

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

function slugBase(raw: string): string {
  return raw
    .replace(/\.[a-z0-9]+$/i, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'video'
}

async function readMedia(publicPath: string): Promise<VideoMedia> {
  // publicPath is "/{sessionId}/name.ext" or "/{sessionId}/images/name.ext"
  const root = path.join(process.cwd(), 'public')
  const full = path.join(root, publicPath.replace(/^\/+/, ''))
  if (!full.startsWith(root + path.sep)) throw new Error(`invalid path ${publicPath}`)
  const buf = await readFile(full)
  return { data: buf.toString('base64'), mimeType: mimeFromPath(publicPath) }
}

/** The session's videos by file (later records win), from LINEAGE.json. */
async function readVideos(sessionId: string): Promise<Record<string, VideoEntry>> {
  const out: Record<string, VideoEntry> = {}
  for (const r of await readLineage(sessionId)) {
    const v = r.video
    if (r.mode !== 'video' || !v) continue
    out[r.resultImage] = {
      interactionId: v.interactionId,
      createdAt: r.timestamp,
      mode: v.mode as VideoMode,
      tab: v.tab,
      prompt: v.partPrompt,
      fullPrompt: r.userPrompt,
      aspectRatio: r.aspectRatio === 'auto' ? undefined : r.aspectRatio,
      resolution: r.resolution,
      durationSeconds: v.durationSeconds,
      seed: v.seed,
      thinking: v.thinking,
      sources: r.sourceImages,
      chain: v.chain,
      part: v.part,
      recipe: v.recipe,
      estUsd: v.estUsd,
    }
  }
  return out
}

const validSession = (id: string) => /^[A-Za-z0-9._-]+$/.test(id) && !id.includes('..')

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') || ''
  if (!validSession(sessionId)) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  return NextResponse.json({ videos: await readVideos(sessionId), keptDays: INTERACTION_KEPT_MS / 86400000 })
}

export async function POST(req: NextRequest) {
  let sessionId = ''
  try {
    const body = await req.json()
    sessionId = String(body.sessionId || '')
    const prompt = String(body.prompt || '').trim()
    const kind = body.kind as 'video' | 'extend' | 'edit'
    const tab: 'video' | 'vid2vid' = body.tab === 'vid2vid' || (!body.tab && kind !== 'video' && !body.continueFrom) ? 'vid2vid' : 'video'
    const resolution = (body.resolution || '720p') as VideoResolution
    const aspectRatio = body.aspectRatio as VideoAspectRatio | undefined
    const durationSeconds = body.duration ? Number(body.duration) : undefined
    const seed = body.seed === undefined || body.seed === null || body.seed === '' ? undefined : Number(body.seed)
    const thinking = body.thinking as VideoThinking | undefined
    const first: string | undefined = body.first || undefined
    const last: string | undefined = body.last || undefined
    const ingredients: string[] = Array.isArray(body.ingredients) ? body.ingredients : []
    const source: string | undefined = body.source || undefined
    const continueFrom: string | undefined = body.continueFrom || undefined
    const chain: string[] = Array.isArray(body.chain) ? body.chain : []
    const part = body.part && Number(body.part.total) > 1 ? { index: Number(body.part.index), total: Number(body.part.total) } : undefined

    const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
    if (!validSession(sessionId) || !prompt || !['video', 'extend', 'edit'].includes(kind)) return bad('sessionId, prompt and kind (video, extend, edit) are required')
    if (!VIDEO_RESOLUTIONS.includes(resolution)) return bad(`resolution must be one of ${VIDEO_RESOLUTIONS.join(', ')}`)
    if (aspectRatio && !(VIDEO_RATIOS as readonly string[]).includes(aspectRatio)) return bad(`aspect ratio must be ${VIDEO_RATIOS.join(' or ')}`)
    if (thinking && !(THINKING_LEVELS as readonly string[]).includes(thinking)) return bad(`thinking must be ${THINKING_LEVELS.join(' or ')}`)
    if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0 && seed <= 2147483647)) return bad('seed must be a whole number from 0 to 2147483647')
    if (last && !first) return bad('a last frame needs a first frame')

    const ingredientImages = ingredients.filter((p) => !isVideoPath(p))
    const ingredientVideos = ingredients.filter(isVideoPath)
    const imageCount = (first ? 1 : 0) + (last ? 1 : 0) + ingredientImages.length
    if (imageCount > MAX_IMAGES) return bad(`at most ${MAX_IMAGES} images`)
    if (ingredientVideos.length > MAX_REF_VIDEOS) return bad(`at most ${MAX_REF_VIDEOS} ingredient videos`)
    if (kind === 'video' && !continueFrom) {
      const problem = slotsProblem({ first: !!first, last: !!last, images: ingredientImages.length, videos: ingredientVideos.length })
      if (problem) return bad(problem)
    }
    if (kind !== 'video') {
      if (!source && !continueFrom) return bad(`${kind} needs the video to ${kind}`)
      if (first || last || ingredientVideos.length) return bad(`${kind} takes one video and ingredient images only`)
    }
    if (kind === 'edit' && continueFrom) return bad('an edit is one generation')
    if (continueFrom && (first || last || ingredients.length || source)) return bad('a later part continues the part before by its generation ID and takes no other sources')

    const sessionDir = path.join(process.cwd(), 'public', sessionId)
    await mkdir(sessionDir, { recursive: true })
    const index = await readVideos(sessionId)

    // --- What Omni gets ---------------------------------------------------
    let mode: VideoMode
    let apiTask: VideoApiTask
    let text = prompt
    let images: VideoMedia[] = []
    let videos: VideoMedia[] = []
    let video: VideoMedia | undefined
    let previousInteractionId: string | undefined
    let sources: string[]
    /** Generation IDs of the source video's own history (extend/edit of an Oskar video). */
    let sourceChain: string[] = []

    if (continueFrom) {
      // A later part: extend the part before by its generation ID.
      mode = 'extend'
      apiTask = 'extend'
      previousInteractionId = continueFrom
      sources = []
    } else if (kind === 'video') {
      const slots = { first: !!first, last: !!last, images: ingredientImages.length, videos: ingredientVideos.length }
      const info = videoModeFor(slots)
      mode = info.mode
      apiTask = info.apiTask
      images = await Promise.all([first, last, ...ingredientImages].filter((p): p is string => !!p).map(readMedia))
      videos = await Promise.all(ingredientVideos.map(readMedia))
      // Frame tags bind the images to their roles (Omni prompt guide).
      if (last && !/<LAST_FRAME>/.test(text)) text = `${/<FIRST_FRAME>/.test(text) ? '' : '<FIRST_FRAME> '}<LAST_FRAME> ${text}`
      else if (first && !/<FIRST_FRAME>/.test(text)) text = `<FIRST_FRAME> ${text}`
      sources = [first, last, ...ingredients].filter((p): p is string => !!p)
    } else {
      // Extend / edit: continue Oskar's own generation while Vertex still has
      // it (no upload, may be longer than an upload); otherwise send the file.
      mode = kind
      apiTask = kind
      images = await Promise.all(ingredientImages.map(readMedia))
      const known = index[path.basename(source!)]
      if (known) sourceChain = known.chain || [known.interactionId]
      if (known && Date.now() - Date.parse(known.createdAt) < INTERACTION_KEPT_MS - 3600 * 1000) {
        previousInteractionId = known.interactionId
      } else {
        video = await readMedia(source!)
      }
      sources = [source!, ...ingredientImages]
    }

    console.log(`[generate-video] ${sessionId} ${kind}/${mode}${part ? ` part ${part.index}/${part.total}` : ''} ${resolution} ${aspectRatio || 'auto'} ${durationSeconds || '-'}s seed=${seed ?? '-'} thinking=${thinking || '-'} images=${images.length} videos=${videos.length} source=${video ? 'upload' : previousInteractionId ? 'generation ID' : 'none'}: "${prompt.slice(0, 80)}"`)

    const result = await generateVideo({
      prompt: text,
      task: apiTask,
      resolution,
      aspectRatio,
      durationSeconds: apiTask === 'edit' ? undefined : durationSeconds,
      seed,
      thinkingLevel: thinking,
      images,
      videos,
      video,
      previousInteractionId,
    })

    // Filename: the user's (Filename field) or the first words of the prompt.
    // Parts before the last go to video-parts/ as <name>-part<n>.mp4.
    const base = slugBase(body.filename || prompt.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join('-'))
    const intermediate = !!part && part.index < part.total
    const dir = intermediate ? path.join(sessionDir, PARTS_DIR) : sessionDir
    await mkdir(dir, { recursive: true })
    const stem = intermediate ? `${base}-part${part!.index}` : base
    let filename = `${stem}.mp4`
    for (let n = 2; await exists(path.join(dir, filename)); n++) filename = `${stem}-${n}.mp4`
    await writeFile(path.join(dir, filename), result.video)

    const key = intermediate ? `${PARTS_DIR}/${filename}` : filename
    const fullChain = [...(chain.length ? chain : sourceChain), result.interactionId]
    // Vertex once reported 1,931 output tokens for a 10 s 360p clip (expected
    // 19,310); the cost record takes the higher of reported and per-second rate.
    const expectedUsd = apiTask !== 'edit' && durationSeconds
      ? (VIDEO_TOKENS_PER_SECOND[resolution] * durationSeconds * USD_PER_M_VIDEO_OUT) / 1e6 : 0
    const estUsd = Math.max(result.estUsd, expectedUsd)
    // The prompt stays attached: the whole prompt (all ✂ parts) in the
    // lineage record and, for the finished video, in its IMAGES.md entry.
    const recipe = body.recipe && typeof body.recipe === 'object' ? body.recipe as Record<string, unknown> : undefined
    const fullPrompt = typeof recipe?.prompt === 'string' && recipe.prompt ? recipe.prompt : prompt
    const record: GenerationRecord = {
      id: newGenerationId(),
      parentImage: sources[0] ? path.basename(sources[0]) : undefined,
      sourceImages: sources.map((p) => path.basename(p)),
      preset: '',
      userPrompt: fullPrompt,
      actualPromptSent: fullPrompt,
      resultImage: key,
      aspectRatio: apiTask === 'edit' || apiTask === 'extend' || !aspectRatio ? 'auto' : aspectRatio,
      resolution,
      timestamp: new Date().toISOString(),
      mode: 'video',
      video: {
        interactionId: result.interactionId,
        mode,
        tab,
        partPrompt: text,
        durationSeconds: apiTask === 'edit' ? undefined : durationSeconds,
        seed,
        thinking,
        chain: fullChain.length > 1 ? fullChain : undefined,
        part,
        recipe,
        outputTokens: result.outputTokens,
        estUsd: Math.round(estUsd * 1000) / 1000,
      },
    }
    await appendLineage(sessionId, record)
    if (!intermediate) {
      try {
        await upsertImageMetadata(sessionDir, filename, { status: 'READY', prompt: fullPrompt.replace(/\s+/g, ' ').trim() })
      } catch (err) {
        console.warn('[generate-video] IMAGES.md write failed:', err)
      }
    }

    const savedPath = `/${sessionId}/${key}`
    console.log(`[generate-video] saved ${savedPath} in ${result.elapsedSeconds}s, ${result.outputTokens} video tokens ≈ $${estUsd.toFixed(2)}`)
    return NextResponse.json({
      filename,
      savedPath,
      intermediate,
      interactionId: result.interactionId,
      chain: fullChain,
      elapsedSeconds: result.elapsedSeconds,
      outputTokens: result.outputTokens,
      estUsd,
      seed,
    })
  } catch (error) {
    console.error('[generate-video] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
