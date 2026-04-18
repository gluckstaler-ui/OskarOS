'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode
} from 'react'
import { Snackbar, SnackbarType, SnackbarAction } from './Snackbar'
import { sessionEvents, SessionEvent, SessionEventType } from '@/lib/session-events'

interface SnackbarItem {
  id: string
  type: SnackbarType
  message: string
  actions?: SnackbarAction[]
  duration?: number
  isProgress?: boolean
}

interface SnackbarContextType {
  show: (
    type: SnackbarType,
    message: string,
    options?: {
      actions?: SnackbarAction[]
      duration?: number
      isProgress?: boolean
    }
  ) => string
  dismiss: (id: string) => void
  dismissAll: () => void
  update: (id: string, updates: Partial<SnackbarItem>) => void
}

const SnackbarContext = createContext<SnackbarContextType | null>(null)

export function useSnackbar() {
  const context = useContext(SnackbarContext)
  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider')
  }
  return context
}

const MAX_VISIBLE = 3

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snackbars, setSnackbars] = useState<SnackbarItem[]>([])

  const show = useCallback((
    type: SnackbarType,
    message: string,
    options?: {
      actions?: SnackbarAction[]
      duration?: number
      isProgress?: boolean
    }
  ): string => {
    const id = `snackbar-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    setSnackbars(prev => {
      const newSnackbars = [...prev, {
        id,
        type,
        message,
        actions: options?.actions,
        duration: options?.duration,
        isProgress: options?.isProgress
      }]

      // Keep only the most recent MAX_VISIBLE
      if (newSnackbars.length > MAX_VISIBLE) {
        return newSnackbars.slice(-MAX_VISIBLE)
      }
      return newSnackbars
    })

    return id
  }, [])

  const dismiss = useCallback((id: string) => {
    setSnackbars(prev => prev.filter(s => s.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    setSnackbars([])
  }, [])

  const update = useCallback((id: string, updates: Partial<SnackbarItem>) => {
    setSnackbars(prev =>
      prev.map(s => s.id === id ? { ...s, ...updates } : s)
    )
  }, [])

  // Subscribe to session events and show appropriate snackbars
  useEffect(() => {
    const unsubscribe = sessionEvents.onAll((event: SessionEvent) => {
      switch (event.type) {
        case 'vibe-ready':
          show('success', `${event.data.vibeName} ready for preview`, {
            actions: [
              {
                label: 'View',
                onClick: () => {
                  // Navigate to vibe preview
                  window.location.href = `/${event.sessionId}/${event.data.vibeFile}`
                }
              }
            ]
          })
          break

        case 'image-ready': {
          const geminiNote = event.data.geminiText ? ` — ${event.data.geminiText.slice(0, 120)}` : ''
          show('info', `${event.data.imageName} ready${geminiNote}`, {
            actions: [
              { label: 'View', onClick: () => {} },
              { label: 'Re-prompt', onClick: () => {} }
            ]
          })
          break
        }

        case 'hot-swap':
          show('info', `🔄 ${event.data.vibesUpdated?.[0]?.replace('vibe-', '').replace('.html', '')} updated with new ${event.data.slot}`, {
            actions: [
              {
                label: 'View',
                onClick: () => {
                  if (event.data.vibesUpdated?.[0]) {
                    window.location.href = `/${event.sessionId}/${event.data.vibesUpdated[0]}`
                  }
                }
              }
            ]
          })
          break

        case 'regenerating':
          show('progress', `Regenerating ${event.data.imageName}...`, {
            isProgress: true,
            duration: 0  // Don't auto-dismiss progress
          })
          break

        case 'all-complete':
          show('success', `🎉 All ${event.data.vibeCount} vibes ready!`, {
            actions: [
              { label: 'Compare', onClick: () => {} }
            ],
            duration: 0  // Stay until dismissed
          })
          break

        case 'error':
          show('error', event.data.message || 'Something went wrong', {
            actions: [
              { label: 'Retry', onClick: () => {} }
            ],
            duration: 0  // Errors stay until dismissed
          })
          break

        case 'phase-change':
          // Don't show snackbar for phase changes (too noisy)
          break

        case 'brief-updated':
          show('info', 'Creative brief updated', {
            duration: 3000
          })
          break

        // ── WP-15 (added 2026-04-17): Big CD signal channel ──

        case 'cd.proofread.advisory':
          // CD looked at the prompt, has a comment, did NOT rewrite.
          // Snackbar only — never logged to chat per WP-15 §"Paper-trail filter".
          show('info', `CD: ${event.data.note}`, { duration: 5000 })
          break

        case 'cd.proofread.rewritten':
          // CD rewrote the prompt before sending to Nano. Caller already
          // overwrote Zone 4 in place; snackbar tells the user what changed.
          show('info', `✏️ CD rewrote your prompt — ${event.data.note}`, {
            duration: 7000,
          })
          break

        case 'cd.verdict': {
          // Extended-toast per WP-15 rule 6 — sticks until dismissed.
          // Variant by verdict glyph: ✓ success, ≈ info, ✗ error.
          const v = event.data.verdict as '✓' | '≈' | '✗'
          const variant = v === '✓' ? 'success' : v === '✗' ? 'error' : 'info'
          show(variant, `${v} ${event.data.filename} — ${event.data.note}`, {
            duration: 0, // sticks until dismissed
          })
          break
        }

        case 'cd.comment':
          // CD reply in Image Mode (Ask CD pill).
          show('info', `CD: ${event.data.content}`, { duration: 0 })
          break

        case 'cd.upload-evaluated': {
          const v = event.data.verdict as '✓' | '≈' | '✗'
          const variant = v === '✓' ? 'success' : v === '✗' ? 'error' : 'info'
          show(variant, `${v} ${event.data.filename} — ${event.data.note}`, {
            duration: 7000,
          })
          break
        }
      }
    })

    return unsubscribe
  }, [show])

  return (
    <SnackbarContext.Provider value={{ show, dismiss, dismissAll, update }}>
      {children}

      {/* Snackbar container - fixed bottom-right */}
      <div style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'auto'
      }}>
        {snackbars.map((snackbar) => (
          <Snackbar
            key={snackbar.id}
            id={snackbar.id}
            type={snackbar.type}
            message={snackbar.message}
            actions={snackbar.actions}
            duration={snackbar.duration}
            onDismiss={dismiss}
            isProgress={snackbar.isProgress}
          />
        ))}
      </div>
    </SnackbarContext.Provider>
  )
}
