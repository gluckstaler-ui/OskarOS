/**
 * Session-scoped runtime config (Ralph 2026-05-04).
 *
 * Lives at `public/{sessionId}/logs/_session-config.json` (post-WP-CRM-A12).
 * Owns the user's TopBar choices: which model + transport powers CD, and
 * which model + mode powers WebDev. The MCP build routes (which can't see
 * UI state because they're downstream of the bridge subprocess) read this
 * file to pick up the user's selection. The chat routes read it as a
 * fallback when a per-request override isn't present.
 *
 * Also carries the optional CRM linkage fields (WP-CRM-A11): when a
 * session was created from a prospect via /api/admin/crm/sessions, that
 * route sets `prospect_id` here. The CRM scanner reads `logs/_session-config.json`
 * across all session folders to derive the prospect→session linkage —
 * no more `public/_crm/links.json` shadow database.
 *
 * Read order at every consumer:
 *   1. Per-request override from request body (instant — toggle change
 *      goes out with the next chat or build call).
 *   2. This config file (survives page reload; written on every toggle).
 *   3. Hardcoded default (existing fallback so legacy sessions don't
 *      break).
 *
 * Writes are atomic (temp file + rename). No in-process cache — the file
 * is sub-ms to read, and a stale cache would defeat the "instant" UX
 * Ralph asked for.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import crypto from 'crypto'

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

// Bug M (Ralph 2026-05-04): `'auto'` means "use whatever Claude Code's
// OWN settings have configured." For users running stock Claude Code,
// that's claude-opus-4-8. For users who've base-URL-piped Claude Code
// to Z.ai, that's their configured GLM model. Forcing `--model` from
// the bridge would override the user's intent and make Z.ai-configured
// CLI sessions report claude-opus-4-8 in the system/init event (which
// is what we passed, not what they wanted).
export type CdModel = 'auto' | 'opus' | 'claude-opus-4-8[1m]' | 'claude-opus-4-8' | 'claude-sonnet-4-6'
export type WebDevModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'
export type ExecutionMode = 'smpl' | 'cli' | 'api'

// Mode → cdModel defaults. When the user toggles execution mode, cdModel
// is set to the corresponding value here. SMPL passes Claude Code's tier
// alias 'opus' → resolves via ANTHROPIC_DEFAULT_OPUS_MODEL in settings.json
// → best available model. CLI uses the full Claude identifier (1M context
// on Anthropic; Z.ai compat remaps to glm-4.7). API uses the Anthropic
// endpoint's model ID directly. Ralph 2026-05-04.
export const MODE_DEFAULTS: Record<ExecutionMode, CdModel> = {
  smpl: 'opus',
  cli: 'claude-opus-4-8[1m]',
  api: 'claude-opus-4-8',
}

export interface SessionConfig {
  webDevModel: WebDevModel
  webDevMode: ExecutionMode
  /**
   * `'auto'` means "let Claude Code's own settings decide" — the bridge
   * spawn omits `--model` so Claude Code uses whatever model the user's
   * `~/.claude/settings.json` (or env) selects. Specific values force a
   * model regardless of Claude Code's defaults — useful only when you
   * KNOW the model is supported by the endpoint Claude Code is talking
   * to. For Anthropic the default Claude Code config is claude-opus-4-8
   * which equals 'auto' in practice.
   */
  cdModel: CdModel
  billingMode: ExecutionMode
  updatedAt: string

  // ────────────────────────────────────────────────────────────────────
  // CRM linkage (optional — populated only for sessions created via
  // /api/admin/crm/sessions). The presence of `prospect_id` is what
  // makes a session folder show up in `scanProspectSessions()` in
  // lib/crm-store.ts. Folder names are mutable labels; this field is
  // the immutable foreign key. WP-CRM-A11.
  // ────────────────────────────────────────────────────────────────────
  prospect_id?: string
  createdAt?: string
  outcome?: 'won' | 'lost' | 'abandoned' | null
  phase?: number
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  webDevModel: 'claude-sonnet-4-6',
  webDevMode: 'cli',
  // CLI default — passes the full Claude identifier with [1m] suffix so
  // the bridge spawns with 1M context on Anthropic. Ralph 2026-05-27:
  // the previous SMPL default ('opus' tier alias) could silently demote
  // to a 200K wire model via the user's ~/.claude/settings.json alias
  // chain. SMPL and API remain as user-clickable options in TopBar; the
  // default just never lands there. API in particular is real out-of-
  // pocket spend and must NEVER be entered without an explicit click.
  cdModel: MODE_DEFAULTS.cli,
  billingMode: 'cli',
  updatedAt: '1970-01-01T00:00:00.000Z',
}

