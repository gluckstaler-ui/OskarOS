// ============================================================================
// POST /api/site/compare { sessionId, direction:'up'|'down' }
//   → { ok, files:[{path,status,essential,localSize?,remoteSize?}], error? }
//
// Walks BOTH sides into manifests (honoring site.ignore + the hard-excludes via
// makeIgnore) and classifies per spec §7 with Ralph #1's mtime correction: a
// same-size-but-newer-than-last-sync file still classifies `changed`.
//
// "last sync time" = the mtime of public/<id>/logs/sync-log.md (written on every
// successful run). Falls back to 0 (size-only) when no sync has happened yet.
// One remote connection per request, closed after.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { connectSite, sessionLocalRoot } from '@/lib/site/connect'
import { LocalTransport } from '@/lib/site/local'
import { compareManifests, makeIgnore } from '@/lib/site/compare'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_CACHE = { 'Cache-Control': 'no-store' }

function lastSyncMs(sessionId: string): number {
  const logPath = join(sessionLocalRoot(sessionId), 'logs', 'sync-log.md')
  try { return existsSync(logPath) ? Math.floor(statSync(logPath).mtimeMs) : 0 } catch { return 0 }
}

export async function POST(req: NextRequest) {
  let sessionId: string, direction: 'up' | 'down'
  try {
    ({ sessionId, direction } = await req.json())
  } catch {
    return NextResponse.json({ ok: false, files: [], error: 'invalid JSON body' }, { status: 400, headers: NO_CACHE })
  }
  if (!sessionId || sessionId.includes('/') || sessionId.includes('..')) {
    return NextResponse.json({ ok: false, files: [], error: 'valid sessionId required' }, { status: 400, headers: NO_CACHE })
  }
  if (direction !== 'up' && direction !== 'down') {
    return NextResponse.json({ ok: false, files: [], error: "direction must be 'up' or 'down'" }, { status: 400, headers: NO_CACHE })
  }

  let connected
  try {
    connected = await connectSite(sessionId)
  } catch (err) {
    return NextResponse.json({ ok: false, files: [], error: err instanceof Error ? err.message : String(err) }, { status: 502, headers: NO_CACHE })
  }

  try {
    const ignore = makeIgnore(connected.site.ignore)
    const local = new LocalTransport(sessionLocalRoot(sessionId))
    await local.connect()

    const localManifest = await local.manifest('', ignore)
    const remoteManifest = await connected.transport.manifest('', ignore)

    // UP: source=local, dest=remote. DOWN: source=remote, dest=local.
    const source = direction === 'up' ? localManifest : remoteManifest
    const dest = direction === 'up' ? remoteManifest : localManifest

    const files = compareManifests({ source, dest, direction, lastSyncMs: lastSyncMs(sessionId), includeUnchanged: true })
      .map(({ path, status, essential, localSize, remoteSize }) => ({ path, status, essential, localSize, remoteSize }))

    return NextResponse.json({ ok: true, files }, { headers: NO_CACHE })
  } catch (err) {
    return NextResponse.json({ ok: false, files: [], error: err instanceof Error ? err.message : String(err) }, { status: 502, headers: NO_CACHE })
  } finally {
    await connected.transport.close()
  }
}
