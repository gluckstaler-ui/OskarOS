// ============================================================================
// POST /api/site/config
//   read  { sessionId }            → { ok, site }
//   write { sessionId, site }      → { ok, site }
//
// Thin wrapper over readSessionConfig/writeSessionConfig (spec §3, §8). NO new
// config file — the `site` block lives in the one canonical
// public/<id>/logs/_session-config.json. Credentials (plaintext password) live
// here by Ralph's explicit call (spec §10.2).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { readSessionConfig, writeSessionConfig, type SiteConfig } from '@/lib/session-config'
import { resolveFileDest } from '@/lib/site/connect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_CACHE = { 'Cache-Control': 'no-store' }

// Port arrives as a string from the form input; coerce to number. (The UI and
// server share the `method` field — no rename layer.)
//
// CRED-SAFE MERGE (Ralph 2026-06-24 — the 530 bug): the form sends an EMPTY
// password whenever it hasn't loaded the stored secret (DEFAULT_SITE.password
// is ''), and omits the server-only fields (secure / defaultDirection /
// ignore). A wholesale replace therefore wiped the credential on every connect
// → 530, and dropped the ignore list. So fold the incoming block over the
// STORED one: a blank host/user/password/docroot keeps the stored value, and
// fields the UI never sends survive.
function normalizeSiteFromUI(raw: Record<string, unknown>, prev?: SiteConfig): SiteConfig {
  const out = { ...raw } as Record<string, unknown>
  if (typeof out.port === 'string') out.port = parseInt(out.port, 10) || 21
  if (!prev) return out as unknown as SiteConfig
  // A blank ('' / null / undefined) incoming value keeps the stored one — never
  // nuke a credential because the form round-tripped empty.
  for (const k of ['host', 'user', 'password', 'docroot', 'destination'] as (keyof SiteConfig)[]) {
    const v = out[k as string]
    if (v === undefined || v === null || v === '') out[k as string] = prev[k]
  }
  // Server-only fields the UI never sends — preserve whatever was stored.
  for (const k of ['method', 'secure', 'defaultDirection', 'ignore'] as (keyof SiteConfig)[]) {
    if (out[k as string] === undefined) out[k as string] = prev[k]
  }
  return out as unknown as SiteConfig
}

// File-mode destination defaults to the derived <home>/<domain>, falling back to
// the user's picked folder when that doesn't resolve — reflect the resolved path
// in what the UI shows so the field can't drift to a stale value.
function withFileDest(site: SiteConfig | undefined): SiteConfig | null {
  if (!site) return null
  if (site.method === 'file' && site.domain) return { ...site, docroot: resolveFileDest(site) }
  return site
}

export async function POST(req: NextRequest) {
  // `site` is raw UI input (sends `mode`, string `port`) — normalizeSiteFromUI
  // folds it into the canonical SiteConfig, so type it loosely here.
  let body: { sessionId?: string; site?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400, headers: NO_CACHE })
  }
  const { sessionId, site } = body
  if (!sessionId || typeof sessionId !== 'string' || sessionId.includes('/') || sessionId.includes('..')) {
    return NextResponse.json({ ok: false, error: 'valid sessionId required' }, { status: 400, headers: NO_CACHE })
  }

  // Write when a `site` block is supplied; otherwise read.
  if (site !== undefined) {
    if (!site || typeof site !== 'object') {
      return NextResponse.json({ ok: false, error: 'site must be an object' }, { status: 400, headers: NO_CACHE })
    }
    // UI sends `mode`; server schema uses `method`. Translate, coerce port, and
    // fold over the stored block so a blank/partial form write can't wipe creds.
    const existing = readSessionConfig(sessionId).site
    const normalized = normalizeSiteFromUI(site, existing)
    const merged = writeSessionConfig(sessionId, { site: normalized })
    return NextResponse.json({ ok: true, site: withFileDest(merged.site) }, { headers: NO_CACHE })
  }

  const cfg = readSessionConfig(sessionId)
  return NextResponse.json({ ok: true, site: withFileDest(cfg.site) }, { headers: NO_CACHE })
}
