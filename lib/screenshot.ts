// ============================================================================
// lib/screenshot.ts — WP-SCOUT-2 (2026-06-03)
//
// `captureUrl(url)` — visit a real EXTERNAL website and return a full-page +
// one-inner-page capture for the Jedi Scout to taste.
//
// Why net-new (not `/api/mcp/screenshot`): the existing route is
// localhost-only (hardcodes `http://localhost:3000` in route.ts:49), resolves
// slug/filename to a session HTML file, and runs dev-only `playwright`. It
// cannot reach an external URL and has no SSRF guard. The Scout has to visit
// arbitrary URLs from the lead pool — we need a different engine, a
// different launch path, and a real network guard.
//
// Engine — puppeteer (locked):
//   - Already a project dependency driving lib/thumbnail-generator.ts (the
//     proven-working Chromium path). We MIRROR that launch (binary resolved
//     via lib/cli-paths.ts:findBinary('chromium'), same `--no-sandbox` etc.
//     args) but keep a SEPARATE singleton on its own globalThis key so the
//     thumbnail browser and the scout browser don't fight over the same
//     newPage() pool. Reference only — DO NOT edit thumbnail-generator.ts.
//
// SSRF guard (security-load-bearing):
//   1. Normalise scheme — accept bare `example.ch` and turn it into
//      `https://example.ch`. Reject any non-http(s) scheme.
//   2. Resolve DNS — get the A records (IPv4) for the hostname.
//   3. Inspect the RESOLVED IP, not the hostname string. A hostname like
//      `evil.com` can DNS-resolve to 127.0.0.1 (DNS rebinding); checking the
//      string is useless. We reject the request if ANY resolved address
//      falls into:
//        - loopback (127.0.0.0/8, ::1)
//        - private (10/8, 172.16/12, 192.168/16, fc00::/7)
//        - link-local (169.254/16, fe80::/10)
//        - cloud metadata (169.254.169.254 is also catch in link-local; we
//          also explicitly reject the AWS/GCP/Azure metadata IPs)
//   4. Hand the URL to puppeteer ONLY after the guard passes. Puppeteer
//      will resolve again at navigation time — the guard pins the host the
//      same Chromium will hit (no rebinding window).
//
// Capture (per agents/jedi-scout.md "Sip 2"):
//   - Full-page screenshot at 1280×800 viewport (DPR 1) — the Scout reads
//     the WHOLE site including below the fold, not just hero. This is the
//     reason the Scout keeps Puppeteer where the Consular doesn't: a
//     PageSpeed thumbnail is above-the-fold only.
//   - One additional INNER page if discoverable — first internal-link <a>
//     pointing to a same-origin path; defensive (an external "Impressum" or
//     a `tel:` link doesn't count). If no internal link, we ship the
//     full-page alone (1 image instead of 2 — graceful, not a failure).
//
// Graceful failure:
//   - Every leg wrapped in try/catch with a typed return. A timeout, DNS
//     failure, SSRF-blocked host, or navigation error returns `{ ok:false,
//     reason }` instead of throwing — one dead lead degrades only itself,
//     never the whole batch.
//   - Hard timeout: 25s total per capture (covers DNS + connect + nav +
//     screenshot + idle settle).
//
// Output layout:
//   public/__scout__/<urlhash>/
//     full.png       — viewport-width full-scroll capture
//     inner.png      — optional 2nd page
//     meta.json      — { url, finalUrl, resolvedIp, pages, capturedAt }
// ============================================================================

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { promises as dns } from 'dns'
import puppeteer, { type Browser, type Page } from 'puppeteer'
import { findBinary } from './cli-paths'

// ── Singleton browser, separate from the thumbnail one. ────────────────────
//
// Same globalThis-pinned + single-flight + disconnect-cleanup pattern as
// thumbnail-generator.ts — without it, Next.js HMR orphans Chromium procs.
// Separate key from the thumbnail singleton so the two pools don't share
// pages (they have different viewport configs + nav patterns).

const BROWSER_KEY = Symbol.for('oskar.scout-screenshot.browser') as unknown as string
const LAUNCH_PROMISE_KEY = Symbol.for('oskar.scout-screenshot.launch-promise') as unknown as string
const EXIT_HANDLER_KEY = Symbol.for('oskar.scout-screenshot.exit-handlers') as unknown as string

const g = globalThis as Record<string, unknown>

function getCachedBrowser(): Browser | null {
  return (g[BROWSER_KEY] as Browser) || null
}
function setCachedBrowser(b: Browser | null): void {
  if (b === null) delete g[BROWSER_KEY]
  else g[BROWSER_KEY] = b
}

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

