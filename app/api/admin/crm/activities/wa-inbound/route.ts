// ============================================================================
// POST /api/admin/crm/activities/wa-inbound — inbound WhatsApp dispatch (HTTP)
// WP-CRM-F19 (Ralph 2026-05-25, refactored from the standalone-bridge era)
//
// Pre-merge (oskar-wa-bridge.mjs era), this endpoint was the bridge's
// outbound hop into the CRM. Post-merge (lib/wa-runtime.ts), the runtime
// calls `dispatchInboundToCrm` directly — no HTTP between them. This route
// stays alive solely as a wire-format surface for the e2e test suite
// (scripts/test-wa-routing.mjs), which exercises the routing logic without
// needing a live Baileys socket.
//
// All actual logic lives in `lib/wa-inbound-dispatch.ts` so the route and
// the runtime can't drift apart.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { dispatchInboundToCrm, type InboundPayload } from '@/lib/wa-inbound-dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json().catch(() => ({}))) as InboundPayload
    const result = await dispatchInboundToCrm(payload)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[wa-inbound] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
