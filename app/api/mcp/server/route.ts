/**
 * /api/mcp/server — HTTP transport for the Oskar MCP orchestrator.
 *
 * Phase 3 (Ralph 2026-04-30, late): the orchestrator is now reachable as
 * a remote MCP server. Multiple clients (CD, WebDev, Sentinel Ti, Jedi
 * Code) connect over HTTP+SSE to the SAME orchestrator running inside
 * Next.js. They share the in-memory event bus (no SSE self-loop), they
 * share the build escrow, they share the ask-user bus.
 *
 * Per-(sessionId, agentRole) Server instances are cached in a globalThis-
 * pinned map. First request from a (session, role) pair creates a Server
 * via the factory; subsequent requests reuse it. The MCP transport
 * manages its own per-connection session for reconnects.
 *
 * Identity comes from headers:
 *   - `X-Oskar-Session: <session-id>`  — required
 *   - `X-Oskar-Agent: cd | webdev | sentinel | jedi-code`  — required
 *
 * Each Server's tool list is filtered by role (see tools.ts:listToolsForRole).
 * An agent literally cannot see tools it isn't allowed to call — the
 * filtering is at the SCHEMA layer, not just permission-checked at
 * dispatch time.
 *
 * Direct event-bus subscription (kills the legacy SSE self-loop):
 * since the orchestrator now lives in the same process as the event bus,
 * each Server subscribes to `lib/event-bus.ts:subscribe()` directly and
 * forwards events to its connected client via `sendLoggingMessage`. No
 * fetch, no parse, no reconnect logic. ~80 lines of `notifications.ts`
 * become a single line.
 *
 * 2026-04-30 (Phase 3, post-CD-review): three lifecycle improvements per
 * CD's audit:
 *   1. transport.onclose evicts the cache entry + releases the event-bus
 *      subscription (no more leak on clean shutdown).
 *   2. sendLoggingMessage failures mark the entry stale; next access
 *      rebuilds it (no more dead-transport reuse).
 *   3. Lazy TTL eviction on every lookup — entries idle > IDLE_TTL_MS get
 *      cleaned up. Backstop for crashes that don't fire onclose.
 * The on-create replay was REMOVED (it raced the GET stream open and could
 * double-deliver across reconnects). The agent's `replay_events()` polling
 * tool is now the only replay path — deterministic, agent-controlled.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { randomUUID } from 'crypto'
import { createOskarServer } from '@/mcp-server/dist/server-factory.js'
import { subscribe } from '@/lib/event-bus'
import type { AgentRole } from '@/lib/mcp-config'
import {
  registerInstance,
  unregisterInstance,
} from '@/lib/agent-inbox-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Per-(session, role) Server cache ────────────────────────────────────────

/**
 * Idle TTL — entries not touched within this window are evicted on next lookup.
 *
 * 2026-04-30 (Ralph + CD post-mortem): bumped from 30min → 24h. Previous
 * 30min was too aggressive: a Claude Code session sitting idle for 30+ min
 * would get its server entry evicted; next call from that client failed with
 * "Server not initialized" because the new transport's session id didn't
 * match the client's cached one. The MCP client doesn't auto-retry on this
 * error — recovery requires a Claude Code session restart. 24h matches
 * realistic dev cadence (most sessions die when Next.js dev restarts anyway,
 * which clears state cleanly).
 */
const IDLE_TTL_MS = 24 * 60 * 60_000

interface ServerEntry {
  server: Server
  transport: WebStandardStreamableHTTPServerTransport
  unsubscribeEventBus: () => void
  /** Wall-clock of last request that touched this entry. */
  lastTouchedMs: number
  /** Set true when transport closes OR a send fails. Next lookup rebuilds. */
  stale: boolean
}

const GLOBAL_KEY = Symbol.for('oskar.mcp-http.servers') as unknown as string
const _g = globalThis as Record<string, unknown>
const servers: Map<string, ServerEntry> =
  (_g[GLOBAL_KEY] as Map<string, ServerEntry>) ||
  ((_g[GLOBAL_KEY] = new Map<string, ServerEntry>()) as Map<string, ServerEntry>)

function cacheKey(sessionId: string, agentRole: AgentRole, instanceId: string): string {
  return `${sessionId}|${agentRole}|${instanceId}`
}

