/**
 * Session Management for OskarOS
 *
 * Sessions are stored as flat folders in /public/{session-id}/
 * All files are siblings - no subfolders ever.
 *
 * Files in a session:
 * - SESSION.md     - Conversation + workflow state (lean)
 * - IMAGES.md      - All image data (verbose)
 * - BUILD.md       - Build progress + hot-swaps
 * - CREATIVE-BRIEF.md - Handoff contract from CD to WebDev
 * - *.jpg/png      - Images (uploaded, generated, manipulated)
 * - *.html         - Vibe outputs
 */

import { readFile, writeFile, readdir, mkdir, stat, unlink } from 'fs/promises'
import path from 'path'
import {
  getLogsDir, getSessionMdPath, getUserMemoryPath,
} from './memory/paths'
import { SESSION_MD_SEED, getUserMdTemplate } from './memory/templates'
import { matchField, matchFieldMultiline } from './markdown-fields'

// Session phases from the spec
export type SessionPhase =
  | 'PHASE_1_DISCOVERY'
  | 'PHASE_2_VIBES'
  | 'PHASE_3_BUILD'
  | 'PHASE_4_POLISH'
  | 'COMPLETE'

// Workflow state checkboxes
export interface WorkflowState {
  imagesUploaded: boolean
  imagesAnalyzed: boolean
  discoveryComplete: boolean
  vibesDeveloped: number  // 0-5
  imagePromptsApproved: boolean
  ceoSelectionMade: boolean
  finalBuildComplete: boolean
}

// Discovery summary (extracted from conversation)
export interface DiscoverySummary {
  oneSentence: string
  customer: string
  weirdDetail: string
  enemy: string
}

// Session metadata (parsed from SESSION.md)
export interface SessionMeta {
  id: string
  businessName: string
  createdAt: string
  phase: SessionPhase
  workflowState: WorkflowState
  discoverySummary?: DiscoverySummary
}

// Full session data
export interface Session extends SessionMeta {
  sessionMd: string
  imagesMd: string
  buildMd: string
  creativeBriefMd: string
}

// Session list item (for homepage)
export interface SessionListItem {
  id: string
  businessName: string
  phase: SessionPhase
  lastUpdated: string
  previewImage?: string
}

// Get the sessions directory path
function getSessionsDir(): string {
  return path.join(process.cwd(), 'public')
}

// Get a specific session's folder path
function getSessionPath(sessionId: string): string {
  return path.join(getSessionsDir(), sessionId)
}

// Generate a new session ID: YYYY-MM-DD-(n)
// Sequential numbering because business name isn't known at creation time
async function generateSessionId(): Promise<string> {
  const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  const sessionsDir = getSessionsDir()

  // Find existing sessions for today to determine next number
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true })
    const todaySessions = entries
      .filter(e => e.isDirectory() && e.name.startsWith(date))
      .map(e => e.name)

    // Extract numbers from existing sessions like "2026-01-27-1", "2026-01-27-2"
    const numbers = todaySessions
      .map(name => {
        const match = name.match(new RegExp(`^${date}-(\\d+)$`))
        return match ? parseInt(match[1], 10) : 0
      })
      .filter(n => n > 0)

    const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1
    return `${date}-${nextNumber}`
  } catch {
    // If we can't read the directory, start at 1
    return `${date}-1`
  }
}

// Generate slug from business name for renaming
function generateSlug(businessName: string): string {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30)
}

// Create initial SESSION.md content
//
// Top-level sections, top-to-bottom:
//   ## Workflow State      — checkbox list
//   ## Discovery Summary   — populated after CD↔COO discovery
//   ## LEDGER              — one-liners (Lumberjack) + Block entries (Sage-240/40)
//                            under `### <YYYY-MM-DD>` sub-headers
//   ## USER SESSION DATA   — landmark marker. Raw User/CD dialogue goes BELOW
//                            this line. Sage walks past this marker to find
//                            non-summarized tissue to fold.
function createInitialSessionMd(businessName: string): string {
  const now = new Date().toISOString()
  return `# Session: ${businessName}
**Created:** ${now}
**Status:** PHASE_1_DISCOVERY
**Business:** ${businessName}

---

## Workflow State
- [ ] Images uploaded
- [ ] Images analyzed by CD
- [ ] Discovery complete
- [ ] Vibes developed (0/5)
- [ ] Image prompts approved
- [ ] CEO selection made
- [ ] Final build complete

---

## Discovery Summary
*Not yet complete*

---

## LEDGER
*No entries yet*

---

## USER SESSION DATA

`
}

// Create initial IMAGES.md content
function createInitialImagesMd(): string {
  return `# Image Registry

## Uploaded Images

*No images uploaded yet*

---

## Image Prompts + Generated

*No image prompts yet*

---

## Manipulations

*No manipulations yet*
`
}

// Create initial BUILD.md content
function createInitialBuildMd(): string {
  return `# Build Log

## Status
**Current Phase:** PHASE_1_DISCOVERY
**Vibes Requested:** 0
**Vibes Complete:** 0
**Vibes Building:** 0
**Vibes Pending:** 0

---

## Active Checkpoint

_No active operation._

---

## Vibe Queue

| # | Name | Status | Started | Completed |
|---|------|--------|---------|-----------|

---

## Hot-Swap Log

| When | Vibe | Slot | Old | New |
|------|------|------|-----|-----|

---

## Brief Update Log

| When | Change | Affected Vibes | Action |
|------|--------|----------------|--------|

---

## Checkpoint History

| When | Operation | Files | Status |
|------|-----------|-------|--------|
`
}

// Create initial CREATIVE-BRIEF.md content
function createInitialCreativeBriefMd(businessName: string): string {
  return `# Creative Brief: ${businessName}

**Status:** DRAFT

---

## Business Identity
*To be completed after discovery*

---

## Voice & Tone
*To be completed after discovery*

---

## Visual Direction
*To be completed after discovery*

---

## The Five Vibes
*To be developed*

---

## Selected Vibe
*CEO selection pending*

---

## Booking Archetype
*To be verified*

---

## WebDev Instructions
*To be provided after vibe selection*
`
}

/**
 * Create a new session
 * businessName is optional at creation - can be "New Session" initially
 */
