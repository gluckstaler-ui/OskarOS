/**
 * GET /api/admin/crm/consular/bloat
 *
 * The Order-66 gauge metric for the CRM top bar (WP-115). Shaped against
 * `db/SESSION.md` — the Consular's single, CRM-wide session log (per §16.1
 * + the agent file's BOOT SEQUENCE). NOT a per-studio-session file.
 *
 * Sage-240/40 compresses that log at ~240KB (the "240" in the variant
 * name), so the gauge tracks the same cut line: green well under, amber
 * approaching, red = the cut is due/overdue. Foundation-first — until the
 * Consular runtime (WP-112) writes the log, the file is absent and the
 * gauge reads 0 / green. It lights up on its own once the log fills.
 *
 * Returns `{ bytes, cutBytes, pct, color }`. Never throws on a missing
 * file — absent log is a legitimate "fresh / green" state, not an error.
 */

import { NextResponse } from 'next/server'
import { stat } from 'fs/promises'
import { join } from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The Sage-240 cut line. Tunable — §16.7 lists the gauge threshold as an
// open decision; 240KB matches the existing sage-240-40 doctrine.
const CUT_BYTES = 240 * 1024 // 245_760
const AMBER_FRAC = 0.6 // 60% of the cut → "cut due soon"

export async function GET() {
  let bytes = 0
  try {
    bytes = (await stat(join(process.cwd(), 'db', 'SESSION.md'))).size
  } catch {
    bytes = 0 // absent log = fresh session = green; not an error
  }

  const rawPct = (bytes / CUT_BYTES) * 100
  const pct = Math.min(100, Math.round(rawPct))
  const color = rawPct >= 100 ? 'red' : rawPct >= AMBER_FRAC * 100 ? 'amber' : 'green'

  return NextResponse.json(
    { bytes, cutBytes: CUT_BYTES, pct, color },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  )
}
