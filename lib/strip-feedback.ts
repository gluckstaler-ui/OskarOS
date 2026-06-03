/**
 * Card-vs-chat strip + feedback loop (Ralph 2026-05-27).
 *
 * The problem doctrine alone cannot solve:
 *   When the CD fires a `tc_*` discovery/understanding/design-directions
 *   card AND adds chat prose alongside it in the same turn, the UI
 *   renders the card and the prose underneath. The user reads the prose
 *   (it's the living thing) and never fills the card. The card is dead.
 *
 *   The CD agent file has carried a HARD RULE against this for months.
 *   It bends the curve. It doesn't reach zero. The model defaults to
 *   chat for the same reason a thumb returns to its rest position —
 *   it's trained gravity.
 *
 * The fix is enforcement at the render layer plus a feedback loop:
 *
 *   1. STRIP — when a tc_* card is present in a turn AND there's chat
 *      prose, the chat is removed from the response before the user
 *      sees it. The card is what renders. Period.
 *
 *   2. FEEDBACK — the stripped paragraph is quoted back to the agent
 *      on the next turn as a system note: "your previous turn included
 *      chat prose alongside a tc_* card. The user saw only the card.
 *      Below is the paragraph that vanished. Where should it have
 *      lived — preamble.body, the next card, a non-card chat turn?"
 *
 * Stripping alone censors the agent silently — the model doesn't know
 * its words evaporated, so it doesn't update. The feedback loop closes
 * the gap: the model experiences the consequence + sees its words
 * quoted back + has explicit instruction on where they should have
 * gone. After 2-3 occurrences in a session, the behavior collapses.
 *
 * Persistence: a single JSON file per session at
 * `public/{sessionId}/logs/_stripped-chat.json`. File-as-API per the
 * project's substrate doctrine. Survives server restart. Cleared on
 * consume (next turn injects it once, then the file is deleted).
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import path from 'path'
import { getLogsDir } from '@/lib/memory/paths'

// Tool names that are user-facing chat-scroll cards. When any of these
// fire in a turn alongside chat prose, the chat gets stripped.
//
// The list deliberately matches the `tc_*` namespace from
// creative-director-agent.md's "Hard rule: chat surface has FOUR
// channels" doctrine — these are the cards the user is supposed to
// respond to via card UI, never via prose-in-chat.
const CARDS_THAT_OWN_THE_TURN = new Set<string>([
  'tc_discovery',
  'tc_understanding',
  'tc_design_directions',
  'tc_descent_selection',
  'tc_design_system',
  'tc_image_strategy',
])

export function isCardThatOwnsTheTurn(toolName: string): boolean {
  return CARDS_THAT_OWN_THE_TURN.has(toolName)
}

// Per-session strip file path. Lives alongside the session config in
// `public/{sessionId}/logs/_stripped-chat.json`. The leading underscore
// matches the existing convention (e.g. `_session-config.json`) and
// keeps it out of any glob the agent might run over its session folder.
export function getStrippedChatPath(sessionId: string): string {
  return path.join(getLogsDir(sessionId), '_stripped-chat.json')
}

export interface StrippedChatRecord {
  stripped: string         // the verbatim chat prose that got removed
  cardNames: string[]      // the tc_* card(s) that fired in the same turn
  ts: number               // ms epoch — for debugging stale records
}

/**
 * Persist the stripped chat for next-turn feedback injection.
 * Atomic-ish (write + no rename — the file is per-session and per-turn,
 * so concurrent writes are not a realistic case here).
 */
export function persistStrippedChat(
  sessionId: string,
  stripped: string,
  cardNames: string[],
): void {
  if (!sessionId || !stripped.trim()) return
  const dir = getLogsDir(sessionId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const filePath = getStrippedChatPath(sessionId)
  const record: StrippedChatRecord = {
    stripped: stripped.trim(),
    cardNames,
    ts: Date.now(),
  }
  writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8')
}

/**
 * Read + delete the stripped-chat record for this session. Returns null
 * if no record exists (the normal case — most turns don't collide).
 *
 * The DELETE is intentional: the feedback note must be injected once,
 * and only once. If we left the file in place, the agent would see the
 * same "you stripped X" note on every turn forever and learn nothing.
 */
export function consumeStrippedChat(
  sessionId: string,
): StrippedChatRecord | null {
  if (!sessionId) return null
  const filePath = getStrippedChatPath(sessionId)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const record = JSON.parse(raw) as StrippedChatRecord
    unlinkSync(filePath)
    return record
  } catch {
    // Corrupt file — delete it so it doesn't haunt future turns.
    try { unlinkSync(filePath) } catch {}
    return null
  }
}

/**
 * Build the system-prompt feedback note. Appended to the system prompt
 * at the START of the next turn. The wording is the load-bearing part:
 * the agent needs to (a) understand the consequence (text was stripped),
 * (b) see its own words quoted verbatim, (c) have explicit guidance on
 * where they SHOULD have lived. Doctrine without the verbatim quote is
 * abstract; the quote is the moment the lesson lands.
 */
export function buildFeedbackSystemNote(record: StrippedChatRecord): string {
  const cardList = record.cardNames.length === 1
    ? `a \`${record.cardNames[0]}\` card`
    : `\`${record.cardNames.join('`, `')}\` cards`
  return `\n\n---\n\n[FEEDBACK FROM PREVIOUS TURN — render-layer enforcement]

Your previous turn fired ${cardList} AND included chat prose. The chat was STRIPPED before the user saw it — the card is what rendered. The paragraph you wrote did not reach the user.

This is the rendering contract. The card UI is the question. Chat prose alongside a question-card breaks the contract because the user reads the prose, never fills the card, and the discovery dies.

The stripped text is below, verbatim. Decide where it should have lived:

- If it was a question → fire another card next turn, do not repeat it as prose.
- If it was reasoning the user needs to engage with the card → it belongs in the next card's \`preamble: {label, body}\` field, NOT in chat.
- If it was a long thought that genuinely needed to be said → take a chat turn WITHOUT a card next time.

<stripped-paragraph>
${record.stripped}
</stripped-paragraph>

The enforcement layer will keep stripping these collisions every turn they happen. The doctrine is the policy; the strip is the enforcement; this note is the learning signal. After two or three of these, the reflex should resolve.

---\n\n`
}
