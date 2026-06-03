// ============================================================================
// GET /api/admin/crm/consular/deck — serve the Consular's curated Flight Deck.
//
// The Consular writes its picks to db/flight-deck.json (file-as-API, like
// db/SESSION.md). The chat route returns that deck AFTER a turn, but the React
// <FlightDeck/> also needs it on initial load / reload — otherwise a persisted
// drive vanishes back to the baseline queue until the next message. This GET
// is that read path. Absent / malformed file → { pushed: null } (the page
// falls back to the client-derived overdue-queue baseline).
// ============================================================================

import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { getCrmDeckPath } from '@/lib/memory/paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export function GET() {
  try {
    const raw = JSON.parse(readFileSync(getCrmDeckPath(), 'utf-8')) as {
      pushed?: unknown
      queueCount?: unknown
    }
    if (raw && Array.isArray(raw.pushed)) {
      return NextResponse.json(
        { pushed: raw.pushed.slice(0, 6), queueCount: typeof raw.queueCount === 'number' ? raw.queueCount : 0 },
        { headers: NO_CACHE },
      )
    }
  } catch {
    /* absent / malformed → baseline */
  }
  return NextResponse.json({ pushed: null, queueCount: 0 }, { headers: NO_CACHE })
}
