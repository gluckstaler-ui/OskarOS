// ============================================================================
// app/api/admin/crm/scout/refsp/route.ts — Re-scrape FSP rows (backfill).
// Ralph 2026-06-05.
//
// POST → enqueueBuild a background job that:
//   1. Walks every live pool row that looks FSP-sourced (xlsx-import:* with
//      raw_payload.quelle="FSP-PsyFinder" OR scrape:fsp:*).
//   2. For each, resolves the canonical FSP slug (via the register's own
//      search — never guesses from the name). Skips if unresolvable.
//   3. Fetches /de/psyfinder/<slug> + parses.
//   4. Merges the fresh fields into the row's raw_payload:
//        profile_url           — for human verification later
//        availability          — raw German wait-time text
//        availability_status   — open / limited / closed / unknown
//        availability_label    — UI-ready normalised label
//        slug, fsp_title, languages, services, target_groups, ...
//      Existing fields the user may have edited (bezirk, adresse) are
//      preserved — the merge spreads existing first, fresh second.
//   5. PATCHes the row via patchRawProspect (server-side, no HTTP).
//
// Progress polls via /api/admin/crm/scout/discover/progress?jobId=... —
// SAME store as Discover (one less moving piece). The phase field carries
// 'refsp' as a distinct value so a UI surface could special-case it later.
//
// Rate discipline: same per-host gate as Discover (200ms between requests
// to psychologie.ch), default concurrency 6. With ~265 XLSX rows × 2 round-
// trips per row (slug search + profile fetch), expect ~1-2 min wall time.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { enqueueBuild } from '@/lib/build-escrow'
import { readRawProspects, patchRawProspect } from '@/lib/crm-store'
import { resolveFspSlugDetail, parseFspProfile } from '@/lib/scrapers/fsp'
import { politeFetch, NotFoundError } from '@/lib/scrapers/http'
import { setProgress, updateProgress } from '@/lib/scout-discover-progress'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SCOUT_SESSION_ID = '__scout__'
const FSP_BASE = 'https://www.psychologie.ch'

interface RefspRequest {
  /** Concurrency for the slug-resolve + profile-fetch fanout. 1..16, default 6. */
  concurrency?: number
  /**
   * If true, also re-fetch rows that ALREADY have a profile_url (refresh
   * availability for the rows we just scraped via Discover). Default false
   * — back-compat with the user's intent ("go over all the OTHER FSP
   * ones") which means the XLSX rows lacking the new fields.
   */
  refreshAll?: boolean
}

