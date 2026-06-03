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
import { publish } from '@/lib/event-bus'
import { findBinary } from '@/lib/cli-paths'

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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

  // Ralph 2026-05-25 · target resolution has TWO modes:
  //
  //  1. Root-relative path ("/admin.html", "/whatever.html") — for global
  //     pages that live outside any session folder. This is what CD needs
  //     to audit the CRM (admin.html). Previously the only way for CD to
  //     screenshot admin.html was to bail out to a raw Playwright script —
  //     the MCP tool flat-out refused. Now we treat any target starting
  //     with `/` as public-root-relative.
  //
  //  2. Vibe slug / filename — for session artifacts ("vibe-3" or
  //     "vibe-3-the-deployment.html"). Resolved inside `public/{session}/`
  //     as before.
  //
  // The session screenshots dir is still used for output in both modes —
  // sessionId is the audit-scope, regardless of what was screenshotted.
  let htmlFilename: string | null = null
  let targetUrl: string
  let outputSlug: string

  if (body.target.startsWith('/')) {
    // Root-relative target. Works for BOTH a static file in public/ ("/admin.html")
    // AND a Next.js route with no file on disk ("/crm"). Ralph 2026-05-30 — the old
    // `existsSync(public/<target>)` gate 404'd every Next route (the live CRM is at
    // /crm, server-rendered, no public/crm.* file), which is why the Consular's
    // screenshot tool "only reached static public/* files." We navigate the real
    // URL instead; a genuinely-missing target is caught by the HTTP status check
    // after page.goto below.
    htmlFilename = body.target
    targetUrl = `${baseUrl}${body.target}`
    // "/admin.html" → "admin"; "/crm" → "crm"; "/foo/bar.html" → "foo-bar"
    outputSlug = body.target.replace(/^\//, '').replace(/\//g, '-').replace(/\.html?$/, '') || 'root'
  } else {
    // Session-scoped resolution: if already .html, use as-is; otherwise
    // treat as slug and scan the folder for `{slug}*.html` matches.
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
        { error: `Target not found: no HTML file matched "${body.target}" in session folder. For global pages outside the session (e.g. admin.html), use a leading slash: "/admin.html".` },
        { status: 404 },
      )
    }
    targetUrl = `${baseUrl}/${body.sessionId}/${htmlFilename}`
    outputSlug = htmlFilename.replace(/\.html$/, '')
  }

  const screenshotsDir = path.join(sessionDir, 'screenshots')
  await mkdir(screenshotsDir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outputName = `${outputSlug}-${frame}-${ts}.png`
  const outputPath = path.join(screenshotsDir, outputName)
  const publicSavedPath = `/${body.sessionId}/screenshots/${outputName}`

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

  // 2026-05-04 (Ralph): observability for the empty-body root cause.
  // The api-client.ts:142 crash that surfaced as `Cannot read properties
  // of undefined (reading 'slice')` came from THIS route returning an
  // empty 500 body. The defensive patch in Commit A keeps the api-client
  // from crashing, but the underlying cause — Playwright timing out
  // because Next.js dev-server is busy serving THIS route while
  // Playwright tries to fetch the vibe HTML through the SAME server —
  // still needs a fix. Logging every step lets us see which await throws.
  const probe = { stage: 'launch', t0: Date.now() }
  const log = (stage: string) => {
    console.log(`[/api/mcp/screenshot] target=${htmlFilename} stage=${stage} elapsed=${Date.now() - probe.t0}ms`)
    probe.stage = stage
  }
  log('launch')
  let browser
  // WP-128 (2026-06-02): resolve via the shared chromium candidate list
  // (lib/cli-paths.ts) — same source as lib/thumbnail-generator.ts — so this
  // works on Linux/WSL. CHROMIUM_BIN overrides; macOS /Applications and the
  // apt/snap paths are candidates. We still pass an explicit executablePath so
  // Playwright never falls back to its (uninstalled) bundled-browser cache.
  const installedChromium = findBinary('chromium')
  if (!existsSync(installedChromium)) {
    return NextResponse.json(
      {
        error: `Chromium not found (resolved "${installedChromium}")`,
        hint: 'macOS: drop Chromium.app in /Applications. Linux/WSL: `apt install chromium-browser`, or set CHROMIUM_BIN. See windows/README.md.',
      },
      { status: 500 },
    )
  }
  try {
    browser = await chromium.launch({ headless: true, executablePath: installedChromium })
  } catch (err) {
    console.error(`[/api/mcp/screenshot] chromium.launch failed at ${installedChromium}:`, err)
    return NextResponse.json(
      {
        error: `Playwright launch failed: ${err instanceof Error ? err.message : String(err)}`,
        executablePath: installedChromium,
      },
      { status: 500 },
    )
  }
  try {
    log('newContext')
    const ctx = await browser.newContext({ viewport: dims })
    log('newPage')
    const page = await ctx.newPage()
    log(`goto:${targetUrl}`)
    const resp = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30_000 })
    // Catch a genuinely-missing target (typo'd file, dead route) via the real
    // HTTP status — replaces the old public/* file-existence gate, and works
    // uniformly for static files AND Next routes.
    if (resp && resp.status() >= 400) {
      return NextResponse.json(
        { error: `Target "${body.target}" returned HTTP ${resp.status()} (${targetUrl})` },
        { status: 404 },
      )
    }
    log('screenshot')
    const buffer = await page.screenshot({ fullPage: true, type: 'png' })
    log('writeFile')
    await writeFile(outputPath, buffer)
    log('done')

    // WP-22 Phase 1 (Ralph 2026-05-06): publish so the chat surface can
    // render a ScreenshotCard. base64 stays out of the event payload —
    // savedPath is enough; the <img> renders from disk via /public.
    try {
      publish(body.sessionId, {
        type: 'screenshot_taken',
        savedPath: publicSavedPath,
        target: htmlFilename,
        frame,
        dims,
      })
    } catch {}

    return NextResponse.json({
      savedPath: publicSavedPath,
      base64: buffer.toString('base64'),
      frame,
      dims,
      target: htmlFilename,
    })
  } catch (err) {
    console.error(`[/api/mcp/screenshot] failed at stage=${probe.stage}:`, err)
    return NextResponse.json(
      {
        error: `Screenshot failed at stage=${probe.stage}: ${err instanceof Error ? err.message : String(err)}`,
        stage: probe.stage,
        targetUrl,
      },
      { status: 500 },
    )
  } finally {
    await browser.close().catch(() => {})
  }
}
