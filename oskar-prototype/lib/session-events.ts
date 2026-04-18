/**
 * Session Events
 *
 * Event system for notifying UI of session changes.
 * Used to trigger snackbars and updates.
 *
 * Events:
 * - vibe-ready: A vibe HTML file is complete
 * - image-ready: An image has been generated
 * - hot-swap: An image was swapped into a vibe
 * - regenerating: Image regeneration started
 * - all-complete: All vibes are done
 * - error: Something failed
 * - phase-change: Session phase changed
 * - brief-updated: Creative brief was modified
 */

export type SessionEventType =
  | 'vibe-ready'
  | 'image-ready'
  | 'hot-swap'
  | 'regenerating'
  | 'all-complete'
  | 'error'
  | 'phase-change'
  | 'brief-updated'
  // ─── WP-15 (added 2026-04-17): CD signal channel ──────────────────────
  | 'cd.proofread.advisory'    // CD looked at prompt, has an opinion, did NOT rewrite
  | 'cd.proofread.rewritten'   // CD rewrote the prompt; user sees new value in Zone 4
  | 'cd.verdict'               // post-gen verdict (✓ ≈ ✗) — extended-toast
  | 'cd.comment'               // CD reply in Image Mode (Ask CD response surfaces here)
  | 'cd.upload-evaluated'      // CD evaluated an upload; snackbar with the take

export interface SessionEvent {
  type: SessionEventType
  sessionId: string
  timestamp: string
  data: {
    // For vibe-ready
    vibeName?: string
    vibeFile?: string

    // For image-ready
    imageName?: string
    imageSlot?: string

    // For hot-swap
    vibesUpdated?: string[]
    slot?: string
    oldImage?: string
    newImage?: string

    // For regenerating
    prompt?: string

    // For error
    message?: string

    // For phase-change
    oldPhase?: string
    newPhase?: string

    // Generic
    [key: string]: any
  }
}

type EventCallback = (event: SessionEvent) => void

/**
 * Event emitter for session events
 * Implemented as a singleton for cross-component access
 */
class SessionEventEmitter {
  private listeners: Map<SessionEventType, Set<EventCallback>> = new Map()
  private allListeners: Set<EventCallback> = new Set()
  private eventHistory: SessionEvent[] = []
  private maxHistory = 100

  /**
   * Subscribe to a specific event type
   */
  on(type: SessionEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(callback)

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(callback)
    }
  }

  /**
   * Subscribe to all events
   */
  onAll(callback: EventCallback): () => void {
    this.allListeners.add(callback)
    return () => {
      this.allListeners.delete(callback)
    }
  }

  /**
   * Emit an event
   */
  emit(event: Omit<SessionEvent, 'timestamp'>): void {
    const fullEvent: SessionEvent = {
      ...event,
      timestamp: new Date().toISOString()
    }

    // Store in history
    this.eventHistory.push(fullEvent)
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift()
    }

    // Notify specific listeners
    const typeListeners = this.listeners.get(event.type)
    if (typeListeners) {
      typeListeners.forEach(cb => {
        try {
          cb(fullEvent)
        } catch (error) {
          console.error('Event listener error:', error)
        }
      })
    }

    // Notify all-event listeners
    this.allListeners.forEach(cb => {
      try {
        cb(fullEvent)
      } catch (error) {
        console.error('Event listener error:', error)
      }
    })
  }

  /**
   * Get recent events for a session
   */
  getHistory(sessionId?: string): SessionEvent[] {
    if (sessionId) {
      return this.eventHistory.filter(e => e.sessionId === sessionId)
    }
    return [...this.eventHistory]
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = []
  }
}

// Singleton instance
export const sessionEvents = new SessionEventEmitter()

// Convenience functions for emitting events

export function emitVibeReady(sessionId: string, vibeName: string, vibeFile: string): void {
  sessionEvents.emit({
    type: 'vibe-ready',
    sessionId,
    data: { vibeName, vibeFile }
  })
}

export function emitImageReady(sessionId: string, imageName: string, imageSlot?: string, geminiText?: string): void {
  sessionEvents.emit({
    type: 'image-ready',
    sessionId,
    data: { imageName, imageSlot, geminiText }
  })
}

export function emitHotSwap(
  sessionId: string,
  vibesUpdated: string[],
  slot: string,
  oldImage: string,
  newImage: string
): void {
  sessionEvents.emit({
    type: 'hot-swap',
    sessionId,
    data: { vibesUpdated, slot, oldImage, newImage }
  })
}

export function emitRegenerating(sessionId: string, imageName: string, prompt: string): void {
  sessionEvents.emit({
    type: 'regenerating',
    sessionId,
    data: { imageName, prompt }
  })
}

export function emitAllComplete(sessionId: string, vibeCount: number): void {
  sessionEvents.emit({
    type: 'all-complete',
    sessionId,
    data: { vibeCount }
  })
}

export function emitError(sessionId: string, message: string): void {
  sessionEvents.emit({
    type: 'error',
    sessionId,
    data: { message }
  })
}

export function emitPhaseChange(sessionId: string, oldPhase: string, newPhase: string): void {
  sessionEvents.emit({
    type: 'phase-change',
    sessionId,
    data: { oldPhase, newPhase }
  })
}

export function emitBriefUpdated(sessionId: string, changes: string): void {
  sessionEvents.emit({
    type: 'brief-updated',
    sessionId,
    data: { changes }
  })
}

// ─── WP-15 emitters (added 2026-04-17) ────────────────────────────────────

/**
 * CD looked at a prompt and has commentary, but did NOT rewrite.
 * Snackbar only — never logged to chat per WP-15 §"Paper-trail filter".
 */
export function emitCDProofreadAdvisory(
  sessionId: string,
  data: { note: string; mode?: string; filename?: string }
): void {
  sessionEvents.emit({
    type: 'cd.proofread.advisory',
    sessionId,
    data,
  })
}

/**
 * CD rewrote a prompt before sending to Nano. Snackbar AND chat per spec.
 * The new prompt should already be in Zone 4 by the time this fires.
 */
export function emitCDProofreadRewritten(
  sessionId: string,
  data: { note: string; oldPrompt: string; newPrompt: string; mode?: string }
): void {
  sessionEvents.emit({
    type: 'cd.proofread.rewritten',
    sessionId,
    data,
  })
}

/**
 * Post-generation verdict. ✓ → snackbar only. ≈ → snackbar only.
 * ✗ → snackbar + chat per Augenmass filter (caller decides).
 */
export function emitCDVerdict(
  sessionId: string,
  data: {
    verdict: '✓' | '≈' | '✗'
    note: string
    filename: string
    mode?: string
  }
): void {
  sessionEvents.emit({
    type: 'cd.verdict',
    sessionId,
    data,
  })
}

/**
 * CD conversational reply in Image Mode (Ask CD pill).
 * Snackbar AND chat per WP-15 rule 8.
 */
export function emitCDComment(
  sessionId: string,
  data: { content: string; source?: string }
): void {
  sessionEvents.emit({
    type: 'cd.comment',
    sessionId,
    data,
  })
}

/**
 * CD evaluated an uploaded image. Snackbar AND chat per WP-15 rule 7.
 */
export function emitCDUploadEvaluated(
  sessionId: string,
  data: { filename: string; verdict: '✓' | '≈' | '✗'; note: string }
): void {
  sessionEvents.emit({
    type: 'cd.upload-evaluated',
    sessionId,
    data,
  })
}
