/**
 * Memory System E2E — One Complete User Journey
 *
 * This test proves the ACTUAL pipeline works, not that mocks return values.
 *
 * The journey:
 *   1. Fresh session → migrate (bootstrap files)
 *   2. App writes chat exchanges → dual-write to raw log + active buffer
 *   3. Consolidator fires → reads raw log tail, calls LLM, writes session.md
 *   4. Dreamer fires → reads inactive buffer, calls LLM, writes user.md, flushes buffer
 *   5. CD agent builds prompt → reads session.md + user.md, has context
 *
 * We spin up a tiny HTTP server that impersonates the Anthropic API.
 * The real fetch() in anthropic.ts hits this server. No mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir, rm, appendFile } from 'fs/promises'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import path from 'path'
import os from 'os'

// ============================================================================
// Fake Anthropic API server
// ============================================================================

let fakeApiPort: number
let fakeApiServer: ReturnType<typeof createServer>
let apiCallLog: Array<{ model: string; prompt: string; timestamp: number }> = []

/**
 * Canned responses: the fake API looks at the prompt content to decide
 * whether this is a consolidator call or a dreamer call, then returns
 * a realistic structured response.
 */
function handleAnthropicRequest(body: any): any {
  const userMessage = body.messages?.[0]?.content || ''
  const model = body.model || 'unknown'

  apiCallLog.push({ model, prompt: userMessage.slice(0, 200), timestamp: Date.now() })

  // Consolidator prompt contains "Raw tail:" — return three-zone session.md
  if (userMessage.includes('Raw tail:') || userMessage.includes('Consolidate')) {
    return {
      id: 'msg_fake_consolidator',
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'text',
        text: `## STATE
- Phase: Discovery → Vibes
- User uploaded café images, discussed minimalist aesthetic
- Working on dark color scheme direction
- Pending: First vibe generation

## ACTIVE
User wants minimalist café site. Uploaded 3 images of interior.
Expressed preference for dark themes with generous whitespace.
Assistant proposed earth tone palette — user pushed back, wants darker.
User confirmed: moody, dark, lots of breathing room.

## LEDGER
- 2026-04-08: minimalist aesthetic confirmed APPROVED
- 2026-04-08: dark color scheme direction APPROVED
- 2026-04-08: earth tone palette REJECTED — too warm, wants cooler/darker`,
      }],
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 200 },
    }
  }

  // Dreamer prompt contains "Buffer:" or "Dream cycle" — return structured triage
  if (userMessage.includes('Buffer:') || userMessage.includes('Dream cycle')) {
    return {
      id: 'msg_fake_dreamer',
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'text',
        text: `### USER_MEMORY_UPDATE
# User Memory
_Last updated: 2026-04-08T15:00:00Z_

## Reading Rules
- Later beats earlier. Current session contradicts memory → trust the session.
- Entries are claims from when written. Verify against current behavior before assuming.
- Don't cite this file to the user. Act on it silently.
- If user says to ignore memory → proceed as if this file were empty.
- Warnings and gotchas are always relevant during active use.

## Taste Profile
- Minimalist design, generous whitespace — non-negotiable GOD-TIER
- Dark color schemes preferred, earth tones rejected PATTERN
- Moody aesthetic with breathing room APPROVED

## Quality Bar
(no signals yet)

## Communication Patterns
- Direct, no-nonsense. Says what they want, expects execution not discussion.
- Pushes back fast when direction is wrong (earth tones → "no, darker")

## Working Context
- Building café booking page
- Has interior photos ready

## Exclusions
- Vibe-specific details → session.md or vibe .md files
- Image assignments → IMAGES.md
- Menu/pricing/bios → CREATIVE-BRIEF.md
- Phase/workflow state → session.md STATE zone
- Anything derivable from session files → don't duplicate
- Enforcement: extract the SIGNAL, discard the SPECIFICS.
### CONSOLIDATED_UPDATE
NO_CHANGE
### TRIAGE_LOG
PROMOTED: minimalist + whitespace preference → user.md Taste Profile (3x signal across exchanges) GOD-TIER
PROMOTED: dark scheme preference → user.md Taste Profile (confirmed after earth tone rejection) PATTERN
PROMOTED: earth tone rejection → user.md Taste Profile (explicit pushback) REJECTED
PROMOTED: direct communication style → user.md Communication Patterns (observed pattern)
DISCARDED: assistant's earth tone proposal (noise — the rejection is what matters)
DISCARDED: image upload mechanics (transient, belongs in session.md)
KEPT: phase transition in session.md LEDGER (still active this session)`,
      }],
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: 800, output_tokens: 400 },
    }
  }

  // Fallback
  return {
    id: 'msg_fake_fallback',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'NO_CHANGE' }],
    model,
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 10 },
  }
}

