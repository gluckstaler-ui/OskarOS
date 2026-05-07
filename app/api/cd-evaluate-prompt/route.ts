/**
 * POST /api/cd-evaluate-prompt — WP-15 proofread endpoint
 *
 * Thin wrapper around `lib/cd-proofread.ts:runProofread()`. Used by the
 * client when it wants a standalone proofread (e.g. Ask CD's "rewrite this
 * prompt" affordance). The /api/edit-image route calls runProofread()
 * directly to avoid an HTTP round-trip.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runProofread, type ProofreadInput, type ProofreadOutcome } from '@/lib/cd-proofread'

export async function POST(req: NextRequest) {
  let body: ProofreadInput
  try {
    body = (await req.json()) as ProofreadInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.sessionId || !body.prompt) {
    return NextResponse.json({ error: 'sessionId and prompt required' }, { status: 400 })
  }
  const result: ProofreadOutcome = await runProofread(body)
  return NextResponse.json(result)
}
