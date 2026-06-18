// ============================================================================
// lib/scrapers/http.ts — polite HTTP helper for register fetches
// (Ralph 2026-06-05).
//
// Each scraper hits an official register (psychologie.ch, fmh.ch, ...). The
// only thing we promise these hosts in return for free data is GOOD MANNERS:
//
//   - Identify as a real client (UA string + Accept header)
//   - Honour a per-host rate limit (1 req every 200ms by default)
//   - Polite retry on 429/5xx with exponential backoff
//   - Hard timeout per request (no leaked sockets)
//   - Respect AbortSignal for cancellable batches
//
// `politeFetch` is the only HTTP entry point a scraper should use. Don't
// reach for `fetch()` directly — the rate limiter is per-host shared
// across all in-flight requests, so going around it defeats the point.
// ============================================================================

/** UA string — identifies us honestly. Don't impersonate a major browser. */
const USER_AGENT = 'OskarOS-Scraper/1.0 (+research-bot; contact rl@paradiso.dev)'

/**
 * Default per-host min interval between request *starts* (ms).
 * Ralph 2026-06-05 — dropped from 200 → 0 (no cap). The previous 200ms
 * gate hard-capped FSP throughput at ~5 req/s regardless of worker
 * count; with the per-call browser in `lib/screenshot.ts` removing the
 * CDP-starvation cap, the network gate was the next bottleneck. Caller
 * can still opt back into a rate limit by passing `minIntervalMs` to
 * `politeFetch(url, {minIntervalMs: N})`. Backoff on 429/5xx is still
 * active — if FSP starts rate-limiting us we'll see retry-with-backoff.
 */
const DEFAULT_MIN_INTERVAL_MS = 0

/** Default per-request hard timeout. Profile pages are ~150KB. */
const DEFAULT_TIMEOUT_MS = 20_000

/** How many transient-failure retries before giving up. */
const DEFAULT_MAX_RETRIES = 3

/**
 * Per-host gate. Each host gets one Promise chain — successive `acquire()`
 * calls await the previous one + the min interval. Globally pinned so HMR
 * reloads in dev don't reset the gate (and we don't burst-fire on reload).
 */
interface HostGate {
  lastStart: number
  chain: Promise<void>
}
const GATES_KEY = Symbol.for('oskar.scrapers.host-gates') as unknown as string
const g = globalThis as Record<string, unknown>
const gates: Map<string, HostGate> =
  (g[GATES_KEY] as Map<string, HostGate>) ||
  ((g[GATES_KEY] = new Map<string, HostGate>()) as Map<string, HostGate>)

function gateOf(host: string): HostGate {
  let gate = gates.get(host)
  if (!gate) {
    gate = { lastStart: 0, chain: Promise.resolve() }
    gates.set(host, gate)
  }
  return gate
}

/**
 * Acquire a slot on the per-host gate. Returns when the calling task may
 * issue its request. Caller MUST update `gate.lastStart` after starting.
 *
 * Ralph 2026-06-05 spec-review MEDIUM #7 — adds ±20% jitter to the inter-
 * request interval. Without jitter, 6 concurrent workers all fire at
 * exactly minIntervalMs from each other and look like a regular bot to
 * any rate-limit detector. Jitter is cheap politeness insurance.
 */
async function acquireSlot(host: string, minIntervalMs: number): Promise<void> {
  const gate = gateOf(host)
  // Chain so multiple awaiters serialise instead of all firing at lastStart+interval.
  const wait = gate.chain.then(async () => {
    const elapsed = Date.now() - gate.lastStart
    // ±20% jitter — makes the inter-request pattern look human-ish.
    const jitter = minIntervalMs * 0.2 * (Math.random() * 2 - 1)
    const target = Math.max(0, minIntervalMs + jitter - elapsed)
    if (target > 0) await new Promise((res) => setTimeout(res, target))
    gate.lastStart = Date.now()
  })
  gate.chain = wait
  await wait
}

export interface PoliteFetchOptions {
  /** Override the default per-host min interval. */
  minIntervalMs?: number
  /** Override the default per-request timeout. */
  timeoutMs?: number
  /** Override the default retry budget. */
  maxRetries?: number
  /** Forward an external abort signal (e.g. enqueueBuild's). */
  signal?: AbortSignal
  /** Additional headers. UA + Accept are always set. */
  headers?: Record<string, string>
  /** HTTP method (default GET). */
  method?: 'GET' | 'POST'
  /** Request body (only for POST). */
  body?: string
}

/**
 * Thrown by politeFetch when the response is a definitive 404. Callers
 * (refsp runner, scraper) check `err instanceof NotFoundError` to count
 * stale slugs as their own bucket instead of lumping them into errors
 * (M2). Stale FSP slugs 404 by design; that's data, not noise.
 */
