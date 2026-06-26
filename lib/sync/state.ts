// ============================================================================
// lib/sync/state.ts — read-only "what is my state for this sync target".
//
// Drives the SYNC-panel indicators (WP-28). THREE targets, each compared
// machine ↔ hub to show in-sync / a 1-sentence diff:
//   A) crm      — the event-log (DB) summary + Scout-screenshot count
//   B) session  — one session folder's file manifest (public/<id>/)
//   C) codebase — a version stamp (git on the spoke, VERSION file on the hub)
//
// NOTHING here mutates anything. The actual sync (apply/push/deploy) lives in
// the per-target sync routes. This module is the eyes, not the hands.
// ============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { getEventsDir, getNodeId } from '../event-log'

const PROJECT_ROOT = process.cwd()
const PUBLIC_DIR = join(PROJECT_ROOT, 'public')
const VERSION_FILE = join(PROJECT_ROOT, '.next', 'DEPLOY_VERSION') // written by scripts/deploy-server.sh
// Archives are NEVER synced (Ralph: individual files only) — keep this in lock-step
// with the rsync --exclude set in scripts/sync-session.sh + sync-crm.sh, else the
// indicator would count an excluded Archive.zip as perpetual drift.
const ARCHIVE_RE = /(\.(zip|tar|tgz|7z|rar)|\.tar\.(gz|bz2|xz))$/i

export type SyncTarget = 'crm' | 'session' | 'codebase'

// ─── A) CRM: event-log summary (per-node high-water lamport + entity counts) ──
export interface CrmState {
  kind: 'crm'
  perNode: Record<string, number> // nodeId → max lamport seen for that node
  total: number                   // total events
  screenshots: number             // Scout capture count (synced WITH crm; never WhatsApp/email)
}

export function crmState(): CrmState {
  const dir = getEventsDir()
  const perNode: Record<string, number> = {}
  let total = 0
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.startsWith('events-') || !f.endsWith('.jsonl')) continue
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue
        let e: { node?: string; lamport?: number }
        try { e = JSON.parse(line) } catch { continue } // torn-tail tolerance
        total++
        const n = e.node ?? 'unknown'
        if (typeof e.lamport === 'number' && e.lamport > (perNode[n] ?? -1)) perNode[n] = e.lamport
      }
    }
  }
  return { kind: 'crm', perNode, total, screenshots: countScoutScreenshots() }
}

function countScoutScreenshots(): number {
  // Scout team-page captures live under public/__scout__ (created on demand by
  // the scout taste route). Count *.jpg/*.png/*.webp, best-effort. NOTE: this
  // deliberately does NOT walk public/_whatsapp — WhatsApp/email media is never
  // part of a CRM sync.
  const root = join(PUBLIC_DIR, '__scout__')
  let n = 0
  const walk = (d: string, depth: number) => {
    if (depth > 4 || !existsSync(d)) return
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name)
      if (f.isDirectory()) walk(p, depth + 1)
      else if (/\.(jpe?g|png|webp)$/i.test(f.name)) n++
    }
  }
  try { walk(root, 0) } catch { /* ignore */ }
  return n
}

// ─── B) session folder: file manifest (relative path → size+mtime) ───────────
export interface SessionState {
  kind: 'session'
  id: string
  files: Record<string, { size: number; mtime: number }>
  count: number
  bytes: number
}

export function sessionState(id: string): SessionState {
  if (id.includes('/') || id.includes('..')) throw new Error('bad session id')
  const root = join(PUBLIC_DIR, id)
  const files: Record<string, { size: number; mtime: number }> = {}
  let bytes = 0
  const walk = (d: string, rel: string) => {
    if (!existsSync(d)) return
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.name === '.DS_Store' || f.name === 'logs') continue
      const p = join(d, f.name)
      const r = rel ? `${rel}/${f.name}` : f.name
      if (f.isDirectory()) walk(p, r)
      else if (!ARCHIVE_RE.test(f.name)) { const s = statSync(p); files[r] = { size: s.size, mtime: Math.floor(s.mtimeMs) }; bytes += s.size }
    }
  }
  try { walk(root, '') } catch { /* ignore */ }
  return { kind: 'session', id, files, count: Object.keys(files).length, bytes }
}

