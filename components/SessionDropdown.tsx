'use client'

import { useState, useEffect, useRef } from 'react'
import { listSessionsAction } from '@/lib/session-actions'

interface SessionInfo {
  id: string
  name: string
  date: string
  status: string
}

interface SessionDropdownProps {
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void
}

export function SessionDropdown({
  currentSessionId,
  onSelectSession,
  onCreateSession
}: SessionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Load sessions when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true)
      listSessionsAction()
        .then(sessionList => {
          // listSessionsAction returns SessionListItem[] directly
          setSessions(sessionList.map(s => ({
            id: s.id,
            name: s.businessName || 'Untitled',
            date: formatDate(s.lastUpdated),
            status: s.phase || 'active'
          })))
        })
        .catch(err => console.error('Failed to load sessions:', err))
        .finally(() => setIsLoading(false))
    }
  }, [isOpen])

  function formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch {
      return dateStr
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'complete': return '#22c55e'  // green
      case 'review': return '#eab308'    // yellow
      case 'active': return '#3b82f6'    // blue
      default: return '#6b7280'          // gray
    }
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Dropdown trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '8px',
          color: 'white',
          fontSize: '13px',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
        }}
      >
        <span style={{ fontSize: '16px' }}>📁</span>
        <span>Sessions</span>
        <span style={{
          fontSize: '10px',
          marginLeft: '4px',
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s'
        }}>▼</span>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '8px',
          width: '280px',
          background: '#1a1a1a',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          zIndex: 1000
        }}>
          {/* New Session button */}
          <button
            onClick={() => {
              onCreateSession()
              setIsOpen(false)
            }}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              color: '#3b82f6',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'left'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(59,130,246,0.1)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span>➕</span>
            <span>New Session</span>
          </button>

          {/* Sessions list */}
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {isLoading ? (
              <div style={{
                padding: '20px',
                textAlign: 'center',
                color: 'rgba(255,255,255,0.5)',
                fontSize: '13px'
              }}>
                Loading sessions...
              </div>
            ) : sessions.length === 0 ? (
              <div style={{
                padding: '20px',
                textAlign: 'center',
                color: 'rgba(255,255,255,0.5)',
                fontSize: '13px'
              }}>
                No sessions yet
              </div>
            ) : (
              sessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => {
                    onSelectSession(session.id)
                    setIsOpen(false)
                  }}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: session.id === currentSessionId ? 'rgba(255,255,255,0.05)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    color: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    textAlign: 'left'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = session.id === currentSessionId ? 'rgba(255,255,255,0.05)' : 'transparent'
                  }}
                >
                  <div>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 500,
                      marginBottom: '2px'
                    }}>
                      {session.name}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'rgba(255,255,255,0.5)'
                    }}>
                      {session.date}
                    </div>
                  </div>
                  <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: getStatusColor(session.status)
                  }} />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
