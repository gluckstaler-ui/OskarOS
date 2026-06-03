// ============================================================================
// GET /api/admin/whatsapp/status — WhatsApp runtime health + pair state
// WP-CRM-F19 (Ralph 2026-05-25)
//
// Discriminated-union endpoint that the Settings → WhatsApp card polls.
// Folds two independent checks into one response:
//   1. Is the npm package installed?            → `not-installed`
//   2. What does the in-process runtime say?    → forwarded as-is
//
// The version string is pulled once per poll from
// `node_modules/@whiskeysockets/baileys/package.json` so the UI can show
// `Baileys X.Y.Z` in every state except `not-installed`.
//
// Pre-merge (oskar-wa-bridge.mjs era), this route also had to check whether
// a separate subprocess was running on :7001. That check is gone — the
// runtime is in our own process, so "installed" implies "running."
// ============================================================================

import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getRuntime } from '@/lib/wa-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

function readBaileysVersion(): string | null {
  const pkgPath = join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const version = readBaileysVersion()
  if (!version) {
    return NextResponse.json({ status: 'not-installed' }, { headers: NO_CACHE })
  }
  const payload = getRuntime().getStatus()
  return NextResponse.json({ ...payload, version }, { headers: NO_CACHE })
}
