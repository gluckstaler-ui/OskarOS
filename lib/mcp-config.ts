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
 * (`mcp__orch__*`). Do NOT rename in one place without renaming all three.
 * Ralph 2026-05-12: shortened from `oskar-orchestrator` to `orch` to trim
 * the wire-format prefix that appears on every tool name advertised to the
 * LLM (~150 sticky tokens saved per session).
 */

import { randomUUID } from 'crypto'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export const MCP_SERVER_NAME = 'orch' as const

export type AgentRole = 'cd' | 'webdev' | 'sentinel' | 'jedi-code' | 'consular' | 'scout'

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

/**
 * Shared cross-agent bus tools (Ralph 2026-05-07 — factored out of the
 * three agent literals to kill the same triplication drift the
 * `report_build_*` and discovery-tools entries hit before).
 *
 * Doctrine — every agent we spawn must be able to:
 *   - drain its own inbox (`agent_inbox`)
 *   - replay app-level events it missed (`replay_events`)
 *   - notify peer agents (`notify_agent`)
 *   - check peer health / claim orphan messages / read thread context
 *
 * Mirror of `ORCHESTRATOR_BASIC` in `mcp-server/tools.ts:107-110` (the
 * server-side advertise filter). The two constants MUST stay in sync —
 * if a tool is added on the server side, add it here too. (Same shape as
 * the discovery-tools drift logged in INSTITUTIONAL-MEMORY.)
 *
 * Spread into every agent's allowlist below via `...ORCHESTRATOR_BASIC_TOOLS`.
 * Per-agent allowlists then add ONLY their role-specific extras.
 */
