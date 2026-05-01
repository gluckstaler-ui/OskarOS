// ==========================================
// Token Usage Tracker
// Captures CLI output, stores per-session usage
// ==========================================

import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

// ==========================================
// Types
// ==========================================

export interface UsageEntry {
  timestamp: string
  agent: 'CD' | 'WebDev' | 'Unknown'
  task?: string
  inputTokens: number
  outputTokens: number
  cost: number
  contextPct?: number
  contextWindow?: number
}

export interface SessionUsage {
  sessionId: string
  entries: UsageEntry[]
  totals: {
    inputTokens: number
    outputTokens: number
    cost: number
    latestContextPct?: number
    latestInputTokens?: number
    latestContextWindow?: number
    /**
     * Last `total_cost_usd` value the bridge emitted for this session.
     *
     * Why: Claude Agent SDK's `total_cost_usd` is MONOTONICALLY CUMULATIVE
     * for the bridge's lifetime (since bridge boot), not per-turn. To get
     * the per-turn cost we have to subtract: turnCost = current - last.
     *
     * This field PERSISTS across reset (DELETE wipes entries[] and the
     * displayed `cost`, but keeps `lastBridgeCumulativeCost`). Otherwise
     * the next turn's delta would be the bridge's full lifetime total
     * and the reset would silently undo itself on the next chat turn —
     * which is exactly the bug the field was added to fix.
     * (Ralph 2026-04-25)
     */
    lastBridgeCumulativeCost?: number
  }
}

// ==========================================
// Pricing (Claude 3.5/4 Sonnet)
// ==========================================

const PRICING = {
  inputPerMillion: 3.00,   // $3 per 1M input tokens
  outputPerMillion: 15.00  // $15 per 1M output tokens
}

export function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * PRICING.inputPerMillion
  const outputCost = (outputTokens / 1_000_000) * PRICING.outputPerMillion
  return Math.round((inputCost + outputCost) * 10000) / 10000 // 4 decimal places
}

// ==========================================
// Parse CLI Output for Usage Stats
// ==========================================

export interface CLIUsageResult {
  inputTokens: number
  outputTokens: number
  cost: number
}

/**
 * Parse the final JSON line from Claude CLI stream-json output
 * Looks for: {"type":"result","cost":0.0234,"input_tokens":1523,"output_tokens":892}
 */
export function parseUsageFromCLIOutput(fullOutput: string): CLIUsageResult | null {
  const lines = fullOutput.trim().split('\n')

  // Try last few lines (sometimes there's trailing whitespace)
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
    const line = lines[i].trim()
    if (!line) continue

    try {
      const parsed = JSON.parse(line)

      // Claude CLI result format
      if (parsed.type === 'result' && (parsed.input_tokens || parsed.cost)) {
        return {
          inputTokens: parsed.input_tokens || 0,
          outputTokens: parsed.output_tokens || 0,
          cost: parsed.cost || calculateCost(parsed.input_tokens || 0, parsed.output_tokens || 0)
        }
      }

      // Alternative format (usage object)
      if (parsed.usage) {
        const input = parsed.usage.input_tokens || 0
        const output = parsed.usage.output_tokens || 0
        return {
          inputTokens: input,
          outputTokens: output,
          cost: calculateCost(input, output)
        }
      }
    } catch {
      // Not JSON, continue
    }
  }

  return null
}

// ==========================================
// Store Usage to Session
// ==========================================

function getUsagePath(sessionId: string): string {
  return join(process.cwd(), 'public', sessionId, 'logs', 'USAGE.json')
}

