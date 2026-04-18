import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import path from 'path'
import { editImageWithText, generateImage, describeGeneratedImage, ImageSize, AspectRatio } from '@/lib/gemini'
import { appendLineage, newGenerationId } from '@/lib/lineage-store'
import type { GenerationRecord } from '@/lib/types'
import { runProofread, type ProofreadOutcome } from '@/lib/cd-proofread'
import { runVerdict, type VerdictOutcome } from '@/lib/cd-verdict'
import { logToChat } from '@/lib/chat-logger'

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
    const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/)
    if (base64Match) {
      const extension = base64Match[1] === 'jpeg' ? 'jpg' : base64Match[1]
      const base64Data = base64Match[2]

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

      const baseFilename = filename?.replace(/\.[^/.]+$/, '') || 'edited-image'
      const safeFilename = baseFilename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      const finalFilename = await getUniqueFilename(outputDir, safeFilename, extension)
      const filePath = path.join(outputDir, finalFilename)

      const imageBuffer = Buffer.from(base64Data, 'base64')
      await writeFile(filePath, imageBuffer)

      savedPath = `${publicPathPrefix}/${finalFilename}`
      console.log(`Edited image saved to: ${savedPath}`)

      // ── WP-6B: Turn 2 fallback — describe the generated image if Turn 1 didn't ──
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
      // Updated 2026-04-17: prefer CD's adjusted description over Nano's when present.
      if (geminiText && sessionId) {
        try {
          const imagesPath = path.join(process.cwd(), 'public', sessionId, 'IMAGES.md')
          const existing = await readFile(imagesPath, 'utf-8').catch(() => '# Image Descriptions\n')
          // 'error' results still log — the failure mode is part of the audit trail.
          const verdictLine = verdict
            ? `\n- **CD verdict:** ${verdict.verdict} — ${verdict.note}`
            : ''
          const entry = `\n### ${finalFilename}\n- **Operation:** ${operation || 'edit'}\n- **Prompt:** ${instruction.slice(0, 200)}${instruction.length > 200 ? '...' : ''}\n- **Nano Banana:** ${geminiText}${verdictLine}\n`
          await writeFile(imagesPath, existing + entry, 'utf-8')
          console.log(`[IMAGES.md] Appended description for ${finalFilename}`)
        } catch (imgErr) {
          console.error(`[IMAGES.md] Failed to write:`, imgErr)
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

    return NextResponse.json({
      imageUrl,
      savedPath,
      filename: filename || 'edited-image.jpg',
      geminiText,
      // WP-15 (added 2026-04-17): structured CD outcomes for client-side
      // snackbar emission. Both null when sessionId was missing or the
      // bridge call timed out.
      proofread,
      verdict,
    })

  } catch (error) {
    console.error('Image edit error:', error)
    return NextResponse.json(
      { error: `Failed to edit image: ${error}` },
      { status: 500 }
    )
  }
}
