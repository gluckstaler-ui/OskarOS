// ============================================================================
// /api/admin/crm/scheduled — scheduled WhatsApp/email sends (Ralph 2026-08-22)
//
//   GET    ?prospect_id=&channel=   → { scheduled: ScheduledSend[] }
//   POST   { prospect_id, channel, to?, subject?, body, in_reply_to?, send_at }
//                                   → { ok, scheduled }
//   DELETE { id }                   → { ok }   (cancel pending / dismiss failed)
//
// Rows are node-local (never synced) — the ticker in lib/scheduled-sends
// fires them through the existing gated outbound routes.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { cancelScheduledSend, createScheduledSend, listScheduledSends } from '@/lib/scheduled-sends'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const prospect_id = req.nextUrl.searchParams.get('prospect_id') || undefined
  const channel = req.nextUrl.searchParams.get('channel') || undefined
  return NextResponse.json({ scheduled: listScheduledSends(prospect_id, channel) })
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>
  try { b = (await req.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const prospect_id = String(b.prospect_id || '').trim()
  const channel = String(b.channel || '')
  const body = String(b.body || '').trim()
  const send_at_raw = String(b.send_at || '')
  if (!prospect_id || !body || (channel !== 'email' && channel !== 'whatsapp')) {
    return NextResponse.json({ error: 'prospect_id, channel (email|whatsapp) and body required' }, { status: 400 })
  }
  const sendAt = new Date(send_at_raw)
  if (Number.isNaN(sendAt.getTime())) {
    return NextResponse.json({ error: `send_at is not a date: ${send_at_raw}` }, { status: 400 })
  }
  if (sendAt.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: 'send_at liegt in der Vergangenheit' }, { status: 400 })
  }
  const to = String(b.to || '').trim()
  if (channel === 'email' && !to) {
    return NextResponse.json({ error: 'Empfänger-Adresse fehlt' }, { status: 400 })
  }
  const scheduled = createScheduledSend({
    prospect_id,
    channel,
    to_addr: to || undefined,
    subject: String(b.subject || '').trim() || undefined,
    body,
    in_reply_to: String(b.in_reply_to || '').trim() || undefined,
    attachments: Array.isArray(b.attachments) ? (b.attachments as unknown[]).map(String) : undefined,
    send_at: sendAt.toISOString(),
  })
  return NextResponse.json({ ok: true, scheduled })
}

export async function DELETE(req: NextRequest) {
  let b: { id?: number }
  try { b = (await req.json()) as { id?: number } } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const id = Number(b.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const result = await cancelScheduledSend(id)
  return result.ok
    ? NextResponse.json({ ok: true, restored: result.restored ?? null, restored_to: result.restored_to ?? null })
    : NextResponse.json({ error: 'not found or currently sending' }, { status: 409 })
}
