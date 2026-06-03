# WP-FONTS-001 — Host the Oskar Curated Font Library

**Owner:** Jedi Claude (engineering)
**Requested by:** Jedi Master Vader (Ralph) via CD
**Status:** READY-FOR-EXECUTION
**Estimated effort:** 4-5 hours
**Date opened:** 2026-05-19
**Last revised:** 2026-05-19 (pivot back to curated-only — see Revision Note)

---

## Revision Note (2026-05-19)

Two pivots since the original draft:

1. Original plan was "host the 50 best families, LT-cuts only." After CD audited the disk (1,078 family folders), the list grew to **~80 curated families plus DINPro** — the omissions CD found (Agfa Rotis superfamily, Bell Gothic, Antique Olive, ITC Officina Serif, Aldus, Apollo, Berling, Plantin, Ehrhardt, Adobe Jenson Pro, Rockwell, Clarendon, Memphis, Joanna, Perpetua, ITC Bookman, Times Eighteen, Linotype Audio Pi, Frutiger Symbols/Stones) all earned slots.

2. Original interim plan was "host EVERYTHING, declare a curated Tier 1." Reversed. **We host ONLY the curated list — nothing else.** The library is the constraint and the constraint is the point. If a future vibe-spec needs a long-tail family, the path is WP-FONTS-EXTEND, not a `/fonts/lib/` smuggle-route. (See `skills/references/fonts.md` §6.)

---

## Why this exists

The Linotype 2002 Library + Adobe Pro extras + DIN cuts + DINPro sit converted (or ready-to-convert) on disk — **not reachable by the Node-Server.** Every vibe falls back to Google Fonts (Inter, Instrument Serif, JetBrains Mono), which bakes the AI-default signal CD has been trying to escape into every build, and breaks any school-anchor whose tradition isn't Helvetica-family.

The library has the legitimate cousins already: **Univers** (Akzidenz), **Sabon** (book serif), **Bembo** (Aldine ETBembo-origin), **DINPro** + **DIN 1451** (engineering), **Letter Gothic** (mono), **Agfa Rotis** (the only four-genre superfamily we have), plus ~70 more pedigreed families. **What's missing is the hosting layer for the curated set, the `@font-face` declarations in `hosted-fonts.css`, and DINPro's TTF→woff2 conversion.**

## First move — Force Anchor

Before trusting any count in this doc: read `fonts/_otf/_convert-summary.json` and walk `fonts/_otf/` to confirm what's actually on disk. Two specific checks:

