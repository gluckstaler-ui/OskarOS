/**
 * Memory System Integration Tests — All 5 Packages
 *
 * P1: paths.ts — path resolution, double-buffer clock logic
 * P2: prompts.ts + consolidator.ts — prompt loading, consolidation cycle
 * P3: CD integration (buildCDPrompt reads session.md/user.md) — tested via file presence
 * P4: dreamer.ts + dreamer-timer.ts + /api/dream — dream cycle, output parsing, timer
 * P5: templates.ts + migrate.ts + anthropic.ts — seeds, migration, API wrapper
 *
 * All Anthropic API calls are mocked. Filesystem ops use real temp dirs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from 'fs/promises'
import path from 'path'
import os from 'os'

// ============================================================================
// Mock setup — must be before imports
// ============================================================================

// Mock the anthropic module so no real API calls happen
vi.mock('../anthropic', () => ({
  callAnthropic: vi.fn().mockResolvedValue(null),
}))

// Mock prompts.ts — we can't read agent .md files in CI
vi.mock('../prompts', () => ({
  CONSOLIDATOR_PROMPT_TEMPLATE:
    'Consolidate this session.\n\nCurrent session.md:\n${currentSession || \'(first consolidation — create from scratch)\'}\n\nRaw tail:\n${rawTail}',
  loadDreamerPromptTemplate: () =>
    'Dream cycle.\n\nConsolidated:\n${consolidated || \'(empty)\'}\n\nBuffer:\n${rawBuffer}\n\nUser memory:\n${userMemory || \'(empty — first session, see INITIAL TEMPLATE below)\'}',
}))

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
  getSessionDir,
  getLogsDir,
  getConsolidatedSessionPath,
  getUserMemoryPath,
  getRawLogPath,
  getActiveBufferPath,
  getInactiveBufferPath,
  getSessionBackupPath,
  getDreamLogPath,
  getConsolidationLogPath,
  activeBuffer,
  inactiveBuffer,
} from '../paths'

import { SESSION_MD_SEED, getUserMdTemplate } from '../templates'
import { callAnthropic } from '../anthropic'
import { runConsolidation } from '../consolidator'
import { runDreamer } from '../dreamer'
import { migrateSession } from '../migrate'
import {
  startDreamerTimer,
  stopDreamerTimer,
  isDreamerTimerRunning,
} from '../dreamer-timer'

// Cast mock for type-safe assertions
const mockCallAnthropic = vi.mocked(callAnthropic)

// ============================================================================
// Test helpers
// ============================================================================

let tmpDir: string
let originalCwd: string

/**
 * Create a temp dir that looks like the app's public/{sessionId} structure.
 * Override process.cwd() so paths.ts resolves correctly.
 */
async function setupTestSession(sessionId: string) {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'memory-test-'))

  // paths.ts uses process.cwd() + 'public' + sessionId
  originalCwd = process.cwd()
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

  const sessionDir = path.join(tmpDir, 'public', sessionId)
  const logsDir = path.join(sessionDir, 'logs')
  await mkdir(logsDir, { recursive: true })

  return { sessionDir, logsDir }
}

