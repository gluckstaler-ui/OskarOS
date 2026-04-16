import { readFileSync } from 'fs'
import path from 'path'

/**
 * Load the Creative Director agent prompt from the MD file.
 * File location: /OskarOS/creative-director-agent.md
 * This file runs from: /OskarOS/oskar-prototype/
 */
function loadCDAgentPrompt(): string {
  try {
    // Go up one level from oskar-prototype to OskarOS base directory
    const mdPath = path.join(process.cwd(), '..', 'creative-director-agent.md')
    return readFileSync(mdPath, 'utf-8')
  } catch (error) {
    console.error('Failed to load creative-director-agent.md:', error)
    console.error('Expected location:', path.join(process.cwd(), '..', 'creative-director-agent.md'))
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
}

/**
 * Build session context to prepend to the agent prompt.
 */
function buildSessionContext(
  sourceImages: Array<{ path: string; analysis?: object }>,
  sessionId: string,
  isResume: boolean = false,
  sessionFiles?: SessionFiles
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

  // Session restore - include actual file contents so CD agent knows the state
  if (isResume && sessionFiles) {
    const htmlList = sessionFiles.htmlFiles?.length
      ? sessionFiles.htmlFiles.map(f => `- ${f}`).join('\n')
      : 'No HTML files generated yet.'

    return `---

## 🔄 SESSION RESTORE

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/ (relative path from oskar-prototype)

### Current Session State

**HTML Files in Session:**
${htmlList}

**Uploaded Images:**
${imageList}

### SESSION.md Contents:
\`\`\`markdown
${sessionFiles.sessionMd || 'Not available'}
\`\`\`

### CREATIVE-BRIEF.md Contents:
\`\`\`markdown
${sessionFiles.creativeBriefMd || 'Not available'}
\`\`\`

### IMAGES.md Contents:
\`\`\`markdown
${sessionFiles.imagesMd || 'Not available'}
\`\`\`

---

**IMPORTANT:** You now have full context of this session. Tell the user:
1. What phase this session is in
2. What vibes/HTML exist
3. What's the next step

---

`
  }

  // Fallback for resume without files
  if (isResume) {
    return `---

## 🔄 SESSION RESTORE

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/ (relative path)

**This is a RESUMED session. Execute your boot sequence:**
1. List files: ls public/${sessionId}/
2. Read SESSION.md: cat public/${sessionId}/SESSION.md
3. Report what phase you're in and what exists

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
  sessionFiles?: SessionFiles
): string {
  const agentPrompt = loadCDAgentPrompt()
  const sessionContext = buildSessionContext(sourceImages, sessionId, isResume, sessionFiles)

  return sessionContext + agentPrompt
}

/**
 * Legacy export for backwards compatibility.
 */
export const CD_AGENT_SYSTEM_PROMPT = loadCDAgentPrompt()
