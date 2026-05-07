/**
 * images-md-writer.ts — single typed gateway for IMAGES.md mutations.
 *
 * Phase 2 (2026-04-30, Ralph bug 18): the only escape hatch CD had for
 * patching IMAGES.md was raw FileEdit against a fragile markdown schema.
 * That produced off-spec fields, masked Status values, and corrupted
 * existing entries. This file is the one path agents (and routes) write
 * through. Schema is enforced HERE; downstream parsers can trust it.
 *
 * Two operations:
 *   - upsertEntry(filename, fields) — create-or-update under
 *     `## Image Prompts + Generated`. Existing entry: in-place field
 *     replace. New entry: append.
 *   - patchFields(filename, fields) — same upsert path, just a different
 *     name when the caller knows the entry exists.
 *
 * Field vocabulary is DOCUMENTED, FROZEN, and MATCHED to the parseImagesMd
 * reader. Adding a field requires updating both this file and
 * lib/session.ts:parseImagesMd.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { replaceField } from './markdown-fields'

export type ImageStatus =
  | 'HERO'
  | 'USED'
  | 'B-ROLL'
  | 'READY'
  | 'APPROVED'
  | 'REDO'
  | 'INGESTED'
  | 'TRASH'
  | 'PENDING'

export interface ImageMetadataPatch {
  /** Status field — capitalized vocabulary above. Defaults to READY on insert. */
  status?: ImageStatus
  /** CD's verdict text (≤400 chars). Maps to `**CD Evaluation:**` (or **CD Analysis:** for backwards compat). */
  evaluation?: string
  /** Vibe slug or `all` — maps to `**Vibe:**`. */
  vibe?: string
  /** Slot label — maps to `**Slot:**`. */
  slot?: string
  /** Optional ISO timestamp; defaults to now. Maps to `**Generated:**` for new entries only. */
  generatedAt?: string
  /** Free-form note appended as `**Note:** ...`. */
  note?: string
  /**
   * Parent prompt block id (e.g. `img-goofy-v1`). When set on a NEW entry
   * (`createIfMissing` path), the `#### filename` block is inserted
   * immediately after the parent's body — BEFORE any other `### img-N`
   * heading — so the parser nests it correctly. Without this, generated
   * images orphan-append to the end of the section and get visually
   * misfiled as uploads. Ralph 2026-05-04. Existing-entry updates ignore
   * this (the entry is already located).
   */
  parentPromptId?: string
}

const VALID_STATUSES = new Set<string>([
  'HERO', 'USED', 'B-ROLL', 'READY', 'APPROVED', 'REDO', 'INGESTED', 'TRASH', 'PENDING', 'STAR',
])

