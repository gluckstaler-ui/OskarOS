/**
 * director-css — pure helpers + shared types for Director Mode.
 *
 * Extracted from `components/studio/LivePreviewWithDirector.tsx` so that
 * CanvasPanel (Studio), LivePreviewWithDirector (Gallery/Image), and any
 * future iframe consumer can share the same CSS-parsing / inspector
 * building blocks instead of each reimplementing them.
 *
 * Everything in this file is:
 *   - Pure (no React, no side effects)
 *   - Same-origin safe (we read/write via the element's OWN defaultView
 *     rather than the parent window to avoid cross-document quirks)
 *   - Testable in isolation
 *
 * Do NOT import React here. Do NOT add state hooks. If a helper needs
 * component state, it belongs in the component or a dedicated hook, not
 * this file.
 *
 * Related constants for the shared iframe contract live here too so
 * `studio-bridge.ts` and `LivePreviewWithDirector.tsx` agree on attribute
 * names, class names, and selector conventions (per #3 review).
 */

// ────────────────────────────────────────────────────────────────────────
// Shared iframe contract constants
//
// Director (parent-side reach-in) and Studio's injected script use DIFFERENT
// attributes and classes because they run in different scopes and carry
// different semantics:
//
//   Director: classes on <html>, `data-oskar-bg` as a bare presence flag
//   Studio:   classes on <body>, `data-oskar-bgimg` stores the bg URL
//
// They are NOT aliases. The constants below are centralized here so that
// each name has ONE owner and future changes touch one file, not eight.
// The one constant that IS truly shared (same attribute, same meaning in
// both systems) is OSKAR_ID_ATTR — used by text-edit persistence.
// ────────────────────────────────────────────────────────────────────────

/** Director Mode: class applied to the iframe's <html> when director is ON.
 *  Scope: documentElement. Used by the parent-side reach-in implementation
 *  in `LivePreviewWithDirector.tsx`. */
export const DIRECTOR_CLASS = 'oskar-director'

/** Studio bridge: class applied to the iframe's <body> when director is ON.
 *  Scope: body. Used by the injected script in `studio-bridge.ts` and by
 *  the legacy save-vibes bridge in `lib/webdev.ts` + `scripts/inject-bridge.mjs`. */
export const DIRECTOR_ACTIVE_CLASS = 'oskar-director-active'

/** Director Mode: presence flag stamped on elements that have a
 *  background-image URL. Value is always "1" — it's a bare marker, NOT the
 *  URL. Used so the hover/click paths can find swap targets without
 *  re-reading computed style on every pointer event. */
export const BG_IMAGE_FLAG_ATTR = 'data-oskar-bg'

/** Studio bridge: attribute that stores the background-image URL as its
 *  value (e.g. `data-oskar-bgimg="/sessions/.../hero.jpg"`). The URL is
 *  the slot identifier used for postMessage swap — different semantics
 *  from BG_IMAGE_FLAG_ATTR above. */
export const BG_IMAGE_SRC_ATTR = 'data-oskar-bgimg'

/** Stable-ID attribute used by the text-edit API to locate an element
 *  across saves. Format: `txt-N` (Studio) or selector path (Director).
 *  SHARED between both systems — if you rename this, rename in all
 *  consumers and re-deploy. */
export const OSKAR_ID_ATTR = 'data-oskar-id'

/** @deprecated Use BG_IMAGE_FLAG_ATTR — renamed to disambiguate from
 *  BG_IMAGE_SRC_ATTR. Kept as an alias so this change can land without
 *  a code freeze; remove after all callers are migrated. */
export const BG_IMAGE_ATTR = BG_IMAGE_FLAG_ATTR

// ────────────────────────────────────────────────────────────────────────
// Type models — Director Mode inspector state
//
// These mirror the shape of each panel's editable properties. Kept here
// (rather than in the component file) so future hooks / helpers /
// persistence layers can import without pulling in React.
// ────────────────────────────────────────────────────────────────────────

export type Unit = 'px' | 'rem'

export interface SpacingQuad {
  t: number
  r: number
  b: number
  l: number
  unit: Unit
  expanded: boolean
}

export interface RadiusQuad {
  tl: number
  tr: number
  br: number
  bl: number
  unit: Unit
  expanded: boolean
}

