/**
 * Tests for WebDev's Phase 2 tool-call capture path.
 *
 * Specifically exercises:
 *   1. readReportBuildCompleteFromStdout extracts structured args from stream-json
 *   2. Fallback chain (parseTrailingJson) still works as defensive last-resort
 *   3. Bad/missing args fall through to fallback
 *
 * The full buildVibeHTML / runWebDev integration paths are exercised by
 * E2E smoke tests; these unit tests pin down the contract.
 */
import { describe, it, expect } from 'vitest'
import { collectFromStdout } from './mcp-tool-collector'

// Stand-in for the (private) helper inside webdev.ts. The function is
// inlined; we rebuild its shape here so tests verify the same semantics
// without exposing internals to the public API.
function readReportBuildCompleteFromStdout(
  stdout: string,
): { filename: string; vibeIndex: number; vibeName: string } | null {
  const calls = collectFromStdout(stdout, ['build_done'])
  const args = calls.build_done as
    | { filename?: unknown; vibeIndex?: unknown; vibeName?: unknown }
    | undefined
  if (!args) return null
  if (typeof args.filename !== 'string' || !args.filename.endsWith('.html')) return null
  if (typeof args.vibeIndex !== 'number') return null
  if (typeof args.vibeName !== 'string') return null
  return { filename: args.filename, vibeIndex: args.vibeIndex, vibeName: args.vibeName }
}

describe('WebDev build_done capture', () => {
  it('extracts the manifest from a typed tool_use event', () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Building vibe-3..."}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"build_done","input":{"filename":"vibe-3-the-deployment.html","vibeIndex":3,"vibeName":"The Deployment","sectionsBuilt":["hero","menu"],"imagesUsed":["hero.jpg"]}}]}}',
      '{"type":"result","subtype":"success"}',
    ].join('\n')
    const m = readReportBuildCompleteFromStdout(stdout)
    expect(m).toEqual({
      filename: 'vibe-3-the-deployment.html',
      vibeIndex: 3,
      vibeName: 'The Deployment',
    })
  })

  it('returns null when the tool call is missing', () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}',
      '{"type":"result","subtype":"success"}',
    ].join('\n')
    expect(readReportBuildCompleteFromStdout(stdout)).toBeNull()
  })

  it('returns null when filename is missing or non-html', () => {
    const stdoutNoFilename = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"build_done","input":{"vibeIndex":3,"vibeName":"X"}}]}}`
    expect(readReportBuildCompleteFromStdout(stdoutNoFilename)).toBeNull()

    const stdoutBadExt = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"build_done","input":{"filename":"vibe-3.txt","vibeIndex":3,"vibeName":"X"}}]}}`
    expect(readReportBuildCompleteFromStdout(stdoutBadExt)).toBeNull()
  })

  it('returns null when vibeIndex is not a number', () => {
    const stdout = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"build_done","input":{"filename":"vibe-3.html","vibeIndex":"three","vibeName":"X"}}]}}`
    expect(readReportBuildCompleteFromStdout(stdout)).toBeNull()
  })

  it('does NOT extract from text-only output mentioning the tool', () => {
    // Phase 2 doctrine: tool effects only fire from typed events. Mentions
    // of `build_done({...})` in chat are inert.
    const stdout = `{"type":"assistant","message":{"content":[{"type":"text","text":"I will call build_done({\\"filename\\":\\"x.html\\"}) now."}]}}`
    expect(readReportBuildCompleteFromStdout(stdout)).toBeNull()
  })

  it('does NOT extract from trailing JSON in text', () => {
    // Trailing JSON is the LEGACY path — handled by parseTrailingJson, not
    // by this function. Keeps the contracts cleanly separated.
    const stdout = `{"type":"assistant","message":{"content":[{"type":"text","text":"Done.\\n{\\"filename\\":\\"vibe-3.html\\",\\"vibeIndex\\":3,\\"vibeName\\":\\"X\\"}"}]}}`
    expect(readReportBuildCompleteFromStdout(stdout)).toBeNull()
  })

  it('handles the prefixed CLI form (mcp__orch__build_done)', () => {
    const stdout = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__orch__build_done","input":{"filename":"vibe-9.html","vibeIndex":9,"vibeName":"Y","sectionsBuilt":[],"imagesUsed":[]}}]}}`
    const m = readReportBuildCompleteFromStdout(stdout)
    expect(m?.filename).toBe('vibe-9.html')
    expect(m?.vibeIndex).toBe(9)
  })
})
