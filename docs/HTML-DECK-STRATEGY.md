# HTML Decks for PowerPoint-Brained Humans
### A sales pitch, a tech autopsy, and a product-design plan — all in one

*Ralph, I read three things before writing this: your `pitch.css` (48kB of typography discipline), the `deck-stage.js` (621 lines, the best slide-engine primitive I've seen live in a project file), and the 16MB `FalCaMel-Decree.pptx` sitting in your `project/` folder — because that file is the entire argument. You already have editable PowerPoint coming out the other end of your HTML pipeline. Most of the "but PPT" objection is dead on arrival. You just don't know that yet, so nobody else does either. Let's fix that.*

---

## The core reframe — before answering anything

You asked me to sell HTML decks to NOOB users. I'm not going to. **Nobody in 2026 wants "HTML decks."** They want the deck to be great, and they want to not get yelled at when they send it. Those are two different problems, and conflating them is what makes tech people lose this argument.

What you actually have is a **deck source-of-truth** — one HTML file — that **outputs to four delivery formats** depending on who's receiving it:

| Situation | What you ship | Why |
|---|---|---|
| Live presentation (projector/laptop) | The HTML itself, fullscreen | Your `deck-stage.js` already does arrow-key nav, Home/End, number keys, localStorage resume, speaker-note broadcasts, 1920×1080 auto-scale |
| Email attachment to a CEO | The exported `.pptx` | Native PowerPoint, editable shapes, preserves Arabic typography. The CEO never knows it came from HTML |
| "Can you send me a link?" | Hosted HTML + QR code | Vercel/Netlify drops, one-line deploy, phone-friendly tap zones built into deck-stage |
| "Just send me the slides" / archive | Print-to-PDF via `@page` rule | Already wired in deck-stage.js line 230. One slide per page at 1920×1080. Same file |
| Self-running/social | MP4 via Playwright screen-record | Scripted navigate-click-wait-capture. Hero moments become posts |

**This is the product.** Not "an HTML deck." A single-source deck that speaks every dialect the recipient wants. PowerPoint is one output, not the rival format.

That reframe changes every downstream answer. Let's go.

---

## 1. What should I export to beyond PowerPoint that doesn't destroy fidelity?

Your question assumes PowerPoint is the baseline and you're looking for upgrades. **Backwards.** HTML is the baseline. Everything else is a lossy projection.

Here's the real matrix, ranked by fidelity to your source:

### Tier 1 — Lossless (same file, different mode)

**A. The HTML itself, fullscreen.**
- **Fidelity**: 100%. It IS the source.
- **Who opens it**: Anyone with a browser. Double-click a `.html`, press F11, hit arrow keys. Done.
- **NOOB barrier**: They need to know that double-click works. One-sentence email: *"Open in Chrome, press F11, use arrow keys."*
- **What breaks**: Nothing, if assets are local or inlined. If your deck uses `<img src="../../cliff-majlis.jpg">` and you email only the HTML, they get broken images. **This is the #1 real failure mode** — I'll address it below.

**B. Print-to-PDF via the existing `@page` rule.**
- Your `deck-stage.js` already injects `@page { size: 1920px 1080px; margin: 0; }` plus `-webkit-print-color-adjust: exact`. In Chrome → Print → Save as PDF, you get one slide per page at authored dimensions.
- **Caveat I verified**: graphical Chrome's print dialog sometimes overrides page size based on window width. Headless Chrome (`chrome --headless --print-to-pdf --no-margins`) honors your CSS faithfully. [Source on this below.]
- **Fidelity**: ~98%. Web fonts load, colors bake in, layout is identical. Interactivity dies, obviously.
- **When to use**: Email-ready archive. Also great for printing. Also great as the *fallback* you attach alongside the .pptx so the recipient has both.

### Tier 2 — Editable PowerPoint (you already have this!)

**C. The `.pptx` your pipeline produces.**
- I unzipped `FalCaMel-Decree.pptx` and inspected the XML. It's not screenshots-as-slides. It's native `<a:t>` text runs, `<a:latin typeface="Reem Kufi">`, `<a:srgbClr>` colors, positioned shapes at EMU precision. **Editable. In. PowerPoint.**
- **Fidelity**: ~85–95% depending on what your decks do. Anything with `position: absolute` inside a fixed stage translates cleanly. CSS animations obviously become static. `background-image` with gradients and overlays can translate but often get flattened to bitmap. Custom web fonts map to "closest match" on machines that lack them — embed fonts if the recipient is on Windows without Reem Kufi installed.
- **Who opens it**: Everyone. It IS PowerPoint.
- **The kill-shot for the sales argument**: when a VP says *"but I need to forward this to my partners and they all use PowerPoint"* — you say *"yes, here's the PowerPoint, same content, it came out of the same file."*

### Tier 3 — Frame-accurate video

**D. MP4 via Playwright or Puppeteer screen-record.**
- Tools: `puppeteer-screen-recorder` or `playwright-video` drive headless Chrome, step through your deck with arrow keys, capture frames → ffmpeg → MP4. Works with your existing `deck-stage.js` keyboard nav out of the box.
- **Fidelity**: 100% visual, including animations. What you see is what they see.
- **Use case**: Screen-record narration, YouTube uploads, LinkedIn posts, Slack shares for people who won't open anything.
- **Cost**: One-time pipeline. ~30 seconds render per deck once wired up.

### Tier 4 — Honest concessions

**E. Single-file HTML with base64-inlined assets.**
- Turn every `<img src="...">` into `<img src="data:image/jpeg;base64,...">` and inline the CSS. Genuinely one file. Works on the plane. No missing images ever.
- **The ugly truth I verified**: Gmail's 25MB limit becomes ~18MB after base64's 37% encoding overhead. Outlook is ~14.5MB. Your Decree pptx is already 16MB — the inlined HTML equivalent is probably 22–25MB and **won't fit in email**. Use WeTransfer, a hosted link, or a cloud drive for anything image-heavy. [Source below.]
- **When to use**: Light decks (text-heavy, <6 images). For your FalCaMel decks with 15+ high-res images, this isn't viable.

**F. Hosted link with QR code.**
- Vercel, Netlify, Cloudflare Pages: `git push` or drag-drop deploys to a URL in seconds. Free tier covers your use.
- One QR code printed on a business card or shown on-screen → phone opens the deck with tap-zones (already built into `deck-stage.js`).
- **What breaks**: The recipient's IT department sometimes blocks unknown domains. Use a custom domain (`decks.falcamel.sa`) and this evaporates.

### Graveyard — do not use

**HTML→PPTX online converters** (the "free" ones). They screenshot each page and paste into slides. Result: 100MB file, uneditable, blurry text, broken Arabic. Your pipeline is already doing the hard thing (shape-and-text conversion via dom-to-pptx or pptxgenjs-style logic) — don't fall back to these.

**ZIP of the whole folder.** Tempting for self-contained delivery, but recipients don't unzip-and-open-index.html. It's 2026. They'll double-click the first .jpg they see.

### The ranked recommendation for your four delivery modes

| You need to... | First choice | Second | When to use the second |
|---|---|---|---|
| Present live | Fullscreen HTML | PDF | Client's laptop blocks Chrome fullscreen or has no internet for web fonts |
| Email to a decision-maker | `.pptx` + PDF fallback in same email | Hosted link | Recipient has a restrictive attachment policy |
| Send a link | Hosted HTML + short URL | Google Drive share of the .pptx | IT blocks unknown domains |
| Archive / "just the slides" | PDF (export from deck) | .pptx | Recipient wants to quote/edit |
| Social / YouTube / Slack | MP4 | GIF of key moment | File size constraints |

---

## 2. What animations & effects should a SOTA HTML deck have?

I read your existing decks. Your current state is:
- **Pitch deck**: zero keyframes. No animations. Typography-led. Appropriate for investor audiences — no circus tricks in a financing conversation.
- **Weigh-In deck**: one `@keyframes pulse` (the red LIVE dot). Restraint.
- **Decree**: zero keyframes. SVG seal is static. Restraint.
- **The FalCaMel concept pages** (scroll-style, not decks): heavy IntersectionObserver reveals, power-on boot animations, glitch strips, scroll-reveal cascades.

You already know the two registers. The question is: **what should go where, and what's missing.**

### The "adds meaning" palette — use these

**Opening reveal (1–2 seconds max).**
Title slide fades in typographically. Not a slam. Not a glitch. A breath. Test: does it make a VP feel respected or patronized? Your Weigh-In's "LIVE · Fight Night" chyron pulse nails this. The Pitch title slide doesn't need it at all — the typography carries weight on its own.

**Staggered reveal inside complex slides** (bullet-by-bullet, column-by-column).
When you advance to a "four-things-to-take" slide, each bullet appears on spacebar press, not all at once. This is the one genuine presenter-side animation worth building. Reveal.js, Slides.com, Pitch all do it. Your `deck-stage.js` has a `slidechange` CustomEvent — you'd add a *within-slide* step counter listening for spacebar and revealing `[data-step="1"]`, `[data-step="2"]` elements. ~40 lines of code. **Highest ROI addition to your engine.**

**Scroll-linked animations** *for scroll pages only*, never slide decks.
The Decree, Descent, and index.html are scroll experiences. `animation-timeline: scroll()` and `view-timeline` are the 2026 way to do parallax without JS. Chrome 115+, Safari 26+ ship it; Firefox still needs a polyfill as of Feb 2026. [Sources below.] Use sparingly — a single hero image that scales into view, not every element drifting sideways.

**View Transitions API for slide-to-slide continuity.**
Same-document view transitions shipped in Safari 18.2 and Firefox 144 (Oct 2025), making it Baseline Newly Available. Your `deck-stage.js` swaps `data-deck-active` attributes on slides — if you name-matched elements between slides (e.g., both slide 2 and slide 3 have a "47-0" giant number), CSS `view-transition-name: score-47` would make the browser morph between them. **Feels magical with zero JS cost.** Biggest "wow" upgrade available to you right now. ~20 lines of CSS.

**Video-as-background, subtle, muted, looping.**
You have `Man_drinking_coffee_with_cats_starlight.mp4` and `Waiter_carries_falcon_on_perch_starlight.mp4` in the folder. One of them behind a title slide, desaturated, 40% opacity, with a legible type overlay — that's a hero moment PPT simply cannot do. The FalCaMel concept pages already use this; the decks don't. **Steal from your own work.**

**Data reveal** (charts that draw themselves).
For the Pitch deck's revenue projection slide (FY23→FY28), the bar chart could draw in as the slide activates. 3-line SVG animation, 800ms. Investor audiences read it as "this is data in motion, not a static claim." Nobody accuses PPT bar-chart animations of being classy.

**The "LIVE" chyron pulse** (your Weigh-In already has this).
Broadcast graphics feel *current*. This is authorial voice, not animation. Don't remove it.

### The "Awwwards cosplay" list — avoid these

- **Cursor effects** (magnetic, trailing, custom). Pointless on a projected screen, annoying on a phone.
- **Full-page parallax on decks.** Fine on scroll concept pages. Fatal on 16:9 decks — presenter clicks forward, audience gets motion sick.
- **Glitch effects in serious decks.** Kills trust. The Weigh-In uses them thematically (arcade vibe) — that's earned. An investor pitch with glitch is malpractice.
- **Lottie for everything.** Lottie is great for micro-interactions (loading spinners, confirm checkmarks). Using it for hero illustrations in a deck is six years late.
- **Rive** for slide decks. Rive excels at interactive state machines (games, product demos). A deck doesn't have state worth that complexity.
- **Scroll-jacking** in presentation mode. Your deck-stage scales one slide to viewport — no scrolling inside a slide. Good. Keep it.
- **Auto-advancing slides.** Never. Presenter drives. If they want a self-running version, that's the MP4 export.

### Missing from your current decks — highest-ROI additions

1. **Within-slide step revealer.** Spacebar advances to next bullet instead of next slide. Your existing slides (especially Pitch slides 2, 7, 14) list four things at once. A presenter would rather reveal them one at a time.

2. **View Transitions between slides with shared elements.** Pick three slide pairs where the same element appears at different scales/positions (logo, a big number, a character portrait) and wire `view-transition-name`. Done in an afternoon.

3. **Background video, used once per deck, at the title slide.** You already have the assets.

4. **Chart draw-on for financial slides.** One utility function, reusable across decks.

5. **A keyboard-visible "jump to slide" overlay** (press `/` or `?` to see thumbnails + labels). Your deck-stage already has `data-label` on every slide. This is a 50-line addition that matters when someone in the audience asks "can you go back to the unit economics slide?" and you don't want to spam arrow-left.

---

## 3. What templates should I build, and what matters in each?

Before answering — a distinction your corpus already reflects but doesn't name:

**You have two products, not one:**
1. **Slide decks** (16:9 fixed stage, arrow-nav, speaker notes, one idea per screen) — Pitch, Weigh-In, Decree in `/project/`
2. **Long-scroll concept pages** (sticky header, section anchors, hero + articles + summons) — index.html, Decree.html at top-level, Descent.html, the "vibe" pages

These are different templates with different jobs. Conflating them is why people argue about "HTML presentations" unproductively. Below I address both, grouped by purpose.

### The decks worth systematizing

**1. Investor pitch** (your `FalCaMel Pitch.html` is the reference)
- **Length**: 14–18 slides. Yours is 16. Don't exceed 18. Investors skim; each extra slide dilutes.
- **Must-have beats**: Title → Executive summary (four takeaways) → Opportunity/market → What the business is → Founder → How it works → Business model → Unit economics → Location/moat → Traction → USP → Competition → Projection → Use of funds → The ask → Contact.
- **Signature move in HTML**: Tabular-numeric fonts (`font-variant-numeric: tabular-nums`). Your pitch.css has this on `.mono`. Numbers align across slides. PPT doesn't do this natively.
- **Trap**: Over-designing. The Pitch deck's restraint (paper palette, single terracotta accent per slide, zero animations) is correct. Don't let anyone add "pop."

**2. Press/narrative deck** (your `Weigh-In Deck.html` is the reference)
- **Length**: 14–20 slides.
- **Must-have beats**: Hook → thesis → positioning → tale-of-the-tape/comparison → the pivot (reveal the thing) → proof moments → by-the-numbers → the offer/tickets → close.
- **Signature move**: Broadcast chyrons, LIVE bugs, corner tags. This is thematic design doing work no PPT template can copy — and it's repeatable. The chyron system in `weigh-in.css` is a component kit: reuse it for Formula 1 deep dives, boxing card explainers, geopolitical face-offs.
- **Trap**: Theme overwhelming content. Every slide has a broadcast graphic; that's a lot. Test: can you read the headline in 2 seconds? If the chyron obscures the punch, kill it on that slide.

**3. Manifesto/decree deck** (your `FalCaMel Decree` in `/project/`)
- **Length**: 12–16 slides.
- **Must-have beats**: Opening decree (the rule) → Article I (first claim) → Article II (proof) → Article III (example) → Article IV (the challenge/conflict) → Article V (the resolution/summons).
- **Signature move**: Bilingual typography, seal/stamp SVGs, ledger-style pricing. Arabic + Latin at parity is a voice move, not a styling move.
- **Trap**: Over-poetry. One line per slide, not three.

### The decks I'd add to your library

**4. Story bible / episode pitch** (for your YouTube work — you don't have one)
- **Length**: 10–15 slides.
- **Beats**: Cold-open hook → the question → why now → three act structure → cast of characters (real people you're profiling) → the twist → the thesis → the visuals (keyframes, locations, b-roll) → the ask (production budget, timeline).
- **Signature move**: Keyframe strip — a horizontal row of thumbnails that's the visual beat map for the episode. HTML gallery > PPT image row, every time.
- **Why it matters for you**: This is the deck you'd actually use for your documentary work. You have none in the folder.

**5. Sponsor/brand one-pager** (expandable to short deck)
- **Length**: 1 screen (one-pager) or 3–5 slides (micro-deck).
- **Beats**: Channel proof (numbers up top) → audience fit (who watches) → past integrations (receipts) → the ask → contact.
- **Signature move**: Audience data-viz (age, geo, interests) rendered as live charts, not PNG exports. Feels current.

**6. Sizzle / trailer board**
- **Length**: 1 vertical scroll page with autoplay muted video sections OR a 6–8 slide deck.
- **Beats**: Hook cold-open → "you'll see" promises → "starring" talent callouts → "from the team that made" credentials → release window → the button.
- **Signature move**: Background video as the design substrate, not an insert.

**7. Conference keynote**
- Different from investor pitch: huge type, sparse bullets, lots of breath.
- 18:9 or 21:9 authored size, not 16:9. Your deck-stage.js accepts arbitrary width/height attributes.

**8. Client proposal** (same-day turnarounds)
- Plain, fast, scannable. Same chassis as investor pitch but less storytelling, more grid-of-what-you-get.

**9. Internal status update** (weekly/monthly)
- Same template re-run with different data. The "one HTML file per week" pattern. Speaker notes JSON becomes the narrated voiceover for async Looms.

### The scroll pages worth systematizing

**10. Concept landing page** (Decree, Descent, index.html pattern)
- **Length**: 8–12 sections.
- **Beats**: Hero with video/image → hook statement → how it works → the cast/product → pricing/menu → proof/stats → the ask/booking → footer.
- **Signature move**: Section-anchored nav, sticky header that adapts on scroll, bilingual headline pairs for international concepts.
- **When NOT to confuse with a deck**: if the recipient says "send me the deck," they want the slides version, not this. Build both from the same content source.

### Common traps across every template

- **Speaker notes are not a footnote.** Your decks put them in a `<script type="application/json" id="speaker-notes">` — that's correct engineering. But I see many of them in the deck files are unpopulated. Write them. They're the voiceover for the MP4, the narration for the Loom, and your own memory prompt when you present cold.
- **16:9 is not sacred.** 21:9 for conference-projector presentations, 9:16 for Stories/Reels. Your deck-stage.js is resolution-agnostic. Use that.
- **Page numbers matter.** Your pitch has `01 / 16`. Your Weigh-In doesn't. Q&A becomes hell without them. Always include.
- **Conf/confidentiality marks, if relevant.** Your Pitch has `<div class="conf">Confidential</div>` with a pulsing dot. That's broadcast-fluent corporate signaling. Keep it.

---

## 4. Critique of the three decks — with reasoning

### `FalCaMel Pitch.html` — the investor deck

**What works.** This is the most disciplined deck in the folder. The typography hierarchy (Inter Tight for display, Inter for body, JetBrains Mono for numbers) is adult. The paper palette with a single terracotta accent per slide is restrained. Tabular-nums on data rows. `01 / 16` page numbers. `Confidential` dot. Exec summary as the second slide, not buried. The 8.5M ask is stated four times across the deck at varying levels of detail — that's good deck-writing. The contact slide includes the site-visit protocol with Fridays closed — specific, real.

**What's copper demanding platinum.**

- **Slide 2 (Executive Summary) has four bullets, revealed all at once.** On first click-in, the audience reads ahead and you lose them. Add a within-slide step revealer — same slide, spacebar reveals bullets 1-4 sequentially. This is the single biggest improvement you could make to the deck's live-presentation experience.
- **Slide 13 (Growth Projection) is a sequence of text claims about revenue.** It begs to be a chart. Even a 5-bar SVG with the numbers drawing up as the slide activates is more persuasive than "FY23 380K → FY24 1.2M → FY25 2.4M → FY26 6.1M → FY27 12.4M → FY28 18.7M" in prose. You're asking an investor to visualize a curve. Give them the curve.
- **Slide 14 (Use of Funds) lists five allocations as paragraph prose.** Same note — a horizontal stacked bar or a five-wedge donut, with the projected 4.2× return as the punchline number.
- **Slide 8 (Unit Economics) buries the killer stat** — "EBITDA margin is 28 percent. Industry benchmark for Riyadh cafes is 14." This is 2× the industry. It should be a hero number on the slide, not the last sentence of a paragraph.
- **No hero image anywhere except slide 4.** An investor pitch about cliff-edge hospitality with one image of the cliff is underselling. Slide 1 (title) should have the cliff as a muted background. Slide 9 (location) should have a satellite map with the three catalyst venues marked. Slide 16 (contact) should have Steve's face. You have `cliff-majlis.jpg`, `cliff-majlis-steve.jpeg`, `falcon-diving.jpg` in the folder. Use them.
- **The speaker notes are real and well-written.** Good. Keep doing this. Consider: your deck-stage.js broadcasts `slideIndexChanged` — build a second window (presenter-view.html) that listens and shows notes + timer + upcoming-slide preview. ~100 lines, massive professional upgrade.

**What to steal from this deck for others.** The header strip (brand mark + kicker + confidentiality badge). The footer strip (footnote source + page number). The `01 / 16` page counter format. The single-accent-per-slide discipline. The tabular-nums number block.

### `Weigh-In Deck.html` — the press/narrative deck

**What works.** The concept is the craft. "Two rulers. Sixty billion. One cafe with a ringside seat" is a pitch sentence that decks usually need three slides to deliver. Your structure delivers it in one. The broadcast chyrons, LIVE bug, corner tags, and Tale-of-the-Tape layout translate fight-broadcast visual grammar into slide design — that's a design move I haven't seen in a deck before. The plot-twist slide ("they're actually friends") earns its keep as a narrative beat. The `tweaks-panel` at the bottom of the HTML (the segmented control for corner/accent/surface) is a genuinely clever author-time tool.

**What's copper demanding platinum.**

- **Slide 1 (The Weigh-In) has a live bug AND a broadcast tag AND a chyron AND hero copy AND a lede AND a kicker.** Six layers of information on the opening slide. The hierarchy is clear (`title-giant` dominates), but the chyron at the bottom with "MBS · Qiddiya vs. MBZ · Yas Island" is doing work the hero should already be doing. Consider: drop the chyron on slide 1 so the title lands clean, then introduce the chyron on slide 2. It becomes a motif that enters, not furniture that's always there.
- **Slide 7 (47–0) has no image, just type.** This is your hero stat. This deserves background video — the falcon diving, desaturated, with the score-number holding in the center. You have `falcon-diving.jpg`. Better: if you have any 2s of falcon flight video, this is where it goes.
- **Slide 4 (Tale of the Tape) is information-dense and reads flat.** It's a 2-column comparison. Test: can the back of the room read the fighter names? The `.fighter-name` at whatever size it renders (I'd need to see computed, but from the CSS and hierarchy it's the `h3` family) is probably too small for the role it's playing. Bump fighter names to hero scale, stats secondary. Right now it reads like a spec sheet; it should read like a card-fight poster.
- **Slide 12 (By the Numbers) is stats-as-prose.** Same note as pitch slide 13. This is a slide that begs to be a grid of hero numbers with labels underneath. You have the data: 142, 600, 72, 91%, 47-0, 6, 45, 8B. Each gets its own cell. Each cell has a one-line label. Done.
- **The close (slide 16 "The Summons") is text-only against a dark background.** Your closing slide is the one people screenshot. Put Sultan or the cliff-at-dusk behind it, tinted.
- **View Transitions between the Weigh-In's LIVE-bug moments would be free magic.** The bug is on every slide. Use `view-transition-name: live-bug` on it — when you navigate between slides, the browser morphs the bug smoothly instead of flickering. Zero cost.

**What to steal.** The broadcast chyron system (`.live-bug`, `.chyron`, `.broadcast-tag`, `.corner-tag`, `.score-tag`) is a component kit. Package it. Any future deck about a rivalry (political, corporate, sports) reuses this.

### `FalCaMel Decree.html` — the manifesto

**What works.** Arabic-first typography is a voice choice, not a styling choice. The `Decree No. 001 · Issued by the House of Jaddah` framing commits to the conceit hard. The SVG seal on the "Summons" section is hand-built and detailed — the rotational `<use>` pattern, the diamond lattice, the Arabic `ج` in gold — that's craft. The ledger-style menu with Arabic and Latin columns separated by price is a pattern you could trademark. The coaster-note ("smaller than the camel") is wit without being glib.

**What's copper demanding platinum.**

- **This is a scroll page masquerading as a deck.** The file I read (`falcamel/FalCaMel Decree.html` at top level) has no `<deck-stage>`, no `.slide` class, no speaker notes, no page numbers. It's a single-page experience with articles. It's beautiful — but it's not the PPTX'd deck version. The *deck* version lives at `falcamel/project/FalCaMel Deck.html` and *that* one has 16 proper slides with speaker notes.
- **Clarify which is which in your filenames.** `FalCaMel Decree.html` at top level = the scroll manifesto. `FalCaMel Deck.html` inside project/ = the deck. Rename them so `FalCaMel Decree — Page.html` and `FalCaMel Decree — Deck.html` make the distinction unambiguous. Future-you will thank present-you.
- **The scroll version is missing a hero image for each Article.** Article I (Residents) has the iconostasis of animal photos — great. Article II (Rite) has a frame with qahwa service — great. Article III (Table) is all typography, no image. Article IV (Race) has the falcon — great. Article V (Summons) has the SVG seal — great. So it's Article III that's the gap. A single photo of the full spread — one of your `luqaimat.jpg` or the maamoul — as a rite-style framed image below the ledger. Fills the rhythm.
- **No animations anywhere, not even fades.** The scroll version would benefit from `animation-timeline: view()` on each Article's hero photo — a subtle crossfade/scale as the section enters viewport. 10 lines of CSS. No JS.
- **The deck version (in project/) has fully populated speaker notes — 16 paragraphs of written voiceover.** This is the most ready-to-record deck you own. This should be your first MP4 export candidate.

**What to steal.** The Article numbering pattern (المادة الأولى · Article I). The bilingual headline pairs. The ledger row structure. The SVG seal — that's a reusable brand element across all FalCaMel output.

### Cross-deck observations

**Asset paths are fragile.** Pitch deck uses `../../cliff-majlis.jpg` (two levels up). Weigh-In uses `../../mbs-vs-MBZ-6.png`. If you move these files, you break them. Proposal: move to `./assets/` within each deck folder, or introduce an `assets/` symlink pattern. This is a 2-hour cleanup that saves 20 hours of future debugging.

**Font loading is not guarded.** All three decks load Google Fonts via `<link>`. On first-load on a corporate network that blocks Google Fonts, your hero typography falls back to system fonts and the design collapses. Fix: preload critical faces AND ship a `@font-face` fallback that embeds the fonts as WOFF2 in the deck (or inline base64 — the Arabic faces are small). This is especially important for Arabic faces on Windows machines that don't ship `Reem Kufi`.

**No presenter view exists.** Your deck-stage broadcasts `slideIndexChanged` via postMessage — that was built for a presenter view that doesn't yet exist in this folder. Biggest single engineering addition: build `presenter.html` that opens alongside the main deck, listens to the postMessage, and shows: current slide thumbnail, next slide thumbnail, speaker notes, elapsed time, slide count. About 150 lines. Makes you indistinguishable from a polished Keynote user.

**No per-deck README.** Each deck folder should have a 5-line `README.md` answering: what's this deck for, who's the intended audience, what's the PPTX export command, what's the presenter-view command. Ralph-in-three-months will be confused otherwise.

---

## The sales pitch (the 30-second version, for you to use verbatim)

*"It's a PowerPoint. Here's the .pptx. It's also a web page — here's the link. Both came out of the same file. If you want me to walk you through it live, I'll open the HTML and full-screen it; if you want to forward the .pptx to your partners, do that; if you want to skim it on your phone, use the link. When you send me comments, I'll update one file and regenerate all three. No copy-paste, no version confusion."*

That's the pitch. Deliver it evenly. Watch them stop worrying.

---

## What to build next (if you want a roadmap)

Ranked by ROI:

1. **Within-slide step revealer** (deck-stage.js addition, ~40 lines). Biggest live-presentation upgrade.
2. **Presenter view window** (new file, ~150 lines). Biggest professional-polish upgrade.
3. **View Transitions between slides** (CSS additions on shared elements). Biggest "wow" with least effort.
4. **Font embedding / fallback** (all decks). Biggest reliability win.
5. **Chart-draw utility** (shared script, ~80 lines). Makes financial slides professional.
6. **MP4 export pipeline** (puppeteer-screen-recorder + scripted navigation). Unlocks social distribution.
7. **Per-deck README + asset path cleanup.** Boring, necessary.
8. **A YouTube episode pitch template.** The deck you actually need and don't have.

Items 1, 2, 3, and 4 would take one focused day each and collectively turn your system from "really good" to "competitive with Pitch, Tome, and Gamma at their own game."

---

## Verified facts cited above

- **Chrome's print-to-PDF and CSS `@page`**: graphical dialog doesn't always honor page size; headless Chrome does. [Excessively Adequate · Controlling Chrome Print via CSS](https://excessivelyadequate.com/posts/print.html), [Chrome headless vs. graphical print](https://andre.arko.net/2025/05/25/chrome-headless-print-to-pdf/), [Chromium issue 238303 re @page](https://bugs.chromium.org/p/chromium/issues/detail?id=238303).
- **HTML→PPTX fidelity landscape**: [dom-to-pptx](https://github.com/atharva9167j/dom-to-pptx) and [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) produce editable shapes, not screenshots, which matches what I see in your Decree PPTX. [DeckTape](https://github.com/astefanutti/decktape) is a PDF exporter for HTML presentations but produces PDF, not editable PPTX.
- **View Transitions & scroll-driven animations in 2026**: cross-document View Transitions shipped Safari 18.2, Firefox 144 (Oct 2025), making Baseline Newly Available. Scroll-driven animations: Chrome 115+, Safari 26+, Firefox still needs polyfill. [MDN · Scroll-driven animation timelines](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines), [Chrome for Developers · View Transitions 2025 update](https://developer.chrome.com/blog/view-transitions-in-2025), [Interop 2026 · CSS-Tricks](https://css-tricks.com/interop-2026/), [Announcing Interop 2026 · WebKit](https://webkit.org/blog/17818/announcing-interop-2026/).
- **Email attachment limits**: Gmail 25MB / Outlook 20–34MB advertised; base64 adds ~37% overhead → effective limits ~18MB / ~14.5MB. [Fileza · Email Attachment Size Limits 2026](https://fileza.io/articles/email-attachment-size-limits-guide), [SizeSnap · Email Attachment Limits](https://sizesnap.io/blog/email-attachment-size-limits), [DeBounce · Email File Size Limits](https://debounce.com/blog/email-file-size-limit/).
- **Headless-Chrome MP4 of HTML decks**: [puppeteer-screen-recorder](https://www.npmjs.com/package/puppeteer-screen-recorder), [playwright-screen-recorder](https://github.com/raymelon/playwright-screen-recorder/).
