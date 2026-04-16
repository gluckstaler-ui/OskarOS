// ==========================================
// Admin API: List Sessions
// GET /api/admin/sessions
// ==========================================

import { NextResponse } from 'next/server'
import { readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { readSessionUsage, formatCost } from '@/lib/usage-tracker'

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
}

// Phase names mapping
const PHASE_NAMES: Record<number, string> = {
  1: 'Discovery',
  2: 'Image Eval',
  3: 'Gen Vibes',
  4: 'User Select',
  5: 'Handoff',
  6: 'Archetype',
  7: 'Brief WD'
}

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

      // Get name from SESSION.md or CREATIVE-BRIEF.md
      let name = dir.name
      let briefContent = ''

      if (hasSessionMd) {
        try {
          const sessionContent = await readFile(join(sessionPath, 'SESSION.md'), 'utf-8')
          const nameMatch = sessionContent.match(/Business:\s*(.+)/i) || sessionContent.match(/Name:\s*(.+)/i)
          if (nameMatch) name = nameMatch[1].trim()
        } catch {}
      }

      // Count vibes from CREATIVE-BRIEF.md
      let vibesTotal = 4 // Default
      let vibesInBrief = 0
      if (hasBrief) {
        try {
          briefContent = await readFile(join(sessionPath, 'CREATIVE-BRIEF.md'), 'utf-8')
          const vibeMatches = briefContent.match(/## VIBE \d+:/gi)
          if (vibeMatches) {
            vibesTotal = vibeMatches.length
            vibesInBrief = vibeMatches.length
          }
          // Get name from brief if not found in session
          if (name === dir.name) {
            const briefNameMatch = briefContent.match(/Business:\s*(.+)/i) || briefContent.match(/# (.+)/i)
            if (briefNameMatch) name = briefNameMatch[1].trim()
          }
        } catch {}
      }

      // Count built HTML files
      const htmlFiles = files.filter(f => f.startsWith('vibe-') && f.endsWith('.html'))
      const vibesComplete = htmlFiles.length

      // Count images
      const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))

      // Detect phase from actual content (same logic as detail API)
      const hasHtmlVibes = htmlFiles.length > 0
      const hasFinalHtml = files.some(f => f.includes('final-landing') || f.startsWith('final-'))

      // Check for actual selected vibe (not just template placeholder)
      const selectedVibeSection = briefContent.match(/## Selected Vibe\s*\n([\s\S]*?)(?=\n##|$)/i)
      const hasSelectedVibe = selectedVibeSection &&
        !selectedVibeSection[1].includes('pending') &&
        !selectedVibeSection[1].includes('To be') &&
        selectedVibeSection[1].trim().length > 20

      // Check for actual booking archetype content (not just template)
      const bookingSection = briefContent.match(/## Booking Archetype\s*\n([\s\S]*?)(?=\n##|$)/i)
      const hasBookingLogic = bookingSection &&
        !bookingSection[1].includes('To be') &&
        !bookingSection[1].includes('verified') &&
        bookingSection[1].trim().length > 30

      let phase = 1
      if (hasFinalHtml && hasBookingLogic) {
        phase = 7 // Final handoff complete
      } else if (hasSelectedVibe && hasBookingLogic) {
        phase = 6 // Archetype/booking questions
      } else if (hasSelectedVibe || hasFinalHtml) {
        phase = 5 // Handoff
      } else if (hasHtmlVibes && vibesInBrief >= 4) {
        phase = 4 // User selecting (all vibes built)
      } else if (hasBrief && vibesInBrief > 0) {
        phase = 3 // Generating vibes
      } else if (hasHtmlVibes) {
        phase = 3 // Any HTML files = at least Phase 3
      } else if (imageFiles.length > 0) {
        phase = 2 // Image evaluation
      }
      // else phase = 1 (Discovery)

      // Get token usage
      const usage = await readSessionUsage(dir.name)

      sessions.push({
        id: dir.name,
        name,
        phase,
        phaseName: PHASE_NAMES[phase] || 'Unknown',
        lastUpdated,
        vibesComplete,
        vibesTotal,
        fileCount,
        tokenBurn: {
          inputTokens: usage.totals.inputTokens,
          outputTokens: usage.totals.outputTokens,
          cost: formatCost(usage.totals.cost)
        }
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
