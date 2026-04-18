import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import path from 'path'
import { generateImage } from '@/lib/gemini'
import {
  type BrandData,
  isBrandDataComplete,
} from '@/lib/brand-data'
// 2026-04-17 split: brandDataFromFile() lives in the server-only sibling so
// `lib/brand-data` stays bundleable into client components.
import { brandDataFromFile } from '@/lib/brand-data-server'
import { findDeliverable, type DeliverableId } from '@/lib/brand-deliverables'
// WP-15 (added 2026-04-17): brand deliverables are an Image sub-tab per
// rule 10 ("scope: all Image sub-tabs"). They MUST go through proofread
// → Nano → verdict like every other generation.
import { runProofread } from '@/lib/cd-proofread'
import { runVerdict } from '@/lib/cd-verdict'
import { logToChat } from '@/lib/chat-logger'

/**
 * POST /api/brand/generate — WP-B4
 *
 * Produces a single brand deliverable (logo, guideline, business card, etc.)
 * by assembling the brand data → deliverable template → prompt, calling Nano
 * Banana at the deliverable's declared aspect ratio, saving the result to
 * `public/{sessionId}/brand/brand-{vibeKey}-{deliverableId}-v{n}.jpg`, and
 * appending an entry to `IMAGES.md` under a `## Brand Assets` section.
 *
 * Request:
 *   {
 *     sessionId: string
 *     vibeKey: string                // e.g. "vibe-1"
 *     deliverableId: DeliverableId
 *     brandOverrides?: Partial<BrandData>  // inline edits from the UI
 *     imageRef?: string                    // optional reference image filename
 *                                          //   (session-relative)
 *   }
 *
 * Response:
 *   { success: true, filename, url, prompt }
 *   { success: false, error }
 */

interface BrandGenerateBody {
  sessionId?: string
  vibeKey?: string
  deliverableId?: string
  brandOverrides?: Partial<BrandData>
  imageRef?: string
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Pick the next available `-v{n}.jpg` suffix for a given base stem.
 * e.g. existing v1 → returns v2; none exist → returns v1.
 */
async function nextVersionFilename(dir: string, base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = `${base}-v${n}.jpg`
    if (!(await fileExists(path.join(dir, candidate)))) return candidate
  }
  return `${base}-v${Date.now()}.jpg`
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as BrandGenerateBody | null
    if (!body) {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }
    const { sessionId, vibeKey, deliverableId, brandOverrides, imageRef } = body

    if (!sessionId || !vibeKey || !deliverableId) {
      return NextResponse.json(
        { success: false, error: 'sessionId, vibeKey, and deliverableId are required' },
        { status: 400 }
      )
    }

    // Resolve the deliverable template
    const deliverable = findDeliverable(deliverableId as DeliverableId)
    if (!deliverable) {
      return NextResponse.json(
        { success: false, error: `Unknown deliverable: ${deliverableId}` },
        { status: 400 }
      )
    }

    // Assemble brand data: server-side parse of VIBE-N.md, then merge overrides.
    // Client-side flow typically passes complete `brandOverrides`; the file
    // fallback covers API-direct callers and stale-state recoveries.
    const fromFile = await brandDataFromFile(sessionId, vibeKey)
    const brand: BrandData = {
      businessName: brandOverrides?.businessName ?? fromFile?.businessName ?? '',
      fontHeading: brandOverrides?.fontHeading ?? fromFile?.fontHeading ?? '',
      fontBody: brandOverrides?.fontBody ?? fromFile?.fontBody ?? '',
      audience: brandOverrides?.audience ?? fromFile?.audience ?? '',
      mood: brandOverrides?.mood ?? fromFile?.mood ?? '',
      colors: brandOverrides?.colors ?? fromFile?.colors ?? [],
      voiceSample: brandOverrides?.voiceSample ?? fromFile?.voiceSample ?? '',
      oneLiner: brandOverrides?.oneLiner ?? fromFile?.oneLiner,
    }

