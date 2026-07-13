// ==========================================
// Admin · Settings · Email connection test (POSTMASTER PM-7, spec §10)
// POST /api/admin/settings/mail/test → { imap: {ok, error?}, smtp: {ok, error?} }
//
// Tests the credentials the card currently SHOWS (body wins over saved
// config, so Filippo can test before saving). IMAP = real login via
// imapflow; SMTP = nodemailer verify (connect + EHLO + auth). Both over
// SSL, both bounded by a hard timeout so a black-holed host can't hang
// the card — a timeout reports as an error, never as silence.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { readMailConfig } from '@/lib/mail-config'

const TIMEOUT_MS = 10_000

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
    ),
  ])
}

async function testImap(host: string, port: number, user: string, pass: string) {
  const client = new ImapFlow({
    host, port, secure: true,
    auth: { user, pass },
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
  })
  try {
    await withTimeout(client.connect(), 'IMAP')
    await client.logout().catch(() => client.close())
    return { ok: true as const }
  } catch (err) {
    try { client.close() } catch { /* already closed */ }
    return { ok: false as const, error: String((err as Error).message || err) }
  }
}

async function testSmtp(host: string, port: number, user: string, pass: string) {
  const transport = nodemailer.createTransport({
    host, port, secure: true,
    auth: { user, pass },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
  })
  try {
    await withTimeout(transport.verify(), 'SMTP')
    return { ok: true as const }
  } catch (err) {
    return { ok: false as const, error: String((err as Error).message || err) }
  } finally {
    transport.close()
  }
}

interface TestBody {
  user?: string
  pass?: string
  imapHost?: string
  imapPort?: number | string
  smtpHost?: string
  smtpPort?: number | string
}

export async function POST(req: NextRequest) {
  let body: TestBody = {}
  try { body = (await req.json()) as TestBody } catch { /* empty body → saved config */ }

  const saved = readMailConfig()
  const user = body.user || saved.user
  const pass = body.pass || saved.pass       // card sends blank pass → test the saved one
  const imapHost = body.imapHost || saved.imapHost
  const imapPort = Number(body.imapPort) || saved.imapPort
  const smtpHost = body.smtpHost || saved.smtpHost
  const smtpPort = Number(body.smtpPort) || saved.smtpPort

  if (!user || !pass) {
    return NextResponse.json(
      { imap: { ok: false, error: 'email + password required' }, smtp: { ok: false, error: 'email + password required' } },
      { status: 400 },
    )
  }

  const [imap, smtp] = await Promise.all([
    testImap(imapHost, imapPort, user, pass),
    testSmtp(smtpHost, smtpPort, user, pass),
  ])

  // Spec §10 dot semantics: green = both, amber = SMTP-only failure
  // ("inbound works, outbound will fail"), red = IMAP down.
  const status = imap.ok && smtp.ok ? 'green' : imap.ok ? 'amber' : 'red'
  return NextResponse.json({ imap, smtp, status })
}
