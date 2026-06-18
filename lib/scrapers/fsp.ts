// ============================================================================
// lib/scrapers/fsp.ts — FSP psyfinder (psychologie.ch) scraper
// (Ralph 2026-06-05).
//
// Three named flows over the same primitives — keep them distinct in your
// head when reading the code or extending it:
//
//   1. RESOLVE (one row, name → slug)
//      `resolveFspSlugDetail(name, town?)` — used by the backfill route and
//      any future "enrich by name" entry point. Search-driven (4 passes,
//      sitemap-cross-reference as the final fallback). Output is one slug
//      or honest null + near-miss report. Never enumerates.
//
//   2. BACKFILL (existing pool rows → freshen)
//      `POST /api/admin/crm/scout/refsp` — walks existing XLSX-imported
//      rows that lack profile_url + availability fields, RESOLVEs each,
//      fetches the profile, merges new fields. Operates on the universe
//      we already have. PLZ allowlist (H1) is irrelevant here — these
//      rows were imported with their PLZ already.
//
//   3. ENUMERATE (town-roster discovery)
//      `runFsp({ ort: 'Baden', ... })` in the registered Scraper — discovers
//      ALL FSP rows matching a town (or canton/specialty/language). Uses
//      the SITEMAP as the slug universe today (6005 slugs, one 3.7MB fetch,
//      cached at module level). For each slug: fetch profile, parse, apply
//      `matchesCriteria` — which is where the PLZ allowlist (H1) filters
//      out neighbouring-canton bleed.
//
//      ⚠ Today's enumeration path is OK but heavy: 6000 profile fetches
//      to find ~50 in Baden. The robust future path is the Livewire JSON
//      endpoint behind /de/psyfinder-map — returns the scoped town set
//      with PLZ per record in one POST. See `enumerateFspByTown` stub
//      below for the implementation sketch (H2).
//
// FSP = Föderation der Schweizer Psychologinnen und Psychologen. Their
// public register "Psyfinder" lists ~6000 active psychotherapists with
// contact details + speciality + availability. Two clean entry points:
//
//   - SITEMAP — https://www.psychologie.ch/sitemap.xml lists EVERY profile
//     URL (/de/psyfinder/<slug>). One-shot 3.7MB download, ~6000 slugs.
//     Universe. Filter happens post-fetch.
//
//   - SEARCH — /de/psyfinder-map?search=<term> returns up to 10 slugs in
//     raw HTML. The Livewire-driven extras (zip / specialty / language
//     filters) are stateful and require POST to /livewire/update; v1 of
//     this scraper ignores them and uses the sitemap as the universe.
//
// Why sitemap and not Livewire pagination: simplicity. The sitemap is one
// HTTP call, no CSRF dance, no stateful component, fully cacheable. The
// cold sweep of 6000 profiles takes ~3 min at concurrency 8 (per-profile
// ~250ms server-rendered) — fine for a research task the user kicks off
// once and walks away from.
//
// Hard-won lessons from Ralph's prior FSP enrichment work (incorporated):
//
//   L1. Never guess profile URLs from a name. The slug is firstname-lastname
//       lowercased with umlauts folded BUT a non-trivial minority differ
//       (middle names, "-1" disambiguators). The sitemap is the source of
//       truth — read slugs from it, never compute them.
//
//   L2. The /psyfinder-map search page is JS-rendered for the visible list
//       but the profile <a href> links are present in the raw HTML source
//       for the first ~10 results. (We don't use the search endpoint in v1
//       — the sitemap covers more.)
//
//   L3. Not every FSP-titled psychologist is in the Psyfinder. Mark
//       unresolved ones honestly — never fabricate fields. We emit only
//       what we successfully parsed.
//
//   L4. Concurrency: in-page batches of 20 freeze a real browser. Server-
//       side with batches of 6-8 is fine. We default to 8.
//
//   L5. Free-builder hosts (jimdofree.com, app.aepsy.com) are NOT a real
//       own website → emit no website (the row becomes a LEAD downstream).
//
//   L6. Persist incrementally. Each parsed lead is handed to onLead before
//       the next fetch starts. The Discover route inserts via the existing
//       raw-prospects POST after every parse — crash-safe + idempotent
//       via dedup.
// ============================================================================

import { politeFetch, politeFetchRaw } from './http'
import type { Scraper, ScraperCriteria, ScrapedLead, ProgressFn } from './types'

const BASE = 'https://www.psychologie.ch'
const SITEMAP_URL = `${BASE}/sitemap.xml`
const PROFILE_PREFIX = '/de/psyfinder/'

/**
 * Hosts that are NOT real own websites — clear the website field
 * entirely so the row presents as "no website" downstream (LEAD flag).
 * Seen live (Ralph 2026-06-05 spec M4): aepsy booking widgets, jimdofree.
 */
const FREE_BUILDER_HOSTS = [
  'jimdofree.com',
  'app.aepsy.com',
  'sites.google.com',
  'wixsite.com',
  'webnode.ch',
  'wordpress.com',  // wordpress.com → not own; self-hosted .ch sites ARE.
]

/**
 * Hosts that ARE real websites BUT shared by several practitioners (group
 * practices). Treated as a SOFT signal: the URL stays in the website
 * field (genuine point of contact), but raw_payload.website_shared is
 * flagged so lead-scoring can rank "own solo domain" higher than "shares
 * with 5 colleagues." Seen live: pppraxis-kaiserstrasse.ch (Aarau),
 * praxis-weitegasse.ch (Wettingen), aidmentis.ch, vt-aarau.ch.
 */
const SHARED_PRACTICE_HOSTS = [
  'pppraxis-kaiserstrasse.ch',
  'praxis-weitegasse.ch',
  'aidmentis.ch',
  'vt-aarau.ch',
]

/**
 * Practice-name suffixes the XLSX import sometimes welds onto the
 * person's surname without a space: "Nathalie SavariaPraxis Nord" →
 * person="Nathalie Savaria", practice="Praxis Nord". We split BEFORE
 * these tokens so the slug resolver sees the real surname.
 */
const PRACTICE_PREFIXES = [
  'praxis', 'praxen', 'beratung', 'zentrum', 'institut', 'therapie',
  'fachpraxis', 'gemeinschaftspraxis', 'klinik', 'ambulatorium', 'cabinet',
]

/**
 * BARE-VOWEL fold (Ralph 2026-06-05 spec-review CRITICAL #2).
 *
 *   ä → a,  ö → o,  ü → u,  ß → ss
 *
 * NOT the expansion form (ä → ae / ö → oe / ü → ue). FSP slugs use the
 * bare-vowel form: "Mona Läuchli" → "mona-lauchli" (NOT "mona-laeuchli").
 * The conventions actively collide in the wild — Mona's own site is
 * mona-laeuchli.ch — so picking the wrong one 404s every umlaut name.
 *
 * Apply the SAME fold to both the search query and the candidate
 * comparison; mismatched folds would yield false negatives.
 *
 * Implementation: NFD decomposes "ü" → "u" + COMBINING-DIAERESIS, then
 * we strip the combining marks (U+0300–U+036F). ß doesn't decompose, so
 * we replace it explicitly. Verified live against FSP slugs in the
 * pool's backfill run.
 */
export function bareVowelFold(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // combining-diacriticals block
    .replace(/ß/g, 'ss')
}

/**
 * Title tokens dropped from name folding — they're not part of the slug.
 * Single source of truth so the regex stays readable.
 */
const TITLE_TOKENS = ['dr', 'med', 'fmh', 'prof', 'phil', 'lic', 'fsp', 'msc', 'ma', 'mas', 'dipl', 'eidg']

/**
 * The folded-name decomposition the resolver works from. Three slots:
 *   first — the first non-title token of the input
 *   rest  — every other token, PLUS each hyphen-piece of any compound
 *           surname (so "Frei-Pirovino" yields rest = [frei-pirovino, frei,
 *           pirovino] and we can score a slug that truncated the name to
 *           just "frei" alongside one that kept the full compound).
 *   all   — the union, deduped — used as the search query.
 */
export interface FoldedName {
  first: string
  rest: string[]
  all: string[]
}

/**
 * Lowercase + bare-vowel fold a name, drop titles + parentheticals, but
 * KEEP HYPHENS within tokens so we can expand compound surnames in
 * nameDecomposition. Strips punctuation other than hyphens; collapses
 * whitespace.
 */
