// ============================================================================
// app/api/admin/crm/raw-prospects/[id]/reject/route.ts — WP-SCOUT-8
//
// Ralph 2026-06-03 — REST-shaped reject (the spec's name for what the v1
// route called "discard"): `POST /api/admin/crm/raw-prospects/<id>/reject`
// stamps the pool row `rejected_at` and the row leaves the pool. Reason is
// optional — v2 dropped the kill-reason chips [SCOUT-F], so the body's
// `{reason?}` is kept as a hook for a later "why?" without prompting today.
//
// Replaces the older `POST /api/admin/crm/scout/discard` route (deleted in
// the same change — only ScoutPool referenced it, updated to call the
// REST path instead).
//
// Idempotency: a row already rejected returns `{ok:true, alreadyRejected:true}`
// instead of 409, so the UI's optimistic-row-removal never gets a stale error
// toast from a double-tap.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { readRawProspect, patchRawProspect } from '@/lib/crm-store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const body = (await req.json().catch(() => ({}))) as { reason?: string }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

    const raw = readRawProspect(id)
    if (!raw) return NextResponse.json({ error: 'pool row not found' }, { status: 404 })
    if (raw.promoted_at) return NextResponse.json({ error: 'already promoted' }, { status: 409 })
    if (raw.rejected_at) return NextResponse.json({ ok: true, alreadyRejected: true })

    await patchRawProspect(id, {
      rejected_at: new Date().toISOString(),
      rejected_reason: reason,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[raw-prospects/reject] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
