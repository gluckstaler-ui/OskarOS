// ============================================================================
// POST /api/site/sync { sessionId, direction:'up'|'down', files:[path] }
//   → STREAM of SYNC_* lines (lib/sync/stream.ts):
//        SYNC_FILE <p> / SYNC_OK <p> / SYNC_ERR <p> <reason> / SYNC_DONE ok=n fail=m
//
// The ONLY live-site write (spec §8). One transport connection drives the whole
// batch (basic-ftp isn't concurrency-safe — spec §4). Each file is its own
// try/catch inside runSyncStream → partial success; a chmod-000 remote file
// reports SYNC_ERR with the FTP code and the batch continues. Local-only backup
// (Ralph #2) and the newest-on-top sync-log (spec §8) are handled inside the
// stream module. The transport is closed once the stream finishes.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { connectSite } from '@/lib/site/connect'
import { runSyncStream } from '@/lib/sync/stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_CACHE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  let sessionId: string, direction: 'up' | 'down', files: string[]
  try {
    ({ sessionId, direction, files } = await req.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400, headers: NO_CACHE })
  }
  if (!sessionId || sessionId.includes('/') || sessionId.includes('..')) {
    return NextResponse.json({ ok: false, error: 'valid sessionId required' }, { status: 400, headers: NO_CACHE })
  }
  if (direction !== 'up' && direction !== 'down') {
    return NextResponse.json({ ok: false, error: "direction must be 'up' or 'down'" }, { status: 400, headers: NO_CACHE })
  }
  if (!Array.isArray(files) || files.length === 0 || files.some((f) => typeof f !== 'string' || f.includes('..'))) {
    return NextResponse.json({ ok: false, error: 'files must be a non-empty array of relative paths' }, { status: 400, headers: NO_CACHE })
  }

  let connected
  try {
    connected = await connectSite(sessionId)
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502, headers: NO_CACHE })
  }

  const { transport, site, localRoot, secure } = connected
  const endpoint = site.method === 'file'
    ? (site.destination ?? '')
    : `${site.user ?? ''}@${site.host ?? ''}`
  const docroot = site.method === 'file' ? (site.destination ?? '') : (site.docroot ?? '')

  const inner = runSyncStream({
    sessionId, direction, files, transport, localRoot,
    method: secure, endpoint, docroot,
  })

  // Wrap so the transport is closed once the batch stream completes/errors.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = inner.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
      } catch (err) {
        try { controller.enqueue(new TextEncoder().encode(`SYNC_ERR <batch> ${err instanceof Error ? err.message : String(err)}\n`)) } catch { /* closed */ }
      } finally {
        await transport.close()
        try { controller.close() } catch { /* noop */ }
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  })
}
