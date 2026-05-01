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

export type ImageOp =
  | { operation: 'crop'; params: { x: number; y: number; w: number; h: number } | { aspect: '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '21:9' } }
  | { operation: 'slice'; params: { rows: number; cols: number } }
  | { operation: 'resize'; params: { w?: number; h?: number; fit?: 'cover' | 'contain' } }
  | { operation: 'chroma-key'; params: { color?: string; tolerance?: number } }
  | { operation: 'format-convert'; params: { to: 'png' | 'jpeg' | 'webp' } }
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

async function appendImagesMdEntry(sessionDir: string, filename: string, opNote: string) {
  const imagesPath = join(sessionDir, 'IMAGES.md')
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const entry = [
    '',
    `#### ${filename}`,
    `**Generated:** ${ts}`,
    `**Status:** B-ROLL`,
    `**Source:** image_ops (${opNote})`,
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

export async function runImageOp(
  sessionDir: string,
  filename: string,
  op: ImageOp,
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
        const out = withSuffix(filename, 'crop')
        await sharp(srcPath).extract({ left: x, top: y, width: w, height: h }).toFile(join(sessionDir, out))
        await appendImagesMdEntry(sessionDir, out, `crop from ${filename}`)
        return { ok: true, outputs: [out] }
      }

      case 'slice': {
        const { rows, cols } = op.params
        if (rows < 1 || cols < 1 || rows > 10 || cols > 10) {
          return { ok: false, error: 'rows + cols must be 1..10', outputs: [] }
        }
        const meta = await sharp(srcPath).metadata()
        const W = meta.width!
        const H = meta.height!
        const tileW = Math.floor(W / cols)
        const tileH = Math.floor(H / rows)
        const outputs: string[] = []
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const out = withSuffix(filename, `r${r}c${c}`)
            await sharp(srcPath)
              .extract({ left: c * tileW, top: r * tileH, width: tileW, height: tileH })
              .toFile(join(sessionDir, out))
            outputs.push(out)
            await appendImagesMdEntry(sessionDir, out, `slice ${rows}×${cols} of ${filename}`)
          }
        }
        return { ok: true, outputs }
      }

      case 'resize': {
        const { w, h, fit } = op.params
        if (!w && !h) return { ok: false, error: 'resize requires w or h', outputs: [] }
        const out = withSuffix(filename, 'resize')
        const sharpFit = fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : 'inside'
        await sharp(srcPath)
          .resize({ width: w, height: h, fit: sharpFit, withoutEnlargement: !fit })
          .toFile(join(sessionDir, out))
        await appendImagesMdEntry(sessionDir, out, `resize ${w || '?'}×${h || '?'}`)
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
        await appendImagesMdEntry(sessionDir, out, `chroma-key #${colorHex} ±${tol}`)
        return { ok: true, outputs: [out] }
      }

      case 'format-convert': {
        const { to } = op.params
        if (!['png', 'jpeg', 'webp'].includes(to)) {
          return { ok: false, error: 'format must be png|jpeg|webp', outputs: [] }
        }
        const out = withSuffix(filename, 'fmt', to === 'jpeg' ? 'jpg' : to)
        let pipeline = sharp(srcPath)
        if (to === 'png') pipeline = pipeline.png()
        else if (to === 'jpeg') pipeline = pipeline.jpeg()
        else pipeline = pipeline.webp()
        await pipeline.toFile(join(sessionDir, out))
        await appendImagesMdEntry(sessionDir, out, `format → ${to}`)
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
        await appendImagesMdEntry(sessionDir, output, `composite ${source} on ${filename}`)
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
