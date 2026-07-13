import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
// nodemailer ships no bundled TypeScript declarations; import it untyped so the
// strict production build doesn't fail type-checking (we only use a couple of methods).
// @ts-ignore
import nodemailer from 'nodemailer'

/*
 * Contact handler for the Bureau Paradiso site (public/2026-07-06-bureau-paradiso/FINAL).
 * The static page POSTs its Kurzformular here; we send via authenticated SMTP to the
 * fixed recipient hello@paradiso.dev. The recipient lives HERE, server-side —
 * the browser never carries a To: address, so this can't be an open relay.
 *
 * Same project pattern as app/api/silke-contact and app/api/barbazza-contact
 * (Node + nodemailer — NO PHP). SMTP credentials come from `.paradiso-mail.env`
 * at the project root (gitignored, outside the web root) or real env vars in
 * production. They never reach the browser.
 *
 * Expected fields (FormData): message (or nachricht) + email. Honeypot: company.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RECIPIENT = 'hello@paradiso.dev'   // fixed, server-side — never from the browser

async function loadCfg() {
  const fromFile: Record<string, string> = {}
  try {
    const txt = await readFile(path.join(process.cwd(), '.paradiso-mail.env'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) fromFile[m[1]] = m[2]
    }
  } catch { /* fall back to env */ }
  const pick = (k: string) => fromFile[k] ?? process.env[`PARADISO_${k}`] ?? process.env[k]
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
  const ports = c.ports!.split(',').map((seg) => {
    const [p, sec] = seg.split(':')
    return { port: Number(p), secure: sec === 'true' }
  })
  let lastErr: unknown
  for (const { port, secure } of ports) {
    for (const strict of [true, false]) {   // some hosts present a hostname-mismatched cert; retry unpinned
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

  const message = get('message') || get('nachricht')
  const email = stripCRLF(get('email')).replace(/\s+/g, '')
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

  if (!message || !email) {
    return NextResponse.json({ ok: false, error: 'Bitte Nachricht und E-Mail-Adresse ausfüllen.' }, { status: 400 })
  }
  if (!emailRe.test(email)) {
    return NextResponse.json({ ok: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, { status: 400 })
  }

  const text =
    'Neue Anfrage über das Kurzformular auf paradiso.dev\n' +
    '----------------------------------------\n' +
    `Absender: ${email}\n` +
    '----------------------------------------\n\n' +
    `${message}\n`

  try {
    const c = await loadCfg()
    if (!c.host || !c.user || !c.pass) throw new Error('SMTP credentials are not configured (.paradiso-mail.env)')
    const t = await getTransport(c)
    const info = await t.sendMail({
      from: `Kurzformular paradiso.dev <${c.from}>`,
      to: RECIPIENT,
      bcc: c.bcc,
      replyTo: email,
      subject: `Anfrage über paradiso.dev — ${email}`,
      text,
    })
    console.log('[paradiso-contact] sent', info.messageId, '->', RECIPIENT, '| accepted', JSON.stringify(info.accepted), '| rejected', JSON.stringify(info.rejected))
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[paradiso-contact] send failed:', e)
    return NextResponse.json({ ok: false, error: 'Die Nachricht konnte gerade nicht gesendet werden.' }, { status: 500 })
  }
}
