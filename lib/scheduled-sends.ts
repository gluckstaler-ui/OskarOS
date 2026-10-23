// ============================================================================
// lib/scheduled-sends.ts — scheduled WhatsApp/email sends (Ralph 2026-08-22)
//
// A scheduled send is a DELAYED BUTTON-PRESS: the composer stores the exact
// payload it would have POSTed to email-outbound / wa-outbound, plus a due
// time. A ticker (started once from instrumentation.ts) fires due rows by
// calling those same gated routes — no second transport path, WP-111 intact.
//
// DELIBERATELY NODE-LOCAL — not event-backed, not carried by Button-A sync.
// The event log replays on every node; a scheduled send that synced would
// fire on the Mac AND the server → double delivery. This table lives only in
// the local crm.db projection: the send fires exactly once, on the node where
// it was scheduled — the same semantics as clicking Send there later.
// ============================================================================

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/crm-boot'

export const SCHEDULED_SENDS_DDL = `
  CREATE TABLE IF NOT EXISTS scheduled_sends (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id TEXT NOT NULL,
    channel     TEXT NOT NULL,            -- 'email' | 'whatsapp'
    to_addr     TEXT,                     -- email only
    subject     TEXT,                     -- email only
    body        TEXT NOT NULL,
    in_reply_to TEXT,                     -- email only
    attachments TEXT,                     -- email only: JSON array of media/ paths
    send_at     TEXT NOT NULL,            -- ISO, UTC
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | sent | failed
    error       TEXT,
    created_at  TEXT NOT NULL,
    sent_at     TEXT
  );
`

export interface ScheduledSend {
  id: number
  prospect_id: string
  channel: 'email' | 'whatsapp'
  to_addr: string | null
  subject: string | null
  body: string
  in_reply_to: string | null
  attachments: string | null
  send_at: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  error: string | null
  created_at: string
  sent_at: string | null
}

// The table ships after the running server's boot DDL — ensure lazily so the
// API route works over HMR without a restart (CREATE IF NOT EXISTS is cheap).
function db() {
  const d = getDb()
  d.exec(SCHEDULED_SENDS_DDL)
  // attachments arrived after the first tables were created (2026-08-22, same
  // day) — idempotent add for any crm.db that already has the v1 shape.
  try { d.exec(`ALTER TABLE scheduled_sends ADD COLUMN attachments TEXT`) } catch { /* exists */ }
  return d
}

