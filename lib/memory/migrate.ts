/**
 * Migration — Transition existing sessions to the new memory system.
 *
 * For sessions created before the memory system existed:
 * 1. Creates the logs/ directory
 * 2. Copies existing SESSION.md content to logs/SESSION-{YYYY-MM}.md (raw log)
 * 3. Seeds user.md from the template
 *
 * Safe to run multiple times — checks for existing files before overwriting.
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import path from 'path'
import {
  getSessionDir,
  getLogsDir,
  getUserMemoryPath,
  getRawLogPath,
} from './paths'
import { getUserMdTemplate } from './templates'

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Migrate a single session to the new memory system.
 */
export async function migrateSession(sessionId: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    sessionId,
    created: [],
    skipped: [],
    errors: [],
  }

  const sessionDir = getSessionDir(sessionId)
  const logsDir = getLogsDir(sessionId)

  // 1. Create logs directory
  try {
    await mkdir(logsDir, { recursive: true })
    result.created.push('logs/')
  } catch (err) {
    result.errors.push(`Failed to create logs/: ${err}`)
    return result
  }

  // 2. Copy existing SESSION.md to monthly raw log
  const sessionMdPath = path.join(sessionDir, 'SESSION.md')
  const rawLogPath = getRawLogPath(sessionId)

  if (await fileExists(sessionMdPath)) {
    if (await fileExists(rawLogPath)) {
      result.skipped.push('Raw log already exists — not overwriting')
    } else {
      try {
        const content = await readFile(sessionMdPath, 'utf-8')
        await writeFile(rawLogPath, content, 'utf-8')
        result.created.push(`logs/SESSION-{month}.md (${content.length} bytes from SESSION.md)`)
      } catch (err) {
        result.errors.push(`Failed to copy SESSION.md to raw log: ${err}`)
      }
    }
  } else {
    result.skipped.push('No existing SESSION.md to migrate')
  }

  // 3. Seed user.md
  const userMemoryPath = getUserMemoryPath(sessionId)

  if (await fileExists(userMemoryPath)) {
    result.skipped.push('user.md already exists')
  } else {
    try {
      await writeFile(userMemoryPath, getUserMdTemplate(sessionId), 'utf-8')
      result.created.push('user.md (template)')
    } catch (err) {
      result.errors.push(`Failed to seed user.md: ${err}`)
    }
  }

  return result
}

/**
 * Migrate all sessions in the public directory.
 */
export async function migrateAllSessions(): Promise<MigrationResult[]> {
  const { readdir } = await import('fs/promises')
  const publicDir = path.join(process.cwd(), 'public')

  let entries: string[]
  try {
    entries = await readdir(publicDir)
  } catch {
    console.error('[migrate] Cannot read public directory')
    return []
  }

  const sessionPattern = /^\d{4}-\d{2}-\d{2}-.+$/
  const sessionIds = entries.filter(e => sessionPattern.test(e))

  console.log(`[migrate] Found ${sessionIds.length} sessions to migrate`)

  const results: MigrationResult[] = []
  for (const sessionId of sessionIds) {
    console.log(`[migrate] Migrating ${sessionId}...`)
    const result = await migrateSession(sessionId)
    results.push(result)

    if (result.created.length > 0) {
      console.log(`  Created: ${result.created.join(', ')}`)
    }
    if (result.skipped.length > 0) {
      console.log(`  Skipped: ${result.skipped.join(', ')}`)
    }
    if (result.errors.length > 0) {
      console.error(`  Errors: ${result.errors.join(', ')}`)
    }
  }

  return results
}

export interface MigrationResult {
  sessionId: string
  created: string[]
  skipped: string[]
  errors: string[]
}
