# Export Formats: HTML → PDF / PPTX + Slides Architecture

This file covers everything mechanical about turning HTML decks into PDF / PPTX deliverables, plus the architectural decisions (single-file vs multi-file, deck-stage CSS trap, slide labels, speaker notes) that downstream export depends on.

**Companion file:** `slide-decks.md` owns the doctrine layer (matrix, format details, content approach templates, per-format production grammar, 2-page showcase rule, slide design patterns). This file is the mechanics layer. If you're deciding WHAT a deck should be, read `slide-decks.md`. If you're deciding HOW to build / export it, read here.

**Read order if both apply:** `slide-decks.md` first (locks the format and category), then this file (locks the architecture and export path).

---

## Section navigation

1. **Architecture decision** (single-file vs multi-file) — the first build choice for any Slides deck
2. **Path A — multi-file architecture** (default for ≥10 slides, team development, parallel builds)
3. **Path B — single-file `<deck-stage>` architecture** (≤10 slides, cross-page state, pitch-deck demos)
4. **Slide labels** (what shows in the counter)
5. **Speaker notes** (off by default; how to add them)
6. **PDF export** (`export_deck_pdf.mjs` for multi-file; `export_deck_stage_pdf.mjs` for single-file deck-stage)
7. **PPTX export** — editable PowerPoint via `html2pptx.js` (HTML must satisfy 4 hard constraints)
8. **Common export pitfalls** (Chromium emoji, ESM resolution, font loading races)
9. **Common questions** (architecture-related troubleshooting)
10. **When to pick which export** (PDF vs PPTX vs HTML-only)

---

## 1. Architecture decision: single-file or multi-file?

**This choice is the first step of any Slides deck — getting it wrong leads to repeated face-plants. Read this section before you start.**

### The two architectures compared

| Dimension | Single file + `deck_stage.js` | **Multi-file + `deck_index.html` aggregator** |
|------|--------------------------|--------------------------------------|
| Code structure | One HTML, all slides are `<section>`s | Each slide its own HTML, `index.html` aggregates via iframe |
| CSS scope | ❌ Global, one page's styles can affect all | ✅ Naturally isolated, iframes each get their own world |
| Verification granularity | ❌ Need JS goTo to switch to a slide | ✅ Double-click a single-page file to view in browser |
| Parallel development | ❌ One file, multi-agent edits will conflict | ✅ Multiple agents can work different pages, zero merge conflict |
| Debug difficulty | ❌ One CSS error and the whole deck flips | ✅ A single-page error only affects itself |
| Embedded interaction | ✅ Cross-page shared state is simple | 🟡 Cross-iframe needs postMessage |
| Print PDF | ✅ Built in | ✅ Aggregator iterates iframes on beforeprint |
| Keyboard navigation | ✅ Built in | ✅ Built in |

### Decision tree

```
│ Q: how many pages will the deck have?
├── ≤10 pages, in-deck animations or cross-page interactions, pitch deck → single file
└── ≥10 pages, academic talk, courseware, long deck, parallel multi-agent → multi-file (recommended)
```

**Default to multi-file.** Every advantage of single-file (keyboard navigation, printing, scale) is also in multi-file, while multi-file's scope isolation and verifiability cannot be compensated for in single-file.

### Why is this rule so hard? (Real incident log)

Single-file architecture once stepped on four landmines in a row while making the AI-Psychology lecture deck:

1. **CSS specificity override**: `.emotion-slide { display: grid }` (specificity 10) beat `deck-stage > section { display: none }` (specificity 2), causing all slides to render stacked simultaneously.
2. **Shadow DOM slot rules suppressed by outer CSS**: `::slotted(section) { display: none }` couldn't block outer-rule overrides, sections refused to hide.
3. **localStorage + hash navigation race**: after refresh, instead of jumping to the hash, it stayed on the old localStorage-recorded position.
4. **High verification cost**: had to `page.evaluate(d => d.goTo(n))` to capture a slide — twice as slow as `goto(file://.../slides/05-X.html)` and often errored.

The root cause for all is **a single global namespace** — multi-file architecture eliminates these problems at the physical layer.

---

## 2. Path A (default): multi-file architecture

### Directory structure

