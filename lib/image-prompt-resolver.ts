/**
 * image-prompt-resolver.ts — WP-1D: 4-Tier Prompt Pre-Loading Waterfall.
 *
 * When the user selects an image in Advanced Mode, we need to load the
 * existing prompt from the highest-priority source available. This resolver
 * walks a priority chain so CD's pre-written prompts (for hero/vibe slots)
 * don't get lost.
 *
 * Priority order:
 *   1. imageManifests[].assets[].instruction — CD-written manifest prompt
 *      (highest priority — hero images have refined prompts from vibe dev)
 *   2. sourceImage.analysis.reprompt — Explicit reprompt written to IMAGES.md
 *   3. sourceImage.sourcePrompt — Prompt that generated this image
 *   4. '' — Empty, show instructional placeholder
 *
 * Pure logic, no React. Returns both the prompt AND its source so the UI
 * can show an indicator ("From IMAGES.md" / "From generation" / "New" / "Modified").
 */

import type { SourceImage, ImageManifest } from './types'

// ============================================================================
// Types
// ============================================================================

export type PromptSource =
  | 'manifest' // Tier 1: CD wrote this as part of vibe development
  | 'reprompt' // Tier 2: Explicit reprompt in IMAGES.md (analysis.reprompt)
  | 'sourcePrompt' // Tier 3: The prompt that originally generated this image
  | 'none' // Tier 4: No existing prompt — placeholder shown

export interface ResolvedPrompt {
  prompt: string
  source: PromptSource
  /** Human-readable label for the UI indicator. */
  sourceLabel: string
}

// ============================================================================
// Resolver
// ============================================================================

/**
 * Look up the best existing prompt for an image.
 *
 * Priority: manifest → reprompt → sourcePrompt → empty.
 */
export function resolvePrompt(
  image: SourceImage,
  manifests: ImageManifest[]
): ResolvedPrompt {
  // Tier 1: Manifest-based prompt (highest priority — CD refined for vibe slots)
  const manifestPrompt = findManifestPrompt(image, manifests)
  if (manifestPrompt) {
    return {
      prompt: manifestPrompt,
      source: 'manifest',
      sourceLabel: 'From IMAGES.md',
    }
  }

  // Tier 2: Explicit reprompt in analysis (written by CD after eval)
  const reprompt = image.analysis?.reprompt
  if (reprompt && reprompt.trim().length > 0) {
    return {
      prompt: reprompt,
      source: 'reprompt',
      sourceLabel: 'Reprompt',
    }
  }

  // Tier 3: Source prompt (the prompt used to generate this image)
  if (image.sourcePrompt && image.sourcePrompt.trim().length > 0) {
    return {
      prompt: image.sourcePrompt,
      source: 'sourcePrompt',
      sourceLabel: 'From generation',
    }
  }

  // Tier 4: Nothing
  return {
    prompt: '',
    source: 'none',
    sourceLabel: 'New',
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find a manifest asset that matches this image.
 *
 * Match strategies (in order):
 *   1. Asset.resultPath ends with image.filename (generated into this slot)
 *   2. Asset.sourceImages includes image's path/filename (this image is the source)
 *   3. Asset.generatedUrl ends with image.filename
 */
function findManifestPrompt(
  image: SourceImage,
  manifests: ImageManifest[]
): string | null {
  const targetFilename = image.filename
  const targetPath = image.path

  for (const manifest of manifests) {
    for (const asset of manifest.assets) {
      // Match #1: this image IS the result of this asset's generation
      if (asset.resultPath && endsWithFilename(asset.resultPath, targetFilename)) {
        return asset.instruction || null
      }
      // Match #2: this image is listed as a source for this asset
      if (asset.sourceImages && asset.sourceImages.length > 0) {
        if (asset.sourceImages.some((s) => s === targetPath || endsWithFilename(s, targetFilename))) {
          return asset.instruction || null
        }
      }
      // Match #3: generated URL match
      if (asset.generatedUrl && endsWithFilename(asset.generatedUrl, targetFilename)) {
        return asset.instruction || null
      }
    }
  }

  return null
}

function endsWithFilename(path: string, filename: string): boolean {
  return path === filename || path.endsWith('/' + filename)
}
