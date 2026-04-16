'use client'

import { useState, useEffect, useCallback } from 'react'

interface UsageData {
  totals: {
    inputTokens: number
    outputTokens: number
    cost: number
  }
  display: {
    inputTokens: string
    outputTokens: string
    cost: string
    totalTokens: string
    latestContextPct?: number
    latestInputTokens?: string
  }
  breakdown?: {
    cd: { inputTokens: number; outputTokens: number; cost: number }
    webdev: { inputTokens: number; outputTokens: number; cost: number }
  }
}

interface UsageBadgeProps {
  sessionId: string | null
  refreshTrigger?: number
  theme?: 'onyx' | 'polar'
  contextPct?: number
  cachedInputTokens?: number
  realInputTokens?: number
}

function formatTokensLocal(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

function getContextColor(pct: number): string {
  if (pct >= 75) return '#ef4444'  // red
  if (pct >= 50) return '#f59e0b'  // yellow
  return '#10b981'                  // green
}

const DollarIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" x2="12" y1="2" y2="22"/>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
)

export function UsageBadge({ sessionId, refreshTrigger, theme = 'onyx', contextPct: propContextPct, cachedInputTokens: propCached, realInputTokens: propReal }: UsageBadgeProps) {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const fetchUsage = useCallback(async () => {
    if (!sessionId) {
      setUsage(null)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/usage`)
      if (res.ok) {
        const data = await res.json()
        setUsage(data)
      } else {
        setUsage(null)
      }
    } catch (err) {
      console.error('Failed to fetch usage:', err)
      setUsage(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    fetchUsage()
  }, [fetchUsage, refreshTrigger])

  if (!sessionId) return null

  // Use real-time props if available, fall back to persisted API data
  const effectiveContextPct = propContextPct ?? usage?.display?.latestContextPct ?? 0
  const effectiveCached = propCached ?? 0
  const effectiveReal = propReal ?? 0
  const contextColor = getContextColor(effectiveContextPct)

  const badgeStyle: React.CSSProperties = {
    backgroundColor: theme === 'polar' ? '#ffffff' : 'rgba(9, 9, 11, 0.5)',
    border: theme === 'polar' ? '1px solid #e5e7eb' : '1px solid rgba(39, 39, 42, 0.5)',
  }

  if (loading && !usage) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        ...badgeStyle,
        borderRadius: '8px',
        fontSize: '10px',
        color: 'var(--text-muted)',
      }}>
        <span style={{ opacity: 0.5 }}>Loading...</span>
      </div>
    )
  }

  const costDisplay = (usage?.display?.cost || '$0.00').replace(/^\$/, '')
  const hasCost = usage && usage.totals.cost > 0

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setShowDetails(true)}
      onMouseLeave={() => setShowDetails(false)}
    >
      {/* Main Badge: [ $cost | ●pct% | tokens ] */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 12px',
        ...badgeStyle,
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}>
        {/* Cost */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: hasCost ? '#10b981' : 'var(--text-muted)' }}>
            <DollarIcon />
          </span>
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
            color: hasCost ? '#10b981' : 'var(--text-muted)',
            letterSpacing: '-0.02em',
          }}>
            {costDisplay}
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border-card)', opacity: 0.5 }} />

        {/* Context Fill % */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: contextColor,
            display: 'inline-block',
            boxShadow: effectiveContextPct >= 75 ? `0 0 4px ${contextColor}` : 'none',
          }} />
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
            color: contextColor,
            letterSpacing: '-0.02em',
          }}>
            {effectiveContextPct}%
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border-card)', opacity: 0.5 }} />

        {/* Cached Input Tokens */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
            color: 'var(--text-muted)',
            letterSpacing: '-0.02em',
          }}>
            {formatTokensLocal(effectiveCached)}
          </span>
        </div>

      </div>

      {/* Hover Details Popup */}
      {showDetails && usage && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '8px',
          padding: '12px 16px',
          backgroundColor: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border-card)',
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          zIndex: 1000,
          minWidth: '220px',
        }}>
          {/* Header */}
          <div style={{
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: '12px',
          }}>
            Session Usage
          </div>

          {/* Context Window */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Context Window</span>
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: 'JetBrains Mono, monospace',
                color: contextColor,
              }}>
                {effectiveContextPct}% used
              </span>
            </div>
            {/* Progress bar */}
            <div style={{
              width: '100%',
              height: '4px',
              backgroundColor: theme === 'polar' ? '#e5e7eb' : 'rgba(39, 39, 42, 0.5)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.min(effectiveContextPct, 100)}%`,
                height: '100%',
                backgroundColor: contextColor,
                borderRadius: '2px',
                transition: 'width 0.3s, background-color 0.3s',
              }} />
            </div>
          </div>

          {/* Token Details */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Cached Input</span>
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--text-main)',
              }}>
                {formatTokensLocal(effectiveCached)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Real Input</span>
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--text-main)',
              }}>
                {formatTokensLocal(effectiveReal)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Total Output</span>
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--text-main)',
              }}>
                {usage.display.outputTokens}
              </span>
            </div>
          </div>

          {/* Agent Breakdown */}
          {usage.breakdown && (
            <>
              <div style={{ height: '1px', backgroundColor: 'var(--border-card)', margin: '8px 0' }} />

              {usage.breakdown.cd.cost > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{
                    fontSize: '9px',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#8b5cf6' }} />
                    Creative Director
                  </span>
                  <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#8b5cf6' }}>
                    ${usage.breakdown.cd.cost.toFixed(4)}
                  </span>
                </div>
              )}

              {usage.breakdown.webdev.cost > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{
                    fontSize: '9px',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3b82f6' }} />
                    WebDeveloper
                  </span>
                  <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#3b82f6' }}>
                    ${usage.breakdown.webdev.cost.toFixed(4)}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Total */}
          <div style={{ height: '1px', backgroundColor: 'var(--border-card)', margin: '8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-main)' }}>
              Total Cost
            </span>
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: 'JetBrains Mono, monospace',
              color: '#10b981',
            }}>
              {usage.display.cost}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
