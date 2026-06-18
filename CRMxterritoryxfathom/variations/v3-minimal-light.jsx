// Variation C — "FOCUSED PHOSPHOR"
// Minimal-tactical. Lots of negative space. One huge "next move" card.
// Single accent (amber). Calm progressive detail view.
// Inter + JetBrains Mono.

(function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const D = window.CRMData;

  const t = {
    bg:        '#ffffff',
    bgElev:    '#ffffff',
    bgSurf:    '#ede2c4',
    bgCard:    '#f7f2e2',
    line:      '#806a3a',
    lineDim:   '#d0c098',
    amber:     '#e89e16',
    amberHi:   '#dca612',
    amberDim:  '#8a5a18',
    phosphor:  '#1f880e',
    cyan:      '#1a6470',
    red:       '#d62012',
    bone:      '#1a1408',
    muted:     '#453620',
    mutedDim:  '#a09078',
  };

  function L({ children, c = t.muted, sz = 10, w = 500, ls = 1.5, style }) {
    return <span style={{ font: `${w} ${sz}px/1 var(--font-mono)`, letterSpacing: ls, textTransform: 'uppercase', color: c, ...style }}>{children}</span>;
  }
  function M({ children, c = t.bone, sz = 12, w = 400, ls = 0, style }) {
    return <span style={{ font: `${w} ${sz}px/1 var(--font-mono)`, letterSpacing: ls, color: c, ...style }}>{children}</span>;
  }

  function Clock() {
    const [n, setN] = useState(new Date());
    useEffect(() => { const id = setInterval(() => setN(new Date()), 1000); return () => clearInterval(id); }, []);
    const pad = x => String(x).padStart(2, '0');
    return <M c={t.amber} sz={11} ls={1.4}>{pad(n.getHours())}:{pad(n.getMinutes())}<span style={{ color: t.amberDim }}>:{pad(n.getSeconds())}</span></M>;
  }

  // ── Channel state + Feather icons (shared logic w/ kanban) ────────────
  function channelStates(lead) {
    const hasPhone = lead.phone && lead.phone !== '—';
    const hasEmail = lead.email && lead.email !== '—';
    const lastDigit = parseInt(lead.id.slice(-1), 10) || 0;
    const past = lead.stage !== 'incoming';
    return {
      phone: !hasPhone ? null
           : lastDigit === 4 ? 'new'
           : past ? 'past' : 'avail',
      whatsapp: !hasPhone ? null
           : (lead.unmatchedWhatsapp || lastDigit === 7) ? 'new'
           : (past || lead.channel === 'whatsapp') ? 'past' : 'avail',
      email: !hasEmail ? null
           : (lastDigit === 0 || lastDigit === 3) ? 'new'
           : (past || lead.channel === 'email') ? 'past' : 'avail',
    };
  }
  function IconPhone({ size, color, fill }) {
    const filled = fill && fill !== 'none';
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  }
  function IconChat({ size, color, fill }) {
    const filled = fill && fill !== 'none';
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    );
  }
  function IconEmail({ size, color, fill, bg = t.bg }) {
    const filled = fill && fill !== 'none';
    if (filled) {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" fill={color} stroke={color} strokeWidth="1.6" />
          <polyline points="22,6 12,13 2,6" fill="none" stroke={bg} strokeWidth="2.2" />
        </svg>
      );
    }
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    );
  }
  function IconStar({ size, color, fill }) {
    const filled = fill && fill !== 'none';
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    );
  }
  function ChannelGlyph({ icon, state, size = 14, bg }) {
    const isWA = icon === 'chat';
    const accent = isWA ? '#25d366' : t.amber;
    let color = t.mutedDim;
    let fill = 'none';
    if (state === 'past') color = isWA ? '#5eb678' : t.amber;
    if (state === 'new') { color = accent; fill = accent; }
    const Icon = { phone: IconPhone, chat: IconChat, email: IconEmail, star: IconStar }[icon];
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size + 4, height: size + 4,
        filter: state === 'new' ? `drop-shadow(0 0 4px ${accent}88)` : 'none',
      }}>
        <Icon size={size} color={color} fill={fill} bg={bg} />
      </span>
    );
  }
  function ChannelStrip({ lead, size = 14, bg }) {
    const states = channelStates(lead);
    return (
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
        {states.phone && <ChannelGlyph icon="phone" state={states.phone} size={size} bg={bg} />}
        {states.whatsapp && <ChannelGlyph icon="chat" state={states.whatsapp} size={size} bg={bg} />}
        {states.email && <ChannelGlyph icon="email" state={states.email} size={size} bg={bg} />}
        <ChannelGlyph icon="star" state={lead.starred ? 'new' : 'avail'} size={size} bg={bg} />
      </div>
    );
  }

  // ── FlightDeck (POLAR proposal) — "Mission Ops" ───────────────────────
  // Three DIFFERENTLY SHAPED cards, one per action archetype:
  //   1. HERO SLAB   — the dominant #1 move (tall, big type, execute affordance)
  //   2. TIMER DIAL  — time-critical call (circular countdown ring on the left)
  //   3. TICKET STUB — quick send/email (perforated horizontal stub)
  function FlightDeck({ leads, qc, onSelect, t }) {
    const [tick, setTick] = useState(0);
    useEffect(() => { const id = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(id); }, []);

    const actions = useMemo(() => {
      const byId = id => leads.find(l => l.id === id);
      return [
        { lead: byId('P017') || leads[0], verb: 'REPLY', channel: 'WhatsApp', why: 'Inbound 59m ago · still warm. Reply before it cools.', dur: '2 MIN REPLY', deadline: 'DUE IN 12M', tone: 'green', shape: 'hero' },
        { lead: byId('P014') || leads[1], verb: 'CALL',  channel: 'Phone',    why: 'Negotiation window closes 14:00', dur: '10 MIN CALL', deadline: 'DUE IN 38M', tone: 'red', shape: 'dial', pct: 0.72, mins: 38 },
        { lead: byId('P010') || leads[2], verb: 'SEND',  channel: 'Email',    why: 'Proposal v3 promised EOD', dur: '5 MIN EMAIL', deadline: 'DUE TODAY', tone: 'amber', shape: 'ticket' },
      ].filter(p => p.lead).slice(0, 3);
    }, [leads]);
    const tc = (tn) => tn === 'green' ? t.phosphor : tn === 'red' ? t.red : t.amber;
    // Channel-adaptive execute verb
    const execVerb = (ch) => ch === 'Phone' ? '▶ CALL' : '▶ DRAFT';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', borderBottom: `1px solid ${t.line}`, background: t.bg, flexShrink: 0 }}>
        {/* Header */}
        <div style={{ position: 'relative', padding: '14px 18px 12px', borderBottom: `1px solid ${t.lineDim}`, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(100deg, transparent 30%, ${t.phosphor}14 50%, transparent 70%)`, backgroundSize: '220% 100%', animation: 'tflash 3.5s linear infinite' }} />
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, background: `${t.phosphor}22`, border: `1px solid ${t.phosphor}`, color: t.phosphor, font: '600 12px/1 var(--font-mono)', animation: 'tpulse 2s infinite' }}>✦</span>
          <div style={{ flex: 1, position: 'relative' }}>
            <div style={{ font: '600 12px/1 var(--font-mono)', letterSpacing: 1.4, color: t.bone, textTransform: 'uppercase' }}>FLIGHT DECK</div>
            <div style={{ font: '400 9.5px/1 var(--font-mono)', color: t.mutedDim, marginTop: 4, letterSpacing: 0.5 }}>
              Consular pushed {actions.length} · <button onClick={() => onSelect(null)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: t.amber, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>{qc.overdue + qc.today} in queue ▾</button>
            </div>
          </div>
          <span style={{ position: 'relative', font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2, color: t.phosphor, padding: '4px 7px', border: `1px solid ${t.phosphor}50`, background: `${t.phosphor}14` }}>● LIVE</span>
        </div>

        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {actions.map((a, i) => {
            const c = tc(a.tone);
            const anim = { animation: `triseup 0.5s cubic-bezier(.2,.7,.3,1) ${0.1 + i * 0.1}s both` };

            // ── SHAPE 1: HERO SLAB ──
            if (a.shape === 'hero') {
              return (
                <button key={a.lead.id} onClick={() => onSelect(a.lead.id)} style={{
                  position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
                  border: `1px solid ${c}55`, borderTop: `3px solid ${c}`, background: `${c}1e`,
                  padding: '16px 16px 14px', overflow: 'hidden', ...anim,
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 22px ${c}30`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(100deg, transparent 35%, ${c}1c 50%, transparent 65%)`, backgroundSize: '220% 100%', animation: 'tflash 2.8s linear infinite' }} />
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ font: '600 10px/1 var(--font-mono)', letterSpacing: 2, color: c }}>↑ NOW · {a.verb} · {a.channel.toUpperCase()}</span>
                    <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1, color: c, padding: '3px 6px', border: `1px solid ${c}55` }}>{a.deadline}</span>
                  </div>
                  <div style={{ position: 'relative', font: '600 22px/1.1 var(--font-sans)', color: t.bone, marginTop: 12, letterSpacing: -0.5 }}>{a.lead.company}</div>
                  <div style={{ position: 'relative', font: '400 12px/1.45 var(--font-sans)', color: t.muted, marginTop: 6 }}>{a.why}</div>
                  <div style={{ position: 'relative', marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4, color: '#fff', background: c, padding: '9px 14px', textTransform: 'uppercase' }}>
                      {execVerb(a.channel)}
                    </span>
                    <span style={{ font: '500 10px/1 var(--font-mono)', color: t.mutedDim, letterSpacing: 0.5 }}>{a.dur}</span>
                  </div>
                </button>
              );
            }

            // ── SHAPE 2: TIMER DIAL ──
            if (a.shape === 'dial') {
              const R = 20, CIRC = 2 * Math.PI * R, pct = a.pct || 0.7;
              return (
                <button key={a.lead.id} onClick={() => onSelect(a.lead.id)} style={{
                  position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
                  border: `1px solid ${c}55`, borderLeft: `3px solid ${c}`, background: `${c}12`,
                  padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14, ...anim,
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; e.currentTarget.style.boxShadow = `0 6px 18px ${c}30`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                  {/* countdown ring */}
                  <div style={{ position: 'relative', width: 50, height: 50, flexShrink: 0 }}>
                    <svg width="50" height="50" viewBox="0 0 50 50" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="25" cy="25" r={R} fill="none" stroke={`${c}30`} strokeWidth="3" />
                      <circle cx="25" cy="25" r={R} fill="none" stroke={c} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)}
                        style={{ transition: 'stroke-dashoffset 0.5s' }} />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                      <span style={{ font: '600 13px/1 var(--font-mono)', color: c }}>{a.mins || 38}</span>
                      <span style={{ font: '400 7px/1 var(--font-mono)', color: t.mutedDim, letterSpacing: 0.5, marginTop: 2 }}>MIN</span>
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4, color: c }}>{a.verb} · {a.channel.toUpperCase()}</span>
                      <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1, color: c, padding: '3px 6px', border: `1px solid ${c}55` }}>{a.deadline}</span>
                    </div>
                    <div style={{ font: '500 14px/1.2 var(--font-sans)', color: t.bone, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.lead.company}</div>
                    <div style={{ font: '400 11px/1.4 var(--font-sans)', color: t.muted, marginTop: 4 }}>{a.why}</div>
                    <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: '#fff', background: c, padding: '7px 11px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
                      <span style={{ font: '500 9px/1 var(--font-mono)', color: t.mutedDim }}>{a.dur}</span>
                    </div>
                  </div>
                </button>
              );
            }

            // ── SHAPE 3: TICKET STUB ──
            return (
              <button key={a.lead.id} onClick={() => onSelect(a.lead.id)} style={{
                position: 'relative', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: t.bone,
                border: `1px dashed ${c}55`, background: `${c}0c`,
                padding: '10px 14px 10px 28px', display: 'flex', alignItems: 'center', gap: 10, ...anim,
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; e.currentTarget.style.boxShadow = `0 5px 14px ${c}26`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                {/* perforation dots down the left */}
                <span style={{ position: 'absolute', left: 9, top: 0, bottom: 0, width: 4, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center' }}>
                  {Array.from({ length: 5 }).map((_, d) => (
                    <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: `${c}66` }} />
                  ))}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: c }}>{a.verb} · {a.channel.toUpperCase()}</span>
                    <span style={{ font: '600 9px/1 var(--font-mono)', letterSpacing: 1, color: c }}>{a.deadline}</span>
                  </div>
                  <div style={{ font: '500 13px/1.2 var(--font-sans)', color: t.bone, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.lead.company}</div>
                  <div style={{ font: '400 10.5px/1.3 var(--font-sans)', color: t.muted, marginTop: 3 }}>{a.why}</div>
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 9px/1 var(--font-mono)', letterSpacing: 1.4, color: '#fff', background: c, padding: '6px 10px', textTransform: 'uppercase' }}>{execVerb(a.channel)}</span>
                    <span style={{ font: '500 9px/1 var(--font-mono)', color: t.mutedDim }}>{a.dur}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── ChatRail — agent-first right panel. Warm-open greeting, message thread, input. ──
  function ChatRail({ leads, qc, heroPick, onSelect, t }) {
    const heroLead = heroPick && heroPick.lead;
    // No pre-loaded greeting — the Flight Deck owns "what's hot". Chat opens clean.
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    const inputRef = useRef(null);
    const scrollRef = useRef(null);

    useEffect(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages.length]);

    const send = () => {
      const v = draft.trim();
      if (!v) return;
      setMessages(prev => [...prev, { from: 'user', text: v }]);
      setDraft('');
      // Synthetic agent reply
      setTimeout(() => {
        setMessages(prev => [...prev, {
          from: 'agent',
          text: 'On it. Pulling context from the last 3 touches…',
          pending: true,
        }]);
      }, 350);
    };

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px 12px',
          borderBottom: `1px solid ${t.lineDim}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26,
            background: `${t.phosphor}22`,
            border: `1px solid ${t.phosphor}`,
            color: t.phosphor,
            font: '600 12px/1 var(--font-mono)',
          }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ font: '500 13px/1.1 var(--font-sans)', color: t.bone }}>Consular</div>
            <div style={{ font: '400 10px/1 var(--font-mono)', color: t.mutedDim, marginTop: 3, letterSpacing: 0.5 }}>
              Stateful · last distillation 2h ago
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={{
          flex: 1, overflow: 'auto',
          padding: '14px 18px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
              padding: '10px 12px',
              background: m.from === 'user' ? `${t.amber}10` : t.bgCard,
              border: `1px solid ${m.from === 'user' ? t.amberDim + '50' : t.lineDim}`,
              borderLeft: m.from === 'agent' ? `2px solid ${t.phosphor}` : `1px solid ${t.amberDim}50`,
              opacity: m.pending ? 0.7 : 1,
              animation: 'tmsgin 0.35s cubic-bezier(.2,.7,.3,1) both',
            }}>
              <div style={{ font: '400 13px/1.5 var(--font-sans)', color: t.bone }}>{m.text}</div>
              {m.actionLabel && (
                <button onClick={() => m.actionLeadId && onSelect(m.actionLeadId)} style={{
                  marginTop: 8,
                  font: '500 10px/1 var(--font-mono)', letterSpacing: 1.2,
                  padding: '6px 10px',
                  color: t.phosphor, background: 'transparent',
                  border: `1px solid ${t.phosphor}`,
                  cursor: 'pointer', textTransform: 'uppercase',
                }}>{m.actionLabel} →</button>
              )}
            </div>
          ))}
        </div>

        {/* Suggestions strip */}
        <div style={{
          padding: '8px 18px 0',
          display: 'flex', flexWrap: 'wrap', gap: 6,
        }}>
          {[
            'Draft the WhatsApp to Caffè',
            'Why is Olimpia stuck after the missed call?',
            'Who\'s been in Closing >5d?',
            'Summarize today',
          ].map((s, i) => (
            <button key={i} onClick={() => setDraft(s)} style={{
              font: '400 11px/1.2 var(--font-sans)',
              padding: '5px 10px',
              color: t.muted, background: 'transparent',
              border: `1px dashed ${t.lineDim}`,
              cursor: 'pointer',
            }}>{s}</button>
          ))}
        </div>

        {/* Input */}
        <div style={{
          padding: '12px 18px 14px',
          borderTop: `1px solid ${t.lineDim}`,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
            }}
            placeholder="Ask · ⌘⏎ to send"
            rows={3}
            style={{
              width: '100%',
              background: t.bgCard, color: t.bone,
              border: `1px solid ${t.lineDim}`,
              padding: '10px 12px',
              font: '400 13px/1.5 var(--font-sans)',
              resize: 'none',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: '400 10px/1 var(--font-mono)', color: t.mutedDim, letterSpacing: 0.5 }}>
              ⌘⏎ to send · context loaded: pipeline + history
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={send} disabled={!draft.trim()} style={{
              font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4,
              padding: '8px 14px',
              background: draft.trim() ? t.phosphor : 'transparent',
              color: draft.trim() ? '#ffffff' : t.muted,
              border: `1px solid ${draft.trim() ? t.phosphor : t.lineDim}`,
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
              textTransform: 'uppercase',
            }}>Send</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Flight Plan — today's agenda, ported from B and re-skinned ─────────
  function FlightPlan({ leads, onSelect, selectedId }) {
    // Synthetic day plan — meetings, calls and follow-ups for today.
    const all = [
      { t: '09:00', kind: 'CALL',    leadId: 'P017' },
      { t: '10:30', kind: 'DEMO',    leadId: 'P020' },
      { t: '11:15', kind: 'EMAIL',   leadId: 'P010' },
      { t: '14:00', kind: 'NEGOT.',  leadId: 'P014' },
      { t: '15:30', kind: 'F-UP',    leadId: 'P008' },
      { t: '17:00', kind: 'CLOSE',   leadId: 'P012' },
    ];
    const items = all.map(it => ({ ...it, lead: leads.find(l => l.id === it.leadId) })).filter(x => x.lead);
    // Compute "now" position — mark items in the past as done, the next upcoming as current.
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const min = it => parseInt(it.t.split(':')[0]) * 60 + parseInt(it.t.split(':')[1]);
    const currentIdx = items.findIndex(it => min(it) > nowMinutes);
    const completedIdx = currentIdx === -1 ? items.length : currentIdx;

    const remaining = items.length - completedIdx;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
        <div style={{ padding: '24px 22px 12px' }}>
          <L c={t.amberDim}>▸ Flight plan · today</L>
          <div style={{ font: '500 20px/1.2 var(--font-sans)', color: t.bone, marginTop: 10, letterSpacing: -0.3 }}>
            {remaining} {remaining === 1 ? 'thing' : 'things'} ahead
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <div style={{ flex: 1, height: 2, background: t.lineDim, position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${(completedIdx / items.length) * 100}%`, background: t.amber, opacity: 0.8 }} />
            </div>
            <M c={t.muted} sz={10}>{completedIdx}/{items.length}</M>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '0 14px 14px' }}>
          {items.map((it, i) => {
            const past = i < completedIdx;
            const now = i === completedIdx;
            const sel = it.lead.id === selectedId;
            return (
              <button key={i} onClick={() => onSelect(it.lead.id)} style={{
                display: 'grid', gridTemplateColumns: '46px 10px 1fr',
                gap: 10, alignItems: 'flex-start', width: '100%',
                padding: '10px 8px',
                background: sel ? `${t.amber}14` : 'transparent',
                border: 'none',
                borderLeft: `2px solid ${sel ? t.amber : now ? t.phosphor : 'transparent'}`,
                cursor: 'pointer', textAlign: 'left', color: t.bone, font: 'inherit',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#ffffff05'; }}
              onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent'; }}>
                <M c={past ? t.mutedDim : now ? t.phosphor : t.bone} sz={12} w={500}>{it.t}</M>
                <span style={{
                  marginTop: 4,
                  width: 8, height: 8, borderRadius: '50%',
                  background: past ? t.mutedDim : now ? t.phosphor : t.amber,
                  boxShadow: now ? `0 0 8px ${t.phosphor}` : 'none',
                  animation: now ? 'tpulse 1.4s infinite' : 'none',
                }} />
                <div>
                  <div style={{
                    font: '500 12px/1.25 var(--font-sans)',
                    color: past ? t.muted : t.bone,
                    textDecoration: past ? 'line-through' : 'none',
                    textDecorationColor: t.mutedDim,
                  }}>
                    {it.lead.company}
                  </div>
                  <L c={past ? t.mutedDim : t.amberDim} sz={9} ls={1.4} style={{ marginTop: 4, display: 'block' }}>
                    {it.kind} · {it.lead.contact}
                  </L>
                  <L c={t.mutedDim} sz={9} ls={1.2} style={{ marginTop: 4, display: 'block', textTransform: 'none' }}>
                    CHF {D.chf(it.lead.amount)} · {Math.round(it.lead.prob * 100)}%
                  </L>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Triage row — single dense ledger line, very Fathom ─────────────────
  // ── CountUp — animated number tick from 0 → target on mount ────────────
  function CountUp({ value, dur = 700, pad = 2 }) {
    const [n, setN] = useState(0);
    useEffect(() => {
      let raf, start;
      const target = Number(value) || 0;
      const step = (ts) => {
        if (!start) start = ts;
        const p = Math.min(1, (ts - start) / dur);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - p, 3);
        setN(Math.round(eased * target));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }, [value, dur]);
    return <>{String(n).padStart(pad, '0')}</>;
  }

  function TriageRow({ count, label, sub, tone, active, onClick, idx = 0 }) {
    // tone: 'red' | 'yellow' | 'orange' | 'green' — each maps to a token color.
    const c = tone === 'red'    ? t.red
            : tone === 'yellow' ? t.amberHi
            : tone === 'green'  ? t.phosphor
            : tone === 'orange' ? t.amber
            : t.amber;
    return (
      <button onClick={onClick} style={{
        display: 'grid', gridTemplateColumns: '76px 1fr 24px',
        gap: 16, alignItems: 'center', width: '100%',
        padding: '20px 24px',
        background: active ? `${t.amber}10` : 'transparent',
        border: 'none',
        borderTop: `1px solid ${t.lineDim}`,
        cursor: 'pointer', color: t.bone, font: 'inherit', textAlign: 'left',
        transition: 'background 0.2s, padding-left 0.2s',
        animation: `triseup 0.5s cubic-bezier(.2,.7,.3,1) ${0.05 + idx * 0.08}s both`,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = `${t.amber}2a`; e.currentTarget.style.paddingLeft = '28px'; }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? `${t.amber}10` : 'transparent'; e.currentTarget.style.paddingLeft = '24px'; }}>
        <M c={c} sz={44} w={300} ls={-2} style={{ textAlign: 'left' }}>
          <CountUp value={count} />
        </M>
        <div>
          <div style={{ font: '500 17px/1.2 var(--font-sans)', color: t.bone, letterSpacing: -0.2 }}>{label}</div>
          <L c={t.muted} sz={10} ls={1.2} style={{ marginTop: 6, display: 'block', textTransform: 'none' }}>{sub}</L>
        </div>
        <span style={{ font: '300 18px/1 var(--font-mono)', color: c, opacity: 0.6 }}>→</span>
      </button>
    );
  }

  // ── Compact lead row for sub-list (filtered) ──────────────────────────
  // Deadline thermometer: only red & amber are allowed to *scream*. Upcoming
  // and far-future use soft, transparent blue/green that discriminates time-
  // distance without competing for attention with overdue/today.
  function deadlineBar(lead) {
    if (!lead.due) return null;
    const d = D.daysBetween(D.TODAY, lead.due);
    if (d > 0)   return { color: '#ff6a4d',                  width: 3 }; // overdue · screams
    if (d === 0) return { color: '#ffd07a',                  width: 3 }; // today · screams
    if (d >= -7) return { color: 'rgba(94, 200, 138, 0.45)', width: 3 }; // upcoming · soft green
    return               { color: 'rgba(95, 168, 223, 0.40)', width: 3 }; // far · soft blue
  }

  function LeadRow({ lead, selected, onClick }) {
    const overdueDays = D.daysBetween(D.TODAY, lead.due);
    const isOverdue = overdueDays > 0;
    const isToday = lead.due === D.TODAY;
    const bar = deadlineBar(lead);
    return (
      <button onClick={onClick} style={{
        position: 'relative',
        display: 'grid', gridTemplateColumns: '70px 1fr 120px 80px 50px',
        gap: 14, alignItems: 'center', width: '100%',
        padding: '14px 24px 14px 28px',
        background: selected ? `${t.amber}10` : 'transparent',
        border: 'none',
        borderTop: `1px solid ${t.lineDim}`,
        cursor: 'pointer', textAlign: 'left', color: t.bone, font: 'inherit',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#ffffff04'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}>
        {/* Deadline thermometer bar */}
        {bar && (
          <span style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: bar.width,
            background: bar.color,
          }} />
        )}
        <M c={isOverdue ? t.red : isToday ? t.amberHi : t.muted} sz={10} w={500} ls={1}>
          {!lead.due ? '—'
            : isOverdue ? `+${overdueDays}D`
            : isToday ? 'TODAY'
            : `${-overdueDays}D`}
        </M>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '500 14px/1.2 var(--font-sans)', color: t.bone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.company}
          </div>
          <div style={{ font: '400 12px/1.3 var(--font-sans)', color: t.muted, marginTop: 3 }}>
            {lead.contact} <span style={{ color: t.mutedDim }}>·</span> {lead.tag}
          </div>
        </div>
        <ChannelStrip lead={lead} size={13} bg={selected ? '#f7f2e2' : t.bg} />
        <M c={t.bone} sz={12} style={{ textAlign: 'right' }}>{D.chf(lead.amount)}</M>
        <M c={t.amber} sz={11} style={{ textAlign: 'right' }}>{Math.round(lead.prob * 100)}%</M>
      </button>
    );
  }

  // ── Hero "next move" card — the focal point ─────────────────────────────
  function NextMoveHero({ pick, dismissedCount, onDismiss, onResetDismissed, onOpen }) {
    const lead = pick && pick.lead;
    const [aiDraft, setAiDraft] = useState(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState(null);
    useEffect(() => { setAiDraft(null); setAiError(null); setAiLoading(false); }, [lead && lead.id]);

    if (!lead) {
      return (
        <div style={{
          margin: '0 24px 12px', padding: '24px 28px',
          background: t.bgElev, border: `1px solid ${t.line}`,
          textAlign: 'center',
        }}>
          <L c={t.amberDim}>▸ INBOX ZERO</L>
          <div style={{ font: '500 22px/1.2 var(--font-sans)', color: t.bone, marginTop: 10, letterSpacing: -0.3 }}>
            Nothing waiting for you.
          </div>
          {dismissedCount > 0 && (
            <button onClick={onResetDismissed} style={{
              marginTop: 14, background: 'none', border: `1px solid ${t.amberDim}`,
              color: t.amber, font: '500 10px/1 var(--font-mono)',
              letterSpacing: 1.4, padding: '8px 12px', cursor: 'pointer',
              textTransform: 'uppercase',
            }}>↺ Restore {dismissedCount} dismissed</button>
          )}
        </div>
      );
    }

    const overdueDays = D.daysBetween(D.TODAY, lead.due);
    const toneColor = pick.tone;
    const isWA = pick.primaryAction === 'whatsapp';
    const isEmail = pick.primaryAction === 'email';

    async function generateAiDraft() {
      setAiLoading(true);
      setAiError(null);
      setAiDraft(null);
      try {
        if (!window.claude || !window.claude.complete) {
          throw new Error('AI helper only available in preview sandbox.');
        }
        const channelHint = isWA ? 'WhatsApp' : isEmail ? 'email reply' : 'WhatsApp follow-up';
        const prompt =
`You are a Swiss-Italian sales rep at OskarOS drafting a ${channelHint} to a lead.

LEAD
- Company: ${lead.company}
- Contact: ${lead.contact}
- City: ${lead.city || '—'}
- Stage: ${D.STAGE[lead.stage].label}
- Status: ${D.STATUS[lead.status].label}
- Value: CHF ${D.chf(lead.amount)} at ${Math.round(lead.prob * 100)}% probability
- Due date: ${lead.due} ${overdueDays > 0 ? `(${overdueDays} days overdue)` : overdueDays === 0 ? '(today)' : ''}
- Next move: ${lead.note}
- Notes: ${lead.comment}
- Recommended because: ${pick.reason}

Write a short, warm, professional ${channelHint} in the contact's likely language (Italian for Italian/Tessin names, French for Romandy, German otherwise; English if unclear). ${isEmail ? '3-5 sentences with a subject line at the top labeled "Subject:".' : '2-3 sentences max. Conversational, no formal sign-off.'} Just the message body — no preamble, no quotes, no extra labels.`;
        const reply = await window.claude.complete(prompt);
        setAiDraft(String(reply || '').trim());
      } catch (e) {
        setAiError(e.message || 'Failed to generate.');
      } finally {
        setAiLoading(false);
      }
    }

    return (
      <div style={{
        margin: '0 24px 12px',
        padding: '22px 28px',
        background: `${toneColor}2a`,
        border: `1px solid ${t.line}`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Tone-colored accent rail */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: toneColor, boxShadow: `0 0 12px ${toneColor}66` }} />

        {/* Top row: reason label · dismiss / restore controls · channel strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <L c={toneColor} ls={1.6}>▸ NEXT MOVE</L>
          <L c={t.mutedDim} sz={9}>· {pick.reason}</L>
          <L c={t.mutedDim} sz={9}>· {lead.id}</L>
          <span style={{ flex: 1 }} />
          <ChannelStrip lead={lead} size={14} bg={t.bgElev} />
          {dismissedCount > 0 && (
            <button onClick={onResetDismissed} title={`Restore ${dismissedCount} dismissed`} style={{
              background: 'none', border: `1px solid ${t.lineDim}`,
              color: t.muted, font: '500 9px/1 var(--font-mono)',
              letterSpacing: 1.2, padding: '6px 8px', cursor: 'pointer',
              textTransform: 'uppercase',
            }}>↺ {dismissedCount}</button>
          )}
          <button onClick={onDismiss} title="Dismiss · show next priority" style={{
            background: 'none', border: `1px solid ${t.lineDim}`,
            color: t.muted, font: '500 9px/1 var(--font-mono)',
            letterSpacing: 1.2, padding: '6px 10px', cursor: 'pointer',
            textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = t.bone; e.currentTarget.style.borderColor = t.amberDim; }}
          onMouseLeave={e => { e.currentTarget.style.color = t.muted; e.currentTarget.style.borderColor = t.lineDim; }}>
            ✕ Dismiss
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ font: '500 24px/1.2 var(--font-sans)', color: t.bone, letterSpacing: -0.5 }}>
            {lead.note}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div style={{ font: '500 14px/1 var(--font-sans)', color: t.bone }}>{lead.company}</div>
            <L c={t.muted}>{lead.contact}</L>
            <L c={overdueDays > 0 ? t.red : t.muted}>{lead.due} · {overdueDays > 0 ? `${overdueDays}D overdue` : overdueDays === 0 ? 'today' : 'on time'}</L>
            <L c={t.amber}>CHF {D.chf(lead.amount)} · {Math.round(lead.prob * 100)}%</L>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Primary action varies by pool */}
          {isWA && <HBtn primary>● REPLY ON WHATSAPP</HBtn>}
          {isEmail && <HBtn primary>● REPLY VIA EMAIL</HBtn>}
          {!isWA && !isEmail && <HBtn primary onClick={onOpen}>EXECUTE</HBtn>}

          {!isWA && <HBtn>SEND WHATSAPP</HBtn>}
          <HBtn>LOG CALL</HBtn>
          {!isEmail && <HBtn>LOG EMAIL</HBtn>}

          <button onClick={generateAiDraft} disabled={aiLoading} style={{
            font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4,
            padding: '10px 14px',
            background: aiLoading ? `${t.phosphor}20` : 'transparent',
            color: t.phosphor,
            border: `1px solid ${t.phosphor}`,
            cursor: aiLoading ? 'wait' : 'pointer',
            textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ position: 'relative', width: 10, height: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {aiLoading ? (
                <span style={{
                  width: 8, height: 8, border: `1.5px solid ${t.phosphor}`, borderTopColor: 'transparent',
                  borderRadius: '50%', animation: 'tspin 0.8s linear infinite',
                }} />
              ) : '✨'}
            </span>
            {aiLoading ? 'DRAFTING…' : 'AI DRAFT'}
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={onOpen} style={{
            background: 'transparent', color: t.amber,
            border: `1px solid ${t.amberDim}`,
            padding: '10px 14px',
            font: '500 10px/1 var(--font-mono)', letterSpacing: 1.4,
            cursor: 'pointer', textTransform: 'uppercase',
          }}>OPEN ▸</button>
        </div>

        {/* AI draft panel */}
        {(aiDraft || aiError) && (
          <div style={{
            marginTop: 14,
            background: t.bg,
            border: `1px solid ${aiError ? t.red + '60' : t.phosphor + '40'}`,
            borderLeft: `2px solid ${aiError ? t.red : t.phosphor}`,
            padding: '12px 14px',
            animation: 'twipe 0.25s ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <L c={aiError ? t.red : t.phosphor} ls={1.4}>
                {aiError ? '⚠ AI ERROR' : `✨ AI-GENERATED DRAFT · ${isEmail ? 'EMAIL' : 'WHATSAPP'}`}
              </L>
              <L c={t.mutedDim} sz={9} ls={1.1}>· claude-haiku</L>
              <span style={{ flex: 1 }} />
              <button onClick={() => { setAiDraft(null); setAiError(null); }} style={{
                background: 'none', border: 'none', color: t.mutedDim,
                cursor: 'pointer', font: '300 12px/1 var(--font-mono)', padding: 0,
              }}>✕</button>
            </div>
            {aiError ? (
              <p style={{ font: '400 12px/1.5 var(--font-sans)', color: t.muted, margin: 0 }}>{aiError}</p>
            ) : (
              <>
                <p style={{ font: '400 14px/1.55 var(--font-sans)', color: t.bone, margin: 0, whiteSpace: 'pre-wrap' }}>{aiDraft}</p>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button onClick={() => { try { navigator.clipboard.writeText(aiDraft); } catch {} }} style={miniBtnStyle}>Copy</button>
                  <button onClick={generateAiDraft} style={miniBtnStyle}>Regenerate</button>
                  <span style={{ flex: 1 }} />
                  <button style={{
                    font: '600 9px/1 var(--font-mono)', letterSpacing: 1.2,
                    padding: '6px 10px',
                    color: '#ffffff', background: t.phosphor,
                    border: `1px solid ${t.phosphor}`, cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}>Send via {isEmail ? 'Email' : 'WhatsApp'} ▸</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const miniBtnStyle = {
    font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2,
    padding: '6px 10px',
    color: t.muted, background: 'transparent',
    border: `1px solid ${t.lineDim}`, cursor: 'pointer',
    textTransform: 'uppercase',
  };

  function HBtn({ children, primary, onClick }) {
    return (
      <button onClick={onClick} style={{
        font: '600 10px/1 var(--font-mono)',
        letterSpacing: 1.4,
        padding: '10px 14px',
        background: primary ? t.amber : 'transparent',
        color: primary ? '#ffffff' : t.amber,
        border: `1px solid ${primary ? t.amber : t.amberDim}`,
        cursor: 'pointer', textTransform: 'uppercase',
      }}>{children}</button>
    );
  }

  // ── Shared helpers ported from kanban: people repeater, age field, etc. ──
  const EMP_BUCKETS = ['1–5', '6–20', '21–50', '51–200', '200+'];
  function leadExtras(lead) {
    const seed = lead.id.charCodeAt(lead.id.length - 1) +
                 lead.id.charCodeAt(lead.id.length - 2) * 31;
    const STREETS = ['Bahnhofstrasse', 'Seestrasse', 'Rämistrasse', 'Via Nassa', 'Via Pioda', 'Rue du Rhône', 'Avenue de la Gare', 'Hauptstrasse', 'Limmatquai', 'Storchengasse'];
    const PLZ_BY_CITY = {
      'Zürich': '8001', 'Lugano': '6900', 'Genève': '1204', 'Bellinzona': '6500',
      'Milano': '20121', 'Bern': '3011', 'St. Moritz': '7500', 'Lausanne': '1003',
      'Basel': '4051', 'Tessin': '6500',
    };
    const street = STREETS[seed % STREETS.length] + ' ' + ((seed % 80) + 1);
    const plz = PLZ_BY_CITY[lead.city] || (8000 + (seed % 999));
    const uidSerial = (seed * 7919) % 1000000000;
    const uid = (seed % 5) !== 0
      ? `CHE-${String(uidSerial).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}`
      : null;
    const employees = EMP_BUCKETS[seed % EMP_BUCKETS.length];
    const contactName = lead.contact && lead.contact !== '—' ? lead.contact : null;
    const people = [];
    if (contactName) {
      people.push({
        id: lead.id + '-p1',
        name: contactName,
        phone: lead.phone,
        email: lead.email,
        isDecisionMaker: true,
      });
    }
    if (seed % 3 === 0 && contactName) {
      const firstNames = ['Anna','Marco','Sara','Tom','Lea','Pierre','Yann','Klaus'];
      const lastName = contactName.split(' ').pop();
      people.push({
        id: lead.id + '-p2',
        name: firstNames[seed % firstNames.length] + ' ' + lastName,
        phone: lead.phone ? lead.phone.replace(/\d$/, String((seed + 1) % 10)) : '—',
        email: lead.email && lead.email !== '—'
          ? lead.email.replace(/^[^@]+/, firstNames[seed % firstNames.length].toLowerCase())
          : '—',
        isDecisionMaker: false,
      });
    }
    const webpage = lead.company !== '—'
      ? `${lead.company.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}.${lead.city === 'Milano' ? 'it' : 'ch'}`
      : null;
    return { address: { strasse: street, plz: String(plz), ort: lead.city }, uid, employees, people, webpage };
  }

  const ROLE_OPTIONS = [
    { value: 'decision_maker',  label: 'Decision Maker',   decisive: true },
    { value: 'economic_buyer',  label: 'Economic Buyer',   decisive: true },
    { value: 'owner',           label: 'Owner / Founder',  decisive: true },
    { value: 'ceo',             label: 'CEO',              decisive: true },
    { value: 'cfo',             label: 'CFO',              decisive: true },
    { value: 'champion',        label: 'Champion',         decisive: false },
    { value: 'influencer',      label: 'Influencer',       decisive: false },
    { value: 'technical_buyer', label: 'Technical Buyer',  decisive: false },
    { value: 'end_user',        label: 'End User',         decisive: false },
    { value: 'gatekeeper',      label: 'Gatekeeper',       decisive: false },
    { value: 'blocker',         label: 'Blocker',          decisive: false },
    { value: 'assistant',       label: 'Assistant',        decisive: false },
    { value: 'other',           label: 'Other',            decisive: false },
  ];
  function roleDef(value) {
    return ROLE_OPTIONS.find(r => r.value === value) || ROLE_OPTIONS[ROLE_OPTIONS.length - 1];
  }

  function fieldInput() {
    return {
      width: '100%',
      background: t.bgCard || t.bgElev,
      border: `1px solid ${t.lineDim}`,
      color: t.bone,
      font: '400 13px/1.4 var(--font-sans)',
      padding: '7px 10px',
      outline: 'none',
    };
  }
  function miniIconBtn() {
    return {
      width: 24, height: 24,
      background: 'transparent', border: `1px solid ${t.lineDim}`,
      color: t.muted, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: 0, font: '400 11px/1 var(--font-mono)',
    };
  }

  function InlineEditField({ defaultValue, placeholder, font, color, mini, upper, onBlurValue }) {
    const [focus, setFocus] = useState(false);
    const [hover, setHover] = useState(false);
    return (
      <input
        defaultValue={defaultValue}
        placeholder={placeholder}
        onFocus={() => setFocus(true)}
        onBlur={e => { setFocus(false); if (onBlurValue) onBlurValue(e.target.value); }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: focus ? t.bg : 'transparent',
          border: 'none',
          borderBottom: focus
            ? `1px solid ${t.amber}`
            : hover ? `1px dotted ${t.amberDim}` : '1px solid transparent',
          color: color || t.bone,
          font: font || '400 13px/1.2 var(--font-sans)',
          padding: mini ? '1px 0' : '3px 0',
          outline: 'none',
          width: '100%', minWidth: 0,
          textTransform: upper ? 'uppercase' : 'none',
          letterSpacing: upper ? 1.1 : 'normal',
        }}
      />
    );
  }

  function DobAgeField({ defaultValue, todayIso }) {
    const [value, setValue] = useState(defaultValue || '');
    const [focus, setFocus] = useState(false);
    const [hover, setHover] = useState(false);
    function parseAge(v) {
      if (!v) return null;
      const m = v.trim().match(/^(\d{1,3})\s*y?$/i);
      if (m) { const a = parseInt(m[1], 10); if (a >= 0 && a < 130) return { age: a, dob: null }; }
      let iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      let eu = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      let euSlash = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      let y, mo, d;
      if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; }
      else if (eu) { d = +eu[1]; mo = +eu[2]; y = +eu[3]; }
      else if (euSlash) { d = +euSlash[1]; mo = +euSlash[2]; y = +euSlash[3]; }
      else return null;
      const dob = new Date(Date.UTC(y, mo - 1, d));
      if (Number.isNaN(dob.getTime())) return null;
      const now = new Date(todayIso + 'T12:00:00Z');
      let age = now.getUTCFullYear() - dob.getUTCFullYear();
      const mDiff = now.getUTCMonth() - dob.getUTCMonth();
      if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
      if (age < 0 || age > 130) return null;
      return { age, dob: `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}` };
    }
    const parsed = parseAge(value);
    const blurredText = parsed ? `${parsed.age}y` : (value || '');
    return (
      <input
        value={focus ? value : blurredText}
        onChange={e => setValue(e.target.value)}
        placeholder="DOB or age"
        title={parsed && parsed.dob ? `DOB ${parsed.dob}` : undefined}
        onFocus={() => { setFocus(true); setValue(parsed && parsed.dob ? parsed.dob : value); }}
        onBlur={() => setFocus(false)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: focus ? t.bg : 'transparent',
          border: 'none',
          borderBottom: focus
            ? `1px solid ${t.amber}`
            : hover ? `1px dotted ${t.amberDim}` : '1px solid transparent',
          color: parsed ? t.amberDim : (value ? t.muted : t.mutedDim),
          font: parsed && !focus
            ? '500 11px/1.2 var(--font-mono)'
            : '400 11px/1.2 var(--font-mono)',
          padding: '1px 0',
          outline: 'none',
          width: '100%', minWidth: 0,
          letterSpacing: 0.5,
        }}
      />
    );
  }

  function PersonRow({ person }) {
    const initialRole = person.isDecisionMaker
      ? 'decision_maker'
      : (person.role || '').toLowerCase().includes('assistant') ? 'assistant'
      : (person.role || '').toLowerCase().includes('owner') ? 'owner'
      : 'other';
    const [role, setRole] = useState(initialRole);
    const [linkedin, setLinkedin] = useState(person.linkedin || null);
    const [notes, setNotes] = useState(person.notes || '');
    const [hover, setHover] = useState(false);
    const isDecisive = roleDef(role).decisive;
    const initial = (person.name || '?').trim().charAt(0).toUpperCase();

    const handleAvatarClick = () => {
      const current = linkedin || '';
      const next = window.prompt(
        linkedin
          ? `LinkedIn for ${person.name}\n\nEdit URL or leave blank to remove:`
          : `Add LinkedIn URL for ${person.name}:`,
        current
      );
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) { setLinkedin(null); return; }
      setLinkedin(trimmed);
      try { window.open(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`, '_blank'); } catch {}
    };

    return (
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: '32px 1.2fr 1.3fr 1fr 150px 70px',
          gap: 12, alignItems: 'center',
          padding: '12px 14px 12px 16px',
          background: isDecisive ? `${t.amber}2a` : (t.bgCard || t.bgElev),
          border: `1px solid ${isDecisive ? t.amberDim : t.lineDim}`,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {isDecisive && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: t.amber }} />}

        <button
          onClick={handleAvatarClick}
          title={linkedin ? `LinkedIn: ${linkedin} · click to edit` : 'Click to link LinkedIn'}
          style={{
            width: 28, height: 28,
            border: `1px solid ${linkedin ? '#0a66c2' : isDecisive ? t.amber : t.amberDim}`,
            background: linkedin ? '#0a66c2' : isDecisive ? `${t.amber}18` : 'transparent',
            color: linkedin ? '#ffffff' : isDecisive ? t.amber : t.muted,
            font: '600 12px/1 var(--font-mono)',
            cursor: 'pointer', padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            letterSpacing: 0.5,
          }}
        >
          {linkedin ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="LinkedIn">
              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
            </svg>
          ) : initial}
        </button>

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <InlineEditField defaultValue={person.name} placeholder="Full name" font="500 13px/1.2 var(--font-sans)" color={t.bone} />
          <InlineEditField defaultValue={person.title || ''} placeholder="Job title (e.g. CEO, Marketing Mgr)" font="400 11px/1.2 var(--font-sans)" color={t.muted} />
        </div>

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <DobAgeField defaultValue={person.dob} todayIso={D.TODAY} />
          <InlineEditField
            defaultValue={notes}
            placeholder="Notes · e.g. prefers WhatsApp after 16:00"
            font="400 11px/1.3 var(--font-sans)"
            color={t.muted}
            onBlurValue={v => setNotes(v)}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <InlineEditField defaultValue={person.phone || ''} placeholder="Phone" font="400 12px/1.2 var(--font-mono)" color={t.amber} />
          <InlineEditField defaultValue={person.email || ''} placeholder="Email" font="400 11px/1.2 var(--font-mono)" color={t.amber} />
        </div>

        <div style={{ position: 'relative' }}>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            style={{
              width: '100%',
              font: '500 10px/1 var(--font-mono)', letterSpacing: 1.1,
              padding: '8px 22px 8px 10px',
              color: isDecisive ? t.amber : t.muted,
              background: isDecisive ? `${t.amber}15` : (t.bgCard || t.bgElev),
              border: `1px solid ${isDecisive ? t.amber : t.lineDim}`,
              cursor: 'pointer', textTransform: 'uppercase',
              appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
              outline: 'none',
            }}
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r.value} value={r.value} style={{ background: '#f7f2e2', color: t.bone, textTransform: 'none' }}>
                {(r.decisive ? '● ' : '○ ') + r.label}
              </option>
            ))}
          </select>
          <span style={{
            position: 'absolute', right: 8, top: '50%',
            transform: 'translateY(-50%)',
            color: isDecisive ? t.amber : t.muted,
            font: '300 9px/1 var(--font-mono)',
            pointerEvents: 'none',
          }}>▾</span>
        </div>

        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', opacity: hover ? 1 : 0.5, transition: 'opacity 0.15s' }}>
          <button title="Call" style={miniIconBtn()}>
            <IconPhone size={12} color={t.muted} fill="none" />
          </button>
          <button title="Email" style={miniIconBtn()}>
            <IconEmail size={12} color={t.muted} fill="none" />
          </button>
          <button title="Remove person" style={{ ...miniIconBtn(), color: t.muted }}>✕</button>
        </div>
      </div>
    );
  }

  // ── Detail panel (calm progressive disclosure) ─────────────────────────
  function DetailPanel({ lead, onClose }) {
    const [status, setStatus] = useState(lead.status);
    const [showSecondary, setShowSecondary] = useState(false);
    const [tab, setTab] = useState('overview');
    const [focusMode, setFocusMode] = useState(() => {
      try { return localStorage.getItem('crm.detail.focus') === '1'; }
      catch { return false; }
    });
    useEffect(() => {
      try { localStorage.setItem('crm.detail.focus', focusMode ? '1' : '0'); } catch {}
    }, [focusMode]);
    useEffect(() => {
      function handler(e) {
        if (e.key !== 'f' && e.key !== 'F') return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        setFocusMode(f => !f);
      }
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, []);
    useEffect(() => { setStatus(lead.status); setShowSecondary(false); setTab(focusMode ? 'history' : 'overview'); }, [lead.id]);
    useEffect(() => { if (focusMode) setTab('history'); }, [focusMode]);

    const extras = leadExtras(lead);
    const uidRequired = status === 'won';

    return (
      <div key={lead.id} style={{ height: '100%', display: 'flex', flexDirection: 'column', animation: 'twipe 0.35s cubic-bezier(.2,.7,.3,1)' }}>
        {/* Header */}
        <div style={{ padding: '28px 28px 20px', borderBottom: `1px solid ${t.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <L c={t.amberDim}>{lead.id} · {D.STAGE[lead.stage].label}</L>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => setFocusMode(f => !f)} title={`${focusMode ? 'Exit' : 'Enter'} focus mode (f)`} style={{
                width: 26, height: 26, padding: 0,
                color: focusMode ? t.amber : t.muted,
                background: focusMode ? `${t.amber}10` : 'transparent',
                border: `1px solid ${focusMode ? t.amberDim : t.lineDim}`,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="2" y="2" width="12" height="3" />
                  <line x1="2" y1="8" x2="14" y2="8" />
                  <rect x="2" y="11" width="12" height="3" />
                </svg>
              </button>
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.muted, cursor: 'pointer', font: '300 18px/1 var(--font-mono)' }}>✕</button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: 12 }}>
            <h2 style={{ font: '500 28px/1.1 var(--font-sans)', color: t.bone, margin: 0, letterSpacing: -0.4, display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              {lead.starred && <span style={{ color: t.amber, fontSize: 18 }}>★</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company}</span>
            </h2>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {['todo','standby','awaiting','won','lost'].map(s => {
                const active = s === status;
                const def = D.STATUS[s];
                const c = def.hue === 'phosphor' ? t.phosphor : def.hue === 'red' ? t.red : def.hue === 'cyan' ? t.amberHi : t.amber;
                return (
                  <button key={s} onClick={() => setStatus(s)} style={{
                    font: '500 10px/1 var(--font-mono)',
                    letterSpacing: 1.3,
                    padding: '7px 10px',
                    color: active ? c : t.muted,
                    background: active ? `${c}15` : 'transparent',
                    border: `1px solid ${active ? c : t.lineDim}`,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}>{active ? '● ' : ''}{def.label}</button>
                );
              })}
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', font: '400 13px/1 var(--font-sans)', color: t.muted }}>
            <span>{lead.contact}</span>
            <M c={t.amber} sz={12}>{lead.phone}</M>
            <M c={t.amber} sz={12}>{lead.email}</M>
          </div>
        </div>

        {!focusMode && (
        <>
        {/* Big "next move" zone */}
        <div style={{ padding: '24px 28px', borderBottom: `1px solid ${t.lineDim}` }}>
          <L c={t.amberDim} sz={9}>NEXT MOVE</L>
          <div style={{ font: '500 22px/1.3 var(--font-sans)', color: t.bone, marginTop: 10, letterSpacing: -0.3 }}>{lead.note}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <Btn primary>EXECUTE</Btn>
            <Btn>SEND WHATSAPP</Btn>
            <Btn>LOG CALL</Btn>
            <Btn>LOG EMAIL</Btn>
          </div>
        </div>

        {/* Key metrics — Value, Probability, Employees, Due (Weighted dropped — it's CHF×prob) */}
        <div style={{ padding: '18px 28px', borderBottom: `1px solid ${t.lineDim}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr 1fr', gap: 20, alignItems: 'flex-start' }}>
          <Met label="Value" v={`CHF ${D.chf(lead.amount)}`} />
          <Met label="Probability" v={`${Math.round(lead.prob * 100)}%`} accent />
          <div>
            <L c={t.muted} sz={9} ls={1.2} style={{ textTransform: 'none' }}>Employees</L>
            <div style={{ display: 'flex', gap: 3, marginTop: 10 }}>
              {EMP_BUCKETS.map(b => {
                const active = b === extras.employees;
                return (
                  <button key={b} style={{
                    font: '500 10px/1 var(--font-mono)', letterSpacing: 0.5,
                    padding: '7px 8px', flex: 1,
                    color: active ? t.bone : t.muted,
                    background: active ? `${t.amber}15` : 'transparent',
                    border: `1px solid ${active ? t.amberDim : t.lineDim}`,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>{b}</button>
                );
              })}
            </div>
          </div>
          <Met label="Due" v={lead.due} red={D.daysBetween(D.TODAY, lead.due) > 0} />
        </div>
        </>
        )}

        {/* Progressive — tabbed secondary */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {!focusMode && (
          <div style={{ padding: '0 28px', borderBottom: `1px solid ${t.lineDim}`, display: 'flex', gap: 4 }}>
            {[['overview','Overview'],['comms','Conversation'],['needs','Needs / Solution'],['history','History', 11]].map(([k, lab, n]) => {
              const active = tab === k;
              return (
                <button key={k} onClick={() => setTab(k)} style={{
                  background: 'none', border: 'none', padding: '14px 12px 13px',
                  cursor: 'pointer',
                  font: '500 12px/1 var(--font-sans)',
                  color: active ? t.amber : t.muted,
                  borderBottom: `2px solid ${active ? t.amber : 'transparent'}`,
                  position: 'relative', top: 1,
                }}>{lab}{n != null && <span style={{ color: t.mutedDim, marginLeft: 6 }}>· {n}</span>}</button>
              );
            })}
          </div>
          )}

          <div style={{ padding: '22px 28px' }}>
            {(focusMode || tab === 'history') && <HistoryTab />}
            {!focusMode && tab === 'overview' && (
              <div>
                {/* People */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <L c={t.amberDim}>PEOPLE</L>
                  <L c={t.mutedDim} sz={9}>· {extras.people.length}</L>
                  <span style={{ flex: 1 }} />
                  <button style={{
                    font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4,
                    color: t.muted, background: 'transparent',
                    border: `1px dashed ${t.lineDim}`,
                    padding: '6px 10px', cursor: 'pointer', textTransform: 'uppercase',
                  }}>+ Add person</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
                  {extras.people.map(p => <PersonRow key={p.id} person={p} />)}
                  {extras.people.length === 0 && (
                    <div style={{
                      padding: 16, textAlign: 'center',
                      border: `1px dashed ${t.lineDim}`,
                      color: t.muted, font: '400 12px/1.4 var(--font-mono)', letterSpacing: 1,
                    }}>NO PEOPLE YET — ADD A CONTACT</div>
                  )}
                </div>

                {/* Address + identifiers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 22 }}>
                  <Field label="Strasse"><input defaultValue={extras.address.strasse} style={fieldInput()} /></Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8 }}>
                    <Field label="PLZ"><input defaultValue={extras.address.plz} style={fieldInput()} /></Field>
                    <Field label="Ort"><input defaultValue={extras.address.ort} style={fieldInput()} /></Field>
                  </div>
                  <Field label="Webpage">
                    {extras.webpage
                      ? <M c={t.amber} sz={13}>{extras.webpage}</M>
                      : <span style={{ color: t.mutedDim, font: '400 12px/1 var(--font-mono)' }}>—</span>}
                  </Field>
                  <Field label={`UID / MWSt.Nr${uidRequired ? ' · required for Won' : ' · optional'}`}>
                    {extras.uid
                      ? <M c={t.amber} sz={13}>{extras.uid}</M>
                      : <input placeholder={uidRequired ? 'CHE-XXX.XXX.XXX (required)' : 'CHE-XXX.XXX.XXX'} style={{
                          ...fieldInput(),
                          borderColor: uidRequired ? t.red + '70' : t.lineDim,
                          background: uidRequired ? `${t.red}06` : (t.bgCard || t.bgElev),
                        }} />}
                  </Field>
                </div>

                <Sec title="Comment">
                  <p style={{ font: '400 14px/1.6 var(--font-sans)', color: t.bone, margin: 0 }}>{lead.comment}</p>
                </Sec>
                <Sec title="Linked sessions · 1">
                  <div style={{ padding: 12, background: t.bgElev, borderLeft: `2px solid ${t.amberDim}` }}>
                    <M c={t.amber} sz={11}>2026-05-23-ristorante-la-pergola</M>
                    <div style={{ font: '400 11px/1 var(--font-mono)', color: t.muted, marginTop: 6 }}>2026-05-23 · Phase 1/7</div>
                  </div>
                </Sec>
              </div>
            )}
            {!focusMode && tab === 'comms' && <CommsTab lead={lead} />}
            {!focusMode && tab === 'needs' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
                <Sec title="Needs analysis">
                  <ul style={{ margin: 0, paddingLeft: 16, font: '400 14px/1.7 var(--font-sans)', color: t.bone }}>
                    <li>Outdated website (current: 2018)</li>
                    <li>NOKIA 3110 → needs iPhone</li>
                    <li>Old Intel Core Duo laptop</li>
                    <li>Still on Yahoo mail</li>
                  </ul>
                </Sec>
                <Sec title="Solutions bought">
                  <ul style={{ margin: 0, paddingLeft: 16, font: '400 14px/1.7 var(--font-sans)', color: t.bone }}>
                    <li>New website · CHF 8'000</li>
                    <li>LED façade retrofit</li>
                    <li>Alarm system + cameras</li>
                    <li>Email migration to Microsoft 365</li>
                  </ul>
                </Sec>
              </div>
            )}
          </div>
        </div>

        {/* Bottom snooze row */}
        <div style={{ borderTop: `1px solid ${t.line}`, padding: '12px 28px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <L c={t.mutedDim}>Snooze</L>
          <Btn sm>+1D</Btn>
          <Btn sm>+3D</Btn>
          <Btn sm>+1W</Btn>
          <span style={{ flex: 1 }} />
          <Btn primary>MARK DONE</Btn>
        </div>
      </div>
    );
  }

  function Sec({ title, children }) {
    return (
      <div style={{ marginBottom: 20 }}>
        <L c={t.amberDim} sz={9} style={{ display: 'block', marginBottom: 10 }}>{title}</L>
        {children}
      </div>
    );
  }

  function Met({ label, v, accent, red }) {
    return (
      <div>
        <L c={t.muted} sz={9} ls={1.2} style={{ textTransform: 'none' }}>{label}</L>
        <div style={{ font: '400 18px/1.1 var(--font-mono)', color: red ? t.red : accent ? t.amber : t.bone, marginTop: 8, letterSpacing: -0.3 }}>{v}</div>
      </div>
    );
  }

  function Field({ label, children }) {
    return (
      <div>
        <L c={t.muted} sz={9} ls={1.2} style={{ textTransform: 'none' }}>{label}</L>
        <div style={{ font: '400 13px/1.4 var(--font-sans)', color: t.bone, marginTop: 6 }}>{children}</div>
      </div>
    );
  }

  function Btn({ children, primary, sm, onClick }) {
    return (
      <button onClick={onClick} style={{
        font: `600 ${sm ? 9 : 10}px/1 var(--font-mono)`,
        letterSpacing: 1.4,
        padding: sm ? '7px 10px' : '10px 14px',
        background: primary ? t.amber : 'transparent',
        color: primary ? '#ffffff' : t.amber,
        border: `1px solid ${primary ? t.amber : t.amberDim}`,
        cursor: 'pointer',
        textTransform: 'uppercase',
      }}>{children}</button>
    );
  }

  function HistoryTab() {
    let lastDay = null;
    return (
      <div>
        {D.history.map((h, i) => {
          const show = h.day !== lastDay;
          lastDay = h.day;
          return (
            <React.Fragment key={i}>
              {show && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: i === 0 ? '0 0 12px' : '20px 0 12px' }}>
                  <L c={t.amber}>{h.day}</L>
                  <div style={{ flex: 1, height: 1, background: t.lineDim }} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 14, alignItems: 'baseline', padding: '8px 0' }}>
                <M c={t.mutedDim} sz={10}>{h.t}</M>
                <div style={{ font: '400 13px/1.4 var(--font-sans)', color: t.bone }}>
                  <span style={{ color: t.amber, fontFamily: 'var(--font-mono)', fontSize: 10, marginRight: 8, letterSpacing: 1, textTransform: 'uppercase' }}>{h.type}</span>
                  {h.text}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  function CommsTab({ lead }) {
    return (
      <div>
        <Sec title="Draft reply">
          <textarea
            rows={4}
            defaultValue={`Hi ${lead.contact?.split(' ')[0] || 'there'},\n\nFollowing up on our last call. ${lead.note}\n\nBest,`}
            style={{
              width: '100%', background: t.bgElev, color: t.bone,
              border: `1px solid ${t.line}`, padding: 12,
              font: '400 13px/1.5 var(--font-sans)',
            }}
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <Btn primary>SEND</Btn>
            <Btn>SAVE DRAFT</Btn>
          </div>
        </Sec>
        <Sec title="Recent · last 7 days">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Bubble dir="in" time="4d ago · WhatsApp" text="Vorrei sapere se possiamo programmare una chiamata la prossima settimana." />
            <Bubble dir="out" time="4d ago · WhatsApp" text="Certo, le propongo martedì 10:00 — funziona?" />
            <Bubble dir="in" time="3d ago · Email" text="Mi può inviare la proposta aggiornata?" />
          </div>
        </Sec>
      </div>
    );
  }

  function Bubble({ dir, time, text }) {
    const out = dir === 'out';
    return (
      <div style={{
        padding: '10px 12px',
        background: out ? `${t.amber}10` : t.bgElev,
        borderLeft: `2px solid ${out ? t.amber : t.amberDim}`,
        marginLeft: out ? 40 : 0,
        marginRight: out ? 0 : 40,
      }}>
        <L c={t.mutedDim} sz={9}>{out ? 'YOU' : 'THEM'} · {time}</L>
        <div style={{ font: '400 13px/1.5 var(--font-sans)', color: t.bone, marginTop: 4 }}>{text}</div>
      </div>
    );
  }

  // ── Filter helpers ────────────────────────────────────────────────────
  function applyFilter(leads, f) {
    if (f === 'all') return leads;
    if (f === 'overdue') return leads.filter(l => D.daysBetween(D.TODAY, l.due) > 0 && l.status !== 'won' && l.status !== 'cancelled');
    if (f === 'today') return leads.filter(l => l.due === D.TODAY);
    if (f === 'stuck') return leads.filter(l => l.stage === 'closing' && D.daysBetween(D.TODAY, l.due) >= 0 && l.status !== 'won');
    if (f === 'whatsapp') return leads.filter(l => l.unmatchedWhatsapp);
    if (['incoming','contacted','demo','closing'].includes(f)) return leads.filter(l => l.stage === f);
    return leads;
  }

  function V3Focus() {
    const [filter, setFilter] = useState('overdue'); // start on most important
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [leadsState] = useState(D.leads);

    // Hero dismissal — persists per-day so dismissals reset overnight
    const [dismissed, setDismissed] = useState(() => {
      try {
        const raw = localStorage.getItem('crm.hero.dismissed');
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (parsed.date !== D.TODAY) return new Set();
        return new Set(parsed.ids || []);
      } catch { return new Set(); }
    });
    useEffect(() => {
      try {
        localStorage.setItem('crm.hero.dismissed', JSON.stringify({
          date: D.TODAY,
          ids: [...dismissed],
        }));
      } catch {}
    }, [dismissed]);

    const selected = leadsState.find(l => l.id === selectedId);
    const filtered = useMemo(() => {
      let rows = applyFilter(leadsState, filter);
      if (query.trim()) {
        const q = query.toLowerCase();
        rows = rows.filter(l =>
          l.company.toLowerCase().includes(q) ||
          (l.contact || '').toLowerCase().includes(q) ||
          (l.tag || '').toLowerCase().includes(q));
      }
      return rows.slice().sort((a, b) => {
        const da = D.daysBetween(D.TODAY, a.due);
        const db = D.daysBetween(D.TODAY, b.due);
        if (db !== da) return db - da;
        return (b.amount * b.prob) - (a.amount * a.prob);
      });
    }, [leadsState, filter, query]);

    const qc = D.queues(leadsState);

    // Hero pick — layered priority:
    //   (1) Inbound WhatsApp waiting for reply
    //   (2) Inbound email waiting for reply
    //   (3) Fallback: highest weighted overdue/today
    // Dismissed leads are skipped so the hero rotates instead of going stale.
    const heroPick = useMemo(() => {
      const undismissed = leadsState.filter(l => !dismissed.has(l.id));

      const urgencyScore = l => {
        const od = D.daysBetween(D.TODAY, l.due);
        return (Math.max(0, od) * 5)
             + (l.starred ? 4 : 0)
             + (l.amount * l.prob / 5000);
      };

      // Pool 1 — Inbound WhatsApp
      const newWA = undismissed.filter(l => channelStates(l).whatsapp === 'new');
      if (newWA.length) {
        const lead = newWA.slice().sort((a, b) => urgencyScore(b) - urgencyScore(a))[0];
        return {
          lead,
          reason: 'INBOUND WHATSAPP · NEEDS REPLY',
          tone: t.phosphor,
          pool: 'whatsapp',
          primaryAction: 'whatsapp',
        };
      }

      // Pool 2 — Inbound email
      const newEmail = undismissed.filter(l => channelStates(l).email === 'new');
      if (newEmail.length) {
        const lead = newEmail.slice().sort((a, b) => urgencyScore(b) - urgencyScore(a))[0];
        return {
          lead,
          reason: 'NEW EMAIL · NEEDS REPLY',
          tone: t.amber,
          pool: 'email',
          primaryAction: 'email',
        };
      }

      // Pool 3 — Overdue / today
      const overdueOrToday = undismissed.filter(l =>
        l.due === D.TODAY || D.daysBetween(D.TODAY, l.due) > 0
      );
      if (overdueOrToday.length) {
        const lead = overdueOrToday.slice().sort((a, b) => urgencyScore(b) - urgencyScore(a))[0];
        const od = D.daysBetween(D.TODAY, lead.due);
        return {
          lead,
          reason: od > 0
            ? `${od}D OVERDUE · ${lead.starred ? 'STARRED' : 'HIGHEST WEIGHTED'}`
            : 'DUE TODAY · HIGHEST WEIGHTED',
          tone: od > 0 ? t.red : t.amberHi,
          pool: 'urgency',
          primaryAction: 'open',
        };
      }

      return null;
    }, [leadsState, dismissed]);

    function dismissHero() {
      if (heroPick && heroPick.lead) {
        setDismissed(prev => new Set([...prev, heroPick.lead.id]));
      }
    }
    function resetDismissed() {
      setDismissed(new Set());
    }

    const open = !!selected;

    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: t.bg,
        color: t.bone,
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Top bar */}
        <div style={{ padding: '14px 28px', borderBottom: `1px solid ${t.line}`, display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ font: '600 14px/1 var(--font-sans)', color: t.bone, letterSpacing: -0.3 }}>OskarOS</span>
            <L c={t.amberDim}>· CRM</L>
          </div>
          {/* Nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginLeft: 14 }}>
            <a href="index.html" onClick={e => e.preventDefault()} style={{
              font: '500 11px/1 var(--font-mono)', letterSpacing: 1.4, textTransform: 'uppercase',
              color: t.amber, textDecoration: 'none',
              padding: '8px 12px', background: `${t.amber}10`,
              border: `1px solid ${t.amberDim}`,
            }}>Overview</a>
            <a href={(typeof location !== 'undefined' && location.pathname.includes('-light')) ? 'kanban-light.html' : 'kanban.html'} style={{
              font: '500 11px/1 var(--font-mono)', letterSpacing: 1.4, textTransform: 'uppercase',
              color: t.muted, textDecoration: 'none',
              padding: '8px 12px', background: 'transparent',
              border: '1px solid transparent',
              transition: 'color 0.15s, background 0.15s',
            }} onMouseEnter={e => { e.currentTarget.style.color = t.amber; e.currentTarget.style.background = '#ffffff05'; }}
              onMouseLeave={e => { e.currentTarget.style.color = t.muted; e.currentTarget.style.background = 'transparent'; }}
            >Kanban</a>
          </div>
          <span style={{ flex: 1 }} />
          <L c={t.muted}>{D.TODAY} · Tue</L>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: t.amberDim }} />
          <L c={t.muted}>{leadsState.length} leads</L>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: t.amberDim }} />
          <ThemeToggle t={t} />
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: t.amberDim }} />
          <Clock />
        </div>

        {/* Main */}
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: open ? '420px minmax(0,1fr) 500px' : '460px minmax(0,1fr) 500px',
          minHeight: 0,
        }}>
          {/* LEFT — TRIAGE COLUMN */}
          <div style={{ borderRight: `1px solid ${t.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '32px 24px 14px' }}>
              <L c={t.amberDim}>Good morning · Tue 26 May</L>
              <div style={{ font: '500 26px/1.15 var(--font-sans)', color: t.bone, marginTop: 12, letterSpacing: -0.5, textWrap: 'pretty' }}>
                {qc.overdue + qc.today} items need you. Start with the {qc.overdue} overdue.
              </div>
            </div>

            <div>
              <TriageRow idx={0} count={qc.overdue}      label="Overdue follow-ups"     sub="Past their due date · prioritize calls first" tone="red"    active={filter==='overdue'}  onClick={() => setFilter('overdue')} />
              <TriageRow idx={1} count={qc.today}        label="Due today"              sub="On the docket for Tue 26 May"                       tone="yellow" active={filter==='today'}    onClick={() => setFilter('today')} />
              <TriageRow idx={2} count={qc.stuckClosing} label="Stuck in Closing"       sub="In closing ≥2d with no movement · unblock"          tone="orange" active={filter==='stuck'}    onClick={() => setFilter('stuck')} />
              <TriageRow idx={3} count={qc.unmatchedWA}  label="Unmatched WhatsApp"     sub="Inbound messages waiting for routing"               tone="green"  active={filter==='whatsapp'} onClick={() => setFilter('whatsapp')} />
            </div>

            <div style={{ flex: 1 }} />
            <div style={{ padding: '12px 24px', borderTop: `1px solid ${t.lineDim}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <L c={t.mutedDim}>Pipeline</L>
              <M c={t.bone} sz={12}>CHF {D.chf(leadsState.reduce((s, l) => s + l.amount, 0))}</M>
              <span style={{ flex: 1 }} />
              <L c={t.mutedDim}>Weighted</L>
              <M c={t.amber} sz={12}>CHF {D.chf(leadsState.reduce((s, l) => s + l.amount * l.prob, 0))}</M>
            </div>
          </div>

          {/* RIGHT — when closed: filtered list + next-move card; when open: detail */}
          {!open && (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {heroPick && <NextMoveHero pick={heroPick} dismissedCount={dismissed.size} onDismiss={dismissHero} onResetDismissed={resetDismissed} onOpen={() => setSelectedId(heroPick.lead.id)} />}

              {/* Query strip */}
              <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: `1px solid ${t.lineDim}` }}>
                <L c={t.amberDim}>
                  {filter === 'all'      && 'All open'}
                  {filter === 'overdue'  && 'Overdue'}
                  {filter === 'today'    && 'Due today'}
                  {filter === 'stuck'    && 'Stuck in Closing'}
                  {filter === 'whatsapp' && 'Unmatched WhatsApp'}
                  {['incoming','contacted','demo','closing'].includes(filter) && D.STAGE[filter].label.charAt(0) + D.STAGE[filter].label.slice(1).toLowerCase()}
                </L>
                <L c={t.mutedDim}>· {filtered.length} leads</L>
                <span style={{ flex: 1 }} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search …" style={{
                  background: t.bgElev, border: `1px solid ${t.lineDim}`,
                  color: t.bone, font: '400 12px/1 var(--font-mono)',
                  padding: '7px 10px', width: 240,
                }} />
                <select value={filter} onChange={e => setFilter(e.target.value)} style={{
                  background: t.bgElev, color: t.bone, border: `1px solid ${t.lineDim}`,
                  padding: '7px 10px', font: '400 11px/1 var(--font-mono)',
                }}>
                  <option value="all">All open · {leadsState.length}</option>
                  <option value="overdue">Overdue · {qc.overdue}</option>
                  <option value="today">Today · {qc.today}</option>
                  <option value="stuck">Stuck closing · {qc.stuckClosing}</option>
                  <option value="whatsapp">Unmatched WA · {qc.unmatchedWA}</option>
                  <option value="incoming">Incoming · {leadsState.filter(l=>l.stage==='incoming').length}</option>
                  <option value="contacted">Contacted · {leadsState.filter(l=>l.stage==='contacted').length}</option>
                  <option value="demo">Demo done · {leadsState.filter(l=>l.stage==='demo').length}</option>
                  <option value="closing">Closing · {leadsState.filter(l=>l.stage==='closing').length}</option>
                </select>
              </div>

              <div style={{ flex: 1, overflow: 'auto' }}>
                {filtered.map((l, i) => (
                  <div key={l.id} style={{ animation: `triseup 0.4s cubic-bezier(.2,.7,.3,1) ${Math.min(i * 0.04, 0.4)}s both` }}>
                    <LeadRow lead={l} selected={l.id === selectedId} onClick={() => setSelectedId(l.id)} />
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div style={{ padding: 48, textAlign: 'center', color: t.muted, font: '400 13px/1.4 var(--font-sans)' }}>
                    Nothing here. Pick another queue.
                  </div>
                )}
              </div>
            </div>
          )}
          {open && (
            <div style={{ overflow: 'hidden', borderLeft: `1px solid ${t.amberDim}` }}>
              <DetailPanel lead={selected} onClose={() => setSelectedId(null)} />
            </div>
          )}

          {/* RIGHT RAIL — Flight Deck (top) + Consular chat (below) */}
          <div style={{ borderLeft: `1px solid ${t.line}`, background: t.bg, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <FlightDeck leads={leadsState} qc={qc} onSelect={setSelectedId} t={t} />
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatRail leads={leadsState} qc={qc} heroPick={heroPick} onSelect={setSelectedId} t={t} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  function ThemeToggle({ t }) {
    const path = (typeof location !== 'undefined' && location.pathname) || '';
    const filename = path.split('/').pop() || '';
    const isLight = filename.includes('-light');
    const otherFile = isLight
      ? filename.replace('-light.html', '.html')
      : filename.replace('.html', '-light.html');
    return (
      <div style={{ display: 'inline-flex', border: `1px solid ${t.lineDim}` }}>
        <a href={isLight ? otherFile : undefined}
           onClick={!isLight ? (e) => e.preventDefault() : undefined}
           title="Onyx (dark)"
           style={{
             font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2,
             padding: '6px 9px',
             color: !isLight ? t.amber : t.muted,
             background: !isLight ? `${t.amber}15` : 'transparent',
             textDecoration: 'none',
             cursor: !isLight ? 'default' : 'pointer',
           }}>ONYX</a>
        <a href={!isLight ? otherFile : undefined}
           onClick={isLight ? (e) => e.preventDefault() : undefined}
           title="Polar (light)"
           style={{
             font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2,
             padding: '6px 9px',
             color: isLight ? t.amber : t.muted,
             background: isLight ? `${t.amber}15` : 'transparent',
             textDecoration: 'none',
             cursor: isLight ? 'default' : 'pointer',
             borderLeft: `1px solid ${t.lineDim}`,
           }}>POLAR</a>
      </div>
    );
  }

  window.V3Focus = V3Focus;
})();
