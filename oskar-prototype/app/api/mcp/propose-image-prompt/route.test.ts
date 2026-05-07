/**
 * Tests for /api/mcp/propose-image-prompt (Ralph 2026-05-04, Bug I).
 *
 * Locks the contract: validate inputs, build a parser-clean ### img-N
 * PENDING block, insert under `## Image Prompts + Generated`, publish
 * `assets_updated`. Round-trips through a real session-folder fixture
 * so the parser-shape assertion is end-to-end (not a mock).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({ publish: publishMock }))

import { POST } from './route'

const TEST_SESSION_ID = '__test-propose-image-prompt__'
const TEST_DIR = join(process.cwd(), 'public', TEST_SESSION_ID)
const TEST_IMAGES_MD = join(TEST_DIR, 'IMAGES.md')

function makeRequest(body: unknown) {
  return new Request('http://test/api/mcp/propose-image-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
  publishMock.mockReset()
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('POST /api/mcp/propose-image-prompt — validation', () => {
  it('400 when sessionId missing', async () => {
    const r = await POST(makeRequest({ vibe: 'v', purpose: 'p', aspectRatio: '1:1', prompt: 'x' }))
    expect(r.status).toBe(400)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('400 when vibe missing', async () => {
    const r = await POST(makeRequest({ sessionId: TEST_SESSION_ID, purpose: 'p', aspectRatio: '1:1', prompt: 'x' }))
    expect(r.status).toBe(400)
  })

  it('400 when purpose missing', async () => {
    const r = await POST(makeRequest({ sessionId: TEST_SESSION_ID, vibe: 'v', aspectRatio: '1:1', prompt: 'x' }))
    expect(r.status).toBe(400)
  })

  it('400 when aspectRatio is not a recognized value', async () => {
    const r = await POST(makeRequest({ sessionId: TEST_SESSION_ID, vibe: 'v', purpose: 'p', aspectRatio: '7:9', prompt: 'x' }))
    expect(r.status).toBe(400)
    const body = await (r as Response).json()
    expect(body.error).toMatch(/aspectRatio/)
  })

  it('400 when prompt is empty/whitespace', async () => {
    const r = await POST(makeRequest({ sessionId: TEST_SESSION_ID, vibe: 'v', purpose: 'p', aspectRatio: '1:1', prompt: '   ' }))
    expect(r.status).toBe(400)
  })

  it('400 when explicit id is malformed', async () => {
    const r = await POST(makeRequest({
      sessionId: TEST_SESSION_ID,
      vibe: 'v', purpose: 'p', aspectRatio: '1:1', prompt: 'x',
      id: 'not-a-valid-id',  // missing img- prefix
    }))
    expect(r.status).toBe(400)
  })
})

describe('POST /api/mcp/propose-image-prompt — happy path', () => {
  it('creates IMAGES.md + ## Image Prompts + Generated when neither exists', async () => {
    const r = await POST(makeRequest({
      sessionId: TEST_SESSION_ID,
      vibe: 'shared', purpose: 'hero', aspectRatio: '16:9',
      prompt: 'A cat standing on a camel.',
    }))
    expect(r.status).toBe(200)
    const body = await (r as Response).json()
    expect(body.ok).toBe(true)
    expect(body.id).toBe('img-001')

    const md = readFileSync(TEST_IMAGES_MD, 'utf-8')
    expect(md).toMatch(/^## Image Prompts \+ Generated/m)
    expect(md).toMatch(/^### img-001\b/m)
    expect(md).toMatch(/\*\*Vibe:\*\* shared/)
    expect(md).toMatch(/\*\*Purpose:\*\* hero/)
    expect(md).toMatch(/\*\*Aspect Ratio:\*\* 16:9/)
    expect(md).toMatch(/\*\*Status:\*\* PENDING/)
    expect(md).toMatch(/\*\*Prompt:\*\* A cat standing on a camel\./)
  })

  it('publishes assets_updated with reason=propose_image_prompt + the new id', async () => {
    await POST(makeRequest({
      sessionId: TEST_SESSION_ID,
      vibe: 'shared', purpose: 'hero', aspectRatio: '1:1', prompt: 'x',
    }))
    expect(publishMock).toHaveBeenCalledWith(TEST_SESSION_ID, expect.objectContaining({
      type: 'assets_updated',
      reason: 'propose_image_prompt',
      id: 'img-001',
    }))
  })

  it('auto-numbers img-N past the highest existing numeric entry', async () => {
    writeFileSync(TEST_IMAGES_MD, [
      '## Image Prompts + Generated',
      '',
      '### img-001',
      '**Vibe:** v', '**Purpose:** p', '**Aspect Ratio:** 1:1', '**Status:** ACTIVE',
      '**Prompt:** old',
      '',
      '---',
      '',
      '### img-007',
      '**Vibe:** v', '**Purpose:** p', '**Aspect Ratio:** 1:1', '**Status:** ACTIVE',
      '**Prompt:** old',
      '',
    ].join('\n'), 'utf-8')

    const r = await POST(makeRequest({
      sessionId: TEST_SESSION_ID,
      vibe: 'v', purpose: 'p', aspectRatio: '1:1', prompt: 'fresh',
    }))
    const body = await (r as Response).json()
    expect(body.id).toBe('img-008')

    const md = readFileSync(TEST_IMAGES_MD, 'utf-8')
    expect(md).toMatch(/^### img-008\b/m)
    // Old entries preserved
    expect(md).toMatch(/^### img-001\b/m)
    expect(md).toMatch(/^### img-007\b/m)
  })

  it('skips named entries (img-goofy-v1) when auto-numbering', async () => {
    writeFileSync(TEST_IMAGES_MD, [
      '## Image Prompts + Generated',
      '',
      '### img-goofy-v1',
      '**Vibe:** v', '**Purpose:** p', '**Aspect Ratio:** 1:1', '**Status:** PENDING',
      '**Prompt:** A goofy dog.',
      '',
    ].join('\n'), 'utf-8')

    const r = await POST(makeRequest({
      sessionId: TEST_SESSION_ID,
      vibe: 'v', purpose: 'p', aspectRatio: '1:1', prompt: 'next one',
    }))
    const body = await (r as Response).json()
    // Numeric counter starts at 0, so first auto-number is img-001
    // (the named img-goofy-v1 doesn't bump the counter).
    expect(body.id).toBe('img-001')
  })

  it('respects an explicit id like img-goofy-v1', async () => {
    const r = await POST(makeRequest({
      sessionId: TEST_SESSION_ID,
      vibe: 'shared', purpose: 'hero', aspectRatio: '4:3',
      prompt: 'A friendly dog character.',
      id: 'img-goofy-v1',
    }))
    expect(r.status).toBe(200)
    const body = await (r as Response).json()
    expect(body.id).toBe('img-goofy-v1')

    const md = readFileSync(TEST_IMAGES_MD, 'utf-8')
    expect(md).toMatch(/^### img-goofy-v1\b/m)
  })

  it('appends new entry to existing ## Image Prompts + Generated section', async () => {
    writeFileSync(TEST_IMAGES_MD, [
      '## Uploaded Images',
      '',
      '### old-photo.jpg',
      '**Status:** READY',
      '',
      '## Image Prompts + Generated',
      '',
      '### img-001',
      '**Vibe:** v', '**Purpose:** p', '**Aspect Ratio:** 1:1', '**Status:** ACTIVE',
      '**Prompt:** old',
      '',
      '## Vibe Assignments',
      '',
      'old assignments here',
    ].join('\n'), 'utf-8')

    const r = await POST(makeRequest({
      sessionId: TEST_SESSION_ID,
      vibe: 'v', purpose: 'p', aspectRatio: '1:1', prompt: 'fresh',
    }))
    expect(r.status).toBe(200)

    const md = readFileSync(TEST_IMAGES_MD, 'utf-8')
    // New block lives BETWEEN the canonical section and `## Vibe Assignments`
    const promptsIdx = md.indexOf('## Image Prompts + Generated')
    const assignmentsIdx = md.indexOf('## Vibe Assignments')
    const newBlockIdx = md.indexOf('### img-002')
    expect(promptsIdx).toBeLessThan(newBlockIdx)
    expect(newBlockIdx).toBeLessThan(assignmentsIdx)
    // Uploaded Images section untouched
    expect(md).toMatch(/### old-photo\.jpg/)
  })

  it('refuses to insert a duplicate id (returns 409)', async () => {
    writeFileSync(TEST_IMAGES_MD, [
      '## Image Prompts + Generated',
      '',
      '### img-collision',
      '**Vibe:** v', '**Purpose:** p', '**Aspect Ratio:** 1:1', '**Status:** PENDING',
      '**Prompt:** existing',
      '',
    ].join('\n'), 'utf-8')

    const r = await POST(makeRequest({
      sessionId: TEST_SESSION_ID,
      vibe: 'v', purpose: 'p', aspectRatio: '1:1', prompt: 'attempt',
      id: 'img-collision',
    }))
    expect(r.status).toBe(409)
    const body = await (r as Response).json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/already exists/)
    // No duplicate publish either
    expect(publishMock).not.toHaveBeenCalled()
  })
})
