// ============================================================================
// app/api/admin/crm/scout/discover/route.ts — Discover from an official
// register (FSP first) into the Scout pool. Ralph 2026-06-05.
//
// POST {register: 'fsp', criteria: {...}, concurrency?: 8}
//   → enqueueBuild({ sessionId: '__scout__', kind: 'scout_discover',
//                    runner }) → { job, deduped }
//
// The runner streams leads from the chosen Scraper, batches them into
// raw-prospects POSTs (50 at a time) so the pool fills incrementally,
// and writes a globalThis-pinned progress payload the UI can poll via
// GET /api/admin/crm/scout/discover/progress?jobId=XXX.
//
// Why a separate progress endpoint (not /api/mcp/job-status):
//   The escrow `JobResult` is a fixed shape that only carries final
//   facts. We want LIVE telemetry — slugs harvested, profiles fetched,
//   matches so far, current message line. Storing that on `job.result`
//   would couple the escrow type to every job kind. A sibling progress
//   map keyed by jobId stays out of the way.
//
// Dedup: handled by the raw-prospects POST endpoint (the existing
// three-leg dedup logic — domain · phone|email · name|adresse, against
// BOTH the pool and the live prospects sheet). We don't re-implement it.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { enqueueBuild } from '@/lib/build-escrow'
import { getScraper } from '@/lib/scrapers'
import { setProgress, updateProgress, appendInsertedIds, appendRecentLeads, getProgress, type DiscoverLeadEntry } from '@/lib/scout-discover-progress'
import { ingestRawProspectCandidates } from '@/lib/raw-prospects-ingest'
import type { ScrapedLead, ScraperCriteria } from '@/lib/scrapers/types'

export const dynamic = 'force-dynamic'
// Enqueue is fast; the heavy work runs in the bg job. Keep the route
// timeout short so a misuse never pins the request loop.
export const maxDuration = 30

const SCOUT_SESSION_ID = '__scout__'

// ── POST ───────────────────────────────────────────────────────────────────

interface DiscoverRequest {
  register?: string
  criteria?: ScraperCriteria
  /** Concurrency for per-profile fetches (clamped 1..16, default 8). */
  concurrency?: number
  /** Batch size for raw-prospects POST. Default 50 (one POST per ~50 leads). */
  batchSize?: number
}

