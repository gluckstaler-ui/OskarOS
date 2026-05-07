# Audio Design Rules · huashu-design

> The audio recipe for every animation demo. Use alongside `sfx-library.md` (asset list).
> Battle-tested across huashu-design hero v1-v9 iterations · deep Gemini analysis of Anthropic's three official films · 8000+ A/B comparisons.

---

## Core Principle · Two-Track Audio (Iron Rule)

Animation audio **must be designed as two independent layers**, never just one:

| Layer | Role | Time scale | Relation to visuals | Frequency band |
|---|---|---|---|---|
| **SFX (beat layer)** | Marks each visual beat | 0.2-2s sharp | **Tight sync** (frame-accurate) | **High freq 800Hz+** |
| **BGM (atmosphere bed)** | Emotional bed, sense of space | Continuous 20-60s | Loose sync (section-level) | **Mid-low freq <4kHz** |

**An animation with only BGM is crippled** — the viewer subconsciously notices "things are moving but nothing is responding." That's the root of the cheap feeling.

---

## Gold Standard · Golden Ratios

These numbers are **engineering hard parameters** derived from comparing Anthropic's three official films against our own v9 final cut. Apply them directly:

### Volume
- **BGM volume**: `0.40-0.50` (relative to full scale 1.0)
- **SFX volume**: `1.00`
- **Loudness gap**: BGM peak is **-6 to -8 dB** below SFX peak (standout doesn't come from raw SFX volume — it comes from the gap)
- **amix parameter**: `normalize=0` (never `normalize=1` — it flattens dynamic range)

### Frequency separation (P1 hard optimization)
Anthropic's secret isn't "louder SFX" — it's **frequency-band layering**:

```bash
[bgm_raw]lowpass=f=4000[bgm]      # BGM limited to mid-low freq <4kHz
[sfx_raw]highpass=f=800[sfx]      # SFX pushed up to mid-high freq 800Hz+
[bgm][sfx]amix=inputs=2:duration=first:normalize=0[a]
```

Why: human ears are most sensitive to 2-5kHz (the "presence band"). If SFX sit in that band and BGM covers the full spectrum, **the SFX get masked by BGM's high-frequency content**. Highpass to push SFX up + lowpass to push BGM down means each occupies its own slot in the spectrum, and SFX clarity goes up a tier.

### Fades
- BGM in: `afade=in:st=0:d=0.3` (0.3s, avoid hard cut)
- BGM out: `afade=out:st=N-1.5:d=1.5` (1.5s long tail, sense of resolution)
- SFX have built-in envelopes; no extra fade needed

---

## SFX Cue Design Rules

### Density (SFX per 10 seconds)
Empirically Anthropic's three films land in three brackets:

| Film | SFX per 10s | Product personality | Scenario |
|---|---|---|---|
| Artifacts (ref-1) | **~9/10s** | Feature-dense, info-heavy | Complex tool demo |
| Code Desktop (ref-2) | **0** | Pure atmosphere, meditative | Dev tool focus state |
| Word (ref-3) | **~4/10s** | Balanced, office rhythm | Productivity tool |

**Heuristic**:
- Calm / focused product → low SFX density (0-3/10s), BGM-led
- Active / info-heavy product → high SFX density (6-9/10s), SFX-driven rhythm
- **Don't fill every visual beat** — restraint is more sophisticated than density. **Cutting 30-50% of cues makes the rest feel more dramatic**.

### Cue priority
Not every visual beat needs an SFX. Use this priority:

**P0 must-have** (omitting feels wrong):
- Typing (terminal / input)
- Click / select (user decision moments)
- Focus shift (visual lead changes)
- Logo reveal (brand resolution)

**P1 recommended**:
- Element entry / exit (modal / card)
- Completion / success feedback
- AI generation start / end
- Major transition (scene change)

**P2 optional** (too many gets noisy):
- hover / focus-in
- Progress tick
- Decorative ambient

### Timestamp alignment precision
- **Same-frame alignment** (0ms drift): click / focus shift / Logo land
- **Lead by 1-2 frames** (-33ms): fast whoosh (give the viewer psychological lead-in)
- **Trail by 1-2 frames** (+33ms): object landing / impact (matches real physics)

---

## BGM Selection Decision Tree

The huashu-design skill ships 6 BGMs (`assets/bgm-*.mp3`):

```
What's the animation's personality?
├─ Product launch / tech demo → bgm-tech.mp3 (minimal synth + piano)
├─ Tutorial / tool walkthrough → bgm-tutorial.mp3 (warm, instructional)
├─ Education / explainer → bgm-educational.mp3 (curious, thoughtful)
├─ Marketing ad / brand spot → bgm-ad.mp3 (upbeat, promotional)
└─ Variant of any of the above → bgm-*-alt.mp3 (alternates)
```

### When to use no BGM (worth considering)
See Anthropic Code Desktop (ref-2): **0 SFX + pure lo-fi BGM** can also be very high-end.

**When to skip BGM**:
- Animation duration < 10s (BGM can't establish itself)
- Product personality is "focus / meditation"
- Scene already has ambient sound or voiceover
- SFX density is high (avoid auditory overload)

---

## Recipe Library (drop-in)

### Recipe A · Product launch hero (huashu-design v9 same)
```
Duration: 25s
BGM: bgm-tech.mp3 · 45% · band <4kHz
SFX density: ~6/10s

cues:
  Terminal type → type × 4 (0.6s spacing)
  Enter         → enter
  Cards converge → card × 4 (staggered 0.2s)
  Select        → click
  Ripple        → whoosh
  4 focus shifts → focus × 4
  Logo          → thud (1.5s)

Volume: BGM 0.45 / SFX 1.0 · amix normalize=0
```

### Recipe B · Tool feature demo (ref Anthropic Code Desktop)
```
Duration: 30-45s
BGM: bgm-tutorial.mp3 · 50%
SFX density: 0-2/10s (very sparse)

Strategy: let BGM + voiceover drive; SFX only at **decisive moments** (file save, command-execution complete)
```

### Recipe C · AI generation demo
```
Duration: 15-20s
BGM: bgm-tech.mp3 or no BGM
SFX density: ~8/10s (high)

cues:
  User input → type + enter
  AI starts processing → magic/ai-process (1.2s loop)
  Generation complete → feedback/complete-done
  Result reveal → magic/sparkle

Highlight: ai-process can loop 2-3 times across the generation
```

### Recipe D · Pure atmosphere long take (ref Artifacts)
```
Duration: 10-15s
BGM: none
SFX: 3-5 carefully crafted cues, used alone

Strategy: each SFX is the lead, no BGM "smearing" everything together.
Best for: single-product slow shots, close-up showcases
```

---

## ffmpeg Composition Templates

### Template 1 · Single SFX overlaid on video
```bash
ffmpeg -y -i video.mp4 -itsoffset 2.5 -i sfx.mp3 \
  -filter_complex "[0:a][1:a]amix=inputs=2:normalize=0[a]" \
  -map 0:v -map "[a]" output.mp4
```

### Template 2 · Multi-SFX timeline (cue-aligned)
```bash
ffmpeg -y \
  -i sfx-type.mp3 -i sfx-enter.mp3 -i sfx-click.mp3 -i sfx-thud.mp3 \
  -filter_complex "\
[0:a]adelay=1100|1100[a0];\
[1:a]adelay=3200|3200[a1];\
[2:a]adelay=7000|7000[a2];\
[3:a]adelay=21800|21800[a3];\
[a0][a1][a2][a3]amix=inputs=4:duration=longest:normalize=0[mixed]" \
  -map "[mixed]" -t 25 sfx-track.mp3
```
**Key parameters**:
- `adelay=N|N`: first is left-channel delay (ms), second is right — write twice for stereo alignment
- `normalize=0`: preserves dynamic range — critical!
- `-t 25`: trim to specified duration

### Template 3 · Video + SFX track + BGM (with frequency separation)
```bash
ffmpeg -y -i video.mp4 -i sfx-track.mp3 -i bgm.mp3 \
  -filter_complex "\
[2:a]atrim=0:25,afade=in:st=0:d=0.3,afade=out:st=23.5:d=1.5,\
     lowpass=f=4000,volume=0.45[bgm];\
[1:a]highpass=f=800,volume=1.0[sfx];\
[bgm][sfx]amix=inputs=2:duration=first:normalize=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k final.mp4
```

---

## Failure Mode Cheat Sheet

| Symptom | Root cause | Fix |
|---|---|---|
| SFX inaudible | BGM high-frequency masking | Add `lowpass=f=4000` to BGM + `highpass=f=800` to SFX |
| SFX too loud, harsh | SFX absolute volume too high | Drop SFX to 0.7, drop BGM to 0.3, preserve the gap |
| BGM and SFX rhythms clash | Wrong BGM (used music with strong beat) | Switch to ambient / minimal-synth BGM |
| BGM cuts abruptly at end | No fade out | `afade=out:st=N-1.5:d=1.5` |
| SFX overlap into mush | Cues too dense + each SFX too long | Keep each SFX under 0.5s, ≥ 0.2s between cues |
| WeChat mp4 has no sound | WeChat sometimes mutes auto-play | Don't worry — sound returns when the user taps; gifs have no sound by design |

---

## Audio-Visual Coupling (advanced)

### SFX timbre should match the visual style
- Warm rice paper visuals → SFX in **wood / soft** timbre (Morse, paper snap, soft click)
- Cold black-tech visuals → SFX in **metal / digital** timbre (beep, pulse, glitch)
- Hand-drawn / playful visuals → SFX in **cartoon / exaggerated** timbre (boing, pop, zap)

Our current `apple-gallery-showcase.md` warm-rice base → pairs with `keyboard/type.mp3` (mechanical) + `container/card-snap.mp3` (soft) + `impact/logo-reveal-v2.mp3` (cinematic bass)

### SFX can lead the visual rhythm
Advanced technique: **design the SFX timeline first, then adjust visual animations to align with the SFX** (not the other way around).
Each SFX cue is a "clock tick" — visuals adapting to SFX rhythm stay rock-solid; the reverse (SFX chasing visuals) often misses by ±1 frame and feels off.

---

## Pre-release Quality Checklist

- [ ] Loudness gap: SFX peak - BGM peak = -6 to -8 dB?
- [ ] Frequency: BGM lowpass 4kHz + SFX highpass 800Hz?
- [ ] amix normalize=0 (preserves dynamic range)?
- [ ] BGM fade-in 0.3s + fade-out 1.5s?
- [ ] SFX count is appropriate (density matches scene personality)?
- [ ] Each SFX aligns to its visual beat within ±1 frame?
- [ ] Logo reveal SFX duration is sufficient (recommended 1.5s)?
- [ ] Mute BGM and listen: do the SFX alone carry rhythm?
- [ ] Mute SFX and listen: does the BGM alone carry emotion?

Each layer should hold up alone. If it only sounds good when both are stacked, you didn't get it right.

---

## References

- SFX asset list: `sfx-library.md`
- Visual style reference: `apple-gallery-showcase.md`
- Deep audio analysis of Anthropic's three films: `/Users/alchain/Documents/writing/01-wechat-writing/projects/2026.04-huashu-design-launch/reference-animations/AUDIO-BEST-PRACTICES.md`
- huashu-design v9 case study: `/Users/alchain/Documents/writing/01-wechat-writing/projects/2026.04-huashu-design-launch/assets/hero-animation-v9-final.mp4`