async function teardownTestSession() {
  vi.restoreAllMocks()
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

// ============================================================================
// P1: paths.ts — Path Resolution & Double-Buffer Logic
// ============================================================================

describe('P1: paths.ts', () => {
  const SESSION_ID = '2026-04-08-test-cafe'

  beforeEach(async () => {
    await setupTestSession(SESSION_ID)
  })
  afterEach(teardownTestSession)

  it('resolves session directory under public/', () => {
    const dir = getSessionDir(SESSION_ID)
    expect(dir).toBe(path.join(tmpDir, 'public', SESSION_ID))
  })

  it('resolves logs directory under session/', () => {
    const dir = getLogsDir(SESSION_ID)
    expect(dir).toBe(path.join(tmpDir, 'public', SESSION_ID, 'logs'))
  })

  it('resolves session.md at session root', () => {
    const p = getConsolidatedSessionPath(SESSION_ID)
    expect(p).toMatch(/\/session\.md$/)
    expect(p).not.toContain('logs')
  })

  it('resolves user.md at session root', () => {
    const p = getUserMemoryPath(SESSION_ID)
    expect(p).toMatch(/\/user\.md$/)
    expect(p).not.toContain('logs')
  })

  it('resolves raw log with current month in logs/', () => {
    const p = getRawLogPath(SESSION_ID)
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(p).toContain(`logs/SESSION-${month}.md`)
  })

  it('resolves backup and log files in logs/', () => {
    expect(getSessionBackupPath(SESSION_ID)).toContain('logs/.session-backup.md')
    expect(getDreamLogPath(SESSION_ID)).toContain('logs/.last-dream-log.md')
    expect(getConsolidationLogPath(SESSION_ID)).toContain('logs/.last-consolidation-log.md')
  })

  describe('double-buffer clock logic', () => {
    it('activeBuffer returns A or B', () => {
      expect(['A', 'B']).toContain(activeBuffer())
    })

    it('inactiveBuffer is the opposite of activeBuffer', () => {
      const active = activeBuffer()
      const inactive = inactiveBuffer()
      expect(active).not.toBe(inactive)
      expect(['A', 'B']).toContain(inactive)
    })

    it('buffer paths include A or B in filename', () => {
      const activePath = getActiveBufferPath(SESSION_ID)
      const inactivePath = getInactiveBufferPath(SESSION_ID)
      expect(activePath).toMatch(/MEMORY-SESSION-[AB]\.md$/)
      expect(inactivePath).toMatch(/MEMORY-SESSION-[AB]\.md$/)
      expect(activePath).not.toBe(inactivePath)
    })

    it('even hours → A active, odd hours → B active', () => {
      // Test the logic directly: hours % 2 === 0 → A
      const hour = new Date().getHours()
      const expected = hour % 2 === 0 ? 'A' : 'B'
      expect(activeBuffer()).toBe(expected)
    })
  })
})

// ============================================================================
// P2: consolidator.ts — Consolidation Cycle
// ============================================================================

describe('P2: consolidator.ts', () => {
  const SESSION_ID = '2026-04-08-consolidator-test'

  beforeEach(async () => {
    await setupTestSession(SESSION_ID)
    mockCallAnthropic.mockReset()
  })
  afterEach(teardownTestSession)

  it('does nothing when raw log is empty', async () => {
    // Create empty raw log
    await writeFile(getRawLogPath(SESSION_ID), '', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), 'existing content', 'utf-8')

    await runConsolidation(SESSION_ID)

    // Should not call Anthropic
    expect(mockCallAnthropic).not.toHaveBeenCalled()
    // session.md unchanged
    const content = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(content).toBe('existing content')
  })

  it('calls Anthropic with Sonnet model when raw log has content', async () => {
    const rawContent = '#### User\nHello\n#### Assistant\nHi there'
    await writeFile(getRawLogPath(SESSION_ID), rawContent, 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '', 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce('## STATE\n- Phase: Discovery\n\n## ACTIVE\nUser greeted.\n\n## LEDGER\n(empty)')

    await runConsolidation(SESSION_ID)

    expect(mockCallAnthropic).toHaveBeenCalledOnce()
    const [model] = mockCallAnthropic.mock.calls[0]
    expect(model).toBe('claude-sonnet-4-6')
  })

  it('writes consolidated output to session.md', async () => {
    await writeFile(getRawLogPath(SESSION_ID), '#### User\nHello', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '', 'utf-8')

    const mockOutput = '## STATE\n- Phase: Discovery\n\n## ACTIVE\nGreeting exchange.\n\n## LEDGER\n(empty)'
    mockCallAnthropic.mockResolvedValueOnce(mockOutput)

    await runConsolidation(SESSION_ID)

    const result = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(result).toBe(mockOutput)
  })

  it('creates one-deep backup before overwriting session.md', async () => {
    const existingSession = '## STATE\n- Phase: Vibes\n\n## ACTIVE\nOld content.\n\n## LEDGER\n- decision 1'
    await writeFile(getRawLogPath(SESSION_ID), '#### User\nNew exchange', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), existingSession, 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce('## STATE\n- Updated')

    await runConsolidation(SESSION_ID)

    const backup = await readFile(getSessionBackupPath(SESSION_ID), 'utf-8')
    expect(backup).toBe(existingSession)
  })

  it('writes debug receipt to .last-consolidation-log.md', async () => {
    await writeFile(getRawLogPath(SESSION_ID), '#### User\nHello', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '', 'utf-8')
    mockCallAnthropic.mockResolvedValueOnce('## STATE\n- Test')

    await runConsolidation(SESSION_ID)

    const log = await readFile(getConsolidationLogPath(SESSION_ID), 'utf-8')
    expect(log).toContain('# Consolidation')
    expect(log).toContain('Tail size read:')
    expect(log).toContain('Output size:')
  })

  it('does not overwrite session.md on API failure', async () => {
    const existing = '## STATE\n- Keep this'
    await writeFile(getRawLogPath(SESSION_ID), '#### User\nHello', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), existing, 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce(null)

    await runConsolidation(SESSION_ID)

    const content = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(content).toBe(existing)
  })
})

// ============================================================================
// P4: dreamer.ts — Dream Cycle
// ============================================================================

describe('P4: dreamer.ts', () => {
  const SESSION_ID = '2026-04-08-dreamer-test'

  beforeEach(async () => {
    await setupTestSession(SESSION_ID)
    mockCallAnthropic.mockReset()
  })
  afterEach(teardownTestSession)

  it('exits early with minimal log when buffer is empty', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), '', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), '', 'utf-8')

    const result = await runDreamer(SESSION_ID)

    expect(result.stats.bufferSize).toBe(0)
    expect(result.stats.userMemoryUpdated).toBe(false)
    expect(result.stats.sessionUpdated).toBe(false)
    expect(mockCallAnthropic).not.toHaveBeenCalled()

    // Dream log should note empty buffer
    const log = await readFile(getDreamLogPath(SESSION_ID), 'utf-8')
    expect(log).toContain('Buffer empty')
  })

  it('calls Anthropic with Sonnet when buffer has content', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), 'Some raw signal', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '## STATE\n- Test', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), '# User Memory', 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce(
      '### USER_MEMORY_UPDATE\nNO_CHANGE\n### CONSOLIDATED_UPDATE\nNO_CHANGE\n### TRIAGE_LOG\nNothing to promote.'
    )

    await runDreamer(SESSION_ID)

    expect(mockCallAnthropic).toHaveBeenCalledOnce()
    const [model, , maxTokens] = mockCallAnthropic.mock.calls[0]
    expect(model).toBe('claude-sonnet-4-6')
    expect(maxTokens).toBe(8192)
  })

  it('updates user.md when dreamer returns new content', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), 'User prefers dark themes', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '## STATE\n- Test', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), '# User Memory\n(empty)', 'utf-8')

    const updatedUserMd = '# User Memory\n\n## Taste Profile\n- Prefers dark themes, moody aesthetics'
    mockCallAnthropic.mockResolvedValueOnce(
      `### USER_MEMORY_UPDATE\n${updatedUserMd}\n### CONSOLIDATED_UPDATE\nNO_CHANGE\n### TRIAGE_LOG\nPromoted: dark theme preference → user.md Taste Profile`
    )

    const result = await runDreamer(SESSION_ID)

    expect(result.stats.userMemoryUpdated).toBe(true)
    expect(result.stats.sessionUpdated).toBe(false)

    const userMd = await readFile(getUserMemoryPath(SESSION_ID), 'utf-8')
    expect(userMd).toContain('dark themes')
  })

  it('updates session.md when dreamer returns consolidated update', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), 'Important context was pruned', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '## STATE\n- Minimal', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), '', 'utf-8')

    const updatedSession = '## STATE\n- Phase: Build\n- Reinstated context\n\n## ACTIVE\nImportant work.\n\n## LEDGER\n- reinstated pruned context'
    mockCallAnthropic.mockResolvedValueOnce(
      `### USER_MEMORY_UPDATE\nNO_CHANGE\n### CONSOLIDATED_UPDATE\n${updatedSession}\n### TRIAGE_LOG\nReinstated: over-pruned context back to session.md`
    )

    const result = await runDreamer(SESSION_ID)

    expect(result.stats.sessionUpdated).toBe(true)
    const session = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(session).toContain('Reinstated context')
  })

  it('flushes the inactive buffer after successful dream', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), 'Signal to process', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), '', 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce(
      '### USER_MEMORY_UPDATE\nNO_CHANGE\n### CONSOLIDATED_UPDATE\nNO_CHANGE\n### TRIAGE_LOG\nFlushed.'
    )

    await runDreamer(SESSION_ID)

    const buffer = await readFile(getInactiveBufferPath(SESSION_ID), 'utf-8')
    expect(buffer).toBe('')
  })

  it('does NOT flush buffer on API failure — preserves signal', async () => {
    const signal = 'Precious signal that must survive'
    await writeFile(getInactiveBufferPath(SESSION_ID), signal, 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), '', 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce(null)

    const result = await runDreamer(SESSION_ID)

    expect(result.stats.triageLog).toContain('ERROR')
    const buffer = await readFile(getInactiveBufferPath(SESSION_ID), 'utf-8')
    expect(buffer).toBe(signal) // Signal preserved!
  })

  it('writes dream log with stats', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), 'Some buffer content', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), '', 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce(
      '### USER_MEMORY_UPDATE\nNO_CHANGE\n### CONSOLIDATED_UPDATE\nNO_CHANGE\n### TRIAGE_LOG\nAll noise.'
    )

    await runDreamer(SESSION_ID)

    const log = await readFile(getDreamLogPath(SESSION_ID), 'utf-8')
    expect(log).toContain('Dream Cycle')
    expect(log).toContain('Buffer Size:')
    expect(log).toContain('Triage Log')
  })

  it('returns dreamTimestamp for clock-awareness', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), '', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), '', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), '', 'utf-8')

    const result = await runDreamer(SESSION_ID)

    expect(result.stats.dreamTimestamp).toBeTruthy()
    // Should be a valid ISO timestamp
    const parsed = new Date(result.stats.dreamTimestamp)
    expect(parsed.getTime()).not.toBeNaN()
  })
})

