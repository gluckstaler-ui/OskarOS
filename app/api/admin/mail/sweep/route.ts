// ==========================================
// POSTMASTER · manual sweep trigger (PM-10, spec §04)
// POST /api/admin/mail/sweep        → start a sweep (or JOIN the running one)
// POST /api/admin/mail/sweep?wait=1 → same, but resolve only when it finishes
//
// The CHECK-EMAIL button. sweepMail() is serialized with join semantics —
// a click during any phase starts nothing new; it attaches to the running
// operation. Default is fire-and-return (the UI polls /api/admin/mail/status
// at 2s while sweeping); ?wait=1 is for scripts and tests.
// `?backfill=1` batches through Sent history (corpus seeding, spec §04).
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { sweepMail, getMailProgress } from '@/lib/mail-eyes'

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const wait = url.searchParams.get('wait') === '1'
  const backfill = url.searchParams.get('backfill') === '1'

  const done = sweepMail({ backfill })
  if (wait) {
    const progress = await done
    return NextResponse.json({ joined: false, progress })
  }
  // Fire-and-return: never let an unhandled rejection escape the route.
  done.catch(() => { /* surfaced via progress.phase === 'failed' */ })
  return NextResponse.json({ started: true, progress: getMailProgress() })
}
