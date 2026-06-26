// ============================================================================
// lib/sync/stream.ts — the shared SYNC_* emitter for Webserver Sync.
//
// Produces a ReadableStream of newline-delimited progress lines (spec §8):
//   SYNC_FILE <path>
//   SYNC_OK   <path>
//   SYNC_ERR  <path> <reason>
//   SYNC_DONE ok=<n> fail=<m>
//
// Each file is its OWN try/catch → partial success: a chmod-000 remote file
// (550) reports a per-file SYNC_ERR and the batch continues (spec §9.7). One
// transport connection drives the whole batch (the route opens/closes it).
//
// BACKUP — Ralph correction #2 (LOCAL ONLY, never a server-side `-bak`):
//   the FTP user is chrooted to the docroot, so a server-side `-bak.html` would
//   be publicly web-served. Instead, before OVERWRITING a remote/local .html or
//   .css that ALREADY EXISTS at the destination, the CURRENT destination copy
//   is saved into  public/<id>/logs/site-backups/<relpath>  — exactly ONE
//   sidecar per file, replaced (not chained) on each overwrite.
//     - UP   (publish): destination = remote → DOWNLOAD the live remote copy first.
//     - DOWN (pull):    destination = local  → COPY the local file first.
//     - New files (no prior dest version): NO backup.
//     - .html / .css ONLY (regenerated assets aren't worth protecting).
//
// SYNC-LOG (spec §8): on SYNC_DONE, prepend a markdown entry (newest-on-top) to
// public/<id>/logs/sync-log.md. `logs/` is hard-excluded so the log never ships.
// ============================================================================
import {
  existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync, rmSync,
} from 'node:fs'
import { join, dirname, extname } from 'node:path'
import type { Transport } from '../site/transport'

export type Direction = 'up' | 'down'

/** Per-file note for the sync log + observability. */
type FileNote = 'new' | 'overwrite' | 'backup-html' | 'backup-css'

export interface SyncFileResult {
  path: string
  ok: boolean
  bytes: number
  note: FileNote
  reason?: string
}

export interface SyncRunParams {
  sessionId: string
  direction: Direction
  /** Relative paths the user selected to move. */
  files: string[]
  transport: Transport
  /** Absolute path to the session's public folder root (where the local files live). */
  localRoot: string
  /** For the sync-log header line: the negotiated transport label. */
  method: 'ftps' | 'plain' | 'file'
  /** For the sync-log header: `user@host` (FTP) or the destination (File). */
  endpoint: string
  /** For the sync-log header: the docroot / destination the bytes land in. */
  docroot: string
}

const BACKUP_EXTS = new Set(['.html', '.css'])
const enc = new TextEncoder()

function backupDir(localRoot: string): string {
  // public/<id>/logs/site-backups — under the hard-excluded logs/ so backups
  // themselves never sync to the server.
  return join(localRoot, 'logs', 'site-backups')
}

/**
 * Perform the one-sidecar backup of the CURRENT destination copy, if the target
 * already exists and is .html/.css. Returns the note for the log, or null if no
 * backup was taken (new file, or non-html/css).
 */
async function maybeBackup(
  rel: string, direction: Direction, transport: Transport, localRoot: string,
): Promise<FileNote | null> {
  const ext = extname(rel).toLowerCase()
  if (!BACKUP_EXTS.has(ext)) return null

  const backupPath = join(backupDir(localRoot), rel)

  if (direction === 'up') {
    // Destination = remote. Back up only if the remote file already exists.
    const remoteExists = await transport.exists(rel)
    if (!remoteExists) return null
    mkdirSync(dirname(backupPath), { recursive: true })
    if (existsSync(backupPath)) rmSync(backupPath, { force: true }) // replace, not chain
    await transport.download(rel, backupPath)
  } else {
    // Destination = local. Back up only if the local file already exists.
    const localPath = join(localRoot, rel)
    if (!existsSync(localPath)) return null
    mkdirSync(dirname(backupPath), { recursive: true })
    if (existsSync(backupPath)) rmSync(backupPath, { force: true }) // replace, not chain
    copyFileSync(localPath, backupPath)
  }
  return ext === '.html' ? 'backup-html' : 'backup-css'
}

/**
 * Move ONE file (with backup), returning its result. Own try/catch so a failure
 * never aborts the batch.
 */
async function moveOne(
  rel: string, params: SyncRunParams,
): Promise<SyncFileResult> {
  const { direction, transport, localRoot } = params
  const localPath = join(localRoot, rel)
  try {
    // Determine if this is a brand-new file at the destination (→ no backup,
    // note 'new') BEFORE we rotate the backup.
    let destExisted: boolean
    if (direction === 'up') destExisted = await transport.exists(rel)
    else destExisted = existsSync(localPath)

    const backupNote = await maybeBackup(rel, direction, transport, localRoot)

    let bytes = 0
    if (direction === 'up') {
      // Local → remote. The local source must exist.
      bytes = existsSync(localPath) ? statSync(localPath).size : 0
      await transport.upload(localPath, rel)
    } else {
      // Remote → local. Backup (above) already copied the prior local copy.
      await transport.download(rel, localPath)
      bytes = existsSync(localPath) ? statSync(localPath).size : 0
    }

    const note: FileNote = backupNote ?? (destExisted ? 'overwrite' : 'new')
    return { path: rel, ok: true, bytes, note, reason: undefined }
  } catch (err) {
    // Surface the FTP code/reason for SYNC_ERR (spec §8: "<reason>").
    const reason = ftpReason(err)
    return { path: rel, ok: false, bytes: 0, note: 'overwrite', reason }
  }
}