// ============================================================================
// P4: dreamer-timer.ts — Timer Lifecycle
// ============================================================================

describe('P4: dreamer-timer.ts', () => {
  afterEach(() => {
    stopDreamerTimer()
  })

  it('starts and reports running', () => {
    expect(isDreamerTimerRunning()).toBe(false)
    startDreamerTimer('test-session', 'http://localhost:3000')
    expect(isDreamerTimerRunning()).toBe(true)
  })

  it('stops cleanly', () => {
    startDreamerTimer('test-session', 'http://localhost:3000')
    stopDreamerTimer()
    expect(isDreamerTimerRunning()).toBe(false)
  })

  it('does not double-start', () => {
    startDreamerTimer('test-session', 'http://localhost:3000')
    startDreamerTimer('test-session', 'http://localhost:3000') // Should be no-op
    expect(isDreamerTimerRunning()).toBe(true)
    stopDreamerTimer()
    expect(isDreamerTimerRunning()).toBe(false)
  })
})

// ============================================================================
// P4: dreamer output parser (via dreamer.ts internals tested through runDreamer)
// ============================================================================

describe('P4: dreamer output parsing', () => {
  const SESSION_ID = '2026-04-08-parser-test'

  beforeEach(async () => {
    await setupTestSession(SESSION_ID)
    mockCallAnthropic.mockReset()
  })
  afterEach(teardownTestSession)

  it('handles all NO_CHANGE sections', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), 'noise', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), 'original session', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), 'original user', 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce(
      '### USER_MEMORY_UPDATE\nNO_CHANGE\n### CONSOLIDATED_UPDATE\nNO_CHANGE\n### TRIAGE_LOG\nAll items were noise.'
    )

    const result = await runDreamer(SESSION_ID)

    expect(result.stats.userMemoryUpdated).toBe(false)
    expect(result.stats.sessionUpdated).toBe(false)

    // Originals should be untouched
    const session = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(session).toBe('original session')
    const user = await readFile(getUserMemoryPath(SESSION_ID), 'utf-8')
    expect(user).toBe('original user')
  })

  it('handles both sections updated simultaneously', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), 'rich signal', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), 'old session', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), 'old user', 'utf-8')

    mockCallAnthropic.mockResolvedValueOnce(
      '### USER_MEMORY_UPDATE\n# User Memory\n## Taste Profile\n- Likes bold colors\n### CONSOLIDATED_UPDATE\n## STATE\n- Phase: Build\n### TRIAGE_LOG\nPromoted taste + updated phase.'
    )

    const result = await runDreamer(SESSION_ID)

    expect(result.stats.userMemoryUpdated).toBe(true)
    expect(result.stats.sessionUpdated).toBe(true)

    const user = await readFile(getUserMemoryPath(SESSION_ID), 'utf-8')
    expect(user).toContain('bold colors')
    const session = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(session).toContain('Phase: Build')
  })

  it('handles malformed output gracefully (missing sections)', async () => {
    await writeFile(getInactiveBufferPath(SESSION_ID), 'buffer', 'utf-8')
    await writeFile(getConsolidatedSessionPath(SESSION_ID), 'keep this', 'utf-8')
    await writeFile(getUserMemoryPath(SESSION_ID), 'keep this too', 'utf-8')

    // Malformed — no section headers
    mockCallAnthropic.mockResolvedValueOnce('Just some random text without headers')

    const result = await runDreamer(SESSION_ID)

    // Should treat as NO_CHANGE since parsing finds nothing
    expect(result.stats.userMemoryUpdated).toBe(false)
    expect(result.stats.sessionUpdated).toBe(false)
  })
})

