// ============================================================================
// app/api/admin/crm/raw-prospects/[id]/un-scout/route.ts
//
// Ralph 2026-06-03 — per-row reset. Wipes `scout_json` back to '{}' so the
// row drops from 'scouted' (or 'failed') back to 'raw' and becomes eligible
// for the next Scout batch.
//
//   POST /api/admin/crm/raw-prospects/<id>/un-scout  →  {ok:true}
//
// Used by the dossier's "↺ Re-Taste" button when:
//   - capture failed and the site has come back online
//   - the user edited the website URL to fix a typo
//   - the user wants a second opinion from a different Sonnet generation
//
// Same guards as the other id-routes: promoted/rejected rows are off-limits
// (those are out of the live pool by definition; un-scouting them would be
// a no-op that confuses the caller). Idempotent on a row that's already
// raw (scout_json='{}') — returns ok with `alreadyRaw:true` so the UI's
// optimistic refresh doesn't get a stale error.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { readRawProspect, patchRawProspect } from '@/lib/crm-store'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const raw = readRawProspect(id)
    if (!raw) return NextResponse.json({ error: 'pool row not found' }, { status: 404 })
    if (raw.promoted_at) return NextResponse.json({ error: 'cannot un-scout a promoted row' }, { status: 409 })
    if (raw.rejected_at) return NextResponse.json({ error: 'cannot un-scout a rejected row' }, { status: 409 })

    // Already raw — short-circuit so the UI doesn't churn a write for nothing.
    if (!raw.scout_json || raw.scout_json === '{}' || raw.scout_json === '') {
      return NextResponse.json({ ok: true, alreadyRaw: true })
    }

    await patchRawProspect(id, { scout_json: '{}' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[raw-prospects/un-scout] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