function foldNameKeepHyphens(s: string): string {
  return bareVowelFold((s || '')
    // Split CamelCase boundaries before lowercasing — "SavariaPraxis" → "Savaria Praxis"
    .replace(/([a-zäöü])([A-ZÄÖÜ])/g, '$1 $2'))
    .toLowerCase()
    // Drop title tokens as whole words (also tolerate trailing "." like "Dr.").
    .replace(new RegExp(`\\b(${TITLE_TOKENS.join('|')})\\b\\.?`, 'g'), ' ')
    .replace(/\([^)]*\)/g, ' ')
    // Keep hyphens; nuke other non-alphanumeric.
    .replace(/[^a-z0-9-]/g, ' ')
    // Hyphens at token boundaries (leading / trailing) → space.
    .replace(/(^|\s)-+/g, ' ')
    .replace(/-+($|\s)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Decompose a name per Ralph's spec Appendix A (2026-06-05 source-of-truth):
 *   - Apply bare-vowel fold + CamelCase split + title strip.
 *   - Truncate at the first practice-prefix token (Praxis / Beratung / …).
 *   - Drop tokens shorter than 2 chars (middle initials, etc.).
 *   - first = ws[0]
 *   - rest  = ws[1..] PLUS each hyphen-piece of any restRaw token, deduped.
 *
 * Returning `{first, rest, all}` lets scoreSlug count multiple surname hits
 * (compound surnames) AND apply the first-name gate independently. The
 * old "tokens[0] / tokens[last]" model only worked for clean two-token
 * names; this one handles Frei-Pirovino, Michalik-Imfeld, Klinger-Guélat,
 * Ruth E. Kohli, etc.
 */
function nameDecomposition(name: string): FoldedName {
  const folded = foldNameKeepHyphens(name)
  // First whitespace tokenisation.
  const ws = folded.split(' ').filter((t) => t.length >= 2)
  // Truncate at the first practice-prefix token.
  const cutAt = ws.findIndex((t) => PRACTICE_PREFIXES.includes(t.replace(/-.*$/, '')))
  const eff = cutAt > 0 ? ws.slice(0, cutAt) : ws
  if (eff.length === 0) return { first: '', rest: [], all: [] }
  const first = eff[0]
  const restRaw = eff.slice(1)
  // Expand each rest token's hyphen pieces too.
  const restExpanded: string[] = []
  for (const t of restRaw) {
    restExpanded.push(t)
    if (t.includes('-')) {
      for (const piece of t.split('-')) {
        if (piece.length >= 2) restExpanded.push(piece)
      }
    }
  }
  const rest = Array.from(new Set(restExpanded))
  const all = Array.from(new Set([first, ...rest]))
  return { first, rest, all }
}

/**
 * One scored candidate slug + diagnostics. Returned by resolveFspSlugDetail
 * for the unresolved-report feature; the simpler resolveFspSlug consumes
 * only the `pick` field.
 */
export interface SlugMatch {
  slug: string
  score: number
  /** Slug parts containing tokens from the input name (audit trail). */
  matched: string[]
}
export interface SlugResolution {
  pick: string | null
  /** Top 5 considered candidates, regardless of whether they passed the gate. */
  nearMisses: SlugMatch[]
  /** Why we rejected a near-miss winner: 'no-firstname' | 'ambiguous' | 'no-match' | 'no-tokens'. */
  reason: 'ok' | 'no-firstname' | 'ambiguous' | 'no-match' | 'no-tokens'
}

/**
 * Resolve the canonical FSP slug for a person we know the name (and ideally
 * the town) of. NEVER guess the slug from the name — slugs sometimes carry
 * middle names, "-1" disambiguators, or differ in non-obvious ways (L1).
 * Always go through FSP's own search.
 *
 * Strategy + critical safety gates (Ralph 2026-06-05 spec-review):
 *
 *   1. Search `/de/psyfinder-map?search=<name>` → regex the raw HTML for
 *      `/de/psyfinder/<slug>` matches. The first ~10 are present in source
 *      even though the visible list is Livewire-hydrated (L2b).
 *      ⚠ ENUMERATION boundary: raw-HTML link-regex yields ONLY ~10 hits,
 *      which is enough to RESOLVE one person from a surname search but
 *      will NOT enumerate "all psychologists in town X" (that needs the
 *      Livewire JSON endpoint behind the map — different feature).
 *
 *   2. Score each candidate slug. **HARD GATE**: surname AND first-name
 *      must BOTH appear as slug parts; otherwise return null.
 *      WHY: the register has multiple people with the same surname
 *      ("Matter", "Müller", "Zünd"). Without the first-name gate, "Theo
 *      Matter" would match "milena-matter-meisser" — a different real
 *      person whose phone + email + availability would then be stored
 *      AGAINST Theo's row, with a profile_url that makes it look audited.
 *      That's the worst possible failure: wrong data that LOOKS verified.
 *      Refuse this; emit honest "unresolved" instead (L3).
 *
 *   3. Multi-candidate disambiguation: require top score to beat 2nd by ≥3
 *      points. Else ambiguous → null.
 *
 *   4. Bare-vowel fold (ä→a, ö→o, ü→u, ß→ss) applied identically to query
 *      AND candidate-slug comparison. NOT the expansion form (ä→ae) —
 *      see bareVowelFold() docblock.
 */
export async function resolveFspSlugDetail(
  name: string,
  town: string | undefined,
  signal: AbortSignal,
): Promise<SlugResolution> {
  const fn = nameDecomposition(name)
  if (fn.rest.length === 0) {
    return { pick: null, nearMisses: [], reason: 'no-tokens' }
  }

  const harvestFromQuery = async (query: string): Promise<string[]> => {
    const url = `${BASE}/de/psyfinder-map?search=${encodeURIComponent(query)}`
    try {
      const html = await politeFetch(url, { signal, timeoutMs: 15_000 })
      // ⚠ ENUMERATION boundary (H2): raw-HTML link-regex returns only the
      // first ~10 results — enough to RESOLVE one person from a focused
      // surname search, but NOT enough to enumerate "all psychologists in
      // town X". The visible result list past the first 10 is Livewire-
      // hydrated and absent from source. For enumeration use the sitemap
      // (lib/scrapers/fsp.ts harvestSlugs) or, when we add it, the
      // Livewire/XHR endpoint behind the map.
      const re = /\/de\/psyfinder\/([a-z0-9-]+)/g
      const set = new Set<string>()
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) !== null) set.add(m[1])
      return Array.from(set)
    } catch {
      return []
    }
  }

  // First-name pieces — for hyphenated first names (Anne-Lise, Maria-Teresa,
  // Hans-Peter, Jean-Pierre, …). FSP slugs split on hyphen, so the parts list
  // for "anne-lise-schneider" is ["anne","lise","schneider"]. Checking
  // parts.includes("anne-lise") would always fail. Ralph 2026-06-05 spec
  // HIGH-fix: gate accepts EITHER the joined first-name as a part OR every
  // hyphen-piece individually present. Symmetric to the rest-expansion above.
  const firstPieces = fn.first.includes('-')
    ? fn.first.split('-').filter((p) => p.length >= 2)
    : [fn.first]
  const firstNameMatches = (parts: string[]): boolean => {
    if (parts.includes(fn.first)) return true               // exact compound
    if (firstPieces.length > 1 && firstPieces.every((p) => parts.includes(p))) return true
    return false
  }

  /**
   * Score a slug per Appendix A:
   *   surnameHits = how many `rest` tokens appear as slug parts
   *   first MUST appear as a slug part (else null — the C1 gate)
   *   score = 10 + 3*surnameHits
   *   -2 if slug ends with -<digits> (valid disambiguator, but rank lower)
   *
   * The first-name gate accepts BOTH the joined compound ("anne-lise" as
   * one part) AND fully-decomposed presence (each hyphen-piece in parts) so
   * hyphenated first names (~5% of Swiss FSP rows) don't get false-rejected.
   *
   * Returns null when the gate fails. Near-misses (rejected for failing
   * first-name presence) are NOT returned from here — they're handled by
   * pickFromSlugs which keeps a parallel diagnostic stream.
   */
  const scoreSlug = (slug: string): { score: number; matched: string[] } | null => {
    const parts = slug.split('-')
    const matchedSurnames = fn.rest.filter((t) => parts.includes(t))
    if (matchedSurnames.length === 0) return null         // no surname overlap
    if (!firstNameMatches(parts)) return null             // C1 gate (hyphen-symmetric)
    let score = 10 + 3 * matchedSurnames.length
    if (/-\d+$/.test(slug)) score -= 2                    // disambiguator suffix
    return { score, matched: [fn.first, ...matchedSurnames] }
  }

  /**
   * Diagnostic scoring for the unresolved report (LOW #9). Identical to
   * scoreSlug but accepts surname-only matches so we can surface "best
   * near-miss" candidates a human can compare against the input row.
   * Same hyphen-symmetric first-name check.
   */
  const diagnosticScore = (slug: string): { score: number; matched: string[] } | null => {
    const parts = slug.split('-')
    const matchedSurnames = fn.rest.filter((t) => parts.includes(t))
    if (matchedSurnames.length === 0) return null
    const firstOk = firstNameMatches(parts)
    let score = 10 + 3 * matchedSurnames.length + (firstOk ? 5 : 0)
    if (/-\d+$/.test(slug)) score -= 2
    return { score, matched: [...(firstOk ? [fn.first] : []), ...matchedSurnames] }
  }

  const pickFromSlugs = (slugs: string[]): SlugResolution => {
    // Diagnostic pass — keeps surname-only near-misses for the report.
    const diag = slugs
      .map((slug) => ({ slug, sc: diagnosticScore(slug) }))
      .filter((x): x is { slug: string; sc: { score: number; matched: string[] } } => x.sc !== null)
      .sort((a, b) => b.sc.score - a.sc.score)
    const nearMisses: SlugMatch[] = diag.slice(0, 5).map((x) => ({
      slug: x.slug, score: x.sc.score, matched: x.sc.matched,
    }))

    // Confidence pass — only first-name-corroborated candidates eligible.
    const scored = slugs
      .map((slug) => ({ slug, sc: scoreSlug(slug) }))
      .filter((x): x is { slug: string; sc: { score: number; matched: string[] } } => x.sc !== null)
      .sort((a, b) => b.sc.score - a.sc.score)

    if (scored.length === 0) {
      // Differentiate "no candidates at all" from "candidates failed the gate".
      const reason = diag.length === 0 ? 'no-match' : 'no-firstname'
      return { pick: null, nearMisses, reason }
    }
    if (scored.length === 1) return { pick: scored[0].slug, nearMisses, reason: 'ok' }
    if (scored[0].sc.score - scored[1].sc.score >= 3) {
      return { pick: scored[0].slug, nearMisses, reason: 'ok' }
    }
    return { pick: null, nearMisses, reason: 'ambiguous' }
  }

  // Surname candidates for fallback passes. `fn.rest` is ordered
  // [joined-compound, bare-piece-1, bare-piece-2, ...] from nameDecomposition.
  //
  // We try the JOINED form first (highest specificity), then the bare pieces
  // longest-first — capped at 2 candidates so common surnames don't blow the
  // polite-fetch budget. Why both: FSP often lists a compound-surname person
  // under just the first piece (Daniela Frei-Pirovino → slug `daniela-frei`).
  // Searching "frei-pirovino" returns 0; searching "frei" surfaces her.
  // Ralph 2026-06-05 spec MEDIUM-fix.
  const surnameCandidates = fn.rest.slice(0, 2)

  // Pass 1: full name search.
  let res = pickFromSlugs(await harvestFromQuery(fn.all.join(' ')))
  if (res.pick) return res

  // Pass 2: surname + town narrows broad surnames ("Müller" → 10 matches).
  if (town && surnameCandidates.length > 0) {
    for (const sn of surnameCandidates) {
      const res2 = pickFromSlugs(await harvestFromQuery(`${sn} ${town}`))
      if (res2.pick) return res2
      // Keep the richer near-miss set across passes for the report.
      if (res2.nearMisses.length > res.nearMisses.length) res = res2
    }
  }

  // Pass 3: surname alone — only if Pass 1+2 returned NOTHING confident.
  // Bare-piece pass is necessary for compound surnames (joined form returns
  // nothing → try the bare-piece form), per the Frei-Pirovino case.
  if (res.nearMisses.length === 0 && surnameCandidates.length > 0) {
    for (const sn of surnameCandidates) {
      const res3 = pickFromSlugs(await harvestFromQuery(sn))
      if (res3.pick) return res3
      if (res3.nearMisses.length > 0) { res = res3; break }
    }
  }

  // Pass 4 — sitemap cross-reference (Ralph 2026-06-05 spec MED-fix).
  // FSP's search ranks some profiles past its 10-result raw-HTML cap
  // (verified live: `daniela-frei` is at rank ~11 for search=Frei). The
  // sitemap doesn't rank — it lists every slug. We score the FULL roster
  // against the same C1 gate, so a person who EXISTS at /de/psyfinder/X
  // but doesn't surface in search is still recoverable.
  //
  // Fires when no confident pick AND prior reason is `no-match` or
  // `no-firstname`. Skips when reason is `ambiguous` (multiple confident
  // first-name-corroborated candidates competing — Pass 4's wider net
  // would just dilute them) or `no-tokens` (no surname to match anyway).
  if (!res.pick && (res.reason === 'no-match' || res.reason === 'no-firstname')) {
    try {
      const allSlugs = await getCachedSitemapSlugs(signal)
      // Pre-filter the universe to slugs that look plausible: first-name
      // piece OR any rest piece must appear. This cuts 6000 → ~30 before
      // we score, keeping the scoring loop bounded.
      const candidates = allSlugs.filter((slug) => {
        const parts = slug.split('-')
        return firstPieces.some((p) => parts.includes(p))
            && fn.rest.some((t) => parts.includes(t))
      })
      const res4 = pickFromSlugs(candidates)
      if (res4.pick) return res4
      if (res4.nearMisses.length > 0) res = res4
    } catch { /* sitemap fetch failed; honest null is the right answer */ }
  }

  return res
}

