/**
 * image-presets.ts — WP-2A: Presets Data Structure
 *
 * Pure data. No React, no UI, no side effects.
 * 70 presets across 4 modes (View has none), organized by category.
 *
 * Preset types by mode:
 *   - Generate: static prompt string (.prompt)
 *   - Edit:     function taking image description (.editFn)
 *   - Compose:  function taking ComposeData (.composeFn)
 *   - Layout:   function taking LayoutData (.layoutFn)
 *
 * Grid metadata on Layout presets drives WP-5's bento engine.
 */

import type { AdvancedTab } from '@/components/AdvancedMode'
import type { BrandData } from '@/lib/brand-data'
import { brandDataBlock } from '@/lib/brand-data'

// ============================================================================
// Types
// ============================================================================

/** Data passed to compose preset functions. */
export interface ComposeData {
  /** Scene image filename or '[scene]' placeholder. */
  sc: string
  /** Array of subject filenames or ['[subjects]']. */
  su: string[]
  /** Comma-joined subject list for inline use. */
  sl: string
  /** All images comma-joined (scene + subjects). */
  ing: string
  /** Scene image's Nano Banana description (empty if no scene). */
  sceneDesc: string
}

/** Data passed to layout preset functions. */
export interface LayoutData {
  /** Ordered slot contents: filename or '[empty]'. */
  s: string[]
}

/** Grid config for Layout presets — drives WP-5 bento engine. */
export interface GridConfig {
  columns: string
  rows: string
  cells: CellConfig[]
  minSlots: number
  maxSlots: number
  allowsExpansion: boolean
}

export interface CellConfig {
  role: 'hero' | 'cell'
  slotIndex: number
  gridColumn?: string
  gridRow?: string
}

// --- Preset variants ---

interface BasePreset {
  label: string
}

export interface GeneratePreset extends BasePreset {
  kind: 'generate'
  prompt: string
}

export interface EditPreset extends BasePreset {
  kind: 'edit'
  editFn: (description: string) => string
}

export interface ComposePreset extends BasePreset {
  kind: 'compose'
  composeFn: (data: ComposeData) => string
}

export interface LayoutPreset extends BasePreset {
  kind: 'layout'
  layoutFn: (data: LayoutData) => string
  grid: GridConfig
}

/**
 * Brand presets take the active vibe's BrandData (fonts, colors, voice,
 * audience, business name, mood) AND the selected image's description.
 * Unlike Generate presets, Brand presets bake real brand tokens into the
 * prompt — no placeholder brackets, no fill-in-the-blank. The Brand tab is
 * stateful: entering it locks in a brand identity, and every generation
 * that follows shares the same tokens.
 */
export interface BrandPreset extends BasePreset {
  kind: 'brand'
  brandFn: (brandData: BrandData, selectedDescription: string) => string
  /**
   * True if this preset needs a source image to be useful (e.g. Business
   * Card uses the selected image as the logomark). Logo can run standalone.
   * The Brand tab UI uses this to hint which preset to pick first.
   */
  needsImage?: boolean
}

export type Preset = GeneratePreset | EditPreset | ComposePreset | LayoutPreset | BrandPreset

export interface PresetCategory {
  label: string
  presets: Preset[]
}

// ============================================================================
// Generate Presets (15)
// ============================================================================

const GENERATE_FUNCTIONAL: PresetCategory = {
  label: 'Functional',
  presets: [
    {
      kind: 'generate',
      label: 'Hero Banner',
      prompt: 'Generate a cinematic hero banner image for a website. Wide format, dramatic lighting, atmospheric depth. Subtle space for text overlay on the left third. Warm, inviting, premium feel.',
    },
    {
      kind: 'generate',
      label: 'Product Shot',
      prompt: 'Generate a flawless commercial product shot on a minimal matte concrete pedestal. Soft, diffused professional studio light from front-right creating subtle defined shadows. Sharp focus on texture. 8K, photorealistic, clean composition.',
    },
    {
      kind: 'generate',
      label: 'Service Icons',
      prompt: 'Generate a set of 8 cohesive minimal line icons on a clean dark background. Consistent 2px stroke weight, rounded corners, modern style. Suitable for a website services section.',
    },
    {
      kind: 'generate',
      label: 'Background Pattern',
      prompt: 'Generate a seamless tileable background pattern. Subtle and sophisticated, suitable for a website section background. Low contrast, muted warm tones. Organic or geometric.',
    },
    {
      kind: 'generate',
      label: 'Team Portrait',
      prompt: 'Generate a professional team portrait in a modern workspace setting. Natural window light, shallow depth of field. Warm, approachable, not corporate-stiff. 3-5 people.',
    },
    {
      kind: 'generate',
      label: 'Menu Card',
      prompt: 'Generate an elegant menu or price card design. Clean typography, organized sections, decorative dividers. Warm tones, premium feel. Suitable for food & beverage or services.',
    },
    {
      kind: 'generate',
      label: 'Testimonial Card',
      prompt: 'Design a testimonial quote card with subtle textured background, large decorative quotation marks, circular avatar placeholder, and attribution text area. Warm and trustworthy.',
    },
    {
      kind: 'generate',
      label: 'Social Media',
      prompt: 'Generate an eye-catching social media post graphic. Bold typography, vibrant brand colors, strong visual hierarchy. Optimized for Instagram square format.',
    },
    {
      kind: 'generate',
      label: 'Location Illustration',
      prompt: 'Generate a stylized illustrated map showing a business location. Warm color palette, landmark callouts, charming hand-drawn feel. Suitable for a website location section.',
    },
    {
      kind: 'generate',
      label: 'Infographic',
      prompt: 'Create an illustrated infographic. Dark UI with teal and gold accents. Include diagrams, flowcharts, key terminology, and visual breakdowns. Professional data visualization style.',
    },
    {
      kind: 'generate',
      label: 'Seasonal Promo',
      prompt: 'Generate a seasonal promotional banner. Festive but tasteful, with space for offer text and a call-to-action button. Warm lighting, celebratory mood without being generic.',
    },
    {
      kind: 'generate',
      label: 'Event Flyer',
      prompt: 'Generate a promotional event flyer. Bold headline area, date/time/location details zone, atmospheric background. Professional but energetic. Vertical format.',
    },
  ],
}

