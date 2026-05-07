# Cinematic Patterns · Best Practices for Workflow Demos

> Five key patterns to upgrade from "PowerPoint animation" to "keynote-grade cinematic".
> Distilled from the two cinematic demos in the 2026-04 "Let's talk about skills" deck (Nuwa workflow
> + Darwin workflow); battle-tested and reproducible.

---

## 0 · What Problem This Document Solves

When you need to make a demo animation that "shows a workflow" (typical scenarios: skill workflow,
product onboarding, API call flow, agent task execution), there are two common approaches:

| Paradigm | What it looks like | Outcome |
|---|---|---|
| **PowerPoint animation** (bad) | step 1 fade in → step 2 fade in → step 3 fade in, 4 boxes lined up on the same screen | Audience feels "this is a PPT with fade effects", no wow moment |
| **Cinematic** (good) | Scene-based, focuses on one thing at a time, scene transitions are dissolve / focus pull / morph | Audience feels "this is a product launch clip", wants to screenshot and share |

The root cause of the difference is **not animation technique** — it's **narrative paradigm**. This
doc explains how to upgrade from the former to the latter.

---

## 1 · Five Core Patterns

### Pattern A · Dashboard + Cinematic Overlay Two-Layer Structure

**Problem**: a pure cinematic defaults to black screen + a single ▶ button. If the user lands on the
page without clicking, they see nothing.

**Solution**:
```
DEFAULT state (always visible): full static workflow dashboard
  └── Audience grasps how this skill / workflow runs at a glance

POINT ▶ trigger (overlay floats up): 22-second cinematic
  └── On finish, auto-fades back to DEFAULT

```

**Implementation key points**:
- `.dash` is visible by default; `.cinema` defaults to `opacity: 0; pointer-events: none`
- `.play-cta` is a small gold button in the lower-right (not a giant center overlay)
- On click → `cinema.classList.add('show')` + `dash.classList.add('hide')`
- Run with `requestAnimationFrame` once (not in a loop); on completion `endCinematic()` reverses
  state

**Anti-pattern**: default = central giant ▶ overlay covering everything; before clicking, the page
is blank.

---

### Pattern B · Scene-based, NOT Step-based

**Problem**: splitting the animation into "step 1 shows → step 2 shows → ..." is PPT thinking.

**Solution**: split into 5 scenes, each scene is an **independent shot** that focuses on one thing
in full screen:

| Scene type | Job | Duration |
|---|---|---|
| 1 · Invoke | User input trigger (terminal typewriter) | 3-4s |
| 2 · Process | Visualization of the core workflow (unique visual language) | 5-6s |
| 3 · Result/Insight | Distilled key product (visualized) | 4-5s |
| 4 · Output | Actual output display (file / diff / number) | 3-4s |
| 5 · Hero Reveal | Closing hero moment (big type + value prop) | 4-5s |

**Total ≈ 22 seconds** — this is the tested golden length:
- Shorter than 18s: PMs haven't entered the state yet, it's over
- Longer than 25s: lose patience
- 22s is just enough to "hook → unfold → close → leave impression"

**Implementation key points**:
- `T = { DURATION: 22.0, s1_in: [0, 0.7], s2_in: [3.8, 4.6], ... }` global timeline
- Single `requestAnimationFrame(render)` runs all scenes' opacity / transform calculations
- Don't chain setTimeouts (easy to break, hard to debug)
- Easing must use `expoOut` / `easeOut` / cubic-bezier — **forbid linear**

---

### Pattern C · Each Demo's Visual Language Must Be Independent

**Problem**: after finishing the first cinematic, you get lazy on the second and reuse the same
template (same orbit + pentagon + typewriter + hero big text), only swapping copy.

**Outcome**: audience notices both cinematics "look identical", which is equivalent to saying "these
two skills have no difference".

**Solution**: each workflow's core metaphor differs, so its visual language must differ.

**Comparison case**:

| Dimension | Nuwa (Distill Person) | Darwin (Optimize Skill) |
|---|---|---|
| Core metaphor | Collect → Distill → Write | Loop → Evaluate → Ratchet |
| Visual motion | Float / Radiate / pentagon | Loop / Rise / Diff |
| Scene 2 | 3D Orbit · 8 archive cards floating in perspective ellipse | Spin Loop · token runs 5 laps along 6-node ring |
| Scene 3 | Pentagon · 5 tokens radiate from center | v1 vs v5 · side-by-side diff (red ver vs gold ver) |
| Scene 4 | SKILL.md typewriter | Hill-Climb · full-screen curve drawing |
| Scene 5 hero | "21 minutes" serif italic big text | Rotating gear ⚙ + "KEPT +1.1" gold tag |

**Acceptance test**: cover the copy and look only at visuals — can you tell which demo this is? If
not, you got lazy.

---

### Pattern D · Use AI-Generated Real Assets, Not Emoji or Hand-Drawn SVG

**Problem**: 3D orbit / gallery needs floating asset fragments. Emoji (📚🎤) is ugly and unbranded;
hand-drawn SVG book spines never look like real books.

**Solution**: use `huashu-gpt-image` to render a 4×2 grid mega-image (8 theme-relevant items · white
background · 60px breathing space · unified style), then `extract_grid.py --mode bbox` to cut into 8
independent transparent PNGs.

**Prompt key points** (detailed prompt patterns in the `huashu-gpt-image` skill):
- IP anchoring ("1960s Caltech archive aesthetic" / "Hearthstone-style consistent treatment")
- White background (easy to cut; gray background has atmosphere but transparent extraction is hard)
- 4×2 not 5×5 (avoids the last-row compression bug)
- Persona finishing ("You are a Wired magazine curator preparing an exhibition photo")

**Anti-pattern**: emoji as icons, CSS silhouettes substituting for product photos.

---

### Pattern E · BGM + SFX Dual Track

**Problem**: animation with no audio — the audience subconsciously feels "this thing looks like a
poor demo".

**Solution**: BGM long tone + 11 SFX cues.

**Generic SFX cue recipe** (works for workflow demos):

