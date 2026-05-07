import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

/**
 * POST /api/director/edit
 * Persists Director Mode edits to HTML files
 */
export async function POST(request: NextRequest) {
  try {
    const { htmlPath, elementId, newValue, elementType } = await request.json()

    if (!htmlPath || !elementId || newValue === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get absolute path - htmlPath is like /2026-01-27-33/vibe-1.html
    const publicDir = join(process.cwd(), 'public')
    const filePath = join(publicDir, htmlPath)

    // Read current HTML
    let html = await readFile(filePath, 'utf-8')

    if (elementType === 'text') {
      // Strategy 1: Look for elements with data-editable or id matching elementId
      const dataEditableRegex = new RegExp(
        `(<[^>]+data-editable="${elementId}"[^>]*>)([^<]*)(</)`,
        'g'
      )
      const idRegex = new RegExp(
        `(<[^>]+id="${elementId}"[^>]*>)([^<]*)(</)`,
        'g'
      )

      if (dataEditableRegex.test(html)) {
        html = html.replace(dataEditableRegex, `$1${escapeHtml(newValue)}$3`)
      } else if (idRegex.test(html)) {
        html = html.replace(idRegex, `$1${escapeHtml(newValue)}$3`)
      } else {
        // Strategy 2: For dynamically assigned IDs (like h1-1, p-3), we need to
        // find the element by walking through the HTML and counting tags
        // This is a simplified approach - find the nth occurrence of the tag
        const match = elementId.match(/^([a-z]+)-(\d+)$/)
        if (match) {
          const tagName = match[1]
          const index = parseInt(match[2])
          let count = 0

          // Create a regex that matches the tag and captures its content
          const tagRegex = new RegExp(`(<${tagName}[^>]*>)([^<]*)(</${tagName}>)`, 'gi')

          html = html.replace(tagRegex, (match, open, content, close) => {
            count++
            if (count === index) {
              return `${open}${escapeHtml(newValue)}${close}`
            }
            return match
          })
        }
      }
    } else if (elementType === 'image') {
      // Update image src
      const imgRegex = new RegExp(
        `(<img[^>]*(?:data-usage="${elementId}"|id="${elementId}")[^>]*src=")([^"]+)(")`
        , 'gi'
      )

      if (imgRegex.test(html)) {
        html = html.replace(imgRegex, `$1${newValue}$3`)
      } else {
        // Try to find any img with matching src pattern
        const srcRegex = new RegExp(
          `(<img[^>]*src=")([^"]*${elementId}[^"]*)(")`
          , 'gi'
        )
        html = html.replace(srcRegex, `$1${newValue}$3`)
      }
    }

    // Write updated HTML
    await writeFile(filePath, html, 'utf-8')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Director edit error:', error)
    return NextResponse.json(
      { error: 'Failed to save edit' },
      { status: 500 }
    )
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
