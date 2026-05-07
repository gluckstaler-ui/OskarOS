/**
 * components/image-mode/proposed-filename.ts — client-side mirror of the
 * server's filename-resolution rules in `lib/image-ops.ts`. Used by every
 * tool body to surface a "→ {will-write}" hint under the filename input so
 * the user knows what file will land BEFORE clicking Generate.
 *
 * Mirrors:
 *   - resolveOutputName  (crop, resize, format-convert single-output)
 *   - withSuffix         (legacy single-output suffixing)
 *   - interpolateSlicePattern (slice multi-output naming-pattern)
 *
 * Keep in sync with lib/image-ops.ts. If the server adds a new placeholder
 * or a new precedence rule, update this file too — they're a coupled pair.
 * No shared schema yet (the server is server-only); a future WP could lift
 * both into a shared lib/filename-rules.ts that browser + server both
 * import. Logged as a "drift risk if forgotten" follow-up.
 */

import type { ImageOpsState } from './types'

// ─────────────────────────────────────────────────────────────────────────────

function splitExt(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return { stem: filename, ext: 'jpg' }
  return { stem: filename.slice(0, dot), ext: filename.slice(dot + 1) }
}

function resolveSingle(
  source: string,
  defaultSuffix: string,
  opts: { outputName?: string; overwrite?: boolean },
  defaultExt?: string,
): string {
  if (opts.outputName && opts.outputName.trim()) {
    const raw = opts.outputName.trim()
    if (/\.[a-z0-9]+$/i.test(raw)) return raw
    const { ext } = splitExt(source)
    return `${raw}.${defaultExt ?? ext}`
  }
  if (opts.overwrite) return source
  const { stem, ext } = splitExt(source)
  return `${stem}-${defaultSuffix}.${defaultExt ?? ext}`
}

function interpolateSlice(
  source: string,
  pattern: string | undefined,
  n: number,
  r: number,
  c: number,
): string {
  const { stem, ext } = splitExt(source)
  if (!pattern || !pattern.trim()) return `${stem}-r${r}c${c}.${ext}`
  let out = pattern
    .replace(/\{stem\}/g, stem)
    .replace(/\{n\}/g, String(n))
    .replace(/\{r\}/g, String(r))
    .replace(/\{c\}/g, String(c))
    .replace(/\{ext\}/g, ext)
  if (!/\.[a-z0-9]+$/i.test(out)) out = `${out}.${ext}`
  return out
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ProposedFilenamePreview {
  /** Single-line summary string the body can render below the input. */
  summary: string
  /** Optional second-line nuance ("→ N files", etc.). */
  note?: string
  /**
   * Bare resolved filename (no `→ ` prefix). Used by the auto-fill hook to
   * pre-populate the filename input. For SLICE this is the FIRST tile's
   * name; the multi-output count lives in `note`.
   */
  bareName: string
}

/**
 * Compute the proposed filename for the active tool. Returns a summary
 * suitable for display under the filename input.
 *
 * Tool-specific rules:
 *   - CROP / RESIZE / FORMAT-CONVERT: single output. Name resolves via
 *     `resolveSingle`. We surface the resolved name verbatim. When
 *     `overwrite=true`, we add a destructive note.
 *   - SLICE: N outputs. We show the FIRST tile's filename + a count, e.g.
 *     "→ {stem}-tile-1.jpg + N more". The user can read the pattern from
 *     the inline tokens too.
 */
export function computeProposedFilename(
  source: string | null,
  state: ImageOpsState,
): ProposedFilenamePreview | null {
  if (!source) return null

  switch (state.tool) {
    case 'crop': {
      // Pre-populate uses the SUFFIX form (no user input yet). When the
      // user types something custom into the filename input, that becomes
      // `outputName` and resolveSingle returns it as-is.
      const bareName = resolveSingle(source, 'crop', {
        outputName: state.cropFilename || undefined,
        overwrite: state.cropOverwrite || undefined,
      })
      return { summary: `→ ${bareName}`, bareName }
    }

    case 'resize': {
      const bareName = resolveSingle(source, 'resize', {
        outputName: state.resizeFilename || undefined,
        overwrite: state.resizeOverwrite || undefined,
      })
      return { summary: `→ ${bareName}`, bareName }
    }

    case 'format-convert': {
      const newExt =
        state.formatTo === 'jpeg' ? 'jpg'
          : state.formatTo === 'png' ? 'png'
            : 'webp'
      const bareName = resolveSingle(
        source,
        'fmt',
        {
          outputName: state.formatFilename || undefined,
          overwrite: state.formatOverwrite || undefined,
        },
        newExt,
      )
      return { summary: `→ ${bareName}`, bareName }
    }

    case 'slice': {
      const cols = Math.max(1, Math.min(6, state.sliceCols))
      const rows = Math.max(1, Math.min(6, state.sliceRows))
      const total = cols * rows
      const first = interpolateSlice(source, state.sliceNamingPattern, 1, 0, 0)
      const last = interpolateSlice(source, state.sliceNamingPattern, total, rows - 1, cols - 1)
      return {
        summary: total === 1
          ? `→ ${first}`
          : `→ ${first} … ${last}`,
        note: total > 1 ? `${total} files total` : undefined,
        bareName: first, // Slice uses naming-pattern, not a single filename input
      }
    }

    default:
      return null
  }
}
