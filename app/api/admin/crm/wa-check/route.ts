// ============================================================================
// GET /api/admin/crm/wa-check?phone=+41...
//
// Does this phone number have a WhatsApp account? Authoritative — asks WhatsApp
// itself via the in-process runtime's Baileys `onWhatsApp` (NOT a landline vs.
// mobile prefix guess). Lets the UI gate the "Send WhatsApp" affordance and
// flag landlines before anyone tries to message them. Ralph 2026-06-16.
//
//   { phone, hasWhatsApp: true }   → registered on WhatsApp
//   { phone, hasWhatsApp: false }  → no account (e.g. a plain landline)
//   { phone, hasWhatsApp: null }   → couldn't verify (bridge not connected)
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '@/lib/wa-runtime'
import { normalizeWhatsAppNumber } from '@/lib/crm-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('phone') || ''
  const phone = normalizeWhatsAppNumber(raw)
  if (!phone) {
    return NextResponse.json({ error: `"${raw}" is not a usable phone number` }, { status: 400 })
  }
  // `typeof` guard: the runtime singleton is HMR-pinned on globalThis, so a
  // freshly-added method isn't on the live instance until a server restart.
  const wa = getRuntime()
  const hasWhatsApp = typeof wa.checkWhatsApp === 'function' ? await wa.checkWhatsApp(phone) : null
  return NextResponse.json(
    { phone, hasWhatsApp },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
