/**
 * image-ops.ts — Sharp pipeline for the `image_ops` MCP tool (Phase 2 Tier B, 2026-04-30).
 *
 * Six operations: crop / slice / resize / chroma-key / format-convert / composite.
 * No blend modes, no rotation in v1 — add only when an actual incident proves the need.
 *
 * Side effects: every op that produces a new file appends an entry to IMAGES.md
 * with status `B-ROLL` so CD can review.
 */

import sharp from 'sharp'
import { join } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, appendFile } from 'fs/promises'

/**
 * WP-IMG-1..4 (2026-05-06): every op now accepts optional `outputName` and
 * `overwrite`. When `overwrite` is true and `outputName` is omitted, the new
 * file CLOBBERS the source. `outputName` always wins when present (server
 * accepts an extension or strips it and applies its own).
 *
 * Slice's `namingPattern` supports `{stem}` (source basename, no ext),
 * `{n}` (1-based tile index), `{r}` (row), `{c}` (col), `{ext}` (source ext).
 * Default = `{stem}-tile-{n}` (mockup default). Backwards compat: omitting
 * the field falls back to the legacy `r{r}c{c}` suffix scheme.
 *
 * Resize's `kernel` maps to Sharp's kernel option (`lanczos3` is the Sharp
 * default; we accept `nearest`/`cubic`/`bilinear`/`lanczos3`).
 */
