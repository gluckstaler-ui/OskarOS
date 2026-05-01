/**
 * /api/mcp/screenshot — Playwright render (Phase 2 Tier S).
 *
 * Resolves a target slug ("vibe-3") OR filename ("vibe-3-foo.html") to an
 * HTML file in the session folder, opens a Chromium page, captures a
 * full-page PNG. Saves to `public/{session}/screenshots/` and returns the
 * saved path. Order 66 wipes this directory — screenshots are session-
 * scoped evidence, not durable state.
 *
 * Frame:
 *   mobile  — 390x844  (iPhone 14)
 *   tablet  — 820x1180 (iPad Air)
 *   desktop — 1280x800 (default)
 *
 * No TTL, no cache. Each call writes a fresh file with an ISO timestamp
 * so the agent can compare before/after iterations.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readdir, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FRAME_DIMS: Record<string, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1280, height: 800 },
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { sessionId?: string; target?: string; frame?: string }
    | null
  if (!body?.sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!body.target || typeof body.target !== 'string') {
    return NextResponse.json({ error: 'target required' }, { status: 400 })
  }

  const frame = body.frame && FRAME_DIMS[body.frame] ? body.frame : 'desktop'
  const dims = FRAME_DIMS[frame]
  const sessionDir = path.join(process.cwd(), 'public', body.sessionId)

  // Resolve target → HTML file. If it already ends in .html, use as-is.
  // Otherwise treat as slug, scan the folder for `{slug}*.html` or
  // `{slug}-*.html` matches.
  let htmlFilename: string | null = null
  if (body.target.endsWith('.html')) {
    if (existsSync(path.join(sessionDir, body.target))) {
      htmlFilename = body.target
    }
  } else {
    try {
      const files = await readdir(sessionDir)
      const candidate =
        files.find((f) => f === `${body.target}.html`) ||
        files.find((f) => f.startsWith(`${body.target}-`) && f.endsWith('.html'))
      htmlFilename = candidate || null
    } catch {
      // sessionDir missing — fall through to error below
    }
  }

  if (!htmlFilename) {
    return NextResponse.json(
      { error: `Target not found: no HTML file matched "${body.target}" in session folder` },
      { status: 404 },
    )
  }

  const screenshotsDir = path.join(sessionDir, 'screenshots')
  await mkdir(screenshotsDir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const slug = htmlFilename.replace(/\.html$/, '')
  const outputName = `${slug}-${frame}-${ts}.png`
  const outputPath = path.join(screenshotsDir, outputName)
  const publicSavedPath = `/${body.sessionId}/screenshots/${outputName}`
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const targetUrl = `${baseUrl}/${body.sessionId}/${htmlFilename}`

  // Lazy-load Playwright so the route doesn't try to import a 500MB
  // browser bundle during the test suite. `playwright` is in devDependencies;
  // we import the chromium driver only when the route is actually called.
  let chromium: typeof import('playwright').chromium
  try {
    const pw = await import('playwright')
    chromium = pw.chromium
  } catch (err) {
    return NextResponse.json(
      { error: `Playwright not available: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext({ viewport: dims })
    const page = await ctx.newPage()
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30_000 })
    const buffer = await page.screenshot({ fullPage: true, type: 'png' })
    await writeFile(outputPath, buffer)

    return NextResponse.json({
      savedPath: publicSavedPath,
      base64: buffer.toString('base64'),
      frame,
      dims,
      target: htmlFilename,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  } finally {
    await browser.close().catch(() => {})
  }
}
