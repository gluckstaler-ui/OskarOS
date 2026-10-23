// ============================================================================
// lib/auto-respond.ts — Consular auto-respond for flagged prospects
// (Ralph 2026-08-22)
//
// Prospects with `auto_respond` = 1 get their inbound answered BY the Consular
// directly, guided by the prospect's `auto_respond_goals` text.
//
// Three moving parts:
//   1. maybeAutoRespond(prospectId) — the ingest hook. Called where inbound
//      already lands (wa-inbound-dispatch for WhatsApp In, mail-eyes for
//      E-mail In). Arms a 3-minute quiet-window timer per prospect; every new
//      inbound resets it. When the burst ends, ONE Consular turn sees all of it.
//   2. runAutoRespond(prospectId) — collects inbound newer than the prospect's
//      watermark and hands it to the Consular bridge with the AUTO-RESPOND
//      directive. The Consular answers by POSTing the gated outbound routes
//      himself (he has shell + HTTP) — this module never touches the transport
//      and never parses his output. Watermark advances after the turn.
//   3. startAutoRespondHeartbeat() — every 15 minutes: run the mail sweep
//      (email only arrives when swept), then process every flagged prospect.
//      Catches debounce timers lost to restarts. WhatsApp needs no pull here:
//      the runtime's own 5-minute reconnect loop keeps the socket fed.
//
// NODE-LOCAL by design (like scheduled-sends): the watermark table lives only
// in this node's crm.db and the timers in this process — the flag itself is an
// event-logged prospect field and syncs, but only the node running the
// heartbeat answers (the one with mail config + paired WhatsApp).
// ============================================================================

import { getDb } from '@/lib/crm-boot'
import { callConsularBridge } from '@/lib/consular-bridge-call'

const STATE_DDL = `
  CREATE TABLE IF NOT EXISTS auto_respond_state (
    prospect_id     TEXT PRIMARY KEY,
    processed_until TEXT NOT NULL
  );
`

const QUIET_WINDOW_MS = 3 * 60_000
const HEARTBEAT_MS = 15 * 60_000

function db() {
  const d = getDb()
  d.exec(STATE_DDL)
  return d
}

interface FlaggedProspect {
  id: string
  company: string
  email: string
  auto_respond_goals: string
}

function readFlagged(prospectId?: string): FlaggedProspect[] {
  const rows = prospectId
    ? db().prepare(`SELECT id, company, email, auto_respond_goals FROM prospects WHERE id = ? AND auto_respond = 1`).all(prospectId)
    : db().prepare(`SELECT id, company, email, auto_respond_goals FROM prospects WHERE auto_respond = 1`).all()
  return rows as unknown as FlaggedProspect[]
}

interface InboundRow {
  id: string
  timestamp: string
  type: 'WhatsApp In' | 'E-mail In'
  subject: string | null
  notes: string
  email_message_id: string | null
}

// ── The turn ────────────────────────────────────────────────────────────────

// Per-prospect serialization: the debounce timer and the heartbeat can both
// reach for the same prospect — the second caller waits, then finds the
// watermark already advanced and no-ops.
const inflight = new Map<string, Promise<void>>()

export function runAutoRespond(prospectId: string): Promise<void> {
  const prev = inflight.get(prospectId) || Promise.resolve()
  const next = prev.then(() => doRun(prospectId), () => doRun(prospectId))
  inflight.set(prospectId, next)
  next.finally(() => { if (inflight.get(prospectId) === next) inflight.delete(prospectId) })
  return next
}