export async function createSession(businessName: string = 'New Session'): Promise<Session> {
  const sessionId = await generateSessionId()
  const sessionPath = getSessionPath(sessionId)

  // Create session folder
  await mkdir(sessionPath, { recursive: true })

  // Create initial markdown files
  const sessionMd = createInitialSessionMd(businessName)
  const imagesMd = createInitialImagesMd()
  const buildMd = createInitialBuildMd()
  const creativeBriefMd = createInitialCreativeBriefMd(businessName)

  // Create logs directory for memory system
  const logsDir = getLogsDir(sessionId)
  await mkdir(logsDir, { recursive: true })

  await Promise.all([
    writeFile(path.join(sessionPath, 'SESSION.md'), sessionMd),
    writeFile(path.join(sessionPath, 'IMAGES.md'), imagesMd),
    writeFile(path.join(sessionPath, 'BUILD.md'), buildMd),
    writeFile(path.join(sessionPath, 'CREATIVE-BRIEF.md'), creativeBriefMd),
    // Memory system seed files
    writeFile(getSessionMdPath(sessionId), SESSION_MD_SEED),
    writeFile(getUserMemoryPath(sessionId), getUserMdTemplate(sessionId)),
  ])

  return {
    id: sessionId,
    businessName,
    createdAt: new Date().toISOString(),
    phase: 'PHASE_1_DISCOVERY',
    workflowState: {
      imagesUploaded: false,
      imagesAnalyzed: false,
      discoveryComplete: false,
      vibesDeveloped: 0,
      imagePromptsApproved: false,
      ceoSelectionMade: false,
      finalBuildComplete: false,
    },
    sessionMd,
    imagesMd,
    buildMd,
    creativeBriefMd,
  }
}

/**
 * Rename a session folder after discovering the business name
 * Changes from "2026-01-27-1" to "2026-01-27-falcamel"
 * Returns the new sessionId
 */
export async function renameSession(oldSessionId: string, businessName: string): Promise<string> {
  const { rename } = await import('fs/promises')
  const oldPath = getSessionPath(oldSessionId)

  // Extract date from old session ID (first 10 chars: YYYY-MM-DD)
  const date = oldSessionId.substring(0, 10)
  const slug = generateSlug(businessName)
  const newSessionId = `${date}-${slug}`
  const newPath = getSessionPath(newSessionId)

  // Don't rename if it's the same
  if (oldSessionId === newSessionId) {
    return oldSessionId
  }

  try {
    await rename(oldPath, newPath)

    // Update SESSION.md with new business name
    const sessionMdPath = path.join(newPath, 'SESSION.md')
    let sessionMd = await readFile(sessionMdPath, 'utf-8')
    sessionMd = sessionMd.replace(
      /((?:\*+\s*)?Business(?:\s*\*+)?:(?:\s*\*+)?\s*).+/,
      (_full, prefix) => `${prefix}${businessName}`,
    )
    sessionMd = sessionMd.replace(/^# Session: .+/m, `# Session: ${businessName}`)
    await writeFile(sessionMdPath, sessionMd)

    // Update CREATIVE-BRIEF.md
    const briefPath = path.join(newPath, 'CREATIVE-BRIEF.md')
    let briefMd = await readFile(briefPath, 'utf-8')
    briefMd = briefMd.replace(/^# Creative Brief: .+/m, `# Creative Brief: ${businessName}`)
    await writeFile(briefPath, briefMd)

    console.log(`📁 Renamed session: ${oldSessionId} → ${newSessionId}`)
    return newSessionId
  } catch (error) {
    console.error(`Failed to rename session ${oldSessionId}:`, error)
    return oldSessionId // Return old ID if rename fails
  }
}

/**
 * Get a session by ID
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const sessionPath = getSessionPath(sessionId)

  try {
    const [sessionMd, imagesMd, buildMd, creativeBriefMd] = await Promise.all([
      readFile(path.join(sessionPath, 'SESSION.md'), 'utf-8'),
      readFile(path.join(sessionPath, 'IMAGES.md'), 'utf-8'),
      readFile(path.join(sessionPath, 'BUILD.md'), 'utf-8'),
      readFile(path.join(sessionPath, 'CREATIVE-BRIEF.md'), 'utf-8'),
    ])

    // Parse SESSION.md for metadata
    const meta = parseSessionMd(sessionId, sessionMd)

    return {
      ...meta,
      sessionMd,
      imagesMd,
      buildMd,
      creativeBriefMd,
    }
  } catch (error) {
    console.error(`Failed to load session ${sessionId}:`, error)
    return null
  }
}

/**
 * List all sessions
 */
export async function listSessions(): Promise<SessionListItem[]> {
  const sessionsDir = getSessionsDir()

  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true })
    const sessions: SessionListItem[] = []

    for (const entry of entries) {
      // Skip non-directories and special folders
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'uploads') continue  // Legacy folder

      // Check if it has SESSION.md (is a valid session)
      const sessionMdPath = path.join(sessionsDir, entry.name, 'SESSION.md')
      try {
        const sessionMd = await readFile(sessionMdPath, 'utf-8')
        const folderStat = await stat(path.join(sessionsDir, entry.name))
        const meta = parseSessionMd(entry.name, sessionMd)

        // Look for a preview image (first vibe or hero)
        let previewImage: string | undefined
        const files = await readdir(path.join(sessionsDir, entry.name))
        const vibeFile = files.find(f => f.startsWith('vibe-') && f.endsWith('.html'))
        const heroFile = files.find(f => f.includes('hero') && (f.endsWith('.jpg') || f.endsWith('.png')))
        if (heroFile) {
          previewImage = `/${entry.name}/${heroFile}`
        }

        sessions.push({
          id: entry.name,
          businessName: meta.businessName,
          phase: meta.phase,
          lastUpdated: folderStat.mtime.toISOString(),
          previewImage,
        })
      } catch {
        // Not a valid session folder, skip
        continue
      }
    }

    // Sort by last updated, newest first
    sessions.sort((a, b) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    )

    return sessions
  } catch (error) {
    console.error('Failed to list sessions:', error)
    return []
  }
}

/**
 * Parse SESSION.md to extract metadata
 */
