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

    // Format for display
    const formatted = {
      sessionId: usage.sessionId,
      entries: usage.entries,
      totals: {
        inputTokens: usage.totals.inputTokens,
        outputTokens: usage.totals.outputTokens,
        cost: usage.totals.cost,
      },
      display: {
        inputTokens: formatTokens(usage.totals.inputTokens),
        outputTokens: formatTokens(usage.totals.outputTokens),
        cost: formatCost(usage.totals.cost),
        totalTokens: formatTokens(usage.totals.inputTokens + usage.totals.outputTokens),
        latestContextPct: usage.totals.latestContextPct ?? 0,
        latestInputTokens: usage.totals.latestInputTokens ? formatTokens(usage.totals.latestInputTokens) : '0',
        latestContextWindow: usage.totals.latestContextWindow ?? 200000,
      },
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
