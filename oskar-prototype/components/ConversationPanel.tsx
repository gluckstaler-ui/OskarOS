'use client'

import { useRef, useEffect } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ConversationMessage, MoodboardData, LayoutMode, StreamingProgress } from '@/lib/types'

// ============================================================================
// CONVERSATION PANEL - COMPLETELY REWRITTEN TO MATCH BENTO.HTML
// ============================================================================

interface ConversationPanelProps {
  messages: ConversationMessage[]
  moodboard?: MoodboardData
  onSendMessage: (message: string, images?: File[]) => void
  onMoodboardSelect: (conceptName: string) => void
  isLoading: boolean
  layoutMode: LayoutMode
  streamingText?: string
  streamingProgress?: StreamingProgress
}

export function ConversationPanel({
  messages,
  moodboard,
  onSendMessage,
  onMoodboardSelect,
  isLoading,
  layoutMode,
  streamingText = '',
  streamingProgress
}: ConversationPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, streamingProgress])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = inputRef.current?.value.trim()
    if (value) {
      onSendMessage(value)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter to submit (unless Shift is held for newline), but only if not loading
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // ============================================================================
  // RENDER - MATCHING BENTO.HTML STRUCTURE EXACTLY
  // ============================================================================
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--bg-card)',
      overflow: 'hidden'
    }}>
      {/* ================================================================== */}
      {/* HEADER - h-14 (56px), flexShrink: 0                              */}
      {/* ================================================================== */}
      <div style={{
        height: '56px',
        minHeight: '56px',
        borderBottom: '1px solid var(--border-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0
      }}>
        <span style={{
          fontSize: '12px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-main)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #3B82F6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          Briefing
        </span>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: '#22C55E',
          boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)'
        }} />
      </div>

      {/* ================================================================== */}
      {/* CHAT LOG - flex: 1, overflow-y: auto                             */}
      {/* ================================================================== */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
        minHeight: 0
      }}>
        {/* Welcome Message */}
        {messages.length === 0 && (
          <ChatBubble role="assistant">
            <p style={{ margin: '0 0 12px 0' }}>
              Hey! I'm the Creative Director for OskarOS. I help businesses create booking pages that don't look like booking pages.
            </p>
            <p style={{ margin: 0, fontWeight: 600 }}>
              Let's start with the basics: What's your business?
            </p>
          </ChatBubble>
        )}

        {/* Moodboard Selection */}
        {moodboard && !moodboard.selectedConcept && (
          <MoodboardSelector moodboard={moodboard} onSelect={onMoodboardSelect} />
        )}

        {/* Messages
            WP-15 (2026-04-17): hide [OSKAR-SYSTEM ...] turns from the
            Briefing display. They still live in the bridge's conversation
            history for the paper trail, but visually they would distract
            the user — these are app→CD machine messages, not user chat.
            We also hide CD's responses to system messages (replies that
            start with the structured ## SEVERITY/## VERDICT/## NOTE blocks). */}
        {messages
          .filter(msg => {
            const c = msg.content || ''
            // Hide outgoing system requests
            if (c.startsWith('[OSKAR-SYSTEM ')) return false
            // Hide CD replies to those — recognized by the structured headers
            if (msg.role === 'assistant') {
              const trimmed = c.trim()
              if (
                trimmed.startsWith('## SEVERITY') ||
                trimmed.startsWith('## VERDICT')
              ) return false
            }
            return true
          })
          .map(msg => (
          <ChatBubble key={msg.id} role={msg.role}>
            <MarkdownRenderer content={msg.content} />
            {msg.images && msg.images.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                {msg.images.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt=""
                    style={{
                      maxWidth: '100px',
                      maxHeight: '100px',
                      borderRadius: '8px',
                      objectFit: 'cover'
                    }}
                  />
                ))}
              </div>
            )}
          </ChatBubble>
        ))}

        {/* Streaming State */}
        {isLoading && (
          <StreamingBubble
            text={streamingText}
            progress={streamingProgress}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ================================================================== */}
      {/* INPUT AREA - 6-line textarea with bottom toolbar                 */}
      {/* ================================================================== */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '16px',
          borderTop: '1px solid var(--border-card)',
          backgroundColor: 'var(--bg-app)',
          flexShrink: 0
        }}
      >
        {/* Input container */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: '12px',
          overflow: 'hidden'
        }}>
          {/* Textarea - 6 lines minimum, NOT disabled during loading so user can compose next message */}
          <textarea
            ref={inputRef}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or instruction..."
            rows={6}
            style={{
              width: '100%',
              minHeight: '144px',
              height: '144px',
              backgroundColor: 'transparent',
              border: 'none',
              padding: '12px 16px',
              fontSize: '14px',
              color: 'var(--text-main)',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'none',
              lineHeight: '1.6'
            }}
          />

          {/* Bottom toolbar: icons left, AI ACTIVE + submit right */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderTop: '1px solid var(--border-card)'
          }}>
            {/* Left: attach + mic */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Attach button */}
              <button
                type="button"
                style={{
                  padding: '4px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                  <line x1="12" x2="12" y1="19" y2="22"></line>
                </svg>
              </button>
            </div>

            {/* Right: AI ACTIVE + submit button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em'
              }}>
                AI Active
              </span>
              <button
                type="submit"
                disabled={isLoading}
                style={{
                  padding: '6px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--text-main)',
                  color: 'var(--bg-app)',
                  border: 'none',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: isLoading ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

// ============================================================================
// CHAT BUBBLE COMPONENT - MATCHES BENTO.HTML ChatMessage
// ============================================================================
function ChatBubble({
  role,
  children
}: {
  role: 'user' | 'assistant'
  children: React.ReactNode
}) {
  const isUser = role === 'user'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      marginBottom: '24px',
      alignItems: isUser ? 'flex-end' : 'flex-start'
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '16px',
        borderRadius: '16px',
        borderTopRightRadius: isUser ? '4px' : '16px',
        borderTopLeftRadius: isUser ? '16px' : '4px',
        fontSize: '14px',
        lineHeight: 1.6,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        backgroundColor: isUser ? 'var(--text-main)' : 'var(--bg-app)',
        color: isUser ? 'var(--bg-app)' : 'var(--text-main)',
        border: isUser ? 'none' : '1px solid var(--border-card)'
      }}>
        {children}
      </div>
      <span style={{
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        marginTop: '8px',
        opacity: 0.5,
        padding: '0 4px'
      }}>
        {isUser ? 'YOU' : 'OSKAR'}
      </span>
    </div>
  )
}

// ============================================================================
// STREAMING BUBBLE COMPONENT
// ============================================================================
function StreamingBubble({
  text,
  progress
}: {
  text: string
  progress?: StreamingProgress
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      marginBottom: '24px'
    }}>
      {/* Progress indicator */}
      {progress && progress.phase !== 'idle' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: '8px',
          marginBottom: '8px',
          maxWidth: '85%'
        }}>
          <div style={{
            width: '24px',
            height: '24px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px'
          }}>
            {progress.phase === 'discovery' && '🔍'}
            {progress.phase === 'confirm' && '✓'}
            {progress.phase === 'vibe' && '✨'}
            {progress.phase === 'done' && '🎉'}
            {progress.phase === 'error' && '⚠️'}
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-main)', fontWeight: 500 }}>
              {progress.message}
            </span>
            {progress.currentVibeName && (
              <span style={{ display: 'block', fontSize: '11px', color: 'var(--accent)', marginTop: '2px' }}>
                {progress.currentVibeName}
              </span>
            )}
          </div>
          {progress.phase === 'vibe' && progress.vibesCurrent && (
            <div style={{
              width: '50px',
              height: '4px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg, #4a9eff, #f97316)',
                borderRadius: '2px',
                width: `${(progress.vibesCurrent / 3) * 100}%`
              }} />
            </div>
          )}
        </div>
      )}

      {/* Streaming text */}
      <div style={{
        maxWidth: '85%',
        padding: '16px',
        borderRadius: '16px',
        borderTopLeftRadius: '4px',
        fontSize: '14px',
        lineHeight: 1.6,
        backgroundColor: 'var(--bg-app)',
        border: '1px solid var(--border-card)',
        color: 'var(--text-main)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}>
        {text ? (
          <>
            <MarkdownRenderer content={text} />
            <span style={{
              display: 'inline-block',
              color: 'var(--accent)',
              marginLeft: '2px'
            }}>▊</span>
          </>
        ) : (
          <div style={{ display: 'flex', gap: '6px', padding: '4px 0' }}>
            <span style={{ width: '6px', height: '6px', background: 'var(--text-muted)', borderRadius: '50%' }} />
            <span style={{ width: '6px', height: '6px', background: 'var(--text-muted)', borderRadius: '50%' }} />
            <span style={{ width: '6px', height: '6px', background: 'var(--text-muted)', borderRadius: '50%' }} />
          </div>
        )}
      </div>

      <span style={{
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        marginTop: '8px',
        opacity: 0.5,
        padding: '0 4px'
      }}>OSKAR</span>
    </div>
  )
}

// ============================================================================
// MOODBOARD SELECTOR COMPONENT
// ============================================================================
function MoodboardSelector({
  moodboard,
  onSelect
}: {
  moodboard: MoodboardData
  onSelect: (conceptName: string) => void
}) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-app)',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '16px',
      border: '1px solid var(--accent, #3B82F6)'
    }}>
      <h4 style={{ margin: '0 0 4px 0', color: 'var(--text-main)', fontSize: '14px' }}>
        Choose Your Direction
      </h4>
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '0 0 12px 0' }}>
        Click on a quadrant to select your vibe
      </p>
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <img
          src={moodboard.imagePath}
          alt="Moodboard options"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr'
        }}>
          {moodboard.concepts.map((concept) => (
            <button
              key={concept.name}
              onClick={() => onSelect(concept.name)}
              title={`${concept.name}: ${concept.visualStyle}`}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <span style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#fff',
                textShadow: '0 1px 3px rgba(0,0,0,0.8)'
              }}>
                {concept.name}
              </span>
              <span style={{
                fontSize: '11px',
                color: 'var(--accent, #3B82F6)',
                textShadow: '0 1px 3px rgba(0,0,0,0.8)'
              }}>
                {concept.oneWord}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
