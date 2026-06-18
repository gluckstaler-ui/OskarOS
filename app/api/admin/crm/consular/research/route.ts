// ============================================================================
// app/api/admin/crm/consular/research/route.ts — WP-23 (2026-06-10, CD)
//
// THE Research button. Pressing Scan/Research on a row (Kanban `LeadDetail`
// or Scout `ScoutDossier`) POSTs {id, name, surface} here. The route injects
// ONE directive line into the Consular's existing `__crm__` session —
//
//   [OSKAR-SYSTEM RESEARCH-COMPANY] id=<…> name=<…> surface=<kanban|scout>
//
// — exactly the way [ASK-CONSULAR] arrives today, and returns immediately.
// No spawn, no fork, no second brain: the same Consular that runs the
// OVERVIEW chat does the teardown (agents/CONSULAR-agent.md § COLD-LEAD
// TEARDOWN is the doctrine) and writes home through its own SQL tool —
// `prospects.intel_json` from Kanban, `raw_prospects.scout_json.taste`
// from Scout. The `surface` token in the directive is what routes the write.
//
// Async semantics (Ralph 2026-06-10, decided):
//   - The teardown runs 60–120s in a background escrow job and HOLDS the
//     `__crm__` session lock while it works (callConsularBridge's
//     withSessionLock) — drafts and Ask-AI queue behind it; that is INTENDED.
//   - Concurrent presses: same row+surface while running → escrow dedup
//     (returns the in-flight job, publishes an "already researching" toast).
//     Different rows → escrow runs them; each bridge turn then queues FIFO
//     on the session lock. Nothing is silently dropped.
//   - Cancel: the escrow job is cancellable via the existing cancel-job
//     surface, but an in-flight Consular turn has no abort hook — cancel
//     marks the job; the current bridge turn drains before the queue moves.
//
// Comms: the Scout/Kanban screens have no visible chat, so the snackbar is
// the Consular's voice (it fires its own `snackbar` MCP calls; /crm bridges
// `cd_snackbar` events from /api/events — see app/crm/page.tsx). The route
// itself guarantees exactly TWO fixed beats: a start toast, and — the only
// hard requirement — a RED STICKY on a crashed tool loop, so a crash never
// reads as a verdict that didn't come. What the beats in between say is the
// Consular's, not the route's.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { enqueueBuild } from '@/lib/build-escrow'
import { publish } from '@/lib/event-bus'
import { callConsularBridge } from '@/lib/consular-bridge-call'
import { readRawProspect, patchRawProspect } from '@/lib/crm-store'
import { verdictTagTone, isVerdictTag } from '@/lib/verdict'
import { CRM_SESSION_ID } from '@/lib/memory/paths'

export const dynamic = 'force-dynamic'
// Enqueue is fast; the teardown runs in the bg job (same shape as scout/taste).
export const maxDuration = 30

type Surface = 'kanban' | 'scout'

/** Publish a `cd_snackbar` onto the `__crm__` bus — same payload shape as
 *  /api/mcp/snackbar, so the /crm SSE bridge renders it identically. */
function snack(text: string, severity: 'info' | 'success' | 'progress' | 'warning' | 'error', sticky?: boolean) {
  publish(CRM_SESSION_ID, {
    type: 'cd_snackbar',
    text,
    severity,
    sticky,
    level: severity === 'warning' || severity === 'error' || severity === 'progress' ? 'warn' : 'info',
  })
}

/** Enqueue ONE row's teardown — the singular directive the doctrine handles.
 *  Extracted so the single press and the Scout bulk bar share one code path. */