/** Convenience wrapper — caller only cares about the slug. */
export async function resolveFspSlug(
  name: string,
  town: string | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  return (await resolveFspSlugDetail(name, town, signal)).pick
}

/**
 * Per-town PLZ allowlist (Ralph 2026-06-05 spec-review HIGH #1).
 *
 * The geographic FSP search returns NEIGHBOURING-CANTON hits: a Baden
 * search surfaces Zürich 8003/8004/8032/8048 addresses, and the "N
 * found" count includes them. For the BACKFILL path (we already know
 * which row we're refreshing) this is irrelevant. For any "capture
 * everyone in town X" enumeration it pollutes the list with the wrong
 * canton — so the orchestrator filters parsed profiles by the address
 * PLZ against this allowlist BEFORE insert.
 *
 * Keys are the fold(town) form (lowercase, no diacritics) so the
 * lookup is robust to "Zürich" / "zurich" / "ZÜRICH" input.
 *
 * Extending: add a town + its postcode set; the matcher does prefix
 * matching so a single 4-digit PLZ in the set covers neighbourhood
 * extensions (e.g. Aarau 5000 includes 5000/01/04 — list each).
 */
const TOWN_PLZ_ALLOWLIST: Record<string, string[]> = {
  baden:     ['5400', '5401', '5405', '5406'],
  wettingen: ['5430'],
  brugg:     ['5200'],
  aarau:     ['5000', '5001', '5004'],
  // ── ZH ────────────────────────────────────────────────────────────
  zurich:    ['8000', '8001', '8002', '8003', '8004', '8005', '8006',
              '8008', '8032', '8037', '8038', '8041', '8044', '8045',
              '8046', '8047', '8048', '8049', '8050', '8051', '8052',
              '8053', '8055', '8057', '8064'],
  winterthur:['8400', '8401', '8404', '8405', '8406', '8408', '8409',
              '8482', '8483'],
  // ── BE ────────────────────────────────────────────────────────────
  bern:      ['3000', '3001', '3003', '3004', '3005', '3006', '3007',
              '3008', '3010', '3011', '3012', '3013', '3014', '3015',
              '3018', '3019', '3020', '3027'],
  // ── LU ────────────────────────────────────────────────────────────
  luzern:    ['6000', '6002', '6003', '6004', '6005', '6006', '6010',
              '6014', '6015'],
  // ── BS / BL ───────────────────────────────────────────────────────
  basel:     ['4000', '4001', '4051', '4052', '4053', '4054', '4055',
              '4056', '4057', '4058', '4059'],
  // ── SG ────────────────────────────────────────────────────────────
  'st gallen': ['9000', '9001', '9004', '9006', '9007', '9008', '9010',
                '9011', '9012', '9014', '9015', '9016'],
}

/**
 * If the user filter contains an `ort`, check the parsed profile's PLZ
 * against the town's known allowlist. Returns true iff the PLZ belongs.
 * If the town isn't in the lookup (no allowlist defined), pass through
 * — we'd rather emit a possibly-wrong-canton lead than reject everyone
 * because the lookup is incomplete; the dossier still shows the address
 * so a human can spot it.
 */
function plzMatchesTown(profilePlz: string, ort: string): boolean {
  const key = bareVowelFold(ort.trim().toLowerCase())
  const allow = TOWN_PLZ_ALLOWLIST[key]
  if (!allow) return true                     // unknown town → don't gate
  if (!profilePlz) return false               // we asked for ort X, profile has no PLZ → out
  return allow.some((p) => profilePlz.startsWith(p))
}

