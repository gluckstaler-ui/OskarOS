// Scout v1 — Taste (Ralph 2026-06-03). v1 runs the REAL cheap ◐ Queried signals
// that need no API key (Hosting via DNS · Age via Wayback · Stack via HTML grep)
// and writes them in place, flipping the row raw → scouted. The ◓ visual taste
// (Puppeteer capture + Opus → palate/execution/choice) is the next increment —
// here it's explicitly "pending". WP-SCOUT-4/5.
import { NextRequest, NextResponse } from 'next/server'
import { promises as dns } from 'node:dns'
import { readRawProspect, patchRawProspect } from '@/lib/crm-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const domainOf = (website: string) =>
  website.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()

async function hosting(domain: string): Promise<string | null> {
  try {
    const addrs = await dns.resolve4(domain)
    if (!addrs.length) return null
    try {
      const ptr = await dns.reverse(addrs[0])
      return ptr[0] ? `${ptr[0]}` : addrs[0]
    } catch { return addrs[0] }
  } catch { return null }
}

async function age(domain: string): Promise<string | null> {
  try {
    const r = await fetch(
      `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp&limit=1`,
      { signal: AbortSignal.timeout(8000) },
    )
    const j = (await r.json()) as string[][]
    const ts = j?.[1]?.[0]
    return ts ? `first seen ${ts.slice(0, 4)}` : null
  } catch { return null }
}

async function stackOf(domain: string): Promise<string | null> {
  try {
    const r = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(8000), redirect: 'follow' })
    const html = (await r.text()).slice(0, 200_000).toLowerCase()
    if (html.includes('wp-content') || html.includes('wordpress')) return 'WordPress'
    if (html.includes('wix.com') || html.includes('_wixcss')) return 'Wix'
    if (html.includes('squarespace')) return 'Squarespace'
    if (html.includes('jimdo')) return 'Jimdo'
    if (html.includes('webflow')) return 'Webflow'
    if (html.includes('cdn.shopify')) return 'Shopify'
    if (html.includes('/_next/')) return 'Next.js · custom'
    return 'custom / unknown'
  } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const { rawIds } = (await req.json()) as { rawIds: string[] }
    const results = await Promise.all((rawIds || []).map(async (id) => {
      const raw = readRawProspect(id)
      if (!raw || !raw.website) return { id, skipped: true } // greenfield — nothing to taste
      const d = domainOf(raw.website)
      const [hostingV, ageV, stackV] = await Promise.all([hosting(d), age(d), stackOf(d)])
      const scout_json = JSON.stringify({
        scanned_at: new Date().toISOString(),
        // ◓ Scouted — pending until the Puppeteer+Opus visual taste lands.
        taste: { palate: null, execution: null, gap: null, heat: null, palate_choice: null, verdict: 'Queried — visual taste pending (Puppeteer + Opus next)', photos: null },
        // ◐ Queried — real, keyless.
        queried: { age: ageV, stack: stackV, hosting: hostingV, performance: null, seo: null, traffic: null, trackers: null, booking: null, languages: null },
        failed: false, fail_reason: null,
      })
      await patchRawProspect(id, { scout_json })
      return { id, ok: true }
    }))
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[scout/taste] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
