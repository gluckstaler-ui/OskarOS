/**
 * POST /api/cd-evaluate-upload — WP-15 rule 7
 *
 * Thin wrapper around lib/cd-upload-eval.ts:runUploadEval(). Called by the
 * client right after a successful /api/upload so the user sees CD's take
 * land as a snackbar a beat later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runUploadEval, type UploadEvalInput, type UploadEvalOutcome } from '@/lib/cd-upload-eval'

export async function POST(req: NextRequest) {
  let body: UploadEvalInput
  try {
    body = (await req.json()) as UploadEvalInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.sessionId || !body.filename) {
    return NextResponse.json({ error: 'sessionId and filename required' }, { status: 400 })
  }
  const result: UploadEvalOutcome = await runUploadEval(body)
  return NextResponse.json(result)
}
