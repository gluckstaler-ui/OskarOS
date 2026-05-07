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

// Stack cap (auto-dismiss snackbars only). Sticky snackbars are NEVER
// evicted by this cap — if the user/agent asked for sticky, sticky wins,
// even if 20 of them stack. The cap only trims the auto-dismiss tail so
// rapid bursts of info/success messages don't dominate the screen.
//
// 2026-05-03 (Ralph): bumped from 3 → 8 + sticky-exempt eviction. The
// previous cap silently dropped sticky snackbars when bursts >3 fired,
// violating the sticky contract.
const MAX_VISIBLE_AUTO = 8

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
      const newItem: SnackbarItem = {
        id,
        type,
        message,
        actions: options?.actions,
        duration: options?.duration,
        isProgress: options?.isProgress,
      }
      const next = [...prev, newItem]

      // Sticky snackbars (duration === 0 OR isProgress) are exempt from
      // eviction. We only trim the auto-dismiss (duration > 0 && !isProgress)
      // tail beyond MAX_VISIBLE_AUTO.
      const isSticky = (s: SnackbarItem) =>
        s.duration === 0 || s.isProgress === true
      const sticky = next.filter(isSticky)
      const auto = next.filter((s) => !isSticky(s))
      const trimmedAuto = auto.length > MAX_VISIBLE_AUTO
        ? auto.slice(-MAX_VISIBLE_AUTO)
        : auto

      // Reassemble preserving original order. Iterate `next` once and pick
      // each item from whichever pool it's in (and still present).
      const stickySet = new Set(sticky.map((s) => s.id))
      const autoSet = new Set(trimmedAuto.map((s) => s.id))
      return next.filter((s) => stickySet.has(s.id) || autoSet.has(s.id))
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
                  // Open in NEW window (Ralph 2026-05-06 spec): navigating
                  // away from the chat surface kills the SSE stream and
                  // discards in-flight build cards. New tab keeps the
                  // builder context alive while the user previews.
                  window.open(
                    `/${event.sessionId}/${event.data.vibeFile}`,
                    '_blank',
                    'noopener,noreferrer',
                  )
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
                  // Ralph 2026-05-06: open in a NEW window (matches the
                  // vibe-ready and BuildJobCard.open paths so all "view this
                  // build" entries behave identically — chat surface stays
                  // alive, no SSE teardown).
                  if (event.data.vibesUpdated?.[0] && typeof window !== 'undefined') {
                    window.open(
                      `/${event.sessionId}/${event.data.vibesUpdated[0]}`,
                      '_blank',
                      'noopener,noreferrer',
                    )
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

        // 2026-04-30 (Ralph) — Phase 2 Tier S `snackbar` MCP tool. Routed
        // through the existing SnackbarProvider so it uses the SAME UI
        // every other snackbar in the app uses (e.g. the image pipeline).
        //
        // 2026-04-30 (Ralph, late) — full 5-severity parity with the
        // existing palette:
        //   info     → blue,        5s auto-dismiss
        //   success  → green,       5s auto-dismiss
        //   progress → cyan,        sticky (an op is in flight; caller dismisses)
        //   warning  → yellow/orange, sticky
        //   error    → red,         sticky
        //
        // `sticky` is ORTHOGONAL to severity. Pass sticky:true to make
        // info/success persist; pass sticky:false to make warning/error/
        // progress auto-dismiss (5s). Both `'warn'` and `'warning'` are
        // accepted on the agent side; we normalize to 'warning' (the
        // SnackbarType the underlying component declares).
        case 'cd.snackbar': {
          const text = event.data.text as string | undefined
          if (!text) break
          const sevRaw = event.data.severity as
            | 'info' | 'success' | 'progress' | 'warn' | 'warning' | 'error'
            | undefined
          const sev = sevRaw === 'warn' ? 'warning' : sevRaw
          // Default sticky-ness per severity.
          const defaultSticky = sev === 'warning' || sev === 'error' || sev === 'progress'
          const sticky = typeof event.data.sticky === 'boolean'
            ? event.data.sticky
            : defaultSticky
          const duration = sticky ? 0 : 5000
          switch (sev) {
            case 'success':
              show('success', text, { duration })
              break
            case 'progress':
              show('progress', text, { duration, isProgress: true })
              break
            case 'warning':
              show('warning', text, { duration })
              break
            case 'error':
              show('error', text, { duration })
              break
            case 'info':
            default:
              show('info', text, { duration })
              break
          }
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
