// ============================================================================
// POST /api/site/connect { sessionId } → { ok, method, secure, docroot, error? }
//
// Opens the transport (FTPS → plain fallback for FTP, or set up Local) and
// reports what was negotiated. This IS the probe (spec §8) — the same call
// returns whether FTPS (green) or plain FTP (yellow) won. No /probe endpoint.
// Connection is opened then immediately closed: connect is a no-write health
// check, and basic-ftp is one-connection-per-request anyway (spec §4).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { connectSite, readSiteConfig, buildTransport } from '@/lib/site/connect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_CACHE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  let sessionId: string
  try {
    ({ sessionId } = await req.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400, headers: NO_CACHE })
  }
  if (!sessionId || typeof sessionId !== 'string' || sessionId.includes('/') || sessionId.includes('..')) {
    return NextResponse.json({ ok: false, error: 'valid sessionId required' }, { status: 400, headers: NO_CACHE })
  }

  const site = readSiteConfig(sessionId)
  if (!site) {
    return NextResponse.json({ ok: false, error: 'no site config for this session' }, { status: 400, headers: NO_CACHE })
  }
  const transport = buildTransport(site)
  try {
    await transport.connect()
    const secure = transport.secure
    await transport.close()
    return NextResponse.json(
      { ok: true, method: site.method, secure, docroot: site.method === 'file' ? site.destination : site.docroot },
      { headers: NO_CACHE },
    )
  } catch (err) {
    await transport.close()
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502, headers: NO_CACHE },
    )
  }
}
