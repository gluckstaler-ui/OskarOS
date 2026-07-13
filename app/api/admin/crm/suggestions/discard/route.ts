// ==========================================
// POSTMASTER · discard a Consular draft (PM-4/PM-5, spec §06 discard-with-memory)
// POST /api/admin/crm/suggestions/discard { prospect_id, channel }
//   → { ok }
//
// Deletes the pending suggestion (event-logged) AND logs a "draft discarded"
// activity so the next briefing reads the verdict in the feed and never
// re-offers the thrown-away draft (spec §06/§14 — the promise has memory in
// the log, not the session).
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { deleteSuggestion, appendActivity } from '@/lib/crm-store'

export async function POST(req: NextRequest) {
  let b: { prospect_id?: string; channel?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const prospectId = String(b.prospect_id || '').trim()
  const channel = b.channel === 'whatsapp' ? 'whatsapp' : 'email'
  if (!prospectId) return NextResponse.json({ error: 'prospect_id required' }, { status: 400 })

  try {
    await deleteSuggestion(prospectId, channel)
    await appendActivity({
      prospect_id: prospectId,
      type: 'Note',
      notes: `Entwurf verworfen (${channel}) — Filippo entschied: keine Antwort nötig.`,
      user_id: 'Filippo',
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
