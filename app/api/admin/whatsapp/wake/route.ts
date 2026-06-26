// ============================================================================
// POST /api/admin/whatsapp/wake — manual silent reconnect (no re-pair).
//
// Companion to the single 5-min semi-automatic reconnect loop in
// lib/wa-runtime. Forces a reconnect on demand — using the existing creds,
// no QR, no wipe — instead of waiting for the next cycle.
//
// NOTE: named "wake", not "connect" — LiteSpeed/cPanel WAF blocks any path
// segment containing "connect" at the edge (CONNECT-method / proxy-abuse
// rule) with a 403 before it ever reaches Next. Ralph 2026-06-19.
// ============================================================================

import { NextResponse } from 'next/server'
import { getRuntime } from '@/lib/wa-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export async function POST() {
  try {
    // Don't await — connection.update drives the state; the UI's /status poll
    // picks up the result. start() (no forceQr) is a silent reconnect.
    void getRuntime().start()
    return NextResponse.json({ ok: true }, { headers: NO_CACHE })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: NO_CACHE },
    )
  }
}
