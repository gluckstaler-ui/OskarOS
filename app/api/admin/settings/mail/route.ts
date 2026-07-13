// ==========================================
// Admin · Settings · Email account endpoint (POSTMASTER PM-7, spec §10)
// GET  /api/admin/settings/mail → current config (password masked) + presence
// POST /api/admin/settings/mail → write mail credentials to .env.local
//
// Same line-aware .env.local writer as settings/keys/route.ts: preserves
// comments + non-managed keys, rewrites managed lines in place, appends
// missing ones. Whitelisted vars only. process.env is frozen at boot, so
// the POST response carries `restartRequired: true` (the Eyes sweep reads
// these at start — PM-1; until then the flag drives the UI snackbar only).
//
// Connection testing lives at POST /api/admin/settings/mail/test.
// Shared config reader: lib/mail-config.ts (route files may only export
// HTTP handlers — helpers live in lib).
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { getDb } from '@/lib/crm-boot'
import { ENV_FILE, MAIL_ENV_VARS, readMailConfig } from '@/lib/mail-config'

const MANAGED = new Set<string>(MAIL_ENV_VARS)

function mask(value: string): string | null {
  if (!value) return null
  if (value.length <= 8) return '••••••••'
  return value.slice(0, 2) + '••••••••' + value.slice(-2)
}

export async function GET() {
  const cfg = readMailConfig()

  // Corpus = every outbound mail on the record (Sent-ingest + CRM sends).
  // Real count from the projection; the card footer's "N in corpus" line.
  let corpusCount = 0
  try {
    corpusCount = (getDb()
      .prepare(`SELECT COUNT(*) AS n FROM activities WHERE type = 'E-mail Out' AND soft_deleted = 0`)
      .get() as { n: number }).n
  } catch { /* projection not booted yet — footer shows 0 */ }

  return NextResponse.json({
    config: {
      OSKAR_MAIL_USER: cfg.user,
      OSKAR_MAIL_PASS: '',                     // never ship the plaintext to the browser
      OSKAR_MAIL_IMAP_HOST: cfg.imapHost,
      OSKAR_MAIL_IMAP_PORT: String(cfg.imapPort),
      OSKAR_MAIL_SMTP_HOST: cfg.smtpHost,
      OSKAR_MAIL_SMTP_PORT: String(cfg.smtpPort),
      OSKAR_MAIL_SWEEP_SEC: String(cfg.sweepSec),
    },
    passMasked: mask(cfg.pass),
    passPresent: Boolean(cfg.pass),
    configured: cfg.configured,
    corpusCount,
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
    for (const u of body.updates) {
      if (!MANAGED.has(u.envVar)) {
        return NextResponse.json({ error: `not a managed env var: ${u.envVar}` }, { status: 403 })
      }
      if (/PORT|SWEEP_SEC/.test(u.envVar) && u.value !== '' && !/^\d+$/.test(u.value)) {
        return NextResponse.json({ error: `${u.envVar} must be numeric` }, { status: 400 })
      }
    }

    const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf-8') : ''
    const lines = existing.split(/\r?\n/)
    const seen = new Set<string>()
    const updateMap = new Map(body.updates.map((u) => [u.envVar, u.value]))

    const next = lines.map((line) => {
      if (!line || line.startsWith('#')) return line
      const eq = line.indexOf('=')
      if (eq < 0) return line
      const key = line.slice(0, eq).trim()
      if (updateMap.has(key)) {
        seen.add(key)
        const v = updateMap.get(key)!
        const needQuote = /[\s#]/.test(v)
        return `${key}=${needQuote ? `"${v.replace(/"/g, '\\"')}"` : v}`
      }
      return line
    })
    for (const u of body.updates) {
      if (!seen.has(u.envVar) && u.value !== '') {
        const needQuote = /[\s#]/.test(u.value)
        next.push(`${u.envVar}=${needQuote ? `"${u.value.replace(/"/g, '\\"')}"` : u.value}`)
      }
    }
    let serialized = next.join('\n')
    if (!serialized.endsWith('\n')) serialized += '\n'
    writeFileSync(ENV_FILE, serialized, 'utf-8')

    return NextResponse.json({
      status: 'written',
      keys: body.updates.map((u) => u.envVar),
      restartRequired: true,
    })
  } catch (err) {
    console.error('[admin/settings/mail] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
