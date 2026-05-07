import { NextRequest, NextResponse } from 'next/server'
import { getVibeSlotMap } from '@/lib/vibe-slots'

/**
 * GET /api/sessions/[id]/vibe-slots
 * Returns the map of { vibe → slots[] } built by scanning `data-slot=`
 * attributes in every vibe HTML file in the session.
 *
 * Used by WP-8B's "Assign to Vibe" drawer.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }
    const groups = await getVibeSlotMap(sessionId)
    return NextResponse.json({ groups })
  } catch (error) {
    console.error('[vibe-slots] GET failed:', error)
    return NextResponse.json(
      { error: `Failed to read vibe slots: ${error}` },
      { status: 500 }
    )
  }
}
