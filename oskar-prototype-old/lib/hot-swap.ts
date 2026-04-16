/**
 * Hot-Swap Mechanism
 *
 * Handles replacing placeholder images in vibe HTML files
 * when generated images arrive.
 *
 * How it works:
 * 1. Vibe HTML has: <img src="placeholder.jpg" data-slot="hero">
 * 2. Image arrives: qahwa-hero-v2.jpg
 * 3. Hot-swap: <img src="qahwa-hero-v2.jpg" data-slot="hero">
 * 4. Log to BUILD.md
 * 5. Fire snackbar event
 */

import { readFile, writeFile, readdir } from 'fs/promises'
import path from 'path'
import { updateBuildMd } from './session'

export interface HotSwapResult {
  success: boolean
  vibesUpdated: string[]  // List of vibe filenames that were updated
  slotsSwapped: { vibe: string; slot: string; oldImage: string; newImage: string }[]
  error?: string
}

export interface SlotInfo {
  vibe: string      // e.g., "vibe-1-qahwa-landing.html"
  slot: string      // e.g., "hero"
  currentImage: string
}

/**
 * Get session folder path
 */
function getSessionPath(sessionId: string): string {
  return path.join(process.cwd(), 'public', sessionId)
}

/**
 * Find all data-slot occurrences in session's vibe HTML files
 */
export async function findAllSlots(sessionId: string): Promise<SlotInfo[]> {
  const sessionPath = getSessionPath(sessionId)
  const slots: SlotInfo[] = []

  try {
    const files = await readdir(sessionPath)
    // Include ALL HTML files (vibes can be named like falcon-s-flight-1769606308431.html)
    const vibeFiles = files.filter(f => f.endsWith('.html'))

    for (const vibeFile of vibeFiles) {
      const html = await readFile(path.join(sessionPath, vibeFile), 'utf-8')

      // Find all img tags with data-slot
      const imgPattern = /<img[^>]*data-slot="([^"]+)"[^>]*src="([^"]+)"[^>]*>/gi
      const altPattern = /<img[^>]*src="([^"]+)"[^>]*data-slot="([^"]+)"[^>]*>/gi

      let match: RegExpExecArray | null
      while ((match = imgPattern.exec(html)) !== null) {
        slots.push({
          vibe: vibeFile,
          slot: match[1],
          currentImage: match[2]
        })
      }

      // Reset and try alternate order (src before data-slot)
      let altMatch: RegExpExecArray | null
      while ((altMatch = altPattern.exec(html)) !== null) {
        // Only add if not already found
        if (!slots.find(s => s.vibe === vibeFile && s.slot === altMatch![2])) {
          slots.push({
            vibe: vibeFile,
            slot: altMatch[2],
            currentImage: altMatch[1]
          })
        }
      }

      // Also find CSS background-image with data-slot comment pattern
      // e.g., /* data-slot: hero */ url('image.jpg')
      const cssSlotPattern = /\/\*\s*data-slot:\s*(\w+)\s*\*\/[^)]*url\(['"]?([^'")\s]+)['"]?\)/gi
      let cssMatch: RegExpExecArray | null
      while ((cssMatch = cssSlotPattern.exec(html)) !== null) {
        if (!slots.find(s => s.vibe === vibeFile && s.slot === cssMatch![1])) {
          slots.push({
            vibe: vibeFile,
            slot: cssMatch[1],
            currentImage: cssMatch[2]
          })
        }
      }
    }

    return slots
  } catch (error) {
    console.error('Error finding slots:', error)
    return []
  }
}

/**
 * Find slots that match a specific image purpose
 */
export async function findMatchingSlots(
  sessionId: string,
  targetSlot: string
): Promise<SlotInfo[]> {
  const allSlots = await findAllSlots(sessionId)
  return allSlots.filter(s => s.slot === targetSlot)
}

/**
 * Swap an image in a single HTML file
 */
async function swapInFile(
  filePath: string,
  slot: string,
  newImage: string
): Promise<{ oldImage: string | null; swapped: boolean }> {
  let html = await readFile(filePath, 'utf-8')

  let oldImage: string | null = null
  let swapped = false

  // Pattern 1: img tag with data-slot before src
  const pattern = new RegExp(
    `(<img[^>]*data-slot="${slot}"[^>]*src=")([^"]+)("[^>]*>)`,
    'gi'
  )

  html = html.replace(pattern, (match, prefix, currentSrc, suffix) => {
    oldImage = currentSrc
    swapped = true
    return `${prefix}${newImage}${suffix}`
  })

  // Pattern 2: img tag with src before data-slot
  if (!swapped) {
    const altPattern = new RegExp(
      `(<img[^>]*src=")([^"]+)("[^>]*data-slot="${slot}"[^>]*>)`,
      'gi'
    )

    html = html.replace(altPattern, (match, prefix, currentSrc, suffix) => {
      oldImage = currentSrc
      swapped = true
      return `${prefix}${newImage}${suffix}`
    })
  }

  // Pattern 3: CSS background-image with data-slot comment
  // e.g., /* data-slot: hero */ url('image.jpg')
  if (!swapped) {
    const cssPattern = new RegExp(
      `(\\/\\*\\s*data-slot:\\s*${slot}\\s*\\*\\/[^)]*url\\(['"]?)([^'"\\)\\s]+)(['"]?\\))`,
      'gi'
    )

    html = html.replace(cssPattern, (match, prefix, currentSrc, suffix) => {
      oldImage = currentSrc
      swapped = true
      return `${prefix}${newImage}${suffix}`
    })
  }

  // Pattern 4: CSS background-image in .hero class (common pattern)
  // Match: .hero { ... background: url('image.jpg') ... }
  // Or: background: linear-gradient(...), url('image.jpg') center/cover;
  if (!swapped && slot === 'hero') {
    // More flexible pattern to match background url in .hero section
    const heroPattern = /(\.hero\s*\{[^}]*url\(['"]?)([^'")\s]+)(['"]?\)[^}]*\})/gi
    html = html.replace(heroPattern, (match, prefix, currentSrc, suffix) => {
      oldImage = currentSrc
      swapped = true
      return `${prefix}${newImage}${suffix}`
    })
  }

  if (swapped) {
    await writeFile(filePath, html)
  }

  return { oldImage, swapped }
}

