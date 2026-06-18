// Kanban — 4 stage columns in the same Territory × Fathom system.
// Drag-and-drop between stages, inline add-lead, slide-over detail.
// Reuses CRMData. Inter + JetBrains Mono on warm-black + amber/phosphor.

(function () {
  const { useState, useMemo, useEffect, useRef } = React;
  const D = window.CRMData;

  // Same token set as V3 — keep the system coherent
  const t = {
    bg:        '#0a0907',
    bgElev:    '#13110d',
    bgSurf:    '#1c1a13',
    bgCard:    '#171410',
    line:      '#2a2519',
    lineDim:   '#1a160f',
    amber:     '#ffb84a',
    amberHi:   '#ffd07a',
    amberDim:  '#7a6536',
    phosphor:  '#c8ee7a',
    cyan:      '#88d4dc',
    red:       '#ff6a4d',
    bone:      '#ece1c5',
    muted:     '#7a6f5a',
    mutedDim:  '#42392a',
  };

  // Stage-specific accent — cool→warm→hot progression
  const STAGE_COLOR = {
    incoming:  t.cyan,
    contacted: t.amberDim,
    demo:      t.amber,
    closing:   t.phosphor,
  };

  function L({ children, c = t.muted, sz = 10, w = 500, ls = 1.4, style }) {
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

  // ── Channel state helper + icons ────────────────────────────────────────
  // Derives per-channel state for a lead: null (channel missing),
  // 'avail' (available, no comms), 'past' (prior comms), 'new' (unread).
  function channelStates(lead) {
    const hasPhone = lead.phone && lead.phone !== '—';
    const hasEmail = lead.email && lead.email !== '—';
    const lastDigit = parseInt(lead.id.slice(-1), 10) || 0;
    const past = lead.stage !== 'incoming';
    return {
      phone: !hasPhone ? null
           : lastDigit === 4 ? 'new'
           : past ? 'past'
           : 'avail',
      whatsapp: !hasPhone ? null
           : (lead.unmatchedWhatsapp || lastDigit === 7) ? 'new'
           : (past || lead.channel === 'whatsapp') ? 'past'
           : 'avail',
      email: !hasEmail ? null
           : (lastDigit === 0 || lastDigit === 3) ? 'new'
           : (past || lead.channel === 'email') ? 'past'
           : 'avail',
    };
  }

  // Feather-icon paths — outline by default, filled variant when fill is set.
  // viewBox 24×24, stroke-width 1.8, round caps/joins.
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
  // Email — feather "mail" path. When filled, draw the flap polyline in the
  // background color over the filled body so the envelope shape stays legible
  // and doesn't read as a solid blob.
  function IconEmail({ size, color, fill, bg = t.bgCard }) {
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
    const isStar = icon === 'star';
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

  function ChannelStrip({ lead, size = 14, onClickChannel, bg }) {
    const states = channelStates(lead);
    return (
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
        {states.phone && (
          <button title={`Call · ${states.phone}`} onClick={() => onClickChannel && onClickChannel('phone')} style={iconActionStyle}>
            <ChannelGlyph icon="phone" state={states.phone} size={size} bg={bg} />
          </button>
        )}
        {states.whatsapp && (
          <button title={`WhatsApp · ${states.whatsapp}`} onClick={() => onClickChannel && onClickChannel('whatsapp')} style={iconActionStyle}>
            <ChannelGlyph icon="chat" state={states.whatsapp} size={size} bg={bg} />
          </button>
        )}
        {states.email && (
          <button title={`Email · ${states.email}`} onClick={() => onClickChannel && onClickChannel('email')} style={iconActionStyle}>
            <ChannelGlyph icon="email" state={states.email} size={size} bg={bg} />
          </button>
        )}
        <button title={lead.starred ? 'Unstar' : 'Star'} onClick={() => onClickChannel && onClickChannel('star')} style={iconActionStyle}>
          <ChannelGlyph icon="star" state={lead.starred ? 'new' : 'avail'} size={size} bg={bg} />
        </button>
      </div>
    );
  }

  const iconActionStyle = {
    background: 'none', border: 'none', padding: 0, margin: 0,
    cursor: 'pointer', lineHeight: 0,
  };

  // ── Lead card ──────────────────────────────────────────────────────────
  function LeadCard({ lead, onClick, onDragStart, onDragEnd, dragging, selected, density = 'cozy' }) {
    const daysInStage = useMemo(() => {
      // Synthetic: seed-based but biased toward shorter durations
      const seed = (lead.id.charCodeAt(lead.id.length - 1) * 13 + lead.id.charCodeAt(0)) % 24;
      return seed + 1;
    }, [lead.id]);
    const overdueDays = D.daysBetween(D.TODAY, lead.due);
    const isOverdue = overdueDays > 0 && lead.status !== 'won' && lead.status !== 'cancelled';
    const isToday   = lead.due === D.TODAY;
    const upcoming  = !isOverdue && !isToday && overdueDays >= -7;
    const initial = (lead.company || '?').trim().charAt(0).toUpperCase();
    const stuck = daysInStage > 14;
    const accent = STAGE_COLOR[lead.stage] || t.amber;

    const [hover, setHover] = useState(false);

    // Build the canonical due-signal string used across all densities
    const dueChip = isOverdue ? { label: `${overdueDays}D OVERDUE`, c: t.red, hot: true }
                  : isToday   ? { label: 'DUE TODAY', c: t.amberHi, hot: true }
                  : overdueDays >= -3 ? { label: `DUE IN ${-overdueDays}D`, c: t.amber, hot: false }
                  : overdueDays >= -7 ? { label: `DUE IN ${-overdueDays}D`, c: t.muted, hot: false }
                  : { label: lead.due, c: t.mutedDim, hot: false };

    // ── Compact mode: 2 lines, with channel strip ──────────────────────
    if (density === 'compact') {
      return (
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', lead.id);
            onDragStart(lead.id);
          }}
          onDragEnd={onDragEnd}
          onClick={onClick}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            position: 'relative',
            background: selected ? `${t.amber}10` : t.bgCard,
            border: `1px solid ${selected ? t.amber : hover ? t.amberDim : t.lineDim}`,
            marginBottom: 6,
            padding: '8px 10px',
            cursor: dragging ? 'grabbing' : 'pointer',
            opacity: dragging ? 0.35 : 1,
            transition: 'border-color 0.15s, transform 0.12s, box-shadow 0.15s, background 0.15s',
            transform: hover && !dragging ? 'translateY(-1px)' : 'none',
            boxShadow: selected
              ? `0 0 0 1px ${t.amber}, 0 4px 14px ${t.amber}30`
              : hover && !dragging ? `0 4px 12px rgba(0,0,0,0.35), 0 0 0 1px ${t.amberDim}40` : 'none',
          }}
        >
          {/* Line 1: avatar + company + channel strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 16, height: 16, flex: '0 0 16px',
              border: `1px solid ${accent}`,
              background: `${accent}12`,
              color: accent,
              font: '600 9px/16px var(--font-mono)',
              textAlign: 'center',
            }}>{initial}</div>
            <div style={{
              flex: 1, minWidth: 0,
              font: '600 12px/1.2 var(--font-sans)', color: t.bone,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {lead.company}
            </div>
            <ChannelStrip lead={lead} size={11} />
          </div>
          {/* Line 2: CHF + % + due chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, paddingLeft: 24 }}>
            <M c={t.muted} sz={10}>CHF {D.chf(lead.amount)}</M>
            <span style={{ flex: 1 }} />
            <M c={t.muted} sz={10}>{Math.round(lead.prob * 100)}%</M>
            <span style={{
              font: '500 9px/1 var(--font-mono)', letterSpacing: 1.1,
              color: dueChip.c,
              background: dueChip.hot ? `${dueChip.c}14` : 'transparent',
              padding: dueChip.hot ? '4px 6px' : '4px 0',
              border: dueChip.hot ? `1px solid ${dueChip.c}40` : 'none',
              whiteSpace: 'nowrap',
              textTransform: 'lowercase',
            }}>{dueChip.label.toLowerCase()}</span>
          </div>
        </div>
      );
    }

    const isComfortable = density === 'comfortable';

    return (
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', lead.id);
          onDragStart(lead.id);
        }}
        onDragEnd={onDragEnd}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative',
          background: selected ? `${t.amber}10` : t.bgCard,
          border: `1px solid ${selected ? t.amber : hover ? t.amberDim : t.lineDim}`,
          marginBottom: 8,
          padding: isComfortable ? '14px 16px' : '12px 14px',
          cursor: dragging ? 'grabbing' : 'pointer',
          opacity: dragging ? 0.35 : 1,
          transition: 'border-color 0.15s, transform 0.12s, box-shadow 0.15s, background 0.15s',
          transform: hover && !dragging ? 'translateY(-1px)' : 'none',
          boxShadow: selected
            ? `0 0 0 1px ${t.amber}, 0 4px 14px ${t.amber}30`
            : hover && !dragging ? `0 6px 18px rgba(0,0,0,0.4), 0 0 0 1px ${t.amberDim}40` : 'none',
        }}
      >
        {/* Header: avatar + name + channel strip */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            width: 22, height: 22, flex: '0 0 22px',
            border: `1px solid ${accent}`,
            background: `${accent}12`,
            color: accent,
            font: '600 11px/22px var(--font-mono)',
            textAlign: 'center',
            letterSpacing: 0.5,
          }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              font: '600 13px/1.25 var(--font-sans)',
              color: t.bone,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {lead.company}
            </div>
            <L c={t.mutedDim} sz={9} ls={1.1} style={{ textTransform: 'none', marginTop: 3, display: 'block' }}>
              {lead.contact}{lead.city && lead.city !== '—' ? ` · ${lead.city}` : ''}
            </L>
          </div>
          <ChannelStrip lead={lead} size={14} />
        </div>

        {/* Bottom: CHF · % · due chip — single row */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <M c={t.bone} sz={11} w={500} style={{ whiteSpace: 'nowrap' }}>CHF {D.chf(lead.amount)}</M>
          <span style={{ flex: 1 }} />
          <M c={t.muted} sz={11}>{Math.round(lead.prob * 100)}%</M>
          <span style={{
            font: '500 10px/1 var(--font-sans)', letterSpacing: 0.2,
            color: dueChip.c,
            background: dueChip.hot ? `${dueChip.c}18` : 'transparent',
            padding: dueChip.hot ? '4px 8px' : '4px 0',
            border: dueChip.hot ? `1px solid ${dueChip.c}50` : 'none',
            borderRadius: dueChip.hot ? 999 : 0,
            whiteSpace: 'nowrap',
            textTransform: 'lowercase',
          }}>{dueChip.label.toLowerCase()}</span>
        </div>

        {/* Tiny footer: stage progress + stuck warning */}
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <L c={t.mutedDim} sz={8} ls={1.1}>· PROD {D.STAGE[lead.stage].step}/4</L>
          {stuck && (
            <>
              <span style={{ color: t.mutedDim }}>·</span>
              <span style={{
                font: '500 8px/1 var(--font-mono)', letterSpacing: 1.1,
                color: t.amber,
              }}>{daysInStage}D STUCK</span>
            </>
          )}
        </div>

        {/* Comfortable extra: next-action preview */}
        {isComfortable && lead.note && (
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: `1px dashed ${t.lineDim}`,
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <span style={{ color: t.amberDim, font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2, paddingTop: 2, flexShrink: 0 }}>NEXT</span>
            <span style={{
              font: '400 12px/1.4 var(--font-sans)', color: t.muted,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
            }}>{lead.note}</span>
          </div>
        )}
      </div>
    );
  }

  function QuickBtn({ icon, title, onClick }) {
    return (
      <button title={title} onClick={onClick} style={{
        width: 22, height: 22, padding: 0,
        background: 'transparent', border: `1px solid ${t.lineDim}`,
        color: t.muted, cursor: 'pointer',
        font: '400 11px/1 var(--font-mono)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'color 0.12s, border-color 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = t.amber; e.currentTarget.style.borderColor = t.amberDim; }}
      onMouseLeave={e => { e.currentTarget.style.color = t.muted; e.currentTarget.style.borderColor = t.lineDim; }}
      >{icon}</button>
    );
  }

  // ── Column ─────────────────────────────────────────────────────────────
  function Column({ stage, leads, allLeads, onCardClick, onDrop, dragOver, onDragOver, onDragLeave, draggingId, onDragStart, onDragEnd, onAddLead, selectedId, density }) {
    const accent = STAGE_COLOR[stage];
    const def = D.STAGE[stage];
    const total = leads.reduce((s, l) => s + l.amount, 0);
    const [adding, setAdding] = useState('');

    const submit = () => {
      const v = adding.trim();
      if (!v) return;
      onAddLead(stage, v);
      setAdding('');
    };

    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        background: t.bg,
        minHeight: 0, minWidth: 0,
        borderRight: `1px solid ${t.lineDim}`,
      }}>
        {/* Top accent rail */}
        <div style={{ height: 2, background: accent, opacity: dragOver ? 1 : 0.6, transition: 'opacity 0.15s' }} />

        {/* Header */}
        <div style={{ padding: '14px 14px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{
              font: '500 14px/1 var(--font-sans)',
              color: t.bone, letterSpacing: -0.2,
            }}>{def.label.charAt(0) + def.label.slice(1).toLowerCase()}</span>
            <L c={t.muted}>{leads.length} {leads.length === 1 ? 'lead' : 'leads'}</L>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
            <L c={t.mutedDim} sz={9}>CHF</L>
            <M c={accent} sz={12}>{D.chf(total)}</M>
          </div>
        </div>

        {/* Inline add */}
        <div style={{ padding: '0 12px 10px' }}>
          <input
            value={adding}
            onChange={e => setAdding(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="+ Add lead (Company, Name, Phone, Email)…"
            style={{
              width: '100%',
              background: t.bgElev,
              border: `1px dashed ${t.lineDim}`,
              color: t.bone,
              font: '400 11px/1 var(--font-sans)',
              padding: '9px 10px',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = t.amberDim; e.currentTarget.style.borderStyle = 'solid'; }}
            onBlur={e => { e.currentTarget.style.borderColor = t.lineDim; e.currentTarget.style.borderStyle = 'dashed'; }}
          />
        </div>

        {/* Drop body */}
        <div
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(stage); }}
          onDragLeave={onDragLeave}
          onDrop={e => { e.preventDefault(); onDrop(stage, e.dataTransfer.getData('text/plain')); }}
          style={{
            flex: 1,
            padding: density === 'compact' ? '0 12px 60px' : '0 12px 60px',
            overflow: 'auto',
            background: dragOver ? `${accent}06` : 'transparent',
            boxShadow: dragOver ? `inset 0 0 0 1px ${accent}55` : 'none',
            transition: 'background 0.12s, box-shadow 0.12s',
          }}
        >
          {leads.map(l => (
            <LeadCard
              key={l.id}
              lead={l}
              density={density}
              dragging={l.id === draggingId}
              selected={l.id === selectedId}
              onClick={() => onCardClick(l.id)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
          {leads.length === 0 && (
            <div style={{
              padding: '40px 16px',
              textAlign: 'center',
              color: t.mutedDim,
              font: '400 11px/1.5 var(--font-mono)',
              letterSpacing: 1,
              border: `1px dashed ${t.lineDim}`,
              marginTop: 8,
            }}>
              {dragOver ? '▾ DROP HERE' : 'EMPTY'}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Stage transition strip — top header above each column ─────────────
  function TransitionStrip({ leads, allStages }) {
    // For each adjacent pair show: "STAGE → STAGE" + count of leads moved/needing move
    const pairs = [
      ['incoming',  'contacted'],
      ['contacted', 'demo'],
      ['demo',      'closing'],
      ['closing',   'won'],
    ];
    return (
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        borderBottom: `1px solid ${t.lineDim}`,
      }}>
        {pairs.map(([from, to]) => (
          <div key={`${from}-${to}`} style={{
            padding: '10px 14px',
            borderRight: `1px solid ${t.lineDim}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <L c={t.mutedDim} sz={9}>{D.STAGE[from]?.label || from.toUpperCase()}</L>
            <L c={t.amberDim} sz={11}>→</L>
            <L c={t.mutedDim} sz={9}>{D.STAGE[to]?.label || to.toUpperCase()}</L>
            <span style={{ flex: 1 }} />
            <L c={t.mutedDim} sz={9}>—</L>
          </div>
        ))}
      </div>
    );
  }

  // ── Synthetic enrichment for new fields ────────────────────────────────
  // Derive address / uid / employees / people from existing lead data + a
  // seed so demo content is stable per lead. Real backend would store these.
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

    // Build a small People list. Primary contact is always present and
    // defaults to decision-maker. About 30% of leads have a secondary
    // contact (e.g. assistant or co-owner).
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

  // ── Feather icons for INTEL chips (size-flexible, currentColor) ────────
  function IconGlobe({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  }
  function IconZap({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    );
  }
  function IconSearch({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    );
  }
  function IconTrendingUp({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    );
  }
  function IconDollar({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    );
  }
  function IconCart({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    );
  }
  function IconMapPin({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    );
  }
  function IconRefresh({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    );
  }
  function IconBriefcase({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    );
  }
  function IconAlertTriangle({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  function IconRotateCw({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    );
  }
  function IconSparkle({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1l1.6 6.4L20 9l-6.4 1.6L12 17l-1.6-6.4L4 9l6.4-1.6L12 1z" />
      </svg>
    );
  }
  function IconShield({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  }
  function IconSmartphone({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    );
  }
  function IconLayers({ s = 12 }) {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    );
  }

  // Hand-researched intel for real-world prospects. Fields marked
  // "UNVERIFIED" can't be determined from a single HTML fetch — real agent
  // would fill these from PageSpeed Insights, Ahrefs, jobs.ch crawls etc.
  const REAL_INTEL = {
    aequitas: {
      cms: { name: 'Webflow', age: 2024 },
      lighthouse: 78,  // UNVERIFIED — estimated from modern Webflow build
      dr: 22,          // UNVERIFIED
      buyingDots: 0,
      budgetTier: 'HIGH',
      hasEcom: false, ecomPlatform: null,
      locations: 1, recentRebrand: true, agency: null,
      hosting: 'Webflow CDN', sslDaysLeft: 200,
      lastUpdateLabel: 'recently (2024 build)',
      industry: 'Legal',
      // Lamp fields — load-bearing for the dashboard
      lamps: {
        age:     { state: '2024 FRESH', tone: 'bad',  level: 4, total: 4, sub: 'upd 4 mo ago' },
        hosting: { state: 'WEBFLOW',    tone: 'info', sub: 'Global CDN' },
        stack:   { state: 'WEBFLOW',    tone: 'info', sub: 'CMS + Forms' },
        photo:   { state: 'MASTER',     tone: 'bad',  sub: 'studio photography' },
        performance: { state: 92, sub: 'mobile 78', score: true },
        seo:     { state: 75, score: true },
        traffic: { state: 'STEADY',     tone: 'mid',  level: 2, total: 4 },
        mobile:  { state: 'OK',         tone: 'info' },
        analytics: { state: 'GA4',      tone: 'info' },
        pixels:  { state: 'META + GOOGLE', tone: 'info' },
        booking: { state: 'NATIVE',     tone: 'info' },
        saas:    { state: 'HUBSPOT',    tone: 'bad' },
        reviews: { state: 'PREMIUM 4.7★', tone: 'bad',  sub: '12 Google reviews' },
        lang:    { state: '4 LANG',     tone: 'info' },
      },
      topKeywords: [
        { kw: 'bernasconi avvocato lugano', rank: 2 },
        { kw: 'studio legale lugano', rank: 6 },
        { kw: 'diritto penale ticino', rank: 14 },
        { kw: 'notaio bellinzona', rank: 19 },
        { kw: 'white-collar attorney CH', rank: 31 },
      ],
      designProse: 'Top-tier execution. Webflow build with disciplined typography hierarchy, professional photography, and multi-lingual rigor across IT/DE/FR/EN. To match this quality we\'d need a senior designer + agency-level photo direction + content team. Replacement cost ≥ CHF 25k for parity — they paid roughly the same.',
      seoProse: 'Limited but coherent. Multi-lingual indexed pages, professional copy, structured data on team profiles. Estimated DR 20–25 — a small footprint that matches firm size, not a content engine. Switching pain technically low (~30 pages) but they have no reason to take the risk.',
      buyerSignals: [],
      needs: [
        'Site is well-built, multi-lingual, GDPR-ready — no obvious pain',
        'Modern Webflow build, professionally executed',
        'Prominent legal figure on the team (Prof. Bernasconi)',
      ],
      solutions: [
        'No pitch angle right now',
        'Park indefinitely — high-prestige firm with a working modern site',
      ],
      redFlag: 'No identifiable pain · top-tier firm · do not pursue',
      lastResearched: '2m ago',
      neverResearched: false,
    },
    alba: {
      cms: { name: 'Next.js', age: 2024 },
      lighthouse: 72,  // UNVERIFIED
      dr: 11,          // UNVERIFIED
      buyingDots: 1,
      budgetTier: 'MID',
      hasEcom: false, ecomPlatform: null,
      locations: 1, recentRebrand: false, agency: null,
      hosting: 'Vercel (Next.js)', sslDaysLeft: 90,
      lastUpdateLabel: 'maintained',
      industry: 'Trades',
      lamps: {
        age:     { state: '2024 FRESH', tone: 'bad',  level: 4, total: 4, sub: 'maintained' },
        hosting: { state: 'VERCEL',     tone: 'info', sub: 'EU CDN' },
        stack:   { state: 'NEXT.JS',    tone: 'info', sub: '14.x + Tailwind' },
        photo:   { state: 'STOCK',      tone: 'good', sub: 'leaning stock' },
        performance: { state: 88, sub: 'mobile 72', score: true },
        seo:     { state: 52, score: true },
        traffic: { state: 'LOW',        tone: 'good', level: 1, total: 4 },
        mobile:  { state: 'OK',         tone: 'info' },
        analytics: { state: 'GA4',      tone: 'info' },
        pixels:  { state: 'GOOGLE',     tone: 'info' },
        booking: { state: 'PHONE',      tone: 'good' },
        saas:    { state: 'NONE',       tone: 'good' },
        reviews: { state: 'GOOGLE 4.6★', tone: 'mid',  sub: '28 reviews' },
        lang:    { state: 'DE',         tone: 'info' },
      },
      topKeywords: [
        { kw: 'bodenbeläge aargau', rank: 7 },
        { kw: 'parkett killwangen', rank: 3 },
        { kw: 'teppich verlegen zürich', rank: 18 },
        { kw: 'vinylboden offerte', rank: 24 },
        { kw: 'haro bauwerk händler', rank: 41 },
      ],
      designProse: 'Decent Next.js execution — looks like a developer/agency hybrid. Bones are modern (responsive, fast). Weak point is the imagery: stock-leaning, sparse portfolio of actual installations, generic hero. The structure is good, the curation isn\'t. We can lift this without a full rebuild — photo shoot + content polish does most of the work.',
      seoProse: 'Weak. Estimated DR < 12. Domain split (.com canonical vs .ch share URL) is a measurable SEO drag we can fix. Local-SEO is the easy win — they\'re undervaluing Killwangen/Aargau geo-targeting, no Google Business optimisation visible. Low switching pain (almost nothing to preserve) and clear upside.',
      buyerSignals: [
        'Has working "Offerte" (quote-request) flow — they invest in leads.',
        'WhatsApp contact integration — already digital-channel aware.',
      ],
      needs: [
        'Stock product imagery — thin portfolio of actual installations',
        'Limited content depth around the partner brands (Bauwerk, Haro etc.)',
        'Domain split: .com is canonical but .ch is what they share — SEO drag',
        'No customer reviews / case studies on-site',
      ],
      solutions: [
        'Photo shoot of completed installations (CHF 2\'800)',
        'Case-study + reviews section to build trust (CHF 3\'500)',
        'Domain consolidation + SEO push (CHF 2\'500)',
        'Optional: maintenance retainer (CHF 200/mo)',
      ],
      redFlag: null,
      lastResearched: '3m ago',
      neverResearched: false,
    },
    fflaw: {
      cms: { name: 'WordPress + Elementor', age: 2020 },
      lighthouse: 58,  // UNVERIFIED
      dr: 28,          // UNVERIFIED
      buyingDots: 2,
      budgetTier: 'MID',
      hasEcom: false, ecomPlatform: null,
      locations: 1, recentRebrand: false, agency: null,
      hosting: 'WordPress hosting (CH)', sslDaysLeft: 165,
      lastUpdateLabel: '2 months ago',
      industry: 'Legal',
      lamps: {
        age:     { state: '2020 MAINT',  tone: 'mid',  level: 3, total: 4, sub: 'upd 2 mo ago' },
        hosting: { state: 'WP HOSTING',  tone: 'info', sub: 'CH server' },
        stack:   { state: 'WP 6.2',      tone: 'info', sub: 'Elementor 4.0.9' },
        photo:   { state: 'COMPETENT',   tone: 'mid',  sub: 'mixed sources' },
        performance: { state: 64, sub: 'mobile 41', score: true },
        seo:     { state: 81, score: true },
        traffic: { state: 'STRONG',      tone: 'bad',  level: 3, total: 4 },
        mobile:  { state: 'PARTIAL',     tone: 'mid' },
        analytics: { state: 'GA4 + GTM', tone: 'info' },
        pixels:  { state: 'META',        tone: 'info' },
        booking: { state: 'NATIVE',      tone: 'info' },
        saas:    { state: 'NONE',        tone: 'good' },
        reviews: { state: 'TRUSTPILOT 4.8★', tone: 'bad',  sub: '500+ reviews' },
        lang:    { state: 'DE/EN',       tone: 'info' },
      },
      topKeywords: [
        { kw: 'rechtsanwalt winterthur', rank: 1 },
        { kw: 'strafrecht zürich', rank: 4 },
        { kw: 'opferanwalt schweiz', rank: 9 },
        { kw: 'migrationsrecht winterthur', rank: 11 },
        { kw: 'tierrechtsanwalt schweiz', rank: 3 },
      ],
      designProse: 'Functional template execution. WordPress + Elementor 4.0.9 — page-builder rhythm, generic section patterns, mobile renders slightly heavy. The site does the job for them but doesn\'t signal premium. Plenty of room to elevate the typographic system, photography, and mobile rhythm without abandoning the WordPress content backend.',
      seoProse: 'Strong. 500+ Trustpilot reviews, regularly-updated blog (multiple posts in 2026), active social pipeline driving traffic. Estimated DR 25–30. Switching pain HIGH — any migration risks the content equity and ranking they\'ve built. Pitch optimisation + modernisation, not replacement. “Your engine works, let\'s make it scale”.',
      buyerSignals: [
        '500+ Trustpilot reviews · 4.8/5 — strong reputation signal.',
        'Active blog with multiple 2026 posts — in-flight content marketing.',
        'Paid consultation booking (CHF 330) — monetizes inbound.',
      ],
      needs: [
        'WordPress + Elementor 4.0.9 — template-heavy, hard to scale',
        'Mobile UX could be tightened (Elementor sites tend to bloat)',
        'Multi-channel social presence runs ahead of the site\'s aesthetics',
      ],
      solutions: [
        'Modern stack migration (Webflow / Next.js) — they\'ve outgrown Elementor',
        'Mobile-first rebuild keeping content + SEO equity',
        'But: their engine works — they need a reason to switch',
      ],
      redFlag: 'Their content engine is working · low switching motivation',
      lastResearched: '4m ago',
      neverResearched: false,
    },
  };

  // ── Synthetic intel data — stable per lead via seed ────────────────────
  function leadIntel(lead) {
    if (lead.realIntel && REAL_INTEL[lead.realIntel]) {
      return REAL_INTEL[lead.realIntel];
    }
    const seed = lead.id.charCodeAt(lead.id.length - 1) +
                 lead.id.charCodeAt(lead.id.length - 2) * 31 + 7;
    const CMS_OPTIONS = [
      { name: 'WordPress 5.2', age: 2018 },
      { name: 'WordPress 6.5', age: 2024 },
      { name: 'Squarespace',   age: 2021 },
      { name: 'Webflow',       age: 2023 },
      { name: 'Wix',           age: 2019 },
      { name: 'Custom HTML',   age: 2016 },
      { name: 'Joomla 3',      age: 2017 },
    ];
    const cms = CMS_OPTIONS[seed % CMS_OPTIONS.length];
    const lighthouse = ((seed * 7) % 80) + 18;            // 18-97
    const dr = (seed * 3) % 65;                            // 0-64
    const buyingDots = (seed * 13) % 6;                    // 0-5
    const budgetTiers = ['LOW','MID','HIGH'];
    const budgetTier = budgetTiers[seed % 3];
    const hasEcom = seed % 4 === 0;
    const ecomPlatform = ['Shopify','WooCommerce','Magento'][seed % 3];
    const locations = (seed % 6) === 0 ? Math.max(2, 1 + (seed % 7)) : 1;
    const recentRebrand = seed % 5 === 0;
    const agency = seed % 7 === 0 ? ['Pixel Agency','Brandstudio','Webfactory ZH','Studio Verde'][seed % 4] : null;

    // ── Real text intel ─────────────────────────────────────────────────
    const HOSTING = ['Hostpoint · CH','Cyon · CH','Infomaniak · CH','Hetzner · DE','Vercel','GoDaddy','SiteGround','WP Engine','Cloudways'];
    const hosting = HOSTING[seed % HOSTING.length];
    const sslDaysLeft = ((seed * 11) % 400) + 5;          // 5-405 days
    const monthsSinceUpdate = (seed * 5) % 36;            // 0-35 months
    const lastUpdateLabel = monthsSinceUpdate < 1
      ? 'this week'
      : monthsSinceUpdate < 12
      ? `${monthsSinceUpdate}mo ago`
      : `${Math.floor(monthsSinceUpdate / 12)}y ago`;

    // Industry inference from company / channel
    function inferIndustry(c) {
      const s = (c || '').toLowerCase();
      if (s.includes('ristorante') || s.includes('trattoria') || s.includes('caffè') || s.includes('bar ') || s.includes('bistrot')) return 'Restaurant';
      if (s.includes('hotel') || s.includes('bellevue') || s.includes('splendid')) return 'Hotel';
      if (s.includes('hair') || s.includes('capelli')) return 'Salon';
      if (s.includes('dent')) return 'Dental';
      if (s.includes('garage')) return 'Auto';
      if (s.includes('atelier') || s.includes('studio')) return 'Studio';
      if (s.includes('boulangerie')) return 'Bakery';
      if (s.includes('sport')) return 'Sport';
      return 'Retail';
    }
    const industry = inferIndustry(lead.company);

    // Buyer-signal prose snippets — 0-3 per lead, narrative form
    const BUYER_PROSE_POOL = [
      `Posted "Marketing Manager" role on jobs.ch ${(seed % 30) + 1}d ago.`,
      `Press mention in Tagi ${(seed % 8) + 1}wk ago — opening new location.`,
      `Instagram rebrand ${(seed * 2) % 60}d ago, site still on old logo.`,
      `Active Meta ad campaign · estimated CHF ${4 + (seed % 8)}k/mo.`,
      `"Coming soon" banner spotted on /jobs page.`,
      `Listed on Crunchbase · raised CHF ${(seed % 5) + 1}M Series A ${(seed % 18) + 2}mo ago.`,
      `Founder posted "we're hiring across all roles" on LinkedIn ${(seed % 14) + 1}d ago.`,
    ];
    const buyerSignals = [];
    if (buyingDots >= 1) buyerSignals.push(BUYER_PROSE_POOL[seed % BUYER_PROSE_POOL.length]);
    if (buyingDots >= 3) buyerSignals.push(BUYER_PROSE_POOL[(seed + 3) % BUYER_PROSE_POOL.length]);
    if (buyingDots >= 5) buyerSignals.push(BUYER_PROSE_POOL[(seed + 5) % BUYER_PROSE_POOL.length]);

    // Needs analysis — 3-5 bullets per lead, derived from industry + age
    const NEEDS_BY_INDUSTRY = {
      Restaurant: ['Outdated menu page (last update 2018)','No online reservation system','Mobile site barely usable on iPhone','Instagram drives traffic to dead links','No multilingual support (DE/IT/FR)'],
      Hotel:      ['Booking widget broken on Safari','Photos are 800px stock','No multilingual support (DE/IT/FR/EN)','Old Joomla 3, security patches missing','No direct-booking incentive vs Booking.com'],
      Salon:      ['Phone-only booking, no Calendly','Stale Facebook page · last post 14mo','No price page (forces phone call)','Founder photos from 2015'],
      Dental:     ['Patient form is a PDF download','GDPR cookie banner missing','Mobile site shows desktop layout','Doctors\' profiles outdated'],
      Auto:       ['Stock-photo workshop hero','Service list as flat text, no categories','No appointment booking','No price ranges shown'],
      Studio:     ['Portfolio is image grid with no captions','No case studies','Contact form returns email-only'],
      Bakery:     ['No daily menu / fresh products page','Instagram driving zero traffic','No online ordering'],
      Sport:      ['Class schedule is a PDF','Trainer bios are 2019 photos','No trial-class CTA'],
      Retail:     ['No e-commerce despite physical inventory','Site loads in 8s on mobile','Stock images only','No store locator'],
    };
    const needs = NEEDS_BY_INDUSTRY[industry] || NEEDS_BY_INDUSTRY.Retail;
    // Solutions = the corresponding upsell pitch
    const SOLUTIONS_BY_INDUSTRY = {
      Restaurant: ['Modern responsive website (CHF 8\'000–12\'000)','Online reservation integration','Multilingual content (DE/IT/FR)','Google Business Profile optimization','Monthly maintenance retainer'],
      Hotel:      ['Direct-booking site with revenue uplift','Photo shoot (CHF 4\'500)','4-language site (DE/IT/FR/EN)','SEO program for direct-booking keywords','Year-1 retainer'],
      Salon:      ['Booking-first site (Calendly/Treatwell)','Price-transparent menu','Founder rebrand photo session','IG-feed integration','€-priced retainer'],
      Dental:     ['Patient portal site','GDPR-compliant cookie + privacy','Mobile-first redesign','Doctor profile refresh'],
      Auto:       ['Service catalog with categories','Appointment-booking integration','Price-range transparency','Local SEO push'],
      Studio:     ['Case-study-first portfolio','Lead capture on contact','Brand-voice copywriting'],
      Bakery:     ['Daily-menu CMS','IG-driven landing page','Click-and-collect integration'],
      Sport:      ['Class-schedule CMS','Trial-class booking flow','Trainer bio refresh + photos'],
      Retail:     ['E-commerce build (Shopify)','Speed audit + CDN','Photo shoot for inventory','Store-locator integration'],
    };
    const solutions = SOLUTIONS_BY_INDUSTRY[industry] || SOLUTIONS_BY_INDUSTRY.Retail;

    const redFlag = seed % 11 === 0
      ? 'Mid-redesign with another agency · Don\'t poach'
      : (seed % 13 === 0 ? 'Listed on bad-payer registry · Verify before invoicing' : null);
    const minutesAgo = (seed * 17) % 600;
    const lastResearched = minutesAgo < 60
      ? `${minutesAgo}m ago`
      : `${Math.floor(minutesAgo / 60)}h ago`;

    // ── Derived lamps ───────────────────────────────────────────────────
    // Design tier from CMS + age. Cheaper stacks + older = DIY/BUDGET. Premium = Webflow recent.
    const designLevel = (() => {
      if (cms.name === 'Custom HTML') return 1;       // DIY
      if (cms.name === 'Wix' || cms.name === 'Joomla 3') return 2;  // BUDGET
      if (cms.name === 'Squarespace' || cms.name.startsWith('WordPress')) return 3; // MID
      if (cms.name === 'Webflow') return cms.age >= 2023 ? 4 : 3; // PREMIUM
      return 3;
    })();
    const designLabel = ['DIY','BUDGET','MID','PREMIUM','LUXURY'][designLevel - 1];
    // Design tone: MID/PREMIUM are ideal targets, DIY too cheap, LUXURY hard to displace
    const designTone = designLevel === 1 ? 'info'
                     : designLevel === 2 ? 'mid'
                     : designLevel === 3 ? 'good'
                     : designLevel === 4 ? 'good'
                     : 'bad';

    // Age — 4 buckets
    const ageYearsAgo = 2026 - cms.age;
    const ageLevel = ageYearsAgo <= 2 ? 4 : ageYearsAgo <= 5 ? 3 : ageYearsAgo <= 10 ? 2 : 1;
    const ageLabel = ['ANCIENT','STALE','MAINTAINED','FRESH'][ageLevel - 1];
    // Tone: fresh = bad for us (recently redesigned), stale/ancient = good for us
    const ageTone = ageLevel === 4 ? 'bad' : ageLevel === 3 ? 'mid' : 'good';

    // Lock
    const lockLabel = redFlag && redFlag.includes('redesign') ? 'LOCKED'
                    : agency ? 'ENGAGED' : 'OPEN';
    const lockTone = lockLabel === 'LOCKED' ? 'bad' : lockLabel === 'ENGAGED' ? 'mid' : 'good';

    // SEO from DR
    const seoLevel = dr < 8 ? 1 : dr < 20 ? 2 : dr < 40 ? 3 : 4;
    const seoLabel = ['NONE','WEAK','MID','STRONG'][seoLevel - 1];
    const seoTone = seoLevel === 4 ? 'bad' : seoLevel === 3 ? 'mid' : 'good';

    // SSL
    const sslLabel = sslDaysLeft <= 0 ? 'HTTP' : sslDaysLeft < 30 ? 'EXPIRING' : 'OK';
    const sslTone = sslLabel === 'HTTP' ? 'bad' : sslLabel === 'EXPIRING' ? 'mid' : 'info';

    // Mobile (use lighthouse as proxy)
    const mobileLabel = lighthouse < 40 ? 'BROKEN' : lighthouse < 70 ? 'PARTIAL' : 'OK';
    const mobileTone = mobileLabel === 'BROKEN' ? 'bad' : mobileLabel === 'PARTIAL' ? 'mid' : 'info';

    // Language — from city
    const langByCity = {
      'Lugano': 'IT', 'Bellinzona': 'IT', 'Tessin': 'IT', 'Milano': 'IT',
      'Genève': 'FR', 'Lausanne': 'FR',
      'Zürich': 'DE', 'Bern': 'DE', 'Basel': 'DE', 'St. Moritz': 'DE',
    };
    const langLabel = langByCity[lead.city] || 'DE';

    // Reviews — synthesized: tone "bad" = high (strong reputation = hard to displace),
    // "mid" = moderate, "good" = weak (we can pitch reputation building as part of redesign).
    const reviewsRoll = (seed * 23) % 8;
    const reviewsLamp = reviewsRoll === 0 ? { state: 'TRUSTPILOT 4.8★', tone: 'bad',  sub: `${100 + (seed % 400)} reviews` }
                      : reviewsRoll === 1 ? { state: 'GOOGLE 4.7★',     tone: 'bad',  sub: `${50 + (seed % 200)} reviews` }
                      : reviewsRoll === 2 ? { state: 'GOOGLE 4.5★',     tone: 'mid',  sub: `${15 + (seed % 60)} reviews` }
                      : reviewsRoll === 3 ? { state: 'GOOGLE 4.2★',     tone: 'mid',  sub: `${10 + (seed % 40)} reviews` }
                      : reviewsRoll === 4 ? { state: 'GOOGLE 3.8★',     tone: 'good', sub: `${5 + (seed % 20)} reviews` }
                      : reviewsRoll === 5 ? { state: 'FEW',             tone: 'good', sub: `${1 + (seed % 5)} reviews` }
                      :                     { state: 'NONE',            tone: 'good', sub: 'no listings' };

    // Performance + SEO — derived from CMS choice / age. Older WordPress = lower perf.
    const perfDesktop = cms.name === 'Webflow' ? 88 + (seed % 8)
                      : cms.name === 'Next.js' ? 82 + (seed % 12)
                      : cms.name === 'Squarespace' ? 70 + (seed % 15)
                      : cms.name.startsWith('WordPress') ? 50 + (seed % 25)
                      : cms.name === 'Wix' ? 55 + (seed % 15)
                      : cms.name === 'Joomla 3' ? 35 + (seed % 25)
                      : 60 + (seed % 20);
    const perfMobile = Math.max(0, perfDesktop - (15 + (seed % 20)));
    const seoScore = seoLevel === 4 ? 75 + (seed % 20)
                   : seoLevel === 3 ? 55 + (seed % 25)
                   : seoLevel === 2 ? 35 + (seed % 25)
                   :                  15 + (seed % 25);

    // Photo source — sub-line under PHOTO state
    const photoRoll = (seed * 11) % 3;
    const photoLamp = photoRoll === 0 ? { state: 'MASTER',    tone: 'bad',  sub: 'studio shoot' }
                    : photoRoll === 1 ? { state: 'COMPETENT', tone: 'mid',  sub: 'mixed sources' }
                    :                   { state: 'STOCK',     tone: 'good', sub: 'unsplash-tier' };

    // Hosting sub — country/CDN flavor
    const hostingFirstWord = (HOSTING[seed % HOSTING.length] || 'UNKNOWN').split(' ')[0].toUpperCase();
    const hostingSub = hostingFirstWord === 'VERCEL' || hostingFirstWord === 'WEBFLOW' || hostingFirstWord === 'WP'
      ? 'Global CDN'
      : hostingFirstWord === 'HOSTPOINT' || hostingFirstWord === 'CYON' || hostingFirstWord === 'INFOMANIAK'
      ? 'CH server'
      : hostingFirstWord === 'HETZNER'
      ? 'EU server'
      : 'US server';

    // Stack sub — version detail when present
    const stackParts = cms.name.split(' ');
    const stackSub = stackParts.length > 1 ? stackParts.slice(1).join(' ') : 'core';

    // Industry sub — city + offices count (shown in employees row, not big lamp)
    const officeCount = (seed % 6) === 0 ? 1 + (seed % 4) : 1;
    const industrySub = `${lead.city || '—'} · ${officeCount > 1 ? `${officeCount} offices` : '1 office'}`;

    const lamps = {
      age:     { state: `${cms.age} ${ageLabel}`, tone: ageTone, level: ageLevel, total: 4, sub: `upd ${lastUpdateLabel}` },
      hosting: { state: hostingFirstWord, tone: 'info', sub: hostingSub },
      stack:   { state: cms.name.toUpperCase().replace('WORDPRESS', 'WP'), tone: 'info', sub: stackSub },
      photo:   photoLamp,
      performance: { state: perfDesktop, sub: `mobile ${perfMobile}`, score: true },
      seo:     { state: seoScore, score: true },
      // Employees row data — rendered below big lamps
      industry:{ state: (industry || 'UNK').toUpperCase(), tone: 'info', sub: industrySub },
      // Small strip — nice-to-haves
      reviews: reviewsLamp,
      mobile:  { state: mobileLabel, tone: mobileTone },
      analytics: (() => {
        const a = (seed * 7) % 4;
        return a === 0 ? { state: 'GA4', tone: 'info' }
             : a === 1 ? { state: 'PLAUSIBLE', tone: 'info' }
             : a === 2 ? { state: 'MATOMO', tone: 'info' }
             :          { state: 'NONE', tone: 'good' };
      })(),
      pixels:  (() => {
        const p = (seed * 13) % 4;
        return p === 0 ? { state: 'META', tone: 'info' }
             : p === 1 ? { state: 'GOOGLE', tone: 'info' }
             : p === 2 ? { state: 'META + GOOGLE', tone: 'info' }
             :          { state: 'NONE', tone: 'good' };
      })(),
      booking: (() => {
        const b = (seed * 17) % 5;
        return b === 0 ? { state: 'CALENDLY', tone: 'info' }
             : b === 1 ? { state: 'TREATWELL', tone: 'info' }
             : b === 2 ? { state: 'NATIVE', tone: 'info' }
             : b === 3 ? { state: 'PHONE', tone: 'good' }
             :          { state: 'NONE', tone: 'good' };
      })(),
      saas:    (() => {
        const s = (seed * 19) % 5;
        return s === 0 ? { state: 'HUBSPOT', tone: 'bad' }
             : s === 1 ? { state: 'SALESFORCE', tone: 'bad' }
             : s === 2 ? { state: 'PIPEDRIVE', tone: 'mid' }
             : s === 3 ? { state: 'INTERCOM', tone: 'mid' }
             :          { state: 'NONE', tone: 'good' };
      })(),
      lang:    { state: langLabel, tone: 'info' },
    };

    // Top 5 keywords — synthesized from industry
    const KEYWORDS_BY_INDUSTRY = {
      Restaurant: ['ristorante lugano', 'cucina ticinese', 'pizzeria menu', 'tavolo riservato', 'aperitivo'],
      Hotel:      ['hotel ' + (lead.city || 'svizzera').toLowerCase(), 'wellness retreat', 'booking direct', 'spa weekend', 'business hotel'],
      Salon:      ['parrucchiere ' + (lead.city || 'svizzera').toLowerCase(), 'taglio capelli donna', 'colorazione', 'balayage prezzo', 'salone bellezza'],
      Dental:     ['zahnarzt ' + (lead.city || 'schweiz').toLowerCase(), 'implantat preis', 'bleaching', 'kieferorthopädie', 'angstpatient'],
      Auto:       ['garage ' + (lead.city || 'schweiz').toLowerCase(), 'service auto', 'reparatur', 'mfk vorbereitung', 'occasion verkauf'],
      Studio:     ['design studio', 'branding agency', 'creative direction', 'web design', 'portfolio'],
      Bakery:     ['bäckerei ' + (lead.city || 'schweiz').toLowerCase(), 'brot bio', 'frühstück', 'kuchen bestellen', 'patisserie'],
      Sport:      ['fitness ' + (lead.city || 'schweiz').toLowerCase(), 'personal training', 'crossfit', 'yoga klasse', 'gruppentraining'],
      Retail:     ['shop ' + (lead.city || 'schweiz').toLowerCase(), 'lieferung kostenlos', 'rabattcode', 'sonderangebot', 'kundendienst'],
    };
    const topKeywords = (KEYWORDS_BY_INDUSTRY[industry] || KEYWORDS_BY_INDUSTRY.Retail).map((kw, i) => ({
      kw,
      rank: ((seed + i * 7) % 40) + 2,
    }));

    // Free-text quality verdicts — must be prose, not a lamp.
    const designTierLabels = { 1: 'DIY', 2: 'BUDGET', 3: 'MID', 4: 'PREMIUM', 5: 'LUXURY' };
    const designProse = `Looks like ${designTierLabels[designLevel]}-tier execution on ${cms.name}. Built ${ageYearsAgo <= 2 ? 'recently' : ageYearsAgo + ' years ago'}, last updated ${lastUpdateLabel}. ${
      designLevel >= 4 ? 'Professional finish — replacement cost would be similar.' :
      designLevel === 3 ? 'Competent but unremarkable — clear room to elevate typography, photography, and mobile rhythm.' :
      'Template-y or DIY feel — wide-open canvas to upgrade.'}`;
    const seoProse = seoLevel === 4
      ? `Strong. DR ${dr}, ${buyingDots >= 1 ? 'active content footprint' : 'established presence'}. Switching pain HIGH — pitch optimisation, not replacement.`
      : seoLevel === 3
      ? `Moderate. DR ${dr}. Switching pain manageable. Could pitch SEO uplift as part of the redesign.`
      : `Weak. DR ${dr} — limited organic footprint. Low switching pain, clear upside on a fresh foundation.`;

    return {
      cms, lighthouse, dr, buyingDots, budgetTier,
      hasEcom, ecomPlatform, locations, recentRebrand, agency, redFlag,
      hosting, sslDaysLeft, lastUpdateLabel,
      industry, buyerSignals, needs, solutions, lamps,
      designProse, seoProse, topKeywords,
      lastResearched, neverResearched: seed % 23 === 0,
    };
  }

  // ── Intel chip — base shell + tone variants ────────────────────────────
  function chipBox(tone, t) {
    // tone: 'hot' | 'cool' | 'warn' | 'dim' | 'neutral'
    const map = {
      hot:     { color: t.amber,    bg: `${t.amber}15`,    border: `1px solid ${t.amberDim}` },
      cool:    { color: t.phosphor, bg: `${t.phosphor}10`, border: `1px solid ${t.phosphor}50` },
      warn:    { color: t.red,      bg: `${t.red}10`,      border: `1px solid ${t.red}50` },
      dim:     { color: t.muted,    bg: 'transparent',     border: `1px dashed ${t.lineDim}` },
      neutral: { color: t.bone,     bg: t.bgCard,          border: `1px solid ${t.lineDim}` },
    };
    return map[tone] || map.neutral;
  }

  function IntelChip({ icon: Icon, label, tone = 'neutral', tooltip, dots, dotsTotal, bars, barsLevel }) {
    const box = chipBox(tone, t);
    return (
      <div title={tooltip} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 8px',
        font: '500 10px/1 var(--font-mono)', letterSpacing: 0.8,
        color: box.color,
        background: box.bg,
        border: box.border,
        whiteSpace: 'nowrap',
      }}>
        {Icon && <Icon s={11} />}
        {label && <span>{label}</span>}
        {/* Dot rating: ●●●●○ */}
        {dots != null && (
          <span style={{ display: 'inline-flex', gap: 2, marginLeft: 1 }}>
            {Array.from({ length: dotsTotal || 5 }).map((_, i) => (
              <span key={i} style={{
                width: 4, height: 4, borderRadius: '50%',
                background: i < dots ? box.color : 'transparent',
                border: `1px solid ${box.color}`,
                opacity: i < dots ? 1 : 0.4,
              }} />
            ))}
          </span>
        )}
        {/* Bar level: ▆▆▁ */}
        {bars != null && (
          <span style={{ display: 'inline-flex', gap: 1.5, alignItems: 'flex-end', marginLeft: 1 }}>
            {Array.from({ length: bars }).map((_, i) => (
              <span key={i} style={{
                width: 3,
                height: 4 + i * 3,
                background: i < barsLevel ? box.color : 'transparent',
                border: `1px solid ${box.color}`,
                opacity: i < barsLevel ? 1 : 0.4,
              }} />
            ))}
          </span>
        )}
      </div>
    );
  }

  // Color by Lighthouse score
  function lighthouseTone(score) {
    if (score < 40)  return 'warn';
    if (score < 70)  return 'hot';
    if (score < 90)  return 'neutral';
    return 'cool';
  }
  function drTone(dr) {
    if (dr < 15)  return 'dim';
    if (dr < 40)  return 'hot';
    return 'cool';
  }

  // ── Lamp — single glanceable indicator. The dashboard primitive. ───────
  // Supports two modes:
  //   - categorical: pass tone='good|mid|bad|info' (color drives card chrome)
  //   - score: pass score=true; state is a 0-100 number; color bands use
  //     Google thresholds: 0-49 red · 50-89 amber · 90-100 green.
  function Lamp({ icon: Icon, label, state, sub, tone, score, scaleLevel, scaleTotal }) {
    let effectiveTone = tone;
    if (score) {
      const n = typeof state === 'number' ? state : parseInt(state, 10) || 0;
      effectiveTone = n < 50 ? 'bad' : n < 90 ? 'mid' : 'good';
    }
    const colorFor = (tn) => tn === 'good' ? t.phosphor
                          : tn === 'mid' ? t.amber
                          : tn === 'bad' ? t.red
                          : t.mutedDim;
    const color = colorFor(effectiveTone);
    const isLoud = effectiveTone === 'bad';
    const isInfo = effectiveTone === 'info' || !effectiveTone;
    return (
      <div style={{
        flex: 1, minWidth: 0,
        padding: '10px 10px 9px',
        background: isLoud ? `${t.red}10`
                 : effectiveTone === 'good' ? `${t.phosphor}08`
                 : effectiveTone === 'mid' ? `${t.amber}08`
                 : t.bgCard,
        border: `1px solid ${isInfo ? t.lineDim : color + '50'}`,
        borderTop: `2px solid ${isInfo ? t.lineDim : color}`,
        display: 'flex', flexDirection: 'column',
        gap: 5,
      }}>
        {/* Header: label + icon */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{
            font: '500 8.5px/1 var(--font-mono)', letterSpacing: 1.4,
            color: t.mutedDim, textTransform: 'uppercase',
          }}>{label}</span>
          <span style={{ color: isInfo ? t.mutedDim : color, display: 'inline-flex' }}>
            <Icon s={10} />
          </span>
        </div>
        {/* State value — the load-bearing reading. Scores rendered larger. */}
        <div style={{
          font: score
            ? `300 22px/1 var(--font-mono)`
            : '600 12px/1.1 var(--font-mono)',
          letterSpacing: score ? -0.5 : 0.6,
          color: isInfo ? t.bone : color,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{state}</div>
        {/* Optional sub-line — context for the state */}
        {sub && (
          <div style={{
            font: '400 9.5px/1.2 var(--font-mono)', letterSpacing: 0.5,
            color: t.mutedDim,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{sub}</div>
        )}
        {/* Optional scale segments */}
        {scaleTotal && (
          <div style={{ display: 'flex', gap: 1.5, marginTop: 2 }}>
            {Array.from({ length: scaleTotal }).map((_, i) => (
              <span key={i} style={{
                flex: 1, height: 2,
                background: i < scaleLevel ? color : t.lineDim,
                opacity: i < scaleLevel ? 1 : 0.5,
              }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Intel layout pieces ────────────────────────────────────────────────
  function Bigval({ label, value, sub, accent, gauge, accentColor, t, small }) {
    return (
      <div>
        <span style={{
          font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4,
          color: t.amberDim, textTransform: 'uppercase',
        }}>{label}</span>
        <div style={{
          font: small
            ? '500 20px/1.05 var(--font-sans)'
            : '300 28px/1.05 var(--font-mono)',
          color: accent ? t.amber : t.bone,
          marginTop: 8, letterSpacing: small ? -0.3 : -1,
        }}>{value}</div>
        {sub && (
          <span style={{
            font: '400 10px/1 var(--font-mono)', letterSpacing: 0.6,
            color: t.muted, marginTop: 6, display: 'inline-block',
          }}>{sub}</span>
        )}
        {gauge != null && (
          <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} style={{
                width: 8, height: 8,
                background: i < Math.round(gauge * 10) ? (accentColor || t.amber) : t.lineDim,
                opacity: i < Math.round(gauge * 10) ? 0.5 + 0.5 * (i / 10) : 1,
              }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  function EmployeesPicker({ selected, t }) {
    return (
      <div>
        <span style={{
          font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4,
          color: t.amberDim, textTransform: 'uppercase',
        }}>Employees</span>
        <div style={{ display: 'flex', gap: 3, marginTop: 10 }}>
          {EMP_BUCKETS.map(b => {
            const active = b === selected;
            return (
              <button key={b} style={{
                font: '500 10px/1 var(--font-mono)', letterSpacing: 0.5,
                padding: '7px 6px', flex: 1,
                color: active ? t.bone : t.muted,
                background: active ? `${t.amber}15` : 'transparent',
                border: `1px solid ${active ? t.amberDim : t.lineDim}`,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{b}</button>
            );
          })}
        </div>
      </div>
    );
  }

  function SubGroup({ title, t, children }) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4,
            color: t.muted, textTransform: 'uppercase',
          }}>{title}</span>
          <div style={{ flex: 1, height: 1, background: t.lineDim }} />
        </div>
        {children}
      </div>
    );
  }

  function ProseLine({ children, t, muted }) {
    return (
      <div style={{
        font: '400 12px/1.55 var(--font-sans)',
        color: muted ? t.mutedDim : t.muted,
        marginTop: 8,
        fontStyle: muted ? 'italic' : 'normal',
      }}>{children}</div>
    );
  }

  function NeedsList({ title, items, t, tone = 'hot' }) {
    const color = tone === 'cool' ? t.phosphor : t.amber;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{
            font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4,
            color, textTransform: 'uppercase',
          }}>{title}</span>
          <div style={{ flex: 1, height: 1, background: t.lineDim }} />
        </div>
        <ul style={{
          margin: 0, padding: 0, listStyle: 'none',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {items.map((it, i) => (
            <li key={i} style={{
              display: 'grid', gridTemplateColumns: '14px 1fr', gap: 8,
              alignItems: 'baseline',
              font: '400 13px/1.45 var(--font-sans)', color: t.bone,
            }}>
              <span style={{ color: color, opacity: 0.7, font: '600 12px/1 var(--font-mono)' }}>›</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // ── Inline detail panel — renders as a grid cell spanning 2 columns ────
  function InlineDetail({ lead, onClose, onUpdate }) {
    const [status, setStatus] = useState(lead.status);
    const [aiDraft, setAiDraft] = useState(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState(null);
    const [focusMode, setFocusMode] = useState(() => {
      try { return localStorage.getItem('crm.detail.focus') === '1'; }
      catch { return false; }
    });
    useEffect(() => {
      try { localStorage.setItem('crm.detail.focus', focusMode ? '1' : '0'); } catch {}
    }, [focusMode]);

    // Keyboard: `f` toggles focus mode (only when no input is focused).
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

    useEffect(() => {
      setStatus(lead.status);
      setAiDraft(null);
      setAiError(null);
      setAiLoading(false);
    }, [lead.id]);

    const overdueDays = D.daysBetween(D.TODAY, lead.due);
    const accent = STAGE_COLOR[lead.stage];
    const extras = leadExtras(lead);
    const uidRequired = status === 'won';

    async function generateAiDraft() {
      setAiLoading(true);
      setAiError(null);
      setAiDraft(null);
      try {
        if (!window.claude || !window.claude.complete) {
          throw new Error('AI helper only available in preview sandbox.');
        }
        const prompt =
`You are a Swiss-Italian sales rep at OskarOS drafting a WhatsApp follow-up to a lead.

LEAD CONTEXT
- Company: ${lead.company}
- Contact: ${lead.contact}
- City: ${lead.city || '—'}
- Stage: ${D.STAGE[lead.stage].label}
- Status: ${D.STATUS[lead.status].label}
- Value: CHF ${D.chf(lead.amount)} at ${Math.round(lead.prob * 100)}% probability
- Due date: ${lead.due} ${overdueDays > 0 ? `(${overdueDays} days overdue)` : overdueDays === 0 ? '(today)' : ''}
- Next move planned: ${lead.note}
- Private notes / context: ${lead.comment}

Write a short, warm, professional WhatsApp message in the contact's likely language (Italian for Italian/Tessin names, French for Romandy, German otherwise; English if unclear). 2-3 sentences max. Conversational, no formal sign-off. Just the message body — no preamble, no quotes, no labels.`;
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
        background: t.bgElev,
        borderLeft: `1px solid ${accent}`,
        borderRight: `1px solid ${accent}`,
        display: 'flex', flexDirection: 'column',
        minHeight: 0, minWidth: 0,
        height: '100%', flex: 1,
        overflow: 'hidden',
        animation: 'tinlineexpand 0.28s cubic-bezier(.2,.7,.3,1)',
      }}>
        {/* Top accent rail */}
        <div style={{ height: 2, background: accent, boxShadow: `0 0 12px ${accent}88` }} />

        {/* Header row */}
        <div style={{ padding: '14px 20px 12px', borderBottom: `1px solid ${t.lineDim}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: lead.starred ? t.amber : t.muted, font: '300 14px/1 var(--font-mono)', padding: 0 }}>
              {lead.starred ? '★' : '☆'}
            </button>
            <h2 style={{ font: '500 19px/1.1 var(--font-sans)', color: t.bone, margin: 0, letterSpacing: -0.3, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.company}
            </h2>
            {/* Status pills — moved into header to reclaim body space */}
            <div style={{ display: 'flex', gap: 3 }}>
              {['todo','standby','awaiting','won','lost','cancelled'].map(s => {
                const active = s === status;
                const def = D.STATUS[s];
                const c = def.hue === 'phosphor' ? t.phosphor : def.hue === 'red' ? t.red : def.hue === 'cyan' ? t.amberHi : def.hue === 'dim' ? t.muted : t.amber;
                return (
                  <button key={s} title={def.label} onClick={() => { setStatus(s); onUpdate(lead.id, { status: s }); }} style={{
                    font: '500 9px/1 var(--font-mono)', letterSpacing: 1.1,
                    padding: '6px 8px',
                    color: active ? c : t.muted,
                    background: active ? `${c}15` : 'transparent',
                    border: `1px solid ${active ? c : t.lineDim}`,
                    cursor: 'pointer', textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}>{active && '● '}{def.label}</button>
                );
              })}
            </div>
            <button onClick={() => setFocusMode(f => !f)} title={`${focusMode ? 'Exit' : 'Enter'} focus mode (f)`} style={{
              ...iconBtn(t),
              color: focusMode ? t.amber : t.muted,
              borderColor: focusMode ? t.amberDim : t.lineDim,
              background: focusMode ? `${t.amber}10` : 'transparent',
            }}>
              {/* Focus icon: rectangle compressing to a single line */}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="2" y="2" width="12" height="3" />
                <line x1="2" y1="8" x2="14" y2="8" />
                <rect x="2" y="11" width="12" height="3" />
              </svg>
            </button>
            <button onClick={onClose} title="Close" style={iconBtn(t)}>✕</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <L c={t.amberDim} sz={9}>{lead.id}</L>
            <L c={t.mutedDim}>·</L>
            <L c={accent} sz={9}>{D.STAGE[lead.stage].label}</L>
            <L c={t.mutedDim}>·</L>
            <L c={t.muted} sz={9} ls={1.2}>LAST TOUCH</L>
            <L c={t.amber} sz={9}>{overdueDays > 0 ? `${overdueDays}D AGO` : overdueDays === 0 ? 'TODAY' : `IN ${-overdueDays}D`}</L>
            <L c={t.mutedDim}>·</L>
            <L c={t.muted} sz={9} ls={1.2}>STEP {D.STAGE[lead.stage].step}/4</L>

            <span style={{ flex: 1 }} />
            {/* Stage chevrons — quick advance/regress */}
            <button title="Regress stage" onClick={() => {
              const stages = ['incoming','contacted','demo','closing'];
              const i = stages.indexOf(lead.stage);
              if (i > 0) onUpdate(lead.id, { stage: stages[i - 1] });
            }} style={iconBtn(t)}>◀</button>
            <button title="Advance stage" onClick={() => {
              const stages = ['incoming','contacted','demo','closing'];
              const i = stages.indexOf(lead.stage);
              if (i < 3) onUpdate(lead.id, { stage: stages[i + 1] });
            }} style={iconBtn(t)}>▶</button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {!focusMode && (<>
          {/* Next move strip */}
          <div style={{ padding: '14px 16px', background: t.bgCard, border: `1px solid ${t.lineDim}`, borderLeft: `3px solid ${t.amber}`, marginBottom: 16 }}>
            <L c={t.amberDim} sz={9} style={{ display: 'block', marginBottom: 8 }}>NEXT MOVE</L>
            <div style={{ font: '500 16px/1.35 var(--font-sans)', color: t.bone, letterSpacing: -0.2 }}>{lead.note}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              <Btn primary>EXECUTE</Btn>
              <Btn>SEND WHATSAPP</Btn>
              <Btn>LOG CALL</Btn>
              <Btn>LOG EMAIL</Btn>
              {/* Linked session — phosphor, sits with the action cluster */}
              {lead.session ? (
                <button title="Open linked session" style={{
                  font: '600 10px/1 var(--font-mono)',
                  letterSpacing: 1.4,
                  padding: '9px 12px',
                  background: 'transparent',
                  color: t.phosphor,
                  border: `1px solid ${t.phosphor}`,
                  cursor: 'pointer',
                  textTransform: 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ display: 'inline-flex' }}><IconSparkle s={10} /></span>
                  <span style={{ font: '500 10px/1 var(--font-mono)', letterSpacing: 0.5 }}>{lead.session}</span>
                  <span style={{ color: t.phosphor, opacity: 0.7 }}>↗</span>
                </button>
              ) : (
                <button title="Start a discovery session linked to this lead" style={{
                  font: '600 10px/1 var(--font-mono)',
                  letterSpacing: 1.4,
                  padding: '9px 12px',
                  background: 'transparent',
                  color: t.phosphor,
                  border: `1px dashed ${t.phosphor}80`,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  + Start discovery
                </button>
              )}
              <button onClick={generateAiDraft} disabled={aiLoading} style={{
                font: '600 10px/1 var(--font-mono)',
                letterSpacing: 1.4,
                padding: '9px 12px',
                background: aiLoading ? `${t.phosphor}20` : 'transparent',
                color: t.phosphor,
                border: `1px solid ${t.phosphor}`,
                cursor: aiLoading ? 'wait' : 'pointer',
                textTransform: 'uppercase',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                position: 'relative',
              }}>
                <span style={{ position: 'relative', width: 10, height: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {aiLoading ? (
                    <span style={{
                      width: 8, height: 8, border: `1.5px solid ${t.phosphor}`, borderTopColor: 'transparent',
                      borderRadius: '50%', animation: 'tspin 0.8s linear infinite',
                    }} />
                  ) : '✨'}
                </span>
                {aiLoading ? 'RESEARCHING…' : 'AI RESEARCH'}
              </button>
            </div>

            {/* AI draft output panel */}
            {(aiDraft || aiError) && (
              <div style={{
                marginTop: 12,
                background: t.bg,
                border: `1px solid ${aiError ? t.red + '60' : t.phosphor + '40'}`,
                borderLeft: `2px solid ${aiError ? t.red : t.phosphor}`,
                padding: '10px 12px',
                position: 'relative',
                animation: 'twipe 0.25s ease-out',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <L c={aiError ? t.red : t.phosphor} sz={9} ls={1.4}>
                    {aiError ? '⚠ AI ERROR' : '✨ AI RESEARCH · WHATSAPP'}
                  </L>
                  <L c={t.mutedDim} sz={9} ls={1.1}>· claude-haiku</L>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => { setAiDraft(null); setAiError(null); }} style={{
                    background: 'none', border: 'none', color: t.mutedDim,
                    cursor: 'pointer', font: '300 12px/1 var(--font-mono)', padding: 0,
                  }}>✕</button>
                </div>
                {aiError ? (
                  <p style={{ font: '400 12px/1.5 var(--font-sans)', color: t.muted, margin: 0 }}>
                    {aiError}
                  </p>
                ) : (
                  <>
                    <p style={{ font: '400 13px/1.55 var(--font-sans)', color: t.bone, margin: 0, whiteSpace: 'pre-wrap' }}>
                      {aiDraft}
                    </p>
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <button onClick={() => { try { navigator.clipboard.writeText(aiDraft); } catch {} }} style={{
                        font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2,
                        padding: '6px 10px',
                        color: t.muted, background: 'transparent',
                        border: `1px solid ${t.lineDim}`, cursor: 'pointer',
                        textTransform: 'uppercase',
                      }}>Copy</button>
                      <button onClick={generateAiDraft} style={{
                        font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2,
                        padding: '6px 10px',
                        color: t.muted, background: 'transparent',
                        border: `1px solid ${t.lineDim}`, cursor: 'pointer',
                        textTransform: 'uppercase',
                      }}>Regenerate</button>
                      <span style={{ flex: 1 }} />
                      <button style={{
                        font: '600 9px/1 var(--font-mono)', letterSpacing: 1.2,
                        padding: '6px 10px',
                        color: '#0a0805', background: t.phosphor,
                        border: `1px solid ${t.phosphor}`, cursor: 'pointer',
                        textTransform: 'uppercase',
                      }}>Send via WhatsApp ▸</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* INTEL — verdict-first redesign. One adaptive headline up top, dense ledger below. */}
          {(() => {
            const intel = leadIntel(lead);

            // Compute the lead verdict — the single most important finding.
            const verdict = (() => {
              if (intel.redFlag) {
                return { tone: 'warn', headline: 'DISQUALIFY', subline: intel.redFlag, meta: null, prose: [] };
              }
              if (intel.buyingDots >= 3) {
                return {
                  tone: 'cool', headline: 'SHOPPING NOW',
                  subline: `${intel.buyingDots} of 5 buying signals active · budget ${intel.budgetTier.toLowerCase()}`,
                  meta: 'buyer', prose: intel.buyerSignals,
                };
              }
              if (intel.lighthouse < 40) {
                return {
                  tone: 'hot', headline: 'WEB FAILING',
                  subline: `Lighthouse ${intel.lighthouse}/100 · last update ${intel.lastUpdateLabel} · this is the pitch`,
                  meta: 'web', prose: intel.buyerSignals.slice(0, 1),
                };
              }
              if (intel.recentRebrand && intel.cms.age <= 2020) {
                return {
                  tone: 'hot', headline: 'BRAND DEBT',
                  subline: `Recent rebrand on social · old ${intel.cms.name} (${intel.cms.age}) still live`,
                  meta: 'web', prose: [],
                };
              }
              if (intel.buyingDots >= 1) {
                return {
                  tone: 'hot', headline: 'WARMING UP',
                  subline: `${intel.buyingDots} of 5 buying signals · ${intel.budgetTier.toLowerCase()} budget`,
                  meta: 'buyer', prose: intel.buyerSignals,
                };
              }
              return {
                tone: 'dim', headline: 'QUIET LEAD',
                subline: 'No strong signals yet. Worth a discovery call to qualify.',
                meta: null, prose: [],
              };
            })();

            const verdictColor = verdict.tone === 'cool' ? t.phosphor
                               : verdict.tone === 'hot'  ? t.amber
                               : verdict.tone === 'warn' ? t.red
                               : t.muted;

            const LedgerRow = ({ label, children }) => (
              <div style={{
                display: 'grid', gridTemplateColumns: '92px 1fr',
                gap: 14, alignItems: 'baseline',
                padding: '10px 0',
                borderTop: `1px solid ${t.lineDim}`,
              }}>
                <span style={{
                  font: '500 10px/1 var(--font-mono)', letterSpacing: 1.6,
                  color: t.amberDim, textTransform: 'uppercase',
                }}>{label}</span>
                <div style={{
                  font: '400 13px/1.5 var(--font-sans)',
                  color: t.bone,
                }}>{children}</div>
              </div>
            );

            const dot = <span style={{ color: t.mutedDim, margin: '0 8px' }}>·</span>;

            return (
              <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid ${t.lineDim}` }}>

                {/* INTEL provenance bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{
                    font: '500 10px/1 var(--font-mono)', letterSpacing: 2,
                    color: t.amber, textTransform: 'uppercase',
                  }}>INTEL</span>
                  <span style={{ width: 1, height: 11, background: t.lineDim }} />
                  {intel.neverResearched ? (
                    <span style={{ font: '400 10px/1 var(--font-mono)', color: t.mutedDim, letterSpacing: 0.8 }}>
                      no scan yet
                    </span>
                  ) : (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      color: t.phosphor, font: '500 10px/1 var(--font-mono)', letterSpacing: 1.1,
                    }}>
                      <IconSparkle s={10} /> scan {intel.lastResearched}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <button title="Re-scan" style={{
                    width: 26, height: 26, padding: 0,
                    background: 'transparent', border: `1px solid ${t.lineDim}`,
                    color: t.muted, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}><IconRotateCw s={11} /></button>
                  <button style={{
                    font: '600 10px/1 var(--font-mono)', letterSpacing: 1.6,
                    color: t.phosphor, background: 'transparent',
                    border: `1px solid ${t.phosphor}`,
                    padding: '7px 12px', cursor: 'pointer', textTransform: 'uppercase',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}><IconSparkle s={10} /> {intel.neverResearched ? 'Scan' : 'Re-scan'}</button>
                </div>

                {/* VERDICT BLOCK — adaptive headline. THIS is the hero. */}
                <div style={{
                  position: 'relative',
                  padding: '20px 24px 22px',
                  background: `${verdictColor}0a`,
                  border: `1px solid ${verdictColor}40`,
                  borderLeft: `3px solid ${verdictColor}`,
                  marginBottom: 6,
                  overflow: 'hidden',
                  display: 'grid',
                  gridTemplateColumns: '1fr 220px',
                  gap: 24,
                  alignItems: 'flex-start',
                }}>
                  {/* LEFT — verdict + subline + prose */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{
                        font: '500 10px/1 var(--font-mono)', letterSpacing: 2,
                        color: verdictColor, textTransform: 'uppercase',
                      }}>VERDICT</span>
                      <h3 style={{
                        font: '600 30px/1 var(--font-sans)',
                        color: verdictColor, letterSpacing: -0.8,
                        textTransform: 'uppercase',
                        margin: 0,
                      }}>{verdict.headline}</h3>
                    </div>
                    <div style={{
                      font: '400 14px/1.5 var(--font-sans)',
                      color: t.bone, marginTop: 10,
                    }}>{verdict.subline}</div>
                    {verdict.prose.length > 0 && (
                      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {verdict.prose.map((p, i) => (
                          <div key={i} style={{
                            font: '400 13px/1.55 var(--font-sans)',
                            color: t.bone,
                            display: 'grid', gridTemplateColumns: '14px 1fr', gap: 8, alignItems: 'baseline',
                          }}>
                            <span style={{ color: verdictColor, font: '500 11px/1 var(--font-mono)' }}>›</span>
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* RIGHT — chf/%/budget/buying stack. 2 cols × 2 rows so CHF↔BUDGET and %↔BUYING align. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, rowGap: 18 }}>
                    {/* Row 1: CHF | close% */}
                    <div>
                      <span style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6, color: t.amberDim, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>CHF est.</span>
                      <input
                        defaultValue={D.chf(lead.amount)}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: `1px solid ${t.lineDim}`,
                          color: t.bone,
                          font: '500 22px/1.1 var(--font-mono)',
                          padding: '2px 0',
                          outline: 'none',
                          letterSpacing: -0.5,
                        }}
                        onFocus={e => e.currentTarget.style.borderBottomColor = verdictColor}
                        onBlur={e => e.currentTarget.style.borderBottomColor = t.lineDim}
                      />
                    </div>
                    <div>
                      <span style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6, color: t.amberDim, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>close %</span>
                      <input
                        defaultValue={Math.round(lead.prob * 100) + '%'}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: `1px solid ${t.lineDim}`,
                          color: t.amber,
                          font: '500 22px/1.1 var(--font-mono)',
                          padding: '2px 0',
                          outline: 'none',
                          letterSpacing: -0.5,
                        }}
                        onFocus={e => e.currentTarget.style.borderBottomColor = verdictColor}
                        onBlur={e => e.currentTarget.style.borderBottomColor = t.lineDim}
                      />
                    </div>

                    {/* Row 2: BUDGET (under CHF) | BUYING (under %) */}
                    <div>
                      <span style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6, color: t.amberDim, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>BUDGET</span>
                      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
                        {Array.from({ length: 3 }).map((_, i) => {
                          const level = intel.budgetTier === 'HIGH' ? 3 : intel.budgetTier === 'MID' ? 2 : 1;
                          const c = intel.budgetTier === 'HIGH' ? t.phosphor : intel.budgetTier === 'MID' ? t.amber : t.mutedDim;
                          return (
                            <button key={i} style={{
                              width: 12, height: 8 + i * 6, padding: 0,
                              background: i < level ? c : 'transparent',
                              border: `1.5px solid ${c}`, opacity: i < level ? 1 : 0.3,
                              cursor: 'pointer',
                            }} />
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <span style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6, color: t.amberDim, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>BUYING</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <button key={i} title={`${i + 1} of 5`} style={{
                            width: 14, height: 14, padding: 0,
                            background: i < intel.buyingDots ? verdictColor : 'transparent',
                            border: `1.5px solid ${verdictColor}`,
                            opacity: i < intel.buyingDots ? 1 : 0.3,
                            boxShadow: i < intel.buyingDots ? `0 0 6px ${verdictColor}55` : 'none',
                            cursor: 'pointer',
                          }} />
                        ))}
                      </div>
                    </div>

                    {intel.recentRebrand && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6, color: t.amberDim, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>BRAND</span>
                        <span style={{ font: '500 11px/1 var(--font-mono)', color: t.phosphor, letterSpacing: 1.1 }}>● REBRAND</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* DASHBOARD LAMPS — 6 big lamps (always-on, each with sub-line), small strip below. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {/* Primary row — 6 lamps with sub-lines */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Lamp icon={IconRefresh}    label="AGE"          state={intel.lamps.age.state}     sub={intel.lamps.age.sub}     tone={intel.lamps.age.tone}     scaleLevel={intel.lamps.age.level} scaleTotal={intel.lamps.age.total} />
                    <Lamp icon={IconGlobe}      label="HOSTING"      state={(intel.lamps.hosting && intel.lamps.hosting.state) || 'UNK'} sub={intel.lamps.hosting && intel.lamps.hosting.sub}   tone={(intel.lamps.hosting && intel.lamps.hosting.tone) || 'info'} />
                    <Lamp icon={IconLayers}     label="STACK"        state={(intel.lamps.stack && intel.lamps.stack.state) || intel.cms.name.split(' ')[0]} sub={intel.lamps.stack && intel.lamps.stack.sub}     tone={(intel.lamps.stack && intel.lamps.stack.tone) || 'info'} />
                    <Lamp icon={IconSparkle}    label="PHOTO"        state={(intel.lamps.photo && intel.lamps.photo.state) || 'UNK'}    sub={intel.lamps.photo && intel.lamps.photo.sub}     tone={(intel.lamps.photo && intel.lamps.photo.tone) || 'info'} />
                    <Lamp icon={IconZap}        label="PERFORMANCE"  state={(intel.lamps.performance && intel.lamps.performance.state) ?? 0} sub={intel.lamps.performance && intel.lamps.performance.sub} score />
                    <Lamp icon={IconSearch}     label="SEO"          state={(intel.lamps.seo && intel.lamps.seo.state) ?? 0} score />
                  </div>
                  {/* Small strip — nice-to-haves: REVIEWS · TRAFFIC · LANG · ANALYTICS · MARKETING · SAAS · BOOKING */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                    padding: '8px 12px',
                    background: t.bgCard, border: `1px solid ${t.lineDim}`,
                    font: '400 10.5px/1.4 var(--font-mono)',
                    letterSpacing: 0.4,
                  }}>
                    {[
                      ['TRAFFIC',   (intel.lamps.traffic && intel.lamps.traffic.state) || 'UNK',     (intel.lamps.traffic && intel.lamps.traffic.tone)],
                      ['LANG',      intel.lamps.lang.state,                                           'info'],
                      ['ANALYTICS', (intel.lamps.analytics && intel.lamps.analytics.state) || 'UNK', (intel.lamps.analytics && intel.lamps.analytics.tone)],
                      ['MARKETING', (intel.lamps.pixels && intel.lamps.pixels.state) || 'UNK',       (intel.lamps.pixels && intel.lamps.pixels.tone)],
                      ['SAAS',      (intel.lamps.saas && intel.lamps.saas.state) || 'NONE',          (intel.lamps.saas && intel.lamps.saas.tone)],
                      ['BOOKING',   (intel.lamps.booking && intel.lamps.booking.state) || 'UNK',     (intel.lamps.booking && intel.lamps.booking.tone)],
                    ].map(([label, value, tone], i, arr) => {
                      const valueColor = tone === 'bad' ? t.red
                                       : tone === 'good' ? t.phosphor
                                       : tone === 'mid' ? t.amber
                                       : t.bone;
                      return (
                        <React.Fragment key={label}>
                          <span>
                            <span style={{ color: t.amberDim, letterSpacing: 1.2 }}>{label}</span>
                            <span style={{ color: valueColor, marginLeft: 6, fontWeight: 500 }}>{value}</span>
                          </span>
                          {i < arr.length - 1 && <span style={{ color: t.mutedDim }}>│</span>}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>

                {/* DESIGN QUALITY + SEO/DISPLACEMENT — qualitative, prose-only */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  <div style={{
                    padding: '12px 14px',
                    background: t.bgCard,
                    border: `1px solid ${t.lineDim}`,
                    borderLeft: `2px solid ${t.amberDim}`,
                  }}>
                    <div style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6, color: t.amberDim, textTransform: 'uppercase', marginBottom: 8 }}>
                      DESIGN QUALITY
                    </div>
                    <div style={{ font: '400 12.5px/1.55 var(--font-sans)', color: t.bone }}>
                      {intel.designProse || 'No design assessment recorded.'}
                    </div>
                  </div>
                  <div style={{
                    padding: '12px 14px',
                    background: t.bgCard,
                    border: `1px solid ${t.lineDim}`,
                    borderLeft: `2px solid ${t.amberDim}`,
                  }}>
                    <div style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6, color: t.amberDim, textTransform: 'uppercase', marginBottom: 8 }}>
                      SEO &amp; DISPLACEMENT PAIN
                    </div>
                    <div style={{ font: '400 12.5px/1.55 var(--font-sans)', color: t.bone }}>
                      {intel.seoProse || 'No SEO assessment recorded.'}
                    </div>
                  </div>
                </div>

                {/* TOP RANKED KEYWORDS — full-width row, below DQ+SEO, above the metrics ledger */}
                {intel.topKeywords && intel.topKeywords.length > 0 && (
                  <div style={{
                    padding: '12px 14px',
                    background: t.bgCard,
                    border: `1px solid ${t.lineDim}`,
                    borderLeft: `2px solid ${t.amberDim}`,
                    marginBottom: 14,
                  }}>
                    <div style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4, color: t.amberDim, textTransform: 'uppercase', marginBottom: 10 }}>
                      // TOP RANKED · {intel.topKeywords.length} KEYWORDS
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {intel.topKeywords.slice(0, 5).map((entry, i) => {
                        const kw = typeof entry === 'string' ? entry : entry.kw;
                        const rank = typeof entry === 'string' ? null : entry.rank;
                        const rankColor = rank == null ? t.mutedDim
                                        : rank <= 5  ? t.phosphor
                                        : rank <= 20 ? t.amber
                                        : t.mutedDim;
                        return (
                          <span key={i} style={{
                            display: 'inline-flex', alignItems: 'baseline', gap: 6,
                            font: '400 11px/1 var(--font-mono)',
                            color: t.bone,
                            border: `1px solid ${t.lineDim}`,
                            padding: '5px 8px',
                            letterSpacing: 0.3,
                            whiteSpace: 'nowrap',
                          }}>
                            <span>{kw}</span>
                            {rank != null && (
                              <span style={{ color: rankColor, font: '500 10px/1 var(--font-mono)', letterSpacing: 0.5 }}>#{rank}</span>
                            )}
                          </span>
                        );
                      })}
                      <button style={{
                        font: '400 11px/1 var(--font-mono)',
                        color: t.muted,
                        background: 'transparent',
                        border: `1px dashed ${t.lineDim}`,
                        padding: '5px 8px',
                        cursor: 'pointer',
                        letterSpacing: 0.3,
                      }}>+ add</button>
                    </div>
                  </div>
                )}

                {/* Lead facts row — REVIEWS · INDUSTRY · LOCATION · EMPLOYEES picker. Sits below keywords, above pain points. */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                  padding: '10px 12px',
                  background: t.bgCard, border: `1px solid ${t.lineDim}`,
                  marginBottom: 14,
                  font: '400 10.5px/1.4 var(--font-mono)',
                  letterSpacing: 0.4,
                }}>
                  <span>
                    <span style={{ color: t.amberDim, letterSpacing: 1.2 }}>REVIEWS</span>
                    <span style={{
                      marginLeft: 6, fontWeight: 500,
                      color: (intel.lamps.reviews && intel.lamps.reviews.tone) === 'bad' ? t.red
                           : (intel.lamps.reviews && intel.lamps.reviews.tone) === 'good' ? t.phosphor
                           : (intel.lamps.reviews && intel.lamps.reviews.tone) === 'mid' ? t.amber
                           : t.bone,
                    }}>{(intel.lamps.reviews && intel.lamps.reviews.state) || 'UNK'}</span>
                    {intel.lamps.reviews && intel.lamps.reviews.sub && (
                      <span style={{ marginLeft: 6, color: t.mutedDim }}>· {intel.lamps.reviews.sub}</span>
                    )}
                  </span>
                  <span style={{ color: t.mutedDim }}>│</span>
                  <span>
                    <span style={{ color: t.amberDim, letterSpacing: 1.2 }}>INDUSTRY</span>
                    <span style={{ color: t.bone, marginLeft: 6, fontWeight: 500 }}>
                      {(intel.lamps.industry && intel.lamps.industry.state) || (intel.industry || 'UNK').toUpperCase()}
                    </span>
                  </span>
                  <span style={{ color: t.mutedDim }}>│</span>
                  <span>
                    <span style={{ color: t.amberDim, letterSpacing: 1.2 }}>LOCATION</span>
                    <span style={{ color: t.bone, marginLeft: 6 }}>
                      {(intel.lamps.industry && intel.lamps.industry.sub) || lead.city || '—'}
                    </span>
                  </span>
                  <span style={{ color: t.mutedDim }}>│</span>
                  <span style={{ color: t.amberDim, letterSpacing: 1.2 }}>EMPLOYEES</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {EMP_BUCKETS.map(b => {
                      const active = b === extras.employees;
                      return (
                        <button key={b} style={{
                          font: '500 9px/1 var(--font-mono)', letterSpacing: 0.5,
                          padding: '5px 7px',
                          color: active ? t.bone : t.muted,
                          background: active ? `${t.amber}15` : 'transparent',
                          border: `1px solid ${active ? t.amberDim : t.lineDim}`,
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>{b}</button>
                      );
                    })}
                  </div>
                </div>

                {/* Metrics row removed — all fields are now covered by the 6 big lamps + small strip. */}

                {/* Opportunity 2-col */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr',
                  gap: 18, alignItems: 'flex-start',
                  padding: '14px 0 0',
                  borderTop: `1px solid ${t.lineDim}`,
                }}>
                  <div>
                    <div style={{
                      font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6,
                      color: t.red, textTransform: 'uppercase', marginBottom: 8,
                    }}>PAIN POINTS</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {intel.needs.map((n, i) => (
                        <li key={i} style={{
                          display: 'grid', gridTemplateColumns: '14px 1fr', gap: 8, alignItems: 'baseline',
                          font: '400 13px/1.45 var(--font-sans)', color: t.bone,
                        }}>
                          <span style={{ color: t.red, font: '500 11px/1 var(--font-mono)' }}>›</span>
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div style={{
                      font: '500 9px/1 var(--font-mono)', letterSpacing: 1.6,
                      color: t.phosphor, textTransform: 'uppercase', marginBottom: 8,
                    }}>WHAT TO PITCH</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {intel.solutions.map((s, i) => (
                        <li key={i} style={{
                          display: 'grid', gridTemplateColumns: '14px 1fr', gap: 8, alignItems: 'baseline',
                          font: '400 13px/1.45 var(--font-sans)', color: t.bone,
                        }}>
                          <span style={{ color: t.phosphor, font: '500 11px/1 var(--font-mono)' }}>›</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Employees moved into the metrics ledger above; standalone picker removed */}
              </div>
            );
          })()}

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {extras.people.map(p => (
              <PersonRow key={p.id} person={p} />
            ))}
            {extras.people.length === 0 && (
              <div style={{
                padding: 16, textAlign: 'center',
                border: `1px dashed ${t.lineDim}`,
                color: t.muted, font: '400 12px/1.4 var(--font-mono)', letterSpacing: 1,
              }}>NO PEOPLE YET — ADD A CONTACT</div>
            )}
          </div>

          {/* Address + identifiers (no section header — sits naturally after People) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <Field label="Strasse"><input defaultValue={extras.address.strasse} style={fieldInput(t)} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8 }}>
              <Field label="PLZ"><input defaultValue={extras.address.plz} style={fieldInput(t)} /></Field>
              <Field label="Ort"><input defaultValue={extras.address.ort} style={fieldInput(t)} /></Field>
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
                    ...fieldInput(t),
                    borderColor: uidRequired ? t.red + '70' : t.lineDim,
                    background: uidRequired ? `${t.red}06` : t.bgCard,
                  }} />}
            </Field>
          </div>

          {/* Private notes */}
          <Sec title="PRIVATE NOTES (you only — never sent)">
            <textarea
              rows={3}
              defaultValue={lead.comment}
              style={{
                width: '100%', background: t.bgCard, color: t.bone,
                border: `1px solid ${t.line}`, padding: 12,
                font: '400 13px/1.55 var(--font-sans)', resize: 'vertical',
              }}
            />
          </Sec>

          {/* Needs / Solutions removed — now absorbed into INTEL block above */}

          {/* Tags removed per user request */}
          </>)}

          {/* History — always visible, even in focus mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 12 }}>
            <L c={t.amberDim} sz={9}>HISTORY</L>
            <L c={t.mutedDim} sz={9}>· {D.history.length}</L>
            <span style={{ flex: 1 }} />
            <button style={{
              font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4,
              color: t.phosphor, background: `${t.phosphor}10`,
              border: `1px solid ${t.phosphor}60`,
              padding: '6px 10px', cursor: 'pointer',
            }}>● SEND WHATSAPP</button>
            <button style={{
              font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4,
              color: t.amber, background: 'transparent',
              border: `1px solid ${t.amberDim}`,
              padding: '6px 10px', cursor: 'pointer',
            }}>+ LOG ACTIVITY</button>
          </div>

          <div>
            {(() => {
              let lastDay = null;
              return D.history.map((h, i) => {
                const show = h.day !== lastDay;
                lastDay = h.day;
                return (
                  <React.Fragment key={i}>
                    {show && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: i === 0 ? '4px 0 10px' : '18px 0 10px' }}>
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
              });
            })()}
          </div>
        </div>

        {/* Footer snooze row */}
        <div style={{ borderTop: `1px solid ${t.line}`, padding: '10px 20px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <L c={t.mutedDim}>Snooze</L>
          <Btn sm>+1D</Btn>
          <Btn sm>+3D</Btn>
          <Btn sm>+1W</Btn>
          <span style={{ flex: 1 }} />
          <a href={`index.html#${lead.id}`} style={{
            font: '500 9px/1 var(--font-mono)', letterSpacing: 1.4,
            color: t.muted, textDecoration: 'none',
          }}>▸ Open in Overview</a>
          <Btn primary>MARK DONE</Btn>
        </div>
      </div>
    );
  }

  function iconBtn(t) {
    return {
      width: 26, height: 26,
      background: 'transparent', border: `1px solid ${t.lineDim}`,
      color: t.muted, cursor: 'pointer',
      font: '300 12px/1 var(--font-mono)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: 0,
      transition: 'color 0.12s, border-color 0.12s',
    };
  }

  function Field({ label, children }) {
    return (
      <div>
        <L c={t.muted} sz={9} ls={1.2} style={{ textTransform: 'none' }}>{label}</L>
        <div style={{ font: '400 13px/1.4 var(--font-sans)', color: t.bone, marginTop: 6 }}>{children}</div>
      </div>
    );
  }

  function fieldInput(t) {
    return {
      width: '100%',
      background: t.bgCard,
      border: `1px solid ${t.lineDim}`,
      color: t.bone,
      font: '400 13px/1.4 var(--font-sans)',
      padding: '7px 10px',
      outline: 'none',
    };
  }

  // Curated role list. The first group are "decisive" roles — picking any
  // of them lights up the amber rail / DM treatment on the person row.
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
      // Open new tab to confirm
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
          background: isDecisive ? `${t.amber}08` : t.bgCard,
          border: `1px solid ${isDecisive ? t.amberDim : t.lineDim}`,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {isDecisive && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: t.amber }} />}

        {/* Avatar — click to link LinkedIn; avatar swaps to LI icon when linked */}
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

        {/* Name + Title */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <InlineEditField defaultValue={person.name} placeholder="Full name" font="500 13px/1.2 var(--font-sans)" color={t.bone} />
          <InlineEditField defaultValue={person.title || ''} placeholder="Job title (e.g. CEO, Marketing Mgr)" font="400 11px/1.2 var(--font-sans)" color={t.muted} />
        </div>

        {/* Age + Notes */}
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

        {/* Phone + Email */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <InlineEditField defaultValue={person.phone || ''} placeholder="Phone" font="400 12px/1.2 var(--font-mono)" color={t.amber} />
          <InlineEditField defaultValue={person.email || ''} placeholder="Email" font="400 11px/1.2 var(--font-mono)" color={t.amber} />
        </div>

        {/* Role dropdown */}
        <div style={{ position: 'relative' }}>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            style={{
              width: '100%',
              font: '500 10px/1 var(--font-mono)', letterSpacing: 1.1,
              padding: '8px 22px 8px 10px',
              color: isDecisive ? t.amber : t.muted,
              background: isDecisive ? `${t.amber}15` : t.bgCard,
              border: `1px solid ${isDecisive ? t.amber : t.lineDim}`,
              cursor: 'pointer', textTransform: 'uppercase',
              appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
              outline: 'none',
            }}
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r.value} value={r.value} style={{ background: '#1a1612', color: t.bone, textTransform: 'none' }}>
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
          <button title="Call" style={miniIconBtn(t)}>
            <IconPhone size={12} color={t.muted} fill="none" />
          </button>
          <button title="Email" style={miniIconBtn(t)}>
            <IconEmail size={12} color={t.muted} fill="none" />
          </button>
          <button title="Remove person" style={{ ...miniIconBtn(t), color: t.muted }}>✕</button>
        </div>
      </div>
    );
  }

  // InlineEditField — looks like text by default, on hover gets a dotted
  // underline (affordance: "this is editable"), on focus turns into a real
  // input with a solid border. Avoids the "is this clickable?" ambiguity.
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

  // DOB field that auto-computes age on blur. Single input — no modal.
  //   - Focused: shows the date the user is typing (any format they like)
  //   - Blurred: parses, and if valid renders compactly as "52y" (still editable on click)
  //   - Invalid input is kept verbatim so the user doesn't lose what they typed
  function DobAgeField({ defaultValue, todayIso }) {
    const [value, setValue] = useState(defaultValue || '');
    const [focus, setFocus] = useState(false);
    const [hover, setHover] = useState(false);

    // Try to parse year from the value. Accept YYYY-MM-DD, DD.MM.YYYY, "52y",
    // or a bare year.
    function parseAge(v) {
      if (!v) return null;
      const m = v.trim().match(/^(\d{1,3})\s*y?$/i);
      if (m) {
        const a = parseInt(m[1], 10);
        if (a >= 0 && a < 130) return { age: a, dob: null };
      }
      // ISO YYYY-MM-DD
      let iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      // EU DD.MM.YYYY
      let eu = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      // EU DD/MM/YYYY
      let euSlash = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      let y, mo, d;
      if (iso)         { y = +iso[1]; mo = +iso[2]; d = +iso[3]; }
      else if (eu)     { d = +eu[1]; mo = +eu[2]; y = +eu[3]; }
      else if (euSlash){ d = +euSlash[1]; mo = +euSlash[2]; y = +euSlash[3]; }
      else return null;
      const dob = new Date(Date.UTC(y, mo - 1, d));
      if (Number.isNaN(dob.getTime())) return null;
      const now = new Date(todayIso + 'T12:00:00Z');
      let age = now.getUTCFullYear() - dob.getUTCFullYear();
      const mDiff = now.getUTCMonth() - dob.getUTCMonth();
      if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
      if (age < 0 || age > 130) return null;
      const isoStr = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      return { age, dob: isoStr };
    }

    const parsed = parseAge(value);
    // What we render when not focused
    const blurredText = parsed ? `${parsed.age}y` : (value || '');

    return (
      <input
        value={focus ? value : blurredText}
        onChange={e => setValue(e.target.value)}
        placeholder="DOB or age (e.g. 1973-04-12 or 52y)"
        title={parsed && parsed.dob ? `DOB ${parsed.dob}` : undefined}
        onFocus={() => { setFocus(true); /* expose raw on focus */ setValue(parsed && parsed.dob ? parsed.dob : value); }}
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

  function miniIconBtn(t) {
    return {
      width: 24, height: 24,
      background: 'transparent', border: `1px solid ${t.lineDim}`,
      color: t.muted, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: 0, font: '400 11px/1 var(--font-mono)',
    };
  }

  // ── Slide-over detail (kept as fallback for narrow viewports) ──────────
  function SlideOver({ lead, onClose, onUpdate }) {
    const [status, setStatus] = useState(lead.status);
    useEffect(() => setStatus(lead.status), [lead.id]);

    return (
      <>
        {/* Backdrop */}
        <div onClick={onClose} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
          zIndex: 50, animation: 'twipe 0.25s ease-out',
        }} />
        {/* Panel */}
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(560px, 90vw)',
          background: t.bgElev,
          borderLeft: `1px solid ${t.amberDim}`,
          boxShadow: '-20px 0 50px rgba(0,0,0,0.5)',
          zIndex: 51,
          display: 'flex', flexDirection: 'column',
          animation: 'tslidein 0.28s cubic-bezier(.2,.7,.3,1)',
        }}>
          {/* Header */}
          <div style={{ padding: '22px 24px 16px', borderBottom: `1px solid ${t.line}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <L c={t.amberDim}>{lead.id} · {D.STAGE[lead.stage].label}</L>
              <button onClick={onClose} style={{
                background: 'none', border: 'none', color: t.muted, cursor: 'pointer',
                font: '300 18px/1 var(--font-mono)',
              }}>✕</button>
            </div>
            <h2 style={{
              font: '500 24px/1.1 var(--font-sans)', color: t.bone, margin: '12px 0 0',
              letterSpacing: -0.4, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {lead.starred && <span style={{ color: t.amber, fontSize: 16 }}>★</span>}
              {lead.company}
            </h2>
            <div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', font: '400 13px/1 var(--font-sans)', color: t.muted }}>
              <span>{lead.contact}</span>
              <M c={t.amber} sz={12}>{lead.phone}</M>
              <M c={t.amber} sz={12}>{lead.email}</M>
            </div>
          </div>

          {/* Next move */}
          <div style={{ padding: '20px 24px', borderBottom: `1px solid ${t.lineDim}` }}>
            <L c={t.amberDim} sz={9}>NEXT MOVE</L>
            <div style={{ font: '500 18px/1.3 var(--font-sans)', color: t.bone, marginTop: 8, letterSpacing: -0.2 }}>
              {lead.note}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <Btn primary>EXECUTE</Btn>
              <Btn>SEND WHATSAPP</Btn>
              <Btn>LOG CALL</Btn>
            </div>
          </div>

          {/* Stage / status */}
          <div style={{ padding: '16px 24px', borderBottom: `1px solid ${t.lineDim}` }}>
            <L c={t.amberDim} sz={9} style={{ display: 'block', marginBottom: 8 }}>STAGE</L>
            <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
              {Object.entries(D.STAGE).map(([k, v]) => {
                const active = lead.stage === k;
                const c = STAGE_COLOR[k];
                return (
                  <button key={k} onClick={() => onUpdate(lead.id, { stage: k })} style={{
                    flex: 1,
                    font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2,
                    padding: '8px 4px',
                    color: active ? c : t.muted,
                    background: active ? `${c}15` : 'transparent',
                    border: `1px solid ${active ? c : t.lineDim}`,
                    cursor: 'pointer', textTransform: 'uppercase',
                  }}>{active && '● '}{v.label}</button>
                );
              })}
            </div>

            <L c={t.amberDim} sz={9} style={{ display: 'block', marginBottom: 8 }}>STATUS</L>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {['todo','standby','awaiting','won','lost'].map(s => {
                const active = s === status;
                const def = D.STATUS[s];
                const c = def.hue === 'phosphor' ? t.phosphor : def.hue === 'red' ? t.red : def.hue === 'cyan' ? t.amberHi : t.amber;
                return (
                  <button key={s} onClick={() => { setStatus(s); onUpdate(lead.id, { status: s }); }} style={{
                    font: '500 9px/1 var(--font-mono)', letterSpacing: 1.2,
                    padding: '7px 10px',
                    color: active ? c : t.muted,
                    background: 'transparent',
                    border: `1px solid ${active ? c : t.lineDim}`,
                    cursor: 'pointer', textTransform: 'uppercase',
                  }}>{active && '● '}{def.label}</button>
                );
              })}
            </div>
          </div>

          {/* Metrics */}
          <div style={{ padding: '18px 24px', borderBottom: `1px solid ${t.lineDim}`, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Met label="Value"  v={`CHF ${D.chf(lead.amount)}`} />
            <Met label="Prob."  v={`${Math.round(lead.prob * 100)}%`} accent />
            <Met label="Weight" v={`CHF ${D.chf(lead.amount * lead.prob)}`} />
            <Met label="Due"    v={lead.due} red={D.daysBetween(D.TODAY, lead.due) > 0} />
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto', padding: '18px 24px' }}>
            <Sec title="Comment">
              <p style={{ font: '400 13px/1.6 var(--font-sans)', color: t.bone, margin: 0 }}>{lead.comment}</p>
            </Sec>
            <Sec title="Tags">
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ font: '400 11px/1 var(--font-mono)', color: t.amber, border: `1px solid ${t.amberDim}`, padding: '5px 8px' }}>{lead.tag}</span>
                <button style={{ font: '400 11px/1 var(--font-mono)', color: t.muted, background: 'none', border: `1px dashed ${t.lineDim}`, padding: '5px 8px', cursor: 'pointer' }}>+ tag</button>
              </div>
            </Sec>
            <Sec title="Recent history · 3">
              {D.history.slice(0, 3).map((h, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 14, alignItems: 'baseline', padding: '8px 0', borderTop: i ? `1px solid ${t.lineDim}` : 'none' }}>
                  <M c={t.mutedDim} sz={10}>{h.t}</M>
                  <div style={{ font: '400 13px/1.4 var(--font-sans)', color: t.bone }}>
                    <span style={{ color: t.amber, fontFamily: 'var(--font-mono)', fontSize: 10, marginRight: 8, letterSpacing: 1, textTransform: 'uppercase' }}>{h.type}</span>
                    {h.text}
                  </div>
                </div>
              ))}
            </Sec>
            <a href={`index.html#${lead.id}`} style={{
              display: 'inline-block', marginTop: 10,
              font: '500 10px/1 var(--font-mono)', letterSpacing: 1.4,
              color: t.amber, textDecoration: 'none',
              padding: '8px 0', textTransform: 'uppercase',
            }}>▸ Open full detail in overview</a>
          </div>

          {/* Bottom snooze */}
          <div style={{ borderTop: `1px solid ${t.line}`, padding: '12px 24px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <L c={t.mutedDim}>Snooze</L>
            <Btn sm>+1D</Btn>
            <Btn sm>+3D</Btn>
            <Btn sm>+1W</Btn>
            <span style={{ flex: 1 }} />
            <Btn primary>MARK DONE</Btn>
          </div>
        </div>
      </>
    );
  }

  function Sec({ title, children }) {
    return (
      <div style={{ marginBottom: 18 }}>
        <L c={t.amberDim} sz={9} style={{ display: 'block', marginBottom: 10 }}>{title}</L>
        {children}
      </div>
    );
  }
  function Met({ label, v, accent, red }) {
    return (
      <div>
        <L c={t.muted} sz={9} ls={1.2} style={{ textTransform: 'none' }}>{label}</L>
        <div style={{ font: '400 16px/1.1 var(--font-mono)', color: red ? t.red : accent ? t.amber : t.bone, marginTop: 8, letterSpacing: -0.3 }}>{v}</div>
      </div>
    );
  }
  function Btn({ children, primary, sm, onClick }) {
    return (
      <button onClick={onClick} style={{
        font: `600 ${sm ? 9 : 10}px/1 var(--font-mono)`,
        letterSpacing: 1.4,
        padding: sm ? '7px 10px' : '9px 12px',
        background: primary ? t.amber : 'transparent',
        color: primary ? '#0a0805' : t.amber,
        border: `1px solid ${primary ? t.amber : t.amberDim}`,
        cursor: 'pointer', textTransform: 'uppercase',
      }}>{children}</button>
    );
  }

  // ── The Kanban view ────────────────────────────────────────────────────
  function Kanban() {
    const [leads, setLeads] = useState(D.leads);
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [draggingId, setDraggingId] = useState(null);
    const [dragOverStage, setDragOverStage] = useState(null);
    const [density, setDensity] = useState(() => {
      try { return localStorage.getItem('crm.kanban.density') || 'cozy'; }
      catch { return 'cozy'; }
    });
    useEffect(() => {
      try { localStorage.setItem('crm.kanban.density', density); } catch {}
    }, [density]);

    const filtered = useMemo(() => {
      if (!query.trim()) return leads;
      const q = query.toLowerCase();
      return leads.filter(l =>
        l.company.toLowerCase().includes(q) ||
        (l.contact || '').toLowerCase().includes(q) ||
        (l.tag || '').toLowerCase().includes(q) ||
        (l.city || '').toLowerCase().includes(q)
      );
    }, [leads, query]);

    const byStage = useMemo(() => {
      const m = { incoming: [], contacted: [], demo: [], closing: [] };
      filtered.forEach(l => { if (m[l.stage]) m[l.stage].push(l); });
      // Sort within column: overdue first, then by due asc
      Object.values(m).forEach(arr => arr.sort((a, b) => {
        const da = D.daysBetween(D.TODAY, a.due);
        const db = D.daysBetween(D.TODAY, b.due);
        return db - da;
      }));
      return m;
    }, [filtered]);

    const selected = leads.find(l => l.id === selectedId);

    const updateLead = (id, patch) => {
      setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
    };

    const onDrop = (stage, id) => {
      setLeads(prev => prev.map(l => l.id === id ? { ...l, stage } : l));
      setDraggingId(null);
      setDragOverStage(null);
    };

    const onAddLead = (stage, raw) => {
      // Quick parse: comma-separated Company, Name, Phone, Email
      const [company, contact = '—', phone = '—', email = '—'] = raw.split(',').map(s => s.trim());
      const newLead = {
        id: 'X' + Math.floor(Math.random() * 9000 + 1000),
        company, contact, channel: 'call',
        stage, stageStep: D.STAGE[stage].step, status: 'todo',
        amount: 0, prob: 0.25,
        due: D.TODAY,
        city: '—', tag: 'New', starred: false,
        note: 'Qualify and reach out.',
        email, phone,
        comment: 'Added via kanban inline.',
        heat: 0.2,
      };
      setLeads(prev => [newLead, ...prev]);
    };

    // Counters
    const total = leads.length;
    const totalPipe = leads.reduce((s, l) => s + l.amount, 0);
    const totalW    = leads.reduce((s, l) => s + l.amount * l.prob, 0);
    const overdueCount = leads.filter(l => D.daysBetween(D.TODAY, l.due) > 0 && l.status !== 'won' && l.status !== 'cancelled').length;

    // Compute layout cells outside JSX so React reliably picks up changes.
    const stageOrder = ['incoming','contacted','demo','closing'];
    const selStageIdx = selected ? stageOrder.indexOf(selected.stage) : -1;
    let detailStart = -1;
    if (selStageIdx >= 0) {
      detailStart = selStageIdx <= 2 ? selStageIdx : selStageIdx - 1;
    }
    const detailEnd = detailStart + 1;

    const cells = [];
    for (let i = 0; i < stageOrder.length; i++) {
      const stage = stageOrder[i];
      if (detailStart >= 0 && i === detailStart) {
        cells.push(
          <div key="inline-detail" style={{ gridColumn: 'span 2', minWidth: 0, minHeight: 0, height: '100%', display: 'flex' }}>
            <InlineDetail
              lead={selected}
              onClose={() => setSelectedId(null)}
              onUpdate={updateLead}
            />
          </div>
        );
        continue;
      }
      if (detailStart >= 0 && i === detailEnd) {
        continue;
      }
      cells.push(
        <Column
          key={stage}
          stage={stage}
          leads={byStage[stage]}
          allLeads={leads}
          density={density}
          dragOver={dragOverStage === stage}
          onDragOver={() => setDragOverStage(stage)}
          onDragLeave={() => setDragOverStage(prev => prev === stage ? null : prev)}
          onDrop={onDrop}
          draggingId={draggingId}
          onDragStart={setDraggingId}
          onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
          onCardClick={setSelectedId}
          selectedId={selectedId}
          onAddLead={onAddLead}
        />
      );
    }

    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: t.bg, color: t.bone,
        fontFamily: 'var(--font-sans)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Top bar */}
        <div style={{ padding: '14px 24px', borderBottom: `1px solid ${t.line}`, display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ font: '600 14px/1 var(--font-sans)', color: t.bone, letterSpacing: -0.3 }}>OskarOS</span>
            <L c={t.amberDim}>· Kanban</L>
          </div>

          {/* Nav tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginLeft: 14 }}>
            <NavLink href={(typeof location !== 'undefined' && location.pathname.includes('-light')) ? 'index-light.html' : 'index.html'}>Overview</NavLink>
            <NavLink current>Kanban</NavLink>
          </div>

          <span style={{ flex: 1 }} />

          {/* Quick stats */}
          <L c={t.mutedDim}>Pipeline</L> <M c={t.bone} sz={12}>CHF {D.chf(totalPipe)}</M>
          <L c={t.mutedDim}>Weighted</L> <M c={t.amber} sz={12}>CHF {D.chf(totalW)}</M>
          <L c={t.mutedDim}>·</L>
          <L c={overdueCount ? t.red : t.muted}>{overdueCount} overdue</L>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: t.amberDim }} />
          <ThemeToggle t={t} />
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: t.amberDim }} />
          <Clock />
        </div>

        {/* Sub-toolbar */}
        <div style={{ padding: '10px 24px', borderBottom: `1px solid ${t.lineDim}`, display: 'flex', alignItems: 'center', gap: 14 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search company, contact, tag, city…  ( / )"
            style={{
              background: t.bgElev, border: `1px solid ${t.lineDim}`,
              color: t.bone, font: '400 12px/1 var(--font-mono)',
              padding: '8px 12px', flex: 1, maxWidth: 380,
            }}
          />
          <L c={t.mutedDim}>· {filtered.length}/{total} leads</L>
          <span style={{ flex: 1 }} />
          <L c={t.mutedDim}>Density</L>
          <DensityToggle density={density} onChange={setDensity} />
        </div>

        {/* Stage transition strip */}
        <TransitionStrip leads={leads} />

        {/* 4 columns — or 3 (2 + inline detail spanning 2) when a lead is selected */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', minHeight: 0 }}>
          {cells}
        </div>
      </div>
    );
  }

  function DensityToggle({ density, onChange }) {
    const opts = [
      { key: 'compact', label: 'Compact', icon: (
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          <rect x="0" y="0" width="14" height="1.5" fill="currentColor" />
          <rect x="0" y="3" width="14" height="1.5" fill="currentColor" />
          <rect x="0" y="6" width="14" height="1.5" fill="currentColor" />
          <rect x="0" y="9" width="14" height="1.5" fill="currentColor" />
        </svg>
      )},
      { key: 'cozy', label: 'Cozy', icon: (
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          <rect x="0" y="0" width="14" height="3" fill="currentColor" />
          <rect x="0" y="5" width="14" height="3" fill="currentColor" />
        </svg>
      )},
      { key: 'comfortable', label: 'Comfortable', icon: (
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          <rect x="0" y="0" width="14" height="4" fill="currentColor" />
          <rect x="0" y="6" width="14" height="4" fill="currentColor" />
        </svg>
      )},
    ];
    return (
      <div style={{ display: 'inline-flex', border: `1px solid ${t.lineDim}` }}>
        {opts.map(o => {
          const active = density === o.key;
          return (
            <button
              key={o.key}
              title={o.label}
              onClick={() => onChange(o.key)}
              style={{
                padding: '6px 10px',
                background: active ? `${t.amber}15` : 'transparent',
                color: active ? t.amber : t.muted,
                border: 'none',
                borderRight: o.key === 'comfortable' ? 'none' : `1px solid ${t.lineDim}`,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                font: '500 9px/1 var(--font-mono)',
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                transition: 'color 0.12s, background 0.12s',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = t.amber; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = t.muted; }}
            >
              {o.icon}
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function NavLink({ children, current, href }) {
    return (
      <a href={href} onClick={current ? (e) => e.preventDefault() : undefined} style={{
        font: '500 11px/1 var(--font-mono)', letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: current ? t.amber : t.muted,
        textDecoration: 'none',
        padding: '8px 12px',
        background: current ? `${t.amber}10` : 'transparent',
        border: `1px solid ${current ? t.amberDim : 'transparent'}`,
        cursor: current ? 'default' : 'pointer',
        transition: 'color 0.15s, background 0.15s',
      }}>{children}</a>
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

  window.Kanban = Kanban;
})();