function asUtcStamp(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

function imagesMdPath(sessionDir: string): string {
  return join(sessionDir, 'IMAGES.md')
}

async function readOrSeed(sessionDir: string): Promise<string> {
  const p = imagesMdPath(sessionDir)
  if (existsSync(p)) return readFile(p, 'utf-8')
  if (!existsSync(sessionDir)) await mkdir(sessionDir, { recursive: true })
  // Seed BOTH sections — parseImagesMd in lib/session.ts early-returns if
  // `## Uploaded Images` is missing, which would mean refresh_assets'
  // entryCount stays at 0 even when entries exist under
  // `## Image Prompts + Generated`. Future refactor: kill that
  // early-return; for now, the writer seeds both so the parser is happy.
  const seed = '# Image Registry\n\n## Uploaded Images\n\n## Image Prompts + Generated\n\n'
  await writeFile(p, seed, 'utf-8')
  return seed
}

/**
 * Find an existing `### filename` or `#### filename` block. Returns the
 * absolute char range inside the document, or null if not found.
 */
function findEntry(md: string, filename: string): { start: number; end: number; body: string } | null {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Allow a trailing `— title` clause after the filename.
  const re = new RegExp(`(^####? )${escaped}(\\b[^\\n]*)?\\n`, 'm')
  const m = md.match(re)
  if (!m) return null
  const start = m.index!
  const after = md.slice(start + m[0].length)
  const nextRe = /\n(?=####? )/
  const nextMatch = after.match(nextRe)
  const end = nextMatch ? start + m[0].length + nextMatch.index! : md.length
  return { start, end, body: md.slice(start, end) }
}

/**
 * Set or insert a `**Field:** value` line. Reuses lib/markdown-fields.ts's
 * proven `replaceField` for in-place updates so we never corrupt the
 * closing `**` (the bug a custom regex hit on the first attempt). New
 * fields are inserted right after the heading line so they group at the
 * top of the block.
 */
function setOrInsertField(body: string, fieldName: string, value: string): string {
  const updated = replaceField(body, fieldName, value)
  if (updated !== body) return updated
  // Field doesn't exist — insert after the heading.
  const lines = body.split('\n')
  lines.splice(1, 0, `**${fieldName}:** ${value}`)
  return lines.join('\n')
}

/**
 * Upsert an entry. Creates under `## Image Prompts + Generated` if absent;
 * otherwise patches the existing block in place. Returns the updated md
 * for callers that want to inspect; also writes to disk.
 */
export async function upsertImageMetadata(
  sessionDir: string,
  filename: string,
  patch: ImageMetadataPatch,
): Promise<{ created: boolean }> {
  if (patch.status && !VALID_STATUSES.has(patch.status)) {
    throw new Error(
      `Invalid status "${patch.status}". Allowed: ${[...VALID_STATUSES].join(', ')}.`,
    )
  }
  let md = await readOrSeed(sessionDir)
  const existing = findEntry(md, filename)

  // Build the patched body.
  let body: string
  let created = false
  if (existing) {
    body = existing.body
    if (patch.status) body = setOrInsertField(body, 'Status', patch.status)
    if (patch.vibe) body = setOrInsertField(body, 'Vibe', patch.vibe)
    if (patch.slot) body = setOrInsertField(body, 'Slot', patch.slot)
    if (patch.evaluation) body = setOrInsertField(body, 'CD Evaluation', patch.evaluation)
    if (patch.note) body = setOrInsertField(body, 'Note', patch.note)
    md = md.slice(0, existing.start) + body + md.slice(existing.end)
  } else {
    created = true
    // Use #### (4 hashes) — matches the existing IMAGES.md convention where
    // ### is reserved for prompt-id headers (`### img-001 — Logo`) and
    // generated/uploaded image filenames live as #### children. Critical:
    // parseImagesMd in lib/session.ts only reads #### entries under
    // `## Image Prompts + Generated`. ### entries get classified as prompts.
    const lines: string[] = [`#### ${filename}`]
    lines.push(`**Generated:** ${asUtcStamp(patch.generatedAt)}`)
    if (patch.vibe) lines.push(`**Vibe:** ${patch.vibe}`)
    if (patch.slot) lines.push(`**Slot:** ${patch.slot}`)
    lines.push(`**Status:** ${patch.status || 'READY'}`)
    if (patch.evaluation) lines.push(`**CD Evaluation:** ${patch.evaluation}`)
    if (patch.note) lines.push(`**Note:** ${patch.note}`)
    body = lines.join('\n') + '\n'

    // Insert under `## Image Prompts + Generated`. If section is missing,
    // append to end with the section header.
    const sectionHeader = '## Image Prompts + Generated'
    const sectionIdx = md.indexOf(sectionHeader)

    // Ralph 2026-05-04: nest under parent prompt when provided. The
    // parser (lib/session-actions.ts:getImageManifestsAction) splits
    // each ### block on `\n#### ` to find generated children. So if we
    // insert `#### filename` AFTER `### img-N`'s body but BEFORE the
    // next `### `, the new entry attaches to img-N. Without this it
    // orphan-appends to the end and visually misfiles as an upload.
    if (sectionIdx >= 0 && patch.parentPromptId) {
      const parentRe = new RegExp(`^### ${patch.parentPromptId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^\\n]*\\n`, 'm')
      const parentMatch = md.slice(sectionIdx).match(parentRe)
      if (parentMatch && parentMatch.index !== undefined) {
        const parentStart = sectionIdx + parentMatch.index
        const parentBodyStart = parentStart + parentMatch[0].length
        // Find where the parent block ends: next `### ` (sibling) or
        // next `## ` (section change). `#### ` (existing children) of
        // the parent stay inside the parent — we insert AFTER them.
        const afterParent = md.slice(parentBodyStart)
        const nextSiblingIdx = afterParent.search(/\n### (?!#)/)
        const nextSectionIdx = afterParent.search(/\n## (?!#)/)
        const cuts = [nextSiblingIdx, nextSectionIdx].filter((n) => n >= 0)
        const insertAt = cuts.length === 0
          ? md.length
          : parentBodyStart + Math.min(...cuts)
        // Trim trailing whitespace inside the parent block; insert with
        // a leading blank line + a trailing `---\n` separator if the
        // body doesn't already end in one.
        const before = md.slice(0, insertAt).replace(/[\s]+$/, '')
        const after = md.slice(insertAt)
        const sepBefore = '\n\n'
        const sepAfter = after.startsWith('\n') ? after : '\n' + after
        md = `${before}${sepBefore}${body.endsWith('\n') ? body : body + '\n'}${sepAfter}`
      } else {
        // parentPromptId given but parent block not found — fall back to
        // end-of-section append rather than dropping the entry. Log so
        // the agent can fix the reference next turn.
        console.warn(
          `[upsertImageMetadata] parentPromptId="${patch.parentPromptId}" not found in IMAGES.md; ` +
          `falling back to end-of-section append for ${filename}`,
        )
        const after = md.slice(sectionIdx + sectionHeader.length)
        const nextSec = after.search(/\n## /)
        const endOfSection = nextSec >= 0 ? sectionIdx + sectionHeader.length + nextSec : md.length
        md = md.slice(0, endOfSection).trimEnd() + '\n\n' + body + md.slice(endOfSection)
      }
    } else if (sectionIdx >= 0) {
      // Find the end of the section (next `## ` heading or EOF).
      const after = md.slice(sectionIdx + sectionHeader.length)
      const nextSec = after.search(/\n## /)
      const endOfSection = nextSec >= 0 ? sectionIdx + sectionHeader.length + nextSec : md.length
      md = md.slice(0, endOfSection).trimEnd() + '\n\n' + body + md.slice(endOfSection)
    } else {
      md = md.trimEnd() + `\n\n${sectionHeader}\n\n${body}`
    }
  }
  await writeFile(imagesMdPath(sessionDir), md, 'utf-8')
  return { created }
}
