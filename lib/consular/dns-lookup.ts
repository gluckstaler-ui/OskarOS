// ============================================================================
// lib/consular/dns-lookup.ts — Hosting lamp (WP-SCOUT-4 / §16.9 / WP-119)
//
// Ralph 2026-06-03 — shared between the Jedi Scout's ◐ Queried prescreen
// (pre-Kanban) and the Consular research route (post-promote). Resolves a
// domain's hosting "fingerprint" via:
//
//   A   → IPv4 address
//   PTR → reverse-DNS hint for the provider name (often telling: 'static-91-…
//         .hostpoint.ch.', 'amazonaws.com.', 'aliyuncs.com.', etc.)
//   MX  → mail handler (sometimes the same provider, sometimes Microsoft/Google)
//   ASN → Cymru DNS-based ASN lookup at <rev-ip>.origin.asn.cymru.com (TXT
//         record returns `AS | CIDR | country | RIR | date`). No API key,
//         no rate-limit hassle, Team-Cymru-style public service.
//
// Independent-leg discipline: every lookup is wrapped in a per-leg try and
// times out via AbortSignal.timeout. A failure yields `null` for that field —
// never throws — so the row degrades to "partial" instead of "failed".
// ============================================================================

import { promises as dns, type MxRecord } from 'node:dns'

export interface HostingInfo {
  /** IPv4 the domain resolves to (first A record). */
  ip: string | null
  /** PTR / reverse-DNS hint — often the provider name. */
  ptr: string | null
  /** MX hostname (first record). */
  mx: string | null
  /** ASN identifier (e.g. `AS6939`). */
  asn: string | null
  /** Two-letter country code from the ASN record (e.g. `CH`). */
  country: string | null
  /** Human-readable provider name guess — derived from PTR / ASN. */
  provider: string | null
}

/** Wrap any promise so that a failure / timeout resolves to `null`. */
function nullOnFail<T>(p: Promise<T>): Promise<T | null> {
  return p.catch(() => null)
}

/**
 * Cymru's DNS-based ASN lookup: reverse the IP, append
 * `.origin.asn.cymru.com`, fetch TXT — value is
 * `"<ASN> | <CIDR> | <CC> | <RIR> | <Date>"` (e.g. `"6939 | 1.2.3.0/24 | US | arin | 2017-01-01"`).
 */
async function cymruAsnLookup(ip: string, timeoutMs: number): Promise<{ asn: string | null; country: string | null }> {
  const parts = ip.split('.')
  if (parts.length !== 4) return { asn: null, country: null }
  const revHost = `${parts[3]}.${parts[2]}.${parts[1]}.${parts[0]}.origin.asn.cymru.com`
  const resolver = new dns.Resolver()
  resolver.setServers(['1.1.1.1', '8.8.8.8'])  // Cymru relies on global recursion; pin to reliable upstreams.
  // Node's dns.Resolver has no AbortSignal — guard with Promise.race.
  const txt: string[][] | null = await Promise.race([
    resolver.resolveTxt(revHost).catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
  ])
  const joined = (txt?.[0] || []).join('')
  if (!joined) return { asn: null, country: null }
  // `"6939 | … | US | arin | …"` → ASN + country (2nd-from-end after split)
  const fields = joined.split('|').map((s) => s.trim())
  const asn = /^\d+$/.test(fields[0] || '') ? `AS${fields[0]}` : null
  const country = /^[A-Z]{2}$/.test(fields[2] || '') ? fields[2] : null
  return { asn, country }
}

/**
 * Cymru ASN → org name (Ralph 2026-06-09). The hardcoded ASN_PROVIDERS map only
 * covers ~70 networks, so unmapped ASNs (green.ch, Datawire, Webland, WebSupport,
 * NovaTrend, …) leaked through as a bare "AS48971 · CH". This resolves ANY ASN
 * live: `<asn>.asn.cymru.com` TXT → "<asn> | <CC> | <RIR> | <date> | <ORG>".
 */
async function cymruAsnName(asn: string | null, timeoutMs: number): Promise<string | null> {
  if (!asn) return null
  const resolver = new dns.Resolver()
  resolver.setServers(['1.1.1.1', '8.8.8.8'])
  const txt: string[][] | null = await Promise.race([
    resolver.resolveTxt(`${asn}.asn.cymru.com`).catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
  ])
  const joined = (txt?.[0] || []).join('')
  if (!joined) return null
  // last field is the org name: "1836 | CH | ripencc | 1996-08-22 | GREEN - green.ch AG, CH"
  return cleanAsnOrg(joined.split('|').pop()?.trim() || '') || null
}

