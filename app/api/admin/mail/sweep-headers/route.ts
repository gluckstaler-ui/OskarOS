// ==========================================
// POSTMASTER · sweep email headers into the cache (Filippo 2026-07-13)
// POST /api/admin/mail/sweep-headers
//   → { folders: [{ folder, added }] }
//
// Initial backfill downloads envelope + classification signals for every UID
// on the server (INBOX and Sent). Subsequent calls are incremental — UIDs
// already in the cache are skipped. Bodies are NEVER stored.
// ==========================================

import { NextResponse } from 'next/server'
import { sweepEmailHeaders } from '@/lib/mail-eyes'

export async function POST() {
  try {
    const folders = await sweepEmailHeaders()
    return NextResponse.json({ folders })
  } catch (err) {
    return NextResponse.json({ folders: [], error: String(err) }, { status: 500 })
  }
}