function enqueueOne(id: string, name: string, surface: Surface) {
  const label = name || id
  const directive = `[OSKAR-SYSTEM RESEARCH-COMPANY] id=${id} name=${label} surface=${surface}`
  const result = enqueueBuild({
    sessionId: CRM_SESSION_ID,
    kind: 'consular_research',
    // Target = surface:id — a second press on the SAME row dedups onto the
    // in-flight job; a different row enqueues its own.
    target: `${surface}:${id}`,
    runner: async ({ signal }) => {
      snack(`Consular researching ${label} — 1-2 min, findings land on the card`, 'progress', false)
      try {
        // WP-23 fix (2026-06-11, Consular). HARVEST the verdict and persist it.
        // Before this, the bridge result was discarded — every Consular teardown
        // returned "submitted" and wrote NOTHING (the route never wired the
        // verdict to the store; the swarm route does, this one didn't). The
        // Consular's SQL tool can't help here either: raw_prospects is fail-closed
        // in lib/consular/sql-tool.ts (WRITABLE_TABLES = prospects/activities/
        // contacts). So the SCOUT surface persists exactly the way the swarm route
        // does — capture the typed submit_scout_verdict, patchRawProspect it
        // (event-logged, durable, survives reboot + reseed-merge).
        const { toolCalls } = await callConsularBridge(directive, {
          expectedTools: ['submit_scout_verdict'],
        })
        if (surface === 'scout' && !signal.aborted) {
          const v = toolCalls.submit_scout_verdict as Record<string, unknown> | undefined
          if (v) {
            // MERGE into existing scout_json so the swarm's queried/capture/
            // sources survive; we only (re)write the `taste` block + scanned_at.
            const existing = (() => {
              try { return JSON.parse(readRawProspect(id)?.scout_json || '{}') as Record<string, unknown> }
              catch { return {} }
            })()
            const taste = {
              who: v.who ?? null, buying: v.buying ?? null,
              chf_est: v.chf_est ?? null, heads: v.heads ?? null,
              switching_pain: v.switching_pain ?? null, pitch: v.pitch ?? null,
              design: v.design ?? null, design_cite: v.design_cite ?? null,
              photos: v.photos ?? null, photos_cite: v.photos_cite ?? null,
              verdict_subline: v.verdict_subline ?? null,
              verdict_tag: v.verdict_tag ?? null,
              verdict_tone: isVerdictTag(v.verdict_tag) ? verdictTagTone(v.verdict_tag) : null,
            }
            await patchRawProspect(id, {
              scout_json: JSON.stringify({ ...existing, taste, scanned_at: new Date().toISOString() }),
            })
          }
        }
        if (!signal.aborted) {
          // One quiet completion marker — a turn whose Consular narrated
          // nothing still visibly ENDS. The findings themselves are in the
          // blob; the card shows them on next load/poll.
          snack(`Research done — ${label}. Open the card.`, 'success', false)
        }
      } catch (err) {
        // THE fixed requirement: a crash never reads as a verdict that
        // didn't come. Red, sticky, names the row.
        const reason = err instanceof Error ? err.message : String(err)
        snack(`Research FAILED — ${label}: ${reason}`, 'error', true)
        throw err
      }
      return { ok: true as const }
    },
  })
  if (result.deduped) {
    snack(`Already researching ${label} — the running turn will land shortly`, 'info', false)
  }
  return { id, ...result }
}

export async function POST(req: NextRequest) {
  let body: { id?: unknown; name?: unknown; surface?: unknown; items?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const surface: Surface | null =
    body.surface === 'kanban' || body.surface === 'scout' ? body.surface : null
  if (!surface) return NextResponse.json({ error: "surface must be 'kanban' | 'scout'" }, { status: 400 })

  // Normalize to a list of {id, name}. Single press: {id, name}. Scout bulk
  // bar: {items:[{id,name}]}. Either form lands as one or more rows here.
  const raw: Array<{ id?: unknown; name?: unknown }> = Array.isArray(body.items)
    ? (body.items as Array<{ id?: unknown; name?: unknown }>)
    : [{ id: body.id, name: body.name }]
  const rows = raw
    .map((r) => ({
      id: typeof r.id === 'string' ? r.id.trim() : '',
      name: typeof r.name === 'string' ? r.name.trim() : '',
    }))
    .filter((r) => r.id)
  if (!rows.length) return NextResponse.json({ error: 'id (string) or items[] required' }, { status: 400 })

  // De-dupe ids within this one request (a double-checked row).
  const seen = new Set<string>()
  const jobs = rows
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => enqueueOne(r.id, r.name, surface))

  if (jobs.length > 1) {
    snack(`${jobs.length} queued for research — the Consular works through them one at a time`, 'info', false)
  }
  return NextResponse.json({ jobs, count: jobs.length })
}