export async function POST(req: NextRequest) {
  let body: DiscoverRequest
  try {
    body = (await req.json()) as DiscoverRequest
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const registerId = String(body.register ?? '').trim().toLowerCase()
  if (!registerId) return NextResponse.json({ error: 'register required' }, { status: 400 })
  const scraper = getScraper(registerId)
  if (!scraper) return NextResponse.json({ error: `unknown register: ${registerId}` }, { status: 404 })

  const criteria: ScraperCriteria = body.criteria ?? {}
  // Ralph 2026-06-05 — default 8 → 32, max 16 → 64. The previous low ceiling
  // was a cap I added defensively; removed. Caller can still pass any value
  // in body.concurrency; the upper bound exists only to prevent pathological
  // input (a 9999 wouldn't help the network anyway).
  const concurrency = Math.max(1, Math.min(64, body.concurrency ?? 32))
  // Ralph 2026-06-05 — batchSize default dropped from 50 → 1 so every match
  // flushes to the pool immediately. Original 50 was a noise-reduction guess
  // (fewer HTTP round-trips) but it created a worse problem: for any criteria
  // returning <50 matches, the user saw the matched counter climb while
  // `inserted` stayed at 0 for the whole run — the ambient overlay's
  // "recent" list never populated until the final drain flush fired.
  // Per-match flushing trades ~10ms × N of localhost POST overhead for live
  // row-by-row visibility. With concurrency=8 the cost is dominated by
  // network fetches anyway; ingest is in the noise.
  const batchSize = Math.max(1, Math.min(200, body.batchSize ?? 1))

  const enqueued = enqueueBuild({
    sessionId: SCOUT_SESSION_ID,
    kind: 'scout_discover',
    target: `${registerId}:${JSON.stringify(criteria)}`,
    runner: async ({ signal, jobId }) => {
        // Seed the progress entry so a poll immediately after POST sees
        // something rather than an unknown-jobId 404.
        setProgress(jobId, {
          register: registerId,
          criteria,
          startedAt: new Date().toISOString(),
          phase: 'init',
          message: 'Starting…',
          insertedIds: [],
          recentLeads: [],
        })

        let pending: ScrapedLead[] = []
        let inserted = 0
        let deduped = 0

        // Serialized flush chain — every onLead call schedules a flush
        // tail-appended to the previous, so concurrent worker fanouts
        // (8 simultaneous fetch threads, each calling onLead synchronously)
        // never race against each other for the same dedup snapshot.
        // Without this, 8 onLead calls would fire 8 parallel POSTs to
        // /raw-prospects, each reading the pool BEFORE any of them wrote,
        // so all 8 dedup checks see the same baseline and a duplicate
        // could slip through. Chaining via .then() forces strict order.
        let flushChain: Promise<void> = Promise.resolve()

        // In-process ingest (Ralph 2026-06-05) — replaced
        //   await fetch(`${origin}/api/admin/crm/raw-prospects`, …)
        // because Next.js dev's localhost-to-self fetch silently hangs
        // across HMR cycles. Inserted=0 despite matched=135 was the
        // smoking gun. Direct function call has none of those failure
        // modes and dedup logic is byte-identical (shared lib).
        /**
         * Drain `pending` into the ingest lib, then translate the result
         * into per-lead activity-feed entries so the overlay shows EVERY
         * matched candidate's outcome (Ralph 2026-06-05) — not just the
         * inserted ones. Drives the scrollable list in ScoutJobsOverlay.
         *
         * Mapping the lib's response back to leads:
         *   - `r.ids[]`        — the new R-ids, in input order (success path)
         *   - `r.skippedDetail` — `{row, reason}` per dedup, where `row` is
         *                         the index into the batch (the lib uses
         *                         array.forEach((_, idx) → idx)
         *   - Anything in batch NOT in skippedDetail → consumed an id slot.
         */
        const flush = async () => {
          if (pending.length === 0) return
          const batch = pending
          pending = []
          try {
            const r = await ingestRawProspectCandidates(
              batch.map((l) => ({
                name: l.name,
                company: l.company,
                phone: l.phone,
                email: l.email,
                website: l.website,
                country: l.country,
                industry: l.industry,
                raw_payload: l.raw_payload,
              })),
              { source: `scrape:${registerId}:${new Date().toISOString().slice(0, 10)}` },
            )
            inserted += r.created
            deduped += r.skipped
            updateProgress(jobId, { inserted, deduped })
            appendInsertedIds(jobId, r.ids)

            // Build per-lead activity entries — one per batch row. Newer
            // entries go FIRST in the appended slice; the lib in
            // scout-discover-progress prepends, so freshest land at top.
            const skippedByIdx = new Map(r.skippedDetail.map((s) => [s.row, s.reason]))
            const entries: DiscoverLeadEntry[] = []
            let idCursor = 0
            batch.forEach((lead, idx) => {
              const profileUrl = typeof lead.raw_payload?.profile_url === 'string'
                ? (lead.raw_payload.profile_url as string)
                : undefined
              const skip = skippedByIdx.get(idx)
              if (skip) {
                entries.push({
                  name: lead.name || lead.company || '(unnamed)',
                  status: 'duplicate',
                  reason: skip,
                  detail: profileUrl,
                })
              } else {
                const id = r.ids[idCursor++]
                entries.push({
                  name: lead.name || lead.company || '(unnamed)',
                  status: 'inserted',
                  id,
                  detail: profileUrl,
                })
              }
            })
            // Reverse so the prepend puts oldest-in-batch DEEPEST in the
            // overlay (the newest match floats to the top of the feed).
            appendRecentLeads(jobId, entries.reverse())
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            const prev = getProgress(jobId)
            updateProgress(jobId, {
              errors: (prev?.errors ?? 0) + 1,
              message: `Ingest failed: ${reason}`,
            })
            // Stamp every lead in the batch as failed so the overlay
            // reflects what didn't make it through.
            const entries: DiscoverLeadEntry[] = batch.map((lead) => ({
              name: lead.name || lead.company || '(unnamed)',
              status: 'failed',
              reason,
              detail: typeof lead.raw_payload?.profile_url === 'string' ? (lead.raw_payload.profile_url as string) : undefined,
            }))
            appendRecentLeads(jobId, entries.reverse())
          }
        }

        const scheduleFlush = () => {
          flushChain = flushChain.then(() => flush()).catch(() => { /* errors recorded inside flush */ })
        }

        try {
          await scraper.run(criteria, {
            signal,
            concurrency,
            onLead: (lead) => {
              pending.push(lead)
              if (pending.length >= batchSize) {
                scheduleFlush()
              }
            },
            onProgress: (p) => {
              updateProgress(jobId, { ...p, inserted, deduped })
            },
          })

          // Drain any trailing leads still pending, then await the WHOLE
          // chain so the post-loop `inserted` reflects every successful
          // POST (not just the ones that finished before the await).
          scheduleFlush()
          await flushChain

          updateProgress(jobId, {
            phase: 'done',
            finishedAt: new Date().toISOString(),
            inserted,
            deduped,
            message: `Done. Inserted ${inserted} new · ${deduped} already in pool/pipeline.`,
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

// ── GET — list available scrapers (for the Discover modal) ─────────────────

export async function GET() {
  const { listScrapers } = await import('@/lib/scrapers')
  return NextResponse.json({ scrapers: listScrapers() })
}
