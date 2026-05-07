/**
 * GET /api/sessions/[id]/lineage
 *
 * Returns all GenerationRecord entries for a session, in append order.
 * Used by the page-load path to rehydrate the version sidebar's lineage
 * after a refresh (WP-1C / WP-2C).
 */

import { NextRequest, NextResponse } from 'next/server'
import { readLineage } from '@/lib/lineage-store'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }
    const records = await readLineage(sessionId)
    return NextResponse.json({ records })
  } catch (err) {
    console.error('[lineage] GET failed:', err)
    return NextResponse.json(
      { error: `Failed to read lineage: ${err}` },
      { status: 500 }
    )
  }
}
