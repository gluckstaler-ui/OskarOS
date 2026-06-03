// ==========================================
// Token Usage Tracker
// Captures CLI output, stores per-session usage
// ==========================================

import { readFile, writeFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// ==========================================
// Types
// ==========================================

export type UsageMode = 'cli' | 'api'

export interface UsageEntry {
  timestamp: string
  agent: 'CD' | 'WebDev' | 'Unknown'
  task?: string
  inputTokens: number
  outputTokens: number
  cost: number
  contextPct?: number
  contextWindow?: number
  /**
   * 2026-05-04 (Ralph): per-call context fill estimate, in tokens.
   * Distinct from `inputTokens` (which is the raw billing aggregate
   * cache_read+cache_creation+input that grows past 1M over a long
   * bridge lifetime). This is what the badge's fill/window display
   * shows, NOT inputTokens.
   */
  contextSize?: number
  // 2026-05-03 (Ralph): Anthropic prompt-caching tokens. Optional —
  // present on API-mode responses, absent on CLI / pre-cache calls.
  // Anthropic does the accounting; we just record what came back.
  cacheCreationTokens?: number
  cacheReadTokens?: number
  /**
   * 2026-05-04 (Ralph, Bug N): which billing path produced this entry.
   * 'cli' = bridge subprocess (Claude Code CLI, Max plan / Z.ai sub).
   * 'api' = direct fetch to Anthropic API (real per-token money).
   * Optional for back-compat with pre-Bug-N entries; consumers treat
   * missing as 'cli' (the dominant historical path).
   */
  mode?: UsageMode
}

/**
 * 2026-05-04 (Ralph, Bug N): per-mode aggregation. Each mode tracks its
 * own cost + token totals so the UsageBadge can display the right number
 * when the user toggles billing mode. CLI math = Claude Code's reported
 * cost (unchanged). API math = calculateCost (unchanged). Toggling the
 * mode flips which value is displayed; computation is mode-specific by
 * construction (entries are tagged at write-time).
 */
export interface ModeTotals {
  inputTokens: number
  outputTokens: number
  cost: number
  cacheCreationTokens: number
  cacheReadTokens: number
  entryCount: number
  /**
   * Per-mode "latest" snapshots — last entry's contextPct + inputTokens
   * + contextWindow. CLI computes contextPct as real-time fill estimate
   * from Claude Code's stream events. API computes contextPct as
   * cumulative input/window. Different math, different values; storing
   * them per-mode lets the badge display the correct one when the user
   * toggles. Ralph 2026-05-04 (Bug N).
   */
  latestContextPct?: number
  latestInputTokens?: number
  latestContextWindow?: number
  /**
   * 2026-05-04 (Ralph): the per-call context fill estimate from the
   * formula in chat-stream/route.ts (`estimatedContextSize` =
   * input_tokens + cache_read/num_turns + cache_creation). Stored
   * separately from `latestInputTokens` (which is the raw billing
   * aggregate and grows past the window over a long bridge lifetime).
   * The badge's "fill / window" display reads THIS, not the raw.
   */
  latestContextSize?: number
}

export interface SessionUsage {
  sessionId: string
  entries: UsageEntry[]
  totals: {
    inputTokens: number
    outputTokens: number
    cost: number
    /**
     * 2026-05-03 (Ralph): cumulative cache token totals across the session.
     * cacheReadTokens = tokens served from cache (cheap reads, ~10× cheaper).
     * cacheCreationTokens = tokens written to cache on the first call
     * (slightly more expensive: 1.25× for 5min TTL, 2× for 1h TTL).
     *
     * Display in the badge: "X read / Y written" so the user sees how
     * much of the input is hitting cache vs paying full price.
     */
    cacheCreationTokens?: number
    cacheReadTokens?: number
    latestContextPct?: number
    latestInputTokens?: number
    latestContextWindow?: number
    /**
     * 2026-05-04 (Ralph): per-call context fill from latest entry.
     * The badge's fill/window display reads this; latestInputTokens
     * is the cumulative billing aggregate and is not safe for that.
     */
    latestContextSize?: number
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
    /**
     * 2026-05-04 (Ralph, Bug N): per-mode rollup. Computed from entries[]
     * at write-time. `cli` covers entries tagged mode='cli' OR untagged
     * legacy entries (treated as CLI for back-compat — dominant historical
     * path). `api` covers entries tagged mode='api'. The cumulative
     * `cost`/`inputTokens`/`outputTokens` above remain as a session-wide
     * mix; consumers that want mode-specific values read these.
     */
    cli?: ModeTotals
    api?: ModeTotals
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
  // 2026-05-03 (Ralph): API-mode cache token counts. Anthropic returns these
  // when cache_control blocks are in the request. Optional — undefined on
  // CLI-mode calls (Claude Code doesn't surface them through the result type).
  cacheCreationTokens?: number
  cacheReadTokens?: number
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
      // 2026-05-03 (Ralph): Claude Code auto-caches the system prompt + tools
      // (per Anthropic prompt-caching docs — automatic for CLI, no flags
      // required). The cache fields show up in the result/usage block.
      // Capture them for visibility — appendUsage records them to disk.
      if (parsed.type === 'result' && (parsed.input_tokens || parsed.cost)) {
        return {
          inputTokens: parsed.input_tokens || 0,
          outputTokens: parsed.output_tokens || 0,
          cost: parsed.cost || calculateCost(parsed.input_tokens || 0, parsed.output_tokens || 0),
          cacheCreationTokens: parsed.cache_creation_input_tokens,
          cacheReadTokens: parsed.cache_read_input_tokens,
        }
      }

      // Alternative format (usage object)
      if (parsed.usage) {
        const input = parsed.usage.input_tokens || 0
        const output = parsed.usage.output_tokens || 0
        return {
          inputTokens: input,
          outputTokens: output,
          cost: calculateCost(input, output),
          cacheCreationTokens: parsed.usage.cache_creation_input_tokens,
          cacheReadTokens: parsed.usage.cache_read_input_tokens,
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

/**
 * Synchronous read of just `.totals.cost` from USAGE.json. WP-CRM-D5
 * (Ralph 2026-05-22). The CRM scan in `scanProspectSessions` is sync and
 * needs per-session cost to aggregate per-prospect. Returns 0 for missing
 * files or read errors (never throws). Reads only the cost field — full
 * usage data isn't needed here.
 */
export function readSessionCostSync(sessionId: string): number {
  const usagePath = getUsagePath(sessionId)
  if (!existsSync(usagePath)) return 0
  try {
    const content = readFileSync(usagePath, 'utf-8')
    const parsed = JSON.parse(content) as SessionUsage
    const c = parsed?.totals?.cost
    return typeof c === 'number' && isFinite(c) ? c : 0
  } catch {
    return 0
  }
}

export async function appendUsage(
  sessionId: string,
  agent: 'CD' | 'WebDev',
  usage: CLIUsageResult,
  task?: string,
  context?: { contextPct: number; contextWindow: number; contextSize?: number },
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
  /**
   * Bug N (Ralph 2026-05-04): which billing path produced this entry.
   * Tagged on the entry so the GET endpoint can compute per-mode totals
   * for the UsageBadge. Defaults to 'cli' on older callers (they all
   * happen to be CLI today, plus 'cli' is the safer historical default).
   */
  mode: UsageMode = 'cli',
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
    mode,
    ...(context && { contextPct: context.contextPct, contextWindow: context.contextWindow }),
    ...(context && typeof context.contextSize === 'number' && { contextSize: context.contextSize }),
    // 2026-05-03 (Ralph): cache token counts pass through unmodified.
    ...(typeof usage.cacheCreationTokens === 'number' && { cacheCreationTokens: usage.cacheCreationTokens }),
    ...(typeof usage.cacheReadTokens === 'number' && { cacheReadTokens: usage.cacheReadTokens }),
  }

  // Append
  sessionUsage.entries.push(entry)

  // Recalculate totals (cumulative cost + tokens + cache, latest context)
  const cumulative = sessionUsage.entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      cost: Math.round((acc.cost + e.cost) * 10000) / 10000,
      cacheCreationTokens: acc.cacheCreationTokens + (e.cacheCreationTokens || 0),
      cacheReadTokens: acc.cacheReadTokens + (e.cacheReadTokens || 0),
    }),
    { inputTokens: 0, outputTokens: 0, cost: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  )

  // 2026-05-04 (Ralph, Bug N): per-mode rollup. Untagged legacy entries
  // count toward CLI (the dominant historical path before this commit).
  // Iterates in chronological order (push-order) so the LAST entry per
  // mode wins for the latestContextPct/latestInputTokens snapshot — that
  // gives the badge the same "freshness" as the real-time stream props
  // do for CLI, but for API mode where there's no live stream.
  const perMode = sessionUsage.entries.reduce(
    (acc, e) => {
      const isApi = (e.mode ?? 'cli') === 'api'
      const bucket = isApi ? acc.api : acc.cli
      bucket.inputTokens += e.inputTokens
      bucket.outputTokens += e.outputTokens
      bucket.cost = Math.round((bucket.cost + e.cost) * 10000) / 10000
      bucket.cacheCreationTokens += e.cacheCreationTokens || 0
      bucket.cacheReadTokens += e.cacheReadTokens || 0
      bucket.entryCount += 1
      // Latest snapshot per mode — overwrites with each iteration so
      // the LAST entry's values win.
      if (typeof e.contextPct === 'number') bucket.latestContextPct = e.contextPct
      bucket.latestInputTokens = e.inputTokens
      if (typeof e.contextWindow === 'number') bucket.latestContextWindow = e.contextWindow
      if (typeof e.contextSize === 'number') bucket.latestContextSize = e.contextSize
      return acc
    },
    {
      cli: { inputTokens: 0, outputTokens: 0, cost: 0, cacheCreationTokens: 0, cacheReadTokens: 0, entryCount: 0 } as ModeTotals,
      api: { inputTokens: 0, outputTokens: 0, cost: 0, cacheCreationTokens: 0, cacheReadTokens: 0, entryCount: 0 } as ModeTotals,
    },
  )

  sessionUsage.totals = {
    ...cumulative,
    latestContextPct: context?.contextPct ?? sessionUsage.totals.latestContextPct,
    latestInputTokens: usage.inputTokens,
    latestContextWindow: context?.contextWindow ?? sessionUsage.totals.latestContextWindow,
    latestContextSize: context?.contextSize ?? sessionUsage.totals.latestContextSize,
    // Preserve OR update the bridge baseline:
    // - If we just delta'd against it, advance to the new high-water mark
    // - Otherwise, keep whatever was already there (legacy callers don't bump it)
    lastBridgeCumulativeCost:
      typeof bridgeCumulativeCost === 'number'
        ? bridgeCumulativeCost
        : sessionUsage.totals.lastBridgeCumulativeCost,
    cli: perMode.cli,
    api: perMode.api,
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
  // Sub-cent: show in cents only (no $ prefix). Above: dollars only.
  // Old version emitted "$0.72¢" which is nonsensical (dollar AND cent
  // markers on the same value). Ralph 2026-05-04.
  if (cost < 0.01) {
    return `${(cost * 100).toFixed(2)}¢`
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