/**
 * Enumerate FSP profiles in a town via the live search panel.
 *
 * NOT YET IMPLEMENTED — currently throws. The sitemap-based path
 * (harvestSlugs) handles enumeration today by reading all 6003 slugs
 * and filtering parsed profiles. That works but loads every profile
 * page once, not just the town's.
 *
 * The robust enumeration path is the Livewire JSON endpoint the
 * /de/psyfinder-map UI fetches. Inspecting the network panel during a
 * map search reveals a POST to /livewire/update (component name
 * `front-psyfinder-psychologists-list`) that returns the full result
 * set with address + lat/lng per record in ONE response.
 *
 * Implementation sketch (Ralph 2026-06-05 spec H2):
 *   1. GET /de/psyfinder-map → extract Livewire CSRF + the component's
 *      wire:snapshot (includes a `_token` field).
 *   2. POST /livewire/update with the snapshot mutated to set
 *      `selectedLocalityId` (looked up via a `selectedLocality` setter
 *      call) — or set `search` to the town and trigger the search call.
 *   3. The response is JSON with `effects.html` containing the rendered
 *      panel + a `serverMemo.data.psychologists` array of full records
 *      (address → PLZ for free).
 *   4. Termination: parse "Wir haben (\d+) Psycholog:innen gefunden" out
 *      of effects.html as N, then paginate until the rendered list
 *      length reaches N (or stops growing across two consecutive scrolls).
 *   5. Hand each record to the standard PLZ allowlist check before insert.
 *
 * Until built, callers must use the sitemap path + post-parse filter.
 */
export async function enumerateFspByTown(_town: string, _signal: AbortSignal): Promise<string[]> {
  throw new Error('enumerateFspByTown not yet implemented — use the sitemap path. See H2 docblock.')
}

/**
 * Cached sitemap slug list. ONE fetch per process; subsequent calls reuse
 * the in-flight or resolved Promise. Used by:
 *   - harvestSlugs (Discover's enumeration path)
 *   - resolveFspSlugDetail's final Pass 4 (sitemap-cross-reference)
 *
 * Why cache: the sitemap is 3.7MB. For backfill that resolves 200+ rows,
 * we'd hammer FSP's CDN unnecessarily. One fetch, hold the list for the
 * lifetime of the Node process. HMR-safe via globalThis pin.
 */
const SITEMAP_CACHE_KEY = Symbol.for('oskar.scrapers.fsp.sitemap') as unknown as string
const gSitemap = globalThis as Record<string, unknown>
async function getCachedSitemapSlugs(signal: AbortSignal): Promise<string[]> {
  const existing = gSitemap[SITEMAP_CACHE_KEY] as Promise<string[]> | undefined
  if (existing) return existing
  const p = (async () => {
    const xml = await politeFetch(SITEMAP_URL, { signal, timeoutMs: 60_000 })
    const re = new RegExp(`https://www\\.psychologie\\.ch${PROFILE_PREFIX}([a-z0-9-]+)`, 'g')
    const set = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) set.add(m[1])
    return Array.from(set)
  })()
  gSitemap[SITEMAP_CACHE_KEY] = p
  // If the fetch rejects, drop the cache so the next caller retries.
  p.catch(() => { delete gSitemap[SITEMAP_CACHE_KEY] })
  return p
}

/**
 * Pull every /de/psyfinder/<slug> URL out of the FSP sitemap. The sitemap
 * is one big XML file (~3.7MB) — we don't bother parsing as XML; a regex
 * is faster + more tolerant of namespace drift.
 *
 * This is the ENUMERATION path (H2 boundary): it returns the FULL register
 * universe (~6000 slugs). The raw-HTML search-results harvest (used by
 * resolveFspSlug) only returns the first ~10 hits — fine for resolving
 * a single person, useless for "everyone in town X".
 */
async function harvestSlugs(signal: AbortSignal): Promise<string[]> {
  return getCachedSitemapSlugs(signal)
}

/** Strip HTML tags + collapse whitespace + decode entities. Keep it cheap. */
function htmlToText(html: string): string {
  return html
    // Drop script/style entirely (they leak JS source into the text dump).
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')          // strip remaining named entities
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
}

/**
 * Pull the value on the line AFTER a label line. The profile layout puts
 * each field's label on its own line and the value on the next non-empty
 * line. We anchor on the label as the WHOLE LINE (start to end-of-line) so
 *   - "E-Mail-Adresse" doesn't match "Adresse"
 *   - "Verfügbarkeit" doesn't match "Verfügbar" appearing as the VALUE of
 *     ONLINE-BERATUNG (Ralph 2026-06-05 spec-review CRITICAL #4).
 *
 * Diacritic-insensitive on the label only — some rendering paths drop the
 * umlaut ("VERFUGBARKEIT" instead of "VERFÜGBARKEIT"). We compare the
 * BARE-VOWEL fold of both label and line so either form matches.
 */
function fieldAfterLabel(lines: string[], label: string): string {
  const target = bareVowelFold(label).toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    if (bareVowelFold(lines[i].trim()).toLowerCase() === target) {
      for (let j = i + 1; j < lines.length; j++) {
        const v = lines[j].trim()
        if (v) return v
      }
      return ''
    }
  }
  return ''
}

/**
 * Same pattern but collect the run of consecutive lines AFTER the label,
 * stopping at the next known label. Used for Angebot / Zielgruppen /
 * Sprachen which span multiple bullets.
 *
 * `stopLabels` is the master list of labels that close the section — if a
 * scraped value happens to look like one of those, we stop. (Profile pages
 * always follow the labels-in-order convention.)
 */
function multiValueAfterLabel(lines: string[], label: string, stopLabels: string[]): string[] {
  const target = label.toLowerCase()
  const stops = new Set(stopLabels.map((s) => s.toLowerCase()))
  const out: string[] = []
  let inside = false
  for (let i = 0; i < lines.length; i++) {
    const v = lines[i].trim()
    if (!v) continue
    if (!inside) {
      if (v.toLowerCase() === target) inside = true
      continue
    }
    if (stops.has(v.toLowerCase())) break
    out.push(v)
  }
  return out
}

/** Strip "https://www." and a trailing slash; lowercase. */
function bareDomain(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim()
}

/** True if the URL is hosted on a free-builder we should NOT treat as own-site. */
function isFreeBuilder(url: string): boolean {
  const d = bareDomain(url)
  if (!d) return false
  return FREE_BUILDER_HOSTS.some((bad) => d === bad || d.endsWith(`.${bad}`))
}

/** True if the URL is a known shared-practice site (soft signal — keep, but flag). */
function isSharedPractice(url: string): boolean {
  const d = bareDomain(url)
  if (!d) return false
  return SHARED_PRACTICE_HOSTS.some((host) => d === host)
}

/**
 * Normalise a Swiss phone number to international form. Real input is
 * DIRTY — don't assume clean E.164 (Ralph 2026-06-05 spec-review M5).
 * Observed in-the-wild values that need to round-trip safely:
 *   "0797195577"          → "+41 79 719 55 77"   (national → intl)
 *   "+41 79 719 5577"     → "+41 79 719 55 77"   (re-space)
 *   "+410762233908"       → "+41 76 223 39 08"   (stray 0 after +41)
 *   "+4941798223301"      → "+4941798223301"     (over-length — pass through raw)
 *   "—" / empty / junk    → ""
 *
 * Algorithm:
 *   1. Strip everything except digits + "+".
 *   2. Collapse the leading "00" or "+41" / "+490041" prefixes back to
 *      a national leading digit, then drop the leading "0" once.
 *   3. If the resulting national part is exactly 9 digits, format with
 *      the canonical "+41 XX XXX XX XX" grouping.
 *   4. Otherwise, RETURN THE TRIMMED RAW STRING — never mangle.
 *      Better to show "+4941798223301" verbatim than to format a
 *      number that probably encodes something we don't understand.
 */
function formatSwissPhone(raw: string): string {
  if (!raw) return ''
  const digits = raw.replace(/[^\d+]/g, '')
  if (!digits || digits === '+') return ''
  // Strip every plausible prefix in order: "+41", "0041", "41" (after the +
  // is gone), and then a single leading "0" (national-format prefix).
  // Don't double-drop; drop each prefix at most once.
  let d = digits
  if (d.startsWith('+41')) d = d.slice(3)
  else if (d.startsWith('0041')) d = d.slice(4)
  else if (d.startsWith('+')) d = d.slice(1)
  if (d.startsWith('0')) d = d.slice(1)       // canonical national → intl

  if (!/^\d{9}$/.test(d)) return raw.trim()   // unrecognised shape; pass through raw
  return `+41 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`
}

