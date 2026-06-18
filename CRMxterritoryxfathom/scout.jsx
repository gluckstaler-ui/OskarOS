// Scout — lead-research feed. Code queries each lead's site (AGE/STACK/PERF…),
// the Consular "tastes" it (PALATE + EXECUTION), and surfaces THE CHOICE the
// site makes + a VERDICT. Onyx + Polar via in-page toggle.

(function () {
  const { useState, useMemo } = React;

  // ── Themes ────────────────────────────────────────────────────────────────
  const THEMES = {
    onyx: {
      bg: '#100d09', bgElev: '#16130d', bgRow: '#2a2216', bgRowAlt: '#0c0a06',
      bgExpand: '#16130c', bgCard: '#1a160f', bgUnscouted: '#0a0806',
      line: '#2a2519', lineDim: '#1a160f',
      amber: '#ffb84a', amberHi: '#ffd07a', amberDim: '#8a6f3a',
      phosphor: '#9bd64a', red: '#ff6a4d', cyan: '#5cd6e0',
      bone: '#ece1c5', muted: '#8a7d62', mutedDim: '#5a4f3c', onAccent: '#0a0805',
      track: '#2a2519',
    },
    polar: {
      bg: '#ffffff', bgElev: '#efe6cf', bgRow: '#ece1c4', bgRowAlt: '#e6dab8',
      bgExpand: '#ede4c8', bgCard: '#f4eed9', bgUnscouted: '#ffffff',
      line: '#c9b88a', lineDim: '#e4dcc6',
      amber: '#cf7a14', amberHi: '#c0901a', amberDim: '#9a8254',
      phosphor: '#4f9a22', red: '#d62012', cyan: '#1f7888',
      bone: '#1a1408', muted: '#6a5c44', mutedDim: '#a99a7e', onAccent: '#ffffff',
      track: '#e4dcc6',
    },
  };
  // fix accidental token typo at runtime
  THEMES.polar.line = '#cdc0a0';

  // ── Scout data — synthetic CH psychotherapists ─────────────────────────────
  const LEADS = [
    { id:'L01', name:'Silvia Balsama', company:'Lernen & Entwickeln', cc:'CH', industry:'Psychotherapy',
      phone:"+41 78 914 06 02", email:'s.balsama@lernenundentwickeln.ch', web:'lernenundentwickeln.ch',
      status:'queried', palate:null, exec:null, choice:'visual taste pending', intel:4 },
    { id:'L02', name:'Charlotte Lattmann', company:'Kurswechsel', cc:'CH', industry:'Psychotherapy',
      phone:'+41 76 575 32 15', email:'lattmann@kurswechsel.ch', web:'charlottelattmann.com',
      status:'warm', palate:3, exec:2, gap:1,
      choice:'A macro dandelion-seed photograph as the hero — a letting-go metaphor rather than a clinical portrait or generic calm-person stock image', intel:4 },
    { id:'L03', name:'Jasmin Mostoufi Pour', company:'Psychologie am See', cc:'CH', industry:'Psychotherapy',
      phone:null, email:'mostoufi@psychologie-am-see.ch', web:'psychologie-am-see.ch',
      status:'warm', palate:3, exec:2, gap:1,
      choice:'A wide atmospheric lake photograph — Lake Zürich at golden hour, calm water, distant mountain silhouette, muted pinks and blues — chosen as the full-bleed hero. Geographic and emotional, not stock.', intel:3 },
    { id:'L04', name:'Sophie Christen', company:null, cc:'CH', industry:'Psychotherapy',
      phone:'+41 79 913 22 11', email:'sophie.christen@psychologie.ch', web:null,
      status:'greenfield' },
    { id:'L05', name:'Frauke Rösch', company:null, cc:'CH', industry:'Psychotherapy',
      phone:'+41 76 756 88 45', email:'psychotherapie-roesch@hin.ch', web:null,
      status:'greenfield' },
    { id:'L06', name:'Helena Rickenbacher', company:'Psychotherapeutische Praxis für Kinder & Jugendliche', cc:'CH', industry:'Psychotherapy',
      phone:'+41 76 344 31 33', email:'helena.rickenbacher@fsp-hin.ch', web:'praxis-helenarickenbacher.ch',
      status:'warm', palate:2, exec:1, gap:1,
      choice:'Three floating circles in muted teal and greige arranged around the circular portrait — the one compositional decision on the page', intel:4 },
    { id:'L07', name:'Karin Kahlenberg-Fehr', company:null, cc:'CH', industry:'Psychotherapy',
      phone:'+41 79 668 18 43', email:'k.kahlenberg@hin.ch', web:null,
      status:'greenfield' },
    { id:'L08', name:'Barbara Bot', company:'Praxis für Psychotherapie und Paarberatung', cc:'CH', industry:'Psychotherapy',
      phone:'+41 44 781 19 91', email:null, web:'barbarabot.ch',
      status:'warm', palate:3, exec:2, gap:1,
      choice:'Abstract organic wave forms in terracotta and sage as the entire hero — zero photography, zero stock, no hands, no candles, nothing the category defaults to', intel:4,
      expanded:true,
      detail:{
        age:'—', stack:'WordPress', perf:'—', seo:'—', trackers:'GA4', booking:'— none',
        hosting:'Hostpoint · CH', traffic:'—', langs:'DE',
        sip1:'Sip 1 — does the maker have an eye, a point of view',
        sip2:'Sip 2 — does it hold below the fold, or break',
        gapNote:'palate − execution → heat band (auto)',
        photos:'No photography at all — abstract wave forms only. The entire hero is art-directed shape and colour; the non-choice of imagery is the choice, and the inner pages abandon it entirely.',
        photosTag:'art-directed vs stock', photosDot:'red',
        verdict:"The rejection of therapy-stock clichés is a real call, but the site can't hold it — inner pages strip to bare WordPress and the wave motif shrinks to a corner ornament.",
      } },
    { id:'L09', name:'Tanja Theiler-Schiesser', company:'Psychotherapie Theiler', cc:'CH', industry:'Psychotherapy',
      phone:'+41 43 305 70 76', email:'tanja.theiler@icloud.com', web:'psychotherapie-theiler.ch',
      status:'warm', palate:2, exec:1, gap:1,
      choice:'A real portrait of Tanja herself — warm, colorful, with soft painterly tones — chosen over the clinical stock headshot or empty-office imagery that fills every other Swiss therapist site.', intel:3 },
    { id:'L10', name:'Annegret Siegenthaler', company:'Praxis Ich', cc:'CH', industry:'Psychotherapy',
      phone:'+41 78 811 81 42', email:'annegret.siegenthaler@psychologie.ch', web:'praxisich.ch',
      status:'warm', palate:3, exec:2, gap:1,
      choice:'An orange gestural abstract painting hung on a white wall — used as the hero image instead of the expected calm stock face or plant', intel:4 },
    { id:'L11', name:'Manuel Zeberli', company:'Praxis Indivita', cc:'CH', industry:'Psychotherapy',
      phone:'+41 78 264 82 64', email:'mzeberli@fsp-hin.ch', web:'praxis-indivita.ch',
      status:'hot', palate:3, exec:2, gap:1,
      choice:'A sweeping desert rock arch as the hero image — warm terracotta, cinematic scale, geological drama — chosen instead of the default hands-folded-on-couch therapy stock photo', intel:4 },
    { id:'L12', name:'Gabriela Frischknecht', company:null, cc:'CH', industry:'Psychotherapy',
      phone:'+41 43 466 83 90', email:'gabriela.frischknecht@psychologie.ch', web:null,
      status:'greenfield' },
  ];

  const STATUS = {
    queried:    { label:'Queried',  toneKey:'muted',    sign:'—'  },
    warm:       { label:'Warm',     toneKey:'amber',    sign:'+1' },
    hot:        { label:'Hot',      toneKey:'red',      sign:'+1' },
    cold:       { label:'Cold',     toneKey:'cyan',     sign:'-1' },
    greenfield: { label:'pursue',   toneKey:'phosphor', sign:'↑'  },
  };

  // ── Atoms ──────────────────────────────────────────────────────────────────
  function Mono({ children, c, sz=11, w=400, ls=0, style }) {
    return <span style={{ font:`${w} ${sz}px/1 var(--font-mono)`, letterSpacing:ls, color:c, ...style }}>{children}</span>;
  }
  function Lbl({ children, c, sz=9, ls=1.4, style }) {
    return <span style={{ font:`500 ${sz}px/1 var(--font-mono)`, letterSpacing:ls, textTransform:'uppercase', color:c, ...style }}>{children}</span>;
  }

  // Score bar: 5 segments, `val` filled, colored by score
  function ScoreBar({ val, total=5, t }) {
    const c = val == null ? t.mutedDim : val >= 4 ? t.phosphor : val >= 3 ? t.amber : val >= 2 ? t.amberHi : t.red;
    return (
      <span style={{ display:'inline-flex', gap:3, alignItems:'center' }}>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} style={{ width:7, height:14, background: i < (val||0) ? c : 'transparent', border:`1px solid ${i < (val||0) ? c : t.mutedDim}` }} />
        ))}
        <Mono c={val == null ? t.mutedDim : t.bone} sz={12} style={{ marginLeft:6 }}>{val == null ? '–' : val}/{total}</Mono>
      </span>
    );
  }

  // Intel dots: 5 dots, `n` lit
  function IntelDots({ n=0, t }) {
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
        <span style={{ display:'inline-flex', gap:4 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} style={{ width:5, height:5, borderRadius:'50%', background: i < n ? t.amber : 'transparent', border:`1px solid ${i < n ? t.amber : t.mutedDim}` }} />
          ))}
        </span>
        <Lbl c={t.mutedDim} sz={8}>INTEL</Lbl>
      </span>
    );
  }

  function StatusBadge({ status, gap, t }) {
    const s = STATUS[status];
    const c = s.toneKey === 'amber' ? t.amber : s.toneKey === 'red' ? t.red : s.toneKey === 'phosphor' ? t.phosphor : s.toneKey === 'cyan' ? t.cyan : t.muted;
    if (status === 'greenfield') {
      return <span style={{ display:'inline-flex', alignItems:'center', gap:5, font:'500 12px/1 var(--font-sans)', color:c }}>{s.label} <span style={{ fontSize:11 }}>↑</span></span>;
    }
    if (status === 'queried') {
      return <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}><span style={{ width:6, height:6, borderRadius:'50%', border:`1px solid ${t.muted}` }} /><Lbl c={t.muted} sz={10}>{s.label}</Lbl></span>;
    }
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
        <span style={{ font:'600 12px/1 var(--font-mono)', letterSpacing:1, color:c, background:`${c}1c`, border:`1px solid ${c}55`, padding:'6px 10px', textTransform:'uppercase' }}>{s.label}</span>
        <Mono c={c} sz={14} w={600}>{gap ? `+${gap}` : s.sign}</Mono>
      </span>
    );
  }

  // contact strip (phone · email · address · website)
  function Contact({ lead, t }) {
    const dim = t.mutedDim, link = t.amber;
    const dot = <span style={{ color:dim, margin:'0 8px' }}>·</span>;
    return (
      <div style={{ display:'flex', alignItems:'center', font:'400 12px/1 var(--font-mono)', color:t.muted, whiteSpace:'nowrap' }}>
        <span>☎ {lead.phone || '—'}</span>{dot}
        <span>✉ {lead.email || '—'}</span>{dot}
        <span>⌂ —</span>{dot}
        {lead.web
          ? <span style={{ color:link }}>↗ {lead.web}</span>
          : <span style={{ color:'#9b7fd6', background:'#9b7fd61c', border:'1px solid #9b7fd655', padding:'3px 7px', font:'500 9px/1 var(--font-mono)', letterSpacing:1 }}>KEINE WEBSITE</span>}
      </div>
    );
  }

  // ── Small query lamp (AGE / STACK / ...) ───────────────────────────────────
  function QLamp({ label, value, side, t }) {
    return (
      <div style={{ display:'grid', gridTemplateColumns:'14px 1fr', columnGap:8, alignItems:'start' }}>
        <span style={{ width:6, height:6, borderRadius:'50%', background: value && value !== '—' && value !== '— none' ? t.amber : 'transparent', border:`1px solid ${value && value !== '—' ? t.amber : t.mutedDim}`, marginTop:3 }} />
        <div>
          <Lbl c={t.mutedDim} sz={8.5}>{label}</Lbl>
          <div style={{ font:'400 12px/1.3 var(--font-mono)', color: value === '—' || !value ? t.mutedDim : t.bone, marginTop:4 }}>{value || '—'}</div>
        </div>
      </div>
    );
  }

  // Synthesize a detail block for leads that don't carry a hand-authored one,
  // so every row can expand. Stable per-lead via id hash.
  function deriveDetail(lead) {
    if (lead.detail) return lead.detail;
    const seed = lead.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const STACKS = ['WordPress', 'Wix', 'Squarespace', 'Jimdo', 'Webflow', 'Custom HTML'];
    const HOSTS = ['Hostpoint · CH', 'Cyon · CH', 'Infomaniak · CH', 'Hostpoint · CH', 'Wix CDN'];
    const stack = STACKS[seed % STACKS.length];
    return {
      age: ['2019', '2021', '2016', '—'][seed % 4],
      stack, perf: '—', seo: '—',
      trackers: ['GA4', '— none', 'Meta Pixel'][seed % 3],
      booking: ['— none', 'Calendly', '— none'][seed % 3],
      hosting: HOSTS[seed % HOSTS.length], traffic: '—',
      langs: ['DE', 'DE/EN', 'DE/FR'][seed % 3],
      sip1: 'Sip 1 — does the maker have an eye, a point of view',
      sip2: 'Sip 2 — does it hold below the fold, or break',
      gapNote: 'palate − execution → heat band (auto)',
      photosDot: 'amber',
      photosTag: lead.palate >= 3 ? 'art-directed vs stock' : 'category-default imagery',
      photos: lead.choice
        ? `The hero makes a deliberate call — ${lead.choice.charAt(0).toLowerCase() + lead.choice.slice(1)}`
        : 'No hero decision detected on the page yet.',
      address: ['Vordere Hauptgasse 2, 4800 Zofingen','Bahnhofstrasse 14, 8001 Zürich','Seestrasse 9, 6900 Lugano','Rue du Rhône 3, 1204 Genève','—'][seed % 5],
      verdict: lead.palate >= 3
        ? 'A genuine point of view in the hero, but execution thins out below the fold — the idea outpaces the build.'
        : 'The page reaches for a clean look but settles for category defaults; little to displace, much to improve.',
    };
  }

  // Greenfield expand — no site to query, so the panel is a brief.
  function GreenfieldDetail({ lead, t }) {
    return (
      <div style={{ background:'transparent', borderTop:`1px solid ${t.line}`, padding:'22px 26px 26px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:'18px 28px', alignItems:'start' }}>
          <div><Lbl c={t.mutedDim} sz={8.5}>NAME</Lbl><div style={{ font:'400 13px/1.4 var(--font-sans)', color:t.bone, marginTop:6 }}>{lead.name}</div></div>
          <div><Lbl c={t.mutedDim} sz={8.5}>EMAIL</Lbl><div style={{ font:'400 13px/1.4 var(--font-sans)', color:t.bone, marginTop:6 }}>{lead.email || '—'}</div></div>
          <div><Lbl c={t.mutedDim} sz={8.5}>PHONE</Lbl><div style={{ font:'400 13px/1.4 var(--font-mono)', color:t.amber, marginTop:6 }}>{lead.phone || '—'}</div></div>
          <button style={{ font:'500 11px/1 var(--font-mono)', letterSpacing:0.5, color:t.muted, background:'transparent', border:`1px solid ${t.line}`, padding:'9px 13px', cursor:'pointer', whiteSpace:'nowrap' }}>↺ Re-Taste (un-scout)</button>
        </div>
        <div style={{ marginTop:22, padding:'16px 18px', background:`${t.phosphor}12`, border:`1px solid ${t.phosphor}40`, borderLeft:`2px solid ${t.phosphor}` }}>
          <Lbl c={t.phosphor} sz={9}>◇ GREENFIELD · NO WEB PRESENCE</Lbl>
          <p style={{ font:'400 14px/1.6 var(--font-sans)', color:t.bone, margin:'10px 0 0' }}>
            Nothing to displace — you set the first impression. No incumbent site, no aesthetic to beat, no agency relationship to unseat. The pitch is the page itself.
          </p>
          <div style={{ marginTop:12, display:'flex', gap:8 }}>
            <span style={{ font:'600 9px/1 var(--font-mono)', letterSpacing:1.4, color:t.onAccent, background:t.phosphor, padding:'7px 11px', textTransform:'uppercase', cursor:'pointer' }}>▶ Draft first contact</span>
            <span style={{ font:'600 9px/1 var(--font-mono)', letterSpacing:1.4, color:t.phosphor, border:`1px solid ${t.phosphor}55`, padding:'7px 11px', textTransform:'uppercase', cursor:'pointer' }}>Mock a hero</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Expanded detail panel ──────────────────────────────────────────────────
  function Detail({ lead, t }) {
    const d = deriveDetail(lead);
    const sid = lead.id.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
    const perf = 40 + (sid*7)%58, seo = 35 + (sid*13)%62, traffic = 30 + (sid*5)%68;
    const F = ({ label, value, accent, italic }) => (
      <div>
        <Lbl c={t.mutedDim} sz={8.5}>{label}</Lbl>
        <div style={{ font:`400 13px/1.4 ${accent ? 'var(--font-mono)' : 'var(--font-sans)'}`, fontStyle: italic ? 'italic' : 'normal', color: value && value !== '—' ? (accent ? t.amber : t.bone) : t.mutedDim, marginTop:6 }}>{value || '—'}</div>
      </div>
    );
    return (
      <div style={{ background:'transparent', borderTop:`2px solid ${t.amber}`, paddingBottom:24 }}>
        {/* field grid — restored */}
        <div style={{ position:'relative', padding:'18px 24px', borderBottom:`1px solid ${t.line}` }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'16px 28px', paddingRight:170 }}>
            <F label="COMPANY" value={lead.company || '(unnamed)'} />
            <F label="NAME" value={lead.name} />
            <F label="WEBSITE" value={lead.web ? `↗ ${lead.web}` : '—'} accent />
            <F label="PHONE" value={lead.phone} accent />
            <F label="EMAIL" value={lead.email} />
            <F label="COUNTRY" value={lead.cc} />
            <F label="INDUSTRY" value={lead.industry} />
            <F label="ADDRESS" value={d.address} italic />
          </div>
          <button style={{ position:'absolute', top:18, right:24, font:'500 10px/1 var(--font-mono)', letterSpacing:0.5, color:t.muted, background:'transparent', border:`1px solid ${t.line}`, padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }}>↺ Re-Taste (un-scout)</button>
        </div>

        {/* 01 EVIDENCE (left, screenshots) + right column: 02 QUERIED over 03 TASTED */}
        <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', alignItems:'stretch' }}>
          {/* 01 EVIDENCE */}
          <div>
            <ZoneHead n="01" title="EVIDENCE" sub={lead.web || 'no site — greenfield'} t={t} />
            <div style={{ padding:'0 0 4px 24px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, height:340 }}>
                {['HOME','INNER'].map((k) => (
                  <div key={k} style={{ background:t.bgCard, border:`1px solid ${t.line}`, position:'relative', overflow:'hidden' }}>
                    <div style={{ position:'absolute', inset:0, background:`linear-gradient(135deg, ${t.amber}26, ${t.phosphor}1c 50%, ${t.cyan}18)` }} />
                    <div style={{ position:'absolute', left:18, top:20, right:18 }}>
                      <div style={{ font:'700 17px/1.2 var(--font-sans)', color:t.bone }}>{lead.name}</div>
                      <div style={{ font:'400 10px/1.4 var(--font-sans)', color:t.muted, marginTop:5 }}>{lead.company || lead.industry}</div>
                      <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:7 }}>
                        {[90,74,82,58].map((w,i) => <span key={i} style={{ height:5, width:`${w}%`, background:t.line, opacity:0.7 }} />)}
                      </div>
                    </div>
                    <div style={{ position:'absolute', right:11, bottom:9, font:'500 9px/1 var(--font-mono)', letterSpacing:1, color:t.mutedDim, textTransform:'uppercase' }}>{k}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN — 02 QUERIED stacked over 03 TASTED */}
          <div style={{ borderLeft:`1px solid ${t.line}`, marginLeft:24, display:'flex', flexDirection:'column' }}>
            {/* 02 QUERIED — indicator grid, cell tinted by state */}
            <ZoneHead n="02" title="QUERIED" sub="code fetches · click any value to override" t={t} pad="18px 24px 12px" />
            <div style={{ margin:'0 24px', background:t.bgCard, border:`1px solid ${t.line}` }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)' }}>
                {[['AGE',d.age],['STACK',d.stack],['HOSTING',d.hosting],['LANGS',d.langs],['BOOKING',d.booking],['TRACKERS',d.trackers]].map(([lab,val],i) => (
                  <IndCell key={lab} label={lab} value={val} last={(i+1)%3===0} t={t} />
                ))}
              </div>
            </div>

            {/* 03 TASTED — choice / photos / verdict only */}
            <ZoneHead n="03" title="TASTED" sub="Consular's read" t={t} pad="18px 24px 12px" />
            <div style={{ padding:'0 24px', display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <Lbl c={t.mutedDim} sz={9}>THE CHOICE</Lbl>
                <div style={{ font:'400 13px/1.55 var(--font-sans)', color:t.bone, fontStyle:'italic', marginTop:7 }}>"{lead.choice}"</div>
              </div>
              {/* PHOTOS — tinted block, no wasted dot row */}
              <div style={{ background:`${d.photosDot==='red'?t.red:t.amber}14`, borderLeft:`2px solid ${d.photosDot==='red'?t.red:t.amber}`, padding:'10px 12px' }}>
                <Lbl c={d.photosDot==='red'?t.red:t.amber} sz={8.5}>PHOTOS · {d.photosTag}</Lbl>
                <p style={{ font:'400 12.5px/1.55 var(--font-sans)', color:t.bone, margin:'7px 0 0' }}>{d.photos}</p>
              </div>
              <div>
                <Lbl c={t.mutedDim} sz={9}>VERDICT</Lbl>
                <div style={{ font:'400 13px/1.6 var(--font-sans)', color:t.bone, marginTop:7 }}>{d.verdict}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  function ZoneHead({ n, title, sub, t, pad }) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:12, padding: pad || '18px 24px 12px' }}>
        <span style={{ font:'500 11px/1 var(--font-mono)', letterSpacing:1, color:t.amber }}>{n} /</span>
        <span style={{ font:'600 12px/1 var(--font-sans)', letterSpacing:0.5, color:t.bone, textTransform:'uppercase' }}>{title}</span>
        <Lbl c={t.mutedDim} sz={9}>{sub}</Lbl>
        <span style={{ flex:1, height:1, background:t.line, marginLeft:4 }} />
      </div>
    );
  }

  function scoreTier(n, kind, t) {
    const c = n >= 90 ? t.phosphor : n >= 70 ? t.amberHi : n >= 50 ? t.amber : t.red;
    const words = { perf:['poor','slow','ok','fast'], seo:['poor','low','ok','clean'], traffic:['flat','low','ok','high'] };
    const wi = n >= 90 ? 3 : n >= 70 ? 2 : n >= 50 ? 1 : 0;
    return { c, word: (words[kind] || words.perf)[wi] };
  }

  function scoresFor(lead) {
    const sid = lead.id.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
    return { perf: 40 + (sid*7)%58, seo: 35 + (sid*13)%62, traffic: 30 + (sid*5)%68 };
  }

  // Score lamp matching PALATE/EXEC: label, then 4 segment bars (empty outlined) + number.
  function MiniScore({ label, num, kind, t }) {
    const { c } = scoreTier(num, kind, t);
    const filled = Math.max(1, Math.round((num / 100) * 4));
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        <span style={{ font:'500 8px/1 var(--font-mono)', letterSpacing:1.2, color:t.mutedDim, textTransform:'uppercase' }}>{label}</span>
        <span style={{ display:'inline-flex', gap:3, alignItems:'center' }}>
          {Array.from({ length:4 }).map((_,i) => (
            <span key={i} style={{ width:7, height:14, background: i < filled ? c : 'transparent', border:`1px solid ${i < filled ? c : t.mutedDim}` }} />
          ))}
          <Mono c={c} sz={13} style={{ marginLeft:6, fontWeight:700 }}>{num}</Mono>
        </span>
      </div>
    );
  }

  function ScoreMeter({ label, num, kind, t }) {
    const { c, word } = scoreTier(num, kind, t);
    const [hover, setHover] = useState(false);
    return (
      <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
        style={{ width:150, padding:'12px 18px', borderRight:`1px solid ${t.lineDim}`, cursor:'pointer', background: hover ? `${c}12` : 'transparent', transition:'background 0.12s' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
          <Lbl c={t.muted} sz={9} ls={1.4}>{label}</Lbl>
          <Mono c={t.mutedDim} sz={9}>{word}</Mono>
        </div>
        <div style={{ display:'flex', alignItems:'baseline', gap:4, marginTop:7 }}>
          <span style={{ font:'700 24px/1 var(--font-mono)', color:c, letterSpacing:-1 }}>{num}</span>
          <span style={{ font:'400 10px/1 var(--font-mono)', color:t.mutedDim }}>/100</span>
        </div>
        <div style={{ position:'relative', height:5, marginTop:9, background:`${t.mutedDim}33` }}>
          <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${num}%`, background:c, boxShadow:`0 0 5px ${c}88` }} />
        </div>
      </div>
    );
  }

  // Classify an indicator value → one of 5 tones for the whole-cell background.
  // red = bad-for-them/dead · amber = dated · phosphor = modern/strong ·
  // cyan = neutral-fact · grey = none/unknown.
  function indTone(label, value, t) {
    const v = (value || '').toLowerCase().trim();
    if (!v || v === '—' || /^—?\s*none/.test(v)) return { bg: t.mutedDim, key:'grey' };
    if (label === 'AGE') {
      const yr = parseInt(v.replace(/[^0-9]/g,''), 10);
      if (!yr) return { bg: t.mutedDim, key:'grey' };
      if (yr <= 2017) return { bg: t.red, key:'red' };
      if (yr <= 2021) return { bg: t.amber, key:'amber' };
      return { bg: t.phosphor, key:'phosphor' };
    }
    if (label === 'STACK') {
      if (/wix|jimdo|squarespace|weebly/.test(v)) return { bg: t.red, key:'red' };
      if (/wordpress|joomla|drupal|typo3/.test(v)) return { bg: t.amber, key:'amber' };
      if (/webflow|next|react|vue|astro|svelte|framer/.test(v)) return { bg: t.phosphor, key:'phosphor' };
      return { bg: t.cyan, key:'cyan' };
    }
    if (label === 'HOSTING') {
      if (/hostpoint|cyon|infomaniak|swiss|nine\.ch/.test(v)) return { bg: t.phosphor, key:'phosphor' };
      if (/vercel|netlify|cloudflare|aws|as\d/.test(v)) return { bg: t.cyan, key:'cyan' };
      return { bg: t.cyan, key:'cyan' };
    }
    if (label === 'TRACKERS') {
      if (/ga4|google|meta|pixel|gtm/.test(v)) return { bg: t.phosphor, key:'phosphor' };
      return { bg: t.cyan, key:'cyan' };
    }
    if (label === 'BOOKING') {
      if (/calendly|treatwell|cal\.com|acuity/.test(v)) return { bg: t.phosphor, key:'phosphor' };
      return { bg: t.cyan, key:'cyan' };
    }
    // LANGS and any other fact → neutral cyan
    return { bg: t.cyan, key:'cyan' };
  }

  function IndCell({ label, value, last, t }) {
    const [hover, setHover] = useState(false);
    const empty = !value || value === '—';
    const none = !empty && (/none/i.test(value) || value === '— none');
    const display = none ? 'none' : (value || '—');
    const tone = indTone(label, value, t);
    const isGrey = tone.key === 'grey';
    // Cleaner cell hues — avoid muddy alpha-over-black. Brighter, truer colors.
    const CELL = {
      red:      '#ff6a4d',
      amber:    '#ff9d2e',
      phosphor: '#5fc24a',
      cyan:     '#3fb6c4',
      grey:     t.mutedDim,
    };
    const cc = CELL[tone.key] || t.cyan;
    return (
      <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
        style={{ padding:'10px 13px 11px', borderRight: last ? 'none' : `1px solid ${t.line}`, borderBottom:`1px solid ${t.line}`,
          background: `${cc}${hover ? '40' : '2e'}`, cursor:'pointer', transition:'background 0.12s' }}>
        <span style={{ font:'500 8px/1 var(--font-mono)', letterSpacing:1, color: isGrey ? t.mutedDim : cc, textTransform:'uppercase', opacity:0.95 }}>{label}</span>
        <div style={{ marginTop:7 }}>
          <span style={{ font:'600 12px/1.3 var(--font-mono)', color: isGrey ? t.mutedDim : t.bone, fontStyle: none ? 'italic' : 'normal', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{display}</span>
        </div>
      </div>
    );
  }

  function HeroScore({ label, val, note, t }) {
    const c = val == null ? t.mutedDim : val >= 4 ? t.phosphor : val >= 3 ? t.amber : val >= 2 ? t.amberHi : t.red;
    return (
      <div style={{ minWidth:0 }}>
        <Lbl c={t.mutedDim} sz={9}>{label} /5</Lbl>
        <div style={{ display:'flex', alignItems:'baseline', gap:12, marginTop:8 }}>
          <span style={{ font:'300 40px/1 var(--font-mono)', color:c, letterSpacing:-2 }}>{val == null ? '–' : val}</span>
          <span style={{ display:'inline-flex', gap:3, alignItems:'flex-end' }}>
            {Array.from({ length:5 }).map((_,i) => <span key={i} style={{ width:7, height: 10+i*4, background: i < (val||0) ? c : t.track }} />)}
          </span>
        </div>
        <Mono c={t.mutedDim} sz={10} style={{ marginTop:10, display:'block', lineHeight:1.4, whiteSpace:'normal' }}>{note}</Mono>
      </div>
    );
  }
  function Inline({ label, value, accent, t }) {
    return (
      <span style={{ display:'inline-flex', alignItems:'baseline', gap:7 }}>
        <Lbl c={t.mutedDim} sz={8.5}>{label}</Lbl>
        <span style={{ font:`400 13px/1.3 ${accent?'var(--font-mono)':'var(--font-sans)'}`, color: value && value!=='—' ? (accent?t.amber:t.bone) : t.mutedDim }}>{value || '—'}</span>
      </span>
    );
  }

  function DRow({ label, children, t, align='center' }) {
    return (
      <div style={{ display:'grid', gridTemplateColumns:'110px 1fr', alignItems:align, gap:14, borderTop:`1px solid ${t.lineDim}`, paddingTop:12 }}>
        <Lbl c={t.mutedDim} sz={9}>{label}</Lbl>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>{children}</div>
      </div>
    );
  }

  function ScoreRow({ label, val, note, t }) {
    return (
      <div style={{ display:'grid', gridTemplateColumns:'120px 1fr', alignItems:'center', gap:14 }}>
        <Lbl c={t.mutedDim} sz={9}>{label}</Lbl>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <ScoreBar val={val} t={t} />
          <Mono c={t.mutedDim} sz={11} style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{note}</Mono>
        </div>
      </div>
    );
  }

  // ── Lead row ───────────────────────────────────────────────────────────────
  function Row({ lead, idx, t, expanded, onToggle }) {
    const greenfield = lead.status === 'greenfield';
    const notScouted = greenfield || lead.status === 'queried';
    const bg = expanded ? t.bgRow : (notScouted ? t.bgUnscouted : t.bgRow);
    return (
      <div style={{ background:bg, border:`1px solid ${t.lineDim}`, marginBottom:8 }}>
        {/* head line — name, region, profession all inline. Whole row toggles. */}
        <div onClick={onToggle} style={{ display:'grid', gridTemplateColumns:'22px 1fr auto 24px', alignItems:'center', gap:14, padding:'12px 16px 7px', cursor:'pointer' }}>
          <span onClick={e => e.stopPropagation()} style={{ width:15, height:15, border:`1px solid ${t.muted}`, borderRadius:3 }} />
          <div style={{ minWidth:0, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={{ font:'600 14px/1.2 var(--font-sans)', color:t.bone }}>{lead.name}</span>
            {lead.company && <span style={{ font:'400 13px/1.2 var(--font-sans)', color:t.muted }}>{lead.company}</span>}
            <span style={{ font:'500 9px/1 var(--font-mono)', letterSpacing:0.5, color:t.muted, border:`1px solid ${t.line}`, borderRadius:9, padding:'3px 7px' }}>{lead.cc}</span>
            <Mono c={t.mutedDim} sz={11}>{lead.industry}</Mono>
          </div>
          <Contact lead={lead} t={t} />
          <button onClick={onToggle} style={{ width:22, height:22, background:'transparent', border:`1px solid ${t.line}`, borderRadius:3, color:t.muted, cursor:'pointer', font:'400 10px/1 var(--font-mono)' }}>{expanded ? '˄' : '˅'}</button>
        </div>
        {/* status line */}
        <div style={{ display:'flex', alignItems:'flex-end', gap:16, padding:'0 16px 11px 52px' }}>
          <StatusBadge status={lead.status} gap={lead.gap} t={t} />
          {greenfield ? (
            <Mono c={t.muted} sz={12} style={{ fontFamily:'var(--font-sans)' }}>No web presence — nothing to displace, you set the first impression.</Mono>
          ) : (
            <>
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginLeft:24 }}>
                <span style={{ font:'500 8px/1 var(--font-mono)', letterSpacing:1.2, color:t.mutedDim, textTransform:'uppercase' }}>PALATE</span>
                <ScoreBar val={lead.palate} t={t} />
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <span style={{ font:'500 8px/1 var(--font-mono)', letterSpacing:1.2, color:t.mutedDim, textTransform:'uppercase' }}>EXEC</span>
                <ScoreBar val={lead.exec} t={t} />
              </div>
              <span style={{ flex:1, minWidth:0, font:'400 12.5px/1.4 var(--font-sans)', color: lead.status==='queried' ? t.mutedDim : t.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {lead.status==='queried' ? lead.choice : `"${lead.choice}"`}
              </span>
              {(() => { const sc = scoresFor(lead); return (
                <span style={{ display:'inline-flex', gap:26, flexShrink:0, paddingLeft:12 }}>
                  <MiniScore label="PERF" num={sc.perf} kind="perf" t={t} />
                  <MiniScore label="SEO" num={sc.seo} kind="seo" t={t} />
                  <MiniScore label="TRAFFIC" num={sc.traffic} kind="traffic" t={t} />
                </span>
              ); })()}
            </>
          )}
        </div>
        {expanded && (greenfield ? <GreenfieldDetail lead={lead} t={t} /> : <Detail lead={lead} t={t} />)}
      </div>
    );
  }

  // ── Top bar ────────────────────────────────────────────────────────────────
  function TopBar({ t, theme, setTheme }) {
    const Tab = ({ children, active }) => (
      <span style={{ font:'500 13px/1 var(--font-sans)', color: active ? t.bone : t.muted, padding:'7px 10px', background: active ? `${t.amber}1c` : 'transparent', border:`1px solid ${active ? t.amber+'55' : 'transparent'}`, borderRadius:6, cursor:'pointer' }}>{children}</span>
    );
    return (
      <div style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 22px', borderBottom:`1px solid ${t.line}`, background:t.bgElev }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:9 }}>
          <span style={{ width:26, height:26, borderRadius:7, background:t.phosphor, color:t.onAccent, font:'700 14px/26px var(--font-sans)', textAlign:'center' }}>O</span>
          <span><span style={{ font:'600 14px/1 var(--font-sans)', color:t.bone }}>OskarOS</span><br/><Lbl c={t.mutedDim} sz={8} style={{ marginTop:3, display:'inline-block' }}>Admin Dashboard</Lbl></span>
        </span>
        <span style={{ display:'flex', gap:2, marginLeft:14 }}>
          <Tab>Sessions</Tab><Tab>Kanban</Tab><Tab active>Scout</Tab><Tab>Overview</Tab><Tab>Analytics</Tab><Tab>Settings</Tab>
        </span>
        <span style={{ flex:1 }} />
        <span style={{ display:'inline-flex', alignItems:'center', gap:14, font:'500 11px/1 var(--font-mono)', color:t.muted, border:`1px solid ${t.line}`, borderRadius:8, padding:'7px 12px' }}>
          <span><span style={{ color:t.phosphor }}>$ 6.86</span> CLI</span>
          <span style={{ color:t.phosphor }}>● 22%</span>
          <span style={{ color:t.amber }}>223.4K/1.0M</span>
        </span>
        {/* ONYX / POLAR */}
        <div style={{ display:'inline-flex', border:`1px solid ${t.line}`, borderRadius:7, overflow:'hidden' }}>
          {['onyx','polar'].map(k => (
            <button key={k} onClick={() => setTheme(k)} style={{ font:'500 9px/1 var(--font-mono)', letterSpacing:1.2, padding:'7px 10px', textTransform:'uppercase', cursor: theme===k ? 'default':'pointer', color: theme===k ? t.amber : t.muted, background: theme===k ? `${t.amber}1c` : 'transparent', border:'none' }}>{k}</button>
          ))}
        </div>
        <span style={{ font:'500 11px/1 var(--font-mono)', color:t.red, border:`1px solid ${t.red}66`, borderRadius:6, padding:'7px 11px' }}>↯ ORDER 66 · 51%</span>
        <span style={{ font:'500 12px/1 var(--font-sans)', color:t.muted, cursor:'pointer' }}>Open App ↗</span>
      </div>
    );
  }

  // ── Screen ─────────────────────────────────────────────────────────────────
  function Scout() {
    const [theme, setTheme] = useState('onyx');
    const t = THEMES[theme];
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [openId, setOpenId] = useState('L08');

    const counts = useMemo(() => ({
      all: LEADS.length,
      hot: LEADS.filter(l => l.status==='hot').length,
      warm: LEADS.filter(l => l.status==='warm').length,
      cold: LEADS.filter(l => l.status==='cold').length,
      notScouted: LEADS.filter(l => l.status==='queried').length,
      greenfield: LEADS.filter(l => l.status==='greenfield').length,
    }), []);

    const rows = useMemo(() => {
      let r = LEADS;
      if (filter==='hot') r = r.filter(l => l.status==='hot');
      else if (filter==='warm') r = r.filter(l => l.status==='warm');
      else if (filter==='cold') r = r.filter(l => l.status==='cold');
      else if (filter==='notscouted') r = r.filter(l => l.status==='queried');
      else if (filter==='greenfield') r = r.filter(l => l.status==='greenfield');
      if (query.trim()) {
        const q = query.toLowerCase();
        r = r.filter(l => (l.name+' '+(l.company||'')).toLowerCase().includes(q));
      }
      return r;
    }, [filter, query]);

    const Pill = ({ id, label, n, tone }) => {
      const active = filter===id;
      const c = tone || t.muted;
      return (
        <button onClick={() => setFilter(id)} style={{
          display:'inline-flex', alignItems:'center', gap:6,
          font:'500 12px/1 var(--font-sans)', padding:'8px 12px',
          color: active ? t.bone : c,
          background: active ? `${t.amber}1c` : 'transparent',
          border:`1px solid ${active ? t.amber+'66' : t.line}`,
          borderRadius:8, cursor:'pointer',
        }}>{label}{n != null && <Mono c={active ? t.amber : t.mutedDim} sz={11}>{n}</Mono>}</button>
      );
    };

    return (
      <div style={{ position:'absolute', inset:0, background:t.bg, color:t.bone, fontFamily:'var(--font-sans)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <TopBar t={t} theme={theme} setTheme={setTheme} />

        {/* funnel strip */}
        <div style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 22px', borderBottom:`1px solid ${t.lineDim}` }}>
          <Pill2 t={t} label="268 in pool" />
          <Mono c={t.mutedDim} sz={13}>→</Mono>
          <Pill2 t={t} label="121 scouted" />
          <Mono c={t.mutedDim} sz={13}>·</Mono>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, font:'500 12px/1 var(--font-sans)', color:t.red, border:`1px solid ${t.red}55`, borderRadius:20, padding:'6px 12px' }}>🔥 5 hot</span>
          <Mono c={t.mutedDim} sz={13}>·</Mono>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, font:'500 12px/1 var(--font-sans)', color:'#9b7fd6', border:'1px solid #9b7fd655', borderRadius:20, padding:'6px 12px' }}>◇ 146 greenfield</span>
        </div>

        {/* search + filters */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 22px', borderBottom:`1px solid ${t.line}` }}>
          <div style={{ position:'relative', width:300 }}>
            <span style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', color:t.mutedDim, fontSize:12 }}>⌕</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search leads…" style={{ width:'100%', background:t.bgElev, border:`1px solid ${t.line}`, borderRadius:8, color:t.bone, font:'400 13px/1 var(--font-sans)', padding:'10px 12px 10px 30px', outline:'none' }} />
          </div>
          <Pill id="all" label="All" n={counts.all} />
          <Pill id="hot" label="🔥 Hot" n={counts.hot} tone={t.red} />
          <Pill id="warm" label="Warm" n={counts.warm} tone={t.amber} />
          <Pill id="cold" label="Cold" n={counts.cold} tone={t.cyan} />
          <Pill id="notscouted" label="Not scouted" n={counts.notScouted} />
          <Pill id="greenfield" label="Greenfield" n={counts.greenfield} tone={t.phosphor} />
          <span style={{ flex:1 }} />
          <button style={{ font:'600 11px/1 var(--font-mono)', letterSpacing:1, color:t.onAccent, background:t.red, border:'none', borderRadius:8, padding:'10px 14px', cursor:'pointer' }}>■ STOP (1 IN FLIGHT)</button>
        </div>

        {/* list */}
        <div style={{ flex:1, overflow:'auto', padding:'12px 22px 60px' }}>
          {rows.map((l, i) => (
            <Row key={l.id} lead={l} idx={i} t={t} expanded={openId===l.id} onToggle={() => setOpenId(openId===l.id ? null : l.id)} />
          ))}
        </div>
      </div>
    );
  }

  function Pill2({ label, t }) {
    return <span style={{ font:'500 12px/1 var(--font-mono)', letterSpacing:0.3, color:t.bone, border:`1px solid ${t.line}`, borderRadius:20, padding:'6px 12px' }}>{label}</span>;
  }

  window.Scout = Scout;
})();
