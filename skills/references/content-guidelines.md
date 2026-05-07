# Content Guidelines: Anti-AI-slop, content rules, scale specs

The traps designers fall into most often when working with AI. This is a "what NOT to do" list, more important than the "what to do" list — because AI slop is the default, and if you don't actively avoid it, it happens.

## AI Slop Complete Blacklist

### Visual traps

**❌ Aggressive gradient backgrounds**
- Purple → pink → blue full-screen gradient (the signature taste of AI-generated webpages)
- Rainbow gradients in any direction
- Mesh gradient covering the background
- ✅ If you must use gradient: subtle, monochromatic, intentional accents (e.g. button hover)

**❌ Rounded card + left-border accent color**
```css
/* The signature of an AI-flavor card */
.card {
  border-radius: 12px;
  border-left: 4px solid #3b82f6;
  padding: 16px;
}
```
This kind of card runs rampant in AI-generated dashboards. Want emphasis? Use more designerly methods: background contrast, weight/size contrast, plain dividers, or just no card at all.

**❌ Emoji decoration**
Unless emoji is part of the brand itself (e.g. Notion, Slack), don't put emoji in your UI. **Especially not**:
- 🚀 ⚡️ ✨ 🎯 💡 in front of titles
- ✅ in feature lists
- → in CTA buttons (a standalone arrow is OK, an emoji arrow is not)

If you need icons, use a real icon library (Lucide / Heroicons / Phosphor), or a placeholder.

**❌ SVG-drawn imagery**
Don't try to draw with SVG: people, scenes, devices, objects, abstract art. AI-drawn SVG imagery is recognizable as AI at a glance — childish and cheap. **A gray rectangle with the label "illustration slot 1200×800" beats a clumsy SVG hero illustration 100x.**

The only places SVG is acceptable:
- True icons (16×16 to 32×32 scale)
- Geometric shapes as decorative elements
- Charts in data viz

**❌ Excessive iconography**
Not every title / feature / section needs an icon. Overusing icons makes the interface look like a toy. Less is more.

