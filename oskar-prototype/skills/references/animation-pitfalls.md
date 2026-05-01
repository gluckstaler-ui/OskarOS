# Animation Pitfalls: HTML Animation Bugs and Rules

The bugs you'll most likely step in when building animation, and how to avoid them. Every rule comes
from a real failure case.

Read this before you write animation — saves you a round of iteration.

## 1. Stacking Layout — `position: relative` Is the Default Obligation

**The trap**: a sentence-wrap element wraps 3 bracket-layer elements (`position: absolute`). The
sentence-wrap was missing `position: relative`, so the absolute brackets used `.canvas` as their
coordinate system and floated 200px below the screen.

**Rule**:
- Any container holding `position: absolute` children **must** explicitly have `position: relative`
- Even when no visual offset is needed, write `position: relative` as the coordinate-system anchor
- Whenever you write `.parent { ... }` and a child has `.child { position: absolute }`, instinctively
  add relative to the parent

**Quick check**: for every `position: absolute` you find, walk up the ancestors and verify the
nearest positioned ancestor is the coordinate system you *want*.

## 2. Character Trap — Don't Rely on Rare Unicode

**The trap**: tried using `␣` (U+2423 OPEN BOX) to visualize the "space token". Neither Noto Serif SC
nor Cormorant Garamond have this glyph; it renders as blank/tofu, audience can't see it at all.

**Rule**:
- **Every character in your animation must exist in your chosen font**
- Common rare-character blacklist: `␣ ␀ ␐ ␋ ␨ ↩ ⏎ ⌘ ⌥ ⌃ ⇧ ␦ ␖ ␛`
- To express "space / return / tab" meta-characters, use a **CSS-built semantic box**:
  ```html
  <span class="space-key">Space</span>
  ```
  ```css
  .space-key {
    display: inline-flex;
    padding: 4px 14px;
    border: 1.5px solid var(--accent);
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.3em;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
  ```
- Validate emoji too: some emoji fall back to a gray box outside Noto Emoji — better to use an
  `emoji` font-family or SVG

## 3. Data-Driven Grid/Flex Templates

**The trap**: code has `const N = 6` tokens, but CSS hardcodes
`grid-template-columns: 80px repeat(5, 1fr)`. The 6th token has no column, the whole matrix is
misaligned.

**Rule**:
- When count comes from a JS array (`TOKENS.length`), the CSS template should also be data-driven
- Option A: inject from JS via CSS variable
  ```js
  el.style.setProperty('--cols', N);
  ```
  ```css
  .grid { grid-template-columns: 80px repeat(var(--cols), 1fr); }
  ```
- Option B: use `grid-auto-flow: column` and let the browser auto-extend
- **Ban the "fixed number + JS constant" combo**: change N and CSS won't follow

## 4. Transition Gap — Scene Switches Must Be Continuous

**The trap**: between zoom1 (13-19s) → zoom2 (19.2-23s), the main sentence is already hidden, zoom1
fades out (0.6s) + zoom2 fades in (0.6s) + stagger delay (0.2s+) = roughly 1 second of pure blank
frame. Audience thinks the animation froze.

**Rule**:
- When chaining scenes, fade-out and fade-in should **cross-overlap**, not finish one fully before
  starting the next
  ```js
  // Bad:
  if (t >= 19) hideZoom('zoom1');      // 19.0s out
  if (t >= 19.4) showZoom('zoom2');    // 19.4s in → 0.4s blank in between

  // Good:
  if (t >= 18.6) hideZoom('zoom1');    // start fade-out 0.4s earlier
  if (t >= 18.6) showZoom('zoom2');    // simultaneous fade-in (cross-fade)
  ```
- Or use an "anchor element" (e.g. the main sentence) as a visual bridge between scenes; it briefly
  re-appears during scene swaps
- Compute CSS transition durations carefully — avoid triggering the next transition before the
  current one ends

## 5. Pure Render Principle — Animation State Must Be Seekable

