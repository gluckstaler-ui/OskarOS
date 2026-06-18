// Shared lead data + helpers used by all three variations.
// Original synthetic data — not from any real CRM.

window.CRMData = (function () {
  const TODAY = '2026-05-26';

  // Days between two ISO dates (a - b). Positive = a is later.
  const daysBetween = (a, b) => {
    const ms = new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z');
    return Math.round(ms / 86400000);
  };

  // Lead schema:
  //   id, company, contact, channel (call|email|meeting|whatsapp|walkin),
  //   stage (incoming|contacted|demo|closing), stageStep (1..4),
  //   status (todo|standby|awaiting|won|lost|cancelled),
  //   amount (CHF), prob (0..1), due (iso), city, tag, starred,
  //   note (short next-action), heat (0..1) for sparkline density,
  //   comment (long), unmatchedWhatsapp (bool)
  const leads = [
    { id: 'P008', company: 'Ristorante La Pergola', contact: 'Carlo Bianchi', channel: 'call', stage: 'contacted', stageStep: 2, status: 'todo', amount: 14200, prob: 0.60, due: '2026-05-21', city: 'Zürich', tag: 'Referral', starred: false, note: 'Follow up Monday — if no answer by Wed, mark Lost.', email: 'carlo@lapergola.ch', phone: '+41 79 901 23 45', comment: "Said decision was 'next week' four weeks ago. Following up Monday.", heat: 0.7 },
    { id: 'P009', company: 'Trattoria Da Luigi', contact: 'Luigi Bianchi', channel: 'call', stage: 'closing', stageStep: 4, status: 'awaiting', amount: 8600, prob: 0.90, due: '2026-05-22', city: 'Lugano', tag: 'Cold-call', starred: false, note: 'Contract sent. Chase signature.', email: 'luigi@daluigi.ch', phone: '+41 91 222 14 08', comment: 'Verbal yes on Wednesday. Waiting on signed PDF.', heat: 0.85 },
    { id: 'P010', company: 'Atelier Frau Weber', contact: 'Lisa Weber', channel: 'email', stage: 'closing', stageStep: 4, status: 'todo', amount: 24500, prob: 0.90, due: '2026-05-23', city: 'Zürich', tag: 'Inbound', starred: true, note: 'Send revised proposal v3.', email: 'lisa@atelier-weber.ch', phone: '+41 44 211 88 02', comment: 'Asked for two minor changes to scope on Friday.', heat: 0.9 },
    { id: 'P011', company: 'Restaurant Du Pont', contact: 'Pierre Dubois', channel: 'meeting', stage: 'demo', stageStep: 3, status: 'todo', amount: 19800, prob: 0.80, due: '2026-05-23', city: 'Genève', tag: 'Referral', starred: false, note: 'Demo follow-up. Send pricing.', email: 'pierre@dupont.ch', phone: '+41 22 311 02 17', comment: 'Demo went well. Decision-maker not in the room.', heat: 0.6 },
    { id: 'P012', company: 'Bistrot Le Petit', contact: 'François Martin', channel: 'call', stage: 'closing', stageStep: 4, status: 'awaiting', amount: 13200, prob: 0.95, due: '2026-05-23', city: 'Genève', tag: 'Referral', starred: false, note: 'Ready to sign. Confirm bank details.', email: 'fm@lepetit.ch', phone: '+41 22 555 09 33', comment: 'Will sign before end of week per call Thursday.', heat: 0.92 },
    { id: 'P013', company: 'Hotel Bellevue Lugano', contact: 'Andrea Conti', channel: 'meeting', stage: 'demo', stageStep: 3, status: 'todo', amount: 32600, prob: 0.75, due: '2026-05-24', city: 'Lugano', tag: 'Hotel · Tessin', starred: true, note: 'Schedule second demo with GM.', email: 'a.conti@bellevue-lugano.ch', phone: '+41 91 711 44 60', comment: 'GM was unavailable for first demo. High-value deal.', heat: 0.75 },
    { id: 'P014', company: 'Sportcenter Olimpia', contact: 'Roberto Greco', channel: 'call', stage: 'closing', stageStep: 4, status: 'todo', amount: 41200, prob: 0.85, due: '2026-05-24', city: 'Tessin', tag: 'Outbound', starred: false, note: 'Negotiation call at 14:00.', email: 'r.greco@olimpia-sport.ch', phone: '+41 91 233 87 41', comment: 'Asking for 10% discount; have authority to give 7%.', heat: 0.82 },
    { id: 'P015', company: 'Hairsalon Capelli', contact: 'Sofia Romano', channel: 'walkin', stage: 'contacted', stageStep: 2, status: 'standby', amount: 5200, prob: 0.55, due: '2026-05-24', city: 'Bellinzona', tag: 'Walk-in', starred: false, note: 'Quote sent. Awaiting reply.', email: 'sofia@capelli.ch', phone: '+41 91 825 41 09', comment: 'Walked in to office on Tuesday.', heat: 0.4, session: '2026-05-28-hairsalon-capelli' },
    { id: 'P016', company: 'Bar Olimpia', contact: 'Giuseppe Conti', channel: 'walkin', stage: 'incoming', stageStep: 1, status: 'todo', amount: 3600, prob: 0.35, due: '2026-05-24', city: 'Lugano', tag: 'Walk-in', starred: false, note: 'Qualify and call back.', email: 'g.conti@barolimpia.ch', phone: '+41 91 922 03 56', comment: 'Owner walked in asking about pricing.', heat: 0.3 },
    { id: 'P017', company: "Caffè Sant'Ambrogio", contact: 'Marco Rossi', channel: 'whatsapp', stage: 'incoming', stageStep: 1, status: 'todo', amount: 12400, prob: 0.45, due: '2026-05-25', city: 'Milano', tag: 'WhatsApp', starred: false, note: 'Reply to inbound WhatsApp.', email: 'marco@santambrogio.it', phone: '+39 02 887 41 22', comment: 'Inbound message: "Costi per 4 location?"', heat: 0.55, unmatchedWhatsapp: true },
    { id: 'P018', company: 'Filomax Wolf', contact: '—', channel: 'email', stage: 'incoming', stageStep: 1, status: 'todo', amount: 0, prob: 0.25, due: '2026-05-26', city: '—', tag: 'New', starred: false, note: 'Discovery call needed.', email: '—', phone: '—', comment: 'Cold lead from website form.', heat: 0.2 },
    { id: 'P019', company: 'Garage Rossi', contact: 'Mario Rossi', channel: 'call', stage: 'contacted', stageStep: 2, status: 'todo', amount: 22100, prob: 0.50, due: '2026-05-26', city: 'Lausanne', tag: 'Referral', starred: false, note: 'Send case study.', email: 'mario@garagerossi.ch', phone: '+41 21 311 09 22', comment: 'Wants references in same industry.', heat: 0.5 },
    { id: 'P020', company: 'Hotel Splendid', contact: 'Erika Vogel', channel: 'meeting', stage: 'incoming', stageStep: 1, status: 'todo', amount: 47800, prob: 0.55, due: '2026-05-26', city: 'St. Moritz', tag: 'Hotel', starred: true, note: 'Discovery call at 10:30 today.', email: 'e.vogel@splendid.ch', phone: '+41 81 833 17 04', comment: 'Booked discovery via website.', heat: 0.65 },
    { id: 'P021', company: 'Studio Dentistico Bianchi', contact: 'Anna Bianchi', channel: 'meeting', stage: 'incoming', stageStep: 1, status: 'todo', amount: 8200, prob: 0.40, due: '2026-05-27', city: 'Bern', tag: 'Inbound', starred: false, note: 'Confirm Wed meeting.', email: 'anna@dentistico-bianchi.ch', phone: '+41 31 822 14 18', comment: 'Scheduled discovery for next Wed.', heat: 0.45 },
    { id: 'P022', company: 'Alpha TEST 2026 AG', contact: '—', channel: 'email', stage: 'incoming', stageStep: 1, status: 'todo', amount: 0, prob: 0.25, due: '2026-05-24', city: 'Zürich', tag: 'New', starred: false, note: 'Initial qualification.', email: '—', phone: '—', comment: 'New inbound lead.', heat: 0.25 },
    { id: 'P023', company: 'Boulangerie Mercier', contact: 'Hugo Mercier', channel: 'whatsapp', stage: 'incoming', stageStep: 1, status: 'todo', amount: 4100, prob: 0.30, due: '2026-05-27', city: 'Genève', tag: 'WhatsApp', starred: false, note: 'Reply to WhatsApp inquiry.', email: 'hugo@mercier.ch', phone: '+41 22 731 09 18', comment: 'Asked "do you serve bakeries?"', heat: 0.3, unmatchedWhatsapp: true },
    { id: 'P024', company: 'Studio Verde Design', contact: 'Eva Müller', channel: 'whatsapp', stage: 'incoming', stageStep: 1, status: 'todo', amount: 6700, prob: 0.35, due: '2026-05-28', city: 'Basel', tag: 'WhatsApp', starred: false, note: 'Qualify.', email: 'eva@studioverde.ch', phone: '+41 61 322 41 80', comment: 'Replied to outbound campaign.', heat: 0.35, unmatchedWhatsapp: true },

    // ── Real-world prospects, hand-researched intel ───────────────────
    // CHF = our estimate of what WE could charge for the redesign.
    // prob = our estimate of closing the deal.
    { id: 'P025', company: 'Aequitas Studio', contact: 'Prof. Paolo Bernasconi', channel: 'email', stage: 'incoming', stageStep: 1, status: 'todo', amount: 32000, prob: 0.05, due: '2026-05-29', city: 'Lugano', tag: 'Cold-outbound', starred: false, note: 'Top-tier firm on modern site — nothing to fix.', email: 'info@aequitaslex.ch', phone: '+41 91 910 06 06', comment: 'Substantial Lugano law firm (10+ lawyers, 4 ex-public prosecutors, Prof. Bernasconi). Recently built Webflow site, multi-lingual, GDPR compliant. CHF 32k is the deal *if* they buy. They won\'t.', heat: 0.1, realIntel: 'aequitas' },
    { id: 'P026', company: 'Alba Bodenbäläge GmbH', contact: 'Familie Alba', channel: 'email', stage: 'incoming', stageStep: 1, status: 'todo', amount: 9500, prob: 0.32, due: '2026-05-29', city: 'Killwangen', tag: 'Cold-outbound', starred: false, note: 'Modern site already — angle is portfolio/SEO uplift.', email: 'info@albabodenbelaege.com', phone: '+41 76 560 90 29', comment: 'Family floor-covering business (father + son) in Killwangen. Site already on Next.js with WhatsApp, partner logos, quote flow. Pain isn\'t "site is broken" — it\'s "could convert better". Smaller pitch.', heat: 0.4, realIntel: 'alba' },
    { id: 'P027', company: 'Fricker Füllemann Rechtsanwälte', contact: 'Matthias Fricker', channel: 'email', stage: 'incoming', stageStep: 1, status: 'todo', amount: 22000, prob: 0.10, due: '2026-05-30', city: 'Winterthur', tag: 'Cold-outbound', starred: false, note: 'Working WP+Elementor engine — unlikely to switch.', email: 'kanzlei@ff-law.ch', phone: '+41 52 222 01 20', comment: 'Boutique 6-lawyer firm in Winterthur. WordPress + Elementor 4.0.9, regularly maintained (last update 2026-03-27). 500+ Trustpilot reviews, active blog (multiple 2026 posts), strong social. Their content engine is working — they have no reason to rip it out.', heat: 0.18, realIntel: 'fflaw' },
  ];

  // History timeline data for the open detail view.
  const history = [
    { t: '08:37', type: 'discovery', text: 'Started discovery · 2026-05-23-ristorante-la-pergola', day: 'SAT, MAY 23' },
    { t: '08:36', type: 'status', text: 'Status: To do → To do', day: 'SAT, MAY 23' },
    { t: '08:36', type: 'status', text: 'Status: Won → Won', day: 'SAT, MAY 23' },
    { t: '08:36', type: 'status', text: 'Status: Standby → Standby', day: 'SAT, MAY 23' },
    { t: '08:35', type: 'note', text: 'Note added: "Called — no answer. Voicemail left."', day: 'SAT, MAY 23' },
    { t: '17:12', type: 'email', text: 'Email sent · Re: proposal v2', day: 'FRI, MAY 22' },
    { t: '14:08', type: 'call', text: 'Outbound call · 3m 14s · voicemail', day: 'FRI, MAY 22' },
    { t: '10:21', type: 'note', text: 'Note added: "Carlo asked for 10% off."', day: 'THU, MAY 21' },
    { t: '09:14', type: 'meeting', text: 'Meeting · Demo · 38 min', day: 'WED, MAY 20' },
  ];

  // Status palette for badges
  const STATUS = {
    todo:      { label: 'TO DO',     hue: 'amber' },
    standby:   { label: 'STANDBY',   hue: 'dim' },
    awaiting:  { label: 'AWAITING',  hue: 'cyan' },
    won:       { label: 'WON',       hue: 'phosphor' },
    lost:      { label: 'LOST',      hue: 'red' },
    cancelled: { label: 'CANCELLED', hue: 'dim' },
  };

  const STAGE = {
    incoming:  { label: 'INCOMING',  step: 1 },
    contacted: { label: 'CONTACTED', step: 2 },
    demo:      { label: 'DEMO DONE', step: 3 },
    closing:   { label: 'CLOSING',   step: 4 },
  };

  const CHANNEL_ICON = {
    call: '☎',
    email: '✉',
    meeting: '◫',
    whatsapp: '◉',
    walkin: '⚐',
  };

  // Derived queue counts at "now"
  function queues(rows) {
    const overdue = rows.filter(l => daysBetween(TODAY, l.due) > 0 && l.status !== 'won' && l.status !== 'lost' && l.status !== 'cancelled').length;
    const today   = rows.filter(l => l.due === TODAY).length;
    const stuckClosing = rows.filter(l => l.stage === 'closing' && daysBetween(TODAY, l.due) >= 0 && l.status !== 'won').length;
    const unmatchedWA = rows.filter(l => l.unmatchedWhatsapp).length;
    return { overdue, today, stuckClosing, unmatchedWA };
  }

  // Money formatter — Swiss style: 14'200
  function chf(n) {
    if (!n) return "0";
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  }

  return {
    TODAY,
    daysBetween,
    leads,
    history,
    STATUS, STAGE, CHANNEL_ICON,
    queues,
    chf,
  };
})();
