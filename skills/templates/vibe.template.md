<!-- ═══════════════════════════════════════════════════════════════════
  vibe.template.md — SOURCE OF TRUTH for vibe-{n}-{slug}.md files.
  Copy this file, fill every section. Comments explain each field once —
  delete them as you fill. Filename: vibe-{n}-{slug}.md (kebab-case slug
  from the vibe's display name). After writing, append one line to
  CREATIVE-BRIEF.md → ## Vibe Index.
  Format truth lives HERE. If this template and any agent-file prose
  disagree, the template wins.
═══════════════════════════════════════════════════════════════════ -->

## Gallery Card

<!-- FIRST block, always. The Gallery UI parses these seven `Field: value`
     lines; field NAMES are locked, values are curated by hand per vibe.
     CURATE, DON'T EXTRACT — read your own Meta + Design System below,
     then pick what represents the vibe at thumbnail scale. -->

Name: <!-- Display name as a human reads it. NOT the filename slug, NOT "VIBE 8 · …". e.g. RESPAWN POINT -->
One-liner: <!-- The hook, one sentence, card-tight. No sub-clauses past the comma if avoidable. -->
Audience: <!-- Brand persona, ~80 chars. "Saudi/Gulf 18-30, digital-native, esports-adjacent, post-arena crowd" -->
Mood: <!-- 3–5 adjectives, Title-cased, comma-separated (normalize · and — separators to commas). -->
Colors: <!-- Exactly 4: `#HEX (Role Name)`, comma-separated. Role names from THIS vibe's design system (Paper, Ink, Clay Accent…), never generic Primary/Secondary. If the DS has 5+ roles, pick the 4 most representative: most-used background, contrast surface, accent/CTA, body ink. -->
Fonts: <!-- Slash-delimited. Simple: `Display / Body`. Complex: `Display / Subtitle / Body`. Append weight only when load-bearing (`Space Mono 700`). Strip usage notes. Mono omitted unless it IS the heading. -->
Hero: <!-- Filename of the lead image, exact case + extension as on disk. Resolves against CREATIVE-BRIEF.md → ## Image Canon. -->

---

## Strategic Bet

<!-- Seeded VERBATIM from the tc_design_directions payload — no re-derivation. -->
- Bet name: <!-- e.g. The Hospitality Play (NOT a school name) -->
- School anchor: <!-- the perceptual operator -->
- Operator: <!-- what the brand BECOMES through this school — argued, not declared -->
- Argument by failure-mode: <!-- 3–5 paragraphs naming the SPECIFIC failure mode of each other surviving bet for the named personas. The argument IS the commitment. -->
- Competitor-swap property: <!-- state why this bet survives find-replace, as a property of the substrate inventory -->

## The Per-Brand Benchmark

- Provocation: <!-- 1–2 sentences naming specific objects, dates, attributes from the substrate inventory. Verbatim what the page uses. -->
- Reflex CTA: <!-- one line arriving as a body response, same wavelength as the provocation. Every CTA below is a diluted echo of this line. -->

## Meta

- **One-liner:** <!-- this vibe's hook (not the brand's) -->
- **Voice:** <!-- how this version talks — detailed, for WebDev -->
- **Who it's for:** <!-- specific person, detailed, for WebDev -->
- **Audience:** <!-- who they ARE, not what they want: "[demographic], [characteristic]. [Insight]." ✗ "Heritage Seekers" (a want, not a person) -->
- **Personas:** <!-- THREE named people (Sandra, 47, Munich, ex-curator…), each with arrival context (from where, what time, what device), scroll-position feelings ("stops at section 04, 18 seconds in, spends 40 more"), and outcome ("books within 48h"). These govern every copy decision. -->
- **Mood:** <!-- 3–5 adjectives only -->
- **Colors:** <!-- same four as Gallery Card; may expand with semantic roles here -->
- **Fonts:** <!-- same pair as Gallery Card -->
- **Banned vocabulary:** <!-- list the words BY NAME -->

## Design System

<!-- Derived from the bet, NOT picked from a menu. Full fill-in template +
     rules (atmosphere as seed, semantic role names per DESIGN.md standard,
     load-bearing Do's & Don'ts): agents/cd-design-system-and-multipage.md.
     Fill every field — WebDev guesses at blanks, and guesses look generic. -->
