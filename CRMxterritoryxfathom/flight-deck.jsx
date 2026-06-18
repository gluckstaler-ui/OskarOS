// ============================================================================
// flight-deck.jsx — Consular-callable Flight Deck component
// ----------------------------------------------------------------------------
// The Consular (agent) pushes a `payload` of up to 3 prioritised actions and a
// queue count; this component renders the deck. Theme-agnostic: pass a `t`
// token object (works in both Onyx/dark and Polar/light builds). Shapes are
// chosen per-action archetype, so the deck reads as a control surface, not a
// list.
//
// ── HOW THE CONSULAR CALLS IT ───────────────────────────────────────────────
//   window.FlightDeck.render(targetEl, {
//     pushed: [
//       { leadId:'P017', company:'Caffè Sant\'Ambrogio', verb:'REPLY',
//         channel:'WhatsApp', why:'Inbound 59m ago · still warm',
//         dur:'2 MIN REPLY', deadline:'12 MIN LEFT', tone:'green', shape:'hero' },
//       … up to 3 …
//     ],
//     queueCount: 14,
//     theme: 'onyx' | 'polar',           // or pass `t` directly
//     onExecute: (action) => {…},        // EXECUTE button
//     onOpenLead: (leadId) => {…},       // card body click
//     onShowQueue: () => {…},            // "N in queue ▾"
//   });
//
// Or as a React element inside an existing tree:
//   <FlightDeck payload={payload} t={t} onExecute={…} onOpenLead={…} onShowQueue={…} />
//
// CONTRACT
//   - Max 3 actions. The component slices to 3 — the Consular prioritises.
//   - tone: 'green' (go) | 'amber' (soon) | 'red' (hot/closing)
//   - shape: 'hero' | 'dial' | 'ticket'  (Polar archetypes)
//          | 'chevron' | 'gauge' | 'tag'  (Onyx archetypes)
//     If omitted, shape is inferred from index (0→hero/chevron, 1→dial/gauge, 2→ticket/tag).
//   - dur:      DURATION  — how long the action takes  ("2 MIN REPLY")
//   - deadline: DEADLINE  — when the window closes      ("12 MIN LEFT" / "DUE TODAY")
//   - execVerb is derived from channel (PHONE → ▶ CALL, else ▶ DRAFT).
// ============================================================================