const GENERATE_CREATIVE: PresetCategory = {
  label: 'Creative',
  presets: [
    {
      kind: 'generate',
      label: 'Epic Landscape',
      prompt: 'Generate a sweeping, cinematic view of a jagged, snowy mountain range at sunrise. A tiny solitary figure standing on a distant peak emphasizes the monumental scale. Intricate details in the rock faces. Dramatic low-hanging mist and powerful sun-rays cutting through the haze. Unreal Engine 5 render style, hyper-real, 8K, wide-angle lens perspective.',
    },
    {
      kind: 'generate',
      label: 'Isometric 3D',
      prompt: "Generate a clean, photorealistic isometric view of a tiny, 3D modular smart home setup presented against a solid, light pastel blue background. The style is cute, playful, 3D render, complete with soft, rounded corners and unified, soft studio light. Clear focus on the specific, detailed objects (tiny solar panels, security camera). Excellent depth of field for an app icon.",
    },
    {
      kind: 'generate',
      label: 'Abstract Concept',
      prompt: "Generate a highly detailed surrealist digital sculpture visualizing the abstract concept of 'the flow of time'. A complex, flowing, liquid mercury structure merges with crumbling ancient clock gears and a delicate blooming flower. No text, just the intricate visual association. Ethereal, hazy light from the center. High-fidelity, conceptual masterpiece.",
    },
  ],
}

// ============================================================================
// Edit Presets (27) — Object Edits +Motion Blur +Home Staging; Art Direction +Cinematic Noir,
// +Pixel Art, +Exploded Diagram; Advanced +Camera Angle (user-prunable list)
// ============================================================================

const EDIT_FILTERS: PresetCategory = {
  label: 'Filters',
  presets: [
    {
      kind: 'edit',
      label: 'Vibrant',
      editFn: (d) => `Make this image more vibrant and saturated. Increase the intensity of all colors. Brighter, more lively, punchier.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Brighten',
      editFn: (d) => `Brighten the overall image and increase the exposure. Make shadows clearer and highlights brighter. Fix any underexposure.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Dramatic Contrast',
      editFn: (d) => `Increase the contrast and make the lighting more dramatic. Deepen shadows, brighten highlights. Punchy, defined separation between light and dark.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Vintage Film',
      editFn: (d) => `Apply a vintage film grain and warm sepia-amber tone. Nostalgic, historical feel. Visible grain texture, soft vignetting at edges. Kodachrome warmth.\n\n${d}`,
    },
  ],
}

const EDIT_OBJECT: PresetCategory = {
  label: 'Object Edits',
  presets: [
    {
      kind: 'edit',
      label: 'Clean Background',
      editFn: (d) => `Remove the background and replace with a clean, seamless white studio backdrop. Isolate the main subject perfectly. Professional product/portrait photography.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Change Color',
      editFn: (d) => `Change the primary color of the main object in this image. Swap it to a different hue while preserving texture, lighting, reflections, and all surrounding context.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Change Scene',
      editFn: (d) => `Keep the main subject but replace the entire background with a new environment. Integrate the subject naturally — match lighting direction, color temperature, and shadow angles.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Remove Object',
      editFn: (d) => `Remove the unwanted person or object from the scene. Fill the space with a clean, plausible extension of the surrounding background. Seamless — no trace of removal.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Motion Blur',
      editFn: (d) => `Add controlled, dynamic motion blur. The central subject must remain sharp, clear, and perfectly masked, while the surrounding background and non-central objects are streaked horizontally to create an intense sense of speed and motion. Flawless subject isolation.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Home Staging',
      editFn: (d) => `Declutter and depersonalize the room shown in this image — ${d} — into a magazine-ready listing photograph WITHOUT replacing any major furniture, fixtures, or fittings. Preserve every existing piece exactly: same chairs, same desks, same sofas, same beds, same lamps, same plants, same shelving, same artwork frames — just clean and refresh their visible condition (no scuffs, no stains, look freshly maintained). Remove every person from the scene. Remove all personal photos, paperwork, sticky notes, cables, electronics clutter, food and water bottles, mugs, tissues, kitsch decor, and visual noise from every surface. If wall paint or wallpaper is dated or drab, repaint walls in a warm neutral (Edgecomb Gray / Swiss Coffee register) — trim, ceiling, and architectural details stay as-is. Replace heavy drapes with sheer white panels or simply open the existing curtains to flood the room with bright natural daylight. Switch on every existing lamp to cast warm inviting light. Empty surfaces, clean floors. The result is the same room with the same furniture and the same architecture, photographed at its absolute professional best — depersonalized and listing-ready, never redesigned.`,
    },
  ],
}

