/**
 * markdown-fields.ts — the ONE place we parse markdown-style key/value lines.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WHY THIS FILE EXISTS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * CD agents write files that the system parses: IMAGES.md, CREATIVE-BRIEF.md,
 * VIBE-X.md, BUILD.md, SESSION.md state blocks. Each of these files is a
 * mix of `Field: value` and `**Field:** value` lines.
 *
 * Until 2026-04-25 every parser had its OWN regex for these lines. They
 * disagreed in subtle ways:
 *
 *   /\*\*Vibe(?:\*\*)?:\s*(.+)/        — bold-only, breaks on plain
 *   /(?:\*\*)?Vibe(?:\*\*)?:\s*(.+)/   — accepts both, BUT closing `**`
 *                                         is on the wrong side of the colon
 *                                         → leaks `** ` prefix into value
 *   /\*\*Vibe:\*\*\s*(.+)/             — bold-only, strict
 *
 * The middle one shipped in `session-actions.ts` and silently corrupted
 * EVERY field it parsed. vibeName became `"** Vibe 1 — Das Zuviel"`,
 * vibeId became `"vibe-**-vibe-1-..."`, filenames had literal asterisks,
 * the filesystem rejected the writes, and WebDev failed silently for 11
 * BUILD trigger cycles in session 2026-04-25-2 with zero error in any log.
 * The user lost a multi-hour session debugging a regex.
 *
 * NEVER write your own regex for `Field: value` lines. Use the helpers
 * in this file. They handle:
 *   - `**Field:** value`   (markdown bold-label)
 *   - `Field: value`        (plain)
 *   - `**Field:** value`    (extra spaces around colon)
 *   - `* * Field: * * value` (broken markdown, still recovers)
 *   - case-insensitive field name matching
 *
 * The CD agent file (`agents/creative-director-agent.md`) tells CD to
 * use plain text in parsed files. That's the BELT. This file is the
 * BRACES. With both, the system is robust to any format CD writes.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

/**
 * Escape a string for safe insertion into a regex pattern.
 * Field names like "Aspect Ratio" or "Hero Image" need this.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Strip leading orphaned `**` and trailing orphaned `**` from a value.
 * Belt-and-braces in case the agent emits `**Vibe**: **value**` or
 * other malformed markdown that slipped past the regex.
 */
function stripOrphanedBold(value: string): string {
  return value
    .replace(/^\s*\*+\s*/, '')   // leading orphan asterisks + space
    .replace(/\s*\*+\s*$/, '')   // trailing orphan asterisks + space
    .trim()
}

/**
 * Match a single-line `Field: value` (or `**Field:** value`) inside `text`.
 * Returns the value, or null if not found.
 *
 * Examples that all work and yield "Hero Image":
 *   matchField("**Vibe:** Hero Image",       "Vibe")  → "Hero Image"
 *   matchField("Vibe: Hero Image",            "Vibe")  → "Hero Image"
 *   matchField("**Vibe:**   Hero Image",     "Vibe")  → "Hero Image"
 *   matchField("vibe: Hero Image",            "Vibe")  → "Hero Image"   (case-insens.)
 *   matchField("**Vibe**: Hero Image",       "Vibe")  → "Hero Image"   (bold on wrong side)
 *
 * Pass `flags` if you need to override defaults (default is "i" for
 * case-insensitive). Pass `requireLineStart: true` to anchor the field
 * to the start of a line (some parsers need this to avoid matching
 * fields nested inside prose).
 */
export function matchField(
  text: string,
  fieldName: string,
  opts: { requireLineStart?: boolean; flags?: string } = {},
): string | null {
  const escaped = escapeRegex(fieldName)
  const anchor = opts.requireLineStart ? '^' : ''
  // Pattern explanation:
  //   (?:\*+\s*)?                   — optional leading asterisks (any count)
  //   <field>                        — the literal field name
  //   (?:\s*\*+)?                   — optional trailing asterisks BEFORE colon
  //                                    (handles `**Field**:` malformation)
  //   :                              — required colon
  //   (?:\s*\*+)?                   — optional asterisks AFTER colon
  //                                    (the standard `**Field:**` shape)
  //   \s*                            — optional whitespace
  //   ([^\n]+)                       — capture the value (single line)
  const pattern = new RegExp(
    `${anchor}(?:\\*+\\s*)?${escaped}(?:\\s*\\*+)?:(?:\\s*\\*+)?\\s*([^\\n]+)`,
    opts.flags ?? 'i' + (opts.requireLineStart ? 'm' : ''),
  )
  const match = text.match(pattern)
  if (!match) return null
  return stripOrphanedBold(match[1])
}

/**
 * Match a multi-line field whose value continues until the next
 * `**Field:**` line, the next `### `/`#### ` header, or end of text.
 *
 * Use this for fields like "CD Analysis", "Reprompt", "Instruction"
 * whose value can span paragraphs.
 *
 * Examples:
 *   matchFieldMultiline(
 *     "**Reprompt:** First line\nSecond line\n\nThird.\n**Status:** PENDING",
 *     "Reprompt"
 *   )
 *   → "First line\nSecond line\n\nThird."
 */
export function matchFieldMultiline(
  text: string,
  fieldName: string,
): string | null {
  const escaped = escapeRegex(fieldName)
  // Stop boundaries — lookahead for any structural line that signals
  // the next thing has begun:
  //   `\n**`   — start of next bold field
  //   `\n###`  — markdown header
  //   `\n####` — sub-header (turn marker etc)
  //   `\n---`  — separator
  //   end of string
  // We don't try to detect plain-text next fields (`\nStatus: ...`) because
  // they're indistinguishable from prose like `Note: blah`. Keep the contract
  // narrow: callers writing files must terminate multiline fields with one of
  // the boundary markers above.
  const stopAhead = `(?=\\n\\*\\*|\\n###|\\n####|\\n---|$)`
  const pattern = new RegExp(
    `(?:\\*+\\s*)?${escaped}(?:\\s*\\*+)?:(?:\\s*\\*+)?\\s*([\\s\\S]+?)${stopAhead}`,
    'i',
  )
  const match = text.match(pattern)
  if (!match) return null
  return stripOrphanedBold(match[1])
}

/**
 * Build a `Field: value` line in the canonical PLAIN format
 * (per CD's hard rule: no markdown formatting in parsed files).
 *
 * Use this when WRITING fields back to disk — keeps the format consistent
 * so future parses are predictable.
 */
export function formatField(fieldName: string, value: string): string {
  return `${fieldName}: ${value}`
}

/**
 * Replace an existing `Field: value` (or `**Field:** value`) line in `text`
 * with a new value. Preserves the original format (bold or plain) so we
 * don't churn formatting on every write — humans who edited the file
 * with bold see bold preserved.
 *
 * If the field doesn't exist, returns `text` unchanged.
 */
export function replaceField(
  text: string,
  fieldName: string,
  newValue: string,
): string {
  const escaped = escapeRegex(fieldName)
  // Capture the leading format (bold or plain) so we re-emit the same shape.
  const pattern = new RegExp(
    `((?:\\*+\\s*)?${escaped}(?:\\s*\\*+)?:(?:\\s*\\*+)?\\s*)([^\\n]+)`,
    'i',
  )
  return text.replace(pattern, (_full, prefix) => `${prefix}${newValue}`)
}
