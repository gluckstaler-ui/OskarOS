# Gallery Ripple + Multi-Focus · Scene Composition Philosophy

> A **reusable visual composition structure** distilled from huashu-design's hero animation v9
> (25 seconds, 8 scenes).
> This is not an animation production pipeline; it's **what scenarios this composition is "right" for**.
> Live reference: [demos/hero-animation-v9.mp4](../demos/hero-animation-v9.mp4) · [https://www.huasheng.ai/huashu-design-hero/](https://www.huasheng.ai/huashu-design-hero/)

## TL;DR

> **When you have 20+ homogeneous visual assets and the scene needs to "express scale and depth",
> prioritize Gallery Ripple + Multi-Focus over piling on layouts.**

Generic SaaS feature animations, product launches, skill marketing, series portfolio reveals —
whenever you have enough material with consistent style, this structure almost always lands.

---

## What This Move Actually Expresses

It's not "showing off material" — it tells a narrative through **two rhythm changes**:

**Beat 1 · Ripple Unfold (~1.5s)**: from center, 48 cards radiate outward. The audience is hit by
"volume" — "oh, this thing has produced this much".

**Beat 2 · Multi-Focus (~8s, 4 cycles)**: while the camera slow-pans, 4 times it dims + desaturates
the background and zooms one card to the center of the screen. The audience switches from "shock of
quantity" to "gaze of quality"; each cycle 1.7s, steady rhythm.

**Core narrative**: **scale (Ripple) → gaze (Focus × 4) → fade (Walloff)**. These three beats
together express "Breadth × Depth" — not just capable of many things, but each of them worth pausing
on.

Compare to counter-examples:

| Approach | Audience perception |
|------|---------|
| 48 cards arranged statically (no Ripple) | Looks nice but no narrative; like a grid screenshot |
| Quick cuts one by one (no gallery context) | Like a slideshow, loses "scale" |
| Only Ripple, no Focus | Shocked by quantity but doesn't remember any specific one |
| **Ripple + Focus × 4 (this recipe)** | **First shock of volume, then gaze of quality, finally calm fade — complete emotional arc** |

---

## Prerequisites (all must be met)

This composition is **not universal**. The 4 conditions below are all required:

1. **Asset count ≥ 20, ideally 30+**
   Fewer than 20 makes the Ripple feel "empty" — only with all 48 cells in motion does the density
   land. v9 used 48 cells × 32 images (loop-fill).

2. **Visually consistent style across assets**
   All 16:9 slide previews / all app screenshots / all cover designs — aspect ratio, palette, layout
   must look like "a set". Mixing types makes the gallery look like a clipboard.

3. **Each asset still has readable info when scaled up**
   Focus enlarges one card to 960px wide; if the original looks blurry or sparse when zoomed, this
   beat is wasted. Reverse check: can you pick 4 "most representative" out of the 48? Can't pick =
   asset quality is uneven.

4. **Scene itself is landscape or square, not portrait**
   The gallery's 3D tilt (`rotateX(14deg) rotateY(-10deg)`) needs lateral spread; portrait makes the
   tilt look narrow and awkward.

**Fallbacks if conditions are missing**:

| Missing | Degrade to |
|-------|-----------|
| < 20 assets | Use "3-5 static side-by-side + sequential focus" |
| Inconsistent style | Use "cover + 3 chapter big images" keynote-style |
| Sparse info | Use "data-driven dashboard" or "punchline + big text" |
| Portrait scene | Use "vertical scroll + sticky cards" |

---

## Technical Recipe (v9 production parameters)

### 4-Layer Structure

```
viewport (1920×1080, perspective: 2400px)
  └─ canvas (4320×2520, oversized overflow) → 3D tilt + pan
      └─ 8×6 grid = 48 cards (gap 40px, padding 60px)
          └─ img (16:9, border-radius 9px)
      └─ focus-overlay (absolute center, z-index 40)
          └─ img (matches selected slide)
```

**Key**: canvas is 2.25× the viewport — pan then has the feel of "peeking into a larger world".

### Ripple Unfold (distance-delay algorithm)

```js
// Each card's entry time = distance-from-center × 0.8s delay
const col = i % 8, row = Math.floor(i / 8);
const dc = col - 3.5, dr = row - 2.5;       // offset to center
const dist = Math.hypot(dc, dr);
const maxDist = Math.hypot(3.5, 2.5);
const delay = (dist / maxDist) * 0.8;       // 0 → 0.8s
const localT = Math.max(0, (t - rippleStart - delay) / 0.7);
const opacity = expoOut(Math.min(1, localT));
```

**Core parameters**:
- Total duration 1.7s (`T.s3_ripple: [8.3, 10.0]`)
- Max delay 0.8s (center first, corners last)
- Each card entry 0.7s
- Easing: `expoOut` (burst feel, not smooth)

**Simultaneous action**: canvas scale 1.25 → 0.94 (zoom out to reveal) — synchronized push-back feel
paired with the appearance.

### Multi-Focus (4-cycle rhythm)

```js
T.focuses = [
  { start: 11.0, end: 12.7, idx: 2  },  // 1.7s
  { start: 13.3, end: 15.0, idx: 3  },  // 1.7s
  { start: 15.6, end: 17.3, idx: 10 },  // 1.7s
  { start: 17.9, end: 19.6, idx: 16 },  // 1.7s
];
```

**Rhythm pattern**: each focus 1.7s, 0.6s breathing room between. Total 8s (11.0–19.6s).

**Within each focus**:
- In ramp: 0.4s (`expoOut`)
- Hold: 0.9s middle (`focusIntensity = 1`)
- Out ramp: 0.4s (`easeOut`)

**Background change (this is key)**:

```js
if (focusIntensity > 0) {
  const dimOp = entryOp * (1 - 0.6 * focusIntensity);  // dim to 40%
  const brt = 1 - 0.32 * focusIntensity;                // brightness 68%
  const sat = 1 - 0.35 * focusIntensity;                // saturate 65%
  card.style.filter = `brightness(${brt}) saturate(${sat})`;
}
```

**Not just opacity — desaturate + darken simultaneously**. This makes the foreground overlay's color
"jump out" instead of just "getting brighter".

**Focus overlay size animation**:
- 400×225 (entrance) → 960×540 (hold)
- 3 layers of shadow + 3px accent-color outline ring around it, giving a "framed" feel

### Pan (sustained motion keeps stillness from being boring)

```js
const panT = Math.max(0, t - 8.6);
const panX = Math.sin(panT * 0.12) * 220 - panT * 8;
const panY = Math.cos(panT * 0.09) * 120 - panT * 5;
```

- Sine wave + linear drift, two-layer motion — not pure loop, every moment a different position
- X/Y use different frequencies (0.12 vs 0.09) to avoid visually obvious "loop pattern"
- Clamp at ±900/500px to prevent drifting off

**Why not pure linear pan**: with linear, the audience "predicts" where it goes next; sine + drift
makes every second new. Under 3D tilt this creates a slight "seasickness" (the good kind), holding
attention.

---

## 5 Reusable Patterns (distilled from v6→v9 iterations)

### 1. **expoOut as Main Easing, Not cubicOut**

`easeOut = 1 - (1-t)³` (smooth) vs `expoOut = 1 - 2^(-10t)` (burst then quickly converges).

**Why**: expoOut hits 90% in the first 30%, more like physical damping, matches the intuition of
"heavy thing landing". Especially good for:
- Card entry (weight)
- Ripple spread (shockwave)
- Brand surface (settling feel)

**When to still use cubicOut**: focus out ramp, symmetric micro-effects.

### 2. **Paper Background + Terracotta Orange Accent (Anthropic Lineage)**

```css
--bg: #F7F4EE;        /* warm paper */
--ink: #1D1D1F;       /* almost black */
--accent: #D97757;    /* terracotta orange */
--hairline: #E4DED2;  /* warm hairline */
```

**Why**: warm background still has "breathing" feel after GIF compression, unlike pure white which
feels "screen-y". Terracotta orange as the only accent threads through terminal prompt, dir-card
selected, cursor, brand hyphen, focus ring — every visual anchor is tied together by this single
color.

**v5 lesson**: added a noise overlay to simulate "paper grain"; result was every frame differs and
GIF compression breaks. v6 changed to "background only + warm shadow", paper feel retained 90%, GIF
size shrunk 60%.

### 3. **Two-Tier Shadows Simulate Depth, No Real 3D**

```css
.gallery-card.depth-near { box-shadow: 0 32px 80px -22px rgba(60,40,20,0.22), ... }
.gallery-card.depth-far  { box-shadow: 0 14px 40px -16px rgba(60,40,20,0.10), ... }
```

Use deterministic algorithm `sin(i × 1.7) + cos(i × 0.73)` to assign each card to one of three tiers
(near/mid/far) of shadow — **visually a "3D stacking" feel, but every frame's transform is identical,
GPU cost 0**.

**Cost of real 3D**: each card needs its own `translateZ`, GPU computes 48 transforms + shadow blur
every frame. v4 tried it; Playwright recording at 25fps was struggling. v6's two-tier shadows have
<5% perceptible difference, but cost is 10× lower.

### 4. **Weight Animation (font-variation-settings) Is More Cinematic Than Size Animation**

```js
const wght = 100 + (700 - 100) * morphP;  // 100 → 700 over 0.9s
wordmark.style.fontVariationSettings = `"wght" ${wght.toFixed(0)}`;
```

Brand wordmark goes Thin → Bold over 0.9s, paired with letter-spacing fine-tune (-0.045 → -0.048em).

**Why this beats scale up/down**:
- Audiences have seen scale up/down too much; expectation is locked in
- Weight change is "intrinsic fullness" — like a balloon being inflated, not "being pushed closer"
- Variable fonts only became common after 2020+; audiences subconsciously feel "modern"

**Limitations**: must use a font that supports variable axes (Inter / Roboto Flex / Recursive etc.).
Static fonts can only fake it (switching between fixed weights produces jumps).

### 5. **Corner Brand Low-Intensity Sustained Signature**

The gallery phase has a small `HUASHU · DESIGN` mark in the upper-left at 16% opacity, 12px font,
wide tracking.

**Why add this**:
- After the Ripple burst, the audience tends to "lose focus" and forget what they're looking at; the
  upper-left mark anchors them
- More elegant than a full-screen logo — brand designers know that brand signatures don't need to
  shout
- When the GIF is screenshotted and shared, leaves an attribution signal

**Rule**: only appears in the middle (busy frame); off in the opening (don't cover terminal); off in
the closing (brand reveal is the star).

---

## Counter-Examples: When Not to Use This Composition

**❌ Product demo (need to show features)**: Gallery flashes each card, audience can't remember any
function. Use "single-screen focus + tooltip annotation".

**❌ Data-driven content**: audience needs to read numbers; gallery's fast pace doesn't allow time.
Use "data charts + sequential reveal".

**❌ Story narrative**: Gallery is a "parallel" structure, story needs "cause and effect". Use
keynote chapter switching.

**❌ Only 3-5 assets**: Ripple density insufficient, looks like "patches". Use "static arrangement +
sequential highlight".

**❌ Portrait (9:16)**: 3D tilt needs lateral spread; portrait makes the tilt feel "skewed" not
"unfolding".

---

## How to Tell If Your Task Fits This Composition

Three quick checks:

**Step 1 · Asset count**: count your same-category visual assets. < 15 → stop; 15-25 → maybe; 25+ →
go for it.

**Step 2 · Consistency test**: put 4 random assets side by side — do they look like "a set"? If not
→ unify style first, or change approach.

**Step 3 · Narrative match**: are you expressing "Breadth × Depth" (volume × quality)? Or "process",
"feature", "story"? If not the former, don't force it.

If all three are yes, fork the v6 HTML, edit the `SLIDE_FILES` array and timeline, and you're reusing.
Edit the palette `--bg / --accent / --ink` to reskin without restructuring.

---

## Related References

- Full technical flow: [references/animations.md](animations.md) · [references/animation-best-practices.md](animation-best-practices.md)
- Animation export pipeline: [references/video-export.md](video-export.md)
- Audio configuration (BGM + SFX dual track): [references/audio-design-rules.md](audio-design-rules.md)
- Apple gallery style cross-reference: [references/apple-gallery-showcase.md](apple-gallery-showcase.md)
- Source HTML (v6 + audio integrated): `www.huasheng.ai/huashu-design-hero/index.html`
