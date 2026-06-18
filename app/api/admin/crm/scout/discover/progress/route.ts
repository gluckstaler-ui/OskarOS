// ============================================================================
// app/api/admin/crm/scout/discover/progress/route.ts — Poll a Discover
// job's live progress. Ralph 2026-06-05.
//
// GET ?jobId=<uuid>  → { progress }
//   404 if the jobId is unknown (process restarted, or never queued).
//
// Pair with POST /api/admin/crm/scout/discover. The UI polls this every
// 1-2s while the run is in flight; once `progress.phase === 'done'` or
// `'error'`, polling stops.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getProgress } from '@/lib/scout-discover-progress'

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId') ?? ''
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  const progress = getProgress(jobId)
  if (!progress) return NextResponse.json({ error: 'unknown jobId' }, { status: 404 })
  return NextResponse.json({ progress })
}
