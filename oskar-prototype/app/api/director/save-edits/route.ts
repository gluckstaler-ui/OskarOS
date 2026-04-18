import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { JSDOM } from 'jsdom'

/**
 * Director-mode persistence — image swaps + inline-style edits.
 *
 * Companion to `/api/director/text-edit` (which persists text changes on
 * blur). This route persists EVERYTHING ELSE the user does in Director
 * Mode: image src swaps, background-image swaps, and inline `style`
 * attributes (filter, transform, object-fit, etc.). It is called from
 * `LivePreviewWithDirector.saveAll()` when the user clicks SAVE — or
 * implicitly when they navigate away (default = commit).
 *
 * Element identification strategy: each edit carries a `selector` (CSS
 * selector path generated client-side via `buildStablePath` in
 * LivePreviewWithDirector). Format:
 *   `body > section:nth-of-type(1) > div:nth-of-type(2) > img:nth-of-type(1)`
 * jsdom resolves it. If the selector misses (page DOM drifted) the edit
 * is reported back as `{ ok: false, reason: 'not-found' }` so the client
 * can warn the user; other edits in the same batch still apply.
 *
 * Request shape:
 *   {
 *     sessionId: string
 *     pageFilename: string
 *     edits: Array<{
 *       selector: string         // CSS selector resolvable in the saved HTML
 *       style?: string           // new value for the `style` attribute (full)
 *       src?: string             // new value for `src` (img only)
 *     }>
 *   }
 *
 * Response shape:
 *   {
 *     success: boolean
 *     applied: number
 *     results: Array<{ selector: string; ok: boolean; reason?: string }>
 *   }
 */

interface SaveEdit {
  selector: string
  style?: string
  src?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      sessionId?: string
      pageFilename?: string
      edits?: SaveEdit[]
    }

    if (!body.sessionId || !body.pageFilename || !Array.isArray(body.edits)) {
      return NextResponse.json(
        { error: 'sessionId, pageFilename, and edits[] are required' },
        { status: 400 }
      )
    }

    if (body.edits.length === 0) {
      return NextResponse.json({ success: true, applied: 0, results: [] })
    }

    const htmlPath = path.join(process.cwd(), 'public', body.sessionId, body.pageFilename)
    let html: string
    try {
      html = await readFile(htmlPath, 'utf-8')
    } catch {
      return NextResponse.json(
        { error: `File not found: ${body.pageFilename}` },
        { status: 404 }
      )
    }

    const dom = new JSDOM(html)
    const doc = dom.window.document
    const results: Array<{ selector: string; ok: boolean; reason?: string }> = []
    let applied = 0

    for (const edit of body.edits) {
      if (!edit.selector) {
        results.push({ selector: '<missing>', ok: false, reason: 'no-selector' })
        continue
      }

      let el: Element | null = null
      try {
        el = doc.querySelector(edit.selector)
      } catch (err) {
        results.push({
          selector: edit.selector,
          ok: false,
          reason: `bad-selector: ${err instanceof Error ? err.message : String(err)}`,
        })
        continue
      }

      if (!el) {
        results.push({ selector: edit.selector, ok: false, reason: 'not-found' })
        continue
      }

      // Apply src (only meaningful for <img>; harmless on other elements)
      if (typeof edit.src === 'string') {
        if (edit.src.length === 0) {
          el.removeAttribute('src')
        } else {
          el.setAttribute('src', edit.src)
        }
      }

      // Apply inline style. Empty string clears the attribute entirely so the
      // saved HTML doesn't carry a leftover `style=""`.
      if (typeof edit.style === 'string') {
        if (edit.style.trim().length === 0) {
          el.removeAttribute('style')
        } else {
          el.setAttribute('style', edit.style)
        }
      }

      applied += 1
      results.push({ selector: edit.selector, ok: true })
    }

    if (applied === 0) {
      return NextResponse.json({ success: false, applied: 0, results }, { status: 200 })
    }

    // Serialize back. jsdom's serialize() preserves the original doctype when
    // the input had one, so we don't need to re-prepend <!DOCTYPE html>.
    const newHtml = dom.serialize()
    await writeFile(htmlPath, newHtml, 'utf-8')

    console.log(
      `[save-edits] ${body.pageFilename}: applied ${applied}/${body.edits.length} edits`
    )

    return NextResponse.json({ success: true, applied, results })
  } catch (error) {
    console.error('[save-edits] Error:', error)
    return NextResponse.json(
      { error: `Save failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    )
  }
}