**The trap**: used `setTimeout` + `fireOnce(key, fn)` to chain-trigger animation states. Plays fine
end-to-end, but for frame-by-frame recording / seeking to arbitrary times, prior setTimeouts have
already fired and you can't "go back in time".

**Rule**:
- The `render(t)` function should ideally be a **pure function**: given t, output a unique DOM state
- If side effects are required (e.g. class toggles), use a `fired` set with explicit reset:
  ```js
  const fired = new Set();
  function fireOnce(key, fn) { if (!fired.has(key)) { fired.add(key); fn(); } }
  function reset() { fired.clear(); /* clear all .show classes */ }
  ```
- Expose `window.__seek(t)` for Playwright / debugging:
  ```js
  window.__seek = (t) => { reset(); render(t); };
  ```
- Animation-related setTimeouts shouldn't span >1 second, otherwise seeking back will scramble state

## 6. Measuring Before Fonts Load = Measuring Wrong

**The trap**: page calls `charRect(idx)` to measure bracket positions on DOMContentLoaded. Fonts
haven't loaded yet, every character width is the fallback font's width, all positions wrong. Once
fonts finish (~500ms later), the bracket's `left: Xpx` is still the old value — permanently
mis-aligned.

**Rule**:
- Any layout code depending on DOM measurement (`getBoundingClientRect`, `offsetWidth`) **must** be
  wrapped in `document.fonts.ready.then()`
  ```js
  document.fonts.ready.then(() => {
    requestAnimationFrame(() => {
      buildBrackets(...);  // fonts ready, measurements accurate
      tick();              // animation starts
    });
  });
  ```
- The extra `requestAnimationFrame` gives the browser one frame to commit layout
- If using Google Fonts CDN, `<link rel="preconnect">` accelerates first load

## 7. Recording Prep — Reserve Hooks for Video Export

**The trap**: Playwright `recordVideo` defaults to 25fps and starts recording from context creation.
Page-load and font-load's first 2 seconds get captured. Delivered video has 2 seconds of blank/flash
at the start.

**Rule**:
- Provide a `render-video.js` tool that handles: warmup navigate → reload to restart animation → wait
  duration → ffmpeg trim head + transcode to H.264 MP4
- The animation's **frame 0** must be the fully-laid-out final initial state (not blank or loading)
- Want 60fps? Use ffmpeg `minterpolate` post-processing — don't expect the browser source frame rate
- Want a GIF? Two-stage palette (`palettegen` + `paletteuse`) can compress a 30s 1080p animation to
  3MB

See `video-export.md` for the full script invocation.

## 8. Batch Export — tmp Dirs Must Carry PID to Prevent Concurrency Collisions

**The trap**: ran `render-video.js` in 3 parallel processes for 3 HTMLs. TMP_DIR was named only with
`Date.now()`, so 3 processes started in the same millisecond shared one tmp directory. The first
finisher cleaned tmp, the other two read the directory and got `ENOENT`, all crashed.

**Rule**:
- Any tmp directory that multiple processes might share must be named with a **PID or random suffix**:
  ```js
  const TMP_DIR = path.join(DIR, '.video-tmp-' + Date.now() + '-' + process.pid);
  ```
- If you really want multi-file parallel, use the shell's `&` + `wait` instead of forking inside one
  node script
- For batch recording multiple HTMLs, the safe play: **serial** (parallel up to 2 is fine, 3+ should
  queue)

## 9. Progress Bar / Replay Button in Recording — Chrome Elements Pollute the Video

**The trap**: animation HTML had a `.progress` bar, `.replay` button, `.counter` timestamp for human
debugging. After recording to MP4, those elements appear at the bottom of the video, like dev tools
got captured into the deliverable.

**Rule**:
- Manage human-facing "chrome elements" (progress bar / replay button / footer / masthead / counter
  / phase labels) separately from video content
