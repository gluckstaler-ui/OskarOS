#!/usr/bin/env node
// ============================================================================
// scripts/backfill-location-activities.mjs
// Ralph 2026-05-26
//
// One-shot fix: WhatsApp activity rows whose source envelope is a
// locationMessage / liveLocationMessage but whose notes were written as
// '[empty message]' (because textFromMessage didn't handle locations
// before the 2026-05-26 fix). PATCHes those rows to '📍 Location shared'.
//
// Safe to re-run: only touches rows whose notes match the legacy
// '[empty message]' marker AND whose envelope is on disk AND is a
// location-type message. Real empty / decryption-fail rows are left alone.
//
// Usage:  node scripts/backfill-location-activities.mjs
//         OSKAR_URL=http://localhost:3000 node scripts/backfill-location-activities.mjs
// ============================================================================
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

const OSKAR_URL = process.env.OSKAR_URL || 'http://localhost:3000'
const MESSAGES_ROOT = join(process.cwd(), 'db', 'whatsapp', 'messages')

// Returns the body text we want to write into the activity row's notes,
// or null if the envelope is not a location message. Mirrors the
// textFromMessage logic in lib/wa-routing.mjs for locations.
async function locationBodyFromEnvelope(filePath) {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const env = JSON.parse(raw)
    let msg = env?.message
    if (!msg) return null
    for (let i = 0; i < 5; i++) {
      if (msg.ephemeralMessage?.message)           { msg = msg.ephemeralMessage.message;           continue }
      if (msg.viewOnceMessage?.message)            { msg = msg.viewOnceMessage.message;            continue }
      if (msg.viewOnceMessageV2?.message)          { msg = msg.viewOnceMessageV2.message;          continue }
      if (msg.viewOnceMessageV2Extension?.message) { msg = msg.viewOnceMessageV2Extension.message; continue }
      if (msg.documentWithCaptionMessage?.message) { msg = msg.documentWithCaptionMessage.message; continue }
      if (msg.editedMessage?.message)              { msg = msg.editedMessage.message;              continue }
      break
    }
    const loc = msg.locationMessage || msg.liveLocationMessage
    if (!loc) return null
    const lat = loc.degreesLatitude
    const lng = loc.degreesLongitude
    if (typeof lat === 'number' && typeof lng === 'number') {
      return `📍 Location shared · https://maps.google.com/?q=${lat},${lng}`
    }
    return '📍 Location shared'
  } catch {
    return null
  }
}

// Build wa_message_id → file path index from the envelope store.
async function indexEnvelopes() {
  const index = new Map()
  let dayDirs = []
  try {
    dayDirs = (await readdir(MESSAGES_ROOT, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch {
    console.error(`No envelope store at ${MESSAGES_ROOT}`)
    return index
  }
  for (const day of dayDirs) {
    const dayDir = join(MESSAGES_ROOT, day)
    let files = []
    try { files = await readdir(dayDir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const waId = f.replace(/\.json$/, '')
      // de-safeWaId: bridge writes safe filenames; the wa_message_id stored
      // in activities is the raw form. They match for [A-Z0-9] ids (the
      // current shape), so no transform needed for now.
      index.set(waId, join(dayDir, f))
    }
  }
  return index
}

async function main() {
  console.log('Indexing envelopes…')
  const envIndex = await indexEnvelopes()
  console.log(`  ${envIndex.size} envelopes on disk`)

  console.log(`Fetching activities from ${OSKAR_URL}…`)
  const res = await fetch(`${OSKAR_URL}/api/admin/crm/activities`)
  const data = await res.json()
  const acts = data.activities || []
  console.log(`  ${acts.length} activities total`)

  // Catch both the legacy '[empty message]' marker AND the in-between
  // '📍 Location shared' (label-only, no URL) written by the first version
  // of this script. The second pass upgrades those to include the maps link.
  const isStaleLocationNote = (n) => {
    const t = String(n || '').trim()
    if (t === '[empty message]') return true
    if (t === '📍 Location shared') return true  // legacy label-only
    return false
  }
  const candidates = acts.filter(a =>
    a.type === 'WhatsApp In' &&
    a.wa_message_id &&
    isStaleLocationNote(a.notes)
  )
  console.log(`  ${candidates.length} candidates with stale location notes`)

  let patched = 0
  let skipped = 0
  for (const a of candidates) {
    const envPath = envIndex.get(a.wa_message_id)
    if (!envPath) {
      console.log(`  SKIP ${a.id} (wa_id=${a.wa_message_id.slice(0,16)}): envelope not on disk`)
      skipped++
      continue
    }
    const body = await locationBodyFromEnvelope(envPath)
    if (!body) {
      // Envelope exists but isn't a location — real decryption-fail / protocol
      // message / something else. Leave the row's notes alone.
      skipped++
      continue
    }
    if (body === String(a.notes || '').trim()) {
      // Already up-to-date.
      skipped++
      continue
    }
    const r = await fetch(`${OSKAR_URL}/api/admin/crm/activities/${encodeURIComponent(a.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: body }),
    })
    if (!r.ok) {
      console.log(`  FAIL ${a.id} (wa_id=${a.wa_message_id.slice(0,16)}): ${r.status} ${r.statusText}`)
      continue
    }
    console.log(`  PATCH ${a.id} (ts=${a.timestamp?.slice(0,19)}, wa_id=${a.wa_message_id.slice(0,16)})`)
    console.log(`         → ${body}`)
    patched++
  }
  console.log(`\nDone. patched=${patched} skipped=${skipped}`)
}

main().catch(err => {
  console.error('ERR:', err)
  process.exit(1)
})
