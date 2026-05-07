#!/usr/bin/env node
// stdio→HTTP MCP proxy for oskar-orchestrator.
//
// Why: Claude Code defers HTTP-type MCP servers (a network round-trip at
// session start would block boot if the remote is slow/down). stdio servers
// are forked at session start and load eagerly. Wrapping the HTTP endpoint
// in a stdio proxy gets us eager loading without changing the server.
//
// Usage in .mcp.json (workspace root or project root):
//   {
//     "mcpServers": {
//       "oskar-orchestrator": {
//         "command": "node",
//         "args": ["oskar-prototype/scripts/mcp-stdio-proxy.mjs"],
//         "env": {
//           "OSKAR_ORCHESTRATOR_URL": "http://localhost:3000/api/mcp/server",
//           "OSKAR_SESSION": "2026-01-27-31",
//           "OSKAR_AGENT": "jedi-code"
//         }
//       }
//     }
//   }
//
// Session resolution (Ralph + JC, 2026-05-06): OSKAR_SESSION is now a
// FALLBACK ONLY. Live session-id comes from `.runtime/active-session`,
// written by the app on every sessionId state change. The proxy re-reads
// the file before each MCP message and re-handshakes when the id changes.
// This means session switches in the app no longer require a Claude Code
// restart.
//
// Protocol notes:
// - MCP stdio transport uses newline-delimited JSON-RPC 2.0 messages.
//   stdout is reserved for those frames; all diagnostics go to stderr.
// - Notifications (no `id` field) expect no response.
// - HTTP responses may be either application/json (single response) or
//   text/event-stream (server streams multiple messages). Both handled.
// - The MCP `mcp-session-id` response header (set by Streamable-HTTP servers
//   on first request) is captured and re-sent on subsequent requests.

import readline from 'node:readline'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_BASE = process.env.OSKAR_ORCHESTRATOR_URL
const SESSION_FALLBACK = process.env.OSKAR_SESSION || ''
const AGENT = process.env.OSKAR_AGENT

if (!URL_BASE || !AGENT) {
  console.error('[mcp-proxy] Missing env: OSKAR_ORCHESTRATOR_URL, OSKAR_AGENT')
  process.exit(1)
}
if (!SESSION_FALLBACK) {
  console.error('[mcp-proxy] OSKAR_SESSION env not set — proxy will fail until .runtime/active-session is written by the app')
}

// Per-fork instance UUID. Mint here if not provided in env so Ralph doesn't
// have to manage it manually. Stable for the lifetime of THIS proxy process —
// every Claude Code launch forks a fresh proxy and gets a fresh id, which is
// exactly the cardinality the bus uses to disambiguate multiple jedi-code
// clients sharing one role.
const INSTANCE = process.env.OSKAR_INSTANCE_ID || randomUUID()

// Sidecar pointer file written by /api/active-session POST. Path resolves
// from this script's location: `<project>/scripts/mcp-stdio-proxy.mjs`
// → `<project>/.runtime/active-session`.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SIDECAR_PATH = path.resolve(__dirname, '..', '.runtime', 'active-session')

/**
 * Read the active session id. Sidecar file wins; env-var is fallback for
 * the bootstrap case (file doesn't exist yet because the app hasn't
 * mounted). Returns the id or empty string if neither is present.
 */
function readActiveSession() {
  try {
    return readFileSync(SIDECAR_PATH, 'utf-8').trim()
  } catch {
    return SESSION_FALLBACK
  }
}

let currentSession = readActiveSession()

function buildFetchUrl(sessionId) {
  return (
    `${URL_BASE}?session=${encodeURIComponent(sessionId)}` +
    `&agent=${encodeURIComponent(AGENT)}` +
    `&instance=${encodeURIComponent(INSTANCE)}`
  )
}

let FETCH_URL = buildFetchUrl(currentSession)

console.error(`[mcp-proxy] stdio → ${FETCH_URL}`)
console.error(`[mcp-proxy] instance: ${INSTANCE} (${process.env.OSKAR_INSTANCE_ID ? 'from env' : 'minted at fork'})`)
console.error(`[mcp-proxy] active-session sidecar: ${SIDECAR_PATH}`)

let mcpSessionId = null

function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function sendOnce(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  }
  if (mcpSessionId) headers['mcp-session-id'] = mcpSessionId
  return fetch(FETCH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  })
}

// Synthetic initialize used only for orchestrator-restart recovery. The
// response body is discarded — its purpose is purely to obtain a fresh
// `mcp-session-id` from the upstream Streamable-HTTP transport. Claude
// Code is unaware this happened; from its POV the original request just
// took a beat longer.
async function reinitialize() {
  try {
    const resp = await fetch(FETCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'mcp-proxy-reinit',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'mcp-stdio-proxy', version: '0.1' },
        },
      }),
    })
    if (!resp.ok) {
      console.error(`[mcp-proxy] reinit failed: HTTP ${resp.status}`)
      return false
    }
    const sid = resp.headers.get('mcp-session-id')
    if (sid) {
      mcpSessionId = sid
      console.error(`[mcp-proxy] re-initialized; new session id: ${sid}`)
    }
    await resp.text().catch(() => {})
    return true
  } catch (err) {
    console.error(`[mcp-proxy] reinit fetch failed: ${err.message}`)
    return false
  }
}

