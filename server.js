/**
 * Custom Next.js dev/prod server — exists for ONE reason: extend Node's
 * default HTTP `requestTimeout` (300_000ms / 5 min) so long-running Nano
 * Banana generations don't get their connection silently dropped.
 *
 * Symptom this fixes (Ralph 2026-06-28):
 *   - Panel "Generate" hits /api/edit-image directly (synchronous).
 *   - Nano returns in 60–250s normally, but slower prompts push past 300s.
 *   - Without this server, Node drops the connection at exactly 5min with
 *     an empty body → frontend's `await response.json()` throws
 *     `SyntaxError: Unexpected end of JSON input`.
 *   - `export const maxDuration` in the route is a Vercel adapter hint —
 *     it does nothing in `next dev` or `next start` locally.
 *
 * The fix: bump `server.requestTimeout` + `server.headersTimeout` to 15min
 * before listen(). Hot reload, server actions, middleware, etc. all keep
 * working — custom server only overrides the socket-level timeouts.
 *
 * To use:
 *   - dev:  `node server.js` (replace `next dev` in package.json scripts)
 *   - prod: `node server.js NODE_ENV=production`
 *
 * Long-term fix is to move /api/edit-image to the escrow pattern that
 * /api/mcp/generate-image already uses (return 202 + jobId immediately,
 * publish image_ready event when work completes). This server timeout is
 * the cheap unblock until that refactor lands.
 */

const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)
const hostname = process.env.HOSTNAME || 'localhost'

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  // The actual fix. Node 18+ defaults: requestTimeout 300_000, headersTimeout
  // 60_000, keepAliveTimeout 5_000. We need request to be longer than the
  // worst-case Nano roundtrip (gen + describe + proofread ~250s + slack).
  server.requestTimeout = 900_000   // 15 min
  server.headersTimeout = 905_000   // must be ≥ requestTimeout per Node docs
  server.keepAliveTimeout = 65_000  // > typical LB idle to avoid 502s

  server.listen(port, () => {
    console.log(
      `> Ready on http://${hostname}:${port} ` +
      `(requestTimeout=${server.requestTimeout}ms — long-Nano-call safe)`
    )
  })
})
