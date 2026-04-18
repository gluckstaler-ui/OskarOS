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
 */
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
    const references: Array<{ file: string; context: string }> = []

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
        references.push({ file: htmlFile, context: contexts.join(', ') })
      }
    }

    // Check IMAGES.md
    const imagesPath = path.join(sessionPath, 'IMAGES.md')
    const imagesMd = await readFile(imagesPath, 'utf-8').catch(() => '')
    if (imagesMd.includes(filename)) {
      references.push({ file: 'IMAGES.md', context: 'status entry' })
    }

    // Check BUILD.md
    const buildPath = path.join(sessionPath, 'BUILD.md')
    const buildMd = await readFile(buildPath, 'utf-8').catch(() => '')
    if (buildMd.includes(filename)) {
      references.push({ file: 'BUILD.md', context: 'build log' })
    }

    // Check CREATIVE-BRIEF.md
    const briefPath = path.join(sessionPath, 'CREATIVE-BRIEF.md')
    const briefMd = await readFile(briefPath, 'utf-8').catch(() => '')
    if (briefMd.includes(filename)) {
      references.push({ file: 'CREATIVE-BRIEF.md', context: 'brief mention' })
    }

    // Check SESSION.md
    const sessionMdPath = path.join(sessionPath, 'SESSION.md')
    const sessionMd = await readFile(sessionMdPath, 'utf-8').catch(() => '')
    if (sessionMd.includes(filename)) {
      references.push({ file: 'SESSION.md', context: 'session note' })
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

    // 2. Remove IMAGES.md entry (remove the ### block for this filename)
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
