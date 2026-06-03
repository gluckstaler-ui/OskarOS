// ==========================================
// Admin API: List Sessions
// GET /api/admin/sessions
// ==========================================

import { NextResponse } from 'next/server'
import { readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { readSessionUsage, formatCost } from '@/lib/usage-tracker'
import { deriveSessionPhase, PHASE_NAMES as SHARED_PHASE_NAMES } from '@/lib/session-phase'
import { readSessionConfig } from '@/lib/session-config'
import { humanizeSessionId } from '@/lib/session'

interface SessionSummary {
  id: string
  name: string
  phase: number
  phaseName: string
  lastUpdated: string
  vibesComplete: number
  vibesTotal: number
  fileCount: number
  tokenBurn: {
    inputTokens: number
    outputTokens: number
    cost: string
  }
  /** WP-CRM-D6: surfaces the prospect linkage so the Sessions tab can
   *  render a "→ CRM lead" breadcrumb without having to re-fetch the
   *  full LinksMap on the client. */
  prospectId?: string
}

// Phase names — re-exported from the shared `lib/session-phase.ts` helper
// (WP-CRM-C4 refactor). Kept as a local alias so the rest of this file
// reads naturally; the CRM scan now reads the same table.
const PHASE_NAMES = SHARED_PHASE_NAMES

export async function GET() {
  try {
    const publicDir = join(process.cwd(), 'public')

    // List all directories in /public
    const entries = await readdir(publicDir, { withFileTypes: true })
    const sessionDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))

    const sessions: SessionSummary[] = []

    for (const dir of sessionDirs) {
      const sessionPath = join(publicDir, dir.name)

      // Check if it's a valid session (has SESSION.md or CREATIVE-BRIEF.md)
      const hasSessionMd = existsSync(join(sessionPath, 'SESSION.md'))
      const hasBrief = existsSync(join(sessionPath, 'CREATIVE-BRIEF.md'))

      if (!hasSessionMd && !hasBrief) {
        continue // Not a session folder
      }

      // Get folder stats for lastUpdated
      const folderStat = await stat(sessionPath)
      const lastUpdated = getRelativeTime(folderStat.mtime)

      // Count files
      const files = await readdir(sessionPath)
      const fileCount = files.filter(f => !f.startsWith('.')).length

      // Top-bar / list display name — deterministic from sessionId
      // (Ralph 2026-06-01). Was: regex-scan of SESSION.md and CREATIVE-
      // BRIEF.md for `Business:` etc., which got hijacked by CD's
      // Confirm-Understanding cards writing multi-sentence brand
      // paragraphs after `**Business:**`. The sessionId is the slug of
      // the businessName by construction — reverse-humanize is a pure
      // transformation with no failure modes.
      const name = humanizeSessionId(dir.name)
      let briefContent = ''

      // Count vibes from CREATIVE-BRIEF.md. (Brief content is still
      // loaded for the vibe count below; the name no longer needs it.)
      let vibesTotal = 4 // Default
      if (hasBrief) {
        try {
          briefContent = await readFile(join(sessionPath, 'CREATIVE-BRIEF.md'), 'utf-8')
          const vibeMatches = briefContent.match(/## VIBE \d+:/gi)
          if (vibeMatches) {
            vibesTotal = vibeMatches.length
          }
        } catch {}
      }

      // Count built HTML files
      const htmlFiles = files.filter(f => f.startsWith('vibe-') && f.endsWith('.html'))
      const vibesComplete = htmlFiles.length

      // WP-CRM-C4: phase derivation moved to lib/session-phase.ts so the
      // CRM kanban pill (C4) reads the same number. This route was the
      // original home of the logic — now just a single call.
      const { phase, phaseName } = deriveSessionPhase(sessionPath)

      // Get token usage
      const usage = await readSessionUsage(dir.name)

      // WP-CRM-D6: surface the CRM linkage from _session-config.json so
      // the Sessions tab can render a "→ CRM lead" breadcrumb.
      const cfg = readSessionConfig(dir.name)
      const prospectId = cfg.prospect_id

      sessions.push({
        id: dir.name,
        name,
        phase,
        phaseName: phaseName || PHASE_NAMES[phase] || 'Unknown',
        lastUpdated,
        vibesComplete,
        vibesTotal,
        fileCount,
        tokenBurn: {
          inputTokens: usage.totals.inputTokens,
          outputTokens: usage.totals.outputTokens,
          cost: formatCost(usage.totals.cost)
        },
        ...(prospectId ? { prospectId } : {}),
      })
    }

    // Sort by last updated (most recent first)
    sessions.sort((a, b) => {
      // Simple heuristic: "Just now" < "X mins ago" < "X hours ago" < "X days ago"
      const order = (s: string) => {
        if (s.includes('Just now')) return 0
        if (s.includes('min')) return 1
        if (s.includes('hour')) return 2
        if (s.includes('day')) return 3
        return 4
      }
      return order(a.lastUpdated) - order(b.lastUpdated)
    })

    return NextResponse.json({ sessions, count: sessions.length })

  } catch (error) {
    console.error('[Admin] Failed to list sessions:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// ==========================================
// Helper: Relative time
// ==========================================

function getRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  return date.toLocaleDateString()
}
