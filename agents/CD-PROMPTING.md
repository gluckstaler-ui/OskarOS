# CD Prompting — Nano Banana Craft Guide

**Read this before writing ANY image prompt.**

---

## THE RULE

If Nano fails, that's YOUR failure. You were vague. You didn't name the files. Fix your prompt.

---

## PROMPT FORMAT

```
[OPERATION] [source files]: [What the scene should be]. [Key details]. [Mood].
```

**Operations:**
- `EDIT [file.jpg]:` — Modify one image
- `COMPOSE [file1.jpg + file2.jpg]:` — Combine elements from multiple images
- `GENERATE:` — Create from scratch (no source files)

---

## THE FIVE COMMANDMENTS

1. **Name the files.** "sultan.jpg" not "the falcon photo." "hero.jpg" not "the background."

2. **Name the characters.** "Sultan" not "the falcon." "Haboob" not "the camel." "Shabby" not "the orange cat."

3. **Name the location.** "Tuwaiq Escarpment, Saudi Arabia" not "a cliff." "Qiddiya entertainment district" not "a theme park."

4. **Include the reference.** If the scene needs Qiddiya visible, reference `SF--park--render.webp`. If it needs the majlis setup, reference `hero.jpg`.

5. **Specify what NOT to do.** "DO NOT modernize the setting." "DO NOT make the falcon larger than natural size."

---

## ANATOMY BY FORM — A/B/C/D

The Five Commandments are universal. This section is what's load-bearing PER FORM — what you must include, where each form's pitfalls hide, what shape a real prompt takes.

**If your prompt is two sentences, you've under-prompted.** Real prompts are paragraphs. Named subjects. Named scenes. Lighting specified. Mood specified. Scale specified. Explicit DO NOT list. See the Successful Prompts archive at the bottom for the right length and texture — every archived prompt is 6–10 lines, not 2.

---

### A) GENERATE — text → new image

Pure imagination call. Nano has nothing to anchor on except your words. Every absent detail becomes a training-data average — generic subject, generic cliff, generic warm light. The whole job is leaving Nano no room to default.

**Anatomy of a strong GENERATE prompt:**

1. **Subject** — named, specific, with adjectives that aren't "beautiful / dramatic / cinematic." A weathered hand, not "a hand." A 60-year-old Saudi man in white thobe, not "a man."
2. **Scene / setting** — named location, named architecture, named cultural context. "Tuwaiq Escarpment, Saudi Arabia" not "a cliff." "Traditional majlis with kilim rugs and brass lanterns" not "a room."
3. **Composition** — framing, angle, distance. "Cinematic close-up, eye-level." "Wide overhead shot." "Three-quarter portrait, shallow depth of field."
4. **Lighting** — named time of day, named light source, named quality. "Golden hour rim light from camera-left." "Morning side-light through wooden latticework." "Brass lantern interior glow."
5. **Mood / feeling** — the emotional register, not generic adjectives. "The moment before the ride begins." "Grandmother's spread, everyone reaching in at once."
6. **Key details** — the load-bearing micro-details that make it specific to YOUR brand, not a stock photo. "Dust motes dancing in the light." "Steam rising from the dallah spout." "Cushion edges frayed from use."
7. **DO NOT list** — negative constraints to fight Nano's drift toward training averages. "DO NOT modernize the setting." "DO NOT use Western tableware." "DO NOT make this look like a stock photo."

**GENERATE-specific pitfalls:**

- **Generic subject → generic output.** Nano fills the void with the AI house style. "A beautiful woman in a coffee shop" produces the same image every model produces today. Generic in, generic out.
- **Vague location → Nano imagines "any cliff."** Wrong rocks, wrong vegetation, wrong continent.
- **No mood → polished but emotionless.** Technically correct, narratively dead.
- **No DO NOT → drift toward training averages.** Modern furniture creeps in. Lighting flattens. Cultural specifics blur.
- **Two-sentence prompts.** The single biggest cause of bad GENERATE output is under-prompting. If you wrote it in 30 seconds, Nano will produce 30-seconds-of-thought results.

---

### B) EDIT IMAGE — 1 image → modified 1 image

You're handing Nano an existing image and asking for a delta. The trap is that Nano interprets "edit this" liberally — it will gladly change things you wanted preserved unless you EXPLICITLY say what to keep.

**Anatomy of a strong EDIT prompt:**

1. **Operation prefix** — `EDIT [filename]:` Always. The UI badge depends on it.
2. **What to change** — the specific delta in concrete terms. Not "improve the lighting" (Nano picks generic improvements). Be precise: "Deepen the shadows. Add Sultan the falcon as silhouette against the starry sky, circling above."
3. **What to keep — explicit invariants** — the load-bearing list. "DO NOT change the man, the cushions, the kilim rugs, the brass lanterns, the string lights, the lighting on the man's face." Without this list, Nano drifts.
4. **The new mood / new feeling** — the why, not just the what. "The feeling: 'The kingdom is down there. You're above it all.'"
5. **Scale and position** for any added elements. "Sultan small in the frame, upper-left third, ~5% of canvas height."