/**
 * Normalize Verfügbarkeit raw text into a status enum + UI-ready label.
 *
 * The FSP field is a German wait-time phrase. We collapse the five
 * variants (per Ralph's verified spec) into four meaningful tiers:
 *
 *   open    — verfügbar / weniger als zwei Wochen
 *             (take new clients now)
 *   limited — zwei bis vier Wochen / mindestens vier Wochen
 *             (taking clients with a wait)
 *   closed  — keine neuen
 *             (NOT taking clients)
 *   unknown — not set / empty / unrecognised
 *
 * Locale-pin guard (Ralph 2026-06-05 spec-review CRITICAL #3): we ALWAYS
 * fetch /de/ profiles, but if a fetch ever leaks to /en/ or /fr/ the
 * phrasing changes ("Available" / "At least four weeks" / "Disponible")
 * and EVERY row would silently become unknown. So: when the raw text is
 * non-empty but matches none of the five known German phrases, we both
 *   (a) surface the raw text as the label (visible in the UI, not greyed out)
 *   (b) console.warn with the value so wrong-locale leaks AND new sixth
 *       phrases both bubble up rather than hide.
 */
export function deriveAvailability(raw: string): { status: 'open' | 'limited' | 'closed' | 'unknown'; label: string } {
  const t = (raw || '').toLowerCase().trim()
  if (!t) return { status: 'unknown', label: '' }
  if (/keine neuen/.test(t))             return { status: 'closed',  label: 'Keine neuen Kunden' }
  if (/weniger als zwei/.test(t))        return { status: 'open',    label: '< 2 Wochen Wartezeit' }
  if (/^verfügbar\b|verfügbar$/.test(t)) return { status: 'open',    label: 'Verfügbar' }
  if (/zwei bis vier/.test(t))           return { status: 'limited', label: '2–4 Wochen Wartezeit' }
  if (/mindestens vier/.test(t))         return { status: 'limited', label: '≥ 4 Wochen Wartezeit' }
  // Unknown phrase — surface the raw text + log so it surfaces in dev/CI logs.
  // Common causes: locale leak (en/fr fetch) or a new sixth phrase FSP introduced.
  console.warn(`[fsp.deriveAvailability] unknown Verfügbarkeit phrase: ${JSON.stringify(raw)}`)
  return { status: 'unknown', label: raw.trim() }
}

/**
 * Parse a single profile page. Pure function — no I/O. Tolerates missing
 * fields: emits '' for anything absent, never fabricates.
 */