export function listSessions(): string[] {
  if (!existsSync(PUBLIC_DIR)) return []
  return readdirSync(PUBLIC_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort()
}

// ─── C) codebase: version stamp ──────────────────────────────────────────────
export interface CodebaseState {
  kind: 'codebase'
  release: string        // human semver (package.json on a spoke, deploy stamp on the hub)
  version: string        // git short commit, or the deployed commit on the hub
  dirty: boolean         // uncommitted/working-tree changes present
  builtAt: string | null // deploy timestamp (hub only)
  node: string           // which machine reported this (OSKAR_NODE_ID)
  role: 'hub' | 'spoke'  // hub = the server, spoke = a workstation pointing at it
}

// Spokes point at a hub via OSKAR_SYNC_HUB; the hub itself leaves it unset.
function nodeRole(): 'hub' | 'spoke' { return process.env.OSKAR_SYNC_HUB ? 'spoke' : 'hub' }

function pkgVersion(): string {
  try { return (JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0' }
  catch { return '0.0.0' }
}

/** Compact one-line label for a node's build: `v1.0.0 · c8f6661+` (+ = dirty).
 *  `release` may be absent when diffing against a hub still on the pre-version
 *  build → fall back to `?` rather than printing "undefined". */
export function codebaseLabel(s: Partial<CodebaseState>): string {
  return `v${s.release || '?'} · ${s.version ?? 'unknown'}${s.dirty ? '+' : ''}`
}

export function codebaseState(): CodebaseState {
  const node = getNodeId(), role = nodeRole()
  // Hub: a DEPLOY_VERSION file the deploy stamped. Spoke: live git + package.json.
  if (existsSync(VERSION_FILE)) {
    try {
      const v = JSON.parse(readFileSync(VERSION_FILE, 'utf8')) as { release?: string; version?: string; builtAt?: string; dirty?: boolean }
      return { kind: 'codebase', release: v.release ?? pkgVersion(), version: v.version ?? 'unknown', dirty: !!v.dirty, builtAt: v.builtAt ?? null, node, role }
    } catch { /* fall through to git */ }
  }
  let version = 'unknown'
  let dirty = false
  try {
    version = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PROJECT_ROOT, timeout: 3000 }).toString().trim()
    dirty = execFileSync('git', ['status', '--porcelain'], { cwd: PROJECT_ROOT, timeout: 3000 }).toString().trim().length > 0
  } catch { /* no git */ }
  return { kind: 'codebase', release: pkgVersion(), version, dirty, builtAt: null, node, role }
}

// ─── diff: local vs remote → { inSync, sentence } for the indicator ──────────
export interface SyncDiff { inSync: boolean; sentence: string; localVersion?: string; remoteVersion?: string }

export function diffCrm(local: CrmState, remote: CrmState): SyncDiff {
  const nodes = new Set([...Object.keys(local.perNode), ...Object.keys(remote.perNode)])
  let aheadHub = 0, aheadLocal = 0
  for (const n of nodes) {
    const l = local.perNode[n] ?? -1, r = remote.perNode[n] ?? -1
    if (r > l) aheadHub += r - l
    if (l > r) aheadLocal += l - r
  }
  const shots = remote.screenshots - local.screenshots
  if (!aheadHub && !aheadLocal && shots === 0) return { inSync: true, sentence: 'In sync' }
  const parts: string[] = []
  if (aheadHub) parts.push(`server has ~${aheadHub} newer event(s)`)
  if (aheadLocal) parts.push(`you have ~${aheadLocal} the server lacks`)
  if (shots) parts.push(`${Math.abs(shots)} screenshot(s) ${shots > 0 ? 'on server' : 'local-only'}`)
  return { inSync: false, sentence: parts.join('; ') }
}

export function diffSession(local: SessionState, remote: SessionState): SyncDiff {
  let onlyLocal = 0, onlyRemote = 0, differ = 0, newerRemote = 0
  const keys = new Set([...Object.keys(local.files), ...Object.keys(remote.files)])
  for (const k of keys) {
    const l = local.files[k], r = remote.files[k]
    if (l && !r) onlyLocal++
    else if (!l && r) onlyRemote++
    // Compare by SIZE only. mtime is NOT preserved across the SSH+tar transport
    // (sub-second precision is lost on extract) → comparing it gives a false
    // "differ" for every transferred file. Size is the reliable cross-machine
    // signal; a real content edit to a build artifact virtually always changes it.
    else if (l && r && l.size !== r.size) { differ++; if (r.mtime > l.mtime) newerRemote++ }
  }
  if (!onlyLocal && !onlyRemote && !differ) return { inSync: true, sentence: 'In sync' }
  const parts: string[] = []
  if (onlyRemote) parts.push(`${onlyRemote} only on server`)
  if (onlyLocal) parts.push(`${onlyLocal} only local`)
  if (differ) parts.push(`${differ} differ (${newerRemote} newer on server)`)
  return { inSync: false, sentence: parts.join('; ') }
}

export function diffCodebase(local: CodebaseState, remote: CodebaseState): SyncDiff {
  const l = codebaseLabel(local)
  const r = codebaseLabel(remote)
  const inSync = local.version === remote.version && local.release === remote.release && !local.dirty
  const deployedAt = remote.builtAt ? new Date(remote.builtAt).toISOString().slice(0, 16).replace('T', ' ') : null
  let sentence: string
  if (inSync) sentence = `In sync · server ${r}${deployedAt ? `, deployed ${deployedAt}` : ''}`
  else if (local.dirty && local.version === remote.version) {
    // same commit on both sides, but the working tree has uncommitted edits.
    // We deploy dirty trees, so the hub MAY already have them — git can't tell.
    sentence = deployedAt
      ? `You ${l} · hub built from ${r} at ${deployedAt}`
      : `You ${l} · uncommitted, not yet on server (${r})`
  } else sentence = `You ${l} · server ${r}${deployedAt ? `, deployed ${deployedAt}` : ''}`
  return { inSync, sentence, localVersion: l, remoteVersion: r }
}