**EDIT-specific pitfalls:**

- **No "DO NOT" list → face drift.** Edit a portrait without "preserve subject's identity, exact same face" and you get a different person. The classic failure.
- **"Improve the X"** — Nano picks generic improvements that may not match the brand. Specify the improvement.
- **Added elements without scale** — giant falcons, tiny camels, broken visual logic.
- **Too many changes in one prompt** — Nano drifts under load. If you need lighting + atmosphere + added subject, chain two edits.

---

### C) COMPOSE IMAGE — N images → 1 image

Subject from one source, scene from another. The trap is Nano needs to know WHICH file plays WHICH role — without explicit role assignment it averages the sources or picks one as primary at random.

**Anatomy of a strong COMPOSE prompt:**

1. **Operation prefix** — `COMPOSE [file1.jpg + file2.jpg]:` Always. Source files in brackets, plus-separated.
2. **Role per file** — explicit. "Take Sultan from sultan.jpg and put him into the hero scene from hero.jpg." Subject vs scene, foreground vs background — name it.
3. **Spatial placement** — where in the scene the subject lands. "On the man's gauntlet, head turned three-quarters." "At the edge of the cliff, silhouetted against the sunset."
4. **Interaction** — what's happening between the elements. "The man looking down at Sultan, half-smile." "The cats lounge on cushions to either side."
5. **Lighting reconciliation** — the seam between sources. "Match the warm afternoon light of hero.jpg — Sultan's plumage catches the same golden tone." Without this, the subject looks pasted in.
6. **Scale** — explicit dimensions. "Sultan natural size, wingspan ~1 meter, head reaches the man's shoulder."
7. **What to preserve from each source.** "Keep Sultan's plumage and eye color from sultan.jpg. Keep the entire majlis setup from hero.jpg unchanged."

**COMPOSE-specific pitfalls:**

- **No role assignment** — Nano averages the sources or picks at random which file is primary. Output looks confused.
- **No lighting reconciliation** — the seam shows. Subject looks pasted in (different light direction, different color temperature, different shadow length).
- **No scale** — subject too big or too small, breaks the scene's logic.
- **More than 2 source files** — Nano struggles to reason about three or more sources. Either reduce to two, or stage the composition (compose A+B → save the result → compose result+C as a second pass).

---

### D) LAYOUT — multi-element composition in ONE Nano call

See `## THE SHEET PATTERN` below for the full anatomy. When to reach for it, the IDENTICAL-keyword discipline that locks subject consistency across panels, the prompt template (2×2 / 2×3 grids with seamless background), and the post-Nano image-ops chain (slice → chroma-key → crop → tag) — all there. Don't reconstruct from memory.

The one prompt-time tip worth repeating here: ALWAYS specify the seamless background color explicitly in the Layout prompt (e.g. "seamless `#f5f5f0` background, 16px gutters between panels"). This gives image-ops a clean color to chroma-key against in post.

---

## COMMON FAILURES

| Failure | Cause | Fix |
|---------|-------|-----|
| Empty valley | No reference for what should be below | Reference `SF--park--render.webp` for Qiddiya |
| Wrong location | Said "cliff" generically | Say "Tuwaiq Escarpment, Saudi Arabia" |
| Giant falcon | Didn't specify scale | "Sultan, natural size, wingspan ~1 meter" |
| Wrong vibe | Didn't specify what to KEEP | "DO NOT change the setting. Keep traditional cushions, kilim rugs." |
| Magazine food shot | Said what's on table, not the FEELING | "Hands reaching in. Someone pouring qahwa. A MOMENT, not a still life." |

---

## SUCCESSFUL PROMPTS (Archive)

### Food Spread — WORKED
```
COMPOSE [luqaimat.jpg]:

Overhead view of grandmother's spread on hammered brass tray. Luqaimat glistening with date syrup in center (blue-and-white ceramic bowl). Kunafa with cheese pull, pistachio garnish, steam rising. Ma'amoul with fork pattern. Dates in wooden bowl. Highland honey with wooden dipper. Brass dallah pouring dark qahwa into traditional finjan.

CRITICAL: At least TWO hands visible reaching into frame — one pouring qahwa, one selecting food. This is a MOMENT, not a magazine shot.

Warm morning light. Wooden table surface. The feeling of everyone reaching in at once.
```

### Haboob Ride — WORKED
```
COMPOSE [hero.jpg + haboob.jpg]:

Silhouette of Haboob the white camel with rider in traditional dress, standing at the edge of the Tuwaiq Escarpment. Dramatic sunset sky — deep orange to purple gradient.

BELOW THE CLIFF: Qiddiya entertainment district from SF--park--render.webp — ferris wheel, stadium lights beginning to glow, coaster tracks, the arch structure, construction cranes.

The scale should communicate 200 meters of altitude. The rider is small against the vast valley below.

Cinematic. The moment before the ride begins.
```