**❌ "Data slop"**
Made-up decorative stats:
- "10,000+ happy customers" (you don't even know if this is true)
- "99.9% uptime" (don't write it without real data)
- Decorative "metric cards" composed of icon + number + word
- Mock tables flashy with fake data

If there's no real data, leave a placeholder or ask the user.

**❌ "Quote slop"**
Made-up user testimonials, decorative celebrity quotes. Leave a placeholder and ask the user for real quotes.

### Font traps

**❌ Avoid these overused fonts**:
- Inter (the AI-generated webpage default)
- Roboto
- Arial / Helvetica
- Pure system font stack
- Fraunces (AI discovered this one and now overuses it)
- Space Grotesk (AI's recent favorite)

**✅ Pair a distinctive display + body**. Inspiration directions:
- Serif display + sans body (editorial feel)
- Mono display + sans body (technical feel)
- Heavy display + light body (contrast)
- Variable font for hero weight animation

Font resources:
- The lesser-known Google Fonts options (Instrument Serif, Cormorant, Bricolage Grotesque, JetBrains Mono)
- Open-source font sites (Fraunces' siblings, Adobe Fonts)
- Don't invent font names out of thin air

### Color traps

**❌ Inventing colors out of thin air**
Don't design an entire unfamiliar color system from scratch. It's usually inharmonious.

**✅ Strategy**:
1. Have a brand color → use the brand color, fill missing color tokens via oklch interpolation
2. No brand color but you have references → eyedrop colors from reference product screenshots
3. From scratch → pick a known color system (Radix Colors / Tailwind default palette / Anthropic brand), don't tune one yourself

**Defining colors in oklch** is the most modern approach:
```css
:root {
  --primary: oklch(0.65 0.18 25);      /* warm terracotta */
  --primary-light: oklch(0.85 0.08 25); /* lighter shade, same hue */
  --primary-dark: oklch(0.45 0.20 25);  /* darker shade, same hue */
}
```
oklch keeps hue from drifting when you adjust lightness, beats hsl.

**❌ Casually inverting colors for dark mode**
Dark mode is not a simple invert. Good dark mode requires re-tuning saturation, contrast, and accent colors. If you don't want to do dark mode, don't.

### Layout traps

**❌ Bento grid overuse**
Every AI-generated landing page wants a bento grid. Unless your information structure genuinely fits bento, use another layout.

**❌ Big hero + 3-column features + testimonials + CTA**
This landing-page template is worn out. If you want to innovate, actually innovate.

**❌ Every card in a card grid looking the same**
Asymmetric, varied-size cards, some with images and some text-only, some spanning columns — that's what real designers make.

## Content rules

### 1. Don't add filler content

Every element must earn its place. Empty space is a design problem solved with **composition** (contrast, rhythm, whitespace), **not** by filling with content.

**Filler-test questions**:
- If you remove this content, does the design get worse? If "no", remove it.
- What real problem does this element solve? If it's "to keep the page from feeling empty", delete.
- Does this stat / quote / feature have real data behind it? If not, don't make it up.

"One thousand no's for every yes."

### 2. Ask before adding material

Think adding another paragraph / page / section will be better? Ask the user first, don't add unilaterally.

Why:
- The user knows their audience better than you
- Adding content has costs the user may not want to pay
- Adding content unilaterally violates the "junior designer reporting to manager" relationship

### 3. Create a system up front

After exploring the design context, **state out loud the system you're going to use**, and let the user confirm:

```markdown
My design system:
- Color: #1A1A1A primary + #F0EEE6 background + #D97757 accent (from your brand)
- Type: Instrument Serif for display + Geist Sans for body
- Rhythm: section title uses full-bleed colored bg + white text; regular section is white bg
- Imagery: hero uses a full-bleed photo, feature section uses placeholders waiting on you
- At most 2 background colors, to avoid clutter

Confirm this direction and I'll start.
```

After the user confirms, then start. This check-in avoids "halfway done and the direction is wrong".

## Scale specs

### Slide deck (1920×1080)

- Body min **24px**, ideal 28–36px
- Titles 60–120px
- Section title 80–160px
- Hero headline can use 180–240px monsters
- Never use <24px text in slides

### Print documents

- Body min **10pt** (≈13.3px), ideal 11–12pt
- Titles 18–36pt
- Caption 8–9pt

### Web and mobile

- Body min **14px** (16px is friendlier for older readers)
- Mobile body **16px** (avoids iOS auto-zoom)
- Hit target (clickable element) min **44×44px**
- Line-height 1.5–1.7 (Chinese 1.7–1.8)

### Contrast

- Body vs. background **at least 4.5:1** (WCAG AA)
- Large text vs. background **at least 3:1**
- Check with Chrome DevTools' accessibility tooling

## CSS power tools

**Modern CSS features** are a designer's best friend, use them boldly:

### Typography

```css
/* Make headline wrapping more natural — no lonely orphan word on the last line */
h1, h2, h3 { text-wrap: balance; }

/* Body wrapping, avoid widows and orphans */
p { text-wrap: pretty; }

/* Killer for Chinese typography: punctuation kerning, line-start/end control */
p { 
  text-spacing-trim: space-all;
  hanging-punctuation: first;
}
```

### Layout

```css
/* CSS Grid + named areas = readability through the roof */
.layout {
  display: grid;
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";
  grid-template-columns: 240px 1fr;
  grid-template-rows: auto 1fr auto;
}

/* Subgrid aligns card contents */
.card { display: grid; grid-template-rows: subgrid; }
```

### Visual effects

```css
/* Designerly scrollbars */
* { scrollbar-width: thin; scrollbar-color: #666 transparent; }

/* Glassmorphism (use sparingly) */
.glass {
  backdrop-filter: blur(20px) saturate(150%);
  background: color-mix(in oklch, white 70%, transparent);
}

/* View transitions API for silky page transitions */
@view-transition { navigation: auto; }
```

### Interaction

```css
/* :has() selector makes conditional styles easy */
.card:has(img) { padding-top: 0; } /* cards with images get no top padding */

/* container queries make components truly responsive */
@container (min-width: 500px) { ... }

/* The new color-mix function */
.button:hover {
  background: color-mix(in oklch, var(--primary) 85%, black);
}
```

## Decision quick-reference: when in doubt

- Want to add a gradient? → probably don't
- Want to add an emoji? → don't
- Want to give a card rounded corners + a left-border accent? → don't, find another way
- Want to draw a hero illustration with SVG? → don't, use a placeholder
- Want to add a decorative quote? → ask the user if they have a real quote first
- Want a row of icon features? → ask if icons are needed; probably not
- Going to use Inter? → swap for something with more character
- Going to use a purple gradient? → swap for a palette with reasoning

**When you feel "adding this would look nicer" — that is usually the AI-slop signal**. Make the simplest version first, only add when the user asks.
