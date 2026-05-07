/**
 * sage-agent-prompt.ts — Sage (Padawan Sage / Dreamer) agent prompt loader.
 *
 * Parallel to `cd-agent-prompt.ts`, this loader powers the main chat bridge
 * when Sage is the active agent (instead of CD). Used by `/api/chat-stream`
 * to spawn a Claude CLI process with Sage's identity so the user can talk
 * directly to the portrait painter / memory agent.
 *
 * Source file: `agents/dreamer-agent-production.md` — the current, Lumberjack-
 * aware Sage definition. (The older `dreamer-agent.md` references the
 * deprecated Consolidator sibling and is NOT used here.)
 *
 * NOTE: CD-specific routes (ask-cd, proofread, verdict, evaluate) keep using
 * `buildCDPrompt` — their system prompts are written for CD's character.
 * Only the main conversational chat swaps to Sage.
 */

import { readFileSync } from 'fs'
import path from 'path'
import type { SessionFiles } from './cd-agent-prompt'

/**
 * Load the Padawan Sage / Dreamer agent prompt from the MD file.
 * File location: /OskarOS/oskar-prototype/agents/dreamer-agent-production.md
 */
function loadSageAgentPrompt(): string {
  try {
    const mdPath = path.join(process.cwd(), 'agents', 'dreamer-agent-production.md')
    return readFileSync(mdPath, 'utf-8')
  } catch (error) {
    console.error('Failed to load dreamer-agent-production.md:', error)
    console.error(
      'Expected location:',
      path.join(process.cwd(), 'agents', 'dreamer-agent-production.md'),
    )
    throw new Error('Padawan Sage agent prompt not found')
  }
}

/**
 * Build session context to prepend to Sage's agent prompt.
 *
 * Sage's focus is different from CD's:
 *   - CD needs to know about images + workflow phase + vibes to generate.
 *   - Sage needs to know about SESSION.md + user.md (the portrait) to
 *     reason about the person in front of them.
 *
 * So the context block is lighter: session id, SESSION.md contents, user.md
 * if present, and a gentle nudge that Sage is in conversation mode (not
 * background compaction mode).
 */
function buildSageSessionContext(
  sessionId: string,
  isResume: boolean = false,
  sessionFiles?: SessionFiles,
  bridgeResumed: boolean = false,
): string {
  // Bridge resumed via --resume: Claude CLI has full conversation history.
  // No need to re-inject session files — just continue the conversation.
  if (bridgeResumed) {
    return `---

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/

I'm back. Continuing our conversation.

---

`
  }

  // Cold start with session files loaded — give Sage the context to reason
  // about who this user is. Sage's whole job is understanding the person.
  if (isResume && sessionFiles) {
    const sessionContext =
      sessionFiles.consolidatedSessionMd || sessionFiles.sessionMd || 'Not available'
    const userMemoryBlock = sessionFiles.userMd
      ? `\n### USER MEMORY (cross-session, durable — from user.md)\n\`\`\`markdown\n${sessionFiles.userMd}\n\`\`\`\n`
      : '\n### USER MEMORY\nNo user.md yet. This is an early conversation — listen carefully.\n'
    const clockBlock = sessionFiles.clockBlock || ''

    return `---

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/

### Session Context (cleaned by Lumberjack):
\`\`\`markdown
${sessionContext}
\`\`\`
${userMemoryBlock}${clockBlock}
---

## CONVERSATION MODE

You are talking directly to the user right now, not running a background
dream pass. Respond as Padawan Sage in conversation: thoughtful, present,
attentive. You may still reference the portrait and session notes when
relevant, but your primary mode here is dialogue, not compaction.

---

`
  }

  // Cold start, no files — first conversation on an existing session folder.
  if (isResume) {
    return `---

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/

On first message, quickly check if SESSION.md exists:
  cat public/${sessionId}/SESSION.md

If it does, read user.md for the existing portrait:
  cat public/${sessionId}/user.md

---

## CONVERSATION MODE

You are talking directly to the user right now, not running a background
dream pass. Respond as Padawan Sage in conversation: thoughtful, present,
attentive.

---

`
  }

  // Brand-new session — no history, no portrait yet.
  return `---

## SESSION CONTEXT

**Session ID:** ${sessionId}
**Session Folder:** public/${sessionId}/ (relative path from oskar-prototype)

This is a fresh conversation. There is no user portrait yet — you are
meeting this person for the first time. Listen carefully; every exchange
is a brushstroke.

---

## CONVERSATION MODE

You are talking directly to the user right now, not running a background
dream pass. Respond as Padawan Sage in conversation: thoughtful, present,
attentive, in character. You may still reason about portraits and signal
extraction, but your primary mode here is dialogue.

---

`
}

export function buildSagePrompt(
  sessionId: string = 'default-session',
  isResume: boolean = false,
  sessionFiles?: SessionFiles,
  bridgeResumed: boolean = false,
): string {
  const agentPrompt = loadSageAgentPrompt()
  const sessionContext = buildSageSessionContext(sessionId, isResume, sessionFiles, bridgeResumed)
  return sessionContext + agentPrompt
}

export const SAGE_AGENT_SYSTEM_PROMPT = loadSageAgentPrompt()
