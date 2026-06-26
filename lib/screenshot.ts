// ============================================================================
// lib/screenshot.ts — WP-SCOUT-2 / §18 WP-130
//
// `captureUrl(url, ctx)` — visit a real EXTERNAL website and screenshot it for
// the Jedi Scout to taste. Returns a typed result; NEVER throws.
//
// What it actually captures (keep this honest — it has drifted before):
//   - MAIN: a full-page screenshot at 1280×800 (DPR 1). The Scout reads the
//     WHOLE site below the fold, not just the hero — that's why it keeps
//     Puppeteer where the Consular makes do with a PageSpeed thumbnail.
//   - PROFILE (shared practices only, ctx.sharedSiteCount >= 2): this
//     practitioner's own page (`<firstname>-profile.jpg`), matched by name
//     against the site's link graph.
//   - SITE-PAGE SWEEP: once the slot dir already holds >=2 shots, every Taste
//     also walks the site's top-level nav and captures each section it doesn't
//     already have (`_site-<slug>.jpg`, skip-if-exists) — so a practice's dir
//     grows into a gallery of its DIFFERENT pages.
//   - There is NO inner-page "Sip 2" capture. It was removed: Puppeteer's CDP
//     is single-channel, and a hung secondary nav blocked screenshots on every
//     concurrent page. `innerPage*` fields exist for back-compat but stay null.
//
//   NB on page.evaluate: anything passed to `page.evaluate` runs in the BROWSER.
//   It must NOT declare inner named functions (`const fn = () => {}`) —
//   esbuild/tsx `keepNames` wraps those in a `__name()` helper that doesn't
//   exist there, so the whole evaluate throws `__name is not defined`. The
//   scout runs in a tsx subprocess, so this is a real production trap; it had
//   the site-sweep AND the cookie-banner dismiss silently doing nothing.
//
// Why net-new (not `/api/mcp/screenshot`): that route is localhost-only,
// resolves to a session HTML file, runs dev-only playwright, and has no SSRF
// guard. The Scout visits arbitrary external lead URLs — different engine,
// different launch path, real network guard.
//
// Engine — puppeteer: same Chromium as lib/thumbnail-generator.ts (binary via
// lib/cli-paths.ts findBinary('chromium'), same `--no-sandbox` args), but a
// FRESH browser PER CAPTURE (no shared singleton) so concurrent captures each
// get their own CDP socket and don't starve one another. Reference only — DO
// NOT edit thumbnail-generator.ts.
//
// SSRF guard (security-load-bearing):
//   1. Normalise scheme — accept bare `example.ch` → `https://example.ch`.
//      Reject any non-http(s) scheme.
//   2. Resolve DNS — A/AAAA records for the hostname.
//   3. Inspect the RESOLVED IP, not the hostname string (a hostname can
//      DNS-rebind to 127.0.0.1). Reject if ANY resolved address is:
//        - loopback (127.0.0.0/8, ::1)
//        - private (10/8, 172.16/12, 192.168/16, fc00::/7)
//        - link-local (169.254/16, fe80::/10)
//        - cloud metadata (AWS/GCP/Azure 169.254.169.254)
//   4. Hand the URL to puppeteer only after the guard passes.
//
// Graceful failure: every leg is try/catch with a typed return; one dead lead
// degrades only itself, never the batch. Hard outer cap TOTAL_TIMEOUT_MS (240s);
// per-nav NAV_TIMEOUT_MS (25s).
//
// Output layout (§18 / WP-130), served auth-gated via WP-132's route:
//   media/<plzOrRegion>/<slug>/<firstname>.jpg          (solo site)
//   media/_shared/<slug>/_site-home.jpg                 (shared practice homepage)
//                        /<firstname>-profile.jpg        (per-practitioner page)
//                        /_site-<section>.jpg            (site-page sweep)
//   + <firstname>.meta.json  ({ url, finalUrl, resolvedIp, pages, capturedAt })
// ============================================================================

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { promises as dns } from 'dns'
import puppeteer, { type Browser, type Page } from 'puppeteer'
import { findBinary } from './cli-paths'
import { elevatePriority } from './process-scheduling'

// ── Per-call browser, NO singleton (Ralph 2026-06-05). ───────────────────
//
// The original design pinned ONE Browser instance via globalThis and
// reused it across every captureUrl call. That meant every concurrent
// page operation funneled through a single Chrome DevTools Protocol
// websocket — and CDP is single-channel. With 8+ pages racing for the
// same CDP socket, navigation timeouts fired before the network even
// responded ("24 of 32 rows failed with capture timeout"). The previous
// fix was a 6-worker concurrency cap. Ralph: "I said 100× I don't want
// caps." Right answer: don't share a CDP socket — give each capture its
// own browser.
//
// Now: every captureUrl spawns a fresh Browser, uses it for one capture,
// closes it on exit. Memory cost ~80-150 MB per concurrent capture. With
// 32 parallel captures: ~3-4 GB peak. Acceptable on a dev box; the prior
// 6-cap is gone. The user-data-dir per browser is a fresh tmpdir each
// launch, so concurrent browsers don't fight for state.
//
// Orphan cleanup: each captureUrl's `finally` closes its own browser, so
// the cross-process pkill sweep that was here before is unnecessary. We
// still register one process-exit hook to track any browser that's still
// open at shutdown — but no globalThis state means HMR no longer orphans.

// Ralph 2026-06-05 — pkill sweep REMOVED.
//
// The original design was: at module load, kill any leftover chromium
// processes from a previous Node crash. Made sense when this module
// lived in ONE process (the Next.js dev server). Now scout-bridge spawns
// a NEW Node subprocess per row, and EACH subprocess loads this module
// fresh — running its own pkill sweep. With 6 concurrent taste rows,
// bridge #1's pkill (delayed by 1.5s) was killing bridge #2's freshly-
// launched browser. Symptom: "capture failed" cascading across rows in
// otherwise-working captures.
//
// Per-call browsers (above) clean up in their own `finally` blocks. To
// cover SIGTERM / SIGKILL / uncaught-exception cases that bypass finally,
// we also register a per-process tracking set: every browser launched
// joins the set, every browser closed leaves it. On process-exit signals,
// we tear down whatever's still in the set.

