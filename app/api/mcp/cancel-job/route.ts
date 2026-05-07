/**
 * /api/mcp/cancel-job — cancel a running job by jobId.
 * Phase 2.5 (Ralph 2026-04-30).
 *
 * Flips status to "cancelled" and aborts the runner's AbortSignal.
 * Builds (lib/run-webdev.ts) propagate the signal to the WebDev child
 * via SIGTERM. Image generation aborts the underlying fetch.
 *
 * If the runner doesn't honor the signal, the underlying work may
 * continue running orphaned — but the JOB is marked cancelled so CD
 * stops polling.
 */

import { NextResponse } from 'next/server'
import { cancelJob, getJob } from '@/lib/build-escrow'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const jobId = String(body.jobId || '').trim()
  if (!sessionId || !jobId) {
    return NextResponse.json({ error: 'sessionId + jobId required' }, { status: 400 })
  }

  const existing = getJob(jobId)
  if (!existing) {
    return NextResponse.json({ error: 'unknown jobId' }, { status: 404 })
  }
  if (existing.sessionId !== sessionId) {
    return NextResponse.json({ error: 'jobId does not belong to this session' }, { status: 403 })
  }

  if (existing.status !== 'running' && existing.status !== 'stuck') {
    return NextResponse.json({
      job: existing,
      note: `Job already terminal (${existing.status}); nothing to cancel.`,
    })
  }

  const job = cancelJob(jobId)
  return NextResponse.json({ job })
}
