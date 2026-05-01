import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, readdir, appendFile } from 'fs/promises'
import path from 'path'
import { reconcileUsedTags } from '@/lib/session'

/**
 * WP-11B: Replace all occurrences of one image with another across all vibe HTMLs.
 *
 * Two modes:
 *   - `scan`: Count occurrences of sourceFilename across all HTMLs.
 *   - `replace`: Swap every occurrence and log to BUILD.md.
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionId, sourceFilename, targetFilename, action = 'scan' } = await req.json()

    if (!sessionId || !sourceFilename) {
      return NextResponse.json(
        { error: 'sessionId and sourceFilename are required' },
        { status: 400 }
      )
    }

    const sessionPath = path.join(process.cwd(), 'public', sessionId)
    const files = await readdir(sessionPath).catch(() => [] as string[])
    const htmlFiles = files.filter((f) => f.endsWith('.html'))

    const escaped = escapeRegex(sourceFilename)

    // Patterns to match all three image reference types
    const patterns = [
      new RegExp(`(src=["'])${escaped}(["'])`, 'gi'),       // <img src="X">
      new RegExp(`(url\\(['"]?)${escaped}(['"]?\\))`, 'gi'), // background-image: url(X)
    ]

    // ── Scan ──
    interface Occurrence {
      file: string
      count: number
      types: string[]
    }
    const occurrences: Occurrence[] = []
    let totalCount = 0

    for (const htmlFile of htmlFiles) {
      const htmlPath = path.join(sessionPath, htmlFile)
      const html = await readFile(htmlPath, 'utf-8').catch(() => '')
      if (!html || !html.includes(sourceFilename)) continue

      let count = 0
      const types: string[] = []

      // Count src= matches
      const srcMatches = html.match(new RegExp(`src=["']${escaped}["']`, 'gi'))
      if (srcMatches) {
        count += srcMatches.length
        types.push('img src')
      }

      // Count url() matches
      const urlMatches = html.match(new RegExp(`url\\(['"]?${escaped}['"]?\\)`, 'gi'))
      if (urlMatches) {
        count += urlMatches.length
        types.push('background-image')
      }

      if (count > 0) {
        occurrences.push({ file: htmlFile, count, types })
        totalCount += count
      }
    }

    if (action === 'scan') {
      return NextResponse.json({
        sourceFilename,
        totalCount,
        vibeCount: occurrences.length,
        occurrences,
      })
    }

    // ── Replace ──
    if (action !== 'replace' || !targetFilename) {
      return NextResponse.json(
        { error: 'action must be "replace" and targetFilename is required' },
        { status: 400 }
      )
    }

    let replacedTotal = 0
    const replacedFiles: string[] = []

    for (const htmlFile of htmlFiles) {
      const htmlPath = path.join(sessionPath, htmlFile)
      let html = await readFile(htmlPath, 'utf-8').catch(() => '')
      if (!html || !html.includes(sourceFilename)) continue

      let replacedInFile = 0
      for (const pattern of patterns) {
        pattern.lastIndex = 0
        html = html.replace(pattern, (match, prefix, suffix) => {
          replacedInFile += 1
          return `${prefix}${targetFilename}${suffix}`
        })
      }

      if (replacedInFile > 0) {
        await writeFile(htmlPath, html, 'utf-8')
        replacedTotal += replacedInFile
        replacedFiles.push(htmlFile)
      }
    }

    // Log to BUILD.md
    try {
      const buildPath = path.join(sessionPath, 'BUILD.md')
      const timestamp = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      const logEntry = `\n| ${timestamp} | REPLACE-ALL | ${sourceFilename} → ${targetFilename} | ${replacedTotal} refs in ${replacedFiles.length} vibes |`
      await appendFile(buildPath, logEntry, 'utf-8')
    } catch {
      // BUILD.md log is best-effort
    }

    console.log(`[replace-image] Replaced ${sourceFilename} → ${targetFilename}: ${replacedTotal} refs in ${replacedFiles.length} files`)

    // Ralph 2026-04-25: reconcile USED tags now that vibe HTML refs changed.
    // The displaced source is no longer referenced anywhere → demote to
    // B-ROLL. The new target is now referenced → promote to USED. Without
    // this, IMAGES.md tags drift from reality and the asset panel keeps
    // showing the old USED/B-ROLL state. HERO + TRASH are sacred and
    // untouched per the existing reconcile rules.
    let reconcile: { promoted: string[]; demoted: string[]; unchanged: number } | null = null
    try {
      reconcile = await reconcileUsedTags(sessionId)
      console.log(
        `[replace-image] Reconciled tags: +${reconcile.promoted.length} USED, -${reconcile.demoted.length} demoted`,
      )
    } catch (err) {
      console.error('[replace-image] reconcileUsedTags failed:', err)
    }

    return NextResponse.json({
      success: true,
      sourceFilename,
      targetFilename,
      replacedTotal,
      replacedFiles,
      reconcile,
    })
  } catch (error) {
    console.error('[replace-image] Error:', error)
    return NextResponse.json(
      { error: `Replace failed: ${error}` },
      { status: 500 }
    )
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
