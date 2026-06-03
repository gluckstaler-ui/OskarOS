// ==========================================
// Admin CRM API: Start a new Oskar session from a prospect
// GET  /api/admin/crm/sessions          — read all prospect→session links
//                                          (derived from filesystem scan)
// POST /api/admin/crm/sessions          — create session for prospect
//
// WP-CRM-A11 (Ralph 2026-05-22):
//   - GET no longer reads public/_crm/links.json (retired). Instead scans
//     public/*/_session-config.json and groups by prospect_id (cached).
//   - POST no longer writes links.json. It writes _session-config.json
//     in the new session folder (with prospect_id) — that's the new
//     source of truth.
//
// WP-CRM-A2 hook (Ralph 2026-05-22):
//   - POST also appends a `Started Discovery Session` activity row.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import {
  readSheet,
  readActivities,
  slugify,
  scanProspectSessions,
  invalidateLinksCache,
  appendActivity,
  type Prospect,
  type Activity,
} from '@/lib/crm-store'
import { writeSessionConfig } from '@/lib/session-config'

// ─── F1 · Discovery Bridge ──────────────────────────────────────────────
// Format the CRM-side context as a single message and inject it into CD's
// inbox via the existing /api/mcp/notify-agent pipeline (the same path the
// chat UI uses for between-turn user messages, with `from: 'user'`). CD
// picks it up on its next agent_inbox poll — which happens at the start
// of every turn — so the first response Filippo sees in the discovery chat
// already references this context. No file on disk, no CD prompt edits,
// no parallel state.
function buildCrmSeed(prospect: Prospect, recent: Activity[]): string {
  const lines: string[] = [
    `[CRM context — Filippo's working notes for this prospect]`,
    ``,
    `Company: ${prospect.company} (${prospect.id})`,
    `Contact: ${prospect.contact_name}${prospect.phone ? ' · ' + prospect.phone : ''}${prospect.email ? ' · ' + prospect.email : ''}`,
    `Stage / status: ${prospect.stage} · ${prospect.status} · CHF ${prospect.amount_chf} · ${prospect.confidence_pct}% confidence`,
  ]
  if (prospect.tags) lines.push(`Tags: ${prospect.tags}`)
  lines.push(``, `Why I approached:`)
  lines.push(prospect.notes || '(no notes yet)')
  // needs_analysis / solutions_bought were migrated into intel_json
  // (intel.pain / intel.pitch) on 2026-05-28 and dropped from Prospect.
  let intel: Record<string, unknown> = {}
  try { intel = JSON.parse(prospect.intel_json || '{}') } catch { intel = {} }
  lines.push(``, `Gaps I see (Needs Analysis):`)
  lines.push((intel.pain as string) || '(none captured yet — please probe in discovery)')
  lines.push(``, `Solutions already discussed (Solutions Bought):`)
  lines.push((intel.pitch as string) || '(none yet — first contact)')
  if (recent.length > 0) {
    lines.push(``, `Recent activities (newest first):`)
    for (const a of recent.slice(0, 5)) {
      const stamp = (a.timestamp || '').slice(0, 16).replace('T', ' ')
      const dur = a.duration_min ? ` (${a.duration_min}min)` : ''
      const note = a.notes ? ` — "${a.notes.slice(0, 140)}"` : ''
      lines.push(`- ${stamp} · ${a.type}${dur}${note}`)
    }
  }
  lines.push(``, `Please use this as the starting context for our discovery — don't re-ask what's already here.`)
  return lines.join('\n')
}