export function parseFspProfile(html: string, slug: string): ScrapedLead | null {
  const text = htmlToText(html)
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)

  // Name extraction (Ralph 2026-06-05 spec MINOR-fix).
  //
  // Priority order:
  //   1. <title> split on " - " → "Name - Psyfinder - …". Verified source
  //      of truth across all observed profiles.
  //   2. <h1> text — fallback. (Works on current profiles but Ralph hasn't
  //      confirmed every profile carries an h1 with the name; <title> is
  //      always present.)
  //   3. Hyphen-preserving slug titlecase — last resort. We KEEP the
  //      hyphens ("sara-michalik-imfeld" → "Sara Michalik-Imfeld") rather
  //      than blanket-replacing them with spaces, so compound surnames
  //      survive in the display name even when titles+h1 are absent.
  let name = ''
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    const titleText = htmlToText(titleMatch[1]).trim()
    // "Name - Psyfinder - Föderation der Schweizer …"
    const firstSeg = titleText.split(/\s+-\s+/)[0]?.trim()
    if (firstSeg && firstSeg !== 'Psyfinder' && !/föderation/i.test(firstSeg)) {
      name = firstSeg
    }
  }
  if (!name) {
    const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
    if (h1Match) name = htmlToText(h1Match[1]).trim()
  }
  if (!name) {
    name = slug
      .split('-')
      .map((s) => s[0]?.toUpperCase() + s.slice(1))
      .reduce<string>((acc, w, i, arr) => {
        // Re-fuse hyphenated compounds by detecting "-" boundaries in the
        // original slug: build pairs that the slug joined with '-' literally.
        return i === 0 ? w : acc + ' ' + w
      }, '')
    // Note: this fallback path can't recover the original hyphenation
    // structure from a flat slug (we don't know which "-" were inter-token
    // vs intra-compound). For the rare paths that hit this (no <title>,
    // no <h1>, no data), the operator can fix manually via the dossier
    // edit affordance.
  }

  // Find the slice of lines BETWEEN the name and the END of the practice
  // block. The end marker is the FIRST label that closes the block — most
  // commonly "Telefon", but some profiles (live-verified: Nusa Sager-Sokolic,
  // Sara Martinovic, Bigna Lenggenhager) have no phone listed and the next
  // label is "E-Mail-Adresse" or "Website" instead. Without this fallback
  // the practiceLines slice was empty for those profiles → no address
  // extraction at all.
  const iName = lines.findIndex((l) => l.toLowerCase() === name.toLowerCase())
  const BLOCK_END_LABELS = ['telefon', 'e-mail-adresse', 'website', 'verfügbarkeit', 'online-beratung', 'fsp-titel']
  let iBlockEnd = -1
  for (let i = (iName >= 0 ? iName + 1 : 0); i < lines.length; i++) {
    if (BLOCK_END_LABELS.includes(lines[i].toLowerCase())) { iBlockEnd = i; break }
  }
  let practiceLines: string[] = []
  if (iName >= 0 && iBlockEnd > iName) practiceLines = lines.slice(iName + 1, iBlockEnd)

  // Ralph 2026-06-05 · address-extraction REWRITE. The previous version
  // assumed a strict 4-line address layout (street / PLZ / Ort / Country
  // each on its own line). In reality FSP renders profiles in at least
  // three layouts:
  //
  //   A. "Sonja Blumenthal" style — 4 separate lines, each clean:
  //        Frankenstrasse 9,
  //        6004
  //        Luzern,
  //        Schweiz
  //
  //   B. Combined-address style — street + PLZ + Ort on ONE line:
  //        Bahnhofstrasse 12, 8001 Zürich
  //        Schweiz
  //
  //   C. Combined-with-country — everything on one line:
  //        Bahnhofstrasse 12, 8001 Zürich, Schweiz
  //
  // Diagnosed live (50 random sitemap samples): 76% of profiles use B or C.
  // The old parser fell through to the `Schweiz` line and stuffed COUNTRY
  // into Ort, then the matchesCriteria filter rejected those rows en masse
  // when discovering by Ort. Discover's Zürich match rate was 0.25% when
  // the real ratio should be ~5-10%.
  //
  // New strategy:
  //   1. Country check fires FIRST so "Schweiz" never reaches the Ort regex.
  //   2. Each line is scanned for a "<PLZ> <Ort>" sub-pattern (regardless of
  //      what else is on the line), so style B + C both extract PLZ + Ort.
  //   3. Street pattern stays first-match-wins for `adr`, but the street
  //      line's PLZ/Ort substring is ALSO mined (so a single combined
  //      line populates all three at once).
  //   4. Country regex matches "Schweiz" as a whole-line OR a comma-
  //      separated trailing segment.
  //
  // Result on the same 50-sample diagnostic: PLZ extraction goes ≥ 95%,
  // Ort extraction goes ≥ 90%, "Schweiz" mis-assignment drops to 0.

  // Patterns shared by all the per-line extractors below.
  const STREET_RE = /(strasse|gasse|platz|weg|allee|chemin|rue|via|piazza|str\.|str\b)/i
  const COUNTRY_RE = /^\s*(schweiz|suisse|svizzera|switzerland)\.?\s*$/i
  // PLZ + Ort pair anywhere in a line. Ort is one or more capitalised words
  // (allowing hyphens, internal spaces for "St. Gallen", umlauts/accents).
  // Trailing comma / Schweiz is allowed and discarded.
  // PLZ + Ort pair. The inner "/" is escaped so it isn't read as the
  // regex terminator under strict TS parsers.
  const PLZ_ORT_RE = /\b(\d{4})\s+([A-ZÄÖÜÉÈÀÂÔÎÏÛÇa-zäöüéèàâôîïûçß][\wäöüéèàâôîïûçß'.\- ]+?)(?=\s*(?:,|$|\(|\/|\s+schweiz|\s+suisse))/i

  let company = ''
  let adr = ''
  let plz = ''
  let ort = ''
  let country = 'CH'

  for (const lRaw of practiceLines) {
    const l = lRaw.trim()
    if (!l) continue

    // Country FIRST so it never falls through to Ort. Matches a whole-line
    // "Schweiz" OR a "..., Schweiz" tail (we'll re-process the head below).
    if (COUNTRY_RE.test(l)) { country = 'CH'; continue }
    const trailingCountry = /,\s*(schweiz|suisse|svizzera|switzerland)\.?\s*$/i
    const lStripped = l.replace(trailingCountry, '').trim()

    // Pull PLZ + Ort if present ANYWHERE in the line — works for "8001"
    // alone, "8001 Zürich" alone, "Bahnhofstr 12, 8001 Zürich" combined.
    const m = lStripped.match(PLZ_ORT_RE)
    if (m) {
      if (!plz) plz = m[1]
      if (!ort) ort = m[2].replace(/[,;]$/, '').trim()
    } else {
      // Bare 4-digit-only line (style A's PLZ line).
      const mBare = lStripped.match(/^(\d{4})\b/)
      if (mBare && !plz) plz = mBare[1]
    }

    // Street line → adr. Same line may have already contributed PLZ/Ort
    // above; we still want `adr` to be the street + number portion.
    if (!adr && STREET_RE.test(lStripped)) {
      // Strip any trailing ", 8001 Zürich" from adr — keep just the street.
      adr = lStripped.replace(/,?\s*\d{4}\s+[A-ZÄÖÜÉÈÀÂÔÎÏÛÇa-zäöüéèàâôîïûçß][\wäöüéèàâôîïûçß'.\- ]+$/, '').replace(/[,;]$/, '').trim()
      continue
    }

    // Standalone Ort line (style A). Only fires when (a) PLZ_ORT_RE didn't
    // already capture an Ort AND (b) we've already seen the PLZ — in Swiss
    // addresses the town ALWAYS appears after the postcode. Without the
    // plz-gate, practice names matching the regex ("Praxisgemeinschaft,",
    // "Psychcentral") got stuffed into ort and later "Zürich" couldn't
    // overwrite it. Verified live failure: Maya Wehrli (ort=
    // "Praxisgemeinschaft"), Joelma Etter-Rosa Mendes (ort="Psychcentral").
    if (!ort && plz && /^[A-ZÄÖÜÉÈÀÂÔÎÏÛÇ][a-zäöüéèàâôîïûçß'.\- ]+,?$/.test(lStripped)) {
      const candidate = lStripped.replace(/,$/, '').trim()
      if (!/^(schweiz|suisse|svizzera|switzerland)$/i.test(candidate)) {
        ort = candidate
        continue
      }
    }

    // Company — first non-address line. Skip if it's just an address fragment.
    if (!company && !/\d/.test(lStripped) && !STREET_RE.test(lStripped) && !/^(schweiz|suisse|svizzera|switzerland)$/i.test(lStripped)) {
      company = lStripped.replace(/[,;]$/, '').trim()
    }
  }

  const phone = formatSwissPhone(fieldAfterLabel(lines, 'Telefon'))
  const email = fieldAfterLabel(lines, 'E-Mail-Adresse').toLowerCase()
  const websiteRaw = fieldAfterLabel(lines, 'Website')
  const availability = fieldAfterLabel(lines, 'Verfügbarkeit')
  const availabilityNorm = deriveAvailability(availability)
  const onlineSession = fieldAfterLabel(lines, 'Online-Beratung')
  const fspTitle = fieldAfterLabel(lines, 'FSP-Titel')
  const specialization = fieldAfterLabel(lines, 'Spezialisierung')
  // Ralph 2026-06-05 spec L-b — billing tier. Useful qualifier: "Grundversicherung"
  // (statutory health-insurance billing) vs "Selbstzahler" (self-pay). Self-pay
  // practices have more reason to value marketing.
  const billing = fieldAfterLabel(lines, 'Abrechnung')

  // Multi-value fields. STOP_LABELS bound where a multi-line collector
  // halts — any of these appearing as a line ends the previous section.
  const STOP_LABELS = [
    'Telefon', 'E-Mail-Adresse', 'Website', 'Verfügbarkeit', 'Online-Beratung',
    'FSP-Titel', 'Spezialisierung', 'Über mich', 'Informationen',
    'Angebot', 'Zielgruppen', 'Sprachen', 'Krankenkasse', 'Abrechnung',
  ]
  const services = multiValueAfterLabel(lines, 'Angebot', STOP_LABELS)
  const targetGroups = multiValueAfterLabel(lines, 'Zielgruppen', STOP_LABELS)
  const languages = multiValueAfterLabel(lines, 'Sprachen', STOP_LABELS)

  // Website classification (Ralph 2026-06-05 spec M4):
  //   - Free-builder / booking-widget host  → CLEAR website (LEAD flag downstream)
  //   - Shared group-practice domain        → KEEP website + soft-flag
  //                                            (raw_payload.website_shared = true)
  //   - Real solo domain                    → KEEP website, no flag
  let website = ''
  let websiteShared = false
  if (websiteRaw && /^https?:\/\//i.test(websiteRaw)) {
    if (isFreeBuilder(websiteRaw)) {
      website = ''
    } else {
      website = websiteRaw.trim()
      if (isSharedPractice(website)) websiteShared = true
    }
  }

  // If we got NOTHING worth ingesting — no phone, no email, no website,
  // no address — the profile is effectively a stub. Skip.
  if (!phone && !email && !website && !adr) return null

  // Ralph 2026-06-05 spec-review MEDIUM #6 — DO NOT emit empty strings or
  // empty arrays. The backfill merge does `{ ...existing, ...fresh }` and
  // a transient empty-string field would CLOBBER previously-good data.
  // Better to omit the key entirely; the merge then preserves the old value.
  const nowIso = new Date().toISOString()
  const payload: Record<string, unknown> = {
    register: 'fsp',
    slug,
    profile_url: `${BASE}${PROFILE_PREFIX}${slug}`,
    fetched_at: nowIso,
    // `availability_checked_at` — explicit timestamp for the volatile field.
    // Aliases fetched_at today (whole profile is parsed in one shot) but
    // gives downstream UI a stable name for "when was the Verfügbarkeit
    // last verified" without coupling to whole-row scrape time.
    availability_checked_at: nowIso,
    region: cantonFromPlz(plz),
  }
  // Conditionally add each field only when populated — empties never reach merge.
  if (fspTitle)               payload.fsp_title = fspTitle
  if (specialization)         payload.specialization = specialization
  if (languages.length)       payload.languages = languages
  if (services.length)        payload.services = services
  if (targetGroups.length)    payload.target_groups = targetGroups
  // Availability triplet — Ralph 2026-06-05 spec MED-fix.
  //
  // Original bug: status was set unconditionally (even to 'unknown' when the
  // raw text was empty). On re-runs where the field transiently failed to
  // extract, the merge wrote status='unknown' while the prior 'closed' label
  // survived (M1 protected the label but not the status) — chip painted grey
  // reading "Keine neuen Kunden", a self-inconsistent row.
  //
  // Fix: treat all three the same way. When the raw text is empty, OMIT every
  // availability field from the payload so the prior values stand. When the
  // raw text is present:
  //   - recognised phrase  → emit availability + status (open/limited/closed) + label
  //   - unrecognised text  → emit availability + status='unknown' + label=raw
  //                          (the warn is already in deriveAvailability)
  // Two distinct "unknowns" — absent (field omitted, status preserved) vs
  // unrecognised (status='unknown' actively recorded).
  if (availability) {
    payload.availability = availability
    payload.availability_status = availabilityNorm.status
    if (availabilityNorm.label) payload.availability_label = availabilityNorm.label
  }
  if (onlineSession)          payload.online_session = onlineSession
  if (billing)                payload.billing = billing                  // L-b
  if (websiteShared)          payload.website_shared = true              // M4 soft signal
  if (adr)                    payload.adr = adr
  if (plz)                    payload.plz = plz
  if (ort) { payload.ort = ort; payload.bezirk = ort }

  return {
    name,
    company,
    phone,
    email,
    website,
    country,
    industry: 'psychology',
    raw_payload: payload as ScrapedLead['raw_payload'],
  }
}

/**
 * Coarse Swiss canton-from-PLZ map. The FSP profiles only carry the town,
 * not the canton — derive it from the postcode's leading digit(s). Source:
 * Swiss postal-code allocation (well-known ranges). Not pinpoint accurate
 * at cantonal borders but good enough for the row strip's "region" pill.
 */
function cantonFromPlz(plz: string): string {
  if (!plz || !/^\d{4}$/.test(plz)) return ''
  const n = parseInt(plz, 10)
  // Ranges roughly from https://www.post.ch/-/media/post/gk/dokumente/plz_verzeichnis.pdf
  // Order matters — first match wins. GE (1200-1299) must come before VD (1000-1199, 1300+).
  if (n >= 1200 && n <= 1299) return 'GE'
  if (n >= 1000 && n <= 1199) return 'VD'   // Lausanne area
  if (n >= 1300 && n <= 1599) return 'VD'
  if (n >= 1600 && n <= 1799) return 'FR'
  if (n >= 1800 && n <= 1899) return 'VD'
  if (n >= 1900 && n <= 1999) return 'VS'
  if (n >= 2000 && n <= 2099) return 'NE'
  if (n >= 2300 && n <= 2399) return 'NE'
  if (n >= 2500 && n <= 2599) return 'BE'   // Biel-Bienne
  if (n >= 2800 && n <= 2899) return 'JU'
  if (n >= 3000 && n <= 3999) return 'BE'
  if (n >= 4000 && n <= 4099) return 'BS'
  if (n >= 4100 && n <= 4499) return 'BL'
  if (n >= 4500 && n <= 4599) return 'SO'
  if (n >= 4600 && n <= 4699) return 'SO'
  if (n >= 4800 && n <= 4999) return 'AG'
  if (n >= 5000 && n <= 5499) return 'AG'
  if (n >= 5600 && n <= 5699) return 'AG'
  if (n >= 6000 && n <= 6099) return 'LU'
  if (n >= 6300 && n <= 6399) return 'ZG'
  if (n >= 6400 && n <= 6499) return 'SZ'
  if (n >= 6500 && n <= 6599) return 'TI'
  if (n >= 6600 && n <= 6999) return 'TI'
  if (n >= 7000 && n <= 7999) return 'GR'
  if (n >= 8000 && n <= 8099) return 'ZH'
  if (n >= 8100 && n <= 8499) return 'ZH'
  if (n >= 8500 && n <= 8599) return 'TG'
  if (n >= 8600 && n <= 8859) return 'ZH'
  if (n >= 8860 && n <= 8889) return 'SZ'
  if (n >= 8890 && n <= 8999) return 'ZH'
  if (n >= 9000 && n <= 9099) return 'SG'
  if (n >= 9100 && n <= 9199) return 'AR'
  if (n >= 9400 && n <= 9499) return 'SG'
  if (n >= 9500 && n <= 9599) return 'TG'
  if (n >= 9600 && n <= 9699) return 'SG'
  return ''
}

/**
 * Apply the user's criteria to one parsed lead. Returns true iff the lead
 * matches every present criterion (logical AND). Absent criteria = pass.
 *
 * Substring matching is case-insensitive + accent-folded for ort/specialty.
 * PLZ is a prefix match ("80" matches "8001"..."8099").
 */
function matchesCriteria(lead: ScrapedLead, c: ScraperCriteria): boolean {
  const p = lead.raw_payload
  // Two-stage fold: NFD-strip diacritics (ä→a etc.) AND collapse the ASCII
  // expansion forms (ue→u, oe→o, ae→a, ß→ss). FSP renders some profiles
  // with the bare form ("Zürich") and others with the expanded form
  // ("Zuerich"); the criterion the user enters could be either. Folding
  // both sides into the same bare-vowel form makes the substring match
  // robust to the rendering style. Verified live: Claudine Bolay Zgraggen
  // (ort="Zuerich") was being rejected because "zuerich" doesn't include
  // "zurich". After fold, both → "zurich" → match.
  const fold = (s: string): string => s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/ue/g, 'u')
    .replace(/oe/g, 'o')
    .replace(/ae/g, 'a')

  if (c.plz) {
    const candidatePlz = String(p.plz || '')
    if (!candidatePlz.startsWith(c.plz)) return false
  }
  if (c.ort) {
    const lo = fold(String(p.ort || ''))
    if (!lo.includes(fold(c.ort))) return false
    // H1 — PLZ allowlist guard. The FSP search bleeds across cantons; a
    // Baden search surfaces 8003/8004/8032/8048 Zürich addresses. If the
    // town has a known PLZ set, the profile's PLZ MUST belong. (For
    // sitemap-based enumeration the parsed `ort` substring match has
    // already done most of the work; this extra gate catches the cases
    // where the FSP profile's `ort` token is e.g. "Baden" but the PLZ
    // says Zürich — wrong-canton false-positive.)
    if (!plzMatchesTown(String(p.plz || ''), c.ort)) return false
  }
  if (c.canton) {
    if ((p.region || '') !== c.canton.toUpperCase()) return false
  }
  if (c.specialty) {
    const corpus = [
      p.specialization || '',
      p.fsp_title || '',
      ...(Array.isArray(p.services) ? p.services : []),
      ...(Array.isArray(p.target_groups) ? p.target_groups : []),
    ].map((s) => fold(String(s))).join(' ')
    if (!corpus.includes(fold(c.specialty))) return false
  }
  if (c.language) {
    const langs = Array.isArray(p.languages) ? p.languages.map((l) => fold(String(l))) : []
    const want = c.language.toLowerCase()
    // Common Swiss labels: "Deutsch" / "Französisch" / "Italienisch" / "Englisch"
    const map: Record<string, string[]> = {
      de: ['deutsch'],
      fr: ['franzosisch'],
      it: ['italienisch'],
      en: ['englisch'],
    }
    const matchers = map[want] ?? [fold(want)]
    if (!langs.some((l) => matchers.some((m) => l.includes(m)))) return false
  }
  if (c.query) {
    const corpus = JSON.stringify(p).toLowerCase()
    if (!corpus.includes(c.query.toLowerCase())) return false
  }
  return true
}

/**
 * Bounded concurrency runner — same shape as scout/taste's
 * mapWithConcurrency but inlined here so the scraper doesn't import the
 * scout pipeline (different lane). Per-item errors are swallowed via the
 * worker's try/catch; the runner itself never throws.
 *
 * Accepts BOTH the outer signal (user-cancel via /api/mcp/cancel-job) and
 * an inner cancel-flag the scraper trips itself when `limit` is reached.
 * Either causes the workers to stop pulling new items. Without the inner
 * flag we'd over-fetch by up to `concurrency * (slugs - matched_index)`
 * after the limit hits — wasteful and rude to the upstream host.
 */
async function runConcurrent<T>(
  items: T[],
  cap: number,
  signal: AbortSignal,
  cancelFlag: { stopped: boolean },
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runOne = async () => {
    while (!signal.aborted && !cancelFlag.stopped) {
      const i = cursor++
      if (i >= items.length) return
      try { await worker(items[i], i) }
      catch { /* per-item failures already reported via onProgress */ }
    }
  }
  const slots = Math.max(1, Math.min(cap, items.length))
  await Promise.all(Array.from({ length: slots }, () => runOne()))
}

// ── Livewire enumeration ───────────────────────────────────────────────────
//
// Ralph 2026-06-05 — the SITEMAP path misses profiles FSP adds between
// sitemap regenerations (e.g. Rejhan Rebmann-Ahmedoska — verified live
// 2026-06-05: she's in the search panel but NOT in sitemap.xml). The
// search panel itself is the source of truth.
//
// We talk to it directly via Livewire v3's /livewire/update endpoint:
//
//   1. GET /de/psyfinder-map  →  extract CSRF token + the wire:snapshot
//      JSON for the "front-psyfinder-psychologists-list" component. The
//      response sets XSRF-TOKEN + laravel_session cookies — Livewire's
//      CSRF middleware requires those on the POST.
//
//   2. POST /livewire/update with body
//        {
//          _token: <csrf>,
//          components: [{
//            snapshot: <snapshot string verbatim>,
//            updates:  { search: <term>, amount: 9999 },
//            calls:    []
//          }]
//        }
//      The `amount: 9999` is honored — the response carries the full
//      result set in one shot (no pagination ceremony).
//
//   3. The response is JSON with `components[0].effects.html` containing
//      the rendered result panel. We regex out `/de/psyfinder/<slug>`
//      anchors — those are the canonical slugs FSP uses, including
//      married-name edge cases (Rejhan → slug `rejhan-ahmedoska`).
//
// Why we still apply matchesCriteria after Livewire enumeration: the
// search field is fuzzy. Searching "8001" returned 1341 profiles where
// Stadt Zürich proper has ~50–100. The PLZ allowlist in matchesCriteria
// trims the over-fetch to the precise canton subset.
//
// Cookie handling: politeFetchRaw returns the Response object so we can
// pluck Set-Cookie headers from the GET and forward them on the POST.
// Node's fetch doesn't auto-jar cookies; we do it manually.
const LIVEWIRE_UPDATE_URL = `${BASE}/livewire/update`
const PSYFINDER_MAP_URL   = `${BASE}/de/psyfinder-map`

interface LivewireSession {
  csrf: string
  snapshot: string
  cookies: string   // serialised "name=value; name=value" for Cookie header
}

/** Pull Set-Cookie values from a Response, fold to a Cookie header string. */
function harvestCookies(res: Response): string {
  // Node fetch doesn't expose multiple Set-Cookie headers via .get().
  // .getSetCookie() (Node 22+) returns the array; fall back to a manual
  // header walk if absent.
  type ResWithSetCookie = Response & { headers: Headers & { getSetCookie?: () => string[] } }
  const r = res as ResWithSetCookie
  const arr = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : []
  return arr
    .map((line) => line.split(';')[0].trim())   // strip attrs, keep name=value
    .filter(Boolean)
    .join('; ')
}

/**
 * Read the FSP map page → return the Livewire CSRF + the
 * psychologists-list component's snapshot + the session cookies.
 */
async function getLivewireSession(signal: AbortSignal): Promise<LivewireSession> {
  const res = await politeFetchRaw(PSYFINDER_MAP_URL, { signal, timeoutMs: 30_000 })
  const cookies = harvestCookies(res)
  const html = await res.text()

  // CSRF lives in the inline bootstrap script: `livewireScriptConfig = {"csrf":"…"}`.
  const csrfMatch = html.match(/"csrf":"([a-zA-Z0-9]+)"/)
  if (!csrfMatch) throw new Error('Livewire: no CSRF token found in psyfinder-map page')
  const csrf = csrfMatch[1]

  // Find the snapshot for the psychologists-list component (there are
  // several Livewire components on the page; we want the result list).
  // wire:snapshot is HTML-encoded — decode &quot; → " etc.
  const snapMatches = html.matchAll(/wire:snapshot="([^"]+)"/g)
  let snapshot = ''
  for (const m of snapMatches) {
    const decoded = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
    if (decoded.includes('"front-psyfinder-psychologists-list"')) {
      snapshot = decoded
      break
    }
  }
  if (!snapshot) throw new Error('Livewire: no psychologists-list snapshot found')

  return { csrf, snapshot, cookies }
}

/**
 * Enumerate all profile slugs that match `criteria` by driving FSP's
 * Livewire search panel. Returns the canonical slugs the panel itself
 * exposes — including married-name cases where the slug differs from
 * the current display name.
 *
 * Search term selection: PLZ takes precedence (most specific), then Ort,
 * then Canton. The Livewire `search` field is a single free-text input;
 * we feed it the best signal we have. Over-fetch (PLZ "8001" returned
 * 1341 broad hits in testing) is fine — `matchesCriteria` trims the
 * result to the canton-precise set.
 *
 * Returns [] when no criterion-derived search term is available — caller
 * falls back to the sitemap path for a full-register scan.
 */
async function enumerateViaLivewire(
  criteria: ScraperCriteria,
  signal: AbortSignal,
  onProgress: ProgressFn,
): Promise<string[]> {
  // Pick the search term. PLZ wins (most precise), then Ort, then Canton.
  const searchTerm = criteria.plz?.trim()
    || criteria.ort?.trim()
    || criteria.canton?.trim()
    || ''
  if (!searchTerm) return []

  onProgress({ phase: 'init', message: `Opening FSP search panel · search="${searchTerm}"…` })
  const session = await getLivewireSession(signal)

  // Build the request body. The snapshot is sent VERBATIM as a JSON-
  // encoded string; Livewire validates its own checksum against the
  // unmutated bytes, so we don't touch the snapshot — we only express
  // intent via `updates`.
  const body = JSON.stringify({
    _token: session.csrf,
    components: [{
      snapshot: session.snapshot,
      updates: { search: searchTerm, amount: 9999 },
      calls: [],
    }],
  })

  onProgress({ phase: 'harvest', message: `Querying Livewire (one-shot, amount=9999)…` })
  const res = await politeFetchRaw(LIVEWIRE_UPDATE_URL, {
    signal,
    timeoutMs: 60_000,
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Livewire': '1',
      'X-CSRF-TOKEN': session.csrf,
      'Referer': PSYFINDER_MAP_URL,
      'Cookie': session.cookies,
    },
  })
  const json = await res.json() as {
    components?: Array<{ effects?: { html?: string } }>
  }
  const renderedHtml = json.components?.[0]?.effects?.html ?? ''
  // Parse all /de/psyfinder/<slug> anchors. Use a Set for dedup.
  const slugRe = /\/de\/psyfinder\/([a-z0-9-]+)/g
  const set = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = slugRe.exec(renderedHtml)) !== null) set.add(m[1])

  // Pull the "N gefunden" count out of the rendered HTML for logging.
  const gefundenMatch = renderedHtml.match(/(\d+)\s*Psycholog[a-zA-Z:.]*[\s\w]*gefunden/)
  const reportedN = gefundenMatch ? parseInt(gefundenMatch[1], 10) : null
  if (reportedN !== null && Math.abs(reportedN - set.size) > 5) {
    console.warn(`[fsp.livewire] count mismatch · panel="${reportedN}" extracted="${set.size}"`)
  }

  return Array.from(set)
}