- **Convention**: any element with class `.no-record` is auto-hidden by the recording script
- Script side (`render-video.js`) injects CSS by default to hide common chrome class names:
  ```
  .progress .counter .phases .replay .masthead .footer .no-record [data-role="chrome"]
  ```
- Inject via Playwright's `addInitScript` (effective before every navigate, also stable across reload)
- If you want to view raw HTML (with chrome), pass `--keep-chrome` flag

## 10. First Few Seconds of Recording Show Animation Repeating — Warmup Frame Leak

**The trap**: old `render-video.js` flow `goto → wait fonts 1.5s → reload → wait duration`. Recording
starts at context creation, the warmup phase already played some animation, after reload it restarts
from 0. Result: the first few seconds of video are "mid-animation + transition + animation from 0",
clearly repeated.

**Rule**:
- **Warmup and Record must use independent contexts**:
  - Warmup context (no `recordVideo` option): only loads url, waits for fonts, then close
  - Record context (with `recordVideo`): fresh start, animation records from t=0
- ffmpeg `-ss trim` can only trim Playwright's small startup latency (~0.3s) — **cannot** be used to
  cover up warmup frames; the source must be clean
- Closing the recording context = WebM written to disk; that's a Playwright constraint
- Reference code pattern:
  ```js
  // Phase 1: warmup (throwaway)
  const warmupCtx = await browser.newContext({ viewport });
  const warmupPage = await warmupCtx.newPage();
  await warmupPage.goto(url, { waitUntil: 'networkidle' });
  await warmupPage.waitForTimeout(1200);
  await warmupCtx.close();

  // Phase 2: record (fresh)
  const recordCtx = await browser.newContext({ viewport, recordVideo });
  const page = await recordCtx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(DURATION * 1000);
  await page.close();
  await recordCtx.close();
  ```

## 11. Don't Draw "Pseudo-chrome" Inside the Frame — Decorative Player UI Collides with Real Chrome

**The trap**: animation uses the `Stage` component, which already provides scrubber + timecode +
pause button (these are `.no-record` chrome, auto-hidden on export). I then drew a
"`00:60 ──── CLAUDE-DESIGN / ANATOMY`" "magazine-page-number-style decorative progress bar" at the
bottom, feeling clever. **Result**: the user sees two progress bars — one is the Stage controller,
one is my decoration. Total visual collision, flagged as bug. "Why is there another progress bar
inside the video?"

**Rule**:

- Stage already provides: scrubber + timecode + pause/replay buttons. **Don't draw progress
  indicators, current timecode, copyright bars, or chapter counters inside the frame** — they either
  clash with chrome, or they're filler slop (violating the "earn its place" principle).
- "Page-number feel", "magazine feel", "bottom signature bar" — these **decorative impulses** are
  high-frequency AI auto-fillers. Be alert at every appearance — does it actually convey
  irreplaceable info? Or is it just filling space?
