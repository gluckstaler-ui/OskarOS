/**
 * vibe-verify.ts — post-build sanity check for vibe HTMLs.
 *
 * WebDev's old "success" criterion was "the file exists." That hides every
 * render-time failure: broken image refs, malformed HTML, half-written files
 * after a timeout, agent that wrote a chat reply instead of a webpage.
 *
 * This module adds a thin verification floor:
 *   - HTML parses with jsdom (catches malformed markup)
 *   - File contains a `<body>` (catches truncated / agent-confused output)
 *   - Every `<img src="...">` resolves to a real file in the session folder
 *   - Every `background-image: url(...)` resolves
 *   - No empty src/href attributes that would render as blank
 *
 * NOT an exhaustive renderer check — for that we'd need a headless browser.
 * This catches the cheap-to-detect failures fast.
 */

import { readFile, stat } from 'fs/promises'
import { JSDOM } from 'jsdom'
import path from 'path'

export interface VerifyIssue {
  kind: 'parse' | 'no-body' | 'missing-image' | 'missing-bg' | 'empty-src' | 'empty-href'
  detail: string
}

/**
 * Run sanity checks on a built vibe HTML. Returns a list of issues — empty
 * means the file passes. Caller decides whether to fail the build, log a
 * warning, or quarantine the file.
 */
export async function verifyVibeHtml(
  filename: string,
  sessionPath: string,
): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = []
  const filePath = path.join(sessionPath, filename)

  let html: string
  try {
    html = await readFile(filePath, 'utf-8')
  } catch (err) {
    issues.push({ kind: 'parse', detail: `cannot read ${filename}: ${err}` })
    return issues
  }

  // ── HTML parses ───────────────────────────────────────────────────────
  let dom: JSDOM
  try {
    dom = new JSDOM(html)
  } catch (err) {
    issues.push({ kind: 'parse', detail: `jsdom failed: ${err}` })
    return issues
  }
  const doc = dom.window.document

  // ── Body present (catches "agent wrote a chat reply") ─────────────────
  if (!doc.body || doc.body.children.length === 0) {
    issues.push({ kind: 'no-body', detail: 'document has no <body> or body is empty' })
    // Don't bail — keep collecting issues even if body is empty
  }

  // ── Every <img src> resolves ──────────────────────────────────────────
  // jsdom's NodeList types come back loose; cast through Element for type safety.
  const imgs = Array.from(doc.querySelectorAll('img')) as Element[]
  for (const img of imgs) {
    const src = img.getAttribute('src')
    if (src === null) continue   // <img> without src is unusual but not fatal
    if (src.trim() === '') {
      issues.push({ kind: 'empty-src', detail: `<img> has empty src` })
      continue
    }
    if (!isLocalRef(src)) continue   // remote / data: URLs — skip
    const exists = await fileExists(sessionPath, src)
    if (!exists) {
      issues.push({ kind: 'missing-image', detail: `<img src="${src}"> not found in session folder` })
    }
  }

  // ── Every background-image: url(...) resolves ─────────────────────────
  // Scan inline styles AND <style> blocks. Same approach as vibe-slots.ts.
  const bgUrls = new Set<string>()
  const styledEls = Array.from(doc.querySelectorAll('[style*="background-image"]')) as Element[]
  for (const el of styledEls) {
    const style = el.getAttribute('style') || ''
    for (const m of style.matchAll(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi)) {
      bgUrls.add(m[1])
    }
  }
  const styleBlocks = Array.from(doc.querySelectorAll('style')) as Element[]
  for (const styleBlock of styleBlocks) {
    const css = styleBlock.textContent || ''
    for (const m of css.matchAll(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi)) {
      bgUrls.add(m[1])
    }
    // Also catch shorthand `background: url(...)`
    for (const m of css.matchAll(/background:\s*[^;]*url\(['"]?([^'")\s]+)['"]?\)/gi)) {
      bgUrls.add(m[1])
    }
  }
  for (const url of bgUrls) {
    if (!isLocalRef(url)) continue
    const exists = await fileExists(sessionPath, url)
    if (!exists) {
      issues.push({ kind: 'missing-bg', detail: `background-image url("${url}") not found in session folder` })
    }
  }

  // ── No empty hrefs that suggest broken navigation ─────────────────────
  const anchors = Array.from(doc.querySelectorAll('a')) as Element[]
  for (const a of anchors) {
    const href = a.getAttribute('href')
    if (href !== null && href.trim() === '') {
      issues.push({ kind: 'empty-href', detail: `<a> has empty href` })
    }
  }

  return issues
}

/**
 * Parse a JSON manifest line from the trailing output of the WebDev agent.
 *
 * The agent is instructed to end its response with a single JSON line like:
 *   {"filename": "vibe-5.html", "vibeIndex": 5, "vibeName": "Home Staging"}
 *
 * We scan the LAST 20 lines (forgiving — agent may add a blank line or two
 * after) for a parseable JSON object containing `filename`. Returns null if
 * none found — caller falls back to defaults.
 */
export interface VibeManifest {
  filename: string
  vibeIndex: number
  vibeName: string
}

export function parseTrailingJson(output: string): VibeManifest | null {
  const lines = output.trim().split('\n')
  // Walk from the end back through the last 20 lines
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    try {
      const parsed = JSON.parse(line)
      if (typeof parsed.filename === 'string' && parsed.filename.endsWith('.html')) {
        return {
          filename: parsed.filename,
          vibeIndex: typeof parsed.vibeIndex === 'number' ? parsed.vibeIndex : 0,
          vibeName: typeof parsed.vibeName === 'string' ? parsed.vibeName : parsed.filename.replace(/\.html$/, ''),
        }
      }
    } catch {
      // Not parseable JSON — keep walking
    }
  }
  return null
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isLocalRef(src: string): boolean {
  if (!src) return false
  if (/^data:/i.test(src)) return false
  if (/^https?:\/\//i.test(src)) return false
  if (/^\/\//.test(src)) return false   // protocol-relative
  return true
}

async function fileExists(sessionPath: string, src: string): Promise<boolean> {
  // Strip any query string from the src (cache-busters etc.)
  const cleanSrc = src.split('?')[0].split('#')[0]
  // Strip a leading "/sessionId/" if present (some HTMLs use absolute paths)
  const localName = cleanSrc.startsWith('/')
    ? cleanSrc.split('/').pop() || cleanSrc
    : cleanSrc
  const resolved = path.isAbsolute(cleanSrc)
    ? cleanSrc
    : path.join(sessionPath, localName)
  try {
    const s = await stat(resolved)
    return s.isFile()
  } catch {
    return false
  }
}