/** Unit for explicit width/height inputs. `%` joins the Unit set because
 *  sizing in percent is a first-class authoring choice (fluid layouts). */
export type SizeUnit = 'px' | '%'

/** One dimension of an element's explicit size. `null` means "not set"
 *  — the element falls back to its natural/flow size. */
export interface SizeDim {
  value: number
  unit: SizeUnit
}

export interface BoxState {
  opacity: number         // 0..1
  /** Explicit width — null when the element has no inline width, uses its
   *  natural / flow / computed-by-parent width. Setting this writes
   *  inline `width: Npx` or `width: N%`. */
  width: SizeDim | null
  /** Explicit height — same semantics as width. */
  height: SizeDim | null
  padding: SpacingQuad
  margin: SpacingQuad
  radius: RadiusQuad
  fill: string | null     // hex color for background-color; null = unset
  /** Hyperlink — read from the nearest <a> in the chain (self or ancestor).
   *  BoxPanel shows a Link row whenever this is non-null. */
  href: string | null
}

export interface TypeState {
  fontFamily: string | null            // first font name from stack
  fontSize: { value: number; unit: Unit } | null
  fontWeight: number | null            // 100..900
  color: string | null                 // hex
  textAlign: 'start' | 'center' | 'end' | 'justify' | null
  lineHeight: number | null            // unitless multiplier
  letterSpacing: { value: number; unit: Unit } | null
}

export interface FilterState {
  brightness: number // 0–2, default 1
  contrast: number // 0–2, default 1
  saturate: number // 0–2, default 1
  sepia: number // 0–1, default 0
  blur: number // px, default 0
  hue: number // deg, default 0
}

export interface TransformState {
  fit: 'cover' | 'contain' | 'fill' | 'auto' | null
  positionX: number
  positionY: number
  zoom: number // 1–2
  rotate: number // deg, ±45
  flipH: boolean
  flipV: boolean
  radius: number // percent, 0–50 (scales to element size)
  repeat: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y' | null
}

/** Snapshot of an element's mutable state at Director-ON time. Used for
 *  Undo (per-element) and as the baseline for saveAll's diff detection. */
export interface ElementSnapshot {
  style: string // the element's inline style at Director-ON time
  src?: string // <img>.src OR SVG <image>.href
  href?: string | null // <a>.href — null means attribute was absent
  textHtml?: string
  innerHtml?: string
  bgImage?: string // parsed background-image
  /** SVG <image>.preserveAspectRatio at snapshot time. The Image-tab
   *  fit + position sliders mutate this (since SVG doesn't have
   *  object-fit / object-position). null = attribute was absent. */
  preserveAspectRatio?: string | null
}

// ────────────────────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────────────────────

export const defaultBox: BoxState = {
  opacity: 1,
  width: null,
  height: null,
  padding: { t: 0, r: 0, b: 0, l: 0, unit: 'px', expanded: false },
  margin: { t: 0, r: 0, b: 0, l: 0, unit: 'px', expanded: false },
  radius: { tl: 0, tr: 0, br: 0, bl: 0, unit: 'px', expanded: false },
  fill: null,
  href: null,
}

export const defaultType: TypeState = {
  fontFamily: null,
  fontSize: null,
  fontWeight: null,
  color: null,
  textAlign: null,
  lineHeight: null,
  letterSpacing: null,
}

export const defaultFilters: FilterState = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  sepia: 0,
  blur: 0,
  hue: 0,
}

export const defaultTransform: TransformState = {
  fit: null,
  positionX: 50,
  positionY: 50,
  zoom: 1,
  rotate: 0,
  flipH: false,
  flipV: false,
  radius: 0,
  repeat: null,
}

// ────────────────────────────────────────────────────────────────────────
// CSS value parsing
// ────────────────────────────────────────────────────────────────────────

/** Parse "16px" / "1rem" / "0" → { value, unit }. Returns null for "auto"
 *  or anything we can't cleanly round-trip through a numeric input. */
export function parseLength(s: string | undefined | null): { value: number; unit: Unit } | null {
  if (!s) return null
  const trimmed = s.trim()
  if (trimmed === '0') return { value: 0, unit: 'px' }
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)(px|rem)?$/)
  if (!m) return null
  return { value: parseFloat(m[1]), unit: (m[2] as Unit) || 'px' }
}

