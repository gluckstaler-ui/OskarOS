// ==========================================
// POSTMASTER · Eyes — the IMAP sweep (PM-1, spec §04)
//
// Filippo 2026-07-13: NO sidecars, NO db/mail. One raw copy per mail:
//   media/<client-slug>/eml/<folder>-<uidvalidity>-<uid>.eml
// (unmatched → media/unmatched/eml/). The FILENAME is the metadata: folder
// keeps INBOX/Sent apart, uidvalidity detects server renumbering, uid is the
// high-water mark. Everything the sidecar used to carry lives either in the
// filename, in the activity row (subject, excerpt, message-id, thread), or
// is re-parsed from the eml on demand (the unmatched banner).
//
// Extracts INBOUND attachments to media/<client-slug>/, files matched mails
// as E-mail In / E-mail Out activities through the event log (appendActivity
// carries the global Message-ID dedup, so sweeps are idempotent:
// crash-resume, UIDVALIDITY resets and self-CC all absorb).
//
// NO cursor at all (Filippo 2026-07-13): the sweep is ADDRESS-DRIVEN — per
// client address a server-side IMAP SEARCH, fetch only what's not on disk.
// Nothing unconnected to a client is ever downloaded. Cursor, backfill and
// re-match all collapsed into this one primitive: a new contact address
// pulls its whole history off the server on the next sweep.
//
// Matching is the deterministic layer: exact address → contacts.email /
// prospects.email. media/unmatched/eml/ IS the unmatched pool — derived,
// parsed on demand, never stored twice (PM-4's banner reads it).
//
// One serialized sweep: a trigger while one runs JOINS it (spec §04 — never
// a stacked second sweep). Progress is a module-level object the status
// route reads; `failed` is a first-class phase (a crash must never read as
// a verdict that didn't come).
//
// Owner: the hub. media/ is per-node, excluded from Button-A sync; only
// activity events travel.
// ==========================================

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { JSDOM } from 'jsdom'
import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import { readMailConfig } from './mail-config'
import { getDb } from './crm-boot'
import { appendActivity, type Activity } from './crm-store'

const MEDIA_DIR = join(process.cwd(), 'media')
const FOLDERS = ['INBOX', 'Sent'] as const
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024   // spec §14: >25 MB → headers+text only

export type SweepPhase =
  | 'idle' | 'connecting' | 'listing' | 'downloading' | 'filing' | 'done' | 'failed'

export interface SweepProgress {
  phase: SweepPhase
  folder?: string
  done_n: number
  total_n: number
  attachment?: string
  error?: string
  failed_phase?: string
  started_at?: string
  finished_at?: string
  filed: number
  new_mail: string[]            // eml paths of this sweep's new INBOX mail (the briefing list source)
}

const progress: SweepProgress = { phase: 'idle', done_n: 0, total_n: 0, filed: 0, new_mail: [] }
export function getMailProgress(): SweepProgress { return { ...progress, new_mail: [...progress.new_mail] } }

function setPhase(phase: SweepPhase, patch: Partial<SweepProgress> = {}) {
  Object.assign(progress, patch, { phase })
}

// ─── eml store cursor (no state file, no sidecars) ──────────────────────────

const EML_RE = /^(INBOX|Sent)-(\d+)-(\d+)\.eml$/

function emlDir(slug: string): string { return join(MEDIA_DIR, slug, 'eml') }

/** One scan over every media/<slug>/eml/ dir. Cheap at bureau scale. */
function listAllEml(): Array<{ slug: string; folder: string; uidValidity: number; uid: number; path: string }> {
  if (!existsSync(MEDIA_DIR)) return []
  const out: Array<{ slug: string; folder: string; uidValidity: number; uid: number; path: string }> = []
  for (const slug of readdirSync(MEDIA_DIR)) {
    const dir = emlDir(slug)
    let files: string[]
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files) {
      const m = EML_RE.exec(f)
      if (m) out.push({ slug, folder: m[1], uidValidity: Number(m[2]), uid: Number(m[3]), path: join(dir, f) })
    }
  }
  return out
}

// (No cursor functions: the address-driven SEARCH sweep replaced the
//  high-water mark entirely — "what do we have" is the filename set,
//  "what exists" is the server's SEARCH answer, the delta is the fetch.)

// ─── attachment filename sanitization (spec §14 — client-controlled names) ──

export function sanitizeFilename(name: string): string {
  const base = basename(String(name || 'attachment'))            // kills ../ and path segments
    .replace(/[^\w.\- ]+/g, '_')                                  // charset clamp
    .replace(/\.{2,}/g, '.')                                      // no dot runs
    .replace(/^[.\s]+/, '')                                       // no hidden/blank prefix
    .slice(0, 120)
  return base || 'attachment'
}

/**
 * Idempotent target path: same name + same byte size ⇒ the SAME file (a
 * re-swept mail reuses its extraction instead of minting `-1` copies —
 * sweeps must be re-runnable end to end). A genuine name collision with
 * different content still gets a numbered suffix.
 */
