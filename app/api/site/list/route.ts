// ============================================================================
// GET /api/site/list?session=<id>&path=<p>
//   → { ok, path, entries:[{name,type,size?}], error? }
//
// Directory listing for the picker (spec §8). `path` is relative to the docroot
// (FTP) or destination (File). `..` that escapes the root is rejected — the
// transport is already chrooted, but defence in depth at the API edge too.
// One connection per request, closed after.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import os from 'node:os'
import { resolve, sep } from 'node:path'
import { connectSite, readSiteConfig } from '@/lib/site/connect'
import { LocalTransport } from '@/lib/site/local'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_CACHE = { 'Cache-Control': 'no-store' }

// Reject any path that walks above its own root (`..` segments).
function escapesRoot(p: string): boolean {
  const norm = p.replace(/\\/g, '/').replace(/^\/+/, '')
  let depth = 0
  for (const seg of norm.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { depth--; if (depth < 0) return true } else depth++
  }
  return false
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('session') ?? ''
  const path = url.searchParams.get('path') ?? ''

  if (!sessionId || sessionId.includes('/') || sessionId.includes('..')) {
    return NextResponse.json({ ok: false, path, entries: [], error: 'valid session required' }, { status: 400, headers: NO_CACHE })
  }
  if (escapesRoot(path)) {
    return NextResponse.json({ ok: false, path, entries: [], error: 'path escapes the docroot' }, { status: 400, headers: NO_CACHE })
  }

  // File (Local) mode: browse the user's HOME directory tree — their actual deploy
  // space — NOT the OS filesystem root. On shared/cPanel hosting `/` is a CageFS
  // skeleton full of inaccessible system dirs (/dev, /proc, /lib …) that are not a
  // valid site destination and throw EACCES on scandir. We clamp every requested
  // path to home so the picker only ever shows real, writable folders (the user's
  // domain dirs, public_html, etc.). `path` is absolute; "" resolves to home.
  const site = readSiteConfig(sessionId)
  if (site?.method === 'file') {
    const home = resolve(os.homedir())
    let target = path ? resolve('/', path.replace(/^\/+/, '')) : home
    if (target !== home && !target.startsWith(home + sep)) target = home // never above home
    try {
      const entries = await new LocalTransport('/').list(target)
      return NextResponse.json({ ok: true, path: target, entries }, { headers: NO_CACHE })
    } catch (err) {
      return NextResponse.json({ ok: false, path: target, entries: [], error: err instanceof Error ? err.message : String(err) }, { status: 502, headers: NO_CACHE })
    }
  }

  let connected
  try {
    connected = await connectSite(sessionId)
  } catch (err) {
    return NextResponse.json({ ok: false, path, entries: [], error: err instanceof Error ? err.message : String(err) }, { status: 502, headers: NO_CACHE })
  }
  try {
    const entries = await connected.transport.list(path)
    return NextResponse.json({ ok: true, path, entries }, { headers: NO_CACHE })
  } catch (err) {
    return NextResponse.json({ ok: false, path, entries: [], error: err instanceof Error ? err.message : String(err) }, { status: 502, headers: NO_CACHE })
  } finally {
    await connected.transport.close()
  }
}
