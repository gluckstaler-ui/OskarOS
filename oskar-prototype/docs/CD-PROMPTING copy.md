# Creative Director Prompting Guide

> "If Nano fails, that's YOUR failure. You were vague."

**READ THIS FILE BEFORE WRITING ANY PROMPT.**

---

## THE CORE TRUTH

Nano Banana is smart. Smarter than you think. It can composite, blend, edit, generate — IF you do your job.

Your job is to tell it:
1. **WHICH images** are ingredients (by filename)
2. **WHAT** the final scene should be
3. **The mood/feeling**
4. **What it should NOT do** (for edits)
5. **A reference file** if the location/subject is specific

If you skip any of these, you get garbage. And that's on you.

---

## THE FIVE COMMANDMENTS

### I. Name the Files
❌ "The hero shot" / "the portrait" / "the background"
✅ `hero.jpg` / `sultan.jpg` / `SF--park--render.webp`

Nano can't read your mind. Name the file.

### II. Name the Characters
❌ "the falcon" / "the camel" / "the cat"
✅ "Sultan" / "Haboob" / "Shabby" / "Qamar"

Characters have names. Use them.

### III. Name the Location
❌ "a cliff" / "the desert" / "a canyon"
✅ "Tuwaiq Escarpment, 200 meters above Qiddiya, Saudi Arabia"

Generic locations get generic results.

### IV. Include Reference for Unknown Locations
If Nano doesn't know what something looks like, **IT WILL HALLUCINATE.**

❌ "Qiddiya glows in the valley below"
✅ "Use SF--park--render.webp as reference — the full Qiddiya entertainment district with coasters, white tensile structures, the vertical Falcon's Flight tower, stadium"

This was the fatal error in Session 2026-01-28-1. Three generations failed because the prompt said "Qiddiya" but gave no reference. Nano invented a river canyon.

### V. Specify What NOT to Do
For EDIT operations, what stays is as important as what changes.

❌ "Add Sultan silhouette to night scene"
✅ "EDIT [hero-night.jpeg]: Add Sultan silhouette against stars. DO NOT change the setting — keep man in white thobe, traditional cushions, kilim rugs, brass lanterns."

The "royal atmosphere" failure: Nano changed the whole setting to a Four Seasons terrace with men in suits because the prompt didn't protect the original elements.

---

## PROMPT FORMAT

```
[OPERATION] [source files]: [instruction]
```

### Operations

| Operation | Format | When to Use |
|-----------|--------|-------------|
| EDIT | `EDIT [filename]: instruction` | Modify single image |
| COMPOSE | `COMPOSE [file1 + file2 + ...]: instruction` | Combine elements |
| GENERATE | `instruction` (no prefix) | Create from scratch |

---

## COMMON FAILURES & FIXES

These are from actual sessions. Learn from them.

| Failure | What You See | Root Cause | Fix |
|---------|--------------|------------|-----|
| Empty valley | Generic desert canyon instead of theme park | No reference file for Qiddiya | Include `SF--park--render.webp` + describe what it shows |
| Wrong geography | River, American Southwest | Vague "cliff" description | Specify "Tuwaiq Escarpment, Saudi Arabia" |
| Giant falcon | Pterodactyl-sized bird | No scale reference | "Peregrine falcon, ~1m wingspan, small against vast sky" |
| Wrong setting | Four Seasons when you wanted grandma's house | Didn't specify what to KEEP | Add "DO NOT change" + list elements |
| Magazine shot | Beautiful but lifeless | Described objects, not feeling | Add "PEOPLE SHARING" / "hands reaching" / "this is a moment" |
| Wrong characters | Men in suits instead of man in thobe | Didn't name who should be there | Name them: "The man in white thobe from hero.jpg" |
| Floating composition | Elements feel pasted | Described pieces, not scene | Describe spatial relationships: "Sultan dives FROM upper-right TOWARD the coaster" |

---

## PROMPT TEMPLATES

### Composition: Character + Scene + Reference
```
COMPOSE [character.jpg + scene.jpg + reference.webp]:
Take [CHARACTER NAME] from [character.jpg] and place them in [scene.jpg].
[WHERE in the frame — upper-right, foreground, etc.].
[WHAT they're doing — diving, lounging, watching].
BELOW/BEHIND: Use [reference.webp] as reference for [what should be visible].
[List specific elements from reference that must appear].
[Mood and lighting].
[Scale note if relevant].
```

### Edit: Add Element to Existing
```
EDIT [source.jpg]:
Add [element] to [location in frame].
DO NOT CHANGE:
- [Element 1 that must remain]
- [Element 2 that must remain]
- [Element 3 that must remain]
[Mood adjustment if any].
```

### Generate: From Scratch
```
[Who — by name, with description].
[Where — specific location, not generic].
[What's happening — the moment, the action].
[The composition — where elements are in frame].
[The mood — lighting, time of day, emotional tone].
[Key details that must be present].
[Scale reference if relevant].
```

### Food/Product Shot
```
[Food items with specific names and preparations].
[Composition — overhead, angle, arrangement].
[Container/surface details — brass tray, wooden table, etc.].
[THE PEOPLE ELEMENT — hands reaching, pouring, sharing].
[Lighting — "golden morning from left" / "warm lantern glow"].
[The feeling — "grandmother's table during a meal, not a magazine shoot"].
```

---

## SUCCESSFUL PROMPTS (ARCHIVE)

These actually worked. Use them as templates.

