// ============================================================================
// lib/site/transport.ts — the transport-agnostic contract.
//
// FTPS, plain FTP, and Local all implement this ONE interface. compare.ts and
// the sync route are written against `Transport`, never against a concrete
// adapter — the only difference between "publish over FTPS" and "publish to a
// folder on the same box" is which class got `new`-ed (spec §2, §4).
//
// `manifest(dir)` is the recursive walk that honors `site.ignore` PLUS the
// hard-excludes (`logs/`, `screenshots/`, `_session-config.json`) — the
// exclusion lives in the walker, so removing a hard-exclude from `site.ignore`
// does NOT make it sync (spec §3, §10.11).
// ============================================================================

export type EntryType = 'dir' | 'file'

/** One immediate child of a directory (non-recursive `list`). */
export interface ListEntry {
  name: string
  type: EntryType
  size: number
}

/** A single file in a recursive `manifest` walk. */
export interface ManifestEntry {
  size: number
  /** Epoch ms. 0 when the transport can't report a reliable mtime (e.g. some FTP servers). */
  mtime: number
}

/**
 * Predicate the walker consults for every relative path it encounters. Returns
 * true when the path must be skipped (ignored or hard-excluded). compare.ts
 * builds this from `site.ignore` + the hard-excludes via `makeIgnore()`.
 */
export type IgnoreFn = (relPath: string) => boolean

export interface Transport {
  /** The negotiated security label, set after connect(). */
  readonly secure: 'ftps' | 'plain' | 'file'

  /** Open the connection / validate the root. Throws on failure. */
  connect(): Promise<void>
  /** Close the connection. Idempotent; never throws. */
  close(): Promise<void>

  /** Non-recursive listing of one directory (relative to the root). Used by the picker. */
  list(dir: string): Promise<ListEntry[]>

  /**
   * Recursive walk into `{ relPath -> {size, mtime} }`, honoring `ignore`
   * (which already folds in the hard-excludes). relPath uses forward slashes,
   * is relative to the root, and never starts with `/`.
   */
  manifest(dir: string, ignore: IgnoreFn): Promise<Map<string, ManifestEntry>>

  /** Upload a local file to a remote relative path (creating parent dirs). */
  upload(localPath: string, remoteRel: string): Promise<void>
  /** Download a remote relative path to a local file (creating parent dirs). */
  download(remoteRel: string, localPath: string): Promise<void>

  /** Recursively create a remote directory (relative to the root). No-op if it exists. */
  mkdirp(remoteRel: string): Promise<void>
  /** Remove a remote file (relative to the root). Used by backup rotation. */
  remove(remoteRel: string): Promise<void>

  /** True if a remote relative path exists (file or dir). */
  exists(remoteRel: string): Promise<boolean>
}
