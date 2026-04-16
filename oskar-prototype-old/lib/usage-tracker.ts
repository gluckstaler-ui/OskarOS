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
}

export interface SessionUsage {
  sessionId: string
  entries: UsageEntry[]
  totals: {
    inputTokens: number
    outputTokens: number
    cost: number
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
  return join(process.cwd(), 'public', sessionId, 'USAGE.json')
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
  task?: string
): Promise<void> {
  const usagePath = getUsagePath(sessionId)

  // Read existing
  const sessionUsage = await readSessionUsage(sessionId)

  // Create entry
  const entry: UsageEntry = {
    timestamp: new Date().toISOString(),
    agent,
    task,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: usage.cost
  }

  // Append
  sessionUsage.entries.push(entry)

  // Recalculate totals
  sessionUsage.totals = sessionUsage.entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      cost: Math.round((acc.cost + e.cost) * 10000) / 10000
    }),
    { inputTokens: 0, outputTokens: 0, cost: 0 }
  )

  // Write back
  await writeFile(usagePath, JSON.stringify(sessionUsage, null, 2), 'utf-8')

  console.log(`[Usage] ${sessionId} | ${agent} | +${usage.inputTokens}in +${usage.outputTokens}out | $${usage.cost} | Total: $${sessionUsage.totals.cost}`)
}

// ==========================================
// Convenience: Track from CLI output directly
// ==========================================

export async function trackUsageFromCLIOutput(
  sessionId: string,
  agent: 'CD' | 'WebDev',
  fullOutput: string,
  task?: string
): Promise<void> {
  const usage = parseUsageFromCLIOutput(fullOutput)

  if (usage) {
    await appendUsage(sessionId, agent, usage, task)
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
