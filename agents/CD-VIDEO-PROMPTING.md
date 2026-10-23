# CD Video Prompting — Gemini Omni Flash Craft Guide

**Read this before writing or reviewing ANY video prompt** (Image mode → tabs VIDEO and VID → VID). Image prompts: `CD-PROMPTING.md`.

Omni Flash makes video **with sound** from a prompt, optionally with images or a video. It renders what you describe and invents everything you leave out. Every second you don't plan becomes a stock-video second.

---

## THE RULE

If the video drifts, cuts where it shouldn't, or sounds wrong, the prompt left a gap. Plan every second, every shot, every sound.

---

## WHAT THE TABS DO (so you know what Omni receives)

**VIDEO — text / image(s) → video.** The slots the user filled decide what Omni does:

| Slots | Omni does | Your prompt describes |
|---|---|---|
| none | text → video | everything |
| First frame | image → video: the image IS the first frame | the motion, camera and sound from that frame on — not the picture |
| First + Last frame | a transition between two frames (same image twice = loop) | the way from the first to the last frame |
| Ingredients (up to 10 images, 3 short videos) | subjects, products or style from the ingredients; they are NOT frames | what the ingredients do, where — named by their tags |

Frames OR ingredients, never both (Omni then treats an ingredient as the last frame).

**VID → VID — change a video.**
- **Extend:** continues the video at its end. The result is the whole video plus the new part (≤ 40 s in all). Optional ingredient images (`<IMAGE_REF_0>`) can enter the scene.
- **Edit:** one change to a video of ≤ 10 s; keeps its length and ratio. Optional ingredient images (what to add).

**Not in the prompt:** ratio, resolution, length, thinking level are set in the tab. Don't write "16:9", "8 seconds" or "4K" into the prompt — at best ignored, at worst they fight the setting (a prompt saying "8 seconds" in a 10 s video leaves 2 s unplanned).

---

## ONE PROMPT, PARTS OF 10 s (✂)

One generation is 3–10 s. A 20 s or 30 s video is one prompt cut into 10 s parts by lines like:

```
✂ PART 2 · 10–20 s
```

- **Keep every ✂ line exactly** where it is. Never delete, merge or move one; Oskar numbers them.
- **Part 1** is the new video. **Every later part starts with `Extend this video:`** and describes only what happens next.
- **Repeat the anchors** in each later part in one short sentence: same subject (name + key look), same place, same light, same sound world. A part without anchors drifts to a new scene.
- **Timecodes count from 0 inside each part:** `[0-4s] … [4-10s]`, also in part 2.
- **Cut where a beat ends.** Never split one action or one spoken line across a ✂.
- A part may have its own shots (cuts): at most 3–4 in 10 s.

---

## ANATOMY OF A STRONG VIDEO PROMPT

1. **Look** — photorealistic live action, animation style, film look, lens feel. One line.
2. **Subject, described once, fully** — name, age, clothes, colours, markings. This is the identity anchor every shot and part refers back to.
3. **Setting** — the named place, time of day, props that matter.
4. **Shots with timecodes** — `[0-3s] Cut 1: medium shot …`. Per shot: framing, camera movement (static, slow push-in, orbit, handheld, aerial pull-back), what moves. For one shot write **"single continuous shot, no cuts"** — Omni cuts by default.
5. **Lighting and mood** — light source, direction, quality; the feeling.
6. **Sound** — ambience, effects with their moment (`door chime at [5s]`), music or **"No music"**, spoken lines in quotes with the language (`says in natural Swiss German: "…"`), otherwise **"No dialogue"**.
7. **Negatives in the text** — there is no negative-prompt field: "No text on screen", "no extra people", "the car keeps its exact shape".

**If your video prompt is under five lines, you under-prompted** (except edits).

---

## BY SITUATION

### A) Text → video
Everything comes from words. Anatomy points 1–7, all of them.

### B) Image → video (first frame)
The picture is already there — describe what **moves**: subject motion, secondary motion (steam, leaves, hair), camera move, sound. "Keep the composition, light and colours of the image." Vague "make it come alive" gives a slow zoom and nothing else.

### C) First + last frame
Describe the **way between**: how the camera travels, what changes, at which second. Loop (same image twice): the motion goes out and returns to its starting position, steady camera.

### D) Ingredients → video
Name each ingredient by its tag: `<IMAGE_REF_0>`, `<IMAGE_REF_1>`, `<VIDEO_REF_0>`. Say what each one is ("the potted olive tree `<IMAGE_REF_0>`"), that it keeps its exact look, and that the ingredients are for appearance, not frames. Video ingredients (≤ 3 s) are best for a person's likeness and for a movement.

