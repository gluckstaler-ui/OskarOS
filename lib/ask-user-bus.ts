/**
 * ask-user resolver bus (Phase 2 Tier S — 2026-04-30).
 *
 * The `ask_user` MCP tool is synchronous from the agent's POV: the call
 * blocks until the user picks an option (or 10 minutes pass, in which
 * case the cancel sentinel returns).
 *
 * Mechanism:
 *
 *   1. Agent calls ask_user → MCP server POSTs /api/mcp/ask-user
 *   2. /api/mcp/ask-user generates a requestId, registers a pending
 *      Promise via `awaitChoice(requestId)`, publishes `cd_ask_user`
 *      event-bus event with {requestId, question, options}.
 *   3. Frontend receives event, renders modal, user clicks an option.
 *   4. Frontend POSTs /api/mcp/ask-user-response/{requestId} with {value}.
 *   5. Resolver endpoint calls `deliverChoice(requestId, value)` → the
 *      pending Promise resolves with the chosen string.
 *   6. /api/mcp/ask-user returns {choice} → MCP tool returns it to the agent.
 *
 * Per-process state: this Map lives in the Next.js dev/prod process. Both
 * /api/mcp/ask-user and /api/mcp/ask-user-response/{requestId} run in the
 * same Node process so they share the Map. (For a multi-instance deploy
 * we'd need Redis or similar — out of scope for v1.)
 *
 * Concurrency: the spec says "second ask_user while first is open → second
 * is queued OR rejected." We implement reject-with-typed-error so the agent
 * gets a clear signal rather than ambiguous queueing.
 */

const CANCEL_SENTINEL = '__cancelled__' as const
const ASK_USER_TIMEOUT_MS = 10 * 60 * 1000 // 10 min per spec

interface PendingAsk {
  resolve: (value: string) => void
  timeout: ReturnType<typeof setTimeout>
  question: string
  startedAt: number
}

// Per-session: at most one ask_user open per session at a time. Concurrent
// calls within the same session are rejected with a typed error.
//
// 2026-04-30 (Ralph): pinned to globalThis. Same module-duplication trap
// the event-bus had — Next.js dev compiles each route handler
// independently; a module-scoped Map ends up with one instance per route.
// /api/mcp/ask-user registers in Map A; /api/mcp/ask-user-response/[id]
// looks up in Map B; deliverChoice returns false; modal click never
// resolves the Promise; CD blocks forever on the await. globalThis
// dedups the Map across module instances and across HMR reloads.
const G_BY_SESSION = Symbol.for('oskar.ask-user-bus.bySession') as unknown as string
const G_BY_REQUEST = Symbol.for('oskar.ask-user-bus.byRequest') as unknown as string
const _g = globalThis as Record<string, unknown>
const pendingBySession: Map<string, PendingAsk> =
  (_g[G_BY_SESSION] as Map<string, PendingAsk>) ||
  ((_g[G_BY_SESSION] = new Map<string, PendingAsk>()) as Map<string, PendingAsk>)
const pendingByRequest: Map<string, { sessionId: string; ask: PendingAsk }> =
  (_g[G_BY_REQUEST] as Map<string, { sessionId: string; ask: PendingAsk }>) ||
  ((_g[G_BY_REQUEST] = new Map<string, { sessionId: string; ask: PendingAsk }>()) as Map<string, { sessionId: string; ask: PendingAsk }>)

export interface RegisterAskOptions {
  sessionId: string
  question: string
  timeoutMs?: number
}

export type RegisterAskResult =
  | { ok: true; requestId: string; promise: Promise<string> }
  | { ok: false; error: string }

/**
 * Register a pending ask_user. Returns the requestId + a Promise that
 * resolves with the user's choice (or the cancel sentinel on timeout).
 *
 * Returns `{ok: false}` if a previous ask_user is already open for this
 * session — reject-with-typed-error per spec.
 */
export function registerAsk(opts: RegisterAskOptions): RegisterAskResult {
  if (pendingBySession.has(opts.sessionId)) {
    return {
      ok: false,
      error: `Another ask_user is already open for session ${opts.sessionId}. Wait for it to resolve before asking again.`,
    }
  }

  const requestId = crypto.randomUUID()
  let resolveFn!: (value: string) => void
  const promise = new Promise<string>((resolve) => {
    resolveFn = resolve
  })

  const timeout = setTimeout(() => {
    // Timeout fires → user took too long. Resolve with cancel sentinel,
    // clean up state.
    const ask = pendingBySession.get(opts.sessionId)
    if (ask?.resolve === resolveFn) {
      pendingBySession.delete(opts.sessionId)
      pendingByRequest.delete(requestId)
      ask.resolve(CANCEL_SENTINEL)
    }
  }, opts.timeoutMs ?? ASK_USER_TIMEOUT_MS)

  const ask: PendingAsk = {
    resolve: resolveFn,
    timeout,
    question: opts.question,
    startedAt: Date.now(),
  }
  pendingBySession.set(opts.sessionId, ask)
  pendingByRequest.set(requestId, { sessionId: opts.sessionId, ask })
  return { ok: true, requestId, promise }
}

/**
 * Resolve a pending ask_user with the user's choice. Called from
 * /api/mcp/ask-user-response/{requestId}. Returns `false` if the requestId
 * is unknown (already resolved, expired, or never existed).
 */
export function deliverChoice(requestId: string, choice: string): boolean {
  const entry = pendingByRequest.get(requestId)
  if (!entry) return false
  clearTimeout(entry.ask.timeout)
  pendingBySession.delete(entry.sessionId)
  pendingByRequest.delete(requestId)
  entry.ask.resolve(choice)
  return true
}

/** Test/debug helper — current pending count. */
export function pendingAskCount(): number {
  return pendingByRequest.size
}

export const ASK_USER_CANCEL_SENTINEL = CANCEL_SENTINEL
