# Design Context: starting from existing context

**This is the single most important thing about this skill.**

A good hi-fi design always grows out of existing design context. **Doing hi-fi from nothing is a last resort and will produce generic work**. So at the start of every design task, ask: is there anything to reference?

## What is design context

By priority from highest to lowest:

### 1. The user's design system / UI kit
The component library, color tokens, type spec, icon system the user's product already has. **The ideal case.**

### 2. The user's codebase
If the user gives you a code repo, it has live component implementations. Read those component files:
- `theme.ts` / `colors.ts` / `tokens.css` / `_variables.scss`
- Concrete components (Button.tsx, Card.tsx)
- Layout scaffold (App.tsx, MainLayout.tsx)
- Global stylesheets

**Read code, copy exact values**: hex codes, spacing scale, font stack, border radius. Don't redraw from memory.

### 3. The user's shipped product
If the user has a live product but hasn't given you code, use Playwright or have the user provide screenshots.

```bash
# Screenshot a public URL with Playwright
npx playwright screenshot https://example.com screenshot.png --viewport-size=1920,1080
```

This shows you the real visual vocabulary.

### 4. Brand guide / logo / existing assets
The user may have: logo files, brand color spec, marketing collateral, slide templates. All of this is context.

### 5. Competitive references
The user says "like website XX" — have them provide a URL or screenshot. **Don't** rely on the fuzzy impression in your training data.

### 6. Known design systems (fallback)
If none of the above exists, use a recognized design system as the base:
- Apple HIG
- Material Design 3
- Radix Colors (palette)
- shadcn/ui (components)
- Tailwind default palette

State explicitly to the user what you're using, so they know it's a starting point and not the final.

## The flow for getting context

### Step 1: ask the user

The required questions at task kickoff (from `workflow.md`):

```markdown
1. Do you have an existing design system / UI kit / component library? Where?
2. Is there a brand guide, color/font spec?
3. Can you give me screenshots or URLs for the existing product?
4. Is there a codebase I can read?
```

### Step 2: when the user says "no", help them find some

Don't just give up. Try:

```markdown
Let me look for clues:
- Does any of your previous projects have related design work?
- What colors/type does your company's marketing site use?
- What style is your product's logo? Can you share one?
- Any product you admire that I could reference?
```

### Step 3: read every piece of context you can find

If the user gives you a codebase path, read:
1. **List the file structure first**: find style/theme/component-related files
2. **Read theme/token files**: lift specific hex/px values
3. **Read 2–3 representative components**: see the visual vocabulary (hover state, shadow, border, padding patterns)
4. **Read the global stylesheet**: base reset, font loading
5. **If there's a Figma link/screenshot**: look at the image, but **trust the code more**

**Important**: **don't** glance once and design from impression. Lift 30+ specific values before you've actually internalized it.

### Step 4: vocalize the system you're going to use

After absorbing context, tell the user the system you're going to use:

```markdown
Based on your codebase and product screenshots, the design system I extracted:

**Color**
- Primary: #C27558 (from tokens.css)
- Background: #FDF9F0
- Text: #1A1A1A
- Muted: #6B6B6B

**Type**
- Display: Instrument Serif (from @font-face in global.css)
- Body: Geist Sans
- Mono: JetBrains Mono

**Spacing** (from your scale system)
- 4, 8, 12, 16, 24, 32, 48, 64

**Shadow pattern**
- `0 1px 2px rgba(0,0,0,0.04)` (subtle card)
- `0 10px 40px rgba(0,0,0,0.1)` (elevated modal)

**Border-radius**
- Small components 4px, cards 12px, buttons 8px

**Component vocabulary**
- Button: filled primary, outlined secondary, ghost tertiary, all 8px corners
- Card: white bg, subtle shadow, no border

I'll start from this system. Confirm OK?
```

After the user confirms, start.

## Designing from nothing (fallback when there's no context)

**Strong warning**: output quality drops significantly in this case. Tell the user this clearly.

```markdown
You don't have design context, so I can only work from generic intuition.
The output will be "looks OK but lacks distinctiveness".
Are you OK continuing, or want to provide some reference material first?
```

If the user insists, decide in this order:

### 1. Pick an aesthetic direction
Don't deliver generic output. Pick a definite direction:
- brutally minimal
- editorial / magazine
- brutalist / raw
- organic / natural
- luxury / refined
- playful / toy
- retro-futuristic
- soft / pastel

Tell the user which one you picked.

### 2. Pick a known design system as the skeleton
- Use Radix Colors for palette (https://www.radix-ui.com/colors)
- Use shadcn/ui for component vocabulary (https://ui.shadcn.com)
- Use Tailwind spacing scale (multiples of 4)

### 3. Pick a distinctive font pairing

Don't use Inter/Roboto. Suggested combos (free on Google Fonts):
- Instrument Serif + Geist Sans
- Cormorant Garamond + Inter Tight
- Bricolage Grotesque + Söhne (paid)
- Fraunces + Work Sans (note Fraunces is already AI-overused)
- JetBrains Mono + Geist Sans (technical feel)

### 4. Every key decision has reasoning

Don't pick silently. Write reasoning in HTML comments:

```html
<!--
Design decisions:
- Primary color: warm terracotta (oklch 0.65 0.18 25) — fits the "editorial" direction  
- Display: Instrument Serif for humanist, literary feel
- Body: Geist Sans for cleanness contrast
- No gradients — committed to minimal, no AI slop
- Spacing: 8px base, golden ratio friendly (8/13/21/34)
-->
```

## Import strategy (user gives you a codebase)

If the user says "import this codebase as reference":

### Small (<50 files)
Read all of it, internalize the context.

### Medium (50–500 files)
Focus on:
- `src/components/` or `components/`
- All styles/tokens/theme-related files
- 2–3 representative full-page components (Home.tsx, Dashboard.tsx)

### Large (>500 files)
Have the user point at the focus:
- "I want to do the settings page" → read existing settings-related code
- "I want to build a new feature" → read the overall shell + the closest reference
- Don't try to be exhaustive, be precise.

## Working with Figma / design files

If the user gives you a Figma link:

- **Don't** expect that you can directly "convert Figma to HTML" — that needs additional tooling
- Figma links are usually not publicly accessible
- Have the user: export as **screenshots** + tell you specific color/spacing values

If they only gave you Figma screenshots, tell the user:
- I can see the visuals, but I can't extract precise values
- Tell me the key numbers (hex, px), or export as code (Figma supports this)

## Final reminder

**The quality ceiling of a project's design is set by the quality of context you receive.**

Spending 10 minutes collecting context is worth more than spending 1 hour drawing hi-fi from nothing.

**When there's no context, prioritize asking the user for it, don't push through.**
