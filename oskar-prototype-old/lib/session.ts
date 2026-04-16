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

## Conversation Log

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

| Time | Vibe | Slot | Old | New |
|------|------|------|-----|-----|

---

## Brief Update Log

| Time | Change | Affected Vibes | Action |
|------|--------|----------------|--------|

---

## Checkpoint History

| Time | Operation | Files | Status |
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

  await Promise.all([
    writeFile(path.join(sessionPath, 'SESSION.md'), sessionMd),
    writeFile(path.join(sessionPath, 'IMAGES.md'), imagesMd),
    writeFile(path.join(sessionPath, 'BUILD.md'), buildMd),
    writeFile(path.join(sessionPath, 'CREATIVE-BRIEF.md'), creativeBriefMd),
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
    sessionMd = sessionMd.replace(/\*\*Business:\*\* .+/, `**Business:** ${businessName}`)
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
  // Extract business name
  const businessMatch = content.match(/\*\*Business:\*\*\s*(.+)/)
  const businessName = businessMatch ? businessMatch[1].trim() : 'Unknown'

  // Extract created date
  const createdMatch = content.match(/\*\*Created:\*\*\s*(.+)/)
  const createdAt = createdMatch ? createdMatch[1].trim() : new Date().toISOString()

  // Extract phase
  const phaseMatch = content.match(/\*\*Status:\*\*\s*(PHASE_\d_\w+|COMPLETE)/)
  const phase = (phaseMatch ? phaseMatch[1] : 'PHASE_1_DISCOVERY') as SessionPhase

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
    const oneSentenceMatch = summaryText.match(/\*\*One-sentence:\*\*\s*(.+)/)
    const customerMatch = summaryText.match(/\*\*Customer:\*\*\s*(.+)/)
    const weirdMatch = summaryText.match(/\*\*Weird detail:\*\*\s*(.+)/)
    const enemyMatch = summaryText.match(/\*\*Enemy:\*\*\s*(.+)/)

    if (oneSentenceMatch) {
      discoverySummary = {
        oneSentence: oneSentenceMatch[1].trim(),
        customer: customerMatch ? customerMatch[1].trim() : '',
        weirdDetail: weirdMatch ? weirdMatch[1].trim() : '',
        enemy: enemyMatch ? enemyMatch[1].trim() : '',
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

    // Parse status
    const statusMatch = content.match(/\*\*Status:\*\*\s*(\w+)/)
    const status = (statusMatch ? statusMatch[1] : 'DRAFT') as CreativeBriefContent['status']

    // If it's still just the skeleton, return minimal content
    if (content.includes('*To be completed after discovery*') && !content.includes('**One-sentence:**')) {
      return { businessName, status }
    }

    // Parse identity section
    let identity: BriefBusinessIdentity | undefined
    const oneSentenceMatch = content.match(/\*\*One-sentence:\*\*\s*(.+)/)
    if (oneSentenceMatch) {
      const conceptMatch = content.match(/\*\*Concept:\*\*\s*(.+)/)
      const locationMatch = content.match(/\*\*Location:\*\*\s*(.+)/)
      const customerMatch = content.match(/\*\*Customer:\*\*\s*(.+)/)
      const weirdMatch = content.match(/\*\*Weird detail:\*\*\s*(.+)/)

      identity = {
        oneSentence: oneSentenceMatch[1].trim(),
        concept: conceptMatch ? conceptMatch[1].trim() : '',
        location: locationMatch ? locationMatch[1].trim() : undefined,
        customer: customerMatch ? customerMatch[1].trim() : '',
        weirdDetail: weirdMatch ? weirdMatch[1].trim() : undefined,
      }
    }

    // Parse voice section
    let voice: BriefVoice | undefined
    const toneMatch = content.match(/\*\*Tone:\*\*\s*(.+)/)
    if (toneMatch) {
      const attitudeMatch = content.match(/\*\*Attitude:\*\*\s*(.+)/)
      const enemyMatch = content.match(/\*\*Enemy:\*\*\s*(.+)/)

      voice = {
        tone: toneMatch[1].trim(),
        attitude: attitudeMatch ? attitudeMatch[1].trim() : '',
        enemy: enemyMatch ? enemyMatch[1].trim() : '',
      }
    }

    // Parse selected vibes
    let selectedVibeIds: string[] | undefined
    const selectedMatch = content.match(/\*\*Selected:\*\*\s*(.+)/)
    const mixedMatch = content.match(/\*\*Mixed from:\*\*\s*(.+)/)
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
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

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

  const content = session.sessionMd.replace(
    /\*\*Status:\*\*\s*(PHASE_\d_\w+|COMPLETE)/,
    `**Status:** ${phase}`
  )

  await updateSessionMd(sessionId, content)

  // Also update BUILD.md phase
  const buildContent = session.buildMd.replace(
    /\*\*Current Phase:\*\*\s*(PHASE_\d_\w+|COMPLETE)/,
    `**Current Phase:** ${phase}`
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
  await writeFile(path.join(sessionPath, filename), html)

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
  status?: string  // Raw status from IMAGES.md (e.g., "✓ HERO", "B-ROLL", "✗ TRASH", "INGESTED")
  tag?: 'HERO' | 'B-ROLL' | 'TRASH' | 'READY' | 'INGESTED' | 'APPROVED' | 'REDO'  // Parsed tag for display
}

// Helper to extract tag from status string
function parseTagFromStatus(status: string): 'HERO' | 'B-ROLL' | 'TRASH' | 'READY' | 'INGESTED' | 'APPROVED' | 'REDO' | undefined {
  const upper = status.toUpperCase()
  if (upper.includes('HERO')) return 'HERO'
  if (upper.includes('TRASH')) return 'TRASH'
  if (upper.includes('B-ROLL')) return 'B-ROLL'
  if (upper.includes('READY')) return 'READY'
  if (upper.includes('INGESTED')) return 'INGESTED'
  if (upper.includes('APPROVED')) return 'APPROVED'
  if (upper.includes('REDO')) return 'REDO'
  return undefined
}

/**
 * Parse IMAGES.md to extract image data including reprompts
 * Returns a map of filename -> ParsedImageEntry
 */
export async function parseImagesMd(sessionId: string): Promise<Map<string, ParsedImageEntry>> {
  const sessionPath = getSessionPath(sessionId)
  const result = new Map<string, ParsedImageEntry>()

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
      const uploadedMatch = entry.match(/\*\*Uploaded:\*\*\s*(.+)/)
      const uploadedAt = uploadedMatch ? uploadedMatch[1].trim() : undefined

      // Parse CD Analysis (use [\s\S] instead of /s flag for ES2017 compatibility)
      const analysisMatch = entry.match(/\*\*CD Analysis:\*\*\s*([\s\S]+?)(?=\n\*\*|$)/)
      const cdAnalysis = analysisMatch ? analysisMatch[1].trim() : undefined

      // Parse Suggested uses
      const usesMatch = entry.match(/\*\*Suggested uses:\*\*\s*(.+)/)
      const suggestedUses = usesMatch
        ? usesMatch[1].split(',').map(s => s.trim()).filter(Boolean)
        : undefined

      // Parse Suggested vibes
      const vibesMatch = entry.match(/\*\*Suggested vibes:\*\*\s*(.+)/)
      const suggestedVibes = vibesMatch
        ? vibesMatch[1].split(',').map(s => s.trim()).filter(Boolean)
        : undefined

      // Parse Reprompt (use [\s\S] instead of /s flag for ES2017 compatibility)
      const repromptMatch = entry.match(/\*\*Reprompt:\*\*\s*([\s\S]+?)(?=\n\*\*|\n###|$)/)
      const reprompt = repromptMatch ? repromptMatch[1].trim() : undefined

      // Parse Status
      const statusMatch = entry.match(/\*\*Status:\*\*\s*(.+)/)
      const status = statusMatch ? statusMatch[1].trim() : undefined
      const tag = status ? parseTagFromStatus(status) : undefined

      result.set(filename, {
        filename,
        uploadedAt,
        cdAnalysis,
        suggestedUses,
        suggestedVibes,
        reprompt,
        status,
        tag
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

        // Parse Generated timestamp
        const generatedMatch = entry.match(/\*\*Generated:\*\*\s*(.+)/)
        const uploadedAt = generatedMatch ? generatedMatch[1].trim() : undefined

        // Parse Status
        const statusMatch = entry.match(/\*\*Status:\*\*\s*(.+)/)
        const status = statusMatch ? statusMatch[1].trim() : undefined
        const tag = status ? parseTagFromStatus(status) : undefined

        // Parse CD Analysis or Evaluation
        const analysisMatch = entry.match(/\*\*(?:CD Analysis|Evaluation):\*\*\s*([\s\S]+?)(?=\n\*\*|\n####|$)/)
        const cdAnalysis = analysisMatch ? analysisMatch[1].trim() : undefined

        result.set(filename, {
          filename,
          uploadedAt,
          cdAnalysis,
          status,
          tag
        })
      }
    }
  } catch (error) {
    console.error(`Failed to parse IMAGES.md for session ${sessionId}:`, error)
  }

  return result
}