function attachmentPath(dir: string, name: string, size: number): { path: string; reused: boolean } {
  let candidate = name, i = 1
  for (;;) {
    const p = join(dir, candidate)
    if (!existsSync(p)) return { path: p, reused: false }
    try { if (statSync(p).size === size) return { path: p, reused: true } } catch { /* race → suffix */ }
    const dot = name.lastIndexOf('.')
    candidate = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`
    i++
  }
}

// ─── deterministic identity: exact address → prospect ───────────────────────

export function slugify(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unknown'
}

export function matchProspectByEmail(address: string): { id: string; company: string } | null {
  const addr = address.trim().toLowerCase()
  if (!addr) return null
  const db = getDb()
  const viaContact = db.prepare(`
    SELECT p.id, p.company FROM contacts c JOIN prospects p ON p.id = c.prospect_id
    WHERE lower(c.email) = ? LIMIT 1
  `).get(addr) as { id: string; company: string } | undefined
  if (viaContact) return viaContact
  const viaProspect = db.prepare(`
    SELECT id, company FROM prospects WHERE lower(email) = ? LIMIT 1
  `).get(addr) as { id: string; company: string } | undefined
  return viaProspect ?? null
}

// ─── the pure core: one fetched message → files + activity ──────────────────

interface ProcessResult {
  emlPath: string
  filed: boolean                 // activity created (or already existed via dedup)
  prospectId?: string
  attachments: string[]          // media paths written
  messageId: string
}

export async function processFetchedMessage(
  folder: (typeof FOLDERS)[number],
  uid: number,
  uidValidity: number,
  raw: Buffer,
): Promise<ProcessResult> {
  const parsed: ParsedMail = await simpleParser(raw)
  const direction = folder === 'Sent' ? 'out' : 'in'
  const messageId = parsed.messageId || `<missing-${folder}-${uid}@oskar.local>`
  const references = ([] as string[]).concat(parsed.references || [])
  const threadId = references[0] || parsed.inReplyTo || messageId
  const fromAddr = parsed.from?.value?.[0]?.address || ''
  const toAddrs = ([] as string[]).concat(
    ...(Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : []).map(t => t.value.map(v => v.address || '')),
  ).filter(Boolean)

  // Counterpart = the client's side of the mail: sender on inbound, recipient on outbound.
  const counterpart = direction === 'in' ? fromAddr : (toAddrs[0] || '')
  const match = matchProspectByEmail(counterpart)
  const slug = slugify(match?.company || 'unmatched')

  // Attachments: extract INBOUND only (ours already exist on disk — spec §09;
  // Sent-sweep never re-downloads its own files). Oversized → listed, skipped.
  const written: string[] = []
  const attachmentMeta: Array<{ name: string; mime: string; path?: string; size: number }> = []
  if (direction === 'in') {
    for (const att of parsed.attachments || []) {
      const name = sanitizeFilename(att.filename || 'attachment')
      const size = att.content?.length ?? 0
      if (size > MAX_ATTACHMENT_BYTES) {
        attachmentMeta.push({ name, mime: att.contentType || '', size })
        continue
      }
      const mediaDir = join(MEDIA_DIR, slug)
      mkdirSync(mediaDir, { recursive: true })
      const { path: outPath, reused } = attachmentPath(mediaDir, name, size)
      if (!reused) writeFileSync(outPath, att.content)
      progress.attachment = basename(outPath)
      const rel = outPath.slice(process.cwd().length + 1)
      written.push(rel)
      attachmentMeta.push({ name: basename(outPath), mime: att.contentType || '', path: rel, size })
    }
  }

  // Canonical raw — media/<slug>/eml/<folder>-<uidvalidity>-<uid>.eml (the
  // ONLY copy besides the activity row; Filippo 2026-07-13, no sidecars).
  // Written BEFORE any cursor movement matters — the filename itself advances
  // the cursor, so a crash after this point refetches nothing; a crash before
  // it refetches and rewrites (idempotent).
  const dir = emlDir(slug)
  mkdirSync(dir, { recursive: true })
  const emlPath = join(dir, `${folder}-${uidValidity}-${uid}.eml`)
  writeFileSync(emlPath, raw)
  const text = (parsed.text || parsed.html?.toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') || '').trim()

  // File the activity — matched mail only. Unmatched stays an eml in
  // media/unmatched/eml/ (the derived pool for PM-4's banner). appendActivity
  // dedups by Message-ID globally, so re-processing is a no-op.
  let filed = false
  if (match) {
    // Filippo 2026-07-13: store the FULL body, no truncation. The 400-char
    // excerpt lied — Filippo couldn't read his own client mail. Whitespace-
    // normalize preserved (paragraph breaks read fine as single blank lines).
    const excerpt = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    const activity: Activity = await appendActivity({
      prospect_id: match.id,
      type: direction === 'in' ? 'E-mail In' : 'E-mail Out',
      timestamp: (parsed.date || new Date()).toISOString(),
      subject: parsed.subject || '',
      notes: excerpt + (written.length ? ` · 📎 ${written.map(w => basename(w)).join(', ')}` : ''),
      user_id: direction === 'out' ? 'Filippo' : 'postmaster',
      email_message_id: messageId,
      email_thread_id: threadId,
      media_path: written[0] || '',
      media_mime: attachmentMeta[0]?.mime || '',
    })
    filed = Boolean(activity)
  }

  return { emlPath, filed, prospectId: match?.id, attachments: written, messageId }
}

/** Count-only variant for the status route (polled at 2s — no parsing, filenames suffice). */
export function countUnmatchedEml(): number {
  const dir = emlDir('unmatched')
  if (!existsSync(dir)) return 0
  let n = 0
  for (const f of readdirSync(dir)) { const m = EML_RE.exec(f); if (m && m[1] === 'INBOX') n++ }
  return n
}

/** Read ONLY the header block of an eml (first 64KB, cut at the blank line).
 *  simpleParser on a full eml decodes every attachment — 984 files took 71s;
 *  headers-only takes ~1s. From/Subject/Date live in the headers. */
function readHeaderBlock(path: string): Buffer {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    const n = readSync(fd, buf, 0, buf.length, 0)
    const slice = buf.subarray(0, n)
    const end = slice.indexOf('\r\n\r\n')
    return end === -1 ? slice : slice.subarray(0, end)
  } finally { closeSync(fd) }
}

/** Header-only classifier — three buckets (Filippo 2026-07-13):
 *    INBOX   — real 1:1 humans (needs your attention)
 *    UPDATES — transactional bulk (mail generated by something you DID:
 *              receipts, tickets, bookings, confirmations, invoices, account notifs, security alerts, appointments)
 *    OTHERS  — promotional bulk (newsletters, marketing pushes, social digests — noise)
 *
 *  Two-stage decision:
 *    A · Is this bulk at all?  (List-Unsubscribe / Feedback-ID / bounce Return-Path / ESP domain / bulk local-part / bulk subdomain)
 *        If NO  → Inbox.
 *    B · If bulk: transactional or promotional?
 *        Transactional signals win over promotional (a `deals@` from an airline about a booking = Updates, not Others).
 *        No signal either way → Others (safer: promotional false-positive costs less than a wrongly-flagged transactional).
 */
const ESP_DOMAIN_RE = /@([a-z0-9-]+\.)*(amazonses\.com|mandrillapp\.com|sparkpostmail\.com|sendgrid\.net|mailgun\.(org|net)|sendinblue\.com|postmarkapp\.com|mailchimp\.com|mailchimpapp\.net|rsgsv\.net|cmail\d+\.com|mailjet\.com|constantcontact\.com|hubspotemail\.net|createsend\d*\.com|customeriomail\.com|klaviyomail\.com|list-manage\.com)$/i
const BOUNCE_RP_RE = /(^|@)(bounce[s]?[+._-]|bounce\.|bounces?\+|msprvs1=|srs0=)/i
// Bulk local-part — matches the bulk word ANYWHERE in the local part, not just at the start,
// so `de_flt_noreply@trip.com`, `posts-recaps@`, `receipts+abc@` all hit.
const BULK_LOCAL_RE = /(?:^|[._+-])(no[-.]?reply|newsletter[s]?|notification[s]?|notify|mailer|mailing|marketing|news(?:letter)?|digest[s]?|reminder[s]?|alert[s]?|bulk|receipt[s]?|ticket[s]?|eticket[s]?|booking[s]?|order[s]?|billing|invoice[s]?|deal[s]?|promo[s]?|posts?|recap[s]?|updates?|hello-noreply|do[-_.]?not[-_.]?reply|automated|infomail|marketingmail|newsmail|salesmail|offer[s]?|webmaster|wordpress|visitus|mahnabteilung|timesheets?|automailer|autoresponder|systemnachricht|kontakt|announcement|comms)(?:[._+-]|$|@|[a-z]*@)/i
// Bulk subdomains — legit companies segregate bulk sends to `mail.brand.com`, `e.brand.com`,
// `messaging.brand.com`, `info.brand.com`, `news.brand.com`, `operational.brand.com`, …
const BULK_SUBDOMAIN_RE = /@(mail|email|e|em|mailings?|messaging|marketing|marketingmail|info|infomail|bounce[s]?|campaigns?|mailer|sender|send|newsletter[s]?|news|notify|notifications?|updates?|promo|offers?|sales|hello|greetings|deals|comms|announcements?|reply|delivery|transactional|operational|mailservice|relationship|contact|kontakt|service|noreply|do-not-reply|inbox|outbound|automated)\.[a-z0-9.-]+$/i

// ─── Stage B splits — transactional (Updates) vs promotional (Others) ─────────
// Transactional local-part: mail triggered by something YOU did
const TRANSACTIONAL_LOCAL_RE = /(?:^|[._+-])(receipt[s]?|ticket[s]?|eticket[s]?|booking[s]?|reservations?|order[s]?|orderno|orderconfirm|invoice[s]?|billing|rechnung(?:en)?|payment[s]?|zahlung(?:s|en)?|refund[s]?|confirm|confirmation|bestaetigung|buchungs?bestaetigung|delivery|shipping|tracking|versand|statement[s]?|account|verify|verification|security|webmaster|automated|express|checkin|check-in|boarding|reminder|erinnerung|termin|rendez-vous|promemoria|password|activation|register|signup|noreply-billing|noreply-orders|noreply-tickets|noreply-booking)(?:[._+-]|$|@|[a-z]*@)/i
// Stripe / SES / Mandrill on receipts+, orders+, tickets+, payments+
const TRANSACTIONAL_ESP_LOCAL_RE = /^(receipt[s]?|order[s]?|ticket[s]?|booking[s]?|payment[s]?|invoice[s]?|refund[s]?|billing|confirm(?:ation)?)[-+._]/i
const TRANSACTIONAL_SUBJECT_RE = /\b(your\s+(ticket|order|receipt|booking|reservation|confirmation|payment|refund|invoice|statement)|order\s*#|receipt\s+(from|for|#)|booking\s+(confirmed|confirmation|reference)|ticket\s+#|invoice\s*(no|#|nr)|your\s+trip|itinerary|confirmation\s+(number|code)|verification\s+code|reset\s+your\s+password|password\s+reset|security\s+alert|payment\s+(received|due|confirmation)|refund\s+issued|shipment|shipped|delivered|out\s+for\s+delivery|welcome\s+to|ihr\s+(ticket|beleg|auftrag|rechnung|buchung)|ihre\s+(ticket|tickets|buchung|bestellung|rechnung)|buchungsbestätigung|rechnung(?:\s|-)|zahlungserinnerung|zahlungsverpflich|zahlungsauf|einzug\s+forderung|terminerinnerung|anmeldedaten|zugangsdaten|passwort|receipt\s+from)\b/i
// Transactional-default domains: airline / booking / payment / delivery / marketplace / bank
const TRANSACTIONAL_DOMAIN_RE = /@[a-z0-9.-]*(airbnb|booking\.com|expedia|opodo|kayak|hotels\.com|trenitalia|oebb|sbb|flixbus|cheaptickets|flypgs|ryanair|lufthansa|swiss\.com|klm|delta|aa\.com|dhl|fedex|ups\.com|dpd|swisspost|post\.ch|paypal|stripe|revolut|neon-free|transferwise|wise\.com|bank|zalando|digitec|galaxus|migros|coop\.ch|apple|icloud|microsoft)/i

// Promotional (Others): distribution-list mail, no specific trigger
const PROMOTIONAL_LOCAL_RE = /(?:^|[._+-])(newsletter[s]?|news|marketing|marketingmail|newsmail|promo[s]?|offer[s]?|deal[s]?|digest[s]?|recap[s]?|posts?|posts-recaps?|discover|explore|inspiration|weekly|daily|announcement[s]?|comms|community|blog|events?|nytdirect|hugoboss|zwilling)(?:[._+-]|$|@|[a-z]*@)/i
const PROMOTIONAL_SUBDOMAIN_RE = /@(news|newsletter[s]?|marketing|marketingmail|promo|promos|deals|offers|messaging|relationship|community|blog|social|hello|greetings|announcements?)\.[a-z0-9.-]+$/i
const PROMOTIONAL_SUBJECT_RE = /(\b(sale|off|discount|save|deal[s]?|promo|coupon|% off|-\d+%|newsletter|weekly|monthly|digest|recap|round-?up|you might have missed|nur\s+\d+\s+tage|jetzt\s+sichern|jetzt\s+nur|nur\s+bei\s+uns|angebot|rabatt|gratis|kostenlos|gewinne|gewinnspiel|preise|schnäppchen|the world:|on politics:|politics:)\b|^[✨🌟🌐💥🔥📸💸💰🎁🎉⏰]|^\[[A-Z0-9\s]+\]\s+)/i
// Social-network digest domains → Others
const SOCIAL_DOMAIN_RE = /@[a-z0-9.-]*(instagram|facebook|linkedin|twitter|x\.com|tiktok|snapchat|pinterest|reddit|discord|slack|threads\.net|bluesky|mastodon)/i

export function classifyBulk(
  fromAddr: string,
  returnPath: string,
  headers?: Map<string, unknown> | Record<string, unknown> | null,
  subject?: string,
): 'inbox' | 'updates' | 'others' {
  const get = (k: string): string => {
    if (!headers) return ''
    const v = headers instanceof Map ? headers.get(k) : (headers as Record<string, unknown>)[k]
    if (!v) return ''
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.map(String).join(' ')
    if (typeof v === 'object' && v && 'value' in v) {
      const inner = (v as { value: unknown }).value
      return typeof inner === 'string' ? inner : JSON.stringify(inner || '')
    }
    return String(v)
  }

  const from = (fromAddr || '').toLowerCase()
  const rp   = (returnPath || '').toLowerCase()
  const subj = (subject || '')

  // ── Stage A: is this bulk at all? ─────────────────────────────────────────
  let isBulk = false
  if (get('list-unsubscribe')) isBulk = true
  if (!isBulk && get('list-id')) isBulk = true
  if (!isBulk) {
    const prec = get('precedence').toLowerCase()
    if (prec === 'bulk' || prec === 'list' || prec === 'junk') isBulk = true
  }
  if (!isBulk) {
    const auto = get('auto-submitted').toLowerCase()
    if (auto && auto !== 'no') isBulk = true
  }
  if (!isBulk && get('feedback-id')) isBulk = true
  if (!isBulk) {
    const xmailer = get('x-mailer')
    if (/ZuckMail|Create Send|Amazon SES|Mailchimp|Sendgrid|SparkPost|Zendesk Mailer|EmailOctopus|MassMailer|MailerLite/i.test(xmailer)) isBulk = true
    if (!isBulk && (get('x-campaign') || get('x-mailin-tag') || get('x-mandrill-user') || get('x-sg-eid') || get('x-mc-user') || get('x-msys-message-id'))) isBulk = true
  }
  if (!isBulk && rp && (BOUNCE_RP_RE.test(rp) || ESP_DOMAIN_RE.test(rp))) isBulk = true
  if (!isBulk && from && (BULK_LOCAL_RE.test(from) || ESP_DOMAIN_RE.test(from) || BULK_SUBDOMAIN_RE.test(from))) isBulk = true
  // Also: promo/trx local, promo subdomain, social domain, or transactional-default domain
  // count as bulk. Closes the hole for NYT / Pegasus / Zwilling that ship without ESP headers.
  if (!isBulk && from && (
    PROMOTIONAL_LOCAL_RE.test(from) ||
    PROMOTIONAL_SUBDOMAIN_RE.test(from) ||
    TRANSACTIONAL_LOCAL_RE.test(from) ||
    TRANSACTIONAL_ESP_LOCAL_RE.test(from) ||
    TRANSACTIONAL_DOMAIN_RE.test(from) ||
    SOCIAL_DOMAIN_RE.test(from)
  )) isBulk = true

  if (!isBulk) return 'inbox'

  // ── Stage B: bulk — transactional (Updates) or promotional (Others)? ──────
  // Social digests are ALWAYS Others (Instagram posts-recaps, LinkedIn digests, ...)
  if (SOCIAL_DOMAIN_RE.test(from)) return 'others'

  // Transactional signals
  const trxLocal   = TRANSACTIONAL_LOCAL_RE.test(from) || TRANSACTIONAL_ESP_LOCAL_RE.test(from)
  const trxDomain  = TRANSACTIONAL_DOMAIN_RE.test(from) || TRANSACTIONAL_DOMAIN_RE.test(rp)
  const trxSubject = subj && TRANSACTIONAL_SUBJECT_RE.test(subj)

  // Promotional signals
  const promoLocal   = PROMOTIONAL_LOCAL_RE.test(from)
  const promoSubdom  = PROMOTIONAL_SUBDOMAIN_RE.test(from)
  const promoSubject = subj && PROMOTIONAL_SUBJECT_RE.test(subj)

  // Transactional wins over promotional when both hit (a `deals@` from an airline about a booking = Updates).
  // Domain-alone (airline/booking/payment) is soft — needs a subject that isn't clearly promotional.
  if (trxLocal || trxSubject) return 'updates'
  if (trxDomain && !promoSubject) return 'updates'

  if (promoLocal || promoSubdom || promoSubject) return 'others'

  // Bulk but no strong signal either way → default to Others (safer: false-promo costs less than missed-transactional).
  return 'others'
}

/** Derived unmatched pool: media/unmatched/eml/INBOX-*.eml, headers parsed on demand.
 *  Each row is labeled `bucket: 'inbox' | 'updates' | 'others'` so the UI can split the three tabs
 *  (Filippo 2026-07-13). */
export type UnmatchedBucket = 'inbox' | 'updates' | 'others'
export type UnmatchedEntry = { path: string; from: string; subject: string; date: string; bucket: UnmatchedBucket }
export async function listUnmatchedEml(): Promise<UnmatchedEntry[]> {
  const dir = emlDir('unmatched')
  if (!existsSync(dir)) return []
  const out: UnmatchedEntry[] = []
  for (const f of readdirSync(dir)) {
    const m = EML_RE.exec(f)
    if (!m || m[1] !== 'INBOX') continue                 // inbound only
    try {
      const parsed = await simpleParser(readHeaderBlock(join(dir, f)))
      const fromValues = parsed.from?.value as { address?: string }[] | undefined
      const fromAddr = fromValues?.[0]?.address || ''
      // Return-Path in simpleParser lands as `<addr>` — strip the brackets.
      const rpRaw = (parsed.headers as Map<string, unknown>)?.get?.('return-path')
      const rpStr = typeof rpRaw === 'string' ? rpRaw : (rpRaw && typeof rpRaw === 'object' && 'value' in rpRaw ? String((rpRaw as { value: unknown }).value || '') : '')
      const returnPath = rpStr.replace(/^<|>$/g, '').trim()
      const subject = parsed.subject || ''
      out.push({
        path: join(dir, f),
        from: parsed.from?.text || fromAddr,
        subject,
        date: (parsed.date || new Date(0)).toISOString(),
        bucket: classifyBulk(fromAddr, returnPath, parsed.headers as Map<string, unknown>, subject),
      })
    } catch { /* unreadable eml — skip, don't crash the banner */ }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

/** Per-bucket counts for the status route. Uses the same header block. */
export async function countUnmatchedByBucket(): Promise<{ inbox: number; updates: number; others: number }> {
  const rows = await listUnmatchedEml()
  const out = { inbox: 0, updates: 0, others: 0 }
  for (const r of rows) out[r.bucket]++
  return out
}

// ─── Header cache — Filippo 2026-07-13 ──────────────────────────────────────
// Emails are stored ONLY for clients (activities + eml files). But the Inbox /
// Updates / Others tabs still need to render fast — so HEADERS (envelope +
// classification signals, NO bodies) are cached in the `email_headers` table.
// Sweep downloads new headers once; queries read from SQL. Bodies stay live-
// fetched via fetchMailBody(folder, uid) on click.
//
// The prior artificial limits (60-day SEARCH window, 30-sec in-memory cache,
// per-tab-open live IMAP) are all gone — replaced by "download once, SELECT".

/** Sweep new email headers into the cache. Idempotent: UIDs already stored
 *  are skipped. Runs both INBOX and Sent so the Sent view is also fast.
 *
 *  Report per folder: `exists` = mailbox row count on server, `uids` = UIDs
 *  returned by SEARCH ALL, `have` = already in cache, `added` = fresh inserts,
 *  `skipped` = fetched but not inserted (rare — malformed rows). Any gap tells
 *  you exactly where mail is being lost. */
export async function sweepEmailHeaders(): Promise<{ folder: string; exists: number; uids: number; have: number; added: number; skipped: number }[]> {
  const cfg = readMailConfig()
  if (!cfg.configured) return []

  const client = new ImapFlow({
    host: cfg.imapHost, port: cfg.imapPort, secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  })

  const db = getDb()
  const clientAddrByAddress = new Map<string, string>()
  for (const row of db.prepare(`
    SELECT id, lower(email) AS e FROM prospects WHERE email IS NOT NULL AND email != ''
    UNION
    SELECT prospect_id AS id, lower(email) AS e FROM contacts WHERE email IS NOT NULL AND email != ''
  `).all() as Array<{ id: string; e: string }>) {
    clientAddrByAddress.set(row.e, row.id)
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO email_headers
      (id, folder, uid_validity, uid, message_id, from_addr, from_name, to_addrs, subject, date, bucket, prospect_id,
       list_unsubscribe, list_id, feedback_id, precedence, auto_submitted, x_mailer, x_campaign, return_path,
       created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const report: { folder: string; exists: number; uids: number; have: number; added: number; skipped: number }[] = []

  try {
    await client.connect()
    for (const folder of FOLDERS) {
      const target = folder === 'Sent' ? await resolveSent(client) : folder
      const lock = await client.getMailboxLock(target)
      let added = 0
      let skipped = 0
      let uidsCount = 0
      let existsCount = 0
      let haveCount = 0
      try {
        const mailbox = client.mailbox
        if (!mailbox || typeof mailbox === 'boolean') { report.push({ folder, exists: 0, uids: 0, have: 0, added, skipped }); continue }
        const uidValidity = Number(mailbox.uidValidity ?? 0)
        existsCount = Number(mailbox.exists ?? 0)

        // Which UIDs do we already have for this (folder, uid_validity)?
        const have = new Set<number>(
          (db.prepare(`SELECT uid FROM email_headers WHERE folder = ? AND uid_validity = ?`).all(folder, uidValidity) as Array<{ uid: number }>).map(r => r.uid),
        )
        haveCount = have.size

        // ALL UIDs — no SINCE limit (Filippo 2026-07-13: no artificial window).
        const uidsAll = await client.search({ all: true }, { uid: true })
        const uidArr = Array.isArray(uidsAll) ? uidsAll : []
        uidsCount = uidArr.length
        const uidList = uidArr.filter(u => !have.has(u))
        if (uidList.length === 0) { report.push({ folder, exists: existsCount, uids: uidsCount, have: haveCount, added, skipped }); continue }

        // FETCH envelope + classification headers, chunked (500 UIDs / round-trip
        // — real IMAP command-line ceiling, not artificial).
        const CHUNK = 500
        for (let i = 0; i < uidList.length; i += CHUNK) {
          const slice = uidList.slice(i, i + CHUNK)
          for await (const msg of client.fetch(slice, {
            envelope: true,
            uid: true,
            headers: ['message-id', 'list-unsubscribe', 'list-id', 'feedback-id', 'precedence', 'auto-submitted', 'x-mailer', 'x-campaign', 'return-path'],
          }, { uid: true })) {
            // Filippo 2026-07-13: DON'T skip on missing From — store with a
            // placeholder so the header cache truly reflects the server.
            // (The old skip is exactly the cap Filippo caught: mail without
            // a From header just vanished.)
            const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase() || '(no-from)'

            const hdrMap = new Map<string, string>()
            if (msg.headers && Buffer.isBuffer(msg.headers)) {
              const text = msg.headers.toString('utf-8')
              for (const line of text.split(/\r?\n/)) {
                const m = /^([a-z0-9-]+):\s*(.*)$/i.exec(line)
                if (m) {
                  const key = m[1].toLowerCase()
                  const cur = hdrMap.get(key)
                  hdrMap.set(key, cur ? cur + ' ' + m[2] : m[2])
                }
              }
            }
            const listUnsub = hdrMap.get('list-unsubscribe') || null
            const listId    = hdrMap.get('list-id') || null
            const feedback  = hdrMap.get('feedback-id') || null
            const prec      = hdrMap.get('precedence') || null
            const autoSub   = hdrMap.get('auto-submitted') || null
            const xmailer   = hdrMap.get('x-mailer') || null
            const xcampaign = hdrMap.get('x-campaign') || null
            const returnPath = (hdrMap.get('return-path') || '').replace(/^<|>$/g, '').trim() || null
            const messageId = (hdrMap.get('message-id') || '').replace(/^<|>$/g, '').trim() || null

            const subject   = msg.envelope?.subject || ''
            const fromName  = msg.envelope?.from?.[0]?.name || ''
            const toList    = (msg.envelope?.to || []).map(a => a.address).filter(Boolean).join(', ')
            const date      = (msg.envelope?.date || new Date(0)).toISOString()

            // Bucket. Client match wins; otherwise classifyBulk.
            const clientId = clientAddrByAddress.get(folder === 'Sent'
              ? (msg.envelope?.to?.[0]?.address?.toLowerCase() || '')
              : fromAddr)
            const bucket = clientId ? 'client' : classifyBulk(fromAddr, returnPath || '', hdrMap, subject)

            if (msg.uid === undefined || msg.uid === null) { skipped++; continue }   // no UID = nothing to key on
            const id = `${folder}:${uidValidity}:${msg.uid}`
            try {
              const info = insert.run(
                id, folder, uidValidity, msg.uid, messageId, fromAddr, fromName, toList, subject, date, bucket, clientId ?? null,
                listUnsub, listId, feedback, prec, autoSub, xmailer, xcampaign, returnPath,
                new Date().toISOString(),
              )
              if (info.changes > 0) added++
              else skipped++     // UNIQUE collision (dup or already-present)
            } catch { skipped++ }
          }
        }
      } finally { lock.release() }
      report.push({ folder, exists: existsCount, uids: uidsCount, have: haveCount, added, skipped })
    }
  } finally {
    try { await client.logout() } catch { /* best-effort */ }
  }
  return report
}

/** Read from cache — no IMAP touched. */
export type CachedUnmatched = UnmatchedEntry & { id: string }
export function listUnmatchedFromCache(bucket?: 'inbox' | 'updates' | 'others'): CachedUnmatched[] {
  const db = getDb()
  const where = bucket
    ? `WHERE bucket = ? AND hidden = 0 AND folder = 'INBOX'`
    : `WHERE bucket IN ('inbox', 'updates', 'others') AND hidden = 0 AND folder = 'INBOX'`
  const args = bucket ? [bucket] : []
  const rows = db.prepare(`
    SELECT id, folder, uid, uid_validity, from_addr, from_name, subject, date, bucket
    FROM email_headers ${where}
    ORDER BY date DESC
  `).all(...args) as Array<{ id: string; folder: string; uid: number; uid_validity: number; from_addr: string; from_name: string | null; subject: string | null; date: string; bucket: 'inbox' | 'updates' | 'others' }>
  return rows.map(r => ({
    id: r.id,
    path: `${r.folder}:${r.uid}`,            // banner passes back to /message; folder+uid → live body fetch
    from: r.from_name ? `"${r.from_name}" <${r.from_addr}>` : r.from_addr,
    subject: r.subject || '',
    date: r.date,
    bucket: r.bucket,
  }))
}

/** Per-bucket counts from the cache — pure SQL, no IMAP. */
export function countUnmatchedFromCache(): { inbox: number; updates: number; others: number } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT bucket, COUNT(*) AS n FROM email_headers
    WHERE bucket IN ('inbox', 'updates', 'others') AND hidden = 0 AND folder = 'INBOX'
    GROUP BY bucket
  `).all() as Array<{ bucket: 'inbox' | 'updates' | 'others'; n: number }>
  const out = { inbox: 0, updates: 0, others: 0 }
  for (const r of rows) out[r.bucket] = r.n
  return out
}

