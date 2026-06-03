'use client'

// ============================================================================
// FlightDeck.tsx — Consular-steered Flight Deck, React port of
// public/__crm__/flight-deck.jsx (Ralph 2026-05-29).
//
// The vanilla original was a Babel-in-browser IIFE that set window.FlightDeck
// and was mounted into a <div> by crm.html's crmRenderFlightDeck(). The React
// /crm can't load it that way, so this is a faithful 1:1 port to a real
// component — same 6 shapes, same onyx+polar token tables, same shapeFor /
// toneColor / execVerb, slice-to-6 contract (Consular picks 1–6). Rendered in
// app/crm/page.tsx's .fp-right column, above the studio <ConversationPanel/>.
//
// One improvement over the original: the four CSS keyframes the cards animate
// against (tflash/tblink/tpulse/triseup) are injected by the component itself.
// In the vanilla page they lived in territoryxfathom2/styles.css and were NOT
// present in crm.html / crm.css — so the deck's shimmer/pulse were silently
// dead. Carrying them here makes the deck self-contained.
//
// HOW THE CONSULAR STEERS IT
//   The Consular writes its picks to `public/__crm__/deck.json` (file-as-API —
//   no MCP tool, no iframe); the /crm page fetches `/__crm__/deck.json` and
//   feeds the picks in as `pushed`. Falls back to the live overdue queue.
// ============================================================================

import { useEffect } from 'react'

export type DeckTone = 'green' | 'amber' | 'red'
export type DeckShape = 'hero' | 'dial' | 'ticket' | 'chevron' | 'gauge' | 'tag'

/** One prioritised action the Consular pushes onto the deck. */
export interface FlightDeckAction {
  leadId?: string
  company?: string
  /** Short imperative — CLOSE / CALL / CHASE / REPLY / SEND. */
  verb?: string
  /** WhatsApp / Phone / Email — drives the EXECUTE verb (CALL vs DRAFT). */
  channel?: string
  /** One-line rationale in the Consular's voice. */
  why?: string
  /** DURATION — how long the action takes ("2 MIN MESSAGE"). */
  dur?: string
  /** DEADLINE — when the window closes ("6D QUIET" / "DUE TODAY"). */
  deadline?: string
  tone?: DeckTone
  /** Explicit archetype; falls back to index-based default when omitted. */
  shape?: DeckShape
  /** 0..1 confidence — drives DialCard ring + GaugeCard fill. */
  pct?: number
  /** Minutes label inside DialCard. */
  mins?: number
}

interface ThemeTokens {
  bg: string; bgCard: string; line: string; lineDim: string
  amber: string; phosphor: string; red: string
  bone: string; muted: string; mutedDim: string; onAccent: string
  register: string
}

export interface FlightDeckProps {
  /** Up to 6 — the component slices; the Consular chooses how many (1–6). */
  pushed: FlightDeckAction[]
  queueCount?: number
  theme?: 'onyx' | 'polar'
  /** Direct token override (rare); otherwise resolved from `theme`. */
  t?: ThemeTokens
  onExecute?: (a: FlightDeckAction) => void
  onOpenLead?: (leadId?: string) => void
  onShowQueue?: () => void
}

// Built-in themes so callers can pass a string instead of a token object.
const THEMES: Record<'onyx' | 'polar', ThemeTokens> = {
  onyx: {
    bg: '#0a0907', bgCard: '#13110d', line: '#2a2519', lineDim: '#1a160f',
    amber: '#ffb84a', phosphor: '#c8ee7a', red: '#ff6a4d',
    bone: '#ece1c5', muted: '#7a6f5a', mutedDim: '#42392a', onAccent: '#0a0805',
    register: 'upper',
  },
  polar: {
    bg: '#ffffff', bgCard: '#f7f2e2', line: '#806a3a', lineDim: '#d0c098',
    amber: '#e89e16', phosphor: '#2a9818', red: '#d62012',
    bone: '#1a1408', muted: '#453620', mutedDim: '#a09078', onAccent: '#ffffff',
    register: 'title',
  },
}

function resolveTheme(theme?: 'onyx' | 'polar', t?: ThemeTokens): ThemeTokens {
  if (t) return t
  return (theme && THEMES[theme]) || THEMES.onyx
}

const toneColor = (t: ThemeTokens, tn?: DeckTone) =>
  tn === 'green' ? t.phosphor : tn === 'red' ? t.red : t.amber
const execVerb = (channel?: string) => (/phone/i.test(channel || '') ? '▶ CALL' : '▶ DRAFT')
const shapeFor = (a: FlightDeckAction, i: number, family: 'onyx' | 'polar'): DeckShape =>
  a.shape ||
  (family === 'onyx'
    ? (['chevron', 'gauge', 'tag'][i] as DeckShape) || 'tag'
    : (['hero', 'dial', 'ticket'][i] as DeckShape) || 'ticket')

