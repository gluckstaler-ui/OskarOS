/**
 * MCP-tool bridge for API mode (Ralph 2026-05-03).
 *
 * Imports the unified MCP tool registry + dispatcher from `mcp-server/dist`
 * (already used by `app/api/mcp/server/route.ts` over HTTP transport) and
 * exposes them in **Anthropic-tools shape** (`input_schema` snake_case)
 * for use in the API-mode `/api/chat` and `lib/claude-api-loop.ts` TOOLS
 * arrays.
 *
 * The MCP defs use `inputSchema` (camelCase, MCP convention); Anthropic
 * uses `input_schema`. Otherwise the JSON Schema is identical.
 *
 * Dispatching: when a `tool_use` block comes back from Anthropic with a
 * name in this list, route it through `callTool(name, args, ctx)` from
 * `mcp-server/dist/tools.js`. The same in-process call the HTTP transport
 * does — no network hop, no MCP protocol overhead.
 */
import {
  TOOL_DEFINITIONS as MCP_TOOL_DEFINITIONS_RAW,
  callTool as mcpCallTool,
} from '@/mcp-server/dist/tools.js'

// 2026-05-03 (Ralph): mcp-server's tsconfig has declaration:false (build
// produces .js + .map only, no .d.ts). Rather than turn that on, inline
// the types here — they're stable and small.
export type McpToolName = string
export interface ToolCallContext {
  sessionId: string
  agentRole: 'cd' | 'webdev' | 'sentinel' | 'jedi-code'
  instanceId: string
}

/**
 * Anthropic-shaped MCP tool definitions. Use in /api/chat TOOLS array
 * alongside the existing inline tools.
 */
export const MCP_TOOL_DEFINITIONS_FOR_ANTHROPIC = MCP_TOOL_DEFINITIONS_RAW.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: (t as unknown as { inputSchema: unknown }).inputSchema,
}))

const MCP_NAMES = new Set<string>(MCP_TOOL_DEFINITIONS_RAW.map((t) => t.name))

/**
 * Returns true if `name` is an MCP tool we handle. Use to route tool_use
 * blocks: MCP tools → `dispatchMcpTool`, others → existing inline handlers.
 */
export function isMcpTool(name: string): boolean {
  return MCP_NAMES.has(name)
}

/**
 * Dispatch an MCP tool call in-process. Mirrors the HTTP route's behavior
 * but without the network hop. Returns Anthropic-friendly { content, isError }.
 */
export async function dispatchMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<{ content: string; isError: boolean }> {
  if (!MCP_NAMES.has(name)) {
    return { content: `[api-mcp-bridge] unknown MCP tool: ${name}`, isError: true }
  }
  const result = await mcpCallTool(name as McpToolName, args, ctx)
  return { content: result.text, isError: result.isError }
}

/**
 * Build a per-request ToolCallContext for API-mode dispatch. The agent
 * role defaults to 'cd' (the main chat agent); change it for routes that
 * spawn other agents.
 */
export function makeApiToolContext(
  sessionId: string,
  agentRole: 'cd' | 'webdev' | 'sentinel' | 'jedi-code' = 'cd',
): ToolCallContext {
  return {
    sessionId,
    agentRole,
    instanceId: `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
}
