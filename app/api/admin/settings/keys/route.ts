// ==========================================
// Admin · Settings · API Keys endpoint
// GET  /api/admin/settings/keys → list providers + masked values + presence
// POST /api/admin/settings/keys → write provider keys to .env.local
//
// Whitelisted providers only — arbitrary env-var writes are not allowed.
// Adding a provider: add an entry to PROVIDERS below; the UI auto-renders
// it. The writer is line-aware: it preserves comments + non-managed keys
// in .env.local, only rewrites lines whose KEY matches a managed env var,
// and appends new lines for managed keys that don't yet exist.
//
// Restart of the Next.js dev server is required for new values to take
// effect — process.env is frozen at boot. The POST response includes
// `restartRequired: true` so the UI can snackbar a reminder.
//
// (Ralph 2026-05-22 — Settings port.)
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { homedir, userInfo } from 'os'

interface ProviderSpec {
  id: string
  name: string
  envVar: string
  format: string           // human description of the expected shape
  note?: string            // optional clarification ("used by X, Y, Z")
  oauth?: boolean          // true if this is an OAuth-style credential
}

// Edit this list to expose more providers. The UI follows the order.
// Each envVar matches what the codebase ACTUALLY reads from process.env —
// verified against lib/gemini.ts, lib/claude-api-loop.ts, lib/bridge-
// process-manager.ts, app/api/chat/route.ts. Earlier NANO_BANANA_API_KEY
// row was a phantom (no consumer) — dropped 2026-05-22.
const PROVIDERS: ProviderSpec[] = [
  {
    id: 'anthropic-oauth',
    name: 'Anthropic — OAuth Token',
    envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    format: 'sk-ant-oat...',
    note: 'Claude Code OAuth — bridge-process-manager passes this when ANTHROPIC_API_KEY is empty',
    oauth: true,
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic — API Key',
    envVar: 'ANTHROPIC_API_KEY',
    format: 'sk-ant-...',
    note: 'Direct API access (claude-api-loop, app/api/chat fallback)',
  },
  {
    id: 'google',
    name: 'Google / Gemini / Nano Banana',
    envVar: 'GOOGLE_API_KEY',
    format: 'AIza...',
    note: 'Shared by Gemini text and image generation (Nano Banana)',
  },
  { id: 'openai',    name: 'OpenAI',              envVar: 'OPENAI_API_KEY',      format: 'sk-...' },
  { id: 'glm',       name: 'GLM',                 envVar: 'GLM_API_KEY',         format: 'zai-...' },
  { id: 'figma',     name: 'Figma',               envVar: 'FIGMA_PERSONAL_TOKEN', format: 'figd_...', oauth: true },
]

// ── Keychain-backed credentials (macOS) ─────────────────────────────
// These are stored by Claude Code itself (`claude login`) in the macOS
// Keychain under the "Claude Code-credentials" generic-password entry.
// The value is a JSON blob; each field below pulls a specific path out.
// Read-only from this UI — writes are owned by Claude Code's login flow.
//
// On non-macOS hosts or hosts where Claude Code isn't installed, the
// `security` shell-out fails silently and these rows render as MISSING.
// (Ralph 2026-05-22 — "you even know where the keys are.")
interface KeychainSourceSpec {
  id: string
  name: string
  service: string          // -s argument
  field: string            // dot-path into the JSON payload
  format: string
  note?: string
  oauth?: boolean
  hint?: string            // small hint shown next to "Keychain · read-only"
}

const KEYCHAIN_SOURCES: KeychainSourceSpec[] = [
  {
    id: 'claude-keychain-access',
    name: 'Claude Code — Access Token (Keychain)',
    service: 'Claude Code-credentials',
    field: 'claudeAiOauth.accessToken',
    format: 'sk-ant-oat01-…',
    note: 'macOS Keychain. Written by `claude login`. Subscription / OAuth path.',
    oauth: true,
    hint: 'Keychain · read-only',
  },
  {
    id: 'claude-keychain-refresh',
    name: 'Claude Code — Refresh Token (Keychain)',
    service: 'Claude Code-credentials',
    field: 'claudeAiOauth.refreshToken',
    format: 'sk-ant-ort01-…',
    note: 'Refresh token paired with the access token. Used to renew on expiry.',
    oauth: true,
    hint: 'Keychain · read-only',
  },
]

function readKeychainJson(service: string): Record<string, any> | null {
  try {
    const account = (() => {
      try { return userInfo().username } catch { return process.env.USER || '' }
    })()
    const args = account
      ? ['find-generic-password', '-s', service, '-a', account, '-w']
      : ['find-generic-password', '-s', service, '-w']
    // execFileSync would be safer; using execSync with shell-escaped args
    // to keep the dependency surface zero.
    const cmd = 'security ' + args
      .map((a) => (/[^\w/.-]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a))
      .join(' ')
    const raw = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim()
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function readField(obj: any, path: string): string {
  if (!obj) return ''
  const parts = path.split('.')
  let cur: any = obj
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part]
    else return ''
  }
  return typeof cur === 'string' ? cur : (cur != null ? String(cur) : '')
}

