// ============================================================================
// POST /api/admin/crm/activities/wa-outbound — send WhatsApp via runtime
// WP-CRM-F19 (Ralph 2026-05-25)
//
// Called by the "Send WhatsApp" button in the lead detail UI. We:
//   1. Look up the prospect, normalize phone
//   2. Call the in-process WhatsApp runtime to send (no HTTP hop anymore)
//   3. Runtime returns wa_message_id from Baileys's ACK
//   4. Append a `WhatsApp Out` activity row with wa_status='sent'
//   5. Delivery + read receipts later flow through the runtime's
//      messages.update handler which calls updateWaStatusByMessageId
//      directly — no HTTP, no /wa-status round-trip.
//
// Fallback: if the runtime is not connected (no creds or socket down),
// return 502 — the UI degrades to the F13 wa.me launcher.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { readSheet, appendActivity, normalizeWhatsAppNumber } from '@/lib/crm-store'
import { getRuntime } from '@/lib/wa-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface OutboundPayload {
  prospect_id?: string
  body?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as OutboundPayload
    const prospect_id = body.prospect_id?.trim()
    const text = (body.body ?? '').trim()
    if (!prospect_id || !text) {
      return NextResponse.json({ error: 'prospect_id and body required' }, { status: 400 })
    }

    const prospects = readSheet()
    const p = prospects.find(x => x.id === prospect_id)
    if (!p) {
      return NextResponse.json({ error: `prospect ${prospect_id} not found` }, { status: 404 })
    }
    const phone = normalizeWhatsAppNumber(p.phone)
    if (!phone) {
      return NextResponse.json({ error: `prospect ${prospect_id} has no usable phone` }, { status: 400 })
    }

    const sendResult = await getRuntime().sendMessage(phone, text)
    if (!sendResult.ok) {
      return NextResponse.json(
        { error: `send failed: ${sendResult.error || 'unknown'}` },
        { status: 502 },
      )
    }

    const activity = await appendActivity({
      prospect_id,
      type: 'WhatsApp Out',
      icon: 'message-circle',
      color: '#25D366',
      notes: text,
      wa_message_id: sendResult.wa_message_id || '',
      wa_status: 'sent',
    })

    return NextResponse.json({
      ok: true,
      prospect_id,
      activity_id: activity.id,
      wa_message_id: sendResult.wa_message_id,
    })
  } catch (err) {
    console.error('[wa-outbound] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
