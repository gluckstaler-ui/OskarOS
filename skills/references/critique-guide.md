# Design Critique: Deep Dive Guide

> Detailed reference for Phase 7. Provides the scoring rubric, per-scenario emphasis, and a checklist of common problems.

---

## Scoring Rubric in Detail

### 1. Philosophy Alignment

| Score | Standard |
|-------|----------|
| 9-10 | Design perfectly embodies the core spirit of the chosen philosophy; every detail has a philosophical justification |
| 7-8 | Overall direction is right and the core traits land; a few details drift |
| 5-6 | Intent is visible, but execution mixes in other style elements — not pure |
| 3-4 | Surface-level imitation only; the philosophy's core was never understood |
| 1-2 | Essentially unrelated to the chosen philosophy |

**Review checklist**:
- Did you use the signature moves of that designer/studio?
- Do the colors, type, and layout match the philosophy's system?
- Are there self-contradicting elements? (e.g. picking Kenya Hara and stuffing the page with content)

### 2. Visual Hierarchy

| Score | Standard |
|-------|----------|
| 9-10 | The viewer's eye flows exactly where the designer intended; zero friction reading the information |
| 7-8 | Clear primary/secondary relationships, with 1-2 spots of muddy hierarchy |
| 5-6 | Title and body separate cleanly, but the middle tiers are messy |
| 3-4 | Information is flat; no clear visual entry point |
| 1-2 | Chaos — the viewer doesn't know where to look first |

**Review checklist**:
- Is the size contrast between title and body strong enough? (at least 2.5x)
- Do color/weight/size establish 3-4 clear tiers?
- Is the whitespace guiding the eye?
- "Squint test": squint your eyes — is the hierarchy still readable?

### 3. Craft Quality

| Score | Standard |
|-------|----------|
| 9-10 | Pixel-perfect; no flaws in alignment, spacing, or color |
| 7-8 | Refined overall, with 1-2 tiny alignment/spacing issues |
| 5-6 | Mostly aligned, but spacing isn't unified and color use isn't systematic |
| 3-4 | Obvious alignment errors, chaotic spacing, too many colors |
| 1-2 | Rough — looks like a draft |

**Review checklist**:
- Are you using a unified spacing system (e.g. an 8pt grid)?
- Is spacing between like elements consistent?
- Is the color count controlled? (usually no more than 3-4)
- Is the type family unified? (usually no more than 2)
- Are edge alignments precise?

### 4. Functionality

| Score | Standard |
|-------|----------|
| 9-10 | Every design element serves the goal; zero redundancy |
| 7-8 | Function-driven, with a small amount of trimmable decoration |
| 5-6 | Works, but obvious decorative elements pull attention |
| 3-4 | Form over function; the user has to work to find the information |
| 1-2 | Drowned in decoration; the design no longer communicates |