async function injectCrmSeedToCD(args: {
  sessionId: string
  prospect: Prospect
}): Promise<void> {
  // Recent activities are pulled fresh — readActivities filters by prospect_id
  // and returns newest-first. Empty array on miss/error is fine; the
  // formatter handles the empty case by omitting that section.
  let recent: Activity[] = []
  try {
    recent = readActivities(args.prospect.id)
  } catch (err) {
    console.warn('[CRM] Discovery Bridge: activities read failed (continuing without):', err)
  }
  const message = buildCrmSeed(args.prospect, recent)
  // Use OSKAR_BASE_URL / NEXT_PUBLIC_BASE_URL precedence; fall back to localhost
  // for dev. This route runs inside the Next.js process so localhost is
  // always reachable, but the env var lets prod override.
  const baseUrl =
    process.env.OSKAR_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'http://localhost:3000'
  try {
    const res = await fetch(`${baseUrl}/api/mcp/notify-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: args.sessionId,
        from: 'user',
        // fromInstance tags this so CD-side audit can distinguish a CRM-
        // bridged seed from a real UI-typed user message if it ever wants to.
        fromInstance: 'crm-bridge',
        target: 'cd',
        message,
        priority: 'high',
        replyTo: null,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>')
      console.warn(
        `[CRM] Discovery Bridge inject failed (HTTP ${res.status}, non-fatal): ${body.slice(0, 200)}`,
      )
    }
  } catch (err) {
    // Non-fatal: the session still works without the warm-open. The CD agent
    // just opens cold like it did before the bridge existed.
    console.warn('[CRM] Discovery Bridge inject failed (non-fatal):', err)
  }
}

export async function GET() {
  try {
    const links = scanProspectSessions()
    return NextResponse.json({ links })
  } catch (err) {
    console.error('[CRM] GET sessions scan failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prospectId } = (await req.json()) as { prospectId?: string }
    if (!prospectId) {
      return NextResponse.json({ error: 'prospectId required' }, { status: 400 })
    }
    const prospects = readSheet()
    const prospect = prospects.find(p => p.id === prospectId)
    if (!prospect) {
      return NextResponse.json({ error: `prospect ${prospectId} not found` }, { status: 404 })
    }

    const today = new Date().toISOString().slice(0, 10)
    const slug = slugify(prospect.company)
    const sessionId = `${today}-${slug}`
    const createdAt = new Date().toISOString()

    // WP-CRM-A12 + A11: write via the single path constant in lib/session-config.
    // This (a) ensures the file lands at `public/<sid>/logs/_session-config.json`
    // automatically, (b) merges with any existing config rather than overwriting,
    // (c) keeps atomic-write semantics, (d) is the only writer-of-truth so future
    // path moves are one-line changes.
    writeSessionConfig(sessionId, {
      prospect_id: prospectId,
      createdAt,
      outcome: null,
      phase: 1,
    })

    // A2 hook: append Started Discovery Session activity row
    try {
      await appendActivity({
        prospect_id: prospectId,
        type: 'Started Discovery Session',
        icon: 'sparkles',
        color: '#10b981',
        session_id: sessionId,
      })
    } catch (err) {
      console.warn('[CRM] activity append failed (non-fatal):', err)
    }

    // F1 · Discovery Bridge — inject CRM context into CD's inbox so the
    // first response references what Filippo already knows. Fire-and-forget:
    // we don't await the response in the user-facing flow because the
    // notify-agent call can take a moment and we don't want to delay the
    // redirect. The notify-agent endpoint itself is fast (in-memory bus),
    // but the safety margin is cheap.
    injectCrmSeedToCD({ sessionId, prospect }).catch(err =>
      console.warn('[CRM] Discovery Bridge inject error (non-fatal):', err),
    )

    // Drop the scan cache so the next GET sees this new session
    invalidateLinksCache()

    return NextResponse.json({
      sessionId,
      // `new=true` signals freshly-created (vs. existing) so the boot path
      // can log accordingly; `session=<sid>` makes Oskar load the
      // pre-created session (which already has `prospect_id` stamped in
      // its config — that's the auto back-link, no manual linking needed);
      // `tab=crm` opens the CRM subtab inside BRIEF so Filippo can keep
      // editing the lead while the discovery chat runs alongside.
      redirectUrl: `/?new=true&prospect=${encodeURIComponent(prospectId)}&session=${encodeURIComponent(sessionId)}&tab=crm`,
      link: {
        sessionId,
        createdAt,
        outcome: null,
        phase: 1,
        tokenBurn: 0,
      },
    })
  } catch (err) {
    console.error('[CRM] POST session failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
