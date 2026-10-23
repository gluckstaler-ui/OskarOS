// ==========================================
// POSTMASTER · Consular reply drafts read (PM-4/PM-5 support, spec §11)
// GET /api/admin/crm/suggestions[?channel=email|whatsapp]
//   → { suggestions: [{ prospect_id, channel, body, subject, in_reply_to, created_at }] }
//
// The inline compose fields (island + client card) read this to prefill the
// Consular's pending draft. GET is read-only; POST is the durable draft save
// from the LeadDetail Composer (human or Consular — same table, one truth,
// event-logged via upsertSuggestion). Consular 2026-08-15.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readSuggestions, upsertSuggestion } from '@/lib/crm-store'

export async function GET(req: NextRequest) {
  const ch = new URL(req.url).searchParams.get('channel')
  const channel = ch === 'email' || ch === 'whatsapp' ? ch : undefined
  try {
    return NextResponse.json({ suggestions: readSuggestions(channel) })
  } catch (err) {
    return NextResponse.json({ suggestions: [], error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let b: { prospect_id?: string; channel?: string; body?: string; subject?: string; in_reply_to?: string; actor?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const prospect_id = String(b.prospect_id || '').trim()
  const channel = b.channel === 'whatsapp' ? ('whatsapp' as const) : ('email' as const)
  const body = String(b.body || '').trim()
  if (!prospect_id || !body) return NextResponse.json({ error: 'prospect_id and body required' }, { status: 400 })
  try {
    const row = await upsertSuggestion({
      prospect_id,
      channel,
      body,
      subject: b.subject?.trim() || null,
      in_reply_to: b.in_reply_to?.trim() || null,
      // 'consular' marks agent-authored drafts so the Composer's template
      // menu can resurface them after template experiments (2026-08-15).
      actor: b.actor === 'consular' ? 'consular' : 'filippo',
    })
    return NextResponse.json({ ok: true, suggestion: row })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
