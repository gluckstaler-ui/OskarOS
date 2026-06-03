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
  const provider = ptr ? guessProviderFromPtr(ptr) : null

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
