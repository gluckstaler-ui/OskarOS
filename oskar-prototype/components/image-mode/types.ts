/**
 * components/image-mode/types.ts — shared types for the image-ops Workshop
 * (WP-IMG-1..4, 2026-05-06).
 *
 * State lives in `AdvancedMode` so the Zone 2 overlay (marquee, slice grid)
 * and the Workshop body (Z3+Z4 area) stay in sync. The same dispatch is used
 * by both surfaces — no two-way relay, no eventual-consistency drift.
 */

export type ImageOpsTool = 'crop' | 'slice' | 'resize' | 'format-convert'

export type CropAspect = 'free' | '1:1' | '3:4' | '4:3' | '16:9' | '9:16' | '2:3'
export type ResizeAspect = 'free' | '1:1' | '4:3' | '16:9' | '9:16'
export type ResizeKernel = 'lanczos3' | 'cubic' | 'bilinear' | 'nearest'

/**
 * Tag chips control which user-curation tag the new output(s) land with.
 * The lifecycle status (READY) is set automatically by the backend; these
 * three are the user's curation verdict on the freshly-generated output:
 *   STAR   — "this is great, promote"
 *   B-ROLL — "keep as variant / secondary" (default — derivatives are
 *            secondary by nature)
 *   TRASH  — "cull immediately" (rare, but available)
 * Mirrors the user-assignable subset of `ImageTag` in `lib/types.ts`.
 * Per Ralph 2026-05-05 the previous 6-chip set (READY/APPROVED/HERO/
 * B-ROLL/REDO/TRASH) collapsed to this 3-chip user-curation triad —
 * lifecycle and placement tags are auto-derived, not user-clickable.
 */
export type ImageOpsTagChip = 'STAR' | 'B-ROLL' | 'TRASH'

/** Image-native (not displayed) pixel rect. */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The full per-session image-ops state. One of these lives in AdvancedMode;
 * the Workshop edits it and the Zone 2 overlay reads it.
 */
export interface ImageOpsState {
  /** Active sub-tool. */
  tool: ImageOpsTool

  // ── CROP ────────────────────────────────────────────────────────────────
  cropAspect: CropAspect
  /** Image-native pixels. `null` = uninitialized (defaults to centered 60% on first paint). */
  cropRect: CropRect | null
  cropOverwrite: boolean
  /** Empty string means "let the server suffix `-crop`". */
  cropFilename: string

  // ── SLICE ───────────────────────────────────────────────────────────────
  sliceCols: number  // 1..6 in UI
  sliceRows: number  // 1..6 in UI
  /** Token-substituted at op time. Default `{stem}-tile-{n}`. */
  sliceNamingPattern: string

  // ── RESIZE ──────────────────────────────────────────────────────────────
  resizeWidth: number  // image-native pixels
  resizeAspect: ResizeAspect
  resizeKernel: ResizeKernel
  resizeOverwrite: boolean
  resizeFilename: string

  // ── FORMAT-CONVERT (WP-IMG-5) ──────────────────────────────────────────
  /** Output container. */
  formatTo: 'jpeg' | 'png' | 'webp'
  /** 1..100 — JPG always, WEBP when not lossless. Disabled for PNG. */
  formatQuality: number
  /** WEBP only — when true, quality slider is disabled. */
  formatLossless: boolean
  /** Both addons available across all output formats (Ralph 2026-05-06).
   *  Each addon has an explicit enabled flag — backend includes the addon
   *  in the pipeline only when the flag is true. Default OFF for both. */
  alphaMatteEnabled: boolean
  /** Eyedropper-picked replace-color. Default white. */
  alphaMatteColor: string
  chromaKeyEnabled: boolean
  /** Eyedropper-picked key color. */
  chromaKeyColor: string
  /** Distance threshold for chroma-key match (RGB Euclidean). */
  chromaKeyTolerance: number
  /** Soft falloff in px around the keyed area. */
  chromaKeyFeather: number
  formatOverwrite: boolean
  formatFilename: string
  /**
   * Eyedropper picks land here so the readout pill can show a frozen value
   * across hover/leave. The picked hex ALSO writes to `chromaKeyColor` when
   * the chroma-key addon is enabled, and/or to `alphaMatteColor` when
   * alpha-matte is enabled. Both addons are universally available across
   * all three output formats (Ralph rev 2026-05-06).
   */
  lastEyedropperPick: { hex: string; x: number; y: number } | null