**Review checklist**:
- If you remove any single element, does the design get worse? (If not, remove it)
- Is the CTA / key information in the most prominent spot?
- Are there elements added "because they look nice"?
- Does the information density match the medium? (PPT shouldn't be dense; PDFs can be)

### 5. Originality

| Score | Standard |
|-------|----------|
| 9-10 | Refreshing; finds a unique expression within the philosophy |
| 7-8 | Has its own voice; not just a template |
| 5-6 | Competent but template-like |
| 3-4 | Heavy use of clichés (e.g. gradient orb = AI) |
| 1-2 | Pure template or stock-asset collage |

**Review checklist**:
- Did you avoid the common clichés? (see "Common Problems" below)
- Is there personal expression while still respecting the philosophy?
- Are there "unexpected but exactly right" design decisions?

---

## Per-scenario Emphasis

Different output types weight the dimensions differently:

| Scenario | Most important | Secondary | Can be relaxed |
|----------|---------------|-----------|----------------|
| WeChat cover / illustration | Originality, Visual Hierarchy | Philosophy Alignment | Functionality (no interaction in a single image) |
| Infographic | Functionality, Visual Hierarchy | Craft Quality | Originality (accuracy first) |
| PPT / Keynote | Visual Hierarchy, Functionality | Craft Quality | Originality (clarity first) |
| PDF / Whitepaper | Craft Quality, Functionality | Visual Hierarchy | Originality (professionalism first) |
| Landing page / website | Functionality, Visual Hierarchy | Originality | — (all dimensions matter) |
| App UI | Functionality, Craft Quality | Visual Hierarchy | Philosophy Alignment (usability first) |
| Xiaohongshu post image | Originality, Visual Hierarchy | Philosophy Alignment | Craft Quality (vibe first) |

---

## Top 10 Common Design Problems

### 1. AI / tech clichés
**Problem**: gradient orbs, falling-digit "Matrix" rain, blue circuit boards, robot faces.
**Why it's a problem**: viewers are visually exhausted by these — you can't be told apart from anyone else.
**Fix**: replace literal symbols with abstract metaphor (use the metaphor of "conversation" instead of a chat-bubble icon).

### 2. Insufficient size hierarchy
**Problem**: title and body are too close in size (<2.5x).
**Why it's a problem**: viewers can't find the key information fast.
**Fix**: title at least 3x the body (body 16px → title 48-64px).

### 3. Too many colors
**Problem**: 5+ colors with no hierarchy.
**Why it's a problem**: visually noisy, weak brand presence.
**Fix**: limit to 1 primary + 1 secondary + 1 accent + grayscale.

### 4. Inconsistent spacing
**Problem**: spacing is improvised, no system.
**Why it's a problem**: looks unprofessional, breaks visual rhythm.
**Fix**: build an 8pt grid (only use 8/16/24/32/48/64px).

### 5. Insufficient whitespace
**Problem**: every space is filled with content.
**Why it's a problem**: density causes reading fatigue and actually lowers communication.
**Fix**: whitespace ≥ 40% of total area (60%+ for minimal styles).

### 6. Too many fonts
**Problem**: 3+ typefaces.
**Why it's a problem**: visual noise, weakens unity.
**Fix**: max 2 typefaces (1 display + 1 body); use weight and size for variation.

### 7. Inconsistent alignment
**Problem**: some left, some center, some right.
**Why it's a problem**: destroys visual order.
**Fix**: pick one (recommend left) and use it everywhere.

### 8. Decoration over content
**Problem**: background patterns / gradients / shadows steal attention from the content.
**Why it's a problem**: backwards — viewers came for the information, not the decoration.
**Fix**: "If I delete this decoration, does the design get worse?" If not, delete it.

### 9. Cyber-neon overuse
**Problem**: deep blue background (#0D1117) + neon glow effects.
**Why it's a problem**: the skill's default taste forbids this — and it has become one of the biggest clichés. Users can override for their own brand.
**Fix**: pick a more distinctive palette (see the color systems of the 20 styles).

### 10. Information density mismatched to medium
**Problem**: a wall of text in a single PPT slide / 10 elements stuffed into a cover image.
**Why it's a problem**: optimal density depends on the medium.
**Fix**:
- PPT: one core idea per slide
- Cover image: one visual focus
- Infographic: layered presentation
- PDF: can be denser, but needs clear navigation

---

## Critique Output Template

```
## Design Critique Report

**Overall score**: X.X/10 [Excellent (8+) / Good (6-7.9) / Needs work (4-5.9) / Failing (<4)]

**Per-dimension scores**:
- Philosophy Alignment: X/10 [one-line note]
- Visual Hierarchy: X/10 [one-line note]
- Craft Quality: X/10 [one-line note]
- Functionality: X/10 [one-line note]
- Originality: X/10 [one-line note]

### Keep (what works)
- [Name what works specifically, in design language]

### Fix (what to change)
[Sorted by severity]

**1. [Problem name]** — Critical / Important / Polish
- Current: [describe what's there]
- Problem: [why this is a problem]
- Fix: [concrete action with values]

### Quick Wins
If you only have 5 minutes, do these three:
- [ ] [Highest-impact fix]
- [ ] [Second most important]
- [ ] [Third most important]
```

---

**Version**: v1.0
**Updated**: 2026-02-13