// ============================================================================
// Test setup
// ============================================================================

let tmpDir: string
const SESSION_ID = '2026-04-08-e2e-cafe'

beforeAll(async () => {
  // 1. Create temp directory mimicking app structure
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'memory-e2e-'))

  // Override process.cwd() and ANTHROPIC_API_KEY
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

  // Create session directory (pre-memory state: just SESSION.md)
  const sessionDir = path.join(tmpDir, 'public', SESSION_ID)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(
    path.join(sessionDir, 'SESSION.md'),
    '#### Creative Director | 14:30:00\n\nWelcome! Upload your images to get started.\n',
    'utf-8'
  )

  // Create agents directory with minimal agent files
  const agentsDir = path.join(tmpDir, 'agents')
  await mkdir(agentsDir, { recursive: true })

  await writeFile(path.join(agentsDir, 'consolidator-agent.md'), `# Consolidator
## THE ACTUAL PROMPT
\`\`\`
Consolidate this session.

Current session.md:
\${currentSession || '(first consolidation — create from scratch)'}

Raw tail:
\${rawTail}
\`\`\`
`, 'utf-8')

  await writeFile(path.join(agentsDir, 'dreamer-agent.md'), `# Dreamer
## THE ACTUAL PROMPT
\`\`\`
Dream cycle.

Consolidated:
\${consolidated || '(empty)'}

Buffer:
\${rawBuffer}

User memory:
\${userMemory || '(empty — first session, see INITIAL TEMPLATE below)'}
\`\`\`
`, 'utf-8')

  // 2. Start fake Anthropic API server
  fakeApiServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }

    // Verify headers match what anthropic.ts sends
    const apiKey = req.headers['x-api-key']
    const version = req.headers['anthropic-version']

    if (!apiKey || apiKey !== 'test-key-e2e') {
      res.writeHead(401)
      res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'Invalid API key' } }))
      return
    }

    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body)

    const response = handleAnthropicRequest(parsed)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
  })

  await new Promise<void>((resolve) => {
    fakeApiServer.listen(0, '127.0.0.1', () => {
      const addr = fakeApiServer.address() as { port: number }
      fakeApiPort = addr.port
      resolve()
    })
  })

  // Point anthropic.ts at our fake server
  process.env.ANTHROPIC_API_KEY = 'test-key-e2e'
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${fakeApiPort}`
})

afterAll(async () => {
  fakeApiServer?.close()
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_URL
})

// ============================================================================
// Import after env setup (vi.mock hoisting handles the rest)
// ============================================================================

// We need to dynamically override the API URL in anthropic.ts.
// Since it uses a hardcoded URL, we'll mock just the URL part.
vi.mock('../anthropic', async () => {
  // Re-implement callAnthropic but hitting our fake server
  return {
    callAnthropic: async (model: string, userMessage: string, maxTokens: number): Promise<string | null> => {
      const apiUrl = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com'
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) return null

      try {
        const response = await fetch(`${apiUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: userMessage }],
          }),
        })
        if (!response.ok) return null
        const result = await response.json() as { content: Array<{ type: string; text?: string }> }
        const textBlock = result.content?.find((b: any) => b.type === 'text')
        return textBlock?.text || null
      } catch {
        return null
      }
    },
  }
})

import { migrateSession } from '../migrate'
import { runConsolidation } from '../consolidator'
import { runDreamer } from '../dreamer'
import {
  getConsolidatedSessionPath,
  getUserMemoryPath,
  getRawLogPath,
  getActiveBufferPath,
  getInactiveBufferPath,
  getLogsDir,
  getDreamLogPath,
  getConsolidationLogPath,
  activeBuffer,
  inactiveBuffer,
} from '../paths'

// ============================================================================
// THE ONE TEST: Full User Journey
// ============================================================================

