/**
 * components/image-mode/run-op.ts — translates the Workshop's state into a
 * `/api/mcp/image-ops` POST and returns a typed result. Centralized here so
 * both the Workshop's Generate button and any future automation (CD-driven
 * ops, batch flows) hit the same encoder.
 *
 * The MCP route returns `{ok: true, outputs: [{filename, dimensions, sizeKB}]}`
 * on success or `{error}` (HTTP 4xx/5xx) on failure.
 */

import type { ImageOpsState } from './types'

export interface OutputInfo {
  filename: string
  dimensions: string // 'WxH'
  sizeKB: number
}

export interface RunOpResult {
  ok: boolean
  outputs: OutputInfo[]
  error?: string
}

export interface RunOpInput {
  sessionId: string
  filename: string
  state: ImageOpsState
  imageNaturalSize: { naturalW: number; naturalH: number } | null
}

/**
 * Convert Workshop state into the MCP image-ops payload for the active tool.
 */
function buildPayload(input: RunOpInput): { operation: string; params: any } | { error: string } {
  const { state, imageNaturalSize } = input

  switch (state.tool) {
    case 'crop': {
      // Need either an explicit rect OR an aspect-only (server centers).
      // The UI maintains `cropRect` once the user has touched the marquee.
      if (state.cropRect) {
        const r = state.cropRect
        if (r.w <= 0 || r.h <= 0) {
          return { error: 'crop rect has zero size' }
        }
        return {
          operation: 'crop',
          params: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.w),
            h: Math.round(r.h),
            outputName: state.cropFilename || undefined,
            overwrite: state.cropOverwrite || undefined,
          },
        }
      }
      // No rect set yet — fall back to centered aspect crop. Server's aspect
      // mapping doesn't include `2:3` or `9:16` for plain center-crop; if the
      // user picked one of those without dragging the marquee, fail loudly so
      // they don't silently get a different aspect.
      const aspectKey = state.cropAspect
      if (aspectKey === 'free') {
        return { error: 'no crop region selected — drag the marquee or pick an aspect chip' }
      }
      const supported = new Set(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3'])
      if (!supported.has(aspectKey)) {
        return { error: `aspect '${aspectKey}' requires a marquee selection` }
      }
      // Compute server-side params manually for parity with the explicit rect path.
      if (!imageNaturalSize) {
        return { error: 'image dimensions not loaded yet' }
      }
      const [aw, ah] = aspectKey.split(':').map((n) => parseInt(n, 10))
      const target = aw / ah
      const src = imageNaturalSize.naturalW / imageNaturalSize.naturalH
      let cw: number, ch: number, cx: number, cy: number
      if (src > target) {
        ch = imageNaturalSize.naturalH
        cw = Math.round(ch * target)
        cx = Math.round((imageNaturalSize.naturalW - cw) / 2)
        cy = 0
      } else {
        cw = imageNaturalSize.naturalW
        ch = Math.round(cw / target)
        cx = 0
        cy = Math.round((imageNaturalSize.naturalH - ch) / 2)
      }
      return {
        operation: 'crop',
        params: {
          x: cx,
          y: cy,
          w: cw,
          h: ch,
          outputName: state.cropFilename || undefined,
          overwrite: state.cropOverwrite || undefined,
        },
      }
    }

    case 'slice': {
      if (state.sliceCols < 1 || state.sliceRows < 1) {
        return { error: 'slice cols/rows must be ≥ 1' }
      }
      return {
        operation: 'slice',
        params: {
          rows: state.sliceRows,
          cols: state.sliceCols,
          namingPattern: state.sliceNamingPattern || undefined,
        },
      }
    }

    case 'resize': {
      if (state.resizeWidth < 1) {
        return { error: 'resize width must be ≥ 1' }
      }
      // Height is computed by Sharp when we omit `h` and pass `fit: inside` (default).
      // Aspect-locked resize uses both w + h so the source's aspect doesn't constrain.
      let h: number | undefined
      if (state.resizeAspect !== 'free' && imageNaturalSize) {
        const [aw, ah] = state.resizeAspect.split(':').map((n) => parseInt(n, 10))
        h = Math.round((state.resizeWidth * ah) / aw)
      }
      return {
        operation: 'resize',
        params: {
          w: state.resizeWidth,
          h,
          fit: state.resizeAspect !== 'free' ? 'cover' : undefined,
          kernel: state.resizeKernel,
          outputName: state.resizeFilename || undefined,
          overwrite: state.resizeOverwrite || undefined,
        },
      }
    }

    case 'format-convert': {
      // Both add-ons are universally available across all output formats
      // (Ralph rev 2026-05-06). The UI surfaces them as opt-in toggles;
      // when toggled OFF they're omitted from the payload here so the
      // backend pipeline skips the corresponding stage cleanly.
      const params: Record<string, unknown> = {
        to: state.formatTo,
        outputName: state.formatFilename || undefined,
        overwrite: state.formatOverwrite || undefined,
      }
      // Quality (JPG always; WEBP when not lossless). PNG ignores quality.
      if (state.formatTo === 'jpeg') {
        params.quality = state.formatQuality
      } else if (state.formatTo === 'webp') {
        if (state.formatLossless) params.lossless = true
        else params.quality = state.formatQuality
      }
      // Add-ons: include only when the user has explicitly enabled them.
      // Inclusion check is the addon-row's "enabled" state in FormatBody;
      // here we read the per-addon state fields. Empty string = "not set".
      if (state.alphaMatteEnabled) {
        params.alphaMatte = { color: state.alphaMatteColor }
      }
      if (state.chromaKeyEnabled) {
        params.chromaKey = {
          color: state.chromaKeyColor,
          tolerance: state.chromaKeyTolerance,
          feather: state.chromaKeyFeather,
        }
      }
      return { operation: 'format-convert', params }
    }

    default:
      return { error: `tool '${state.tool}' not implemented yet` }
  }
}

export async function runImageOpsCall(input: RunOpInput): Promise<RunOpResult> {
  const built = buildPayload(input)
  if ('error' in built) {
    return { ok: false, outputs: [], error: built.error }
  }

  try {
    const res = await fetch('/api/mcp/image-ops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: input.sessionId,
        filename: input.filename,
        operation: built.operation,
        params: built.params,
        // WP-IMG-7 (2026-05-06): tag-chip threading. Workshop's footer-chip
        // selection determines the IMAGES.md status the new output(s) land
        // with. Sent at the top level (route extracts it before dispatching
        // to the typed op handler).
        tag: input.state.tagChip,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        outputs: [],
        error: data.error || `HTTP ${res.status}`,
      }
    }
    return { ok: true, outputs: data.outputs as OutputInfo[] }
  } catch (err) {
    return {
      ok: false,
      outputs: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
