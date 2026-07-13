// ==========================================
// POSTMASTER · read one email body (Filippo 2026-07-13)
// GET /api/admin/mail/message?path=INBOX:<uid>
//   → { from, to, subject, date, text, html, attachments[] }
//
// Bodies are NOT stored for non-client mail. This route opens IMAP, fetches
// the raw source for one UID, parses, returns text + HTML + attachments.
// Inline images (cid:) are inlined as data URIs during parse.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { fetchMailBody } from '@/lib/mail-eyes'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const raw = url.searchParams.get('path') || ''
  if (!raw) return NextResponse.json({ error: 'path required' }, { status: 400 })

  // Expected format: "INBOX:<uid>" (or "Sent:<uid>")
  const m = /^(INBOX|Sent):(\d+)$/.exec(raw)
  if (!m) return NextResponse.json({ error: 'invalid path — expected FOLDER:UID' }, { status: 400 })
  const [, folder, uidStr] = m
  const uid = Number(uidStr)
  if (!Number.isFinite(uid)) return NextResponse.json({ error: 'invalid uid' }, { status: 400 })

  try {
    const body = await fetchMailBody(folder, uid)
    return NextResponse.json(body)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