async function doRun(prospectId: string): Promise<void> {
  const p = readFlagged(prospectId)[0]
  if (!p) return

  const mark = db().prepare(`SELECT processed_until FROM auto_respond_state WHERE prospect_id = ?`)
    .get(prospectId) as { processed_until: string } | undefined
  if (!mark) {
    // First contact with this flag: baseline to NOW. Only inbound arriving
    // AFTER activation gets answered — never the historical thread.
    db().prepare(`INSERT INTO auto_respond_state (prospect_id, processed_until) VALUES (?, ?)`)
      .run(prospectId, new Date().toISOString())
    return
  }

  const inbound = db().prepare(`
    SELECT id, timestamp, type, subject, notes, email_message_id
    FROM activities
    WHERE prospect_id = ? AND type IN ('WhatsApp In', 'E-mail In')
      AND soft_deleted = 0 AND timestamp > ?
    ORDER BY timestamp ASC
  `).all(prospectId, mark.processed_until) as unknown as InboundRow[]
  if (inbound.length === 0) return

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const lines = inbound.map((m) => {
    const head = `[${m.timestamp}] ${m.type}${m.subject ? ` · subject: ${m.subject}` : ''}${m.email_message_id ? ` · message-id: ${m.email_message_id}` : ''}`
    return `${head}\n${m.notes || '(empty)'}`
  })
  const directive =
    `[OSKAR-SYSTEM AUTO-RESPOND]\n\n` +
    `Prospect ${p.id} (${p.company}) is on autopilot — answer the new inbound below DIRECTLY, per your agent file's AUTO-RESPOND doctrine. You send; nobody reviews before the wire.\n\n` +
    `Filippo's communication goals for this client:\n${p.auto_respond_goals.trim() || '(none written — hold the line of the existing thread)'}\n\n` +
    `New inbound (oldest first):\n\n${lines.join('\n\n')}\n\n` +
    `Send via the gated routes on ${base}:\n` +
    `  WhatsApp → POST /api/admin/crm/activities/wa-outbound        {"prospect_id":"${p.id}","body":"…"}\n` +
    `  Email    → POST /api/admin/crm/activities/email-outbound     {"prospect_id":"${p.id}","to":"${p.email}","subject":"…","body":"…","in_reply_to":"<message-id of the mail you answer>"}\n` +
    `Answer on the channel the inbound came in on. One send per channel at most — bundle, don't fragment. If nothing needs an answer, write a one-line note activity saying why (your decline doctrine) and send nothing.`

  const newest = inbound[inbound.length - 1].timestamp
  try {
    const result = await callConsularBridge(directive)
    db().prepare(`UPDATE auto_respond_state SET processed_until = ? WHERE prospect_id = ?`)
      .run(newest, prospectId)
    console.log(`[auto-respond] ${p.id}: ${inbound.length} inbound handled — ${result.text.slice(0, 120)}`)
  } catch (err) {
    // Watermark NOT advanced — the next debounce fire or heartbeat retries.
    console.warn(`[auto-respond] ${p.id}: bridge turn failed (will retry):`, err)
  }
}

// ── The ingest hook (burst debounce) ────────────────────────────────────────

type TimerMap = Map<string, ReturnType<typeof setTimeout>>
function timers(): TimerMap {
  const g = globalThis as { __autoRespondTimers?: TimerMap }
  if (!g.__autoRespondTimers) g.__autoRespondTimers = new Map()
  return g.__autoRespondTimers
}

export function maybeAutoRespond(prospectId: string): void {
  try {
    if (readFlagged(prospectId).length === 0) return
  } catch {
    return // crm.db not booted yet (early inbound during startup) — heartbeat catches it
  }
  const t = timers()
  const existing = t.get(prospectId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    t.delete(prospectId)
    void runAutoRespond(prospectId).catch((err) =>
      console.warn(`[auto-respond] ${prospectId}: run failed:`, err))
  }, QUIET_WINDOW_MS)
  timer.unref?.()
  t.set(prospectId, timer)
}

// ── The 15-minute heartbeat ─────────────────────────────────────────────────

async function heartbeat(): Promise<void> {
  const flagged = readFlagged()
  if (flagged.length === 0) return

  // Pull: email only lands when a sweep runs. sweepMail is join-serialized —
  // a click on CHECK EMAIL during this is a join, not a second sweep. The
  // sweep's own ingest hook (maybeAutoRespond per fresh mail) arms debounce
  // timers; the pass below catches anything they'd miss after a restart.
  try {
    const { sweepMail } = await import('./mail-eyes')
    await sweepMail({})
  } catch (err) {
    console.warn('[auto-respond] heartbeat mail sweep failed (non-fatal):', err)
  }

  for (const p of flagged) {
    await runAutoRespond(p.id).catch((err) =>
      console.warn(`[auto-respond] heartbeat ${p.id} failed:`, err))
  }
}

export function startAutoRespondHeartbeat(): void {
  const g = globalThis as { __autoRespondHeartbeat?: ReturnType<typeof setInterval> }
  if (g.__autoRespondHeartbeat) return
  g.__autoRespondHeartbeat = setInterval(() => {
    void heartbeat().catch((err) => console.warn('[auto-respond] heartbeat failed:', err))
  }, HEARTBEAT_MS)
  g.__autoRespondHeartbeat.unref?.()
  console.log('[auto-respond] heartbeat started (every 15 min)')
}
