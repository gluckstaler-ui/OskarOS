import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { readSessionUsage, formatCost, formatTokens } from '@/lib/usage-tracker'
// (readSessionUsage is also used by DELETE — same module, single import.)

/**
 * GET /api/sessions/[id]/usage
 * Returns usage/billing data for a specific session
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }

    const usage = await readSessionUsage(sessionId)

    // 2026-05-03 (Ralph): expose cache token totals so the badge can
    // display "cached / fresh" split. Anthropic returns both fields on
    // every cache-aware response; we just sum them per session.
    const cacheReadTokens = usage.totals.cacheReadTokens ?? 0
    const cacheCreationTokens = usage.totals.cacheCreationTokens ?? 0
    // "Fresh" input = real billable input that wasn't a cache hit.
    // Anthropic's input_tokens already excludes cache reads, so freshInput
    // = inputTokens. cacheCreationTokens is billed separately at write rate
    // (1.25× / 2×) but is NOT counted in input_tokens — it's its own line.
    const freshInputTokens = usage.totals.inputTokens

    // 2026-05-04 (Ralph, Bug N): per-mode rollup. Pulled from
    // usage.totals.cli / usage.totals.api (computed at write-time by
    // appendUsage). Defaults to zeroed buckets for back-compat with
    // pre-Bug-N USAGE.json files that lack these fields.
    const cliTotals = usage.totals.cli ?? {
      inputTokens: 0, outputTokens: 0, cost: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0, entryCount: 0,
    }
    const apiTotals = usage.totals.api ?? {
      inputTokens: 0, outputTokens: 0, cost: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0, entryCount: 0,
    }
    function formatModeBlock(t: typeof cliTotals & {
      latestContextPct?: number
      latestInputTokens?: number
      latestContextWindow?: number
      latestContextSize?: number
    }) {
      const fresh = t.inputTokens
      return {
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        cost: t.cost,
        cacheCreationTokens: t.cacheCreationTokens,
        cacheReadTokens: t.cacheReadTokens,
        freshInputTokens: fresh,
        entryCount: t.entryCount,
        // Bug N (Ralph 2026-05-04): per-mode latest snapshot. Different
        // math per mode (CLI = real-time fill estimate; API = cumulative
        // input / window). Stored per-mode so toggling visibly changes
        // the % indicator.
        latestContextPct: t.latestContextPct ?? 0,
        latestInputTokens: t.latestInputTokens ?? 0,
        latestContextWindow: t.latestContextWindow ?? 200000,
        // 2026-05-04 (Ralph): per-call fill estimate. Distinct from
        // latestInputTokens (raw billing aggregate that grows past 1M).
        latestContextSize: t.latestContextSize ?? 0,
        display: {
          cost: formatCost(t.cost),
          inputTokens: formatTokens(t.inputTokens),
          outputTokens: formatTokens(t.outputTokens),
          cacheReadTokens: formatTokens(t.cacheReadTokens),
          cacheCreationTokens: formatTokens(t.cacheCreationTokens),
          freshInputTokens: formatTokens(fresh),
          cacheHitPct: t.cacheReadTokens + fresh > 0
            ? Math.round((t.cacheReadTokens / (t.cacheReadTokens + fresh)) * 100)
            : 0,
          latestInputTokens: formatTokens(t.latestInputTokens ?? 0),
          latestContextSize: formatTokens(t.latestContextSize ?? 0),
          latestContextWindow: formatTokens(t.latestContextWindow ?? 200000),
        },
      }
    }

    // Format for display
    const formatted = {
      sessionId: usage.sessionId,
      entries: usage.entries,
      totals: {
        inputTokens: usage.totals.inputTokens,
        outputTokens: usage.totals.outputTokens,
        cost: usage.totals.cost,
        cacheCreationTokens,
        cacheReadTokens,
        freshInputTokens,
      },
      display: {
        inputTokens: formatTokens(usage.totals.inputTokens),
        outputTokens: formatTokens(usage.totals.outputTokens),
        cost: formatCost(usage.totals.cost),
        totalTokens: formatTokens(usage.totals.inputTokens + usage.totals.outputTokens),
        latestContextPct: usage.totals.latestContextPct ?? 0,
        latestInputTokens: usage.totals.latestInputTokens ? formatTokens(usage.totals.latestInputTokens) : '0',
        latestContextWindow: usage.totals.latestContextWindow ?? 200000,
        // 2026-05-04 (Ralph): per-call fill estimate from formula (raw + formatted).
        latestContextSize: usage.totals.latestContextSize ?? 0,
        latestContextSizeStr: formatTokens(usage.totals.latestContextSize ?? 0),
        latestContextWindowStr: formatTokens(usage.totals.latestContextWindow ?? 200000),
        // Cache-aware display strings
        cacheReadTokens: formatTokens(cacheReadTokens),
        cacheCreationTokens: formatTokens(cacheCreationTokens),
        freshInputTokens: formatTokens(freshInputTokens),
        // Hit rate as percentage of total input throughput (read / (read+fresh))
        cacheHitPct: cacheReadTokens + freshInputTokens > 0
          ? Math.round((cacheReadTokens / (cacheReadTokens + freshInputTokens)) * 100)
          : 0,
      },
      // Bug N (Ralph 2026-05-04): per-mode rollups. Frontend reads the
      // billingMode-appropriate block; toggling billingMode flips which
      // cost is displayed.
      cli: formatModeBlock(cliTotals),
      api: formatModeBlock(apiTotals),
      breakdown: {
        cd: {
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        },
        webdev: {
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        },
      },
    }

    // Calculate per-agent breakdown
    for (const entry of usage.entries) {
      const agent = entry.agent === 'CD' ? 'cd' : entry.agent === 'WebDev' ? 'webdev' : null
      if (agent) {
        formatted.breakdown[agent].inputTokens += entry.inputTokens
        formatted.breakdown[agent].outputTokens += entry.outputTokens
        formatted.breakdown[agent].cost += entry.cost
      }
    }

    // Round breakdown costs
    formatted.breakdown.cd.cost = Math.round(formatted.breakdown.cd.cost * 10000) / 10000
    formatted.breakdown.webdev.cost = Math.round(formatted.breakdown.webdev.cost * 10000) / 10000

    // Never cache — usage changes after every chat turn AND after the reset
    // button. A stale read makes the reset look broken. (Ralph 2026-04-22)
    return NextResponse.json(formatted, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (error) {
    console.error('Failed to read session usage:', error)
    return NextResponse.json(
      { error: 'Failed to read usage data' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/sessions/[id]/usage
 *
 * Reset the dollar / token counter for this session. Overwrites
 * `public/{sessionId}/logs/USAGE.json` with the empty-shape used by
 * `readSessionUsage()` on a fresh session. The actual USAGE.json file
 * stays on disk (so tailing tools don't see a flicker of "missing") —
 * it just goes back to zeros.
 *
 * Ralph 2026-04-23: asked twice before to reset the counter by hand.
 * Now it's a button in the UsageBadge hover popup.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }
    const logsDir = join(process.cwd(), 'public', sessionId, 'logs')
    const usagePath = join(logsDir, 'USAGE.json')
    // Ensure the logs directory exists — appendUsage also creates it lazily,
    // but a brand-new session that's never logged anything wouldn't have it.
    await mkdir(logsDir, { recursive: true })

    // Ralph 2026-04-25: PRESERVE `lastBridgeCumulativeCost` across reset.
    // The bridge's `event.total_cost_usd` keeps climbing for the bridge's
    // lifetime regardless of our reset. If we zero this baseline, the next
    // chat turn would dump the entire bridge-lifetime cost into a single
    // new entry and the reset would silently undo itself one message later.
    // Read existing first, keep the baseline, zero everything else.
    const existingUsage = await readSessionUsage(sessionId)
    const empty = {
      sessionId,
      entries: [],
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        ...(typeof existingUsage.totals.lastBridgeCumulativeCost === 'number' && {
          lastBridgeCumulativeCost: existingUsage.totals.lastBridgeCumulativeCost,
        }),
      },
    }
    await writeFile(usagePath, JSON.stringify(empty, null, 2), 'utf-8')
    console.log(`[usage] Reset counter for session ${sessionId} (kept bridge baseline=${existingUsage.totals.lastBridgeCumulativeCost ?? 0})`)
    return NextResponse.json({ success: true, sessionId })
  } catch (error) {
    console.error('Failed to reset session usage:', error)
    return NextResponse.json(
      { error: 'Failed to reset usage data' },
      { status: 500 }
    )
  }
}
