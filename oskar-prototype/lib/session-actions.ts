'use server'

/**
 * Server Actions for Session Operations
 *
 * These run on the server and can access the filesystem directly.
 * No API routes needed.
 */

import {
  listSessions,
  createSession,
  getSession,
  deleteSession,
  updateSessionPhase,
  updateWorkflowState,
  saveUploadedImage,
  appendToSessionLog,
  updateImagesMd,
  updateBuildMd,
  populateCreativeBrief,
  readCreativeBrief,
  renameSession,
  parseImagesMd,
  ParsedImageEntry,
  SessionListItem,
  Session,
  SessionPhase,
  WorkflowState,
  CreativeBriefContent
} from './session'
import { hotSwap, autoHotSwap, HotSwapResult } from './hot-swap'
// analyze() removed — CD reads uploaded images itself via Read tool
import { ImageManifest, ImageAsset } from './types'

/**
 * List all sessions
 */
export async function listSessionsAction(): Promise<SessionListItem[]> {
  return listSessions()
}

/**
 * Create a new session
 */
export async function createSessionAction(businessName: string = 'New Session'): Promise<{
  success: boolean
  sessionId?: string
  error?: string
}> {
  try {
    const session = await createSession(businessName)
    return { success: true, sessionId: session.id }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Rename a session folder after discovering the business name
 */
export async function renameSessionAction(oldSessionId: string, businessName: string): Promise<{
  success: boolean
  newSessionId?: string
  error?: string
}> {
  try {
    const newSessionId = await renameSession(oldSessionId, businessName)
    return { success: true, newSessionId }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Get a session by ID
 */
export async function getSessionAction(sessionId: string): Promise<Session | null> {
  return getSession(sessionId)
}

/**
 * Delete a session
 */
export async function deleteSessionAction(sessionId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await deleteSession(sessionId)
    return { success: true }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Update session phase
 */
export async function updatePhaseAction(
  sessionId: string,
  phase: SessionPhase
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateSessionPhase(sessionId, phase)
    return { success: true }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Upload an image to a session
 * The file data comes as base64 to avoid multipart form handling
 */
export async function uploadImageAction(
  sessionId: string,
  filename: string,
  base64Data: string,
  mimeType: string
): Promise<{
  success: boolean
  filename?: string
  path?: string
  analysis?: any
  error?: string
}> {
  try {
    // Decode base64 to buffer
    const rawData = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(rawData, 'base64')

    // Save to session folder
    const savedFilename = await saveUploadedImage(sessionId, filename, buffer)

    // CD reads uploaded images itself via Read tool — no Nano Banana analysis needed
    return {
      success: true,
      filename: savedFilename,
      path: `/${sessionId}/${savedFilename}`,
      analysis: null
    }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Append a conversation entry to SESSION.md
 */
export async function appendToSessionLogAction(
  sessionId: string,
  agent: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await appendToSessionLog(sessionId, agent, content)
    return { success: true }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Log an image upload to IMAGES.md
 */
export async function logImageUploadAction(
  sessionId: string,
  filename: string,
  analysis?: { description?: string; elements?: string[] }
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    // Append to IMAGES.md
    let imagesMd = session.imagesMd

    // Replace "No images uploaded yet" if present
    if (imagesMd.includes('*No images uploaded yet*')) {
      imagesMd = imagesMd.replace('*No images uploaded yet*', '')
    }

    const entry = `
### ${filename}
**Uploaded:** ${timestamp}
**Analysis:** ${analysis?.description || 'Pending'}
${analysis?.elements?.length ? `**Elements:** ${analysis.elements.join(', ')}` : ''}

`
    // Insert after "## Uploaded Images" section
    const insertPoint = imagesMd.indexOf('## Uploaded Images')
    if (insertPoint !== -1) {
      const nextSection = imagesMd.indexOf('---', insertPoint)
      imagesMd = imagesMd.slice(0, nextSection) + entry + imagesMd.slice(nextSection)
    } else {
      imagesMd += entry
    }

    await updateImagesMd(sessionId, imagesMd)
    return { success: true }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Log a generated image to IMAGES.md
 * Updates the status of matching prompts and adds generated version as a sub-entry
 *
 * @param vibeName - The vibe name (e.g., "Falcon's Flight")
 * @param purpose - The image purpose/usage (e.g., "sultan-action", "hero")
 */
export async function logImageGenerationAction(
  sessionId: string,
  filename: string,
  prompt: string,
  vibeName?: string,
  purpose?: string,
  description?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    let imagesMd = session.imagesMd

    // Replace "No image prompts yet" if present
    if (imagesMd.includes('*No image prompts yet*')) {
      imagesMd = imagesMd.replace('*No image prompts yet*', '')
    }
    if (imagesMd.includes('*No generated images yet')) {
      imagesMd = imagesMd.replace(/\*No generated images yet[^*]*\*/, '')
    }

    // Try to find and update an existing prompt that matches this generation
    const promptsSection = imagesMd.match(/## Image Prompts \+ Generated\n([\s\S]*?)(?=\n---\n## |$)/)

    let foundAndUpdated = false

    // Normalize vibe and purpose for matching (defined outside block for logging)
    const vibeSlug = vibeName?.toLowerCase().replace(/['']/g, '').replace(/\s+/g, '-')
    const purposeSlug = purpose?.toLowerCase().replace(/\s+/g, '-')

    if (promptsSection && (vibeName || purpose)) {
      // Look for a matching img-xxx entry with the same vibe AND purpose
      const promptEntries = promptsSection[1].split(/\n### /)

      for (let i = 1; i < promptEntries.length; i++) {
        const entry = promptEntries[i]
        const entryId = entry.split('\n')[0].trim()

        // Only update img-xxx entries (not already-generated filenames)
        if (!entryId.startsWith('img-')) continue

        const entryVibe = extractField(entry, 'Vibe')?.toLowerCase().replace(/['']/g, '').replace(/\s+/g, '-')
        const entryPurpose = extractField(entry, 'Purpose')?.toLowerCase().replace(/\s+/g, '-')
        const entryStatus = extractField(entry, 'Status')

        // Match by BOTH vibe AND purpose (both must match if both provided)
        // Note: If entry has no Vibe field (!entryVibe), match on purpose alone
        // This handles img-xxx entries that don't specify a vibe (e.g., "shared" images)
        const vibeMatches = !vibeSlug || !entryVibe || entryVibe === vibeSlug
        const purposeMatches = !purposeSlug || entryPurpose === purposeSlug

        if (vibeMatches && purposeMatches && (vibeSlug || purposeSlug)) {
          // Check if already has this generated version
          if (entry.includes(filename)) {
            foundAndUpdated = true
            break
          }

          // Update status from PENDING to ACTIVE
          let updatedEntry = entry
          if (entryStatus?.toUpperCase() === 'PENDING') {
            updatedEntry = updatedEntry.replace(/\*\*Status:\*\*\s*PENDING/i, '**Status:** ACTIVE')
          }

          // Add generated version as sub-entry
          const generatedSubEntry = `

#### ${filename}
**Generated:** ${timestamp}
**Status:** ACTIVE
${description ? `**Nano Banana:** ${description}` : ''}
`
          // Append the sub-entry
          updatedEntry = updatedEntry + generatedSubEntry

          // Replace the original entry
          promptEntries[i] = updatedEntry
          imagesMd = imagesMd.replace(promptsSection[1], promptEntries.join('\n### '))

          foundAndUpdated = true
          console.log(`📝 Updated img entry: ${entryId} with generated file: ${filename}`)
          break
        }
      }
    }

    // If no matching prompt found, DON'T create a standalone entry
    // This prevents duplicate cards. The asset should already exist in the UI.
    if (!foundAndUpdated) {
      console.log(`⚠️ No matching img-xxx entry found for ${filename}`)
      console.log(`   Looking for: vibeSlug="${vibeSlug}", purposeSlug="${purposeSlug}"`)
      console.log(`   Tip: Ensure IMAGES.md has an img-xxx entry with matching **Purpose:** field`)
      // We still return success - the image was generated, just not logged to an entry
    }

    await updateImagesMd(sessionId, imagesMd)
    return { success: true }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Log a hot-swap to BUILD.md
 */
export async function logHotSwapAction(
  sessionId: string,
  vibe: string,
  slot: string,
  oldImage: string,
  newImage: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    let buildMd = session.buildMd

    // Find the Hot-Swap Log table and append row
    const tableHeader = '| Time | Vibe | Slot | Old | New |'
    const tableIndex = buildMd.indexOf(tableHeader)
    if (tableIndex !== -1) {
      // Find the end of the table header row (after |-----|)
      const headerEnd = buildMd.indexOf('\n', buildMd.indexOf('|-----|', tableIndex)) + 1
      const newRow = `| ${timestamp} | ${vibe} | ${slot} | ${oldImage} | ${newImage} |\n`
      buildMd = buildMd.slice(0, headerEnd) + newRow + buildMd.slice(headerEnd)
    }

    await updateBuildMd(sessionId, buildMd)
    return { success: true }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Update workflow state checkboxes
 */
export async function updateWorkflowStateAction(
  sessionId: string,
  updates: Partial<WorkflowState>
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateWorkflowState(sessionId, updates)
    return { success: true }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Populate CREATIVE-BRIEF.md with structured content
 * Called at phase transitions to build up the brief incrementally
 */
export async function populateCreativeBriefAction(
  sessionId: string,
  content: CreativeBriefContent
): Promise<{ success: boolean; error?: string }> {
  try {
    await populateCreativeBrief(sessionId, content)
    return { success: true }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Read the current CREATIVE-BRIEF.md
 */
export async function readCreativeBriefAction(
  sessionId: string
): Promise<{ success: boolean; brief?: CreativeBriefContent; error?: string }> {
  try {
    const brief = await readCreativeBrief(sessionId)
    return { success: true, brief: brief || undefined }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Hot-swap a generated image into vibes
 * Automatically infers slot from filename pattern: {vibe}-{slot}-v{n}.ext
 */
export async function autoHotSwapAction(
  sessionId: string,
  imageFilename: string
): Promise<{ success: boolean; result?: HotSwapResult; error?: string }> {
  try {
    const result = await autoHotSwap(sessionId, imageFilename)
    return { success: result.success, result, error: result.error }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Hot-swap an image into a specific slot across all vibes
 */
export async function hotSwapAction(
  sessionId: string,
  imageFilename: string,
  slot: string
): Promise<{ success: boolean; result?: HotSwapResult; error?: string }> {
  try {
    const result = await hotSwap(sessionId, imageFilename, slot)
    return { success: result.success, result, error: result.error }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Move images from /uploads/ staging area to session folder
 * Returns updated paths for each image
 * Called when session is created AFTER images were uploaded
 */
export async function moveImagesToSessionAction(
  sessionId: string,
  imagePaths: string[]  // e.g., ['/uploads/1234-hero.jpg', ...]
): Promise<{
  success: boolean
  movedImages?: Array<{ oldPath: string; newPath: string; filename: string }>
  error?: string
}> {
  try {
    const path = await import('path')
    const fs = await import('fs/promises')

    const sessionDir = path.join(process.cwd(), 'public', sessionId)
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')

    // Ensure session directory exists
    await fs.mkdir(sessionDir, { recursive: true })

    const movedImages: Array<{ oldPath: string; newPath: string; filename: string }> = []

    for (const imagePath of imagePaths) {
      // Extract filename from path (e.g., '/uploads/1234-hero.jpg' -> '1234-hero.jpg')
      const filename = path.basename(imagePath)
      const sourcePath = path.join(uploadsDir, filename)
      const destPath = path.join(sessionDir, filename)

      try {
        // Copy file (use copy instead of move in case uploads are shared)
        await fs.copyFile(sourcePath, destPath)

        const newPath = `/${sessionId}/${filename}`
        movedImages.push({
          oldPath: imagePath,
          newPath,
          filename
        })

        console.log(`📦 Moved image: ${imagePath} -> ${newPath}`)
      } catch (err) {
        console.error(`Failed to move ${imagePath}:`, err)
        // Continue with other images even if one fails
      }
    }

    return { success: true, movedImages }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Parse IMAGES.md and return image manifests for AssetsPanel
 * Reads the filesystem (source of truth) and returns structured data for UI
 */
export async function getImageManifestsAction(
  sessionId: string
): Promise<{ success: boolean; manifests?: ImageManifest[]; error?: string }> {
  try {
    const session = await getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const manifests: Map<string, ImageManifest> = new Map()
    const content = session.imagesMd

    // Find the "## Image Prompts + Generated" section
    const promptsSection = content.match(/## Image Prompts \+ Generated\n([\s\S]*?)(?=\n## |\n---\n## |$)/)
    if (!promptsSection) {
      return { success: true, manifests: [] }
    }

    const section = promptsSection[1]

    // Parse each image entry (### img-xxx)
    const entries = section.split(/\n### /).slice(1)

    for (const entry of entries) {
      const lines = entry.trim().split('\n')
      const promptId = lines[0].trim()

      if (!promptId || promptId.includes('No image prompts')) continue

      // Only process img-xxx entries (skip standalone filename entries created by old fallback)
      // Standalone entries like "### falcon-s-flight-hero-v1-123.jpg" should be ignored
      if (!promptId.startsWith('img-')) continue

      // Parse fields from the ### level (prompt definition)
      const vibe = extractField(entry, 'Vibe') || 'shared'
      const purpose = extractField(entry, 'Purpose') || 'hero'
      const aspectRatio = extractField(entry, 'Aspect Ratio') || '16:9'

      // Extract prompt (multi-line) — supports both bold "**Prompt:**" and plain "Prompt:"
      const promptMatch = entry.match(/(?:\*\*)?Prompt(?:\s+to\s+Nano\s+Banana)?(?:\*\*)?:\s*([\s\S]*?)(?=\n---|\n####|\n\*\*[A-Z]|\n### |$)/)
      const instruction = promptMatch ? promptMatch[1].trim() : ''

      // Normalize vibe: "shared (all vibes)" / "all" / "shared" → shared
      // Multi-vibe: "SAYF, THE HUNT" → split and assign to each
      const isShared = /^(?:shared|all)\b/i.test(vibe)
      const vibeList = isShared
        ? [{ vibeName: 'shared', displayName: 'All Vibes (Shared)' }]
        : vibe.split(/,\s*/).map(v => ({
            vibeName: v.trim().toLowerCase().replace(/\s+/g, '-'),
            displayName: v.trim()
          }))

      for (const { vibeName: normalizedVibe, displayName: vibeDisplayName } of vibeList) {
      const vibeId = normalizedVibe === 'shared' ? 'vibe-shared' : `vibe-${normalizedVibe}`
      if (!manifests.has(vibeId)) {
        manifests.set(vibeId, {
          vibeId,
          vibeName: vibeDisplayName,
          assets: []
        })
      }

      // Check for generated versions (#### level)
      const generatedVersions = entry.split(/\n#### /).slice(1)

      if (generatedVersions.length > 0) {
        // Parse each generated version
        for (const version of generatedVersions) {
          const actualFilename = version.split('\n')[0].trim()
          const versionStatus = extractField(version, 'Status') || 'PENDING'
          const versionStatusLower = versionStatus.toLowerCase()

          // Map status - recognize all valid generated image statuses as 'complete'
          // Valid statuses: READY, HERO, B-ROLL, APPROVED, TRASH, REDO, ACTIVE, etc.
          let assetStatus: 'pending' | 'generating' | 'complete' | 'error' = 'pending'
          if (versionStatusLower.includes('generating')) {
            assetStatus = 'generating'
          } else if (versionStatusLower.includes('error') || versionStatusLower.includes('failed')) {
            assetStatus = 'error'
          } else if (versionStatusLower.includes('pending')) {
            assetStatus = 'pending'
          } else {
            // Any other status (READY, HERO, B-ROLL, APPROVED, TRASH, REDO, ACTIVE, REPLACED, etc.)
            // means the image was generated and exists
            assetStatus = 'complete'
          }

          // Determine operation from instruction or default
          let assetOperation: 'generate' | 'extract' | 'compose' | 'enhance' | 'edit' = 'generate'
          const instructionLower = instruction.toLowerCase()
          if (instructionLower.includes('extract') || instructionLower.includes('remove background')) {
            assetOperation = 'extract'
          } else if (instructionLower.includes('composite') || instructionLower.includes('compose')) {
            assetOperation = 'compose'
          } else if (instructionLower.includes('enhance')) {
            assetOperation = 'enhance'
          } else if (instructionLower.includes('edit')) {
            assetOperation = 'edit'
          }

          // Extract source for modifications
          const source = extractField(version, 'Source') || extractField(entry, 'Source')
          const sourceImages = source ? [source] : []

          // Build result path for generated images
          const resultPath = assetStatus === 'complete' ? `/${sessionId}/${actualFilename}` : undefined
          const generatedUrl = resultPath  // For display purposes

          // Create asset for this version
          const asset = {
            id: `${vibeId}-${actualFilename}`,
            filename: actualFilename,
            operation: assetOperation as ImageAsset['operation'],
            sourceImages,
            instruction,
            usage: purpose as ImageAsset['usage'],
            aspectRatio: aspectRatio as ImageAsset['aspectRatio'],
            resolution: '2K' as ImageAsset['resolution'],
            status: assetStatus,
            vibeId,
            vibeName: vibeDisplayName,
            isActive: versionStatusLower.includes('active'),
            isReplaced: versionStatusLower.includes('replaced'),
            resultPath,
            generatedUrl,
            rawStatus: versionStatus  // Store raw status for filtering (HERO, READY, B-ROLL, etc.)
          }

          manifests.get(vibeId)!.assets.push(asset as ImageAsset)
        }
      } else {
        // No versions yet = pending prompt, no generated images
        const constructedFilename = `${normalizedVibe}-${purpose}-v1.jpg`

        const asset = {
          id: `${vibeId}-${promptId}`,
          filename: constructedFilename,
          operation: 'generate' as const,
          sourceImages: [],
          instruction,
          usage: purpose as ImageAsset['usage'],
          aspectRatio: aspectRatio as ImageAsset['aspectRatio'],
          resolution: '2K' as ImageAsset['resolution'],
          status: 'pending' as const,
          vibeId,
          vibeName: vibeDisplayName,
          isActive: false,
          isReplaced: false,
          rawStatus: 'PENDING'  // Pending prompt - not yet generated
        }

        manifests.get(vibeId)!.assets.push(asset as ImageAsset)
      }
      } // end vibeList loop
    }

    // Also parse Manipulations section
    const manipSection = content.match(/## Manipulations\n([\s\S]*?)(?=\n## |$)/)
    if (manipSection) {
      const manipEntries = manipSection[1].split(/\n### /).slice(1)

      for (const entry of manipEntries) {
        const filename = entry.split('\n')[0].trim()
        if (!filename || filename.includes('No manipulations')) continue

        const source = extractField(entry, 'Source')
        const operation = extractField(entry, 'Operation') || 'extract'
        const status = extractField(entry, 'Status') || 'PENDING'
        const usedIn = extractField(entry, 'Used in')

        // Extract instruction
        const instructionMatch = entry.match(/\*\*Instruction(?:\s+to\s+Nano\s+Banana)?:\*\*\s*([\s\S]*?)(?=\n\*\*[A-Z]|$)/)
        const instruction = instructionMatch ? instructionMatch[1].trim() : operation

        // Try to infer vibe from "Used in" field
        let vibeName = 'Shared'
        let vibeId = 'vibe-shared'

        if (usedIn) {
          const vibeMatch = usedIn.match(/vibe-\d+-([a-z]+)/i)
          if (vibeMatch) {
            vibeName = vibeMatch[1].charAt(0).toUpperCase() + vibeMatch[1].slice(1)
            vibeId = `vibe-${vibeMatch[1].toLowerCase()}`
          }
        }

        // Create vibe manifest if doesn't exist
        if (!manifests.has(vibeId)) {
          manifests.set(vibeId, {
            vibeId,
            vibeName,
            assets: []
          })
        }

        // Map status
        let assetStatus: 'pending' | 'generating' | 'complete' | 'error' = 'pending'
        const statusLower = status.toLowerCase()
        if (statusLower.includes('active') || statusLower.includes('complete')) {
          assetStatus = 'complete'
        } else if (statusLower.includes('generating')) {
          assetStatus = 'generating'
        } else if (statusLower.includes('error') || statusLower.includes('failed')) {
          assetStatus = 'error'
        }

        // Map operation
        let assetOperation: 'generate' | 'extract' | 'compose' | 'enhance' | 'edit' = 'extract'
        const opLower = operation.toLowerCase()
        if (opLower.includes('composite') || opLower.includes('compose')) {
          assetOperation = 'compose'
        } else if (opLower.includes('enhance')) {
          assetOperation = 'enhance'
        } else if (opLower.includes('edit')) {
          assetOperation = 'edit'
        }

        // Build result path for generated manipulations
        const resultPath = assetStatus === 'complete' ? `/${sessionId}/${filename}` : undefined
        const generatedUrl = resultPath  // For display purposes

        const asset = {
          id: `${vibeId}-${filename}`,
          filename,
          operation: assetOperation as ImageAsset['operation'],
          sourceImages: source ? [source] : [],
          instruction,
          usage: 'extracted' as ImageAsset['usage'],
          aspectRatio: '1:1' as ImageAsset['aspectRatio'],
          resolution: '2K' as ImageAsset['resolution'],
          status: assetStatus,
          vibeId,
          vibeName,
          isActive: statusLower.includes('active'),
          isReplaced: false,
          resultPath,
          generatedUrl,
          rawStatus: status  // Store raw status for filtering
        }

        manifests.get(vibeId)!.assets.push(asset as ImageAsset)
      }
    }

    // Filter to show only ONE card per prompt (the best version)
    // Priority: HERO > READY > APPROVED > B-ROLL > TRASH > PENDING
    const statusPriority = (status: string): number => {
      const s = status.toUpperCase()
      if (s.includes('HERO')) return 100
      if (s.includes('READY')) return 90
      if (s.includes('APPROVED')) return 80
      if (s.includes('B-ROLL')) return 50
      if (s.includes('TRASH') || s.includes('REDO')) return 20
      if (s.includes('PENDING')) return 10
      return 60 // Unknown status - treat as decent
    }

    // Group assets by their instruction (prompt), keep only the best one per prompt
    const filteredManifests = Array.from(manifests.values()).map(manifest => {
      const assetsByPrompt = new Map<string, any>()

      for (const asset of manifest.assets) {
        const promptKey = asset.instruction.substring(0, 100) // Use first 100 chars as key
        const existing = assetsByPrompt.get(promptKey)

        // Get priority from rawStatus (HERO, READY, B-ROLL, etc.)
        const assetPriority = statusPriority((asset as any).rawStatus || 'PENDING')
        const existingPriority = existing ? statusPriority(existing.rawStatus || 'PENDING') : 0

        if (!existing || assetPriority > existingPriority) {
          assetsByPrompt.set(promptKey, asset)
        }
      }

      return {
        ...manifest,
        assets: Array.from(assetsByPrompt.values())
      }
    })

    console.log('📊 Manifests filtered - showing best version per prompt:', filteredManifests.map(m => `${m.vibeName}: ${m.assets.length} assets`))

    return { success: true, manifests: filteredManifests }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}

/**
 * Helper to extract a field value from markdown entry
 */
function extractField(text: string, fieldName: string): string | null {
  // Match both bold "**Field:**" and plain "Field:" formats
  const regex = new RegExp(`(?:\\*\\*)?${fieldName}(?:\\*\\*)?:\\s*([^\\n]+)`, 'i')
  const match = text.match(regex)
  return match ? match[1].trim() : null
}

/**
 * Get parsed image entries from IMAGES.md
 * Returns filename -> {cdAnalysis, reprompt, suggestedUses, suggestedVibes}
 */
export async function getImageEntriesAction(
  sessionId: string
): Promise<{
  success: boolean
  entries?: Record<string, ParsedImageEntry>
  error?: string
}> {
  try {
    const entriesMap = await parseImagesMd(sessionId)
    const entries: Record<string, ParsedImageEntry> = {}
    entriesMap.forEach((value, key) => {
      entries[key] = value
    })
    return { success: true, entries }
  } catch (error) {
    return { success: false, error: `${error}` }
  }
}