function parseSessionMd(sessionId: string, content: string): SessionMeta {
  // All field reads use the shared `matchField` helper (accepts both
  // bold-labeled `**Field:**` and plain `Field:`). See lib/markdown-fields.ts.
  const businessName = matchField(content, 'Business') || 'Unknown'
  const createdAt = matchField(content, 'Created') || new Date().toISOString()
  // Status is constrained to PHASE_X_NAME / COMPLETE — validate after match.
  const statusValue = matchField(content, 'Status') || ''
  const phaseFromStatus = statusValue.match(/^(PHASE_\d_\w+|COMPLETE)$/)
  const phase = (phaseFromStatus ? phaseFromStatus[1] : 'PHASE_1_DISCOVERY') as SessionPhase

  // Parse workflow checkboxes
  const workflowState: WorkflowState = {
    imagesUploaded: content.includes('[x] Images uploaded'),
    imagesAnalyzed: content.includes('[x] Images analyzed'),
    discoveryComplete: content.includes('[x] Discovery complete'),
    vibesDeveloped: 0,
    imagePromptsApproved: content.includes('[x] Image prompts approved'),
    ceoSelectionMade: content.includes('[x] CEO selection made'),
    finalBuildComplete: content.includes('[x] Final build complete'),
  }

  // Parse vibes count
  const vibesMatch = content.match(/Vibes developed \((\d)\/5\)/)
  if (vibesMatch) {
    workflowState.vibesDeveloped = parseInt(vibesMatch[1])
  }

  // Parse discovery summary if present
  let discoverySummary: DiscoverySummary | undefined
  const summarySection = content.match(/## Discovery Summary\n([\s\S]*?)(?=\n---|\n## |$)/)
  if (summarySection && !summarySection[1].includes('Not yet complete')) {
    const summaryText = summarySection[1]
    const oneSentence = matchField(summaryText, 'One-sentence')
    if (oneSentence) {
      discoverySummary = {
        oneSentence,
        customer: matchField(summaryText, 'Customer') || '',
        weirdDetail: matchField(summaryText, 'Weird detail') || '',
        enemy: matchField(summaryText, 'Enemy') || '',
      }
    }
  }

  return {
    id: sessionId,
    businessName,
    createdAt,
    phase,
    workflowState,
    discoverySummary,
  }
}

/**
 * Update SESSION.md with new content
 */
export async function updateSessionMd(sessionId: string, content: string): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  await writeFile(path.join(sessionPath, 'SESSION.md'), content)
}

/**
 * Update IMAGES.md with new content
 */
export async function updateImagesMd(sessionId: string, content: string): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  await writeFile(path.join(sessionPath, 'IMAGES.md'), content)
}

/**
 * Update BUILD.md with new content
 */
export async function updateBuildMd(sessionId: string, content: string): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  await writeFile(path.join(sessionPath, 'BUILD.md'), content)
}

/**
 * Update CREATIVE-BRIEF.md with new content
 */
export async function updateCreativeBriefMd(sessionId: string, content: string): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  await writeFile(path.join(sessionPath, 'CREATIVE-BRIEF.md'), content)
}

// ==========================================
// Creative Brief Population Types
// ==========================================

export interface BriefBusinessIdentity {
  oneSentence: string
  concept: string
  location?: string
  customer: string
  weirdDetail?: string
}

export interface BriefVoice {
  tone: string
  attitude: string
  enemy: string
  samples?: string[]
}

export interface BriefVisualDirection {
  colors: { name: string; hex: string }[]
  fonts: { heading: string; body: string }
  mood?: string
}

export interface BriefVibe {
  id: string
  name: string
  headline: string
  tagline: string
  colors: string[]
  typography: { heading: string; body: string }
  selected?: boolean
}

export interface BriefArchetype {
  atomicUnit: string
  specificUnitSelection: boolean
  concurrentBooking: boolean
  durationModel: 'rigid' | 'flexible'
  pricingModel: string
  closestArchetype: string
  adjustments?: string
}

export interface BriefWebDevInstructions {
  selectedVibeIds: string[]
  copyBlocks?: string[]
  voiceRequirements?: string
  bookingFlowNotes?: string
}

export interface CreativeBriefContent {
  businessName: string
  status: 'DRAFT' | 'DISCOVERY_COMPLETE' | 'VIBES_READY' | 'CEO_SELECTED' | 'ARCHETYPE_VERIFIED' | 'FINAL'
  identity?: BriefBusinessIdentity
  voice?: BriefVoice
  visual?: BriefVisualDirection
  vibes?: BriefVibe[]
  selectedVibeIds?: string[]
  archetype?: BriefArchetype
  webdevInstructions?: BriefWebDevInstructions
}

/**
 * Populate CREATIVE-BRIEF.md with structured content
 * Called at phase transitions to build up the brief incrementally
 */
export async function populateCreativeBrief(
  sessionId: string,
  content: CreativeBriefContent
): Promise<void> {
  const sessionPath = getSessionPath(sessionId)

  let md = `# Creative Brief: ${content.businessName}

**Status:** ${content.status}

---

## Business Identity
`

  if (content.identity) {
    md += `**One-sentence:** ${content.identity.oneSentence}
**Concept:** ${content.identity.concept}
${content.identity.location ? `**Location:** ${content.identity.location}` : ''}
**Customer:** ${content.identity.customer}
${content.identity.weirdDetail ? `**Weird detail:** ${content.identity.weirdDetail}` : ''}
`
  } else {
    md += `*To be completed after discovery*
`
  }

  md += `
---

## Voice & Tone
`

  if (content.voice) {
    md += `**Tone:** ${content.voice.tone}
**Attitude:** ${content.voice.attitude}
**Enemy:** ${content.voice.enemy}
`
    if (content.voice.samples && content.voice.samples.length > 0) {
      md += `
**Voice Samples:**
${content.voice.samples.map(s => `- "${s}"`).join('\n')}
`
    }
  } else {
    md += `*To be completed after discovery*
`
  }

  md += `
---

## Visual Direction
`

  if (content.visual) {
    md += `**Mood:** ${content.visual.mood || 'TBD'}

**Colors:**
${content.visual.colors.map(c => `- ${c.name}: \`${c.hex}\``).join('\n')}

**Typography:**
- Heading: ${content.visual.fonts.heading}
- Body: ${content.visual.fonts.body}
`
  } else {
    md += `*To be completed after discovery*
`
  }

  md += `
---

## The Five Vibes
`

  if (content.vibes && content.vibes.length > 0) {
    for (const vibe of content.vibes) {
      const selectedMark = content.selectedVibeIds?.includes(vibe.id) ? ' ✓ SELECTED' : ''
      md += `
### ${vibe.name}${selectedMark}
**Headline:** ${vibe.headline}
**Tagline:** ${vibe.tagline}
**Colors:** ${vibe.colors.join(', ')}
**Typography:** ${vibe.typography.heading} / ${vibe.typography.body}
`
    }
  } else {
    md += `*To be developed*