const EDIT_ART_DIRECTION: PresetCategory = {
  label: 'Art Direction',
  presets: [
    {
      kind: 'edit',
      label: 'Watercolor',
      editFn: (d) => `Transform into a watercolor painting. Keep the semantic structure and all key details but apply a hand-painted watercolor medium. Visible brushstrokes, paper texture, paint bleeds.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Night Scene',
      editFn: (d) => `Edit this to be a moody, foggy nighttime scene. Relight entirely — moonlight and artificial sources replace daylight. Deep shadows, atmospheric haze, stars visible.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Cinematic Noir',
      editFn: (d) => `Moody, high-contrast Film Noir version. Deep chiaroscuro lighting, extreme shadow definition and minimal, focused highlights that emphasize textures. Long, raking shadows for mystery. Deep hazy atmospheric perspective. Film grain and crushed blacks.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Blueprint',
      editFn: (d) => `Transform into a detailed architectural blueprint. Cyan-on-dark-blue technical drawing. Elevations, floor plan, section details. Annotate materials correctly from what is visible.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Pixel Art',
      editFn: (d) => `Transform into high-quality 16-bit pixel art style with intentional CRT scanline overlay and retro gaming color palette. Preserve core composition and subjects, render all edges as clean intentional pixelation. Flat, technical lighting as if from a classic gaming monitor.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Exploded Diagram',
      editFn: (d) => `Generate a precise exploded technical diagram of this object. All internal components must be logically placed. Show lens elements, sensor, circuits, and any relevant mechanical parts. Include labeled parts in readable technical typography with thin leader lines to each component. Engineering-grade clarity, clean neutral background.\n\n${d}`,
    },
  ],
}

const EDIT_ADVANCED: PresetCategory = {
  label: 'Advanced',
  presets: [
    {
      kind: 'edit',
      label: 'Ultra-HD',
      editFn: (d) => `Generate an ultra-high-definition, hyper-photorealistic version. Sharpen every texture to extreme clarity. Every detail lifelike and razor-sharp.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Golden Hour',
      editFn: (d) => `Enhance with dramatic golden hour lighting. Deep warm amber light, long raking shadows, rays through atmospheric haze. Rich warmth on all surfaces.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Atmospheric Mist',
      editFn: (d) => `Add deep, multi-layered atmospheric mist. Profound sense of scale. Horizon dissolves into soft gradient. Foreground hyper-detailed, background recedes into haze.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Depth & Scale',
      editFn: (d) => `Exaggerate depth and dramatic scale. Push background further away. Sharp foreground contrasts against vast receding background. Monumental sense of scale.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Add Life Details',
      editFn: (d) => `Enrich with lived-in details. Add contextually appropriate props — food, drinks, personal items. Make the setting feel inhabited, curated, and real.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Aerial View',
      editFn: (d) => `Transform to dramatic aerial perspective. Reveal full spatial layout, surroundings, and scale from a drone vantage point.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Color Grade',
      editFn: (d) => `Apply cinematic color grading. Teal shadows, warm highlights, lifted blacks, controlled contrast. The look of a high-end commercial or film still.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Portrait Enhance',
      editFn: (d) => `Subtle portrait enhancement. Soften skin texture naturally, brighten eyes, even out skin tone, add gentle warmth. Keep it realistic — magazine-quality retouching, not plastic. Preserve the person's identity and character.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Portrait Pro',
      editFn: (d) => `Hyper-photorealistic portrait quality. 85mm f/1.8 lens feel. Capture micro skin pores and individual hairs. Intense Rembrandt studio lighting from the left. Slightly blurred neutral background. 8K cinematic quality. Every texture razor-sharp.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Product Shot',
      editFn: (d) => `Generate a flawless, commercial product advertisement shot. Presented angled perfectly on a clean, light grey minimalist concrete pedestal. Unified soft, diffused professional studio light from the front-right, creating subtle, defined shadows. Sharp focus on product texture and logos. 8K, photorealistic, clean composition.\n\n${d}`,
    },
    {
      kind: 'edit',
      label: 'Camera Angle',
      editFn: (d) => `Regenerate this exact moment from a new camera angle. [DELETE all angles below except the ONE you want, then generate.]

— Low angle: camera looking up at the subject, heroic framing, dramatic sky or ceiling filling the background.
— Over the shoulder: camera positioned behind and slightly above one subject, looking past their shoulder at the scene.
— Wide drone: high aerial perspective revealing full spatial context and surroundings.
— Close-up: tight framing on the subject's face or key detail, shallow depth of field, background falls away.

Preserve subject identity, lighting, time of day, wardrobe, and atmosphere — only the camera position changes.

${d}`,
    },
  ],
}