  // ── PREVIEW (Ralph 2026-05-06) ─────────────────────────────────────────
  /** Toggled from the ops-bar right slot. When true, Zone 2 splits into
   *  input | output halves; when false, Zone 2 stays as a single image
   *  (current behavior, marquee/grid render at full size). */
  showPreview: boolean
  /** URL of the most recent op output, for the Zone 2 split's RIGHT half.
   *  Cleared on tool change so a CROP output doesn't leak into a SLICE
   *  view. After the next Generate of the new tool, it repopulates. */
  lastOutput: { tool: ImageOpsTool; url: string } | null

  // ── FOOTER ──────────────────────────────────────────────────────────────
  tagChip: ImageOpsTagChip
}

export function makeInitialImageOpsState(): ImageOpsState {
  return {
    tool: 'crop',
    cropAspect: 'free',
    cropRect: null,
    cropOverwrite: false,
    cropFilename: '',
    sliceCols: 3,
    sliceRows: 1,
    sliceNamingPattern: '{stem}-tile-{n}',
    resizeWidth: 1280,
    resizeAspect: 'free',
    resizeKernel: 'lanczos3',
    resizeOverwrite: false,
    resizeFilename: '',
    formatTo: 'jpeg',
    formatQuality: 90,
    formatLossless: false,
    alphaMatteEnabled: false,
    alphaMatteColor: '#FFFFFF',
    chromaKeyEnabled: false,
    chromaKeyColor: '#FF00FF',
    chromaKeyTolerance: 30,
    chromaKeyFeather: 8,
    formatOverwrite: false,
    formatFilename: '',
    lastEyedropperPick: null,
    showPreview: false,
    lastOutput: null,
    // Default to B-ROLL — image-ops outputs are derivatives by nature
    // (slice-tile, crop, resize-variant). User can promote to STAR or
    // demote to TRASH from the chip row.
    tagChip: 'B-ROLL',
  }
}

/** Aspect ratio pairs for crop chips. `null` = free aspect. */
export const CROP_ASPECT_RATIOS: Record<CropAspect, [number, number] | null> = {
  free: null,
  '1:1': [1, 1],
  '3:4': [3, 4],
  '4:3': [4, 3],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '2:3': [2, 3],
}

/** Aspect ratio pairs for resize chips. */
export const RESIZE_ASPECT_RATIOS: Record<ResizeAspect, [number, number] | null> = {
  free: null,
  '1:1': [1, 1],
  '4:3': [4, 3],
  '16:9': [16, 9],
  '9:16': [9, 16],
}

/** UI helper: list order for chips (object keys are not guaranteed order). */
export const CROP_ASPECT_ORDER: CropAspect[] = ['free', '1:1', '3:4', '4:3', '16:9', '9:16', '2:3']
export const RESIZE_ASPECT_ORDER: ResizeAspect[] = ['free', '1:1', '4:3', '16:9', '9:16']
export const RESIZE_KERNEL_ORDER: ResizeKernel[] = ['lanczos3', 'cubic', 'bilinear', 'nearest']
export const TAG_CHIP_ORDER: ImageOpsTagChip[] = ['STAR', 'B-ROLL', 'TRASH']

/** Tag-chip color map (used for the active footer pill). */
export const TAG_CHIP_COLORS: Record<ImageOpsTagChip, string> = {
  STAR: '#FACC15',      // gold — great picture
  'B-ROLL': '#6B7280',  // gray — secondary / variant
  TRASH: '#EF4444',     // red — cull
}

/** Kernel reference card content (for the `?` popover next to the kernel select). */
export const KERNEL_REFERENCE: Record<ResizeKernel, { strength: string; tradeoff: string; useFor: string }> = {
  lanczos3: {
    strength: 'Sharpest result, best detail preservation.',
    tradeoff: 'Slowest. Can introduce ringing on hard edges.',
    useFor: 'Default for photographic downscale / upscale.',
  },
  cubic: {
    strength: 'Good detail retention, faster than lanczos3.',
    tradeoff: 'Slightly softer than lanczos3.',
    useFor: 'Mid-fidelity downscale where speed matters.',
  },
  bilinear: {
    strength: 'Smooth gradients, no ringing.',
    tradeoff: 'Loses fine detail; soft.',
    useFor: 'Thumbnails, previews, anti-aliased gradients.',
  },
  nearest: {
    strength: 'Pixel-perfect, no smoothing.',
    tradeoff: 'Blocky on non-integer scales.',
    useFor: 'Pixel art, integer-scaled thumbnails, debugging.',
  },
}