`
  }

  md += `
---

## Selected Vibe
`

  if (content.selectedVibeIds && content.selectedVibeIds.length > 0) {
    const selectedVibes = content.vibes?.filter(v => content.selectedVibeIds?.includes(v.id)) || []
    if (selectedVibes.length === 1) {
      md += `**Selected:** ${selectedVibes[0].name}
`
    } else if (selectedVibes.length > 1) {
      md += `**Mixed from:** ${selectedVibes.map(v => v.name).join(' + ')}
`
    }
  } else {
    md += `*CEO selection pending*
`
  }

  md += `
---

## Booking Archetype
`

  if (content.archetype) {
    md += `| Question | Answer |
|----------|--------|
| Atomic Unit | ${content.archetype.atomicUnit} |
| Specific Unit Selection | ${content.archetype.specificUnitSelection ? 'Yes' : 'No'} |
| Concurrent Booking | ${content.archetype.concurrentBooking ? 'Yes' : 'No'} |
| Duration Model | ${content.archetype.durationModel} |
| Pricing Model | ${content.archetype.pricingModel} |

**Closest Archetype:** ${content.archetype.closestArchetype}
${content.archetype.adjustments ? `**Adjustments:** ${content.archetype.adjustments}` : ''}
`
  } else {
    md += `*To be verified*
`
  }

  md += `
---

## WebDev Instructions
`

  if (content.webdevInstructions) {
    md += `**Selected Vibes:** ${content.webdevInstructions.selectedVibeIds.join(', ')}
${content.webdevInstructions.voiceRequirements ? `\n**Voice Requirements:** ${content.webdevInstructions.voiceRequirements}` : ''}
${content.webdevInstructions.bookingFlowNotes ? `\n**Booking Flow Notes:** ${content.webdevInstructions.bookingFlowNotes}` : ''}
`
    if (content.webdevInstructions.copyBlocks && content.webdevInstructions.copyBlocks.length > 0) {
      md += `
**Copy Blocks to Use:**
${content.webdevInstructions.copyBlocks.map(b => `- ${b}`).join('\n')}
`
    }
  } else {
    md += `*To be provided after vibe selection*
`
  }

  await writeFile(path.join(sessionPath, 'CREATIVE-BRIEF.md'), md)
}

/**
 * Read and parse the current CREATIVE-BRIEF.md
 * Returns null if brief doesn't exist or is skeleton only
 */
export async function readCreativeBrief(sessionId: string): Promise<CreativeBriefContent | null> {
  const sessionPath = getSessionPath(sessionId)

  try {
    const content = await readFile(path.join(sessionPath, 'CREATIVE-BRIEF.md'), 'utf-8')

    // Parse business name
    const nameMatch = content.match(/# Creative Brief: (.+)/)
    const businessName = nameMatch ? nameMatch[1].trim() : 'Unknown'

    // All field reads via shared helper — accepts both bold and plain.
    const status = (matchField(content, 'Status') || 'DRAFT') as CreativeBriefContent['status']

    // If it's still just the skeleton, return minimal content
    if (content.includes('*To be completed after discovery*') && !matchField(content, 'One-sentence')) {
      return { businessName, status }
    }

    // Parse identity section
    let identity: BriefBusinessIdentity | undefined
    const oneSentence = matchField(content, 'One-sentence')
    if (oneSentence) {
      identity = {
        oneSentence,
        concept: matchField(content, 'Concept') || '',
        location: matchField(content, 'Location') || undefined,
        customer: matchField(content, 'Customer') || '',
        weirdDetail: matchField(content, 'Weird detail') || undefined,
      }
    }

    // Parse voice section
    let voice: BriefVoice | undefined
    const tone = matchField(content, 'Tone')
    if (tone) {
      voice = {
        tone,
        attitude: matchField(content, 'Attitude') || '',
        enemy: matchField(content, 'Enemy') || '',
      }
    }

    // Parse selected vibes
    let selectedVibeIds: string[] | undefined
    const selectedMatch = matchField(content, 'Selected')
    const mixedMatch = matchField(content, 'Mixed from')
    if (selectedMatch || mixedMatch) {
      // We'd need the vibe IDs from context, for now just mark as having selection
      selectedVibeIds = []
    }

    return {
      businessName,
      status,
      identity,
      voice,
      selectedVibeIds,
    }
  } catch {
    return null
  }
}

/**
 * Format a log timestamp as `YYYY-MM-DD HH:MM:SS` (24-hour, local time).
 *
 * Sessions can span multiple days (especially with Lumberjack compaction
 * resumes), so logs need date context — seeing just `14:32:05` and not knowing
 * whether it's today or three days ago is useless for forensics.
 *
 * Exported so sibling loggers (IMAGES.md, BUILD.md) can share one format
 * when/if we align them.
 */
export function formatLogTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${date} ${time}`
}

/**
 * Append a conversation entry to SESSION.md
 */
export async function appendToSessionLog(
  sessionId: string,
  agent: string,
  content: string
): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  const sessionMdPath = path.join(sessionPath, 'SESSION.md')

  const existingContent = await readFile(sessionMdPath, 'utf-8')
  const timestamp = formatLogTimestamp()

  const entry = `
---
#### ${agent} | ${timestamp}

${content}
`

  await writeFile(sessionMdPath, existingContent + entry)
}

/**
 * Update workflow state in SESSION.md
 */
