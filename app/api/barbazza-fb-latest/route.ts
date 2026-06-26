import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/*
 * Latest-post widget for the Barbazza brand site (public/2026-05-31-weingut-barbazza).
 * The static page fetches this on load and renders its own on-brand card from the result —
 * so the visitor sees the ACTUAL latest Facebook post first, with no Facebook chrome.
 *
 * Facebook exposes a page's posts only to AUTHENTICATED requests, so this needs a
 * long-lived Page access token. It is read from `.barbazza-fb.env` at the project root
 * (gitignored, outside the web root) or from real environment variables in production —
 * it never reaches the browser.
 *
 *   FB_PAGE_ID     = 100057179450929          (Winery Barbazza — already known)
 *   FB_PAGE_TOKEN  = <long-lived Page token>   (the one thing only the owner can mint)
 *   FB_GRAPH_VER   = v21.0                      (optional)
 *
 * If the token is missing or Graph errors, this returns { ok:false } and the page keeps
 * its baked-in snapshot — the card is never broken, just not auto-current.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_ID_DEFAULT = '100057179450929'

async function loadCfg() {
  const fromFile: Record<string, string> = {}
  try {
    const txt = await readFile(path.join(process.cwd(), '.barbazza-fb.env'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) fromFile[m[1]] = m[2]
    }
  } catch { /* fall back to env */ }
  const pick = (k: string) => fromFile[k] ?? process.env[k]
  return {
    pageId: pick('FB_PAGE_ID') || PAGE_ID_DEFAULT,
    token: pick('FB_PAGE_TOKEN'),
    ver: pick('FB_GRAPH_VER') || 'v21.0',
  }
}

// Small in-memory cache so we don't hit Graph on every page view.
let cache: { at: number; body: any } | null = null
const TTL_MS = 10 * 60 * 1000

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d)
  } catch { return '' }
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.body, { headers: { 'Cache-Control': 'public, max-age=600' } })
  }

  const c = await loadCfg()
  if (!c.token) {
    // No token configured yet — tell the page to keep its baked-in snapshot.
    return NextResponse.json({ ok: false, reason: 'no-token' }, { status: 200 })
  }

  const fields = 'permalink_url,message,created_time,full_picture,attachments{media_type,unshimmed_url}'
  const url = `https://graph.facebook.com/${c.ver}/${c.pageId}/posts` +
    `?fields=${encodeURIComponent(fields)}&limit=1&access_token=${encodeURIComponent(c.token)}`

  try {
    const r = await fetch(url, { cache: 'no-store' })
    const j: any = await r.json()
    if (!r.ok || j.error || !Array.isArray(j.data) || !j.data.length) {
      console.error('[barbazza-fb-latest] graph error:', JSON.stringify(j.error || j).slice(0, 300))
      const body = { ok: false, reason: 'graph-error' }
      return NextResponse.json(body, { status: 200 })
    }
    const p = j.data[0]
    const att = p.attachments?.data?.[0]
    const isVideo = (att?.media_type || '').toLowerCase() === 'video'
    const body = {
      ok: true,
      post: {
        permalink: p.permalink_url || att?.unshimmed_url || `https://www.facebook.com/${c.pageId}`,
        message: (p.message || '').trim(),
        image: p.full_picture || null,
        dateLabel: fmtDate(p.created_time),
        isVideo,
      },
    }
    cache = { at: Date.now(), body }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=600' } })
  } catch (e) {
    console.error('[barbazza-fb-latest] fetch failed:', e)
    return NextResponse.json({ ok: false, reason: 'fetch-failed' }, { status: 200 })
  }
}
