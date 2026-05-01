# Apple Gallery Showcase · Gallery Display-wall Animation Style

> **GALLERY = FORMAT 9 (2026-04-30).** This file is the canonical runtime grammar for the **Gallery format** — Format 9 in the 20-category × 9-format matrix in `skills/references/slide-decks.md`. Gallery applies to categories #2 Product Launch (system launch with multiple capabilities), #7 Marketing Portfolio (canonical portfolio pattern), #17 Product Demo (skill capability demo with 10+ outputs). The structural rules below — visual tokens, layout patterns, 5 animation patterns, timeline architecture, craft details, failure modes — are what CD/WebDev follow when implementing Gallery. The integrated summary lives in `docs/HUASHU-INTEGRATION-PROPOSAL.md` v4 §C11; that's for backlog reasoning, this file is for runtime use.
>
> Inspired by the Claude Design site hero video + Apple product-page "showcase wall" arrangement
> Battle-tested on huashu-design release hero v5
> Best for: **product launch hero animations, skill capability demos, portfolio displays** — anywhere you need to display "many high-quality outputs" simultaneously while guiding the viewer's attention

---

## Trigger Check: When to Use This Style

**Good fit**:
- 10+ real outputs to display simultaneously (PPT, App, web, infographics)
- Audience is a professional one (developers, designers, PMs) sensitive to "craft"
- The vibe you want is "restrained, exhibition-like, refined, with breathing room"
- You need focus and overview to coexist (close-up details without losing the whole)

**Bad fit**:
- Single-product spotlight (use the frontend-design product hero template)
- Emotion-driven / story-driven animation (use a timeline narrative template)
- Small screen / vertical (the tilted perspective gets muddy on small canvases)

---

## Core Visual Tokens

```css
:root {
  /* Light gallery palette */
  --bg:         #F5F5F7;   /* main canvas — Apple site gray */
  --bg-warm:    #FAF9F5;   /* warm off-white variant */
  --ink:        #1D1D1F;   /* primary text */
  --ink-80:     #3A3A3D;
  --ink-60:     #545458;
  --muted:      #86868B;   /* secondary text */
  --dim:        #C7C7CC;
  --hairline:   #E5E5EA;   /* card 1px border */
  --accent:     #D97757;   /* terracotta orange — Claude brand */
  --accent-deep:#B85D3D;

  --serif-cn: "Noto Serif SC", "Songti SC", Georgia, serif;
  --serif-en: "Source Serif 4", "Tiempos Headline", Georgia, serif;
  --sans:     "Inter", -apple-system, "PingFang SC", system-ui;
  --mono:     "JetBrains Mono", "SF Mono", ui-monospace;
}
```

**Key principles**:
1. **Never pure black**. Black makes the work feel cinematic — not "an output you could actually adopt"
2. **Terracotta is the only accent hue**, everything else is grayscale + white
3. **Three-typeface stack** (serif EN + serif CN + sans + mono) creates a "publication" tone, not an "internet product" tone

---

## Core Layout Patterns

### 1. Floating cards (the basic unit of the whole style)

```css
.gallery-card {
  background: #FFFFFF;
  border-radius: 14px;
  padding: 6px;                          /* the padding is the "matting paper" */
  border: 1px solid var(--hairline);
  box-shadow:
    0 20px 60px -20px rgba(29, 29, 31, 0.12),   /* main shadow, soft and long */
    0 6px 18px -6px rgba(29, 29, 31, 0.06);     /* second close-light layer, creates float */
  aspect-ratio: 16 / 9;                  /* unified slide ratio */
  overflow: hidden;
}
.gallery-card img {
  width: 100%; height: 100%;
  object-fit: cover;
  border-radius: 9px;                    /* slightly smaller radius than the card — visual nesting */
}
```

**Counter-example**: don't tile flush (no padding, no border, no shadow) — that's information-graphic density, not exhibition.

### 2. 3D tilted showcase wall

```css
.gallery-viewport {
  position: absolute; inset: 0;
  overflow: hidden;
  perspective: 2400px;                   /* deeper perspective, tilt isn't exaggerated */
  perspective-origin: 50% 45%;
}
.gallery-canvas {
  width: 4320px;                         /* canvas = 2.25x viewport */
  height: 2520px;                        /* leaves room for pan */
  transform-origin: center center;
  transform: perspective(2400px)
             rotateX(14deg)              /* tilt back */
             rotateY(-10deg)             /* turn left */
             rotateZ(-2deg);             /* slight tilt — kills the too-orderly look */
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 40px;
  padding: 60px;
}
```