export async function updateWorkflowState(
  sessionId: string,
  updates: Partial<WorkflowState>
): Promise<void> {
  const session = await getSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  let content = session.sessionMd

  // Update checkboxes
  if (updates.imagesUploaded !== undefined) {
    content = content.replace(
      /\[(x| )\] Images uploaded/,
      `[${updates.imagesUploaded ? 'x' : ' '}] Images uploaded`
    )
  }
  if (updates.imagesAnalyzed !== undefined) {
    content = content.replace(
      /\[(x| )\] Images analyzed/,
      `[${updates.imagesAnalyzed ? 'x' : ' '}] Images analyzed`
    )
  }
  if (updates.discoveryComplete !== undefined) {
    content = content.replace(
      /\[(x| )\] Discovery complete/,
      `[${updates.discoveryComplete ? 'x' : ' '}] Discovery complete`
    )
  }
  if (updates.vibesDeveloped !== undefined) {
    content = content.replace(
      /\[(x| )\] Vibes developed \(\d\/5\)/,
      `[${updates.vibesDeveloped >= 5 ? 'x' : ' '}] Vibes developed (${updates.vibesDeveloped}/5)`
    )
  }
  if (updates.imagePromptsApproved !== undefined) {
    content = content.replace(
      /\[(x| )\] Image prompts approved/,
      `[${updates.imagePromptsApproved ? 'x' : ' '}] Image prompts approved`
    )
  }
  if (updates.ceoSelectionMade !== undefined) {
    content = content.replace(
      /\[(x| )\] CEO selection made/,
      `[${updates.ceoSelectionMade ? 'x' : ' '}] CEO selection made`
    )
  }
  if (updates.finalBuildComplete !== undefined) {
    content = content.replace(
      /\[(x| )\] Final build complete/,
      `[${updates.finalBuildComplete ? 'x' : ' '}] Final build complete`
    )
  }

  await updateSessionMd(sessionId, content)
}

/**
 * Update session phase in SESSION.md
 */
export async function updateSessionPhase(
  sessionId: string,
  phase: SessionPhase
): Promise<void> {
  const session = await getSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  // Replace status — accepts both bold-labeled and plain. The pattern
  // captures the prefix (whatever shape it has — `**Status:** `, `Status: `,
  // `**Status**: `) and re-emits it with the new value, preserving
  // whichever format the file already used so we don't churn formatting.
  const content = session.sessionMd.replace(
    /((?:\*+\s*)?Status(?:\s*\*+)?:(?:\s*\*+)?\s*)(PHASE_\d_\w+|COMPLETE)/,
    (_full, prefix) => `${prefix}${phase}`,
  )

  await updateSessionMd(sessionId, content)

  // Same pattern for BUILD.md's `Current Phase` field
  const buildContent = session.buildMd.replace(
    /((?:\*+\s*)?Current Phase(?:\s*\*+)?:(?:\s*\*+)?\s*)(PHASE_\d_\w+|COMPLETE)/,
    (_full, prefix) => `${prefix}${phase}`,
  )
  await updateBuildMd(sessionId, buildContent)
}

/**
 * Save an uploaded image to session folder
 */
export async function saveUploadedImage(
  sessionId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const sessionPath = getSessionPath(sessionId)

  // Sanitize filename
  let safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '-')

  // Check for collision and add number if needed
  const files = await readdir(sessionPath)
  let finalFilename = safeFilename
  let counter = 2
  while (files.includes(finalFilename)) {
    const ext = path.extname(safeFilename)
    const base = path.basename(safeFilename, ext)
    finalFilename = `${base}-${counter}${ext}`
    counter++
  }

  await writeFile(path.join(sessionPath, finalFilename), buffer)

  return finalFilename
}

/**
 * Save a generated image to session folder
 * Naming: {vibe}-{purpose}-v{version}.{ext}
 */
export async function saveGeneratedImage(
  sessionId: string,
  vibe: string,
  purpose: string,
  base64Data: string
): Promise<{ filename: string; version: number }> {
  const sessionPath = getSessionPath(sessionId)

  // Determine extension from base64 header
  const mimeMatch = base64Data.match(/^data:image\/(\w+);base64,/)
  const ext = mimeMatch ? mimeMatch[1] : 'png'

  // Find next version number
  const files = await readdir(sessionPath)
  const prefix = `${vibe}-${purpose}-v`
  const existingVersions = files
    .filter(f => f.startsWith(prefix) && f.match(/v(\d+)\./))
    .map(f => {
      const match = f.match(/v(\d+)\./)
      return match ? parseInt(match[1]) : 0
    })

  const version = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1
  const filename = `${vibe}-${purpose}-v${version}.${ext}`

  // Remove base64 header and save
  const rawData = base64Data.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(rawData, 'base64')
  await writeFile(path.join(sessionPath, filename), buffer)

  return { filename, version }
}

/**
 * Save a manipulated image to session folder
 * Naming: {source}-{operation}.{ext}
 */
export async function saveManipulatedImage(
  sessionId: string,
  sourceFilename: string,
  operation: string,
  base64Data: string
): Promise<string> {
  const sessionPath = getSessionPath(sessionId)

  // Get source base name
  const sourceBase = path.basename(sourceFilename, path.extname(sourceFilename))

  // Determine extension from base64 header
  const mimeMatch = base64Data.match(/^data:image\/(\w+);base64,/)
  const ext = mimeMatch ? mimeMatch[1] : 'png'

  const filename = `${sourceBase}-${operation}.${ext}`

  // Remove base64 header and save
  const rawData = base64Data.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(rawData, 'base64')
  await writeFile(path.join(sessionPath, filename), buffer)

  return filename
}

/**
 * Save a vibe HTML file to session folder
 * Naming: vibe-{n}-{name}-{page}.html
 */
export async function saveVibeHtml(
  sessionId: string,
  vibeNumber: number,
  vibeName: string,
  pageType: 'landing' | 'booking',
  html: string
): Promise<string> {
  const sessionPath = getSessionPath(sessionId)

  // Sanitize vibe name for filename
  const safeName = vibeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const filename = `vibe-${vibeNumber}-${safeName}-${pageType}.html`
  const target = path.join(sessionPath, filename)

  // Phase 2 (2026-04-30): snapshot the previous build to `.cache/last-build/`
  // BEFORE overwriting. The `vibe_diff` tool reads this snapshot to compute
  // "what changed since last build". First build has no snapshot — the diff
  // tool returns empty + a note in that case.
  try {
    const fs = require('fs')
    const fsp = require('fs/promises')
    if (fs.existsSync(target)) {
      const cacheDir = path.join(sessionPath, '.cache', 'last-build')
      if (!fs.existsSync(cacheDir)) await fsp.mkdir(cacheDir, { recursive: true })
      await fsp.copyFile(target, path.join(cacheDir, filename))
    }
  } catch {
    // Snapshot is best-effort — never block the build for a snapshot failure.
  }

  await writeFile(target, html)

  return filename
}

/**
 * Save final output HTML
 * Naming: final-{page}.html
 */
export async function saveFinalHtml(
  sessionId: string,
  pageType: 'landing' | 'booking',
  html: string
): Promise<string> {
  const sessionPath = getSessionPath(sessionId)
  const filename = `final-${pageType}.html`
  await writeFile(path.join(sessionPath, filename), html)
  return filename
}

/**
 * List all files in a session folder
 */
