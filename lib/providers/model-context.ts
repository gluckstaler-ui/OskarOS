/**
 * Per-model context-window lookup (Ralph 2026-05-04, Bug L).
 *
 * Anthropic's docs (verified 2026-05-04) — Opus 4.7 + Sonnet 4.6 ship with
 * 1M-token context windows natively, no beta header required. The previous
 * `contextWindow = 200000` hardcode in chat/route.ts under-reported context
 * usage by 5x, making UsageBadge percentages misleading (e.g. 200K used
 * showed as 100% when it was actually 20%).
 *
 * Source: https://platform.claude.com/docs/en/docs/build-with-claude/context-windows
 *   "Claude Opus 4.7, Claude Opus 4.6, and Claude Sonnet 4.6 have a 1M-token
 *    context window. Other Claude models, including Claude Sonnet 4.5 and
 *    Sonnet 4 (deprecated), have a 200k-token context window."
 *
 * The Claude Code CLI uses `[1m]` suffixes (e.g. `claude-opus-4-7[1m]`) as
 * its own alias system — these are NOT valid Anthropic API identifiers.
 * The CLI strips the suffix before calling the API. We accept both forms
 * here for symmetry: bridge-mode uses `[1m]` shapes, API mode uses bare
 * names.
 *
 * Default for unknown models is 200K — safe lower bound. The badge will
 * UNDER-report usage rather than miss the approaching ceiling.
 */

const CONTEXT_WINDOW_BY_MODEL: Record<string, number> = {
  // ── Anthropic — current generation (1M native) ─────────────────────
  'claude-opus-4-8': 1_000_000,        // newest Opus (launched 2026-05-29) — 1M native, no beta header
  'claude-opus-4-8[1m]': 1_000_000,    // Claude Code CLI alias
  'claude-opus-4-7': 1_000_000,        // legacy but still served + still 1M
  'claude-opus-4-7[1m]': 1_000_000,    // CLI alias
  'claude-sonnet-4-6': 1_000_000,
  'claude-sonnet-4-6[1m]': 1_000_000,  // CLI alias
  'claude-opus-4-6': 1_000_000,        // legacy but still 1M

  // ── Anthropic — 200K models ────────────────────────────────────────
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-opus-4-5-20251101': 200_000,
  'claude-opus-4-1': 200_000,
  'claude-opus-4-1-20250805': 200_000,
  'claude-sonnet-4-0': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-opus-4-0': 200_000,
  'claude-opus-4-20250514': 200_000,

  // ── Google (when WebDev API path uses Gemini directly) ─────────────
  'gemini-3.1-pro-preview': 1_000_000,

  // ── Z.ai/GLM (wire-truth models — what Z.ai actually serves) ─────────
  'glm-5.1': 200_000,
  'glm-5-turbo': 200_000,
  'glm-4.7': 200_000,
  'glm-4.5-air': 200_000,
}

const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * Returns the context-window size in tokens for the given model identifier.
 * Falls back to 200K for unknown models — safe lower bound that under-reports
 * rather than over-reports usage. Logs a warning when the lookup misses so
 * we can spot new model identifiers that need to be added to the table.
 */
export function getContextWindow(model: string | undefined | null): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW
  const known = CONTEXT_WINDOW_BY_MODEL[model]
  if (known !== undefined) return known
  console.warn(
    `[model-context] no context-window entry for "${model}"; defaulting to ${DEFAULT_CONTEXT_WINDOW}. ` +
    `Add a row to lib/providers/model-context.ts when this becomes frequent.`,
  )
  return DEFAULT_CONTEXT_WINDOW
}
