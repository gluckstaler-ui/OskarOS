/**
 * Lineage Store (WP-1C / WP-2C — added 2026-04-17)
 *
 * Persistent record of every Nano Banana generation in a session.
 * Stored as a sidecar JSON at `public/{sessionId}/LINEAGE.json`.
 *
 * Why a sidecar instead of folding into IMAGES.md:
 *   - IMAGES.md is human-edited by CD (statuses, reprompts, analysis text).
 *     Forcing a machine-strict format there would conflict with CD edits.
 *   - LINEAGE.json is append-only, machine-only — safe to evolve.
 *   - On reload, we merge: source images come from disk + IMAGES.md;
 *     generation records come from LINEAGE.json. Same SourceImage[] shape.
 *
 * Schema:
 *   {
 *     version: 1,
 *     records: GenerationRecord[]    // chronological, append-only
 *   }
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'
import type { GenerationRecord } from './types'

interface LineageFile {
  version: 1
  records: GenerationRecord[]
}

const EMPTY: LineageFile = { version: 1, records: [] }

function lineagePath(sessionId: string): string {
  return path.join(process.cwd(), 'public', sessionId, 'LINEAGE.json')
}

/**
 * Read all generation records for a session. Returns empty list if the
 * file is missing or unreadable — this is best-effort, never throws.
 */
export async function readLineage(sessionId: string): Promise<GenerationRecord[]> {
  try {
    const raw = await readFile(lineagePath(sessionId), 'utf-8')
    const parsed = JSON.parse(raw) as LineageFile
    if (parsed?.version === 1 && Array.isArray(parsed.records)) {
      return parsed.records
    }
    return []
  } catch {
    return []
  }
}

/**
 * Append a single generation record. Race-tolerant — re-reads the existing
 * file, appends, writes atomically. Concurrent generates may interleave but
 * neither will lose its record.
 */
export async function appendLineage(
  sessionId: string,
  record: GenerationRecord
): Promise<void> {
  const dir = path.dirname(lineagePath(sessionId))
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    // Directory exists — fine.
  }

  const existing = await readLineage(sessionId)
  // De-dup by id — if a record with the same id already exists, replace it.
  const filtered = existing.filter((r) => r.id !== record.id)
  filtered.push(record)
  const payload: LineageFile = { version: 1, records: filtered }
  await writeFile(lineagePath(sessionId), JSON.stringify(payload, null, 2), 'utf-8')
}

/**
 * Build a stable id for a new generation. Unique within a session.
 */
export function newGenerationId(): string {
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 7)
  return `gen-${ts}-${rnd}`
}
