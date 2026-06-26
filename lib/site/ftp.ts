// ============================================================================
// lib/site/ftp.ts — FtpTransport over `basic-ftp`. Handles BOTH explicit FTPS
// (AUTH TLS on port 21, then PBSZ 0 + PROT P) and plain FTP on the same client.
//
// FTPS first (spec §4, green chip): secure:true + secureOptions:{
//   rejectUnauthorized:false, servername:host }. rejectUnauthorized:false is
// the documented default — shared-host certs cover `*.web-hosting.com` while
// the user dialled `<host>`, so a strict check would mismatch on every connect
// (spec §10.4 — the chip color is the disclosure, no gate, no modal).
//
// If FTPS negotiation fails AND the caller didn't pin secure:'ftps', fall back
// to plain FTP (secure:false, yellow chip). The negotiated result is exposed
// as `this.secure` ('ftps' | 'plain') so /api/site/connect can report it.
//
// One connection per operation batch (basic-ftp is NOT concurrency-safe — spec
// §4). The route opens, runs the whole file batch, closes.
//
// All remote ops are anchored to an ABSOLUTE path under `docroot`, so the
// client's mutable cwd (ensureDir changes it) never corrupts a later op.
// ============================================================================
import { Client, FileType } from 'basic-ftp'
import { mkdirSync } from 'node:fs'
import { dirname, posix } from 'node:path'
import type {
  Transport, ListEntry, ManifestEntry, IgnoreFn,
} from './transport'

export interface FtpOptions {
  host: string
  port: number
  user: string
  password: string
  docroot: string
  /** 'ftps' pins secure FTPS (no fallback). 'plain' forces plain. undefined → try FTPS, fall back. */
  pin?: 'ftps' | 'plain'
}

/** True for IPv4/IPv6 literals — SNI must not be set to these. */
function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true // IPv4
  if (host.includes(':')) return true // IPv6 (and bracketed forms)
  return false
}

export class FtpTransport implements Transport {
  private client = new Client(30_000)
  private opts: FtpOptions
  private root: string
  secure: 'ftps' | 'plain' = 'ftps'

  constructor(opts: FtpOptions) {
    this.opts = opts
    // Normalize docroot to a leading-slash, no-trailing-slash absolute base.
    this.root = '/' + (opts.docroot || '').replace(/^\/+/, '').replace(/\/+$/, '')
    if (this.root === '/') this.root = ''
  }

  /** Absolute remote path for a relative path under the docroot. */
  private abs(rel: string): string {
    const clean = (rel || '').replace(/^\/+/, '')
    return this.root + (clean ? '/' + clean : '') || '/'
  }

  async connect(): Promise<void> {
    const { host, port, user, password, pin } = this.opts
    const base = { host, port: Number(port) || 21, user, password }

    // Any failure below MUST close the control socket before rethrowing.
    // Pure-FTPd caps concurrent connections per IP (8 on Namecheap shared);
    // a leaked socket lingers until the 15-min idle timeout, so repeated
    // failed connects (a connect/disconnect UI does this) would pile up and
    // lock the account out with `421 Too many connections`.
    try {
      if (pin === 'plain') {
        await this.client.access({ ...base, secure: false })
        this.secure = 'plain'
      } else {
        // Try explicit FTPS first. SNI (servername) must be a hostname — Node's
        // TLS layer refuses an IP literal there, so omit it when host is an IP
        // (the cert SAN match is moot anyway with rejectUnauthorized:false).
        const secureOptions: Record<string, unknown> = { rejectUnauthorized: false }
        if (!isIpLiteral(host)) secureOptions.servername = host
        try {
          await this.client.access({ ...base, secure: true, secureOptions })
          this.secure = 'ftps'
        } catch (err) {
          if (pin === 'ftps') throw err // pinned — no silent downgrade
          // Fall back to plain FTP on a fresh client (the failed one is unusable).
          try { this.client.close() } catch { /* already dead */ }
          this.client = new Client(30_000)
          await this.client.access({ ...base, secure: false })
          this.secure = 'plain'
        }
      }
      // Anchor at the docroot so every op resolves predictably.
      if (this.root) await this.client.cd(this.root)
    } catch (err) {
      try { this.client.close() } catch { /* already dead */ }
      throw err
    }
  }

  async close(): Promise<void> {
    try { this.client.close() } catch { /* already closed */ }
  }

  async list(dir: string): Promise<ListEntry[]> {
    const infos = await this.client.list(this.abs(dir))
    return infos
      .filter((f) => f.name !== '.' && f.name !== '..')
      .map((f) => ({
        name: f.name,
        type: f.type === FileType.Directory ? ('dir' as const) : ('file' as const),
        size: f.type === FileType.Directory ? 0 : f.size,
      }))
  }

  async manifest(dir: string, ignore: IgnoreFn): Promise<Map<string, ManifestEntry>> {
    const out = new Map<string, ManifestEntry>()
    const walk = async (relDir: string): Promise<void> => {
      let infos
      try {
        infos = await this.client.list(this.abs(relDir))
      } catch { return } // dir missing on this side — nothing to manifest
      for (const f of infos) {
        if (f.name === '.' || f.name === '..') continue
        const rel = relDir ? posix.join(relDir, f.name) : f.name
        if (f.type === FileType.Directory) {
          if (ignore(rel) || ignore(rel + '/')) continue
          await walk(rel)
        } else {
          // Files + symlinks-to-files: treated as files, no lstat/skip (spec §10.6).
          if (ignore(rel)) continue
          // MLSD gives a reliable parsed date; LIST may not. 0 when absent.
          const mtime = f.modifiedAt ? f.modifiedAt.getTime() : 0
          out.set(rel, { size: f.size, mtime })
        }
      }
    }
    await walk(dir || '')
    return out
  }

  async mkdirp(remoteRel: string): Promise<void> {
    // ensureDir mutates cwd; restore the docroot anchor afterward.
    await this.client.ensureDir(this.abs(remoteRel))
    if (this.root) await this.client.cd(this.root)
  }

  async upload(localPath: string, remoteRel: string): Promise<void> {
    const parent = posix.dirname(remoteRel)
    if (parent && parent !== '.' && parent !== '/') await this.mkdirp(parent)
    await this.client.uploadFrom(localPath, this.abs(remoteRel))
  }

  async download(remoteRel: string, localPath: string): Promise<void> {
    mkdirSync(dirname(localPath), { recursive: true })
    await this.client.downloadTo(localPath, this.abs(remoteRel))
  }

  async remove(remoteRel: string): Promise<void> {
    // ignoreErrorCodes:true — removing a non-existent file is not an error here.
    await this.client.remove(this.abs(remoteRel), true)
  }

  async exists(remoteRel: string): Promise<boolean> {
    // size() throws on a missing file; cheap existence probe for backup rotation.
    try { await this.client.size(this.abs(remoteRel)); return true } catch { /* not a file */ }
    // Could be a directory — try listing its parent and matching the name.
    try {
      const parent = posix.dirname(remoteRel)
      const name = posix.basename(remoteRel)
      const infos = await this.client.list(this.abs(parent === '.' ? '' : parent))
      return infos.some((f) => f.name === name)
    } catch { return false }
  }
}
