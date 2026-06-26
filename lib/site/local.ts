// ============================================================================
// lib/site/local.ts — LocalTransport (node:fs), rooted at `destination`.
//
// File mode (spec §4, teal chip): for when OskarOS itself runs ON the server.
// No network, no auth — every op resolves under `destination`. `secure` is the
// literal 'file'. Path traversal outside the root is rejected (defence in
// depth; the API layer also guards `..`).
// ============================================================================
import {
  existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync, type Dirent,
} from 'node:fs'
import { join, resolve, dirname, sep, posix } from 'node:path'
import type {
  Transport, ListEntry, ManifestEntry, IgnoreFn,
} from './transport'

export class LocalTransport implements Transport {
  readonly secure = 'file' as const
  private root: string

  constructor(destination: string) {
    this.root = resolve(destination)
  }

  // Resolve a relative path under the root, refusing anything that escapes it.
  private abs(rel: string): string {
    const clean = rel.replace(/^\/+/, '')
    const full = resolve(this.root, clean)
    // `root + sep` would be `//` when root is `/` (the fs-root browse case), which
    // would wrongly flag a real child like `/Users` as escaping. Normalize it.
    const rootSep = this.root.endsWith(sep) ? this.root : this.root + sep
    if (full !== this.root && !full.startsWith(rootSep)) {
      throw new Error(`path escapes destination root: ${rel}`)
    }
    return full
  }

  async connect(): Promise<void> {
    // The destination is a live site's docroot — it MUST already exist (the host
    // creates it when the domain is added). We do NOT create it: a missing path is
    // a WRONG path, surfaced loudly, never papered over with a mkdir at `/`.
    if (!existsSync(this.root)) throw new Error(`destination does not exist: ${this.root}`)
    if (!statSync(this.root).isDirectory()) throw new Error(`destination is not a directory: ${this.root}`)
  }

  async close(): Promise<void> { /* nothing to close */ }

  async list(dir: string): Promise<ListEntry[]> {
    const full = this.abs(dir)
    if (!existsSync(full)) return []
    const out: ListEntry[] = []
    let dirents: Dirent[]
    try { dirents = readdirSync(full, { withFileTypes: true }) } catch { return [] } // unreadable dir → empty
    for (const d of dirents) {
      // Follow symlinks for the type, but tolerate broken/unreadable entries
      // (e.g. /.VolumeIcon.icns at the fs root) — fall back to the dirent type,
      // never crash the whole listing on one bad node.
      let isDir = d.isDirectory(), size = 0
      try { const st = statSync(join(full, d.name)); isDir = st.isDirectory(); size = isDir ? 0 : st.size } catch { /* inaccessible */ }
      out.push({ name: d.name, type: isDir ? 'dir' : 'file', size })
    }
    return out
  }

  async manifest(dir: string, ignore: IgnoreFn): Promise<Map<string, ManifestEntry>> {
    const base = this.abs(dir)
    const out = new Map<string, ManifestEntry>()
    const walk = (absDir: string, relDir: string) => {
      if (!existsSync(absDir)) return
      let entries: Dirent[]
      try { entries = readdirSync(absDir, { withFileTypes: true }) } catch { return } // unreadable dir → skip
      for (const d of entries) {
        const rel = relDir ? posix.join(relDir, d.name) : d.name
        const abs = join(absDir, d.name)
        if (d.isDirectory()) {
          // Ignore probes for a directory test the path WITH a trailing slash
          // (matches how `logs/`, `screenshots/` etc. are written in ignore lists).
          if (ignore(rel) || ignore(rel + '/')) continue
          walk(abs, rel)
        } else {
          // Files (and symlinks-to-files: normal stat, follow like any file —
          // spec §10.6 forbids lstat/skip). statSync follows symlinks.
          if (ignore(rel)) continue
          try {
            const st = statSync(abs)
            out.set(rel, { size: st.size, mtime: Math.floor(st.mtimeMs) })
          } catch { /* broken symlink / permission denied — skip this entry */ }
        }
      }
    }
    walk(base, '')
    return out
  }

  async upload(localPath: string, remoteRel: string): Promise<void> {
    const dest = this.abs(remoteRel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(localPath, dest)
  }

  async download(remoteRel: string, localPath: string): Promise<void> {
    const src = this.abs(remoteRel)
    mkdirSync(dirname(localPath), { recursive: true })
    copyFileSync(src, localPath)
  }

  async mkdirp(remoteRel: string): Promise<void> {
    mkdirSync(this.abs(remoteRel), { recursive: true })
  }

  async remove(remoteRel: string): Promise<void> {
    const p = this.abs(remoteRel)
    if (existsSync(p)) rmSync(p, { force: true })
  }

  async exists(remoteRel: string): Promise<boolean> {
    return existsSync(this.abs(remoteRel))
  }
}