// ============================================================================
// Compose Presets (15)
// ============================================================================

const COMPOSE_PRESETS: PresetCategory = {
  label: 'Compose',
  presets: [
    {
      kind: 'compose',
      label: 'Magazine Cover',
      composeFn: (d) => `Combine ${d.ing} to create a stylish magazine cover photoshoot. Editorial lighting, cinematic composition. Include masthead title area, inset portraits, body copy block zones.`,
    },
    {
      kind: 'compose',
      label: 'Natural Placement',
      composeFn: (d) => `Seamlessly integrate ${d.sl} into ${d.sc}. Match lighting direction, shadow angles, and color temperature perfectly. Place subjects on logical surfaces. As if they were always there.`,
    },
    {
      kind: 'compose',
      label: 'Before / After',
      composeFn: (d) => `Create a dramatic before/after split comparison. Left side: ${d.sc} in original state. Right side: enhanced version with ${d.sl} integrated. Clean vertical divider line between halves.`,
    },
    {
      kind: 'compose',
      label: 'Foreground Hero',
      composeFn: (d) => `Place ${d.su[0] || '[subject]'} as a massive, hyper-detailed foreground centerpiece. ${d.su.length > 1 ? d.su.slice(1).join(', ') + ' as smaller mid-ground elements. ' : ''}${d.sc} as vast background. Dramatic scale contrast.`,
    },
    {
      kind: 'compose',
      label: 'Movie Poster',
      composeFn: (d) => `Cinematic movie poster. ${d.sc} as dramatic background. ${d.su.join(', ')} arranged heroically in the composition. Bold title area at top, credits at bottom. Dramatic lighting and color grade.`,
    },
    {
      kind: 'compose',
      label: 'Artistic Collage',
      composeFn: (d) => `Artistic mixed-media collage. Torn-edge cutouts of ${d.sl} arranged over ${d.sc}. Textured paper overlay, paint strokes, hand-crafted feel. Editorial art direction.`,
    },
    {
      kind: 'compose',
      label: 'Balanced Scene',
      composeFn: (d) => `Balanced, harmonious integration into ${d.sc}. ${d.su.map((s, i) => s + (i % 2 === 0 ? ' positioned right' : ' positioned left')).join('. ')}. Natural spacing, matched lighting and atmosphere.`,
    },
    {
      kind: 'compose',
      label: 'Layered Depth',
      composeFn: (d) => `Create a layered depth composition over ${d.sc}. ${d.su[0] || '[subject]'} sharp in foreground. ${d.su.length > 1 ? d.su.slice(1).join(', ') + ' softer in mid-ground.' : ''} Atmospheric perspective. Each layer at different focal depth.`,
    },
    {
      kind: 'compose',
      label: 'Double Exposure',
      composeFn: (d) => `Artistic double exposure blend. Merge ${d.sc} with ${d.sl}. Silhouette of one contains the detail of another. Moody, cinematic, with controlled transparency and overlap.`,
    },
    {
      kind: 'compose',
      label: 'Panoramic Merge',
      composeFn: (d) => `Extend ${d.sc} into a wide panoramic scene. Seamlessly integrate ${d.sl} into the expanded environment. Consistent lighting and atmosphere across the full width.`,
    },
    {
      kind: 'compose',
      label: 'Profile Shot',
      composeFn: (d) => `Professional portrait. Take the subject from ${d.su[0] || '[subject]'} and place them in front of the soft, blurred bokeh background from ${d.sc}. Match lighting to natural, slightly overcast. Flawless masking, preserved expression and clothing.`,
    },
    {
      kind: 'compose',
      label: 'Product Try-On',
      composeFn: (d) => `Photorealistic product fitting. Integrate ${d.su[0] || '[product]'} onto the person in ${d.sc}. The product fits naturally — correct scale, matched skin tone lighting, realistic shadows and depth of field. As if photographed wearing it.`,
    },
    {
      kind: 'compose',
      label: 'Product Staging',
      composeFn: (d) => `Interior staging mockup. Place ${d.sl} seamlessly into the environment of ${d.sc}. Products sit naturally on surfaces with correct shadows, anchored to the floor or table. Matched warm light from the scene's windows and fixtures.`,
    },
    {
      kind: 'compose',
      label: 'Flat-Lay',
      composeFn: (d) => `Creative flat-lay knolling composition. Arrange ${d.sl} in a clean, balanced grid from directly above on a textured surface from ${d.sc}. Warm, curated aesthetic. Visible surface texture. All items have matched overhead light and unified shadow direction.`,
    },
    {
      kind: 'compose',
      label: 'Polaroid Pile',
      composeFn: (d) => `Nostalgic photo pile on a warm surface. ${d.sl} as individual polaroid-style prints with white borders, arranged in a loose overlapping cluster. Slight random rotations. Realistic shadows between layers. ${d.sc} as the background surface texture.`,
    },
  ],
}