(function () {
  const { useState, useEffect, useMemo } = React;

  // Built-in themes so the Consular can pass a string instead of a token object.
  const THEMES = {
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
  };

  function resolveTheme(theme, t) {
    if (t) return t;
    return THEMES[theme] || THEMES.onyx;
  }

  const toneColor = (t, tn) => tn === 'green' ? t.phosphor : tn === 'red' ? t.red : t.amber;
  const execVerb = (channel) => /phone/i.test(channel || '') ? '▶ CALL' : '▶ DRAFT';
  const shapeFor = (a, i, family) => a.shape || (family === 'onyx'
    ? ['chevron', 'gauge', 'tag'][i] || 'tag'
    : ['hero', 'dial', 'ticket'][i] || 'ticket');

  // ── Individual card shapes ────────────────────────────────────────────────
  function HeroCard({ a, c, t, anim, onExecute, onOpenLead }) {
    return (
      <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
        border: `1px solid ${c}55`, borderTop: `3px solid ${c}`, background: `${c}1e`,
        padding: '16px 16px 14px', overflow: 'hidden', ...anim, transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 22px ${c}30`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(100deg, transparent 35%, ${c}1c 50%, transparent 65%)`, backgroundSize: '220% 100%', animation: 'tflash 2.8s linear infinite' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ font: '600 10px/1 var(--font-mono)', letterSpacing: 2, color: c }}>↑ NOW · {a.verb} · {(a.channel || '').toUpperCase()}</span>
          <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1, color: c, padding: '3px 6px', border: `1px solid ${c}55` }}>{a.deadline}</span>
        </div>
        <div style={{ position: 'relative', font: '600 22px/1.1 var(--font-sans)', color: t.bone, marginTop: 12, letterSpacing: -0.5 }}>{a.company}</div>
        <div style={{ position: 'relative', font: '400 12px/1.45 var(--font-sans)', color: t.muted, marginTop: 6 }}>{a.why}</div>
        <div style={{ position: 'relative', marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '9px 14px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
          <span style={{ font: '500 10px/1 var(--font-mono)', color: t.mutedDim, letterSpacing: 0.5 }}>{a.dur}</span>
        </div>
      </button>
    );
  }

  function DialCard({ a, c, t, anim, onExecute, onOpenLead }) {
    const R = 20, CIRC = 2 * Math.PI * R, pct = a.pct || 0.7;
    return (
      <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
        border: `1px solid ${c}55`, borderLeft: `3px solid ${c}`, background: `${c}12`,
        padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14, ...anim, transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; e.currentTarget.style.boxShadow = `0 6px 18px ${c}30`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
        <div style={{ position: 'relative', width: 50, height: 50, flexShrink: 0 }}>
          <svg width="50" height="50" viewBox="0 0 50 50" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="25" cy="25" r={R} fill="none" stroke={`${c}30`} strokeWidth="3" />
            <circle cx="25" cy="25" r={R} fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <span style={{ font: '600 13px/1 var(--font-mono)', color: c }}>{a.mins || 38}</span>
            <span style={{ font: '400 7px/1 var(--font-mono)', color: t.mutedDim, letterSpacing: 0.5, marginTop: 2 }}>MIN</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4, color: c }}>{a.verb} · {(a.channel || '').toUpperCase()}</span>
            <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1, color: c, padding: '3px 6px', border: `1px solid ${c}55` }}>{a.deadline}</span>
          </div>
          <div style={{ font: '500 14px/1.2 var(--font-sans)', color: t.bone, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
          <div style={{ font: '400 11px/1.4 var(--font-sans)', color: t.muted, marginTop: 4 }}>{a.why}</div>
          <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '7px 11px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
            <span style={{ font: '500 9px/1 var(--font-mono)', color: t.mutedDim }}>{a.dur}</span>
          </div>
        </div>
      </button>
    );
  }

  function TicketCard({ a, c, t, anim, onExecute, onOpenLead }) {
    return (
      <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
        border: `1px dashed ${c}55`, background: `${c}0c`,
        padding: '10px 14px 10px 28px', display: 'flex', alignItems: 'flex-start', gap: 10, ...anim, transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; e.currentTarget.style.boxShadow = `0 5px 14px ${c}26`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
        <span style={{ position: 'absolute', left: 9, top: 0, bottom: 0, width: 4, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center' }}>
          {Array.from({ length: 5 }).map((_, d) => <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: `${c}66` }} />)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: c }}>{a.verb} · {(a.channel || '').toUpperCase()}</span>
            <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1, color: c }}>{a.deadline}</span>
          </div>
          <div style={{ font: '500 13px/1.2 var(--font-sans)', color: t.bone, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
          <div style={{ font: '400 10.5px/1.3 var(--font-sans)', color: t.muted, marginTop: 3 }}>{a.why}</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '6px 10px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
            <span style={{ font: '500 9px/1 var(--font-mono)', color: t.mutedDim }}>{a.dur}</span>
          </div>
        </div>
      </button>
    );
  }

  function ChevronCard({ a, c, t, anim, onExecute, onOpenLead }) {
    return (
      <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
        background: `${c}16`, border: `1px solid ${c}55`,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
        padding: '13px 15px 15px', overflow: 'hidden', ...anim, transition: 'background 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.background = `${c}24`}
        onMouseLeave={e => e.currentTarget.style.background = `${c}16`}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(100deg, transparent 35%, ${c}1c 50%, transparent 65%)`, backgroundSize: '220% 100%', animation: 'tflash 2.8s linear infinite' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ font: '600 10px/1 var(--font-mono)', letterSpacing: 2, color: c }}>▸▸ TOP PRIORITY</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}`, animation: 'tblink 1.3s infinite' }} />
            <span style={{ font: '500 10px/1 var(--font-mono)', color: c }}>{a.deadline}</span>
          </span>
        </div>
        <div style={{ position: 'relative', font: '600 19px/1.1 var(--font-sans)', color: t.bone, marginTop: 10, letterSpacing: -0.4 }}>{a.company}</div>
        <div style={{ position: 'relative', font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4, color: c, marginTop: 6 }}>{a.verb} · {a.channel}</div>
        <div style={{ position: 'relative', font: '400 11px/1.4 var(--font-sans)', color: t.muted, marginTop: 6 }}>{a.why}</div>
        <div style={{ position: 'relative', marginTop: 11, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '7px 11px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
          <span style={{ font: '500 9px/1 var(--font-mono)', color: t.mutedDim }}>{a.dur}</span>
        </div>
      </button>
    );
  }

  function GaugeCard({ a, c, t, anim, onExecute, onOpenLead }) {
    const segs = 20, lit = Math.round((a.pct || 0.7) * segs);
    return (
      <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
        background: 'transparent', border: `1px solid ${c}40`, borderLeft: `2px solid ${c}`,
        padding: '11px 13px', ...anim, transition: 'background 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.background = `${c}12`}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4, color: c }}>{a.verb}</span>
          <span style={{ font: '400 9px/1 var(--font-mono)', color: t.mutedDim, letterSpacing: 1 }}>· {a.channel}</span>
          <span style={{ flex: 1 }} />
          <span style={{ font: '600 11px/1 var(--font-mono)', color: c }}>{a.deadline}</span>
        </div>
        <div style={{ font: '500 14px/1.2 var(--font-sans)', color: t.bone, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
        <div style={{ display: 'flex', gap: 2, marginTop: 9 }}>
          {Array.from({ length: segs }).map((_, s) => {
            const on = s < lit, head = s === lit - 1;
            return <span key={s} style={{ flex: 1, height: 6, background: on ? c : t.lineDim, opacity: on ? (head ? 1 : 0.4 + 0.5 * (s / segs)) : 1, boxShadow: head ? `0 0 6px ${c}` : 'none', animation: head ? 'tpulse 1s infinite' : 'none' }} />;
          })}
        </div>
        <div style={{ font: '400 11px/1.4 var(--font-sans)', color: t.muted, marginTop: 8 }}>{a.why}</div>
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '7px 11px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
          <span style={{ font: '500 9px/1 var(--font-mono)', color: t.mutedDim }}>{a.dur}</span>
        </div>
      </button>
    );
  }

  function TagCard({ a, c, t, anim, onExecute, onOpenLead }) {
    return (
      <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
        background: 'transparent', border: `1px dashed ${c}55`,
        clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px)',
        padding: '9px 13px 9px 16px', display: 'flex', alignItems: 'flex-start', gap: 10, ...anim, transition: 'background 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.background = `${c}10`}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <span style={{ width: 8, height: 8, flexShrink: 0, marginTop: 3, border: `1px solid ${c}`, transform: 'rotate(45deg)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: c }}>{a.verb} · {a.channel}</span>
            <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1, color: c }}>{a.deadline}</span>
          </div>
          <div style={{ font: '500 13px/1.2 var(--font-sans)', color: t.bone, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
          <div style={{ font: '400 10.5px/1.3 var(--font-sans)', color: t.muted, marginTop: 3 }}>{a.why}</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '6px 10px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
            <span style={{ font: '500 9px/1 var(--font-mono)', color: t.mutedDim }}>{a.dur}</span>
          </div>
        </div>
      </button>
    );
  }

  const SHAPES = { hero: HeroCard, dial: DialCard, ticket: TicketCard, chevron: ChevronCard, gauge: GaugeCard, tag: TagCard, agenda: AgendaCard, soft: SoftCard, propose: ProposeCard, ledger: LedgerCard };

  // ── PROPOSE CARD — confirm a tentative meeting. An ACCEPT, not an attend. ──
  // Expects: { company, contact, leadId, slots:['Tue 10:30','Wed 14:00'], kind,
  //            why, tone (default green) }
  function ProposeCard({ a, c, t, anim, onExecute, onOpenLead }) {
    const slots = a.slots || ['Tue 10:30'];
    return (
      <div style={{
        position: 'relative', font: 'inherit', color: t.bone,
        border: `1px solid ${c}55`, borderLeft: `3px solid ${c}`,
        background: `${c}10`, padding: '12px 14px', ...anim,
      }}>
        <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
          background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left', width: '100%',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: c }}>⇄ THEY PROPOSED · {a.kind || 'MEETING'}</span>
            <span style={{ font: '400 9px/1 var(--font-mono)', color: t.mutedDim }}>awaiting your yes</span>
          </div>
          <div style={{ font: '500 14px/1.2 var(--font-sans)', color: t.bone, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
          {a.why && <div style={{ font: '400 11px/1.4 var(--font-sans)', color: t.muted, marginTop: 4 }}>{a.why}</div>}
        </button>
        {/* proposed slots — tap to lock */}
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {slots.map((s, i) => (
            <span key={i} onClick={e => { e.stopPropagation(); onExecute && onExecute({ ...a, accepted: s }); }} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              font: '600 10px/1 var(--font-mono)', letterSpacing: 0.5,
              color: i === 0 ? t.onAccent : c, background: i === 0 ? c : 'transparent',
              border: `1px solid ${c}`, padding: '7px 11px', cursor: 'pointer',
            }}>{i === 0 ? '✓ ' : ''}{s}</span>
          ))}
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute({ ...a, accepted: 'other' }); }} style={{
            font: '500 10px/1 var(--font-mono)', letterSpacing: 0.5, color: t.mutedDim,
            border: `1px dashed ${t.lineDim}`, padding: '7px 11px', cursor: 'pointer',
          }}>propose other</span>
        </div>
      </div>
    );
  }

  // ── LEDGER CARD — collect overdue payment. Revenue booked, cash not in. ────
  // Expects: { company, leadId, amount:"14'200", invoice:'INV-2041',
  //            overdueDays:12, why, tone (default red) }
  function LedgerCard({ a, c, t, anim, onExecute, onOpenLead }) {
    return (
      <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
        border: `1px solid ${c}55`, background: `${c}10`,
        padding: '12px 14px 12px 16px', overflow: 'hidden', ...anim, transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = `${c}1a`}
      onMouseLeave={e => e.currentTarget.style.background = `${c}10`}>
        {/* perforated invoice top edge */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundImage: `repeating-linear-gradient(90deg, ${c} 0 4px, transparent 4px 8px)`, backgroundSize: '8px 100%', opacity: 0.6 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: c }}>⚑ PAYMENT OVERDUE</span>
          <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1, color: c, padding: '3px 6px', border: `1px solid ${c}55` }}>+{a.overdueDays}D LATE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
          <span style={{ font: '300 24px/1 var(--font-mono)', color: c, letterSpacing: -1 }}>CHF {a.amount}</span>
          <span style={{ font: '400 9px/1 var(--font-mono)', color: t.mutedDim }}>{a.invoice}</span>
        </div>
        <div style={{ font: '500 13px/1.2 var(--font-sans)', color: t.bone, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
        {a.why && <div style={{ font: '400 11px/1.4 var(--font-sans)', color: t.muted, marginTop: 4 }}>{a.why}</div>}
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute({ ...a, mode: 'remind' }); }} style={{ display: 'inline-flex', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: t.onAccent, background: c, padding: '7px 11px', textTransform: 'uppercase' }}>▶ SEND REMINDER</span>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute({ ...a, mode: 'resend' }); }} style={{ display: 'inline-flex', font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: c, border: `1px solid ${c}55`, padding: '7px 11px', textTransform: 'uppercase' }}>RESEND INVOICE</span>
        </div>
      </button>
    );
  }

  // ── AGENDA RAIL — scheduled event. Fixed clock time, not a countdown. ──────
  // Expects: { at:'10:30', kind:'DEMO'|'MEETING'|'CALL', company, where, leadId,
  //            nowPct:0..1 (how far the day has progressed toward this slot) }
  function AgendaCard({ a, c, t, anim, onExecute, onOpenLead }) {
    const cyan = t.cyan || '#5cd6e0';
    const nowPct = Math.max(0, Math.min(1, a.nowPct != null ? a.nowPct : 0.4));
    return (
      <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
        position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
        border: `1px solid ${cyan}44`, borderLeft: `1px solid ${cyan}44`,
        background: `${cyan}0e`, display: 'flex', gap: 0, overflow: 'hidden',
        ...anim, transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = `${cyan}18`}
      onMouseLeave={e => e.currentTarget.style.background = `${cyan}0e`}>
        {/* time gutter + spine */}
        <div style={{ position: 'relative', width: 64, flexShrink: 0, padding: '13px 0 13px 14px', borderRight: `1px solid ${cyan}33` }}>
          <div style={{ font: '500 18px/1 var(--font-mono)', color: cyan, letterSpacing: -0.5 }}>{a.at}</div>
          <div style={{ font: '400 8px/1 var(--font-mono)', color: t.mutedDim, letterSpacing: 1, marginTop: 4 }}>FIXED</div>
          {/* spine with creeping "now" head */}
          <div style={{ position: 'absolute', right: -1, top: 0, bottom: 0, width: 1, background: `${cyan}33` }}>
            <span style={{ position: 'absolute', left: -2.5, top: `${nowPct * 100}%`, width: 6, height: 6, borderRadius: '50%', background: cyan, boxShadow: `0 0 8px ${cyan}`, animation: 'tpulse 2s infinite' }} />
          </div>
        </div>
        {/* body */}
        <div style={{ flex: 1, minWidth: 0, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: cyan }}>◫ {a.kind || 'MEETING'}</span>
            {a.where && <span style={{ font: '400 9px/1 var(--font-mono)', color: t.mutedDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{a.where}</span>}
          </div>
          <div style={{ font: '500 14px/1.2 var(--font-sans)', color: t.bone, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
          {a.why && <div style={{ font: '400 11px/1.4 var(--font-sans)', color: t.muted, marginTop: 4 }}>{a.why}</div>}
          <div style={{ marginTop: 9, display: 'flex', gap: 8 }}>
            <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a); }} style={{ display: 'inline-flex', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: t.onAccent, background: cyan, padding: '6px 10px', textTransform: 'uppercase' }}>▶ JOIN</span>
            <span style={{ display: 'inline-flex', font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: cyan, border: `1px solid ${cyan}55`, padding: '6px 10px', textTransform: 'uppercase' }}>PREP</span>
          </div>
        </div>
      </button>
    );
  }

  // ── SOFT CARD — relationship touch. Lowest urgency, highest humanity. ──────
  // Expects: { company, contact, occasion:'turns 52 today'|'1yr since first contact',
  //            leadId, onDismiss? }
  function SoftCard({ a, c, t, anim, onExecute, onOpenLead, onDismiss }) {
    const warm = t.amber;
    return (
      <div style={{
        position: 'relative', font: 'inherit', color: t.bone,
        border: `1px solid ${t.lineDim}`, borderRadius: 14,
        background: t.bgCard, padding: '13px 15px',
        display: 'flex', alignItems: 'center', gap: 12,
        ...anim, transition: 'background 0.15s',
      }}>
        <span style={{
          width: 30, height: 30, flexShrink: 0, borderRadius: '50%',
          border: `1px solid ${warm}55`, background: `${warm}14`, color: warm,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          font: '500 14px/1 var(--font-sans)',
        }}>♡</span>
        <button onClick={() => onOpenLead && onOpenLead(a.leadId)} style={{
          flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0,
        }}>
          <div style={{ font: '400 9px/1 var(--font-mono)', letterSpacing: 1.2, color: t.mutedDim, textTransform: 'uppercase' }}>A HUMAN MOMENT</div>
          <div style={{ font: '500 14px/1.3 var(--font-sans)', color: t.bone, marginTop: 5 }}>
            {a.contact || a.company} <span style={{ color: t.muted, fontWeight: 400 }}>{a.occasion}</span>
          </div>
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
          <span onClick={e => { e.stopPropagation(); onExecute && onExecute(a); }} style={{ display: 'inline-flex', justifyContent: 'center', font: '600 9px/1 var(--font-mono)', letterSpacing: 1.2, color: warm, border: `1px solid ${warm}55`, padding: '6px 10px', textTransform: 'uppercase', cursor: 'pointer' }}>Send a note</span>
          <span onClick={e => { e.stopPropagation(); onDismiss && onDismiss(a); }} style={{ display: 'inline-flex', justifyContent: 'center', font: '400 8px/1 var(--font-mono)', letterSpacing: 1, color: t.mutedDim, cursor: 'pointer' }}>dismiss</span>
        </div>
      </div>
    );
  }

  // ── The deck ────────────────────────────────────────────────────────────
  function FlightDeck({ payload, theme, t: tProp, onExecute, onOpenLead, onShowQueue }) {
    const t = resolveTheme(theme || (payload && payload.theme), tProp);
    const family = (theme || (payload && payload.theme)) === 'polar' || t.bg === '#ffffff' ? 'polar' : 'onyx';
    const pushed = ((payload && payload.pushed) || []).slice(0, 7);
    const queueCount = (payload && payload.queueCount) != null ? payload.queueCount : 0;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', borderBottom: `1px solid ${t.line}`, background: t.bg, flexShrink: 0, position: 'relative' }}>
        {family === 'onyx' && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,184,74,0.03) 0 1px, transparent 1px 3px)' }} />
        )}
        {/* Header */}
        <div style={{ position: 'relative', zIndex: 3, padding: '13px 18px 11px', borderBottom: `1px solid ${t.lineDim}`, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(100deg, transparent 30%, ${t.phosphor}12 50%, transparent 70%)`, backgroundSize: '220% 100%', animation: 'tflash 3.5s linear infinite' }} />
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 25, height: 25, background: `${t.phosphor}20`, border: `1px solid ${t.phosphor}`, color: t.phosphor, font: '600 11px/1 var(--font-mono)', animation: 'tpulse 2s infinite' }}>✦</span>
          <div style={{ flex: 1, position: 'relative' }}>
            <div style={{ font: '600 11px/1 var(--font-mono)', letterSpacing: 1.5, color: family === 'onyx' ? t.amber : t.bone, textTransform: 'uppercase' }}>{family === 'onyx' ? '▸ FLIGHT DECK' : 'FLIGHT DECK'}</div>
            <div style={{ font: '400 9px/1 var(--font-mono)', color: t.mutedDim, marginTop: 4, letterSpacing: 0.7 }}>
              CONSULAR PUSHED {pushed.length} · <button onClick={() => onShowQueue && onShowQueue()} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: t.amber, cursor: 'pointer', letterSpacing: 0.7 }}>{queueCount} IN QUEUE ▾</button>
            </div>
          </div>
          <span style={{ position: 'relative', width: 7, height: 7, borderRadius: family === 'onyx' ? 0 : '50%', background: t.phosphor, boxShadow: `0 0 8px ${t.phosphor}`, animation: 'tblink 1.4s infinite' }} />
          <span style={{ position: 'relative', font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2, color: t.phosphor }}>LIVE</span>
        </div>
        {/* Cards */}
        <div style={{ position: 'relative', zIndex: 3, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pushed.map((a, i) => {
            const c = toneColor(t, a.tone);
            const anim = { animation: `triseup 0.5s cubic-bezier(.2,.7,.3,1) ${0.1 + i * 0.1}s both` };
            const Card = SHAPES[shapeFor(a, i, family)] || SHAPES.tag;
            return <Card key={a.leadId || i} a={a} c={c} t={t} anim={anim} onExecute={onExecute} onOpenLead={onOpenLead} />;
          })}
        </div>
      </div>
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function render(targetEl, opts) {
    const el = typeof targetEl === 'string' ? document.querySelector(targetEl) : targetEl;
    if (!el) { console.warn('[FlightDeck] target not found'); return; }
    const root = ReactDOM.createRoot(el);
    root.render(
      <FlightDeck
        payload={opts}
        theme={opts.theme}
        t={opts.t}
        onExecute={opts.onExecute}
        onOpenLead={opts.onOpenLead}
        onShowQueue={opts.onShowQueue}
      />
    );
    return root;
  }

  window.FlightDeck = FlightDeck;        // React component
  window.FlightDeck.render = render;     // imperative Consular entry point
  window.FlightDeck.THEMES = THEMES;
})();
