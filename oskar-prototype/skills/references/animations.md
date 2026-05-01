# Animations: Timeline-Driven Animation Engine

Read this when you build animation / motion-design HTML. Principles, usage, common patterns.

## Core Pattern: Stage + Sprite

Our animation system (`assets/animations.jsx`) provides a timeline-driven engine:

- **`<Stage>`**: container for the entire animation, automatically provides auto-scale (fit viewport)
  + scrubber + play/pause/loop controls
- **`<Sprite start end>`**: a time slice. A Sprite is only visible between `start` and `end`. Inside,
  use the `useSprite()` hook to read its local progress `t` (0→1)
- **`useTime()`**: read current global time (seconds)
- **`Easing.easeInOut` / `Easing.easeOut` / ...`**: easing functions
- **`interpolate(t, from, to, easing?)`**: interpolate based on t

This pattern borrows from Remotion / After Effects, but lightweight, zero-dependency.

## Getting Started

```html
<script type="text/babel" src="animations.jsx"></script>
<script type="text/babel">
  const { Stage, Sprite, useTime, useSprite, Easing, interpolate } = window.Animations;

  function Title() {
    const { t } = useSprite();  // local progress 0→1
    const opacity = interpolate(t, [0, 1], [0, 1], Easing.easeOut);
    const y = interpolate(t, [0, 1], [40, 0], Easing.easeOut);
    return (
      <h1 style={{ 
        opacity, 
        transform: `translateY(${y}px)`,
        fontSize: 120,
        fontWeight: 900,
      }}>
        Hello.
      </h1>
    );
  }

  function Scene() {
    return (
      <Stage duration={10}>  {/* 10-second animation */}
        <Sprite start={0} end={3}>
          <Title />
        </Sprite>
        <Sprite start={2} end={5}>
          <SubTitle />
        </Sprite>
        {/* ... */}
      </Stage>
    );
  }

  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<Scene />);