// ============================================================================
// Layout Presets (13) — each carries GridConfig for WP-5
// ============================================================================

const LAYOUT_PRESETS: PresetCategory = {
  label: 'Layout',
  presets: [
    {
      kind: 'layout',
      label: 'Bento 2\u00D72',
      // 2026-04-17: prompt rewritten to match actual grid (4-slot bento with
      // tall hero left, two stacked right cells, and a wide bottom strip).
      layoutFn: (d) => `Bento grid layout: ${d.s[0] || '[hero]'} as tall portrait left column. ${d.s[1] || '[slot 2]'} top-right square. ${d.s[2] || '[slot 3]'} bottom-right square. ${d.s[3] || '[slot 4]'} as wide landscape bottom strip spanning full width. 12px white gutters, rounded corners, warm unified studio grade.`,
      grid: {
        // 2026-04-17 fix: was 2-row grid with cells 3+4 colliding at (col 2, row 2).
        // Now 3-row grid — hero spans rows 1-2 in column 1, two cells stack in
        // column 2, and slot 4 becomes a wide bottom strip across both columns.
        columns: '1fr 1fr',
        rows: '1fr 1fr 0.6fr',
        cells: [
          { role: 'hero', slotIndex: 0, gridColumn: '1', gridRow: '1 / 3' },
          { role: 'cell', slotIndex: 1, gridColumn: '2', gridRow: '1' },
          { role: 'cell', slotIndex: 2, gridColumn: '2', gridRow: '2' },
          { role: 'cell', slotIndex: 3, gridColumn: '1 / 3', gridRow: '3' },
        ],
        minSlots: 4,
        maxSlots: 4,
        allowsExpansion: false,
      },
    },
    {
      kind: 'layout',
      label: 'Bento Asymmetric',
      layoutFn: (d) => {
        const remaining = d.s.slice(1).filter(x => x !== '[empty]').join(', ') || '[remaining slots]'
        return `Asymmetric bento: ${d.s[0] || '[hero]'} as large hero panel left third. ${remaining} in smaller cells on right. Clean gutters, unified lighting across all cells.`
      },
      grid: {
        columns: '2fr 1fr',
        rows: '1fr 1fr',
        cells: [
          { role: 'hero', slotIndex: 0, gridColumn: '1', gridRow: '1 / 3' },
          { role: 'cell', slotIndex: 1, gridColumn: '2', gridRow: '1' },
          { role: 'cell', slotIndex: 2, gridColumn: '2', gridRow: '2' },
        ],
        minSlots: 3,
        maxSlots: 3,
        allowsExpansion: false,
      },
    },
    {
      kind: 'layout',
      label: 'Triptych',
      layoutFn: (d) => `Clean triptych: three panels side by side. ${d.s[0] || '[panel 1]'} left. ${d.s[1] || '[panel 2]'} center. ${d.s[2] || '[panel 3]'} right. Equal widths, 10px white gutters, matched color grade.`,
      grid: {
        columns: '1fr 1fr 1fr',
        rows: '1fr',
        cells: [
          { role: 'cell', slotIndex: 0 },
          { role: 'cell', slotIndex: 1 },
          { role: 'cell', slotIndex: 2 },
        ],
        minSlots: 3,
        maxSlots: 3,
        allowsExpansion: false,
      },
    },
    {
      kind: 'layout',
      label: 'Editorial Stack',
      layoutFn: (d) => {
        const below = d.s.slice(1).filter(x => x !== '[empty]').join(', ')
        return `Editorial stacked layout. ${d.s[0] || '[hero]'} as full-width hero image on top. ${below} as a row of smaller panels below. 8px white borders, sophisticated lighting.`
      },
      grid: {
        columns: '1fr',
        rows: 'auto 1fr',
        cells: [
          { role: 'hero', slotIndex: 0, gridColumn: '1', gridRow: '1' },
          // Remaining cells rendered as a sub-row in WP-5
        ],
        minSlots: 3,
        maxSlots: 5,
        allowsExpansion: true,
      },
    },
    {
      kind: 'layout',
      label: 'Filmstrip',
      layoutFn: (d) => {
        const filled = d.s.filter(x => x !== '[empty]').join(', ')
        return `Horizontal filmstrip: ${filled} as equal panels side by side. Each subject isolated on matching studio backdrop. Consistent lighting across all panels. 8px gutters.`
      },
      grid: {
        columns: 'repeat(auto, 1fr)', // Dynamic — WP-5 computes from slot count
        rows: '1fr',
        cells: [], // Dynamic — WP-5 generates cells from filled slots
        minSlots: 3,
        maxSlots: 8,
        allowsExpansion: true,
      },
    },
    {
      kind: 'layout',
      label: 'Editorial Magazine',
      layoutFn: (d) => {
        const details = d.s.slice(1).filter(x => x !== '[empty]').join(', ') || '[detail crops]'
        return `Magazine spread layout: ${d.s[0] || '[hero]'} as large hero taking left 60%. ${details} arranged asymmetrically on right with generous negative space. Minimal, sophisticated.`
      },
      grid: {
        columns: '3fr 2fr',
        rows: '1fr 1fr',
        cells: [
          { role: 'hero', slotIndex: 0, gridColumn: '1', gridRow: '1 / 3' },
          { role: 'cell', slotIndex: 1, gridColumn: '2', gridRow: '1' },
          { role: 'cell', slotIndex: 2, gridColumn: '2', gridRow: '2' },
        ],
        minSlots: 3,
        maxSlots: 3,
        allowsExpansion: false,
      },
    },
    {
      kind: 'layout',
      label: 'Side by Side',
      layoutFn: (d) => `Clean side-by-side comparison. Left panel: ${d.s[0] || '[image 1]'}. Right panel: ${d.s[1] || '[image 2]'}. Equal 50/50 split. Matched color grade and lighting. Thin divider.`,
      grid: {
        columns: '1fr 1fr',
        rows: '1fr',
        cells: [
          { role: 'cell', slotIndex: 0 },
          { role: 'cell', slotIndex: 1 },
        ],
        minSlots: 2,
        maxSlots: 2,
        allowsExpansion: false,
      },
    },
    {
      kind: 'layout',
      label: 'Portfolio Grid',
      layoutFn: (d) => {
        const filled = d.s.filter(x => x !== '[empty]').join(', ')
        return `Portfolio grid: ${filled} arranged in a clean grid. 10px white gutters between cells. Soft diffused studio lighting. Muted sophisticated palette unified across all cells.`
      },
      grid: {
        columns: 'repeat(3, 1fr)',
        rows: 'repeat(auto, 1fr)', // Dynamic rows
        cells: [], // Dynamic — WP-5 generates
        minSlots: 4,
        maxSlots: 9,
        allowsExpansion: true,
      },
    },
    {
      kind: 'layout',
      label: 'Vertical Stack',
      layoutFn: (d) => {
        const filled = d.s.filter(x => x !== '[empty]').join(' \u2192 ')
        return `Vertical stack layout: ${filled}. Each panel full-width, stacked top to bottom. Consistent color grade across panels. 8px gutters between.`
      },
      grid: {
        columns: '1fr',
        rows: 'repeat(auto, 1fr)', // Dynamic
        cells: [],
        minSlots: 2,
        maxSlots: 5,
        allowsExpansion: true,
      },
    },
    {
      kind: 'layout',
      label: 'Feature + Detail',
      layoutFn: (d) => {
        const details = d.s.slice(1).filter(x => x !== '[empty]').join(', ') || '[detail shots]'
        return `Feature layout: ${d.s[0] || '[hero]'} as 70% hero panel on top. ${details} as a row of smaller detail panels below. Clean, editorial hierarchy.`
      },
      grid: {
        columns: '1fr',
        rows: '2fr 1fr',
        cells: [
          { role: 'hero', slotIndex: 0, gridColumn: '1', gridRow: '1' },
        ],
        minSlots: 3,
        maxSlots: 5,
        allowsExpansion: true,
      },
    },
    {
      kind: 'layout',
      label: 'Mosaic',
      layoutFn: (d) => {
        const filled = d.s.filter(x => x !== '[empty]').join(', ')
        return `Organic mosaic layout. ${filled} arranged in varied sizes — some large, some small. No strict grid. Artistic, Pinterest-style arrangement. Minimal gaps.`
      },
      grid: {
        columns: '1fr 2fr 1fr',
        rows: '1fr 2fr',
        cells: [
          { role: 'cell', slotIndex: 0, gridColumn: '1', gridRow: '1' },
          { role: 'hero', slotIndex: 1, gridColumn: '2', gridRow: '1 / 3' },
          { role: 'cell', slotIndex: 2, gridColumn: '3', gridRow: '1' },
          { role: 'cell', slotIndex: 3, gridColumn: '1', gridRow: '2' },
          { role: 'cell', slotIndex: 4, gridColumn: '3', gridRow: '2' },
        ],
        minSlots: 4,
        maxSlots: 6,
        allowsExpansion: true,
      },
    },
    {
      kind: 'layout',
      label: 'Infographic',
      layoutFn: (d) => {
        const filled = d.s.filter(x => x !== '[empty]').join(', ')
        return `Illustrated infographic layout. Arrange ${filled} as visual elements within a dark UI infographic. Teal and gold accents. Add diagrams, labels, connecting lines, and explanatory text zones between the images.`
      },
      grid: {
        columns: '1fr 1fr',
        rows: '1fr 1fr',
        cells: [
          { role: 'cell', slotIndex: 0 },
          { role: 'cell', slotIndex: 1 },
          { role: 'cell', slotIndex: 2 },
          { role: 'cell', slotIndex: 3 },
        ],
        minSlots: 3,
        maxSlots: 6,
        allowsExpansion: true,
      },
    },
    {
      kind: 'layout',
      label: 'Detail Inset',
      layoutFn: (d) => {
        const details = d.s.slice(1).filter(x => x !== '[empty]').join(', ') || '[detail shots]'
        return `Technical detail view. ${d.s[0] || '[main product]'} as the full clean background view. ${details} as circular inset panels showing extreme macro close-ups. Clean white connecting lines from inset to detail area. Unified technical lighting.`
      },
      grid: {
        columns: '1fr',
        rows: '1fr',
        cells: [
          { role: 'hero', slotIndex: 0, gridColumn: '1', gridRow: '1' },
          // Insets rendered as positioned overlays in WP-5
        ],
        minSlots: 3,
        maxSlots: 5,
        allowsExpansion: true,
      },
    },
  ],
}