/**
 * Hot-swap an image into all vibes that use that slot
 */
export async function hotSwap(
  sessionId: string,
  newImageFilename: string,
  slot: string
): Promise<HotSwapResult> {
  const sessionPath = getSessionPath(sessionId)
  const result: HotSwapResult = {
    success: true,
    vibesUpdated: [],
    slotsSwapped: []
  }

  try {
    const matchingSlots = await findMatchingSlots(sessionId, slot)

    if (matchingSlots.length === 0) {
      return {
        success: false,
        vibesUpdated: [],
        slotsSwapped: [],
        error: `No vibes found with slot "${slot}"`
      }
    }

    for (const slotInfo of matchingSlots) {
      const filePath = path.join(sessionPath, slotInfo.vibe)
      const { oldImage, swapped } = await swapInFile(filePath, slot, newImageFilename)

      if (swapped && oldImage) {
        result.vibesUpdated.push(slotInfo.vibe)
        result.slotsSwapped.push({
          vibe: slotInfo.vibe,
          slot,
          oldImage,
          newImage: newImageFilename
        })
      }
    }

    // Log to BUILD.md
    await logSwapToBuildMd(sessionId, result.slotsSwapped)

    return result
  } catch (error) {
    return {
      success: false,
      vibesUpdated: [],
      slotsSwapped: [],
      error: `Hot-swap failed: ${error}`
    }
  }
}

/**
 * Log hot-swap to BUILD.md
 */
async function logSwapToBuildMd(
  sessionId: string,
  swaps: { vibe: string; slot: string; oldImage: string; newImage: string }[]
): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  const buildMdPath = path.join(sessionPath, 'BUILD.md')

  try {
    const content = await readFile(buildMdPath, 'utf-8')
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    // Find the Hot-Swap Log table and add entries
    const logSection = content.match(/(## Hot-Swap Log[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|)/m)

    if (logSection) {
      let newContent = content
      for (const swap of swaps) {
        const vibeName = swap.vibe.replace('vibe-', '').replace('.html', '')
        const newRow = `\n| ${timestamp} | ${vibeName} | ${swap.slot} | ${swap.oldImage} | ${swap.newImage} |`

        // Insert after the header row
        const headerEnd = logSection[0].lastIndexOf('|')
        newContent = newContent.replace(
          logSection[0],
          logSection[0] + newRow
        )
      }

      await writeFile(buildMdPath, newContent)
    }
  } catch (error) {
    console.error('Failed to log swap to BUILD.md:', error)
  }
}

/**
 * Update image slots status in BUILD.md for a specific vibe
 */
export async function updateVibeSlotStatus(
  sessionId: string,
  vibeNumber: number,
  slot: string,
  imageName: string
): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  const buildMdPath = path.join(sessionPath, 'BUILD.md')

  try {
    const content = await readFile(buildMdPath, 'utf-8')

    // Find the vibe section and update the slot
    const vibeSection = new RegExp(
      `(### Vibe ${vibeNumber}:[\\s\\S]*?\\| ${slot} \\|)([^|]+)(\\|[^|]*\\|)`,
      'i'
    )

    const newContent = content.replace(vibeSection, `$1 ${imageName} $3`.replace(/\s+/g, ' '))

    if (newContent !== content) {
      await writeFile(buildMdPath, newContent)
    }
  } catch (error) {
    console.error('Failed to update vibe slot status:', error)
  }
}

/**
 * Check if an image is a placeholder
 */
export function isPlaceholder(filename: string): boolean {
  return filename === 'placeholder.jpg' ||
    filename === 'placeholder.png' ||
    filename.startsWith('placeholder') ||
    filename === ''
}

/**
 * Determine the slot type from an image filename
 * Based on naming convention: {vibe}-{purpose}-v{version}.{ext}
 */
export function inferSlotFromFilename(filename: string): string | null {
  // Pattern: qahwa-hero-v1.jpg -> slot is "hero"
  const match = filename.match(/^[\w-]+-(\w+)-v\d+\.\w+$/)
  if (match) {
    return match[1]
  }

  // Also check for simple patterns like hero.jpg, menu-bg.jpg
  const simpleMatch = filename.match(/^([\w-]+)\.\w+$/)
  if (simpleMatch) {
    const name = simpleMatch[1].toLowerCase()
    // Common slot names
    const commonSlots = ['hero', 'menu-bg', 'background', 'portrait', 'icon', 'gallery']
    if (commonSlots.includes(name)) {
      return name
    }
  }

  return null
}

/**
 * Auto-hot-swap: Given a new image file, figure out where it goes and swap it
 */
export async function autoHotSwap(
  sessionId: string,
  newImageFilename: string
): Promise<HotSwapResult> {
  const slot = inferSlotFromFilename(newImageFilename)

  if (!slot) {
    return {
      success: false,
      vibesUpdated: [],
      slotsSwapped: [],
      error: `Could not infer slot from filename: ${newImageFilename}`
    }
  }

  return hotSwap(sessionId, newImageFilename, slot)
}
