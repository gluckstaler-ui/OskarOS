// ============================================================================
// lib/site/compare.ts — transport-agnostic diff (local manifest ⇄ remote
// manifest). Written ONCE against the Transport interface; FTPS, FTP and Local
// all share it (spec §2, §7).
//
// Walk both sides into `{ relPath -> {size, mtime} }` honoring `site.ignore`
// PLUS the hard-excludes (`logs/`, `screenshots/`, `_session-config.json`) —
// the hard-excludes hold even if the user removed them from `site.ignore`
// (spec §3, §10.11). Enforced in `makeIgnore()`, which the walkers consult.
//
// CHANGE DETECTION — Ralph correction #1 (overrides spec §7's size-only rule):
//   changed = (size differs) OR (local mtime is newer than the last-sync time).
//   A same-length text edit ("2024" → "2025") MUST still classify `changed` so
//   it publishes. mtime is the tiebreak, never size alone.
//
// Direction matters (spec §5.3): UP compares local→remote, DOWN remote→local.
// "source" = the side we read FROM, "dest" = the side we write TO.
//   - only on source        → `new`
//   - both, size differs     → `changed`
//   - both, source mtime newer than lastSync (and size equal) → `changed`
//   - both, otherwise        → `unchanged`
//
// Sort (spec §5.4): changed-essential → new-essential → new-non-essential →
//   changed-non-essential → unchanged. Default-selected = essential && (new||changed).
// ============================================================================
import { isEssential } from './essential'
import type { Transport, ManifestEntry } from './transport'

export type FileStatus = 'new' | 'changed' | 'unchanged'

export interface CompareRow {
  path: string
  status: FileStatus
  essential: boolean
  /** Pre-checked in the picker: essential && (new || changed). */
  selected: boolean
  /** Size on the local side, if present. */
  localSize?: number
  /** Size on the remote side, if present. */
  remoteSize?: number
}

// The three paths that are ALWAYS excluded — picker, diff, and sync, both
// directions — regardless of `site.ignore` (spec §10.11). A leading-segment
// match: `logs`, `logs/x`, `screenshots/...`, and the bare config file.
const HARD_EXCLUDES = ['logs', 'screenshots', '_session-config.json']

/**
 * Build the IgnoreFn the walkers consult. Folds the hard-excludes in FIRST
 * (non-negotiable), then the user's `site.ignore` patterns.
 *
 * Pattern semantics (deliberately simple — these are folder/file names, not a
 * full gitignore engine):
 *   - trailing `/`  → directory prefix match (`logs/` excludes `logs` and everything under it)
 *   - leading `*`   → suffix match (`.env*` → startsWith; `*.log` → endsWith)
 *   - otherwise     → exact segment match anywhere in the path, OR a path-prefix match
 */
export function makeIgnore(userIgnore: string[] = []): (relPath: string) => boolean {
  const patterns = [...HARD_EXCLUDES.map((p) => (p.endsWith('.json') ? p : p + '/')), ...userIgnore]

  return (relPathRaw: string): boolean => {
    const relPath = relPathRaw.replace(/\/+$/, '') // normalize trailing slash off
    if (!relPath) return false
    const segments = relPath.split('/')

    for (const patRaw of patterns) {
      if (!patRaw) continue
      const pat = patRaw.trim()

      // Directory-prefix pattern: "logs/" excludes "logs" and "logs/anything".
      if (pat.endsWith('/')) {
        const dir = pat.slice(0, -1)
        if (relPath === dir || relPath.startsWith(dir + '/') || segments.includes(dir)) return true
        continue
      }
      // Glob-ish: "*.log" (endsWith), ".env*" (startsWith on basename).
      if (pat.startsWith('*')) {
        const suffix = pat.slice(1)
        if (segments.some((s) => s.endsWith(suffix))) return true
        continue
      }
      if (pat.endsWith('*')) {
        const prefix = pat.slice(0, -1)
        if (segments.some((s) => s.startsWith(prefix))) return true
        continue
      }
      // Plain name: exact segment match anywhere, OR a leading path prefix.
      if (segments.includes(pat) || relPath === pat || relPath.startsWith(pat + '/')) return true
    }
    return false
  }
}

// Rank for the spec §5.4 sort order. Lower sorts first.
//   0 changed-essential · 1 new-essential · 2 new-non-essential ·
//   3 changed-non-essential · 4 unchanged
function rank(essential: boolean, status: FileStatus): number {
  if (status === 'unchanged') return 4
  if (essential) return status === 'changed' ? 0 : 1
  return status === 'new' ? 2 : 3
}

export interface CompareParams {
  /** Manifest of the side we read FROM (local for UP, remote for DOWN). */
  source: Map<string, ManifestEntry>
  /** Manifest of the side we write TO (remote for UP, local for DOWN). */
  dest: Map<string, ManifestEntry>
  /** UP → source=local; DOWN → source=remote. Controls localSize/remoteSize mapping. */
  direction: 'up' | 'down'
  /**
   * Epoch ms of the last successful sync (Ralph #1 mtime tiebreak). A source
   * file whose mtime is strictly newer than this counts as `changed` even when
   * sizes match. 0 / undefined → mtime never forces `changed` (size-only).
   */
  lastSyncMs?: number
  /** Include `unchanged` rows in the output (default false — diff list hides them). */
  includeUnchanged?: boolean
}

/**
 * Classify every relPath across both manifests. Pure — no I/O. The route walks
 * both transports into manifests, then calls this.
 */
export function compareManifests(params: CompareParams): CompareRow[] {
  const { source, dest, direction, lastSyncMs = 0, includeUnchanged = false } = params
  const rows: CompareRow[] = []
  const keys = new Set([...source.keys(), ...dest.keys()])

  for (const path of keys) {
    const s = source.get(path)
    const d = dest.get(path)
    const essential = isEssential(path)

    // localSize/remoteSize are mapped by direction (UP: source=local; DOWN: source=remote).
    const sourceSize = s?.size
    const destSize = d?.size
    const localSize = direction === 'up' ? sourceSize : destSize
    const remoteSize = direction === 'up' ? destSize : sourceSize

    let status: FileStatus
    if (s && !d) {
      status = 'new'
    } else if (!s && d) {
      // Only on the DEST side. From the chosen direction's POV this isn't a
      // file to move (it'd be moved by the opposite direction). The prototype
      // hides these for the active direction, so we skip — they reappear when
      // the user flips direction and re-compares.
      continue
    } else if (s && d) {
      // Both sides present. Size is the primary "differs" signal...
      if (s.size !== d.size) {
        status = 'changed'
      } else if (lastSyncMs > 0 && s.mtime > 0 && s.mtime > lastSyncMs) {
        // ...but Ralph #1: a same-size source edited AFTER the last sync still
        // counts as changed (the "2024"→"2025" case). mtime is the tiebreak.
        status = 'changed'
      } else {
        status = 'unchanged'
      }
    } else {
      continue
    }

    if (status === 'unchanged' && !includeUnchanged) continue

    rows.push({
      path,
      status,
      essential,
      selected: essential && (status === 'new' || status === 'changed'),
      localSize,
      remoteSize,
    })
  }

  // Spec §5.4 sort; tiebreak alphabetical so output is deterministic.
  rows.sort((a, b) => rank(a.essential, a.status) - rank(b.essential, b.status) || a.path.localeCompare(b.path))
  return rows
}
