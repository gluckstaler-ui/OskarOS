// ==========================================
// Shared agent catalog — used by /api/admin/agents/* routes and the
// Settings · Agents pane in /public/admin.html.
//
// Keying agents by `id` (not by filename) avoids the .md-in-path bug
// that broke Next.js dynamic segment parsing. The filename mapping
// stays here so the routes can read the right file off disk.
//
// Adding an agent: add an entry below; the catalog endpoint and the
// preview / raw / state routes all derive their behavior from it.
// ==========================================

import { join } from 'path'
import type { AgentRole } from './agent-inbox-bus'

export interface AgentCatalogEntry {
  id: string
  name: string
  role: string
  file: string                        // filename under /agents/
  color: string                       // accent color for the row icon
  icon: string                        // lucide icon name
  /** If set, this agent has an inbox on the bus — live state polling
   *  is enabled for it. Sage + Orchestrator have no inbox. */
  inboxRole?: AgentRole
}

export const AGENTS_DIR = join(process.cwd(), 'agents')

export const AGENTS: AgentCatalogEntry[] = [
  {
    id: 'cd',
    name: 'Creative Director',
    role: 'Discovery · Branding · Vibes',
    file: 'creative-director-agent.md',
    color: '#5EEAD4',
    icon: 'palette',
    inboxRole: 'cd',
  },
  {
    id: 'webdev',
    name: 'WebDev',
    role: 'Wireframe + Vibe Builds',
    file: 'webdev-agent.md',
    color: '#F59E0B',
    icon: 'code',
    inboxRole: 'webdev',
  },
  {
    id: 'sentinel',
    name: 'Sentinel Ti',
    role: 'Verification + Audit',
    file: 'sentinel-ti.md',
    color: '#15B981',
    icon: 'shield',
    inboxRole: 'sentinel',
  },
  {
    id: 'sage',
    name: 'Padawan Sage',
    role: 'Cross-Session Memory',
    file: 'dreamer-agent.md',
    color: '#a78bfa',
    icon: 'book-open',
  },
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    role: 'MCP · Tool Routing',
    file: 'ORCHESTRATOR.md',
    color: '#0F766E',
    icon: 'cpu',
  },
]

export function findAgentById(id: string): AgentCatalogEntry | undefined {
  return AGENTS.find((a) => a.id === id)
}
