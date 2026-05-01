import { NextRequest, NextResponse } from 'next/server'
import { hotSwapToVibe } from '@/lib/vibe-slots'
import { publish } from '@/lib/event-bus'

/**
 * POST /api/sessions/[id]/assign-slot
 * Body: { vibe: string, slot: string, filename: string }
 *
 * Targeted assign: swaps the image into ONE specific vibe (not all vibes
 * that happen to share the slot name). Used by WP-8B's assign drawer.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body.vibe !== 'string' || typeof body.slot !== 'string' || typeof body.filename !== 'string') {
      return NextResponse.json(
        { error: 'Body must be { vibe: string, slot: string, filename: string }' },
        { status: 400 }
      )
    }

    const { vibe, slot, filename } = body
    const result = await hotSwapToVibe(sessionId, vibe, slot, filename)

    if (!result.success) {
      publish(sessionId, {
        type: 'hotswap_failed',
        vibe,
        slot,
        filename,
        error: result.error,
        level: 'error',
      })
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    // Phase 2: server-side publish so /api/events delivers hotswap_complete
    // to BOTH the frontend (UI snackbar via sessionEvents) AND the MCP server
    // (CD as a logging notification). Removes the duplicate emitHotSwap path
    // that AdvancedMode used to call client-side after this fetch.
    publish(sessionId, {
      type: 'hotswap_complete',
      vibe,
      slot,
      sourceImage: filename,
    })

    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('[assign-slot] POST failed:', error)
    return NextResponse.json(
      { error: `Assign failed: ${error}` },
      { status: 500 }
    )
  }
}
