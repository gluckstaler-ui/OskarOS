// One-shot seed (Ralph 2026-05-28): give the CRM real, non-empty company data.
//
// - Sets Filomax (P021) address to Via dei Faggi 1, 6912 Pazzallo (Ralph-provided).
// - Imports the three "hand-researched" companies from the territoryxfathom
//   mockup (crm-data.js): Aequitas, Alba Bodenbeläge, Fricker Füllemann.
//   Their street/PLZ/Ort are VERIFIED from each firm's own website:
//     Aequitas   → Via Lucchini 1, 6901 Lugano        (aequitaslex.ch)
//     Alba       → Rebäckerstrasse 1, 8956 Killwangen (albabodenbelaege.ch)
//     Fricker    → Merkurstrasse 25, 8400 Winterthur  (ff-law.ch)
//   UID/MWST left blank — not published on their sites; not fabricated.
//
// Writes via crm-store.writeSheet → event-first (events.jsonl) then SQLite.
// Run: npx tsx scripts/seed-company-addresses.ts
import { readSheet, writeSheet, type Prospect } from '../lib/crm-store'

const nowIso = () => new Date().toISOString()

const mk = (p: Partial<Prospect> & { id: string; company: string }): Prospect => ({
  id: p.id,
  company: p.company,
  contact_name: p.contact_name ?? '',
  phone: p.phone ?? '',
  email: p.email ?? '',
  website: p.website ?? '',
  address_strasse: p.address_strasse ?? '',
  address_plz: p.address_plz ?? '',
  address_ort: p.address_ort ?? '',
  uid_number: p.uid_number ?? '',
  stage: (p.stage ?? 'Incoming') as Prospect['stage'],
  status: (p.status ?? 'To do') as Prospect['status'],
  amount_chf: p.amount_chf ?? 0,
  confidence_pct: p.confidence_pct ?? 0,
  next_action_date: p.next_action_date ?? '',
  next_action_label: p.next_action_label ?? '',
  tags: p.tags ?? '',
  starred: p.starred ?? false,
  owner: p.owner ?? 'Filippo',
  notes: p.notes ?? '',
  created_at: p.created_at ?? nowIso(),
  standby_plan: '',
  lost_reason: '',
  sub_stage: '',
  intel_json: p.intel_json ?? '{}',
})

async function main() {
  const rows = readSheet()
  const has = (needle: string) => rows.some(r => r.company.toLowerCase().includes(needle))

  // 1) Filomax (P021) — Ralph-provided address.
  const filomax = rows.find(r => r.id === 'P021')
  if (filomax) {
    filomax.address_strasse = 'Via dei Faggi 1'
    filomax.address_plz = '6912'
    filomax.address_ort = 'Pazzallo'
  } else {
    console.warn('! P021 (Filomax) not found — skipped its address')
  }

  // 2) Upsert the three verified companies. Run-1 inserted them with empty
  //    addresses (INSERT-column bug, now fixed); upserting by id fills them
  //    via the generic per-field UPDATE path. `has()` kept for first-run.
  void has
  const targets: Prospect[] = []
  targets.push(mk({
    id: 'P029',
    company: 'Aequitas Studio',
    contact_name: 'Prof. Paolo Bernasconi',
    phone: '+41 91 910 06 06',
    email: 'info@aequitaslex.ch',
    website: 'aequitaslex.ch',
    address_strasse: 'Via Lucchini 1', address_plz: '6901', address_ort: 'Lugano',
    amount_chf: 32000, confidence_pct: 5,
    next_action_date: '2026-05-29',
    next_action_label: 'Top-tier firm on a modern site — nothing to fix.',
    tags: 'Cold-outbound',
    notes: 'Substantial Lugano law firm (10+ lawyers, 4 ex-public prosecutors, Prof. Bernasconi). Recently built Webflow site, multi-lingual, GDPR compliant. CHF 32k is the deal IF they buy. They won’t.',
  }))
  targets.push(mk({
    id: 'P030',
    company: 'Alba Bodenbeläge GmbH',
    contact_name: 'Familie Alba',
    phone: '+41 76 560 90 29',
    email: 'info@albabodenbelaege.ch',
    website: 'albabodenbelaege.ch',
    address_strasse: 'Rebäckerstrasse 1', address_plz: '8956', address_ort: 'Killwangen',
    amount_chf: 9500, confidence_pct: 32,
    next_action_date: '2026-05-29',
    next_action_label: 'Modern site already — angle is portfolio / SEO uplift.',
    tags: 'Cold-outbound',
    notes: 'Family floor-covering business (father + son) in Killwangen. Site already on Next.js with WhatsApp, partner logos, quote flow. Pain isn’t "site is broken" — it’s "could convert better". Smaller pitch.',
  }))
  targets.push(mk({
    id: 'P031',
    company: 'Fricker Füllemann Rechtsanwälte',
    contact_name: 'Matthias Fricker',
    phone: '+41 52 222 01 20',
    email: 'kanzlei@ff-law.ch',
    website: 'ff-law.ch',
    address_strasse: 'Merkurstrasse 25', address_plz: '8400', address_ort: 'Winterthur',
    amount_chf: 22000, confidence_pct: 10,
    next_action_date: '2026-05-30',
    next_action_label: 'Working WP + Elementor engine — unlikely to switch.',
    tags: 'Cold-outbound',
    notes: 'Boutique 6-lawyer firm in Winterthur. WordPress + Elementor, regularly maintained. 500+ reviews, active blog, strong social. Their content engine works — no reason to rip it out.',
  }))

  for (const t of targets) {
    const i = rows.findIndex((r) => r.id === t.id)
    if (i >= 0) rows[i] = { ...t, created_at: rows[i].created_at }
    else rows.push(t)
  }

  await writeSheet(rows)
  console.log(`Filomax address set: ${!!filomax}`)
  console.log(`Upserted (${targets.length}): ${targets.map((t) => `${t.id} ${t.company}`).join(' | ')}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