export function createScheduledSend(input: {
  prospect_id: string
  channel: 'email' | 'whatsapp'
  to_addr?: string
  subject?: string
  body: string
  in_reply_to?: string
  attachments?: string[]
  send_at: string
}): ScheduledSend {
  const now = new Date().toISOString()
  const r = db().prepare(`
    INSERT INTO scheduled_sends (prospect_id, channel, to_addr, subject, body, in_reply_to, attachments, send_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(input.prospect_id, input.channel, input.to_addr || null, input.subject || null,
    input.body, input.in_reply_to || null,
    input.attachments?.length ? JSON.stringify(input.attachments) : null,
    input.send_at, now)
  return db().prepare(`SELECT * FROM scheduled_sends WHERE id = ?`).get(Number(r.lastInsertRowid)) as unknown as ScheduledSend
}

export function listScheduledSends(prospect_id?: string, channel?: string): ScheduledSend[] {
  // Pending + failed are the rows the composer needs to show; sent rows are
  // history (the send itself already logged an activity) — keep the last few
  // days for reassurance, hide the rest.
  const cutoff = new Date(Date.now() - 3 * 24 * 3600_000).toISOString()
  const rows = db().prepare(`
    SELECT * FROM scheduled_sends
    WHERE (status IN ('pending','sending','failed') OR (status = 'sent' AND sent_at >= ?))
      AND (? IS NULL OR prospect_id = ?)
      AND (? IS NULL OR channel = ?)
    ORDER BY send_at ASC
  `).all(cutoff, prospect_id ?? null, prospect_id ?? null, channel ?? null, channel ?? null)
  return rows as unknown as ScheduledSend[]
}

export interface CancelResult {
  ok: boolean
  // The unsent payload of a canceled pending/failed row — never destroyed.
  restored?: {
    prospect_id: string
    channel: string
    body: string
    subject: string | null
    in_reply_to: string | null
    to_addr: string | null
  }
  // 'suggestions'   → written back into the composer's draft slot (durable)
  // 'response-only' → slot already holds a newer draft; caller gets the text
  restored_to?: 'suggestions' | 'response-only'
}

export async function cancelScheduledSend(id: number): Promise<CancelResult> {
  // Cancels a pending row or dismisses a failed/sent one. A row mid-'sending'
  // is left alone — the ticker owns it for those few seconds.
  //
  // CANCEL NEVER DESTROYS TEXT (Ralph 2026-08-25): a pending or failed row
  // still holds an unsent email whose only copy is this row — the composer
  // discarded the draft at schedule time. Before deleting the row, hand the
  // payload back through the CANONICAL path (event-logged upsertSuggestion —
  // suggestions is a replayed projection; a raw INSERT here would vanish on
  // the next replay): into the draft slot if it is free, otherwise only in
  // the return value so the UI can restore it — a newer draft in the slot is
  // never bulldozed.
  const { readSuggestion, upsertSuggestion } = await import('@/lib/crm-store')
  const d = db()
  const row = d.prepare(`SELECT * FROM scheduled_sends WHERE id = ?`).get(id) as ScheduledSend | undefined
  if (!row || row.status === 'sending') return { ok: false }
  const r = d.prepare(`DELETE FROM scheduled_sends WHERE id = ? AND status != 'sending'`).run(id)
  if (r.changes === 0) return { ok: false }
  if (row.status !== 'pending' && row.status !== 'failed') return { ok: true } // 'sent' = pure history dismissal
  const channel = row.channel === 'whatsapp' ? ('whatsapp' as const) : ('email' as const)
  const slotFree = readSuggestion(row.prospect_id, channel) === null
  if (slotFree) {
    await upsertSuggestion({
      prospect_id: row.prospect_id, channel, body: row.body,
      subject: row.subject, in_reply_to: row.in_reply_to, actor: 'filippo',
    })
  }
  return {
    ok: true,
    restored: {
      prospect_id: row.prospect_id, channel: row.channel, body: row.body,
      subject: row.subject, in_reply_to: row.in_reply_to, to_addr: row.to_addr,
    },
    restored_to: slotFree ? 'suggestions' : 'response-only',
  }
}

// ── Ticker ──────────────────────────────────────────────────────────────────

async function fireOne(row: ScheduledSend): Promise<void> {
  const isEmail = row.channel === 'email'
  const payload = isEmail
    ? {
        prospect_id: row.prospect_id, to: row.to_addr, subject: row.subject || '',
        body: row.body, in_reply_to: row.in_reply_to || undefined,
        attachments: row.attachments ? (JSON.parse(row.attachments) as string[]) : undefined,
        // The pending suggestion at FIRE time may be a newer, unrelated draft —
        // consuming it would bulldoze work in progress. The composer already
        // discarded the draft this send was built from at SCHEDULE time.
        skip_suggestion: true,
      }
    : { prospect_id: row.prospect_id, body: row.body }
  const routePath = isEmail
    ? '/api/admin/crm/activities/email-outbound'
    : '/api/admin/crm/activities/wa-outbound'
  // Call the route handler in-process (both handlers read only req.json()).
  // No HTTP self-call: on the server the app sits behind LiteSpeed/Passenger
  // where loopback URLs are unreliable.
  const mod = isEmail
    ? await import('@/app/api/admin/crm/activities/email-outbound/route')
    : await import('@/app/api/admin/crm/activities/wa-outbound/route')
  const req = new NextRequest('http://oskar.internal' + routePath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const res = await mod.POST(req)
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
}

async function tick(): Promise<void> {
  const now = new Date().toISOString()
  const due = db().prepare(`
    SELECT * FROM scheduled_sends WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC
  `).all(now) as unknown as ScheduledSend[]
  for (const row of due) {
    // Claim before firing — a second overlapping tick must not double-send.
    const claimed = db().prepare(
      `UPDATE scheduled_sends SET status = 'sending' WHERE id = ? AND status = 'pending'`,
    ).run(row.id)
    if (claimed.changes === 0) continue
    try {
      await fireOne(row)
      db().prepare(`UPDATE scheduled_sends SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`)
        .run(new Date().toISOString(), row.id)
      console.log(`[scheduled-sends] fired #${row.id} ${row.channel} → prospect ${row.prospect_id}`)
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err)
      db().prepare(`UPDATE scheduled_sends SET status = 'failed', error = ? WHERE id = ?`).run(msg, row.id)
      console.warn(`[scheduled-sends] #${row.id} ${row.channel} failed: ${msg}`)
    }
  }
}

const TICK_MS = 20_000

export function startScheduledSendTicker(): void {
  // globalThis-pinned like the WhatsApp runtime singleton — instrumentation
  // runs once per boot, but the guard keeps a dev HMR edge from doubling it.
  const g = globalThis as { __scheduledSendTicker?: ReturnType<typeof setInterval> }
  if (g.__scheduledSendTicker) return
  g.__scheduledSendTicker = setInterval(() => {
    void tick().catch((err) => console.warn('[scheduled-sends] tick failed:', err))
  }, TICK_MS)
  g.__scheduledSendTicker.unref?.()
  console.log('[scheduled-sends] ticker started (every 20s)')
}