/** Parse a width/height value from inline style. Accepts px and % units.
 *  Returns null for empty / auto / anything unrecognized — null preserves
 *  the "not explicitly set" distinction that the BoxPanel relies on. */
export function parseSizeDim(raw: string | undefined | null): SizeDim | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed === 'auto') return null
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)(px|%)$/)
  if (!m) return null
  return { value: parseFloat(m[1]), unit: m[2] as SizeUnit }
}

/** Serialize a SizeDim back into CSS. `null` serializes to the empty
 *  string so the caller can clear the inline property. */
export function serializeSizeDim(s: SizeDim | null): string {
  if (s === null) return ''
  return `${s.value}${s.unit}`
}

/**
 * Read the rendered (computed) width+height of an element, rounded to
 * integer px. Used to PREFILL the Box Size inputs so the user sees the
 * element's current size even when it's styled by classes or natural
 * flow (no inline width/height). Ralph 2026-04-24: the panel previously
 * showed blank inputs for any element without inline size — the user
 * couldn't tell what size they were adjusting from.
 */
export function readComputedSize(el: HTMLElement): {
  width: SizeDim | null
  height: SizeDim | null
} {
  try {
    const view = el.ownerDocument?.defaultView ?? window
    const computed = view.getComputedStyle(el)
    const w = parseFloat(computed.width)
    const h = parseFloat(computed.height)
    return {
      width: isFinite(w) && w >= 0 ? { value: Math.round(w), unit: 'px' } : null,
      height: isFinite(h) && h >= 0 ? { value: Math.round(h), unit: 'px' } : null,
    }
  } catch {
    return { width: null, height: null }
  }
}

/** Parse the CSS 1/2/3/4-value shorthand ("16px" / "0 16px" / "0 16px 24px"
 *  / "0 16px 24px 8px") into a SpacingQuad. Returns null for anything we
 *  can't cleanly parse. Unit is taken from the FIRST value. */
export function parseQuadShorthand(s: string | undefined | null): Omit<SpacingQuad, 'expanded'> | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/).map(parseLength)
  if (parts.some((p) => p === null)) return null
  const unit = parts[0]!.unit
  const v = parts.map((p) => p!.value)
  if (v.length === 1) return { t: v[0], r: v[0], b: v[0], l: v[0], unit }
  if (v.length === 2) return { t: v[0], r: v[1], b: v[0], l: v[1], unit }
  if (v.length === 3) return { t: v[0], r: v[1], b: v[2], l: v[1], unit }
  return { t: v[0], r: v[1], b: v[2], l: v[3], unit }
}

/** Best-effort hex normalization. Accepts "#rrggbb", "rgb(...)", "rgba(...)".
 *  Returns "#rrggbb". For rgba with alpha < 1, drops the alpha
 *  (opacity is a separate control). */
export function normalizeColorToHex(raw: string): string {
  const s = raw.trim()
  if (s.startsWith('#')) {
    if (s.length === 4) {
      const r = s[1], g = s[2], b = s[3]
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    if (s.length === 7) return s.toLowerCase()
  }
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[0-9.]+\s*)?\)$/)
  if (m) {
    const r = parseInt(m[1], 10).toString(16).padStart(2, '0')
    const g = parseInt(m[2], 10).toString(16).padStart(2, '0')
    const b = parseInt(m[3], 10).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return s
}

/** Map CSS keyword weights to numeric so the dropdown can select them. */
export function normalizeWeight(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'normal') return 400
  if (trimmed === 'bold') return 700
  if (trimmed === 'lighter') return 300
  if (trimmed === 'bolder') return 600
  const n = parseInt(trimmed, 10)
  return isNaN(n) ? null : n
}

/** Extract the first (primary) font family from a CSS font-family stack,
 *  stripping quotes. e.g. `"Space Mono", monospace` → `Space Mono`. */