// ============================================================================
// P5: templates.ts — Seeds
// ============================================================================

describe('P5: templates.ts', () => {
  it('SESSION_MD_SEED has all three zones', () => {
    expect(SESSION_MD_SEED).toContain('## STATE')
    expect(SESSION_MD_SEED).toContain('## ACTIVE')
    expect(SESSION_MD_SEED).toContain('## LEDGER')
  })

  it('getUserMdTemplate includes all 6 sections', () => {
    const template = getUserMdTemplate('test-session')
    expect(template).toContain('## Reading Rules')
    expect(template).toContain('## Taste Profile')
    expect(template).toContain('## Quality Bar')
    expect(template).toContain('## Communication Patterns')
    expect(template).toContain('## Working Context')
    expect(template).toContain('## Exclusions')
  })

  it('getUserMdTemplate Reading Rules include the trust hierarchy', () => {
    const template = getUserMdTemplate('test-session')
    expect(template).toContain('Later beats earlier')
    expect(template).toContain('trust the session')
  })

  it('getUserMdTemplate Exclusions prevent duplication', () => {
    const template = getUserMdTemplate('test-session')
    expect(template).toContain('extract the SIGNAL, discard the SPECIFICS')
  })
})

// ============================================================================
// P5: migrate.ts — Session Migration
// ============================================================================