</script>
```

## Common Animation Patterns

### 1. Fade In / Fade Out

```jsx
function FadeIn({ children }) {
  const { t } = useSprite();
  const opacity = interpolate(t, [0, 0.3], [0, 1], Easing.easeOut);
  return <div style={{ opacity }}>{children}</div>;
}
```

**Range note**: `[0, 0.3]` means fade-in completes in the first 30% of the sprite's time, then
opacity stays 1 for the rest.

### 2. Slide In

```jsx
function SlideIn({ children, from = 'left' }) {
  const { t } = useSprite();
  const progress = interpolate(t, [0, 0.4], [0, 1], Easing.easeOut);
  const offset = (1 - progress) * 100;
  const directions = {
    left: `translateX(-${offset}px)`,
    right: `translateX(${offset}px)`,
    top: `translateY(-${offset}px)`,
    bottom: `translateY(${offset}px)`,
  };
  return (
    <div style={{
      transform: directions[from],
      opacity: progress,
    }}>
      {children}
    </div>
  );
}
```

### 3. Char-by-Char Typewriter

```jsx
function Typewriter({ text }) {
  const { t } = useSprite();
  const charCount = Math.floor(text.length * Math.min(t * 2, 1));
  return <span>{text.slice(0, charCount)}</span>;
}
```

### 4. Number Counter

```jsx
function CountUp({ from = 0, to = 100, duration = 0.6 }) {
  const { t } = useSprite();
  const progress = interpolate(t, [0, duration], [0, 1], Easing.easeOut);
  const value = Math.floor(from + (to - from) * progress);
  return <span>{value.toLocaleString()}</span>;
}
```

### 5. Phased Explanation (Typical Educational Animation)

```jsx
function Scene() {
  return (
    <Stage duration={20}>
      {/* Phase 1: present the problem */}
      <Sprite start={0} end={4}>
        <Problem />
      </Sprite>

      {/* Phase 2: present the approach */}
      <Sprite start={4} end={10}>
        <Approach />
      </Sprite>

      {/* Phase 3: present the result */}
      <Sprite start={10} end={16}>
        <Result />
      </Sprite>

      {/* Caption visible throughout */}
      <Sprite start={0} end={20}>
        <Caption />
      </Sprite>
    </Stage>
  );
}
```

## Easing Functions

Preset easing curves:

| Easing | Character | Use for |
|--------|------|------|
| `linear` | Constant rate | Scrolling captions, sustained motion |
| `easeIn` | Slow → fast | Exiting / disappearing |
| `easeOut` | Fast → slow | Entering / appearing |
| `easeInOut` | Slow → fast → slow | Position changes |
| **`expoOut`** ⭐ | **Exponential ease-out** | **Anthropic-grade main easing** (physical weight) |
| **`overshoot`** ⭐ | **Springy bounce-back** | **Toggle / button pop / emphasis interaction** |
| `spring` | Spring | Interaction feedback, geometry settling |
| `anticipation` | Reverse-then-forward | Action emphasis |

**Default main easing is `expoOut`** (not `easeOut`) — see `animation-best-practices.md` §2.
`expoOut` for entry, `easeIn` for exit, `overshoot` for toggles — the foundation rule for
Anthropic-grade animation.

## Pacing and Duration Guide

### Micro-interactions (0.1-0.3s)
- Button hover
- Card expand
- Tooltip appearance

### UI Transitions (0.3-0.8s)
- Page switches
- Modal appearance
- List item insertion

### Narrative Animation (2-10s per beat)
- One phase of a concept explanation
- Data chart reveal
- Scene transition

### Single Narrative Beat: Max 10 Seconds
Human attention is finite. 10 seconds for one thing, then move to the next.

## Order of Thinking When Designing Animation

### 1. Content / Story First, Then Animation

**Wrong**: think about fancy animation first, then stuff content into it
**Right**: think about what info you want to convey first, then use animation to serve it

Animation is **signal**, not **decoration**. A fade-in says "this matters, look here" — if everything
fade-ins, the signal collapses.

### 2. Write the Timeline by Scenes

```
0:00 - 0:03   Problem appears (fade in)
0:03 - 0:06   Problem zooms / unfolds (zoom+pan)
0:06 - 0:09   Solution appears (slide in from right)
0:09 - 0:12   Solution unpacks (typewriter)
0:12 - 0:15   Result demo (counter up + chart reveal)
0:15 - 0:18   One-line summary (static, hold 3s)
0:18 - 0:20   CTA or fade out
```

Write the timeline first, then the components.

### 3. Assets First

Images / icons / fonts the animation needs — **prepare them first**. Don't draw halfway then go look
for assets — it breaks rhythm.

## Common Issues

**Animation stutters**
→ Mostly layout thrashing. Use `transform` and `opacity`; don't animate `top` / `left` / `width` /
`height` / `margin`. Browsers GPU-accelerate `transform`.

**Animation too fast, can't read**
→ A Chinese character takes 100-150ms to read; a word 300-500ms. If you're telling a story with text,
give each line at least 3 seconds.

**Animation too slow, audience bored**
→ Interesting visual change should be dense. A static frame >5 seconds gets dull.

**Multiple animations interfere**
→ Use CSS `will-change: transform` to tell the browser this element will move, reducing reflow.

**Recording to video**
→ Use the skill's built-in toolchain (one command outputs three formats): see `video-export.md`
- `scripts/render-video.js` — HTML → 25fps MP4 (Playwright + ffmpeg)
- `scripts/convert-formats.sh` — 25fps MP4 → 60fps MP4 + optimized GIF
- Want more precise frame rendering? Make render(t) a pure function, see `animation-pitfalls.md`
  rule 5

## Working with Video Tools

This skill produces **HTML animation** (runs in browser). If the final deliverable is video footage:

- **Short animation / concept demo**: use HTML animation here → screen recording
- **Long video / narrative**: this skill focuses on HTML animation; long video belongs to AI-video
  generation skills or pro video software
- **Motion graphics**: After Effects / Motion Canvas are more appropriate

## About Popmotion etc.

If you really need physics animation (spring, decay, keyframes with precise timing) that our engine
can't handle, fall back to Popmotion:

```html
<script src="https://unpkg.com/popmotion@11.0.5/dist/popmotion.min.js"></script>
```

But **try our engine first**. 90% of the time it's enough.