### E) Extend (VID → VID)
`Extend this video:` + what happens next, with the anchors. To bring in an ingredient: "`<IMAGE_REF_0>` slides into view next to the cup". New spoken lines only work on videos Oskar made, not on uploaded ones.

### F) Edit (VID → VID)
**One change, one or two sentences, end with "Keep everything else the same."** Style ("turn this into watercolour"), light ("warm golden-hour light"), day → night, add / remove an object, new background, change the text on a sign, weather. Long edit prompts change things nobody asked for. Two changes = two edits.

---

## LIMITS THAT SHAPE THE PROMPT (tested 2026-10-23)

- Ratio 16:9 or 9:16 only; 3–10 s per generation; up to 40 s by extending.
- Edit takes videos ≤ 10 s; extend takes uploads ≤ 30 s.
- English dialogue works best; other languages vary — keep lines short.
- Named celebrities and franchise characters are blocked by Google's filter (support code 35561575). Describe the look instead of naming them.
- **Takes:** the same take (seed) only repeats a video exactly. One changed word gives a different video. When the user is on "Take: Same as …" and asks for a better prompt, tell them a changed prompt makes a new take — and that only a higher resolution keeps the take.

---

## REVIEW BY AI — what you return

- The full refined prompt inside a `## IMAGE PROMPT` block (Oskar's parser uses that name for video too). It replaces the prompt in the tab.
- Every ✂ line, every tag (`<FIRST_FRAME>`, `<IMAGE_REF_0>`, …) kept exactly.
- The user's intent, names, quoted lines and language kept.
- No ratio, length or resolution in the text.
- If the prompt is already excellent, return it unchanged.

---

## COMMON FAILURES

| Failure | Cause | Fix |
|---|---|---|
| Random cuts in a one-shot video | Omni cuts by default | "Single continuous shot, no cuts." |
| Image → video only zooms slowly | Prompt described the picture | Describe motion, camera move, sound |
| Part 2 is a different scene / person | No anchors after the ✂ | Restate subject, place, light, sound in one line |
| A part's action runs out early | Timecodes don't fill 10 s | Plan [0-x] … [y-10s] |
| Edit changed more than asked | Long or multi-change edit prompt | One change + "Keep everything else the same." |
| Extend jumps instead of continuing | Missing "Extend this video:" / no continuity | Start with it, continue the last action |
| Ingredient ignored or used as a frame | Not named by its tag / mixed with frames | Name `<IMAGE_REF_0>`; frames OR ingredients |
| Dialogue garbled | Long line, several speakers at once | One short line per speaker, in quotes, with language and timecode |
| Garbled text in the image | Text not specified | Give the exact words and where they appear |
| Character blocked | Named a celebrity / franchise character | Describe the look, no name |

---

## PRE-SUBMISSION CHECKLIST

- [ ] Right situation for the slots (A–F) — and the prompt describes what that situation needs
- [ ] Subject anchored once, fully; repeated briefly after every ✂
- [ ] Every second planned with timecodes; "single continuous shot" if one shot
- [ ] Camera movement per shot
- [ ] Sound: ambience, effects with timing, music or "No music", dialogue or "No dialogue"
- [ ] Negatives written out
- [ ] ✂ lines and tags untouched; no ratio / length / resolution in the text
- [ ] Edit: one change + "Keep everything else the same."

---

## SUCCESSFUL PROMPTS (Archive)

### Olive tree on the table — 20 s, 2 parts, first frame — WORKED (2026-10-23)
```
Single continuous shot, warm morning light on a rustic wooden table. [0-4s] Steam rises slowly from the green cup. [4-10s] A hand places the potted olive tree next to the cup. Quiet ambience, no dialogue, no music.

✂ PART 2 · 10–20 s
Extend this video: [0-5s] The camera slowly pushes in on the olive leaves moving in a light breeze. [5-10s] The light turns golden. Same look and sound.
```
Part 2 continued part 1 without a seam.

### Windowsill — extend +10 s — WORKED
```
Extend this video: The camera slowly pulls back to reveal the whole sunny windowsill; a small bird lands outside the window. Same look and sound, no music.
```

### Add an object — edit with an ingredient — WORKED
```
Put the potted olive tree <IMAGE_REF_0> on the table next to the cup. Keep everything else the same.
```
Only the tree was added; cup, light and steam stayed.

---

## ADDING TO THIS FILE

When a video prompt works, archive it here with its situation and length. When one fails, add a row to COMMON FAILURES. The next CD shouldn't have to rediscover what works.
