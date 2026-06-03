/**
 * Tool registry barrel — Phase 2 split (2026-04-30) + Phase 3 HTTP transport.
 *
 * Phase 3 (Ralph 2026-04-30, late): the orchestrator now ships in TWO transports:
 *   1. Stdio — for backward-compat with subprocess spawns
 *   2. HTTP  — for multi-client access (CD, Jedi Code, WebDev, Sentinel Ti
 *              all connect to the same orchestrator running in Next.js)
 *
 * To support multiple concurrent (sessionId, agentRole) pairs in the HTTP
 * variant, dispatchers no longer read `process.env.OSKAR_SESSION_ID` —
 * they take a `ctx: ToolCallContext` parameter that carries identity.
 * Stdio callers pass a context built from env vars; HTTP callers build
 * a context per request from headers.
 */

import { CD_TOOL_DEFINITIONS, callCDTool, type CDToolName } from './tools-cd.js'
import { WEBDEV_TOOL_DEFINITIONS, callWebDevTool, type WebDevToolName } from './tools-webdev.js'
import { SENTINEL_TOOL_DEFINITIONS, callSentinelTool, type SentinelToolName } from './tools-sentinel.js'
import { CAPABILITY_TOOL_DEFINITIONS, callCapabilityTool, type CapabilityToolName } from './tools-capabilities.js'
import { ORCHESTRATOR_TOOL_DEFINITIONS, callOrchestratorTool, type OrchestratorToolName } from './tools-orchestrator.js'
// [RETIRED 2026-05-29] crm_query SQL MCP disabled — see the note at CONSULAR_ALLOWED below.
// import { CONSULAR_TOOL_DEFINITIONS, callConsularTool, type ConsularToolName } from './tools-consular.js'

// 2026-04-30: only the stdio entrypoint enforces OSKAR_SESSION_ID. The HTTP
// route uses headers; tests use mocks. This guard remains for the stdio
// path so misconfigured spawns fail loud at startup.
const SESSION_ID = process.env.OSKAR_SESSION_ID
if (process.env.OSKAR_REQUIRE_SESSION === '1' && !SESSION_ID) {
  console.error('[mcp-server] OSKAR_SESSION_ID env var is required')
  process.exit(1)
}

export type AgentRole = 'cd' | 'webdev' | 'sentinel' | 'jedi-code' | 'consular' | 'scout'

/**
 * Identity context threaded through every tool call. Replaces the module-
 * level `process.env.OSKAR_SESSION_ID` reads in the dispatchers — those
 * couldn't support multiple sessions in one process (HTTP transport).
 *
 * Commit 1 (2026-05-01): added `instanceId` to disambiguate multiple
 * clients of the same role (e.g., two Jedi Code windows). The agent-
 * inbox-bus uses (sessionId, agentRole, instanceId) as the queue key
 * so role-only fan-out reaches every live instance instead of racing
 * the first-poller to drain the single shared queue.
 */
export interface ToolCallContext {
  sessionId: string
  agentRole: AgentRole
  instanceId: string
}

export const TOOL_DEFINITIONS = [
  ...CD_TOOL_DEFINITIONS,
  ...WEBDEV_TOOL_DEFINITIONS,
  ...SENTINEL_TOOL_DEFINITIONS,
  ...CAPABILITY_TOOL_DEFINITIONS,
  ...ORCHESTRATOR_TOOL_DEFINITIONS,
  // ...CONSULAR_TOOL_DEFINITIONS,   // [RETIRED 2026-05-29] crm_query not advertised in tools/list
] as const

export type ToolName =
  | CDToolName
  | WebDevToolName
  | SentinelToolName
  | CapabilityToolName
  | OrchestratorToolName
  // | ConsularToolName   // [RETIRED 2026-05-29] crm_query SQL MCP

const CD_NAMES = new Set<string>(CD_TOOL_DEFINITIONS.map((t) => t.name))
const WEBDEV_NAMES = new Set<string>(WEBDEV_TOOL_DEFINITIONS.map((t) => t.name))
const SENTINEL_NAMES = new Set<string>(SENTINEL_TOOL_DEFINITIONS.map((t) => t.name))
const CAPABILITY_NAMES = new Set<string>(CAPABILITY_TOOL_DEFINITIONS.map((t) => t.name))
const ORCHESTRATOR_NAMES = new Set<string>(ORCHESTRATOR_TOOL_DEFINITIONS.map((t) => t.name))
// [RETIRED 2026-05-29] crm_query SQL MCP — names set unused while disabled.
// const CONSULAR_NAMES = new Set<string>(CONSULAR_TOOL_DEFINITIONS.map((t) => t.name))