/**
 * Sentinel instance id used when a client doesn't provide one.
 *
 * Backwards compat (Commit 1, 2026-05-01): pre-instance-aware clients
 * (CD bridge with stale cached config, ad-hoc curl probes, dev tooling)
 * don't pass `?instance=` or `X-Oskar-Instance`. They land on a stable
 * per-(session, role) "legacy" instance that participates in fan-out
 * alongside instance-aware clients. Once everyone moves to instance-
 * aware configs (next bridge respawn for CD), this becomes dead weight.
 */
function legacyInstanceId(sessionId: string, agentRole: AgentRole): string {
  return `legacy-${sessionId}-${agentRole}`
}

const VALID_ROLES = new Set<AgentRole>(['cd', 'webdev', 'sentinel', 'jedi-code'])

function isValidRole(value: string): value is AgentRole {
  return VALID_ROLES.has(value as AgentRole)
}

async function disposeEntry(key: string, entry: ServerEntry): Promise<void> {
  try { entry.unsubscribeEventBus() } catch {}
  try { await entry.transport.close() } catch {}
  servers.delete(key)
  console.log(`[mcp-http] disposed: ${key}`)
}

/**
 * Lazy GC — runs on every getOrCreateServer call. Walks the cache once,
 * disposes entries that are stale or idle past IDLE_TTL_MS. Cheap because
 * the cache is small (one entry per active session × role pair).
 */
async function evictDeadAndIdle(): Promise<void> {
  const now = Date.now()
  for (const [key, entry] of servers) {
    if (entry.stale || now - entry.lastTouchedMs > IDLE_TTL_MS) {
      await disposeEntry(key, entry)
    }
  }
}

async function getOrCreateServer(
  sessionId: string,
  agentRole: AgentRole,
  instanceId: string,
  forceRebuild: boolean = false,
): Promise<ServerEntry> {
  await evictDeadAndIdle()

  const key = cacheKey(sessionId, agentRole, instanceId)
  const existing = servers.get(key)
  // 2026-04-30 (Ralph + diagnostic): force-rebuild on `initialize` requests
  // (caller passes forceRebuild=true). Each MCP transport accepts
  // `initialize` exactly once; reusing a cached transport for a new
  // initialize fails with "Server already initialized". A fresh
  // initialize means a fresh client session — give it a fresh transport.
  if (existing && !forceRebuild && !existing.stale) {
    existing.lastTouchedMs = Date.now()
    return existing
  }
  if (existing) {
    // stale OR force-rebuild — clean up before recreating.
    await disposeEntry(key, existing)
  }

  const server = createOskarServer({ sessionId, agentRole, instanceId })

  // Stateful transport — each connection gets its own MCP session ID for
  // reconnect support.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await server.connect(transport)

  // Forward declaration so the close hook + send-failure handler can mark
  // the entry stale by reference.
  const entry: ServerEntry = {
    server,
    transport,
    unsubscribeEventBus: () => {},
    lastTouchedMs: Date.now(),
    stale: false,
  }

  // Register this instance with the agent-inbox-bus so role-only fan-out
  // notify_agent calls reach it. Unregister when the transport closes —
  // a dead instance shouldn't keep accumulating messages it'll never read.
  registerInstance(sessionId, agentRole, instanceId)

  // Wire transport.onclose → mark stale + drop instance from registry.
  // The next request that hits this (session, role, instance) triple sees
  // stale and rebuilds. evictDeadAndIdle disposes immediately on the very
  // next lookup.
  transport.onclose = () => {
    entry.stale = true
    unregisterInstance(sessionId, agentRole, instanceId)
    console.log(`[mcp-http] transport closed: ${key}`)
  }

  // Direct event-bus subscription. No on-create replay — the agent's
  // `replay_events()` polling tool is the deterministic recovery path.
  //
  // 2026-04-30 (Ralph + CD, post-mortem): an earlier version marked the
  // entry STALE on every sendLoggingMessage failure. That was wrong:
  // sendLoggingMessage requires the client's GET stream to be open, but
  // there are normal moments where it ISN'T (between calls, during the
  // brief window after initialize before the client opens GET, etc). A
  // transient send failure during one of those windows would tear the
  // whole entry down → next request fails with "Server not initialized"
  // because the new transport has a fresh session id but the client
  // still holds the old one. The fix: send failures are NORMAL. Drop
  // the event silently. The ring buffer + replay_events() polling tool
  // is the durability layer — push notifications are best-effort. Only
  // transport.onclose marks stale (real connection death).
  entry.unsubscribeEventBus = subscribe(sessionId, (event) => {
    server.sendLoggingMessage({
      level: (event.level as 'info' | 'warning' | 'error') || 'info',
      data: event,
    }).catch(() => {
      // Silently drop. Most likely the GET stream isn't open right now.
      // The agent will catch up on next replay_events() poll.
    })
  })

  servers.set(key, entry)
  console.log(`[mcp-http] new server: ${key}`)
  return entry
}

