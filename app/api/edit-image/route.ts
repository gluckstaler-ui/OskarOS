import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import path from 'path'
import { callGemini, type ImageSize, type AspectRatio } from '@/lib/gemini'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
import { appendLineage, newGenerationId } from '@/lib/lineage-store'
import type { GenerationRecord } from '@/lib/types'
import { publish } from '@/lib/event-bus'
import { upsertImageMetadata } from '@/lib/images-md-writer'

// Check if file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

// Get unique filename by appending -2, -3, etc. if collision
async function getUniqueFilename(dir: string, baseName: string, ext: string): Promise<string> {
  const firstTry = `${baseName}.${ext}`
  if (!await fileExists(path.join(dir, firstTry))) {
    return firstTry
  }

  let counter = 2
  while (counter < 100) {
    const filename = `${baseName}-${counter}.${ext}`
    if (!await fileExists(path.join(dir, filename))) {
      return filename
    }
    counter++
  }

  // Fallback to timestamp only if 100+ collisions
  return `${baseName}-${Date.now()}.${ext}`
}

// Words we don't want as filenames — determiners, fillers, generic image
// terms, AND camera/composition descriptors that Nano's descriptions
// constantly lead with. If slugTwoWordsFromDescription strips everything,
// we fall back to 'image'.
//
// Ralph 2026-04-25: previously this list was tiny, so Nano's typical opener
// "A close-up, low-angle photograph captures..." would slug to `close-low.jpg`
// — pure camera vocabulary, zero subject content. Filenames went from
// `sultan.jpg` / `haboob.jpg` quality down to `wide-angle-7.jpg` /
// `top-down-5.jpg` garbage. The expanded set below kills the
// composition vocabulary AND the verb prefixes Nano uses to introduce
// the actual subject ("captures", "depicts", "shows", "features").
const FILENAME_STOPWORDS = new Set([
  // Determiners / pronouns / prepositions / conjunctions
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its', "it's",
  'he', 'she', 'they', 'we', 'you', 'me', 'us', 'them', 'his', 'her',
  'their', 'our', 'your', 'my', 'who', 'whom', 'which', 'what', 'whose',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'into', 'onto', 'over', 'under', 'about', 'before', 'after', 'between',
  'and', 'or', 'but', 'as', 'while',
  // Auxiliary / linking verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may',
  'might', 'must',
  // Verbs Nano uses to introduce the subject ("...captures a falcon...")
  'captures', 'capture', 'capturing', 'shows', 'showing', 'show', 'depicts', 'depict',
  'depicting', 'features', 'feature', 'featuring', 'illustrates',
  'illustrate', 'illustrating', 'portrays', 'portray', 'portraying',
  'represents', 'represent', 'displays', 'display', 'displaying',
  'reveals', 'reveal', 'revealing', 'highlights', 'highlight',
  'highlighting', 'emphasizes', 'emphasize', 'emphasizing',
  'demonstrates', 'demonstrate', 'demonstrating', 'presents', 'present',
  'presenting', 'taken', 'taking', 'placed', 'positioned', 'set', 'made',
  // Generic image / medium nouns
  'photo', 'photograph', 'photography', 'image', 'picture', 'shot',
  'scene', 'render', 'rendering', 'view', 'composition', 'capture',
  'depiction', 'portrait', 'landscape', 'illustration', 'frame',
  'framing', 'snapshot', 'still', 'visual',
  // CAMERA ANGLES / COMPOSITION DESCRIPTORS — the load-bearing additions.
  // These are what Nano leads with and what was producing the garbage names.
  'close', 'closeup', 'wide', 'medium', 'long', 'macro', 'micro',
  'extreme', 'high', 'low', 'overhead', 'aerial', 'panoramic',
  'cinematic', 'angle', 'angled', 'angles', 'detailed', 'detail',
  'symmetrical', 'asymmetrical', 'candid', 'formal', 'casual',
  'top', 'down', 'side', 'front', 'back', 'rear', 'three', 'quarter',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'flat', 'lay', 'oblique', 'tilted', 'straight', 'level', 'eye',
  'birds', 'worms', 'dutch', 'tracking', 'establishing',
  // Filler intensifiers / quantifiers
  'very', 'really', 'quite', 'highly', 'extremely', 'somewhat', 'rather',
  'fairly', 'pretty', 'some', 'any', 'all', 'each', 'every', 'much',
  'many', 'few', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'several', 'multiple', 'numerous',
  // Generic descriptive adjectives that aren't subjects
  'soft', 'hard', 'large', 'small', 'big', 'little', 'tall', 'short',
  'narrow', 'thick', 'thin', 'light', 'dark', 'bright', 'dim',
  'natural', 'artificial', 'warm', 'cool', 'hot', 'cold', 'old', 'new',
  'modern', 'traditional', 'classic', 'contemporary', 'vintage',
  'antique', 'fresh', 'worn', 'aged', 'clean', 'dirty', 'polished',
  'rough', 'smooth', 'textured', 'simple', 'complex', 'minimal',
  'minimalist', 'rich', 'sparse', 'busy', 'quiet', 'loud', 'subtle',
  'bold', 'vibrant', 'muted', 'pale', 'deep', 'shallow', 'good', 'bad',
  'great', 'nice', 'beautiful', 'ugly', 'pretty', 'lovely', 'gorgeous',
  'stunning', 'sharp', 'blurred', 'blurry', 'crisp', 'precise',
  // Common adverbs / connective filler
  'also', 'too', 'just', 'only', 'even', 'still', 'now', 'then', 'here',
  'there', 'where', 'when', 'how', 'why', 'much', 'more', 'most', 'less',
  // Common framing verbs / nouns about the picture itself
  'created', 'creating', 'generated', 'showing', 'including', 'including',
  'standing', 'sitting', 'lying', 'resting', 'against',
])