| Time | SFX | Trigger scene |
|---|---|---|
| 0.10s | whoosh | Terminal rises from below |
| 3.0s | enter | Typewriter completes, press enter |
| 4.0s | slide-in | Scene 2 elements enter |
| 5-9s × 5 times | sparkle | Key process nodes (each generation / token / data point) |
| 14s | click | Switch to output scene |
| 17.8s | logo-reveal | Hero reveal moment |
| typewriter | type | Triggered every 2 chars (don't go too dense) |

**Frequency separation**: BGM volume 0.32 (low-frequency floor), SFX volume 0.55 (mid-high punch),
sparkle 0.7 (must stand out), logo-reveal 0.85 (strongest hero moment).

**User control**:
- Must have a ▶ start overlay (browser autoplay restriction)
- Small mute button upper-right (user can mute anytime)
- Don't make it "play immediately when the user lands here"

---

## 2 · Static Dashboard Design Key Points

The dashboard is Layer 1 of the two-layer structure; PMs who don't click ▶ should still understand
the skill.

**Layout**: 3-column grid (or 1 large + 2 small); each panel solves one problem:

| Panel type | What problem it solves | Case |
|---|---|---|
| **Pipeline / Flow Diagram** | "What's the workflow of this skill?" | Nuwa 4-stage pipeline · Darwin autoresearch loop |
| **Snapshot / State** | "What does the real output data look like?" | Darwin 8-dim rubric snapshot |
| **Trajectory / Evolution** | "How does it change across runs?" | Darwin 5-generation hill-climb curve |
| **Examples / Gallery** | "What's been produced already?" | Nuwa 21 personas gallery |
| **Strip · Example I/O** | "What goes in → what comes out" | Nuwa example strip: `› nuwa distill feynman → feynman.skill (21 min)` |

**Key constraints**:
- Info density must be sufficient (each panel must carry differentiated info)
- But no data slop (every number must be meaningful)
- Color scheme consistent with cinematic (same color family, smooth transition)

---

## 3 · Debug & Dev Tools

Any long animation needs three dev tools or debugging will explode.

### Tool 1 · `?seek=N` Freezes to Second N

```js
const seek = parseFloat(params.get('seek'));
if (!isNaN(seek)) {
  started = true; muted = true;
  frozenT = seek;  // render() uses this t instead of elapsed
  cinema.classList.add('show'); dash.classList.add('hide');
}

// Inside render():
let t = frozenT !== null ? frozenT : (elapsed % T.DURATION);
```

Usage: `http://.../slide.html?seek=12` — directly view the 12th-second frame without waiting for
playback.

### Tool 2 · `?autoplay=1` Skips ▶ Overlay

Convenient for Playwright auto-screenshot tests, also useful for force-starting when embedded in an
iframe.

### Tool 3 · Manual REPLAY Button

Small button upper-right; user / debugger can replay any number of times. CSS:

```css
.replay{position:absolute;top:18px;right:18px;background:rgba(212,165,116,0.1);
  border:1px solid rgba(212,165,116,0.3);color:#D4A574;
  font-family:monospace;font-size:10px;letter-spacing:.28em;text-transform:uppercase;
  padding:6px 12px;border-radius:1px;cursor:pointer;backdrop-filter:blur(6px);z-index:6}
```

---

## 4 · iframe Embedding Pitfalls (if cinematic is embedded in deck)

### Pitfall 1 · Parent Window's Click Zone Intercepts iframe Buttons

If deck index.html added "left/right 22vw transparent click zones for paging", they **cover the ▶
play button inside the iframe** — clicking the button gets eaten as "next page".

**Fix**: add `top: 12vh; bottom: 25vh` to the click zone, leaving 25% top and bottom uncovered, so
the central ▶ and bottom-right ▶ inside the iframe both work.

### Pitfall 2 · iframe Steals Focus, Keyboard Events Lost

After the user clicks the iframe, focus is inside it; the parent's ←/→ keyboard events don't fire.

**Fix**:
```js
iframe.addEventListener('load', () => {
  // Inject keyboard forwarder
  const doc = iframe.contentDocument;
  doc.addEventListener('keydown', (e) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, ... }));
  });
  // After click, pull focus back to parent window
  doc.addEventListener('click', () => setTimeout(() => window.focus(), 0));
});
```

### Pitfall 3 · file:// vs https:// Behavior Difference

A cinematic that worked locally on file:// may break after deployment because:
- Under file://, iframe contentDocument is same-origin
- Under https:// it's also same-origin (if same host), but audio autoplay restrictions are stricter

**Fix**:
- Before deploy, use `python3 -m http.server` to start a local HTTP server and test once
- BGM must `bgm.play()` only after the user clicks ▶ — don't play immediately on page load

---

## 5 · Anti-Pattern Cheat Sheet

| ❌ Anti-pattern | ✅ Pattern |
|---|---|
| Default = black screen ▶ overlay | Default = static dashboard, ▶ is auxiliary |
| 4 steps stacked side-by-side fade-in | 5 scenes full-screen swap, each focuses on one thing |
| Reuse template + swap copy for different demos | Each demo has independent visual language (cover copy and you can tell them apart) |
| Emoji / hand-drawn SVG as assets | gpt-image-2 mega-image + extract_grid extraction |
| No BGM, no SFX | BGM + 11 SFX cues dual track |
| setTimeout chain scheduling | requestAnimationFrame + global timeline T object |
| Linear animation | Expo / cubic-bezier easing |
| No dev tools | `?seek=N` + `?autoplay=1` + REPLAY button |
| iframe buttons eaten by parent click zone | Click zone has top/bottom margin yielding to buttons |

---

## 6 · Time Budget

Following these patterns, a complete cinematic demo (with dashboard):

| Task | Time |
|---|---|
| Design 5-scene narrative + visual language | 30 min (be careful — decides independence) |
| Dashboard static layout + content | 1 hour |
| Cinematic 5 scenes implementation | 1.5 hours |
| Audio cues timing + replay button | 30 min |
| Playwright screenshot validation of 5 key moments | 15 min |
| **Single demo total** | **3-4 hours** |

The second demo reuses the framework but **visual language must be independent**, roughly 2-3 hours.
