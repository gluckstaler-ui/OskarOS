/**
 * Tests for upsertImageMetadata's parentPromptId behavior (Ralph 2026-05-04).
 *
 * The bug: when CD called propose_image_prompt to write `### img-goofy-v1`
 * and the user clicked Generate on its panel card, the resulting Goofy
 * image got written to IMAGES.md as a `#### filename` block at the END
 * of `## Image Prompts + Generated`. Because the parser splits each
 * `### img-N` block on `\n#### ` to find children, the new entry got
 * attached to whichever `### img-N` happened to be last — NOT to img-goofy-v1.
 * Visual result: Goofy showed up in the "Uploaded Images" cluster.
 *
 * Fix: pass parentPromptId from the panel → /api/edit-image → upsertImageMetadata.
 * The writer inserts the `#### filename` block AFTER the parent's body
 * but BEFORE the next `### `. Parser then nests it correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { upsertImageMetadata } from './images-md-writer'

const TEST_SESSION_ID = '__test-images-md-writer-parent__'
const TEST_DIR = join(process.cwd(), 'public', TEST_SESSION_ID)
const TEST_IMAGES_MD = join(TEST_DIR, 'IMAGES.md')

function seed(md: string) {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(TEST_IMAGES_MD, md, 'utf-8')
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('upsertImageMetadata — parentPromptId nesting', () => {
  it('inserts #### filename DIRECTLY AFTER the parent ### img-N block', async () => {
    seed([
      '# Image Registry',
      '',
      '## Uploaded Images',
      '',
      '## Image Prompts + Generated',
      '',
      '### img-goofy-v1',
      '**Vibe:** shared',
      '**Purpose:** character',
      '**Aspect Ratio:** 1:1',
      '**Status:** PENDING',
      '**Prompt:** A goofy cartoon dog.',
      '',
      '---',
      '',
      '### img-mickey-v1',
      '**Vibe:** shared',
      '**Status:** PENDING',
      '**Prompt:** Mickey Mouse.',
      '',
    ].join('\n'))

    await upsertImageMetadata(TEST_DIR, 'goofy-1234567890.jpg', {
      status: 'READY',
      evaluation: 'A friendly dog character with orange turtleneck.',
      parentPromptId: 'img-goofy-v1',
    })

    const md = readFileSync(TEST_IMAGES_MD, 'utf-8')
    const goofyParentIdx = md.indexOf('### img-goofy-v1')
    const generatedIdx = md.indexOf('#### goofy-1234567890.jpg')
    const mickeyParentIdx = md.indexOf('### img-mickey-v1')

    // The new #### block lives BETWEEN goofy parent and mickey parent.
    expect(goofyParentIdx).toBeGreaterThanOrEqual(0)
    expect(generatedIdx).toBeGreaterThan(goofyParentIdx)
    expect(generatedIdx).toBeLessThan(mickeyParentIdx)
    // The new entry uses #### (4 hashes), NOT ### — that's what the parser
    // requires to nest under the parent.
    expect(md).toMatch(/^#### goofy-1234567890\.jpg/m)
  })

  it('falls back to end-of-section append when parentPromptId is not found', async () => {
    seed([
      '## Image Prompts + Generated',
      '',
      '### img-001',
      '**Status:** PENDING',
      '**Prompt:** existing',
      '',
    ].join('\n'))

    await upsertImageMetadata(TEST_DIR, 'orphan.jpg', {
      status: 'READY',
      parentPromptId: 'img-does-not-exist',
    })

    const md = readFileSync(TEST_IMAGES_MD, 'utf-8')
    // Still landed under the section, just at the tail rather than nested
    // under a specific parent.
    expect(md).toMatch(/^#### orphan\.jpg/m)
    expect(md).toMatch(/## Image Prompts \+ Generated/)
  })

  it('without parentPromptId, behaves identically to pre-fix (end-of-section)', async () => {
    seed([
      '## Image Prompts + Generated',
      '',
      '### img-first',
      '**Status:** PENDING',
      '**Prompt:** first',
      '',
      '### img-last',
      '**Status:** PENDING',
      '**Prompt:** last',
      '',
    ].join('\n'))

    await upsertImageMetadata(TEST_DIR, 'unspecified.jpg', { status: 'READY' })

    const md = readFileSync(TEST_IMAGES_MD, 'utf-8')
    const lastIdx = md.indexOf('### img-last')
    const newIdx = md.indexOf('#### unspecified.jpg')
    // Lands AFTER img-last (at section tail).
    expect(newIdx).toBeGreaterThan(lastIdx)
  })

  it('when parent block has existing #### children, new entry lands AFTER them', async () => {
    seed([
      '## Image Prompts + Generated',
      '',
      '### img-goofy-v1',
      '**Status:** PENDING',
      '**Prompt:** goofy',
      '',
      '#### goofy-old.jpg',
      '**Status:** READY',
      '',
      '### img-next',
      '**Status:** PENDING',
      '**Prompt:** next',
      '',
    ].join('\n'))

    await upsertImageMetadata(TEST_DIR, 'goofy-new.jpg', {
      status: 'READY',
      parentPromptId: 'img-goofy-v1',
    })

    const md = readFileSync(TEST_IMAGES_MD, 'utf-8')
    const oldIdx = md.indexOf('#### goofy-old.jpg')
    const newIdx = md.indexOf('#### goofy-new.jpg')
    const nextParentIdx = md.indexOf('### img-next')

    // New child lands AFTER the existing child but BEFORE the next parent.
    expect(oldIdx).toBeGreaterThan(0)
    expect(newIdx).toBeGreaterThan(oldIdx)
    expect(newIdx).toBeLessThan(nextParentIdx)
  })
})
