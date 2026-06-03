// Scout v1 — the live pool (Ralph 2026-06-03). GET → raw_prospects that are
// neither promoted nor rejected. WP-SCOUT-7's screen reads this.
import { NextResponse } from 'next/server'
import { readRawProspects } from '@/lib/crm-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const pool = readRawProspects()
    return NextResponse.json({ pool, count: pool.length })
  } catch (err) {
    console.error('[scout/pool] GET failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
