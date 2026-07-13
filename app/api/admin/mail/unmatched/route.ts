// ==========================================
// POSTMASTER · Inbox / Updates / Others (Filippo 2026-07-13)
// GET /api/admin/mail/unmatched
//   → { unmatched: [{ path: "INBOX:<uid>", from, subject, date, bucket }] }
//
// Reads from the email_headers cache — pure SQL, no IMAP round-trip. Headers
// are downloaded once by the sweep; queries stay instant. Bodies fetched live
// per click via /api/admin/mail/message.
// ==========================================

import { NextResponse } from 'next/server'
import { listUnmatchedFromCache } from '@/lib/mail-eyes'

export async function GET() {
  try {
    return NextResponse.json({ unmatched: listUnmatchedFromCache() })
  } catch (err) {
    return NextResponse.json({ unmatched: [], error: String(err) }, { status: 500 })
  }
}