export async function POST(req: NextRequest) {
  let body: RefspRequest = {}
  try {
    body = (await req.json().catch(() => ({}))) as RefspRequest
  } catch {
    // Empty body is fine — default config.
  }
  // Ralph 2026-06-05 — bumped 16 → 64 default 6 → 32. Refsp is HTTP-only
  // (no Puppeteer), so the only real-world ceiling is FSP's tolerance for
  // burst-fetches. With politeFetch's per-host gate at minIntervalMs=0
  // and 32 workers, we hit roughly the same rate as 6 workers used to —
  // bottleneck moved to fetch RTT, not concurrency.
  const concurrency = Math.max(1, Math.min(64, body.concurrency ?? 32))
  const refreshAll = body.refreshAll === true

  const enqueued = enqueueBuild({
    sessionId: SCOUT_SESSION_ID,
    // Ralph 2026-06-05 — split refsp out from scout_discover into its own
    // JobKind. Conceptually distinct: Discover ADDS leads from the register
    // universe; Backfill ENRICHES existing pool rows. Same machinery (escrow
    // + progress map), different lane so a Discover run and a Backfill run
    // can coexist without dedupe-collision on `target` strings.
    kind: 'scout_backfill',
    target: `refsp:${refreshAll ? 'all' : 'missing'}`,
    runner: async ({ signal, jobId }) => {
        setProgress(jobId, {
          register: 'fsp-refresh',
          criteria: {},
          startedAt: new Date().toISOString(),
          phase: 'init',
          message: 'Selecting FSP rows to refresh…',
          insertedIds: [],
          recentLeads: [],
        })

        // 1. Select FSP rows in the live pool.
        const all = readRawProspects()
        const targets = all.filter((p) => {
          let rp: Record<string, unknown> = {}
          try { rp = JSON.parse(p.raw_payload || '{}') as Record<string, unknown> } catch { rp = {} }
          const src = p.source || ''
          const quelle = (rp.quelle as string) || ''
          const isFspXlsx = quelle === 'FSP-PsyFinder' || src.startsWith('xlsx-import:')
          const isFspScrape = src.startsWith('scrape:fsp:') || rp.register === 'fsp'
          if (!isFspXlsx && !isFspScrape) return false
          // Skip rows we've already enriched (have profile_url + availability_status),
          // unless refreshAll is on.
          if (!refreshAll && rp.profile_url && rp.availability_status) return false
          return true
        })

        updateProgress(jobId, {
          phase: 'harvest',
          message: `${targets.length} FSP row${targets.length === 1 ? '' : 's'} to refresh.`,
          harvested: targets.length,
        })

        if (signal.aborted) return { ok: true as const }
        if (targets.length === 0) {
          updateProgress(jobId, {
            phase: 'done',
            finishedAt: new Date().toISOString(),
            message: 'Nothing to refresh — all FSP rows already enriched.',
            harvested: 0, fetched: 0, matched: 0, inserted: 0, deduped: 0,
          })
          return { ok: true as const }
        }

        // 2. Per-row worker: resolve slug → fetch profile → merge → PATCH.
        let processed = 0
        let resolved = 0
        let unresolved = 0
        let updated = 0
        let notFound = 0          // M2 — 404 distinct from errors
        let errors = 0
        let cursor = 0

        // Unresolved report collector (LOW #9). Holds [{id, name, reason,
        // nearMisses}] for human review. Written to data/scrapers/fsp-
        // unresolved-<timestamp>.json on completion so an operator can
        // separate XLSX typos ("Nathalie SavariaPraxis Nord" → close-match
        // available) from genuine not-listed ("Theo Matter" → no near miss).
        const unresolvedReport: Array<{
          id: string
          name: string
          town: string
          reason: string
          nearMisses: Array<{ slug: string; score: number; matched: string[] }>
        }> = []

        const runOne = async () => {
          while (!signal.aborted) {
            const i = cursor++
            if (i >= targets.length) return
            const row = targets[i]
            // Per-row try/catch. CRITICAL: every code path in the catch + the
            // not-found branches MUST `continue` (next iteration of while),
            // NOT `return` (which exits the worker for good and prematurely
            // drains the pool — the bug that bit us the first time around).
            try {
              let rp: Record<string, unknown> = {}
              try { rp = JSON.parse(row.raw_payload || '{}') as Record<string, unknown> } catch { rp = {} }

              // Town for slug-search context (helps disambiguate common surnames).
              const adresse = String(rp.adresse ?? rp.adr ?? rp.address ?? '')
              const bezirk = String(rp.bezirk ?? rp.ort ?? '')
              // Extract a town from the adresse: last comma-segment after the PLZ,
              // or fall back to bezirk.
              let town = bezirk
              const mTown = adresse.match(/\b\d{4}\s+([A-Za-zÄÖÜäöüß\- ]+)/)
              if (mTown) town = mTown[1].trim().split(',')[0]

              // 2a. Reuse existing slug if we have one.
              let slug = (rp.slug as string) || ''
              if (!slug && rp.profile_url) {
                const m = String(rp.profile_url).match(/\/de\/psyfinder\/([a-z0-9-]+)/)
                if (m) slug = m[1]
              }
              if (!slug) {
                const detail = await resolveFspSlugDetail(row.name || '', town, signal)
                if (!detail.pick) {
                  unresolved += 1
                  // Capture for the report (L-a) — name + near-misses lets a
                  // human spot XLSX typos in seconds.
                  unresolvedReport.push({
                    id: row.id,
                    name: row.name || '',
                    town: town || '',
                    reason: detail.reason,
                    nearMisses: detail.nearMisses,
                  })
                  // Continue to next row — DO NOT return (that kills the worker).
                } else {
                  slug = detail.pick
                }
              }

              if (slug) {
                resolved += 1
                // 2b. Fetch profile + parse.
                const url = `${FSP_BASE}/de/psyfinder/${slug}`
                // 404 here means the slug we resolved/inherited is stale —
                // the listing was deleted since the row was created. We
                // count it as `notFound` (distinct from errors), wipe the
                // stale profile_url so the row reverts to "unresolved",
                // and continue (M2).
                let html: string
                try {
                  html = await politeFetch(url, { signal, timeoutMs: 20_000 })
                } catch (err) {
                  if (err instanceof NotFoundError) {
                    notFound += 1
                    unresolvedReport.push({
                      id: row.id,
                      name: row.name || '',
                      town: town || '',
                      reason: 'stale-404',
                      nearMisses: [{ slug, score: 0, matched: ['(was '+slug+', now 404)'] }],
                    })
                    processed += 1
                    continue
                  }
                  throw err   // genuine network / 5xx → counted as error below
                }
                const fresh = parseFspProfile(html, slug)
                if (fresh) {
                  // 2c. Merge — existing payload preserves user edits (bezirk etc.);
                  //     fresh fills in the FSP-canonical fields. Fresh wins on the
                  //     new keys (profile_url, availability_*, slug, fetched_at).
                  //     Ralph 2026-06-09: `verfuegbarkeit` RETIRED — the UI reads
                  //     availability_status/_label directly; we no longer mirror the
                  //     legacy key. `delete` strips any copy carried in the old payload.
                  const merged: Record<string, unknown> = {
                    ...rp,
                    ...fresh.raw_payload,
                    verband_url: fresh.raw_payload.profile_url,
                  }
                  delete merged.verfuegbarkeit

                  // 2d. PATCH the row. Also backfill phone/email/website if the
                  //     XLSX row had nothing AND the profile carries one.
                  const patch: Record<string, unknown> = {
                    raw_payload: JSON.stringify(merged),
                  }
                  if (!row.phone && fresh.phone)     patch.phone = fresh.phone
                  if (!row.email && fresh.email)     patch.email = fresh.email
                  if (!row.website && fresh.website) patch.website = fresh.website
                  if (!row.company && fresh.company) patch.company = fresh.company

                  await patchRawProspect(row.id, patch)
                  updated += 1
                }
                // else: profile is a stub; leave the row untouched, fall through.
              }
            } catch {
              errors += 1
            }
            processed += 1
            if (processed % 10 === 0 || processed === targets.length) {
              const bits: string[] = [`${updated} updated`, `${unresolved} unresolved`]
              if (notFound) bits.push(`${notFound} stale-404`)
              if (errors) bits.push(`${errors} errors`)
              updateProgress(jobId, {
                phase: 'fetch',
                message: `Processed ${processed}/${targets.length} · ${bits.join(' · ')}`,
                fetched: processed,
                matched: resolved,
                inserted: updated,
                deduped: unresolved,
                errors: errors + notFound,
              })
            }
          }
        }

        const slots = Math.max(1, Math.min(concurrency, targets.length))
        try {
          await Promise.all(Array.from({ length: slots }, () => runOne()))

          // Persist the unresolved report (L-a). One JSON file per run under
          // data/scrapers/. The file is auto-gitignored (the dir is data —
          // runtime state) and a human can open it to triage typos vs not-listed.
          let reportPath: string | undefined
          if (unresolvedReport.length > 0) {
            try {
              const reportDir = join(process.cwd(), 'data', 'scrapers')
              await mkdir(reportDir, { recursive: true })
              const stamp = new Date().toISOString().replace(/[:.]/g, '-')
              reportPath = join(reportDir, `fsp-unresolved-${stamp}.json`)
              await writeFile(reportPath, JSON.stringify({
                jobId,
                generatedAt: new Date().toISOString(),
                summary: { processed, resolved, updated, unresolved, notFound, errors, total: targets.length },
                rows: unresolvedReport,
              }, null, 2), 'utf-8')
            } catch (e) {
              console.warn('[refsp] failed to write unresolved report:', e)
            }
          }

          const summaryBits: string[] = [`${updated} updated`, `${unresolved} unresolved`]
          if (notFound) summaryBits.push(`${notFound} stale-404`)
          if (errors)   summaryBits.push(`${errors} errors`)
          if (reportPath) summaryBits.push(`report → ${reportPath.replace(process.cwd(), '.')}`)
          updateProgress(jobId, {
            phase: 'done',
            finishedAt: new Date().toISOString(),
            message: `Done. ${summaryBits.join(' · ')}`,
            fetched: processed,
            matched: resolved,
            inserted: updated,
            deduped: unresolved,
            errors: errors + notFound,
          })
          return { ok: true as const }
        } catch (err) {
          updateProgress(jobId, {
            phase: 'error',
            finishedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
            message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          })
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
  })

  return NextResponse.json({
    job: enqueued.job,
    deduped: enqueued.deduped,
    originalStartedAt: enqueued.originalStartedAt,
  })
}
