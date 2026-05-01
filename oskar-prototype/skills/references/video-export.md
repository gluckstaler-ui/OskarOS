# Video Export: HTML Animation → MP4 / GIF

Once an animation HTML is finished, users often ask "can we export it as video?" This is the full pipeline.

## When to Export

**Export when**:
- The animation runs end-to-end and is visually verified (Playwright screenshots confirm correct state at each timestamp)
- The user has watched it at least once in a browser and signed off
- **Don't** export while animation bugs are unfixed — fixing things post-export is more expensive

**Triggers users may say**:
- "Can we export this to video?"
- "Make it MP4"
- "Make it a GIF"
- "60fps"

## Output Specs

By default, deliver three formats and let the user choose:

| Format | Spec | Best for | Typical size (30s) |
|---|---|---|---|
| MP4 25fps | 1920×1080 · H.264 · CRF 18 | WeChat embed, Channels, YouTube | 1-2 MB |
| MP4 60fps | 1920×1080 · minterpolate · H.264 · CRF 18 | High-fps showcase, Bilibili, portfolio | 1.5-3 MB |
| GIF | 960×540 · 15fps · palette-optimized | Twitter/X, README, Slack preview | 2-4 MB |

## Toolchain

Two scripts in `scripts/`:

### 1. `render-video.js` — HTML → MP4

Records a 25fps MP4 base. Depends on a global Playwright install.

```bash
NODE_PATH=$(npm root -g) node /path/to/claude-design/scripts/render-video.js <html-file>
```

Optional flags:
- `--duration=30` animation length in seconds
- `--width=1920 --height=1080` resolution
- `--trim=2.2` seconds to trim from the start (drops reload + font-load time)
- `--fontwait=1.5` font-load wait time in seconds (raise when many fonts)

Output: same directory as the HTML, `.mp4` with the same basename.

### 2. `add-music.sh` — MP4 + BGM → MP4

Mix BGM into a silent MP4. Pick by mood from the bundled BGM library, or supply your own audio. Auto-trims to length and adds fade in/out.

```bash
bash add-music.sh <input.mp4> [--mood=<name>] [--music=<path>] [--out=<path>]
```

**Bundled BGM library** (in `assets/bgm-<mood>.mp3`):

| `--mood=` | Style | Best for |
|-----------|-------|----------|
| `tech` (default) | Apple-Silicon / Apple-keynote, minimal synth + piano | Product launch, AI tools, skill release |
| `ad` | Upbeat modern electronic, build + drop | Social ads, product teaser, promo |
| `educational` | Warm bright, light guitar / electric piano, inviting | Explainer, tutorial intro, course teaser |
| `educational-alt` | Same family, alternate cut | Same as above |
| `tutorial` | Lo-fi ambient, almost imperceptible | Software demo, programming tutorial, long demos |
| `tutorial-alt` | Alternate cut | Same as above |

**Behavior**:
- Music trimmed to video length
- 0.3s fade-in + 1s fade-out (avoid hard cuts)
- Video stream `-c:v copy` (no re-encode), audio AAC 192k
- `--music=<path>` overrides `--mood` — supply any external audio
- Wrong `--mood` name lists all available options instead of failing silently

**Typical pipeline** (animation export trifecta + music):
```bash
node render-video.js animation.html                        # record
bash convert-formats.sh animation.mp4                      # derive 60fps + GIF
bash add-music.sh animation-60fps.mp4                      # add default tech BGM
# Or for different scenarios:
bash add-music.sh tutorial-demo.mp4 --mood=tutorial
bash add-music.sh product-promo.mp4 --mood=ad --out=promo-final.mp4
```

### 3. `convert-formats.sh` — MP4 → 60fps MP4 + GIF

Generate a 60fps MP4 and a GIF from an existing MP4.

```bash
bash /path/to/claude-design/scripts/convert-formats.sh <input.mp4> [gif_width] [--minterpolate]
```

Outputs (alongside the input):
- `<name>-60fps.mp4` — defaults to frame replication via `fps=60` (broad compatibility); pass `--minterpolate` for high-quality motion interpolation
- `<name>.gif` — palette-optimized GIF (default 960 wide, configurable)

**60fps mode selection**:

| Mode | Command | Compatibility | Use when |
|------|---------|---------------|----------|
| Frame replication (default) | `convert-formats.sh in.mp4` | QuickTime / Safari / Chrome / VLC all play | General delivery, upload platforms, social media |
| minterpolate | `convert-formats.sh in.mp4 --minterpolate` | macOS QuickTime / Safari may refuse to play | Bilibili and other showcases that need real interpolation — **always test** target player before delivery |