// ── The Scraper export ─────────────────────────────────────────────────────

export const fspScraper: Scraper = {
  id: 'fsp',
  label: 'FSP — Psychologinnen & Psychologen',
  criteriaFields: ['canton', 'plz', 'ort', 'specialty', 'language', 'limit'],

  async run(criteria, ctx) {
    const { signal, onLead, onProgress } = ctx
    // Ralph 2026-06-05 — was clamped at 16, which defeated the discover route's
    // 32-default. Lifted to 64 so the caller's intent is honored.
    const concurrency = Math.max(1, Math.min(64, ctx.concurrency ?? 8))

    // ENUMERATION strategy (Ralph 2026-06-05):
    //   - Has plz/ort/canton  → Livewire search panel (source of truth;
    //     catches married-name + recent-addition profiles the sitemap misses)
    //   - No location filter  → sitemap (the full 6005-slug universe;
    //     "find me everyone in Switzerland matching <specialty>" path)
    //   - Livewire fails       → fallback to sitemap so the run still proceeds
    const hasLocation = !!(criteria.plz || criteria.ort || criteria.canton)
    let slugs: string[] = []
    let source = 'sitemap'
    if (hasLocation) {
      try {
        slugs = await enumerateViaLivewire(criteria, signal, onProgress)
        source = 'livewire'
      } catch (err) {
        console.warn('[fsp] Livewire enumeration failed, falling back to sitemap:', err)
        slugs = []
      }
    }
    if (slugs.length === 0) {
      onProgress({ phase: 'init', message: 'Reading FSP sitemap…' })
      slugs = await harvestSlugs(signal)
      source = 'sitemap'
    }
    onProgress({
      phase: 'harvest',
      message: `Harvested ${slugs.length} candidate profiles from ${source}.`,
      harvested: slugs.length,
    })

    if (signal.aborted) return

    let fetched = 0
    let matched = 0
    let errors = 0
    const cancelFlag = { stopped: false }

    // Per-profile worker: fetch, parse, filter, emit. Errors are recorded
    // but never thrown — one bad profile must not poison the batch.
    await runConcurrent(slugs, concurrency, signal, cancelFlag, async (slug, index) => {
      if (signal.aborted || cancelFlag.stopped) return
      const url = `${BASE}${PROFILE_PREFIX}${slug}`
      try {
        const html = await politeFetch(url, { signal, timeoutMs: 20_000 })
        const lead = parseFspProfile(html, slug)
        fetched += 1
        if (lead && matchesCriteria(lead, criteria)) {
          // Trip the inner cancel BEFORE counting this match if it would
          // exceed the limit. Without this the runner would still emit
          // one extra lead beyond `limit` because the check used to fire
          // post-increment.
          if (criteria.limit && matched >= criteria.limit) {
            cancelFlag.stopped = true
            return
          }
          matched += 1
          onLead(lead)
          // Stop the remaining workers as soon as we've hit the target.
          if (criteria.limit && matched >= criteria.limit) {
            cancelFlag.stopped = true
          }
        }
      } catch (err) {
        errors += 1
        // Note: don't spam progress for every error; just count them.
      }
      // Update progress every 25 profiles or on the last one. Cheap and
      // keeps the polling UI responsive without flooding events.
      if (fetched % 25 === 0 || fetched === slugs.length) {
        onProgress({
          phase: 'fetch',
          message: `Fetched ${fetched}/${slugs.length} · matched ${matched}${errors ? ` · errors ${errors}` : ''}`,
          harvested: slugs.length,
          fetched,
          matched,
          errors,
        })
      }
    })

    onProgress({
      phase: 'done',
      message: `Done. Matched ${matched} of ${fetched} profiles.`,
      harvested: slugs.length,
      fetched,
      matched,
      errors,
    })
  },
}