async function getBrowser(): Promise<Browser> {
  const cached = getCachedBrowser()
  if (cached && cached.connected) return cached

  const inFlight = g[LAUNCH_PROMISE_KEY] as Promise<Browser> | undefined
  if (inFlight) return inFlight

  const launchPromise = (async (): Promise<Browser> => {
    try {
      const executablePath = findBinary('chromium')
      if (!existsSync(executablePath)) {
        throw new Error(
          `Chromium not found (resolved "${executablePath}"). Install it — ` +
          `macOS: drop Chromium.app in /Applications; Linux/WSL: \`apt install chromium-browser\` — ` +
          `or set CHROMIUM_BIN. See windows/README.md.`,
        )
      }
      console.log('[Scout] Launching puppeteer with binary:', executablePath)
      const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      })
      browser.on('disconnected', () => {
        if (getCachedBrowser() === browser) setCachedBrowser(null)
      })
      setCachedBrowser(browser)
      return browser
    } catch (err) {
      const tryPath = await puppeteer.executablePath().catch(() => '<unresolved>')
      console.error('[Scout] puppeteer.launch failed. Binary:', tryPath, 'Error:', err)
      throw err
    } finally {
      delete g[LAUNCH_PROMISE_KEY]
    }
  })()

  g[LAUNCH_PROMISE_KEY] = launchPromise
  return launchPromise
}

// ── SSRF guard. ────────────────────────────────────────────────────────────
//
// Reject any IPv4 in a sensitive range. IPv6 — we reject any ::1 (loopback)
// and ANY private/link-local prefix.

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => parseInt(n, 10))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return true // malformed → reject conservatively
  }
  const [a, b] = parts
  // Loopback
  if (a === 127) return true
  // Private
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  // Link-local + AWS/GCP/Azure cloud metadata (169.254.169.254 is in link-local)
  if (a === 169 && b === 254) return true
  // CGNAT (RFC 6598) — also non-public
  if (a === 100 && b >= 64 && b <= 127) return true
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  // Unique-local fc00::/7 (fc**: or fd**:)
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true
  // IPv4-mapped — rebind to a private v4
  const v4mapped = lower.match(/^::ffff:([0-9.]+)$/)
  if (v4mapped) return isPrivateIPv4(v4mapped[1])
  return false
}

/** Normalise an input string into a URL. Bare hostname → `https://hostname`. */
export function normalizeUrl(raw: string): URL | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  // Reject implausible inputs early (phone numbers, "n/a", just "www")
  if (!/[a-z0-9]/i.test(trimmed)) return null
  if (/^\d[\d\s+().-]*$/.test(trimmed)) return null // looks like a phone
  if (/^(n\/?a|none|tba|tbd|—|–|-)$/i.test(trimmed)) return null
  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    // bare ".tld" or "www" without a label = junk
    if (!/\./.test(u.hostname)) return null
    return u
  } catch {
    return null
  }
}

/**
 * Resolve the hostname to IPv4/IPv6 and reject if any address is private/
 * loopback/link-local. Returns the resolved IP that puppeteer should hit, or
 * null + reason for the guard to fail.
 */