/** Extract a compact reason — FTP error code when present, else the message. */
function ftpReason(err: unknown): string {
  if (err && typeof err === 'object') {
    // basic-ftp throws FTPError with a numeric `.code` (e.g. 550).
    const code = (err as { code?: unknown }).code
    const msg = (err as { message?: unknown }).message
    if (typeof code === 'number') return String(code)
    if (typeof code === 'string' && /^\d{3}$/.test(code)) return code
    if (typeof msg === 'string' && msg) {
      const m = msg.match(/\b(\d{3})\b/) // pull a 3-digit code out of the message if present
      return m ? m[1] : msg.split('\n')[0]
    }
  }
  return String(err)
}

/** Human-readable note for the sync-log bullet. */
function logNote(r: SyncFileResult): string {
  if (!r.ok) return r.reason ?? 'failed'
  switch (r.note) {
    case 'new': return 'new'
    case 'backup-html': return '-bak.html written'
    case 'backup-css': return '-bak.css written'
    case 'overwrite': default: return 'overwrite'
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Append (newest-on-top) the sync-log entry for a completed run (spec §8).
 * Exported so callers/tests can invoke it directly; also called on SYNC_DONE.
 */
export function appendSyncLog(
  params: SyncRunParams, results: SyncFileResult[], durationMs: number,
): void {
  const { sessionId, direction, localRoot, method, endpoint, docroot } = params
  const logPath = join(localRoot, 'logs', 'sync-log.md')
  mkdirSync(dirname(logPath), { recursive: true })

  const ok = results.filter((r) => r.ok).length
  const fail = results.length - ok
  const totalBytes = results.reduce((a, r) => a + (r.ok ? r.bytes : 0), 0)
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace('T', ' ')
  const arrow = direction === 'up' ? '↑ publish' : '↓ download'
  const dur = (durationMs / 1000).toFixed(1) + 's'

  const lines: string[] = []
  lines.push(`## ${ts} · ${arrow} · ${method} · ${endpoint} → ${docroot}`)
  lines.push(`- ${ok} ok, ${fail} fail, ${fmtBytes(totalBytes)}, ${dur}`)
  for (const r of results) {
    lines.push(`- ${r.ok ? 'ok  ' : 'fail'} ${r.path}    (${logNote(r)})`)
  }
  const entry = lines.join('\n') + '\n'

  let existing = ''
  let header = `# Sync log — ${sessionId}\n`
  if (existsSync(logPath)) {
    const raw = readFileSync(logPath, 'utf8')
    const nl = raw.indexOf('\n')
    if (raw.startsWith('# Sync log')) {
      header = raw.slice(0, nl + 1)
      existing = raw.slice(nl + 1).replace(/^\n+/, '')
    } else {
      existing = raw
    }
  }
  // Newest entry directly under the title, above all prior entries.
  const body = `${header}\n${entry}${existing ? '\n' + existing.replace(/^\n+/, '') : ''}`
  writeFileSync(logPath, body, 'utf8')
}

/**
 * Run the whole batch and return a ReadableStream of the SYNC_* lines. The
 * caller (the /api/site/sync route) supplies an ALREADY-CONNECTED transport and
 * closes it when the stream ends. This function never opens/closes the
 * connection — one connection per request lives in the route (spec §4).
 */
export function runSyncStream(params: SyncRunParams): ReadableStream<Uint8Array> {
  const started = Date.now()
  const results: SyncFileResult[] = []

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)) } catch { /* closed */ } }
      let ok = 0
      let fail = 0
      // Deterministic order: base file before its explicit `-bak` sidecar so the
      // base rotates first, then the sidecar overwrite lands on the just-rotated
      // copy (spec §8 "well-defined sequence"). Sorting by path puts
      // `index-bak.html` AFTER `index.html` for the same stem.
      const ordered = [...params.files].sort((a, b) => a.localeCompare(b))

      for (const rel of ordered) {
        send(`SYNC_FILE ${rel}\n`)
        const r = await moveOne(rel, params)
        results.push(r)
        if (r.ok) { ok++; send(`SYNC_OK ${rel}\n`) }
        else { fail++; send(`SYNC_ERR ${rel} ${r.reason ?? 'failed'}\n`) }
      }

      send(`SYNC_DONE ok=${ok} fail=${fail}\n`)
      // Spec §8: the log is written by THIS module on observing SYNC_DONE.
      try { appendSyncLog(params, results, Date.now() - started) } catch { /* log is best-effort */ }
      try { controller.close() } catch { /* noop */ }
    },
  })
}
