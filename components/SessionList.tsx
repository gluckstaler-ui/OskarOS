'use client'

import { useState, useEffect } from 'react'
import { SessionListItem, SessionPhase } from '@/lib/session'
import { listSessionsAction } from '@/lib/session-actions'

interface SessionListProps {
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void
}

const PHASE_LABELS: Record<SessionPhase, string> = {
  'PHASE_1_DISCOVERY': 'Discovery',
  'PHASE_2_VIBES': 'Vibes',
  'PHASE_3_BUILD': 'Building',
  'PHASE_4_POLISH': 'Polish',
  'COMPLETE': 'Complete',
}

const PHASE_COLORS: Record<SessionPhase, string> = {
  'PHASE_1_DISCOVERY': 'bg-blue-500/20 text-blue-300',
  'PHASE_2_VIBES': 'bg-purple-500/20 text-purple-300',
  'PHASE_3_BUILD': 'bg-amber-500/20 text-amber-300',
  'PHASE_4_POLISH': 'bg-emerald-500/20 text-emerald-300',
  'COMPLETE': 'bg-green-500/20 text-green-300',
}

export function SessionList({ onSelectSession, onCreateSession }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSessions()
  }, [])

  async function loadSessions() {
    try {
      const sessionList = await listSessionsAction()
      setSessions(sessionList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={loadSessions}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Create New Session Button */}
      <button
        onClick={onCreateSession}
        className="w-full p-4 border-2 border-dashed border-white/20 rounded-xl
          hover:border-white/40 hover:bg-white/5
          transition-all duration-200
          flex items-center justify-center gap-3
          text-white/60 hover:text-white/80"
      >
        <span className="text-2xl">+</span>
        <span className="font-medium">Create New Session</span>
      </button>

      {/* Session List */}
      {sessions.length === 0 ? (
        <div className="text-center py-8 text-white/40">
          <p>No sessions yet.</p>
          <p className="text-sm mt-1">Create your first session to get started.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className="w-full p-4 bg-zinc-800/50 rounded-xl
                hover:bg-zinc-700/50 transition-all duration-200
                text-left group"
            >
              <div className="flex items-start gap-4">
                {/* Preview Image */}
                <div className="w-16 h-16 rounded-lg bg-zinc-700/50 overflow-hidden flex-shrink-0">
                  {session.previewImage ? (
                    <img
                      src={session.previewImage}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl text-white/20">
                      📁
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-white/90 truncate group-hover:text-white">
                    {session.businessName}
                  </h3>

                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${PHASE_COLORS[session.phase]}`}>
                      {PHASE_LABELS[session.phase]}
                    </span>
                    <span className="text-xs text-white/40">
                      {formatDate(session.lastUpdated)}
                    </span>
                  </div>

                  <p className="text-xs text-white/40 mt-1 truncate">
                    {session.id}
                  </p>
                </div>

                {/* Arrow */}
                <div className="text-white/20 group-hover:text-white/40 transition-colors">
                  →
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