/**
 * Dispatch a tool call to its audience-specific handler. The handler
 * returns `{text, isError}`; the MCP server wraps that into a CallToolResult.
 *
 * `ctx` is the identity envelope — sessionId and agentRole. Dispatchers
 * use it to know which session's state to mutate.
 */
export async function callTool(
  name: ToolName,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<{ text: string; isError: boolean }> {
  if (CD_NAMES.has(name)) return callCDTool(name as CDToolName, args, ctx)
  if (WEBDEV_NAMES.has(name)) return callWebDevTool(name as WebDevToolName, args, ctx)
  if (SENTINEL_NAMES.has(name)) return callSentinelTool(name as SentinelToolName, args, ctx)
  if (CAPABILITY_NAMES.has(name)) return callCapabilityTool(name as CapabilityToolName, args, ctx)
  if (ORCHESTRATOR_NAMES.has(name)) return callOrchestratorTool(name as OrchestratorToolName, args, ctx)
  // [RETIRED 2026-05-29] crm_query SQL MCP — dispatch disabled (tool not advertised).
  // if (CONSULAR_NAMES.has(name)) return callConsularTool(name as ConsularToolName, args, ctx)
  return { text: `Unknown tool: ${name as string}`, isError: true }
}

// ── Per-role tool scoping ────────────────────────────────────────────────────
//
// Mirrors the per-agent allowed-tools whitelists in lib/mcp-config.ts but
// applies at the SERVER level. The factory uses these to filter
// `tools/list` responses so an agent literally can't see tools it shouldn't
// call. Cleaner than CLI-flag filtering — the schema says what's available.

const ALL_TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name)

// Cross-agent messaging — every role gets these. Permission scoping for who
// can notify whom lives inside `lib/agent-inbox-bus.ts`.
// Commit 3 (2026-05-01): `claim_orphan` added — any role can claim its own
// role's orphans (the bus enforces role-match at claim time).
// Punch-list #2 (CD, 2026-05-01): `thread_history` added — read-only thread
// reconstruction post-drain. No permission scoping (threads are public
// conversation context within a session).
const ORCHESTRATOR_BASIC = [
  'notify_agent', 'agent_inbox', 'agent_status', 'replay_events',
  'claim_orphan', 'thread_history',
]

const CD_ALLOWED = new Set<string>([
  // Phase 1 orchestration
  // Ralph 2026-05-18: build_all_vibes + build_final collapsed into
  // array-based build_vibe([slug, ...]). Two build tools now: wireframes
  // (Phase 2) and vibe (Phase 4 + Phase 5).
  'build_vibe', 'build_wireframes', 'hotswap', 'images_needed', 'refresh_assets',
  // Phase 2 Family 1 (submit/report)
  'submit_proofread', 'submit_image_verdict', 'submit_upload_eval', 'submit_image_prompt',
  // Bug 18 typed gateway
  'update_image_metadata',
  // Phase 2.5 escrow
  'job_status', 'cancel_job',
  // Phase 2 Tier S capabilities
  'generate_image', 'screenshot', 'snackbar', 'modal',
  // Phase 2 Tier A
  'session_meta', 'list_assets', 'find_assets', 'lint_brand_compliance', 'apply_patch',
  // Phase 2 Tier B
  'image_ops', 'vibe_diff',
  // Phase 3 cross-agent
  ...ORCHESTRATOR_BASIC,
  // ── Sync gap fix (Ralph + Jedi Code 2026-05-06) ────────────────────────
  // These were in `lib/mcp-config.ts` `CD_ALLOWED_TOOLS` (spawn-time
  // --allowed-tools flag) but NOT in this server-side advertise filter.
  // Result: CD's spawn ALLOWED the calls but the MCP server never
  // advertised the tools in tools/list, so they didn't reach CD's
  // deferred-tool list. Two-state-machine drift — same shape as the
  // build_vibe wrapper drift logged in INSTITUTIONAL-MEMORY.
  // The two allowlists MUST stay in sync. Future entries: add to BOTH
  // files in the same commit, or factor them into a single source.
  'tc_discovery', 'tc_understanding',
  'tc_image_strategy',
  'tc_design_directions',
  'tc_design_system',
  // 2026-05-10 Ralph + CD: was in CD_ALLOWED_TOOLS at lib/mcp-config.ts:179
  // but missing here. ToolSearch couldn't find it → CD couldn't fire it
  // even though spawn allowed the call. Same drift class as the 2026-05-06
  // entry. Sync with lib/mcp-config.ts whenever you add/remove a tool here.
  'tc_descent_selection',
  'propose_image_prompt',
  'todo_write',
  'preview_card',
  'build_done', 'build_fail', 'build_progress',
  'submit_critique',
  // WP-SCOUT-3 (Ralph 2026-06-03): typed Scout verdict tool. Same drift
  // class the comment 30 lines up warned about — registered in
  // mcp-server/tools-cd.ts:156 + dispatched at :1032 but missed in BOTH
  // allowlists, so the spawn-time `--allowed-tools` gate rejected the call
  // and the bridge collector saw zero tool_use blocks → "no verdict from
  // agent" on EVERY worker run. Pair with the entry in lib/mcp-config.ts
  // CD_ALLOWED_TOOLS (same commit).
  'submit_scout_verdict',
])