    if (!isBrandDataComplete(brand)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Brand data incomplete. Required: businessName, fontHeading, ≥2 colors, mood. Provide via brandOverrides or ensure VIBE-N.md has these fields.',
        },
        { status: 400 }
      )
    }

    // Load reference image (optional) — Nano Banana accepts base64
    const referenceImages: string[] = []
    if (imageRef && imageRef.trim()) {
      const refPath = path.join(process.cwd(), 'public', sessionId, imageRef.trim())
      try {
        const buf = await readFile(refPath)
        const mime = imageRef.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
        referenceImages.push(`data:${mime};base64,${buf.toString('base64')}`)
      } catch {
        console.warn(`[brand/generate] imageRef not found: ${refPath} — continuing without.`)
      }
    }

    // Build the prompt from the deliverable template
    const userPrompt = deliverable.build(brand, imageRef || undefined)

    // ── WP-15 rule 10: brand sub-tab inherits the proofread → verdict contract ──
    const proofread = await runProofread({
      sessionId,
      mode: 'brand' as 'generate' | 'edit' | 'compose' | 'layout',
      prompt: userPrompt,
      image: imageRef ? { filename: imageRef } : undefined,
    })
    const actualPrompt = proofread.finalPrompt
    if (proofread.severity === 'rewritten') {
      await logToChat(sessionId, {
        kind: 'cd-rewrite',
        content: `**Note:** ${proofread.note}\n\n**Original (deliverable: ${deliverable.label}):**\n\`\`\`\n${userPrompt}\n\`\`\`\n\n**CD's rewrite:**\n\`\`\`\n${actualPrompt}\n\`\`\``,
        source: `image-mode:brand`,
      })
    }
    console.log(
      `[brand/generate] Proofread: severity=${proofread.severity} ${proofread.durationMs}ms`
    )

    // Call Nano Banana with the deliverable's declared aspect ratio
    const { imageUrl, geminiText } = await generateImage({
      prompt: actualPrompt,
      referenceImages: referenceImages.length ? referenceImages : undefined,
      aspectRatio: deliverable.aspectRatio,
      imageSize: '2K',
    })

    // Decode + save
    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '')
    const brandDir = path.join(process.cwd(), 'public', sessionId, 'brand')
    await mkdir(brandDir, { recursive: true })

    const baseStem = `brand-${vibeKey.toLowerCase()}-${deliverable.id}`
    const finalFilename = await nextVersionFilename(brandDir, baseStem)
    const filePath = path.join(brandDir, finalFilename)
    await writeFile(filePath, Buffer.from(base64Data, 'base64'))

    // Auto-catalog to IMAGES.md under a `## Brand Assets` section.
    // Idempotent: if the section exists, append; otherwise create it.
    try {
      const imagesPath = path.join(process.cwd(), 'public', sessionId, 'IMAGES.md')
      const existing = await readFile(imagesPath, 'utf-8').catch(() => '# Image Descriptions\n')
      const ts = new Date().toTimeString().slice(0, 8)
      const entry =
        `\n### brand/${finalFilename}\n` +
        `- **Deliverable:** ${deliverable.label} (${deliverable.id})\n` +
        `- **Vibe:** ${vibeKey}\n` +
        `- **Aspect:** ${deliverable.aspectRatio}\n` +
        `- **Generated:** ${ts}\n` +
        (geminiText ? `- **Nano Banana:** ${geminiText}\n` : '')

      let updated: string
      if (/^##\s+Brand\s+Assets\b/m.test(existing)) {
        // Append to existing section — insert just before the next `## ` or EOF
        const reSection = /(^##\s+Brand\s+Assets\b[\s\S]*?)(?=\n##\s|\Z)/m
        updated = existing.replace(reSection, (block) => block.trimEnd() + '\n' + entry)
        if (updated === existing) {
          // Fallback: plain append to EOF
          updated = existing.trimEnd() + '\n' + entry
        }
      } else {
        updated = existing.trimEnd() + '\n\n## Brand Assets\n' + entry
      }
      await writeFile(imagesPath, updated, 'utf-8')
    } catch (catalogErr) {
      console.warn('[brand/generate] IMAGES.md catalog append failed:', catalogErr)
      // Non-fatal — the asset still exists on disk
    }

    // ── WP-15 rule 6: post-gen verdict (also for brand) ──
    const verdict = await runVerdict({
      sessionId,
      filename: `brand/${finalFilename}`,
      nanoDescription: geminiText || undefined,
      originalPrompt: actualPrompt,
      mode: 'brand' as 'generate' | 'edit' | 'compose' | 'layout',
    })
    if (verdict.verdict === '✗') {
      await logToChat(sessionId, {
        kind: 'cd-verdict-fail',
        content: `**Verdict:** ✗\n**Note:** ${verdict.note}`,
        ref: `brand/${finalFilename}`,
        source: `image-mode:brand`,
      })
    }
    console.log(
      `[brand/generate] Verdict: ${verdict.verdict} ${verdict.durationMs}ms`
    )

    return NextResponse.json({
      success: true,
      filename: finalFilename,
      url: `/${sessionId}/brand/${finalFilename}`,
      deliverable: deliverable.id,
      aspectRatio: deliverable.aspectRatio,
      // Audit fields per WP-15 §"Prompt integrity"
      userPrompt,
      actualPromptSent: actualPrompt,
      geminiText: verdict.adjustedDescription || geminiText || null,
      proofread,
      verdict,
    })
  } catch (error) {
    console.error('[brand/generate] POST failed:', error)
    return NextResponse.json(
      { success: false, error: `Failed to generate brand asset: ${error}` },
      { status: 500 }
    )
  }
}
