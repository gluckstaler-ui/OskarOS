# Wireframe Doctrine Surfaces

Every wireframe HTML opens with TWO in-page surfaces stacked above the wireframe page:

1. **Self-Critique** — radar (5 axes) + KEEP / FIX / QUICK-WINS triple column
2. **Direction Banner** — CD direction + WebDev build, with an open-questions block

Below them, a `wf-marker` strip introduces the WIREFRAME PAGE.

---

## How to use this file

1. **Phase 2** — Copy the `<style>` block below into your wireframe's `<style>`. Keep the class names verbatim. Remap the five neutral tokens (`--paper`, `--ink`, `--accent`, `--raster`, `--faden`) to your vibe's palette — keep the tokens themselves named the same so the rules below still resolve.
2. **Phase 2** — Copy the HTML skeleton. Fill the **Direction Banner** slots now (voice hypothesis, section flow, anchor, build decisions, open questions) from VIBE-N.md + your own reasoning. Leave the **Self-Critique** skeleton EMPTY for now — empty radar polygon, empty `<li>`s, empty score. You fill those in Phase 7 after Phase 6 screenshots.
3. **Phase 2** — Render both surface skeletons before the `wf-marker`. The wireframe page begins after.
4. **Phase 7** — After Phase 6 screenshots the rendered file, look at the screenshot and FileEdit-fill the Self-Critique skeleton: radar polygon points, five `<circle>` vertices, composite score, KEEP/FIX/QUICK-WINS bullets. Score what you SHIPPED, not what you intended.

Phase mapping: WF mode only. Phase 4 vibes get Sentinel-Ti's external `submit_critique` (different render target — a chat-surface card, not in-page). Phase 5 finals ship clean — no surfaces at all.

Surface dimensions are LOCKED — 5 radar axes, 3 verdict columns, 4 CD `<dt>`s, 4 WebDev `<dt>`s, 1 open-questions block. Don't add axes. Don't add columns. If the vibe has nothing to say in a slot, the slot still renders with a one-line acknowledgment ("No motion in this build — see Pass 3 polish.").


## Slot rules (the only ones that matter)

- **Radar scores.** Five integers 0-10. Don't draw a polygon that flatters; CD reads the radar BEFORE the columns. If Craft is 5, write 5 — then put "Craft" in the Fix column with the specific reason.
- **Keep column.** Decisions, not features. "Live-strip above header — conversion before brand" is a decision. "Has a live strip" is a feature.
- **Fix column.** Name your own weaknesses. If you write "no fixes," you didn't look. There is always something.
- **Quick Wins column.** Concrete moves with verbs. Not "improve mobile" — "anchor-scroll the closing CTA to #hero-grid instead of /book."
- **CD · Direction slots.** Pull from VIBE-N.md verbatim where the brief is sharp. Where it's vague, write what you INFERRED — that's the read-check.
- **WebDev · Build slots.** Decisions you made, in your voice. The user reads this to catch direction errors at the cheapest moment.
- **Open questions.** Real ambiguity only. "Should the CTA be red or orange?" is not an open question — that's a decision you should have made. 

---

## The `<style>` block

