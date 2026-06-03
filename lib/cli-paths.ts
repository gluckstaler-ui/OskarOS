// ==========================================================================
// lib/cli-paths.ts — single source of truth for resolving external CLI /
// browser binaries and the PATH handed to spawned subprocesses.
//
// Consolidates the binary-finding logic that used to be copy-pasted (with
// drifting macOS-only paths) across webdev.ts, bridge-process-manager.ts and
// probe-model/route.ts. OskarOS now targets Linux x86 + WSL2, not just macOS;
// the old `/opt/homebrew/bin/...` literals degraded for the CLI binaries (they
// fell through to PATH) but the duplication was a portability trap. Env-var
// overrides (CLAUDE_BIN / GEMINI_BIN / CHROMIUM_BIN) let hosted deploys pin the
// exact binary.
//
// WP-40 (Linux/WSL portability), Ralph 2026-06-02. See docs/Feature-X.md §4.3.
// ==========================================================================
import { existsSync } from 'fs'
import { join } from 'path'

const HOME = process.env.HOME || ''

export type BinaryName = 'claude' | 'gemini' | 'chromium'

// Ordered candidate lists. First existing path wins; the bare name is the
// last resort (a spawn with a sane PATH — see safePath — still resolves it).
// An env override, when set, is tried first.
const CANDIDATE_PATHS: Record<BinaryName, (string | undefined)[]> = {
  claude: [
    process.env.CLAUDE_BIN,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    '/snap/bin/claude',
    join(HOME, '.npm-global/bin/claude'),
    join(HOME, 'node_modules/.bin/claude'),
    'claude',
  ],
  gemini: [
    process.env.GEMINI_BIN,
    '/opt/homebrew/bin/gemini',
    '/usr/local/bin/gemini',
    '/usr/bin/gemini',
    '/snap/bin/gemini',
    join(HOME, '.npm-global/bin/gemini'),
    'gemini',
  ],
  // NOTE: the chromium resolver is defined here and READY, but the two Chromium
  // launchers (lib/thumbnail-generator.ts, app/api/mcp/screenshot/route.ts) are
  // deliberately NOT yet wired to it — that is WP-128 (split from WP-40).
  chromium: [
    process.env.CHROMIUM_BIN,
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/opt/homebrew/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium',
    'chromium',
  ],
}

/**
 * Resolve a binary to an absolute path, or to its bare name as a last resort
 * (so a spawn with a sane PATH still finds it). Never throws.
 */
export function findBinary(name: BinaryName): string {
  for (const p of CANDIDATE_PATHS[name]) {
    if (!p) continue
    if (p === name || existsSync(p)) return p
  }
  return name
}

/**
 * PATH for spawned subprocesses: the macOS + common Linux bin dirs prepended
 * to the inherited PATH, so `claude` / `gemini` / `node` resolve on either OS.
 * `extra` (e.g. a session-local node_modules/.bin) is prepended ahead of all.
 */
export function safePath(extra?: string): string {
  const common = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin'
  return [extra, common, process.env.PATH].filter(Boolean).join(':')
}