export class NotFoundError extends Error {
  readonly url: string
  constructor(url: string) {
    super(`HTTP 404 (${url})`)
    this.name = 'NotFoundError'
    this.url = url
  }
}

/**
 * Fetch a URL, returning the text body. Throws on persistent failure,
 * abort, or non-2xx after retries.
 *
 *  - 429 / 5xx → retry with exponential backoff up to `maxRetries`
 *  - 4xx other → throws immediately (it won't succeed by trying again)
 *  - timeout / network → retry, same budget
 *  - signal.aborted → throws AbortError-like; caller's enqueueBuild stops
 */
export async function politeFetch(url: string, opts: PoliteFetchOptions = {}): Promise<string> {
  const {
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    signal,
    headers = {},
    method = 'GET',
    body,
  } = opts

  const host = new URL(url).host

  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('aborted')

    await acquireSlot(host, minIntervalMs)
    if (signal?.aborted) throw new Error('aborted')

    const controller = new AbortController()
    // Forward the caller's abort so it kills the in-flight fetch too.
    const onParentAbort = () => controller.abort()
    signal?.addEventListener('abort', onParentAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
          ...headers,
        },
      })
      clearTimeout(timer)
      signal?.removeEventListener('abort', onParentAbort)

      if (res.ok) return await res.text()

      // 404 is a clean signal — slug stale / not listed / never existed.
      // Throw as NotFoundError so the caller can count it as its own
      // bucket and never retry (M2). FSP stale slugs 404 by design.
      if (res.status === 404) throw new NotFoundError(url)

      // 4xx non-rate-limited → terminal. Don't waste retries.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} (${url})`)
      }
      // 429 / 5xx → retry after backoff.
      lastErr = new Error(`HTTP ${res.status} (${url})`)
    } catch (err) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onParentAbort)
      // Caller's abort propagates through controller.abort() → fetch throws.
      if (signal?.aborted) throw new Error('aborted')
      // ── Terminal errors: throw IMMEDIATELY, skip backoff (Ralph M2).
      // 404 stale-slug, 4xx other → no amount of waiting will help, and
      // burning two backoff sleeps per 404 across 234 rows wastes minutes.
      if (err instanceof NotFoundError) throw err
      if (err instanceof Error && /^HTTP 4\d\d /.test(err.message) && !/^HTTP 429 /.test(err.message)) {
        throw err
      }
      lastErr = err
    }

    // Exponential backoff: 400ms · 1.6s · 6.4s (attempts 0..2 → sleep before next).
    // With jitter so a fleet of workers retrying after a 5xx-spike doesn't
    // thundering-herd back at the upstream at the same instant.
    if (attempt < maxRetries) {
      const base = 400 * Math.pow(4, attempt)
      const jitter = base * 0.3 * Math.random()             // 0–30% extra
      await new Promise((res) => setTimeout(res, base + jitter))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * Variant of politeFetch that returns the raw Response so the caller can
 * read headers (Set-Cookie) before consuming the body. Same gate / retry /
 * abort semantics as politeFetch. Use when you need cookies for a session-
 * coupled POST (e.g. Livewire CSRF requires the XSRF cookie set by a prior
 * GET).
 */
export async function politeFetchRaw(url: string, opts: PoliteFetchOptions = {}): Promise<Response> {
  const {
    // Ralph 2026-06-05 — was 200ms (asymmetric with politeFetch's 0).
    // Same rationale: per-host gate hard-capped throughput regardless of
    // worker count. Caller can opt back in via `{minIntervalMs: N}`.
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    signal,
    headers = {},
    method = 'GET',
    body,
  } = opts
  const host = new URL(url).host
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('aborted')
    await acquireSlot(host, minIntervalMs)
    if (signal?.aborted) throw new Error('aborted')
    const controller = new AbortController()
    const onParentAbort = () => controller.abort()
    signal?.addEventListener('abort', onParentAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
          ...headers,
        },
      })
      clearTimeout(timer)
      signal?.removeEventListener('abort', onParentAbort)
      if (res.ok) return res
      if (res.status === 404) throw new NotFoundError(url)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} (${url})`)
      }
      lastErr = new Error(`HTTP ${res.status} (${url})`)
    } catch (err) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onParentAbort)
      if (signal?.aborted) throw new Error('aborted')
      if (err instanceof NotFoundError) throw err
      if (err instanceof Error && /^HTTP 4\d\d /.test(err.message) && !/^HTTP 429 /.test(err.message)) throw err
      lastErr = err
    }
    if (attempt < maxRetries) {
      const base = 400 * Math.pow(4, attempt)
      const jitter = base * 0.3 * Math.random()
      await new Promise((res) => setTimeout(res, base + jitter))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
