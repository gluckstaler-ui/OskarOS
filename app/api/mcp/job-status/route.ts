/**
 * /api/mcp/job-status — poll a single job by jobId, OR list all jobs
 * for a session. Phase 2.5 (Ralph 2026-04-30).
 *
 * Returns server-derived `status` — including "stuck" when a running
 * job has been alive longer than the threshold. CD never does timestamp
 * math; the verdict is in the payload.
 */

import { NextResponse } from 'next/server'
import { getJob, listJobs, gc } from '@/lib/build-escrow'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const jobId = body.jobId ? String(body.jobId).trim() : null
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  // Lazy GC — keeps the in-memory ledger bounded.
  gc()

  if (jobId) {
    const job = getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: 'unknown jobId — process may have restarted' }, { status: 404 })
    }
    if (job.sessionId !== sessionId) {
      return NextResponse.json({ error: 'jobId does not belong to this session' }, { status: 403 })
    }
    return NextResponse.json({ job })
  }

  // No jobId → return all jobs for this session, newest first.
  return NextResponse.json({ jobs: listJobs(sessionId) })
}
