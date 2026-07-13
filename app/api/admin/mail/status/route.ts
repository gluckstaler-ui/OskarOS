// ==========================================
// POSTMASTER · sweep status (PM-10, spec §13)
// GET /api/admin/mail/status → the strip's + CHECK-EMAIL ticker's one source.
//
// Everything here is DERIVED — no state file (Ralph 2026-07-12):
//   progress            in-memory from mail-eyes (phase incl. `failed`)
//   corpus_count        SELECT over activities (E-mail Out on the record)
//   suggestions_pending SELECT over the suggestions table
//   unmatched_count     media/unmatched/eml/ INBOX mail (the banner's pool)
// UI polls at 2s while `sweeping`, else on the normal cadence.
// ==========================================

import { NextResponse } from 'next/server'
import { getMailProgress } from '@/lib/mail-eyes'
import { countUnmatchedFromCache } from '@/lib/mail-eyes'
import { getDb } from '@/lib/crm-boot'
import { readMailConfig } from '@/lib/mail-config'

export async function GET() {
  const progress = getMailProgress()
  const cfg = readMailConfig()

  let corpusCount = 0
  let suggestionsPending = 0
  try {
    const db = getDb()
    corpusCount = (db.prepare(`SELECT COUNT(*) AS n FROM activities WHERE type = 'E-mail Out' AND soft_deleted = 0`).get() as { n: number }).n
    suggestionsPending = (db.prepare(`SELECT COUNT(*) AS n FROM suggestions WHERE channel = 'email'`).get() as { n: number }).n
  } catch { /* projection not booted — zeros are honest */ }

  // Filippo 2026-07-13: bucket counts served from the email_headers cache
  // (pure SQL — no IMAP round-trip, no artificial limits).
  let inboxCount = 0
  let updatesCount = 0
  let othersCount = 0
  try {
    const b = countUnmatchedFromCache()
    inboxCount = b.inbox
    updatesCount = b.updates
    othersCount = b.others
  } catch { /* cache table missing — leave zero */ }
  const unmatchedCount = inboxCount + updatesCount + othersCount

  const sweeping = !['idle', 'done', 'failed'].includes(progress.phase)
  return NextResponse.json({
    configured: cfg.configured,
    sweeping,
    healthy: progress.phase !== 'failed',
    progress,
    last_sweep_at: progress.finished_at ?? null,
    filed_last_sweep: progress.filed,
    corpus_count: corpusCount,
    suggestions_pending: suggestionsPending,
    unmatched_count: unmatchedCount,
    inbox_count: inboxCount,
    updates_count: updatesCount,
    others_count: othersCount,
    sweep_sec: cfg.sweepSec,
  })
}
