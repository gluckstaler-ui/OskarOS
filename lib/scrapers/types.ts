// ============================================================================
// lib/scrapers/types.ts — common shapes for the directory-scraper framework
// (Ralph 2026-06-05).
//
// One Scraper per official register (FSP, FMH, ...). Each Scraper exposes a
// uniform interface so the Discover route stays agnostic — it only knows
// "give me a registerId + criteria, hand me leads as they come in." Adding
// a new register is a plugin: implement the Scraper interface, drop into
// the registry in lib/scrapers/index.ts.
//
// The output shape (ScrapedLead) maps 1:1 onto the PoolCandidate shape that
// app/api/admin/crm/raw-prospects POST already ingests + dedupes. That keeps
// the dedup discipline ([SCOUT-G] in raw-prospects/route.ts) authoritative —
// scrapers never reinvent it.
// ============================================================================

/** Stable id for each register — the registry key (lib/scrapers/index.ts). */
export type RegisterId = 'fsp'

/**
 * What a register knows how to filter on. Every scraper accepts the SAME
 * criteria object — fields it doesn't understand are silently ignored. The
 * UI/Discover route never has to special-case "FSP also has a `specialty`
 * field." A new register that wants a new filter dimension extends this
 * type; old scrapers don't care.
 *
 * `query` is the catch-all free-text fallback (a register's native search
 * box). Most registers have one.
 */
export interface ScraperCriteria {
  /** Free-text. Mapped to the register's own search box when present. */
  query?: string
  /** ISO Swiss canton code (ZH, BE, AG, ...). */
  canton?: string
  /** Town / municipality name (matched substring-insensitive). */
  ort?: string
  /** Postcode (or prefix — "80" matches all 8xxx Zurich). */
  plz?: string
  /** Register-specific specialisation keyword (FSP: Paartherapie, Kinder, ...). */
  specialty?: string
  /** ISO 639-1 language code the practitioner offers (de/fr/it/en). */
  language?: string
  /** Optional cap on how many leads to return. */
  limit?: number
}

/**
 * One row of the harvested-then-parsed register entry. Maps onto the
 * PoolCandidate fields accepted by /api/admin/crm/raw-prospects so the
 * Discover route can forward the array verbatim.
 *
 * `raw_payload` is the register-specific blob — the unparsed bits the UI
 * never needs but a debugger / re-parse might. (E.g. FSP languages list,
 * services list, availability label, online-session flag.)
 */
export interface ScrapedLead {
  name: string                    // person name (h1 of profile)
  company?: string                // practice name ("Praxis für Psychotherapie")
  phone?: string                  // already-normalised; never the literal "—"
  email?: string                  // lower-cased
  website?: string                // canonicalised; never a free-builder host
  country?: string                // ISO 3166-1 alpha-2 ("CH")
  industry?: string               // a coarse industry label ("psychology")
  raw_payload: Record<string, unknown> & {
    register: RegisterId          // "fsp"
    slug: string                  // "sonja-blumenthal"
    profile_url: string           // "https://www.psychologie.ch/de/psyfinder/sonja-blumenthal"
    fetched_at: string            // ISO timestamp of when we scraped this row
    // FSP-specific (other registers add their own keys):
    fsp_title?: string            // "Fachpsychologin für Psychotherapie FSP"
    specialization?: string
    languages?: string[]
    services?: string[]
    target_groups?: string[]
    availability?: string
    /**
     * Normalised availability tier — derived from `availability` raw text.
     *   open    = taking new clients now (< 2 weeks / "Verfügbar")
     *   limited = taking new clients with a wait (2–4 wks / ≥ 4 wks)
     *   closed  = "Keine neuen Kunden"
     *   unknown = field not set or unrecognised text
     */
    availability_status?: 'open' | 'limited' | 'closed' | 'unknown'
    /** UI-ready human label for the chip ("< 2 Wochen Wartezeit", "Keine neuen Kunden", ...). */
    availability_label?: string
    /**
     * ISO timestamp of when the availability field was last verified
     * against the live FSP profile. Aliases `fetched_at` today (one
     * profile scrape → both timestamps move together) but exposed as
     * its own key so the UI can flag stale availability without coupling
     * to whole-row freshness, and a future re-scrape can prioritise
     * oldest-first. Persisted on every parse / backfill PATCH.
     */
    availability_checked_at?: string
    online_session?: string
    /** Billing tier: "Grundversicherung" / "Selbstzahler" / mixed. Lead-scoring signal. */
    billing?: string
    /**
     * True when the website is a SHARED group-practice domain (real site,
     * but multiple FSP practitioners list it). Lead-scoring should treat
     * this as a softer "has own site" signal than a solo domain.
     */
    website_shared?: boolean
    adr?: string                  // free-form address line ("Frankenstrasse 9")
    plz?: string                  // postcode ("6004")
    ort?: string                  // town ("Luzern")
    region?: string               // canton when derivable
    bezirk?: string               // sub-region; tracked by the row strip
  }
}

/**
 * Live progress sent to the polling client during a Discover run. Mirrors
 * the shape of build_vibe's progress events but tighter — Discover is a
 * single linear scan rather than a vibe build's multi-stage pipeline.
 */
export interface ScraperProgress {
  phase: 'init' | 'harvest' | 'fetch' | 'ingest' | 'done' | 'error'
  /** Human-readable status line for the UI ("Fetching profile 142 of 6003 · Sonja Blumenthal"). */
  message: string
  /** How many slugs (FSP profiles) we've enumerated so far. */
  harvested?: number
  /** How many profiles we've fetched + parsed. */
  fetched?: number
  /** How many leads matched the criteria filter. */
  matched?: number
  /** How many leads survived dedup + landed in raw_prospects. */
  inserted?: number
  /** How many were rejected by dedup. */
  deduped?: number
  /** When ingestion errored on a specific row (network blip, bad parse). */
  errors?: number
  /** Set once phase === 'done'. */
  ids?: string[]
  /** Set on phase === 'error'. */
  error?: string
}

/** Callback the framework hands each scraper for live progress reporting. */
export type ProgressFn = (p: ScraperProgress) => void

/**
 * The contract every register implements. Adding a register = implementing
 * this. The discover route never imports a register directly; it goes
 * through lib/scrapers/index.ts (the registry).
 */
export interface Scraper {
  readonly id: RegisterId
  /** User-facing name ("FSP — Psychologinnen & Psychologen"). */
  readonly label: string
  /** What query parameters the UI should surface for this register. */
  readonly criteriaFields: Array<keyof ScraperCriteria>

  /**
   * Run the discovery. Streams leads via `onLead` as they parse so the
   * Discover route can ingest incrementally instead of waiting for the
   * full set — important when a cold sweep takes several minutes.
   *
   * Honour `signal.aborted` between profile fetches; the Discover route
   * passes it through from enqueueBuild.
   */
  run(
    criteria: ScraperCriteria,
    ctx: {
      signal: AbortSignal
      onLead: (lead: ScrapedLead) => void
      onProgress: ProgressFn
      /** Concurrency cap for the per-profile fetch fanout (default 6, see L4). */
      concurrency?: number
    },
  ): Promise<void>
}
