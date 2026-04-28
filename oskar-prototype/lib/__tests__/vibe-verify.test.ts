// Regression suite for lib/vibe-verify.ts. The post-build verification floor
// for WebDev — replaces the old "file exists = success" criterion with
// HTML-parses + image-refs-resolve + body-present + manifest-parseable.

import { describe, it, expect } from 'vitest'
import { parseTrailingJson } from '../vibe-verify'

describe('vibe-verify', () => {
  describe('parseTrailingJson', () => {
    it('finds manifest at the end of agent output', () => {
      const output = `Building the page now...
Wrote vibe-5-staging.html
Done.

{"filename": "vibe-5-staging.html", "vibeIndex": 5, "vibeName": "Staging"}`
      expect(parseTrailingJson(output)).toEqual({
        filename: 'vibe-5-staging.html',
        vibeIndex: 5,
        vibeName: 'Staging',
      })
    })

    it('finds manifest with trailing whitespace lines after', () => {
      const output = `Done.

{"filename": "vibe-2-foo.html", "vibeIndex": 2, "vibeName": "Foo"}

`
      expect(parseTrailingJson(output)?.filename).toBe('vibe-2-foo.html')
    })

    it('skips lines that are not JSON', () => {
      const output = `Some text
Not JSON
{"filename": "vibe-3-bar.html", "vibeIndex": 3, "vibeName": "Bar"}
End`
      expect(parseTrailingJson(output)?.filename).toBe('vibe-3-bar.html')
    })

    it('returns null when no parseable JSON found', () => {
      const output = `Build complete.\nNo manifest here.`
      expect(parseTrailingJson(output)).toBeNull()
    })

    it('returns null when JSON is missing required filename field', () => {
      const output = `{"vibeIndex": 5, "vibeName": "Staging"}`
      expect(parseTrailingJson(output)).toBeNull()
    })

    it('returns null when filename is not a .html file', () => {
      const output = `{"filename": "vibe-5.txt", "vibeIndex": 5, "vibeName": "Staging"}`
      expect(parseTrailingJson(output)).toBeNull()
    })

    it('falls back to defaults when vibeIndex/vibeName are missing', () => {
      const output = `{"filename": "vibe-7-thing.html"}`
      expect(parseTrailingJson(output)).toEqual({
        filename: 'vibe-7-thing.html',
        vibeIndex: 0,
        vibeName: 'vibe-7-thing',
      })
    })

    it('handles malformed JSON without throwing', () => {
      const output = `{"filename": "vibe-5.html", "vibeIndex": 5,}` // trailing comma
      expect(() => parseTrailingJson(output)).not.toThrow()
    })
  })
})
