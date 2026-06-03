// Seed the People (contacts) table for the three researched companies — FULL
// records (every field populated). Sourced from each firm's team page +
// targeted web research (Ralph 2026-05-28).
//
// Honesty notes:
//  - phone: neither firm publishes per-person direct lines → firm line on each
//    (real, published).
//  - email: Aequitas pattern CONFIRMED (paolo.bernasconi@aequitaslex.ch) →
//    firstname.lastname@ derived for the rest; FF-Law uses the same standard
//    pattern (derived, not confirmed). Compound names (Rosa Maria, Dell'Oro)
//    are best-guess — verify before sending.
//  - linkedin: real profiles for the 3 partners (found via search); a working
//    LinkedIn people-search link for associates (functional, not a fake URL).
//  - Alba names no individuals → one family-business contact.
//
// Re-runnable: clears existing contacts for the 3 prospects, then re-adds.
// Run: OSKAR_NODE_ID=ralph-mac npx tsx scripts/seed-company-contacts.ts
import { addContact, readContacts, removeContact, type ContactRole } from '../lib/crm-store'

const AEQUITAS_TEL = '+41 91 910 06 06'
const FFLAW_TEL = '+41 52 222 01 20'
const ALBA_TEL = '+41 76 560 90 29'
const liSearch = (q: string) =>
  'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(q)

interface Person {
  name: string
  role: ContactRole
  title: string
  phone: string
  email: string
  linkedin: string
  notes: string
  is_decisive?: boolean
}

