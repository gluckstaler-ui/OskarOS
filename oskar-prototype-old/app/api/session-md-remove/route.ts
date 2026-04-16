import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

/**
 * POST /api/session-md-remove
 *
 * Removes an entry from IMAGES.md or CREATIVE-BRIEF.md
 *
 * Body: { sessionId, type: 'image' | 'vibe', filename }
 *
 * For images: removes the ### {filename} entry from IMAGES.md "## Uploaded Images" section
 *   and any #### entries referencing this filename in generated sections
 *
 * For vibes: removes the matching # VIBE N: section from CREATIVE-BRIEF.md
 *   AND the matching ### filename.html entry from the "## Vibe Preview" section
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionId, type, filename } = await req.json()

    if (!sessionId || !type || !filename) {
      return NextResponse.json({ error: 'Missing sessionId, type, or filename' }, { status: 400 })
    }

    // Sanitize
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '')
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '')
    const sessionPath = path.join(process.cwd(), 'public', safeSession)

    if (type === 'image') {
      return await removeImageEntry(sessionPath, safeFilename)
    } else if (type === 'vibe') {
      return await removeVibeEntry(sessionPath, safeFilename)
    } else {
      return NextResponse.json({ error: 'Invalid type — must be "image" or "vibe"' }, { status: 400 })
    }
  } catch (error) {
    console.error('session-md-remove error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

async function removeImageEntry(sessionPath: string, filename: string) {
  const imagesPath = path.join(sessionPath, 'IMAGES.md')

  let content: string
  try {
    content = await readFile(imagesPath, 'utf-8')
  } catch {
    return NextResponse.json({ error: 'IMAGES.md not found' }, { status: 404 })
  }

  const originalLength = content.length

  // Remove ### {filename} entries (uploaded images — level 3 heading)
  // Each entry starts with ### filename and ends before the next ### or ## heading
  content = removeMdSection(content, `### ${filename}`, /^###?\s|^## /m)

  // Also remove #### {filename} entries (generated images — level 4 heading)
  content = removeMdSection(content, `#### ${filename}`, /^####?\s|^### |^## /m)

  if (content.length === originalLength) {
    console.log(`⚠️ No entry found for "${filename}" in IMAGES.md`)
    return NextResponse.json({ success: true, removed: false, message: 'Entry not found in IMAGES.md' })
  }

  // Clean up excessive blank lines (more than 2 in a row)
  content = content.replace(/\n{4,}/g, '\n\n\n')

  await writeFile(imagesPath, content)
  console.log(`🗑️ Removed "${filename}" from IMAGES.md`)

  return NextResponse.json({ success: true, removed: true })
}

async function removeVibeEntry(sessionPath: string, filename: string) {
  const briefPath = path.join(sessionPath, 'CREATIVE-BRIEF.md')

  let content: string
  try {
    content = await readFile(briefPath, 'utf-8')
  } catch {
    return NextResponse.json({ error: 'CREATIVE-BRIEF.md not found' }, { status: 404 })
  }

  let removedMain = false
  let removedPreview = false

  // Step 1: Find the vibe name from the filename
  // Filename format: vibe-N-slug-name.html → match against # VIBE N: "NAME"
  const vibeMatch = filename.match(/^vibe-(\d+)-(.+)\.html$/)

  if (vibeMatch) {
    const vibeNumber = vibeMatch[1]
    const vibeSlug = vibeMatch[2]

    // Find and remove the main vibe section: # VIBE N: "..."
    // It runs from # VIBE N: until the next # VIBE or ## Vibe Preview or end of vibes
    const vibeHeaderRegex = new RegExp(
      `(^# VIBE ${vibeNumber}:.*$)`,
      'm'
    )
    const headerMatch = content.match(vibeHeaderRegex)

    if (headerMatch && headerMatch.index !== undefined) {
      const startIdx = headerMatch.index
      // Find where this vibe section ends — next # VIBE header or ## Vibe Preview or ## Meta or ## Selected or ## Booking
      const rest = content.slice(startIdx + headerMatch[0].length)
      const nextSectionMatch = rest.match(/^# VIBE \d+:|^## Vibe Preview|^## Meta|^## Selected Vibe|^## Booking/m)

      let endIdx: number
      if (nextSectionMatch && nextSectionMatch.index !== undefined) {
        endIdx = startIdx + headerMatch[0].length + nextSectionMatch.index
      } else {
        endIdx = content.length
      }

      // Remove the section (including any trailing --- separator)
      const before = content.slice(0, startIdx)
      let after = content.slice(endIdx)
      // Clean leading separator from the next section
      after = after.replace(/^---\s*\n/, '')

      content = before + after
      removedMain = true
      console.log(`🗑️ Removed VIBE ${vibeNumber} main section from CREATIVE-BRIEF.md`)
    }
  }

  // Step 2: Remove the ### filename entry from ## Vibe Preview section
  const previewHeaderRegex = new RegExp(`^### ${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm')
  const previewMatch = content.match(previewHeaderRegex)

  if (previewMatch && previewMatch.index !== undefined) {
    const startIdx = previewMatch.index
    const rest = content.slice(startIdx + previewMatch[0].length)
    // Entry ends at next ### or ## heading
    const nextMatch = rest.match(/^###?\s|^## /m)
    let endIdx: number
    if (nextMatch && nextMatch.index !== undefined) {
      endIdx = startIdx + previewMatch[0].length + nextMatch.index
    } else {
      endIdx = content.length
    }

    content = content.slice(0, startIdx) + content.slice(endIdx)
    removedPreview = true
    console.log(`🗑️ Removed "${filename}" from Vibe Preview section`)
  }

  if (!removedMain && !removedPreview) {
    console.log(`⚠️ No entry found for "${filename}" in CREATIVE-BRIEF.md`)
    return NextResponse.json({ success: true, removed: false, message: 'Entry not found in CREATIVE-BRIEF.md' })
  }

  // Clean up excessive blank lines
  content = content.replace(/\n{4,}/g, '\n\n\n')

  await writeFile(briefPath, content)

  return NextResponse.json({ success: true, removedMain, removedPreview })
}

/**
 * Removes a markdown section starting with a specific heading line,
 * ending before the next heading that matches the boundary regex.
 */
function removeMdSection(content: string, heading: string, boundaryRegex: RegExp): string {
  // Find the heading line
  const headingRegex = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm')
  const match = content.match(headingRegex)

  if (!match || match.index === undefined) return content

  const startIdx = match.index
  const rest = content.slice(startIdx + match[0].length)

  // Find where this section ends
  const lines = rest.split('\n')
  let sectionEnd = rest.length
  let charCount = 0

  for (const line of lines) {
    // Skip first line (it's the rest of the heading line or empty)
    if (charCount === 0) {
      charCount += line.length + 1
      continue
    }
    if (boundaryRegex.test(line)) {
      sectionEnd = charCount
      break
    }
    charCount += line.length + 1
  }

  const endIdx = startIdx + match[0].length + sectionEnd

  // Remove the section including any trailing --- and blank lines
  let before = content.slice(0, startIdx)
  let after = content.slice(endIdx)

  // Clean trailing separators
  before = before.replace(/\n---\s*\n*$/, '\n')
  after = after.replace(/^---\s*\n/, '')

  return before + after
}