// ============================================================================
// Brand Presets (8) — rewritten 2026-04-17
// ============================================================================
//
// Business-in-use deliverables (logos, cards, signage, menus, packaging,
// merch, social templates). These are the physical + digital assets a
// small business uses every day — not designer deliverables.
//
// KEY DIFFERENCE from other preset kinds: Brand is STATEFUL. The tab owns
// a brand identity (from the active vibe) and every prompt bakes the real
// fonts, colors, voice, audience, business name into the prompt. No
// placeholder brackets. No fill-in-the-blank. The prompts embed
// `brandDataBlock(b)` which renders the actual vibe tokens.
//
// Most presets also use the selected image as an ingredient (logomark,
// product photo, character mark). `needsImage: true` marks those.
//
// Menu copy, voice samples, and business-truth strings get pulled from
// CREATIVE-BRIEF.md automatically via WP-15 proofread — the preset just
// points at "the brief" and CD enriches during proofread.
// ============================================================================

const BRAND_PRESETS: PresetCategory = {
  label: 'Brand',
  presets: [
    {
      kind: 'brand',
      label: 'Logo System',
      brandFn: (b) => `Generate a complete logo system for ${b.businessName || 'the business'} on a single 1:1 sheet, four quadrants: (1) primary lockup — wordmark + mark together in the primary brand color on a light neutral ground, (2) monochrome — single-color variant on a neutral ground, suitable for embossing or single-ink print, (3) icon alone — the mark at app-icon scale, (4) wordmark alone — typography-only treatment in the heading font. Generous whitespace, precise alignment, subtle hairline dividers between quadrants. This is a logo sheet, not a mockup — no mood shots, no product placement, no sample card around it. Draw the business name from the brand data verbatim. Render all color hex codes exactly as specified.

${brandDataBlock(b)}`,
    },
    {
      kind: 'brand',
      label: 'Business Card',
      needsImage: true,
      brandFn: (b, d) => `Generate a photoreal business card mockup for ${b.businessName || 'the business'}. 16:9 composition: front on the left, back on the right, both resting on a subtle textured surface (matte paper, wood, stone — whichever matches the mood below), soft directional light from upper-left casting a realistic drop shadow. Front: use the provided image as the logomark${d ? ` (described as: ${d})` : ''}, plus the business name in the heading font below it. Back: use the accent color as a full-bleed field, with four contact-field placeholders in the body font (name, role, email, phone) in a color with proper contrast on that field. Render this as if a photographer shot an actual printed card — not a design mockup with rulers. Render all hex codes exactly.

${brandDataBlock(b)}`,
    },
    {
      kind: 'brand',
      label: 'Storefront Sign',
      needsImage: true,
      brandFn: (b, d) => `Generate a photorealistic mockup of ${b.businessName || 'the business'}'s storefront signage. Square aspect, eye-level angle from the street, soft natural light. The sign hangs or mounts on a surface appropriate to the brand mood — choose ONE: carved wood for warm/heritage moods, brass plaque for refined moods, painted flat panel for modern moods, neon tubing for night/energy moods, hand-lettered for folk/craft moods. Use the provided image as the logomark inlay${d ? ` (described as: ${d})` : ''}. Business name rendered in the heading font, carved/painted/etched/glowing — match the signage material physically. Real wear and weather-suitable for the mood. No floating logo on blank background — this is the sign on a real storefront with a hint of context (door frame, wall texture, light fixture). Render all hex codes exactly.

${brandDataBlock(b)}`,
    },
    {
      kind: 'brand',
      label: 'Menu Card',
      brandFn: (b) => `Generate a single-page physical menu for ${b.businessName || 'the business'}. 3:4 portrait aspect, photoreal paper/card texture, subtle drop shadow on a dark table surface. Layout: business name wordmark at top in the heading font, two-to-three menu sections with items and prices below, brief flavor descriptions under each item in the body font. PULL THE ACTUAL MENU ITEMS FROM THE CREATIVE BRIEF — use the real item names, real prices, and real flavor descriptions in the business's voice. Do NOT invent items or Lorem Ipsum. Register: a menu a customer would pick up and read, not a designer's comp. Match the mood below in palette and type hierarchy. Render all hex codes exactly.

${brandDataBlock(b)}`,
    },
    {
      kind: 'brand',
      label: 'Packaging',
      needsImage: true,
      brandFn: (b, d) => `Generate a photoreal packaging mockup for ${b.businessName || 'the business'}. Square aspect, product at an angled three-quarter view on a surface that matches the mood (linen for craft, slate for premium, wood for heritage, concrete for modern). Choose ONE packaging form that fits the business — a kraft bag, a tin, a glass jar, a wax-paper wrap, a ceramic vessel, a cup sleeve — whichever feels native to the brand. Apply the provided image as the label or mark on the package${d ? ` (described as: ${d})` : ''}, plus the business name in the heading font and a single flavor/variety line in the body font. Real soft studio light, tactile material texture, no floating mockup feel. Render all hex codes exactly.

${brandDataBlock(b)}`,
    },
    {
      kind: 'brand',
      label: 'Staff Uniform',
      needsImage: true,
      brandFn: (b, d) => `Generate a photoreal mockup of branded staff uniform merchandise for ${b.businessName || 'the business'}. Square aspect, flat-lay of ONE item chosen to fit the mood: canvas apron, cap, polo, t-shirt, tote bag. Item laid on a surface that matches the brand palette. The provided image appears embroidered or screen-printed on the item${d ? ` (described as: ${d})` : ''} — treated as a physical application (thread texture on embroidery, ink texture on screen-print), not a floating logo overlay. Business name in the heading font as a small secondary mark nearby or stitched below the logo. Soft directional light. Render all hex codes exactly.

${brandDataBlock(b)}`,
    },
    {
      kind: 'brand',
      label: 'Social Template',
      needsImage: true,
      brandFn: (b, d) => `Generate a 1:1 social-post template for ${b.businessName || 'the business'} using the provided image${d ? ` (described as: ${d})` : ''} as the hero. The image fills the full frame. Overlay a short headline at the top or bottom in the heading font — pull the headline text from the business's voice samples in the creative brief; don't invent generic travel-brochure copy. A thin accent-color strip anchors the composition along one edge. Small wordmark "${b.businessName || 'the business'}" in the body font at one corner with real type-on-photo contrast (subtle drop shadow for legibility, no box around the text). This should read like a real brand's Instagram post, not a design-template mockup. Render all hex codes exactly.

${brandDataBlock(b)}`,
    },
    {
      kind: 'brand',
      label: 'Loyalty Card',
      brandFn: (b) => `Generate a photoreal loyalty/stamp card mockup for ${b.businessName || 'the business'}. 16:9 composition, card front and back on a textured surface with soft shadow. Front: business name in heading font, short loyalty offer line in body font (e.g. "10 cups. One on us." — pull from the business's voice in the brief, don't invent), a row of 10 empty circles for stamps along the bottom in the accent color. Back: short terms-and-conditions placeholder and the business's physical address line, in the body font. Card stock with subtle paper texture. Real print feel, not a digital mockup. Render all hex codes exactly.

${brandDataBlock(b)}`,
    },
  ],
}

