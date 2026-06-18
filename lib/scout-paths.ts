// lib/scout-paths.ts — §18 single source of truth for the Scout media layout:
//
//   media/<plz-or-region>/<slug>/<firstname>.jpg          (main)
//                                /<firstname>-inner.jpg    (Sip 2)
//                                /<firstname>-profile.jpg  (shared-site profile)
//
// Imported by the migration (WP-129), captureUrl (WP-130), and the auth-gated
// serve route. ONE slugify/fold function so the filesystem path, the DB pointer,
// and the route regex (^[a-z0-9_-]+$) never drift.
import path from 'path'

export const MEDIA_ROOT = path.join(process.cwd(), 'media')

const FOLD: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss',
  é: 'e', è: 'e', ê: 'e', ë: 'e', à: 'a', â: 'a', á: 'a',
  ô: 'o', ó: 'o', î: 'i', í: 'i', ï: 'i', û: 'u', ç: 'c', ñ: 'n',
}
/** lowercase + ASCII-fold German/French diacritics; strip any remaining marks. */
export function asciiFold(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[äöüßéèêëàâáôóîíïûçñ]/g, (c) => FOLD[c] ?? c)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
}
/** one path-safe chunk: folded, non-alnum → '-', trimmed. Always non-empty. */
export function slugChunk(s: string): string {
  return asciiFold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}

/** domain key for matching captures to rows: drop scheme + www., lowercase. */
export function domainOf(url: string): string {
  const raw = (url || '').trim()
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw)
    return u.hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase()
  }
}

/** <slug> = hostname minus `www.` minus the final TLD label, slugified.
 *  www.psychotherapiezentrum-fluntern.ch/foo → "psychotherapiezentrum-fluntern" */
export function siteSlug(url: string): string {
  const host = domainOf(url)
  const labels = host.split('.')
  const noTld = labels.length > 1 ? labels.slice(0, -1).join('-') : host
  return slugChunk(noTld)
}

// title tokens to skip when picking a firstname ("Dr. med. Hans …" → "hans")
const TITLE = /^(dr|prof|med|dipl|phil|lic|msc|ba|ma|fmh|fsp|dipl\.-psych|psych)$/
/** firstname slug from a full name, skipping leading titles. */
export function firstnameSlug(name: string): string {
  const toks = (name || '').trim().split(/\s+/).filter(Boolean)
  const first = toks.find((t) => !TITLE.test(t.replace(/\.$/, '').toLowerCase())) || toks[0] || 'unknown'
  return slugChunk(first)
}

/** PLZ (4-digit) for the top dir; else region fallback (bare, folded — matches
 *  the §18 diagram `zuerich/…`). raw_payload-driven; NEVER fabricates a PLZ. */
export function plzOrRegion(rp: Record<string, unknown>): string {
  const plz = String(rp?.plz ?? '').trim()
  if (/^\d{4}$/.test(plz)) return plz
  const text = ['adr', 'adresse', 'address', 'ort'].map((k) => (typeof rp?.[k] === 'string' ? (rp[k] as string) : '')).join(' ')
  const m = text.match(/\b(\d{4})\s+[A-ZÄÖÜ]/)
  if (m && +m[1] >= 1000 && +m[1] <= 9999) return m[1]
  const region = String(rp?.bezirk ?? rp?.region ?? '').replace(/\(\?\)/g, '').trim()
  return region ? slugChunk(region) : 'unknown'
}

export interface ScoutTarget {
  plzOrRegion: string
  slug: string
  firstname: string
  /** Optional. When >=2 the practice's site is shared by multiple practitioners
   *  (Gemeinschaftspraxis). In that case PLZ is meaningless for the capture
   *  layout — it's ONE praxis, not one per practitioner ZIP — so we bucket
   *  under `_shared/<slug>` instead of `<plz>/<slug>`. Ralph 2026-06-05. */
  sharedSiteCount?: number | null
}
export type CaptureKind = 'main' | 'inner' | 'profile'
const SUFFIX: Record<CaptureKind, string> = { main: '', inner: '-inner', profile: '-profile' }

/** Sentinel top-level bucket for sites shared by ≥2 practitioners.
 *  Underscore-prefixed so it never collides with a real PLZ. Matches the
 *  serve-route regex `^[a-z0-9_-]+$`. */
export const SHARED_BUCKET = '_shared'

export function captureDir(t: Pick<ScoutTarget, 'plzOrRegion' | 'slug' | 'sharedSiteCount'>): string {
  const top = (t.sharedSiteCount && t.sharedSiteCount >= 2) ? SHARED_BUCKET : t.plzOrRegion
  return path.join(MEDIA_ROOT, top, t.slug)
}
/** fs path for one capture file. `disambig` = last-initial ('m') or numeric ('2'). */
export function captureFileName(t: Pick<ScoutTarget, 'firstname'>, kind: CaptureKind, disambig = ''): string {
  return `${t.firstname}${disambig ? '-' + disambig : ''}${SUFFIX[kind]}.jpg`
}
export function captureFile(t: ScoutTarget, kind: CaptureKind, disambig = ''): string {
  return path.join(captureDir(t), captureFileName(t, kind, disambig))
}
/** the auth-gated serve URL (WP-132 route) for an fs file under MEDIA_ROOT. */
export function captureServeUrl(fsPath: string): string {
  const rel = path.relative(MEDIA_ROOT, fsPath).split(path.sep).join('/')
  return `/api/admin/scout/capture/${rel}`
}