const ORCHESTRATOR_BASIC_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__agent_inbox`,
  `mcp__${MCP_SERVER_NAME}__replay_events`,
  `mcp__${MCP_SERVER_NAME}__notify_agent`,
  `mcp__${MCP_SERVER_NAME}__agent_status`,
  `mcp__${MCP_SERVER_NAME}__claim_orphan`,
  `mcp__${MCP_SERVER_NAME}__thread_history`,
]

export const CD_ALLOWED_TOOLS = [
  // Orchestration (Phase 1)
  // Ralph 2026-05-18: build_all_vibes + build_final collapsed into
  // array-based build_vibe([slugs]). Two build tools: wireframes (Phase 2)
  // and vibe (Phase 4 + Phase 5 — orchestrator derives strictness).
  `mcp__${MCP_SERVER_NAME}__build_vibe`,
  `mcp__${MCP_SERVER_NAME}__build_wireframes`,
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
  // Bug I (Ralph 2026-05-04): typed prompt block writer for IMAGES.md.
  // Registered in mcp-server/tools-cd.ts:258 but missed in the original
  // allowlist; CD's calls were rejected by the spawn-time `--allowed-tools`
  // gate even though the server happily dispatched. Added 2026-05-06.
  `mcp__${MCP_SERVER_NAME}__propose_image_prompt`,
  // WP-66 (Ralph 2026-05-06): TodoWrite persistence layer. Registered in
  // mcp-server/tools-cd.ts; allowlist entry needed so CD can actually
  // fire writes (otherwise the spawn flag rejects).
  `mcp__${MCP_SERVER_NAME}__todo_write`,
  // Ralph 2026-05-06: on-demand card preview. CD calls this when user
  // asks to "show me [a card]" so they see a visual instance instead of
  // pasted React source. Both allowlists (this one + mcp-server/tools.ts
  // CD_ALLOWED) must include it — they're independent gates.
  `mcp__${MCP_SERVER_NAME}__preview_card`,
  // Phase 2.5 escrow (Ralph 2026-04-30): poll/cancel long-running jobs
  `mcp__${MCP_SERVER_NAME}__job_status`,
  `mcp__${MCP_SERVER_NAME}__cancel_job`,
  // Capability tools (Phase 2 — Tier S)
  `mcp__${MCP_SERVER_NAME}__generate_image`,
  `mcp__${MCP_SERVER_NAME}__screenshot`,
  `mcp__${MCP_SERVER_NAME}__snackbar`,
  `mcp__${MCP_SERVER_NAME}__modal`,
  // Discovery flow (Ralph 2026-05-06) — tools were registered server-side
  // (mcp-server/tools-cd.ts:311, 334) but missing from CD's allowlist, so
  // only JD could fire the cards. CD now has direct access.
  `mcp__${MCP_SERVER_NAME}__tc_discovery`,
  `mcp__${MCP_SERVER_NAME}__tc_understanding`,
  // WP-70 + WP-71 (Ralph 2026-05-10): Image Strategy Card — Phase 3/5
  // slot plan with two layouts (webpage-vertical, keynote-multi-row).
  `mcp__${MCP_SERVER_NAME}__tc_image_strategy`,
  // WP-74 (Ralph 2026-05-10): Design Directions Card — closes Discovery Phase 1.
  // Multi-select cap-2 from 6 candidate directions.
  `mcp__${MCP_SERVER_NAME}__tc_design_directions`,
  // WP-77 (Ralph 2026-05-10): Design System Card — Phase 4→5 sign-off.
  // Interactive vibe-selector with live CSS var swap, full-width.
  `mcp__${MCP_SERVER_NAME}__tc_design_system`,
  // WP-75 (Ralph 2026-05-10): Descent Selection Card — Phase 2→3 wireframe
  // pick (cap=2) and Phase 4→5 final pick (cap=1). Same chassis as Design
  // Directions; phase discriminator drives cap + label.
  `mcp__${MCP_SERVER_NAME}__tc_descent_selection`,
  // Capability tools (Phase 2 — Tier A)
  `mcp__${MCP_SERVER_NAME}__session_meta`,
  `mcp__${MCP_SERVER_NAME}__list_assets`,
  `mcp__${MCP_SERVER_NAME}__find_assets`,
  `mcp__${MCP_SERVER_NAME}__lint_brand_compliance`,
  `mcp__${MCP_SERVER_NAME}__apply_patch`,
  // Capability tools (Phase 2 — Tier B)
  `mcp__${MCP_SERVER_NAME}__image_ops`,
  `mcp__${MCP_SERVER_NAME}__vibe_diff`,
  // Bus tools — shared cross-agent comms (factored to ORCHESTRATOR_BASIC_TOOLS
  // above; mirror of mcp-server/tools.ts ORCHESTRATOR_BASIC). One source of
  // truth for the six bus tools every agent inherits.
  ...ORCHESTRATOR_BASIC_TOOLS,
  // Cross-agent tools Ralph verified CD can fire (2026-05-06 audit):
  // CD occasionally needs to report build state on WebDev's behalf or
  // file a critique. Server-side these are unrestricted — match the allowlist.
  `mcp__${MCP_SERVER_NAME}__build_done`,
  `mcp__${MCP_SERVER_NAME}__build_fail`,
  `mcp__${MCP_SERVER_NAME}__build_progress`,
  `mcp__${MCP_SERVER_NAME}__submit_critique`,
  // WP-SCOUT-3 (Ralph 2026-06-03): typed Scout verdict tool. Registered in
  // mcp-server/tools-cd.ts:156 + dispatched at :1032, but originally missed
  // in BOTH allowlists (this spawn-time list + mcp-server/tools.ts CD_ALLOWED).
  // Result: the spawn flag rejected the call → Sonnet workers always returned
  // "no verdict from agent" (the bridge collector saw zero tool calls). Same
  // bug class as `propose_image_prompt` (Bug I, 2026-05-06) — the inverse of
  // the comment two paragraphs below this array.
  `mcp__${MCP_SERVER_NAME}__submit_scout_verdict`,
  // ── Claude Code built-in tools (Ralph 2026-05-06) ─────────────────────
  // Not MCP tools — Claude Code's own tool surface. Without these in the
  // allowlist, CD can't `Read`/`Write`/`Edit` files directly, can't run
  // `Bash`, can't `Grep`/`Glob` the session folder. The pre-existing
  // doctrine ("CD orchestrates via typed MCP gateways, doesn't bulldoze
  // files") is preserved at the agent-prompt layer, not the spawn-flag
  // layer — adding the tools here lets CD reach for them WHEN her prompt
  // tells her to (e.g. "read CREATIVE-BRIEF.md before you propose a
  // change"). Names are bare (no `mcp__` prefix) — that's how Claude Code
  // identifies its own built-ins.
  //
  // `TodoWrite` (Claude Code built-in) is INTENTIONALLY OMITTED — the MCP
  // `todo_write` above is the single write path, since it persists to
  // SESSION.md (WP-66). One source of truth; no duplicate stream-parser
  // path to keep in sync. `NotebookEdit` is omitted because the project
  // has no Jupyter notebooks.
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  // Harness-extension tools (Ralph 2026-05-06) — version-dependent on
  // the `claude` binary, but the allowlist is an additive filter so
  // unsupported entries are simply ignored at runtime (no spawn error).
  // Coexists with MCP equivalents where applicable: `AskUserQuestion`
  // alongside `mcp__${MCP_SERVER_NAME}__modal`. Two surfaces by
  // intent — the built-in is the cleaner UX path; the MCP one is
  // server-validated and event-bus-backed.
  'AskUserQuestion',
  'Skill',
  'ToolSearch',
  'ScheduleWakeup',
  'CronCreate',
  'CronList',
  'CronDelete',
  'RemoteTrigger',
  'SendMessage',
].join(',')

export const WEBDEV_ALLOWED_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__build_done`,
  `mcp__${MCP_SERVER_NAME}__build_fail`,
  `mcp__${MCP_SERVER_NAME}__build_progress`,
  // WebDev can render its own work for self-verification + speak to user
  `mcp__${MCP_SERVER_NAME}__screenshot`,
  `mcp__${MCP_SERVER_NAME}__snackbar`,
  `mcp__${MCP_SERVER_NAME}__modal`,
  // Tier A: WebDev can read session state + assets + lint its own output
  `mcp__${MCP_SERVER_NAME}__session_meta`,
  `mcp__${MCP_SERVER_NAME}__list_assets`,
  `mcp__${MCP_SERVER_NAME}__lint_brand_compliance`,
  // Ralph 2026-05-18 — WF-mode self-critique. Mirrors mcp-server/tools.ts
  // WEBDEV_ALLOWED. Add to BOTH files in the same commit; the advertise
  // filter and the spawn-flag allowlist are independent gates.
  `mcp__${MCP_SERVER_NAME}__submit_critique`,
  // Bus tools — shared cross-agent comms (see ORCHESTRATOR_BASIC_TOOLS above).
  // Doctrine — WebDev notifies CD at start/verify/complete and drains its own
  // inbox at turn start. Without these, WebDev was a fire-and-forget subprocess.
  ...ORCHESTRATOR_BASIC_TOOLS,
  // Claude Code built-in tools (Ralph 2026-05-07). WebDev's agent prompt
  // (agents/webdev-agent.md "Your Tools") doctrine names Bash/Glob/Grep
  // as part of WebDev's working surface — verifying file existence, finding
  // files by pattern, searching VIBE-N.md for sections, etc. Without these
  // explicitly in the spawn-flag allowlist, the doctrine and the spawn flag
  // disagreed — same shape as the CD allowlist drift logged earlier.
  // Names are bare (no `mcp__` prefix) — Claude Code's own tool grammar.
  'Bash',
  'Glob',
  'Grep',
].join(',')

