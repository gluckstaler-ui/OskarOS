// ============================================================================
// backfill-untruncate-activities.mjs — repair rows written under the old
// 400-char (email) / 200-char (WhatsApp, vanilla) note clamps.
//
// Filippo 2026-08-18: "messages don't get truncated in message history."
// The render clamp and the write clamps are gone (LeadDetail FeedRow,
// email-outbound, mail-eyes, wa-outbound). This repairs the rows that were
// already stored short — the feed is the archive, and an archive that stops
// mid-word is not one.
//
// Source of truth = the raw .eml on disk (media/<slug>/eml/<folder>-<uv>-<uid>.eml),
// matched to the activity by Message-ID. Body extraction is IDENTICAL to
// lib/mail-eyes.ts so a repaired row reads exactly like a freshly swept one.
//
// SAFETY — only ever EXTENDS. A row is rewritten only when the parsed body
// starts with what is already stored (whitespace-insensitive prefix). A
// divergent body is reported, never written: Darth Bulldozer does not get to
// overwrite Filippo's history on a guess.
//
//   node scripts/backfill-untruncate-activities.mjs          # dry run
//   node scripts/backfill-untruncate-activities.mjs --write  # apply
// ============================================================================
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { simpleParser } from 'mailparser'
import Database from 'better-sqlite3'

const WRITE = process.argv.includes('--write')
const DB_PATH = join(process.cwd(), 'db', 'crm.db')
const MEDIA_DIR = join(process.cwd(), 'media')

// Same normalization mail-eyes applies before storing.
const normalize = (s) =>
  s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

// Comparison key: whitespace collapsed, trailing ellipsis dropped (the old
// vanilla renderer stored the "…" it appended).
const cmpKey = (s) => s.replace(/[…\s]+$/g, '').replace(/\s+/g, ' ').trim()

function emlFiles() {
  const out = []
  if (!existsSync(MEDIA_DIR)) return out
  for (const slug of readdirSync(MEDIA_DIR)) {
    const dir = join(MEDIA_DIR, slug, 'eml')
    let files
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files) if (f.endsWith('.eml')) out.push(join(dir, f))
  }
  return out
}

const db = new Database(DB_PATH)
const rows = db
  .prepare(`SELECT id, prospect_id, type, timestamp, email_message_id, notes
              FROM activities
             WHERE email_message_id IS NOT NULL AND email_message_id <> ''`)
  .all()
const byMsgId = new Map(rows.map((r) => [String(r.email_message_id).trim(), r]))

let extended = 0, alreadyFull = 0, divergent = 0, unmatched = 0
const updates = []

for (const path of emlFiles()) {
  const raw = readFileSync(path)
  const parsed = await simpleParser(raw)
  const msgId = String(parsed.messageId || '').trim()
  if (!msgId) continue
  const row = byMsgId.get(msgId)
  if (!row) { unmatched++; continue }

  const text = (parsed.text || parsed.html?.toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') || '').trim()
  const full = normalize(text)
  // Keep any attachment suffix the original row carried (" · 📎 file.pdf").
  const attachSuffix = (String(row.notes).match(/ · 📎 .*$/s) || [''])[0]
  const stored = String(row.notes).replace(/ · 📎 .*$/s, '')

  if (cmpKey(full) === cmpKey(stored)) { alreadyFull++; continue }
  if (!cmpKey(full).startsWith(cmpKey(stored))) {
    divergent++
    console.log(`  ~ ${row.id} ${row.type} — parsed body diverges from stored (left alone)`)
    console.log(`      stored : ${cmpKey(stored).slice(0, 90)}`)
    console.log(`      parsed : ${cmpKey(full).slice(0, 90)}`)
    continue
  }
  extended++
  updates.push({ id: row.id, notes: full + attachSuffix, was: stored.length, now: full.length, type: row.type, ts: row.timestamp })
}

// ── Source 2: the event journal (db/events/*.jsonl) ─────────────────────────
// An OUTBOUND mail sent from the composer has no local .eml (the Sent copy
// lives on the IMAP server). But the CRM's own append-only journal recorded
// the composer's state — the `suggestion upsert` immediately preceding the
// send IS the text that went out. Same strict prefix guard: the stored
// (clamped) note must be a prefix of the journal body, or nothing is written.
function journalSuggestions() {
  const out = []
  const dir = join(process.cwd(), 'db', 'events')
  let files
  try { files = readdirSync(dir) } catch { return out }
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue
      let e
      try { e = JSON.parse(line) } catch { continue }
      if (e.entity !== 'suggestion' || e.op !== 'upsert') continue
      const body = e.payload?.body
      if (!body || !e.payload?.prospect_id) continue
      out.push({ prospect_id: e.payload.prospect_id, channel: e.payload.channel || 'email', ts: e.ts, body })
    }
  }
  return out
}

const already = new Set(updates.map((u) => u.id))
const suggestions = journalSuggestions()
if (suggestions.length) {
  const short = db
    .prepare(`SELECT id, prospect_id, type, timestamp, notes FROM activities
               WHERE type IN ('E-mail Out', 'WhatsApp Out')`)
    .all()
  for (const row of short) {
    if (already.has(row.id)) continue
    const channel = row.type === 'E-mail Out' ? 'email' : 'whatsapp'
    // Latest composer state at or before the send.
    const cand = suggestions
      .filter((s) => s.prospect_id === row.prospect_id && s.channel === channel && s.ts <= row.timestamp)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))[0]
    if (!cand) continue
    const attachSuffix = (String(row.notes).match(/ · 📎 .*$/s) || [''])[0]
    const stored = String(row.notes).replace(/ · 📎 .*$/s, '')
    const full = normalize(cand.body)
    if (cmpKey(full) === cmpKey(stored)) { alreadyFull++; continue }
    if (!cmpKey(full).startsWith(cmpKey(stored))) continue   // not the same mail — silence, not a guess
    extended++
    updates.push({ id: row.id, notes: full + attachSuffix, was: stored.length, now: full.length, type: row.type, ts: row.timestamp, src: 'journal' })
  }
}

for (const u of updates) {
  console.log(`  + ${u.id} ${u.type} ${String(u.ts).slice(0, 10)} — ${u.was} → ${u.now} chars  [${u.src || 'eml'}]`)
}

if (WRITE && updates.length) {
  const stmt = db.prepare('UPDATE activities SET notes = ? WHERE id = ?')
  const tx = db.transaction((list) => { for (const u of list) stmt.run(u.notes, u.id) })
  tx(updates)
}

console.log(
  `\n${WRITE ? 'WROTE' : 'DRY RUN'} — extended ${extended}, already full ${alreadyFull}, ` +
  `divergent ${divergent} (untouched), eml with no activity row ${unmatched}`,
)
db.close()