/** DELETE — real IMAP move-to-Trash, then drop the header cache row(s).
 *  Filippo 2026-07-13: delete means delete. Move to server-side Trash (which is
 *  what every mail client does on a delete) + remove from our cache. */
async function trashFolderPath(client: ImapFlow): Promise<string> {
  const list = await client.list()
  for (const f of list) {
    if (f.specialUse === '\\Trash') return f.path
  }
  return 'Trash'  // fallback — most servers accept this
}

async function withImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const cfg = readMailConfig()
  if (!cfg.configured) throw new Error('mail not configured')
  const client = new ImapFlow({
    host: cfg.imapHost, port: cfg.imapPort, secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  })
  try { await client.connect(); return await fn(client) }
  finally { try { await client.logout() } catch { /* best-effort */ } }
}

/** Delete a single UID: IMAP move to Trash, then drop from cache. */
export async function deleteEmail(id: string): Promise<{ deleted: boolean }> {
  const db = getDb()
  const row = db.prepare(`SELECT folder, uid FROM email_headers WHERE id = ?`).get(id) as { folder: string; uid: number } | undefined
  if (!row) return { deleted: false }
  await withImap(async (client) => {
    const trash = await trashFolderPath(client)
    const lock = await client.getMailboxLock(row.folder)
    try {
      await client.messageMove([row.uid], trash, { uid: true })
    } finally { lock.release() }
  })
  db.prepare(`DELETE FROM email_headers WHERE id = ?`).run(id)
  return { deleted: true }
}