/** "GREEN - green.ch AG, CH" → "green.ch AG"; "SQUARESPACE - Squarespace, Inc." → "Squarespace, Inc." */
function cleanAsnOrg(raw: string): string {
  let s = raw.replace(/,\s*[A-Z]{2}$/, '').trim() // drop trailing ", CH"
  const dash = s.indexOf(' - ')
  if (dash > 0 && /^[A-Z0-9][A-Z0-9-]*$/.test(s.slice(0, dash))) s = s.slice(dash + 3).trim() // drop "HANDLE - "
  return s
}

/** Guess a provider name from the PTR hostname (common substrings). */
function guessProviderFromPtr(ptr: string): string | null {
  const p = ptr.toLowerCase()
  // Order: most specific first. Tweaks live here (cheap heuristics).
  if (p.includes('hostpoint'))     return 'Hostpoint'
  if (p.includes('infomaniak'))    return 'Infomaniak'
  if (p.includes('cyon'))          return 'Cyon'
  if (p.includes('hosttech'))      return 'Hosttech'
  if (p.includes('metanet'))       return 'Metanet'
  if (p.includes('amazonaws'))     return 'AWS'
  if (p.includes('googleusercontent') || p.includes('1e100')) return 'Google'
  if (p.includes('azure') || p.includes('azurewebsites')) return 'Azure'
  if (p.includes('cloudflare'))    return 'Cloudflare'
  if (p.includes('netlify'))       return 'Netlify'
  if (p.includes('vercel'))        return 'Vercel'
  if (p.includes('wpengine'))      return 'WP Engine'
  if (p.includes('squarespace'))   return 'Squarespace'
  if (p.includes('wix'))           return 'Wix'
  if (p.includes('shopify'))       return 'Shopify'
  if (p.includes('ovh'))           return 'OVH'
  if (p.includes('hetzner'))       return 'Hetzner'
  return null
}

/**
 * ASN → human-readable provider name (Ralph 2026-06-05).
 *
 * Falls back from PTR-based guessing. Reverse-DNS hostnames don't always
 * contain a provider substring (e.g. many AWS EC2 IPs have empty or
 * generic PTRs), but the ASN never lies — every IP routes via exactly
 * one ASN, and the top ~50 cloud/hosting/CDN providers cover the
 * overwhelming majority of small-business websites.
 *
 * Source: Hurricane Electric BGP toolkit + Cymru — top consumer/cloud/
 * CDN providers by traffic share. Swiss + German providers prioritised
 * for the OskarOS pipeline (most leads are CH/DE small businesses).
 */
const ASN_PROVIDERS: Record<string, string> = {
  // ── Switzerland (priority — most OskarOS leads are Swiss) ───────────
  AS61969:  'Hostpoint',
  AS29222:  'Infomaniak',
  AS15623:  'Init7',
  AS13030:  'Init7',
  AS200938: 'Cyon',
  AS41051:  'Hosttech',
  AS21069:  'Metanet',
  AS6730:   'Sunrise',
  AS3303:   'Swisscom',
  AS559:    'SWITCH',
  // ── Germany / Europe ────────────────────────────────────────────────
  AS24940:  'Hetzner',
  AS213230: 'Hetzner',
  AS24961:  'myLoc / WebtropiA',
  AS8972:   'STRATO',
  AS31034:  'Aruba.it',
  AS35540:  'IONOS',
  AS8560:   'IONOS',
  AS44066:  '1&1 Versatel',
  AS16276:  'OVH',
  AS35042:  'Dedibox / Online.net',
  AS12876:  'Scaleway',
  AS47583:  'Hostinger',
  AS196752: 'Tilaa',
  AS49581:  'Fiberby',
  AS39351:  '31173 Services',
  // ── Big Cloud / Hyperscalers ────────────────────────────────────────
  AS16509:  'AWS',                    // Amazon US-East / global
  AS14618:  'AWS',                    // Amazon (different ranges)
  AS39111:  'AWS',
  AS15169:  'Google',                 // Google
  AS396982: 'Google Cloud',
  AS19527:  'Google',
  AS8075:   'Azure',                  // Microsoft
  AS8068:   'Azure',
  AS12076:  'Azure',
  AS14061:  'DigitalOcean',
  AS20473:  'Vultr / Choopa',
  AS63949:  'Akamai Linode',
  AS22612:  'NameCheap',
  AS46844:  'Sharktech',
  // ── CDNs / Edge ─────────────────────────────────────────────────────
  AS13335:  'Cloudflare',
  AS54113:  'Fastly',
  AS20940:  'Akamai',
  AS16625:  'Akamai',
  AS60068:  'CDN77',
  AS35280:  'Iliad / Free',
  AS54994:  'StackPath',
  AS27647:  'Weebly / Square',
  AS54641:  'Netlify',
  AS27496:  'Squarespace',
  AS393941: 'Vercel',
  AS21342:  'Akamai',
  AS40620:  'Centrilogic',
  // ── Website builders / SaaS hosting ─────────────────────────────────
  AS19551:  'Imperva / Incapsula',
  AS32934:  'Facebook / Meta',
  AS13414:  'Twitter / X',
  AS27357:  'Rackspace',
  AS46606:  'Hostinger',
  AS54600:  'PEG TECH',
  AS44273:  'Jimdo',
  AS46989:  'Wix',
  AS200426: 'Wix',
  // ── Generic / Legacy ────────────────────────────────────────────────
  AS9009:   'M247',
  AS30633:  'Leaseweb',
  AS27411:  'Liquid Web',
  AS25820:  'IT7 Networks',
  AS62240:  'Clouvider',
  AS62567:  'DigitalOcean',
}

