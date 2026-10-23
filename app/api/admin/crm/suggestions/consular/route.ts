// ==========================================
// GET /api/admin/crm/suggestions/consular?prospect_id=P035&channel=email
//   → { draft: { body, subject, created_at } | null }
//
// The last CONSULAR-authored draft for a prospect+channel, recovered from
// the event log (db/events/*.jsonl — the durable memory the suggestions
// table lacks: the table holds ONE working row that template experiments
// and autosave overwrite; the log remembers who wrote what, when).
// Feeds the "✨ Consular-Entwurf" entry in the Composer's template menu
// (Filippo 2026-08-15: "deine Drafts sind ein Menüpunkt im Vorlagenmenü").
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const EVENTS_DIR = resolve(process.cwd(), 'db', 'events')

interface SuggestionEvent {
  ts?: string
  actor?: string
  entity?: string
  entity_id?: string
  op?: string
  payload?: { prospect_id?: string; channel?: string; body?: string; subject?: string | null }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const prospectId = (url.searchParams.get('prospect_id') || '').trim()
  const channel = url.searchParams.get('channel') === 'whatsapp' ? 'whatsapp' : 'email'
  if (!prospectId) return NextResponse.json({ error: 'prospect_id required' }, { status: 400 })

  try {
    if (!existsSync(EVENTS_DIR)) return NextResponse.json({ draft: null })
    let best: { body: string; subject: string | null; created_at: string } | null = null
    let bestTs = ''
    for (const f of readdirSync(EVENTS_DIR).filter((x) => x.endsWith('.jsonl'))) {
      const lines = readFileSync(join(EVENTS_DIR, f), 'utf-8').split('\n')
      for (const line of lines) {
        if (!line.includes('"entity":"suggestion"') || !line.includes(`"${prospectId}"`)) continue
        let ev: SuggestionEvent
        try { ev = JSON.parse(line) as SuggestionEvent } catch { continue }
        if (ev.entity !== 'suggestion' || ev.op !== 'upsert' || ev.actor !== 'consular') continue
        const p = ev.payload
        if (!p || p.prospect_id !== prospectId || p.channel !== channel || !p.body) continue
        const ts = ev.ts || ''
        if (ts >= bestTs) { bestTs = ts; best = { body: p.body, subject: p.subject ?? null, created_at: ts } }
      }
    }
    return NextResponse.json({ draft: best })
  } catch (err) {
    return NextResponse.json({ draft: null, error: String(err) }, { status: 500 })
  }
}
