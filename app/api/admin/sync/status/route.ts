// ============================================================================
// GET /api/admin/sync/status?target=crm|session|codebase|sessions[&id=<session>]
//
// The SYNC-panel indicator backend (WP-28). Computes THIS machine's state,
// fetches the hub's (OSKAR_SYNC_HUB), and returns { inSync, sentence } per
// target. `target=sessions` returns the dropdown list. Read-only.
//
// Spoke (local Mac) sets OSKAR_SYNC_HUB=https://awesome-ux.ch in .env.local;
// the hub (server) leaves it unset → reports "this machine is the hub".
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import {
  crmState, sessionState, codebaseState, codebaseLabel, listSessions,
  diffCrm, diffSession, diffCodebase, type SyncTarget,
} from '@/lib/sync/state'
import { getNodeId } from '@/lib/event-log'
import { recordHubContact, readHubContact, readClients } from '@/lib/sync/clients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_CACHE = { 'Cache-Control': 'no-store' }
const HUB = process.env.OSKAR_SYNC_HUB?.replace(/\/$/, '') || ''

async function hubState(target: SyncTarget, versionLabel: string, id?: string): Promise<unknown | null> {
  if (!HUB) return null
  const u = new URL(`${HUB}/api/admin/sync/state`)
  u.searchParams.set('target', target)
  if (id) u.searchParams.set('id', id)
  // Identify ourselves to the hub: node id + our build, so the hub's presence
  // panel can show which version each connected spoke is running.
  const r = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(8000), headers: { 'X-Oskar-Node': getNodeId(), 'X-Oskar-Version': versionLabel } })
  if (!r.ok) throw new Error(`hub ${r.status}`)
  recordHubContact(HUB)   // spoke side: remember our last successful hub contact
  return r.json()
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const target = url.searchParams.get('target')
  const id = url.searchParams.get('id') ?? undefined
  const localCode = codebaseState()          // this node's own build (computed once)
  const localLabel = codebaseLabel(localCode) // e.g. "v1.0.0 · c8f6661+"
  try {
    if (target === 'sessions') {
      const base = { sessions: listSessions(), hub: HUB, local: getNodeId(), localCodebase: localLabel, localRelease: localCode.release }
      // Hub: which spokes have checked in (+ their versions). Spoke: when we last reached the hub.
      return NextResponse.json(HUB ? { ...base, lastHub: readHubContact() } : { ...base, clients: readClients() }, { headers: NO_CACHE })
    }
    if (target === 'codebase' && !HUB) {
      // The hub itself — no remote to diff against, so just report our own build.
      const builtAt = localCode.builtAt ? `, built ${new Date(localCode.builtAt).toISOString().slice(0, 16).replace('T', ' ')}` : ''
      return NextResponse.json({ target, hubConfigured: false, inSync: null, sentence: `This machine is the hub · ${localLabel}${builtAt}` }, { headers: NO_CACHE })
    }
    if (!HUB) return NextResponse.json({ target, hubConfigured: false, sentence: 'This machine is the hub (no remote to compare)' }, { headers: NO_CACHE })

    if (target === 'crm') {
      const remote = await hubState('crm', localLabel) as Parameters<typeof diffCrm>[1]
      return NextResponse.json({ target, ...diffCrm(crmState(), remote) }, { headers: NO_CACHE })
    }
    if (target === 'codebase') {
      const remote = await hubState('codebase', localLabel) as Parameters<typeof diffCodebase>[1]
      return NextResponse.json({ target, ...diffCodebase(localCode, remote) }, { headers: NO_CACHE })
    }
    if (target === 'session') {
      if (!id) return NextResponse.json({ error: 'session id required' }, { status: 400, headers: NO_CACHE })
      const remote = await hubState('session', localLabel, id) as Parameters<typeof diffSession>[1]
      return NextResponse.json({ target, id, ...diffSession(sessionState(id), remote) }, { headers: NO_CACHE })
    }
    return NextResponse.json({ error: 'target must be crm|session|codebase|sessions' }, { status: 400, headers: NO_CACHE })
  } catch (err) {
    // never break the panel — surface the reason in the indicator
    return NextResponse.json({ target, inSync: null, sentence: `hub unreachable: ${err instanceof Error ? err.message : String(err)}` }, { headers: NO_CACHE })
  }
}
