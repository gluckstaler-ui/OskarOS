// ============================================================================
// POST /api/admin/whatsapp/pair — wipe creds + start a fresh Baileys socket
// WP-CRM-F19 (Ralph 2026-05-25)
//
// The Settings → WhatsApp card calls this when Filippo clicks
// "Generate QR code". The in-process runtime wipes any existing creds,
// starts a fresh Baileys socket, and emits a new QR via connection.update.
// The QR is then picked up by the next `/status` poll and rendered in the UI.
// ============================================================================

import { NextResponse } from 'next/server'
import { getRuntime } from '@/lib/wa-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export async function POST() {
  try {
    // Don't await — the QR arrives asynchronously via the connection.update
    // event handler. Returning immediately lets the UI start its /status
    // poll right away to pick up the QR data URL.
    void getRuntime().start({ forceQr: true })
    return NextResponse.json({ ok: true }, { headers: NO_CACHE })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: NO_CACHE },
    )
  }
}
