// fill-crm-intel.mjs — seed opportunity-dashboard intel_json for ≥10 prospects.
// Copies the territoryxfathom mockup's REAL_INTEL 1:1 into the matching live
// prospects (Aequitas P029, Alba P030, Fricker P031, Caffè Sant'Ambrogio P001)
// plus plausible SMB mock data for 6 more — so the opp dashboard renders
// non-empty and lamps color-code by tone. Apple-to-apple vs the mockup.
//
//   node scripts/fill-crm-intel.mjs
//
// Idempotent: re-running overwrites intel_json on the same ids. Throwaway seed
// data for visual debugging — NOT production wiring.

const BASE = process.env.CRM_BASE || 'http://localhost:3000';

// schema keys consumed by crmRenderOpp/crmLampHtml/crmStripCellHtml:
//   verdict_{tag,subline,prose,chf_est,close_pct,budget,buying,tone}
//   lamp_{age|hosting|stack|photo|performance|seo}_{state,sub,tone}
//   strip_{traffic|analytics|marketing|saas|booking}_{state,tone}, strip_lang_state
//   prose_{design,seo}, keywords ("kw#rank,..."),
//   facts_reviews_{state,sub,tone}, facts_employees, pain, pitch, intel_scan_at
// tone ∈ info|good|mid|bad   budget ∈ —|LOW|MID|HIGH   emp ∈ 1–4|5–9|10–24|25–49|50+

const SCAN = '2026-05-28';

