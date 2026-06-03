/**
 * preamble.ts — universal "CD speaking" preamble parser (Ralph 2026-05-14).
 *
 * The 5 toolcard routes (`ask-discovery-questions`, `confirm-understanding`,
 * `present-design-directions`, `present-descent-selection`,
 * `present-image-strategy`) each accept an optional `preamble: {label, body}`
 * field on their POST body. This helper normalises that input to the
 * canonical typed shape or `undefined` — same validator across all five
 * so the doctrine is enforced in one place instead of five.
 *
 * Per docs/toolcards-mockup.html: every tc_* toolcard that asks the user
 * something carries a cyan-bordered preamble at the top with a mono-caps
 * role tag ("Why I'm asking" / "What I heard" / "What to weigh" / "How the
 * image plan fits") and prose body. Both required when preamble is
 * provided; if either is missing/empty, the whole preamble is dropped.
 */

import type { Preamble } from './types'

export function parsePreamble(raw: unknown): Preamble | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as { label?: unknown; body?: unknown }
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  const body = typeof o.body === 'string' ? o.body.trim() : ''
  if (!label || !body) return undefined
  return { label, body }
}