- If you genuinely believe a bottom strip must exist (e.g. the animation's subject IS player UI),
  it must be **narratively necessary** AND **visually distinct from the Stage scrubber** (different
  position, form, tone).

**Element ownership test** (every element drawn into canvas must answer):

| What it is | What to do |
|------------|------|
| Narrative content of a specific scene | OK, keep it |
| Global chrome (control/debug) | Add `.no-record` class, hidden on export |
| **Neither scene-owned nor chrome** | **Delete**. It's an orphan, definitely filler slop |

**Self-check (3 seconds before delivery)**: take a still frame and ask yourself —

- Is there anything that "looks like video player UI" (horizontal progress bar, timecode, control
  buttons)?
- If yes, would the narrative suffer if you deleted it? If not, delete.
- Does the same kind of info (progress/time/credits) appear twice? Merge to one place in chrome.

**Counter-example**: drawing `00:42 ──── PROJECT NAME` at the bottom, drawing "CH 03 / 06" chapter
counter in the lower-right, drawing version "v0.3.1" at the edge — all pseudo-chrome filler.

## 12. Recording Preamble + Recording Start Offset — `__ready` × tick × lastTick Triple Trap

**The trap (A · preamble blank)**: 60-second animation exported to MP4, first 2-3 seconds are blank.
`ffmpeg --trim=0.3` can't crop it.

**The trap (B · start offset, real incident on 2026-04-20)**: exported a 24-second video, user feels
"video doesn't start playing until 19s in". In reality, the animation started recording from t=5,
recorded to t=24, looped back to t=0, and recorded another 5 seconds to end — so the last 5 seconds
of the video is the actual animation start.

**Root cause** (both pitfalls share one root cause):

Playwright `recordVideo` starts writing WebM the moment `newContext()` is called, but Babel/React/font
loading take L seconds (2-6s). The recording script uses `window.__ready = true` as the anchor for
"animation starts here" — it must be strictly paired with the animation's `time = 0`. Two common
mistakes:

| Mistake | Symptom |
|------|------|
| Setting `__ready` in `useEffect` or sync setup (before tick's first frame) | Recording script thinks animation started, but WebM is still recording the blank page → **preamble blank** |
| Initializing tick's `lastTick = performance.now()` at **script top level** | Font-loading L seconds get counted into first-frame `dt`, `time` jumps instantly to L → recording lags L seconds throughout → **start offset** |

**✅ Correct full starter tick template** (every hand-written animation must use this skeleton):

```js
// ━━━━━━ state ━━━━━━
let time = 0;
let playing = false;   // ❗ default false, only start after fonts ready
let lastTick = null;   // ❗ sentinel — first-frame dt forced to 0 (don't use performance.now())
const fired = new Set();

// ━━━━━━ tick ━━━━━━
function tick(now) {
  if (lastTick === null) {
    lastTick = now;
    window.__ready = true;   // ✅ pair: "recording start" with "animation t=0" same frame
    render(0);               // re-render to ensure DOM ready (fonts already loaded)
    requestAnimationFrame(tick);
    return;
  }
  const dt = (now - lastTick) / 1000;   // dt only advances after first frame
  lastTick = now;

  if (playing) {
    let t = time + dt;
    if (t >= DURATION) {
      t = window.__recording ? DURATION - 0.001 : 0;  // don't loop while recording, leave 0.001s to keep last frame
      if (!window.__recording) fired.clear();
    }
    time = t;
    render(time);
  }
  requestAnimationFrame(tick);
}

// ━━━━━━ boot ━━━━━━
// Don't rAF immediately at top level — wait for fonts
document.fonts.ready.then(() => {
  render(0);                 // draw initial frame first (fonts ready)
  playing = true;
  requestAnimationFrame(tick);  // first tick pairs __ready + t=0
});

// ━━━━━━ seek interface (for render-video defensive correction) ━━━━━━
window.__seek = (t) => { fired.clear(); time = t; lastTick = null; render(t); };
```

**Why this template is correct**:

| Element | Why it must be this way |
|------|-------------|
| `lastTick = null` + first-frame `return` | Avoids counting the L seconds from script-load to tick-first-execution into animation time |
| `playing = false` default | During font-loading, even if `tick` runs it doesn't advance time, avoiding render misalignment |
| `__ready` set on tick's first frame | Recording script starts timing here, the corresponding frame is the animation's true t=0 |
| Start tick inside `document.fonts.ready.then(...)` | Avoids fallback-font width measurement, avoids first-frame font shift |
| `window.__seek` exists | Lets `render-video.js` proactively correct — second line of defense |

**Recording-script-side defenses**:
1. `addInitScript` injects `window.__recording = true` (before page goto)
2. `waitForFunction(() => window.__ready === true)`, record this offset for ffmpeg trim
3. **Extra**: after `__ready`, proactively `page.evaluate(() => window.__seek && window.__seek(0))`
   to force-reset any HTML time drift — second line of defense for HTMLs that don't strictly follow
   the starter template

**Verification**: after exporting MP4
```bash
ffmpeg -i video.mp4 -ss 0 -vframes 1 frame-0.png
ffmpeg -i video.mp4 -ss $DURATION-0.1 -vframes 1 frame-end.png
```
The first frame must be the animation's t=0 initial state (not mid, not black), the last frame must
be the animation's final state (not some moment in the second loop).

**Reference implementation**: `assets/animations.jsx`'s Stage component and `scripts/render-video.js`
both implement this protocol. Hand-written HTML must use the starter tick template — every line
defends against a specific bug.

## 13. No Loop During Recording — `window.__recording` Signal

**The trap**: animation Stage defaults to `loop=true` (convenient for browser viewing).
`render-video.js` waits 300ms buffer after duration before stopping, those 300ms let Stage enter the
next loop. ffmpeg `-t DURATION` truncation places the final 0.5-1s in the next loop — the video
suddenly returns to frame 1 (Scene 1) at the end, audience thinks the video is broken.

**Root cause**: no handshake protocol between recording script and HTML for "I'm recording". HTML
doesn't know it's being recorded, keeps looping like a browser interaction.

**Rule**:

1. **Recording script**: inject `window.__recording = true` in `addInitScript` (before page goto):
   ```js
   await recordCtx.addInitScript(() => { window.__recording = true; });
   ```

2. **Stage component**: detect this signal, force loop=false:
   ```js
   const effectiveLoop = (typeof window !== 'undefined' && window.__recording) ? false : loop;
   // ...
   if (next >= duration) return effectiveLoop ? 0 : duration - 0.001;
   //                                                       ↑ leave 0.001 to prevent end=duration Sprite from being shut off
   ```

3. **Closing Sprite's fadeOut**: while recording, set `fadeOut={0}`, otherwise the video end fades to
   transparent/dark — users expect to land on a clear last frame, not a fade. When hand-writing HTML,
   ending Sprites should use `fadeOut={0}`.

**Reference implementation**: `assets/animations.jsx`'s Stage / `scripts/render-video.js` already
have the handshake built in. Hand-written Stages must implement `__recording` detection — otherwise
recording will hit this trap.

**Verification**: after exporting MP4 run `ffmpeg -ss 19.8 -i video.mp4 -frames:v 1 end.png` and
check that the last 0.2 seconds is still the expected final frame, not a sudden cut to another scene.

## 14. 60fps Video Defaults to Frame Duplication — minterpolate Has Poor Compatibility

**The trap**: `convert-formats.sh` using `minterpolate=fps=60:mi_mode=mci...` to generate 60fps MP4,
some macOS QuickTime / Safari versions can't open it (black screen or refuses to open). VLC / Chrome
can open it.

**Root cause**: minterpolate's H.264 elementary stream contains certain SEI / SPS fields that some
players parse incorrectly.

**Rule**:

- Default 60fps uses simple `fps=60` filter (frame duplication), broad compatibility (QuickTime /
  Safari / Chrome / VLC all open)
- High-quality interpolation goes through `--minterpolate` flag explicitly — **but you must locally
  test the target player** before delivering
- The 60fps label's value is in **upload-platform algorithm recognition** (Bilibili / YouTube
  prioritize 60fps tagged content); the actual perceptual smoothness gain for CSS animation is
  marginal
- Add `-profile:v high -level 4.0` to improve H.264 universal compatibility

**`convert-formats.sh` already defaults to compat mode**. If you need high-quality interpolation, add
`--minterpolate` flag:
```bash
bash convert-formats.sh input.mp4 --minterpolate
```

## 15. `file://` + External `.jsx` CORS Trap — Single-File Delivery Must Inline the Engine

**The trap**: animation HTML loads engine via `<script type="text/babel" src="animations.jsx"></script>`.
Open by double-click on local machine (`file://` protocol) → Babel Standalone uses XHR to fetch `.jsx`
→ Chrome reports `Cross origin requests are only supported for protocol schemes: http, https,
chrome, chrome-extension...` → entire page goes black, no `pageerror` reported, only console error,
easily misdiagnosed as "animation didn't trigger".

Starting an HTTP server may not save you — if a global proxy is set, `localhost` also goes through
the proxy and returns 502 / connection failed.

**Rule**:

- **Single-file delivery (HTML usable on double-click)** → `animations.jsx` must be **inlined** into
  a `<script type="text/babel">...</script>` tag, don't use `src="animations.jsx"`
- **Multi-file project (HTTP-server demo)** → external loading is fine, but explicitly document the
  `python3 -m http.server 8000` command in the deliverable
- Decision criterion: is what you're delivering "an HTML file" or "a project directory with server"?
  The former requires inlining
- Stage component / animations.jsx are often 200+ lines — pasting into HTML `<script>` is fully
  acceptable, don't fear file size

**Minimum verification**: double-click your generated HTML, **don't** open via any server. If Stage
displays the animation's first frame correctly, it passes.

## 16. Cross-Scene Inverted Context — In-Frame Elements Must Not Hardcode Color

**The trap**: building a multi-scene animation, `ChapterLabel` / `SceneNumber` / `Watermark` —
elements that **appear across all scenes** — hardcode `color: '#1A1A1A'` (dark text). First 4 scenes
have light backgrounds, fine. By the 5th black-background scene, "05" and the watermark are
invisible — no error, no check triggers, key info silently disappears.

**Rule**:

- **Cross-scene reused in-frame elements** (chapter label / scene number / timecode / watermark /
  copyright bar) **must not hardcode color values**
- Use one of three approaches:
  1. **`currentColor` inheritance**: element only writes `color: currentColor`, parent scene
     container sets `color: <computed>`
  2. **invert prop**: component accepts `<ChapterLabel invert />` to manually toggle dark/light
  3. **Auto-compute from background**: `color: contrast-color(var(--scene-bg))` (CSS 4 new API, or
     compute in JS)
- Before delivery, use Playwright to grab a representative frame from **each scene** and human-eye
  check whether the cross-scene elements are visible everywhere

The insidious thing about this pitfall is — **no bug alarm**. Only human eyes or OCR will catch it.

## Quick Self-Check (5 seconds before starting work)

- [ ] Every `position: absolute` parent has `position: relative`?
- [ ] Special characters in animation (`␣` `⌘` `emoji`) all exist in the chosen font?
- [ ] Grid/Flex template count matches JS data length?
- [ ] Cross-fades between scene swaps, no >0.3s pure blank?
- [ ] DOM measurement code wrapped in `document.fonts.ready.then()`?
- [ ] `render(t)` is pure, or has explicit reset mechanism?
- [ ] Frame 0 is the complete initial state, not blank?
- [ ] No "pseudo-chrome" decoration in frame (progress bar / timecode / bottom signature colliding
      with Stage scrubber)?
- [ ] Animation tick's first frame synchronously sets `window.__ready = true`? (built into
      animations.jsx; hand-written HTML must add it)
- [ ] Stage detects `window.__recording` and forces loop=false? (hand-written HTML must add)
- [ ] Closing Sprite's `fadeOut` set to 0 (so video end stops on a clear frame)?
- [ ] 60fps MP4 defaults to frame-duplication mode (compat); only add `--minterpolate` for
      high-quality interpolation?
- [ ] After export, grab frame 0 + last frame to verify they're animation initial / final states?
- [ ] Specific brand involved (Stripe / Anthropic / Lovart / ...): completed the "brand asset
      protocol" (SKILL.md §1.a five steps)? Wrote `brand-spec.md`?
- [ ] Single-file delivery HTML: `animations.jsx` is inlined, not `src="..."`? (under file://,
      external .jsx will CORS to black screen)
- [ ] Cross-scene elements (chapter label / watermark / scene number) do not hardcode color? Visible
      under every scene's background?