### Royal Atmosphere — WORKED
```
EDIT [hero-night.jpeg]:

Deepen the shadows. Add Sultan the falcon as silhouette against the starry sky, circling above.

DO NOT change the setting. Keep: man in white thobe, traditional cushions, kilim rugs, brass lanterns, string lights.

The Qiddiya lights glow blue in the valley below — stadium visible, entertainment district as distant constellation.

The feeling: "The kingdom is down there. You're above it all."
```

---

## PRE-SUBMISSION CHECKLIST

Before sending any prompt:

- [ ] Did I name the source files explicitly?
- [ ] Did I name characters by name (Sultan, Haboob, Shabby)?
- [ ] Did I specify the exact location (Tuwaiq Escarpment, not "cliff")?
- [ ] If Qiddiya should be visible, did I reference `SF--park--render.webp`?
- [ ] Did I include at least one "DO NOT" instruction?
- [ ] Did I describe the FEELING, not just the objects?
- [ ] Is scale specified for any focal subjects?
- [ ] Would another CD understand exactly what I want?

---

## THE SHEET PATTERN — multi-variant in one generation

Nano cannot match a subject across separate generations. Steve in call A vs call B = cousins. Steve four times in ONE call = same person, four poses. **This is the load-bearing insight.**

When you need N variants of one thing, generate them as a single sheet, then slice in image-ops.

### When to reach for it

- **Logo set** — color / mono / icon-only / wordmark on one sheet
- **Character poses** — Sultan flying / hooded / on gauntlet / wing-extended
- **Multi-vibe consistency** — same character anatomy across 4 vibes (anatomy stays identical when generated together)
- **Palette validation** — same hero scene at 4 different palette tones, pick the one that ships
- **Aspect-ratio crops** — same composition rendered to 1:1 / 16:9 / 9:16 / 4:5 in one go (no per-ratio re-imagining)
- **Style exploration** — same subject in 4 different art directions on one canvas

### How to prompt

Make the grid structure explicit. Specify margins, background, and the consistency requirement.

```
GENERATE: Single canvas with a 2×2 grid layout. White seamless background.
16px clear margin between panels.

Top-left:    Sultan flying head-on, wings spread, looking at camera.
Top-right:   Sultan hooded on the leather gauntlet.
Bottom-left: Sultan perched, wings extended, ready to launch.
Bottom-right: Sultan in profile, head turned three-quarters.

Same falcon throughout — IDENTICAL plumage pattern, IDENTICAL eye color,
IDENTICAL beak proportions. The four poses are the same individual bird.

Aspect: 1:1.
```

The CRITICAL words are "IDENTICAL" repeated for each anatomical feature you care about. Nano respects within-render consistency when asked; without the explicit instruction it will drift slightly between panels.

### After Nano returns

Order of operations:

1. **image-ops SLICE** 2×2 → 4 outputs land as B-ROLL with auto-numbered names
2. **image-ops FORMAT-CONVERT** → PNG with chroma-key add-on ON, eyedropper-pick the white background → 4 alpha-PNGs
3. **image-ops CROP** if the slice cells include unwanted margin around individual subjects
4. **Tag** the keepers (READY for ship; the rejects stay B-ROLL)

### Why it beats N separate calls

| Concern | Sheet pattern | N separate calls |
|---|---|---|
| Cost | 1 Nano call | N Nano calls |
| Consistency | Guaranteed within one render | Drifts between calls — "cousins, not the same person" |
| Iteration | One prompt re-rolls all N | Each variant needs its own re-roll |
| Provenance | All trace to one source via `image_ops:slice` | N separate generations to manage |

### Successful sheet prompts (archive)

Add to the archive when a sheet prompt works perfectly. Format:

```
### [Subject set name] — SHEET WORKED
\`\`\`
[The exact 2×2 or 2×3 prompt]
\`\`\`
**Sliced into:** [N output filenames]
**Post-processing:** [chroma-key key color / crop adjustments / etc.]
```

---

## ASPECT RATIOS

Passed separately to the API, NOT in prompt text.

| Ratio | Use For |
|-------|---------|
| 16:9 | Hero images, cinematic landscapes |
| 1:1 | Portraits, food, social media |
| 3:4 | Mobile-first heroes |
| 4:3 | Menu backgrounds, wide cards |
| 9:16 | Stories, vertical mobile |

---

## ADDING TO THIS FILE

When a prompt works perfectly, archive it:

```markdown
### [Scene Name] — WORKED
\`\`\`
[The exact prompt]
\`\`\`
```

When a prompt fails, add to COMMON FAILURES table.

The next JEDI shouldn't have to rediscover what works.