/**
 * Re-read the sidecar file on every request. If the active session id has
 * changed since the last forward, drop the cached `mcp-session-id` (which
 * was issued for the OLD session's transport) and rebuild FETCH_URL. The
 * stale-session recovery path below will then auto-rehandshake on the
 * first 400/404, which is exactly what we want.
 */
function refreshSessionFromSidecar() {
  const next = readActiveSession()
  if (!next || next === currentSession) return false
  console.error(`[mcp-proxy] active session changed: ${currentSession} → ${next}`)
  currentSession = next
  FETCH_URL = buildFetchUrl(currentSession)
  // Force re-handshake — the old session id is for a different bus key.
  mcpSessionId = null
  return true
}

async function forward(req) {
  refreshSessionFromSidecar()
  let response
  try {
    response = await sendOnce(req)
  } catch (err) {
    console.error(`[mcp-proxy] fetch failed for ${req.method ?? '?'}: ${err.message}`)
    if (req.id != null) {
      writeMessage({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: `Proxy fetch failed: ${err.message}` },
      })
    }
    return
  }

  // ── Stale-session recovery ────────────────────────────────────────────
  // Next.js dev cycle / orchestrator crash drops the in-process session
  // cache. We still hold the old `mcp-session-id` and keep re-sending it.
  // The orchestrator's response shape varies:
  //   • 404 "Session not found"            — transport-level rejection
  //   • 400 "Server not initialized"       — route created a fresh transport
  //                                          (no force-rebuild because we
  //                                          DID send a session id, just a
  //                                          stale one) and the transport
  //                                          rejects the non-initialize
  //                                          request because it's never
  //                                          seen the old session id.
  // Both signal the same condition: our cached id is stale. Clear it,
  // re-handshake, replay the original request exactly once. Without this
  // the MCP bridge dies on every dev restart until Claude Code itself
  // restarts.
  const isStaleSessionResponse = (status, body) =>
    (status === 404 && body.includes('Session not found')) ||
    (status === 400 && body.includes('Server not initialized'))

  if ((response.status === 404 || response.status === 400) && mcpSessionId) {
    const body = await response.text().catch(() => '')
    if (isStaleSessionResponse(response.status, body)) {
      console.error(`[mcp-proxy] stale session id (HTTP ${response.status}); re-handshaking…`)
      mcpSessionId = null
      const ok = await reinitialize()
      if (!ok) {
        if (req.id != null) {
          writeMessage({
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32603,
              message: 'Proxy: re-handshake failed after orchestrator restart',
            },
          })
        }
        return
      }
      try {
        response = await sendOnce(req)
      } catch (err) {
        console.error(`[mcp-proxy] retry fetch failed: ${err.message}`)
        if (req.id != null) {
          writeMessage({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32603, message: `Proxy retry failed: ${err.message}` },
          })
        }
        return
      }
    } else {
      // Unrelated 4xx — reconstruct a Response so the standard error path
      // below can read the body without re-fetching.
      response = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
  }

  // Capture or refresh the MCP session id if the server emits one. The
  // Streamable-HTTP transport assigns it on initialize and requires it on
  // every subsequent request — without it the orchestrator returns
  // "Server not initialized" for everything after the first call.
  const sid = response.headers.get('mcp-session-id')
  if (sid && sid !== mcpSessionId) {
    mcpSessionId = sid
    console.error(`[mcp-proxy] session id assigned: ${sid}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable>')
    console.error(`[mcp-proxy] HTTP ${response.status} for ${req.method ?? '?'}: ${body.slice(0, 200)}`)
    if (req.id != null) {
      writeMessage({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32603,
          message: `Upstream HTTP ${response.status}: ${body.slice(0, 500)}`,
        },
      })
    }
    return
  }

  // Notifications: no response expected. Drain the body so the connection
  // releases cleanly.
  if (req.id == null) {
    await response.text().catch(() => {})
    return
  }

  const ctype = response.headers.get('content-type') || ''

  if (ctype.includes('application/json')) {
    const out = await response.json()
    writeMessage(out)
    return
  }

  if (ctype.includes('text/event-stream')) {
    const reader = response.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const event = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const dataStr = event
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('\n')
        if (!dataStr) continue
        try {
          writeMessage(JSON.parse(dataStr))
        } catch {
          // Non-JSON event payload (e.g. heartbeat) — skip.
        }
      }
    }
    return
  }

  const body = await response.text().catch(() => '')
  console.error(`[mcp-proxy] unexpected content-type "${ctype}" for ${req.method ?? '?'}; body: ${body.slice(0, 200)}`)
}

// Serialize forwards. MCP stdio is request/response over a single channel,
// and the orchestrator's session-id (assigned on initialize, required on
// every subsequent request) only works if requests can't race. Each new
// stdin line chains onto the tail of the queue.
let queue = Promise.resolve()

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req
  try {
    req = JSON.parse(trimmed)
  } catch {
    console.error(`[mcp-proxy] invalid JSON on stdin: ${trimmed.slice(0, 200)}`)
    return
  }
  queue = queue.then(() => forward(req)).catch((err) => {
    console.error(`[mcp-proxy] queue task failed: ${err?.message ?? err}`)
  })
})

rl.on('close', async () => {
  console.error('[mcp-proxy] stdin closed; draining queue…')
  await queue.catch(() => {})
  console.error('[mcp-proxy] all drained; exiting.')
  process.exit(0)
})

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.error(`[mcp-proxy] received ${sig}; exiting.`)
    process.exit(0)
  })
}
