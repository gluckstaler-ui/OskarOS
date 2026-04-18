/**
 * cd-response-parser.ts — WP-6A (heuristic tiers removed 2026-04-17 per WP-15)
 *
 * Parses CD agent responses into structured { imagePrompt, feedback } output.
 *
 * Tier 1: Strict match   — `## IMAGE PROMPT\n...`
 * Tier 2: Loose match    — Any ## or ### header containing "prompt" (case-insensitive)
 * Tier 5: No prompt      — Treat entire reply as conversational feedback
 *
 * (Tiers 3 + 4 — code-block-after-"prompt" and longest-paragraph heuristics —
 * were removed 2026-04-17. Under WP-15, Ask CD replies are CONVERSATIONAL by
 * default; CD only emits `## IMAGE PROMPT` when explicitly committing to a
 * Nano-ready prompt. The old heuristic tiers misfired on conversational
 * replies — they yanked CD's question or commentary into Zone 4 and the
 * REPROMPT badge promised a committed prompt that wasn't one. Result: users
 * could click GENERATE on CD's question text and send garbage to Nano.
 *
 * New rule: only EXPLICIT prompt commitment (tier 1 or 2) routes to Zone 4.
 * Everything else → feedback only.)
 */

export interface CDParsedResponse {
  /** The extracted image prompt — null when CD didn't explicitly commit one. */
  imagePrompt: string | null
  /** CD's feedback/reasoning (null if not found). */
  feedback: string | null
  /** Which tier matched (1 = strict, 2 = loose, 5 = conversational/no prompt). */
  tier: 1 | 2 | 5
  /** The full raw response from CD. */
  raw: string
}

/**
 * Extract content between a header and the next header or EOF.
 * Trims leading/trailing whitespace.
 */
function extractSection(text: string, headerIndex: number, headerLine: string): string {
  const afterHeader = text.slice(headerIndex + headerLine.length)
  // Find next ## header (not ###)
  const nextHeader = afterHeader.match(/\n##\s+[A-Z]/)
  const section = nextHeader
    ? afterHeader.slice(0, nextHeader.index!)
    : afterHeader
  return section.trim()
}

/**
 * Extract ## FEEDBACK section if present.
 */
function extractFeedback(text: string): string | null {
  // Strict: ## FEEDBACK
  const strictFeedback = text.match(/^## FEEDBACK\s*$/m)
  if (strictFeedback) {
    const content = extractSection(text, strictFeedback.index!, strictFeedback[0])
    if (content) return content
  }

  // Loose: any header containing "feedback"
  const looseFeedback = text.match(/^#{2,3}\s+[^\n]*feedback[^\n]*/im)
  if (looseFeedback) {
    const content = extractSection(text, looseFeedback.index!, looseFeedback[0])
    if (content) return content
  }

  return null
}

/**
 * Parse a CD agent response into structured output.
 *
 * The waterfall tries increasingly relaxed patterns until one hits.
 * Logging: callers should log the tier for monitoring (>10% tier 4+ = tune CD prompt).
 */
export function parseCDResponse(raw: string): CDParsedResponse {
  if (!raw || !raw.trim()) {
    return { imagePrompt: null, feedback: null, tier: 5, raw }
  }

  const feedback = extractFeedback(raw)

  // ── Tier 1: Strict match ─────────────────────────────────────────────
  // `## IMAGE PROMPT` exactly (case-insensitive line start)
  const tier1 = raw.match(/^## IMAGE PROMPT\s*$/im)
  if (tier1) {
    const prompt = extractSection(raw, tier1.index!, tier1[0])
    if (prompt) {
      console.log('[cd-parser] Tier 1: strict ## IMAGE PROMPT match')
      return { imagePrompt: prompt, feedback, tier: 1, raw }
    }
  }

  // ── Tier 2: Loose match ──────────────────────────────────────────────
  // Any ## or ### header containing the word "prompt" (not "feedback")
  const tier2 = raw.match(/^#{2,3}\s+[^\n]*\bprompt\b[^\n]*/im)
  if (tier2) {
    // Make sure this isn't the feedback header
    const headerText = tier2[0].toLowerCase()
    if (!headerText.includes('feedback')) {
      const prompt = extractSection(raw, tier2.index!, tier2[0])
      if (prompt) {
        console.log(`[cd-parser] Tier 2: loose header match — "${tier2[0].trim()}"`)
        return { imagePrompt: prompt, feedback, tier: 2, raw }
      }
    }
  }

  // ── Tier 5 (no prompt commitment) ────────────────────────────────────
  // CD didn't emit `## IMAGE PROMPT` or any prompt-flagged header. Treat
  // the whole reply as conversational. Caller surfaces it as feedback +
  // snackbar; Zone 4 stays untouched. The user's prompt was a question
  // or context request; CD's reply was conversation, not a deliverable.
  //
  // 2026-04-17: tiers 3 + 4 removed. They guessed at "this paragraph
  // looks like a prompt" by length/heuristics. Under WP-15, CD writes
  // questions, advice, examples in quotes — none of those should land
  // in Zone 4. Use the entire raw reply as `feedback` here so callers
  // can show CD's actual words instead of a stale "didn't format
  // a clear prompt" error message.
  console.log('[cd-parser] Tier 5: no explicit ## IMAGE PROMPT — treating reply as conversational')
  return {
    imagePrompt: null,
    feedback: feedback || raw.trim(),
    tier: 5,
    raw,
  }
}