// ============================================================================
// Mode → Category Map
// ============================================================================

const PRESETS_BY_MODE: Record<string, PresetCategory[]> = {
  view: [],
  generate: [GENERATE_FUNCTIONAL, GENERATE_CREATIVE],
  edit: [EDIT_FILTERS, EDIT_OBJECT, EDIT_ART_DIRECTION, EDIT_ADVANCED],
  compose: [COMPOSE_PRESETS],
  layout: [LAYOUT_PRESETS],
  brand: [BRAND_PRESETS],
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns categorized presets for a given mode.
 * View mode returns an empty array.
 */
export function getPresetsForMode(mode: AdvancedTab): PresetCategory[] {
  return PRESETS_BY_MODE[mode] || []
}

/**
 * Flat list of all presets for a mode (ignoring categories).
 */
export function getFlatPresetsForMode(mode: AdvancedTab): Preset[] {
  return getPresetsForMode(mode).flatMap(cat => cat.presets)
}

/**
 * Find a preset by label within a mode.
 */
export function findPreset(mode: AdvancedTab, label: string): Preset | undefined {
  return getFlatPresetsForMode(mode).find(p => p.label === label)
}

/**
 * Total preset count across all modes.
 */
export function getTotalPresetCount(): number {
  return Object.values(PRESETS_BY_MODE).reduce(
    (sum, cats) => sum + cats.reduce((s, c) => s + c.presets.length, 0),
    0
  )
}
