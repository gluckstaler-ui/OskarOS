/**
 * Dream API Route
 *
 * POST /api/dream - Trigger a dream cycle (Padawan Sage) for a session
 *   Body: { sessionId: string }
 *   Returns: { status, timestamp, ...stats }
 *
 * GET /api/dream - Status check
 *   Returns: { currentHour, currentMinute }
 */

import { NextRequest, NextResponse } from 'next/server'
import { runDreamer } from '@/lib/memory/dreamer'

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json()

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    console.log(`[/api/dream] Starting dream cycle for session=${sessionId}`)
    const result = await runDreamer(sessionId)

    return NextResponse.json({
      status: 'complete',
      ...result.stats,
    })
  } catch (error) {
    console.error('[/api/dream] Error:', error)
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    currentHour: new Date().getHours(),
    currentMinute: new Date().getMinutes(),
  })
}