// ──────────────────────────────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────────────────────────────

// WP-CRM-A12 (Ralph 2026-05-22): moved from session root into `logs/`
// alongside USAGE.json and BRIDGE.json. One source-of-truth path constant.
// Migration of existing 15 files: run `scripts/migrate-session-config.mjs`
// once after this WP ships. Subsequent reads/writes use the new path only.
function getConfigPath(sessionId: string): string {
  return join(process.cwd(), 'public', sessionId, 'logs', '_session-config.json')
}

// ──────────────────────────────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────────────────────────────

/**
 * Read the session config from disk. Returns DEFAULT_SESSION_CONFIG (with
 * a fresh `updatedAt`) if the file is missing or unreadable. Never throws.
 */
export function readSessionConfig(sessionId: string): SessionConfig {
  const path = getConfigPath(sessionId)
  if (!existsSync(path)) return { ...DEFAULT_SESSION_CONFIG }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SessionConfig>
    // Merge over defaults so a partial file (or one missing fields after a
    // schema add) still resolves to a valid SessionConfig.
    return { ...DEFAULT_SESSION_CONFIG, ...parsed }
  } catch (err) {
    console.warn(`[session-config] Failed to read ${path}:`, err instanceof Error ? err.message : err)
    return { ...DEFAULT_SESSION_CONFIG }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Write (atomic)
// ──────────────────────────────────────────────────────────────────────

/**
 * Write a partial update to the session config. Merged over the existing
 * file (or DEFAULT_SESSION_CONFIG if missing). Atomic: writes to a temp
 * file in the same directory, then renames over the target. Never throws
 * — failures are logged and swallowed so a transient FS hiccup doesn't
 * crash the toggle UX.
 */
export function writeSessionConfig(sessionId: string, partial: Partial<SessionConfig>): SessionConfig {
  const path = getConfigPath(sessionId)
  const merged: SessionConfig = {
    ...readSessionConfig(sessionId),
    ...partial,
    updatedAt: new Date().toISOString(),
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${crypto.randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8')
    renameSync(tmp, path)
  } catch (err) {
    console.warn(`[session-config] Failed to write ${path}:`, err instanceof Error ? err.message : err)
    // Clean up any orphaned tmp file from a half-completed write
    try {
      const dir = dirname(path)
      const { readdirSync } = require('fs') as typeof import('fs')
      const orphans = readdirSync(dir).filter((f: string) => f.startsWith('_session-config.json.') && f.endsWith('.tmp'))
      for (const o of orphans) {
        try { unlinkSync(join(dir, o)) } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
  return merged
}

// ──────────────────────────────────────────────────────────────────────
// 3-tier resolver — primary entry point for routes
// ──────────────────────────────────────────────────────────────────────

/**
 * Resolve a config value with the 3-tier read order:
 *   1. `override` if defined (per-request body wins)
 *   2. session config file value
 *   3. `defaultValue` (last resort)
 *
 * Generic so it works for any field of SessionConfig.
 *
 * Example:
 *   const cdModel = resolveConfig('cdModel', req.cdModel, sessionId, 'claude-opus-4-8[1m]')
 */
export function resolveConfig<K extends keyof SessionConfig>(
  field: K,
  override: SessionConfig[K] | undefined | null,
  sessionId: string,
  defaultValue: SessionConfig[K],
): SessionConfig[K] {
  if (override !== undefined && override !== null) return override
  const cfg = readSessionConfig(sessionId)
  const fileValue = cfg[field]
  // Distinguish "explicit default in file" from "field literally absent" — if
  // the file's value equals the schema default and the override is missing,
  // we still prefer the explicit defaultValue passed in (callers may want to
  // override the schema default for a specific call site).
  if (fileValue !== undefined && fileValue !== DEFAULT_SESSION_CONFIG[field]) return fileValue
  // File has the schema default OR the field is missing — use the caller's
  // defaultValue, which is typically the same string but may differ.
  return defaultValue
}

/**
 * Convenience for the most common case: resolving the WebDev model+mode
 * combo for build routes. Returns both fields in one call.
 */
export function resolveWebDevExecution(
  override: { mode?: ExecutionMode | null; model?: WebDevModel | null } | undefined,
  sessionId: string,
  defaultMode: ExecutionMode = 'cli',
  defaultModel: WebDevModel = 'claude-sonnet-4-6',
): { mode: ExecutionMode; model: WebDevModel } {
  return {
    mode: resolveConfig('webDevMode', override?.mode, sessionId, defaultMode),
    model: resolveConfig('webDevModel', override?.model, sessionId, defaultModel),
  }
}
