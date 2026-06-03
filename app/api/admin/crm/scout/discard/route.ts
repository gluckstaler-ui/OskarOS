// Scout v1 — Discard (Ralph 2026-06-03). One-click; stamps the pool row
// rejected (reason optional, no prompt in v2). WP-SCOUT-8.
import { NextRequest, NextResponse } from 'next/server'
import { readRawProspect, patchRawProspect } from '@/lib/crm-store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { id, reason } = (await req.json()) as { id: string; reason?: string }
    const raw = readRawProspect(id)
    if (!raw) return NextResponse.json({ error: 'pool row not found' }, { status: 404 })
    if (raw.promoted_at) return NextResponse.json({ error: 'already promoted' }, { status: 409 })
    if (raw.rejected_at) return NextResponse.json({ ok: true, alreadyDiscarded: true })
    await patchRawProspect(id, { rejected_at: new Date().toISOString(), rejected_reason: reason || '' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[scout/discard] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
