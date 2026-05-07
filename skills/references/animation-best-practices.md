# Animation Best Practices · Positive-Pattern Motion Design Grammar

> Distilled from a deep teardown of Anthropic's three official product animations
> (Claude Design / Claude Code Desktop / Claude for Word) into "Anthropic-grade" motion design rules.
>
> Use alongside `animation-pitfalls.md` (the don'ts list) — this file is "**do this**",
> pitfalls is "**don't do that**". Orthogonal. Read both.
>
> **Constraint declaration**: This file only documents **motion logic and expressive style**.
> It introduces **no specific brand color values**. Color decisions go through §1.a Core Asset Protocol
> (extracted from the brand spec) or the "Design Direction Advisor"
> (each of the 20 philosophies has its own palette). This reference talks about "**how things move**",
> not "**what color**".

---

## §0 · Who You Are · Identity and Taste

> Before you read any technical rule below, read this section first. Rules **emerge from identity** —
> not the other way around.

### §0.1 Identity Anchor

**You are a motion designer who has studied the motion archives of Anthropic / Apple / Pentagram / Field.io.**

When you make animation, you are not tweaking CSS transitions — you are using digital elements to
**simulate a physical world**, getting the audience's subconscious to believe "these are objects with
weight, with inertia, that overshoot."

You don't make PowerPoint-style animations. You don't make "fade in fade out" animations. You make
animations that **make people believe the screen is a space they could reach into**.

### §0.2 Core Beliefs (3)

1. **Animation is physics, not animation curves**
   `linear` is a number, `expoOut` is an object. You believe pixels on screen deserve to be treated
   as "objects". Every easing choice answers the physical question "how heavy is this element?
   how much friction does it have?"

2. **Time allocation matters more than curve shape**
   Slow-Fast-Boom-Stop is your breath. **Animation with even pacing is a tech demo; animation with
   rhythm is narrative.** Slowing down at the right moment matters more than getting easing right at
   the wrong moment.

3. **Yielding to the audience is harder than showing off**
   Pausing 0.5s before a key result is **technique**, not compromise. **Giving the human brain
   reaction time is the highest virtue of an animator.** AI defaults to a non-stop, info-dense
   animation — that's the rookie. What you must do is restraint.

### §0.3 Taste Standards · What Is Beautiful

Here are your criteria for "good" vs "great". Each has a **recognition method** — when you see a
candidate animation, judge with these questions, not by mechanically checking 14 rules.

| Beauty Dimension | Recognition (audience reaction) |
|---|---|
| **Physical weight** | When the animation ends, the element "**lands**" steadily — it doesn't just "**stop**" there. The audience subconsciously feels "this has weight" |
| **Yielding to the audience** | A perceptible pause (≥300ms) before key info appears — the audience has time to "**see**" before continuing |
| **Whitespace** | The ending is an abrupt cut + hold, not a fade to black. The last frame is clear, definitive, decisive |
| **Restraint** | Only one spot in the whole piece is "120% polished"; the other 80% is just right — **showing off everywhere is a cheap signal** |
| **Hand feel** | Arcs (not straight lines), irregularity (not setInterval mechanical timing), a sense of breathing |
| **Respect** | Show the tweak process, show bug fixes — **don't hide the work, don't sell "magic"**. AI is a collaborator, not a magician |

### §0.4 Self-check · The Audience's First Reaction Method

After you finish an animation, **what's the audience's first reaction?** — that is the only metric
you optimize for.

| Audience reaction | Rating | Diagnosis |
|---|---|---|
| "Looks pretty smooth" | good | Passable but generic, you made PowerPoint |
| "This animation flows nicely" | good+ | Technique is right, but no wow |
| "This thing really looks like **it's lifting off the desk**" | great | You touched physical weight |
| "This doesn't look AI-made" | great+ | You touched the Anthropic threshold |
| "I want to **screenshot** this and share it" | great++ | You got the audience to spread it on their own |

**The difference between great and good is not technical correctness, it's taste judgment**.
Technique right + taste right = great. Technique right + taste empty = good. Technique wrong = haven't
even started.

### §0.5 Identity vs. Rules

The technical rules in §1-§8 below are this identity's **execution methods** in concrete scenarios —
not an independent rule list.

- Run into a scenario the rules don't cover → return to §0, judge by **identity**, don't guess
- Run into rule conflicts → return to §0, judge by **taste standards** which matters more
- Want to break a rule → first answer "does this serve any of the §0.3 beauties?" If yes, break it.
  If no, don't.

OK. Read on.

---

## Overview · Animation as Physics, in Three Layers

The cheapness of most AI-generated animation comes from one root — **they behave like "numbers", not
"objects"**. Real-world objects have mass, inertia, elasticity, overshoot. The "premium" feel of
Anthropic's three pieces comes from giving digital elements a set of **physical-world motion rules**.

These rules sit in 3 layers:

1. **Narrative rhythm layer**: time allocation of Slow-Fast-Boom-Stop
2. **Motion curve layer**: Expo Out / Overshoot / Spring — refuse linear
3. **Expressive language layer**: showing process, mouse arcs, logo morph-collapse

---

## 1. Narrative Rhythm · Slow-Fast-Boom-Stop 5-Beat Structure

All three Anthropic pieces follow this structure without exception:

| Beat | Share | Pace | Function |
|---|---|---|---|
| **B1 Trigger** | ~15% | Slow | Give humans reaction time, build reality |
| **B2 Generate** | ~15% | Mid | Visual wow point appears |
| **B3 Process** | ~40% | Fast | Show controllability/density/detail |
| **B4 Burst** | ~20% | Boom | Camera pull-back / 3D pop-out / multi-panel surge |
| **B5 Land** | ~10% | Still | Brand logo + abrupt cut |

**Concrete duration mapping** (15s animation):
B1 Trigger 2s · B2 Generate 2s · B3 Process 6s · B4 Burst 3s · B5 Land 2s

**Forbidden**:
- Even pacing (constant info density per second) — audience fatigue
- Sustained high density — no peak, no memory anchor
- Soft fade-out ending (fade to transparent) — should be **abrupt cut**

**Self-check**: sketch 5 thumbnails on paper, one per beat showing its peak frame. If the 5 sketches
look the same, the rhythm isn't there.

---

## 2. Easing Philosophy · Refuse linear, Embrace Physics

Every motion in Anthropic's three pieces uses bezier curves with a "damped" feel. Default cubic
easeOut (`1-(1-t)³`) is **not sharp enough** — startup not fast enough, stop not steady enough.

### Three Core Easings (built into animations.jsx)

```js
// 1. Expo Out · rapid start, slow brake (most-used, default main easing)
// CSS equivalent: cubic-bezier(0.16, 1, 0.3, 1)
Easing.expoOut(t) // = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)

// 2. Overshoot · springy toggle / button pop
// CSS equivalent: cubic-bezier(0.34, 1.56, 0.64, 1)
Easing.overshoot(t)

// 3. Spring physics · geometry settling, natural landing
Easing.spring(t)
```

### Usage Mapping

| Scenario | Easing |
|---|---|
| Card rise-in / panel entrance / Terminal fade / focus overlay | **`expoOut`** (main, most common) |
| Toggle switch / button pop / emphasis interaction | `overshoot` |
| Preview geometry settling / physical landing / UI bounce | `spring` |
| Continuous motion (e.g. mouse trajectory interpolation) | `easeInOut` (preserves symmetry) |

### Counterintuitive Insight

Most product trailers' animations are **too fast and too hard**. `linear` makes digital elements feel
mechanical, `easeOut` is the baseline, **`expoOut` is the technical root of "premium feel"** — it
gives digital elements **physical-world weight**.

---

## 3. Motion Language · 8 Common Principles

### 3.1 No Pure Black or White as Background

None of Anthropic's three pieces use `#FFFFFF` or `#000000` as primary background. **A neutral with
color temperature** (warm or cool) carries the materiality of "paper / canvas / desktop", reducing
the machine feel.

**Specific color values** are decided via §1.a Core Asset Protocol (extracted from brand spec) or
"Design Direction Advisor" (each of the 20 philosophies has its own background scheme). This reference
gives no specific color values — those are **brand decisions**, not motion rules.

### 3.2 Easing Is Never linear

See §2.

### 3.3 Slow-Fast-Boom-Stop Narrative

See §1.

### 3.4 Show "Process" Not "Magic Result"

- Claude Design shows tweaking parameters, dragging sliders (not one-click perfect output)
- Claude Code shows code errors + AI fixing them (not first-shot success)
- Claude for Word shows Redline red-strike / green-add edit process (not the final draft directly)

**Shared subtext**: the product is a **collaborator, pair-programmer, senior editor** — not a
one-button magician. This precisely targets professional users' pain points around "controllability"
and "authenticity".

**Anti AI slop**: AI defaults to "magic-one-click-success" animations (one click → perfect result),
that is the common denominator. **Reverse it** — show the process, show the tweak, show the bugs and
fixes — that's where brand recognition comes from.

### 3.5 Mouse Trajectory Hand-Drawn (Arcs + Perlin Noise)

Real human mouse motion isn't a straight line, it's "accelerating start → arc → decelerating
correction → click". An AI's straight-line interpolated mouse trajectory has **subconscious
rejection**.

```js
// Quadratic Bezier interpolation (start → control → end)
function bezierQuadratic(p0, p1, p2, t) {
  const x = (1-t)*(1-t)*p0[0] + 2*(1-t)*t*p1[0] + t*t*p2[0];
  const y = (1-t)*(1-t)*p0[1] + 2*(1-t)*t*p1[1] + t*t*p2[1];
  return [x, y];
}

// Path: start → off-axis midpoint → end (creates an arc)
const path = [[100, 100], [targetX - 200, targetY + 80], [targetX, targetY]];

// Layer minute Perlin Noise on top (±2px) to create "hand jitter"
const jitterX = (simpleNoise(t * 10) - 0.5) * 4;
const jitterY = (simpleNoise(t * 10 + 100) - 0.5) * 4;
```

### 3.6 Logo "Morph-Collapse" (Morph)

The logo entrance in Anthropic's three pieces is **never a simple fade-in** — it morphs from a
preceding visual element.

**Common pattern**: in the last 1-2 seconds, do a Morph / Rotate / Converge so the entire narrative
"collapses" onto the brand point.

**Low-cost implementation** (without a real morph):
Have the previous visual element "collapse" into a colored block (scale → 0.1, translate to center),
then have the block "expand" out into the wordmark. Bridge with a 150ms fast cut + motion blur
(`filter: blur(6px)` → `0`).

```js
<Sprite start={13} end={14}>
  {/* Collapse: previous element scale 0.1, opacity stays, filter blur increases */}
  const scale = interpolate(t, [0, 0.5], [1, 0.1], Easing.expoOut);
  const blur = interpolate(t, [0, 0.5], [0, 6]);
</Sprite>
<Sprite start={13.5} end={15}>
  {/* Expand: logo from block center scale 0.1 → 1, blur 6 → 0 */}
  const scale = interpolate(t, [0, 0.6], [0.1, 1], Easing.overshoot);
  const blur = interpolate(t, [0, 0.6], [6, 0]);
</Sprite>
```

### 3.7 Serif + Sans-Serif Dual Type

- **Brand / voiceover**: serif (carries "academic / editorial / taste")
- **UI / code / data**: sans-serif + monospace

**A single typeface is wrong.** Serif gives "taste", sans-serif gives "function".

Specific font choices go through the brand spec (the Display / Body / Mono stacks of brand-spec.md)
or the design direction advisor's 20 philosophies. This reference gives no specific fonts — those are
**brand decisions**.

### 3.8 Focus Switch = Background Dim + Foreground Sharpen + Flash Guide

Focus switching is **not just** lowering opacity. The complete recipe is:

```js
// Filter combo for non-focused elements
tile.style.filter = `
  brightness(${1 - 0.5 * focusIntensity})
  saturate(${1 - 0.3 * focusIntensity})
  blur(${focusIntensity * 4}px)        // ← key: only with blur do they truly "recede"
`;
tile.style.opacity = 0.4 + 0.6 * (1 - focusIntensity);

// After focus completes, flash a 150ms highlight at the focus point to guide the eye back
focusOverlay.animate([
  { background: 'rgba(255,255,255,0.3)' },
  { background: 'rgba(255,255,255,0)' }
], { duration: 150, easing: 'ease-out' });
```

**Why blur is mandatory**: with only opacity + brightness, off-focus elements are still "sharp",
visually they don't "recede into the background". blur(4-8px) actually pushes non-focus back a depth
plane.

---

## 4. Concrete Motion Techniques (Code You Can Steal)

### 4.1 FLIP / Shared Element Transition

A button "expands" into an input field — **not** the button vanishing + a new panel appearing. The
core is **the same DOM element** transitioning between two states, not two elements cross-fading.

```jsx
// Use Framer Motion layoutId
<motion.div layoutId="design-button">Design</motion.div>
// ↓ same layoutId after click
<motion.div layoutId="design-button">
  <input placeholder="Describe your design..." />
</motion.div>
```

Native implementation: see https://aerotwist.com/blog/flip-your-animations/

### 4.2 "Breathing" Expansion (width→height)

Panel expansion is **not stretching width and height simultaneously**, it's:
- First 40% of time: only stretch width (keep height small)
- Last 60% of time: width holds, height fills

This simulates the physical-world feeling of "first unfold, then fill with water".

```js
const widthT = interpolate(t, [0, 0.4], [0, 1], Easing.expoOut);
const heightT = interpolate(t, [0.3, 1], [0, 1], Easing.expoOut);
style.width = `${widthT * targetW}px`;
style.height = `${heightT * targetH}px`;
```

### 4.3 Staggered Fade-up (30ms stagger)

Table rows, card columns, list items entering — **delay each element by 30ms**, `translateY` from
10px back to 0.

```js
rows.forEach((row, i) => {
  const localT = Math.max(0, t - i * 0.03);  // 30ms stagger
  row.style.opacity = interpolate(localT, [0, 0.3], [0, 1], Easing.expoOut);
  row.style.transform = `translateY(${
    interpolate(localT, [0, 0.3], [10, 0], Easing.expoOut)
  }px)`;
});
```

### 4.4 Non-linear Breathing · Hold 0.5s Before Key Result

Machine execution is fast and continuous, but **hold 0.5 seconds before key results appear** to give
the audience's brain reaction time.

```jsx
// Typical scenario: AI finishes generating → hold 0.5s → result reveals
<Sprite start={8} end={8.5}>
  {/* 0.5s pause — nothing moves, let the audience stare at the loading state */}
  <LoadingState />
</Sprite>
<Sprite start={8.5} end={10}>
  <ResultAppear />
</Sprite>
```

**Counter-example**: AI finishes generating, instantly cuts to result — audience has no reaction
time, info is lost.

### 4.5 Chunk Reveal · Simulating Token Streaming

AI text generation **should not pop characters one at a time via `setInterval`** (like old movie
subtitles). Use **chunk reveal** — 2–5 characters appear at once, with irregular intervals,
simulating real token-stream output.

```js
// Chunk by chunk, not char by char
const chunks = text.split(/(\s+|,\s*|\.\s*|;\s*)/);  // split on words + punctuation
let i = 0;
function reveal() {
  if (i >= chunks.length) return;
  element.textContent += chunks[i++];
  const delay = 40 + Math.random() * 80;  // irregular 40-120ms
  setTimeout(reveal, delay);
}
reveal();
```

### 4.6 Anticipation → Action → Follow-through

3 of Disney's 12 principles. Anthropic uses them very explicitly:

- **Anticipation**: a small reverse motion before the main action (button slightly shrinks before
  popping)
- **Action**: the main motion itself
- **Follow-through**: a residual after the action (card lands then bounces slightly)

```js
// Full three-stage card entrance
const anticip = interpolate(t, [0, 0.2], [1, 0.95], Easing.easeIn);     // anticipation
const action  = interpolate(t, [0.2, 0.7], [0.95, 1.05], Easing.expoOut); // action
const settle  = interpolate(t, [0.7, 1], [1.05, 1], Easing.spring);       // settle
// Final scale = product of three stages, or apply piecewise
```

**Counter-example**: an animation with only Action, no Anticipation + Follow-through, feels like
"PowerPoint animation".

### 4.7 3D Perspective + translateZ Layering

Want a "tilted 3D + floating cards" vibe? Give the container perspective, give individual elements
different translateZ:

```css
.stage-wrap {
  perspective: 2400px;
  perspective-origin: 50% 30%;  /* line of sight slightly looking down */
}
.card-grid {
  transform-style: preserve-3d;
  transform: rotateX(8deg) rotateY(-4deg);  /* golden ratio */
}
.card:nth-child(3n) { transform: translateZ(30px); }
.card:nth-child(5n) { transform: translateZ(-20px); }
.card:nth-child(7n) { transform: translateZ(60px); }
```

**Why rotateX 8° / rotateY -4° is the golden ratio**:
- > 10° → elements look too distorted, like they're "falling over"
- < 5° → looks like "skew" rather than "perspective"
- 8° × -4° asymmetry simulates the natural angle of "camera looking down from upper-left"

### 4.8 Diagonal Pan · Move XY Together

Camera motion isn't pure up-down or pure left-right, it **moves XY together** to simulate diagonal
travel:

```js
const panX = Math.sin(flowT * 0.22) * 40;
const panY = Math.sin(flowT * 0.35) * 30;
stage.style.transform = `
  translate(-50%, -50%)
  rotateX(8deg) rotateY(-4deg)
  translate3d(${panX}px, ${panY}px, 0)
`;
```

**Key**: X and Y use different frequencies (0.22 vs 0.35) to avoid Lissajous-loop regularity.

---

## 5. Scene Recipes (Three Narrative Templates)

The reference materials' three videos correspond to three product personalities. **Pick the one that
best fits your product**, don't mix.

### Recipe A · Apple Keynote Dramatic (Claude Design class)

**Fits**: major version launch, hero animation, visual-wow priority
**Rhythm**: Slow-Fast-Boom-Stop, strong arc
**Easing**: `expoOut` throughout + a touch of `overshoot`
**SFX density**: high (~0.4/s), SFX pitch tuned to BGM scale
**BGM**: IDM / minimal tech-electronic, calm + precise
**Closing**: rapid camera pull-back → drop → logo morph → ethereal single tone → abrupt cut

### Recipe B · One-Take Tool (Claude Code class)

**Fits**: developer tools, productivity apps, flow-state scenes
**Rhythm**: sustained steady flow, no obvious peak
**Easing**: `spring` physics + `expoOut`
**SFX density**: **0** (rhythm driven entirely by BGM)
**BGM**: Lo-fi Hip-hop / Boom-bap, 85-90 BPM
**Core technique**: key UI actions land on BGM kick/snare transients — "**musical groove IS the
interaction SFX**"

### Recipe C · Office-Productivity Narrative (Claude for Word class)

**Fits**: enterprise software, document/spreadsheet/calendar, professional-feel priority
**Rhythm**: many scene hard-cuts + Dolly In/Out
**Easing**: `overshoot` (toggle) + `expoOut` (panel)
**SFX density**: medium (~0.3/s), mostly UI clicks
**BGM**: Jazzy Instrumental, minor key, BPM 90-95
**Core highlight**: one scene must be the "whole-piece highlight" — 3D pop-out / lifting off the
plane

---

## 6. Counter-Examples · This Is AI Slop

| Anti-pattern | Why it's wrong | Correct |
|---|---|---|
| `transition: all 0.3s ease` | `ease` is linear's cousin, all elements move at same speed | Use `expoOut` + per-element stagger |
| All entrances are `opacity 0→1` | No motion direction | Pair with `translateY 10→0` + Anticipation |
| Logo fade-in | No narrative closure | Morph / Converge / collapse-expand |
| Mouse moves in straight line | Subconscious machine feel | Bezier arc + Perlin Noise |
| Type single chars (setInterval) | Like old movie subtitles | Chunk Reveal, random intervals |
| No hold before key result | Audience has no reaction time | Hold 0.5s before result |
| Focus switch only changes opacity | Off-focus elements still sharp | opacity + brightness + **blur** |
| Pure black / pure white background | Cyber feel / glare fatigue | Neutral with color temperature (via brand spec) |
| All animations same speed | No rhythm | Slow-Fast-Boom-Stop |
| Fade-out ending | No decisiveness | Abrupt cut (hold last frame) |

---

## 7. Pre-Delivery Checklist (60 seconds)

- [ ] Narrative structure is Slow-Fast-Boom-Stop, not even pacing?
- [ ] Default easing is `expoOut`, not `easeOut` or `linear`?
- [ ] Toggle / button pop uses `overshoot`?
- [ ] Cards / lists enter with 30ms stagger?
- [ ] 0.5s hold before key results?
- [ ] Typing uses Chunk Reveal, not setInterval single char?
- [ ] Focus switch adds blur (not just opacity)?
- [ ] Logo is morph-collapse, not fade-in?
- [ ] Background is not pure black / pure white (has color temperature)?
- [ ] Type has serif + sans-serif hierarchy?
- [ ] Ending is abrupt cut, not fade?
- [ ] (If a mouse exists) mouse trajectory is arc, not straight line?
- [ ] SFX density matches product personality (see Recipe A/B/C)?
- [ ] BGM and SFX have 6-8dB loudness gap? (see `audio-design-rules.md`)

---

## 8. Relation to Other References

| Reference | Role | Relation |
|---|---|---|
| `animation-pitfalls.md` | Technical pitfalls (16) | "**Don't do that**" · the inverse of this file |
| `animations.md` | Stage/Sprite engine usage | Foundation of **how to write** animation |
| `audio-design-rules.md` | Dual-track audio rules | **Audio pairing** for animation |
| `sfx-library.md` | 37-cue SFX list | SFX **asset library** |
| `apple-gallery-showcase.md` | Apple gallery showcase style | A specific motion-style topic |
| **This file** | Positive-pattern motion design grammar | "**Do this**" |

**Call order**:
1. First read SKILL.md workflow Step 3's Four Position Questions (decide narrative role and visual
   temperature)
2. After picking a direction, read this file to settle **motion language** (Recipe A/B/C)
3. When coding, refer to `animations.md` and `animation-pitfalls.md`
4. When exporting video, follow `audio-design-rules.md` + `sfx-library.md`

---

## Appendix · Source Material for This File

- Anthropic official animation teardown: `参考动画/BEST-PRACTICES.md` in the huashu project directory
- Anthropic audio teardown: same directory `AUDIO-BEST-PRACTICES.md`
- 3 reference videos: `ref-{1,2,3}.mp4` + corresponding `gemini-ref-*.md` / `audio-ref-*.md`
- **Strict filtering**: this reference contains no specific brand color values, font names, or
  product names. Color/font decisions go through §1.a Core Asset Protocol or the 20 design
  philosophies.
