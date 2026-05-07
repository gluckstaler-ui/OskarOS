import { readFileSync } from 'fs'
import path from 'path'

/**
 * Load the Creative Director agent prompt from the MD file.
 * File location: /OskarOS/oskar-prototype/agents/creative-director-agent.md
 */
function loadCDAgentPrompt(): string {
  try {
    const mdPath = path.join(process.cwd(), 'agents', 'creative-director-agent.md')
    return readFileSync(mdPath, 'utf-8')
  } catch (error) {
    console.error('Failed to load creative-director-agent.md:', error)
    console.error('Expected location:', path.join(process.cwd(), 'agents', 'creative-director-agent.md'))
    throw new Error('Creative Director agent prompt not found')
  }
}

/**
 * Session files for resume context
 */
export interface SessionFiles {
  sessionMd?: string
  creativeBriefMd?: string
  imagesMd?: string
  htmlFiles?: string[]  // List of existing HTML filenames
  // Memory system fields (P3)
  consolidatedSessionMd?: string  // from session.md (the clean desk)
  userMd?: string                 // from user.md (long-term memory)
  clockBlock?: string             // memory clock context
}

/**
 * Build session context to prepend to the agent prompt.
 */
function buildSessionContext(
  sourceImages: Array<{ path: string; analysis?: object }>,
  sessionId: string,
  isResume: boolean = false,
  sessionFiles?: SessionFiles,
  bridgeResumed: boolean = false
): string {
  let imageList: string
  if (sourceImages.length === 0) {
    imageList = 'No images uploaded yet. You will need to write generation prompts for all images.'
  } else {
    imageList = sourceImages
      .map((img) => {
        const filename = path.basename(img.path)
        return `- ${filename}`
      })
      .join('\n')
  }

  // Bridge resumed via --resume: Claude CLI has full conversation history.
  // No need to re-inject session files or boot sequence — just continue.
  if (bridgeResumed) {
    return `---

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/

I'm back.

---

`
  }

  // Cold start restore - include actual file contents so CD agent knows the state
  if (isResume && sessionFiles) {
    const htmlList = sessionFiles.htmlFiles?.length
      ? sessionFiles.htmlFiles.map(f => `- ${f}`).join('\n')
      : 'No HTML files generated yet.'

    // Prefer consolidated session.md over raw SESSION.md when available
    const sessionContext = sessionFiles.consolidatedSessionMd || sessionFiles.sessionMd || 'Not available'
    const userMemoryBlock = sessionFiles.userMd
      ? `\n### USER MEMORY (cross-session, durable — from user.md)\n\`\`\`markdown\n${sessionFiles.userMd}\n\`\`\`\n`
      : ''
    const clockBlock = sessionFiles.clockBlock || ''

    return `---

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/

### Current Session State

**HTML Files in Session:**
${htmlList}

**Uploaded Images:**
${imageList}

### Session Context:
\`\`\`markdown
${sessionContext}
\`\`\`
${userMemoryBlock}
### CREATIVE-BRIEF.md Contents:
\`\`\`markdown
${sessionFiles.creativeBriefMd || 'Not available'}
\`\`\`

### IMAGES.md Contents:
\`\`\`markdown
${sessionFiles.imagesMd || 'Not available'}
\`\`\`
${clockBlock}
---

Executing boot protocol:
1. Report what phase we're in
2. Report what's coming up next

---

`
  }

  // Fallback for resume without files (cold start)
  if (isResume) {
    return `---

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/

Executing boot protocol:
1. Read SESSION.md: cat public/${sessionId}/SESSION.md
2. Report what phase we're in
3. Report what's coming up next

### Uploaded Images
${imageList}

---

`
  }

  // Normal new session context
  return `---

## SESSION CONTEXT

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/ (relative path from oskar-prototype)

**⚠️ FIRST ACTION REQUIRED:**
1. Read the uploaded images listed below
2. WRITE your analysis to public/${sessionId}/IMAGES.md
3. Update public/${sessionId}/SESSION.md workflow checkbox: [x] Images analyzed by CD

### Uploaded Images
${imageList}

---

`
}

/**
 * Build the complete prompt for the Creative Director agent.
 * @param isResume - Set to true when resuming an existing session
 * @param sessionFiles - Optional session file contents for resume context
 */
export function buildCDPrompt(
  sourceImages: Array<{ path: string; analysis?: object }> = [],
  sessionId: string = 'default-session',
  isResume: boolean = false,
  sessionFiles?: SessionFiles,
  bridgeResumed: boolean = false
): string {
  const agentPrompt = loadCDAgentPrompt()
  const sessionContext = buildSessionContext(sourceImages, sessionId, isResume, sessionFiles, bridgeResumed)

  return sessionContext + agentPrompt
}

/**
 * Legacy export for backwards compatibility.
 */
export const CD_AGENT_SYSTEM_PROMPT = loadCDAgentPrompt()