```css
/* ─── Wireframe doctrine surfaces — neutral tokens ─────────────────────────
   Map these five tokens to your vibe's palette in :root.
   Keep the variable names — the rules below reference them by name.
   ────────────────────────────────────────────────────────────────────── */
:root {
  --paper:   #F2F1ED;  /* surface ground for the wireframe + banner */
  --ink:     #0A0A0A;  /* text + structural rules */
  --accent:  #C8232C;  /* radar polygon, verdict-Fix headings, key emphasis */
  --raster:  #6E6E6E;  /* meta lines, dashed rules, micro-labels */
  --faden:   #D8D6D0;  /* hairline structural lines */
}

/* ─── Shared utilities ───────────────────────────────────────────────── */
.mono  { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
.micro { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--raster); }

/* ─── DOCTRINE SURFACE 1 — Self-Critique ─────────────────────────────── */
.critique {
  background: #FFFFFF;
  border-bottom: 1px solid var(--raster);
  padding: 24px clamp(20px, 4vw, 56px);
}
.critique-head {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 20px; padding-bottom: 10px;
  border-bottom: 1px dashed var(--raster);
}
.critique-head h1 {
  margin: 0; font-size: 12px; letter-spacing: 0.18em;
  text-transform: uppercase; font-weight: 700;
}
.critique-body {
  display: grid; grid-template-columns: 240px 1fr; gap: 36px; align-items: start;
}
@media (max-width: 760px) { .critique-body { grid-template-columns: 1fr; } }
.radar-wrap { text-align: center; }
.radar-wrap svg { max-width: 240px; height: auto; }
.radar-score {
  font-size: 22px; font-weight: 700; margin-top: 2px;
  font-family: "JetBrains Mono", monospace;
}
.radar-score-lbl {
  font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--raster); margin-top: 2px;
}
.verdict { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
@media (max-width: 760px) { .verdict { grid-template-columns: 1fr; } }
.v-col h3 {
  font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
  margin: 0 0 10px 0; padding-bottom: 4px;
  border-bottom: 2px solid currentColor; display: inline-block;
}
.v-keep h3  { color: #2F7A4A; }
.v-fix h3   { color: var(--accent); }
.v-quick h3 { color: #B58F4A; }
.v-col ul { margin: 0; padding-left: 16px; font-size: 13px; }
.v-col li { margin-bottom: 6px; line-height: 1.5; }

/* ─── DOCTRINE SURFACE 2 — Direction Banner ──────────────────────────── */
.banner {
  background: #FFFFFF;
  border-bottom: 2px solid var(--ink);
  padding: 24px clamp(20px, 4vw, 56px);
  display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
}
@media (max-width: 760px) { .banner { grid-template-columns: 1fr; gap: 24px; } }
.banner h2 {
  font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase;
  margin: 0 0 12px 0; padding-left: 10px;
  border-left: 4px solid currentColor;
}
.banner-cd     h2 { color: #2E2B72; }
.banner-webdev h2 { color: #5C3317; }
.banner dl { margin: 0; font-size: 13px; }
.banner dt {
  font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--raster); margin-top: 10px;
}
.banner dt:first-child { margin-top: 0; }
.banner dd { margin: 3px 0 0 0; line-height: 1.55; }
.open-questions {
  margin-top: 14px; padding: 10px 14px;
  background: var(--faden); border-left: 3px solid #B58F4A;
  font-size: 12px;
}
.open-questions strong {
  display: block; font-size: 9px; letter-spacing: 0.14em;
  text-transform: uppercase; color: #B58F4A; margin-bottom: 4px;
}

/* ─── WIREFRAME PAGE BEGINS marker ───────────────────────────────────── */
.wf-marker {
  background: var(--ink); color: var(--paper);
  padding: 6px clamp(20px, 4vw, 56px);
  font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase;
  font-family: "JetBrains Mono", monospace;
}
```

---

## The HTML skeleton

