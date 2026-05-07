/**
 * Templates for memory system files.
 *
 * These are the initial contents of session.md and user.md
 * when a new session is created.
 */

export const SESSION_MD_SEED = `## STATE
- Phase: Discovery
- First session

## ACTIVE
(no exchanges yet)

## LEDGER
(empty)
`

export function getUserMdTemplate(sessionId: string): string {
  return `# User Memory
_Last updated: never_

## Taste Profile
(first session — no signals yet)

## Quality Bar
(no signals yet)

## Communication Patterns
(no signals yet)

## Working Context
(no signals yet)
`
}