**Sweet-spot parameters**:
- rotateX: 10-15deg (more than that and it feels like a VIP party backdrop)
- rotateY: ±8-12deg (left-right symmetry)
- rotateZ: ±2-3deg ("not robot-placed" human touch)
- perspective: 2000-2800px (less than 2000 fish-eyes; more than 3000 approaches orthographic)

### 3. 2×2 four-corner convergence (selection scenario)

```css
.grid22 {
  display: grid;
  grid-template-columns: repeat(2, 800px);
  gap: 56px 64px;
  align-items: start;
}
```

Each card slides in from its corner (tl/tr/bl/br) toward center, with fade in. Matching `cornerEntry` vectors:

```js
const cornerEntry = {
  tl: { dx: -700, dy: -500 },
  tr: { dx:  700, dy: -500 },
  bl: { dx: -700, dy:  500 },
  br: { dx:  700, dy:  500 },
};
```

---

## Five Core Animation Patterns

### Pattern A · Four-corner convergence (0.8-1.2s)

4 elements slide in from the viewport corners, scaling 0.85→1.0, with ease-out. Best as an opening for "showing multi-directional choice."

```js
const inP = easeOut(clampLerp(t, start, end));
card.style.transform = `translate3d(${(1-inP)*ce.dx}px, ${(1-inP)*ce.dy}px, 0) scale(${0.85 + 0.15*inP})`;
card.style.opacity = inP;
```

### Pattern B · Selected zoom + others slide out (0.8s)

The selected card scales 1.0→1.28, the others fade out + blur + drift back to corners:

```js
// Selected
card.style.transform = `translate3d(${cellDx*outP}px, ${cellDy*outP}px, 0) scale(${1 + 0.28*easeOut(zoomP)})`;
// Not selected
card.style.opacity = 1 - outP;
card.style.filter = `blur(${outP * 1.5}px)`;
```

**Key**: the unselected ones must blur, not just fade. Blur simulates depth of field — visually "pushing the selected one forward."

### Pattern C · Ripple expand (1.7s)

From the center outward, delay by distance — each card fades in + scales 1.25x→0.94x ("camera pulling back"):

```js
const col = i % COLS, row = Math.floor(i / COLS);
const dc = col - (COLS-1)/2, dr = row - (ROWS-1)/2;
const dist = Math.sqrt(dc*dc + dr*dr);
const delay = (dist / maxDist) * 0.8;
const localT = Math.max(0, (t - rippleStart - delay) / 0.7);
card.style.opacity = easeOut(Math.min(1, localT));

// Whole gallery scales 1.25→0.94 simultaneously
const galleryScale = 1.25 - 0.31 * easeOut(rippleProgress);
```

### Pattern D · Sinusoidal Pan (continuous drift)

Combine sine wave + linear drift — avoid the "has start, has end" loop feel of a marquee:

```js
const panX = Math.sin(panT * 0.12) * 220 - panT * 8;    // horizontal drift left
const panY = Math.cos(panT * 0.09) * 120 - panT * 5;    // vertical drift up
const clampedX = Math.max(-900, Math.min(900, panX));   // prevent edge exposure
```