// ── Route handlers ──────────────────────────────────────────────────────────

async function handle(req: Request): Promise<Response> {
  // 2026-04-30: identity comes from headers OR URL query params. Some
  // MCP clients (notably some Claude Code builds) don't propagate the
  // `headers` field of `.mcp.json` — every request lands here without
  // the X-Oskar-* headers and gets rejected with 400. Fallback to query
  // params so config can encode identity in the URL when headers don't
  // make it through.
  const url = new URL(req.url)
  const sessionId =
    req.headers.get('X-Oskar-Session') ||
    url.searchParams.get('session')
  const agentRoleRaw =
    req.headers.get('X-Oskar-Agent') ||
    url.searchParams.get('agent')
  const instanceIdRaw =
    req.headers.get('X-Oskar-Instance') ||
    url.searchParams.get('instance')

  if (!sessionId) {
    // Log what we DID receive so config errors are debuggable.
    const hdrs = Array.from(req.headers.entries())
      .filter(([k]) => !/^(content-length|connection|host|accept|user-agent)$/i.test(k))
      .map(([k, v]) => `${k}=${v.slice(0, 40)}`)
      .join(' ')
    console.warn(`[mcp-http] 400: X-Oskar-Session missing. method=${req.method} url=${req.url} headers=${hdrs}`)
    return Response.json(
      {
        error: 'X-Oskar-Session header (or ?session= query param) required',
        hint: 'Configure your MCP client to send the X-Oskar-Session header, or include ?session=<id>&agent=<role> in the URL.',
      },
      { status: 400 },
    )
  }
  if (!agentRoleRaw || !isValidRole(agentRoleRaw)) {
    console.warn(`[mcp-http] 400: X-Oskar-Agent missing/invalid. session=${sessionId} value=${agentRoleRaw}`)
    return Response.json(
      {
        error: `X-Oskar-Agent header (or ?agent= query param) must be one of: ${[...VALID_ROLES].join(', ')}`,
        hint: 'Configure your MCP client to send the X-Oskar-Agent header, or include ?agent=<role> in the URL.',
      },
      { status: 400 },
    )
  }
  const agentRole = agentRoleRaw

  // Instance id (Commit 1, 2026-05-01): disambiguates multiple clients of
  // the same role. The proxy mints one at fork; CD's bridge config gets one
  // at spawn. Old clients that don't pass it get a stable per-(session, role)
  // legacy id so they still work — they just share one queue with each other.
  const instanceId = instanceIdRaw && instanceIdRaw.trim().length > 0
    ? instanceIdRaw.trim()
    : legacyInstanceId(sessionId, agentRole)

  // Detect fresh `initialize` requests: no mcp-session-id header means
  // the client doesn't have a transport-level session yet. Force-rebuild
  // the cached Server so its transport accepts the initialize.
  const hasMcpSessionHeader = !!req.headers.get('mcp-session-id')
  const forceRebuild = req.method === 'POST' && !hasMcpSessionHeader

  let entry: ServerEntry
  try {
    entry = await getOrCreateServer(sessionId, agentRole, instanceId, forceRebuild)
  } catch (err) {
    console.error('[mcp-http] failed to create server:', err)
    return Response.json(
      { error: `Failed to initialize MCP server: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  return entry.transport.handleRequest(req)
}

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  return handle(req)
}

export async function DELETE(req: Request) {
  // Per the MCP spec, DELETE terminates a session. The transport's
  // handleRequest invokes onsessionclosed, then onclose fires our cleanup.
  return handle(req)
}
