/**
 * brand-deliverables.ts — WP-B2
 *
 * The catalog of brand deliverables the Branding tab can produce. Seven
 * entries for Phase 1 MVP (see docs/BRANDING-PLAN.md for the extended Phase
 * 3 catalog). Each entry carries:
 *   - Metadata (label, aspect ratio, thumbnail emoji, one-line description)
 *   - A pure `build(brand, imageRef?)` that assembles the full 4-block prompt
 *     (FORMAT / STRUCTURE / BRAND DATA / CONSTRAINTS) for Nano Banana.
 *
 * The shared `brandDataBlock()` from `lib/brand-data.ts` is embedded in every
 * deliverable so font/color/voice edits in one place update all outputs.
 */

import type { AspectRatio } from './types'
import { brandDataBlock, type BrandData } from './brand-data'

export type DeliverableId =
  | 'logo'
  | 'guideline'
  | 'business-card'
  | 'pitch-slide'
  | 'website-hero'
  | 'social-post'
  | 'social-story'

export interface DeliverableTemplate {
  id: DeliverableId
  label: string
  aspectRatio: AspectRatio
  thumbnailEmoji: string
  /** One-line description for the picker tile. */
  description: string
  /** Assemble the full Nano Banana prompt for this deliverable. */
  build: (brand: BrandData, imageRef?: string) => string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function imageReferenceBlock(imageRef?: string): string {
  if (imageRef && imageRef.trim()) {
    return `Reference image provided: ${imageRef.trim()}`
  }
  return 'No reference image — design from the brand data alone.'
}

function asMultiline(blocks: string[]): string {
  return blocks.filter(Boolean).map((b) => b.trim()).join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// The 7 deliverables
// ─────────────────────────────────────────────────────────────────────────────

const LOGO: DeliverableTemplate = {
  id: 'logo',
  label: 'Logo',
  aspectRatio: '1:1',
  thumbnailEmoji: '🔖',
  description: 'Complete logo system — primary, monochrome, icon, wordmark — on one sheet.',
  build: (b, imageRef) =>
    asMultiline([
      `# FORMAT
Deliverable: Complete logo system on one sheet
Aspect: 1:1 square
Register: Pentagram brand identity / Saul Bass modernism — clean, confident, reproducible at any scale`,

      `# STRUCTURE
Four-quadrant layout on a clean neutral background:
  - Top-left: PRIMARY LOGO (full lockup — icon + wordmark)
  - Top-right: MONOCHROME version of the primary logo (single color, for stamping/embossing)
  - Bottom-left: ICON / SYMBOL alone (app-icon ready, centered in its frame)
  - Bottom-right: WORDMARK alone (business name in ${b.fontHeading || '(primary font)'}, no icon)
Each quadrant labeled in small ${b.fontBody || '(secondary font)'} caps beneath.
14px gutter between quadrants. Unified diffused daylight across the sheet.`,

      brandDataBlock(b),

      `# CONSTRAINTS
- Do not render any reference image verbatim — create an original mark informed by the brand data.
- The icon must work at 16px (favicon scale) — no fine detail that would disappear.
- Use ONLY the declared colors. No gradients unless two of the declared colors are blended.
- No Lorem Ipsum. No invented taglines. Only the business name appears in the wordmark.
- Pure background (white or the declared secondary color), no photo textures.

${imageReferenceBlock(imageRef)}`,
    ]),
}

const GUIDELINE: DeliverableTemplate = {
  id: 'guideline',
  label: 'Brand Guideline',
  aspectRatio: '3:4',
  thumbnailEmoji: '📘',
  description: 'Bento sheet: title, seal, typography, colors, iconography, voice.',
  build: (b, imageRef) =>
    asMultiline([
      `# FORMAT
Deliverable: Brand Identity Guideline — single-page bento infographic
Aspect: 3:4 portrait
Register: Pentagram rebrand / IBM design standards — editorial, precise, high-end`,

      `# STRUCTURE
Non-overlapping bento grid. Named cells:
  - Title (top band, full-width) — business name in ${b.fontHeading || '(primary font)'} + one-line tagline
  - Visual Identity Seal v1.1 — the logo/mark (from reference image if provided)
  - Typography — Primary Font (${b.fontHeading || 'primary'}) sample + Secondary Font (${b.fontBody || 'secondary'}) sample, both with full alphabet + size scale
  - Color Palette — four swatches rendered with EXACT 6-digit hex codes + usage notes (primary surface, text, accent, etc.)
  - Iconography & Asset Suite — 6 minimal line icons in ${b.fontBody || 'secondary'} style, 2px stroke, rounded corners
  - Mood & Brand Voice — bold headline in ${b.fontHeading || 'primary'}, 3-4 sentences of brand voice in ${b.fontBody || 'secondary'}
14px gutter between cells. Unified diffused beauty light.`,

      brandDataBlock(b),

      `# CONSTRAINTS
- The reference image (if provided) IS the Visual Identity Seal — render it directly in that cell. Do not redraw.
- Render all hex codes as EXACT 6-digit strings. No color approximations.
- No Lorem Ipsum. Use the provided voice sample and mood adjectives verbatim.
- No cell may overlap another. Respect the 14px gutter.
- No fake logos, partner marks, or invented content beyond what's in the brand data.

${imageReferenceBlock(imageRef)}`,
    ]),
}

const BUSINESS_CARD: DeliverableTemplate = {
  id: 'business-card',
  label: 'Business Card',
  aspectRatio: '16:9',
  thumbnailEmoji: '💳',
  description: 'Front + back split layout at standard 85×54mm ratio.',
  build: (b, imageRef) =>
    asMultiline([
      `# FORMAT
Deliverable: Business Card — front and back, side by side
Aspect: 16:9 landscape
Register: Pentagram / minimalist — clean, confident, premium paper stock feel`,

      `# STRUCTURE
Two panels separated by a 14px white gutter:
  - LEFT (front): Business name in ${b.fontHeading || '(primary font)'} centered or offset. Logo/mark area. Accent color strip along one edge. Minimal.
  - RIGHT (back): Contact field placeholders in ${b.fontBody || '(secondary font)'} — "[NAME]", "[TITLE]", "[EMAIL]", "[PHONE]", "[WEBSITE]". Small QR code area bottom-right. Secondary color background.
Both sides share the same outer dimensions. Card edges subtly visible against a neutral surface.`,

      brandDataBlock(b),

      `# CONSTRAINTS
- Do not invent a logo not present in the reference image. If no reference provided, use a clean wordmark of the business name in ${b.fontHeading || '(primary font)'}.
- Use realistic field placeholders: "[NAME]", "[EMAIL]", etc. No Lorem Ipsum, no fake names.
- Render hex codes correctly if any are shown.
- Both sides must share the same palette. Don't drift between the two sides.

${imageReferenceBlock(imageRef)}`,
    ]),
}

const PITCH_SLIDE: DeliverableTemplate = {
  id: 'pitch-slide',
  label: 'Pitch Slide',
  aspectRatio: '16:9',
  thumbnailEmoji: '🎯',
  description: 'Investor-deck title slide — headline, tagline, CTA.',
  build: (b, imageRef) =>
    asMultiline([
      `# FORMAT
Deliverable: Pitch Deck Title Slide
Aspect: 16:9 landscape (Keynote/Powerpoint native)
Register: Stripe / Linear / Apple keynote — confident, minimal, premium`,

      `# STRUCTURE
Single-slide composition:
  - Headline (top-third or centered): business one-liner in large ${b.fontHeading || '(primary font)'}
  - Subtitle: voice-sample sentence in ${b.fontBody || '(secondary font)'}, muted color
  - CTA element: a single button/pill in the accent color with white text
  - Brand mark: small, bottom-left or top-right corner
  - Background: subtle gradient of primary + secondary colors OR brand image full-bleed with dark overlay
Generous negative space. No bullet points.`,

      brandDataBlock(b),

      `# CONSTRAINTS
- ONE headline only. No sub-bullets. No multi-point lists. This is a title slide.
- CTA text: "Learn More" or "Get Started" or use the brand's voice sample verbatim if short enough.
- No placeholder company logos ("YOUR LOGO HERE"). Either render the reference image as the mark, or a clean wordmark.
- No stock-photo people. Use the reference image OR an abstract gradient.

${imageReferenceBlock(imageRef)}`,
    ]),
}

const WEBSITE_HERO: DeliverableTemplate = {
  id: 'website-hero',
  label: 'Website Hero',
  aspectRatio: '16:9',
  thumbnailEmoji: '🖥',
  description: 'Full-width hero: nav, headline, CTA button, brand image.',
  build: (b, imageRef) =>
    asMultiline([
      `# FORMAT
Deliverable: Website hero section — desktop render, above-the-fold
Aspect: 16:9 landscape
Register: High-end web design — Stripe, Arc, Vercel — crisp, generous, loaded`,

      `# STRUCTURE
Top-to-bottom layout:
  - NAVIGATION BAR (top 8% of height): brand wordmark left, 3-4 nav links in ${b.fontBody || '(secondary font)'} right, subtle 1px underline or pill CTA
  - HERO CONTENT (middle 70%): headline in ${b.fontHeading || '(primary font)'} on the left third, subtitle in ${b.fontBody || '(secondary font)'} below, accent-colored CTA button
  - HERO IMAGE (right two-thirds OR full-bleed background): the reference image positioned with slight parallax framing
  - SUBTLE DETAIL (bottom 8%): a thin accent divider + scroll indicator`,

      brandDataBlock(b),

      `# CONSTRAINTS
- Nav links: use realistic, minimal link labels — "Home", "Menu", "Reservations", "Contact" — not "Link 1", "Link 2".
- ONE CTA button only. Accent color background, white text, rounded corners.
- Headline: business voice sample verbatim, NOT invented.
- No fake testimonials, star ratings, or press logos.
- Mobile/tablet variants NOT included — desktop only at this aspect.

${imageReferenceBlock(imageRef)}`,
    ]),
}

const SOCIAL_POST: DeliverableTemplate = {
  id: 'social-post',
  label: 'Social Post',
  aspectRatio: '1:1',
  thumbnailEmoji: '📷',
  description: 'Instagram feed post — bold headline, brand image.',
  build: (b, imageRef) =>
    asMultiline([
      `# FORMAT
Deliverable: Instagram feed post
Aspect: 1:1 square
Register: Bold, scroll-stopping editorial — designed to stop a thumb`,

      `# STRUCTURE
Either:
  (a) Full-bleed brand image with a bottom 40% dark gradient and headline in large ${b.fontHeading || '(primary font)'} overlay, OR
  (b) Split composition — left half bold color block with headline in ${b.fontHeading || '(primary font)'}, right half full-bleed brand image
Include a subtle brand mark (bottom-right corner, small).
Generous negative space. No text layered over busy image areas.`,

      brandDataBlock(b),

      `# CONSTRAINTS
- Headline under 8 words. Punchy. Use the brand voice sample or a natural variation.
- One CTA at most — "Book Now", "Reserve", "Open Menu". Or NO CTA (just brand presence).
- No hashtags in the image. No emojis in the image.
- No fake likes, comments, or social UI chrome — this is the post artwork only.

${imageReferenceBlock(imageRef)}`,
    ]),
}

const SOCIAL_STORY: DeliverableTemplate = {
  id: 'social-story',
  label: 'Social Story',
  aspectRatio: '9:16',
  thumbnailEmoji: '📱',
  description: 'Instagram story — vertical, full-bleed, headline + CTA.',
  build: (b, imageRef) =>
    asMultiline([
      `# FORMAT
Deliverable: Instagram story
Aspect: 9:16 vertical
Register: Vertical scroll-stopper, full immersion — phone-native`,

      `# STRUCTURE
Top-to-bottom:
  - Top 15%: headline in ${b.fontHeading || '(primary font)'}, bold, large, overlay on the image
  - Middle 60%: full-bleed brand image
  - Bottom 25%: voice sample sentence in ${b.fontBody || '(secondary font)'} + a prominent "Swipe Up" / tappable CTA in accent color
Safe zones: keep headline below the 10% mark (avoid phone status bar) and CTA above the 10% bottom mark (avoid IG UI overlay).`,

      brandDataBlock(b),

      `# CONSTRAINTS
- Absolutely no Lorem Ipsum.
- CTA: pill-shaped, accent color, centered horizontally.
- No invented engagement metrics (no fake reactions, viewer counts).
- No phone chrome in the render — just the story content.

${imageReferenceBlock(imageRef)}`,
    ]),
}

// ─────────────────────────────────────────────────────────────────────────────
// Public catalog
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND_DELIVERABLES: DeliverableTemplate[] = [
  LOGO,
  GUIDELINE,
  BUSINESS_CARD,
  PITCH_SLIDE,
  WEBSITE_HERO,
  SOCIAL_POST,
  SOCIAL_STORY,
]

export function findDeliverable(id: DeliverableId): DeliverableTemplate | undefined {
  return BRAND_DELIVERABLES.find((d) => d.id === id)
}