/**
 * Strip the boilerplate intro phrase Nano uses to introduce the subject.
 *
 * Patterns handled (case-insensitive):
 *   "A/An <camera-adj> photograph/shot/image of/captures/shows... a/an/the SUBJECT"
 *   "An overhead photograph captures the dossier ..."   →  starts at "dossier ..."
 *   "A close-up, low-angle photograph captures the precise intersection of..." →  starts at "intersection of ..."
 *
 * Without this, the slugger picks up adjectives like `close`/`low`/`wide`
 * before reaching the actual subject noun.
 */
function stripDescriptionPreamble(text: string): string {
  // Match leading "A/An [up to ~6 adjective/comma tokens] [medium-noun]
  // [optional verb] [optional article]" and remove it.
  const pattern =
    /^\s*(?:a|an|the)\s+(?:[a-z][a-z-]*(?:,\s*|\s+)){0,6}(?:photograph|photo|photography|image|picture|shot|scene|render|rendering|view|composition|capture|depiction|portrait|landscape|illustration|frame|snapshot|still|visual|diptych|triptych)\s+(?:captures?|shows?|showing|depicts?|depicting|features?|featuring|illustrates?|illustrating|portrays?|portraying|reveals?|displays?|displaying|highlights?|emphasizes?|presents?|of|taken|made)?\s*(?:a|an|the|some|two|three|four|five|six|several|multiple)?\s*/i
  return text.replace(pattern, '')
}

/**
 * Derive a two-word filename slug from Nano's description.
 *
 * Three-stage pipeline:
 *   1. Strip Nano's "A close-up photograph captures the..." preamble so we
 *      start at the actual subject.
 *   2. Tokenize, lowercase, drop stopwords (which now include the camera/
 *      composition vocabulary that pre-2026-04-25 was leaking into names).
 *   3. Take the first two surviving tokens.
 *
 * Returns 'image' if nothing useful survives.
 */
/**
 * Normalize a client-sent filename hint into a safe slug (extension stripped,
 * lowercased, non-alphanumerics collapsed to single dashes, leading/trailing
 * dashes removed). Returns 'image' if the input collapses to nothing.
 *
 * Used only for the client-hint path — keeps the semantic name the client
 * built (e.g. `vibrant-sultan`) intact while making it filesystem-safe.
 */
function sanitizeFilenameBase(raw: string): string {
  // Ralph 2026-05-22: Unicode-aware slug. Ohne diese Zeile macht der
  // Server jedes `räume` zu `r-ume`, und das in PromptEditor neue
  // editierbare Filename-Feld zeigt eine Lüge an (User tippt räume,
  // Datei landet als r-ume.jpg). \p{L} = Unicode-Letters, \p{N} =
  // Unicode-Numbers, NFC-Normalize damit ä als einzelner Codepoint
  // gespeichert wird (macOS/Linux/Windows-Kompat).
  const noExt = raw.replace(/\.[^/.]+$/, '')
  const slug = noExt
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}.\-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return slug || 'image'
}

function slugTwoWordsFromDescription(description: string | null | undefined): string {
  if (!description) return 'image'
  const stripped = stripDescriptionPreamble(description.toLowerCase())
  const words = stripped
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !FILENAME_STOPWORDS.has(w))
  if (words.length === 0) return 'image'
  const pair = words.slice(0, 2).join('-')
  return pair || 'image'
}

function mimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

