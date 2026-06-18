// ============================================================================
// lib/wa-bucketing.ts — WhatsApp media bucket naming (Ralph 2026-06-05)
//
// Pure functions. No I/O. Used by both the inbound dispatch (for live writes)
// and the one-shot migration script.
//
// Naming scheme (per Ralph's spec):
//
//   media/<digits>-<slug>/<hash>.<ext>            ← matched prospect
//   media/unmatched/<digits>-<slug>/<hash>.<ext>  ← phone known, no prospect yet
//   media/_non_phone/<digits>-<slug>/<hash>.<ext> ← @lid / @g.us / non-phone JID
//   media/_invalid_phone/<safe>/<hash>.<ext>      ← JID didn't parse at all
//
// The `<digits>` is the phone in NO-PLUS form, country code first:
//   "41791234567" (NOT "+41791234567" — leaves filesystem chars unambiguous,
//   no URL encoding needed for the auth-gated route).
// The `<slug>` is the sender's display label (company / contact_name / pushName),
// ASCII-folded + lowercased + non-alphanumerics collapsed to hyphens, capped
// at 30 chars. Examples: "Filomax GmbH" → "filomax-gmbh"; "Dr. Müller" →
// "dr-mueller". If no name is available, the slug is omitted (bucket is just
// the digits — e.g. "41791234567/").
// ============================================================================

/** Slugify a free-form name for the bucket suffix. Result matches /^[a-z0-9-]{0,30}$/. */
export function slugifyName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks (ä → a)
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')        // any non-alphanum → hyphen
    .replace(/-+/g, '-')                // collapse repeats
    .replace(/^-|-$/g, '')              // trim leading/trailing hyphen
    .slice(0, 30)
    .replace(/-$/, '')                  // re-trim trailing hyphen post-truncate
}

/** Parse a WhatsApp JID into a structured form.
 *  Returns the kind plus the digit prefix (always — even for non-phones).
 *
 *  Examples:
 *    "41791234567@s.whatsapp.net"   → { kind: 'phone',     digits: '41791234567' }
 *    "41791234567:5@s.whatsapp.net" → { kind: 'phone',     digits: '41791234567' }  (device suffix dropped)
 *    "126139246858419@lid"          → { kind: 'lid',       digits: '126139246858419' }
 *    "1234567890-9876543@g.us"      → { kind: 'group',     digits: '1234567890-9876543' }
 *    "status@broadcast"             → { kind: 'broadcast', digits: '' }
 *    plain digits "41791234567"     → { kind: 'phone',     digits: '41791234567' } (legacy)
 */
export interface JidParts {
  kind: 'phone' | 'lid' | 'group' | 'broadcast' | 'unknown'
  digits: string
}
export function parseJid(jid: string | null | undefined): JidParts {
  const raw = String(jid ?? '').trim()
  if (!raw) return { kind: 'unknown', digits: '' }
  // Legacy: bare digits (no @suffix) — treat as phone.
  if (/^\d+$/.test(raw)) return { kind: 'phone', digits: raw }
  const at = raw.indexOf('@')
  if (at < 0) return { kind: 'unknown', digits: raw.replace(/[^0-9-]/g, '') }
  const local = raw.slice(0, at)
  const suffix = raw.slice(at + 1).toLowerCase()
  // Phone: `<digits>` or `<digits>:<deviceId>`, then `@s.whatsapp.net`.
  if (suffix === 's.whatsapp.net') {
    const digits = local.split(':')[0].replace(/[^0-9]/g, '')
    return digits ? { kind: 'phone', digits } : { kind: 'unknown', digits: '' }
  }
  if (suffix === 'lid') {
    return { kind: 'lid', digits: local.replace(/[^0-9]/g, '') }
  }
  if (suffix === 'g.us') {
    return { kind: 'group', digits: local.replace(/[^0-9-]/g, '') }
  }
  if (suffix === 'broadcast') {
    return { kind: 'broadcast', digits: '' }
  }
  return { kind: 'unknown', digits: local.replace(/[^0-9]/g, '') }
}

/** Validate a digits-only phone string against rough E.164 bounds.
 *  E.164 allows 8-15 digits total (incl. country code). Anything below 8 is
 *  not a real number; above 15 is over-spec (likely a JID with extra IDs). */
export function isValidE164Digits(digits: string): boolean {
  return /^\d{8,15}$/.test(digits)
}

/** Bucket classification — the full result the migration + runtime both use. */
export type BucketKind = 'matched' | 'unmatched' | 'non_phone' | 'invalid'
export interface Bucket {
  kind: BucketKind
  /** The path under media/ (no leading slash, no trailing slash). */
  dir: string
}

/** Compute the bucket directory for a (jid, displayName, matchedProspect?) triple.
 *
 *  Matched:    media/<digits>-<slug>/
 *  Unmatched:  media/unmatched/<digits>-<slug>/   (only when JID is a valid phone)
 *  Non-phone:  media/_non_phone/<digits>-<slug>/  (@lid, @g.us, @broadcast, etc.)
 *  Invalid:    media/_invalid_phone/<safe>/      (JID couldn't be parsed; digits absent or out of range)
 */
export function bucketFor(
  jid: string | null | undefined,
  displayName: string | null | undefined,
  matched: { company?: string | null; contact_name?: string | null } | null,
): Bucket {
  const parts = parseJid(jid)
  // Prefer prospect's label when matched; else pushName.
  const matchedLabel = matched
    ? slugifyName(matched.company || matched.contact_name || '')
    : ''
  const slug = matchedLabel || slugifyName(displayName)
  const tail = slug ? `${parts.digits}-${slug}` : parts.digits

  if (parts.kind === 'phone' && isValidE164Digits(parts.digits)) {
    if (matched) return { kind: 'matched', dir: tail }
    return { kind: 'unmatched', dir: `unmatched/${tail}` }
  }
  if (parts.kind === 'lid' || parts.kind === 'group') {
    const safeTail = tail || parts.digits || 'unknown'
    return { kind: 'non_phone', dir: `_non_phone/${safeTail}` }
  }
  if (parts.kind === 'broadcast') {
    return { kind: 'non_phone', dir: `_non_phone/broadcast` }
  }
  // Phone-kind but digits out of range, OR completely unknown JID.
  const safeTail = (parts.digits || 'unknown').replace(/[^A-Za-z0-9_-]/g, '')
  return { kind: 'invalid', dir: `_invalid_phone/${safeTail}` }
}
