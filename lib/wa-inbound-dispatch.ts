// ============================================================================
// lib/wa-inbound-dispatch.ts — inbound-message → CRM activity row
// WP-CRM-F19 (Ralph 2026-05-25)
//
// Extracted from app/api/admin/crm/activities/wa-inbound/route.ts during the
// bridge→runtime merge. Both the HTTP route (kept for e2e tests) and the
// in-process WhatsApp runtime call this function directly, so there's only
// one code path for "decide which lead an incoming WhatsApp message belongs
// to and write its activity row."
//
// Unmatched senders (phone not in CRM) are stashed in
// public/_whatsapp/unmatched.jsonl for later triage. We do NOT auto-create
// prospect rows from unknown senders — that's a manual call.
// ============================================================================
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { readSheet, writeSheet, appendActivity, normalizeWhatsAppNumber } from './crm-store'

export interface InboundPayload {
  phone?: string
  body?: string
  wa_message_id?: string
  timestamp?: string | number
  push_name?: string
  media_path?: string
  media_mime?: string
}

export interface InboundResult {
  matched: boolean
  stashed?: boolean
  prospect_id?: string
  activity_id?: string
  error?: string
}

const UNMATCHED_DIR = join(process.cwd(), 'public', '_whatsapp')
const UNMATCHED_PATH = join(UNMATCHED_DIR, 'unmatched.jsonl')

function isoFromTs(ts: string | number | undefined): string {
  if (!ts) return new Date().toISOString()
  if (typeof ts === 'number') return new Date(ts * 1000).toISOString()
  const n = Number(ts)
  if (Number.isFinite(n) && n > 1_000_000_000) return new Date(n * 1000).toISOString()
  return ts
}

export async function dispatchInboundToCrm(payload: InboundPayload): Promise<InboundResult> {
  const incomingPhone = normalizeWhatsAppNumber(payload.phone)
  if (!incomingPhone) {
    return { matched: false, error: 'phone required' }
  }

  // O(N) prospect scan. Fine for 30–50 leads; would be a hash lookup at
  // 1000+ scale. Indexing belongs in a future crm-store refactor, not here.
  const prospects = readSheet()
  let matched: { id: string } | null = null
  for (const p of prospects) {
    if (normalizeWhatsAppNumber(p.phone) === incomingPhone) {
      matched = { id: p.id }
      break
    }
  }

  const timestamp = isoFromTs(payload.timestamp)
  const hasMedia = !!payload.media_path
  const hasMime = !!payload.media_mime
  const rawText = (payload.body ?? '').trim()
  // Caption present → use it. Otherwise:
  //  - Media downloaded → empty text; UI renders thumbnail/audio/etc.
  //  - Media node present but download failed/skipped → '[Media — not imported]'
  //  - No media node and no text → '[empty message]'.
  const text =
    rawText  ? rawText
    : hasMedia ? ''
    : hasMime  ? '[Media — not imported]'
    :            '[empty message]'

  if (!matched) {
    try {
      if (!existsSync(UNMATCHED_DIR)) mkdirSync(UNMATCHED_DIR, { recursive: true })
      appendFileSync(UNMATCHED_PATH, JSON.stringify({
        phone: incomingPhone,
        push_name: payload.push_name ?? null,
        body: text,
        wa_message_id: payload.wa_message_id ?? null,
        media_path: payload.media_path ?? null,
        media_mime: payload.media_mime ?? null,
        timestamp,
      }) + '\n')
    } catch (err) {
      console.warn('[wa-inbound-dispatch] unmatched.jsonl write failed:', err)
    }
    return { matched: false, stashed: true }
  }

  // Ralph 2026-05-25 · #1 · reply-based snooze auto-promote.
  // If the matched prospect is in 'Awaiting reply' state, an inbound message
  // means "they replied" — flip the status back to 'To do' and write a
  // status_changed audit row so the timeline shows the transition. The
  // existing prospects array is already loaded above.
  const fullProspect = prospects.find(p => p.id === matched.id)
  if (fullProspect && fullProspect.status === 'Awaiting reply') {
    const prevStatus = fullProspect.status
    fullProspect.status = 'To do'
    try {
      await writeSheet(prospects)
      await appendActivity({
        prospect_id: matched.id,
        type: 'status_changed',
        icon: 'message-circle',
        color: '#25D366',
        notes: `${prevStatus} → To do (they replied)`,
        timestamp,
      })
    } catch (err) {
      // Non-fatal — log + continue. The WhatsApp In activity below still lands.
      console.warn('[wa-inbound-dispatch] reply-snooze auto-promote failed:', err)
    }
  }

  // Matched — write WhatsApp In activity. appendActivity dedups on
  // (wa_message_id, prospect_id) so bridge replays are safe.
  const activity = await appendActivity({
    prospect_id: matched.id,
    type: 'WhatsApp In',
    icon: 'message-circle',
    color: '#25D366',
    notes: text,
    wa_message_id: payload.wa_message_id ?? '',
    media_path: payload.media_path ?? '',
    media_mime: payload.media_mime ?? '',
    timestamp,
  })

  return { matched: true, prospect_id: matched.id, activity_id: activity.id }
}

