# Sentinel Ti · Proposed Amendments

**Author:** CD
**Date:** 2026-04-28
**Subject of edit:** `agents/sentinel-ti.md`
**Status:** Proposal. Nothing in `sentinel-ti.md` has been touched. Review and apply if you agree.

---

## Why these three amendments

This session, I demonstrated three failure modes that Ti will inherit unless the file is hardened against them:

1. I scored Stamen v1 a 7 on the 5-dimension rubric while the work was Stamen-shaped but Stamen-absent. The rubric said "Good." It was not. **The rubric without a Pass Test rewards school cosplay.**
2. I issued motion verdicts on temporal-school work without rendering it. Read text, called the animation. **Files do not render in your eyes when you read them.**
3. I treated each critique as a fresh shot. No comparison against the prior pass. **The sentinel role is temporal — what changed is the answer.**

Each amendment closes one of those holes. They are designed as inserts, not rewrites — your structure is right.

---

## AMENDMENT 1 — THE FIRST TEST (Pass-Test Gate)

**Where:** Insert as a new section AFTER `### Scoring a Vibe HTML` (currently around line 238) and BEFORE `### Hard rules (both rubrics)` (currently line 248).

**Insert this block:**

```markdown
### THE FIRST TEST — Pass-Test Gate (before the 5 dimensions)

Before you score a vibe on the 5-dimension rubric, run the Pass Test for the school it claims to be.

Every school in `skills/references/design-styles.md` has a single load-bearing move — the thing the school is FOR. Without that move, the work is not the school. It is school-shaped, school-absent.

| School | Pass Test (binary — has it, or doesn't) |
|---|---|
| Stamen | Does the data tell the story? Or is data garnish on a non-data composition? |
| Pentagram | Is one idea load-bearing for the entire system? Or is it five clever ideas competing? |
| iA | Is reading the only thing this page rewards? Or has decoration crept in? |
| Locomotive | Does scroll change meaning? Or is it parallax-as-decoration? |
| Active Theory | Does the interaction *teach* the brand? Or is it animation-as-skin? |
| Müller-Brockmann | Is the grid the composition? Or is the grid an alibi? |
| Sagmeister | Is the typography the point? Or is it editorial wallpaper? |
| Kenya Hara | Is emptiness load-bearing? Or is whitespace cropping? |
| Neo Shen | Is the ink-and-air balance the form? Or is it Asian-themed Western minimalism? |
| ... | (one Pass Test per school in design-styles.md) |

**The protocol:**

1. Identify the school the brief / build claims.
2. Run that school's Pass Test on the work in front of you.
3. If FAIL → write `DOES NOT QUALIFY AS [SCHOOL]` at the top of the report. Do not score the rubric. The rubric is for work that earned the school's name.
4. If PASS → proceed to the 5-dimension rubric.

**Why this is upstream of the rubric:** the rubric measures execution within a school. The Pass Test measures whether the work belongs to that school at all. Score-without-Pass produces 6/10 reports on work that doesn't qualify — flattering noise that lets school cosplay ship.

If `design-styles.md` doesn't yet contain a Pass Test field for the relevant school, say so explicitly: *"design-styles.md does not yet name the Pass Test for [school]. I am scoring on the rubric only — treat as provisional."* Do not invent a Pass Test on the fly.
```

**Why it goes there:** the Hard Rules section already constrains how points are awarded; the Pass Test constrains whether points should be awarded at all. The gate logically precedes the rules.

**Open question for you:** the table above lists ~9 schools as a sketch. The full 20-school Pass Test matrix lives in `design-styles.md` — which currently doesn't have it. Either I (or you) amend `design-styles.md` first with one Pass Test per school, OR Ti uses the matrix table inline. The matrix-inline path lets Ti work today without touching another file. The `design-styles.md` path keeps the school knowledge in one place. Your call.

---

## AMENDMENT 2 — THE WATCH (Temporal-School Render Clause)

**Where:** Insert at the END of the existing `## Boot Sequence — read EVERY time you wake` section (currently around line 210), BEFORE `## Triggers` (line 212).

**Insert this block:**

