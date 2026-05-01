/**
 * image-ops.test.ts — Phase 2 Tier B (2026-04-30).
 *
 * Per-operation tests using a real Sharp pipeline against in-memory PNGs.
 * Uses a tmp session dir; no fixtures committed to disk.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import sharp from 'sharp'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runImageOp } from '../image-ops'

let sessionDir: string

beforeAll(async () => {
  sessionDir = mkdtempSync(join(tmpdir(), 'image-ops-test-'))
  // Make a 100x100 magenta PNG (chroma-key fixture)
  const magenta = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 255 } },
  }).png().toBuffer()
  writeFileSync(join(sessionDir, 'magenta.png'), magenta)

  // 200x100 cyan landscape (for crop / resize / format-convert)
  const cyan = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 200, b: 200 } },
  }).png().toBuffer()
  writeFileSync(join(sessionDir, 'cyan.png'), cyan)

  // 50x50 red square (composite source)
  const red = await sharp({
    create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer()
  writeFileSync(join(sessionDir, 'red.png'), red)
})

afterAll(() => {
  if (sessionDir) rmSync(sessionDir, { recursive: true, force: true })
})

describe('image_ops', () => {
  describe('crop', () => {
    it('crops by explicit rect', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'crop',
        params: { x: 0, y: 0, w: 50, h: 50 },
      })
      expect(r.ok).toBe(true)
      expect(r.outputs).toHaveLength(1)
      const meta = await sharp(join(sessionDir, r.outputs[0])).metadata()
      expect(meta.width).toBe(50)
      expect(meta.height).toBe(50)
    })

    it('crops by aspect ratio (1:1 from 200x100 → 100x100)', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'crop',
        params: { aspect: '1:1' },
      })
      expect(r.ok).toBe(true)
      const meta = await sharp(join(sessionDir, r.outputs[0])).metadata()
      expect(meta.width).toBe(100)
      expect(meta.height).toBe(100)
    })
  })

  describe('slice', () => {
    it('slices 2x2 → 4 files', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'slice',
        params: { rows: 2, cols: 2 },
      })
      expect(r.ok).toBe(true)
      expect(r.outputs).toHaveLength(4)
      for (const f of r.outputs) {
        expect(existsSync(join(sessionDir, f))).toBe(true)
      }
    })

    it('rejects rows < 1', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'slice',
        params: { rows: 0, cols: 2 },
      })
      expect(r.ok).toBe(false)
    })
  })

  describe('resize', () => {
    it('resizes to width', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'resize',
        params: { w: 100 },
      })
      expect(r.ok).toBe(true)
      const meta = await sharp(join(sessionDir, r.outputs[0])).metadata()
      expect(meta.width).toBe(100)
    })

    it('rejects missing dimensions', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'resize',
        params: {},
      })
      expect(r.ok).toBe(false)
    })
  })

  describe('chroma-key', () => {
    it('makes magenta pixels transparent', async () => {
      const r = await runImageOp(sessionDir, 'magenta.png', {
        operation: 'chroma-key',
        params: { color: '#ff00ff', tolerance: 10 },
      })
      expect(r.ok).toBe(true)
      const out = join(sessionDir, r.outputs[0])
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
      expect(info.channels).toBe(4)
      // Sample pixel: should have alpha=0
      expect(data[3]).toBe(0)
    })
  })

  describe('format-convert', () => {
    it('converts PNG → WebP', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'format-convert',
        params: { to: 'webp' },
      })
      expect(r.ok).toBe(true)
      expect(r.outputs[0]).toMatch(/\.webp$/)
      const meta = await sharp(join(sessionDir, r.outputs[0])).metadata()
      expect(meta.format).toBe('webp')
    })

    it('rejects unsupported format', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'format-convert',
        params: { to: 'gif' as any },
      })
      expect(r.ok).toBe(false)
    })
  })

  describe('composite', () => {
    it('overlays source on destination at center', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'composite',
        params: {
          source: 'red.png',
          output: 'composited.png',
          position: { anchor: 'center' },
        },
      })
      expect(r.ok).toBe(true)
      expect(existsSync(join(sessionDir, 'composited.png'))).toBe(true)
    })

    it('errors when composite source is missing', async () => {
      const r = await runImageOp(sessionDir, 'cyan.png', {
        operation: 'composite',
        params: {
          source: 'does-not-exist.png',
          output: 'fail.png',
          position: { x: 0, y: 0 },
        },
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/not found/i)
    })
  })

  it('errors cleanly when source filename is missing', async () => {
    const r = await runImageOp(sessionDir, 'ghost.png', {
      operation: 'crop',
      params: { x: 0, y: 0, w: 10, h: 10 },
    })
    expect(r.ok).toBe(false)
  })
})