const intel = {
  // ── Aequitas — DISQUALIFY (red flag: top-tier firm, no pain) ──
  P029: {
    intel_scan_at: SCAN,
    verdict_tag: 'DISQUALIFY', verdict_tone: 'bad',
    verdict_subline: 'No identifiable pain · top-tier firm · do not pursue',
    verdict_prose: '',
    verdict_chf_est: "32'000", verdict_close_pct: '5%', verdict_budget: 'HIGH', verdict_buying: 0,
    lamp_age_state: '2024 FRESH', lamp_age_sub: 'upd 4 mo ago', lamp_age_tone: 'bad',
    lamp_hosting_state: 'WEBFLOW', lamp_hosting_sub: 'Global CDN', lamp_hosting_tone: 'info',
    lamp_stack_state: 'WEBFLOW', lamp_stack_sub: 'CMS + Forms', lamp_stack_tone: 'info',
    lamp_photo_state: 'MASTER', lamp_photo_sub: 'studio photography', lamp_photo_tone: 'bad',
    lamp_performance_state: '92', lamp_performance_sub: 'mobile 78', lamp_performance_tone: 'good',
    lamp_seo_state: '75', lamp_seo_sub: '', lamp_seo_tone: 'mid',
    strip_traffic_state: 'STEADY', strip_traffic_tone: 'mid',
    strip_lang_state: '4 LANG',
    strip_analytics_state: 'GA4', strip_analytics_tone: 'info',
    strip_marketing_state: 'META + GOOGLE', strip_marketing_tone: 'info',
    strip_saas_state: 'HUBSPOT', strip_saas_tone: 'bad',
    strip_booking_state: 'NATIVE', strip_booking_tone: 'info',
    prose_design: "Top-tier execution. Webflow build with disciplined typography hierarchy, professional photography, and multi-lingual rigor across IT/DE/FR/EN. To match this quality we'd need a senior designer + agency-level photo direction + content team. Replacement cost ≥ CHF 25k for parity — they paid roughly the same.",
    prose_seo: 'Limited but coherent. Multi-lingual indexed pages, professional copy, structured data on team profiles. Estimated DR 20–25 — a small footprint that matches firm size, not a content engine. Switching pain technically low (~30 pages) but they have no reason to take the risk.',
    keywords: 'bernasconi avvocato lugano#2,studio legale lugano#6,diritto penale ticino#14,notaio bellinzona#19,white-collar attorney CH#31',
    facts_reviews_state: 'PREMIUM 4.7★', facts_reviews_sub: '12 Google reviews', facts_reviews_tone: 'bad',
    facts_employees: '5–9',
    pain: 'Site is well-built, multi-lingual, GDPR-ready — no obvious pain\nModern Webflow build, professionally executed\nProminent legal figure on the team (Prof. Bernasconi)',
    pitch: 'No pitch angle right now\nPark indefinitely — high-prestige firm with a working modern site',
  },
  // ── Alba — WARMING UP (1 buying signal, mid budget) ──
  P030: {
    intel_scan_at: SCAN,
    verdict_tag: 'WARMING UP', verdict_tone: 'mid',
    verdict_subline: '1 of 5 buying signals · mid budget',
    verdict_prose: 'Has working "Offerte" (quote-request) flow — they invest in leads.\nWhatsApp contact integration — already digital-channel aware.',
    verdict_chf_est: "9'500", verdict_close_pct: '35%', verdict_budget: 'MID', verdict_buying: 1,
    lamp_age_state: '2024 FRESH', lamp_age_sub: 'maintained', lamp_age_tone: 'bad',
    lamp_hosting_state: 'VERCEL', lamp_hosting_sub: 'EU CDN', lamp_hosting_tone: 'info',
    lamp_stack_state: 'NEXT.JS', lamp_stack_sub: '14.x + Tailwind', lamp_stack_tone: 'info',
    lamp_photo_state: 'STOCK', lamp_photo_sub: 'leaning stock', lamp_photo_tone: 'good',
    lamp_performance_state: '88', lamp_performance_sub: 'mobile 72', lamp_performance_tone: 'mid',
    lamp_seo_state: '52', lamp_seo_sub: '', lamp_seo_tone: 'mid',
    strip_traffic_state: 'LOW', strip_traffic_tone: 'good',
    strip_lang_state: 'DE',
    strip_analytics_state: 'GA4', strip_analytics_tone: 'info',
    strip_marketing_state: 'GOOGLE', strip_marketing_tone: 'info',
    strip_saas_state: 'NONE', strip_saas_tone: 'good',
    strip_booking_state: 'PHONE', strip_booking_tone: 'good',
    prose_design: "Decent Next.js execution — looks like a developer/agency hybrid. Bones are modern (responsive, fast). Weak point is the imagery: stock-leaning, sparse portfolio of actual installations, generic hero. The structure is good, the curation isn't. We can lift this without a full rebuild — photo shoot + content polish does most of the work.",
    prose_seo: "Weak. Estimated DR < 12. Domain split (.com canonical vs .ch share URL) is a measurable SEO drag we can fix. Local-SEO is the easy win — they're undervaluing Killwangen/Aargau geo-targeting, no Google Business optimisation visible. Low switching pain (almost nothing to preserve) and clear upside.",
    keywords: 'bodenbeläge aargau#7,parkett killwangen#3,teppich verlegen zürich#18,vinylboden offerte#24,haro bauwerk händler#41',
    facts_reviews_state: 'GOOGLE 4.6★', facts_reviews_sub: '28 reviews', facts_reviews_tone: 'mid',
    facts_employees: '5–9',
    pain: 'Stock product imagery — thin portfolio of actual installations\nLimited content depth around the partner brands (Bauwerk, Haro etc.)\nDomain split: .com is canonical but .ch is what they share — SEO drag\nNo customer reviews / case studies on-site',
    pitch: "Photo shoot of completed installations (CHF 2'800)\nCase-study + reviews section to build trust (CHF 3'500)\nDomain consolidation + SEO push (CHF 2'500)\nOptional: maintenance retainer (CHF 200/mo)",
  },
  // ── Fricker Füllemann — DISQUALIFY (engine works, low switching motivation) ──
  P031: {
    intel_scan_at: SCAN,
    verdict_tag: 'DISQUALIFY', verdict_tone: 'bad',
    verdict_subline: 'Their content engine is working · low switching motivation',
    verdict_prose: '500+ Trustpilot reviews · 4.8/5 — strong reputation signal.\nActive blog with multiple 2026 posts — in-flight content marketing.\nPaid consultation booking (CHF 330) — monetizes inbound.',
    verdict_chf_est: "22'000", verdict_close_pct: '15%', verdict_budget: 'MID', verdict_buying: 2,
    lamp_age_state: '2020 MAINT', lamp_age_sub: 'upd 2 mo ago', lamp_age_tone: 'mid',
    lamp_hosting_state: 'WP HOSTING', lamp_hosting_sub: 'CH server', lamp_hosting_tone: 'info',
    lamp_stack_state: 'WP 6.2', lamp_stack_sub: 'Elementor 4.0.9', lamp_stack_tone: 'info',
    lamp_photo_state: 'COMPETENT', lamp_photo_sub: 'mixed sources', lamp_photo_tone: 'mid',
    lamp_performance_state: '64', lamp_performance_sub: 'mobile 41', lamp_performance_tone: 'mid',
    lamp_seo_state: '81', lamp_seo_sub: '', lamp_seo_tone: 'mid',
    strip_traffic_state: 'STRONG', strip_traffic_tone: 'bad',
    strip_lang_state: 'DE/EN',
    strip_analytics_state: 'GA4 + GTM', strip_analytics_tone: 'info',
    strip_marketing_state: 'META', strip_marketing_tone: 'info',
    strip_saas_state: 'NONE', strip_saas_tone: 'good',
    strip_booking_state: 'NATIVE', strip_booking_tone: 'info',
    prose_design: "Functional template execution. WordPress + Elementor 4.0.9 — page-builder rhythm, generic section patterns, mobile renders slightly heavy. The site does the job for them but doesn't signal premium. Plenty of room to elevate the typographic system, photography, and mobile rhythm without abandoning the WordPress content backend.",
    prose_seo: 'Strong. 500+ Trustpilot reviews, regularly-updated blog (multiple posts in 2026), active social pipeline driving traffic. Estimated DR 25–30. Switching pain HIGH — any migration risks the content equity and ranking they\'ve built. Pitch optimisation + modernisation, not replacement. "Your engine works, let\'s make it scale".',
    keywords: 'rechtsanwalt winterthur#1,strafrecht zürich#4,opferanwalt schweiz#9',
    facts_reviews_state: 'TRUSTPILOT 4.8★', facts_reviews_sub: '500+ reviews', facts_reviews_tone: 'bad',
    facts_employees: '10–24',
    pain: 'WordPress + Elementor 4.0.9 — template-heavy, hard to scale\nMobile UX could be tightened (Elementor sites tend to bloat)\nMulti-channel social presence runs ahead of the site\'s aesthetics',
    pitch: 'Modern stack migration (Webflow / Next.js) — they\'ve outgrown Elementor\nMobile-first rebuild keeping content + SEO equity\nBut: their engine works — they need a reason to switch',
  },
  // ── Caffè Sant'Ambrogio — SHOPPING NOW (copied 1:1 from mockup's visible card) ──
  P001: {
    intel_scan_at: SCAN,
    verdict_tag: 'SHOPPING NOW', verdict_tone: 'good',
    verdict_subline: '3 of 5 buying signals active · budget low',
    verdict_prose: 'Founder posted "we\'re hiring across all roles" on LinkedIn 14d ago.\nInstagram rebrand 42d ago, site still on old logo.',
    verdict_chf_est: "12'400", verdict_close_pct: '45%', verdict_budget: 'LOW', verdict_buying: 3,
    lamp_age_state: '2017 STALE', lamp_age_sub: 'upd 1y ago', lamp_age_tone: 'bad',
    lamp_hosting_state: 'SITEGROUND', lamp_hosting_sub: 'CH server', lamp_hosting_tone: 'info',
    lamp_stack_state: 'JOOMLA 3', lamp_stack_sub: '', lamp_stack_tone: 'info',
    lamp_photo_state: 'MASTER', lamp_photo_sub: 'studio shoot', lamp_photo_tone: 'bad',
    lamp_performance_state: '41', lamp_performance_sub: 'mobile 25', lamp_performance_tone: 'bad',
    lamp_seo_state: '76', lamp_seo_sub: '', lamp_seo_tone: 'mid',
    strip_traffic_state: 'UNK', strip_traffic_tone: 'info',
    strip_lang_state: 'IT',
    strip_analytics_state: 'NONE', strip_analytics_tone: 'bad',
    strip_marketing_state: 'GOOGLE', strip_marketing_tone: 'info',
    strip_saas_state: 'NONE', strip_saas_tone: 'good',
    strip_booking_state: 'NATIVE', strip_booking_tone: 'info',
    prose_design: 'Looks like a BUDGET-tier execution on Joomla 3. Built 9 years ago, last updated 1y ago. Template-y or DIY feel — wide-open canvas to upgrade.',
    prose_seo: 'Strong. DR 63, active content footprint. Switching pain HIGH — pitch optimisation, not replacement.',
    keywords: 'ristorante lugano#23,cucina ticinese#36,pizzeria menu#37,tavolo riservato#4,aperitivo#11',
    facts_reviews_state: 'GOOGLE 4.2★', facts_reviews_sub: '31 reviews', facts_reviews_tone: 'mid',
    facts_employees: '50+',
    pain: 'Outdated menu page (last update 2018)\nNo online reservation system\nMobile site barely usable on iPhone\nInstagram drives traffic to dead links\nNo multilingual support (DE/IT/FR)',
    pitch: "Modern responsive website (CHF 8'000–12'000)\nOnline reservation integration\nMultilingual content (DE/IT/FR)\nGoogle Business Profile optimization\nMonthly maintenance retainer",
  },
  // ── P002 Studio Dentistico Bianchi — WEB FAILING ──
  P002: {
    intel_scan_at: SCAN,
    verdict_tag: 'WEB FAILING', verdict_tone: 'mid',
    verdict_subline: 'Lighthouse 34/100 · last update 3y ago · this is the pitch',
    verdict_prose: 'Mobile performance is the wedge — patients book on phones.',
    verdict_chf_est: "11'000", verdict_close_pct: '50%', verdict_budget: 'MID', verdict_buying: 2,
    lamp_age_state: '2021 AGING', lamp_age_sub: 'upd 3y ago', lamp_age_tone: 'mid',
    lamp_hosting_state: 'HOSTPOINT', lamp_hosting_sub: 'CH server', lamp_hosting_tone: 'info',
    lamp_stack_state: 'WORDPRESS', lamp_stack_sub: 'Divi theme', lamp_stack_tone: 'info',
    lamp_photo_state: 'STOCK', lamp_photo_sub: 'generic dental', lamp_photo_tone: 'good',
    lamp_performance_state: '34', lamp_performance_sub: 'mobile 22', lamp_performance_tone: 'bad',
    lamp_seo_state: '58', lamp_seo_sub: '', lamp_seo_tone: 'mid',
    strip_traffic_state: 'LOW', strip_traffic_tone: 'good',
    strip_lang_state: 'IT/DE',
    strip_analytics_state: 'GA4', strip_analytics_tone: 'info',
    strip_marketing_state: 'NONE', strip_marketing_tone: 'good',
    strip_saas_state: 'NONE', strip_saas_tone: 'good',
    strip_booking_state: 'PHONE', strip_booking_tone: 'good',
    prose_design: 'Dated Divi template, heavy hero sliders, weak mobile rhythm. Clear modernisation case without touching their content.',
    prose_seo: 'Thin. Estimated DR < 10. Local dental keywords wide open — no Google Business optimisation, no review funnel.',
    keywords: 'dentista lugano#12,studio dentistico ticino#9,impianti dentali lugano#21,sbiancamento denti#33',
    facts_reviews_state: 'GOOGLE 4.4★', facts_reviews_sub: '47 reviews', facts_reviews_tone: 'mid',
    facts_employees: '5–9',
    pain: 'Mobile site slow + hard to navigate\nNo online appointment booking\nNo review-generation funnel',
    pitch: 'Mobile-first rebuild with online booking\nGoogle Business + review automation\nBefore/after gallery for treatments',
  },
  // ── P003 Bar Olimpia — SHOPPING NOW ──
  P003: {
    intel_scan_at: SCAN,
    verdict_tag: 'SHOPPING NOW', verdict_tone: 'good',
    verdict_subline: '3 of 5 buying signals active · budget low',
    verdict_prose: 'Owner DM\'d asking about a "simple site" last week.\nRuns paid Instagram ads to a dead Linktree.',
    verdict_chf_est: "4'200", verdict_close_pct: '55%', verdict_budget: 'LOW', verdict_buying: 3,
    lamp_age_state: 'NO SITE', lamp_age_sub: 'Linktree only', lamp_age_tone: 'bad',
    lamp_hosting_state: 'NONE', lamp_hosting_sub: '', lamp_hosting_tone: 'bad',
    lamp_stack_state: 'LINKTREE', lamp_stack_sub: '', lamp_stack_tone: 'mid',
    lamp_photo_state: 'PHONE', lamp_photo_sub: 'owner snapshots', lamp_photo_tone: 'mid',
    lamp_performance_state: '—', lamp_performance_sub: 'no site', lamp_performance_tone: 'info',
    lamp_seo_state: '0', lamp_seo_sub: '', lamp_seo_tone: 'bad',
    strip_traffic_state: 'NONE', strip_traffic_tone: 'bad',
    strip_lang_state: 'IT',
    strip_analytics_state: 'NONE', strip_analytics_tone: 'bad',
    strip_marketing_state: 'META', strip_marketing_tone: 'info',
    strip_saas_state: 'NONE', strip_saas_tone: 'good',
    strip_booking_state: 'NONE', strip_booking_tone: 'bad',
    prose_design: 'No website at all — only a Linktree. Greenfield: anything we build is a step up.',
    prose_seo: 'Invisible on search. Pure local-SEO greenfield — Google Business not even claimed.',
    keywords: '',
    facts_reviews_state: 'GOOGLE 4.0★', facts_reviews_sub: '18 reviews', facts_reviews_tone: 'mid',
    facts_employees: '1–4',
    pain: 'No website — losing search traffic entirely\nPaid ads point to a dead Linktree\nGoogle Business unclaimed',
    pitch: 'One-page launch site (CHF 2\'500)\nClaim + optimise Google Business\nPoint the ad spend somewhere that converts',
  },
  // ── P004 Garage Rossi — WARMING UP ──
  P004: {
    intel_scan_at: SCAN,
    verdict_tag: 'WARMING UP', verdict_tone: 'mid',
    verdict_subline: '2 of 5 buying signals · mid budget',
    verdict_prose: 'Replied to the first WhatsApp within an hour.',
    verdict_chf_est: "22'100", verdict_close_pct: '58%', verdict_budget: 'MID', verdict_buying: 2,
    lamp_age_state: '2019 AGING', lamp_age_sub: 'upd 2y ago', lamp_age_tone: 'mid',
    lamp_hosting_state: 'INFOMANIAK', lamp_hosting_sub: 'CH server', lamp_hosting_tone: 'info',
    lamp_stack_state: 'WORDPRESS', lamp_stack_sub: 'Astra theme', lamp_stack_tone: 'info',
    lamp_photo_state: 'MIXED', lamp_photo_sub: 'some stock', lamp_photo_tone: 'mid',
    lamp_performance_state: '57', lamp_performance_sub: 'mobile 39', lamp_performance_tone: 'mid',
    lamp_seo_state: '63', lamp_seo_sub: '', lamp_seo_tone: 'mid',
    strip_traffic_state: 'STEADY', strip_traffic_tone: 'mid',
    strip_lang_state: 'IT/DE',
    strip_analytics_state: 'GA4', strip_analytics_tone: 'info',
    strip_marketing_state: 'GOOGLE', strip_marketing_tone: 'info',
    strip_saas_state: 'NONE', strip_saas_tone: 'good',
    strip_booking_state: 'PHONE', strip_booking_tone: 'good',
    prose_design: 'Workmanlike WordPress build. Functional but generic — could use a photo refresh and a clearer service-booking path.',
    prose_seo: 'Mid. Ranks locally for a few service terms. Room to expand into model/brand-specific landing pages.',
    keywords: 'garage lugano#8,cambio gomme ticino#14,tagliando auto lugano#19,carrozzeria#27',
    facts_reviews_state: 'GOOGLE 4.5★', facts_reviews_sub: '63 reviews', facts_reviews_tone: 'mid',
    facts_employees: '5–9',
    pain: 'Generic template, dated photography\nNo online service booking\nNo brand-specific service pages',
    pitch: 'Service-booking flow + quote request\nPhoto refresh of the workshop\nBrand/model landing pages for SEO',
  },
  // ── P005 Hotel Splendid — QUIET LEAD ──
  P005: {
    intel_scan_at: SCAN,
    verdict_tag: 'QUIET LEAD', verdict_tone: 'info',
    verdict_subline: 'No strong signals yet. Worth a discovery call to qualify.',
    verdict_prose: '',
    verdict_chf_est: "47'800", verdict_close_pct: '55%', verdict_budget: 'HIGH', verdict_buying: 1,
    lamp_age_state: '2022 OK', lamp_age_sub: 'upd 8 mo ago', lamp_age_tone: 'good',
    lamp_hosting_state: 'AWS', lamp_hosting_sub: 'EU region', lamp_hosting_tone: 'info',
    lamp_stack_state: 'WEBFLOW', lamp_stack_sub: 'CMS', lamp_stack_tone: 'info',
    lamp_photo_state: 'MASTER', lamp_photo_sub: 'pro hospitality', lamp_photo_tone: 'bad',
    lamp_performance_state: '79', lamp_performance_sub: 'mobile 61', lamp_performance_tone: 'mid',
    lamp_seo_state: '71', lamp_seo_sub: '', lamp_seo_tone: 'mid',
    strip_traffic_state: 'STEADY', strip_traffic_tone: 'mid',
    strip_lang_state: 'IT/DE/EN',
    strip_analytics_state: 'GA4 + GTM', strip_analytics_tone: 'info',
    strip_marketing_state: 'META + GOOGLE', strip_marketing_tone: 'info',
    strip_saas_state: 'CLOUDBEDS', strip_saas_tone: 'bad',
    strip_booking_state: 'OTA + DIRECT', strip_booking_tone: 'good',
    prose_design: 'Polished Webflow build with strong hospitality photography. Already premium — displacement pain is real.',
    prose_seo: 'Solid. Multi-lingual, structured data on rooms. A content/booking-conversion layer beats a redesign.',
    keywords: 'hotel lugano lago#3,boutique hotel ticino#7,hotel splendid lugano#1,wellness hotel#22',
    facts_reviews_state: 'BOOKING 8.9', facts_reviews_sub: '900+ reviews', facts_reviews_tone: 'bad',
    facts_employees: '25–49',
    pain: 'Direct-booking conversion lags OTA share\nNo upsell/packages flow on-site\nContent thin vs competitor wellness hotels',
    pitch: 'Direct-booking conversion optimisation\nPackages + upsell module\nSEO content layer on top (no redesign)',
  },
  // ── P006 Pizzeria Da Mario — WEB FAILING ──
  P006: {
    intel_scan_at: SCAN,
    verdict_tag: 'WEB FAILING', verdict_tone: 'mid',
    verdict_subline: 'Lighthouse 29/100 · Wix site stuck in 2016 · this is the pitch',
    verdict_prose: 'PDF menu last edited 2019.',
    verdict_chf_est: "6'400", verdict_close_pct: '65%', verdict_budget: 'LOW', verdict_buying: 2,
    lamp_age_state: '2016 STALE', lamp_age_sub: 'upd 5y ago', lamp_age_tone: 'bad',
    lamp_hosting_state: 'WIX', lamp_hosting_sub: 'managed', lamp_hosting_tone: 'info',
    lamp_stack_state: 'WIX', lamp_stack_sub: '', lamp_stack_tone: 'mid',
    lamp_photo_state: 'PHONE', lamp_photo_sub: 'low-res', lamp_photo_tone: 'mid',
    lamp_performance_state: '29', lamp_performance_sub: 'mobile 18', lamp_performance_tone: 'bad',
    lamp_seo_state: '44', lamp_seo_sub: '', lamp_seo_tone: 'bad',
    strip_traffic_state: 'LOW', strip_traffic_tone: 'good',
    strip_lang_state: 'IT',
    strip_analytics_state: 'NONE', strip_analytics_tone: 'bad',
    strip_marketing_state: 'NONE', strip_marketing_tone: 'good',
    strip_saas_state: 'NONE', strip_saas_tone: 'good',
    strip_booking_state: 'PHONE', strip_booking_tone: 'good',
    prose_design: 'Ancient Wix template, broken on mobile, PDF menu. Easy, obvious upgrade.',
    prose_seo: 'Weak. Barely ranks for its own name. Local-SEO + a live menu fixes most of it.',
    keywords: 'pizzeria lugano#16,pizza asporto ticino#24,da mario pizzeria#2',
    facts_reviews_state: 'GOOGLE 4.6★', facts_reviews_sub: '210 reviews', facts_reviews_tone: 'bad',
    facts_employees: '5–9',
    pain: 'Wix site broken on mobile\nPDF menu, no online ordering\nNo Google Business posts',
    pitch: 'Modern mobile site + live menu\nOnline ordering / reservation\nGoogle Business + review funnel',
  },
  // ── P007 Boutique Aurora — WARMING UP (ecom) ──
  P007: {
    intel_scan_at: SCAN,
    verdict_tag: 'WARMING UP', verdict_tone: 'mid',
    verdict_subline: '2 of 5 buying signals · mid budget',
    verdict_prose: 'Asked about "making the shop faster" on LinkedIn.\nRuns seasonal Meta campaigns.',
    verdict_chf_est: "14'600", verdict_close_pct: '48%', verdict_budget: 'MID', verdict_buying: 2,
    lamp_age_state: '2023 OK', lamp_age_sub: 'upd 5 mo ago', lamp_age_tone: 'good',
    lamp_hosting_state: 'SHOPIFY', lamp_hosting_sub: 'managed', lamp_hosting_tone: 'info',
    lamp_stack_state: 'SHOPIFY', lamp_stack_sub: 'Dawn theme', lamp_stack_tone: 'info',
    lamp_photo_state: 'COMPETENT', lamp_photo_sub: 'product flat-lay', lamp_photo_tone: 'mid',
    lamp_performance_state: '62', lamp_performance_sub: 'mobile 44', lamp_performance_tone: 'mid',
    lamp_seo_state: '68', lamp_seo_sub: '', lamp_seo_tone: 'mid',
    strip_traffic_state: 'STEADY', strip_traffic_tone: 'mid',
    strip_lang_state: 'IT/DE',
    strip_analytics_state: 'GA4', strip_analytics_tone: 'info',
    strip_marketing_state: 'META + GOOGLE', strip_marketing_tone: 'info',
    strip_saas_state: 'KLAVIYO', strip_saas_tone: 'bad',
    strip_booking_state: 'N/A', strip_booking_tone: 'info',
    prose_design: 'Stock Shopify Dawn theme. Clean but undifferentiated — the brand deserves a custom storefront and editorial photography.',
    prose_seo: 'Mid. Product pages index fine; collection/editorial content thin. Performance is the conversion drag.',
    keywords: 'boutique lugano#11,moda donna ticino#19,abbigliamento lugano#14,boutique aurora#1',
    facts_reviews_state: 'GOOGLE 4.7★', facts_reviews_sub: '54 reviews', facts_reviews_tone: 'bad',
    facts_employees: '5–9',
    pain: 'Generic Shopify theme, slow on mobile\nNo editorial/brand content\nKlaviyo flows underused',
    pitch: 'Custom storefront on Shopify\nEditorial photo + content layer\nPerformance + conversion-rate optimisation',
  },
};