export function extractFirstFontName(stack: string): string {
  const first = stack.split(',')[0].trim()
  return first.replace(/^["']|["']$/g, '').replace(/^["']|["']$/g, '')
}

/** Valid values for CSS text-align that our inspector supports. */
export function isValidAlign(s: string): boolean {
  return s === 'start' || s === 'center' || s === 'end' || s === 'justify' || s === 'left' || s === 'right'
}

// ────────────────────────────────────────────────────────────────────────
// Element readers — pull state off a DOM element
// ────────────────────────────────────────────────────────────────────────

/** Read an element's Box state from inline styles (preferring inline over
 *  computed to preserve author intent). Defensive: catches failures and
 *  returns defaults so a bad read can't crash the caller. */
export function readBoxFromElement(el: HTMLElement): BoxState {
  try {
    const s = el.style
    const view = el.ownerDocument?.defaultView ?? window
    const computed = view.getComputedStyle(el)

    const opacityRaw = s.opacity || computed.opacity || '1'
    const opacity = Math.max(0, Math.min(1, parseFloat(opacityRaw) || 1))

    const padding = readQuad(s, computed, 'padding')
    const paddingExpanded = !(padding.t === padding.r && padding.r === padding.b && padding.b === padding.l)

    const margin = readQuad(s, computed, 'margin')
    const marginExpanded = !(margin.t === margin.r && margin.r === margin.b && margin.b === margin.l)

    const radius = readRadius(s, computed)
    const radiusExpanded = !(radius.tl === radius.tr && radius.tr === radius.br && radius.br === radius.bl)

    const rawFill = s.backgroundColor || ''
    const fill = rawFill.trim() ? normalizeColorToHex(rawFill) : null

    // Href — from nearest anchor in chain (self or ancestor). Null if none.
    const anchorEl = typeof el.closest === 'function' ? el.closest('a') : null
    const href = anchorEl ? anchorEl.getAttribute('href') : null

    // Width/height — read ONLY from inline style (intent). Ignore computed:
    // the whole point of the Size field is "did the author explicitly set a
    // size?" — and the BoxPanel's Reset-to-default is "clear the inline
    // value." Computed always has a value, which would fool the user into
    // thinking every element was pinned.
    const width = parseSizeDim(s.width)
    const height = parseSizeDim(s.height)

    return {
      opacity,
      width,
      height,
      padding: { ...padding, expanded: paddingExpanded },
      margin: { ...margin, expanded: marginExpanded },
      radius: { ...radius, expanded: radiusExpanded },
      fill,
      href,
    }
  } catch (err) {
    console.warn('[director-css] readBoxFromElement failed, using defaults:', err)
    return defaultBox
  }
}

function readQuad(
  inline: CSSStyleDeclaration,
  computed: CSSStyleDeclaration,
  prop: 'padding' | 'margin',
): Omit<SpacingQuad, 'expanded'> {
  const short = parseQuadShorthand(inline.getPropertyValue(prop))
  if (short) return short

  const sides = (['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => {
    const raw =
      inline.getPropertyValue(`${prop}-${side.toLowerCase()}`) ||
      computed.getPropertyValue(`${prop}-${side.toLowerCase()}`) ||
      '0'
    return parseLength(raw) || { value: 0, unit: 'px' as Unit }
  })
  return { t: sides[0].value, r: sides[1].value, b: sides[2].value, l: sides[3].value, unit: sides[0].unit }
}

function readRadius(
  inline: CSSStyleDeclaration,
  computed: CSSStyleDeclaration,
): Omit<RadiusQuad, 'expanded'> {
  const shortRaw = inline.getPropertyValue('border-radius')
  if (shortRaw) {
    const q = parseQuadShorthand(shortRaw)
    if (q) return { tl: q.t, tr: q.r, br: q.b, bl: q.l, unit: q.unit }
  }
  const corners = (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((c) => {
    const raw =
      inline.getPropertyValue(`border-${c}-radius`) ||
      computed.getPropertyValue(`border-${c}-radius`) ||
      '0'
    return parseLength(raw) || { value: 0, unit: 'px' as Unit }
  })
  return { tl: corners[0].value, tr: corners[1].value, br: corners[2].value, bl: corners[3].value, unit: corners[0].unit }
}

/** Read Typography state from an element. Falls back from inline to
 *  computed so the inspector shows the element's CURRENT effective values
 *  (not just the inline ones, which are often empty for class-styled elements). */
export function readTypeFromElement(el: HTMLElement): TypeState {
  try {
    const s = el.style
    const view = el.ownerDocument?.defaultView ?? window
    const computed = view.getComputedStyle(el)

    const fontFamilyRaw = s.fontFamily || computed.fontFamily || ''
    const fontFamily = fontFamilyRaw ? extractFirstFontName(fontFamilyRaw) : null

    const fontSize = parseLength(s.fontSize) || parseLength(computed.fontSize)

    const fwRaw = s.fontWeight || computed.fontWeight
    const fontWeight = fwRaw ? normalizeWeight(fwRaw) : null

    const colorRaw = s.color || computed.color
    const color = colorRaw ? normalizeColorToHex(colorRaw) : null

    const alignRaw = s.textAlign || computed.textAlign || ''
    const textAlign = isValidAlign(alignRaw) ? (alignRaw as TypeState['textAlign']) : null

    // Line-height: convert px → unitless multiplier using font-size.
    const lhRaw = s.lineHeight || computed.lineHeight
    let lineHeight: number | null = null
    if (lhRaw && lhRaw !== 'normal') {
      const lhMatch = lhRaw.match(/^(\d+(?:\.\d+)?)(px|rem)?$/)
      if (lhMatch) {
        const num = parseFloat(lhMatch[1])
        if (lhMatch[2] === 'px' && fontSize) {
          const fsPx = fontSize.unit === 'px' ? fontSize.value : fontSize.value * 16
          lineHeight = fsPx > 0 ? Math.round((num / fsPx) * 100) / 100 : null
        } else {
          lineHeight = num
        }
      }
    }

    let letterSpacing: { value: number; unit: Unit } | null = null
    const lsRaw = s.letterSpacing || computed.letterSpacing
    if (lsRaw && lsRaw !== 'normal') {
      letterSpacing = parseLength(lsRaw)
    }

    return { fontFamily, fontSize, fontWeight, color, textAlign, lineHeight, letterSpacing }
  } catch (err) {
    console.warn('[director-css] readTypeFromElement failed, using defaults:', err)
    return defaultType
  }
}

// ────────────────────────────────────────────────────────────────────────
// Element classification
// ────────────────────────────────────────────────────────────────────────

/** Text-capable elements where the Type panel is meaningful. Explicit
 *  text tags always qualify; for any other element (div/section/etc.),
 *  returns true when it has visible text in its subtree — font / color /
 *  size on a container cascades to its text children. */
export function isTextElement(el: HTMLElement): boolean {
  const tag = el.tagName
  const textTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'SPAN', 'A', 'LI', 'BLOCKQUOTE', 'STRONG', 'EM',
    'LABEL', 'BUTTON', 'FIGCAPTION', 'SUMMARY']
  if (textTags.includes(tag)) return true
  return (el.textContent || '').trim().length > 0
}

/**
 * True when the element is safe to REPLACE text on — i.e. its only
 * children are text / inline-formatting nodes, not block-level siblings.
 *
 * Rationale (Ralph 2026-04-23): setting `.textContent` on a container
 * that wraps multiple paragraphs/headings obliterates every child
 * element. The Text tab must only be shown for leaf text holders, never
 * for sections/divs that happen to contain text somewhere in their
 * subtree. `isTextElement` keeps the older, looser meaning (Type tab
 * still cascades to children) — this helper is the strict gate.
 */
export function isTextLeafElement(el: HTMLElement): boolean {
  // No element children at all → safe (pure text node, e.g. <p>hello</p>
  // or a leaf <h1>).
  if (el.children.length === 0) return true
  // Otherwise only allow children that are PURELY inline formatting tags
  // and contain no further block structure. Anything else means a real
  // container — setting textContent would wipe siblings.
  const inlineTags = new Set([
    'B', 'I', 'EM', 'STRONG', 'SPAN', 'U', 'S', 'SMALL', 'SUB', 'SUP',
    'MARK', 'BR', 'CODE', 'Q', 'CITE', 'TIME', 'ABBR', 'KBD', 'SAMP',
    'VAR', 'WBR',
  ])
  for (const child of Array.from(el.children)) {
    if (!inlineTags.has(child.tagName)) return false
    // Recurse one level: an <em> wrapping a <div> is still dangerous.
    if ((child as HTMLElement).children.length > 0) {
      if (!isTextLeafElement(child as HTMLElement)) return false
    }
  }
  return true
}

/** True when the element is a direct swap target — an <img> OR has a
 *  background-image URL. Used by the gear overlay and Image tab gating. */
export function isSwapTarget(el: HTMLElement): boolean {
  if (el.tagName === 'IMG') return true
  const view = el.ownerDocument?.defaultView
  if (!view) return false
  const bg = view.getComputedStyle(el).backgroundImage
  return !!bg && bg !== 'none' && /url\(/i.test(bg)
}

/** Walk up from `start` to the nearest swap-target (self or ancestor).
 *  Returns null if none exists between `start` and the document body. */
export function findSwapTarget(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start
  const body = start.ownerDocument?.body
  while (node && node !== body) {
    if (isSwapTarget(node)) return node
    node = node.parentElement
  }
  return null
}

// ────────────────────────────────────────────────────────────────────────
// Discovery — walk the iframe DOM to populate inspector dropdowns
// ────────────────────────────────────────────────────────────────────────

/** Every unique `href` value on the page (from <a href>). Empties filtered. */
export function discoverLinksOnPage(iframeDoc: Document | null | undefined): string[] {
  if (!iframeDoc) return []
  const found = new Set<string>()
  iframeDoc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href')
    if (href && href.trim()) found.add(href.trim())
  })
  return Array.from(found).sort()
}

/** Every font-family actually used on the page (primary names only,
 *  deduplicated, sorted). Populates the Font dropdown. */
export function discoverFontsOnPage(iframeDoc: Document | null | undefined): string[] {
  if (!iframeDoc) return []
  const view = iframeDoc.defaultView
  if (!view) return []
  const found = new Set<string>()
  const all = iframeDoc.querySelectorAll<HTMLElement>('*')
  for (const el of all) {
    if (['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'TITLE'].includes(el.tagName)) continue
    try {
      const ff = view.getComputedStyle(el).fontFamily
      if (ff) found.add(extractFirstFontName(ff))
    } catch {
      // ignore per-element failures
    }
  }
  return Array.from(found).sort()
}

/** Font weights available for a given family via document.fonts (FontFaceSet).
 *  Falls back to the standard 100..900 set when the API is unavailable or
 *  no matching face is found. */
export function discoverWeightsForFont(
  iframeDoc: Document | null | undefined,
  family: string | null,
): number[] {
  const standard = [100, 200, 300, 400, 500, 600, 700, 800, 900]
  if (!iframeDoc || !family) return standard
  const fs = (iframeDoc as Document & { fonts?: FontFaceSet }).fonts
  if (!fs) return standard
  const found = new Set<number>()
  try {
    fs.forEach((font) => {
      const familyClean = font.family.replace(/^["']|["']$/g, '').trim()
      if (familyClean.toLowerCase() !== family.toLowerCase()) return
      const w = font.weight.trim()
      const rangeMatch = w.match(/^(\d+)\s+(\d+)$/)
      if (rangeMatch) {
        const from = parseInt(rangeMatch[1], 10)
        const to = parseInt(rangeMatch[2], 10)
        for (const n of standard) if (n >= from && n <= to) found.add(n)
      } else {
        const n = normalizeWeight(w)
        if (n !== null) found.add(n)
      }
    })
  } catch {
    return standard
  }
  const result = Array.from(found).sort((a, b) => a - b)
  return result.length > 0 ? result : standard
}

// ────────────────────────────────────────────────────────────────────────
// Serializers — state → CSS string (for applying back to the element)
// ────────────────────────────────────────────────────────────────────────

/** Serialize a SpacingQuad into CSS shorthand. Collapses to single-value
 *  form when all four sides match; otherwise 4-value form "T R B L". */
export function serializeQuad(q: SpacingQuad): string {
  const { t, r, b, l, unit } = q
  if (t === r && r === b && b === l) return `${t}${unit}`
  return `${t}${unit} ${r}${unit} ${b}${unit} ${l}${unit}`
}

/** Serialize a RadiusQuad into CSS border-radius. Corner order is TL TR BR BL
 *  (clockwise from top-left) — matches CSS shorthand. */
export function serializeRadius(q: RadiusQuad): string {
  const { tl, tr, br, bl, unit } = q
  if (tl === tr && tr === br && br === bl) return `${tl}${unit}`
  return `${tl}${unit} ${tr}${unit} ${br}${unit} ${bl}${unit}`
}

export function spacingIsZero(q: SpacingQuad): boolean {
  return q.t === 0 && q.r === 0 && q.b === 0 && q.l === 0
}

export function radiusIsZero(q: RadiusQuad): boolean {
  return q.tl === 0 && q.tr === 0 && q.br === 0 && q.bl === 0
}

export function buildFilterString(f: FilterState): string {
  const parts: string[] = []
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`)
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`)
  if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`)
  if (f.sepia > 0) parts.push(`sepia(${f.sepia})`)
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`)
  if (f.hue !== 0) parts.push(`hue-rotate(${f.hue}deg)`)
  return parts.join(' ')
}

export function buildTransformString(t: TransformState): string {
  const parts: string[] = []
  if (t.flipH && t.flipV) parts.push('scale(-1, -1)')
  else if (t.flipH) parts.push('scaleX(-1)')
  else if (t.flipV) parts.push('scaleY(-1)')
  if (t.zoom !== 1) parts.push(`scale(${t.zoom})`)
  if (t.rotate !== 0) parts.push(`rotate(${t.rotate}deg)`)
  return parts.join(' ')
}

// ────────────────────────────────────────────────────────────────────────
// Humanization
// ────────────────────────────────────────────────────────────────────────

/** Human-readable label for a numeric font weight. 400 → "Regular", etc. */
export function weightLabel(n: number): string {
  if (n === 100) return 'Thin'
  if (n === 200) return 'Extra Light'
  if (n === 300) return 'Light'
  if (n === 400) return 'Regular'
  if (n === 500) return 'Medium'
  if (n === 600) return 'Semibold'
  if (n === 700) return 'Bold'
  if (n === 800) return 'Extra Bold'
  if (n === 900) return 'Black'
  return ''
}

// ────────────────────────────────────────────────────────────────────────
// Selector paths — how server-side code locates elements by DOM position
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a real CSS selector path that a server can resolve via
 * `document.querySelector`. Walks from the element up to <body>, recording
 * `tag:nth-of-type(N)` at each level. Resilient to class renames and
 * auto-generated ids — depends only on DOM structure.
 *
 *   body > section:nth-of-type(1) > div:nth-of-type(2) > img:nth-of-type(1)
 */
export function buildSelectorPath(el: HTMLElement): string {
  const parts: string[] = []
  let node: HTMLElement | null = el
  const body = el.ownerDocument?.body
  while (node && node !== body) {
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (!parent) break
    const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
    const idx = siblings.indexOf(node)
    parts.unshift(`${tag}:nth-of-type(${idx + 1})`)
    node = parent
  }
  return 'body > ' + parts.join(' > ')
}

/** Stable opaque ID used by the text-edit API to persistently address an
 *  element. Wraps `buildSelectorPath` with an `auto-` prefix so the server
 *  can distinguish programmatic ids from author-provided ones. */
export function buildStablePath(el: HTMLElement): string {
  return 'auto-' + buildSelectorPath(el)
}

/** Resolve a slot id (img:src#occurrence, bgimg:url, or a data-slot value)
 *  back to the element inside the provided document. Used by the picker
 *  modal + save-edits routes. */
export function resolveSlotToElement(doc: Document, slot: string): HTMLElement | null {
  if (slot.startsWith('img:')) {
    const rest = slot.slice(4)
    const hashIdx = rest.lastIndexOf('#')
    let targetSrc = rest
    let occ = 1
    if (hashIdx >= 0) {
      const n = parseInt(rest.slice(hashIdx + 1), 10)
      if (!isNaN(n) && n >= 1) {
        targetSrc = rest.slice(0, hashIdx)
        occ = n
      }
    }
    const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>('img'))
    let seen = 0
    for (const img of imgs) {
      if (img.getAttribute('src') === targetSrc || img.src === targetSrc) {
        seen += 1
        if (seen === occ) return img
      }
    }
    return null
  }
  if (slot.startsWith('bgimg:')) {
    const url = slot.slice(6)
    const els = Array.from(doc.querySelectorAll<HTMLElement>(`[${BG_IMAGE_ATTR}="1"]`))
    for (const el of els) {
      const bg = doc.defaultView?.getComputedStyle(el).backgroundImage || ''
      if (bg.includes(url)) return el
    }
    return els[0] || null
  }
  return doc.querySelector<HTMLElement>(`img[data-slot="${slot}"]`)
}

/** Helper: force the iframe to reload after out-of-band changes. */
export function cacheBustSuffix(): string {
  return `?_ts=${Date.now()}`
}