### Sultan Action — WORKED
```
COMPOSE [hero.jpg + sultan.jpg + SF--park--render.webp]:
Sultan the falcon diving at 45 degrees from upper-right frame toward the coaster.
Wings tucked for speed dive, motion blur on wingtips only.
The majlis scene from hero.jpg remains — man in white thobe on red cushions,
Haboob the camel behind, orange cat lounging, black cat at edge.
BELOW THE CLIFF: The full Qiddiya entertainment district from SF--park--render.webp —
coaster tracks weaving through attractions, white tensile structures, green landscaping,
the vertical Falcon's Flight tower, stadium visible, Riyadh skyline in distance.
Golden hour. The 200-meter altitude should be FELT through scale.
```

**Why it worked:** Named all three source files. Named the characters. Specified where elements should be (upper-right, below). Included reference file AND described what from it should appear. Specified scale feeling.

### Food Spread — WORKED
```
Food spread on hammered brass tray. Overhead angle with depth.
Luqaimat glistening with date syrup in blue-and-white ceramic bowl (CENTER).
Kunafa with visible cheese pull, pistachio garnish, steam rising.
Ma'amoul with traditional fork pattern, date filling visible.
Dates in terracotta bowl. Highland honey in small jar with wooden dipper.
Brass dallah actively pouring dark qahwa into finjan.
AT LEAST TWO HANDS visible reaching into frame — one pouring, one selecting food.
This is grandmother's table during a meal, not a magazine shoot.
Golden morning light from left. Rustic wood table surface visible at edges.
```

**Why it worked:** Specific food names and preparations. Clear composition (overhead, CENTER). The people element (hands, pouring). The feeling explicitly stated ("grandmother's table, not magazine"). Lighting direction specified.

### Haboob Sunset Ride — WORKED
```
COMPOSE [1769605208767-haboob.jpg + hero.jpg + SF--park--render.webp]:
Silhouette of rider in traditional dress on Haboob the white camel.
Standing at Tuwaiq Escarpment cliff edge, dramatic sunset sky behind.
BELOW: Full Qiddiya entertainment district from SF--park--render.webp —
ferris wheel, stadium lights beginning to glow, coaster tracks, construction cranes.
The rider is small against the vast sky. The scale shows 200-meter altitude.
Golden hour transitioning to blue hour. Cinematic wide shot.
```

**Why it worked:** Named the files. Named the character (Haboob). Location specified (Tuwaiq). Reference file included with specific elements listed. Scale explicitly called out ("small against vast sky", "200-meter altitude").

### Royal Atmosphere — WORKED
```
EDIT [1769605208790-hero-night.jpeg]:
Deepen the shadows. Add two falcon silhouettes circling against the starry sky.
Qiddiya glows cold blue in the valley below — use SF--park--render.webp as reference
for the entertainment district's spread of lights.
DO NOT CHANGE: The man in white thobe, the traditional cushions, the kilim rugs,
the brass lanterns, Haboob behind, the cats on cushions.
The feeling: "The kingdom is down there. You're above it all."
```

**Why it worked:** EDIT with explicit source file. Changes specified (deepen shadows, add falcons). Reference file for valley. DO NOT CHANGE list protecting original elements. Feeling stated explicitly.

---

## FAILED PROMPTS (AUTOPSY)

Learn from the corpses.

### Sultan Action v1 — FAILED
```
Sultan diving toward Falcon's Flight coaster with the majlis scene below.
Qiddiya glitters in the valley. Golden hour. Dramatic.
```

**Why it failed:** No source files named. No reference for Qiddiya. No spatial composition (WHERE is Sultan diving FROM?). No scale reference. Result: Empty valley, generic canyon, floating elements.

### Royal Atmosphere v1 — FAILED
```
Add exclusivity feeling to the night scene. Falcons circling.
The theme park glows below. Luxury atmosphere.
```

**Why it failed:** No source file named. No "DO NOT CHANGE" list. "Luxury atmosphere" is vague. Result: Four Seasons terrace, men in suits, wrong setting entirely.

---

## BEFORE SUBMITTING ANY PROMPT

**Checklist:**
- [ ] Did I name the source files by actual filename?
- [ ] Did I name the characters (Sultan, Haboob, Shabby, etc.)?
- [ ] Did I specify the location (Tuwaiq Escarpment, not "cliff")?
- [ ] If location is specific, did I include a reference file?
- [ ] Did I describe spatial composition (where elements are in frame)?
- [ ] For EDIT: Did I list what should NOT change?
- [ ] Did I describe the FEELING, not just the objects?
- [ ] Did I include scale reference if size matters?
- [ ] Is this 2+ sentences? (API requirement)

**If any answer is NO, fix the prompt before submitting.**

---

## ASPECT RATIOS

Passed separately to the API, NOT in prompt text.

| Ratio | Use Case |
|-------|----------|
| 16:9 | Hero images, landscapes, wide establishing shots |
| 1:1 | Menu items, portraits, icons |
| 3:4 | Character features, vertical portrait |
| 9:16 | Stories, vertical mobile, social |
| 4:3 | Traditional photo ratio |

---

## THE META-LESSON

The prompts that fail are vague.
The prompts that work are specific.

"A cliff above a theme park" → Fail.
"Tuwaiq Escarpment, 200m above Qiddiya, use SF--park--render.webp for valley detail" → Success.

"Add a falcon" → Fail.
"Add Sultan the peregrine falcon diving at 45 degrees from upper-right, wings tucked, ~1m wingspan (small against sky)" → Success.

**Specificity is not optional. It's the whole job.**

---

*This file exists because three image generations failed.*
*Read it before writing prompts.*
*Add to it when new failures teach new lessons.*

---

*Last updated: 2026-01-30*
*Session: 2026-01-28-1 (FalCaMel Café)*