export async function readSessionUsage(sessionId: string): Promise<SessionUsage> {
  const usagePath = getUsagePath(sessionId)

  if (!existsSync(usagePath)) {
    return {
      sessionId,
      entries: [],
      totals: { inputTokens: 0, outputTokens: 0, cost: 0 }
    }
  }

  try {
    const content = await readFile(usagePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {
      sessionId,
      entries: [],
      totals: { inputTokens: 0, outputTokens: 0, cost: 0 }
    }
  }
}

export async function appendUsage(
  sessionId: string,
  agent: 'CD' | 'WebDev',
  usage: CLIUsageResult,
  task?: string,
  context?: { contextPct: number; contextWindow: number },
  /**
   * If `usage.cost` is the BRIDGE'S CUMULATIVE total_cost_usd (monotonic
   * since bridge boot), pass it here too. We compute the per-turn delta
   * against `totals.lastBridgeCumulativeCost` from the previous write.
   *
   * If omitted (legacy callers, WebDev CLI track), `usage.cost` is taken
   * as-is — assumed to be per-turn already.
   *
   * Bridge restart detection: if `bridgeCumulativeCost < stored`, the
   * bridge restarted (counter went back to 0); we treat the new value
   * as the turn cost directly.
   *
   * Reset preservation: even after `DELETE /api/sessions/:id/usage`
   * wipes entries[] and `totals.cost`, `totals.lastBridgeCumulativeCost`
   * is preserved by the DELETE handler so this delta math stays correct.
   * (Ralph 2026-04-25)
   */
  bridgeCumulativeCost?: number,
): Promise<void> {
  const usagePath = getUsagePath(sessionId)

  // Read existing
  const sessionUsage = await readSessionUsage(sessionId)

  // Compute the actual per-turn cost
  let entryCost = usage.cost
  if (typeof bridgeCumulativeCost === 'number') {
    const stored = sessionUsage.totals.lastBridgeCumulativeCost ?? 0
    if (bridgeCumulativeCost < stored) {
      // Bridge restarted (cumulative reset to 0 or near-0). Treat the
      // emitted value as the turn cost directly.
      entryCost = bridgeCumulativeCost
      console.log(`[Usage] ${sessionId} | bridge restart detected (was=${stored}, now=${bridgeCumulativeCost})`)
    } else {
      entryCost = Math.max(0, bridgeCumulativeCost - stored)
    }
  }

  // Create entry
  const entry: UsageEntry = {
    timestamp: new Date().toISOString(),
    agent,
    task,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: entryCost,
    ...(context && { contextPct: context.contextPct, contextWindow: context.contextWindow }),
  }

  // Append
  sessionUsage.entries.push(entry)

  // Recalculate totals (cumulative cost + tokens, latest context)
  const cumulative = sessionUsage.entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      cost: Math.round((acc.cost + e.cost) * 10000) / 10000
    }),
    { inputTokens: 0, outputTokens: 0, cost: 0 }
  )

  sessionUsage.totals = {
    ...cumulative,
    latestContextPct: context?.contextPct ?? sessionUsage.totals.latestContextPct,
    latestInputTokens: usage.inputTokens,
    latestContextWindow: context?.contextWindow ?? sessionUsage.totals.latestContextWindow,
    // Preserve OR update the bridge baseline:
    // - If we just delta'd against it, advance to the new high-water mark
    // - Otherwise, keep whatever was already there (legacy callers don't bump it)
    lastBridgeCumulativeCost:
      typeof bridgeCumulativeCost === 'number'
        ? bridgeCumulativeCost
        : sessionUsage.totals.lastBridgeCumulativeCost,
  }

  // Write back
  await writeFile(usagePath, JSON.stringify(sessionUsage, null, 2), 'utf-8')

  console.log(`[Usage] ${sessionId} | ${agent} | +${usage.inputTokens}in +${usage.outputTokens}out | turn:$${entryCost.toFixed(4)} | Total: $${sessionUsage.totals.cost} | Context: ${context?.contextPct ?? '?'}%`)
}

// ==========================================
// Convenience: Track from CLI output directly
// ==========================================

export async function trackUsageFromCLIOutput(
  sessionId: string,
  agent: 'CD' | 'WebDev',
  fullOutput: string,
  task?: string,
  context?: { contextPct: number; contextWindow: number }
): Promise<void> {
  const usage = parseUsageFromCLIOutput(fullOutput)

  if (usage) {
    await appendUsage(sessionId, agent, usage, task, context)
  } else {
    console.log(`[Usage] ${sessionId} | ${agent} | No usage data found in CLI output`)
  }
}

// ==========================================
// Format for display
// ==========================================

export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(2)}¢`
  }
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return tokens.toString()
}
