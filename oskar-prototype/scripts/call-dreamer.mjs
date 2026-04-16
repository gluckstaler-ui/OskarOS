#!/usr/bin/env node
/**
 * Call the dreamer agent via claude --print (uses OAuth, no API key needed).
 *
 * Isolation:
 *   --tools ""     → no tools (dreamer can't write files)
 *   cwd = /tmp     → no CLAUDE.md, no project memory injection
 *
 * The dreamer is a text pipeline: prompt in, structured text out.
 *
 * Usage:
 *   node call-dreamer.mjs <dreamer-agent.md> <session-md> [user-md]
 */

import { readFileSync, existsSync } from 'fs'
import { spawn } from 'child_process'

const [agentPath, sessionMdPath, userMdPath] = process.argv.slice(2)

if (!agentPath || !sessionMdPath) {
  console.error('Usage: node call-dreamer.mjs <dreamer-agent.md> <session.md> [user.md]')
  process.exit(1)
}

// --- Build prompt: full agent file + session data appended ---
const agentFile = readFileSync(agentPath, 'utf-8')
const sessionContent = readFileSync(sessionMdPath, 'utf-8')
const userMemory = userMdPath && existsSync(userMdPath)
  ? readFileSync(userMdPath, 'utf-8').trim()
  : ''

const mode = userMemory
  ? 'SUBSEQUENT PASS — a portrait exists. Be conservative. Only update what genuinely changes WHO this person is.'
  : 'FIRST PASS — no portrait yet. Paint the full person from the session below.'

const prompt = agentFile + `

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

const promptSize = Buffer.byteLength(prompt, 'utf-8')
console.error(`[call-dreamer] Prompt: ${promptSize}b, model: claude-opus-4-6`)

// --- Run claude --print from /tmp (no CLAUDE.md, no project memory) ---
const child = spawn('claude', [
  '--print',
  '--model', 'claude-opus-4-6',
  '--tools', '',
], {
  cwd: '/tmp',
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''

child.stdout.on('data', (d) => { stdout += d })
child.stderr.on('data', (d) => { stderr += d })

child.stdin.write(prompt)
child.stdin.end()

child.on('close', (code) => {
  if (code !== 0) {
    console.error(`[call-dreamer] Exit code: ${code}`)
    if (stderr) console.error(stderr.trim())
    process.exit(1)
  }
  console.error(`[call-dreamer] Response: ${stdout.length} chars`)
  process.stdout.write(stdout)
})