/** Delete a client-tab mail by its RFC Message-ID. The activity row carries
 *  the Message-ID; we look up the UID in the header cache, do the IMAP move-
 *  to-Trash, drop the cache row, AND soft-delete the activity so the CRM
 *  thread stops showing it. */
export async function deleteEmailByMessageId(messageId: string, activityId?: string): Promise<{ deleted: boolean }> {
  const db = getDb()
  const clean = messageId.replace(/^<|>$/g, '')
  const row = db.prepare(`SELECT id, folder, uid FROM email_headers WHERE message_id = ?`).get(clean) as { id: string; folder: string; uid: number } | undefined
  if (row) {
    await withImap(async (client) => {
      const trash = await trashFolderPath(client)
      const lock = await client.getMailboxLock(row.folder)
      try { await client.messageMove([row.uid], trash, { uid: true }) }
      finally { lock.release() }
    })
    db.prepare(`DELETE FROM email_headers WHERE id = ?`).run(row.id)
  }
  // Even if the header cache row is missing (never swept, or already dropped),
  // still soft-delete the activity so the client thread updates.
  if (activityId) {
    db.prepare(`UPDATE activities SET soft_deleted = 1 WHERE id = ?`).run(activityId)
  }
  return { deleted: Boolean(row || activityId) }
}

