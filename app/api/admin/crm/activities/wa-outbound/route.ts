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
import { basename, resolve as resolvePath, sep } from 'path'
import { existsSync } from 'fs'
import { readSheet, appendActivity, normalizeWhatsAppNumber } from '@/lib/crm-store'
import { getRuntime } from '@/lib/wa-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface OutboundPayload {
  prospect_id?: string
  // Reply to an UNMATCHED sender (no lead yet) by raw phone — used by the
  // unmatched-senders reply box. When present without prospect_id we send to
  // this number and skip the activity log (there's no prospect to attach it
  // to). Ralph 2026-06-15.
  phone?: string
  body?: string
  // Optional document attachment, media-relative path only ("media/…" or
  // relative to media/) — fenced inside media/ exactly like email-outbound.
  // When present, body becomes the caption. Requires the runtime's
  // sendDocument (post-restart method — HMR-pinned singleton, see below).
  // Consular 2026-08-13.
  attachment?: string
  attachment_name?: string
}

const MEDIA_ROOT_WA = resolvePath(process.cwd(), 'media')
const ATTACH_MIME: Record<string, string> = {
  pdf: 'application/pdf', html: 'text/html', txt: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as OutboundPayload
    const prospect_id = body.prospect_id?.trim()
    const rawPhone = body.phone?.trim()
    const text = (body.body ?? '').trim()
    if (!text || (!prospect_id && !rawPhone)) {
      return NextResponse.json({ error: 'body and (prospect_id or phone) required' }, { status: 400 })
    }

    // Resolve the destination number: a known lead's phone, or a raw phone for
    // an unmatched-sender reply.
    let phone: string | null
    if (prospect_id) {
      const p = readSheet().find(x => x.id === prospect_id)
      if (!p) {
        return NextResponse.json({ error: `prospect ${prospect_id} not found` }, { status: 404 })
      }
      phone = normalizeWhatsAppNumber(p.phone)
      if (!phone) {
        return NextResponse.json({ error: `prospect ${prospect_id} has no usable phone` }, { status: 400 })
      }
    } else {
      phone = normalizeWhatsAppNumber(rawPhone!)
      if (!phone) {
        return NextResponse.json({ error: `"${rawPhone}" is not a usable WhatsApp number` }, { status: 400 })
      }
    }

    // Don't fire a WhatsApp at a number with no WhatsApp account (e.g. a plain
    // landline). `false` = verified no-account → refuse; `null` = couldn't
    // verify (bridge down) → fall through and let the send attempt itself fail
    // with its own error. The `typeof` guard tolerates the HMR-pinned runtime
    // singleton (globalThis.__waRuntime survives hot-reloads, so a freshly-added
    // method isn't on the live instance until a server restart). Ralph 2026-06-16.
    const wa = getRuntime()
    const hasWa = typeof wa.checkWhatsApp === 'function' ? await wa.checkWhatsApp(phone) : null
    if (hasWa === false) {
      return NextResponse.json(
        { error: `+${phone} has no WhatsApp account — nothing was sent`, code: 'no_whatsapp' },
        { status: 422 },
      )
    }

    // ── Optional document attachment (Consular 2026-08-13) ──────────────
    // Fence: media-relative only, resolved inside media/ — mirror of the
    // email-outbound fence. Sent via runtime.sendDocument when the live
    // singleton has it (post-restart); otherwise a clear 501, not a silent
    // text-only downgrade.
    const attachRel = String(body.attachment || '').trim()
    let sendResult: { ok: boolean; wa_message_id?: string; error?: string }
    if (attachRel) {
      const rel = attachRel.startsWith('media/') ? attachRel.slice('media/'.length) : attachRel
      const abs = resolvePath(MEDIA_ROOT_WA, rel)
      if (!abs.startsWith(MEDIA_ROOT_WA + sep) || !existsSync(abs)) {
        return NextResponse.json({ error: `attachment outside media/ or missing: ${attachRel}` }, { status: 400 })
      }
      const wa2 = getRuntime()
      if (typeof (wa2 as { sendDocument?: unknown }).sendDocument !== 'function') {
        return NextResponse.json(
          { error: 'document send not available until server restart (runtime singleton is HMR-pinned)', code: 'restart_required' },
          { status: 501 },
        )
      }
      const fileName = String(body.attachment_name || '').trim() || basename(abs)
      const ext = (fileName.split('.').pop() || '').toLowerCase()
      sendResult = await wa2.sendDocument(phone, abs, fileName, ATTACH_MIME[ext] || 'application/octet-stream', text)
    } else {
      sendResult = await getRuntime().sendMessage(phone, text)
    }
    if (!sendResult.ok) {
      return NextResponse.json(
        { error: `send failed: ${sendResult.error || 'unknown'}` },
        { status: 502 },
      )
    }

    // Log a `WhatsApp Out` activity only when there's a prospect to attach it
    // to. An unmatched-sender reply has no lead, so it just sends.
    let activity_id: string | undefined
    if (prospect_id) {
      const attachedName = attachRel ? (String(body.attachment_name || '').trim() || basename(attachRel)) : ''
      const activity = await appendActivity({
        prospect_id,
        type: 'WhatsApp Out',
        icon: 'message-circle',
        color: '#25D366',
        notes: attachRel ? `${text}${text ? '\n' : ''} · 📎 ${attachedName}` : text,
        wa_message_id: sendResult.wa_message_id || '',
        wa_status: 'sent',
        ...(attachRel ? { media_path: attachRel.startsWith('media/') ? attachRel : `media/${attachRel}` } : {}),
      })
      activity_id = activity.id
    }

    return NextResponse.json({
      ok: true,
      prospect_id,
      phone,
      activity_id,
      wa_message_id: sendResult.wa_message_id,
    })
  } catch (err) {
    console.error('[wa-outbound] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
