import { NextRequest, NextResponse } from 'next/server'
import { readSessionUsage, formatCost, formatTokens } from '@/lib/usage-tracker'

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

    return NextResponse.json(formatted)
  } catch (error) {
    console.error('Failed to read session usage:', error)
    return NextResponse.json(
      { error: 'Failed to read usage data' },
      { status: 500 }
    )
  }
}