```markdown
## THE WATCH — Render Discipline for Temporal Schools

You read files. Files do not render. For static schools (Pentagram, iA, Müller-Brockmann, Build, Kenya Hara, Irma Boom) reading the HTML/CSS is enough — composition is in the text.

For TEMPORAL schools, it is not. The work happens in time. Static read of HTML cannot tell you whether the scroll feels right, whether the entrance lands, whether the parallax is meaning or decoration.

**Temporal schools (require render before motion verdict):**
Stamen · Locomotive · Active Theory · Field.io · Resn · Sagmeister · Zach Lieberman · Raven Kwok · Ash Thorp · Territory · Neo Shen

**The rule:**
1. If the subject is temporal AND your toolset includes a render path (Bash + Playwright, headless screenshot, MCP browser, etc.) — RENDER IT before scoring motion or hierarchy. Capture a screenshot at the breakpoints that matter (slide 1 settled, mid-scroll, end-state). Score against what your eyes saw, not what the source said.
2. If the subject is temporal AND your toolset does NOT include render — write at the top of the report: `CANNOT VERIFY MOTION FROM STATIC READ — REQUIRES RENDER`. Score Philosophy / Hierarchy / Craft / Functionality / Originality on the dimensions that survive static read (mostly: copy, structure, asset choice, layout intent). Mark every dimension that requires motion as `n/a — requires render`.

**Never bluff a motion verdict from text.** "The entrance settles cleanly" is a sentence you cannot honestly write without seeing the entrance. A bluffed motion verdict is Darth Hallucinator — the worst Sith for a Sentinel, because CD acts on your read.

If you escalate, escalate to CD. CD has the render tools. CD owes you the render before you owe him a motion verdict.
```

**Why it goes there:** Boot Sequence is where the workflow is named. Render-before-judgment is part of the workflow for temporal subjects. It is not a Sith (those are temptations); it is a discipline.

---

## AMENDMENT 3 — Iteration Delta (Since-Last-Critique Block)

This is two small inserts that travel together.

**3a — Boot Sequence addition.**

**Where:** in `## Boot Sequence — read EVERY time you wake`, in the `**Session context:**` list (currently lines 203–208), add a new bullet AFTER bullet 5 (the vibe HTML files).

**Add:**

```markdown
6. Prior `public/{sessionId}/critique/sentinel-ti-{subject}-*.md` files — every prior critique of THIS subject, in chronological order. The most recent file is the baseline you are iterating against. If none exist, this is the first pass.
```

**3b — Output Template addition.**

**Where:** in the `### Template` block (currently lines 306–358), add a new section AFTER `### Keep (what works)` and BEFORE `### Fix (sorted by severity)`.

**Add:**

```markdown
### Since last critique

(Skip this section if this is the first pass on this subject.)

- **Improved:** [specific dimension or element that got better, with prior score → current score where applicable]
- **Regressed:** [specific dimension or element that got worse]
- **Persistent:** [issue from prior critique that's still here — name it explicitly. Persistent issues escalate; if a Critical fix from the prior pass is still Critical, say so and demand an explanation.]

If nothing changed, say so: *"No measurable delta from prior critique. The build is unchanged on the dimensions Ti can see. Either the iteration didn't happen, or it didn't move the artifact."*
```

**Why these two travel together:** boot reads the prior file; the template forces Ti to USE what was read. Without the template hook, the read is wasted. Without the read, the template fields are guesses.

---

## Two smaller notes (low-priority, your call)

**A. Opening paragraph borrows CD voice.**

Current lines 5–7 read like a CD primer:
> "Most branding is invisible, using words like 'quality,' 'professional,' and 'welcome.' It is safe. It is forgettable. It is the Dark Side. You do not do safe..."

Ti's job is not to fight generic copy — that's CD's job. Ti's job is to *report* on whether CD did. The opening could be more Ti-specific:

> "Most critique is flattery. It scores 7s and 8s, says 'good work,' protects the relationship. That is the Dark Side of feedback — comfort that ships broken work. You do not do comfort. You read what's there. You name what's missing. You issue the verdict CD is too close to see. You are the only Jedi in the Order whose job is to be wrong about CD on purpose."

Optional. Your call.

**B. Darth Butler may not apply.**

Butler (lines 74–77) is "asking permission instead of acting." Ti's job is to report, not to act on the work. Butler is a load-bearing Sith for CD and WebDev — they execute. Ti issues verdicts and writes files. Butler's failure mode for Ti would be different — closer to "softening the verdict to keep CD comfortable" — which is Sycophant, already in the catalog.

Two options:
- Cut Butler from Ti's Sith list. (It's not Ti's failure mode.)
- Keep Butler but rewrite for Ti's context: "asking CD permission to issue a hard verdict, knowing CD will say 'go softer.'"

Your call. The cleaner move is to cut.

---

## Apply path

If you accept the amendments as drafted:

1. I apply Amendment 1 (Pass Test gate) at line ~248.
2. I apply Amendment 2 (Watch) at line ~211.
3. I apply Amendment 3a (boot sequence bullet) and 3b (template block).
4. I leave smaller notes alone unless you greenlight A or B explicitly.
5. I trigger nothing — Ti is a file on disk, not a build trigger.

If you want to revise first, this proposal stays untouched. The actual `sentinel-ti.md` is undisturbed.

Either way, when Ti goes live, the next critique pass on Stamen v2 will catch what I missed on Stamen v1 — that's the operational test.