export type ImageOp =
  | { operation: 'crop'; params: ({ x: number; y: number; w: number; h: number } | { aspect: '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '21:9' }) & { outputName?: string; overwrite?: boolean } }
  | { operation: 'slice'; params: { rows: number; cols: number; namingPattern?: string } }
  | { operation: 'resize'; params: { w?: number; h?: number; fit?: 'cover' | 'contain'; kernel?: 'nearest' | 'cubic' | 'bilinear' | 'lanczos3'; outputName?: string; overwrite?: boolean } }
  | { operation: 'chroma-key'; params: { color?: string; tolerance?: number; feather?: number } }
  /**
   * WP-IMG-5 (2026-05-06): format-convert with quality, lossless, and two
   * optional add-ons.
   *
   *   to: 'png' | 'jpeg' | 'webp'   — output container
   *   quality: 1..100                — JPG always, WEBP when lossless=false
   *   lossless: boolean              — WEBP only (PNG is implicitly lossless)
   *   alphaMatte: { color: '#RRGGBB' }
   *                                  — JPG only (composite over flat color
   *                                    when source has alpha; default white).
   *                                    Server applies alphaMatte BEFORE
   *                                    encoding so the final JPG never has
   *                                    a black-fringe halo.
   *   chromaKey: { color, tolerance, feather }
   *                                  — PNG only (eyedropper-fed key + tol +
   *                                    feather). Generates an alpha channel
   *                                    keyed against `color` ± tolerance,
   *                                    feathered across `feather` px so the
   *                                    edge isn't aliased.
   */
  | {
      operation: 'format-convert'
      params: {
        to: 'png' | 'jpeg' | 'webp'
        quality?: number
        lossless?: boolean
        alphaMatte?: { color: string }
        chromaKey?: { color: string; tolerance?: number; feather?: number }
        outputName?: string
        overwrite?: boolean
      }
    }
  | {
      operation: 'composite'
      params: {
        source: string
        source_alpha?: boolean
        output: string
        position: { x: number; y: number } | { anchor: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }
        scale?: number
        opacity?: number
      }
    }

export interface ImageOpResult {
  ok: boolean
  error?: string
  outputs: string[] // filenames written, in session-folder-relative form
}

const ASPECT_MAP: Record<string, [number, number]> = {
  '16:9': [16, 9],
  '4:3': [4, 3],
  '1:1': [1, 1],
  '9:16': [9, 16],
  '3:4': [3, 4],
  '21:9': [21, 9],
}

function withSuffix(filename: string, suffix: string, newExt?: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot >= 0 ? filename.slice(0, dot) : filename
  const ext = newExt || (dot >= 0 ? filename.slice(dot + 1) : 'jpg')
  return `${base}-${suffix}.${ext}`
}

/**
 * WP-IMG-1..4 (2026-05-06): resolve the final output name for single-output ops.
 *
 * Precedence:
 *   1. `outputName` explicit  → used as-is (extension preserved or appended from source)
 *   2. `overwrite === true`   → returns the source filename (caller will clobber)
 *   3. fallback               → `withSuffix(filename, defaultSuffix, defaultExt?)`
 *
 * Always returns a filename (no path, no slashes).
 */
function resolveOutputName(
  filename: string,
  defaultSuffix: string,
  opts: { outputName?: string; overwrite?: boolean } = {},
  defaultExt?: string,
): string {
  if (opts.outputName && opts.outputName.trim().length > 0) {
    const raw = opts.outputName.trim()
    // If the user-provided name has an extension, keep it; otherwise borrow from source.
    if (/\.[a-z0-9]+$/i.test(raw)) return raw
    const dot = filename.lastIndexOf('.')
    const ext = defaultExt || (dot >= 0 ? filename.slice(dot + 1) : 'jpg')
    return `${raw}.${ext}`
  }
  if (opts.overwrite) return filename
  return withSuffix(filename, defaultSuffix, defaultExt)
}

/**
 * WP-IMG-3 (2026-05-06): slice naming-pattern interpolation.
 * Supported placeholders: {stem} {n} {r} {c} {ext}
 * `n` is 1-based across the whole grid (row-major). Falls back to the legacy
 * `r{r}c{c}` suffix when `pattern` is empty.
 */
function interpolateSlicePattern(
  filename: string,
  pattern: string | undefined,
  n: number,
  r: number,
  c: number,
): string {
  const dot = filename.lastIndexOf('.')
  const stem = dot >= 0 ? filename.slice(0, dot) : filename
  const ext = dot >= 0 ? filename.slice(dot + 1) : 'jpg'
  if (!pattern || pattern.trim().length === 0) {
    return `${stem}-r${r}c${c}.${ext}`
  }
  let out = pattern
    .replace(/\{stem\}/g, stem)
    .replace(/\{n\}/g, String(n))
    .replace(/\{r\}/g, String(r))
    .replace(/\{c\}/g, String(c))
    .replace(/\{ext\}/g, ext)
  if (!/\.[a-z0-9]+$/i.test(out)) out = `${out}.${ext}`
  return out
}

/**
 * WP-IMG-7 (2026-05-06): every image_ops output now writes a structured
 * `**Provenance:** image_ops:{operation}` field alongside the human-readable
 * `**Source:**` line. Parser (lib/session.ts → parseImagesMd) reads it into
 * `ParsedImageEntry.provenance`; find_assets filters on it; Sage uses it for
 * cross-session consolidation.
 *
 * `operation` is the typed op name: crop / slice / resize / chroma-key /
 * format-convert / composite. The colon-prefix convention `image_ops:`
 * keeps the namespace open for future tools (e.g. `nano:`, `gemini:`).
 *
 * `tag` is optional — when omitted, falls back to `B-ROLL` for parity with
 * existing behavior. WP-IMG-1's tag-chip footer threads the user's chosen
 * tag through here so the new output lands at the right status.
 */
async function appendImagesMdEntry(
  sessionDir: string,
  filename: string,
  opNote: string,
  operation: string,
  tag: string = 'B-ROLL',
) {
  const imagesPath = join(sessionDir, 'IMAGES.md')
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const entry = [
    '',
    `#### ${filename}`,
    `**Generated:** ${ts}`,
    `**Status:** ${tag}`,
    `**Source:** image_ops (${opNote})`,
    `**Provenance:** image_ops:${operation}`,
    '',
  ].join('\n')
  try {
    if (existsSync(imagesPath)) {
      await appendFile(imagesPath, entry, 'utf-8')
    } else {
      await writeFile(imagesPath, `# Image Registry\n\n## Manipulations\n${entry}`, 'utf-8')
    }
  } catch {
    // Best-effort — file write is the actual deliverable.
  }
}

/**
 * WP-IMG-7 (2026-05-06): `tag` lets the caller choose the IMAGES.md status
 * the output(s) land with (READY/APPROVED/HERO/B-ROLL/REDO/TRASH). Defaults
 * to `B-ROLL` for parity with pre-WP-7 behavior.
 */
export async function runImageOp(
  sessionDir: string,
  filename: string,
  op: ImageOp,
  tag: string = 'B-ROLL',
): Promise<ImageOpResult> {
  const srcPath = join(sessionDir, filename)
  if (!existsSync(srcPath)) {
    return { ok: false, error: `source not found: ${filename}`, outputs: [] }
  }

  try {
    switch (op.operation) {
      case 'crop': {
        const meta = await sharp(srcPath).metadata()
        const W = meta.width!
        const H = meta.height!
        let x: number, y: number, w: number, h: number
        if ('aspect' in op.params) {
          const [aw, ah] = ASPECT_MAP[op.params.aspect]
          // Center-crop to the target aspect
          const targetAspect = aw / ah
          const srcAspect = W / H
          if (srcAspect > targetAspect) {
            h = H
            w = Math.round(H * targetAspect)
            x = Math.round((W - w) / 2)
            y = 0
          } else {
            w = W
            h = Math.round(W / targetAspect)
            x = 0
            y = Math.round((H - h) / 2)
          }
        } else {
          ;({ x, y, w, h } = op.params)
        }
        // WP-IMG-2: outputName + overwrite. Overwrite is dangerous (clobbers
        // source on disk); the UI surfaces a confirm checkbox so user
        // explicitly opts in. We honor it as-is here.
        const out = resolveOutputName(filename, 'crop', op.params)
        await sharp(srcPath).extract({ left: x, top: y, width: w, height: h }).toFile(join(sessionDir, out))
        await appendImagesMdEntry(sessionDir, out, `crop from ${filename}`, 'crop', tag)
        return { ok: true, outputs: [out] }
      }

      case 'slice': {
        const { rows, cols, namingPattern } = op.params
        if (rows < 1 || cols < 1 || rows > 10 || cols > 10) {
          return { ok: false, error: 'rows + cols must be 1..10', outputs: [] }
        }
        const meta = await sharp(srcPath).metadata()
        const W = meta.width!
        const H = meta.height!
        const tileW = Math.floor(W / cols)
        const tileH = Math.floor(H / rows)
        const outputs: string[] = []
        // WP-IMG-3: row-major 1-based tile index for `{n}` placeholder.
        let n = 1
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const out = interpolateSlicePattern(filename, namingPattern, n, r, c)
            await sharp(srcPath)
              .extract({ left: c * tileW, top: r * tileH, width: tileW, height: tileH })
              .toFile(join(sessionDir, out))
            outputs.push(out)
            await appendImagesMdEntry(sessionDir, out, `slice ${rows}×${cols} of ${filename}`, 'slice', tag)
            n++
          }
        }
        return { ok: true, outputs }
      }

      case 'resize': {
        const { w, h, fit, kernel } = op.params
        if (!w && !h) return { ok: false, error: 'resize requires w or h', outputs: [] }
        const out = resolveOutputName(filename, 'resize', op.params)
        const sharpFit = fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : 'inside'
        // WP-IMG-4: kernel is optional. Sharp's `lanczos3` is the default
        // when omitted; the other named kernels map 1:1 to Sharp's enum.
        const sharpKernel = kernel
          ? (kernel === 'cubic' ? sharp.kernel.cubic
              : kernel === 'bilinear' ? sharp.kernel.linear // Sharp's `linear` IS bilinear
              : kernel === 'nearest' ? sharp.kernel.nearest
              : sharp.kernel.lanczos3)
          : undefined
        await sharp(srcPath)
          .resize({ width: w, height: h, fit: sharpFit, withoutEnlargement: !fit, kernel: sharpKernel })
          .toFile(join(sessionDir, out))
        await appendImagesMdEntry(sessionDir, out, `resize ${w || '?'}×${h || '?'}${kernel ? ` (${kernel})` : ''}`, 'resize', tag)
        return { ok: true, outputs: [out] }
      }

      case 'chroma-key': {
        const colorHex = (op.params.color || '#ff00ff').replace('#', '')
        const targetR = parseInt(colorHex.slice(0, 2), 16)
        const targetG = parseInt(colorHex.slice(2, 4), 16)
        const targetB = parseInt(colorHex.slice(4, 6), 16)
        const tol = op.params.tolerance ?? 30
        const { data, info } = await sharp(srcPath)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        const { width, height, channels } = info
        const buf = Buffer.from(data)
        for (let i = 0; i < buf.length; i += channels) {
          const r = buf[i]
          const g = buf[i + 1]
          const b = buf[i + 2]
          const dr = r - targetR
          const dg = g - targetG
          const db = b - targetB
          const dist = Math.sqrt(dr * dr + dg * dg + db * db)
          if (dist <= tol) buf[i + 3] = 0
        }
        const out = withSuffix(filename, 'chroma', 'png')
        await sharp(buf, { raw: { width, height, channels } })
          .png()
          .toFile(join(sessionDir, out))
        await appendImagesMdEntry(sessionDir, out, `chroma-key #${colorHex} ±${tol}`, 'chroma-key', tag)
        return { ok: true, outputs: [out] }
      }

      case 'format-convert': {
        // WP-IMG-5 (rev 2026-05-06, Ralph): both add-ons available across
        // ALL output formats (JPG / PNG / WEBP). The pipeline is:
        //
        //   1. chroma-key      — RGBA buffer pass: pixels matching `color`
        //                        ± tolerance get alpha=0; pixels in
        //                        `tolerance + feather` window get linear
        //                        falloff. Result is RGBA.
        //   2. alpha-matte     — `flatten({background: color})` composites
        //                        the (possibly chroma-keyed) RGBA over a
        //                        flat color. Result is RGB. JPG output uses
        //                        this implicitly when source has alpha and
        //                        matte is enabled; PNG/WEBP can use it to
        //                        bake a colored backdrop into the image.
        //   3. encode          — PNG / JPEG / WEBP with quality / lossless.
        //
        // The two passes are ORTHOGONAL — chroma-key produces alpha,
        // alpha-matte consumes alpha (replaces with flat color). Combining
        // them in JPEG = "remove green screen, replace with white". In PNG
        // = "remove green screen, optionally fill bg with brand color".
        const { to, quality, lossless, alphaMatte, chromaKey } = op.params
        if (!['png', 'jpeg', 'webp'].includes(to)) {
          return { ok: false, error: 'format must be png|jpeg|webp', outputs: [] }
        }
        const out = resolveOutputName(filename, 'fmt', op.params, to === 'jpeg' ? 'jpg' : to)

        let pipeline = sharp(srcPath)

        // ── Stage 1: chroma-key (any format) ──
        // Operates on raw RGBA buffer; result is fed back into Sharp as a
        // raw input so subsequent stages can chain on top.
        if (chromaKey) {
          const hexColor = chromaKey.color.replace('#', '')
          const tR = parseInt(hexColor.slice(0, 2), 16)
          const tG = parseInt(hexColor.slice(2, 4), 16)
          const tB = parseInt(hexColor.slice(4, 6), 16)
          const tol = chromaKey.tolerance ?? 30
          const feather = chromaKey.feather ?? 0
          const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
          const { width, height, channels } = info
          const buf = Buffer.from(data)
          for (let i = 0; i < buf.length; i += channels) {
            const dr = buf[i] - tR
            const dg = buf[i + 1] - tG
            const db = buf[i + 2] - tB
            const dist = Math.sqrt(dr * dr + dg * dg + db * db)
            if (dist <= tol) {
              buf[i + 3] = 0
            } else if (feather > 0 && dist <= tol + feather) {
              // Linear feather across the falloff window.
              const t = (dist - tol) / feather
              buf[i + 3] = Math.round(buf[i + 3] * Math.min(1, Math.max(0, t)))
            }
          }
          pipeline = sharp(buf, { raw: { width, height, channels } })
        }

        // ── Stage 2: alpha-matte (any format) ──
        // Composite over flat color. For JPEG this is mandatory when there's
        // alpha (otherwise Sharp fills with black on encode). For PNG/WEBP
        // it's optional — useful for "bake the chosen background INTO the
        // image" workflows.
        if (alphaMatte) {
          pipeline = pipeline.ensureAlpha().flatten({ background: alphaMatte.color || '#FFFFFF' })
        }

        // ── Stage 3: encode ──
        if (to === 'png') {
          pipeline = pipeline.png()
        } else if (to === 'jpeg') {
          // Defensive: even without alphaMatte, JPEG can't keep alpha.
          // Sharp's jpeg() handles this by calling its own background fill;
          // setting `background` explicitly avoids surprises with libvips
          // versions that default to black.
          if (!alphaMatte) {
            pipeline = pipeline.flatten({ background: '#FFFFFF' })
          }
          pipeline = pipeline.jpeg({
            quality: typeof quality === 'number' ? Math.max(1, Math.min(100, quality)) : 90,
          })
        } else if (to === 'webp') {
          if (lossless) {
            pipeline = pipeline.webp({ lossless: true })
          } else {
            pipeline = pipeline.webp({
              quality: typeof quality === 'number' ? Math.max(1, Math.min(100, quality)) : 80,
            })
          }
        }

        await pipeline.toFile(join(sessionDir, out))
        const noteParts = [`format → ${to}`]
        if (chromaKey) noteParts.push(`+ chroma-key ${chromaKey.color}`)
        if (alphaMatte) noteParts.push(`+ alpha-matte ${alphaMatte.color}`)
        if (to === 'webp' && lossless) noteParts.push('+ lossless')
        await appendImagesMdEntry(sessionDir, out, noteParts.join(' '), 'format-convert', tag)
        return { ok: true, outputs: [out] }
      }

      case 'composite': {
        const { source, output, position, scale, opacity, source_alpha } = op.params
        const sourcePath = join(sessionDir, source)
        if (!existsSync(sourcePath)) {
          return { ok: false, error: `composite source not found: ${source}`, outputs: [] }
        }
        const baseMeta = await sharp(srcPath).metadata()
        const ovMeta = await sharp(sourcePath).metadata()
        let ovBuf: Buffer
        if (scale && scale !== 1.0) {
          const newW = Math.round(ovMeta.width! * scale)
          const newH = Math.round(ovMeta.height! * scale)
          ovBuf = await sharp(sourcePath).resize(newW, newH).toBuffer()
        } else {
          ovBuf = await readFile(sourcePath)
        }
        // Apply opacity by manipulating alpha channel.
        if (typeof opacity === 'number' && opacity < 1.0) {
          ovBuf = await sharp(ovBuf)
            .ensureAlpha()
            .composite([
              {
                input: Buffer.from([255, 255, 255, Math.round(opacity * 255)]),
                raw: { width: 1, height: 1, channels: 4 },
                tile: true,
                blend: 'dest-in',
              },
            ])
            .toBuffer()
        }
        const ovAfterMeta = await sharp(ovBuf).metadata()
        const ovW = ovAfterMeta.width!
        const ovH = ovAfterMeta.height!
        const baseW = baseMeta.width!
        const baseH = baseMeta.height!
        let left = 0
        let top = 0
        if ('x' in position) {
          left = position.x
          top = position.y
        } else {
          switch (position.anchor) {
            case 'center':
              left = Math.round((baseW - ovW) / 2)
              top = Math.round((baseH - ovH) / 2)
              break
            case 'top-left':
              left = 0; top = 0
              break
            case 'top-right':
              left = baseW - ovW; top = 0
              break
            case 'bottom-left':
              left = 0; top = baseH - ovH
              break
            case 'bottom-right':
              left = baseW - ovW; top = baseH - ovH
              break
          }
        }
        await sharp(srcPath)
          .composite([{ input: ovBuf, left, top }])
          .toFile(join(sessionDir, output))
        // Honor source_alpha is implicit in Sharp (PNG transparency preserved).
        await appendImagesMdEntry(sessionDir, output, `composite ${source} on ${filename}`, 'composite', tag)
        return { ok: true, outputs: [output] }
      }

      default:
        // @ts-expect-error exhaustive
        return { ok: false, error: `unknown op: ${op.operation}`, outputs: [] }
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message, outputs: [] }
  }
}
