/**
 * Per-session MCP config — shared between bridge-process-manager.ts and
 * lib/webdev.ts (Phase 2, 2026-04-30) and lib/sentinel-ti.ts.
 *
 * Phase 3 (Ralph 2026-04-30, late): the orchestrator now lives INSIDE
 * Next.js as an HTTP route at `/api/mcp/server`. Spawn-based clients
 * (CD bridge, WebDev CLI, Sentinel Ti) connect via HTTP transport instead
 * of spawning their own stdio subprocess. One orchestrator, many clients,
 * no SSE self-loop.
 *
 * The Claude/Gemini CLI accepts `--mcp-config <file>` pointing at a JSON
 * doc that defines MCP servers to spawn or connect to. This helper writes
 * the per-session, per-role config and returns the path.
 *
 * The server name MUST match what's expected in `--allowed-tools` flags
 * (`mcp__oskar-orchestrator__*`). Do NOT rename in one place without
 * renaming all three.
 */

import { randomUUID } from 'crypto'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export const MCP_SERVER_NAME = 'oskar-orchestrator' as const

export type AgentRole = 'cd' | 'webdev' | 'sentinel' | 'jedi-code'

export interface McpConfigOptions {
  sessionId: string
  /** Project root — typically `process.cwd()` from a Next.js handler. */
  cwd: string
  /**
   * Phase 3: identifies which agent is connecting. The HTTP route filters
   * the tool list by role (see `mcp-server/tools.ts:listToolsForRole`).
   * Defaults to `'cd'` for back-compat with old call sites that pre-date
   * this parameter.
   */
  agentRole?: AgentRole
}

/**
 * Ensure the per-session MCP config exists on disk and return its path.
 * Idempotent: re-written on each call (the file is tiny and env may
 * change between calls).
 *
 * The written config points the Claude/Gemini CLI at the HTTP MCP route.
 *
 * 2026-04-30 (Ralph + diagnostic logs): identity is passed via URL query
 * params, not HTTP headers. Claude CLI's MCP transport doesn't reliably
 * propagate the `headers` field of `.mcp.json` — every request landed at
 * the route headerless and got rejected with 400. The query-param path
 * bypasses that; the URL is part of the connection and always reaches the
 * server. The route accepts both header-based and query-based identity
 * (back-compat), but query is canonical.
 *
 * Commit 1 (2026-05-01): config now includes a fresh per-spawn `instance`
 * UUID. The agent-inbox-bus uses (sessionId, agentRole, instanceId) to
 * keep multiple clients of the same role (e.g., parallel WebDev spawns,
 * back-to-back bridge respawns) from racing each other for messages.
 * Each `ensureMcpConfig` call mints a fresh id — old spawns keep the file
 * they read at startup; new spawns get a new id. Same cardinality as
 * "fresh subprocess = fresh instance."
 */
export function ensureMcpConfig({ sessionId, cwd, agentRole = 'cd' }: McpConfigOptions): string {
  const cacheDir = join(cwd, '.cache')
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const configPath = join(cacheDir, `mcp-config-${sessionId}-${agentRole}.json`)

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const instanceId = randomUUID()
  const url =
    `${baseUrl}/api/mcp/server` +
    `?session=${encodeURIComponent(sessionId)}` +
    `&agent=${encodeURIComponent(agentRole)}` +
    `&instance=${encodeURIComponent(instanceId)}`

  const config = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url,
      },
    },
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  return configPath
}

/**
 * `--allowed-tools` whitelists per agent. Each agent gets only the tools
 * relevant to its job. Tightens the safety rail beyond `bypassPermissions`.
 */
export const CD_ALLOWED_TOOLS = [
  // Orchestration (Phase 1)
  `mcp__${MCP_SERVER_NAME}__build_vibe`,
  `mcp__${MCP_SERVER_NAME}__build_all_vibes`,
  `mcp__${MCP_SERVER_NAME}__build_final`,
  `mcp__${MCP_SERVER_NAME}__hotswap`,
  `mcp__${MCP_SERVER_NAME}__images_needed`,
  `mcp__${MCP_SERVER_NAME}__refresh_assets`,
  // Submit tools (Phase 2 — Family 1)
  `mcp__${MCP_SERVER_NAME}__submit_proofread`,
  `mcp__${MCP_SERVER_NAME}__submit_image_verdict`,
  `mcp__${MCP_SERVER_NAME}__submit_upload_eval`,
  `mcp__${MCP_SERVER_NAME}__submit_image_prompt`,
  // IMAGES.md typed gateway (Bug 18)
  `mcp__${MCP_SERVER_NAME}__update_image_metadata`,
  // Phase 2.5 escrow (Ralph 2026-04-30): poll/cancel long-running jobs
  `mcp__${MCP_SERVER_NAME}__job_status`,
  `mcp__${MCP_SERVER_NAME}__cancel_job`,
  // Capability tools (Phase 2 — Tier S)
  `mcp__${MCP_SERVER_NAME}__generate_image`,
  `mcp__${MCP_SERVER_NAME}__screenshot`,
  `mcp__${MCP_SERVER_NAME}__snackbar`,
  `mcp__${MCP_SERVER_NAME}__ask_user`,
  // Capability tools (Phase 2 — Tier A)
  `mcp__${MCP_SERVER_NAME}__session_meta`,
  `mcp__${MCP_SERVER_NAME}__list_assets`,
  `mcp__${MCP_SERVER_NAME}__find_assets`,
  `mcp__${MCP_SERVER_NAME}__lint_brand_compliance`,
  `mcp__${MCP_SERVER_NAME}__apply_patch`,
  // Capability tools (Phase 2 — Tier B)
  `mcp__${MCP_SERVER_NAME}__image_ops`,
  `mcp__${MCP_SERVER_NAME}__vibe_diff`,
].join(',')

export const WEBDEV_ALLOWED_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__report_build_complete`,
  `mcp__${MCP_SERVER_NAME}__report_build_failed`,
  `mcp__${MCP_SERVER_NAME}__report_build_progress`,
  // WebDev can render its own work for self-verification + speak to user
  `mcp__${MCP_SERVER_NAME}__screenshot`,
  `mcp__${MCP_SERVER_NAME}__snackbar`,
  `mcp__${MCP_SERVER_NAME}__ask_user`,
  // Tier A: WebDev can read session state + assets + lint its own output
  `mcp__${MCP_SERVER_NAME}__session_meta`,
  `mcp__${MCP_SERVER_NAME}__list_assets`,
  `mcp__${MCP_SERVER_NAME}__lint_brand_compliance`,
].join(',')

export const SENTINEL_ALLOWED_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__submit_critique`,
  // Ti can speak to the user (e.g. "your rendering blew the contrast budget")
  `mcp__${MCP_SERVER_NAME}__snackbar`,
  `mcp__${MCP_SERVER_NAME}__ask_user`,
  // Tier A: Ti needs session state + screenshots to render verifications
  `mcp__${MCP_SERVER_NAME}__session_meta`,
  `mcp__${MCP_SERVER_NAME}__screenshot`,
].join(',')
