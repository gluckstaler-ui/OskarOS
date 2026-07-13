import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
// nodemailer ships no bundled TypeScript declarations; import it untyped so the
// strict production build doesn't fail type-checking (we only use a couple of methods).
// @ts-ignore
import nodemailer from 'nodemailer'

/*
 * Contact handler for the Barbazza brand site (public/2026-05-31-weingut-barbazza).
 * The static page POSTs its form here; we route by category to the right family
 * member and send via authenticated SMTP as postmaster@barbazza.wine.
 *
 * The recipient is resolved HERE, server-side, from a category key — the browser
 * never carries a To: address, so this can't be abused as an open relay.
 *
 * SMTP credentials are read from `.barbazza-mail.env` at the project root
 * (gitignored, outside the web root), or from real environment variables in
 * production. They never reach the browser.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// category key -> recipient (server-side routing)
// Ralph 2026-07-13: all four now go to Marin. Mladen's gmail
// (mladentomasicbarbaca@gmail.com) went dark → tasting/shop requests were
// bouncing. Marin's barbazza.wine mailbox is confirmed delivering; he triages
// tastings from there. The subject/body still carry the category label.
const ROUTES: Record<string, string> = {
  'wine-tasting': 'marin@barbazza.wine', // → Marin (was Mladen's dead gmail)
  'wine-shop': 'marin@barbazza.wine',    // → Marin (was Mladen's dead gmail)
  'feedback': 'marin@barbazza.wine',     // Marin
  'general': 'marin@barbazza.wine',      // Marin
}
const LABELS: Record<string, string> = {
  'wine-tasting': 'Wine-Tasting',
  'wine-shop': 'Wine-Shop',
  'feedback': 'Feedback',
  'general': 'General Inquiry',
}

async function loadCfg() {
  const fromFile: Record<string, string> = {}
  try {
    const txt = await readFile(path.join(process.cwd(), '.barbazza-mail.env'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) fromFile[m[1]] = m[2]
    }
  } catch { /* fall back to env */ }
  const pick = (k: string) => fromFile[k] ?? process.env[k]
  return {
    host: pick('SMTP_HOST'),
    user: pick('SMTP_USER'),
    pass: pick('SMTP_PASS'),
    from: pick('MAIL_FROM') ?? pick('SMTP_USER'),
    bcc: pick('MAIL_ARCHIVE_BCC') || undefined,
    ports: pick('SMTP_PORTS') ?? '465:true,587:false,26:false',
  }
}

let cachedTx: any = null
async function getTransport(c: Awaited<ReturnType<typeof loadCfg>>) {
  if (cachedTx) return cachedTx
  const ports = c.ports!.split(',').map((s) => {
    const [p, sec] = s.split(':')
    return { port: Number(p), secure: sec === 'true' }
  })
  let lastErr: unknown
  for (const { port, secure } of ports) {
    for (const strict of [true, false]) {   // cPanel presents a hostname-mismatched cert; retry unpinned
      const t = nodemailer.createTransport({
        host: c.host, port, secure,
        auth: { user: c.user, pass: c.pass },
        requireTLS: !secure,
        tls: { rejectUnauthorized: strict, servername: c.host, minVersion: 'TLSv1.2' },
        connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 20000,
      })
      try { await t.verify(); cachedTx = t; return t } catch (e) { lastErr = e }
    }
  }
  throw lastErr ?? new Error('No SMTP submission port was reachable.')
}

const stripCRLF = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request.' }, { status: 400 })
  }
  const get = (k: string) => (form.get(k) ?? '').toString().trim()

  // Honeypot: bots fill the hidden "company" field. Pretend success, send nothing.
  if (get('company')) return NextResponse.json({ ok: true })

  let category = get('category')
  if (!ROUTES[category]) category = 'general'

  const name = stripCRLF(get('name'))
  const email = get('email').replace(/[\r\n\s]+/g, '')
  const message = get('message')

  if (!name || !email || !message) {
    return NextResponse.json({ ok: false, error: 'Please fill in your name, email and message.' }, { status: 400 })
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'That email address looks invalid.' }, { status: 400 })
  }

  const to = ROUTES[category]
  const label = LABELS[category]
  const text =
    'New message from the Barbazza website\n' +
    '----------------------------------------\n' +
    `Subject:  ${label}\n` +
    `Name:     ${name}\n` +
    `Email:    ${email}\n` +
    '----------------------------------------\n\n' +
    `${message}\n`

  try {
    const c = await loadCfg()
    if (!c.host || !c.user || !c.pass) throw new Error('SMTP credentials are not configured')
    const t = await getTransport(c)
    const info = await t.sendMail({
      from: `Barbazza Website <${c.from}>`,
      to,
      bcc: c.bcc,
      replyTo: `${name} <${email}>`,
      subject: `Barbazza — ${label} — ${name}`,
      text,
    })
    console.log('[barbazza-contact] sent', info.messageId, '->', to, '| accepted', JSON.stringify(info.accepted), '| rejected', JSON.stringify(info.rejected))
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[barbazza-contact] send failed:', e)
    return NextResponse.json({ ok: false, error: 'The server could not send the message right now.' }, { status: 500 })
  }
}
