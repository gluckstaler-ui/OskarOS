import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { appendFileSync } from 'fs'
import path from 'path'
import { applyDirectorEdits } from '@/lib/director-surgery'

// TEMP live-debug (2026-06-22): capture what the REAL canvas sends to disk so we
// can diagnose the butchering without a browser. Remove once root cause is found.
function dbg(line: string) {
  try { appendFileSync(path.join(process.cwd(), 'db', 'director-debug.log'), line + '\n') } catch {}
}

/**
 * Persist a Director-Mode text edit.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 2026-06-19 — full rewrite. The previous implementation expected `oskarId`
 * to be `txt-N` and walked the HTML with a fragile tag-counting regex. But the
 * client (LivePreviewWithDirector.onFocusOut) sends `oskarId = buildStablePath(el)`
 * — a structural selector path like `auto-body > section:nth-of-type(1) >
 * p:nth-of-type(2)`. The `^txt-(\d+)$` check therefore ALWAYS returned 400 and
 * the client swallowed it, so text edits NEVER persisted (silent whack-a-mole).
 *
 * Now we resolve that exact selector path with `applyDirectorEdits` — the same
 * byte-surgical engine `/api/director/save-edits` uses — and splice only the
 * element's inner-text span. Scripts / SVG / siblings stay byte-identical.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionId, pageFilename, oskarId, newText, baseText } = await req.json()

    // newText may legitimately be '' (user cleared the text), so check for
    // presence, not truthiness.
    if (!sessionId || !pageFilename || !oskarId || newText === undefined || newText === null) {
      return NextResponse.json(
        { error: 'sessionId, pageFilename, oskarId, and newText are required' },
        { status: 400 }
      )
    }

    // pageFilename is a real session-relative path (may include a subfolder,
    // e.g. "Old_Vibes/vibe-11.html") — `parseHtmlPath` already decoded it.
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

    const { html: newHtml, results, applied } = applyDirectorEdits(html, [
      {
        selector: String(oskarId),
        innerHtml: String(newText),
        // Optimistic-concurrency guard: only write if the source's current text
        // still matches what the user was editing. Prevents an edit made while
        // the canvas renders a TRANSLATION from clobbering the source language.
        ...(baseText !== undefined && baseText !== null ? { expectText: String(baseText) } : {}),
      },
    ])

    // Live diagnostic (the dbg() helper above was added 2026-06-22 but never
    // called, so the log stayed empty). Capture EVERY attempt — selector +
    // outcome — so a "doesn't save" can be traced to its exact reason offline.
    dbg(`text-edit ${pageFilename} | sel=${oskarId} | applied=${applied} reason=${results[0]?.reason ?? 'ok'} | base="${String(baseText ?? '').replace(/\s+/g, ' ').slice(0, 70)}" new="${String(newText).replace(/\s+/g, ' ').slice(0, 70)}"`)

    if (applied === 0) {
      const reason = results[0]?.reason || 'unknown'
      // The element on disk no longer matches what the user edited — almost
      // always because the canvas is showing a translated/transformed view.
      // Refuse loudly (409) so the client can tell the user instead of silently
      // dropping the edit.
      if (reason === 'stale-or-transformed') {
        return NextResponse.json(
          {
            error:
              'This element is showing transformed or translated content, not the source. ' +
              'Switch the preview to the source language to edit it directly, or edit the ' +
              'translation in the META panel.',
            reason,
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: `Could not apply text edit (${reason}) for ${oskarId} in ${pageFilename}`, reason },
        { status: 404 }
      )
    }

    await writeFile(htmlPath, newHtml, 'utf-8')
    console.log(`[text-edit] ${pageFilename}: ${oskarId} → "${String(newText).slice(0, 40)}…"`)

    return NextResponse.json({ success: true, oskarId, newText })
  } catch (error) {
    console.error('[text-edit] Error:', error)
    return NextResponse.json(
      { error: `Text edit failed: ${error}` },
      { status: 500 }
    )
  }
}
