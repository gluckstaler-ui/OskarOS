/**
 * /api/cron/sage-all — OPTIONAL HTTP trigger for the Sage sweep.
 *
 * NOTE: this is NOT how the weekly cron runs. The cron runs a standalone script
 * (scripts/sage-sunday-cron.ts via crontab) so it works with NO server up — an
 * HTTP endpoint that needs a live dev server isn't an autonomous cron. This
 * route stays only as a manual/on-demand trigger when a long-lived server IS
 * running. Both paths call the same lib/memory/sage-sweep.ts (kept DRY).
 *
 * Auth: bearer CRON_SECRET. ?skipPortrait=1 runs 240/40 alone (testing).
 */

import { NextRequest } from 'next/server'
import { runSageSweep } from '@/lib/memory/sage-sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 500 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const skipPortrait = req.nextUrl.searchParams.get('skipPortrait') === '1'
  const result = await runSageSweep({ skipPortrait })
  return Response.json(result)
}