const PEOPLE: Record<string, Person[]> = {
  // ── Aequitas Studio Legale (Lugano) — aequitaslex.ch/it/avvocati ────────
  P029: [
    { name: 'Paolo Bernasconi', role: 'decision_maker', title: 'Avvocato e Notaio', is_decisive: true,
      phone: AEQUITAS_TEL, email: 'paolo.bernasconi@aequitaslex.ch',
      linkedin: 'https://www.linkedin.com/in/bernasconi-paolo-lugano-9562b8b3/',
      notes: 'Founding name partner (Prof.). Ex-public-prosecutor; architect of Swiss anti-money-laundering law. Primary decision-maker.' },
    { name: 'Fabio Alippi', role: 'influencer', title: 'Avvocato e Notaio',
      phone: AEQUITAS_TEL, email: 'fabio.alippi@aequitaslex.ch', linkedin: liSearch('Fabio Alippi Aequitas Lugano avvocato'),
      notes: 'Senior — Avvocato e Notaio at Aequitas Studio.' },
    { name: 'Alessandro Martinelli', role: 'influencer', title: 'Avvocato e Notaio',
      phone: AEQUITAS_TEL, email: 'alessandro.martinelli@aequitaslex.ch', linkedin: liSearch('Alessandro Martinelli Aequitas Lugano avvocato'),
      notes: 'Senior — Avvocato e Notaio at Aequitas Studio.' },
    { name: 'Marco Bertoli', role: 'influencer', title: 'Avvocato',
      phone: AEQUITAS_TEL, email: 'marco.bertoli@aequitaslex.ch', linkedin: liSearch('Marco Bertoli Aequitas Lugano avvocato'),
      notes: 'Avvocato at Aequitas Studio (Lugano).' },
    { name: 'Cynthia Bruschi', role: 'influencer', title: 'Avvocato',
      phone: AEQUITAS_TEL, email: 'cynthia.bruschi@aequitaslex.ch', linkedin: liSearch('Cynthia Bruschi Aequitas Lugano avvocato'),
      notes: 'Avvocato at Aequitas Studio (Lugano).' },
    { name: 'Rosa Maria Cappa', role: 'influencer', title: 'Avvocato',
      phone: AEQUITAS_TEL, email: 'rosamaria.cappa@aequitaslex.ch', linkedin: liSearch('Rosa Maria Cappa Aequitas Lugano avvocato'),
      notes: 'Avvocato at Aequitas Studio (Lugano). Email derived — verify.' },
    { name: "John Dell'Oro", role: 'influencer', title: 'Avvocato',
      phone: AEQUITAS_TEL, email: 'john.delloro@aequitaslex.ch', linkedin: liSearch("John Dell'Oro Aequitas Lugano avvocato"),
      notes: 'Avvocato at Aequitas Studio (Lugano). Email derived — verify.' },
    { name: 'Emanuele Stauffer', role: 'influencer', title: 'Avvocato',
      phone: AEQUITAS_TEL, email: 'emanuele.stauffer@aequitaslex.ch', linkedin: liSearch('Emanuele Stauffer Aequitas Lugano avvocato'),
      notes: 'Avvocato at Aequitas Studio (Lugano).' },
    { name: 'Stefania Zanetti', role: 'influencer', title: 'Avvocato',
      phone: AEQUITAS_TEL, email: 'stefania.zanetti@aequitaslex.ch', linkedin: liSearch('Stefania Zanetti Aequitas Lugano avvocato'),
      notes: 'Avvocato at Aequitas Studio (Lugano).' },
  ],

  // ── Alba Bodenbeläge GmbH (Killwangen) — no individuals named on site ────
  P030: [
    { name: 'Familie Alba', role: 'owner', title: 'Inhaber · Vater & Sohn', is_decisive: true,
      phone: ALBA_TEL, email: 'info@albabodenbelaege.ch', linkedin: liSearch('Alba Bodenbeläge Killwangen'),
      notes: 'Family business — father + son + 2 employees (per website). Individual names not published; firm contact only.' },
  ],

  // ── Fricker Füllemann Rechtsanwälte (Winterthur) — ff-law.ch/team ────────
  P031: [
    { name: 'Matthias Fricker', role: 'decision_maker', title: 'Rechtsanwalt & Partner', is_decisive: true,
      phone: FFLAW_TEL, email: 'matthias.fricker@ff-law.ch',
      linkedin: 'https://ch.linkedin.com/in/matthias-fricker-88b54860',
      notes: 'Name partner since 2020 (M.A. HSG). Criminal / social-insurance / admin / contract law. Primary contact.' },
    { name: 'Fabian Füllemann', role: 'decision_maker', title: 'Rechtsanwalt & Partner',
      phone: FFLAW_TEL, email: 'fabian.fuellemann@ff-law.ch',
      linkedin: 'https://www.linkedin.com/in/fabian-fuellemann/',
      notes: 'Name partner since 2020 (MLaw, St. Gallen + Zürich).' },
    { name: 'Omar Ghafier', role: 'influencer', title: 'Rechtsanwalt',
      phone: FFLAW_TEL, email: 'omar.ghafier@ff-law.ch', linkedin: liSearch('Omar Ghafier Rechtsanwalt Winterthur'),
      notes: 'Rechtsanwalt at Fricker Füllemann (Winterthur). Email derived — verify.' },
    { name: 'Christine Lehner', role: 'influencer', title: 'Rechtsanwältin',
      phone: FFLAW_TEL, email: 'christine.lehner@ff-law.ch', linkedin: liSearch('Christine Lehner Rechtsanwältin Winterthur'),
      notes: 'Rechtsanwältin at Fricker Füllemann (Winterthur). Email derived — verify.' },
    { name: 'Nathalie Fitzek', role: 'influencer', title: 'Rechtsanwältin (D)',
      phone: FFLAW_TEL, email: 'nathalie.fitzek@ff-law.ch', linkedin: liSearch('Nathalie Fitzek Rechtsanwältin Winterthur'),
      notes: 'Rechtsanwältin (Deutschland) at Fricker Füllemann. Email derived — verify.' },
    { name: 'Felicitas Ernst', role: 'influencer', title: 'Rechtsanwältin (D)',
      phone: FFLAW_TEL, email: 'felicitas.ernst@ff-law.ch', linkedin: liSearch('Felicitas Ernst Rechtsanwältin Winterthur'),
      notes: 'Rechtsanwältin (Deutschland) at Fricker Füllemann. Email derived — verify.' },
  ],
}

async function main() {
  let total = 0
  for (const [pid, list] of Object.entries(PEOPLE)) {
    // clear existing (re-runnable)
    for (const c of readContacts(pid)) await removeContact(c.id)
    for (const p of list) {
      await addContact({
        prospect_id: pid,
        name: p.name,
        role: p.role,
        title: p.title,
        phone: p.phone,
        email: p.email,
        linkedin: p.linkedin,
        notes: p.notes,
        is_decisive: p.is_decisive ?? false,
      })
      total++
    }
    console.log(`${pid}: ${list.length} contacts (full)`)
  }
  console.log(`Total: ${total}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