Why is frame replication now the default? minterpolate's H.264 elementary stream has a known compat bug — we hit "macOS QuickTime won't open it" multiple times when minterpolate was the default. See `animation-pitfalls.md` §14.

`gif_width` parameter:
- 960 (default) — universal social
- 1280 — sharper but bigger file
- 600 — Twitter/X priority loading

## Standard Full Flow (recommended)

After the user says "export to video":

```bash
cd <project-dir>

# Assume $SKILL points to this skill's root (replace with your install path)

# 1. Record the 25fps base MP4
NODE_PATH=$(npm root -g) node "$SKILL/scripts/render-video.js" my-animation.html

# 2. Derive the 60fps MP4 and GIF
bash "$SKILL/scripts/convert-formats.sh" my-animation.mp4

# Deliverables:
# my-animation.mp4         (25fps · 1-2 MB)
# my-animation-60fps.mp4   (60fps · 1.5-3 MB)
# my-animation.gif         (15fps · 2-4 MB)
```

## Technical Notes (for debugging)

### Playwright recordVideo gotchas

- Frame rate is fixed at 25fps; you can't record 60fps directly (Chromium headless compositor cap)
- Recording starts when the context is created, so always pass `trim` to drop the load time
- Default container is webm; ffmpeg must transcode to H.264 MP4 for general playback

`render-video.js` handles all of the above.

### ffmpeg minterpolate parameters

Current config: `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`

- `mi_mode=mci` — motion compensation interpolation
- `mc_mode=aobmc` — adaptive overlapped block motion compensation
- `me_mode=bidir` — bidirectional motion estimation
- `vsbmc=1` — variable-size block motion compensation

Works well on CSS **transform animations** (translate / scale / rotate).
On **pure fades** it can produce mild ghosting — if the user dislikes it, fall back to plain frame replication:

```bash
ffmpeg -i input.mp4 -r 60 -c:v libx264 ... output.mp4
```

### Why GIF palette is two-stage

GIF is limited to 256 colors. A single-pass GIF squashes all animation colors into one generic 256-color palette, which mangles delicate palettes like rice-beige + orange.

Two-stage:
1. `palettegen=stats_mode=diff` — scan the whole clip and generate an **optimal palette specific to this animation**
2. `paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle` — encode with that palette; rectangle diff only updates changed regions, dramatically shrinking the file

For fade transitions `dither=bayer` is smoother than `none`, with a slightly larger file.

## Pre-flight (before export)

30-second sanity check before exporting:

- [ ] HTML runs end-to-end in browser, no console errors
- [ ] First frame is a complete initial state (not a blank loading state)
- [ ] Last frame is a stable resolution state (not mid-animation)
- [ ] Fonts / images / emoji all render correctly (see `animation-pitfalls.md`)
- [ ] `Duration` parameter matches the actual animation length in HTML
- [ ] Stage detection in HTML forces `loop=false` when `window.__recording` is set (mandatory for hand-rolled Stages; handled by `assets/animations.jsx`)
- [ ] Final Sprite has `fadeOut={0}` (no fade at video end)
- [ ] Includes the "Created by Huashu-Design" watermark (mandatory for animation scenarios; third-party brand work prefixes "Unofficial · ". See SKILL.md §"Skill promotion watermark")

## Delivery Notes (boilerplate)

Standard handover format after export:

```
**Full delivery**

| File | Format | Spec | Size |
|---|---|---|---|
| foo.mp4 | MP4 | 1920×1080 · 25fps · H.264 | X MB |
| foo-60fps.mp4 | MP4 | 1920×1080 · 60fps (motion interpolation) · H.264 | X MB |
| foo.gif | GIF | 960×540 · 15fps · palette-optimized | X MB |

**Notes**
- 60fps uses minterpolate motion estimation — works well on transform animations
- GIF uses palette optimization; a 30s animation compresses to ~3MB

Tell me if you want different sizes or frame rates.
```

## Common User Follow-ups

| User says | What to do |
|---|---|
| "Too big" | MP4: raise CRF to 23-28; GIF: drop resolution to 600 or fps to 10 |
| "GIF is too blurry" | Raise `gif_width` to 1280; or recommend MP4 instead (WeChat Moments supports it too) |
| "I want vertical 9:16" | Change the HTML source to `--width=1080 --height=1920` and re-record |
| "Add a watermark" | ffmpeg `-vf "drawtext=..."` or `overlay=` a PNG |
| "Transparent background" | MP4 doesn't support alpha; use WebM VP9 + alpha or APNG |
| "Lossless" | CRF 0 + preset veryslow (file gets ~10x larger) |