**Parameters**:
- Sine period `0.09-0.15 rad/s` (slow — about 30-50s per swing)
- Linear drift `5-8 px/s` (slower than a viewer's blink)
- Amplitude `120-220 px` (large enough to feel, small enough to not nauseate)

### Pattern E · Focus Overlay (focus shift)

**Key design**: the focus overlay is a **flat element** (no tilt) floating on top of the tilted canvas. The selected slide scales from its tile position (~400×225) to screen center (960×540); the background canvas keeps its tilt but **dims to 45%**:

```js
// Focus overlay (flat, centered)
focusOverlay.style.width = (startW + (endW - startW) * focusIntensity) + 'px';
focusOverlay.style.height = (startH + (endH - startH) * focusIntensity) + 'px';
focusOverlay.style.opacity = focusIntensity;

// Background cards dim, but stay visible (key — never 100% mask)
card.style.opacity = entryOp * (1 - 0.55 * focusIntensity);   // 1 → 0.45
card.style.filter = `brightness(${1 - 0.3 * focusIntensity})`;
```

**Sharpness iron rule**:
- The focus overlay's `<img>` `src` must point at the original full-res image — **don't reuse the gallery's compressed thumbnail**
- Preload all originals into a `new Image()[]` array
- Set the overlay's `width/height` per-frame; the browser resamples the original each frame

---

## Timeline Architecture (reusable skeleton)

```js
const T = {
  DURATION: 25.0,
  s1_in: [0.0, 0.8],    s1_type: [1.0, 3.2],  s1_out: [3.5, 4.0],
  s2_in: [3.9, 5.1],    s2_hold: [5.1, 7.0],  s2_out: [7.0, 7.8],
  s3_hold: [7.8, 8.3],  s3_ripple: [8.3, 10.0],
  panStart: 8.6,
  focuses: [
    { start: 11.0, end: 12.7, idx: 2  },
    { start: 13.3, end: 15.0, idx: 3  },
    { start: 15.6, end: 17.3, idx: 10 },
    { start: 17.9, end: 19.6, idx: 16 },
  ],
  s4_walloff: [21.1, 21.8], s4_in: [21.8, 22.7], s4_hold: [23.7, 25.0],
};

// Core easing
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
function lerp(time, start, end, fromV, toV, easing) {
  if (time <= start) return fromV;
  if (time >= end) return toV;
  let p = (time - start) / (end - start);
  if (easing) p = easing(p);
  return fromV + (toV - fromV) * p;
}

// Single render(t) function reads timestamp, writes all elements
function render(t) { /* ... */ }
requestAnimationFrame(function tick(now) {
  const t = ((now - startMs) / 1000) % T.DURATION;
  render(t);
  requestAnimationFrame(tick);
});
```

**Architecture essence**: **all state derives from the timestamp t** — no state machine, no setTimeout. So:
- `window.__setTime(12.3)` jumps to any time instantly (great for Playwright frame-by-frame screenshots)
- Loops are seamless naturally (t mod DURATION)
- During debugging you can freeze any frame

---

## Craft Details (easily missed but lethal)

### 1. SVG noise texture

Light backgrounds are at risk of looking too flat. Layer in a very subtle fractalNoise:

```html
<style>
.stage::before {
  content: '';
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.078  0 0 0 0 0.078  0 0 0 0 0.074  0 0 0 0.035 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  opacity: 0.5;
  pointer-events: none;
  z-index: 30;
}
</style>
```

You won't see the difference — until you remove it.

### 2. Corner brand mark

```html
<div class="corner-brand">
  <div class="mark"></div>
  <div>HUASHU · DESIGN</div>
</div>
```

```css
.corner-brand {
  position: absolute; top: 48px; left: 72px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--muted);
}
```

Show it only during the showcase-wall scene, fading in/out. Like a museum label.

### 3. Brand resolution wordmark

```css
.brand-wordmark {
  font-family: var(--sans);
  font-size: 148px;
  font-weight: 700;
  letter-spacing: -0.045em;   /* negative tracking is key — pulls letters into a logo */
}
.brand-wordmark .accent {
  color: var(--accent);
  font-weight: 500;           /* the accent character is actually thinner — visual contrast */
}
```

`letter-spacing: -0.045em` is the standard Apple product-page large-display move.

---

## Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Looks like a PPT template | Cards have no shadow / no hairline | Add two box-shadow layers + 1px border |
| Tilt feels cheap | Only used rotateY, no rotateZ | Add ±2-3deg rotateZ to break the rigidity |
| Pan feels janky | Used setTimeout or CSS keyframes loops | Use rAF + sin/cos continuous functions |
| Text unreadable on focus | Reused the low-res gallery thumbnail | Independent overlay + original src |
| Background feels empty | Pure `#F5F5F7` | Layer in SVG fractalNoise at 0.5 opacity |
| Type feels too "internet" | Only Inter | Add Serif (CN+EN) + mono for a 3-stack |

---

## References

- Full implementation sample: `/Users/alchain/Documents/writing/01-wechat-writing/projects/2026.04-huashu-design-launch/assets/hero-animation-v5.html`
- Original inspiration: claude.ai/design hero video
- Aesthetic references: Apple product pages, Dribbble shot collection pages

When you hit "many high-quality outputs to display" animation needs, copy the skeleton from this file, swap in content, and tune timing.