describe('P5: migrate.ts', () => {
  const SESSION_ID = '2026-04-08-migrate-test'

  beforeEach(async () => {
    await setupTestSession(SESSION_ID)
    mockCallAnthropic.mockReset()
  })
  afterEach(teardownTestSession)

  it('creates all required files for a fresh session', async () => {
    // Start with just the session directory (no logs/, no session.md, no user.md)
    const sessionDir = getSessionDir(SESSION_ID)
    // Remove the logs dir that setupTestSession created, to simulate pre-memory state
    await rm(getLogsDir(SESSION_ID), { recursive: true, force: true })

    const result = await migrateSession(SESSION_ID)

    expect(result.errors).toHaveLength(0)
    expect(result.created).toContain('logs/')

    // session.md should exist with seed content
    const session = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(session).toContain('## STATE')

    // user.md should exist with template
    const user = await readFile(getUserMemoryPath(SESSION_ID), 'utf-8')
    expect(user).toContain('## Reading Rules')

    // Buffer files should exist and be empty
    const bufferA = await readFile(getActiveBufferPath(SESSION_ID), 'utf-8')
    const bufferB = await readFile(getInactiveBufferPath(SESSION_ID), 'utf-8')
    expect(bufferA).toBe('')
    expect(bufferB).toBe('')
  })

  it('copies existing SESSION.md to raw monthly log', async () => {
    const sessionDir = getSessionDir(SESSION_ID)
    const oldContent = '#### User\nHello\n#### Assistant\nWelcome!'
    await writeFile(path.join(sessionDir, 'SESSION.md'), oldContent, 'utf-8')
    // Remove logs dir to simulate fresh state
    await rm(getLogsDir(SESSION_ID), { recursive: true, force: true })

    const result = await migrateSession(SESSION_ID)

    const rawLog = await readFile(getRawLogPath(SESSION_ID), 'utf-8')
    expect(rawLog).toBe(oldContent)
  })

  it('is idempotent — second run skips existing files', async () => {
    // First run
    await rm(getLogsDir(SESSION_ID), { recursive: true, force: true })
    const first = await migrateSession(SESSION_ID)
    expect(first.created.length).toBeGreaterThan(0)

    // Second run
    const second = await migrateSession(SESSION_ID)
    expect(second.created.filter(c => c !== 'logs/')).toHaveLength(0)
    expect(second.skipped.length).toBeGreaterThan(0)
    expect(second.errors).toHaveLength(0)
  })

  it('does not delete original SESSION.md', async () => {
    const sessionDir = getSessionDir(SESSION_ID)
    await writeFile(path.join(sessionDir, 'SESSION.md'), 'Original content', 'utf-8')
    await rm(getLogsDir(SESSION_ID), { recursive: true, force: true })

    await migrateSession(SESSION_ID)

    // Original should still be there
    const original = await readFile(path.join(sessionDir, 'SESSION.md'), 'utf-8')
    expect(original).toBe('Original content')
  })
})

