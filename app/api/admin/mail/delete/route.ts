// ==========================================
// POSTMASTER · delete a mail on the IMAP server (Filippo 2026-07-13)
// POST /api/admin/mail/delete
//   { id?: "INBOX:<uidValidity>:<uid>" }                — Inbox/Updates/Others row
//   { from?: "addr" }                                    — every mail from sender
//   { messageId?: "rfc-822-id", activityId?: "A0123" }   — client-tab row (looked up by MID)
//   → { deleted: 1 | N }
//
// Delete means DELETE. IMAP move-to-Trash on the server + drop the cached
// header row (+ soft-delete the CRM activity when routed from the client tab).
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { deleteEmail, deleteSender, deleteEmailByMessageId } from '@/lib/mail-eyes'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; from?: string; messageId?: string; activityId?: string }
  try {
    if (body.id) { const r = await deleteEmail(body.id); return NextResponse.json({ deleted: r.deleted ? 1 : 0 }) }
    if (body.messageId || body.activityId) {
      const r = await deleteEmailByMessageId(body.messageId || '', body.activityId)
      return NextResponse.json({ deleted: r.deleted ? 1 : 0 })
    }
    if (body.from) { const r = await deleteSender(body.from); return NextResponse.json({ deleted: r.deleted }) }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
  return NextResponse.json({ error: 'id, from, or messageId required' }, { status: 400 })
}
