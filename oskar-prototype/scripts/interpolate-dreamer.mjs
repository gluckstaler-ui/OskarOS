#!/usr/bin/env node
/**
 * Assemble the dreamer prompt: full agent file + session data appended.
 * Used by backfill-user-md.sh.
 *
 * Usage:
 *   node interpolate-dreamer.mjs <dreamer-agent.md> <session-md> [user-md]
 *
 * Outputs the full prompt to stdout.
 * The agent file is sent as-is (identity + instructions).
 * Session data is appended as an INPUTS section at the end.
 */

import { readFileSync } from 'fs'

const [agentPath, sessionMdPath, userMdPath] = process.argv.slice(2)

if (!agentPath || !sessionMdPath) {
  console.error('Usage: node interpolate-dreamer.mjs <dreamer-agent.md> <session.md> [user.md]')
  process.exit(1)
}

const agentFile = readFileSync(agentPath, 'utf-8')
const sessionContent = readFileSync(sessionMdPath, 'utf-8')
const userMemory = userMdPath ? readFileSync(userMdPath, 'utf-8').trim() : ''

const mode = userMemory
  ? 'SUBSEQUENT PASS — a portrait exists. Be conservative. Only update what genuinely changes WHO this person is.'
  : 'FIRST PASS — no portrait yet. Paint the full person from the session below.'

let prompt = agentFile

prompt += `

---

## INPUTS — THIS SESSION

**Mode:** ${mode}

### SESSION.MD (the raw conversation log to consolidate)
${sessionContent}

### CURRENT USER.MD
${userMemory || '(empty — first session, paint the full portrait)'}

---

Now produce your output in the exact format defined in OUTPUT FORMAT above.
`

process.stdout.write(prompt)
