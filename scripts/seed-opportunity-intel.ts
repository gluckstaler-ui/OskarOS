// Fill the Opportunity dashboard (intel_json) for the 3 hand-researched
// companies, from the territoryxfathom REAL_INTEL data (kanban.jsx).
// Field shapes match crm.html's renderer: keywords "kw#rank,…", budget
// LOW/MID/HIGH, buying 0-5, prose/pain/pitch newline-bulleted, employees one
// of 1–4 / 5–9 / 10–24 / 25–49 / 50+. Merges into existing intel_json.
// Run: OSKAR_NODE_ID=ralph-mac npx tsx scripts/seed-opportunity-intel.ts
import { readSheet, writeSheet } from '../lib/crm-store'

const INTEL: Record<string, Record<string, unknown>> = {
  // P029 — Aequitas Studio (Lugano)
  P029: {
    verdict_tag: 'SKIP · NO PAIN TO SELL',
    verdict_subline: 'Top-tier firm on a modern Webflow build — multi-lingual, GDPR-ready, professionally executed. No identifiable pain to sell against; re-approach only on a content/SEO signal.',
    verdict_prose: `9-lawyer firm with Bernasconi-name authority — pay isn't the question, fit is\nModern Webflow build (2024), multi-lingual IT/DE/FR/EN, GDPR-ready\nNo obvious gap they feel — nothing to fix right now`,
    verdict_chf_est: '32000',
    verdict_close_pct: '5%',
    verdict_budget: 'HIGH',
    verdict_buying: 0,
    prose_design: `Top-tier execution. Webflow build with disciplined typography hierarchy, professional photography, and multi-lingual rigor across IT/DE/FR/EN. To match this quality we'd need a senior designer + agency-level photo direction + content team. Replacement cost ≥ CHF 25k for parity — they paid roughly the same.`,
    prose_seo: `Limited but coherent. Multi-lingual indexed pages, professional copy, structured data on team profiles. Estimated DR 20–25 — a small footprint that matches firm size, not a content engine. Switching pain technically low (~30 pages) but they have no reason to take the risk.`,
    keywords: 'bernasconi avvocato lugano#2,studio legale lugano#6,diritto penale ticino#14,notaio bellinzona#19,white-collar attorney CH#31',
    pain: `Site is well-built, multi-lingual, GDPR-ready — no obvious pain\nModern Webflow build, professionally executed\nProminent legal figure on the team (Prof. Bernasconi)`,
    pitch: `No pitch angle right now\nPark indefinitely — high-prestige firm with a working modern site`,
    facts_employees: '10–24',
    facts_reviews_state: 'PREMIUM 4.7★',
    facts_reviews_sub: '12 Google reviews',
    intel_scan_at: '2026-05-28',
  },
  // P030 — Alba Bodenbeläge (Killwangen)
  P030: {
    verdict_tag: 'PURSUE · CONVERSION UPLIFT',
    verdict_subline: 'Modern Next.js build that under-converts — stock imagery, thin portfolio, domain split. Low switching pain, clear upside. Pitch photo + content + local-SEO, not a rebuild.',
    verdict_prose: `Has a working "Offerte" quote-request flow — they invest in leads\nWhatsApp contact integration — already digital-channel aware`,
    verdict_chf_est: '9500',
    verdict_close_pct: '32%',
    verdict_budget: 'MID',
    verdict_buying: 1,
    prose_design: `Decent Next.js execution — looks like a developer/agency hybrid. Bones are modern (responsive, fast). Weak point is the imagery: stock-leaning, sparse portfolio of actual installations, generic hero. The structure is good, the curation isn't. We can lift this without a full rebuild — photo shoot + content polish does most of the work.`,
    prose_seo: `Weak. Estimated DR < 12. Domain split (.com canonical vs .ch share URL) is a measurable SEO drag we can fix. Local-SEO is the easy win — they're undervaluing Killwangen/Aargau geo-targeting, no Google Business optimisation visible. Low switching pain (almost nothing to preserve) and clear upside.`,
    keywords: 'bodenbeläge aargau#7,parkett killwangen#3,teppich verlegen zürich#18,vinylboden offerte#24,haro bauwerk händler#41',
    pain: `Stock product imagery — thin portfolio of actual installations\nLimited content depth around the partner brands (Bauwerk, Haro etc.)\nDomain split: .com is canonical but .ch is what they share — SEO drag\nNo customer reviews / case studies on-site`,
    pitch: `Photo shoot of completed installations (CHF 2'800)\nCase-study + reviews section to build trust (CHF 3'500)\nDomain consolidation + SEO push (CHF 2'500)\nOptional: maintenance retainer (CHF 200/mo)`,
    facts_employees: '1–4',
    facts_reviews_state: 'GOOGLE 4.6★',
    facts_reviews_sub: '28 reviews',
    intel_scan_at: '2026-05-28',
  },
  // P031 — Fricker Füllemann Rechtsanwälte (Winterthur)
  P031: {
    verdict_tag: 'SKIP · ENGINE WORKS',
    verdict_subline: 'Boutique firm on WordPress + Elementor with a working content engine (500+ reviews, active blog). High switching pain. Pitch optimisation / modernisation, not replacement — they need a reason to switch.',
    verdict_prose: `500+ Trustpilot reviews · 4.8/5 — strong reputation signal\nActive blog with multiple 2026 posts — in-flight content marketing\nPaid consultation booking (CHF 330) — monetizes inbound`,
    verdict_chf_est: '22000',
    verdict_close_pct: '10%',
    verdict_budget: 'MID',
    verdict_buying: 2,
    prose_design: `Functional template execution. WordPress + Elementor 4.0.9 — page-builder rhythm, generic section patterns, mobile renders slightly heavy. The site does the job for them but doesn't signal premium. Plenty of room to elevate the typographic system, photography, and mobile rhythm without abandoning the WordPress content backend.`,
    prose_seo: `Strong. 500+ Trustpilot reviews, regularly-updated blog (multiple posts in 2026), active social pipeline driving traffic. Estimated DR 25–30. Switching pain HIGH — any migration risks the content equity and ranking they've built. Pitch optimisation + modernisation, not replacement. "Your engine works, let's make it scale".`,
    keywords: 'rechtsanwalt winterthur#1,strafrecht zürich#4,opferanwalt schweiz#9,migrationsrecht winterthur#11,tierrechtsanwalt schweiz#3',
    pain: `WordPress + Elementor 4.0.9 — template-heavy, hard to scale\nMobile UX could be tightened (Elementor sites tend to bloat)\nMulti-channel social presence runs ahead of the site's aesthetics`,
    pitch: `Modern stack migration (Webflow / Next.js) — they've outgrown Elementor\nMobile-first rebuild keeping content + SEO equity\nBut: their engine works — they need a reason to switch`,
    facts_employees: '5–9',
    facts_reviews_state: 'TRUSTPILOT 4.8★',
    facts_reviews_sub: '500+ reviews',
    intel_scan_at: '2026-05-28',
  },
}

async function main() {
  const rows = readSheet()
  let filled = 0
  for (const p of rows) {
    const intel = INTEL[p.id]
    if (!intel) continue
    let existing: Record<string, unknown> = {}
    try { existing = JSON.parse(p.intel_json || '{}') } catch { existing = {} }
    p.intel_json = JSON.stringify({ ...existing, ...intel })
    filled++
    console.log(`${p.id} ${p.company}: ${intel.verdict_tag}`)
  }
  await writeSheet(rows)
  console.log(`\nFilled the Opportunity dashboard for ${filled} prospects.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