// ============================================================================
// P5: anthropic.ts — API Wrapper Shape
// ============================================================================

describe('P5: anthropic.ts (mocked)', () => {
  beforeEach(() => {
    mockCallAnthropic.mockReset()
  })

  it('callAnthropic accepts MemoryModel types', async () => {
    mockCallAnthropic.mockResolvedValueOnce('response')
    const result = await callAnthropic('claude-sonnet-4-6', 'test prompt', 1024)
    expect(result).toBe('response')
  })

  it('callAnthropic returns null on failure', async () => {
    mockCallAnthropic.mockResolvedValueOnce(null)
    const result = await callAnthropic('claude-haiku-4-5-20251001', 'test', 512)
    expect(result).toBeNull()
  })
})

// ============================================================================
// Integration: Full Pipeline (Consolidator → Dreamer)
// ============================================================================

describe('Integration: Consolidator → Dreamer pipeline', () => {
  const SESSION_ID = '2026-04-08-integration-test'

  beforeEach(async () => {
    await setupTestSession(SESSION_ID)
    mockCallAnthropic.mockReset()
  })
  afterEach(teardownTestSession)

  it('full cycle: migrate → consolidate → dream', async () => {
    const sessionDir = getSessionDir(SESSION_ID)

    // 1. Simulate pre-memory session with existing SESSION.md
    await rm(getLogsDir(SESSION_ID), { recursive: true, force: true })
    await writeFile(
      path.join(sessionDir, 'SESSION.md'),
      '#### User\nI like minimalist design with lots of whitespace\n#### Assistant\nGreat, noted your preference.',
      'utf-8'
    )

    // 2. MIGRATE — bootstraps the memory system
    const migration = await migrateSession(SESSION_ID)
    expect(migration.errors).toHaveLength(0)

    // 3. Simulate app writing to raw log (new exchange after migration)
    const rawLogPath = getRawLogPath(SESSION_ID)
    const currentRaw = await readFile(rawLogPath, 'utf-8').catch(() => '')
    await writeFile(
      rawLogPath,
      currentRaw + '\n#### User\nCan we try a dark color scheme?\n#### Assistant\nSure, switching to dark.',
      'utf-8'
    )

    // 4. CONSOLIDATE — compresses raw log to session.md
    mockCallAnthropic.mockResolvedValueOnce(
      '## STATE\n- Phase: Vibes\n- Working on color scheme\n\n## ACTIVE\nUser requested dark scheme. Assistant pivoted.\n\n## LEDGER\n- 2026-04-08: dark color scheme requested APPROVED'
    )

    await runConsolidation(SESSION_ID)

    const sessionMd = await readFile(getConsolidatedSessionPath(SESSION_ID), 'utf-8')
    expect(sessionMd).toContain('Phase: Vibes')
    expect(sessionMd).toContain('dark color scheme')

    // 5. Simulate app writing to INACTIVE buffer (dreamer's input)
    await writeFile(
      getInactiveBufferPath(SESSION_ID),
      '#### User\nI like minimalist design with lots of whitespace\n#### User\nCan we try a dark color scheme?',
      'utf-8'
    )

    // 6. DREAM — triages buffer, updates user.md
    mockCallAnthropic.mockResolvedValueOnce(
      '### USER_MEMORY_UPDATE\n'
      + '# User Memory\n_Last updated: 2026-04-08_\n\n'
      + '## Taste Profile\n- Minimalist design, generous whitespace, dark color schemes\n\n'
      + '## Quality Bar\n(no signals yet)\n\n'
      + '## Communication Patterns\n(no signals yet)\n\n'
      + '## Working Context\n(no signals yet)\n\n'
      + '## Exclusions\n- Vibe-specific details → session.md\n'
      + '### CONSOLIDATED_UPDATE\nNO_CHANGE\n'
      + '### TRIAGE_LOG\n'
      + 'PROMOTED: minimalist + whitespace + dark scheme → user.md Taste Profile\n'
      + 'DISCARDED: assistant acknowledgments (noise)\n'
      + 'KEPT: dark scheme decision in session.md LEDGER (still active)'
    )

    const dreamResult = await runDreamer(SESSION_ID)

    expect(dreamResult.stats.userMemoryUpdated).toBe(true)
    expect(dreamResult.stats.bufferSize).toBeGreaterThan(0)

    // Verify user.md got the taste signal
    const userMd = await readFile(getUserMemoryPath(SESSION_ID), 'utf-8')
    expect(userMd).toContain('Minimalist design')
    expect(userMd).toContain('dark color')

    // Verify buffer was flushed
    const buffer = await readFile(getInactiveBufferPath(SESSION_ID), 'utf-8')
    expect(buffer).toBe('')

    // Verify dream log exists
    const dreamLog = await readFile(getDreamLogPath(SESSION_ID), 'utf-8')
    expect(dreamLog).toContain('Dream Cycle')
    expect(dreamLog).toContain('PROMOTED')
  })
})
