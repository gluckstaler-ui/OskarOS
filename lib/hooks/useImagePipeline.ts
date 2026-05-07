'use client'

/**
 * useImagePipeline — extracts the image generation subsystem out of page.tsx.
 *
 * The pipeline is the 150-line state machine that:
 *   1. Takes an ImageAsset (filename, instruction, source images, resolution)
 *   2. Sets manifest status → 'generating'
 *   3. Calls /api/edit-image (Nano Banana via Gemini)
 *   4. On success: updates manifest, pushes the generated image to the global
 *      sourceImages array, logs to IMAGES.md, emits snackbar events, and
 *      triggers a hot-swap into matching vibe HTML slots
 *   5. On error: marks the manifest entry as 'error' and emits an error event
 *
 * It also owns two pieces of state that belong to this subsystem:
 *   - `imageQueue` — pending uploads/edits the user queued up
 *   - `imageManifests` — per-vibe asset tables (the "book" of images-by-slot)
 *
 * What stays in page.tsx:
 *   - `sourceImages` — too many non-pipeline consumers (Director Mode,
 *     AdvancedMode, vibeCards memo, etc.) to move cleanly. The hook receives
 *     a `onAssetRegenerated` callback so it can push into that array without
 *     owning it.
 *   - `selectedAsset` — UI state. Hook receives a callback for when the
 *     currently-viewed asset is the one that just finished.
 *
 * Why this exists: page.tsx was a 2871-line "toddler torso" with 33
 * useCallbacks whose dep arrays mixed pipeline state with unrelated concerns.
 * Extracting this subsystem creates a clean boundary — future callers
 * (AdvancedMode's Generate tab, image remix flows, chat-triggered regen)
 * reuse `generateAsset` without re-implementing the state machine.
 */

import { useCallback, useState } from 'react'
import type { ImageAsset, ImageManifest, ImageQueueItem, SourceImage } from '@/lib/types'
import { logImageGenerationAction, hotSwapAction } from '@/lib/session-actions'
// 2026-04-30 Phase 2: emitHotSwap + emitImageReady removed from this hook.
// Server-side publish in /api/edit-image, /api/generate-image, and
// /api/sessions/[id]/assign-slot is the single source of truth now.
// We still need emitError + emitRegenerating for client-only flows.
import { emitError, emitRegenerating } from '@/lib/session-events'

export interface UseImagePipelineConfig {
  /** Current session id — required for /api/edit-image + IMAGES.md logging +
   *  hot-swap to route to the right folder. `null` is allowed so the hook
   *  is safe to call before a session exists; generation simply short-circuits. */
  sessionId: string | null
  /** The id of the asset currently being viewed in the UI (if any). When a
   *  generation result comes back for this asset, the hook notifies via
   *  `onSelectedAssetUpdate`. Pass `null`/`undefined` when nothing is selected. */
  selectedAssetId?: string | null
  /** Called when the generation result should replace the currently-viewed
   *  asset (usually `setSelectedAsset`). */
  onSelectedAssetUpdate?: (asset: ImageAsset) => void
  /** Called with the new SourceImage to push into the global sourceImages
   *  array (so it appears in asset panels). Typically wraps a setSourceImages
   *  state updater. */
  onAssetRegenerated?: (newImage: SourceImage) => void
}

export interface UseImagePipelineValue {
  /** Pending uploads/edits — state setter exposed for upload handlers. */
  imageQueue: ImageQueueItem[]
  setImageQueue: React.Dispatch<React.SetStateAction<ImageQueueItem[]>>
  /** Per-vibe asset tables. */
  imageManifests: ImageManifest[]
  setImageManifests: React.Dispatch<React.SetStateAction<ImageManifest[]>>
  /**
   * Kick off a Nano Banana generation for the given asset. Single entry
   * point; handles the full state-machine (generating → complete | error),
   * updates manifests, emits snackbars, and hot-swaps matching vibe slots.
   */
  generateAsset: (asset: ImageAsset) => Promise<void>
}