```html
<!-- ═════════════════════ DOCTRINE SURFACE 1 — Self-Critique ═════════════════════ -->
<section class="critique" aria-label="WebDev self-critique">
  <div class="critique-head">
    <h1>WebDev · Self-Critique</h1>
    <span class="mono" style="font-size:11px; color:var(--raster);">{slug} · WF pass · {date} · {one-word posture, e.g. CONVERSION-BUILT, ATMOSPHERE-FIRST}</span>
  </div>
  <div class="critique-body">
    <div class="radar-wrap">
      <!--
        RADAR SCORES — five axes, 0-10 each.
        Compute polygon points from your scores:
          x = score * 10 * sin(angle)
          y = -score * 10 * cos(angle)
        Angles (clockwise from top): 0°, 72°, 144°, 216°, 288°
        At score=10 the polygon hits the outer ring (r=100).
        Example scores below: Phil 8 · Hier 9 · Craft 8 · Func 10 · Orig 8 (composite 8.6)
      -->
      <svg viewBox="0 0 240 240" role="img" aria-label="Critique radar — 5 dimensions">
        <g transform="translate(120 120)">
          <circle r="20"  fill="none" stroke="#E5E2D6" stroke-width="0.5"/>
          <circle r="40"  fill="none" stroke="#E5E2D6" stroke-width="0.5"/>
          <circle r="60"  fill="none" stroke="#D9D7CF" stroke-width="0.5"/>
          <circle r="80"  fill="none" stroke="#D9D7CF" stroke-width="0.5"/>
          <circle r="100" fill="none" stroke="#6E6E6E" stroke-width="0.75"/>
          <line x1="0" y1="0" x2="0"     y2="-100" stroke="#6E6E6E" stroke-width="0.5"/>
          <line x1="0" y1="0" x2="95.1"  y2="-30.9" stroke="#6E6E6E" stroke-width="0.5"/>
          <line x1="0" y1="0" x2="58.8"  y2="80.9"  stroke="#6E6E6E" stroke-width="0.5"/>
          <line x1="0" y1="0" x2="-58.8" y2="80.9"  stroke="#6E6E6E" stroke-width="0.5"/>
          <line x1="0" y1="0" x2="-95.1" y2="-30.9" stroke="#6E6E6E" stroke-width="0.5"/>
          <polygon points="{x1},{y1}  {x2},{y2}  {x3},{y3}  {x4},{y4}  {x5},{y5}"
                   fill="var(--accent)" fill-opacity="0.18"
                   stroke="var(--accent)" stroke-width="1.5"/>
          <circle cx="{x1}" cy="{y1}" r="3" fill="var(--accent)"/>
          <circle cx="{x2}" cy="{y2}" r="3" fill="var(--accent)"/>
          <circle cx="{x3}" cy="{y3}" r="3" fill="var(--accent)"/>
          <circle cx="{x4}" cy="{y4}" r="3" fill="var(--accent)"/>
          <circle cx="{x5}" cy="{y5}" r="3" fill="var(--accent)"/>
          <text x="0"    y="-110" text-anchor="middle" font-size="9" font-family="JetBrains Mono, monospace" letter-spacing="0.1em" fill="#0A0A0A">PHILOSOPHY</text>
          <text x="110"  y="-28"  text-anchor="start"  font-size="9" font-family="JetBrains Mono, monospace" letter-spacing="0.1em" fill="#0A0A0A">HIERARCHY</text>
          <text x="68"   y="98"   text-anchor="middle" font-size="9" font-family="JetBrains Mono, monospace" letter-spacing="0.1em" fill="#0A0A0A">CRAFT</text>
          <text x="-68"  y="98"   text-anchor="middle" font-size="9" font-family="JetBrains Mono, monospace" letter-spacing="0.1em" fill="#0A0A0A">FUNCTION</text>
          <text x="-110" y="-28"  text-anchor="end"    font-size="9" font-family="JetBrains Mono, monospace" letter-spacing="0.1em" fill="#0A0A0A">ORIGINALITY</text>
        </g>
      </svg>
      <div class="radar-score">{composite} / 10</div>
      <div class="radar-score-lbl">composite · {weighting note, e.g. function-weighted}</div>
    </div>

    <div class="verdict">
      <div class="v-col v-keep">
        <h3>Keep</h3>
        <ul>
          <li>{3-5 bullets — load-bearing decisions you'd defend in a critique. What's working and WHY.}</li>
        </ul>
      </div>
      <div class="v-col v-fix">
        <h3>Fix</h3>
        <ul>
          <li>{1-3 bullets — known weaknesses. Name them yourself before CD does.}</li>
        </ul>
      </div>
      <div class="v-col v-quick">
        <h3>Quick Wins</h3>
        <ul>
          <li>{1-3 bullets — concrete next moves. Real-time data hookups, scroll anchors, copy tightening.}</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- ═════════════════════ DOCTRINE SURFACE 2 — Direction Banner ═════════════════════ -->
<aside class="banner" aria-label="Direction banner">
  <section class="banner-cd">
    <h2>CD · Direction</h2>
    <dl>
      <dt>Voice hypothesis</dt>
      <dd>{One sentence — how this vibe TALKS. Quote the brand's actual words where possible.}</dd>

      <dt>Section flow</dt>
      <dd>{Numbered list of sections in order. Terse — "1 HERO · 2 SOCIAL PROOF · 3 ANCHOR · ..."}</dd>

      <dt>Anchor (the load-bearing thing)</dt>
      <dd>{The 1-3 decisions everything else hangs from. The weird detail. The signature experience. Name them by name.}</dd>

      <dt>Differentiation argument</dt>
      <dd>{Why this vibe survives a Phase 2 Descent. What it does that the other three vibes can't. One paragraph.}</dd>
    </dl>
  </section>

  <section class="banner-webdev">
    <h2>WebDev · Build</h2>
    <dl>
      <dt>Color discipline</dt>
      <dd>{Which token does what. Where the accent is allowed, where it isn't. The budget.}</dd>

      <dt>Type pairing</dt>
      <dd>{Display font + body font + any third (mono/numerals). What each is reserved for.}</dd>

      <dt>Animation posture</dt>
      <dd>{Motion-led / restrained / static. If motion: name every animated element. If static: say "static" and stop.}</dd>

      <dt>Image strategy</dt>
      <dd>{What's grey-box placeholder, what's real, what's intentionally absent. The photo budget.}</dd>
    </dl>

    <div class="open-questions">
      <strong>Open questions</strong>
      {One paragraph — what you'd ask CD before Pass 2. Real ambiguity, not theater. If you have nothing, write "No open questions — direction is unambiguous."}
    </div>
  </section>
</aside>

<!-- ═════════════════════ WIREFRAME PROPER ══════════════════════════════════ -->
<div class="wf-marker">─── WIREFRAME PAGE BEGINS · {slug} · {date} ───</div>

<!-- your wireframe page starts here -->
```

---