export const SENTINEL_ALLOWED_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__submit_critique`,
  // Ti can speak to the user (e.g. "your rendering blew the contrast budget")
  `mcp__${MCP_SERVER_NAME}__snackbar`,
  `mcp__${MCP_SERVER_NAME}__modal`,
  // Tier A: Ti needs session state + screenshots to render verifications
  `mcp__${MCP_SERVER_NAME}__session_meta`,
  `mcp__${MCP_SERVER_NAME}__screenshot`,
  // Bus tools — shared cross-agent comms (see ORCHESTRATOR_BASIC_TOOLS above).
  // Ti pings CD when a critique lands and drains its inbox between audits.
  ...ORCHESTRATOR_BASIC_TOOLS,
].join(',')

// WP-110 (Ralph 2026-05-29). SPAWN-TIME `--allowed-tools` gate for the Consular.
// The `crm_query` SQL MCP tool was RETIRED 2026-05-29 — DB access is via the
// HTTP route POST /api/admin/crm/consular/sql (event-logged), NOT an MCP tool;
// a bridged agent already has shell + HTTP, so an advertised full-SQL MCP tool
// was a redundant, wider attack surface. Commented out (not deleted); mirrors
// the retire in mcp-server/tools.ts CONSULAR_ALLOWED. What remains is the
// UI / research bus the Consular genuinely needs.
// Ralph 2026-05-29: the Consular gets EXACTLY the same tools as CD — aliased,
// not a hand-picked subset, so the two can never drift. Whatever CD can do, the
// Consular can do, including the built-in `Read` it needs to open images the
// rep pastes into the chat. Persona/behavior stays distinct via the agent file
// (agents/CONSULAR-agent.md) — tools are capability, not character.
//
// (History: the `crm_query` SQL MCP was RETIRED 2026-05-29 — the Consular
// reaches the CRM DB via the HTTP route POST /api/admin/crm/consular/sql, not an
// MCP tool. The earlier minimal allowlist — submit_image_prompt, snackbar,
// modal, WebSearch/Fetch, bus — is subsumed by CD's superset.)
export const CONSULAR_ALLOWED_TOOLS = CD_ALLOWED_TOOLS

// WP-SCOUT-3 (Ralph 2026-06-03). The Scout is aliased to CD's full surface
// — the persona stays distinct via agents/jedi-scout.md and the typed
// submit_scout_verdict (added in mcp-server/tools-cd.ts) is what the role
// actually calls. CD's surface gets Read/Glob/Grep/Bash for free, which the
// Scout needs to look at the captured screenshots from lib/screenshot.ts.
export const SCOUT_ALLOWED_TOOLS = CD_ALLOWED_TOOLS
