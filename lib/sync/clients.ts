// ============================================================================
// lib/sync/clients.ts — hub/spoke presence for the SYNC panel (WP-28).
//
// The hub is otherwise passive: spokes (local Macs) fetch its /api/admin/sync/
// state to compute their own diff. To show "which clients are connected" on the
// hub, each spoke now sends its node id (X-Oskar-Node) on that fetch, and the
// hub records it here. The hub panel reads `readClients()`; the spoke panel
// reads `readHubContact()` to show when it last reached the hub.
//
// Storage is plain JSON under db/sync/ — files are the API, no new store.
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const CLIENTS_PATH = join(process.cwd(), 'db', 'sync', 'clients.json')
const HUB_PATH = join(process.cwd(), 'db', 'sync', 'last-hub.json')

// A spoke counts as "connected" if it checked in within this window.
export const CONNECTED_WINDOW_MS = 10 * 60 * 1000 // 10 min

interface ClientRecord { nodeId: string; ip: string; version?: string; firstSeen: string; lastSeen: string; count: number }
interface HubContact { host: string; reachedAt: string }

function readJson<T>(p: string, fallback: T): T {
  try { return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback } catch { return fallback }
}
function writeJson(p: string, data: unknown): void {
  try {
    mkdirSync(dirname(p), { recursive: true })
    const tmp = `${p}.${Math.random().toString(36).slice(2)}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, p)
  } catch { /* best effort — presence is non-critical */ }
}

/** Hub side: a spoke just fetched our state — record/refresh it (with its version). */
export function recordClient(nodeId: string, ip: string, version?: string): void {
  if (!nodeId || nodeId === 'unknown') return
  const all = readJson<Record<string, ClientRecord>>(CLIENTS_PATH, {})
  const now = new Date().toISOString()
  const prev = all[nodeId]
  all[nodeId] = {
    nodeId,
    ip: ip || prev?.ip || '',
    version: version || prev?.version || '',
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    count: (prev?.count ?? 0) + 1,
  }
  writeJson(CLIENTS_PATH, all)
}

/** Hub side: spokes that have ever connected — most-recent first, with a live flag + their version. */
export function readClients(): Array<{ nodeId: string; ip: string; version: string; lastSeen: string; connected: boolean }> {
  const all = readJson<Record<string, ClientRecord>>(CLIENTS_PATH, {})
  const now = Date.now()
  return Object.values(all)
    .map((c) => ({
      nodeId: c.nodeId,
      ip: c.ip,
      version: c.version || '',
      lastSeen: c.lastSeen,
      connected: now - new Date(c.lastSeen).getTime() < CONNECTED_WINDOW_MS,
    }))
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
}

/** Spoke side: we just reached the hub — remember when + which host. */
export function recordHubContact(host: string): void {
  writeJson(HUB_PATH, { host, reachedAt: new Date().toISOString() } satisfies HubContact)
}
export function readHubContact(): HubContact | null {
  return readJson<HubContact | null>(HUB_PATH, null)
}
