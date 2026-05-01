/**
 * api-client — thin fetch() wrapper for the MCP server's tool implementations.
 *
 * The MCP server runs as a stdio subprocess of the Claude CLI bridge. It
 * doesn't share the Next.js process namespace, so it talks to the running
 * app over HTTP. Each MCP tool is a typed thin client over an existing
 * Next.js API route.
 *
 * 2026-04-30 (Ralph) — STRUCTURED FAILURE SEMANTICS.
 *
 * The fix lives at CD's REASONING layer, not the network. The previous
 * `fetch_failed: fetch failed` string reads to an LLM as "transient
 * network blip, try again" — so CD retried, and retried, and retried.
 *
 * Now every failure carries:
 *   - a typed `error` CODE (mcp_unavailable / mcp_timeout / mcp_route_error
 *     / mcp_server_error / mcp_validation_error / mcp_not_found)
 *   - a `recovery` string that explicitly tells the agent what to do
 *     ("Do NOT retry. Work around with FileWrite/FileEdit, or tell the
 *     user.") — no ambiguity about whether to loop.
 *
 * The CD agent prompt names these codes at the top level: when CD sees
 * `mcp_unavailable` (or any structured "do not retry" signal) the rule is
 * STOP. Don't call MCP again this turn. Work around or escalate to user.
 *
 * No timeouts. No process kills. No bridge-level interception. The
 * signal is unambiguous and CD's reasoning loop respects it.
 */

const BASE_URL = process.env.OSKAR_BASE_URL || 'http://localhost:3000'

/**
 * Typed error codes. The agent prompt knows these names.
 *
 * Retry policy carried in `recovery`:
 *   - mcp_unavailable    — DO NOT retry. Fetch threw (server unreachable,
 *                          DNS, connection refused). Work around or tell user.
 *   - mcp_timeout        — DO NOT retry. The route took too long. The
 *                          underlying op may still be running. Tell user.
 *   - mcp_validation_error — Args were rejected (HTTP 400). RETRY with
 *                          corrected args (this is the only retryable code).
 *   - mcp_not_found      — Target missing (HTTP 404). Try a different
 *                          target OR tell user. DO NOT retry the same call.
 *   - mcp_route_error    — Other 4xx. DO NOT retry. Surface to user.
 *   - mcp_server_error   — HTTP 5xx. DO NOT retry. Backend broke; tell user.
 */
export type McpErrorCode =
  | 'mcp_unavailable'
  | 'mcp_timeout'
  | 'mcp_validation_error'
  | 'mcp_not_found'
  | 'mcp_route_error'
  | 'mcp_server_error'

export interface McpError {
  code: McpErrorCode
  /** Human-readable detail. Includes URL, raw HTTP status, etc. */
  detail: string
  /**
   * Explicit instruction to the AGENT, not the human. Format intended to
   * be read verbatim by the LLM consuming the tool result. Always names
   * the retry stance ("DO NOT retry" / "RETRY with corrected args").
   */
  recovery: string
}

export interface ApiResponse<T = unknown> {
  ok: boolean
  status: number
  body: T
  /** Backwards-compat string. Always equals `mcpError.recovery + ' — ' + mcpError.detail`. */
  error?: string
  /** New (2026-04-30): structured failure. Set iff !ok. */
  mcpError?: McpError
}

/** Pretty-print the structured error so it survives JSON.stringify in tool results. */
export function formatMcpError(err: McpError): string {
  return `${err.code}: ${err.detail} | recovery: ${err.recovery}`
}

function classifyHttpStatus(status: number): McpErrorCode {
  if (status === 400 || status === 422) return 'mcp_validation_error'
  if (status === 404) return 'mcp_not_found'
  if (status >= 400 && status < 500) return 'mcp_route_error'
  return 'mcp_server_error'
}

function recoveryFor(code: McpErrorCode): string {
  switch (code) {
    case 'mcp_unavailable':
      return 'DO NOT retry MCP this turn. The orchestrator is unreachable. Work around using your file tools (Read/Write/Edit) if possible, or tell the user MCP is down and ask how to proceed.'
    case 'mcp_timeout':
      return 'DO NOT retry. The route did not respond in time. The underlying operation may still be running in the background — tell the user and wait for an event-bus notification, or ask whether to abandon and try a different approach.'
    case 'mcp_validation_error':
      return 'Your arguments were rejected. Read the detail, FIX YOUR ARGS, and call once more with corrected arguments. This is the only error class where retry is appropriate.'
    case 'mcp_not_found':
      return 'The target does not exist. DO NOT retry the same call. Either pick a different target (check session_meta or list_assets) or tell the user the resource is missing.'
    case 'mcp_route_error':
      return 'DO NOT retry. The route refused the request. Surface the failure to the user with the detail.'
    case 'mcp_server_error':
      return 'DO NOT retry MCP this turn. The backend errored. Tell the user, and either work around with file tools or ask how to proceed.'
  }
}

function makeError(code: McpErrorCode, detail: string): McpError {
  return { code, detail, recovery: recoveryFor(code) }
}

/**
 * POST JSON to a Next.js endpoint and parse the JSON response.
 *
 * Never throws. Failures return a STRUCTURED error with a typed `code`
 * and an explicit `recovery` instruction the agent can read verbatim.
 * The agent prompt names these codes — see agents/creative-director-agent.md.
 *
 * No timeout. No retry inside this client. CD's prompt is the loop guard.
 */
export async function postJson<T = unknown>(
  pathOrUrl: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let parsed: T | undefined
    const text = await r.text()
    try {
      parsed = text ? (JSON.parse(text) as T) : undefined
    } catch {
      parsed = text as unknown as T
    }
    if (r.ok) {
      return { ok: true, status: r.status, body: (parsed ?? null) as T }
    }
    const code = classifyHttpStatus(r.status)
    const bodyStr = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
    const mcpError = makeError(code, `HTTP ${r.status} from ${pathOrUrl}: ${bodyStr.slice(0, 240)}`)
    return {
      ok: false,
      status: r.status,
      body: (parsed ?? null) as T,
      error: formatMcpError(mcpError),
      mcpError,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const mcpError = makeError(
      'mcp_unavailable',
      `fetch threw against ${pathOrUrl}: ${reason}`,
    )
    return {
      ok: false,
      status: 0,
      body: null as unknown as T,
      error: formatMcpError(mcpError),
      mcpError,
    }
  }
}

/**
 * GET helper — used by the notification loop and tools that read state.
 * Same structured-error contract as postJson.
 */
export async function getText(pathOrUrl: string): Promise<ApiResponse<string>> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`
  try {
    const r = await fetch(url)
    const text = await r.text()
    if (r.ok) return { ok: true, status: r.status, body: text }
    const code = classifyHttpStatus(r.status)
    const mcpError = makeError(code, `HTTP ${r.status} from ${pathOrUrl}: ${text.slice(0, 200)}`)
    return {
      ok: false,
      status: r.status,
      body: text,
      error: formatMcpError(mcpError),
      mcpError,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const mcpError = makeError('mcp_unavailable', `fetch threw against ${pathOrUrl}: ${reason}`)
    return {
      ok: false,
      status: 0,
      body: '',
      error: formatMcpError(mcpError),
      mcpError,
    }
  }
}
