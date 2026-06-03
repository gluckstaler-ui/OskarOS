// ==========================================
// Placeholder deploy endpoint — fires when CRM Status → Won + Stage → Closing
// POST /api/admin/deploy
//
// WP-CRM-D4 (Ralph 2026-05-22): real deployment lives downstream in
// WP-DEPLOY. This endpoint exists so the CRM's terminal action has
// something to call today — it writes a `delivery_started` Activity row
// and returns 200, no side effects on disk. When WP-DEPLOY ships, the
// guts of this endpoint get replaced; the CRM contract doesn't change.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { appendActivity } from '@/lib/crm-store'

interface DeployRequest {
  prospect_id?: string
  session_id?: string
  company?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DeployRequest
    const prospectId = body.prospect_id?.trim()
    if (!prospectId) {
      return NextResponse.json({ error: 'prospect_id required' }, { status: 400 })
    }

    // Activity row so the terminal action shows up in the lead's history.
    // The icon/color line up with the rest of D4's vocabulary.
    try {
      await appendActivity({
        prospect_id: prospectId,
        type: 'delivery_started',
        icon: 'rocket',
        color: '#10b981',
        session_id: body.session_id ?? '',
        notes: body.company ? `Delivery queued for ${body.company}` : 'Delivery queued',
      })
    } catch (err) {
      console.warn('[deploy] activity append failed (non-fatal):', err)
    }

    // Real deployment lands in WP-DEPLOY. For now, return a 200 with a
    // status token so the CRM toast can render "queued".
    return NextResponse.json({
      status: 'queued',
      message: 'Delivery workflow queued. Real handoff lands in WP-DEPLOY.',
      prospect_id: prospectId,
    })
  } catch (err) {
    console.error('[deploy] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