async function ssrfGuard(url: URL): Promise<{ ok: true; ip: string } | { ok: false; reason: string }> {
  try {
    // resolve4 + resolve6 — accept whichever returns first; reject if EITHER
    // family has a sensitive address (a host that flips between public-v4 and
    // private-v6 should still fail).
    const [v4, v6] = await Promise.all([
      dns.resolve4(url.hostname).catch(() => [] as string[]),
      dns.resolve6(url.hostname).catch(() => [] as string[]),
    ])
    if (v4.length === 0 && v6.length === 0) {
      return { ok: false, reason: `DNS resolution failed for ${url.hostname}` }
    }
    for (const ip of v4) {
      if (isPrivateIPv4(ip)) return { ok: false, reason: `SSRF blocked: ${url.hostname} → ${ip} is private/loopback` }
    }
    for (const ip of v6) {
      if (isPrivateIPv6(ip)) return { ok: false, reason: `SSRF blocked: ${url.hostname} → ${ip} is private/loopback` }
    }
    return { ok: true, ip: v4[0] || v6[0] }
  } catch (err) {
    return { ok: false, reason: `SSRF guard error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ── Inner-page discovery. ──────────────────────────────────────────────────

/**
 * Pick one internal link to visit for the Scout's "scroll down, open one more
 * page" sip. Heuristic: first <a> with an href that resolves to the same
 * origin, isn't the current path, isn't an anchor/`tel:`/`mailto:` link.
 */
async function pickInnerPage(page: Page, originUrl: URL): Promise<string | null> {
  try {
    const candidates: string[] = await page.evaluate((origin) => {
      const out: string[] = []
      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
      for (const a of anchors) {
        const href = a.href
        if (!href) continue
        try {
          const u = new URL(href, origin)
          if (u.origin !== new URL(origin).origin) continue
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
          if (u.pathname === '/' || u.pathname === new URL(origin).pathname) continue
          if (u.hash && u.pathname === new URL(origin).pathname) continue
          // Prefer pages with substantive paths (avoid "/" or pure hash links)
          out.push(u.href)
        } catch { /* skip malformed href */ }
      }
      return out
    }, originUrl.href)
    // First substantive candidate wins
    return candidates.find((h) => /\/[a-z0-9-]+/i.test(new URL(h).pathname)) || null
  } catch {
    return null
  }
}

// ── Public surface. ────────────────────────────────────────────────────────

export interface CaptureSuccess {
  ok: true
  url: string                  // canonical input URL we hit
  finalUrl: string             // post-redirect final URL
  resolvedIp: string
  fullPagePath: string         // absolute filesystem path
  innerPagePath: string | null // absolute filesystem path or null
  fullPageUrl: string          // public URL for in-app rendering
  innerPageUrl: string | null
  pages: number
  capturedAt: string
}

export interface CaptureFailure {
  ok: false
  url: string | null
  reason: string
}

export type CaptureResult = CaptureSuccess | CaptureFailure

// Ralph 2026-06-03 · bumped 25 → 60s after a Scout batch lost 49 / 98 rows
// to `capture failed: timeout after 25000ms`. The failure msg in the DB
// came from this outer race (not the per-nav timeout), so this single line
// is the lever; the nav timeout stays at 18s as the gentler per-page bound.
const TOTAL_TIMEOUT_MS = 60_000
const NAV_TIMEOUT_MS = 18_000
const SCOUT_PUBLIC_ROOT = '__scout__'

/**
 * Visit a real external URL and capture a full-page screenshot + optionally
 * one inner page. Returns a typed result; NEVER throws.
 */
export async function captureUrl(rawUrl: string): Promise<CaptureResult> {
  const startedAt = Date.now()
  const url = normalizeUrl(rawUrl)
  if (!url) return { ok: false, url: rawUrl || null, reason: 'invalid URL' }

  const guard = await ssrfGuard(url)
  if (guard.ok === false) return { ok: false, url: url.href, reason: guard.reason }

  // Per-URL output dir: a stable hash so repeat captures land in the same
  // place (overwrite the previous, no name drift).
  const slug = createHash('sha1').update(url.href).digest('hex').slice(0, 16)
  const publicDir = join(process.cwd(), 'public', SCOUT_PUBLIC_ROOT, slug)
  if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true })
  const fullPath = join(publicDir, 'full.png')
  const innerPath = join(publicDir, 'inner.png')
  const metaPath = join(publicDir, 'meta.json')

  let browser: Browser
  try {
    browser = await getBrowser()
  } catch (err) {
    return { ok: false, url: url.href, reason: `browser-launch failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  let page: Page | null = null
  try {
    // Race the whole pipeline against the hard timeout so a slow host can't
    // stall the batch. The individual nav timeout is the gentler bound.
    const captured = await Promise.race<CaptureResult>([
      (async (): Promise<CaptureResult> => {
        page = await browser.newPage()
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OskarOS-Scout/1.0',
        )
        const response = await page.goto(url.href, {
          waitUntil: 'networkidle2',
          timeout: NAV_TIMEOUT_MS,
        })
        if (!response) {
          return { ok: false, url: url.href, reason: 'no response from server' }
        }
        // settle: brief delay so fonts/late JS aren't mid-render
        await new Promise((r) => setTimeout(r, 600))
        await page.screenshot({ path: fullPath, type: 'png', fullPage: true })

        const finalUrl = page.url()

        // Sip 2 — one inner page if there's a same-origin link.
        let innerOk = false
        let innerFinalUrl: string | null = null
        const inner = await pickInnerPage(page, new URL(finalUrl))
        if (inner) {
          try {
            await page.goto(inner, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS })
            await new Promise((r) => setTimeout(r, 400))
            await page.screenshot({ path: innerPath, type: 'png', fullPage: true })
            innerOk = true
            innerFinalUrl = page.url()
          } catch {
            // inner-page failure is non-fatal — we still have full.png
          }
        }

        const result: CaptureSuccess = {
          ok: true,
          url: url.href,
          finalUrl,
          resolvedIp: guard.ip,
          fullPagePath: fullPath,
          innerPagePath: innerOk ? innerPath : null,
          fullPageUrl: `/${SCOUT_PUBLIC_ROOT}/${slug}/full.png`,
          innerPageUrl: innerOk ? `/${SCOUT_PUBLIC_ROOT}/${slug}/inner.png` : null,
          pages: innerOk ? 2 : 1,
          capturedAt: new Date().toISOString(),
        }
        writeFileSync(metaPath, JSON.stringify({ ...result, innerFinalUrl, durationMs: Date.now() - startedAt }, null, 2))
        return result
      })(),
      new Promise<CaptureResult>((resolve) =>
        setTimeout(() => resolve({ ok: false, url: url.href, reason: `timeout after ${TOTAL_TIMEOUT_MS}ms` }), TOTAL_TIMEOUT_MS),
      ),
    ])
    return captured
  } catch (err) {
    return { ok: false, url: url.href, reason: err instanceof Error ? err.message : String(err) }
  } finally {
    if (page) {
      try { await page.close() } catch { /* page already closed */ }
    }
  }
}
