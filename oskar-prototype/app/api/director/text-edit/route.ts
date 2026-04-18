import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

/**
 * WP-10B: Persist a text edit from Director Mode.
 *
 * The bridge tags text elements with `data-oskar-id="txt-N"`. On commit,
 * the parent receives { oskarId, newText, tagName }. This route injects
 * the `data-oskar-id` attribute into the HTML (if not already present)
 * and replaces the text content of the matching element.
 *
 * Strategy: since `data-oskar-id` is assigned at runtime by the bridge and
 * may not exist in the saved HTML, we use a positional approach:
 *   1. Re-scan the HTML for text-bearing leaf elements matching the tagName.
 *   2. Assign sequential IDs (txt-1, txt-2…) mirroring the bridge's walk.
 *   3. Replace the text content of the element with the matching ID.
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionId, pageFilename, oskarId, newText, tagName } = await req.json()

    if (!sessionId || !pageFilename || !oskarId || !newText) {
      return NextResponse.json(
        { error: 'sessionId, pageFilename, oskarId, and newText are required' },
        { status: 400 }
      )
    }

    const htmlPath = path.join(process.cwd(), 'public', sessionId, pageFilename)
    let html: string
    try {
      html = await readFile(htmlPath, 'utf-8')
    } catch {
      return NextResponse.json(
        { error: `File not found: ${pageFilename}` },
        { status: 404 }
      )
    }

    // Parse the numeric index from oskarId (e.g. "txt-7" → 7)
    const idMatch = oskarId.match(/^txt-(\d+)$/)
    if (!idMatch) {
      return NextResponse.json(
        { error: `Invalid oskarId format: ${oskarId}` },
        { status: 400 }
      )
    }
    const targetIndex = parseInt(idMatch[1], 10)

    // Replicate the bridge's DOM walk in string-land:
    // Find all text-bearing tags in document order and count to the target index.
    const editableTags = 'h1|h2|h3|h4|h5|h6|p|button|span|a|li|td|th|label|figcaption'
    const tagPattern = new RegExp(
      `<(${editableTags})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`,
      'gi'
    )

    let index = 0
    let replaced = false
    let oldText: string | null = null

    const newHtml = html.replace(tagPattern, (full, tag, attrs, content) => {
      // Skip elements inside data-slot or data-usage containers
      // (crude heuristic: if attrs contain data-slot or data-usage, skip)
      if (/data-slot|data-usage|data-oskar-bgimg/i.test(attrs)) return full

      // Check if content is "text-only" — no block-level children
      if (/<(div|section|article|header|footer|nav|main|aside|table|ul|ol|img)\b/i.test(content)) {
        return full
      }

      // Must have non-empty text
      const textContent = content.replace(/<[^>]+>/g, '').trim()
      if (!textContent) return full

      // If tagName filter was provided, only count matching tags
      if (tagName && tag.toLowerCase() !== tagName.toLowerCase()) {
        // Still count it — the bridge counts ALL matching tags regardless of tagName
        index += 1
        if (index === targetIndex) {
          // This is the target but wrong tag — still replace (bridge assigned this ID)
          oldText = textContent
          replaced = true
          return `<${tag}${attrs}>${newText}</${tag}>`
        }
        return full
      }

      index += 1
      if (index === targetIndex) {
        oldText = textContent
        replaced = true
        return `<${tag}${attrs}>${newText}</${tag}>`
      }
      return full
    })

    if (!replaced) {
      return NextResponse.json(
        { error: `Could not find text element ${oskarId} in ${pageFilename}` },
        { status: 404 }
      )
    }

    await writeFile(htmlPath, newHtml, 'utf-8')
    console.log(`[text-edit] Replaced ${oskarId} in ${pageFilename}: "${oldText?.slice(0, 40)}…" → "${newText.slice(0, 40)}…"`)

    return NextResponse.json({
      success: true,
      oskarId,
      oldText,
      newText,
    })
  } catch (error) {
    console.error('[text-edit] Error:', error)
    return NextResponse.json(
      { error: `Text edit failed: ${error}` },
      { status: 500 }
    )
  }
}
