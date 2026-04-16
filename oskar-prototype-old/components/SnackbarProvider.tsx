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

        case 'image-ready':
          show('info', `${event.data.imageName} ready`, {
            actions: [
              { label: 'View', onClick: () => {} },
              { label: 'Re-prompt', onClick: () => {} }
            ]
          })
          break

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
