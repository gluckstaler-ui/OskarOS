# Design Philosophy Showcases — Sample Asset Index

> 8 scenarios × 3 styles = 24 prebuilt design samples
> Used in Phase 3 to recommend a design direction by showing "what this style actually looks like"

## Style Reference

| Code | School | Style name | Visual character |
|------|--------|-----------|------------------|
| **Pentagram** | Information-architect school | Pentagram / Michael Bierut | Black/white restrained, Swiss grid, strong type hierarchy, #E63946 red accent |
| **Build** | Minimalist school | Build Studio | Luxury-grade whitespace (70%+), subtle weights (200-600), #D4A574 warm gold, refined |
| **Takram** | Eastern-philosophy school | Takram | Soft-tech feel, natural colors (rice / gray / green), rounded corners, charts as art |

## Scenario Lookup Table

### Content design scenarios

| # | Scenario | Spec | Pentagram | Build | Takram |
|---|----------|------|-----------|-------|--------|
| 1 | WeChat cover | 1200×510 | `cover/cover-pentagram` | `cover/cover-build` | `cover/cover-takram` |
| 2 | PPT data slide | 1920×1080 | `ppt/ppt-pentagram` | `ppt/ppt-build` | `ppt/ppt-takram` |
| 3 | Vertical infographic | 1080×1920 | `infographic/infographic-pentagram` | `infographic/infographic-build` | `infographic/infographic-takram` |

### Website design scenarios

| # | Scenario | Spec | Pentagram | Build | Takram |
|---|----------|------|-----------|-------|--------|
| 4 | Personal homepage | 1440×900 | `website-homepage/homepage-pentagram` | `website-homepage/homepage-build` | `website-homepage/homepage-takram` |
| 5 | AI directory site | 1440×900 | `website-ai-nav/ainav-pentagram` | `website-ai-nav/ainav-build` | `website-ai-nav/ainav-takram` |
| 6 | AI writing tool | 1440×900 | `website-ai-writing/aiwriting-pentagram` | `website-ai-writing/aiwriting-build` | `website-ai-writing/aiwriting-takram` |
| 7 | SaaS landing page | 1440×900 | `website-saas/saas-pentagram` | `website-saas/saas-build` | `website-saas/saas-takram` |
| 8 | Developer docs | 1440×900 | `website-devdocs/devdocs-pentagram` | `website-devdocs/devdocs-build` | `website-devdocs/devdocs-takram` |

> Each entry has both `.html` (source) and `.png` (screenshot)

## Usage

### Citing during Phase 3 recommendations
Once you've recommended a design direction, you can show the matching scenario screenshot:
```
"Here's what Pentagram looks like as a WeChat cover → [show cover/cover-pentagram.png]"
"Takram for a PPT data slide feels like this → [show ppt/ppt-takram.png]"
```

### Scenario-matching priority
1. The user's scenario has an exact match → show the matching scenario directly
2. No exact match but close type → show the nearest scenario (e.g. "product website" → show SaaS landing)
3. Total mismatch → skip the prebuilt sample, go straight to Phase 3.5 live generation

### Side-by-side comparison
The 3 styles for the same scenario work well side-by-side, helping the user compare directly:
- "Same WeChat cover, three styles"
- Display order: Pentagram (rational, restrained) → Build (luxury minimal) → Takram (soft and warm)

## Content Detail

### WeChat cover (cover/)
- Content: Claude Code Agent workflow — 8 parallel agent architecture
- Pentagram: huge red "8" + Swiss grid lines + data bars
- Build: ultra-thin "Agent" floating in 70% whitespace + warm-gold hairline
- Takram: 8-node radial flow chart as artwork + rice background

### PPT data slide (ppt/)
- Content: GLM-4.7 open-source model coding breakthrough (AIME 95.7 / SWE-bench 73.8% / τ²-Bench 87.4)
- Pentagram: 260px "95.7" anchor + red/gray/light-gray comparison bar chart
- Build: three groups of 120px ultra-thin numerals floating + warm-gold gradient comparison bars
- Takram: SVG radar chart + three-color overlay + rounded data cards

### Vertical infographic (infographic/)
- Content: AI memory system CLAUDE.md optimized from 93KB to 22KB
- Pentagram: huge "93→22" numerals + numbered blocks + CSS data bars
- Build: extreme whitespace + soft-shadow cards + warm-gold connectors
- Takram: SVG ring chart + organic curved flow + frosted-glass cards

### Personal homepage (website-homepage/)
- Content: Indie developer Alex Chen portfolio
- Pentagram: 112px name + Swiss grid columns + numbered bands
- Build: glass-morph nav + floating stat cards + ultra-thin weights
- Takram: paper texture + small round avatar + hairline dividers + asymmetric layout

### AI directory site (website-ai-nav/)
- Content: AI Compass — directory of 500+ AI tools
- Pentagram: square search box + numbered tool list + uppercase category tags
- Build: rounded search box + refined white tool cards + pill tags
- Takram: organic offset card layout + soft category tags + chart-style connectors

### AI writing tool (website-ai-writing/)
- Content: Inkwell — AI writing assistant
- Pentagram: 86px headline + line-drawn editor mock + grid feature columns
- Build: floating editor card + warm-gold CTA + luxurious writing experience
- Takram: poetic serif headline + organic editor + flow chart

### SaaS landing page (website-saas/)
- Content: Meridian — business intelligence analytics platform
- Pentagram: black/white split + structured dashboard + 140px "3x" anchor
- Build: floating dashboard cards + SVG area chart + warm-gold gradient
- Takram: rounded bar chart + flow nodes + soft earth tones

### Developer docs (website-devdocs/)
- Content: Nexus API — unified AI model gateway
- Pentagram: left-side nav + square code blocks + red string highlights
- Build: centered floating code card + soft shadow + warm-gold icons
- Takram: rice-toned code block + flow connectors + dashed feature cards

## File Stats

- HTML source files: 24
- PNG screenshots: 24
- Total assets: 48 files

---

**Version**: v1.0
**Created**: 2026-02-13
**For**: design-philosophy skill, Phase 3 recommendation step