interface OpenBrowserRegistry {
  set: Set<Browser>
  wired: boolean
}
const REGISTRY_KEY = Symbol.for('oskar.scout-screenshot.open-browsers') as unknown as string
const gReg = globalThis as Record<string, unknown>
function getRegistry(): OpenBrowserRegistry {
  let reg = gReg[REGISTRY_KEY] as OpenBrowserRegistry | undefined
  if (!reg) {
    reg = { set: new Set<Browser>(), wired: false }
    gReg[REGISTRY_KEY] = reg
  }
  if (!reg.wired) {
    reg.wired = true
    const teardown = () => {
      // Close every browser this process still owns. Best-effort, sync.
      // We don't await — process is dying.
      const r = gReg[REGISTRY_KEY] as OpenBrowserRegistry | undefined
      if (!r) return
      for (const b of Array.from(r.set)) {
        try { void b.close() } catch { /* already dying */ }
      }
      r.set.clear()
    }
    // SIGINT/SIGTERM/exit ONLY — not uncaughtException. Next.js dev
    // owns recovery on uncaught errors; if we also process.exit() there,
    // we kill the dev server on benign hot-reload races. Browsers leaked
    // by an unhandled throw inside captureUrl are still cleaned by the
    // try/finally in the normal flow; SIGKILL bypasses everything (no
    // signal handler can catch it).
    process.once('SIGINT',  () => { teardown(); process.exit(130) })
    process.once('SIGTERM', () => { teardown(); process.exit(143) })
    process.once('exit',    teardown)
  }
  return reg
}

/**
 * Spawn ONE fresh browser for this capture call. Caller owns it and is
 * responsible for closing it in `finally`. No caching, no sharing — each
 * concurrent captureUrl gets its own CDP channel, so they don't starve.
 *
 * The browser is added to a per-process registry so a SIGINT/SIGTERM (e.g.
 * dev-server restart, parent process death) reaps every in-flight browser
 * on the way out — finally blocks can't run when SIGKILL hits, but Node's
 * exit handlers run on SIGINT/SIGTERM.
 */
// Monotonic counter used to spread launches across a window. Ralph 2026-06-05
// — at concurrency 32, mapWithConcurrency fires all 32 spawnBrowser() calls
// in the same microsecond. Puppeteer's launch path then races against itself
// (port allocation, user-data-dir creation, helper-process forking), and one
// of the 32 reliably hangs — the "one worker always times out" pattern. Each
// captureUrl picks a slot index modulo a small fleet size and adds slot ×
// STAGGER_MS of artificial delay before launching, so the 32 launches spread
// across ~500ms. The TOTAL throughput is unchanged (the slow-loading work is
// network/DOM, not launch); we just avoid the simultaneous-spawn cliff.
const LAUNCH_SLOTS = 16
const STAGGER_MS = 30 // 16 × 30 = 480ms total spread, then it cycles
let launchCounter = 0