export async function POST(req: NextRequest) {
  let sessionId: string | undefined

  try {
    const body = await req.json()
    sessionId = body.sessionId
    const {
      sourceImagePaths,
      instruction,
      filename,
      imageSize,
      aspectRatio,
      operation,
      preset,
      mode,
      promptId,
    } = body

    if (!instruction) {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 })
    }

    // ── 1. Load source images (throw on failure) ─────────────────────────
    const sourceImages: { data: string; mimeType: string }[] = []
    const sourceFilenames: string[] = []
    if (sourceImagePaths?.length && operation !== 'generate') {
      for (const sourcePath of sourceImagePaths) {
        const fullPath = path.join(process.cwd(), 'public', sourcePath)
        const imageBuffer = await readFile(fullPath)
        sourceImages.push({
          data: imageBuffer.toString('base64'),
          mimeType: mimeFromPath(sourcePath),
        })
        sourceFilenames.push(sourcePath.split('/').pop() || 'image')
      }
      console.log(`[edit-image] Loaded ${sourceImages.length} source images: ${sourceFilenames.join(', ')}`)
    }

    // ── 2. Call Gemini (one function, one config) ────────────────────────
    const label = sourceImages.length > 0 ? 'edit/compose' : 'generate'
    console.log(`[edit-image] ${label}: "${instruction.substring(0, 80)}..."`)

    const { imageUrl, geminiText } = await callGemini({
      prompt: instruction,
      sourceImages: sourceImages.length > 0 ? sourceImages : undefined,
      sourceFilenames: sourceFilenames.length > 0 ? sourceFilenames : undefined,
      imageSize: (imageSize as ImageSize) || '1K',
      aspectRatio: (aspectRatio as AspectRatio) || '16:9',
      style: sourceImages.length === 0 ? 'photorealistic' : undefined,
    })

    // ── 3. Parse base64 + save to disk ───────────────────────────────────
    const DATA_PREFIX = 'data:image/'
    const BASE64_SEP = ';base64,'
    let savedPath: string | null = null
    let savedFilename: string | null = null

    if (imageUrl.startsWith(DATA_PREFIX)) {
      const sepIdx = imageUrl.indexOf(BASE64_SEP, DATA_PREFIX.length)
      if (sepIdx !== -1) {
        const rawExt = imageUrl.slice(DATA_PREFIX.length, sepIdx)
        const extension = rawExt === 'jpeg' ? 'jpg' : rawExt
        const base64Data = imageUrl.slice(sepIdx + BASE64_SEP.length)

        const outputDir = sessionId
          ? path.join(process.cwd(), 'public', sessionId)
          : path.join(process.cwd(), 'public', 'generated-images')
        const publicPathPrefix = sessionId ? `/${sessionId}` : '/generated-images'

        await mkdir(outputDir, { recursive: true })

        const isGenericClientName =
          !filename ||
          /^(?:image|edited-image|generated-image|untitled)(?:-\d+)?(?:\.[a-z]+)?$/i.test(filename)
        const baseFilename = !isGenericClientName
          ? sanitizeFilenameBase(filename)
          : slugTwoWordsFromDescription(geminiText)
        const finalFilename = await getUniqueFilename(outputDir, baseFilename, extension)

        await writeFile(path.join(outputDir, finalFilename), Buffer.from(base64Data, 'base64'))
        savedPath = `${publicPathPrefix}/${finalFilename}`
        savedFilename = finalFilename
        console.log(`[edit-image] Saved: ${savedPath}`)
      }
    }

    // ── 4. Lineage ───────────────────────────────────────────────────────
    if (sessionId && savedFilename) {
      try {
        const record: GenerationRecord = {
          id: newGenerationId(),
          parentImage: sourceFilenames[0] || undefined,
          sourceImages: sourceFilenames,
          preset: preset || '',
          userPrompt: instruction,
          actualPromptSent: instruction,
          resultImage: savedFilename,
          aspectRatio: (aspectRatio as AspectRatio) || '16:9',
          resolution: (imageSize as ImageSize) || '1K',
          timestamp: new Date().toISOString(),
          mode: (mode || operation || 'generate') as GenerationRecord['mode'],
          description: geminiText || undefined,
        }
        await appendLineage(sessionId, record)
      } catch (lineageErr) {
        console.error('[LINEAGE] Failed to append:', lineageErr)
      }
    }

    // ── 5. IMAGES.md entry ─────────────────────────────────────────────
    if (sessionId && savedFilename) {
      try {
        const sessionDir = path.join(process.cwd(), 'public', sessionId)
        const description = geminiText
          ? geminiText.replace(/\s+/g, ' ').trim()
          : undefined
        await upsertImageMetadata(sessionDir, savedFilename, {
          status: 'READY',
          prompt: instruction,
          description,
          ...(promptId ? { parentPromptId: promptId } : {}),
        })
      } catch (err) {
        console.warn('[edit-image] IMAGES.md write failed:', err)
      }
    }

    // ── 6. Publish event ─────────────────────────────────────────────────
    if (sessionId && savedFilename) {
      publish(sessionId, {
        type: 'image_ready',
        filename: savedFilename,
        imageName: savedFilename,
        slot: 'composed',
        geminiText: geminiText || null,
        nanoText: geminiText || null,
        savedPath,
      })
    }

    // ── 7. Return ────────────────────────────────────────────────────────
    return NextResponse.json({
      imageUrl,
      savedPath,
      filename: savedFilename || filename || 'edited-image.jpg',
      geminiText: geminiText || null,
    })

  } catch (error) {
    console.error('[edit-image] Error:', error)
    if (sessionId) {
      publish(sessionId, {
        type: 'image_failed',
        error: String(error),
        level: 'error',
      })
    }
    return NextResponse.json(
      { error: `Failed to edit image: ${error}` },
      { status: 500 }
    )
  }
}
