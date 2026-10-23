// ==========================================
// POSTMASTER · Voice — send email from the CRM (PM-2, spec §05)
// POST /api/admin/crm/activities/email-outbound
//   { prospect_id, to, subject, body, in_reply_to?, attachments?: ["media/…"] }
//   → { ok, email_message_id }
//
// Mirrors wa-outbound: gated route sends (WP-111 — the Consular suggests,
// the route sends, the agent never touches the transport). SMTP via
// nodemailer over SSL using the Settings-managed OSKAR_MAIL_* config.
//
// After the send: E-mail Out activity through the event log (thread id
// walked from in_reply_to), the pending suggestion is consumed, and the
// SENT TEXT (plus the suggestion it replaced, if any) is posted into the
// Consular chat fire-and-forget — the agent reads the diff itself; this
// route computes nothing it doesn't have to (the agent is smart).
//
// Attachments are media-relative paths only — resolved and fenced inside
// media/ (client-named files live there; never let a path walk out).
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { basename, join, resolve, sep } from 'path'
import nodemailer from 'nodemailer'
import { renderEmailHtml } from '@/lib/email-html'
import { readMailConfig } from '@/lib/mail-config'
import { appendActivity, deleteSuggestion, readSuggestion } from '@/lib/crm-store'
import { getDb } from '@/lib/crm-boot'
import { callConsularBridge } from '@/lib/consular-bridge-call'

const MEDIA_ROOT = resolve(process.cwd(), 'media')

interface Body {
  prospect_id?: string
  to?: string
  subject?: string
  body?: string
  in_reply_to?: string
  attachments?: string[]
  skip_suggestion?: boolean
}

export async function POST(req: NextRequest) {
  let b: Body
  try { b = (await req.json()) as Body } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const prospectId = String(b.prospect_id || '').trim()
  const to = String(b.to || '').trim()
  const text = String(b.body || '').trim()
  const subject = String(b.subject || '').trim()
  if (!prospectId || !to || !text) {
    return NextResponse.json({ error: 'prospect_id, to and body are required' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: `not an email address: ${to}` }, { status: 400 })
  }

  const prospect = getDb().prepare(`SELECT id, company FROM prospects WHERE id = ?`).get(prospectId) as
    | { id: string; company: string } | undefined
  if (!prospect) return NextResponse.json({ error: `unknown prospect: ${prospectId}` }, { status: 404 })

  const cfg = readMailConfig()
  if (!cfg.configured) {
    return NextResponse.json({ error: 'mail not configured (Settings → Email)' }, { status: 503 })
  }

  // Attachments: media-relative, fenced inside media/ — reject escapes loudly.
  const attachPaths: string[] = []
  for (const rel of b.attachments || []) {
    const abs = resolve(process.cwd(), String(rel))
    if (abs !== MEDIA_ROOT && !abs.startsWith(MEDIA_ROOT + sep)) {
      return NextResponse.json({ error: `attachment outside media/: ${rel}` }, { status: 400 })
    }
    if (!existsSync(abs)) {
      return NextResponse.json({ error: `attachment not found: ${rel}` }, { status: 400 })
    }
    attachPaths.push(abs)
  }

  const transport = nodemailer.createTransport({
    host: cfg.smtpHost, port: cfg.smtpPort, secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15_000, greetingTimeout: 15_000,
  })

  let messageId: string
  try {
    const info = await transport.sendMail({
      from: cfg.user,
      to,
      subject,
      text,
      // HTML twin: **bold**, [label](url) and bare links become real markup;
      // plain-text part stays as authored (Consular 2026-08-15).
      html: renderEmailHtml(text),
      inReplyTo: b.in_reply_to || undefined,
      references: b.in_reply_to || undefined,
      attachments: attachPaths.map((p) => ({ filename: basename(p), path: p })),
    })
    messageId = info.messageId
  } catch (err) {
    // The composed text is the caller's to keep — a failed send loses nothing.
    return NextResponse.json({ error: `SMTP send failed: ${String((err as Error).message || err)}` }, { status: 502 })
  } finally {
    transport.close()
  }

  // Log-first record of the send. Thread id: the reply target, else this mail
  // roots its own thread. appendActivity dedups by Message-ID — the Sent-folder
  // sweep will meet this same id later and file nothing twice.
  const relAttachments = attachPaths.map((p) => p.slice(process.cwd().length + 1))
  await appendActivity({
    prospect_id: prospectId,
    type: 'E-mail Out',
    subject,
    // Filippo 2026-08-18: store the FULL body, no truncation — same rule as the
    // inbound sweep (lib/mail-eyes.ts). The 400-char slice cut mails mid-word
    // in the history feed, and `\s+ → ' '` flattened every paragraph into one
    // run. Whitespace-normalize only: collapse runs of spaces/tabs, cap blank
    // lines at one, keep the line breaks Filippo actually wrote.
    notes: text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() + (relAttachments.length ? ` · 📎 ${relAttachments.map((r) => basename(r)).join(', ')}` : ''),
    user_id: 'Filippo',
    email_message_id: messageId,
    email_thread_id: b.in_reply_to || messageId,
    media_path: relAttachments[0] || '',
  })

  // Consume the pending suggestion (if any) and hand the Consular both texts —
  // it reads the diff; the lesson is its to draw. Fire-and-forget: the send
  // must not wait on a bridge turn, and a chat failure must not fail the send.
  // skip_suggestion: a scheduled send fires long after it was composed — the
  // pending suggestion at fire time may be a newer, unrelated draft, and
  // consuming it here would bulldoze work in progress (scheduled-sends ticker,
  // Ralph 2026-08-22).
  const suggestion = b.skip_suggestion ? null : readSuggestion(prospectId, 'email')
  if (suggestion) await deleteSuggestion(prospectId, 'email', 'Filippo')
  const chatLines = [
    `[OSKAR-SYSTEM EMAIL-SENT] prospect=${prospectId} (${prospect.company}) to=${to}`,
    `subject: ${subject || '(none)'}`,
    relAttachments.length ? `attachments: ${relAttachments.join(', ')}` : null,
    '--- sent ---',
    text,
    suggestion ? '--- your suggestion (now consumed) ---' : null,
    suggestion ? suggestion.body : null,
  ].filter((l): l is string => l !== null).join('\n')
  void callConsularBridge(chatLines).catch((err) =>
    console.warn('[email-outbound] Consular chat post failed (send already succeeded):', err))

  return NextResponse.json({ ok: true, email_message_id: messageId })
}