const ENV_FILE = join(process.cwd(), '.env.local')
const MANAGED_KEYS = new Set(PROVIDERS.map((p) => p.envVar))

function mask(value: string | undefined): string | null {
  if (!value) return null
  if (value.length <= 8) return '••••••••'
  return value.slice(0, 4) + '••••' + value.slice(-4)
}

// Parse a KEY=VALUE-per-line file (.env.local / .api-key style).
function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const raw = readFileSync(filePath, 'utf-8')
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

// Both .env.local and .api-key store ANTHROPIC_API_KEY / other secrets.
// .env.local wins on conflict (it's the canonical Next.js path); .api-key
// is the legacy local-dev shim that app/api/chat/route.ts:47 reads as a
// fallback when process.env is empty. Both are merged so the UI shows
// values from either source. (Ralph 2026-05-22: "anthropic API key is
// here: app/api/chat/route.ts:47" — pointing at the .api-key fallback.)
const API_KEY_FILE = join(process.cwd(), '.api-key')
function readEnvLocal(): Record<string, string> {
  return { ...readEnvFile(API_KEY_FILE), ...readEnvFile(ENV_FILE) }
}

export async function GET() {
  const env = readEnvLocal()

  // Env-backed providers (writable, source: 'env')
  const envProviders = PROVIDERS.map((p) => {
    const raw = env[p.envVar] || process.env[p.envVar] || ''
    return {
      ...p,
      source: 'env' as const,
      present: Boolean(raw),
      masked: mask(raw),
      value: raw,
    }
  })

  // Keychain-backed credentials (read-only, source: 'keychain')
  // One `security` call per unique service, cached so we don't shell out
  // N times when several rows share a Keychain entry.
  const keychainCache = new Map<string, any>()
  const keychainProviders = KEYCHAIN_SOURCES.map((k) => {
    let payload = keychainCache.get(k.service)
    if (payload === undefined) {
      payload = readKeychainJson(k.service)
      keychainCache.set(k.service, payload)
    }
    const raw = readField(payload, k.field)
    return {
      id: k.id,
      name: k.name,
      envVar: `${k.service}:${k.field}`,        // synthetic id for grouping; not writable
      source: 'keychain' as const,
      format: k.format,
      note: k.note,
      oauth: k.oauth,
      hint: k.hint,
      present: Boolean(raw),
      masked: mask(raw),
      value: raw,
    }
  })

  return NextResponse.json({
    providers: [...envProviders, ...keychainProviders],
  })
}

interface PostBody {
  updates: Array<{ envVar: string; value: string }>
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PostBody
    if (!Array.isArray(body.updates)) {
      return NextResponse.json({ error: 'updates[] required' }, { status: 400 })
    }

    // Validate every key is in the whitelist before touching the file.
    for (const u of body.updates) {
      if (!MANAGED_KEYS.has(u.envVar)) {
        return NextResponse.json(
          { error: `not a managed env var: ${u.envVar}` },
          { status: 403 },
        )
      }
    }

    // Read existing file (or start fresh) and merge.
    const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf-8') : ''
    const lines = existing.split(/\r?\n/)
    const seenKeys = new Set<string>()
    const updateMap = new Map(body.updates.map((u) => [u.envVar, u.value]))

    // Rewrite matching lines in place; preserve comments + foreign keys.
    const next = lines.map((line) => {
      if (!line || line.startsWith('#')) return line
      const eq = line.indexOf('=')
      if (eq < 0) return line
      const key = line.slice(0, eq).trim()
      if (updateMap.has(key)) {
        seenKeys.add(key)
        const v = updateMap.get(key)!
        // Quote if value contains whitespace or # — otherwise bare.
        const needQuote = /[\s#]/.test(v)
        return `${key}=${needQuote ? `"${v.replace(/"/g, '\\"')}"` : v}`
      }
      return line
    })

    // Append managed keys that weren't already present.
    for (const u of body.updates) {
      if (!seenKeys.has(u.envVar) && u.value !== '') {
        const needQuote = /[\s#]/.test(u.value)
        next.push(`${u.envVar}=${needQuote ? `"${u.value.replace(/"/g, '\\"')}"` : u.value}`)
      }
    }

    // Trailing newline.
    let serialized = next.join('\n')
    if (!serialized.endsWith('\n')) serialized += '\n'

    writeFileSync(ENV_FILE, serialized, 'utf-8')

    return NextResponse.json({
      status: 'written',
      keys: body.updates.map((u) => u.envVar),
      restartRequired: true,
    })
  } catch (err) {
    console.error('[admin/settings/keys] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