// The CRM event-log caps each event at 4096 bytes. The 3 mockup-exact records
// have long prose that blows the cap — trim ONLY the long-form text fields to
// fit (verdict/lamps/strip/facts/keywords stay 1:1, since those drive the
// color + bg rendering we're debugging).
const OVERRIDES = {
  P029: {
    prose_design: 'Top-tier Webflow build. Parity cost ≥ CHF 25k.',
    prose_seo: 'Coherent multi-lingual footprint, DR ~20–25. No reason to switch.',
    pain: 'Well-built, multi-lingual — no obvious pain\nProminent legal figure (Bernasconi)',
    pitch: 'No angle now\nPark — prestige firm, modern site',
  },
  P030: {
    prose_design: 'Decent Next.js, modern bones. Weak: stock imagery, thin portfolio.',
    prose_seo: 'Weak, DR < 12. Domain split = SEO drag. Local-SEO is the win.',
    pain: 'Stock imagery, thin portfolio\nDomain split — SEO drag',
    pitch: "Photo shoot (CHF 2'800)\nReviews section (CHF 3'500)",
    verdict_prose: 'Working "Offerte" flow.\nWhatsApp integration.',
  },
  P031: {
    prose_design: 'WP + Elementor 4.0.9 — heavy mobile.',
    prose_seo: 'Strong. DR ~25–30. Pain HIGH — optimise.',
    pain: 'Elementor — hard to scale\nMobile UX could tighten',
    pitch: 'Modern stack migration\nKeep SEO equity',
    verdict_prose: '500+ Trustpilot 4.8★. Active 2026 blog.',
  },
};
for (const [id, ov] of Object.entries(OVERRIDES)) Object.assign(intel[id], ov);

const ids = Object.keys(intel);
let ok = 0, fail = 0;

for (const id of ids) {
  const ij = JSON.stringify(intel[id]);
  const body = JSON.stringify({ intel_json: ij });
  const ijBytes = Buffer.byteLength(ij, 'utf8');
  try {
    const r = await fetch(`${BASE}/api/admin/crm/prospects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const txt = await r.text();
    if (!r.ok) { console.error(`✗ ${id} (intel ${ijBytes}b) → ${r.status} ${txt.slice(0, 160)}`); fail++; continue; }
    let saved = '';
    try { const j = JSON.parse(txt); saved = j.prospect ? `intel ${ (j.prospect.intel_json||'').length }b` : 'no prospect in resp'; } catch { saved = 'non-json resp'; }
    console.log(`✓ ${id} (${intel[id].verdict_tag}) → ${r.status} · ${saved}`);
    ok++;
  } catch (e) {
    console.error(`✗ ${id} → ${e.message}`); fail++;
  }
}

console.log(`\nDone: ${ok} ok, ${fail} failed, ${ids.length} total.`);
