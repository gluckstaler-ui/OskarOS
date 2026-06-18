// Variation B — "MISSION CONTROL"
// Telemetry-style. Pipeline as a flow bar at top. Day-as-timeline. Mission-file detail.
// Amber/phosphor with cyan signal. Inter + JetBrains Mono.

(function () {
  const { useState, useEffect, useMemo } = React;
  const D = window.CRMData;

  const t = {
    bg:        '#0a0805',
    bgElev:    '#13100a',
    bgSurf:    '#1a160e',
    line:      '#3a2c12',
    lineDim:   '#241a0a',
    amber:     '#ffa940',
    amberHi:   '#ffd166',
    amberDim:  '#8a6a2c',
    phosphor:  '#b8f060',
    cyan:      '#5cd6e0',
    red:       '#ff5a3c',
    bone:      '#f4ead4',
    muted:     '#7a6a52',
    mutedDim:  '#4a3f30',
  };

  function Lbl({ children, c = t.muted, sz = 10, w = 500, ls = 1.4, style }) {
    return <span style={{ font: `${w} ${sz}px/1 var(--font-mono)`, letterSpacing: ls, textTransform: 'uppercase', color: c, ...style }}>{children}</span>;
  }
  function Mono({ children, c = t.bone, sz = 12, w = 400, ls = 0, style }) {
    return <span style={{ font: `${w} ${sz}px/1 var(--font-mono)`, letterSpacing: ls, color: c, ...style }}>{children}</span>;
  }

  function Clock() {
    const [n, setN] = useState(new Date());
    useEffect(() => { const id = setInterval(() => setN(new Date()), 1000); return () => clearInterval(id); }, []);
    const pad = x => String(x).padStart(2, '0');
    return <Mono c={t.amber} sz={11} ls={1.5}>T+{pad(n.getHours())}:{pad(n.getMinutes())}:<span style={{ animation: 'tcaret 1s steps(2) infinite' }}>{pad(n.getSeconds())}</span></Mono>;
  }

  // ── Pipeline flow bar ──────────────────────────────────────────────────
  function FlowBar({ leads }) {
    const stages = ['incoming', 'contacted', 'demo', 'closing'];
    const buckets = stages.map(s => ({
      key: s, label: D.STAGE[s].label,
      rows: leads.filter(l => l.stage === s),
    }));
    const counts = buckets.map(b => b.rows.length);
    const sums   = buckets.map(b => b.rows.reduce((a, l) => a + l.amount, 0));
    const maxSum = Math.max(...sums, 1);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {buckets.map((b, i) => {
          const h = 28 + 60 * (sums[i] / maxSum);
          const won = i === 3;
          return (
            <div key={b.key} style={{
              position: 'relative',
              padding: '10px 12px 12px',
              background: t.bgElev,
              border: `1px solid ${t.lineDim}`,
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Lbl c={t.amberDim} sz={9}>STAGE {i + 1} · {b.label}</Lbl>
                <Mono c={won ? t.phosphor : t.amber} sz={20} ls={-0.5}>{String(counts[i]).padStart(2, '0')}</Mono>
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'flex-end', gap: 3, height: 96 }}>
                {b.rows.slice(0, 24).map((l, j) => {
                  const overdue = D.daysBetween(D.TODAY, l.due) > 0;
                  const today   = l.due === D.TODAY;
                  return (
                    <div key={j} title={l.company} style={{
                      flex: 1, minWidth: 3, maxWidth: 14,
                      background: overdue ? t.red : today ? t.amberHi : t.amber,
                      opacity: 0.35 + 0.65 * l.prob,
                      height: `${30 + 70 * (l.amount / Math.max(...b.rows.map(r => r.amount), 1))}%`,
                    }} />
                  );
                })}
              </div>
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Lbl c={t.mutedDim} sz={8}>CHF</Lbl>
                <Mono c={t.bone} sz={12}>{D.chf(sums[i])}</Mono>
              </div>
              {/* arrow to next */}
              {i < 3 && (
                <div style={{
                  position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
                  width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: `8px solid ${t.amberDim}`,
                  zIndex: 2,
                }} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Day timeline (today's agenda) ──────────────────────────────────────
  function DayTimeline({ leads, onSelect }) {
    // Synthetic "today" agenda — derived from leads with due == TODAY or starred
    const items = [
      { t: '09:00', kind: 'CALL',    lead: leads.find(l => l.id === 'P017') },
      { t: '10:30', kind: 'DEMO',    lead: leads.find(l => l.id === 'P020') },
      { t: '11:15', kind: 'EMAIL',   lead: leads.find(l => l.id === 'P010') },
      { t: '14:00', kind: 'NEGOT.',  lead: leads.find(l => l.id === 'P014') },
      { t: '15:30', kind: 'F-UP',    lead: leads.find(l => l.id === 'P008') },
      { t: '17:00', kind: 'CLOSE',   lead: leads.find(l => l.id === 'P012') },
    ].filter(x => x.lead);
    return (
      <div>
        {items.map((it, i) => {
          const past = i < 2;
          const now  = i === 2;
          return (
            <button key={i} onClick={() => onSelect(it.lead.id)} style={{
              display: 'grid', gridTemplateColumns: '46px 14px 1fr 50px',
              gap: 10, alignItems: 'center', width: '100%',
              padding: '8px 6px',
              background: 'transparent', border: 'none',
              borderTop: i ? `1px dashed ${t.lineDim}` : 'none',
              textAlign: 'left', cursor: 'pointer', color: t.bone, font: 'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#ffffff05'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <Mono c={past ? t.mutedDim : now ? t.phosphor : t.bone} sz={12} w={500}>{it.t}</Mono>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: past ? t.mutedDim : now ? t.phosphor : t.amber,
                boxShadow: now ? `0 0 8px ${t.phosphor}` : 'none',
                animation: now ? 'tpulse 1.4s infinite' : 'none',
              }} />
              <div>
                <div style={{ font: '500 12px/1.2 var(--font-sans)', color: past ? t.muted : t.bone, textDecoration: past ? 'line-through' : 'none' }}>
                  {it.lead.company}
                </div>
                <Lbl c={past ? t.mutedDim : t.amberDim} sz={9}>{it.kind} · {it.lead.contact}</Lbl>
              </div>
              <Mono c={past ? t.mutedDim : t.muted} sz={10} style={{ textAlign: 'right' }}>{D.chf(it.lead.amount)}</Mono>
            </button>
          );
        })}
      </div>
    );
  }

  // ── Channel pulse (equalizer bars) ─────────────────────────────────────
  function ChannelPulse({ leads }) {
    const bars = ['call', 'email', 'meeting', 'whatsapp', 'walkin'].map(ch => ({
      ch, count: leads.filter(l => l.channel === ch).length,
    }));
    const max = Math.max(...bars.map(b => b.count), 1);
    return (
      <div>
        {bars.map(b => (
          <div key={b.ch} style={{ display: 'grid', gridTemplateColumns: '76px 1fr 24px', gap: 8, alignItems: 'center', padding: '5px 0' }}>
            <Lbl c={t.muted} sz={9}>{b.ch.toUpperCase()}</Lbl>
            <div style={{ display: 'flex', gap: 2, height: 10 }}>
              {Array.from({ length: 18 }).map((_, i) => {
                const lit = i < Math.round((b.count / max) * 18);
                return <span key={i} style={{
                  flex: 1,
                  background: lit ? t.amber : t.lineDim,
                  opacity: lit ? 0.45 + 0.55 * (i / 18) : 1,
                  boxShadow: lit && i >= 14 ? `0 0 4px ${t.amber}` : 'none',
                }} />;
              })}
            </div>
            <Mono c={t.amber} sz={11}>{String(b.count).padStart(2, '0')}</Mono>
          </div>
        ))}
      </div>
    );
  }

  // ── Triage card ────────────────────────────────────────────────────────
  function TriageCard({ count, label, sub, hue, onClick, active }) {
    const c = hue === 'red' ? t.red : hue === 'amber' ? t.amber : hue === 'cyan' ? t.cyan : t.phosphor;
    return (
      <button onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 14, width: '100%',
        padding: '14px 16px',
        background: active ? `${c}18` : t.bgElev,
        border: `1px solid ${active ? c : t.lineDim}`,
        borderLeft: `3px solid ${c}`,
        cursor: 'pointer', color: t.bone, font: 'inherit', textAlign: 'left',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = `${c}0a`; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = t.bgElev; }}>
        <Mono c={c} sz={32} w={300} ls={-1} style={{ minWidth: 48, textShadow: `0 0 12px ${c}55` }}>
          {String(count).padStart(2, '0')}
        </Mono>
        <div style={{ flex: 1 }}>
          <Lbl c={c} sz={10} ls={1.4}>{label}</Lbl>
          <div style={{ font: '400 11px/1.3 var(--font-sans)', color: t.muted, marginTop: 4 }}>{sub}</div>
        </div>
        <Mono c={c} sz={14}>→</Mono>
      </button>
    );
  }

  // ── Lead row (mission ledger) ──────────────────────────────────────────
  function LeadRow({ lead, idx, selected, onClick }) {
    const overdueDays = D.daysBetween(D.TODAY, lead.due);
    const isOverdue = overdueDays > 0;
    const isToday   = lead.due === D.TODAY;
    return (
      <button onClick={onClick} style={{
        display: 'grid',
        gridTemplateColumns: '34px 56px 1fr 14px 70px 50px 70px',
        gap: 10, alignItems: 'center', width: '100%',
        padding: '9px 12px',
        background: selected ? `${t.amber}15` : 'transparent',
        borderTop: `1px solid ${t.lineDim}`,
        cursor: 'pointer', textAlign: 'left', color: t.bone, font: 'inherit',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#ffffff06'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}>
        <Mono c={selected ? t.amber : t.mutedDim} sz={10}>{String(idx + 1).padStart(3, '0')}</Mono>
        <Mono c={isOverdue ? t.red : isToday ? t.amberHi : t.muted} sz={10} w={500}>
          {isOverdue ? `T+${overdueDays}D` : isToday ? 'TODAY' : `T-${-overdueDays}D`}
        </Mono>
        <div>
          <div style={{ font: '500 12px/1.2 var(--font-sans)', color: t.bone, display: 'flex', gap: 6, alignItems: 'center' }}>
            {lead.starred && <span style={{ color: t.amber, fontSize: 9 }}>★</span>}
            {lead.company}
          </div>
          <Lbl c={t.muted} sz={9}>{lead.contact} · {lead.city}</Lbl>
        </div>
        <span style={{ color: t.amberDim, font: '400 11px/1 var(--font-mono)' }}>{D.CHANNEL_ICON[lead.channel]}</span>
        <Mono c={t.bone} sz={11} style={{ textAlign: 'right' }}>{D.chf(lead.amount)}</Mono>
        <Mono c={t.amber} sz={11} style={{ textAlign: 'right' }}>{Math.round(lead.prob * 100)}%</Mono>
        <div style={{ display: 'flex', gap: 1.5 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} style={{
              flex: 1, height: 14,
              background: i < Math.round(lead.heat * 8) ? t.amber : t.lineDim,
              opacity: i < Math.round(lead.heat * 8) ? 0.4 + 0.6 * (i / 8) : 1,
            }} />
          ))}
        </div>
      </button>
    );
  }

  // ── Detail (mission file) ──────────────────────────────────────────────
  function DetailPanel({ lead, onClose }) {
    const [tab, setTab] = useState('brief');
    const [status, setStatus] = useState(lead.status);
    useEffect(() => setStatus(lead.status), [lead.id]);

    return (
      <div key={lead.id} style={{ height: '100%', display: 'flex', flexDirection: 'column', animation: 'twipe 0.35s cubic-bezier(.2,.7,.3,1)' }}>
        {/* MISSION FILE stamp header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.amberDim}`, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              padding: '3px 7px',
              border: `1px solid ${t.amber}`,
              transform: 'rotate(-1deg)',
            }}>
              <Lbl c={t.amber} sz={9}>FILE · {lead.id}</Lbl>
            </div>
            <Lbl c={t.amberDim} sz={9}>{D.STAGE[lead.stage].label} · {lead.channel.toUpperCase()}</Lbl>
            <span style={{ flex: 1 }} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.amberDim, cursor: 'pointer', font: '300 16px/1 var(--font-mono)' }}>✕</button>
          </div>
          <h2 style={{ font: '500 22px/1.1 var(--font-sans)', color: t.bone, margin: '8px 0 0', letterSpacing: -0.3 }}>{lead.company}</h2>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, font: '400 12px/1 var(--font-sans)', color: t.muted, flexWrap: 'wrap' }}>
            <span>{lead.contact}</span>
            <Mono c={t.amber} sz={11}>{lead.phone}</Mono>
            <Mono c={t.amber} sz={11}>{lead.email}</Mono>
            <span>{lead.city}</span>
          </div>
        </div>

        {/* Status bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', borderBottom: `1px solid ${t.line}` }}>
          {['todo','standby','awaiting','won','lost','cancelled'].map(s => {
            const active = s === status;
            const def = D.STATUS[s];
            const c = def.hue === 'amber' ? t.amber : def.hue === 'phosphor' ? t.phosphor : def.hue === 'cyan' ? t.cyan : def.hue === 'red' ? t.red : t.muted;
            return (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: '11px 6px',
                background: active ? `${c}18` : 'transparent',
                border: 'none',
                borderRight: `1px solid ${t.lineDim}`,
                borderBottom: `2px solid ${active ? c : 'transparent'}`,
                cursor: 'pointer',
                font: '500 10px/1 var(--font-mono)',
                color: active ? c : t.muted,
                letterSpacing: 1.2,
              }}>
                {active && '● '}{def.label}
              </button>
            );
          })}
        </div>

        {/* Key metrics with telemetry style */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.lineDim}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Bigval label="VALUE" v={`CHF ${D.chf(lead.amount)}`} accent={t.bone} />
            <Bigval label="PROB."  v={`${Math.round(lead.prob * 100)}%`} accent={t.amber} bar={lead.prob} />
            <Bigval label="WEIGHT" v={`CHF ${D.chf(lead.amount * lead.prob)}`} accent={t.amber} />
            <Bigval label="DUE"    v={lead.due} accent={D.daysBetween(D.TODAY, lead.due) > 0 ? t.red : t.phosphor}
                                   sub={D.daysBetween(D.TODAY, lead.due) > 0 ? `${D.daysBetween(D.TODAY, lead.due)}D OVERDUE` : 'ON TRACK'} />
          </div>
        </div>

        {/* Tab strip */}
        <div style={{ borderBottom: `1px solid ${t.line}`, display: 'flex', padding: '0 18px' }}>
          {[['brief','BRIEF'],['needs','NEEDS / SOLUTION'],['history','TIMELINE',11],['comms','COMMS']].map(([k, lab, n]) => {
            const active = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{
                background: 'none', border: 'none', padding: '10px 14px 9px',
                marginRight: 2,
                cursor: 'pointer',
                font: '500 10px/1 var(--font-mono)', letterSpacing: 1.4,
                color: active ? t.amber : t.muted,
                borderBottom: `2px solid ${active ? t.amber : 'transparent'}`,
                position: 'relative', top: 1,
              }}>{lab}{n != null && <span style={{ color: t.mutedDim, marginLeft: 6 }}>{n}</span>}</button>
            );
          })}
        </div>

        {/* Tab body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
          {tab === 'brief' && <BriefTab lead={lead} />}
          {tab === 'needs' && <NeedsTab lead={lead} />}
          {tab === 'history' && <HistoryTab lead={lead} />}
          {tab === 'comms' && <CommsTab lead={lead} />}
        </div>

        <div style={{ borderTop: `1px solid ${t.line}`, padding: '10px 18px', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Btn primary>● SEND WHATSAPP</Btn>
          <Btn>LOG CALL</Btn>
          <Btn>LOG EMAIL</Btn>
          <span style={{ flex: 1 }} />
          <Lbl c={t.mutedDim}>SNOOZE</Lbl>
          <Btn sm>+1D</Btn>
          <Btn sm>+3D</Btn>
          <Btn sm>+1W</Btn>
          <Btn sm primary>DONE</Btn>
        </div>
      </div>
    );
  }

  function Bigval({ label, v, sub, accent = '#fff', bar }) {
    return (
      <div>
        <Lbl c={t.mutedDim} sz={9}>{label}</Lbl>
        <div style={{ font: '400 18px/1.1 var(--font-mono)', color: accent, marginTop: 4, letterSpacing: -0.5 }}>{v}</div>
        {bar != null && (
          <div style={{ marginTop: 6, height: 3, background: t.lineDim, position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, width: `${bar * 100}%`, background: accent }} />
          </div>
        )}
        {sub && <Lbl c={t.muted} sz={9} style={{ display: 'block', marginTop: 6 }}>{sub}</Lbl>}
      </div>
    );
  }

  function Btn({ children, primary, sm, onClick }) {
    return (
      <button onClick={onClick} style={{
        font: `600 ${sm ? 9 : 10}px/1 var(--font-mono)`,
        letterSpacing: 1.2,
        padding: sm ? '6px 8px' : '8px 12px',
        background: primary ? t.amber : 'transparent',
        color: primary ? '#0a0805' : t.amber,
        border: `1px solid ${primary ? t.amber : t.amberDim}`,
        cursor: 'pointer',
      }}>{children}</button>
    );
  }

  function Sec({ title, right, children }) {
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Lbl c={t.amberDim}>{title}</Lbl>
          <div style={{ flex: 1, height: 1, backgroundImage: `repeating-linear-gradient(90deg, ${t.lineDim} 0 4px, transparent 4px 8px)`, backgroundSize: '8px 100%', animation: 'tdash 1.4s linear infinite' }} />
          {right}
        </div>
        {children}
      </div>
    );
  }

  function BriefTab({ lead }) {
    return (
      <div>
        <Sec title="NEXT MOVE" right={<Btn sm primary>EXECUTE</Btn>}>
          <p style={{ font: '500 15px/1.5 var(--font-sans)', color: t.bone, margin: 0 }}>{lead.note}</p>
        </Sec>
        <Sec title="CONTEXT">
          <p style={{ font: '400 13px/1.6 var(--font-sans)', color: t.muted, margin: 0 }}>{lead.comment}</p>
        </Sec>
        <Sec title="TAGS · LINKED">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ font: '400 11px/1 var(--font-mono)', color: t.amber, border: `1px solid ${t.amberDim}`, padding: '5px 8px' }}>{lead.tag}</span>
            <span style={{ font: '400 11px/1 var(--font-mono)', color: t.muted, border: `1px dashed ${t.lineDim}`, padding: '5px 8px' }}>+ tag</span>
          </div>
          <div style={{ marginTop: 12, border: `1px solid ${t.lineDim}`, padding: 10 }}>
            <Lbl c={t.amberDim}>SESSION · 2026-05-23-RISTORANTE-LA-PERGOLA</Lbl>
            <div style={{ font: '400 11px/1.4 var(--font-mono)', color: t.muted, marginTop: 6 }}>2026-05-23 · Phase 1/7 · 3 artifacts</div>
          </div>
        </Sec>
      </div>
    );
  }

  function NeedsTab() {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Sec title="NEEDS ANALYSIS">
          <ul style={{ margin: 0, paddingLeft: 16, font: '400 13px/1.7 var(--font-sans)', color: t.bone }}>
            <li>Outdated website (current: 2018)</li>
            <li>NOKIA 3110 → needs iPhone</li>
            <li>Old Intel Core Duo laptop</li>
            <li>Still on Yahoo mail</li>
          </ul>
        </Sec>
        <Sec title="SOLUTIONS BOUGHT">
          <ul style={{ margin: 0, paddingLeft: 16, font: '400 13px/1.7 var(--font-sans)', color: t.bone }}>
            <li>New website · CHF 8'000</li>
            <li>LED façade retrofit</li>
            <li>Alarm system + cameras</li>
            <li>Email migration to Microsoft 365</li>
          </ul>
        </Sec>
      </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: i === 0 ? '0 0 10px' : '16px 0 10px' }}>
                  <Lbl c={t.amber}>{h.day}</Lbl>
                  <div style={{ flex: 1, height: 1, background: t.lineDim }} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '50px 12px 1fr', gap: 10, alignItems: 'center', padding: '6px 0' }}>
                <Mono c={t.mutedDim} sz={10}>{h.t}</Mono>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: h.type === 'discovery' ? t.phosphor : h.type === 'status' ? t.amber : h.type === 'call' ? t.cyan : t.amberDim,
                  boxShadow: '0 0 6px currentColor',
                }} />
                <span style={{ font: '400 12px/1.4 var(--font-sans)', color: t.bone }}>{h.text}</span>
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
        <Sec title="DRAFT · OUTBOUND" right={<Btn sm primary>SEND</Btn>}>
          <textarea
            rows={4}
            defaultValue={`Hi ${lead.contact?.split(' ')[0] || 'there'},\n\nFollowing up on our last call. ${lead.note}\n\nBest,`}
            style={{
              width: '100%', background: t.bgElev, color: t.bone,
              border: `1px solid ${t.line}`, padding: 10,
              font: '400 13px/1.5 var(--font-sans)',
            }}
          />
        </Sec>
        <Sec title="INBOUND · LAST 7D">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Msg dir="in"  time="4D AGO · WHATSAPP" text="Vorrei sapere se possiamo programmare una chiamata la prossima settimana." />
            <Msg dir="out" time="4D AGO · WHATSAPP" text="Certo, le propongo martedì 10:00 — funziona?" />
            <Msg dir="in"  time="3D AGO · EMAIL"    text="Mi può inviare la proposta aggiornata?" />
          </div>
        </Sec>
      </div>
    );
  }

  function Msg({ dir, time, text }) {
    const out = dir === 'out';
    return (
      <div style={{
        padding: '8px 10px',
        background: out ? `${t.amber}10` : t.bgElev,
        border: `1px solid ${out ? t.amberDim : t.lineDim}`,
        borderLeft: `2px solid ${out ? t.amber : t.cyan}`,
        marginLeft: out ? 40 : 0,
        marginRight: out ? 0 : 40,
      }}>
        <Lbl c={t.mutedDim} sz={9}>{out ? 'YOU' : 'THEM'} · {time}</Lbl>
        <div style={{ font: '400 12px/1.5 var(--font-sans)', color: t.bone, marginTop: 4 }}>{text}</div>
      </div>
    );
  }

  // ── Filter helpers (shared) ────────────────────────────────────────────
  function applyFilter(leads, f) {
    if (f === 'all') return leads;
    if (f === 'overdue') return leads.filter(l => D.daysBetween(D.TODAY, l.due) > 0 && l.status !== 'won' && l.status !== 'cancelled');
    if (f === 'today') return leads.filter(l => l.due === D.TODAY);
    if (f === 'stuck') return leads.filter(l => l.stage === 'closing' && D.daysBetween(D.TODAY, l.due) >= 0 && l.status !== 'won');
    if (f === 'whatsapp') return leads.filter(l => l.unmatchedWhatsapp);
    if (['incoming','contacted','demo','closing'].includes(f)) return leads.filter(l => l.stage === f);
    return leads;
  }

  function V2Mission() {
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [leadsState] = useState(D.leads);

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
      return rows.slice().sort((a, b) => D.daysBetween(D.TODAY, b.due) - D.daysBetween(D.TODAY, a.due));
    }, [leadsState, filter, query]);

    const qc = D.queues(leadsState);
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
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Faint grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `linear-gradient(${t.lineDim} 1px, transparent 1px), linear-gradient(90deg, ${t.lineDim} 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
          opacity: 0.25,
        }} />

        {/* Top bar */}
        <div style={{ position: 'relative', zIndex: 4, padding: '10px 18px', borderBottom: `1px solid ${t.line}`, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Lbl c={t.amber} sz={11} ls={1.6}>OSKAR<span style={{ color: t.amberDim }}>OS</span> · MISSION CONTROL</Lbl>
          <Lbl c={t.muted}>OVERVIEW · OPS</Lbl>
          <span style={{ flex: 1 }} />
          <Lbl c={t.muted}>PIPELINE</Lbl> <Mono c={t.bone} sz={12}>CHF {D.chf(totalPipeline)}</Mono>
          <Lbl c={t.muted}>WEIGHT</Lbl> <Mono c={t.amber} sz={12}>CHF {D.chf(totalWeighted)}</Mono>
          <Lbl c={t.muted}>NET</Lbl> <Mono c={t.phosphor} sz={12}>CHF {D.chf(totalWeighted - 2.08 * leadsState.length)}</Mono>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.phosphor, boxShadow: `0 0 8px ${t.phosphor}`, animation: 'tblink 1.4s infinite' }} />
          <Clock />
        </div>

        {/* Main grid */}
        <div style={{
          position: 'relative', zIndex: 3, flex: 1,
          display: 'grid',
          gridTemplateColumns: open ? '260px 1fr 540px' : '260px 1fr 280px',
          minHeight: 0,
        }}>
          {/* LEFT: Triage stack + filters */}
          <div style={{ borderRight: `1px solid ${t.line}`, padding: '12px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Lbl c={t.amber} ls={1.6}>▸ MORNING TRIAGE · {D.TODAY}</Lbl>
            <TriageCard count={qc.overdue} label="OVERDUE" sub="Requires immediate action" hue="red" active={filter==='overdue'} onClick={() => setFilter('overdue')} />
            <TriageCard count={qc.today} label="DUE TODAY" sub="On the docket" hue="amber" active={filter==='today'} onClick={() => setFilter('today')} />
            <TriageCard count={qc.stuckClosing} label="STUCK · CLOSING" sub=">=2d no movement" hue="cyan" active={filter==='stuck'} onClick={() => setFilter('stuck')} />
            <TriageCard count={qc.unmatchedWA} label="UNMATCHED WA" sub="Inbound · needs routing" hue="phosphor" active={filter==='whatsapp'} onClick={() => setFilter('whatsapp')} />

            <div style={{ height: 6 }} />
            <Lbl c={t.amberDim}>STAGE</Lbl>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <FilterRow active={filter==='all'} count={leadsState.length} onClick={() => setFilter('all')}>All open</FilterRow>
              {Object.entries(D.STAGE).map(([k, v]) => (
                <FilterRow key={k} active={filter===k} count={leadsState.filter(l=>l.stage===k).length} onClick={() => setFilter(k)}>
                  {v.label.charAt(0) + v.label.slice(1).toLowerCase()}
                </FilterRow>
              ))}
            </div>
          </div>

          {/* CENTER */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!open && (
              <div style={{ padding: '14px 18px 12px', borderBottom: `1px solid ${t.lineDim}` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
                  <Lbl c={t.amber}>▸ PIPELINE FLOW · 4 STAGES</Lbl>
                  <Lbl c={t.mutedDim}>CHF {D.chf(totalPipeline)} ACROSS {leadsState.length} LEADS</Lbl>
                </div>
                <FlowBar leads={leadsState} />
              </div>
            )}

            {/* Query strip */}
            <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${t.lineDim}` }}>
              <Lbl c={t.amberDim}>QUERY</Lbl>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="company / contact / tag ( / )" style={{
                background: t.bgElev, border: `1px solid ${t.lineDim}`,
                color: t.bone, font: '400 12px/1 var(--font-mono)',
                padding: '7px 10px', flex: 1, maxWidth: 380,
              }} />
              <span style={{ flex: 1 }} />
              <Lbl c={t.muted}>{filtered.length}/{leadsState.length} LEADS</Lbl>
              <Lbl c={t.amberDim}>SORT ▸ OVERDUE</Lbl>
            </div>

            {/* Lead ledger */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ position: 'sticky', top: 0, zIndex: 2, background: t.bg, padding: '8px 12px', borderBottom: `1px solid ${t.lineDim}`, display: 'grid', gridTemplateColumns: '34px 56px 1fr 14px 70px 50px 70px', gap: 10 }}>
                <Lbl c={t.mutedDim}>#</Lbl>
                <Lbl c={t.mutedDim}>SCHED</Lbl>
                <Lbl c={t.mutedDim}>SUBJECT</Lbl>
                <Lbl c={t.mutedDim}>CH</Lbl>
                <Lbl c={t.mutedDim} style={{ textAlign: 'right' }}>CHF</Lbl>
                <Lbl c={t.mutedDim} style={{ textAlign: 'right' }}>P</Lbl>
                <Lbl c={t.mutedDim}>HEAT</Lbl>
              </div>
              <div>
                {filtered.map((l, i) => (
                  <LeadRow key={l.id} lead={l} idx={i} selected={l.id === selectedId} onClick={() => setSelectedId(l.id)} />
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: dynamic — agenda (closed) or detail (open) */}
          {!open && (
            <div style={{ borderLeft: `1px solid ${t.line}`, overflow: 'auto', padding: '14px' }}>
              <Lbl c={t.amber} ls={1.6}>▸ FLIGHT PLAN · TODAY</Lbl>
              <div style={{ marginTop: 10, padding: '0 4px' }}>
                <DayTimeline leads={leadsState} onSelect={setSelectedId} />
              </div>

              <div style={{ height: 18 }} />
              <Lbl c={t.amber} ls={1.6}>▸ CHANNEL PULSE</Lbl>
              <div style={{ marginTop: 10 }}>
                <ChannelPulse leads={leadsState} />
              </div>

              <div style={{ height: 18 }} />
              <Lbl c={t.amber} ls={1.6}>▸ NEXT MOVE</Lbl>
              <div style={{ marginTop: 10, padding: 12, background: t.bgElev, borderLeft: `3px solid ${t.phosphor}` }}>
                <Lbl c={t.phosphor} sz={9}>RECOMMENDED · HIGHEST WEIGHTED</Lbl>
                <div style={{ font: '500 14px/1.3 var(--font-sans)', color: t.bone, marginTop: 6 }}>Hotel Bellevue Lugano</div>
                <div style={{ font: '400 11px/1.4 var(--font-sans)', color: t.muted, marginTop: 4 }}>Andrea Conti · CHF 32'600 · 75%</div>
                <button onClick={() => setSelectedId('P013')} style={{
                  marginTop: 10, width: '100%',
                  background: t.phosphor, color: '#0a0805',
                  border: 'none', padding: '8px 0',
                  font: '600 10px/1 var(--font-mono)', letterSpacing: 1.4,
                  cursor: 'pointer',
                }}>OPEN FILE ▸</button>
              </div>
            </div>
          )}
          {open && (
            <div style={{ borderLeft: `1px solid ${t.amberDim}`, background: t.bgElev, overflow: 'hidden' }}>
              <DetailPanel lead={selected} onClose={() => setSelectedId(null)} />
            </div>
          )}
        </div>

        {/* Bottom strip */}
        <div style={{ borderTop: `1px solid ${t.line}`, padding: '6px 18px', display: 'flex', gap: 14, alignItems: 'center', position: 'relative', zIndex: 4 }}>
          <Lbl c={t.amber}>NOMINAL</Lbl>
          <Lbl c={t.muted}>STATUS · ALL SYSTEMS OPERATIONAL</Lbl>
          <span style={{ flex: 1 }} />
          <Lbl c={t.muted}>SOURCE · docs/crm-feature/prospects.xlsx</Lbl>
        </div>
      </div>
    );
  }

  function FilterRow({ active, children, count, onClick }) {
    return (
      <button onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
        background: active ? `${t.amber}15` : 'transparent',
        border: 'none', cursor: 'pointer',
        color: active ? t.bone : t.muted,
        font: '400 12px/1.2 var(--font-sans)', textAlign: 'left',
        borderLeft: `2px solid ${active ? t.amber : 'transparent'}`,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#ffffff05'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
        <span style={{ flex: 1 }}>{children}</span>
        <Mono c={active ? t.amber : t.mutedDim} sz={10}>{count}</Mono>
      </button>
    );
  }

  window.V2Mission = V2Mission;
})();