/** Delete every mail from one sender: IMAP move-to-Trash per folder, then drop from cache. */
export async function deleteSender(fromAddr: string): Promise<{ deleted: number }> {
  const db = getDb()
  const rows = db.prepare(`SELECT id, folder, uid FROM email_headers WHERE lower(from_addr) = lower(?)`).all(fromAddr) as Array<{ id: string; folder: string; uid: number }>
  if (rows.length === 0) return { deleted: 0 }
  // Group UIDs by folder for a single move per folder.
  const byFolder = new Map<string, number[]>()
  for (const r of rows) {
    const list = byFolder.get(r.folder) || []
    list.push(r.uid)
    byFolder.set(r.folder, list)
  }
  await withImap(async (client) => {
    const trash = await trashFolderPath(client)
    for (const [folder, uids] of byFolder) {
      const lock = await client.getMailboxLock(folder)
      try {
        await client.messageMove(uids, trash, { uid: true })
      } finally { lock.release() }
    }
  })
  const del = db.prepare(`DELETE FROM email_headers WHERE id = ?`)
  const tx = db.transaction((ids: string[]) => { for (const id of ids) del.run(id) })
  tx(rows.map(r => r.id))
  return { deleted: rows.length }
}

/** On-demand body fetch — Inbox/Updates/Others click-through.
 *  Given `INBOX:1042`, opens IMAP, fetches the raw source, parses. */