```
my-deck/
├── index.html              # copied from assets/deck_index.html, edit MANIFEST
├── shared/
│   ├── tokens.css          # shared design tokens (palette / type / common chrome)
│   └── fonts.html          # <link> to Google Fonts (each page includes)
└── slides/
    ├── 01-cover.html       # each file is a complete slide HTML (default canvas: True HD; not locked)
    ├── 02-agenda.html
    ├── 03-problem.html
    └── ...
```

### Per-slide template skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>P05 · Chapter Title</title>
<link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet">
<link rel="stylesheet" href="../shared/tokens.css">
<style>
  body { padding: 120px; }
  .my-thing { ... }
</style>
</head>
<body>
  <!-- Slide content. Default canvas True HD; dimensions are CSS variables in tokens.css, NOT hard locks -->
  <div class="page-header">...</div>
  <div>...</div>
  <div class="page-footer">...</div>
</body>
</html>
```

**Key constraints:**
- `<body>` IS the canvas, lay out directly on it. Don't wrap with `<section>` or another wrapper.
- Canvas dimensions are CSS variables in `shared/tokens.css` (default `--canvas-width: 1920px`, `--canvas-height: 1080px`) — overridable per deck. NEVER write `body { width: 1920px; height: 1080px }` as a hard rule. See `slide-decks.md` "Canvas dimensions: default, never locked" for the policy and the one legitimate exception (PowerPoint editability — Section 7 below requires `960pt × 540pt`).
- Include `shared/tokens.css` for shared design tokens (palette, type, page-header/footer, etc.).
- Font `<link>` is written per-page (importing fonts independently is cheap and ensures every page is independently openable).

### The aggregator: `deck_index.html`

**Copy directly from `assets/deck_index.html`**. You only need to edit one place — the `window.DECK_MANIFEST` array, listing all slide filenames with human-readable labels in order:

```js
window.DECK_MANIFEST = [
  { file: "slides/01-cover.html",    label: "Cover" },
  { file: "slides/02-agenda.html",   label: "Agenda" },
  { file: "slides/03-problem.html",  label: "Problem statement" },
  // ...
];
```

The aggregator already has built-in: keyboard navigation (←/→/Home/End/number keys/P print), scale + letterbox, bottom-right counter, localStorage memory, hash jump, print mode (iterate iframes to output PDF page-by-page).

### Single-page verification (multi-file architecture's killer advantage)

Each slide is independent HTML. **As soon as one is done, double-click it open in the browser and look:**

```bash
open slides/05-personas.html
```

Playwright screenshot is also direct `goto(file://.../slides/05-personas.html)` — no JS jump needed and no interference from another page's CSS. This drops the cost of "edit a bit, verify a bit" workflow to near zero.

### Parallel development

Hand each slide's task to a different agent and run in parallel — HTML files are independent, no merge conflicts. For long decks, this parallelism cuts production time to 1/N.

### What goes in `shared/tokens.css`

Only put **truly cross-page shared** things in here:

- CSS variables (palette, type scale, spacing scale, canvas dimensions as `--canvas-width` / `--canvas-height`)
- Canvas DEFAULTS via CSS variables — NOT hard `body { width: ...; height: ... }` locks. The deck-stage runtime / aggregator scales and letterboxes; CSS just supplies the variable values.
- `.page-header` / `.page-footer` chrome that's identical across every page

**Don't** stuff per-page layout classes in here — that regresses to the global-pollution problem of single-file architecture.

---

## 3. Path B (small deck): single file + `deck_stage.js`

For ≤10 pages, scenarios needing cross-page shared state (e.g. one React tweaks panel controlling all slides), or pitch-deck demos that demand extreme compactness.

### Basic usage

1. Read content from `assets/deck_stage.js` and embed into the HTML's `<script>` (or `<script src="deck_stage.js">`)
2. Inside body wrap slides with `<deck-stage>`
3. 🛑 **The script tag MUST come after `</deck-stage>`** (see hard constraint below)

```html
<body>

  <deck-stage>
    <section>
      <h1>Slide 1</h1>
    </section>
    <section>
      <h1>Slide 2</h1>
    </section>
  </deck-stage>

  <!-- ✅ Correct: script comes after deck-stage -->
  <script src="deck_stage.js"></script>

</body>
```

### 🛑 Script-position hard constraint (real bump 2026-04-20)

**You cannot put `<script src="deck_stage.js">` in `<head>`.** Even though it would define `customElements` in `<head>`, the parser fires `connectedCallback` the moment it parses the `<deck-stage>` opening tag — child `<section>`s have not been parsed yet, so `_collectSlides()` gets an empty array, the counter shows `1 / 0`, and all slides render stacked simultaneously.

**Three compliant ways** (any one):

```html
<!-- ✅ Most recommended: script after </deck-stage> -->
</deck-stage>
<script src="deck_stage.js"></script>

<!-- ✅ Also OK: script in head with defer -->
<head><script src="deck_stage.js" defer></script></head>

<!-- ✅ Also OK: module scripts are deferred by nature -->
<head><script src="deck_stage.js" type="module"></script></head>
```

`deck_stage.js` itself has a `DOMContentLoaded`-deferred-collection defense built in — putting the script in head won't completely blow up — but `defer` or putting it at body bottom is still the cleaner approach, avoids relying on the defense branch.

### ⚠️ Single-file architecture's CSS trap (must read)

The single-file architecture's most common pitfall — **`display` property hijacked by per-page styles.**

Common error pose 1 (writing display: flex directly on section):

```css
/* ❌ Outer CSS specificity 2, overrides the shadow DOM's ::slotted(section){display:none} (also 2) */
deck-stage > section {
  display: flex;            /* All slides will render stacked simultaneously! */
  flex-direction: column;
  padding: 80px;
  ...
}
```

Common error pose 2 (a class on section with higher specificity):

```css
.emotion-slide { display: grid; }   /* specificity: 10, even worse */
```

Both make **all slides render stacked simultaneously** — the counter may show `1 / 10` pretending it's normal, but visually slide 1 is on top of slide 2 on top of slide 3.

### ✅ Starter CSS (copy at kickoff, no traps)

**section itself** is only responsible for "visible/invisible"; **layout (flex/grid etc.) goes on `.active`**:

```css
/* section only defines non-display common styles */
deck-stage > section {
  background: var(--paper);
  padding: 80px 120px;
  overflow: hidden;
  position: relative;
  /* ⚠️ Do NOT write display here! */
}

/* Lock "non-active = hidden" — specificity + weight double insurance */
deck-stage > section:not(.active) {
  display: none !important;
}

/* Active slide gets the needed display + layout */
deck-stage > section.active {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

/* Print mode: all pages must show, override :not(.active) */
@media print {
  deck-stage > section { display: flex !important; }
  deck-stage > section:not(.active) { display: flex !important; }
}
```

Alternative: **put per-page flex/grid on an inner wrapper `<div>`**, keep section itself as just a `display: block/none` switcher. This is the cleanest approach:

```html
<deck-stage>
  <section>
    <div class="slide-content flex-layout">...</div>
  </section>
</deck-stage>
```

### Custom dimensions

```html
<deck-stage width="1080" height="1920">
  <!-- 9:16 portrait -->
</deck-stage>
```

---

## 4. Slide labels

deck_stage and deck_index both label each slide (counter display). Give them **more meaningful** labels:

**Multi-file**: in `MANIFEST`, write `{ file, label: "04 Problem statement" }`
**Single-file**: on the section, add `<section data-screen-label="04 Problem Statement">`

**Critical: slide numbering starts at 1, not 0.**

When the user says "slide 5", they mean the 5th slide, never array index `[4]`. Humans don't talk 0-indexed.

---

## 5. Speaker notes

**Off by default**, only added when the user explicitly requests.

With speaker notes added you can reduce on-slide text to a minimum and focus on impactful visuals — notes carry the full script.

### Format

**Multi-file**: in `index.html`'s `<head>`:

```html
<script type="application/json" id="speaker-notes">
[
  "Slide 1 script...",
  "Slide 2 script...",
  "..."
]
</script>
```

**Single-file**: same place.

### Notes writing principles

- **Complete**: not an outline, the actual words you would say
- **Conversational**: the way you actually speak, not formal writing
- **Aligned**: array's Nth entry corresponds to slide N
- **Length**: 200–400 words is ideal
- **Emotion track**: mark stress, pauses, emphasis points

---

## 6. PDF export

### Print to PDF (built-in)

**Multi-file**: `deck_index.html` already handles the `beforeprint` event, outputs PDF page-by-page.
**Single-file**: `deck_stage.js` handles it the same way.

Print styles are already written, no need to add `@media print` CSS.

### `export_deck_pdf.mjs` — vector PDF for multi-file decks

```bash
node scripts/export_deck_pdf.mjs --slides <slides-dir> --out deck.pdf
```

**Features:**
- Text **stays vector** (copyable, searchable)
- 100% visual fidelity (Playwright's embedded Chromium renders, then prints)
- **No edits to HTML required**
- Each slide gets its own `page.pdf()`, then merged via `pdf-lib`

**Dependencies**: `npm install playwright pdf-lib`

**Limitation**: PDF text can't be re-edited — go back to HTML to change.

### `export_deck_stage_pdf.mjs` — single-file deck-stage architecture only ⚠️

**When to use**: deck is a single HTML file + a `<deck-stage>` web component wrapping N `<section>`s (i.e. Path B architecture). At this point `export_deck_pdf.mjs`'s "one `page.pdf()` per HTML" approach doesn't work; use this dedicated script.

```bash
node scripts/export_deck_stage_pdf.mjs --html deck.html --out deck.pdf
```

**Why it can't reuse export_deck_pdf.mjs** (real bumps from 2026-04-20):

1. **Shadow DOM beats `!important`**: deck-stage's shadow CSS has `::slotted(section) { display: none }` (only the active one is `display: block`). Even using `@media print { deck-stage > section { display: block !important } }` in light DOM can't suppress it — after `page.pdf()` triggers print media, Chromium's final render only contains the active slide, so **the entire PDF is 1 page** (a repeat of the current active slide).

2. **Looping goto per page also yields only 1 page**: the intuitive solution "navigate to each `#slide-N` then `page.pdf({pageRanges:'1'})`" also fails — because the print CSS, with `deck-stage > section { display: block }` rule overridden in shadow DOM, ends up always rendering the first section in the list (not the one you navigated to). 17 loops yields 17 P01 covers.

3. **Absolute children jump to next page**: even after successfully rendering all sections, if section is `position: static`, its absolutely-positioned `cover-footer`/`slide-footer` get positioned relative to the initial containing block — when section is print-forced to 1080px height, the absolute footer can be pushed to the next page (manifests as the PDF having one more page than sections, the extra page containing only the orphan footer).

**Fix strategy** (already implemented in script):

```js
// After opening HTML, page.evaluate to extract sections from the deck-stage slot
// and attach them directly under body inside a regular div, with inline style
// ensuring position:relative + fixed dimensions
await page.evaluate(() => {
  const stage = document.querySelector('deck-stage');
  const sections = Array.from(stage.querySelectorAll(':scope > section'));
  document.head.appendChild(Object.assign(document.createElement('style'), {
    textContent: `
      @page { size: 1920px 1080px; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; }
      deck-stage { display: none !important; }
    `,
  }));
  const container = document.createElement('div');
  sections.forEach(s => {
    s.style.cssText = 'width:1920px!important;height:1080px!important;display:block!important;position:relative!important;overflow:hidden!important;page-break-after:always!important;break-after:page!important;background:#F7F4EF;margin:0!important;padding:0!important;';
    container.appendChild(s);
  });
  // Last page: disable page break, avoid trailing blank page
  sections[sections.length - 1].style.pageBreakAfter = 'auto';
  sections[sections.length - 1].style.breakAfter = 'auto';
  document.body.appendChild(container);
});

await page.pdf({ width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
```

**Why this works:**
- Pulling sections from the shadow DOM slot to a regular div in light DOM completely bypasses the `::slotted(section) { display: none }` rule
- Inline `position: relative` makes absolute children position relative to section, no overflow
- `page-break-after: always` makes the browser print each section on its own page
- `:last-child` no-page-break avoids the trailing blank page

**When using `mdls -name kMDItemNumberOfPages` to verify**: macOS Spotlight metadata is cached; after rewriting a PDF, run `mdimport file.pdf` to force-refresh, otherwise it shows the old page count. Use `pdfinfo` or count files with `pdftoppm` for the real number.

---

## 7. PPTX export — editable PowerPoint

This section covers the path of using `scripts/html2pptx.js` + `pptxgenjs` to translate HTML element-by-element into **truly editable PowerPoint text frames** — also the only path supported by `export_deck_pptx.mjs`.

> **Core prerequisite**: to use this path, the HTML must follow the four constraints below from line one. **Don't write it first and convert later** — retrofitting triggers 2-3 hours of rework (verified on the 2026-04-20 Options Council Project).
>
> If visual freedom matters more (animation / web components / CSS gradients / complex SVG), use the PDF path instead (Section 6 above). **Don't** expect the PPTX export to give you both visual fidelity and editability — this is a physical constraint of the PPTX file format itself (see "Why the four constraints aren't bugs but physics" at the end).

### Canvas Size: Use 960×540pt (LAYOUT_WIDE)

PPTX is measured in **inches** (physical size), not pixels. Decision rule: the body's computed style must **match the presentation layout's inch dimensions** (±0.1", enforced by `validateDimensions` in `html2pptx.js`).

### Three candidate sizes

| HTML body | Physical size | Matching PPT layout | When to pick |
|---|---|---|---|
| **`960pt × 540pt`** | **13.333″ × 7.5″** | **pptxgenjs `LAYOUT_WIDE`** | Default recommendation (modern PowerPoint 16:9 standard) |
| `720pt × 405pt` | 10″ × 5.625″ | Custom | Only when the user explicitly wants the legacy "PowerPoint Widescreen" template |
| `1920px × 1080px` | 20″ × 11.25″ | Custom | Avoid — non-standard size, fonts look unusually small when projected |

**Don't think of HTML size as resolution.** PPTX is a vector document; body size determines **physical dimensions**, not sharpness. An oversized body (20″×11.25″) doesn't make text crisper — it just makes the pt size relatively smaller against the canvas, looking worse when projected/printed.

### Body declaration (any of three equivalents)

```css
body { width: 960pt;  height: 540pt; }    /* clearest, recommended */
body { width: 1280px; height: 720px; }    /* equivalent, in px */
body { width: 13.333in; height: 7.5in; }  /* equivalent, in inches */
```

Matching pptxgenjs:

```js
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';  // 13.333 × 7.5 inch, no custom config needed
```

---

## Four Hard Constraints (violations throw immediately)

`html2pptx.js` translates the HTML DOM into PowerPoint objects element by element. PowerPoint's format constraints projected back onto HTML give you these four rules.

### Rule 1: A DIV cannot directly contain text — wrap in `<p>` or `<h1>`-`<h6>`

```html
<!-- Wrong: text directly inside a div -->
<div class="title">Q3 revenue grew 23%</div>

<!-- Right: text inside <p> or <h1>-<h6> -->
<div class="title"><h1>Q3 revenue grew 23%</h1></div>
<div class="body"><p>New users were the main driver</p></div>
```

**Why**: PowerPoint text must live inside a text frame, and a text frame maps to a paragraph-level HTML element (p/h*/li). A bare `<div>` has no text container in PPTX.

**Don't use `<span>` for the main text either** — span is inline, can't be aligned independently as a text frame. Span only belongs **inside p/h\*** for local styling (bold, color shift).

### Rule 2: No CSS gradients — solid colors only

```css
/* Wrong */
background: linear-gradient(to right, #FF6B6B, #4ECDC4);

/* Right: solid color */
background: #FF6B6B;

/* Right: if you need multi-color stripes, use flex children with solid fills */
.stripe-bar { display: flex; }
.stripe-bar div { flex: 1; }
.red   { background: #FF6B6B; }
.teal  { background: #4ECDC4; }
```

**Why**: PowerPoint shape fills only support solid / gradient-fill, but pptxgenjs's `fill: { color: ... }` only maps to solid. Going through PowerPoint's native gradient requires a different structure that the toolchain currently doesn't support.

### Rule 3: Background / border / shadow only on DIV, not on text tags

```html
<!-- Wrong: <p> has a background -->
<p style="background: #FFD700; border-radius: 4px;">Key point</p>

<!-- Right: outer div carries background/border, <p> just holds text -->
<div style="background: #FFD700; border-radius: 4px; padding: 8pt 12pt;">
  <p>Key point</p>
</div>
```

**Why**: in PowerPoint, a shape (rectangle, rounded rectangle) and a text frame are separate objects. HTML `<p>` only translates to a text frame — background / border / shadow are shape-level and must live on the **div that wraps the text**.

### Rule 4: A DIV cannot use `background-image` — use the `<img>` tag

```html
<!-- Wrong -->
<div style="background-image: url('chart.png')"></div>

<!-- Right -->
<img src="chart.png" style="position: absolute; left: 50%; top: 20%; width: 300pt; height: 200pt;" />
```

**Why**: `html2pptx.js` only extracts image paths from `<img>` elements; it does not parse CSS `background-image` URLs.

---

## Path A — HTML Template Skeleton

One HTML file per slide, scope-isolated from each other (avoiding the CSS pollution of single-file decks).

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 960pt; height: 540pt;           /* matches LAYOUT_WIDE */
    font-family: system-ui, -apple-system, "PingFang SC", sans-serif;
    background: #FEFEF9;                    /* solid color, no gradient */
    overflow: hidden;
  }
  /* DIV handles layout / background / border */
  .card {
    position: absolute;
    background: #1A4A8A;                    /* background on DIV */
    border-radius: 4pt;
    padding: 12pt 16pt;
  }
  /* Text tags handle font styling only — no background/border */
  .card h2 { font-size: 24pt; color: #FFFFFF; font-weight: 700; }
  .card p  { font-size: 14pt; color: rgba(255,255,255,0.85); }
</style>
</head>
<body>

  <!-- Title block: outer div positions, inner text tags hold copy -->
  <div style="position: absolute; top: 40pt; left: 60pt; right: 60pt;">
    <h1 style="font-size: 36pt; color: #1A1A1A; font-weight: 700;">Lead with an assertion, not a topic word</h1>
    <p style="font-size: 16pt; color: #555555; margin-top: 10pt;">Subtitle clarifies the claim</p>
  </div>

  <!-- Content card: div carries the background, h2/p carry the text -->
  <div class="card" style="top: 130pt; left: 60pt; width: 240pt; height: 160pt;">
    <h2>Point one</h2>
    <p>Brief supporting copy</p>
  </div>

  <!-- List: use ul/li, don't hand-roll • characters -->
  <div style="position: absolute; top: 320pt; left: 60pt; width: 540pt;">
    <ul style="font-size: 16pt; color: #1A1A1A; padding-left: 24pt; list-style: disc;">
      <li>First bullet</li>
      <li>Second bullet</li>
      <li>Third bullet</li>
    </ul>
  </div>

  <!-- Illustration: <img> tag, not background-image -->
  <img src="illustration.png" style="position: absolute; right: 60pt; top: 110pt; width: 320pt; height: 240pt;" />

</body>
</html>
```

---

## Common Errors Cheat Sheet

| Error message | Cause | Fix |
|---------------|-------|-----|
| `DIV element contains unwrapped text "XXX"` | Bare text in a div | Wrap the text in `<p>` or `<h1>`-`<h6>` |
| `CSS gradients are not supported` | Used linear/radial-gradient | Switch to a solid color, or use flex children |
| `Text element <p> has background` | Background color set on `<p>` | Wrap with a `<div>` for background, leave `<p>` as text-only |
| `Background images on DIV elements are not supported` | div used background-image | Switch to an `<img>` tag |
| `HTML content overflows body by Xpt vertically` | Content exceeds 540pt | Reduce content or font size, or use `overflow: hidden` to clip |
| `HTML dimensions don't match presentation layout` | body size doesn't match pres layout | Use `960pt × 540pt` body with `LAYOUT_WIDE`, or defineLayout custom size |
| `Text box "XXX" ends too close to bottom edge` | Large `<p>` is < 0.5 inch from body bottom | Move it up — leave bottom margin; PPT itself crops some of the bottom |

---

## Basic Workflow (3 steps to PPTX)

### Step 1: Write each slide as its own HTML, following the constraints

```
my-deck/
├── slides/
│   ├── 01-cover.html    # each file is a complete 960×540pt HTML
│   ├── 02-agenda.html
│   └── ...
└── illustration/        # all images referenced by <img>
    ├── chart1.png
    └── ...
```

### Step 2: Write a build.js that calls `html2pptx.js`

```js
const pptxgen = require('pptxgenjs');
const html2pptx = require('../scripts/html2pptx.js');  // this skill's script

(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';  // 13.333 × 7.5 inch, matches HTML's 960×540pt

  const slides = ['01-cover.html', '02-agenda.html', '03-content.html'];
  for (const file of slides) {
    await html2pptx(`./slides/${file}`, pres);
  }

  await pres.writeFile({ fileName: 'deck.pptx' });
})();
```

### Step 3: Open and verify

- Open the exported PPTX in PowerPoint or Keynote
- Double-clicking any text should let you edit it directly (if it's an image, you violated rule 1)
- Verify overflow: every page should sit within body bounds, nothing clipped

---

## This Path vs Other Options (when to use what)

| Need | Choose |
|------|--------|
| Colleague edits the PPTX text / will be sent to non-technical people for further editing | **This path** (editable; HTML must be written under the four constraints from the start) |
| Lecture use only / archive, no further editing | `export_deck_pdf.mjs` (multi-file) or `export_deck_stage_pdf.mjs` (single-file deck-stage) — outputs vector PDF |
| Visual freedom matters more (animation, web components, CSS gradients, complex SVG), accept non-editable | **PDF** (same as above) — PDF preserves visuals and is cross-platform, much better than an "image PPTX" |

**Never run html2pptx on visual-freedom HTML hoping it passes** — empirical pass rate is < 30%, and retrofitting page-by-page is slower than rewriting. For that scenario output PDF, not a forced PPTX.

---

## Fallback: Existing Visual Mockup, but the User Insists on Editable PPTX

You'll occasionally hit this scenario: you/the user has already written a visual-driven HTML (gradients, web components, complex SVGs all in play), PDF would be the right output, but the user explicitly says "no, it has to be an editable PPTX."

**Don't run `html2pptx` blindly hoping it passes** — empirically the pass rate is <30% on visual-driven HTML, the other 70% errors out or distorts. The right fallback is:

### Step 1 · Communicate the constraints upfront (transparent)

In one sentence, lay out three things:

> "Your current HTML uses [name them: gradients / web components / complex SVG / ...]. Direct conversion to editable PPTX will fail. Two options:
> - A. **Output PDF** (recommended) — visuals 100% preserved, recipient can view and print but can't edit text
> - B. **Use the visual mockup as a reference and rewrite an editable HTML** (preserve the design decisions for color / layout / copy, but reorganize HTML structure to match the four hard constraints — **giving up** gradients, web components, complex SVGs and similar visual capabilities) → then export editable PPTX
>
> Which one?"

Don't soft-pedal Option B — be clear about **what gets lost**. Let the user decide the trade-off.

### Step 2 · If the user picks B: AI rewrites — don't make the user do it

The doctrine here: **the user gives the design intent, you translate it to compliant implementation**. Don't ask the user to learn the four constraints and rewrite themselves.

Rewrite principles:
- **Preserve**: color system (primary/secondary/neutral), information hierarchy (title/subtitle/body/note), core copy, layout skeleton (top-mid-bottom / two-column / grid), page rhythm
- **Downgrade**: CSS gradients → solids or flex stripes, web component → paragraph-level HTML, complex SVG → simplified `<img>` or solid geometry, shadows → drop or weaken, custom fonts → fall back to system fonts
- **Rewrite**: bare text → wrap in `<p>` / `<h*>`, `background-image` → `<img>` tag, background/border on `<p>` → outer div carries it

### Step 3 · Produce a before/after diff (transparent delivery)

After rewriting, give the user a before/after list so they know what was simplified:

```
Original design → editable adjustment
- Title section purple gradient → solid #5B3DE8 background
- Data card shadow → removed (replaced with 2pt border)
- Complex SVG line chart → simplified to <img> PNG (screenshot from HTML)
- Hero web component animation → static first frame (web component doesn't translate)
```

### Step 4 · Export & deliver both formats

- The `editable` HTML → run `scripts/export_deck_pptx.mjs` to produce editable PPTX
- **Recommended to also keep** the original visual mockup → run `scripts/export_deck_pdf.mjs` for high-fidelity PDF
- Deliver both: PDF for the visuals, PPTX for editing — each does its job

### When to refuse Option B

In some cases the rewrite cost is so high the user should give up on editable PPTX:
- The HTML's core value is animation or interaction (rewriting leaves only a static first frame, losing 50%+ of the information)
- More than 30 pages, rewrite cost exceeds 2 hours
- Visual design depends deeply on precise SVG / custom filters (rewrite is barely related to the original)

In that case, tell the user: "Rewriting this deck costs too much. I recommend PDF, not PPTX. If the recipient really needs PPTX format, accept that the visuals will be much plainer — want to switch to PDF?"

---

## Why the Four Constraints Aren't Bugs but Physics

These four rules aren't `html2pptx.js` being lazy — they are **constraints of the PowerPoint file format (OOXML) itself** projected onto HTML:

- In PPTX, text must be inside a text frame (`<a:txBody>`), which maps to paragraph-level HTML elements
- In PPTX, shapes and text frames are different objects; you can't paint a background and write text on the same element
- PPTX shape fill has limited gradient support (only certain preset gradients, no arbitrary-angle CSS gradients)
- PPTX picture objects must reference a real image file, not a CSS property

Once you understand this, **don't expect the tool to get smarter** — the HTML has to adapt to the PPTX format, not the other way around.

---

## 8. Common export pitfalls

These are the recurring failures that hit during PDF / PPTX export specifically (separate from the architecture pitfalls in Section 1). All real bumps from the moxt brochure and Options Council Project.

### 8.1 Emoji doesn't render in Chromium / Playwright export

Chromium has no color emoji font by default; `page.pdf()` or `page.screenshot()` shows emoji as empty boxes.

**Workaround**: use Unicode text symbols (`✦` `✓` `✕` `→` `·` `—`) or just plain text ("Email · 23" instead of "📧 23 emails").

### 8.2 `export_deck_pdf.mjs` errors with `Cannot find package 'playwright'`

Cause: ESM module resolution searches upward for `node_modules` from the script's location. The script is at `~/.claude/skills/huashu-design/scripts/`, no deps there.

**Workaround**: copy the script into the deck project directory (e.g. `brochure/build-pdf.mjs`), run `npm install playwright pdf-lib` at the project root, then `node build-pdf.mjs --slides slides --out output/deck.pdf`.

### 8.3 Google Fonts hadn't finished loading when the screenshot was taken → fallback fonts render

Before Playwright screenshot/PDF, at least `wait-for-timeout=3500` to let webfont download and paint. Or self-host fonts at `shared/fonts/` to reduce network dependency.

This is the most common silent failure — the PDF looks "wrong" but won't error. The export script doesn't know whether the webfont actually loaded; it just runs after the timeout. If your deck uses non-Latin scripts (CJK, Arabic, Devanagari), self-host the fonts. Webfont CDN delays disproportionately affect non-Latin glyphs.

---

## 9. Common questions

**Multi-file: pages inside iframe won't open / blank screen**
→ Check whether the `MANIFEST`'s `file` paths are correct relative to `index.html`. Use browser DevTools to see if the iframe's src is directly accessible.

**Multi-file: a slide's styles conflict with another slide's**
→ Impossible (iframes are isolated). If it feels like a conflict, it's the cache — Cmd+Shift+R hard-refresh.

**Single-file: multiple slides render stacked**
→ CSS specificity issue. See the "Single-file architecture's CSS trap" in Section 3 above.

**Single-file: scaling looks wrong**
→ Check that all slides hang directly under `<deck-stage>` as `<section>`. No wrapping `<div>` between them.

**Single-file: jump to a specific slide**
→ Add a hash to the URL: `index.html#slide-5` jumps to slide 5.

**Both architectures: text positions inconsistent across screens**
→ Use the deck's canvas variables (`--canvas-width` / `--canvas-height`) consistently with `px` units inside the canvas, not raw `vw`/`vh` or `%`. The aggregator scales and letterboxes at viewport time — don't fight it with bare viewport units.

**PDF export looks like wrong fonts**
→ See pitfall 8.3. Webfont didn't finish loading before Playwright captured. Add a longer wait or self-host fonts.

**PDF export from deck-stage gives a 1-page repeat of the active slide**
→ Use `export_deck_stage_pdf.mjs`, not `export_deck_pdf.mjs`. Section 6 above explains why.

**PPTX export skipped half the slides**
→ Slides violated one of the 4 hard constraints (Section 7). Read the script's stderr for which constraint and which slide. Fix from line one of the offending HTML; don't retrofit.

**PPTX export font fallback looks wrong on the recipient's machine**
→ See Section 7's "Font-fallback caveat." Playwright measured the webfont; PowerPoint renders the local font; misalignment if they differ. Either install the same font on the recipient's machine, or fall back to `system-ui` in the source HTML so both sides agree.

---

## 10. When to pick which export

| Scenario | Recommended |
|------|------|
| Send to organizer / archive | **PDF** (universal, hi-fi, text-searchable) |
| Send to a collaborator who'll tweak text | **PPTX editable** (accept the font fallback) |
| Live presenting, content won't change | **PDF** (vector hi-fi, cross-platform) |
| HTML is the primary medium | Play directly in browser; export is just a backup |
| Long-term project, edited repeatedly, team collaboration | **Write HTML to PPTX constraints from line one** (Section 7) so `export_deck_pptx.mjs` passes everything cleanly forever |

**Don't take the PPTX path for visual-first scenarios** → use the PDF path. PDF is 100% visual fidelity, vector, cross-platform, text-searchable — the real home of visual-first decks, not "an uneditable compromise."