const WEBDEV_ALLOWED = new Set<string>([
  'build_done', 'build_fail', 'build_progress',
  'screenshot', 'snackbar', 'modal',
  'session_meta', 'list_assets', 'lint_brand_compliance',
  'job_status',
  // Ralph 2026-05-18 — WebDev self-critiques in WF mode (Phase 2 wireframes)
  // per agents/webdev-agent.md § "Self-Critique (WF mode only)" lines 514-565.
  // Doctrine said fire it; advertise filter omitted it; the call silently
  // dropped. Same two-state-machine drift class as the historic CD allowlist
  // misses logged earlier in this file. Sync with lib/mcp-config.ts:244.
  'submit_critique',
  ...ORCHESTRATOR_BASIC,
])

const SENTINEL_ALLOWED = new Set<string>([
  'submit_critique',
  'snackbar', 'modal',
  'session_meta', 'screenshot',
  'job_status',
  ...ORCHESTRATOR_BASIC,
])

// Jedi Code (the architect) gets full access — same surface as CD plus the
// other agents' submit/report tools, since Jedi may need to verify the full
// contract end-to-end while debugging seams.
const JEDI_CODE_ALLOWED = new Set<string>(ALL_TOOL_NAMES)

// Ralph 2026-05-29: the Consular gets EXACTLY the same tools as CD — aliased to
// CD_ALLOWED so the server-side advertise/dispatch gate can't drift from CD's.
// (History: the `crm_query` SQL MCP was RETIRED 2026-05-29 — DB access is via
// the HTTP route POST /api/admin/crm/consular/sql, not an MCP tool. The earlier
// minimal set — submit_image_prompt, snackbar, modal, bus — is subsumed by CD's
// superset.) Persona stays distinct via agents/CONSULAR-agent.md.
const CONSULAR_ALLOWED = CD_ALLOWED

// WP-SCOUT-3 (Ralph 2026-06-03). Scout = CD's surface (same aliasing pattern
// as the Consular). The persona is the tasting agent (agents/jedi-scout.md);
// the discriminator is the typed submit_scout_verdict (defined alongside
// submit_image_verdict in tools-cd.ts). Both gates (this one and
// lib/mcp-config.ts) are INDEPENDENT — keep them in lockstep.
const SCOUT_ALLOWED = CD_ALLOWED

const ROLE_ALLOWED: Record<AgentRole, Set<string>> = {
  cd: CD_ALLOWED,
  webdev: WEBDEV_ALLOWED,
  sentinel: SENTINEL_ALLOWED,
  'jedi-code': JEDI_CODE_ALLOWED,
  consular: CONSULAR_ALLOWED,
  scout: SCOUT_ALLOWED,
}

export function isToolAllowedForRole(toolName: string, role: AgentRole): boolean {
  return ROLE_ALLOWED[role]?.has(toolName) ?? false
}

export function listToolsForRole(role: AgentRole): typeof TOOL_DEFINITIONS[number][] {
  const allowed = ROLE_ALLOWED[role]
  if (!allowed) return []
  return TOOL_DEFINITIONS.filter((t) => allowed.has(t.name))
}
