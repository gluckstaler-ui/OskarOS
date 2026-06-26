// ============================================================================
// GET /api/admin/sync/state?target=crm|session|codebase[&id=<session>]
//
// Returns THIS machine's state for a sync target (WP-28). The remote side reads
// this to compute the in-sync / diff indicator. Read-only — no mutation.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { crmState, sessionState, codebaseState, type SyncTarget } from '@/lib/sync/state'
import { getNodeId } from '@/lib/event-log'
import { recordClient } from '@/lib/sync/clients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_CACHE = { 'Cache-Control': 'no-store' }

export function GET(req: NextRequest) {
  // Hub-side presence (WP-28): record the spoke reading our state, keyed by the
  // node id it sends (X-Oskar-Node). Ignore our own / anonymous reads.
  const reqNode = req.headers.get('x-oskar-node') || ''
  if (reqNode && reqNode !== getNodeId()) {
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || ''
    recordClient(reqNode, ip, req.headers.get('x-oskar-version') || '')
  }
  const url = new URL(req.url)
  const target = url.searchParams.get('target') as SyncTarget | null
  try {
    if (target === 'crm') return NextResponse.json(crmState(), { headers: NO_CACHE })
    if (target === 'codebase') return NextResponse.json(codebaseState(), { headers: NO_CACHE })
    if (target === 'session') {
      const id = url.searchParams.get('id')
      if (!id) return NextResponse.json({ error: 'session id required' }, { status: 400, headers: NO_CACHE })
      return NextResponse.json(sessionState(id), { headers: NO_CACHE })
    }
    return NextResponse.json({ error: 'target must be crm|session|codebase' }, { status: 400, headers: NO_CACHE })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500, headers: NO_CACHE })
  }
}