1. **Verify every family in the Tier 1 list (§"Tier 1 — the curated set" below) resolves** to a folder under `fonts/_otf/<letter>/<family-name>/`. Log any miss.
2. **Verify `_top/` contains the Adobe Pro + DIN direct woff2s** (ACaslonPro, AGaramondPro, AJensonPro, DINEngschrift, DINMittelschrift, DINNeuzeitGrotesk).
3. **DINPro is NOT in `fonts/_otf/`.** Source files live at `/Users/ralphlengler/OskarOS/.claude/worktrees/*/fonts/DINPro-*.ttf` — 5 weights (Light, Regular, Medium, Bold, Black) as TTF. Pick any worktree as the canonical source (they're identical copies); convert all 5 to woff2 as part of this WP.

Log any Tier 1 family that fails to resolve. Substitute intelligently from the closest sibling on disk; document the substitution in the completion report.

---

## Goal (one sentence)

**Copy the ~80 curated families from `fonts/_otf/` to `public/fonts/`, convert DINPro's 5 TTFs to woff2, declare every cut in `hosted-fonts.css`, and ship a manifest + license note. Nothing else ships.**

---

## Architecture — one zone, curated only

```
public/fonts/
  hosted-fonts.css      ← @font-face declarations for the ~80 curated families
  manifest.json         ← inventory of what hosted-fonts.css declares (curated set only)
  LICENSE-NOTE.md       ← one-paragraph license disclosure
  families/             ← woff2 + otf files, grouped by family-slug
    univers/
      UniversLT-Light.woff2
      UniversLT-Light.otf
      UniversLT-Roman.woff2
      ...
    agfa-rotis-sans-serif/
      ...
    dinpro/
      DINPro-Light.woff2          ← converted from TTF in this WP
      DINPro-Regular.woff2
      DINPro-Medium.woff2
      DINPro-Bold.woff2
      DINPro-Black.woff2
    sabon/
      Sabon-Roman.woff2
      Sabon-Italic.woff2
      SabonOsF-Roman.woff2        ← OsF as separate file
      SabonSC-Roman.woff2         ← SC as separate file
      ...
```

**Key rules:**
- ONLY the families in §"Tier 1 — the curated set" ship. Nothing else from `fonts/_otf/` is copied.
- **Latin cuts only.** No Cyr / Greek / CE / multilingual variants in v1 (a vibe that needs them files WP-FONTS-MULTILANG).
- Both `.woff2` and `.otf` copy. WebDev defaults to woff2; OTF available for downstream pipelines (Figma sync, PDF export).
- Family-folder is kebab-case slug of the family name. `Agfa Rotis Sans Serif` → `agfa-rotis-sans-serif/`. `ITC Founders Caslon 12` → `itc-founders-caslon-12/`.
- Original filenames preserved verbatim within the folder — the suffixes (`-OsF`, `-SC`, `-LT`) carry encoding info, don't normalize them.

---

## Deliverables (4 artifacts)

1. **`public/fonts/families/`** — woff2 + otf copies of the ~80 curated families, organized by family-slug folder. Original filenames preserved. Latin cuts only.

2. **`public/fonts/hosted-fonts.css`** — central `@font-face` declaration file. Declares every cut of every Tier 1 family. One `<link rel="stylesheet" href="/fonts/hosted-fonts.css">` in a vibe HTML's `<head>` and all families resolve by name. Includes `font-display: block` (typography IS the brand — no Arial flash before Univers loads; all woff2 self-hosted so the wait is sub-100ms), correct `font-weight` + `font-style` per cut, CSS custom-property aliases for common roles (`--font-grotesk`, `--font-book`, `--font-mono`, `--font-engineering`, etc.). All `src: url(...)` paths point into `/fonts/families/<slug>/...`.

3. **`public/fonts/manifest.json`** — machine-readable inventory of what `hosted-fonts.css` declares (the curated set, ~80 families, ~500+ cuts). Each family entry lists available cuts (weight + style + variant) and the CSS family-name to reference.

4. **`public/fonts/LICENSE-NOTE.md`** — one-paragraph disclosure of source library origin + Oskar internal-prototype scope. Not legal advice.

---

## DINPro — special handling (only family not in `fonts/_otf/`)

DINPro is the only Tier 1 family that requires a conversion step in this WP. The others are already woff2 on disk.

**Source:** `/Users/ralphlengler/OskarOS/.claude/worktrees/<any-worktree>/fonts/DINPro-*.ttf`. Pick any worktree — they're identical copies of the same 5 TTF files (Light, Regular, Medium, Bold, Black). Suggested: `.claude/worktrees/quirky-payne-8d3aa3/fonts/DINPro-*.ttf`.

**Conversion:** TTF → woff2 via the same tool used for the Linotype conversion (`woff2_compress` or whatever produced the existing `_convert.log` outputs). Output to `public/fonts/families/dinpro/`.

**Weight mapping (TTF filename → CSS `font-weight`):**
- DINPro-Light.ttf → 300
- DINPro-Regular.ttf → 400
- DINPro-Medium.ttf → 500
- DINPro-Bold.ttf → 700
- DINPro-Black.ttf → 900

No italic / oblique cuts in the source — all 5 are upright Roman.

**`@font-face` declarations:** standard pattern, one block per weight, all `font-style: normal`.

Also: copy the TTF originals into `public/fonts/families/dinpro/` alongside the woff2s. Some downstream pipelines want TTF; OTF doesn't exist for DINPro.

---

## Non-goals (NOT in this WP)


- ❌ Variable-font conversion — all cuts ship as static `@font-face` entries
- ❌ Subset generation — host the woff2s as-converted
- ❌ Refactor existing vibe HTMLs — that's WP-FONTS-USE-001, downstream
- ❌ License review — `LICENSE-NOTE.md` is disclosure, not legal advice

---

## Tier 1 — the curated set (~80 families, declared in `hosted-fonts.css`)

This is the complete list. Nothing outside this list ships. The list is the contract.

Categorized by register. Jedi Claude verifies each is present in `fonts/_otf/` (or `_top/` for the Adobe Pro + DIN cuts, or `.claude/worktrees/*/fonts/` for DINPro) and declares ALL its standard cuts (Roman / Italic / Bold / BoldItalic minimum; more weights if available). For families with optical-size variants (Bembo, ITC Bodoni, ITC Founders Caslon, AJenson Pro, Times Ten / Times Eighteen), declare all sizes — they're irreplaceable. For families with OsF / SC variants (Sabon, Bembo, Janson Text, Stempel Garamond), declare them as separate family-names (`'Sabon OsF'`, `'Sabon SC'`) per the OpenType decision in §"Decisions" below.

### Grotesk / Modern Sans (22 families)

| # | Family | Why it's here |
|---|---|---|
| 1 | Univers | Akzidenz-tradition flagship (Frutiger 1957). THE Söhne substitute |
| 2 | Neue Helvetica | Universal modernist sans (Miedinger refined 1983) |
| 3 | Helvetica | Original 1957 cut |
| 4 | Trade Gothic | Akzidenz-cousin compressed grotesk (Burke 1948) |
| 5 | Frutiger | Humanist signage (Frutiger 1976) |
| 6 | Avenir | Geometric humanist (Frutiger 1988) |
| 7 | Futura | Bauhaus geometric (Renner 1927) |
| 8 | Gill Sans | British humanist (Gill 1928) |
| 9 | ITC Franklin Gothic | American grotesk revival |
| 10 | ITC Avant Garde Gothic | Lubalin/Carnase 1970, ligatures-rich |
| 11 | ITC Officina Sans | Spiekermann 1990 |
| 12 | ITC Stone Sans | Sumner Stone 1987 |
| 13 | News Gothic | American Akzidenz-cousin (Benton 1908) |
| 14 | Folio | Akzidenz revival (Bauer 1957) |
| 15 | DIN 1451 Engschrift | German Industrial Standard, narrow (1931). NON-NEGOTIABLE |
| 16 | DIN 1451 Mittelschrift | German Industrial Standard, workhorse (1931). NON-NEGOTIABLE |
| 17 | DIN Neuzeit Grotesk | Pischner 1928 — the original DIN before the standard |
| 18 | **DINPro** | **Paratype 1995 — modern OpenType DIN, 5 weights (Light/Regular/Medium/Bold/Black). NEEDS TTF→woff2 conversion in this WP.** Source: `.claude/worktrees/*/fonts/DINPro-*.ttf` |
| 19 | Myriad | Slimbach/Twombly 1992, modern workhorse |
| 20 | Bell Gothic | Matthew Carter 1937 — American phone-book grotesk, signage-legibility |
| 21 | Bell Centennial | Carter 1978 — Bell Gothic's successor for AT&T directory |
| 22 | Antique Olive | Excoffon 1962 — French humanist sans, Paris not Düsseldorf |

### Humanist / Soft Sans + Cross-genre Superfamilies (8 families)

| # | Family | Why |
|---|---|---|
| 22 | Optima | Zapf 1958 — humanist serif-without-serifs |
| 23 | PMN Caecilia | Noordzij 1990 — humanist slab |
| 24 | ITC Stone Serif | Companion to Stone Sans, 1987 |
| 25 | ITC Officina Serif | Spiekermann 1990 — companion to Officina Sans, single-voice pairing |
| 26 | Agfa Rotis Sans Serif | Otl Aicher 1989 — sans member of the only complete four-genre superfamily we have |
| 27 | Agfa Rotis Semisans | The humanist-leaning sans of the Rotis superfamily |
| 28 | Agfa Rotis Semi Serif | The serif-with-vestigial-stems middle ground |
| 29 | Agfa Rotis Serif | The full serif. Pair any two Rotis cuts — they read as sisters across genres |

### Old-Style Book Serif (17 families)

| # | Family | Why |
|---|---|---|
| 30 | Sabon | Tschichold 1967 — universal book serif. Includes OsF + SC cuts |
| 31 | Stempel Garamond | Frankfurt-cut Garamond — harder than Adobe |
| 32 | Bembo | Aldine 1495 / Morison 1928. **ETBembo origin.** Includes OsF + ExtraBold |
| 33 | Adobe Caslon Pro | English Old-style (Slimbach digitization). In `_top/` folder |
| 34 | ITC Founders Caslon (12, 30, 42) | **Optical-size cuts** — historical punchcut sizes. Irreplaceable |
| 35 | Caslon Classico | Schmid 1990 — modern Caslon counterpoint to the historical Founders cuts |
| 36 | Adobe Garamond Pro | Slimbach 1989 Garamond. In `_top/` folder |
| 37 | ITC Garamond | Tony Stan 1975 — distinctively-ITC Garamond, different voice from Adobe/Stempel |
| 38 | Garamond 3 | Linotype's Granjon-derived Garamond — third Garamond voice |
| 39 | Stempel Schneidler | Schneidler 1936 — Venetian-tradition |
| 40 | Janson Text | Kis 1685 / Hell digitization, includes OsF + SC |
| 41 | ITC New Baskerville | Modernized Baskerville |
| 42 | Centaur | Bruce Rogers 1914 — Venetian classic |
| 43 | Aldus | Zapf — Palatino's lighter sister, distinct body-copy register |
| 44 | Apollo | Frutiger 1962 — underused book-serif |
| 45 | Berling | Forsberg 1951 — Swedish humanist serif |
| 46 | Plantin | Monotype 1913 — English book-typography classic |
| 47 | Ehrhardt | Monotype's Janson-cousin — editorial book voice |
| 48 | Adobe Jenson Pro | Slimbach optical-size Venetian. Six size grades. In `_top/` folder |

### Modern / Transitional / High-Contrast Serif (5 families)

| # | Family | Why |
|---|---|---|
| 49 | Bauer Bodoni | Bauer Foundry 1926 cut |
| 50 | ITC Bodoni (Six, Twelve, Seventytwo) | **Optical-size cuts.** Irreplaceable for editorial work |
| 51 | Linotype Didot | Didot-revival, fashion-editorial high-contrast |
| 52 | Walbaum | German Didot-cousin |
| 53 | Linotype Centennial | Linotype's 100-year anniversary face |

### Slab / Geometric Serif (7 families)

| # | Family | Why |
|---|---|---|
| 54 | ITC Lubalin Graph | Lubalin 1974 — display slab |
| 55 | Glypha | Frutiger 1979 — clean slab |
| 56 | ITC American Typewriter | Joel Kaden 1974 — typewriter-stylization |
| 57 | Rockwell | Pierpont 1934 — the canonical geometric slab |
| 58 | Clarendon | Besley 1845 — bracketed slab, headline voice |
| 59 | Memphis | Wolf 1929 — geometric slab, Bauhaus-era |
| 60 | Joanna | Gill 1930 — British editorial serif with slab DNA |

### Display Serif (Italian/Renaissance/Editorial) (7 families)

| # | Family | Why |
|---|---|---|
| 61 | Palatino | Zapf 1948 — Italian Renaissance modern |
| 62 | Minion | Slimbach 1990 — Aldine-Renaissance |
| 63 | Times Ten | Optical-size cut of Times (10pt body specifically) |
| 64 | Times Eighteen | Optical-size Times for 18pt display — better than Times Ten enlarged |
| 65 | ITC Mendoza Roman | Mendoza 1991 — French humanist |
| 66 | Galliard | Carter 1978 — Granjon-revival |
| 67 | ITC Bookman | American magazine workhorse — distinct register |
| 68 | Perpetua | Gill 1925 — British editorial classic |

### Inscriptional / Display (2 families)

| # | Family | Why |
|---|---|---|
| 69 | Trajan | Twombly 1989 — Roman inscriptional capitals |
| 70 | Augustea Open | Aldo Novarese 1951 — inline display |

### Mono / Typewriter (3 families)

| # | Family | Why |
|---|---|---|
| 71 | Letter Gothic | IBM 1956 — typewriter mono with real italic-slant |
| 72 | Courier | The OG typewriter mono |
| 73 | LinoLetter | Rare Linotype mono — Hans Eduard Meier 1992 |

### Script / Editorial Display (3 families)

| # | Family | Why |
|---|---|---|
| 74 | ITC Edwardian Script | Don't laugh — useful for select editorial-tier branding work |
| 75 | Künstler Script | Hans Bohn 1957 — Pelikan/Pelican-aesthetic |
| 76 | Snell Roundhand | Matthew Carter 1965 — best-of-class formal script |

### Pi / Symbol families (3 families)

| # | Family | Why |
|---|---|---|
| 77 | Linotype Audio Pi | Audio-related glyphs. Useful for non-AI-default vibe iconography |
| 78 | Frutiger Symbols | Geometric symbol set in Frutiger DNA |
| 79 | Frutiger Stones | Decorative ornament set, Frutiger lineage |

**Total: ~80 families in the curated set (including DINPro).** Nothing outside this list ships. Substitution rule for any family that fails to resolve on disk is in "First move — Force Anchor" above.

---

## File structure (Jedi Claude implements this)

```
public/fonts/
  hosted-fonts.css          ← @font-face declarations for all ~80 curated families
  manifest.json             ← machine-readable inventory of the curated set
  LICENSE-NOTE.md           ← one-paragraph disclosure
  families/                 ← woff2 + otf grouped by family-slug
    univers/
      UniversLT-Light.woff2
      UniversLT-Light.otf
      UniversLT-Roman.woff2
      UniversLT-Roman.otf
      ...
    neue-helvetica/
      ...
    agfa-rotis-sans-serif/
      ...
    agfa-rotis-serif/
      ...
    dinpro/                 ← TTF→woff2 conversion happens in this WP
      DINPro-Light.ttf
      DINPro-Light.woff2
      DINPro-Regular.ttf
      DINPro-Regular.woff2
      DINPro-Medium.ttf
      DINPro-Medium.woff2
      DINPro-Bold.ttf
      DINPro-Bold.woff2
      DINPro-Black.ttf
      DINPro-Black.woff2
    sabon/
      Sabon-Roman.woff2
      Sabon-Italic.woff2
      SabonOsF-Roman.woff2  ← OsF cut as separate file, declared as 'Sabon OsF' in CSS
      SabonSC-Roman.woff2   ← SC cut as separate file, declared as 'Sabon SC' in CSS
      ...
    adobe-caslon-pro/       ← from fonts/_otf/_top/
      ACaslonPro-Regular.woff2
      ...
    bembo/, sabon/, ...
```

**Naming conventions:**

- **Family folder slugs:** kebab-case of the family name. `Univers` → `univers/`. `Stempel Garamond` → `stempel-garamond/`. `Agfa Rotis Sans Serif` → `agfa-rotis-sans-serif/`. `ITC Founders Caslon 12` → `itc-founders-caslon-12/`. **`DINPro` → `dinpro/`.**
- **File names:** keep original verbatim (e.g. `UniversLT-Light.woff2`). The filename suffixes carry encoding info — `LT` = Latin Text, `-OsF` = Old-style figures, `-SC` = Small caps. Don't rename.
- **Source paths.** Most families come from `fonts/_otf/<letter>/<family-folder>/`. Adobe Pro fonts + DIN direct cuts come from `fonts/_otf/_top/`. **DINPro comes from `.claude/worktrees/<any-worktree>/fonts/DINPro-*.ttf` and gets converted in this WP.**
- **Latin cuts only.** Skip Cyr / Greek / CE / multilingual files in source folders.
- **Copy, don't move.** Originals stay put. `public/fonts/families/` is a copy.

---

## `hosted-fonts.css` content (Jedi Claude generates)

Generate **one `@font-face` block per cut, per family**, with the curated set above. Example pattern:

```css
/* ═══════ Univers ═══════ */
@font-face {
  font-family: 'Univers';
  src: url('/fonts/families/univers/UniversLT-Light.woff2') format('woff2');
  font-weight: 300;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: 'Univers';
  src: url('/fonts/families/univers/UniversLT-Roman.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
/* ... Medium (500), Bold (700), Black (900), and all -Oblique → font-style: italic ... */

/* ═══════ DINPro (converted in this WP) ═══════ */
@font-face {
  font-family: 'DINPro';
  src: url('/fonts/families/dinpro/DINPro-Light.woff2') format('woff2');
  font-weight: 300;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: 'DINPro';
  src: url('/fonts/families/dinpro/DINPro-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
/* ... Medium (500), Bold (700), Black (900) — all font-style: normal, no italics ... */

/* ═══════ Adobe Caslon Pro ═══════ */
@font-face {
  font-family: 'Adobe Caslon Pro';
  src: url('/fonts/families/adobe-caslon-pro/ACaslonPro-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
/* ... */
```

**Weight mapping** (filename token → CSS numeric):
- Thin / Ultra Light → 100
- Extra Light → 200
- Light → 300
- Roman / Regular / Book → 400
- Medium → 500
- Demibold / Semibold → 600
- Bold → 700
- Ultra / ExtraBold → 800
- Heavy / Black → 900

**Italic / Oblique mapping:** any cut with `-Italic`, `-Oblique`, `-It`, `-Obl` in the filename → `font-style: italic`.

**OsF and SC variants:** SEPARATE family-names (`'Sabon OsF'`, `'Sabon SC'`, `'Bembo OsF'`, `'Bembo SC'`, `'Janson Text OsF'`, `'Janson Text SC'`, `'Stempel Garamond OsF'`, `'Stempel Garamond SC'`) — these old cuts predate OpenType layout tables; `font-variant-numeric` / `font-variant-caps` won't fire. Document in skill MD §5 (already written).

**CSS Custom Properties (at the bottom of `hosted-fonts.css`):**

```css
:root {
  /* Grotesk register */
  --font-grotesk: 'Univers', 'Helvetica Neue', 'Arial', sans-serif;
  --font-grotesk-cond: 'Trade Gothic Cond', 'Univers Cond', 'Arial Narrow', sans-serif;
  --font-grotesk-display: 'Trade Gothic Bold', 'Univers Bold', sans-serif;
  --font-signage: 'Bell Gothic', 'Bell Centennial', 'Trade Gothic', sans-serif;

  /* Humanist sans */
  --font-humanist: 'Gill Sans', 'Optima', 'Antique Olive', sans-serif;
  --font-geometric: 'Avenir', 'Futura', sans-serif;
  --font-rotis-sans: 'Agfa Rotis Sans Serif', 'Agfa Rotis Semisans', sans-serif;
  --font-rotis-serif: 'Agfa Rotis Serif', 'Agfa Rotis Semi Serif', serif;

  /* Industrial / Engineering */
  --font-engineering: 'DINPro', 'DIN 1451 Mittelschrift', 'DIN Neuzeit Grotesk', sans-serif;
  --font-engineering-narrow: 'DIN 1451 Engschrift', 'DIN 1451 Mittelschrift', sans-serif;

  /* Book serif */
  --font-book: 'Sabon', 'Stempel Garamond', 'Adobe Garamond Pro', Georgia, serif;
  --font-aldine: 'Bembo', 'Centaur', 'Adobe Jenson Pro', serif;
  --font-caslon: 'Adobe Caslon Pro', 'ITC Founders Caslon 12', 'Caslon Classico', serif;
  --font-editorial-book: 'Plantin', 'Ehrhardt', 'Joanna', serif;

  /* Display serif */
  --font-didone: 'Linotype Didot', 'Bauer Bodoni', 'ITC Bodoni Twelve', serif;
  --font-slab: 'ITC Lubalin Graph', 'Rockwell', 'Glypha', serif;
  --font-slab-bracketed: 'Clarendon', 'Memphis', serif;
  --font-inscriptional: 'Trajan', 'Augustea Open', serif;
  --font-times-display: 'Times Eighteen', 'Times Ten', serif;

  /* Mono */
  --font-mono: 'Letter Gothic', 'Courier', monospace;
}
```

These variables are the CD/WebDev interface — anything else is an implementation detail.

---

## `manifest.json` schema

Inventories ONLY the curated set (what `hosted-fonts.css` declares). No long-tail entries.

```json
{
  "version": "1.0",
  "generated": "2026-05-19T...",
  "source": "Linotype 2002 + Adobe Pro + DIN cuts + DINPro (Paratype 1995)",
  "totals": {
    "families": 80,
    "cuts": 500
  },
  "families": {
    "Univers": {
      "css_name": "Univers",
      "folder": "/fonts/families/univers",
      "designer": "Adrian Frutiger",
      "year": 1957,
      "category": "grotesk",
      "tradition": "akzidenz-grotesk",
      "cuts": [
        { "weight": 300, "style": "normal", "woff2": "/fonts/families/univers/UniversLT-Light.woff2", "otf": "/fonts/families/univers/UniversLT-Light.otf" },
        { "weight": 400, "style": "normal", "woff2": "/fonts/families/univers/UniversLT-Roman.woff2", "otf": "/fonts/families/univers/UniversLT-Roman.otf" }
      ]
    },
    "DINPro": {
      "css_name": "DINPro",
      "folder": "/fonts/families/dinpro",
      "designer": "Paratype",
      "year": 1995,
      "category": "grotesk",
      "tradition": "din",
      "source_format": "ttf-converted",
      "cuts": [
        { "weight": 300, "style": "normal", "woff2": "/fonts/families/dinpro/DINPro-Light.woff2", "ttf": "/fonts/families/dinpro/DINPro-Light.ttf" },
        { "weight": 400, "style": "normal", "woff2": "/fonts/families/dinpro/DINPro-Regular.woff2", "ttf": "/fonts/families/dinpro/DINPro-Regular.ttf" },
        { "weight": 500, "style": "normal", "woff2": "/fonts/families/dinpro/DINPro-Medium.woff2", "ttf": "/fonts/families/dinpro/DINPro-Medium.ttf" },
        { "weight": 700, "style": "normal", "woff2": "/fonts/families/dinpro/DINPro-Bold.woff2", "ttf": "/fonts/families/dinpro/DINPro-Bold.ttf" },
        { "weight": 900, "style": "normal", "woff2": "/fonts/families/dinpro/DINPro-Black.woff2", "ttf": "/fonts/families/dinpro/DINPro-Black.ttf" }
      ]
    },
    "Sabon OsF": {
      "css_name": "Sabon OsF",
      "folder": "/fonts/families/sabon",
      "variant_of": "Sabon",
      "variant": "old-style-figures",
      "cuts": [ "..." ]
    }
  }
}
```

**Generation rule:** walk `public/fonts/families/` recursively, parse filenames for weight/style/variant hints, produce the manifest entry per family.

**Naming hint extraction (apply in this order):**
- Filename contains `-OsF` or `OsF-` → emit as SEPARATE entry with `css_name: '<Family> OsF'` and `variant: "old-style-figures"`
- Filename contains `-SC` or `SC-` → emit as SEPARATE entry with `css_name: '<Family> SC'` and `variant: "small-caps"`
- Filename suffix `Italic | Oblique | -It | -Obl` → `style: italic`; else `normal`
- Filename weight token (`Light | Roman | Regular | Book | Medium | Demibold | Semibold | Bold | Heavy | Black | ExtraBold | Ultra`) → numeric weight per §"Weight mapping" above
- Default if nothing matches: `weight: 400, style: normal`

CD and WebDev read `manifest.json` to introspect what's hosted without parsing CSS.

---

## `skills/references/fonts.md` — already written by CD

This skill MD lives at `skills/references/fonts.md` and is CD's deliverable, already on disk. **Jedi Claude's responsibility is to verify the skill MD doesn't drift from `hosted-fonts.css`** — every family-name and `--font-*` CSS variable cited in the skill MD must resolve to a real `@font-face` declaration in the CSS. Any mismatch is a bug; flag in the WP completion report.

Don't rewrite the skill MD. If you find a drift, decide: is the CSS wrong (fix CSS) or is the skill MD wrong (open a follow-up note for CD to fix)? Most drifts will be CSS being missing a family the skill MD promises — fix the CSS, not the docs.

---

## Acceptance criteria (how we know it's done)

1. ✅ `public/fonts/families/` exists with one sub-folder per curated family (~80 folders total). Each folder contains the family's woff2 + otf (+ ttf for DINPro) for every cut.
2. ✅ DINPro folder (`public/fonts/families/dinpro/`) contains 5 woff2 files (Light/Regular/Medium/Bold/Black) freshly converted from the TTF sources at `.claude/worktrees/*/fonts/DINPro-*.ttf`, plus the original 5 TTFs.
3. ✅ `public/fonts/hosted-fonts.css` exists and contains `@font-face` declarations for every cut of every curated family (~500+ blocks). All `src: url(...)` paths point into `/fonts/families/<slug>/...`. Includes the `:root { --font-* }` custom-property block at the bottom.
4. ✅ `public/fonts/manifest.json` exists, validates as JSON, inventories exactly the curated set (~80 families). Each family entry has `css_name`, `folder`, `cuts[]`. Tier 1 families have full metadata (designer, year, category, tradition). OsF / SC variants emitted as separate entries.
5. ✅ `public/fonts/LICENSE-NOTE.md` exists with one-paragraph origin + scope disclosure.
6. ✅ Loading a fresh test HTML with `<link rel="stylesheet" href="/fonts/hosted-fonts.css">` and `font-family: Univers;` renders Univers (not system fallback). Same for `font-family: 'DINPro'; font-weight: 500;` (must render the converted Medium) and `font-family: 'Agfa Rotis Serif';`. Verify via Playwright screenshot.
7. ✅ Skill MD `skills/references/fonts.md` doesn't drift from CSS — every family-name and `--font-*` variable cited in the skill MD resolves to a real declaration in `hosted-fonts.css`. Spot-check 10 random citations.
8. ✅ Integration test: open `vibe-19-boom-buchwerk.html`, swap `<link>` from Google to `/fonts/hosted-fonts.css`, hard-refresh — Univers + Sabon + Bembo + Letter Gothic render in declared roles.
9. ✅ Network panel: `hosted-fonts.css` loads in <300ms locally; woff2s lazy-load only when actually requested by a `font-family` rule (not pre-fetched).

---

## Decisions (already made — implement as written)

1. **Naming collisions.** "Bembo Bold" = weight 700. "Bembo ExtraBold" = weight 800. Document mapping in `manifest.json`.
2. **Optical-size cuts** (ITC Founders Caslon 12/30/42; ITC Bodoni Six/Twelve/Seventytwo). Each size is its OWN CSS family-name (`'ITC Founders Caslon 12'`), NOT a weight on a shared family. Document in skill MD §2.
3. **OsF and SC variants.** Separate family-names (`'Sabon OsF'`, `'Sabon SC'`), NOT `font-variant-numeric` switches — these pre-OT cuts don't carry the layout tables. They're separate fonts; treat them as such.
4. **CE / Cyr variants.** Skipped in v1 (see Non-goals). Future multilingual need → WP-FONTS-MULTILANG.
5. **License notice.** Add `public/fonts/LICENSE-NOTE.md` — one paragraph on Linotype 2002 origin + Oskar internal-prototype-use. Not a legal review.

If Jedi Claude finds a genuine open question during execution (something the disk reveals that this doc didn't anticipate), STOP and surface it before deciding alone.

---

## Estimated effort breakdown

| Task | Estimate |
|---|---|
| Verify all curated families resolve on disk; log substitutions | 30 min |
| Convert DINPro: 5 TTFs → 5 woff2s (`woff2_compress`); copy TTFs + woff2s into `dinpro/` | 20 min |
| Copy curated families from `fonts/_otf/` → `public/fonts/families/<slug>/` (scripted, Latin cuts only) | 45 min |
| Generate `hosted-fonts.css` (script walks the curated list, emits `@font-face` per cut + `:root` variables block) | 75 min |
| Generate `manifest.json` (script walks `public/fonts/families/`, emits per-family entries with OsF/SC split) | 45 min |
| Write `LICENSE-NOTE.md` | 10 min |
| Verify `skills/references/fonts.md` against `hosted-fonts.css` (no drift); spot-check 10 citations | 30 min |
| Test HTML + Playwright verification (Univers + Agfa Rotis Serif + DINPro Medium) | 30 min |
| Patch `vibe-19-boom-buchwerk.html` as integration test | 30 min |
| Buffer for naming quirks (Adobe Pro cuts from `_top/`, DIN cuts from `_top/`, OsF/SC splits, slug collisions) | 45 min |

**Total: ~5.5 hours.**

---

## File locations summary (so Jedi Claude doesn't have to hunt)

| What | Where |
|---|---|
| Most curated families (woff2 + OTF) | `fonts/_otf/<letter>/<family-name>/` |
| Adobe Pro + DIN direct cuts | `fonts/_otf/_top/*.woff2` (ACaslonPro, AGaramondPro, AJensonPro, DINEngschrift, DINMittelschrift, DINNeuzeitGrotesk) |
| **DINPro (TTF source — needs conversion)** | `.claude/worktrees/<any-worktree>/fonts/DINPro-*.ttf` — 5 weights |
| Conversion log (for tool reference) | `fonts/_otf/_convert.log` |
| Conversion summary | `fonts/_otf/_convert-summary.json` |
| Skip-list (faces that failed earlier conversion) | `fonts/_otf/_skip-list.txt` |
| **Destination of curated woff2 + OTF** | `public/fonts/families/<family-slug>/` |
| **Destination of DINPro (TTF + converted woff2)** | `public/fonts/families/dinpro/` |
| **Destination of @font-face CSS** | `public/fonts/hosted-fonts.css` |
| **Destination of inventory JSON** | `public/fonts/manifest.json` |
| **Destination of license notice** | `public/fonts/LICENSE-NOTE.md` |
| **Skill MD (already written by CD)** | `skills/references/fonts.md` |


---

_End of WP-FONTS-001._
