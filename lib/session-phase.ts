/**
 * Shared session-phase derivation. WP-CRM-C4 (Ralph 2026-05-22).
 *
 * Phase is NOT stored in `_session-config.json` — it's computed from the
 * actual contents of the session folder. Two callers need it:
 *
 *   1. `app/api/admin/sessions/route.ts` — Sessions tab in /admin.html
 *      (already had this logic inline; refactored out here).
 *   2. `lib/crm-store.ts → scanProspectSessions()` — CRM kanban needs the
 *      phase pill on cards (C4) and per-prospect cost rollup (D5).
 *
 * Both reach in via the file system; this helper is sync to fit both call
 * sites without forcing a Promise contract on the Excel-write paths.
 *
 * The phase ladder mirrors PHASE_NAMES below.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export const PHASE_NAMES: Record<number, string> = {
  1: 'Discovery',
  2: 'Image Eval',
  3: 'Gen Vibes',
  4: 'User Select',
  5: 'Handoff',
  6: 'Archetype',
  7: 'Brief WD',
}

export interface SessionPhaseInfo {
  phase: number             // 1..7 — see PHASE_NAMES
  phaseName: string         // user-visible label
  staleDays: number         // ceil((now - newestFileMtime) / day) — for the
                            // amber/green pill color in C4. 0 if folder has no
                            // files or stat fails.
}

const PHASE_DEFAULT: SessionPhaseInfo = { phase: 1, phaseName: PHASE_NAMES[1], staleDays: 0 }

/**
 * Compute the phase for a session by inspecting the folder's contents.
 * Returns PHASE_DEFAULT for missing folders or read failures so a transient
 * FS hiccup doesn't surface a 7-degree bug as a 0.
 */
export function deriveSessionPhase(sessionPath: string): SessionPhaseInfo {
  if (!existsSync(sessionPath)) return PHASE_DEFAULT
  let files: string[]
  try {
    files = readdirSync(sessionPath)
  } catch {
    return PHASE_DEFAULT
  }

  // CREATIVE-BRIEF.md is the source of truth for "how many vibes does the
  // CD agent want?" — counts `## VIBE N:` headings in the brief.
  let briefContent = ''
  let vibesInBrief = 0
  const hasBrief = existsSync(join(sessionPath, 'CREATIVE-BRIEF.md'))
  if (hasBrief) {
    try {
      briefContent = readFileSync(join(sessionPath, 'CREATIVE-BRIEF.md'), 'utf-8')
      const vibeMatches = briefContent.match(/## VIBE \d+:/gi)
      vibesInBrief = vibeMatches?.length ?? 0
    } catch {
      // tolerate read failures — fall through with empty briefContent
    }
  }

  const htmlFiles = files.filter(f => f.startsWith('vibe-') && f.endsWith('.html'))
  const hasHtmlVibes = htmlFiles.length > 0
  const hasFinalHtml = files.some(f => f.includes('final-landing') || f.startsWith('final-'))
  const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))

  // Selected-vibe + booking-archetype heuristics — match the existing
  // /api/admin/sessions/route.ts logic exactly. Don't tighten these without
  // also updating the Sessions tab; both surfaces must read the same number.
  const selectedVibeSection = briefContent.match(/## Selected Vibe\s*\n([\s\S]*?)(?=\n##|$)/i)
  const hasSelectedVibe =
    !!selectedVibeSection &&
    !selectedVibeSection[1].includes('pending') &&
    !selectedVibeSection[1].includes('To be') &&
    selectedVibeSection[1].trim().length > 20

  const bookingSection = briefContent.match(/## Booking Archetype\s*\n([\s\S]*?)(?=\n##|$)/i)
  const hasBookingLogic =
    !!bookingSection &&
    !bookingSection[1].includes('To be') &&
    !bookingSection[1].includes('verified') &&
    bookingSection[1].trim().length > 30

  let phase = 1
  if (hasFinalHtml && hasBookingLogic) {
    phase = 7
  } else if (hasSelectedVibe && hasBookingLogic) {
    phase = 6
  } else if (hasSelectedVibe || hasFinalHtml) {
    phase = 5
  } else if (hasHtmlVibes && vibesInBrief >= 4) {
    phase = 4
  } else if (hasBrief && vibesInBrief > 0) {
    phase = 3
  } else if (hasHtmlVibes) {
    phase = 3
  } else if (imageFiles.length > 0) {
    phase = 2
  }
  // else phase = 1 (Discovery)

  // Compute staleness for the C4 pill color: how many days since the
  // newest file in the folder. Capped at 999 to avoid silly pill widths
  // for very old archive folders.
  let newestMtime = 0
  for (const f of files) {
    if (f.startsWith('.')) continue
    try {
      const s = statSync(join(sessionPath, f))
      if (s.mtimeMs > newestMtime) newestMtime = s.mtimeMs
    } catch {
      // ignore individual stat failures
    }
  }
  const staleDays = newestMtime === 0
    ? 0
    : Math.min(999, Math.ceil((Date.now() - newestMtime) / (24 * 60 * 60 * 1000)))

  return { phase, phaseName: PHASE_NAMES[phase] || 'Unknown', staleDays }
}
