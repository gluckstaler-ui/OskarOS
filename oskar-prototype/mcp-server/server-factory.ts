/**
 * server-factory.ts — pure builder for the Oskar MCP Server (Phase 3, 2026-04-30).
 *
 * Single function `createOskarServer({ sessionId, agentRole })` that builds
 * a Server instance with:
 *   - Tool list filtered by agent role (cd / webdev / sentinel / jedi-code)
 *   - Dispatch handlers that thread (sessionId, agentRole) into the tool ctx
 *   - Standard `tools/list` and `tools/call` request handlers wired up
 *
 * Used by:
 *   - `mcp-server/index.ts` — the stdio entrypoint, one Server per subprocess
 *   - `app/api/mcp/server/route.ts` — the HTTP entrypoint, per-(session, role)
 *     Server pinned to globalThis
 *
 * No transport, no notifications loop, no global state. The factory is pure;
 * the caller wires up whichever transport its environment needs.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  callTool,
  isToolAllowedForRole,
  listToolsForRole,
  type AgentRole,
  type ToolCallContext,
  type ToolName,
} from './tools.js'

export interface CreateOskarServerOptions {
  sessionId: string
  agentRole: AgentRole
  /**
   * Unique per-client-fork id. Disambiguates multiple clients of the same
   * role (e.g., two Jedi Code windows). Required for the agent-inbox-bus's
   * fan-out + sticky routing. The HTTP transport route fills in a stable
   * "legacy-{session}-{role}" sentinel for clients that don't provide one.
   */
  instanceId: string
}

export function createOskarServer(opts: CreateOskarServerOptions): Server {
  const { sessionId, agentRole, instanceId } = opts
  const ctx: ToolCallContext = { sessionId, agentRole, instanceId }

  const server = new Server(
    {
      name: 'oskar-orchestrator',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  )

  // ── Tool listing: only what this role is allowed to call ──────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listToolsForRole(agentRole).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
  }))

  // ── Tool execution ────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    console.error(
      `[mcp-server] (${agentRole}/${sessionId.slice(0, 12)}) tool call: ${name}`,
    )

    if (!isToolAllowedForRole(name, agentRole)) {
      return {
        content: [
          { type: 'text', text: `Tool "${name}" not permitted for role "${agentRole}".` },
        ],
        isError: true,
      }
    }

    const result = await callTool(name as ToolName, (args || {}) as Record<string, unknown>, ctx)
    return {
      content: [{ type: 'text', text: result.text }],
      isError: result.isError,
    }
  })

  return server
}
