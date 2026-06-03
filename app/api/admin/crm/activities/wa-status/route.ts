// ============================================================================
// POST /api/admin/crm/activities/wa-status — update WhatsApp activity status
// WP-CRM-F19 (Ralph 2026-05-24)
//
// Called by oskar-wa-bridge when Baileys emits `messages.update` events
// (delivery receipts, read receipts). The bridge maps the receipt's
// `key.id` to wa_message_id and the receipt level to a status string:
//   - 'sent'      → initial state set by wa-outbound (single grey ✓)
//   - 'delivered' → recipient's WhatsApp received it (grey ✓✓)
//   - 'read'      → recipient opened the chat (blue ✓✓)
//   - 'failed'    → send failed permanently
//
// Status downgrades are ignored (handled in updateWaStatusByMessageId).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { updateWaStatusByMessageId } from '@/lib/crm-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StatusPayload {
  wa_message_id?: string
  status?: 'sent' | 'delivered' | 'read' | 'failed'
}

const VALID = new Set(['sent', 'delivered', 'read', 'failed'])

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as StatusPayload
    const wa_message_id = (body.wa_message_id ?? '').trim()
    const status = (body.status ?? '').trim()
    if (!wa_message_id || !VALID.has(status)) {
      return NextResponse.json({ error: 'wa_message_id + valid status required' }, { status: 400 })
    }
    const updated = await updateWaStatusByMessageId(wa_message_id, status)
    return NextResponse.json({ ok: true, updated_id: updated?.id ?? null })
  } catch (err) {
    console.error('[wa-status] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