export function useImagePipeline({
  sessionId,
  selectedAssetId,
  onSelectedAssetUpdate,
  onAssetRegenerated,
}: UseImagePipelineConfig): UseImagePipelineValue {
  const [imageQueue, setImageQueue] = useState<ImageQueueItem[]>([])
  const [imageManifests, setImageManifests] = useState<ImageManifest[]>([])

  const generateAsset = useCallback(
    async (asset: ImageAsset) => {
      // ─── Mark as generating ─────────────────────────────────────────────
      setImageManifests(prev => {
        const exists = prev.some(m => m.assets.some(a => a.id === asset.id))
        if (exists) {
          return prev.map(manifest => ({
            ...manifest,
            assets: manifest.assets.map(a =>
              a.id === asset.id ? { ...a, status: 'generating' as const } : a
            ),
          }))
        }
        // New standalone asset — add to existing 'standalone' manifest or create one.
        const standaloneIdx = prev.findIndex(m => m.vibeId === 'standalone')
        const generatingAsset: ImageAsset = { ...asset, status: 'generating' as const }
        if (standaloneIdx >= 0) {
          return prev.map((m, i) =>
            i === standaloneIdx
              ? { ...m, assets: [...m.assets, generatingAsset] }
              : m
          )
        }
        return [
          ...prev,
          { vibeId: 'standalone', vibeName: 'Generated', assets: [generatingAsset] },
        ]
      })

      if (selectedAssetId === asset.id) {
        onSelectedAssetUpdate?.({ ...asset, status: 'generating' })
      }

      if (sessionId) {
        emitRegenerating(sessionId, asset.filename, asset.instruction)
      }

      // ─── Network call ───────────────────────────────────────────────────
      try {
        const response = await fetch('/api/edit-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceImagePaths: asset.sourceImages,
            instruction: asset.instruction,
            // Send the asset's target filename (CD-supplied or
            // manifest-constructed, e.g. `vibe-1-the-standard-hero-v1.jpg`)
            // as the hint. The server respects this when present and not
            // generic; falls back to slugging Nano's description only
            // when no real hint exists. Restored Ralph 2026-04-25 — the
            // pipeline was previously discarding `asset.filename` and
            // letting Nano's camera-vocabulary preamble name the file.
            filename: asset.filename,
            imageSize: asset.resolution,
            aspectRatio: asset.aspectRatio,
            operation: asset.operation,
            sessionId,
            // Ralph 2026-05-04: parent prompt id (e.g. `img-goofy-v1`)
            // so the server can nest the generated `#### filename` under
            // the right `### img-N` block instead of orphan-appending
            // it to the end of the section (which made it visually
            // misfile as an upload).
            promptId: asset.promptId,
          }),
        })
        const data = await response.json()
        if (data.error) {
          throw new Error(data.error)
        }

        // ─── Success ──────────────────────────────────────────────────────
        const updatedAsset: ImageAsset = {
          ...asset,
          status: 'complete',
          resultPath: data.savedPath,
          resultUrl: data.imageUrl,
          generatedUrl: data.savedPath,
        }

        setImageManifests(prev =>
          prev.map(manifest => ({
            ...manifest,
            assets: manifest.assets.map(a => (a.id === asset.id ? updatedAsset : a)),
          }))
        )

        if (selectedAssetId === asset.id) {
          onSelectedAssetUpdate?.(updatedAsset)
        }

        console.log(`Generated ${asset.filename} -> ${data.savedPath}`)

        // ─── IMAGES.md + hot-swap + sourceImages push ────────────────────
        if (sessionId && data.savedPath) {
          const filename = data.savedPath.split('/').pop() || asset.filename
          const newImage: SourceImage = {
            id: `generated-${asset.id}-${Date.now()}`,
            filename,
            path: data.savedPath,
            uploadedAt: new Date().toISOString(),
            analysis: {
              elements: [],
              description: `Generated for ${asset.vibeName} (${asset.usage}): ${asset.instruction.slice(0, 100)}`,
              suggestedExtractions: [],
            },
            isGenerated: true,
            sourcePrompt: asset.instruction,
            generationStatus: 'pending',
            // Preserves the pre-existing behavior; the ImageTag typing quirk
            // at this field is a known outstanding issue elsewhere in the
            // codebase — not introduced by this extraction.
            tag: (asset.vibeName?.toUpperCase() || 'B-ROLL') as SourceImage['tag'],
          }
          onAssetRegenerated?.(newImage)

          await logImageGenerationAction(
            sessionId,
            filename,
            asset.instruction,
            asset.vibeName,
            asset.usage,
            data.geminiText || undefined
          )

          // 2026-04-30 Phase 2: removed `emitImageReady(...)` here.
          // /api/edit-image and /api/generate-image already publish
          // `image_ready` to the event-bus server-side; the /api/events SSE
          // delivers it to BOTH the frontend (sessionEvents) AND the MCP
          // server (CD as logging notification). Single source of truth.

          // Hot-swap — fills matching data-slot elements in vibe HTMLs.
          // 2026-04-30 Phase 2: removed `emitHotSwap(...)` here for the
          // same reason. /api/sessions/[id]/assign-slot publishes
          // `hotswap_complete` server-side. Client-side emit was a duplicate.
          if (asset.usage) {
            const swapResult = await hotSwapAction(sessionId, filename, asset.usage)
            if (swapResult.success && swapResult.result?.vibesUpdated.length) {
              console.log(
                `🔄 Hot-swapped ${filename} into ${swapResult.result.vibesUpdated.length} vibes`
              )
            }
          }
        }
      } catch (error) {
        // ─── Error ────────────────────────────────────────────────────────
        console.error('Generation error:', error)
        const errorAsset: ImageAsset = {
          ...asset,
          status: 'error',
          error: String(error),
        }
        setImageManifests(prev =>
          prev.map(manifest => ({
            ...manifest,
            assets: manifest.assets.map(a => (a.id === asset.id ? errorAsset : a)),
          }))
        )
        if (selectedAssetId === asset.id) {
          onSelectedAssetUpdate?.(errorAsset)
        }
        if (sessionId) {
          emitError(sessionId, `Failed to generate ${asset.filename}: ${error}`)
        }
      }
    },
    [sessionId, selectedAssetId, onSelectedAssetUpdate, onAssetRegenerated]
  )

  return {
    imageQueue,
    setImageQueue,
    imageManifests,
    setImageManifests,
    generateAsset,
  }
}
