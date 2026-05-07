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
import { CD_TOOL_DEFINITIONS, callCDTool } from './tools-cd.js';
import { WEBDEV_TOOL_DEFINITIONS, callWebDevTool } from './tools-webdev.js';
import { SENTINEL_TOOL_DEFINITIONS, callSentinelTool } from './tools-sentinel.js';
import { CAPABILITY_TOOL_DEFINITIONS, callCapabilityTool } from './tools-capabilities.js';
import { ORCHESTRATOR_TOOL_DEFINITIONS, callOrchestratorTool } from './tools-orchestrator.js';
// 2026-04-30: only the stdio entrypoint enforces OSKAR_SESSION_ID. The HTTP
// route uses headers; tests use mocks. This guard remains for the stdio
// path so misconfigured spawns fail loud at startup.
const SESSION_ID = process.env.OSKAR_SESSION_ID;
if (process.env.OSKAR_REQUIRE_SESSION === '1' && !SESSION_ID) {
    console.error('[mcp-server] OSKAR_SESSION_ID env var is required');
    process.exit(1);
}
export const TOOL_DEFINITIONS = [
    ...CD_TOOL_DEFINITIONS,
    ...WEBDEV_TOOL_DEFINITIONS,
    ...SENTINEL_TOOL_DEFINITIONS,
    ...CAPABILITY_TOOL_DEFINITIONS,
    ...ORCHESTRATOR_TOOL_DEFINITIONS,
];
const CD_NAMES = new Set(CD_TOOL_DEFINITIONS.map((t) => t.name));
const WEBDEV_NAMES = new Set(WEBDEV_TOOL_DEFINITIONS.map((t) => t.name));
const SENTINEL_NAMES = new Set(SENTINEL_TOOL_DEFINITIONS.map((t) => t.name));
const CAPABILITY_NAMES = new Set(CAPABILITY_TOOL_DEFINITIONS.map((t) => t.name));
const ORCHESTRATOR_NAMES = new Set(ORCHESTRATOR_TOOL_DEFINITIONS.map((t) => t.name));
/**
 * Dispatch a tool call to its audience-specific handler. The handler
 * returns `{text, isError}`; the MCP server wraps that into a CallToolResult.
 *
 * `ctx` is the identity envelope — sessionId and agentRole. Dispatchers
 * use it to know which session's state to mutate.
 */
export async function callTool(name, args, ctx) {
    if (CD_NAMES.has(name))
        return callCDTool(name, args, ctx);
    if (WEBDEV_NAMES.has(name))
        return callWebDevTool(name, args, ctx);
    if (SENTINEL_NAMES.has(name))
        return callSentinelTool(name, args, ctx);
    if (CAPABILITY_NAMES.has(name))
        return callCapabilityTool(name, args, ctx);
    if (ORCHESTRATOR_NAMES.has(name))
        return callOrchestratorTool(name, args, ctx);
    return { text: `Unknown tool: ${name}`, isError: true };
}
// ── Per-role tool scoping ────────────────────────────────────────────────────
//
// Mirrors the per-agent allowed-tools whitelists in lib/mcp-config.ts but
// applies at the SERVER level. The factory uses these to filter
// `tools/list` responses so an agent literally can't see tools it shouldn't
// call. Cleaner than CLI-flag filtering — the schema says what's available.
const ALL_TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name);
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
];
const CD_ALLOWED = new Set([
    // Phase 1 orchestration
    'build_vibe', 'build_all_vibes', 'build_final', 'hotswap', 'images_needed', 'refresh_assets',
    // Phase 2 Family 1 (submit/report)
    'submit_proofread', 'submit_image_verdict', 'submit_upload_eval', 'submit_image_prompt',
    // Bug 18 typed gateway
    'update_image_metadata',
    // Phase 2.5 escrow
    'job_status', 'cancel_job',
    // Phase 2 Tier S capabilities
    'generate_image', 'screenshot', 'snackbar', 'ask_user',
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
    'ask_discovery_questions', 'confirm_understanding',
    'propose_image_prompt',
    'todo_write',
    'preview_card',
    'report_build_complete', 'report_build_failed', 'report_build_progress',
    'submit_critique',
]);
const WEBDEV_ALLOWED = new Set([
    'report_build_complete', 'report_build_failed', 'report_build_progress',
    'screenshot', 'snackbar', 'ask_user',
    'session_meta', 'list_assets', 'lint_brand_compliance',
    'job_status',
    ...ORCHESTRATOR_BASIC,
]);
const SENTINEL_ALLOWED = new Set([
    'submit_critique',
    'snackbar', 'ask_user',
    'session_meta', 'screenshot',
    'job_status',
    ...ORCHESTRATOR_BASIC,
]);
// Jedi Code (the architect) gets full access — same surface as CD plus the
// other agents' submit/report tools, since Jedi may need to verify the full
// contract end-to-end while debugging seams.
const JEDI_CODE_ALLOWED = new Set(ALL_TOOL_NAMES);
const ROLE_ALLOWED = {
    cd: CD_ALLOWED,
    webdev: WEBDEV_ALLOWED,
    sentinel: SENTINEL_ALLOWED,
    'jedi-code': JEDI_CODE_ALLOWED,
};
export function isToolAllowedForRole(toolName, role) {
    return ROLE_ALLOWED[role]?.has(toolName) ?? false;
}
export function listToolsForRole(role) {
    const allowed = ROLE_ALLOWED[role];
    if (!allowed)
        return [];
    return TOOL_DEFINITIONS.filter((t) => allowed.has(t.name));
}
//# sourceMappingURL=tools.js.map