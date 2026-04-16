// ==========================================
// Thumbnail Generator
// On-demand screenshot generation for vibe HTML pages
// ==========================================

import puppeteer, { Browser } from 'puppeteer'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// Thumbnail dimensions
const THUMBNAIL_WIDTH = 320
const THUMBNAIL_HEIGHT = 180

// Cache for browser instance (reuse across requests)
let browserInstance: Browser | null = null

/**
 * Get or create a browser instance
 */
async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance
  }

  // Try common Chromium paths (macOS Homebrew, Linux, etc.)
  const chromiumPaths = [
    '/opt/homebrew/bin/chromium',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ]

  let executablePath: string | undefined
  const { existsSync } = await import('fs')
  for (const p of chromiumPaths) {
    if (existsSync(p)) {
      executablePath = p
      break
    }
  }

  browserInstance = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  })

  return browserInstance
}

/**
 * Get the thumbnail path for a vibe
 */
export function getThumbnailPath(sessionId: string, vibeFile: string): string {
  const publicDir = join(process.cwd(), 'public')
  const thumbnailDir = join(publicDir, 'thumbnails', sessionId)

  // Create thumbnails directory if it doesn't exist
  if (!existsSync(thumbnailDir)) {
    mkdirSync(thumbnailDir, { recursive: true })
  }

  // Generate thumbnail filename (vibe-1.html -> vibe-1.png)
  const thumbnailName = vibeFile.replace(/\.html$/, '.png')
  return join(thumbnailDir, thumbnailName)
}

/**
 * Check if thumbnail exists
 */
export function thumbnailExists(sessionId: string, vibeFile: string): boolean {
  const thumbnailPath = getThumbnailPath(sessionId, vibeFile)
  return existsSync(thumbnailPath)
}

/**
 * Get the public URL for a thumbnail
 */
export function getThumbnailUrl(sessionId: string, vibeFile: string): string {
  const thumbnailName = vibeFile.replace(/\.html$/, '.png')
  return `/thumbnails/${sessionId}/${thumbnailName}`
}

/**
 * Generate a thumbnail for a vibe HTML page
 * Returns the path to the generated thumbnail
 */
export async function generateThumbnail(
  sessionId: string,
  vibeFile: string,
  baseUrl: string
): Promise<string> {
  const thumbnailPath = getThumbnailPath(sessionId, vibeFile)

  // If thumbnail already exists, return it
  if (existsSync(thumbnailPath)) {
    return thumbnailPath
  }

  const browser = await getBrowser()
  const page = await browser.newPage()

  try {
    // Set viewport to capture at higher resolution, then scale down
    // This gives us a crisp thumbnail
    await page.setViewport({
      width: 1280,
      height: 720,
      deviceScaleFactor: 1
    })

    // Navigate to the vibe HTML page
    const vibeUrl = `${baseUrl}/${sessionId}/${vibeFile}`
    await page.goto(vibeUrl, {
      waitUntil: 'networkidle0',
      timeout: 30000
    })

    // Wait a bit for any animations/fonts to load
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))

    // Take screenshot and resize
    await page.screenshot({
      path: thumbnailPath,
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: 1280,
        height: 720
      }
    })

    // Use sharp or canvas to resize if needed, but for now
    // we'll generate at target size by using a smaller viewport
    // Re-take at correct size
    await page.setViewport({
      width: THUMBNAIL_WIDTH * 2,  // 2x for retina-quality
      height: THUMBNAIL_HEIGHT * 2,
      deviceScaleFactor: 1
    })

    await page.reload({ waitUntil: 'networkidle0' })
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))

    await page.screenshot({
      path: thumbnailPath,
      type: 'png'
    })

    return thumbnailPath

  } finally {
    await page.close()
  }
}

/**
 * Generate thumbnails for all vibes in a session
 */
export async function generateAllThumbnails(
  sessionId: string,
  vibeFiles: string[],
  baseUrl: string
): Promise<Map<string, string>> {
  const results = new Map<string, string>()

  for (const vibeFile of vibeFiles) {
    try {
      const path = await generateThumbnail(sessionId, vibeFile, baseUrl)
      results.set(vibeFile, path)
    } catch (error) {
      console.error(`[Thumbnail] Failed to generate for ${vibeFile}:`, error)
    }
  }

  return results
}

/**
 * Close the browser instance (call on server shutdown)
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close()
    browserInstance = null
  }
}
