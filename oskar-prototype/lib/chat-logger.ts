/**
 * Chat Logger — WP-15 (built 2026-04-17)
 *
 * Appends curated CD activity entries to `SESSION.md` under a
 * `## CD Activity` section. This is the "paper-trail" channel referenced
 * by WP-15 rule 2 ("Augenmass paper-trail").
 *
 * The Augenmass FILTER lives at the call site, not here. Callers decide
 * whether an event is worth logging:
 *   - User messages → log
 *   - CD conversational replies (Ask CD, Briefing) → log
 *   - Rewrites (`severity: 'rewritten'`) → log
 *   - ✗ verdicts → log
 *   - `advisory` proofreads → DO NOT log (snackbar only)
 *   - ✓ verdicts → DO NOT log
 *   - Mechanical events (save, hot-swap) → DO NOT log
 *
 * Format: each entry gets a `### {ISO timestamp}` header and a single
 * fenced block. Append-only — never rewrites prior entries.
 */

import { readFile, writeFile } from 'fs/promises'
import path from 'path'

export type ChatLogKind =
  | 'user'              // User message in Ask CD or Briefing
  | 'cd-reply'          // CD conversational reply
  | 'cd-rewrite'        // CD rewrote a prompt — note explains why
  | 'cd-verdict-fail'   // ✗ verdict from post-gen evaluation
  | 'cd-evaluation'     // CD evaluation of an upload (always logged)

export interface ChatLogEntry {
  kind: ChatLogKind
  /** Free-form content — user message, CD note, prompt diff, etc. */
  content: string
  /** Optional reference to the image, slot, vibe, or file the entry concerns. */
  ref?: string
  /** Optional source surface (Ask CD, Briefing, Image Mode tab). */
  source?: string
}

const HEADER = '## CD Activity'

function sessionPath(sessionId: string): string {
  return path.join(process.cwd(), 'public', sessionId, 'SESSION.md')
}

/**
 * Read SESSION.md (or return a minimal stub if missing). Best-effort.
 */
async function readSession(sessionId: string): Promise<string> {
  try {
    return await readFile(sessionPath(sessionId), 'utf-8')
  } catch {
    return `# Session ${sessionId}\n\n${HEADER}\n`
  }
}

/**
 * Render an entry as a markdown block.
 */
function renderEntry(entry: ChatLogEntry): string {
  const ts = new Date().toISOString()
  const header = `### ${ts} — ${entry.kind}` + (entry.ref ? ` — ${entry.ref}` : '')
  const meta = entry.source ? `_source: ${entry.source}_\n\n` : ''
  return `${header}\n\n${meta}${entry.content.trim()}\n`
}

/**
 * Append a single entry to the `## CD Activity` section. If the section
 * doesn't exist yet, append it to the end of the file. Race-tolerant —
 * re-reads on every call (cheap; SESSION.md is small).
 */
export async function logToChat(
  sessionId: string,
  entry: ChatLogEntry
): Promise<void> {
  if (!sessionId) return
  try {
    const existing = await readSession(sessionId)
    const block = renderEntry(entry)

    if (existing.includes(HEADER)) {
      // Append after the existing section header — entries flow newest-last.
      // Find the next `## ` after our header (or EOF) and inject before it.
      const headerStart = existing.indexOf(HEADER)
      const afterHeader = existing.indexOf('\n', headerStart) + 1
      const nextSection = existing.indexOf('\n## ', afterHeader)
      const insertAt = nextSection === -1 ? existing.length : nextSection

      const head = existing.slice(0, insertAt).replace(/\n+$/, '\n')
      const tail = existing.slice(insertAt)
      const next = `${head}\n${block}\n${tail}`
      await writeFile(sessionPath(sessionId), next, 'utf-8')
    } else {
      // Append the section + the entry to the end of the file.
      const sep = existing.endsWith('\n') ? '\n' : '\n\n'
      const next = `${existing}${sep}${HEADER}\n\n${block}\n`
      await writeFile(sessionPath(sessionId), next, 'utf-8')
    }
  } catch (err) {
    // Logging is best-effort — a write failure must not break the calling flow.
    console.error('[chat-logger] Failed to log to SESSION.md:', err)
  }
}
