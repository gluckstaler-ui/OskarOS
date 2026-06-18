// ============================================================================
// app/api/admin/crm/scout/backfill-queried/status/route.ts
// Ralph 2026-06-05 spec-review M-iii.
//
// GET ?jobId=<uuid> → { progress }
//
// The client polls THIS endpoint while a backfill is in flight — not the
// 200-row, 150KB/tick pool fetch it used before. The payload is bounded
// by the row count of the run (~50 bytes/row) so a 200-row backfill →
// ~10KB per poll instead of ~150KB. With 80 polls per run that's a 24MB
// → ~800KB round-trip reduction (97% less bandwidth).
//
// Distinct from /api/mcp/job-status (which only carries the escrow's
// generic JobResult shape) — we need per-row outcomes + lamp counts the
// L-ii snackbar consumes at completion.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getBackfillProgress } from '@/lib/scout-backfill-progress'

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId') ?? ''
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }
  const progress = getBackfillProgress(jobId)
  if (!progress) {
    return NextResponse.json({ error: 'unknown jobId' }, { status: 404 })
  }
  return NextResponse.json({ progress })
}
