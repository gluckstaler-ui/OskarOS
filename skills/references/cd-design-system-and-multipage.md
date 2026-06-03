# CD — Design System Template + Multi-Page Briefs

This file holds two reference blocks the Creative Director uses at point-of-use, not on cold-boot:

1. The full Design System fill-in template every vibe-{n}-{slug}.md must include in its `## Design System` block.
2. The multi-page brief structure (hub + sub-pages) for projects that need more than one landing page.

Both lived inside `agents/creative-director-agent.md` previously. They moved here on 2026-05-08 to keep the cold-boot agent file lean. The agent file references this file from Phase 4 (Design System) and from the Multi-Page handoff. CD reads this file when writing a vibe's design system block, or when a project needs multiple pages — not before.

---

## Design System Template (per vibe)

Every vibe MUST include a `## Design System` block in its `vibe-{n}-{slug}.md`. This is what WebDev uses to build the visual foundation — CSS variables, base component styles, shared elements. Without it, WebDev guesses, and guesses look generic.

This block follows the upcoming DESIGN.md standard (Google's emerging convention) so our design systems are forward-compatible with downstream tooling. Fill every field. Don't leave a section blank — if a vibe doesn't use shadows or animation, write that explicitly.

```
## Design System

### Atmosphere
{One sentence. The mood and posture the rest of the system serves. E.g.
"Warm, oracular, restrained. One bright accent against a deep neutral field."}

### Color Palette & Roles
- Primary: #XXXXXX — interactive elements, links, primary CTAs
- Surface: #XXXXXX — card fills, overlay backgrounds
- Background: #XXXXXX — page background
- Ink: #XXXXXX — body text, icons
- Accent: #XXXXXX — highlights, focus rings, secondary emphasis
- Success: #XXXXXX (optional — only if the vibe uses status states)
- Warning: #XXXXXX (optional)
- Error: #XXXXXX (optional)

### Typography
- Font Family: {Display font}, {Body font}, system-ui fallback
- H1: clamp(3rem, 8vw, 5.5rem) / 700 / 1.1
- H2: clamp(1.8rem, 4vw, 2.5rem) / 600 / 1.2
- H3: clamp(1.2rem, 2.5vw, 1.6rem) / 600 / 1.3
- Body: 1rem / 400 / 1.6
- Caption: 0.85rem / 500 / 1.4

### Spacing Scale
4, 8, 16, 24, 32, 48, 64, 96px. Use these. Don't introduce custom values.

### Component Stylings
- Button (Primary): bg primary, text on-primary, padding 16px 32px,
  border-radius 8px, hover lighten 10% + scale(1.02)
- Button (Secondary): transparent bg, text ink, border 1px solid ink,
  padding 16px 32px, border-radius 8px, hover bg surface
- Card: bg surface, border-radius 12px, padding 24px,
  shadow 0 2px 12px rgba(ink, 0.08)
- Input: border 1px solid ink/40%, padding 12px 16px, border-radius 8px,
  focus ring 2px primary

### Image Treatment
- Hero: full-bleed, object-fit cover, overlay rgba(ink, 0.4) for legibility
- Portrait: 3:4, border-radius 12px, no overlay
- Menu-bg / Section-bg: 16:9, soft vignette if behind text

### Header
- Sticky: {yes/no}
- Background: {color or treatment}
- Layout: {logo left/center, nav right}
- Scroll behavior: {shrink on scroll / change opacity / none}
- Mobile: hamburger at {breakpoint}px

### Footer
- Layout: {columns desktop / stacked mobile / etc.}
- Background: {color}
- Text: {color}

### Do's and Don'ts
- DO use Primary only for interactive elements (CTAs, links, focus)
- DO maintain 4.5:1 contrast on body text, 3:1 on large text
- DO use the spacing scale exclusively
- DON'T introduce colors outside this palette
- DON'T use drop shadows above 8px offset
- DON'T animate properties outside transform and opacity

### WebDev Prompt Guide
When building this vibe, before writing code:
1. Reference this Design System block
2. Validate color choices against WCAG AA (4.5:1 body, 3:1 large)
3. Apply the spacing scale exclusively
4. Cross-reference any sibling Animation Direction or Audio Direction blocks
```

**Rules:**
- The design system is PER VIBE. Each vibe gets its own. They should feel like siblings of the same voice, not clones.
- Atmosphere is the seed. Every other section serves it.
- Colors have semantic roles (what they're FOR), not just hex codes. The role names (Primary/Surface/Background/Ink/Accent) match the upcoming DESIGN.md standard — don't rename them per project. Editorial / publication-grade vibes that introduce richer role names (e.g. Paper / Ink / Rule / Mute) are allowed IN THIS BLOCK, but those creative role names DO NOT propagate to the `## Gallery Card` block at the top of the file — that block always uses the locked schema (Primary/Secondary/Accent/Text).
- If you already specified colors and fonts in the Meta Data section, the design system expands on those — it adds the usage rules, the component styles, and the tokens WebDev needs.
- The `## Gallery Card` block (top of vibe-{n}-{slug}.md) is the SEED — 7 fixed fields, parser-friendly, CURATED BY HAND. The Meta Data section is the NARRATIVE expansion. The Design System section is the FULL SPECIFICATION. Three audiences: Gallery UI, CD's narrative re-read, WebDev's build instructions. Don't collapse them into one block — each contract has different stability requirements.
- **Gallery Card color format** — 4 hexes with role names in parens, comma-separated: `#0D0D1A (Arcade Dark), #00E676 (Player 1 Green), #7C4DFF (Arcade Purple), #E0E0E0 (HUD Light)`. The role names come from this Design System block — pick the 4 hexes that best represent the vibe at thumbnail scale (typically: dominant background, primary surface/contrast, accent/CTA, body text/ink) and copy the role names verbatim from your Color Palette section.
- **Gallery Card font format** — slash-delimited, simple or complex:
  - 2-part: `Orbitron / Space Mono` (Display / Body — when the DS has only those two roles)
  - 3-part: `Space Mono 700 / Inter / Inter Text 400/500` (Display / Subtitle / Body — when the DS has a distinct intermediate layer)
  - Strip usage prose — `Space Mono wght 700 (for that algorithmic register)` becomes `Space Mono 700`. Keep weights only when load-bearing for the voice.
  - Mono is omitted from the card unless it IS the heading.
- The Do's and Don'ts list is load-bearing. It's the guardrails that prevent the vibe from drifting once built. WebDev checks against it. Sentinel Ti audits against it.

---

## Multi-Page Projects

Some businesses need more than a single landing page. When discovery reveals this, you write a multi-page brief.

### What You Write to vibe-{n}-{slug}.md (multi-page case)

**1. Site Structure** — the page tree

```
## Site Structure

### Hub Page: {filename}.html
{Description — this is the main landing page, the gateway}

### Sub-Pages:
- {page-name}.html — {what it covers}
- {page-name}.html — {what it covers}
- {page-name}.html — {what it covers}
```

The hub page is the main landing page. It links to sub-pages. Write it like any other vibe. Each sub-page gets its own section in the brief:

```
# PAGE: {Page Title}

**File:** {page-name}.html
**Parent:** {hub-filename}.html
**Shared from parent:** header, footer, design system

## Sections
{Section-by-section copy, same format as a vibe}

## Image Map
{Same format as vibe image maps}

## WebDev Build Instructions
{Specific layout instructions for complex pages — optional but recommended}
```

**2. Design System** — shared across ALL pages

The design system (see template above) becomes the shared visual language for the entire site. Hub page and all sub-pages use the SAME design system. Same colors, same typography, same buttons, same header, same footer.

**Rules:**
- Sub-pages inherit the design system from the hub. Don't redefine colors/fonts/buttons — reference the hub's design system.
- Cross-page links use relative paths: `href="projekt-sursee.html"` not absolute URLs.
- Shared components (header, footer) must be IDENTICAL across all pages. Tell WebDev explicitly: "Copy header from {hub-filename}.html."
- If a sub-page needs unique layout (e.g., a project gallery with lightbox), describe it in `## WebDev Build Instructions`.
