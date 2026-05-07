/**
 * Phase 2 doctrinal regression test (2026-04-30).
 *
 * Locks in the deletion of text-output parsers replaced by typed MCP tool
 * calls. If anyone in the future re-adds these files or re-exports the
 * helper functions, this test fails immediately and they have to either:
 *   (a) update the tests to reflect a deliberate reversal, OR
 *   (b) realize they're reintroducing the bug class Phase 2 was designed to fix.
 *
 * The principle: tool effects only fire from typed MCP events, never from
 * text scans.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

describe('Phase 2 — deleted files stay deleted', () => {
  const ROOT = resolve(__dirname, '..', '..')

  it('lib/cd-response-parser.ts does not exist', () => {
    expect(existsSync(resolve(ROOT, 'lib/cd-response-parser.ts'))).toBe(false)
  })

  it('parseCDResponse cannot be imported from any active path', async () => {
    // Cover the obvious / discoverable paths someone might re-add.
    const possible = [
      'lib/cd-response-parser',
      'lib/cd-parser',
      'lib/cd-response',
    ]
    for (const path of possible) {
      let imported: unknown = null
      try {
        imported = await import(`@/${path}`)
      } catch {
        // expected — does not exist
      }
      if (imported && typeof imported === 'object') {
        const exports = Object.keys(imported as Record<string, unknown>)
        expect(exports).not.toContain('parseCDResponse')
        expect(exports).not.toContain('CDParsedResponse')
      }
    }
  })
})

describe('Phase 2 — header-regex parsers stay deleted from cd-* libs', () => {
  it('cd-proofread no longer exports parseProofreadResponse', async () => {
    const mod = await import('../cd-proofread')
    expect(Object.keys(mod)).not.toContain('parseProofreadResponse')
  })

  it('cd-verdict no longer exports parseVerdictResponse', async () => {
    const mod = await import('../cd-verdict')
    expect(Object.keys(mod)).not.toContain('parseVerdictResponse')
  })

  it('cd-upload-eval no longer exports parseUploadEvalResponse', async () => {
    const mod = await import('../cd-upload-eval')
    expect(Object.keys(mod)).not.toContain('parseUploadEvalResponse')
  })
})