export async function listSessionFiles(sessionId: string): Promise<string[]> {
  const sessionPath = getSessionPath(sessionId)
  return readdir(sessionPath)
}

/**
 * Read a file from session folder
 */
export async function readSessionFile(
  sessionId: string,
  filename: string
): Promise<string> {
  const sessionPath = getSessionPath(sessionId)
  return readFile(path.join(sessionPath, filename), 'utf-8')
}

/**
 * Delete a session and all its files
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  const files = await readdir(sessionPath)

  // Delete all files
  for (const file of files) {
    await unlink(path.join(sessionPath, file))
  }

  // Remove folder
  const { rmdir } = await import('fs/promises')
  await rmdir(sessionPath)
}

/**
 * Parsed image entry from IMAGES.md
 */
export interface ParsedImageEntry {
  filename: string
  uploadedAt?: string
  cdAnalysis?: string
  suggestedUses?: string[]
  suggestedVibes?: string[]
  reprompt?: string
  status?: string  // Raw status from IMAGES.md (e.g., "HERO", "USED", "B-ROLL", "TRASH")
  tag?: 'HERO' | 'USED' | 'B-ROLL' | 'TRASH' | 'READY' | 'INGESTED' | 'APPROVED' | 'REDO'  // Parsed tag for display
  /** Vibe HTML files this image is referenced in. Populated by
   *  parseImagesMd via scanVibeHtmlsForUsedImages. Independent of `tag`
   *  so a HERO image can also be USED — both badges render. */
  usedIn?: string[]
}

/**
 * Scan all vibe-*.html files in a session and build a map of
 * imageFilename -> list of vibe HTML files that reference it.
 *
 * Detects both `<img src="foo.jpg">` and CSS `url('foo.jpg')` references.
 * This is the SOURCE OF TRUTH for "is this image USED" — the HTML files
 * are the contract, IMAGES.md tags are semantic only.
 */