export interface MailBody {
  from: string
  to: string
  subject: string
  date: string
  text: string
  html: string | null
  attachments: { name: string; size: number; contentId?: string; contentType?: string; dataUrl?: string }[]
}
// ─── HTML sanitizer (Filippo 2026-07-13, replaces the iframe) ──────────────
// Strips scripts, event handlers, javascript: URLs, style/link tags, iframes,
// and any tag not on the allowlist. Rewrites data-uri img srcs through
// (already-inlined cid: images become data URIs before sanitize). External
// http(s) links are preserved but forced target=_blank + rel=noopener.
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p',
  'pre', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'body', 'html', 'head', 'meta',
  'title', 'font', 'center',
])
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  '*':      new Set(['title', 'lang', 'dir', 'align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'bgcolor', 'color', 'face', 'size', 'border', 'cellpadding', 'cellspacing']),
  a:        new Set(['href']),
  img:      new Set(['src', 'alt', 'width', 'height']),
}
const URL_ATTRS = new Set(['href', 'src'])

function sanitizeHtml(input: string): string {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${input}</body></html>`)
  const doc = dom.window.document
  const walker = doc.createTreeWalker(doc.body, dom.window.NodeFilter.SHOW_ELEMENT)
  const toRemove: Element[] = []
  for (let node = walker.nextNode() as Element | null; node; node = walker.nextNode() as Element | null) {
    const tag = node.tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) { toRemove.push(node); continue }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value
      const isAllowed = ALLOWED_ATTRS[tag]?.has(name) || ALLOWED_ATTRS['*'].has(name)
      if (!isAllowed) { node.removeAttribute(attr.name); continue }
      if (URL_ATTRS.has(name)) {
        const v = value.trim().toLowerCase()
        // Block javascript:, vbscript:, and data: (except image data: for cid-replaced imgs)
        if (v.startsWith('javascript:') || v.startsWith('vbscript:')) { node.removeAttribute(attr.name); continue }
        if (v.startsWith('data:') && !(tag === 'img' && v.startsWith('data:image/'))) { node.removeAttribute(attr.name); continue }
      }
    }
    if (tag === 'a') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer') }
  }
  for (const el of toRemove) el.replaceWith(...Array.from(el.childNodes))
  return doc.body.innerHTML
}

export async function fetchMailBody(folder: string, uid: number): Promise<MailBody> {
  const cfg = readMailConfig()
  if (!cfg.configured) throw new Error('mail not configured')

  const client = new ImapFlow({
    host: cfg.imapHost, port: cfg.imapPort, secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  })
  let source: Buffer = Buffer.alloc(0)
  try {
    await client.connect()
    const lock = await client.getMailboxLock(folder)
    try {
      for await (const msg of client.fetch([uid], { source: true }, { uid: true })) {
        if (msg.source) source = msg.source
      }
    } finally { lock.release() }
  } finally {
    try { await client.logout() } catch { /* best-effort close */ }
  }
  if (!source.length) throw new Error('message not found on server')

  // Filippo 2026-07-13: write to system temp dir so the OS manages lifecycle.
  // The parse works off the buffer too — the file exists mainly so downstream
  // debugging (or a future "open in Mail.app") has an artifact to point at.
  const tmpPath = join(tmpdir(), `oskar-mail-${folder}-${uid}-${Date.now()}.eml`)
  try { writeFileSync(tmpPath, source) } catch { /* tmp write failed — parse from buffer still works */ }

  const parsed = await simpleParser(source)
  let html = parsed.html || null
  const attachments = (parsed.attachments || []).map(a => {
    const dataUrl = a.content ? `data:${a.contentType || 'application/octet-stream'};base64,${a.content.toString('base64')}` : undefined
    return {
      name: a.filename || '',
      size: a.size || 0,
      contentId: a.cid,
      contentType: a.contentType,
      dataUrl,
    }
  })
  if (html) {
    for (const a of attachments) {
      if (a.contentId && a.dataUrl) {
        const cidRe = new RegExp(`cid:${a.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi')
        html = html.replace(cidRe, a.dataUrl)
      }
    }
    html = sanitizeHtml(html)               // scripts / styles / iframes stripped
  }
  const toText = parsed.to
    ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : parsed.to.text || '')
    : ''
  return {
    from: parsed.from?.text || '',
    to: toText,
    subject: parsed.subject || '',
    date: (parsed.date || new Date(0)).toISOString(),
    text: parsed.text || '',
    html,
    attachments,
  }
}

