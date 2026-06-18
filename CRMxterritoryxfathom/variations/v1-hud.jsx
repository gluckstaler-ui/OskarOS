// Variation A — "TACTICAL HUD"
// Heavy mono labels, corner brackets, scanlines, animated dashes, glitch wipes.
// Amber/phosphor terminal feel. Inter + JetBrains Mono.

(function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const D = window.CRMData;

  // ── Tokens ──────────────────────────────────────────────────────────────
  const t = {
    bg:        '#0a0805',
    bgElev:    '#120e08',
    bgSurf:    '#1a140b',
    line:      '#3a2c12',
    lineDim:   '#241a0a',
    amber:     '#ffa940',
    amberHi:   '#ffd166',
    amberDim:  '#8a6a2c',
    phosphor:  '#b8f060',
    cyan:      '#74e0e0',
    red:       '#ff5a3c',
    bone:      '#f4ead4',
    muted:     '#7a6a52',
    mutedDim:  '#4a3f30',
  };

  // ── Atoms ───────────────────────────────────────────────────────────────

  // Corner brackets — Territory's signature tactical frame.
  function Brackets({ size = 10, color = t.amberDim, thick = 1, only }) {
    const s = { position: 'absolute', width: size, height: size, borderColor: color, borderStyle: 'solid', pointerEvents: 'none' };
    const show = c => !only || only.includes(c);
    return (
      <>
        {show('tl') && <span style={{ ...s, top: -1, left: -1, borderWidth: `${thick}px 0 0 ${thick}px` }} />}
        {show('tr') && <span style={{ ...s, top: -1, right: -1, borderWidth: `${thick}px ${thick}px 0 0` }} />}
        {show('bl') && <span style={{ ...s, bottom: -1, left: -1, borderWidth: `0 0 ${thick}px ${thick}px` }} />}
        {show('br') && <span style={{ ...s, bottom: -1, right: -1, borderWidth: `0 ${thick}px ${thick}px 0` }} />}
      </>
    );
  }

  // Animated dashed divider (left→right marching ants)
  function Dashes({ color = t.amberDim, height = 1, speed = '1.2s', style }) {
    return (
      <div style={{
        height,
        backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 10px)`,
        backgroundSize: '10px 100%',
        animation: `tdash ${speed} linear infinite`,
        ...style,
      }} />
    );
  }

  // Mono label
  function Lbl({ children, color = t.muted, size = 10, weight = 500, ls = 1.4, style }) {
    return (
      <span style={{
        font: `${weight} ${size}px/1 var(--font-mono)`,
        letterSpacing: ls,
        textTransform: 'uppercase',
        color,
        ...style,
      }}>{children}</span>
    );
  }

  // Live clock
  function Clock() {
    const [now, setNow] = useState(new Date());
    useEffect(() => {
      const id = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(id);
    }, []);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return (
      <span style={{ font: '500 11px/1 var(--font-mono)', color: t.amber, letterSpacing: 1.5 }}>
        {hh}:{mm}<span style={{ animation: 'tcaret 1s steps(2) infinite' }}>:</span>{ss}
      </span>
    );
  }

  // Telemetry ticker — endless mono strip
  function Ticker({ items }) {
    const strip = [...items, ...items];
    return (
      <div style={{ overflow: 'hidden', flex: 1, position: 'relative', maskImage: 'linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent)' }}>
        <div style={{ display: 'inline-flex', gap: 28, animation: 'tticker 60s linear infinite', whiteSpace: 'nowrap' }}>
          {strip.map((it, i) => (
            <span key={i} style={{ font: '400 10px/1 var(--font-mono)', color: t.muted, letterSpacing: 0.8 }}>
              <span style={{ color: t.amberDim }}>▸</span> {it}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Status pill
  function StatusPill({ status, mono = true }) {
    const s = D.STATUS[status];
    const c = s.hue === 'amber'    ? t.amber
            : s.hue === 'phosphor' ? t.phosphor
            : s.hue === 'cyan'     ? t.cyan
            : s.hue === 'red'      ? t.red
            : t.muted;
    return (
      <span style={{
        font: `500 9px/1 ${mono ? 'var(--font-mono)' : 'var(--font-sans)'}`,
        letterSpacing: 1.2,
        color: c,
        padding: '4px 6px',
        border: `1px solid ${c}66`,
        background: `${c}10`,
        textTransform: 'uppercase',
      }}>● {s.label}</span>
    );
  }

  // Mini sparkline (dash density representing heat)
  function HeatBars({ heat = 0.5, total = 12 }) {
    const filled = Math.round(heat * total);
    return (
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} style={{
            width: 6, height: 8,
            background: i < filled ? t.amber : t.lineDim,
            opacity: i < filled ? (0.4 + 0.6 * (i / total)) : 1,
          }} />
        ))}
      </div>
    );
  }

  // ── Triage Slab — the hero of the closed view ──────────────────────────
  function TriageSlab({ count, label, sub, hue, onClick, active, kbd }) {
    const c = hue === 'red'      ? t.red
            : hue === 'amber'    ? t.amber
            : hue === 'phosphor' ? t.phosphor
            : t.cyan;
    return (
      <button onClick={onClick} style={{
        position: 'relative',
        background: active ? `${c}14` : 'transparent',
        border: `1px solid ${active ? c : c + '40'}`,
        padding: '14px 16px 12px',
        textAlign: 'left',
        cursor: 'pointer',
        color: t.bone,
        font: 'inherit',
        transition: 'background 0.15s, border-color 0.15s',
        overflow: 'hidden',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = `${c}08`; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        <Brackets color={c} thick={1.5} size={8} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Lbl color={c} size={9} ls={1.6}>{label}</Lbl>
          <Lbl color={c + '99'} size={9} ls={1.4}>[{kbd}]</Lbl>
        </div>
        <div style={{
          font: '300 56px/1 var(--font-mono)',
          color: c,
          marginTop: 6,
          letterSpacing: -2,
          textShadow: `0 0 18px ${c}55`,
        }}>
          {String(count).padStart(2, '0')}
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lbl color={t.muted} size={9}>{sub}</Lbl>
          <span style={{ flex: 1 }} />
          <span style={{ font: '500 10px/1 var(--font-mono)', color: c, letterSpacing: 1 }}>→</span>
        </div>
        {/* hairline progress bar */}
        <div style={{ marginTop: 10, height: 2, background: t.lineDim, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, count * 8)}%`, background: c, opacity: 0.7 }} />
        </div>
      </button>
    );
  }

  // ── Lead row (compact) ─────────────────────────────────────────────────
  function LeadRow({ lead, onClick, selected, idx }) {
    const overdueDays = D.daysBetween(D.TODAY, lead.due);
    const isOverdue = overdueDays > 0 && lead.status !== 'won' && lead.status !== 'cancelled';
    const isToday   = lead.due === D.TODAY;
    const accent = isOverdue ? t.red : isToday ? t.amberHi : t.amberDim;
    return (
      <button onClick={onClick} style={{
        display: 'grid',
        gridTemplateColumns: '20px 78px 1fr 70px 64px 90px 26px',
        gap: 10,
        alignItems: 'center',
        padding: '10px 12px',
        background: selected ? `${t.amber}10` : 'transparent',
        borderLeft: `2px solid ${selected ? t.amber : accent}`,
        borderTop: `1px solid ${t.lineDim}`,
        cursor: 'pointer',
        color: t.bone,
        font: 'inherit',
        textAlign: 'left',
        width: '100%',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#ffffff05'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
      >
        <Lbl color={t.mutedDim} size={9}>{String(idx + 1).padStart(2, '0')}</Lbl>
        <div>
          <Lbl color={isOverdue ? t.red : isToday ? t.amberHi : t.muted} size={9}>
            {isOverdue ? `T+${overdueDays}D` : isToday ? 'TODAY' : `T-${-overdueDays}D`}
          </Lbl>
          <div style={{ font: '400 10px/1.2 var(--font-mono)', color: t.mutedDim, marginTop: 3 }}>
            {lead.due}
          </div>
        </div>
        <div>
          <div style={{ font: '500 13px/1.2 var(--font-sans)', color: t.bone, display: 'flex', alignItems: 'center', gap: 6 }}>
            {lead.starred && <span style={{ color: t.amber, fontSize: 10 }}>★</span>}
            {lead.company}
          </div>
          <div style={{ font: '400 11px/1.3 var(--font-sans)', color: t.muted, marginTop: 2 }}>
            {lead.contact} · <span style={{ color: t.mutedDim }}>{lead.tag}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', font: '500 12px/1 var(--font-mono)', color: t.bone, letterSpacing: 0.5 }}>
          {D.chf(lead.amount)}
          <div style={{ font: '400 10px/1 var(--font-mono)', color: t.mutedDim, marginTop: 3 }}>CHF</div>
        </div>
        <div style={{ textAlign: 'right', font: '500 12px/1 var(--font-mono)', color: t.amber }}>
          {Math.round(lead.prob * 100)}%
        </div>
        <HeatBars heat={lead.heat} total={9} />
        <span style={{ font: '300 12px/1 var(--font-mono)', color: t.amberDim }}>›</span>
      </button>
    );
  }

  // ── Detail panel (open state) ───────────────────────────────────────────
  function DetailPanel({ lead, onClose }) {
    const [tab, setTab] = useState('overview'); // overview | conversation | needs | history
    const [status, setStatus] = useState(lead.status);
    useEffect(() => setStatus(lead.status), [lead.id, lead.status]);

    const statusOpts = ['todo', 'standby', 'awaiting', 'won', 'lost'];

    return (
      <div key={lead.id} style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', animation: 'twipe 0.35s cubic-bezier(.2,.7,.3,1)' }}>
        {/* Header */}
        <div style={{ padding: '14px 18px 12px', borderBottom: `1px solid ${t.line}`, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Lbl color={t.amberDim} size={9}>{lead.id} ▪ {D.STAGE[lead.stage].label}</Lbl>
              <Lbl color={t.muted} size={9}>· {lead.channel.toUpperCase()}</Lbl>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.amberDim, cursor: 'pointer', font: '300 16px/1 var(--font-mono)', padding: 4 }}>✕</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
            <h2 style={{ font: '500 22px/1.1 var(--font-sans)', color: t.bone, margin: 0, letterSpacing: -0.3 }}>
              {lead.company}
            </h2>
            {lead.starred && <span style={{ color: t.amber }}>★</span>}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, font: '400 12px/1 var(--font-sans)', color: t.muted }}>
            <span>{lead.contact}</span>
            <span style={{ color: t.mutedDim }}>·</span>
            <span style={{ color: t.amber, fontFamily: 'var(--font-mono)' }}>{lead.phone}</span>
            <span style={{ color: t.mutedDim }}>·</span>
            <span style={{ color: t.amber, fontFamily: 'var(--font-mono)' }}>{lead.email}</span>
          </div>
        </div>

        {/* Status row */}
        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${t.lineDim}`, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {statusOpts.map(s => {
            const active = s === status;
            const def = D.STATUS[s];
            const c = def.hue === 'amber' ? t.amber : def.hue === 'phosphor' ? t.phosphor : def.hue === 'cyan' ? t.cyan : def.hue === 'red' ? t.red : t.muted;
            return (
              <button key={s} onClick={() => setStatus(s)} style={{
                font: '500 10px/1 var(--font-mono)',
                letterSpacing: 1.2,
                padding: '7px 10px',
                color: active ? c : t.muted,
                background: active ? `${c}1a` : 'transparent',
                border: `1px solid ${active ? c : t.lineDim}`,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}>{active && '● '}{def.label}</button>
            );
          })}
        </div>

        {/* Key metrics strip */}
        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${t.lineDim}`, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <Metric label="VALUE / CHF" value={D.chf(lead.amount)} accent={t.bone} />
          <Metric label="PROBABILITY" value={`${Math.round(lead.prob * 100)}%`} accent={t.amber} />
          <Metric label="WEIGHTED"    value={D.chf(lead.amount * lead.prob)} accent={t.amber} />
          <Metric label="DUE"         value={lead.due} sub={D.daysBetween(D.TODAY, lead.due) > 0 ? `${D.daysBetween(D.TODAY, lead.due)}D OVERDUE` : 'ON TIME'} accent={D.daysBetween(D.TODAY, lead.due) > 0 ? t.red : t.phosphor} />
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: `1px solid ${t.line}`, display: 'flex', gap: 0, padding: '0 18px' }}>
          {[
            ['overview',     'OVERVIEW'],
            ['conversation', 'CONVERSATION', 11],
            ['needs',        'NEEDS / SOLUTION'],
            ['history',      'HISTORY', 11],
          ].map(([key, label, n]) => {
            const active = tab === key;
            return (
              <button key={key} onClick={() => setTab(key)} style={{
                background: 'none', border: 'none', padding: '10px 0', marginRight: 22,
                cursor: 'pointer',
                font: '500 10px/1 var(--font-mono)', letterSpacing: 1.4,
                color: active ? t.amber : t.muted,
                borderBottom: `2px solid ${active ? t.amber : 'transparent'}`,
                position: 'relative', top: 1,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                {label}
                {n != null && <span style={{ color: active ? t.amberDim : t.mutedDim }}>{n}</span>}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
          {tab === 'overview' && <OverviewTab lead={lead} />}
          {tab === 'conversation' && <ConversationTab lead={lead} />}
          {tab === 'needs' && <NeedsTab lead={lead} />}
          {tab === 'history' && <HistoryTab lead={lead} />}
        </div>

        {/* Bottom action row */}
        <div style={{ borderTop: `1px solid ${t.line}`, padding: '12px 18px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <ActBtn primary>SEND WHATSAPP</ActBtn>
          <ActBtn>LOG CALL</ActBtn>
          <ActBtn>LOG EMAIL</ActBtn>
          <span style={{ flex: 1 }} />
          <Lbl color={t.mutedDim}>SNOOZE</Lbl>
          <ActBtn small>+1D</ActBtn>
          <ActBtn small>+3D</ActBtn>
          <ActBtn small>+1W</ActBtn>
          <ActBtn small primary>DONE</ActBtn>
        </div>
      </div>
    );
  }

  function Metric({ label, value, sub, accent = '#fff' }) {
    return (
      <div>
        <Lbl color={t.mutedDim} size={9}>{label}</Lbl>
        <div style={{ font: '400 20px/1.1 var(--font-mono)', color: accent, marginTop: 5, letterSpacing: -0.5 }}>
          {value}
        </div>
        {sub && <div style={{ font: '500 9px/1 var(--font-mono)', color: t.muted, marginTop: 4, letterSpacing: 1 }}>{sub}</div>}
      </div>
    );
  }

  function ActBtn({ children, primary, small, onClick }) {
    return (
      <button onClick={onClick} style={{
        font: `600 ${small ? 9 : 10}px/1 var(--font-mono)`,
        letterSpacing: 1.2,
        padding: small ? '6px 8px' : '8px 12px',
        background: primary ? t.amber : 'transparent',
        color: primary ? '#0a0805' : t.amber,
        border: `1px solid ${primary ? t.amber : t.amberDim}`,
        cursor: 'pointer',
        textTransform: 'uppercase',
      }}>{children}</button>
    );
  }

  // ── Detail tabs ─────────────────────────────────────────────────────────

  function OverviewTab({ lead }) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Section title="NEXT MOVE">
          <p style={{ font: '400 13px/1.5 var(--font-sans)', color: t.bone, margin: 0 }}>{lead.note}</p>
          <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
            <ActBtn small primary>EXECUTE</ActBtn>
            <ActBtn small>RESCHEDULE</ActBtn>
          </div>
        </Section>
        <Section title="COMMENT">
          <p style={{ font: '400 13px/1.5 var(--font-sans)', color: t.bone, margin: 0 }}>{lead.comment}</p>
        </Section>
        <Section title="TAGS">
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ font: '400 11px/1 var(--font-mono)', color: t.amber, border: `1px solid ${t.amberDim}`, padding: '5px 8px' }}>
              {lead.tag} <span style={{ color: t.mutedDim, marginLeft: 6 }}>×</span>
            </span>
            <button style={{ font: '400 11px/1 var(--font-mono)', color: t.muted, background: 'none', border: `1px dashed ${t.lineDim}`, padding: '5px 8px', cursor: 'pointer' }}>+ tag</button>
          </div>
        </Section>
        <Section title="LINKED SESSIONS · 1">
          <div style={{ border: `1px solid ${t.line}`, padding: 10, position: 'relative' }}>
            <Brackets color={t.amberDim} size={6} />
            <div style={{ font: '500 11px/1 var(--font-mono)', color: t.amber }}>2026-05-23-ristorante-la-pergola</div>
            <div style={{ font: '400 10px/1 var(--font-mono)', color: t.muted, marginTop: 6 }}>2026-05-23 · Phase 1/7</div>
          </div>
        </Section>
      </div>
    );
  }

  function ConversationTab({ lead }) {
    return (
      <div>
        <Section title="DRAFT REPLY">
          <textarea
            rows={4}
            defaultValue={`Hi ${lead.contact?.split(' ')[0] || 'there'},\n\nFollowing up on our last call. ${lead.note} Could you let me know by EOW?\n\nBest,`}
            style={{
              width: '100%', background: t.bgElev, color: t.bone,
              border: `1px solid ${t.line}`, padding: 10,
              font: '400 13px/1.5 var(--font-sans)', resize: 'vertical',
            }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <ActBtn small primary>SEND</ActBtn>
            <ActBtn small>SAVE DRAFT</ActBtn>
          </div>
        </Section>
        <div style={{ height: 16 }} />
        <Section title="LAST MESSAGE · INBOUND">
          <div style={{ font: '400 13px/1.6 var(--font-sans)', color: t.bone, background: t.bgElev, padding: 12, border: `1px solid ${t.lineDim}` }}>
            "Vorrei sapere se possiamo programmare una chiamata la prossima settimana. Sono libero martedì o giovedì."
          </div>
          <div style={{ font: '400 10px/1 var(--font-mono)', color: t.muted, marginTop: 6 }}>RECEIVED · 4D AGO · WHATSAPP</div>
        </Section>
      </div>
    );
  }

  function NeedsTab({ lead }) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Section title="NEEDS ANALYSIS">
          <ul style={{ margin: 0, paddingLeft: 16, font: '400 13px/1.7 var(--font-sans)', color: t.bone }}>
            <li>Outdated website (current: 2018)</li>
            <li>NOKIA 3110 → needs iPhone</li>
            <li>Old Intel Core Duo laptop</li>
            <li>Still on Yahoo mail</li>
          </ul>
        </Section>
        <Section title="SOLUTIONS BOUGHT">
          <ul style={{ margin: 0, paddingLeft: 16, font: '400 13px/1.7 var(--font-sans)', color: t.bone }}>
            <li>New website · CHF 8'000</li>
            <li>LED façade retrofit</li>
            <li>Alarm system + cameras</li>
            <li>Email migration to Microsoft 365</li>
          </ul>
        </Section>
      </div>
    );
  }

  function HistoryTab({ lead }) {
    let lastDay = null;
    return (
      <div>
        {D.history.map((h, i) => {
          const showDay = h.day !== lastDay;
          lastDay = h.day;
          return (
            <React.Fragment key={i}>
              {showDay && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: i === 0 ? '0 0 12px' : '18px 0 12px' }}>
                  <Lbl color={t.amber} size={10}>{h.day}</Lbl>
                  <div style={{ flex: 1, height: 1, background: t.lineDim }} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '50px 14px 1fr', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                <Lbl color={t.mutedDim} size={10}>{h.t}</Lbl>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: h.type === 'discovery' ? t.phosphor : h.type === 'status' ? t.amber : h.type === 'call' ? t.cyan : h.type === 'email' ? t.amberHi : t.muted,
                  boxShadow: '0 0 8px currentColor',
                }} />
                <span style={{ font: '400 12px/1.4 var(--font-sans)', color: t.bone }}>{h.text}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  function Section({ title, children }) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Lbl color={t.amberDim}>{title}</Lbl>
          <Dashes color={t.lineDim} style={{ flex: 1 }} />
        </div>
        {children}
      </div>
    );
  }

  // ── Lead list filter helpers ───────────────────────────────────────────
  function applyFilter(leads, f) {
    if (f === 'all') return leads;
    if (f === 'overdue') return leads.filter(l => D.daysBetween(D.TODAY, l.due) > 0 && l.status !== 'won' && l.status !== 'cancelled');
    if (f === 'today') return leads.filter(l => l.due === D.TODAY);
    if (f === 'week')  return leads.filter(l => { const d = D.daysBetween(D.TODAY, l.due); return d >= -7 && d <= 0; });
    if (f === 'stuck') return leads.filter(l => l.stage === 'closing' && D.daysBetween(D.TODAY, l.due) >= 0 && l.status !== 'won');
    if (f === 'whatsapp') return leads.filter(l => l.unmatchedWhatsapp);
    if (['incoming','contacted','demo','closing'].includes(f)) return leads.filter(l => l.stage === f);
    if (['call','email','meeting','whatsapp_ch'].includes(f)) {
      const ch = f === 'whatsapp_ch' ? 'whatsapp' : f;
      return leads.filter(l => l.channel === ch);
    }
    return leads;
  }

  // ── The variation ──────────────────────────────────────────────────────
  function V1HUD() {
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [leadsState, setLeadsState] = useState(D.leads);

    const selected = useMemo(
      () => leadsState.find(l => l.id === selectedId),
      [leadsState, selectedId]
    );

    const filtered = useMemo(() => {
      let rows = applyFilter(leadsState, filter);
      if (query.trim()) {
        const q = query.toLowerCase();
        rows = rows.filter(l =>
          l.company.toLowerCase().includes(q) ||
          (l.contact || '').toLowerCase().includes(q) ||
          (l.tag || '').toLowerCase().includes(q) ||
          (l.city || '').toLowerCase().includes(q)
        );
      }
      // Always sort by overdue desc, then due asc
      return rows.slice().sort((a, b) => {
        const da = D.daysBetween(D.TODAY, a.due);
        const db = D.daysBetween(D.TODAY, b.due);
        if (db !== da) return db - da;
        return b.amount * b.prob - a.amount * a.prob;
      });
    }, [leadsState, filter, query]);

    const q = D.queues(leadsState);

    // Totals
    const totalPipeline = leadsState.reduce((s, l) => s + l.amount, 0);
    const totalWeighted = leadsState.reduce((s, l) => s + l.amount * l.prob, 0);

    const open = !!selected;

    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: t.bg,
        color: t.bone,
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Scanline overlay */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5,
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,169,64,0.025) 0 1px, transparent 1px 3px)',
          mixBlendMode: 'screen',
        }} />
        {/* Vignette grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
          backgroundImage: `linear-gradient(${t.lineDim} 1px, transparent 1px), linear-gradient(90deg, ${t.lineDim} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          opacity: 0.4,
          maskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,0.6), transparent 70%)',
        }} />

        {/* ── Top status bar ─────────────────────────────────────────── */}
        <div style={{ position: 'relative', zIndex: 6, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: `1px solid ${t.line}` }}>
          <Lbl color={t.amber} size={11} ls={1.8}>OSKAR<span style={{ color: t.amberDim }}>OS</span>::CRM</Lbl>
          <Lbl color={t.muted}>SYS_OVERVIEW.001</Lbl>
          <Lbl color={t.muted}>NODE / ADMIN</Lbl>
          <div style={{ flex: 1 }} />
          <Ticker items={[
            `PIPELINE CHF ${D.chf(totalPipeline)}`,
            `WEIGHTED CHF ${D.chf(totalWeighted)}`,
            `CONVERSION 24%`,
            `AVG CYCLE 18D`,
            `CAC CHF 2.08`,
            `LEADS ACTIVE ${leadsState.length}`,
            `WIN RATE 31%`,
            `SOURCE docs/crm-feature/prospects.xlsx`,
          ]} />
          <span style={{ width: 8, height: 8, background: t.phosphor, boxShadow: `0 0 10px ${t.phosphor}`, animation: 'tblink 1.5s infinite' }} />
          <Lbl color={t.phosphor}>LIVE</Lbl>
          <Clock />
        </div>

        {/* ── Main grid ──────────────────────────────────────────────── */}
        <div style={{ position: 'relative', zIndex: 4, flex: 1, display: 'grid', gridTemplateColumns: open ? '180px 1fr 560px' : '180px 1fr', minHeight: 0 }}>

          {/* SIDE FILTERS */}
          <div style={{ borderRight: `1px solid ${t.line}`, padding: '14px 12px', overflow: 'auto' }}>
            <Lbl color={t.amberDim}>VIEW</Lbl>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FilterRow active={filter==='all'} count={leadsState.length} onClick={() => setFilter('all')}>All open</FilterRow>
              <FilterRow active={filter==='overdue'} count={q.overdue} dot={t.red} onClick={() => setFilter('overdue')}>Overdue</FilterRow>
              <FilterRow active={filter==='today'} count={q.today} dot={t.amber} onClick={() => setFilter('today')}>Today</FilterRow>
              <FilterRow active={filter==='week'} count={leadsState.filter(l=>{const d=D.daysBetween(D.TODAY,l.due);return d>=-7&&d<=0;}).length} onClick={() => setFilter('week')}>This week</FilterRow>
            </div>

            <div style={{ height: 14 }} />
            <Lbl color={t.amberDim}>STAGE</Lbl>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Object.entries(D.STAGE).map(([k, v]) => (
                <FilterRow key={k} active={filter===k} count={leadsState.filter(l=>l.stage===k).length} onClick={() => setFilter(k)}>
                  {v.label.charAt(0) + v.label.slice(1).toLowerCase()}
                </FilterRow>
              ))}
            </div>

            <div style={{ height: 14 }} />
            <Lbl color={t.amberDim}>CHANNEL</Lbl>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FilterRow active={filter==='call'} count={leadsState.filter(l=>l.channel==='call').length} icon="☎" onClick={() => setFilter('call')}>Calls</FilterRow>
              <FilterRow active={filter==='email'} count={leadsState.filter(l=>l.channel==='email').length} icon="✉" onClick={() => setFilter('email')}>Emails</FilterRow>
              <FilterRow active={filter==='meeting'} count={leadsState.filter(l=>l.channel==='meeting').length} icon="◫" onClick={() => setFilter('meeting')}>Meetings</FilterRow>
              <FilterRow active={filter==='whatsapp_ch'} count={leadsState.filter(l=>l.channel==='whatsapp').length} icon="◉" onClick={() => setFilter('whatsapp_ch')}>WhatsApp</FilterRow>
            </div>

            <div style={{ height: 16 }} />
            <button onClick={() => { setFilter('all'); setQuery(''); setSelectedId(null); }} style={{
              width: '100%', background: 'transparent', border: `1px dashed ${t.lineDim}`, color: t.muted,
              font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4, padding: '8px 0', cursor: 'pointer',
            }}>RESET ▸</button>
          </div>

          {/* CENTER COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            {!open && (
              <>
                {/* Triage hero */}
                <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${t.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                      <Lbl color={t.amber} size={11} ls={1.6}>▸ MORNING TRIAGE</Lbl>
                      <Lbl color={t.muted}>{D.TODAY} · TUE</Lbl>
                    </div>
                    <Lbl color={t.muted}>4 QUEUES · {q.overdue + q.today + q.stuckClosing + q.unmatchedWA} ITEMS PENDING</Lbl>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    <TriageSlab kbd="1" count={q.overdue} label="OVERDUE FOLLOW-UPS" sub="REQUIRES IMMEDIATE ACTION" hue="red" active={filter==='overdue'} onClick={() => setFilter('overdue')} />
                    <TriageSlab kbd="2" count={q.today} label="DUE TODAY" sub="ON THE DOCKET" hue="amber" active={filter==='today'} onClick={() => setFilter('today')} />
                    <TriageSlab kbd="3" count={q.stuckClosing} label="STUCK IN CLOSING" sub="≥2D NO MOVEMENT" hue="cyan" active={filter==='stuck'} onClick={() => setFilter('stuck')} />
                    <TriageSlab kbd="4" count={q.unmatchedWA} label="UNMATCHED WHATSAPP" sub="INBOUND · NEEDS ROUTING" hue="phosphor" active={filter==='whatsapp'} onClick={() => setFilter('whatsapp')} />
                  </div>
                </div>
              </>
            )}

            {/* Search + count strip */}
            <div style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${t.lineDim}` }}>
              <Lbl color={t.amberDim}>QUERY</Lbl>
              <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="company / contact / tag / city  ( / )" style={{
                  width: '100%', background: t.bgElev, border: `1px solid ${t.lineDim}`,
                  color: t.bone, font: '400 12px/1 var(--font-mono)',
                  padding: '7px 10px', letterSpacing: 0.3,
                }} />
              </div>
              <span style={{ flex: 1 }} />
              <Lbl color={t.muted}>{filtered.length}/{leadsState.length} RESULTS</Lbl>
              <Lbl color={t.amberDim}>SORT ▸ OVERDUE</Lbl>
            </div>

            {/* Lead list */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ position: 'sticky', top: 0, background: t.bg, padding: '8px 20px', borderBottom: `1px solid ${t.lineDim}`, display: 'grid', gridTemplateColumns: '20px 78px 1fr 70px 64px 90px 26px', gap: 10, zIndex: 2 }}>
                <Lbl color={t.mutedDim}>#</Lbl>
                <Lbl color={t.mutedDim}>DUE</Lbl>
                <Lbl color={t.mutedDim}>COMPANY / CONTACT</Lbl>
                <Lbl color={t.mutedDim} style={{ textAlign: 'right' }}>VALUE</Lbl>
                <Lbl color={t.mutedDim} style={{ textAlign: 'right' }}>P</Lbl>
                <Lbl color={t.mutedDim}>HEAT</Lbl>
                <Lbl color={t.mutedDim}>▸</Lbl>
              </div>
              <div style={{ padding: '0 20px 80px' }}>
                {filtered.map((l, i) => (
                  <LeadRow key={l.id} lead={l} idx={i} selected={l.id === selectedId} onClick={() => setSelectedId(l.id)} />
                ))}
                {filtered.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: t.muted, font: '400 12px/1.4 var(--font-mono)', letterSpacing: 1 }}>
                    NO RESULTS · ADJUST FILTERS
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DETAIL PANEL */}
          {open && (
            <div style={{
              borderLeft: `1px solid ${t.amberDim}`,
              background: t.bgElev,
              position: 'relative',
              overflow: 'hidden',
            }}>
              <Brackets color={t.amber} size={14} thick={1.5} />
              <DetailPanel lead={selected} onClose={() => setSelectedId(null)} />
            </div>
          )}
        </div>

        {/* ── Bottom status strip ───────────────────────────────────── */}
        <div style={{ position: 'relative', zIndex: 6, borderTop: `1px solid ${t.line}`, padding: '6px 18px', display: 'flex', alignItems: 'center', gap: 14, fontSize: 10 }}>
          <Lbl color={t.amber}>READY</Lbl>
          <Dashes color={t.lineDim} style={{ width: 60 }} />
          <Lbl color={t.muted}>F · FILTER · /·SEARCH · ↑↓·NAV · ⏎·OPEN · ESC·CLOSE · D·DONE · S·SNOOZE</Lbl>
          <span style={{ flex: 1 }} />
          <Lbl color={t.muted}>UNCOMMITTED CHANGES · 0</Lbl>
          <Lbl color={t.muted}>SOURCE · docs/crm-feature/prospects.xlsx</Lbl>
        </div>
      </div>
    );
  }

  function FilterRow({ active, children, count, icon, dot, onClick }) {
    return (
      <button onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px',
        background: active ? `${t.amber}15` : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: active ? t.bone : t.muted,
        font: '400 12px/1.2 var(--font-sans)',
        textAlign: 'left',
        position: 'relative',
        borderLeft: `2px solid ${active ? t.amber : 'transparent'}`,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#ffffff05'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, boxShadow: `0 0 6px ${dot}` }} />}
        {icon && <span style={{ width: 10, color: active ? t.amber : t.muted }}>{icon}</span>}
        <span style={{ flex: 1 }}>{children}</span>
        <span style={{ font: '500 10px/1 var(--font-mono)', color: active ? t.amber : t.mutedDim }}>{count}</span>
      </button>
    );
  }

  window.V1HUD = V1HUD;
})();
