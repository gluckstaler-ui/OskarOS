'use client'

import { useState, useEffect, useCallback } from 'react'

interface ModeBlock {
  inputTokens: number
  outputTokens: number
  cost: number
  cacheCreationTokens: number
  cacheReadTokens: number
  freshInputTokens: number
  entryCount: number
  // Bug N (Ralph 2026-05-04): per-mode latest snapshot. CLI computes
  // contextPct as real-time fill estimate; API as cumulative input /
  // context window. Different numbers, stored separately so toggling
  // visibly switches the badge.
  latestContextPct: number
  latestInputTokens: number
  latestContextWindow: number
  latestContextSize?: number
  display: {
    cost: string
    inputTokens: string
    outputTokens: string
    cacheReadTokens: string
    cacheCreationTokens: string
    freshInputTokens: string
    cacheHitPct: number
    latestInputTokens: string
    latestContextSize?: string
    latestContextWindow?: string
  }
}

interface UsageData {
  totals: {
    inputTokens: number
    outputTokens: number
    cost: number
    // 2026-05-03 (Ralph): cache visibility
    cacheCreationTokens?: number
    cacheReadTokens?: number
    freshInputTokens?: number
  }
  display: {
    inputTokens: string
    outputTokens: string
    cost: string
    totalTokens: string
    latestContextPct?: number
    latestInputTokens?: string
    latestContextWindow?: number
    cacheReadTokens?: string
    cacheCreationTokens?: string
    freshInputTokens?: string
    cacheHitPct?: number
    // 2026-05-04 (Ralph): per-call context fill — formatted strings for
    // the badge's "X / Y" display. Distinct from cache totals.
    latestContextSize?: number
    latestContextSizeStr?: string
    latestContextWindowStr?: string
  }
  // Bug N (Ralph 2026-05-04): per-mode rollups. Read the one matching
  // current billingMode; toggling flips which cost is shown.
  cli?: ModeBlock
  api?: ModeBlock
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
  /**
   * Bug N (Ralph 2026-05-04): which mode's $ to display. CLI shows the
   * cost Claude Code reports (Max plan / Z.ai sub equivalent). API shows
   * calculateCost (real per-token). Toggling flips both the displayed
   * value AND the visual label so the user sees which math is in use.
   */
  billingMode?: 'smpl' | 'cli' | 'api'
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

export function UsageBadge({ sessionId, refreshTrigger, theme = 'onyx', contextPct: propContextPct, cachedInputTokens: propCached, realInputTokens: propReal, billingMode }: UsageBadgeProps) {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(false)
  // 2026-04-30: replaced the two-click arm pattern with a native confirm
  // dialog. The arm dance was too easy to miss — Ralph kept clicking, the
  // 3-second timeout would expire between clicks, and each new click was
  // just re-arming instead of committing. Confirm dialog is unmissable.
  const [resetting, setResetting] = useState(false)

  const fetchUsage = useCallback(async () => {
    if (!sessionId) {
      setUsage(null)
      return
    }

    setLoading(true)
    try {
      // Bust both browser and Next.js fetch cache — without this, the reset
      // button looks broken because the GET that follows DELETE returns a
      // stale cost from cache. (Ralph 2026-04-22)
      const url = `/api/sessions/${sessionId}/usage?t=${Date.now()}`
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        console.log(`[UsageBadge] GET ${url} → cost=${data?.display?.cost} totals=$${data?.totals?.cost}`)
        setUsage(data)
      } else {
        console.warn(`[UsageBadge] GET ${url} → HTTP ${res.status}`)
        setUsage(null)
      }
    } catch (err) {
      console.error('[UsageBadge] fetch failed:', err)
      setUsage(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    // Bug N (Ralph 2026-05-04): refetch on billingMode change too —
    // toggling needs fresh USAGE.json so the per-mode latest snapshot
    // reflects whatever happened on the OTHER mode while we weren't
    // looking. Without this, switching CLI→API right after a CLI turn
    // would show stale 0% until the next API call completes.
    fetchUsage()
  }, [fetchUsage, refreshTrigger, billingMode])

  const handleResetClick = useCallback(async () => {
    console.log('[UsageBadge] reset button clicked, sessionId=', sessionId)
    if (!sessionId) {
      console.warn('[UsageBadge] reset aborted — no sessionId')
      return
    }
    // Native confirm dialog. One click, one prompt, one decision. No more
    // two-click arm-then-commit pattern with a 3s window that the user
    // could miss.
    const ok = window.confirm(
      `Reset the dollar / token counter for session ${sessionId}?\n\nThis zeros the displayed total but preserves the bridge cost baseline so future turns count correctly.`,
    )
    if (!ok) {
      console.log('[UsageBadge] reset cancelled by user')
      return
    }
    setResetting(true)
    try {
      const url = `/api/sessions/${sessionId}/usage`
      console.log(`[UsageBadge] DELETE ${url}`)
      const res = await fetch(url, { method: 'DELETE' })
      const text = await res.text()
      console.log(`[UsageBadge] DELETE ${url} → HTTP ${res.status} body=${text}`)
      if (!res.ok) {
        console.error('[UsageBadge] Reset failed:', text)
        window.alert(`Reset failed: HTTP ${res.status}\n${text}`)
        return
      }
      // Immediate refetch so the badge reflects the zeroed state.
      await fetchUsage()
      // Belt-and-suspenders second refetch after a beat — if something
      // racing the DELETE (a chat-stream completion, a manual edit) wrote
      // back to USAGE.json, this catches the new state too.
      await new Promise((r) => setTimeout(r, 300))
      await fetchUsage()
      console.log('[UsageBadge] reset complete')
    } catch (err) {
      console.error('[UsageBadge] Reset error:', err)
      window.alert(`Reset error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setResetting(false)
    }
  }, [sessionId, fetchUsage])

  if (!sessionId) return null

  // Restore git's context% logic exactly. Live props from CLI streaming
  // (chat-stream's 'done' event) take precedence; otherwise fall back
  // to the shared latest snapshot in USAGE.json. The same calculation
  // covers both CLI and API modes — both compute "how full is the
  // context window" against the model's window. The per-mode $ split
  // (Bug N) stays; per-mode contextPct routing was a bridge too far.
  // Ralph 2026-05-04.
  // 2026-05-04 (Ralph): per-mode context routing. CLI and API compute
  // contextPct + contextSize differently (CLI = formula with
  // cache_read/num_turns; API = last-iter sum). Storing per-mode and
  // routing here makes the toggle FLIP every value visibly: cost, %,
  // and the X/Y tokens. Without this routing the badge reads the
  // global "last entry wins" snapshot — so toggling did nothing if the
  // most recent entry was the same mode you toggled to.
  const ctxModeBlock = billingMode ? usage?.[billingMode] : undefined
  const modeContextPct = ctxModeBlock?.latestContextPct
  const modeContextSize = ctxModeBlock?.latestContextSize
  const modeContextWindow = ctxModeBlock?.latestContextWindow

  // Live props (CLI streaming only) override the stored per-mode
  // snapshot for THE CURRENT mode. We don't show stale CLI props in
  // API mode — propCached/propReal only flow when the streaming
  // endpoint is /api/chat-stream (CLI bridge).
  const useLiveProps = billingMode !== 'api' && (propCached !== undefined || propReal !== undefined)
  const effectiveContextPct = useLiveProps
    ? (propContextPct ?? 0)
    : (modeContextPct ?? usage?.display?.latestContextPct ?? 0)
  const effectiveCached = propCached ?? 0
  const effectiveReal = propReal ?? 0
  const contextColor = getContextColor(effectiveContextPct)

  // X/Y display: live props for live CLI; otherwise per-mode stored
  // values; otherwise global fallback. Window comes from the same
  // tier so CLI and API don't mix (e.g. CLI pre-Bug-L sessions might
  // have 200K stored even when current model is 1M).
  const liveContextSize = useLiveProps ? effectiveCached + effectiveReal : null
  const effectiveContextSize =
    liveContextSize ?? modeContextSize ?? usage?.display?.latestContextSize ?? 0
  const effectiveContextWindow =
    modeContextWindow ?? usage?.display?.latestContextWindow ?? 200000

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

  // Bug N (Ralph 2026-05-04): mode-specific cost. When billingMode is
  // explicitly passed in, read the matching per-mode block from the API
  // response. Falls back to the cumulative `display.cost` if the prop
  // is absent (back-compat) or the mode-specific block is missing
  // (e.g. legacy USAGE.json with no per-mode rollup yet).
  const modeBlock: ModeBlock | undefined =
    billingMode === 'cli' || billingMode === 'smpl' ? usage?.cli :
    billingMode === 'api' ? usage?.api :
    undefined
  const modeCost = modeBlock?.display?.cost
  const modeCostNumeric = modeBlock?.cost ?? 0
  const costDisplay = (modeCost ?? usage?.display?.cost ?? '$0.00').replace(/^\$/, '')
  // hasCost reflects the visible value — when a billingMode is selected,
  // it's the per-mode total; otherwise the cumulative session total.
  const hasCost = billingMode
    ? modeCostNumeric > 0
    : (usage && usage.totals.cost > 0)

  // 2026-05-03 (Ralph): hover popup ("strange overlay on hover") removed.
  // The triple ($/%/tokens) on the badge is the surface; details that used
  // to live in the hover popup can be reached from the Admin page if needed.
  return (
    <div style={{ position: 'relative' }}>
      {/* Main Badge: [ $cost | ●pct% | tokens ] — same shape for both
          modes. CLI's $ is technically a Max-plan-equivalent (Claude
          Code reports it; the user pays a flat sub), but it's still
          signal worth seeing. Toggling between CLI and API flips the
          $ value to the per-mode cumulative + the CLI/API label.
          Context% is computed by chat-stream / chat-route in their
          own code paths and surfaced via props or USAGE.json. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 12px',
        ...badgeStyle,
        borderRadius: '8px',
      }}>
        {/* Cost + mode label + Reset. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: hasCost ? 'var(--brand-green-bright)' : 'var(--text-muted)' }}>
            <DollarIcon />
          </span>
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
            color: hasCost ? 'var(--brand-green-bright)' : 'var(--text-muted)',
            letterSpacing: '-0.02em',
          }}>
            {costDisplay}
          </span>
          {/* Bug N (Ralph 2026-05-04): mode label. Visible cue that the
              displayed cost is mode-specific, not cumulative. Toggling
              billing mode flips both this label AND the cost value. */}
          {billingMode ? (
            <span style={{
              fontSize: '9px',
              fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              opacity: 0.7,
              marginLeft: 1,
            }}>
              {billingMode}
            </span>
          ) : null}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleResetClick()
            }}
            disabled={resetting}
            title={resetting ? 'Resetting…' : 'Reset dollar counter for this session'}
            style={{
              marginLeft: 2,
              width: 16,
              height: 16,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--text-dim)',
              cursor: resetting ? 'wait' : 'pointer',
              opacity: resetting ? 0.5 : 1,
              transition: 'all 0.12s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!resetting) {
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-main)'
              }
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 3v6h6" />
            </svg>
          </button>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border-card)', opacity: 0.5 }} />

        {/* Context Fill % — primary signal for "is the window getting
            full?" Same calculation in both modes (input / window).
            Colored dot turns yellow at 50%, red at 75% — that's when
            to consider Order 66 in CLI mode or accept that the next
            request might 400 in API mode. */}
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

        {/* 2026-05-04 (Ralph): standalone "cached input tokens" pill
            (formerly between % and the X/Y display) was redundant
            once the X/Y display became real "fill / window". Removed —
            the X/Y now contains the same information plus the
            denominator. Old code: <span>{formatTokensLocal(effectiveCached)}</span> */}

        {/* 2026-05-04 (Ralph): real context fill / window. Replaces the
            old cumulative cache-ratio display, which read like a context
            indicator (e.g. "9.7M / 1.6M") but was actually
            cacheReadTokens / freshInputTokens, both lifetime totals.
            That looked like the badge was reporting context state, but
            those numbers grow unboundedly — Ralph saw "9.7M / 1.6M" on
            a 1M model and rightly called it broken.

            What this shows now: per-call context fill (formula in
            chat-stream/route.ts and chat/route.ts) over the model's
            window. Lives in the same render slot. Order 66 signal in
            absolute tokens, paired with the % indicator to its left.
            Color-coded with the same threshold as the % dot. */}
        {effectiveContextSize > 0 ? (
          <>
            <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border-card)', opacity: 0.5 }} />
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              title={
                `Context fill: ${formatTokensLocal(effectiveContextSize)} of ${formatTokensLocal(effectiveContextWindow)}\n` +
                `Cache reads (lifetime): ${usage?.display?.cacheReadTokens || '0'}\n` +
                `Cache writes (lifetime): ${usage?.display?.cacheCreationTokens || '0'}\n` +
                `Fresh input (lifetime): ${usage?.display?.freshInputTokens || '0'}\n` +
                `Cache hit rate: ${usage?.display?.cacheHitPct ?? 0}%`
              }
            >
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
                color: contextColor,
                letterSpacing: '-0.02em',
              }}>
                {formatTokensLocal(effectiveContextSize)}<span style={{ opacity: 0.5 }}>/</span>{formatTokensLocal(effectiveContextWindow)}
              </span>
            </div>
          </>
        ) : null}

      </div>
    </div>
  )
}
