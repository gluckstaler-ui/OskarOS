import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import path from 'path'
import { editImageWithText, generateImage, describeGeneratedImage, ImageSize, AspectRatio } from '@/lib/gemini'
import { appendLineage, newGenerationId } from '@/lib/lineage-store'
import type { GenerationRecord } from '@/lib/types'
import { runProofread, type ProofreadOutcome } from '@/lib/cd-proofread'
import { runVerdict, type VerdictOutcome } from '@/lib/cd-verdict'
import { logToChat } from '@/lib/chat-logger'
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
  const noExt = raw.replace(/\.[^/.]+$/, '')
  const slug = noExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

export async function POST(req: NextRequest) {
  try {
    const {
      sourceImagePaths,   // Array of paths like ["/uploads/steve.jpg"]
      instruction,
      filename,
      imageSize,
      aspectRatio,
      operation,          // 'generate' for pure generation, anything else uses edit
      sessionId,          // Optional: if provided, save to session folder
      preset,             // WP-1C/2C: preset label used for this generation (for lineage)
      mode,               // WP-1C/2C: tab mode (generate|edit|compose|layout)
      promptId,           // Ralph 2026-05-04: parent ### img-N block to nest the new #### entry under
    } = await req.json()

    if (!instruction) {
      return NextResponse.json(
        { error: 'instruction is required' },
        { status: 400 }
      )
    }

    // Load source images from disk (only needed for edit operations)
    const sourceImages: string[] = []
    if (sourceImagePaths && sourceImagePaths.length > 0 && operation !== 'generate') {
      for (const sourcePath of sourceImagePaths) {
        try {
          const fullPath = path.join(process.cwd(), 'public', sourcePath)
          const imageBuffer = await readFile(fullPath)
          const base64 = imageBuffer.toString('base64')
          const mimeType = sourcePath.endsWith('.png') ? 'image/png' : 'image/jpeg'
          sourceImages.push(`data:${mimeType};base64,${base64}`)
        } catch (readError) {
          console.error(`Failed to read source image ${sourcePath}:`, readError)
        }
      }
    }

    // ── WP-15 (added 2026-04-17): Proofread before Nano ──
    // CD reviews the prompt. If CD finds an objective defect, it rewrites in
    // place; we send the rewrite to Nano and surface a snackbar via the
    // response payload. If CD doesn't reply within 2s, we fire as-is.
    // sessionId must be present — without it we can't reach Big CD.
    let proofread: ProofreadOutcome | null = null
    let actualPrompt = instruction
    if (sessionId) {
      const sourceFilenamesForCtx = (sourceImagePaths || []).map(
        (p: string) => p.split('/').pop() || `image`
      )
      proofread = await runProofread({
        sessionId,
        mode: (mode || operation || 'generate') as 'generate' | 'edit' | 'compose' | 'layout',
        prompt: instruction,
        image:
          sourceFilenamesForCtx.length > 0
            ? { filename: sourceFilenamesForCtx[0] }
            : undefined,
        stagedImages:
          sourceFilenamesForCtx.length > 1
            ? { scene: sourceFilenamesForCtx[0], subjects: sourceFilenamesForCtx.slice(1) }
            : undefined,
      })
      actualPrompt = proofread.finalPrompt

      // Augenmass paper-trail: only `rewritten` lands in chat. `advisory`
      // and `timeout` stay snackbar-only per WP-15 §"Paper-trail filter".
      if (proofread.severity === 'rewritten') {
        await logToChat(sessionId, {
          kind: 'cd-rewrite',
          content: `**Note:** ${proofread.note}\n\n**Original:**\n\`\`\`\n${instruction}\n\`\`\`\n\n**CD's rewrite:**\n\`\`\`\n${actualPrompt}\n\`\`\``,
          source: `image-mode:${mode || operation}`,
        })
      }

      console.log(
        `[edit-image] Proofread: severity=${proofread.severity} ${proofread.durationMs}ms — sending to Nano now`
      )
    }

    let imageUrl: string
    let geminiText: string | null = null
    // Lifted to outer scope so the response payload can include it.
    let verdict: VerdictOutcome | null = null

    // Pure generation: no source images, just create from prompt
    if (operation === 'generate') {
      console.log(`Generating new image from prompt: "${actualPrompt.substring(0, 80)}..."`)
      const genResult = await generateImage({
        prompt: actualPrompt,
        style: 'photorealistic',
        imageSize: (imageSize as ImageSize) || '1K',
        aspectRatio: (aspectRatio as AspectRatio) || '16:9'
      })
      imageUrl = genResult.imageUrl
      geminiText = genResult.geminiText || null
    } else {
      // Edit/compose: transform existing images
      // Extract filenames from paths for image labeling
      const sourceFilenames = (sourceImagePaths || []).map((p: string) => p.split('/').pop() || `image`)
      console.log(`Editing image with ${sourceImages.length} sources (${sourceFilenames.join(', ')}): "${actualPrompt.substring(0, 50)}..."`)
      const result = await editImageWithText({
        sourceImages,
        sourceFilenames,
        instruction: actualPrompt,
        imageSize: (imageSize as ImageSize) || '1K',
        aspectRatio: (aspectRatio as AspectRatio) || '16:9'
      })
      imageUrl = result.imageUrl
      geminiText = result.geminiText || null
    }

    // Save to disk
    let savedPath: string | null = null
    // Lifted so the response payload below can report the real saved name
    // (not the client-sent hint). Stays null if Nano didn't return a
    // base64 image — in that case nothing was written.
    let savedFilename: string | null = null

    // 2026-04-20: Parse the data URL with startsWith + indexOf instead of
    // a regex. Previous `/^data:image\/(\w+);base64,(.+)$/` threw
    // `RangeError: Maximum call stack size exceeded` at `String.match` on
    // certain imageUrl values returned by the Gemini generate path. The
    // regex engine flattens V8 cons-strings (rope trees) via recursion;
    // when Gemini's JSON decoder produces a deeply-nested rope for a multi-
    // MB base64 blob, the flatten blows the stack even though the pattern
    // itself is bounded. startsWith/indexOf/slice are all iterative in V8
    // and handle ropes without touching the stack. Ralph's repro hit 1K
    // images, not 2K — the trigger is rope depth, not byte count, so
    // resolution alone doesn't predict it.
    const DATA_PREFIX = 'data:image/'
    const BASE64_SEP = ';base64,'
    let parsed: { extension: string; base64Data: string } | null = null
    if (imageUrl.startsWith(DATA_PREFIX)) {
      const sepIdx = imageUrl.indexOf(BASE64_SEP, DATA_PREFIX.length)
      if (sepIdx !== -1) {
        const rawExt = imageUrl.slice(DATA_PREFIX.length, sepIdx)
        const extension = rawExt === 'jpeg' ? 'jpg' : rawExt
        const base64Data = imageUrl.slice(sepIdx + BASE64_SEP.length)
        parsed = { extension, base64Data }
      }
    }

    if (parsed) {
      const { extension, base64Data } = parsed

      // Determine output directory based on sessionId
      let outputDir: string
      let publicPathPrefix: string

      if (sessionId) {
        outputDir = path.join(process.cwd(), 'public', sessionId)
        publicPathPrefix = `/${sessionId}`
        console.log(`📁 Saving generated image to session folder: ${sessionId}`)
      } else {
        outputDir = path.join(process.cwd(), 'public', 'generated-images')
        publicPathPrefix = '/generated-images'
        console.log(`📁 No session - saving to generated-images`)
      }

      await mkdir(outputDir, { recursive: true })

      // ── WP-6B: Turn 2 fallback — describe the generated image if Turn 1 didn't ──
      // MOVED earlier (2026-04-20): used to run AFTER the write. Now runs
      // BEFORE, because the filename is derived from Nano's description
      // (first two content words → slug). Without Turn 2's text we'd have
      // to invent a name.
      if (!geminiText && imageUrl) {
        console.log(`[Turn 2] No description from Turn 1 — running self-describe...`)
        const sourceFilenames = (sourceImagePaths || []).map((p: string) => p.split('/').pop() || 'image')
        const turn2Description = await describeGeneratedImage(imageUrl, {
          prompt: instruction,
          mode: operation || 'generate',
          sourceFilenames: sourceFilenames.length > 0 ? sourceFilenames : undefined,
        })
        if (turn2Description) {
          geminiText = turn2Description
          console.log(`[Turn 2] Got description: ${turn2Description.length} chars`)
        } else {
          console.warn(`[Turn 2] describeGeneratedImage returned null — no description available`)
        }
      }

      // Filename selection (Ralph 2026-04-25 — restored client-hint primacy):
      //
      //   1. Client-sent `filename` wins when present and not generic. The
      //      client (AdvancedMode.handleGenerate) builds it from the source
      //      image's root filename + the preset/action that's being applied,
      //      e.g. `vibrant-sultan`, `night-cliff-majlis`. That preserves the
      //      semantic context the user actually cares about — what was
      //      edited and how — instead of whatever camera-vocabulary noise
      //      Nano happens to lead its description with.
      //
      //   2. Fallback: `slugTwoWordsFromDescription(geminiText)` — the
      //      description-derived slug. Used only when the client doesn't
      //      send a hint OR sends a known generic placeholder. The expanded
      //      stopwords list still kicks in here.
      //
      // The pre-2026-04-20 recursion bug (`gen-gen-gen-image.jpg`) came
      // from the client unconditionally prefixing `gen-` on every re-edit.
      // The new client formula uses preset + source-ROOT (walks the parent
      // chain to the original upload), so prefixes don't accumulate.
      const isGenericClientName =
        !filename ||
        /^(?:image|edited-image|generated-image|untitled)(?:-\d+)?(?:\.[a-z]+)?$/i.test(filename)
      const baseFilename = !isGenericClientName
        ? sanitizeFilenameBase(filename)
        : slugTwoWordsFromDescription(geminiText)
      const finalFilename = await getUniqueFilename(outputDir, baseFilename, extension)
      const filePath = path.join(outputDir, finalFilename)

      const imageBuffer = Buffer.from(base64Data, 'base64')
      await writeFile(filePath, imageBuffer)

      savedPath = `${publicPathPrefix}/${finalFilename}`
      savedFilename = finalFilename
      console.log(`Edited image saved to: ${savedPath}`)

      // ── WP-15 (added 2026-04-17): Post-generation verdict ──
      // CD reads the saved image (via FileRead in its own tools) + Nano's
      // self-description. Returns ✓/≈/✗ + note + optional description fix.
      // Soft 3s timeout — if CD is busy, we still record the generation but
      // skip the verdict. ✗ verdicts go to chat per Augenmass; others stay
      // in snackbars only.
      if (sessionId) {
        verdict = await runVerdict({
          sessionId,
          filename: finalFilename,
          nanoDescription: geminiText || undefined,
          originalPrompt: actualPrompt,
          mode: (mode || operation || 'generate') as 'generate' | 'edit' | 'compose' | 'layout',
        })
        console.log(
          `[edit-image] Verdict: ${verdict.verdict} ${verdict.durationMs}ms — note="${verdict.note?.slice(0, 80)}"`
        )
        if (verdict.verdict === '✗') {
          await logToChat(sessionId, {
            kind: 'cd-verdict-fail',
            content: `**Verdict:** ✗\n**Note:** ${verdict.note}`,
            ref: finalFilename,
            source: `image-mode:${mode || operation}`,
          })
        }
        // CD's adjusted description supersedes Nano's self-description.
        if (verdict.adjustedDescription) {
          geminiText = verdict.adjustedDescription
        }
      }

      // ── WP-6B: Write description to IMAGES.md ──
      // Ralph 2026-05-04: route through upsertImageMetadata. The previous
      // direct-write produced `### filename` (top-level prompt entry) —
      // wrong shape; the parser then treated each generation as its own
      // prompt block, which made Goofy show up as an "Uploaded Image"
      // instead of nesting under `### img-goofy-v1`. The upsert path
      // writes `#### filename` (the right shape) and, when promptId is
      // provided, inserts AT the parent block's tail so the parser
      // attaches it correctly.
      if (sessionId) {
        try {
          const sessionDir = path.join(process.cwd(), 'public', sessionId)
          const evaluation = verdict
            ? `${verdict.verdict} — ${verdict.note}`.slice(0, 400)
            : geminiText
              ? geminiText.replace(/\s+/g, ' ').trim().slice(0, 400)
              : undefined
          await upsertImageMetadata(sessionDir, finalFilename, {
            status: 'READY',
            evaluation,
            ...(promptId ? { parentPromptId: promptId } : {}),
          })
          console.log(
            `[IMAGES.md] upserted ${finalFilename}` +
            (promptId ? ` under ${promptId}` : ' (no parent prompt — appended)'),
          )
        } catch (imgErr) {
          console.error(`[IMAGES.md] Failed to upsert ${finalFilename}:`, imgErr)
        }
      }

      // ── WP-1C/2C (added 2026-04-17): Persist GenerationRecord to LINEAGE.json ──
      // Lineage data was previously in-memory only; refresh wiped the version
      // sidebar's history. Sidecar JSON survives reload without conflicting
      // with CD edits to IMAGES.md.
      if (sessionId) {
        try {
          const sourceFilenames = (sourceImagePaths || []).map(
            (p: string) => p.split('/').pop() || p
          )
          // WP-15 audit trail: capture what the user typed AND what Nano
          // actually received, plus both CD evaluations. Without these the
          // "did CD rewrite silently?" check cannot run from disk later.
          const record: GenerationRecord = {
            id: newGenerationId(),
            parentImage: sourceFilenames[0] || undefined,
            sourceImages: sourceFilenames,
            preset: preset || '',
            userPrompt: instruction,
            actualPromptSent: actualPrompt,
            resultImage: finalFilename,
            aspectRatio: (aspectRatio as AspectRatio) || '16:9',
            resolution: (imageSize as ImageSize) || '1K',
            timestamp: new Date().toISOString(),
            mode: (mode || operation || 'generate') as GenerationRecord['mode'],
            description: geminiText || undefined,
            proofreadResult: proofread
              ? { severity: proofread.severity, note: proofread.note }
              : undefined,
            verdict: verdict
              ? {
                  rating: verdict.verdict,
                  note: verdict.note,
                  adjustedDescription: verdict.adjustedDescription,
                }
              : undefined,
          }
          await appendLineage(sessionId, record)
          console.log(`[LINEAGE] Appended record ${record.id} for ${finalFilename}`)
        } catch (lineageErr) {
          console.error('[LINEAGE] Failed to append:', lineageErr)
        }
      }
    }

    // Phase 2: server-side publish on success so /api/events delivers
    // image_ready to BOTH the frontend (UI) and the MCP server (CD). The
    // legacy duplicate emitImageReady call in app/page.tsx (line ~1920)
    // can be deleted now — this is the single source of truth.
    if (sessionId && (savedFilename || filename)) {
      publish(sessionId, {
        type: 'image_ready',
        filename: savedFilename || filename || 'edited-image.jpg',
        imageName: savedFilename || filename || 'edited-image.jpg',
        slot: 'composed',
        geminiText: geminiText || null,
        nanoText: geminiText || null,
        savedPath,
      })
    }

    return NextResponse.json({
      imageUrl,
      savedPath,
      // The real saved name (derived from Nano's description). Falls back
      // to the client-sent hint if nothing was written to disk.
      filename: savedFilename || filename || 'edited-image.jpg',
      geminiText,
      // WP-15 (added 2026-04-17): structured CD outcomes for client-side
      // snackbar emission. Both null when sessionId was missing or the
      // bridge call timed out.
      proofread,
      verdict,
    })

  } catch (error) {
    console.error('Image edit error:', error)
    const sessionIdForFailure = (await req.clone().json().catch(() => ({}))).sessionId
    if (sessionIdForFailure) {
      publish(sessionIdForFailure, {
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