// ─── the sweep: serialized, joinable, failure is a first-class phase ─────────

let running: Promise<SweepProgress> | null = null

export function sweepMail(opts: { backfill?: boolean } = {}): Promise<SweepProgress> {
  if (running) return running          // join semantics — never a stacked sweep
  running = doSweep(opts).finally(() => { running = null })
  return running
}

/** Every known client address — the download filter (Filippo 2026-07-13:
 *  "I don't want to download any email which is not connected to a client").
 *  The contacts table drives what the sweep even asks the server for. */
function clientAddresses(): string[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT DISTINCT lower(email) AS e FROM contacts  WHERE email IS NOT NULL AND email != ''
    UNION
    SELECT DISTINCT lower(email) AS e FROM prospects WHERE email IS NOT NULL AND email != ''
  `).all() as Array<{ e: string }>
  return rows.map(r => r.e)
}

async function doSweep(_opts: { backfill?: boolean }): Promise<SweepProgress> {
  const cfg = readMailConfig()
  setPhase('connecting', {
    folder: undefined, done_n: 0, total_n: 0, filed: 0, error: undefined,
    failed_phase: undefined, attachment: undefined,
    started_at: new Date().toISOString(), finished_at: undefined, new_mail: [],
  })
  if (!cfg.configured) {
    setPhase('failed', { error: 'mail not configured (Settings → Email)', failed_phase: 'connecting', finished_at: new Date().toISOString() })
    return getMailProgress()
  }

  const client = new ImapFlow({
    host: cfg.imapHost, port: cfg.imapPort, secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  })

  try {
    await client.connect()
    // ── address-driven pull (replaces the fetch-everything cursor sweep) ──
    // Per folder, per client address: server-side SEARCH, fetch only what we
    // don't have. Cursor, backfill, and re-match all collapse into this one
    // primitive: a new address simply pulls its whole history off the server
    // on the next sweep; already-stored mail is skipped by filename; the
    // activity layer dedups by Message-ID on top.
    const addresses = clientAddresses()
    const have = new Set(listAllEml().map(e => `${e.folder}-${e.uidValidity}-${e.uid}`))
    for (const folder of FOLDERS) {
      setPhase('listing', { folder })
      const lock = await client.getMailboxLock(folder === 'Sent' ? await resolveSent(client) : folder)
      try {
        const mailbox = client.mailbox
        if (!mailbox || typeof mailbox === 'boolean') continue
        const serverValidity = Number(mailbox.uidValidity ?? 0)
        const wanted = new Set<number>()
        for (const addr of addresses) {
          // Inbound: the client wrote us. Sent: we wrote the client.
          const crit = folder === 'Sent' ? { to: addr } : { from: addr }
          try {
            const uids = await client.search(crit, { uid: true })
            for (const uid of Array.isArray(uids) ? uids : []) {
              if (!have.has(`${folder}-${serverValidity}-${uid}`)) wanted.add(uid)
            }
          } catch { /* one address failing must not kill the sweep */ }
        }
        if (wanted.size === 0) continue
        setPhase('downloading', { folder, total_n: progress.total_n + wanted.size })
        // Chunked fetch — IMAP command length is finite.
        const all = [...wanted].sort((a, b) => a - b)
        for (let i = 0; i < all.length; i += 100) {
          const range = all.slice(i, i + 100).join(',')
          for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
            if (!msg.source) continue
            const res = await processFetchedMessage(folder, msg.uid, serverValidity, Buffer.from(msg.source))
            progress.done_n++
            if (res.filed) progress.filed++
            if (folder === 'INBOX') progress.new_mail.push(res.emlPath)
          }
        }
      } finally {
        lock.release()
      }
    }
    await client.logout().catch(() => client.close())
    setPhase('done', { finished_at: new Date().toISOString() })
  } catch (err) {
    try { client.close() } catch { /* closed */ }
    setPhase('failed', {
      error: String((err as Error).message || err),
      failed_phase: progress.phase === 'failed' ? progress.failed_phase : progress.phase,
      finished_at: new Date().toISOString(),
    })
    console.error('[mail-eyes] sweep failed:', err)
  }
  return getMailProgress()
}

/** Sent-folder name varies by server (Sent, Sent Items, INBOX.Sent…). */
async function resolveSent(client: ImapFlow): Promise<string> {
  try {
    for (const box of await client.list()) {
      if (box.specialUse === '\\Sent') return box.path
    }
  } catch { /* fall through */ }
  return 'Sent'
}