// The four keyframes the cards animate against — injected once into <head>.
const KEYFRAMES = `
@keyframes tflash { 0% { background-position: -120% 0; } 100% { background-position: 220% 0; } }
@keyframes tblink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0.25; } }
@keyframes tpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes triseup { 0% { opacity: 0; transform: translateY(8px); } 100% { opacity: 1; transform: translateY(0); } }
`
let keyframesInjected = false
function useDeckKeyframes() {
  useEffect(() => {
    if (keyframesInjected || typeof document === 'undefined') return
    const el = document.createElement('style')
    el.setAttribute('data-flight-deck-keyframes', '')
    el.textContent = KEYFRAMES
    document.head.appendChild(el)
    keyframesInjected = true
  }, [])
}

interface CardProps {
  a: FlightDeckAction
  c: string
  t: ThemeTokens
  anim: React.CSSProperties
  onExecute?: (a: FlightDeckAction) => void
  onOpenLead?: (leadId?: string) => void
}

// ── Individual card shapes ──────────────────────────────────────────────────
function HeroCard({ a, c, t, anim, onExecute, onOpenLead }: CardProps) {
  return (
    <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
      position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
      border: `1px solid ${c}55`, borderTop: `3px solid ${c}`, background: `${c}1e`,
      padding: '16px 16px 14px', overflow: 'hidden', ...anim, transition: 'transform 0.15s, box-shadow 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 22px ${c}30` }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(100deg, transparent 35%, ${c}1c 50%, transparent 65%)`, backgroundSize: '220% 100%', animation: 'tflash 2.8s linear infinite' }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ font: '600 10px/1 "JetBrains Mono", monospace', letterSpacing: 2, color: c }}>↑ NOW · {a.verb} · {(a.channel || '').toUpperCase()}</span>
        <span style={{ font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1, color: c, padding: '3px 6px', border: `1px solid ${c}55` }}>{a.deadline}</span>
      </div>
      <div style={{ position: 'relative', font: '600 22px/1.1 "Inter", system-ui, sans-serif', color: t.bone, marginTop: 12, letterSpacing: -0.5 }}>{a.company}</div>
      <div style={{ position: 'relative', font: '400 12px/1.45 "Inter", system-ui, sans-serif', color: t.muted, marginTop: 6 }}>{a.why}</div>
      <div style={{ position: 'relative', marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 10px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '9px 14px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
        <span style={{ font: '500 10px/1 "JetBrains Mono", monospace', color: t.mutedDim, letterSpacing: 0.5 }}>{a.dur}</span>
      </div>
    </button>
  )
}

function DialCard({ a, c, t, anim, onExecute, onOpenLead }: CardProps) {
  const R = 20, CIRC = 2 * Math.PI * R, pct = a.pct || 0.7
  return (
    <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
      position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
      border: `1px solid ${c}55`, borderLeft: `3px solid ${c}`, background: `${c}12`,
      padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14, ...anim, transition: 'transform 0.15s, box-shadow 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; e.currentTarget.style.boxShadow = `0 6px 18px ${c}30` }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}>
      <div style={{ position: 'relative', width: 50, height: 50, flexShrink: 0 }}>
        <svg width="50" height="50" viewBox="0 0 50 50" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="25" cy="25" r={R} fill="none" stroke={`${c}30`} strokeWidth="3" />
          <circle cx="25" cy="25" r={R} fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ font: '600 13px/1 "JetBrains Mono", monospace', color: c }}>{a.mins || 38}</span>
          <span style={{ font: '400 7px/1 "JetBrains Mono", monospace', color: t.mutedDim, letterSpacing: 0.5, marginTop: 2 }}>MIN</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ font: '600 10px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: c }}>{a.verb} · {(a.channel || '').toUpperCase()}</span>
          <span style={{ font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1, color: c, padding: '3px 6px', border: `1px solid ${c}55` }}>{a.deadline}</span>
        </div>
        <div style={{ font: '500 14px/1.2 "Inter", system-ui, sans-serif', color: t.bone, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
        <div style={{ font: '400 11px/1.4 "Inter", system-ui, sans-serif', color: t.muted, marginTop: 4 }}>{a.why}</div>
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '7px 11px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
          <span style={{ font: '500 9px/1 "JetBrains Mono", monospace', color: t.mutedDim }}>{a.dur}</span>
        </div>
      </div>
    </button>
  )
}

function TicketCard({ a, c, t, anim, onExecute, onOpenLead }: CardProps) {
  return (
    <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
      position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
      border: `1px dashed ${c}55`, background: `${c}0c`,
      padding: '10px 14px 10px 28px', display: 'flex', alignItems: 'flex-start', gap: 10, ...anim, transition: 'transform 0.15s, box-shadow 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; e.currentTarget.style.boxShadow = `0 5px 14px ${c}26` }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}>
      <span style={{ position: 'absolute', left: 9, top: 0, bottom: 0, width: 4, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center' }}>
        {Array.from({ length: 5 }).map((_, d) => <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: `${c}66` }} />)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: c }}>{a.verb} · {(a.channel || '').toUpperCase()}</span>
          <span style={{ font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1, color: c }}>{a.deadline}</span>
        </div>
        <div style={{ font: '500 13px/1.2 "Inter", system-ui, sans-serif', color: t.bone, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
        <div style={{ font: '400 10.5px/1.3 "Inter", system-ui, sans-serif', color: t.muted, marginTop: 3 }}>{a.why}</div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '6px 10px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
          <span style={{ font: '500 9px/1 "JetBrains Mono", monospace', color: t.mutedDim }}>{a.dur}</span>
        </div>
      </div>
    </button>
  )
}

function ChevronCard({ a, c, t, anim, onExecute, onOpenLead }: CardProps) {
  return (
    <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
      position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
      background: `${c}16`, border: `1px solid ${c}55`,
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
      padding: '13px 15px 15px', overflow: 'hidden', ...anim, transition: 'background 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = `${c}24` }}
      onMouseLeave={e => { e.currentTarget.style.background = `${c}16` }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(100deg, transparent 35%, ${c}1c 50%, transparent 65%)`, backgroundSize: '220% 100%', animation: 'tflash 2.8s linear infinite' }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ font: '600 10px/1 "JetBrains Mono", monospace', letterSpacing: 2, color: c }}>▸▸ TOP PRIORITY</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}`, animation: 'tblink 1.3s infinite' }} />
          <span style={{ font: '500 10px/1 "JetBrains Mono", monospace', color: c }}>{a.deadline}</span>
        </span>
      </div>
      <div style={{ position: 'relative', font: '600 19px/1.1 "Inter", system-ui, sans-serif', color: t.bone, marginTop: 10, letterSpacing: -0.4 }}>{a.company}</div>
      <div style={{ position: 'relative', font: '600 10px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: c, marginTop: 6 }}>{a.verb} · {a.channel}</div>
      <div style={{ position: 'relative', font: '400 11px/1.4 "Inter", system-ui, sans-serif', color: t.muted, marginTop: 6 }}>{a.why}</div>
      <div style={{ position: 'relative', marginTop: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '7px 11px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
        <span style={{ font: '500 9px/1 "JetBrains Mono", monospace', color: t.mutedDim }}>{a.dur}</span>
      </div>
    </button>
  )
}

function GaugeCard({ a, c, t, anim, onExecute, onOpenLead }: CardProps) {
  const segs = 20, lit = Math.round((a.pct || 0.7) * segs)
  return (
    <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
      position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
      background: 'transparent', border: `1px solid ${c}40`, borderLeft: `2px solid ${c}`,
      padding: '11px 13px', ...anim, transition: 'background 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = `${c}12` }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: '600 10px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: c }}>{a.verb}</span>
        <span style={{ font: '400 9px/1 "JetBrains Mono", monospace', color: t.mutedDim, letterSpacing: 1 }}>· {a.channel}</span>
        <span style={{ flex: 1 }} />
        <span style={{ font: '600 11px/1 "JetBrains Mono", monospace', color: c }}>{a.deadline}</span>
      </div>
      <div style={{ font: '500 14px/1.2 "Inter", system-ui, sans-serif', color: t.bone, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
      <div style={{ display: 'flex', gap: 2, marginTop: 9 }}>
        {Array.from({ length: segs }).map((_, s) => {
          const on = s < lit, head = s === lit - 1
          return <span key={s} style={{ flex: 1, height: 6, background: on ? c : t.lineDim, opacity: on ? (head ? 1 : 0.4 + 0.5 * (s / segs)) : 1, boxShadow: head ? `0 0 6px ${c}` : 'none', animation: head ? 'tpulse 1s infinite' : 'none' }} />
        })}
      </div>
      <div style={{ font: '400 11px/1.4 "Inter", system-ui, sans-serif', color: t.muted, marginTop: 8 }}>{a.why}</div>
      <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '7px 11px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
        <span style={{ font: '500 9px/1 "JetBrains Mono", monospace', color: t.mutedDim }}>{a.dur}</span>
      </div>
    </button>
  )
}

function TagCard({ a, c, t, anim, onExecute, onOpenLead }: CardProps) {
  return (
    <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
      position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
      background: 'transparent', border: `1px dashed ${c}55`,
      clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px)',
      padding: '9px 13px 9px 16px', display: 'flex', alignItems: 'flex-start', gap: 10, ...anim, transition: 'background 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = `${c}10` }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <span style={{ width: 8, height: 8, flexShrink: 0, marginTop: 3, border: `1px solid ${c}`, transform: 'rotate(45deg)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: c }}>{a.verb} · {a.channel}</span>
          <span style={{ font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1, color: c }}>{a.deadline}</span>
        </div>
        <div style={{ font: '500 13px/1.2 "Inter", system-ui, sans-serif', color: t.bone, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
        <div style={{ font: '400 10.5px/1.3 "Inter", system-ui, sans-serif', color: t.muted, marginTop: 3 }}>{a.why}</div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 "JetBrains Mono", monospace', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '6px 10px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
          <span style={{ font: '500 9px/1 "JetBrains Mono", monospace', color: t.mutedDim }}>{a.dur}</span>
        </div>
      </div>
    </button>
  )
}

const SHAPES: Record<DeckShape, (p: CardProps) => React.JSX.Element> = {
  hero: HeroCard, dial: DialCard, ticket: TicketCard, chevron: ChevronCard, gauge: GaugeCard, tag: TagCard,
}

// ── The deck ────────────────────────────────────────────────────────────────
export function FlightDeck({ pushed, queueCount, theme, t: tProp, onExecute, onOpenLead, onShowQueue }: FlightDeckProps) {
  useDeckKeyframes()
  const t = resolveTheme(theme, tProp)
  const family: 'onyx' | 'polar' = theme === 'polar' || t.bg === '#ffffff' ? 'polar' : 'onyx'
  const picks = (pushed || []).slice(0, 6)
  const qc = queueCount != null ? queueCount : 0

  // Empty drive — keep the header (so the surface reads as "the Consular hasn't
  // pushed yet") but render nothing below. Never a blank rectangle.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: `1px solid ${t.line}`, background: t.bg, flexShrink: 0, position: 'relative' }}>
      {family === 'onyx' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,184,74,0.03) 0 1px, transparent 1px 3px)' }} />
      )}
      {/* Header */}
      <div style={{ position: 'relative', zIndex: 3, padding: '13px 18px 11px', borderBottom: `1px solid ${t.lineDim}`, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(100deg, transparent 30%, ${t.phosphor}12 50%, transparent 70%)`, backgroundSize: '220% 100%', animation: 'tflash 3.5s linear infinite' }} />
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 25, height: 25, background: `${t.phosphor}20`, border: `1px solid ${t.phosphor}`, color: t.phosphor, font: '600 11px/1 "JetBrains Mono", monospace', animation: 'tpulse 2s infinite' }}>✦</span>
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ font: '600 11px/1 "JetBrains Mono", monospace', letterSpacing: 1.5, color: family === 'onyx' ? t.amber : t.bone, textTransform: 'uppercase' }}>{family === 'onyx' ? '▸ FLIGHT DECK' : 'FLIGHT DECK'}</div>
          <div style={{ font: '400 9px/1 "JetBrains Mono", monospace', color: t.mutedDim, marginTop: 4, letterSpacing: 0.7 }}>
            CONSULAR PUSHED {picks.length} · <button onClick={() => onShowQueue && onShowQueue()} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: t.amber, cursor: 'pointer', letterSpacing: 0.7 }}>{qc} IN QUEUE ▾</button>
          </div>
        </div>
        <span style={{ position: 'relative', width: 7, height: 7, borderRadius: family === 'onyx' ? 0 : '50%', background: t.phosphor, boxShadow: `0 0 8px ${t.phosphor}`, animation: 'tblink 1.4s infinite' }} />
        <span style={{ position: 'relative', font: '500 9px/1 "JetBrains Mono", monospace', letterSpacing: 1.2, color: t.phosphor }}>LIVE</span>
      </div>
      {/* Cards */}
      {picks.length > 0 && (
        <div style={{ position: 'relative', zIndex: 3, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {picks.map((a, i) => {
            const c = toneColor(t, a.tone)
            const anim: React.CSSProperties = { animation: `triseup 0.5s cubic-bezier(.2,.7,.3,1) ${0.1 + i * 0.1}s both` }
            const Card = SHAPES[shapeFor(a, i, family)] || SHAPES.tag
            return <Card key={a.leadId || i} a={a} c={c} t={t} anim={anim} onExecute={onExecute} onOpenLead={onOpenLead} />
          })}
        </div>
      )}
    </div>
  )
}

export default FlightDeck
