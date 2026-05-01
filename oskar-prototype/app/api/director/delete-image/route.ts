import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, unlink, readdir } from 'fs/promises'
import path from 'path'

/**
 * WP-11A: Delete a generated image with orphan guard.
 *
 * Two modes:
 *   - `scan` (default): Returns all references to the image across HTMLs and markdown.
 *   - `delete`: Hard-deletes the file, removes IMAGES.md entry, replaces HTML refs
 *     with `placeholder.jpg`.
 *
 * Reference `kind` (Ralph 2026-04-23):
 *   - `html`  → the image is ACTUALLY USED on a page. Deleting without
 *               swapping will break visible content. Client should block.
 *   - `metadata` → the image is only MENTIONED in a markdown file
 *               (SESSION.md log, CREATIVE-BRIEF.md, IMAGES.md status,
 *               BUILD.md log, vibe-*.md drafts). Safe to delete — the
 *               metadata remains as history of what existed. Client can
 *               auto-delete in this case.
 *
 * Delete action cleans IMAGES.md (status index, not history) and swaps
 * HTML references to `placeholder.jpg`. It deliberately does NOT strip
 * mentions from SESSION.md / CREATIVE-BRIEF.md / BUILD.md / vibe-*.md —
 * those are historical logs and doctoring them is worse than a dangling
 * filename reference.
 */

/** Metadata markdown files in a session folder that scan should treat as
 *  "safe" references (block on HTML only). Any *.md with `vibe-` in its
 *  name also joins this set at scan time — vibes drafts are metadata. */
const METADATA_MDS = ['IMAGES.md', 'BUILD.md', 'CREATIVE-BRIEF.md', 'SESSION.md']

export async function POST(req: NextRequest) {
  try {
    const { sessionId, filename, action = 'scan' } = await req.json()

    if (!sessionId || !filename) {
      return NextResponse.json(
        { error: 'sessionId and filename are required' },
        { status: 400 }
      )
    }

    const sessionPath = path.join(process.cwd(), 'public', sessionId)

    // ── Scan for references ──
    const references: Array<{
      file: string
      context: string
      /** 'html' = blocking, 'metadata' = safe. Client uses this to decide
       *  whether to prompt the user or auto-delete. */
      kind: 'html' | 'metadata'
    }> = []

    // Get all HTML files
    const files = await readdir(sessionPath).catch(() => [] as string[])
    const htmlFiles = files.filter((f) => f.endsWith('.html'))

    for (const htmlFile of htmlFiles) {
      const htmlPath = path.join(sessionPath, htmlFile)
      const html = await readFile(htmlPath, 'utf-8').catch(() => '')
      if (!html) continue

      // Check for the filename in various patterns
      if (html.includes(filename)) {
        // Determine context: src=, data-slot, background-image
        const contexts: string[] = []
        if (new RegExp(`src=["']${escapeRegex(filename)}["']`, 'i').test(html)) {
          contexts.push('img src')
        }
        if (new RegExp(`data-slot.*${escapeRegex(filename)}`, 'i').test(html)) {
          contexts.push('data-slot')
        }
        if (new RegExp(`url\\(['"]?${escapeRegex(filename)}['"]?\\)`, 'i').test(html)) {
          contexts.push('background-image')
        }
        if (contexts.length === 0) contexts.push('text reference')
        references.push({ file: htmlFile, context: contexts.join(', '), kind: 'html' })
      }
    }

    // Scan known metadata markdown files + any `vibe-*.md` drafts.
    const vibeMdFiles = files.filter((f) => /^vibe.*\.md$/i.test(f))
    const metadataFiles = Array.from(new Set([...METADATA_MDS, ...vibeMdFiles]))

    for (const mdName of metadataFiles) {
      const mdPath = path.join(sessionPath, mdName)
      const md = await readFile(mdPath, 'utf-8').catch(() => '')
      if (md && md.includes(filename)) {
        references.push({
          file: mdName,
          context: mdContextLabel(mdName),
          kind: 'metadata',
        })
      }
    }

    if (action === 'scan') {
      return NextResponse.json({ references })
    }

    // ── Delete action ──
    if (action !== 'delete') {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    // 1. Replace references in HTML files with placeholder.jpg
    for (const ref of references) {
      if (!ref.file.endsWith('.html')) continue
      const htmlPath = path.join(sessionPath, ref.file)
      let html = await readFile(htmlPath, 'utf-8').catch(() => '')
      if (!html) continue

      // Replace in src attributes
      html = html.replace(
        new RegExp(`(src=["'])${escapeRegex(filename)}(["'])`, 'gi'),
        '$1placeholder.jpg$2'
      )
      // Replace in url() patterns
      html = html.replace(
        new RegExp(`(url\\(['"]?)${escapeRegex(filename)}(['"]?\\))`, 'gi'),
        '$1placeholder.jpg$2'
      )
      await writeFile(htmlPath, html, 'utf-8')
    }

    // 2. Remove IMAGES.md entry (remove the ### block for this filename).
    //    IMAGES.md is the active STATUS index of what exists — strip on
    //    delete. SESSION.md / CREATIVE-BRIEF.md / BUILD.md / vibe-*.md are
    //    HISTORY / DRAFTS and are left untouched so the log stays honest.
    const imagesPath = path.join(sessionPath, 'IMAGES.md')
    const imagesMd = await readFile(imagesPath, 'utf-8').catch(() => '')
    if (imagesMd.includes(filename)) {
      const lines = imagesMd.split('\n')
      const newLines: string[] = []
      let skip = false
      for (const line of lines) {
        if (line.startsWith(`### ${filename}`)) {
          skip = true
          continue
        }
        if (skip && line.startsWith('### ')) {
          skip = false // next entry
        }
        if (!skip) {
          newLines.push(line)
        }
      }
      await writeFile(imagesPath, newLines.join('\n'), 'utf-8')
    }

    // 3. Hard-delete the file
    const filePath = path.join(sessionPath, filename)
    try {
      await unlink(filePath)
      console.log(`[delete-image] Deleted ${filename} from ${sessionId}`)
    } catch (err) {
      console.warn(`[delete-image] Could not delete file ${filename}:`, err)
    }

    return NextResponse.json({
      success: true,
      deleted: filename,
      referencesReplaced: references.filter((r) => r.file.endsWith('.html')).length,
    })
  } catch (error) {
    console.error('[delete-image] Error:', error)
    return NextResponse.json(
      { error: `Delete failed: ${error}` },
      { status: 500 }
    )
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Human label for markdown reference entries. Keeps dialog output
 *  identical to the pre-2026-04-23 behavior for the four canonical files,
 *  and gives vibe-*.md drafts a consistent description. */
function mdContextLabel(filename: string): string {
  switch (filename) {
    case 'IMAGES.md':
      return 'status entry'
    case 'BUILD.md':
      return 'build log'
    case 'CREATIVE-BRIEF.md':
      return 'brief mention'
    case 'SESSION.md':
      return 'session note'
    default:
      return /^vibe/i.test(filename) ? 'vibe draft' : 'metadata'
  }
}