// ============================================================================
// Promote unmatched WAs for a phone (called when a contact is created/edited)
// ----------------------------------------------------------------------------
// Ralph 2026-05-31 · Marin-Tomasic regression.
// `dispatchInboundToCrm` only scans `prospects.phone` to decide where a new WA
// lands. It does NOT scan `contacts.phone`. So when a WA arrives from a number
// that belongs to a contact (e.g. an employee's mobile, not the company's main
// phone on the prospect row), it gets stashed in unmatched.jsonl — and stays
// there forever, even after the user later creates the contact with that
// phone, because nothing rescans the buffer.
//
// This function is the missing rescan: given a phone + prospect_id, it finds
// every buffered message whose sender phone normalizes to the same number,
// promotes each into a `WhatsApp In` activity on that prospect (via
// `appendActivity`, which dedupes on wa_message_id+prospect_id so reruns are
// safe), and rewrites the buffer with the promoted entries removed.
//
// Call sites:
//  - POST /api/admin/crm/prospects/[id]/contacts (after addContact)  ← create
//  - one-off backfill scripts                                        ← cleanup
// Future: hook into the contact-PATCH `phone` field too if the phone-edit
// case becomes a real pattern. Not added today — Ralph asked for create only.
// ============================================================================

export interface PromoteResult {
  promoted: number          // # of activities created/deduped
  activity_ids: string[]    // their ids (in unmatched-buffer order)
  prospect_id: string
}

export async function promoteUnmatchedForPhone(
  rawPhone: string | undefined | null,
  prospect_id: string,
): Promise<PromoteResult> {
  const normalized = normalizeWhatsAppNumber(rawPhone)
  if (!normalized || !prospect_id) {
    return { promoted: 0, activity_ids: [], prospect_id }
  }
  if (!existsSync(UNMATCHED_PATH)) {
    return { promoted: 0, activity_ids: [], prospect_id }
  }

  const content = await readFile(UNMATCHED_PATH, 'utf8')
  const remaining: string[] = []
  const matches: Array<Record<string, unknown>> = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Keep corrupted lines untouched — don't silently drop on disk.
      remaining.push(line)
      continue
    }
    if (normalizeWhatsAppNumber(parsed.phone as string | undefined) === normalized) {
      matches.push(parsed)
    } else {
      remaining.push(line)
    }
  }

  if (matches.length === 0) {
    // No matches → don't rewrite the file (avoids spurious mtime bumps and
    // dodges the unlikely-but-possible concurrent-append race).
    return { promoted: 0, activity_ids: [], prospect_id }
  }

  const activity_ids: string[] = []
  for (const m of matches) {
    const activity = await appendActivity({
      prospect_id,
      type: 'WhatsApp In',
      icon: 'message-circle',
      color: '#25D366',
      notes: typeof m.body === 'string' ? m.body : '',
      wa_message_id: (m.wa_message_id as string | null) ?? '',
      media_path: (m.media_path as string | null) ?? '',
      media_mime: (m.media_mime as string | null) ?? '',
      timestamp: (m.timestamp as string | undefined) ?? new Date().toISOString(),
    })
    activity_ids.push(activity.id)
  }

  // Write back only non-matching lines. Matches the dispatcher's trailing-
  // newline convention so the file stays append-friendly for the next inbound.
  const out = remaining.length
    ? remaining.filter(l => l.trim()).join('\n') + '\n'
    : ''
  try {
    if (!existsSync(UNMATCHED_DIR)) mkdirSync(UNMATCHED_DIR, { recursive: true })
    await writeFile(UNMATCHED_PATH, out, 'utf8')
  } catch (err) {
    // Non-fatal: activities already wrote (and dedupe on wa_message_id). The
    // promoted entries may briefly reappear in the wa-unmatched view until
    // the next successful rewrite; a manual retry will not double-post.
    console.warn('[wa-inbound-dispatch] promote: unmatched.jsonl rewrite failed:', err)
  }

  // Move this number's media into media/<phone>/ now that it's matched (Ralph
  // 2026-05-31). Moves by content-hash so it relocates BOTH pre-bucketing flat
  // files AND new media/unmatched/<phone>/ files. Best-effort — media_path URLs
  // are content-hash-only, so the serve route still resolves the files even if
  // the move fails; the stored media_path needs no rewrite.
  try {
    const hashes = matches
      .map((m) => (typeof m.media_path === 'string' ? m.media_path : ''))
      .filter((p) => p.startsWith('/api/admin/media/'))
      .map((p) => p.slice('/api/admin/media/'.length))
    if (hashes.length > 0) {
      const { moveMediaByHashes } = await import('./media-store')
      const moved = moveMediaByHashes(hashes, normalized)
      if (moved > 0) console.log(`[wa-inbound-dispatch] promote: moved ${moved} media file(s) → media/${normalized}/`)
    }
  } catch (err) {
    console.warn('[wa-inbound-dispatch] promote: media move failed (non-fatal):', err)
  }

  return { promoted: matches.length, activity_ids, prospect_id }
}