export async function scanVibeHtmlsForUsedImages(sessionId: string): Promise<Map<string, string[]>> {
  const sessionPath = getSessionPath(sessionId)
  const usedIn = new Map<string, string[]>()

  try {
    const files = await readdir(sessionPath)
    const vibeHtmls = files.filter(f => /^vibe-.*\.html$/i.test(f))

    // Match `src="foo.jpg"` (or src='foo.jpg') and `url(foo.jpg)` / `url('foo.jpg')` / `url("foo.jpg")`
    // Capture group 1 covers src=, group 2 covers url(); we coalesce.
    const refPattern = /(?:src\s*=\s*["']([^"']+\.(?:jpg|jpeg|png|webp|avif|gif))["'])|(?:url\s*\(\s*['"]?([^'")]+\.(?:jpg|jpeg|png|webp|avif|gif))['"]?\s*\))/gi

    for (const vibeFile of vibeHtmls) {
      let html: string
      try {
        html = await readFile(path.join(sessionPath, vibeFile), 'utf-8')
      } catch {
        continue
      }

      const seen = new Set<string>()
      let match: RegExpExecArray | null
      refPattern.lastIndex = 0
      while ((match = refPattern.exec(html)) !== null) {
        const raw = (match[1] || match[2] || '').trim()
        if (!raw) continue
        // Reduce to bare filename (strip any leading path / query / hash)
        const filename = raw.split(/[?#]/)[0].split('/').pop() || raw
        if (!filename || seen.has(filename)) continue
        seen.add(filename)
        const list = usedIn.get(filename) || []
        if (!list.includes(vibeFile)) list.push(vibeFile)
        usedIn.set(filename, list)
      }
    }
  } catch (err) {
    console.error(`[scanVibeHtmlsForUsedImages] Failed for session ${sessionId}:`, err)
  }

  return usedIn
}

/**
 * Scan vibe HTMLs for images referenced inside `<section class="hero">…</section>`.
 *
 * Returns a Map<filename, vibeFile[]> for every image whose filename appears
 * via `<img src=...>` or CSS `url(...)` inside any vibe's hero section.
 *
 * (Ralph 2026-04-25: HERO assignment is mechanical, not a CD judgment.
 * Hero membership = "appears in the hero section of any vibe HTML.")
 */
export async function scanVibeHtmlsForHeroImages(sessionId: string): Promise<Map<string, string[]>> {
  const sessionPath = getSessionPath(sessionId)
  const heroIn = new Map<string, string[]>()

  try {
    const files = await readdir(sessionPath)
    const vibeHtmls = files.filter(f => /^vibe-.*\.html$/i.test(f))

    // Match `<section ... class="...hero..." ...>` open tag through `</section>`.
    // Tolerant to other classes alongside "hero" and to attribute order.
    // [\s\S]*? = any char including newlines, non-greedy so we stop at the
    // first matching </section>.
    const heroSectionPattern =
      /<section\b[^>]*\bclass\s*=\s*["'][^"']*\bhero\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi
    const refPattern = /(?:src\s*=\s*["']([^"']+\.(?:jpg|jpeg|png|webp|avif|gif))["'])|(?:url\s*\(\s*['"]?([^'")]+\.(?:jpg|jpeg|png|webp|avif|gif))['"]?\s*\))/gi

    for (const vibeFile of vibeHtmls) {
      let html: string
      try {
        html = await readFile(path.join(sessionPath, vibeFile), 'utf-8')
      } catch {
        continue
      }

      heroSectionPattern.lastIndex = 0
      let sectionMatch: RegExpExecArray | null
      while ((sectionMatch = heroSectionPattern.exec(html)) !== null) {
        const sectionBody = sectionMatch[1] || ''
        const seen = new Set<string>()
        refPattern.lastIndex = 0
        let refMatch: RegExpExecArray | null
        while ((refMatch = refPattern.exec(sectionBody)) !== null) {
          const raw = (refMatch[1] || refMatch[2] || '').trim()
          if (!raw) continue
          const filename = raw.split(/[?#]/)[0].split('/').pop() || raw
          if (!filename || seen.has(filename)) continue
          seen.add(filename)
          const list = heroIn.get(filename) || []
          if (!list.includes(vibeFile)) list.push(vibeFile)
          heroIn.set(filename, list)
        }
      }

      // Also catch CSS-driven heroes: a `.hero-bg` / `.hero-image` rule with
      // `background-image: url(...)`. These don't sit inside the section tag
      // so the section regex misses them.
      const heroBgPattern =
        /\.hero(?:[-_]bg|[-_]image|[-_]background)?\b[^{]*\{[^}]*background(?:-image)?\s*:\s*[^;}]*url\(\s*['"]?([^'")]+\.(?:jpg|jpeg|png|webp|avif|gif))['"]?\s*\)/gi
      heroBgPattern.lastIndex = 0
      let bgMatch: RegExpExecArray | null
      while ((bgMatch = heroBgPattern.exec(html)) !== null) {
        const raw = (bgMatch[1] || '').trim()
        if (!raw) continue
        const filename = raw.split(/[?#]/)[0].split('/').pop() || raw
        if (!filename) continue
        const list = heroIn.get(filename) || []
        if (!list.includes(vibeFile)) list.push(vibeFile)
        heroIn.set(filename, list)
      }
    }
  } catch (err) {
    console.error(`[scanVibeHtmlsForHeroImages] Failed for session ${sessionId}:`, err)
  }

  return heroIn
}

/**
 * Reconcile USED + HERO tags in IMAGES.md against the actual vibe HTMLs.
 * SOURCE OF TRUTH = the vibe HTML files. IMAGES.md is the persisted shadow.
 *
 * Rules:
 *   - HERO promotion (Ralph 2026-04-25): an image referenced inside any
 *     vibe's `<section class="hero">` (or in a `.hero-bg` / `.hero-image`
 *     CSS rule) gets `Status: HERO`. Mechanical, not a judgment.
 *   - TRASH is sacred. TRASH images stay TRASH (the user banned them deliberately).
 *   - For everything else:
 *       referenced in HTML  → set Status: USED
 *       NOT referenced      → set Status: B-ROLL
 *   - HERO supersedes USED in the persisted tag (single Status field), but
 *     the visual coexistence is handled at render time via `usedIn`.
 *
 * Returns a summary of changes made.
 */
export async function reconcileUsedTags(sessionId: string): Promise<{ promoted: string[]; demoted: string[]; heroPromoted: string[]; unchanged: number }> {
  const sessionPath = getSessionPath(sessionId)
  const usedMap = await scanVibeHtmlsForUsedImages(sessionId)
  const usedSet = new Set(usedMap.keys())
  const heroMap = await scanVibeHtmlsForHeroImages(sessionId)
  const heroSet = new Set(heroMap.keys())

  const imagesPath = path.join(sessionPath, 'IMAGES.md')
  let content: string
  try {
    content = await readFile(imagesPath, 'utf-8')
  } catch {
    return { promoted: [], demoted: [], heroPromoted: [], unchanged: 0 }
  }

  const promoted: string[] = []  // moved → USED
  const demoted: string[] = []   // moved → B-ROLL
  const heroPromoted: string[] = []  // moved → HERO
  let unchanged = 0

  // Walk the file line-by-line, tracking the most recent #### filename block.
  const lines = content.split('\n')
  const out: string[] = []
  let currentFilename: string | null = null

  for (const line of lines) {
    // #### filename.jpg (or .jpeg/.png/etc) under "Image Prompts + Generated"
    const fnMatch = /^#### (\S+\.(?:jpg|jpeg|png|webp|avif|gif))\s*$/i.exec(line)
    if (fnMatch) {
      currentFilename = fnMatch[1]
      out.push(line)
      continue
    }

    // Status line within the current block — rewrite if needed.
    // Pattern accepts both `**Status:** value` and `Status: value`.
    if (currentFilename) {
      const statusMatch = /^(?:\*+\s*)?Status(?:\s*\*+)?:(?:\s*\*+)?\s*(.+?)\s*$/i.exec(line)
      if (statusMatch) {
        const oldStatus = statusMatch[1]
        const oldTag = parseTagFromStatus(oldStatus)
        const isReferenced = usedSet.has(currentFilename)
        const isHero = heroSet.has(currentFilename)

        let newTag: string | null = null
        // TRASH is sacred — banned by the user, never auto-overwrite.
        // PENDING is sacred — a prompt slot with no generated image yet.
        // HERO is NO LONGER sacred (Ralph 2026-04-25): it's mechanical, so
        // a stale HERO tag on an image that's no longer in any hero section
        // gets corrected by the same pass that promotes new heroes.
        if (oldTag === 'TRASH' || oldTag === 'PENDING' as never) {
          newTag = null
        } else if (oldStatus.toUpperCase() === 'PENDING') {
          newTag = null
        } else if (isHero && oldTag !== 'HERO') {
          newTag = 'HERO'
          heroPromoted.push(currentFilename)
        } else if (!isHero && oldTag === 'HERO') {
          // Hero demoted out of hero section — fall through to USED/B-ROLL
          // depending on whether it's still referenced anywhere.
          if (isReferenced) {
            newTag = 'USED'
            promoted.push(currentFilename)
          } else {
            newTag = 'B-ROLL'
            demoted.push(currentFilename)
          }
        } else if (isReferenced && oldTag !== 'USED' && oldTag !== 'HERO') {
          newTag = 'USED'
          promoted.push(currentFilename)
        } else if (!isReferenced && oldTag === 'USED') {
          newTag = 'B-ROLL'
          demoted.push(currentFilename)
        }

        if (newTag) {
          out.push(`**Status:** ${newTag}`)
        } else {
          out.push(line)
          unchanged++
        }
        currentFilename = null  // only rewrite the first Status under each #### block
        continue
      }
    }

    out.push(line)
  }

  // Self-healing: any image referenced in HTML but with no #### block in IMAGES.md
  // gets a stub block appended. Stub Status is USED (it's referenced — that's the contract).
  const haveBlock = new Set<string>()
  const blockRegex = /^#### (\S+\.(?:jpg|jpeg|png|webp|avif|gif))\s*$/gim
  let m: RegExpExecArray | null
  const finalContent = out.join('\n')
  while ((m = blockRegex.exec(finalContent)) !== null) haveBlock.add(m[1])

  const orphans = [...usedSet].filter(fn => !haveBlock.has(fn))
  let appended = ''
  if (orphans.length > 0) {
    // Insert stub blocks just before the "## Manipulations" section, falling back to end of file.
    const manipIdx = out.findIndex(line => line.trim() === '## Manipulations')
    const stubs = orphans.map(fn => {
      // If the orphan is in a hero section, stub with HERO; else USED.
      const stubStatus = heroSet.has(fn) ? 'HERO' : 'USED'
      return `#### ${fn}\n**Generated:** ${new Date().toISOString().slice(0, 10)}\n**Status:** ${stubStatus}\n**Nano Banana:** (auto-stub created by reconcileUsedTags — image is referenced in a vibe HTML but had no entry. Update with real description if known.)\n\n`
    }).join('')
    if (manipIdx > 0) {
      out.splice(manipIdx, 0, stubs.trimEnd())
    } else {
      out.push(stubs.trimEnd())
    }
    appended = orphans.join(', ')
  }

  // Only rewrite if anything changed
  if (promoted.length || demoted.length || heroPromoted.length || orphans.length) {
    await writeFile(imagesPath, out.join('\n'), 'utf-8')
    console.log(`[reconcileUsedTags] session=${sessionId} hero=+${heroPromoted.length} promoted=+${promoted.length} demoted=-${demoted.length} stubsAdded=${orphans.length}${orphans.length ? ' [' + appended + ']' : ''}`)
  }

  return { promoted, demoted, heroPromoted, unchanged }
}

// Helper to extract tag from status string
// Order matters: check more specific tags before less specific ones (e.g. HERO before B-ROLL).
function parseTagFromStatus(status: string): 'HERO' | 'USED' | 'B-ROLL' | 'TRASH' | 'READY' | 'INGESTED' | 'APPROVED' | 'REDO' | undefined {
  const upper = status.toUpperCase()
  if (upper.includes('HERO')) return 'HERO'
  if (upper.includes('TRASH')) return 'TRASH'
  if (upper.includes('B-ROLL')) return 'B-ROLL'
  if (upper.includes('USED')) return 'USED'
  if (upper.includes('READY')) return 'READY'
  if (upper.includes('INGESTED')) return 'INGESTED'
  if (upper.includes('APPROVED')) return 'APPROVED'
  if (upper.includes('REDO')) return 'REDO'
  // Bug 8 fix (Ralph 2026-04-30): legacy status "ACTIVE" was written by a
  // deprecated ingestion step and lived outside the documented vocabulary.
  // Normalize to USED so v2-aware code paths never surface it. The raw
  // status string remains in entry.status for forensics; entry.tag (this
  // function's return) is what summaries should prefer.
  if (upper.includes('ACTIVE')) return 'USED'
  return undefined
}

/**
 * Parse IMAGES.md to extract image data including reprompts
 * Returns a map of filename -> ParsedImageEntry
 */
export async function parseImagesMd(sessionId: string): Promise<Map<string, ParsedImageEntry>> {
  const sessionPath = getSessionPath(sessionId)
  const result = new Map<string, ParsedImageEntry>()

  // Run the vibe HTML scanner once and attach `usedIn` to every entry below.
  // Independent of the `tag` parsed from IMAGES.md so HERO images can also
  // surface USED in the AssetsPanel (HERO badge top-left + USED pill bottom-right).
  let usedInMap: Map<string, string[]> = new Map()
  try {
    usedInMap = await scanVibeHtmlsForUsedImages(sessionId)
  } catch (err) {
    console.warn(`[parseImagesMd] usedIn scan failed for ${sessionId}:`, err)
  }

  try {
    const content = await readFile(path.join(sessionPath, 'IMAGES.md'), 'utf-8')

    // Find the "## Uploaded Images" section
    // Note: entries may have --- separators between them, so we match until a new ## section or end
    const uploadedSection = content.match(/## Uploaded Images\s*\n([\s\S]*?)(?=\n## [^#]|$)/)
    if (!uploadedSection) return result

    const section = uploadedSection[1]

    // Split by ### headers to get individual image entries
    const entries = section.split(/(?=^### )/m).filter(e => e.trim().startsWith('### '))

    for (const entry of entries) {
      // Parse filename from header: ### hero.jpg
      const filenameMatch = entry.match(/^### (.+)$/m)
      if (!filenameMatch) continue
      const filename = filenameMatch[1].trim()

      // Parse Uploaded timestamp
      // All field extraction via shared helper — accepts both bold-labeled
      // and plain formats. See lib/markdown-fields.ts.
      const uploadedAt = matchField(entry, 'Uploaded') || undefined
      const cdAnalysis = matchFieldMultiline(entry, 'CD Analysis') || undefined

      const usesValue = matchField(entry, 'Suggested uses')
      const suggestedUses = usesValue
        ? usesValue.split(',').map(s => s.trim()).filter(Boolean)
        : undefined

      const vibesValue = matchField(entry, 'Suggested vibes')
      const suggestedVibes = vibesValue
        ? vibesValue.split(',').map(s => s.trim()).filter(Boolean)
        : undefined

      const reprompt = matchFieldMultiline(entry, 'Reprompt') || undefined
      const status = matchField(entry, 'Status') || undefined
      const tag = status ? parseTagFromStatus(status) : undefined

      result.set(filename, {
        filename,
        uploadedAt,
        cdAnalysis,
        suggestedUses,
        suggestedVibes,
        reprompt,
        status,
        tag,
        usedIn: usedInMap.get(filename),
      })
    }

    // Also parse generated images from "## Image Prompts + Generated" section
    // These are #### level entries with their own Status fields
    const generatedSection = content.match(/## Image Prompts \+ Generated\s*\n([\s\S]*?)(?=\n## [^#]|$)/)
    if (generatedSection) {
      const genSection = generatedSection[1]

      // Find all #### entries (generated images)
      const genEntries = genSection.split(/(?=^#### )/m).filter(e => e.trim().startsWith('#### '))

      for (const entry of genEntries) {
        // Parse filename from header: #### shared-hero-action-shot-v1.jpg
        const filenameMatch = entry.match(/^#### (.+)$/m)
        if (!filenameMatch) continue
        const filename = filenameMatch[1].trim()

        // All via shared helper. CD Analysis / Evaluation: try both names.
        const uploadedAt = matchField(entry, 'Generated') || undefined
        const status = matchField(entry, 'Status') || undefined
        const tag = status ? parseTagFromStatus(status) : undefined
        const cdAnalysis =
          matchFieldMultiline(entry, 'CD Analysis')
          || matchFieldMultiline(entry, 'Evaluation')
          || undefined

        result.set(filename, {
          filename,
          uploadedAt,
          cdAnalysis,
          status,
          tag,
          usedIn: usedInMap.get(filename),
        })
      }
    }

  } catch (error) {
    console.error(`Failed to parse IMAGES.md for session ${sessionId}:`, error)
  }

  return result
}