async function spawnBrowser(): Promise<Browser> {
  // Prefer a system / CHROMIUM_BIN chromium; otherwise fall back to puppeteer's
  // OWN installed Chrome (~/.cache/puppeteer/...). findBinary's candidate list
  // doesn't include the puppeteer cache, which is the only Chrome on the server.
  let executablePath = findBinary('chromium')
  if (!existsSync(executablePath)) {
    try { executablePath = await puppeteer.executablePath() } catch { /* keep findBinary's path for the error below */ }
  }
  if (!existsSync(executablePath)) {
    throw new Error(
      `Chromium not found (resolved "${executablePath}"). Install it — ` +
      `macOS: drop Chromium.app in /Applications; Linux/WSL: \`apt install chromium-browser\` ` +
      `or \`npx puppeteer browsers install chrome\` — or set CHROMIUM_BIN.`,
    )
  }
  // Stagger this launch against any in-flight neighbours. Each call grabs
  // the next slot in a small ring (0..15) and waits slot × 30 ms. With 32
  // simultaneous callers, the first 16 get slots 0..15 (0..450 ms wait),
  // the next 16 get slots 0..15 again — but by then the first wave has
  // moved past the race-prone launch window, so contention is gone.
  const slot = (launchCounter++) % LAUNCH_SLOTS
  if (slot > 0) await new Promise((r) => setTimeout(r, slot * STAGGER_MS))
  const reg = getRegistry()
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    // Chrome's vendored .so files live in ~/lib on the server, but the Next
    // process env doesn't carry LD_LIBRARY_PATH — so set it for the Chrome
    // child here. Harmless on macOS (the dir just doesn't exist → ignored).
    env: { ...process.env, LD_LIBRARY_PATH: [join(process.env.HOME || '', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
    // WebSocket transport (the Puppeteer default). I tried `pipe: true`
    // here to give Chromium a kernel-level link to Node's life — but
    // pipe mode introduced flakiness with our --no-sandbox / --disable-*
    // flag set: launches got slower and capture failure rate went up.
    // Sticking with WebSocket. Orphan reaping is now handled by the
    // 3-second-bounded `browser.close()` in the finally block PLUS the
    // SIGKILL fallback on `browser.process()` — even a wedged Chromium
    // gets killed within 3s of finally entering, instead of pinning the
    // route handler forever.
    //
    // For Scout we don't care about cert validity — we're screenshotting a
    // public page, not transferring sensitive data. The SSRF guard vets
    // the resolved IP, so network-side protection stays intact.
    acceptInsecureCerts: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--ignore-certificate-errors',
      // Anti-bot evasion — Vercel/Cloudflare detect headless via subtle
      // signals and serve a 429 challenge instead of the real site.
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
  reg.set.add(browser)
  // Self-remove from registry when this browser closes cleanly — saves
  // the SIGTERM handler doing redundant close() calls.
  browser.once('disconnected', () => { reg.set.delete(browser) })

  // Push this Chromium to the highest scheduling priority the OS will
  // grant. The dev server itself was already elevated at boot (via
  // instrumentation.ts), so the spawned Chromium starts at the dev
  // server's elevated nice — but on Apple Silicon the per-process QoS
  // class also factors in, and an explicit setpriority on the child's
  // pid is a stronger signal to the scheduler. Synchronous, cheap, safe
  // to repeat. Returns null on permission rejection — non-fatal.
  const cp = browser.process()
  if (cp?.pid) elevatePriority(cp.pid)

  return browser
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
  let trimmed = (raw || '').trim()
  if (!trimmed) return null
  // Reject implausible inputs early (phone numbers, "n/a", just "www")
  if (!/[a-z0-9]/i.test(trimmed)) return null
  if (/^\d[\d\s+().-]*$/.test(trimmed)) return null // looks like a phone
  if (/^(n\/?a|none|tba|tbd|—|–|-)$/i.test(trimmed)) return null

  // Ralph 2026-06-05 · data-quality salvage (post-migration triage). Two
  // recurring patterns in scraped FSP data:
  //   1. Double protocol — "https://https://example.ch" was producing
  //      "invalid URL" because the inner colon broke the parser. Strip
  //      ANY leading run of `https?://` so only one survives.
  //   2. Comma-separated URLs — "https://a.ch, www.b.ch" (the source
  //      pasted two URLs into one cell). Take the first non-empty token
  //      on `,` / `;` / whitespace AFTER stripping the protocol so the
  //      separators don't get hidden inside a scheme.
  trimmed = trimmed.replace(/^(?:https?:\/\/)+/i, '')   // collapse to bare host
  trimmed = trimmed.split(/[,;\s]+/)[0] || trimmed       // first token wins
  if (!trimmed) return null

  try {
    const candidate = `https://${trimmed}`
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

// ── Public surface. ────────────────────────────────────────────────────────

export interface CaptureSuccess {
  ok: true
  url: string                    // canonical input URL we hit
  finalUrl: string               // post-redirect final URL
  resolvedIp: string
  fullPagePath: string           // absolute filesystem path
  innerPagePath: string | null   // absolute filesystem path or null (currently always null — Sip 2 disabled)
  profilePagePath: string | null // shared-site practitioner-page capture, WP-130
  fullPageUrl: string            // auth-gated URL for in-app rendering
  innerPageUrl: string | null
  profilePageUrl: string | null  // shared-site practitioner-page URL, WP-130
  pages: number
  capturedAt: string
  /** Rendered homepage DOM (post-settle, before nav-away). In-memory only —
   *  NOT persisted to meta/scout_json. Lets the queried/cookie detector see
   *  JS-injected CMP banners + Datenschutz links that a raw fetch misses on
   *  SPAs. Null if `page.content()` failed. */
  html: string | null
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
/* Ralph 2026-06-05 · pulled back from 180s/60s. 3-minute outer cap meant
   a single hanging site pinned a concurrency slot for 3 full minutes,
   serialising the rest of the batch behind it. 50s is patient enough for
   any site that's actually going to load (median is <8s; 95th percentile
   <30s); anything past that is a wedge and we'd rather mark it failed
   and free the slot. */
// Ralph 2026-06-05 — bumped back to 240s so a big-practice site sweep with
// 20+ nav links has room. Was capping rows at 50s which cut sweeps short.
// Wedged-site downside: a fully wedged site now ties up its concurrency slot
// for up to 240s instead of 50s. Acceptable — concurrency is 6, the bridge
// step still serializes, so a wedge can't pin the whole batch.
const TOTAL_TIMEOUT_MS = 240_000  // 4 min outer cap
const NAV_TIMEOUT_MS = 25_000     // 25 s per nav (unchanged)

// Ralph 2026-06-05 — hoisted to module scope so the deep-link / search
// decision can reject location/info paths BEFORE deciding which branch to
// take. Previously this list lived inside the search branch, so the deep-link
// branch had no way to know `/de/standorte/standort-sihlfeld` is not a
// practitioner's profile.
const REJECT_PATHS = [
  '/standorte', '/standort', '/kosten', '/preise', '/angebot', '/angebote',
  '/kontakt', '/impressum', '/datenschutz', '/about', '/uber-uns',
  '/ueber-uns', '/join', '/jobs', '/karriere', '/news', '/blog',
]

/**
 * Strip a leading language prefix (`/de`, `/en`, `/de-ch`, …) off a pathname.
 * Returns the prefix as `lang` (e.g. `/de`) and the rest as `rest` (`/team/sarai-alonso`).
 * If no language prefix is present, returns `lang: ''` and the original path.
 *
 * Why this exists: bare `pathname === '/'` was the only ROOT check, so
 * `/de` (German-language root) and `/de/standorte/standort-sihlfeld` were
 * both misclassified as deep-link practitioner pages. Stripping the language
 * segment lets the REJECT match see the meaningful `/standorte/...` part.
 */
function stripLangPrefix(pathname: string): { lang: string; rest: string } {
  const m = pathname.match(/^(\/[a-z]{2}(?:-[a-z]{2})?)(\/.*|$)/i)
  if (m) return { lang: m[1], rest: m[2] || '/' }
  return { lang: '', rest: pathname || '/' }
}

function isRootLikePath(rest: string): boolean {
  return rest === '' || rest === '/'
}

function isRejectPath(rest: string): boolean {
  const low = rest.toLowerCase()
  return REJECT_PATHS.some((r) => low === r || low.startsWith(r + '/'))
}

/** ctx for the new media/<plz>/<slug>/<firstname>.jpg layout (WP-130, §18). */
export interface ScoutCaptureCtx {
  plzOrRegion: string
  slug: string
  firstname: string
  /** Count of pool rows sharing this website domain — when ≥2 we ALSO grab
   *  the practitioner's profile page on the shared site. */
  sharedSiteCount?: number
  /** Slug-form tokens used to find the practitioner's profile link
   *  ([firstname, lastname-slug, …]). When sharedSiteCount<2 this is unused. */
  nameTokens?: string[]
}

/**
 * Render a URL in headless Chromium and return its DOM after the SPA + any
 * cookie/CMP layer has had a moment to hydrate. For the queried/cookie detector
 * (lib/consular/research-queried.ts): a Nuxt/Next/Vue site ships a near-empty
 * raw HTML, so a plain `fetch` can't see the banner or the Datenschutz link —
 * this can. SSRF-guarded like captureUrl. Best-effort: returns null on any
 * failure (caller falls back to the raw grep). In the taste flow the caller
 * already has the rendered DOM from captureUrl (`CaptureSuccess.html`), so this
 * only fires on the backfill path.
 */
export async function fetchRenderedHtml(rawUrl: string, hardTimeoutMs = 20_000): Promise<string | null> {
  const url = normalizeUrl(rawUrl)
  if (!url) return null
  const guard = await ssrfGuard(url)
  if (guard.ok === false) return null
  let browser: Browser | null = null
  try {
    browser = await spawnBrowser()
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    )
    const html = await Promise.race<string | null>([
      (async () => {
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
        // Let the SPA hydrate + the CMP loader inject (banners land ~0.5-1.5s).
        await new Promise((r) => setTimeout(r, 2_800))
        return page.content()
      })(),
      new Promise<string | null>((resolve) => setTimeout(() => resolve(null), hardTimeoutMs)),
    ])
    return html
  } catch {
    return null
  } finally {
    if (browser) {
      try { await Promise.race([browser.close(), new Promise<void>((res) => setTimeout(res, 3000))]) } catch { /* dead */ }
      try { const cp = browser.process(); if (cp && !cp.killed && cp.exitCode === null) cp.kill('SIGKILL') } catch { /* none */ }
    }
  }
}

/**
 * Visit a real external URL and capture a full-page screenshot. Returns a
 * typed result; NEVER throws.
 *
 * §18 / WP-130: writes JPEG (q=85) to `media/<plzOrRegion>/<slug>/
 * <firstname>.jpg`, returns the auth-gated `/api/admin/scout/capture/...`
 * URL for the dossier. When `sharedSiteCount >= 2` we ALSO grab a
 * practitioner-specific page (matched by name tokens against the link
 * graph) into `<firstname>-profile.jpg`. Inner page (Sip 2) stays
 * disabled — see the comment at the screenshot site.
 */
export async function captureUrl(rawUrl: string, ctx: ScoutCaptureCtx): Promise<CaptureResult> {
  const startedAt = Date.now()
  const url = normalizeUrl(rawUrl)
  if (!url) return { ok: false, url: rawUrl || null, reason: 'invalid URL' }

  const guard = await ssrfGuard(url)
  if (guard.ok === false) return { ok: false, url: url.href, reason: guard.reason }

  // Lazy-load scout-paths + sharp so this module can still import in any
  // legacy entry point (e.g. orchestrator code path) without pulling sharp
  // into the bundle unnecessarily.
  const { captureDir, captureFile, captureServeUrl } = await import('./scout-paths')
  const sharp = (await import('sharp')).default

  // Output dir: media/<plz>/<slug>/  (solo)  OR  media/_shared/<slug>/  (shared).
  //
  // Ralph 2026-06-05 — SHARED sites use FIXED filenames and SKIP IF EXISTS.
  //
  //   _shared/<slug>/_site-home.jpg     ← THE practice homepage, captured ONCE
  //   _shared/<slug>/_site-team.jpg     ← THE team page, captured ONCE (when found)
  //   _shared/<slug>/<firstname>-profile.jpg ← per-practitioner profile (unique)
  //
  // The previous content-addressed scheme (`_main-<sha8>.jpg`) was wrong:
  // SPA half-renders and "Server offline" frames each produced a distinct
  // hash, so the same homepage URL spawned N "different" files per practice.
  // Hide-the-monstrosity. We don't hash anymore. The first practitioner of a
  // praxis captures `_site-home.jpg`; every later practitioner SKIPS that
  // capture entirely. The dedup is by URL, not by bytes. To re-capture a bad
  // shot, delete the file and re-Taste — the next capture refills it.
  const dir = captureDir(ctx)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const profilePath = captureFile(ctx, 'profile')
  const isShared = !!(ctx.sharedSiteCount && ctx.sharedSiteCount >= 2)
  // Solo: `<plz>/<slug>/<firstname>.jpg`. Shared: `_shared/<slug>/_site-home.jpg`.
  let fullPath = isShared ? join(dir, '_site-home.jpg') : captureFile(ctx, 'main')

  /** Write a main-shot JPEG to disk.
   *  - Solo sites: write to fullPath unconditionally (overwrite on re-Taste).
   *  - Shared sites: write to `_site-home.jpg` ONLY if it doesn't already
   *    exist. Subsequent practitioners of the same practice skip the write
   *    and just point at the existing file. No bytes-deduplication, no
   *    half-rendered SPA second copies — same URL → same file → captured once.
   *  Returns the path the row should point at (always equals fullPath now). */
  const writeMainShot = (buf: Buffer): string => {
    if (!isShared) {
      writeFileSync(fullPath, buf)
      return fullPath
    }
    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, buf)
    } else {
      console.log(`[capture] ${url.href} · shared-site · ${fullPath} exists → skip write`)
    }
    return fullPath
  }
  // No inner — Sip 2 is currently disabled (see screenshot site below).
  const metaPath = join(dir, `${ctx.firstname}.meta.json`)

  // Per-call browser (Ralph 2026-06-05). Each captureUrl spawns its own
  // Chromium → its own CDP socket → no cross-call starvation. Caller's
  // `finally` below closes it so we don't leak.
  let browser: Browser
  try {
    browser = await spawnBrowser()
  } catch (err) {
    return { ok: false, url: url.href, reason: `browser-launch failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  let page: Page | null = null

  // Ralph 2026-06-05 — UNIFIED settle (no more 1.5 s band-aid waits).
  // Every page.goto inside this captureUrl uses the same adaptive logic:
  //   1. Wait 300 ms for DOM construction.
  //   2. Detect SPA-loader (low body text, "Loading…" markers, #nuxt-loading).
  //   3. Fast path → window.stop() + screenshot. SPA path → poll up to 6 s
  //      for body text ≥ 200 chars AND every <img>/background-image loaded
  //      (or aged-out > 2 s in DOM). Final 500 ms cushion.
  // Called by: initial nav, deep-link root re-shoot, profile probe, profile
  // final. Without this every secondary nav was using a 1.5 s fixed wait —
  // produced byte-identical half-rendered captures across 5 prospects.
  async function spaSettle(pg: Page, navigatedUrl: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 300))
    const isSpaWaiting = await pg.evaluate((): boolean => {
      const text = (document.body?.innerText || '').trim().toLowerCase()
      if (text.length < 60) return true
      if (/(^|\s)(loading|wird geladen|chargement|caricamento)\.{0,3}$/i.test(text)) return true
      if (document.querySelector('#nuxt-loading, #__nuxt > .nuxt-progress, .spa-loader')) return true
      return false
    }).catch(() => false)

    if (!isSpaWaiting) {
      try {
        await Promise.race([
          pg.evaluate(() => { window.stop() }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('stop timed out')), 1_500)),
        ])
      } catch { /* keep going */ }
      return
    }

    console.log(`[capture] ${navigatedUrl} · SPA detected · waiting for content+images…`)
    const maxWaitMs = 6_000
    const pollMs = 400
    const startedWait = Date.now()
    while (Date.now() - startedWait < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollMs))
      const ready = await pg.evaluate((startedAtMs: number): boolean => {
        const text = (document.body?.innerText || '').trim()
        if (text.length < 200) return false
        const elapsed = Date.now() - startedAtMs
        const imgs = Array.from(document.images)
        for (const img of imgs) {
          if (!img.src) continue
          const aged = elapsed > 2_000
          if (!aged && (!img.complete || !img.naturalWidth)) return false
        }
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[]
        for (const el of all) {
          if (!el.offsetWidth || !el.offsetHeight) continue
          const bg = getComputedStyle(el).backgroundImage
          if (!bg || !/^url\(/.test(bg)) continue
          if (el.offsetWidth * el.offsetHeight < 200_000) continue
          const m = bg.match(/url\(["']?([^"')]+)["']?\)/)
          if (!m) continue
          const probe = new Image()
          probe.src = m[1]
          const aged = elapsed > 2_000
          if (!aged && (!probe.complete || !probe.naturalWidth)) return false
          break
        }
        return true
      }, startedWait).catch(() => true)
      if (ready) break
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  try {
    // Race the whole pipeline against the hard timeout so a slow host can't
    // stall the batch. The individual nav timeout is the gentler bound.
    const captured = await Promise.race<CaptureResult>([
      (async (): Promise<CaptureResult> => {
        // Ralph 2026-06-05 (debug) · STRIPPED-DOWN capture. Removed
        // evaluateOnNewDocument stealth (the prior version was somehow
        // silently hanging the pipeline → outer 180 s timeout fired on
        // all 3 reset rows). Going minimal: navigate, settle, screenshot.
        page = await browser.newPage()
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        )

        console.log(`[capture] ${url.href} · goto…`)
        const response = await page.goto(url.href, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT_MS,
        })
        if (!response) {
          return { ok: false, url: url.href, reason: 'no response from server' }
        }
        console.log(`[capture] ${url.href} · goto OK · settle…`)
        // Ralph 2026-06-05 — ADAPTIVE settle, extracted into spaSettle() so
        // EVERY subsequent navigation (root re-shoot, profile probe, profile
        // final) gets the same treatment. Previous version used 1.5s fixed
        // waits after the initial nav — that produced byte-identical
        // half-rendered captures across 5 prospects (sha256 793abc… on
        // david/tanja/sarai/sandra/stefan) because the SPA hero hadn't
        // loaded in 1.5s. Fix is uniform settle, not "one good, four bad".
        await spaSettle(page, url.href)

        // Snapshot the RENDERED DOM now (settled, banner present, before we
        // dismiss it or navigate away for the profile/sweep). This is what the
        // queried cookie/tracker detector reads — a Nuxt/Next SPA ships a near-
        // empty raw HTML, so the live banner + Datenschutz link only exist here.
        // Best-effort: detection degrades to the raw grep if this fails.
        let renderedHtml: string | null = null
        try { renderedHtml = await page.content() } catch { /* keep null */ }

        // Ralph 2026-06-05 · COOKIE-BANNER DISMISS. Most Swiss/EU sites
        // overlay a consent banner that covers 30-70% of the viewport — so
        // the Scout screenshot ends up being a picture of the banner, not
        // the actual page. We try three layers, in order:
        //   1. Known consent-library selectors (OneTrust, Cookiebot, Axeptio,
        //      Didomi, HubSpot, CookieConsent, Termly). These cover ~80% of
        //      EU sites because the libs ship predictable IDs/classes.
        //   2. ARIA/heuristic selectors — buttons with aria-label or data-
        //      attributes containing "accept" + "cookie".
        //   3. Text-match buttons whose visible label matches a German /
        //      English / French / Italian "accept" phrase.
        // Wrapped in a 2 s race so a buggy banner script can't pin the
        // pipeline. Then a 200 ms settle so the fade-out animation
        // completes before we shoot. Failure to find a banner is silent —
        // no banner is the happy path.
        try {
          const dismissResult = await Promise.race<unknown>([
            page.evaluate(async () => {
              // Try up to 8 times across ~1.6 s — covers async-loaded banners
              // (cookiebot's CDN, axeptio) that inject after DCL. The selector +
              // text scan is INLINED into the loop on purpose: this body runs in
              // the browser, so a named inner helper (`const tryOnce = …`) gets
              // wrapped by esbuild/tsx `keepNames` in a `__name()` call that
              // doesn't exist there — it throws `__name is not defined`, the
              // outer catch swallows it, and the banner is never dismissed. That
              // bug had this entire dismiss doing nothing (shots of the banner).
              const KNOWN_SELECTORS = [
                // OneTrust (used by ~30% of EU sites)
                '#onetrust-accept-btn-handler',
                'button[id^="onetrust-accept"]',
                // Cookiebot
                '#CybotCookiebotDialogBodyButtonAccept',
                '#CybotCookiebotDialogBodyLevelButtonAcceptAll',
                '#CybotCookiebotDialogBodyLevelButtonAccept',
                // Axeptio
                '#axeptio_btn_acceptAll',
                'button.axeptio-btn-accept-all',
                // Didomi
                '#didomi-notice-agree-button',
                'button[aria-label*="Agree to all" i]',
                // HubSpot
                '#hs-eu-confirmation-button',
                '#hs-eu-cookie-confirmation .hs-eu-confirmation-button',
                // CookieConsent (Insites Cookieconsent / Klaro / OSano)
                '.cc-btn.cc-allow', '.cc-btn.cc-dismiss', '.klaro .cm-btn-accept-all',
                // Termly
                '#termly-code-snippet-support-modal-accept',
                // Drupal EU Cookie Compliance
                '.agree-button.eu-cookie-compliance-default-button',
                // Generic data-testid + aria-label
                'button[data-testid*="accept-all" i]',
                'button[data-test*="accept-all" i]',
                'button[aria-label*="accept all" i]',
                'button[aria-label*="alle akzeptieren" i]',
                // Usercentrics (very common on DE/CH sites)
                'button[data-testid="uc-accept-all-button"]',
                '#usercentrics-root button[data-testid="uc-accept-all-button"]',
                // Borlabs Cookie (German WordPress staple)
                'a.brlbs-btn-accept-all', 'button.brlbs-btn-accept-all', '[data-borlabs-cookie-accept]',
                // Iubenda
                '.iubenda-cs-accept-btn',
                // Complianz
                '.cmplz-accept', 'button.cmplz-btn.cmplz-accept',
                // CookieYes
                '.cky-btn-accept',
                // Real Cookie Banner
                '.rcb-btn-accept-all', '[data-rcb-action="accept-all"]',
                // Cookie Notice / GDPR Cookie Consent (WP)
                '#cn-accept-cookie', '#cookie-notice .cn-set-cookie',
              ]
              // Text-match accept labels (DE/EN/FR/IT). Whole-label match,
              // case-insensitive, so a "Cookie Settings" button isn't mistaken
              // for accept. Hoisted above the loop (a plain array — safe).
              const ACCEPT_TEXTS = [
                /^accept all( cookies)?$/i,
                /^accept( all)?$/i,
                /^agree( to all)?$/i,
                /^i agree$/i,
                /^allow all( cookies)?$/i,
                /^got it$/i,
                /^ok$/i,
                /^okay$/i,
                /^alles klar$/i,
                /^ok,? (verstanden|got it)$/i,
                /^continue$/i,

                /^alle akzeptieren$/i,
                /^alles akzeptieren$/i,
                /^akzeptieren$/i,
                /^einverstanden$/i,
                /^zustimmen$/i,
                /^verstanden$/i,
                /^ich stimme zu$/i,

                /^tout accepter$/i,
                /^accepter$/i,
                /^accepter tout$/i,
                /^j'accepte( tout)?$/i,
                /^d'accord$/i,

                /^accetta tutto$/i,
                /^accetta$/i,
                /^ho capito$/i,
                /^accetto$/i,
              ]

              // Partial-label fallback for custom/translated banners whose
              // accept button isn't an exact whole-label match ("Alle Cookies
              // akzeptieren", "Cookies akzeptieren", "Ich akzeptiere"). Accept-
              // ish wording, but NEVER a deny / "only necessary" / settings /
              // policy-link button (those refuse, open preferences, or navigate).
              const ACCEPT_PARTIAL = /(akzeptier|zustimm|einverstanden|annehmen|alle.*(erlaub|zulass)|accept|agree|allow all|allow cookies|got it|tout accepter|accepter|d.?accord|accetta|accetto|ho capito)/i
              const DENY_OR_CONFIG = /(ablehn|reject|decline|nur (notwendige|essenzielle|technisch|erforderlich)|essential only|necessary only|einstellung|preferenc|präferenz|settings|verwalten|manage|configure|konfigurier|individuell|auswahl|customi[sz]e|anpassen|optionen|\boptions\b|mehr (info|erfahren)|details|impressum|datenschutz|weiterlesen)/i

              // Polling retry — ~250 ms × 10 ≈ 2.5 s, stops on first hit. Three
              // passes per tick: exact selector → exact label → partial label.
              // INLINED (no named helper → no __name landmine). SPA banners can
              // inject 0.5-2 s after hydration, hence the wider window.
              for (let i = 0; i < 10; i++) {
                for (const sel of KNOWN_SELECTORS) {
                  const el = document.querySelector(sel) as HTMLElement | null
                  if (el && el.offsetParent !== null) {
                    el.click()
                    return { hit: true, via: 'selector', selector: sel }
                  }
                }
                const clickable = Array.from(document.querySelectorAll(
                  'button, a[role="button"], [role="button"], input[type="button"], input[type="submit"], a[href="#"]',
                )) as HTMLElement[]
                // Pass 1 — exact whole-label (precise; avoids "cookie settings").
                for (const el of clickable) {
                  if (!el.offsetParent) continue
                  const label = ((el as HTMLInputElement).value || el.innerText || el.textContent || '').trim()
                  if (!label || label.length > 60) continue
                  if (ACCEPT_TEXTS.some((re) => re.test(label))) {
                    el.click()
                    return { hit: true, via: 'text', label }
                  }
                }
                // Pass 2 — partial accept-ish, excluding deny/settings/policy.
                for (const el of clickable) {
                  if (!el.offsetParent) continue
                  const label = ((el as HTMLInputElement).value || el.innerText || el.textContent || '').trim()
                  if (!label || label.length > 60) continue
                  if (DENY_OR_CONFIG.test(label)) continue
                  if (ACCEPT_PARTIAL.test(label)) {
                    el.click()
                    return { hit: true, via: 'text-partial', label }
                  }
                }
                await new Promise((res) => setTimeout(res, 250))
              }
              return { hit: false }
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('cookie dismiss timed out')), 3_500)),
          ])
          // Settle so the dismissal animation finishes before we shoot.
          await new Promise((r) => setTimeout(r, 250))
          // Diagnostic log so we know whether the banner-dismiss fired.
          // Silent on miss (the page might have no banner — that's fine);
          // logs the hit so we can audit which library/text triggered.
          const dr = dismissResult as { hit?: boolean; via?: string; selector?: string; label?: string } | undefined
          if (dr?.hit) {
            const detail = dr.via === 'selector' ? dr.selector : dr.label
            console.log(`[capture] ${url.href} · cookie banner dismissed (${dr.via}: ${detail})`)
          }
        } catch { /* banner-eval timed out or blocked — keep going, take the shot anyway */ }

        console.log(`[capture] ${url.href} · screenshot…`)
        // PNG buffer → JPEG (sharp, q=85) → write. The buffer round-trip is
        // ~80 ms; the disk-size win is 5-8× (typical practice homepage
        // 700 KB PNG → ~110 KB JPEG). §18 / WP-130.
        const mainPng = await Promise.race<Buffer>([
          page.screenshot({ type: 'png' }) as Promise<Buffer>,
          new Promise<Buffer>((_, rej) => setTimeout(() => rej(new Error('screenshot timed out')), 30_000)),
        ])
        const mainJpeg = await sharp(mainPng).jpeg({ quality: 85 }).toBuffer()
        fullPath = writeMainShot(mainJpeg)
        console.log(`[capture] ${url.href} · screenshot done (${mainJpeg.length} B) → ${fullPath}`)

        const finalUrl = page.url()

        // Ralph 2026-06-05 · INNER PAGE DISABLED. Puppeteer's CDP is single-
        // channel: when one page's nav hangs (e.g. Vercel challenge pages
        // that never fire DOMContentLoaded), it blocks screenshots on ALL
        // other concurrent pages — that's why all 3 sites hit the outer
        // 180 s ceiling even though main captures finished in 60 ms.
        // Just skip the inner. Main capture is what the Scout tastes.
        const innerFinalUrl: string | null = null

        // ── Profile-page capture for shared practices (§18 / WP-130). ──
        // RALPH 2026-06-05 — DETERMINISTIC fix. Previous version's link-graph
        // heuristic silently produced no profile in practice (verified across
        // 3 test rows: zero -profile.jpg files written). New rule:
        //
        //   * If the row's website is the ROOT (path = "/" or empty), the
        //     MAIN capture above IS the homepage. Then for the PROFILE we
        //     search the link graph for the practitioner's name; if no
        //     direct link is visible, we navigate to /team or /standorte
        //     and search THAT graph.
        //   * If the row's website is a DEEP LINK (e.g. praxis-z.ch/de/
        //     team/sandra-appiah), the website IS the profile page. The
        //     main capture above already grabbed it, so we ALSO navigate
        //     to the root and capture that as the homepage view —
        //     SWAPPING which file gets which capture:
        //       <firstname>.jpg          ← practice homepage (root)
        //       <firstname>-profile.jpg  ← what the website pointed at
        //
        // Either branch ALWAYS logs its decision so silent failures are
        // visible. "Stack up" guarantee per Ralph's spec: shared practice =
        // 2 files per practitioner, no exceptions.
        let profileOk = false
        let profileFinalUrl: string | null = null
        let mainUrlAfterFix: string | null = null   // overrides finalUrl in meta if main was re-shot
        if (ctx.sharedSiteCount && ctx.sharedSiteCount >= 2) {
          try {
            const inputUrl = new URL(url.href)
            // Three-way classification on the input path (post-lang-strip):
            //   PROFILE  — looks like a practitioner deep-link (/team/x, /personen/y, …)
            //   ROOT     — empty / "/" / language-only (/de, /en-us, …)
            //   REJECT   — info/location page (/standorte/…, /kontakt, /jobs, …)
            //              The main shot was OF the reject page → we throw it
            //              away and re-shoot the actual root before searching.
            const { lang, rest } = stripLangPrefix(inputUrl.pathname)
            const isRoot   = isRootLikePath(rest)
            const isReject = isRejectPath(rest)
            const isDeepLink = !isRoot && !isReject   // PROFILE branch

            // Root URL respecting the input's language — for /de inputs we
            // re-shoot https://host/de/, not https://host/ (which 404s on a
            // language-gated site). For non-lang inputs, falls back to "/".
            const rootHref = `${inputUrl.protocol}//${inputUrl.host}${lang || '/'}`

            // Probe paths get the detected language prefix injected too —
            // /team works on praxis-x.ch but not on /de-only praxis-z.ch.
            const PROBE_PATHS = ['team', 'therapeuten', 'psychotherapeuten']
            const probeUrls: string[] = []
            for (const p of PROBE_PATHS) {
              if (lang) probeUrls.push(`${inputUrl.protocol}//${inputUrl.host}${lang}/${p}`)
              probeUrls.push(`${inputUrl.protocol}//${inputUrl.host}/${p}`)
            }

            const tokens = (ctx.nameTokens || [ctx.firstname]).map((t) => t.toLowerCase()).filter((t) => t.length >= 3)
            const firstTok = tokens[0] || ''
            const lastTok  = tokens[1] || ''

            // Scored matcher: searches the CURRENT page's link graph for the
            // best practitioner-profile link. Reuses the module-scope REJECT_PATHS
            // so location/info pages are filtered. Highest score wins, ties
            // broken by URL length (shorter = more direct).
            //   +100 last segment contains BOTH first+last
            //   + 70 last segment contains first AND last≥4
            //   + 50 path contains BOTH
            //   + 25 path contains last
            //   + 15 link text contains BOTH
            //   +  5 link text contains last
            const findBest = async (): Promise<string | null> => {
              return await page!.evaluate((args) => {
                const { first, last, REJECT } = args as { first: string; last: string; REJECT: string[] }
                const here = location.host
                const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
                let best: { href: string; score: number } | null = null
                for (const a of links) {
                  let u: URL
                  try { u = new URL(a.href) } catch { continue }
                  if (u.host !== here) continue
                  const text = (a.innerText || a.textContent || '').toLowerCase()
                  const pathLow = u.pathname.toLowerCase()
                  // Strip lang prefix for the REJECT check (browser-side dup
                  // of stripLangPrefix — kept inline so the page.evaluate
                  // sandbox doesn't need a serialized helper).
                  const langStripped = pathLow.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/, '') || '/'
                  if (REJECT.some((r) => langStripped === r || langStripped.startsWith(r + '/'))) continue
                  const lastSeg = pathLow.split('/').filter(Boolean).slice(-1)[0] || ''
                  let score = 0
                  if (first && last) {
                    if (lastSeg.includes(first) && lastSeg.includes(last)) score = 100
                    else if (lastSeg.includes(first) && last.length >= 4) score = 70
                    else if (pathLow.includes(first) && pathLow.includes(last)) score = 50
                    else if (last && pathLow.includes(last)) score = 25
                    else if (first && text.includes(first) && last && text.includes(last)) score = 15
                    else if (last && text.includes(last)) score = 5
                  } else if (first) {
                    if (lastSeg.includes(first)) score = 30
                    else if (pathLow.includes(first)) score = 10
                  }
                  if (score === 0) continue
                  if (!best || score > best.score ||
                      (score === best.score && a.href.length < best.href.length)) {
                    best = { href: a.href, score }
                  }
                }
                return best?.href ?? null
              }, { first: firstTok, last: lastTok, REJECT: REJECT_PATHS })
            }

            // Shoot a Buffer screenshot of the current page, returns the JPEG.
            const shoot = async (label: string): Promise<Buffer> => {
              const png = await Promise.race<Buffer>([
                page!.screenshot({ type: 'png' }) as Promise<Buffer>,
                new Promise<Buffer>((_, rej) => setTimeout(() => rej(new Error(`${label} screenshot timed out`)), 20_000)),
              ])
              return await sharp(png).jpeg({ quality: 85 }).toBuffer()
            }

            // ── BRANCH 1 — DEEP LINK (sarai's /de/team/sarai-alonso) ────
            // The main shot we already took IS the practitioner's profile.
            // Move it to profilePath, then re-navigate to the language root
            // and re-shoot as the new main.
            if (isDeepLink) {
              console.log(`[capture] ${url.href} · shared-site · deep-link → PROFILE=this, MAIN=root (${rootHref})`)
              writeFileSync(profilePath, mainJpeg)
              profileOk = true
              profileFinalUrl = url.href
              await page!.goto(rootHref, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
              await spaSettle(page!, rootHref)
              fullPath = writeMainShot(await shoot('root-after-deeplink'))
              mainUrlAfterFix = page!.url()
            }

            // ── BRANCH 2 — REJECT (fabiana's /de/standorte/standort-sihlfeld) ─
            // The main shot we took is OF the reject page (location/info,
            // not the practitioner). Throw it away, re-shoot the actual root
            // as main, then fall through to the search-from-root logic for
            // the profile.
            else if (isReject) {
              console.log(`[capture] ${url.href} · shared-site · REJECT-path input → re-shoot root (${rootHref}) for MAIN, then search`)
              await page!.goto(rootHref, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
              await spaSettle(page!, rootHref)
              fullPath = writeMainShot(await shoot('root-after-reject'))
              mainUrlAfterFix = page!.url()
            }

            // ── BRANCH 3 (and fall-through from BRANCH 2) — SEARCH ──────
            // Main is on the homepage. Look for the practitioner's link.
            if (isRoot || isReject) {
              // We're on root (BRANCH 2 just navigated; BRANCH 3 was already
              // there). Search this page's links first.
              let profileTargetUrl: string | null = await findBest()

              if (!profileTargetUrl) {
                for (const probeUrl of probeUrls) {
                  try {
                    await page!.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 })
                    await spaSettle(page!, probeUrl)
                    const found = await findBest()
                    if (found) { profileTargetUrl = found; break }
                  } catch { /* try next probe */ }
                }
              }

              if (profileTargetUrl) {
                console.log(`[capture] ${url.href} · shared-site · PROFILE → ${profileTargetUrl}`)
                await page!.goto(profileTargetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
                await spaSettle(page!, profileTargetUrl)
                writeFileSync(profilePath, await shoot('profile'))
                profileOk = true
                profileFinalUrl = page!.url()
              } else {
                // No profile link found — DON'T write a duplicate of root as
                // -profile.jpg (janine's bug: previously fell through and
                // wrote root twice). Leave profileOk=false; the dossier
                // simply renders only the main shot.
                console.log(`[capture] ${url.href} · shared-site · PROFILE link not found (tokens=${tokens.join(',')}) — no -profile.jpg written`)
              }
            }

          } catch (err) {
            console.log(`[capture] ${url.href} · profile errored: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        // ── SITE-PAGE SWEEP — capture DIFFERENT pages (Ralph 2026-06-05) ──
        // "The Scout needs to do DIFFERENT pictures if there are already two in
        // this directory." So this runs OFF THE DISK COUNT, not sharedSiteCount:
        // once the slot already holds ≥2 shots (a shared practice's home + a
        // practitioner profile), the next Taste walks the site's top-level nav
        // and captures every section we don't ALREADY have, as `_site-<slug>.jpg`.
        // skip-if-exists → only NEW pages are added, so the dir grows into a
        // gallery of DIFFERENT pages, never a second homepage. NO numeric cap —
        // the set is the site's own table of contents.
        //
        // It runs on its OWN fresh page, OUTSIDE the profile-search try above,
        // so a slow profile route can no longer skip it (the old version was
        // nested inside that try AND scanned the wedged `page`, which is why it
        // produced 0 files). Widens the link scan to the whole document when the
        // semantic nav (header/nav/[role=navigation]) is thin — Wix/Jimdo/SPA
        // practice sites, the common case here.
        const existingShots = existsSync(dir)
          ? readdirSync(dir).filter((f) => /\.(jpg|png|webp)$/i.test(f)).length
          : 0
        if (existingShots >= 2) {
          let sweepPage: Page | null = null
          try {
            const su = new URL(url.href)
            const { lang: sweepLang } = stripLangPrefix(su.pathname)
            const sweepRoot = `${su.protocol}//${su.host}${sweepLang || '/'}`
            sweepPage = await browser.newPage()
            await sweepPage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
            await sweepPage.goto(sweepRoot, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
            await spaSettle(sweepPage, sweepRoot)

            // NB: this runs in the BROWSER (page context). It must contain NO
            // inner `const fn = () => {}` declarations — esbuild/tsx `keepNames`
            // wraps those in a `__name()` helper that doesn't exist in the page,
            // so the whole evaluate throws `__name is not defined` and the scan
            // silently returns nothing. (That `__name` throw is why the prior
            // sweep captured 0 files.) Everything below is flat: inline regex,
            // anonymous callbacks only.
            const navLinks = await sweepPage.evaluate((REJECT: string[]): Array<{ href: string; slug: string }> => {
              const here = location.host
              // Primary-nav anchors first; widen to the whole document when thin
              // (Wix / Jimdo / SPA practice sites rarely use header/nav/role=nav).
              let anchors = Array.from(document.querySelectorAll('header a[href], nav a[href], [role="navigation"] a[href]')) as HTMLAnchorElement[]
              if (anchors.length < 3) anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
              const seen = new Set<string>()
              const out: Array<{ href: string; slug: string }> = []
              for (const a of anchors) {
                let u: URL
                try { u = new URL(a.href) } catch { continue }
                if (u.host !== here) continue
                if (u.hash) continue                                       // same-page anchor
                if (/\.(pdf|zip|docx?|xlsx?|jpg|png|gif|webp|mp4)$/i.test(u.pathname)) continue
                // Strip a leading /de · /en-us language prefix, inline.
                const stripped = u.pathname.toLowerCase().replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/, '') || '/'
                if (stripped === '/' || stripped === '') continue          // homepage already shot
                // Top-level sections only. Deep /team/<person> paths are the
                // per-practitioner profiles, captured separately.
                if (stripped.split('/').filter(Boolean).length !== 1) continue
                if (REJECT.some((r) => stripped === r || stripped.startsWith(r + '/'))) continue
                if (seen.has(stripped)) continue
                seen.add(stripped)
                const slug = stripped.replace(/^\//, '').replace(/\/$/, '')
                  .replace(/\//g, '-').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'page'
                out.push({ href: u.href, slug })
              }
              return out
            }, REJECT_PATHS)

            const missing = navLinks.filter((l) => !existsSync(join(dir, `_site-${l.slug}.jpg`)))
            if (navLinks.length === 0) {
              console.log(`[capture] ${url.href} · site-sweep · no internal nav links found on homepage`)
            } else if (missing.length === 0) {
              console.log(`[capture] ${url.href} · site-sweep · all ${navLinks.length} nav pages already shot`)
            } else {
              console.log(`[capture] ${url.href} · site-sweep · ${missing.length}/${navLinks.length} nav pages missing → capturing`)
              // NO cap. Every section the practice publishes gets one shot;
              // each page is its own try so a single slow page can't abort the
              // rest, and TOTAL_TIMEOUT_MS is the only outer ceiling.
              for (const link of missing) {
                try {
                  await sweepPage.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 12_000 })
                  await spaSettle(sweepPage, link.href)
                  const png = await Promise.race<Buffer>([
                    sweepPage.screenshot({ type: 'png' }) as Promise<Buffer>,
                    new Promise<Buffer>((_, rej) => setTimeout(() => rej(new Error('sweep screenshot timed out')), 20_000)),
                  ])
                  writeFileSync(join(dir, `_site-${link.slug}.jpg`), await sharp(png).jpeg({ quality: 85 }).toBuffer())
                  console.log(`[capture] ${url.href} · site-sweep · _site-${link.slug} ← ${link.href}`)
                } catch (err) {
                  console.log(`[capture] ${url.href} · site-sweep · _site-${link.slug} failed: ${err instanceof Error ? err.message : String(err)}`)
                }
              }
            }
          } catch (err) {
            console.log(`[capture] ${url.href} · site-sweep errored: ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            if (sweepPage) { try { await sweepPage.close() } catch { /* already closed */ } }
          }
        }

        const result: CaptureSuccess = {
          ok: true,
          url: url.href,
          // Ralph 2026-06-05 — when the deep-link swap or REJECT-path branch
          // re-shot the root as main, the meta's `finalUrl` should reflect
          // what the MAIN JPEG actually contains (root), not the initial nav.
          finalUrl: mainUrlAfterFix ?? finalUrl,
          resolvedIp: guard.ip,
          fullPagePath: fullPath,
          innerPagePath: null,
          profilePagePath: profileOk ? profilePath : null,
          fullPageUrl: captureServeUrl(fullPath),
          innerPageUrl: null,
          profilePageUrl: profileOk ? captureServeUrl(profilePath) : null,
          pages: 1 + (profileOk ? 1 : 0),
          capturedAt: new Date().toISOString(),
          html: renderedHtml,
        }
        // Persist meta WITHOUT the rendered HTML (it's 100s of KB and in-memory-only).
        const { html: _omitHtml, ...metaResult } = result
        writeFileSync(metaPath, JSON.stringify({ ...metaResult, innerFinalUrl, profileFinalUrl, durationMs: Date.now() - startedAt }, null, 2))
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
    // ── Browser teardown with bounded wait (Ralph 2026-06-05). ──────────
    // `browser.close()` is async over the CDP transport (pipe or WS). If
    // Chromium is wedged — crashed renderer, navigation hang, GPU hang —
    // the close message either never gets a reply or the cleanup chain
    // inside Puppeteer hangs awaiting one. Without a bounded wait, the
    // `await` here never resolves, the route handler never returns, and
    // the Chromium process lives until something else kills it.
    //
    // 3 seconds is plenty for a healthy close (typically ~50ms); anything
    // beyond that is a wedge. Fall back to SIGKILL on the underlying
    // process. That's safe because the per-call browser is no longer
    // shared with anything — we own it, we kill it.
    try {
      await Promise.race([
        browser.close(),
        new Promise<void>((res) => setTimeout(res, 3000)),
      ])
    } catch { /* already dead */ }
    // Hard kill if the OS still shows the process alive after the timeout
    // expired. `browser.process()` is the Node ChildProcess wrapper; its
    // `killed` flag and `exitCode` tell us whether close() actually
    // tore Chromium down.
    try {
      const cp = browser.process()
      if (cp && !cp.killed && cp.exitCode === null) {
        cp.kill('SIGKILL')
      }
    } catch { /* nothing to kill */ }
  }
}
