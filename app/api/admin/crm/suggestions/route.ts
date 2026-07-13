// ==========================================
// POSTMASTER · Consular reply drafts read (PM-4/PM-5 support, spec §11)
// GET /api/admin/crm/suggestions[?channel=email|whatsapp]
//   → { suggestions: [{ prospect_id, channel, body, subject, in_reply_to, created_at }] }
//
// The inline compose fields (island + client card) read this to prefill the
// Consular's pending draft. Writes happen only through suggest_reply →
// upsertSuggestion (event-logged); this route is read-only.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readSuggestions } from '@/lib/crm-store'

export async function GET(req: NextRequest) {
  const ch = new URL(req.url).searchParams.get('channel')
  const channel = ch === 'email' || ch === 'whatsapp' ? ch : undefined
  try {
    return NextResponse.json({ suggestions: readSuggestions(channel) })
  } catch (err) {
    return NextResponse.json({ suggestions: [], error: String(err) }, { status: 500 })
  }
}
