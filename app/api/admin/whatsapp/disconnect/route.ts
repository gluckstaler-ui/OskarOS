// ============================================================================
// POST /api/admin/whatsapp/disconnect — log out + clear saved creds
// WP-CRM-F19 (Ralph 2026-05-25)
//
// Triggered by the "Disconnect" button in the Settings → WhatsApp card
// (visible in `connected` state, gated by a confirmation strip). The
// in-process runtime calls sock.logout() to unlink the device on
// WhatsApp's side, then wipes the auth dir so the next pair starts fresh.
// ============================================================================

import { NextResponse } from 'next/server'
import { getRuntime } from '@/lib/wa-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export async function POST() {
  try {
    await getRuntime().disconnect()
    return NextResponse.json({ ok: true }, { headers: NO_CACHE })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: NO_CACHE },
    )
  }
}