- Atmosphere:
- Palette + semantic roles: <!-- Primary / Surface / Background / Ink / Accent — with WHY each role exists per the bet -->
- Typography: <!-- token table: size / family / use per token -->
- Spacing: <!-- scale + reasoning -->
- Components: <!-- each major component: class name + behaviour + dimensions + reasoning -->
- Image treatment:
- Header / Footer:
- Do's / Don'ts:

## Sections

<!-- The emotional journey as a SEQUENCE OF TRIADS, not paragraphs.
     EVERY section specifies all three channels:
       (a) COPY — actual sentences (headline, body, caption, CTA). Every line
           passes Competitor-Swap + Corporate-PR before it survives.
       (b) PICTURE — which image, at what scale (viewport-fraction or aspect
           constraint), what treatment (full-bleed / contained / hover / overlay).
       (c) INTERACTIVITY — what happens on enter/scroll/hover/click.
           Specific pattern + reduced-motion fallback.
     Persona simulation runs against the integrated triad, not the copy alone.
     Standard sections, always present as triads:
       Header/Nav · Hero · Hook · What We Do · How It Works ·
       Products/Services · Location · Booking CTA · Footer -->

## Image Strategy

<!-- Per-photo creative reasoning, NOT slot assignments.
     For each image: WHY this image at THIS scale HERE (sentence-level).
     Hero-picture rule honoured: the hero is a JOB (establish in 3s, set tone,
     earn the scroll) — name which picture is the hero, whether it matches the
     strongest, and if not, which exception applies.
     Resolution discipline: photos scale to viewport, no inline width/height
     below natural scale. Video: named aspect-ratio rule per video.
     Phase 2: subject-matched SVG placeholders. Phase 3: real assets. -->

## Image Assignments

<!-- slot → source filename (sources from CREATIVE-BRIEF.md → ## Image Canon) -->

## Interactivity

<!-- 5–9 named patterns, each: PATTERN + REASON + REDUCED-MOTION FALLBACK.
     "Hero ken-burns ±1% scale over 12s because the room is alive but slow;
     disabled under prefers-reduced-motion." Slop says "subtle animation." -->

## Navigation

<!-- Site header: INLINE HTML, embedded verbatim — never "use existing X"
     (workers strip what reads as boilerplate; inline HTML can't be stripped).
     Per-vibe secondary nav (catalog rail / scroll-progress / drawer / none):
     decided and embedded here. -->

## Pass 1 Reasoning

<!-- WebDev reads this into the Direction Banner. -->
- Voice hypothesis:
- Section flow: <!-- named landmarks in reading order -->
- Anchor: <!-- the un-copyable detail that carries the vibe -->
- Why this beats the alternatives: <!-- recap the failure-mode argument -->
- Banned-vocabulary contract enforced: <!-- yes/no -->
- Hero-picture rule honoured: <!-- which picture, why job-fit, where the strongest lives if not hero -->
- Hero COMBO specified: <!-- layout + copy + interaction + visual, tested as a combo against the personas -->
- Hero pool shopped: <!-- picked from CREATIVE-BRIEF.md ## Hero Candidates, not improvised. If pool was shallow: Nano-brief written + tagged BRIEFING REFERENCE. -->
- Competitor-swap test passed: <!-- yes/no -->
- Triad balance: <!-- picture-strategy + interactivity sections together ≥ copy section by token count (the novel test) -->

## WebDev Build Notes

<!-- With receipts: -->
- File path + cache-bust rule:
- Fonts: <!-- hosted font names + line numbers in fonts.css + source-of-truth clause (project local > global catalog) + no-substitute clause naming the forbidden substitutes -->
- Navigation: <!-- refers to the inline block above -->
- Image references: <!-- explicit file list on disk + no-SVG-placeholders rule (Phase 3 only) -->
- Video preservation: <!-- aspect-ratio + object-fit constraints -->
- Responsive contract: <!-- breakpoints + layout transformations -->
- Resolution discipline: <!-- no inline width=/height= below natural scale -->
- i18n contract:
