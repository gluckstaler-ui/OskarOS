// ==========================================
// Thumbnail Generator
// On-demand screenshot generation for vibe HTML pages
//
// Ralph 2026-05-12 — orphan-leak fix.
//
// Two bugs caused 28 zombie Chromium processes (~3GB RAM) to accumulate
// inside one dev-server lifetime:
//
//   1. Module-level `browserInstance` was lost on Next.js HMR. Each HMR
//      reload reset the variable to null but left the underlying puppeteer
//      process alive in the OS — orphaned. Same shape as the bridge-process
//      manager leak in RESURRECTION.md. Fix: pin to globalThis with a
//      Symbol key (mirrors lib/event-bus.ts pattern).
//
//   2. `getBrowser()` had no single-flight mutex. The admin thumbnail
//      route fires one request per vibe file in parallel — for a 4-vibe
//      session, FOUR getBrowser() calls land before any of them resolves;
//      all four see browserInstance===null, all four launch their own
//      puppeteer browser. First-to-finish wins the cache slot; the other
//      three become orphans. Fix: single-flight via shared promise
//      (mirrors the `sessionPromiseRef` pattern in app/page.tsx).
//
// Plus startup-time orphan sweep + SIGINT/SIGTERM/exit handlers to clean
// up the cached browser on server shutdown.
// ==========================================

import puppeteer, { Browser } from 'puppeteer'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { findBinary } from './cli-paths'

// Thumbnail dimensions
const THUMBNAIL_WIDTH = 320
const THUMBNAIL_HEIGHT = 180

// ── globalThis-pinned state (HMR-safe) ──────────────────────────────────────
//
// Next.js dev compiles each route handler independently and can load
// this module multiple times within ONE Node process. Module-scope
// vars don't survive HMR; globalThis does.
const BROWSER_KEY = Symbol.for('oskar.thumbnail-generator.browser') as unknown as string
const LAUNCH_PROMISE_KEY = Symbol.for('oskar.thumbnail-generator.launch-promise') as unknown as string
const SWEPT_KEY = Symbol.for('oskar.thumbnail-generator.swept') as unknown as string
const EXIT_HANDLER_KEY = Symbol.for('oskar.thumbnail-generator.exit-handlers') as unknown as string

const g = globalThis as Record<string, unknown>

function getCachedBrowser(): Browser | null {
  return (g[BROWSER_KEY] as Browser) || null
}
function setCachedBrowser(b: Browser | null): void {
  if (b === null) {
    delete g[BROWSER_KEY]
  } else {
    g[BROWSER_KEY] = b
  }
}

// Orphan-sweep was removed 2026-05-24 — the async exec(pkill) could race
// with the first launch and kill the newly-spawned browser (chrome spawns
// with the matching "puppeteer_dev_chrome_profile" args). Shutdown handlers
// below + per-process state pin handle the cleanup case without the race.
void SWEPT_KEY // suppress unused-var warning; kept for forward-compat

// Shutdown handlers — close the cached browser cleanly on dev-server stop.
// Registered exactly once per process via the EXIT_HANDLER_KEY guard.
if (!g[EXIT_HANDLER_KEY]) {
  g[EXIT_HANDLER_KEY] = true
  const shutdown = () => {
    const b = getCachedBrowser()
    setCachedBrowser(null)
    if (b) b.close().catch(() => {})
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.once('exit', shutdown)
}

/**
 * Get or create a singleton puppeteer browser.
 *
 * Single-flight: concurrent callers all await the same launch promise
 * instead of each racing to launch their own browser. Without this, the
 * admin thumbnail route (which fires one parallel request per vibe file)
 * spawned N browsers for an N-vibe session and orphaned N-1.
 *
 * HMR-safe: state lives on globalThis so dev-mode module reloads don't
 * lose the reference and orphan the underlying process.
 */
async function getBrowser(): Promise<Browser> {
  const cached = getCachedBrowser()
  if (cached && cached.connected) {
    return cached
  }

  // Single-flight: if a launch is already in flight, await its result.
  const inFlight = g[LAUNCH_PROMISE_KEY] as Promise<Browser> | undefined
  if (inFlight) {
    return inFlight
  }

  const launchPromise = (async (): Promise<Browser> => {
    try {
      // WP-128 (2026-06-02): resolve Chromium via the shared candidate list
      // (lib/cli-paths.ts) instead of hardcoding the macOS path, so this works
      // on Linux/WSL too. CHROMIUM_BIN overrides; otherwise it tries
      // /Applications/Chromium.app (macOS — Ralph's pinned snapshot) then the
      // apt/snap locations (/usr/bin/chromium, chromium-browser, …).
      const executablePath = findBinary('chromium')
      if (!existsSync(executablePath)) {
        throw new Error(
          `Chromium not found (resolved "${executablePath}"). Install it — ` +
          `macOS: drop Chromium.app in /Applications; Linux/WSL: \`apt install chromium-browser\` — ` +
          `or set CHROMIUM_BIN. See windows/README.md.`,
        )
      }
      console.log('[Thumbnail] Launching puppeteer with binary:', executablePath)

      const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          // macOS-safe args. --no-sandbox is needed when puppeteer can't
          // find a setuid sandbox helper; --disable-dev-shm-usage avoids
          // /dev/shm pressure on Linux (no-op on macOS, kept for parity).
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      })

      // If the browser disconnects unexpectedly (crash, killed externally,
      // etc.), drop the cache so the NEXT getBrowser() call launches fresh
      // instead of returning a dead reference.
      browser.on('disconnected', () => {
        if (getCachedBrowser() === browser) setCachedBrowser(null)
      })

      setCachedBrowser(browser)
      return browser
    } catch (err) {
      // Surface the actual launch failure with the resolved binary path so
      // the next debugging session doesn't have to re-derive what went wrong.
      const tryPath = await puppeteer.executablePath().catch(() => '<unresolved>')
      console.error('[Thumbnail] puppeteer.launch failed. Binary:', tryPath, 'Error:', err)
      throw err
    } finally {
      // Clear the in-flight promise so the next cold-cache call can
      // launch again if needed (e.g., after a disconnected event).
      delete g[LAUNCH_PROMISE_KEY]
    }
  })()

  g[LAUNCH_PROMISE_KEY] = launchPromise
  return launchPromise
}

/**
 * Get the thumbnail path for a vibe
 */
export function getThumbnailPath(sessionId: string, vibeFile: string): string {
  const publicDir = join(process.cwd(), 'public')
  const thumbnailDir = join(publicDir, 'thumbnails', sessionId)

  // Mirror any subdir structure in vibeFile (VIBE-1/foo.html → thumbnails/SESSION/VIBE-1/)
  const subDir = vibeFile.includes('/') ? vibeFile.substring(0, vibeFile.lastIndexOf('/')) : ''
  const targetDir = subDir ? join(thumbnailDir, subDir) : thumbnailDir
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
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

    // Single capture at 1280x720. The CSS in admin.html / page.tsx scales
    // the <img> down to display size — no need to re-render at a smaller
    // viewport, which was wasteful and bug-prone (2 navigations, fragile
    // networkidle0 race, blank capture if the small-viewport reload hadn't
    // settled before screenshot). Removed 2026-05-24.
    await page.screenshot({
      path: thumbnailPath,
      type: 'png',
      clip: { x: 0, y: 0, width: 1280, height: 720 },
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
 * Close the browser instance. Auto-invoked on SIGINT/SIGTERM/exit (see the
 * module-init handlers above); also exported for explicit teardown in tests
 * or graceful shutdown code paths.
 */
export async function closeBrowser(): Promise<void> {
  const b = getCachedBrowser()
  setCachedBrowser(null)
  if (b) await b.close().catch(() => {})
}