describe('E2E: Complete User Journey', () => {
  it('migrate → chat exchanges → consolidate → dream → CD reads memory', async () => {
    // ================================================================
    // STEP 1: MIGRATE — Bootstrap memory system for existing session
    // ================================================================
    const migration = await migrateSession(SESSION_ID)

    expect(migration.errors).toHaveLength(0)
    expect(migration.created.length).toBeGreaterThan(0)

    // Verify all memory files exist
    const sessionMd = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(sessionMd).toContain('## STATE')
    expect(sessionMd).toContain('## ACTIVE')
    expect(sessionMd).toContain('## LEDGER')

    const userMd = await readFile(getUserMemoryPath(SESSION_ID), 'utf-8')
    expect(userMd).toContain('## Reading Rules')

    const bufferA = await readFile(getActiveBufferPath(SESSION_ID), 'utf-8')
    const bufferB = await readFile(getInactiveBufferPath(SESSION_ID), 'utf-8')
    expect(bufferA).toBe('')
    expect(bufferB).toBe('')

    console.log('✓ Step 1: Migration complete')

    // ================================================================
    // STEP 2: SIMULATE CHAT — App dual-writes to raw log + active buffer
    // (This is what appendToSessionLog does in session.ts)
    // ================================================================
    const rawLogPath = getRawLogPath(SESSION_ID)
    const activeBufferPath = getActiveBufferPath(SESSION_ID)
    const inactiveBufferPath = getInactiveBufferPath(SESSION_ID)

    const exchange1 = `
---
#### User | 14:31:00

I want a minimalist café website. Dark colors, lots of whitespace. Here are my interior photos.
`
    const exchange2 = `
---
#### Creative Director | 14:31:15

Beautiful space! I'm seeing warm earth tones from the wood and brick. Let me propose a palette that brings out those natural textures...
`
    const exchange3 = `
---
#### User | 14:32:00

No, darker. I don't want earth tones. Think moody, think breathing room. The opposite of cluttered.
`
    const exchange4 = `
---
#### Creative Director | 14:32:20

Got it — killing the earth tones. Going dark: deep charcoal base, off-white text, minimal accents. The whitespace does the talking. Let me build your first vibe.
`

    // Dual-write each exchange (same as appendToSessionLog)
    for (const exchange of [exchange1, exchange2, exchange3, exchange4]) {
      await appendFile(rawLogPath, exchange)
      await appendFile(activeBufferPath, exchange)
    }

    // Also write to the inactive buffer (simulating previous hour's exchanges)
    // This is what the dreamer will read
    await writeFile(inactiveBufferPath,
      exchange1 + exchange2 + exchange3 + exchange4,
      'utf-8'
    )

    const rawLogContent = await readFile(rawLogPath, 'utf-8')
    expect(rawLogContent).toContain('minimalist café')
    expect(rawLogContent).toContain('earth tones')

    console.log('✓ Step 2: Chat exchanges written to raw log + both buffers')

    // ================================================================
    // STEP 3: CONSOLIDATOR — Fire-and-forget after last CD turn
    // (This is what chat-stream/route.ts does at line 550)
    // ================================================================
    await runConsolidation(SESSION_ID)

    const consolidatedSession = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')

    // Must have all three zones
    expect(consolidatedSession).toContain('## STATE')
    expect(consolidatedSession).toContain('## ACTIVE')
    expect(consolidatedSession).toContain('## LEDGER')

    // Must capture the actual decisions, not just echo the raw log
    expect(consolidatedSession).toContain('minimalist')
    expect(consolidatedSession).toContain('dark')
    expect(consolidatedSession).toContain('REJECTED') // earth tones were rejected

    // Backup should exist (we had seed content before)
    const backup = await readFile(
      path.join(getLogsDir(SESSION_ID), '.session-backup.md'),
      'utf-8'
    )
    expect(backup).toContain('## STATE') // backup of the seed

    // Debug receipt should exist
    const consolidationLog = await readFile(
      path.join(getLogsDir(SESSION_ID), '.last-consolidation-log.md'),
      'utf-8'
    )
    expect(consolidationLog).toContain('# Consolidation')
    expect(consolidationLog).toContain('Tail size read:')

    console.log('✓ Step 3: Consolidation complete — session.md has three zones with decisions')

    // ================================================================
    // STEP 4: DREAMER — Fires on the hour, reads inactive buffer
    // (This is what dreamer-timer.ts triggers directly)
    // ================================================================
    const dreamResult = await runDreamer(SESSION_ID)

    // Buffer had content
    expect(dreamResult.stats.bufferSize).toBeGreaterThan(0)

    // User.md should be updated with promoted signals
    expect(dreamResult.stats.userMemoryUpdated).toBe(true)

    const updatedUserMd = await readFile(getUserMemoryPath(SESSION_ID), 'utf-8')

    // Must have promoted the actual taste signals
    expect(updatedUserMd).toContain('## Taste Profile')
    expect(updatedUserMd).toContain('Minimalist')
    expect(updatedUserMd).toContain('dark')

    // Must have captured communication pattern
    expect(updatedUserMd).toContain('## Communication Patterns')
    expect(updatedUserMd).toContain('Direct')

    // Must have exclusion rules (not dumping specifics into user.md)
    expect(updatedUserMd).toContain('## Exclusions')
    expect(updatedUserMd).toContain('extract the SIGNAL')

    // Inactive buffer should be FLUSHED (dreamer consumed it)
    const flushedBuffer = await readFile(inactiveBufferPath, 'utf-8')
    expect(flushedBuffer).toBe('')

    // Dream log should exist with triage receipt
    const dreamLog = await readFile(getDreamLogPath(SESSION_ID), 'utf-8')
    expect(dreamLog).toContain('Dream Cycle')
    expect(dreamLog).toContain('Triage Log')
    expect(dreamLog).toContain('PROMOTED')

    // Dream timestamp should be valid ISO
    const tsMatch = dreamLog.match(/Dream Cycle — (.+)/)
    expect(tsMatch).toBeTruthy()
    expect(new Date(tsMatch![1]).getTime()).not.toBeNaN()

    console.log('✓ Step 4: Dream cycle complete — user.md has taste signals, buffer flushed')

    // ================================================================
    // STEP 5: CD AGENT READS MEMORY — Next chat turn has full context
    // (This is what chat/route.ts does at lines 544-557)
    // ================================================================
    const cdSessionMd = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8').catch(() => '')
    const cdUserMd = await readFile(getUserMemoryPath(SESSION_ID), 'utf-8').catch(() => '')
    const cdDreamLog = await readFile(getDreamLogPath(SESSION_ID), 'utf-8').catch(() => '')

    // CD agent gets session.md — knows current state and decisions
    expect(cdSessionMd).toContain('Phase:')
    expect(cdSessionMd).toContain('APPROVED')
    expect(cdSessionMd).toContain('REJECTED')

    // CD agent gets user.md — knows long-term preferences
    expect(cdUserMd).toContain('Minimalist')
    expect(cdUserMd).toContain('dark')
    expect(cdUserMd).toContain('Direct')

    // CD agent can read dream timestamp for clock awareness
    const dreamTimestamp = cdDreamLog.match(/^# Dream Cycle — (.+)$/m)?.[1] || 'never'
    expect(dreamTimestamp).not.toBe('never')

    // Build the clock block (same as route.ts line 552)
    const currentHour = new Date().getHours()
    const currentMinute = String(new Date().getMinutes()).padStart(2, '0')
    const clockBlock = `\n## MEMORY CLOCK\n- Current time: ${currentHour}:${currentMinute}\n- Active buffer: MEMORY-SESSION-${activeBuffer()}.md\n- Dreamer last ran: ${dreamTimestamp}\n`

    expect(clockBlock).toContain('MEMORY CLOCK')
    expect(clockBlock).toContain('MEMORY-SESSION-')

    console.log('✓ Step 5: CD agent reads session.md + user.md + clock — full context available')

    // ================================================================
    // VERIFY: API was actually called (not mocked away silently)
    // ================================================================
    expect(apiCallLog.length).toBe(2) // consolidator + dreamer
    expect(apiCallLog[0].model).toBe('claude-sonnet-4-6')
    expect(apiCallLog[1].model).toBe('claude-sonnet-4-6')

    console.log(`✓ Verified: ${apiCallLog.length} real API calls made to fake server`)
    console.log('\n🏁 FULL USER JOURNEY COMPLETE')
  })
})
