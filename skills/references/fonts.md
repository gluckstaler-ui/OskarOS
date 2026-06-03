# Fonts — the Oskar Library

> TIER 2 skill. Read on: typography decisions, school-anchor selection, font-pairing moments, any "what font should I use here" reflex. Don't read mid-build for trivial swaps — read it ONCE at the start of any new vibe-spec where typography is load-bearing.

Oskar self-hosts **~80 curated families** at `/fonts/...` and declares them in `/fonts/hosted-fonts.css`. One `<link>` in `<head>` and every family below resolves by CSS name. The list is deliberate — every family pulls a real 20th-century type tradition the AI default doesn't have. Nothing else loads. No Google Fonts, no Adobe Fonts CDN, no OS fallbacks dressed up as choices.

---

## §1 — How to load (WebDev)

One link in `<head>`:

```html
<link rel="stylesheet" href="/fonts/hosted-fonts.css">
```

That's it. All ~80 hosted families now resolve by CSS `font-family` name.

**Do:**
- `font-display: block` is already baked into every `@font-face` block (NOT `swap` — typography IS the brand; we don't want a FOUT flash of Arial before Univers loads. All cuts are self-hosted woff2, sub-100ms, the wait is invisible). No action needed.
- Use the `--font-*` CSS custom properties (§4) over hard-coded family names.
- Let the browser lazy-load woff2 files. A 3-4 MB stylesheet of `@font-face` blocks does NOT trigger 3-4 MB of downloads — files only fetch when a `font-family` rule actually requests them.

**Don't:**
- Preload everything. The hosted set is too big; preloading guarantees you wait for fonts the page never uses.
- Add `<font-face>` blocks inside individual vibe HTMLs for hosted families — they're already declared. Adding duplicates causes weight/style collisions.
- Load Google Fonts as a fallback. That defeats the entire point of this library. If the curated set doesn't have what you need, file WP-FONTS-EXTEND (§6) — don't smuggle.

---

## §2 — What's in the box

~80 hosted families across nine registers. Each row: family / designer / year / one-line pairing or use-case note.

### Grotesk / Modern Sans

| Family | Designer / Year | Use it when |
|---|---|---|
| Univers | Frutiger 1957 | Akzidenz-tradition flagship. THE Söhne substitute. |
| Neue Helvetica | Miedinger refined 1983 | Universal modernist sans — when Akzidenz feels too cold. |
| Helvetica | Miedinger 1957 | The original cut. Editorial registers wanting period accuracy. |
| Trade Gothic | Burke 1948 | Akzidenz-cousin condensed grotesk. Pairs killer with Sabon. |
| Frutiger | Frutiger 1976 | Humanist signage. CDG airport. Wayfinding. |
| Avenir | Frutiger 1988 | Geometric humanist. Modern brand-system default. |
| Futura | Renner 1927 | Bauhaus geometric. Pair sparingly — it punches. |
| Gill Sans | Gill 1928 | British humanist. Penguin Books DNA. |
| ITC Franklin Gothic | Benton revival | American grotesk heritage. Newsprint voice. |
| ITC Avant Garde Gothic | Lubalin/Carnase 1970 | Ligature-rich, 1970s editorial. |
| ITC Officina Sans | Spiekermann 1990 | Information-design workhorse. Pair with Officina Serif. |
| ITC Stone Sans | Stone 1987 | Companion-family sans. Pair with Stone Serif. |
| News Gothic | Benton 1908 | American Akzidenz-cousin. Print-newspaper voice. |
| Folio | Bauer 1957 | Akzidenz revival — drier than Univers. |
| DIN 1451 Engschrift | DIN 1931 | German Industrial Standard, narrow. Signage, engineering. |
| DIN 1451 Mittelschrift | DIN 1931 | The DIN workhorse. Engineering-clean. |
| DIN Neuzeit Grotesk | Pischner 1928 | The original DIN before the standard. Softer, more humanist. |
| DINPro | Paratype 1995 | The modern, OpenType-correct DIN with full weight range (Light → Black). The contemporary engineering / wayfinding default. |
| Myriad | Slimbach/Twombly 1992 | Modern workhorse. Apple's pre-SF voice. |
| Bell Gothic | Carter 1937 | American phone-book grotesk. Built for small-size legibility. |
| Bell Centennial | Carter 1978 | Bell Gothic's successor for AT&T directory. |
| Antique Olive | Excoffon 1962 | French humanist sans. The "Paris not Düsseldorf" feel. |

### Humanist / Soft Sans + Cross-genre Superfamilies

| Family | Designer / Year | Use it when |
|---|---|---|
| Optima | Zapf 1958 | Humanist serif-without-serifs. The classy-without-pretense sans. |
| PMN Caecilia | Noordzij 1990 | Humanist slab. Kindle's default for years. |
| ITC Stone Serif | Stone 1987 | Companion-family serif to Stone Sans. |
| ITC Officina Serif | Spiekermann 1990 | Companion-family serif to Officina Sans. Single-voice pairing. |
| **Agfa Rotis Sans Serif** | Aicher 1989 | Sans member of the Rotis superfamily. |
| **Agfa Rotis Semisans** | Aicher 1989 | Humanist-leaning sans, more warmth. |
| **Agfa Rotis Semi Serif** | Aicher 1989 | The serif-with-vestigial-stems middle ground. |
| **Agfa Rotis Serif** | Aicher 1989 | Full serif. Pair ANY two Rotis cuts — they read as sisters across genres. The only complete four-genre superfamily we have. |

### Old-Style Book Serif

| Family | Designer / Year | Use it when |
|---|---|---|
| Sabon | Tschichold 1967 | Universal book serif. OsF + SC cuts included. The Lyon Text substitute. |
| Stempel Garamond | Frankfurt | Harder, more Frankfurt-cut Garamond. Editorial-academic register. |
| Bembo | Aldine 1495 / Morison 1928 | **ETBembo origin.** OsF + ExtraBold included. PP Editorial Old substitute. |
| Adobe Caslon Pro | Slimbach digitization | English Old-style. Constitutional / book-cover voice. |
| ITC Founders Caslon (12, 30, 42) | Optical sizes | Historical punchcut sizes. Use 12 for body, 30 for sub-display, 42 for hero. Irreplaceable. |
| Caslon Classico | Schmid 1990 | Modern Caslon counterpoint to the historical Founders cuts. |
| Adobe Garamond Pro | Slimbach 1989 | The standard Garamond. Different voice from Stempel and ITC. |
| ITC Garamond | Stan 1975 | The distinctively-ITC Garamond. Bolder, more display-leaning. |
| Garamond 3 | Linotype / Granjon-derived | Third Garamond voice, softer than Adobe. |
| Stempel Schneidler | Schneidler 1936 | Venetian-tradition. Renaissance-academic register. |
| Janson Text | Kis 1685 / Hell digitization | OsF + SC included. Dutch tradition. |
| ITC New Baskerville | Modernized | Baskerville for body copy without the period weight. |
| Centaur | Rogers 1914 | Venetian classic. Limited-edition book voice. |
| Aldus | Zapf | Palatino's lighter sister. Distinct from Palatino in body-copy register. |
| Apollo | Frutiger 1962 | Underused book-serif. Reach for it when Garamond feels overused. |
| Berling | Forsberg 1951 | Swedish humanist serif. Sober, considered. |
| Plantin | Monotype 1913 | English book-typography classic. Penguin DNA. |
| Ehrhardt | Monotype | Janson-cousin. Editorial book voice. |
| Adobe Jenson Pro | Slimbach optical | Venetian, six optical sizes. The most considered book serif we have. |

### Modern / Transitional / High-Contrast Serif

| Family | Designer / Year | Use it when |
|---|---|---|
| Bauer Bodoni | Bauer 1926 | The canonical Bodoni cut. Fashion-editorial hero. |
| ITC Bodoni (Six, Twelve, Seventytwo) | Optical sizes | Irreplaceable for editorial. Use Six at small body, Twelve for general, Seventytwo for hero. |
| Linotype Didot | Didot revival | Fashion-magazine high-contrast. Vogue / Harper's DNA. |
| Walbaum | German Didot-cousin | The Didot alternative. Slightly less knife-edge. |
| Linotype Centennial | Linotype | Linotype's 100-year anniversary face. Body-serif workhorse with modernist DNA. |

### Slab / Geometric Serif

| Family | Designer / Year | Use it when |
|---|---|---|
| ITC Lubalin Graph | Lubalin 1974 | Display slab. 1970s editorial-poster register. |
| Glypha | Frutiger 1979 | Clean slab. Works in body copy unlike most slabs. |
| ITC American Typewriter | Kaden 1974 | Typewriter-stylization without going full Courier. |
| Rockwell | Pierpont 1934 | The canonical geometric slab. Industrial heritage. |
| Clarendon | Besley 1845 | Bracketed slab. Old-West / vintage-editorial. |
| Memphis | Wolf 1929 | Bauhaus-era geometric slab. |
| Joanna | Gill 1930 | British editorial serif with slab DNA. |

### Display Serif (Italian / Renaissance / Editorial)

| Family | Designer / Year | Use it when |
|---|---|---|
| Palatino | Zapf 1948 | Italian Renaissance modern. Body-serif of the educated. |
| Minion | Slimbach 1990 | Aldine-Renaissance. Quiet, well-considered. |
| Times Ten | Optical cut | Times designed for 10pt body specifically. Use over plain Times. |
| Times Eighteen | Optical cut | Times for 18pt display. Better than Times Ten enlarged. |
| ITC Mendoza Roman | Mendoza 1991 | French humanist. Subtle, considered. |
| Galliard | Carter 1978 | Granjon-revival. Editorial-historical voice. |
| ITC Bookman | American | The magazine workhorse. Distinct register from Garamond/Caslon. |
| Perpetua | Gill 1925 | British editorial classic. Pairs with Gill Sans. |

### Inscriptional / Display

| Family | Designer / Year | Use it when |
|---|---|---|
| Trajan | Twombly 1989 | Roman inscriptional capitals. Movie-poster / institutional. |
| Augustea Open | Novarese 1951 | Inline display. Use sparingly, very voiced. |

### Mono / Typewriter

| Family | Designer / Year | Use it when |
|---|---|---|
| Letter Gothic | IBM 1956 | Typewriter mono with real italic-slant (not slanted Roman). The GT Pressura Mono substitute. |
| Courier | The OG | Document / legal / period-correct typewriter. |
| LinoLetter | Meier 1992 | Rare Linotype mono. Tighter than Letter Gothic. |

### Script / Editorial Display

| Family | Designer / Year | Use it when |
|---|---|---|
| ITC Edwardian Script | ITC | Don't laugh — useful for select editorial-tier branding work. |
| Künstler Script | Bohn 1957 | Pelikan / formal-stationery aesthetic. |
| Snell Roundhand | Carter 1965 | Best-of-class formal script. The wedding-invitation reference. |

### Pi / Symbol families

| Family | Designer / Year | Use it when |
|---|---|---|
| Linotype Audio Pi | Linotype | Audio-related glyphs. Useful for non-AI-default vibe iconography. |
| Frutiger Symbols | Frutiger | Geometric symbol set in Frutiger DNA. |
| Frutiger Stones | Frutiger | Decorative ornament set, Frutiger lineage. |

---

## §3 — How to pick (CD)

### School-Anchor → Linotype substitute mapping

When a vibe-spec wants a proprietary font that we don't have license to ship, swap to the closest Linotype cousin. Use this table as the canonical mapping:

| School / Proprietary anchor | Linotype substitute |
|---|---|
| **Söhne / Akzidenz-Grotesk** | **Univers** (Light Italic for editorial register, Bold for display) — OR **Neue Helvetica** if Akzidenz-warmth is too soft. **Bell Gothic** if the register is signage / small-size. |
| **Lyon Text / GT Sectra** | **Sabon** with OsF + SC variants. **Adobe Jenson Pro** if more historical. |
| **PP Editorial Old / ETBembo** | **Bembo** with ExtraBold for display. **Apollo** as an underused alternative. |
| **GT Pressura Mono / JetBrains Mono** | **Letter Gothic** for warm-typewriter register; **DINPro Medium** for engineering-clean register (or **DIN 1451 Mittelschrift** for the historical cut). |
| **FF DIN / DIN Next** | **DINPro** — full weight range, OpenType-correct, modern. The right answer when the spec wants DIN-family but needs Light or Black weights. |
| **Pentagram-style Display Serif** | **Linotype Didot** OR **Bauer Bodoni** OR **ITC Bodoni Seventytwo** (use the optical-size cut). |
| **Boom / Martens-tier Editorial Mix** | **Trade Gothic Cond + Sabon + Bembo Italic + Letter Gothic** — the Akzidenz-Buchwerk recipe. |
| **Inscriptional / Institutional** | **Trajan** (display) + **Adobe Caslon Pro** (body). |
| **Friedman / four-genre superfamily** | **Agfa Rotis** — pick any two of {Sans / Semisans / Semi Serif / Serif}. The only thing in the library that does this. |
| **Information Architecture / data-display** | **ITC Officina Sans + ITC Officina Serif** (Spiekermann pairing). Or **Bell Gothic** for small-size data. |
| **Antique-Olive / French magazine** | **Antique Olive** itself. Excoffon is in Tier 1. |
| **British editorial book** | **Plantin** OR **Joanna** OR **Perpetua** + **Gill Sans**. |

---

## §4 — CSS variables (the API)

Prefer variables over hard-coded family names. The variable carries semantic intent; updating the variable refreshes every usage at once.

```css
font-family: var(--font-grotesk);        /* GOOD — semantic */
font-family: 'Univers', sans-serif;       /* OK but rigid — direct reference */
font-family: 'Helvetica Neue', sans-serif; /* BAD — OS-default stack, no Tier 1 reach */
```

The full list lives at the bottom of `/fonts/hosted-fonts.css`. Quick reference:

### Grotesk register
- `--font-grotesk` — Univers → Helvetica Neue → Arial fallback. The default sans.
- `--font-grotesk-cond` — Trade Gothic Condensed → Univers Cond fallback. For condensed display.
- `--font-grotesk-display` — Trade Gothic Bold → Univers Bold. For display headlines.
- `--font-signage` — Bell Gothic → Bell Centennial → Trade Gothic. For wayfinding / small-size legibility.

### Humanist sans
- `--font-humanist` — Gill Sans → Optima → Antique Olive. For warmer, less-modernist sans.
- `--font-geometric` — Avenir → Futura. For geometric register.
- `--font-rotis-sans` — Agfa Rotis Sans Serif → Semisans. Use when pairing with another Rotis cut.
- `--font-rotis-serif` — Agfa Rotis Serif → Semi Serif. The serif counterpart.

### Industrial / Engineering
- `--font-engineering` — DINPro → DIN 1451 Mittelschrift → DIN Neuzeit Grotesk. For technical / engineering register. **Reach for DINPro first** — it has the full weight range (Light through Black) that DIN 1451 lacks.
- `--font-engineering-narrow` — DIN 1451 Engschrift → DIN 1451 Mittelschrift. For narrow engineering use only — DINPro doesn't have a narrow cut on disk.

### Book serif
- `--font-book` — Sabon → Stempel Garamond → Adobe Garamond Pro → Georgia. The default body serif.
- `--font-aldine` — Bembo → Centaur → Adobe Jenson Pro. For Aldine-Renaissance register.
- `--font-caslon` — Adobe Caslon Pro → ITC Founders Caslon 12 → Caslon Classico. For Caslon-family work.
- `--font-editorial-book` — Plantin → Ehrhardt → Joanna. For British editorial book voice.

### Display serif
- `--font-didone` — Linotype Didot → Bauer Bodoni → ITC Bodoni Twelve. High-contrast display.
- `--font-slab` — ITC Lubalin Graph → Rockwell → Glypha. Geometric slab display.
- `--font-slab-bracketed` — Clarendon → Memphis. Bracketed slab.
- `--font-inscriptional` — Trajan → Augustea Open. Roman inscriptional caps.
- `--font-times-display` — Times Eighteen → Times Ten. Optical Times for display.

### Mono
- `--font-mono` — Letter Gothic → Courier. The default mono. **Don't fall back to system monospace.**

---

## §5 — OsF / SC variants (power-user typography)

Four families in Tier 1 ship Old-style Figures (OsF) and Small Caps (SC) as **separate `@font-face` declarations**:

- **Sabon** — `'Sabon OsF'`, `'Sabon SC'`
- **Bembo** — `'Bembo OsF'`, `'Bembo SC'`
- **Janson Text** — `'Janson Text OsF'`, `'Janson Text SC'`
- **Stempel Garamond** — `'Stempel Garamond OsF'`, `'Stempel Garamond SC'`

These are NOT OpenType feature switches. The source cuts predate OpenType layout tables, so `font-variant-numeric: oldstyle-nums` and `font-variant-caps: small-caps` won't trigger anything. They're separate fonts.

### When to use OsF (Old-style Figures)

In any book-tier reading surface. Lining figures (the default `0–9`) sit on the cap-line and look like an Excel sheet when mixed with body text — they break the rhythm. Old-style figures sit on the x-height with descenders, reading like letters. Use them for:

- Body copy with any numeric content (prices, dates, statistics)
- Editorial typography where the page should read like a book, not a balance sheet
- Anywhere you'd see Linotype set, ever

```css
.body-copy { font-family: 'Sabon OsF', serif; }       /* GOOD */
.body-copy { font-family: 'Sabon', serif; }            /* lining figures — reads like a spreadsheet */
```

### When to use SC (Small Caps)

In opening lines (drop-cap follow-on), eyebrow text, marginalia, in-line emphasis (when italic would be wrong). True small caps are proportioned to harmonize with lowercase — they're not just `font-variant: small-caps` on Roman caps (which scales the cap glyphs and looks like a stretched eyesore).

```css
.eyebrow { font-family: 'Sabon SC', serif; letter-spacing: 0.04em; }
```

---

## What this library buys you

The difference between a vibe that reads as "AI-generated" and a vibe that reads as "designed" is whether the typography came from the converged training-data default or from a real 20th-century type tradition. Inter is converged. Univers is not. Instrument Serif is converged. Sabon is not. JetBrains Mono is converged. Letter Gothic is not.

The library is the substrate. The school-anchor decides which families to reach for. The vibe spec writes them in. WebDev loads them by `<link>`. The page ships with typography that no AI competitor will produce by default — because no AI default has Univers in its fallback stack.

Use it.
