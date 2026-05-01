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