function guessProviderFromAsn(asn: string | null): string | null {
  if (!asn) return null
  return ASN_PROVIDERS[asn] ?? null
}

/**
 * Resolve a domain's hosting fingerprint. Every leg fails to `null`
 * independently — the caller decides what to do with a partial result.
 *
 *   const h = await lookupHosting('example.ch')
 *   // → { ip:'91.…', ptr:'static-91-….hostpoint.ch.',
 *   //     mx:'mxc.hostpoint.ch.', asn:'AS61969', country:'CH',
 *   //     provider:'Hostpoint' }
 */
export async function lookupHosting(domain: string, timeoutMs = 5000): Promise<HostingInfo> {
  const cleaned = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
  if (!cleaned) {
    return { ip: null, ptr: null, mx: null, asn: null, country: null, provider: null }
  }

  // Resolve A + MX in parallel, both swallow errors to null.
  const [aResult, mxResult] = await Promise.all([
    nullOnFail(Promise.race([
      dns.resolve4(cleaned),
      new Promise<string[]>((_, r) => setTimeout(() => r(new Error('A timeout')), timeoutMs)),
    ])),
    nullOnFail(Promise.race([
      dns.resolveMx(cleaned),
      new Promise<MxRecord[]>((_, r) => setTimeout(() => r(new Error('MX timeout')), timeoutMs)),
    ])),
  ])

  const ip = aResult && aResult.length > 0 ? aResult[0] : null
  const mx = mxResult && mxResult.length > 0
    ? mxResult.sort((a, b) => a.priority - b.priority)[0].exchange.replace(/\.$/, '')
    : null

  // PTR + ASN need the IP. Run in parallel if we have one.
  const [ptrResult, asnResult] = ip
    ? await Promise.all([
        nullOnFail(Promise.race([
          dns.reverse(ip).then((arr) => (arr[0] || '').replace(/\.$/, '')),
          new Promise<string>((_, r) => setTimeout(() => r(new Error('PTR timeout')), timeoutMs)),
        ])),
        cymruAsnLookup(ip, timeoutMs).catch(() => ({ asn: null, country: null })),
      ])
    : [null, { asn: null, country: null }]

  const ptr = ptrResult || null
  // Provider resolution chain: PTR substring → ASN map → null.
  // Ralph 2026-06-05 · ASN fallback added so "AS16509 · US" displays as
  // "AWS · US" — common cloud providers (AWS/Google/Azure/etc.) rarely
  // have provider-named PTRs, so the bare ASN was leaking through.
  let provider = (ptr ? guessProviderFromPtr(ptr) : null) ?? guessProviderFromAsn(asnResult.asn)
  // Live Cymru AS-name fallback (Ralph 2026-06-09) — resolves any unmapped ASN
  // ("AS48971 · CH" → "Datawire AG · CH") so bare ASNs stop leaking to the UI.
  if (!provider && asnResult.asn) provider = await cymruAsnName(asnResult.asn, timeoutMs)

  return { ip, ptr, mx, asn: asnResult.asn, country: asnResult.country, provider }
}

/**
 * Compact one-line human form for the row's `hosting` lamp:
 *   "Hostpoint · CH" (when provider+country both resolved)
 *   "AS6939 · CH"    (ASN fallback when PTR didn't name a provider)
 *   "91.2.3.4"       (IP-only fallback when ASN failed too)
 *   ""               (everything failed — caller renders the empty state)
 */
export function formatHostingLamp(h: HostingInfo): string {
  const left = h.provider || h.asn || h.ip || ''
  const right = h.country || ''
  if (!left) return ''
  return right ? `${left} · ${right}` : left
}
