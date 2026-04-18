/**
 * POST /api/cd-evaluate-result — WP-15 verdict endpoint
 *
 * Thin wrapper around `lib/cd-verdict.ts:runVerdict()`. /api/edit-image
 * calls runVerdict() directly after Nano returns; this endpoint exists for
 * the client-side "ask CD to look at this again" pattern.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runVerdict, type VerdictInput, type VerdictOutcome } from '@/lib/cd-verdict'

export async function POST(req: NextRequest) {
  let body: VerdictInput
  try {
    body = (await req.json()) as VerdictInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.sessionId || !body.filename || !body.originalPrompt) {
    return NextResponse.json(
      { error: 'sessionId, filename, originalPrompt required' },
      { status: 400 }
    )
  }
  const result: VerdictOutcome = await runVerdict(body)
  return NextResponse.json(result)
}
