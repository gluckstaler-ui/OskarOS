#!/usr/bin/env node
/**
 * Oskar MCP server — stdio entrypoint.
 *
 * Phase 3 (Ralph 2026-04-30, late): the orchestrator now ships in two
 * transports. This file is the legacy stdio path — kept for back-compat
 * with subprocess-style spawns (and as a fallback if the HTTP route in
 * `app/api/mcp/server/route.ts` ever needs to be bypassed).
 *
 * For new spawns, prefer the HTTP transport. Configure clients with
 * `.mcp.json` pointing at `http://localhost:3000/api/mcp/server` and pass
 * agent identity via `X-Oskar-Session` + `X-Oskar-Agent` headers.
 *
 * The shared logic lives in `server-factory.ts`; this entrypoint just wires
 * the factory output to a stdio transport + the legacy SSE notification
 * subscriber.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { randomUUID } from 'node:crypto'

// Mark the env-var requirement BEFORE importing tools.ts (its module-level
// guard fails fast if OSKAR_SESSION_ID is missing under this flag).
process.env.OSKAR_REQUIRE_SESSION = '1'

import { createOskarServer } from './server-factory.js'
import { startNotificationLoop } from './notifications.js'
import type { AgentRole } from './tools.js'

const SESSION_ID = process.env.OSKAR_SESSION_ID || ''
// Agent identity for stdio: the spawn passes OSKAR_AGENT_ROLE in its env.
// Defaults to 'cd' for back-compat with existing bridge spawns that pre-date
// the role plumbing (they were all CD before WebDev/Sentinel got their own
// MCP configs).
const AGENT_ROLE = (process.env.OSKAR_AGENT_ROLE as AgentRole | undefined) || 'cd'

// Commit 1 (2026-05-01): per-fork instance id for the bus's fan-out routing.
// Stable for the lifetime of THIS subprocess. Matches the stdio-proxy minting
// pattern.
const INSTANCE_ID = process.env.OSKAR_INSTANCE_ID || randomUUID()

console.error(
  `[mcp-server] (stdio) starting role=${AGENT_ROLE} session=${SESSION_ID} instance=${INSTANCE_ID}`,
)

async function main() {
  const server = createOskarServer({
    sessionId: SESSION_ID,
    agentRole: AGENT_ROLE,
    instanceId: INSTANCE_ID,
  })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[mcp-server] connected via stdio, ready')
  // Stdio variant still uses the SSE-self-loop notification path because
  // it's in a different process from the Next.js event-bus. The HTTP route
  // skips this loop entirely (it subscribes in-process — see route.ts).
  startNotificationLoop(server)
}

main().catch((err) => {
  console.error('[mcp-server] fatal:', err)
  process.exit(1)
})
