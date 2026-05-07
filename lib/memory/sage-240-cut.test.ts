/**
 * Sage 240/40 cut-anchor regression tests (Ralph 2026-05-02).
 *
 * Bug history: the previous walker (`findFirstLivingTissue`) consumed
 * `---` separators and orphan loose prose as if they were Block-paragraph
 * content. On a file with old SESSION-RESTORED zones containing duplicate
 * Block letters + loose prose between them, the walker landed on the
 * FIRST recent `#### User | …` raw turn — which is LIVE conversation. The
 * cut took 200 lines from there and ate today's tissue.
 *
 * Fix: anchor the cut on the END of the LAST Block by file position
 * (treating `---` as a hard boundary), and time-protect cutEnd against
 * any User turn newer than the most recent Block's end-time.
 *
 * These tests recreate the exact crufty pattern from
 * `public/2026-01-27-31/SESSION.md` on 2026-05-01 22:43 (when the bug
 * fired) and assert the new cut window:
 *   - starts AT the line right after the last real Block
 *   - stops BEFORE the first live `#### User | YYYY-MM-DD HH:MM` turn
 *     dated newer than the most recent Block
 */
import { describe, it, expect } from 'vitest'
import {
  findCutAnchorAfterLastBlock,
  findMostRecentBlockEndTime,
  findLiveTissueLine,
} from './dreamer'

// Build a synthetic SESSION.md mimicking Ralph's pre-cut crufty file:
//   - LEDGER + USD marker at top
//   - Recent real Block (DD, dated 2026-05-01 20:22 → 20:37)
//   - OLD `## SESSION RESTORED` zone with duplicate Block G/H/I letters
//   - Orphan loose prose (the steve-3.jpeg bullet list, "Three title-slide
//     registers" paragraph) — the kind of content the old walker swallowed
//   - `### YYYY-MM-DDTHH:MM:SS — cd-rewrite` event headers
//   - Recent live `#### User | 2026-05-01 21:12` turns (the protected ones)
function buildCruftySession(): string[] {
  return [
    '## STATE',                                                          // 0
    '',                                                                  // 1
    '## LEDGER',                                                         // 2
    '',                                                                  // 3
    '### 2026-05-01',                                                    // 4
    '**Block DD — Goldfish audit verdict** (2026-05-01 20:22 → 20:37)',  // 5  ← summary in LEDGER
    '',                                                                  // 6
    '## USER SESSION DATA',                                              // 7  ← USD marker (idx 7)
    '',                                                                  // 8
    '### 2026-05-01',                                                    // 9
    '**Block DD — Goldfish audit verdict** (2026-05-01 20:22 → 20:37)',  // 10 ← LAST REAL BLOCK
    'CD audited the Goldfish moves of the day; user demanded a Sith map.',// 11
    'The lineage from Bulldozer through Rewriter to Yak got named.',     // 12
    '',                                                                  // 13
    '## SESSION RESTORED — 2026-01-27 — 16:26',                          // 14 ← old crufty zone
    '',                                                                  // 15
    '---',                                                               // 16
    '**Block G — Image Mode layout** (23:50 → 00:26)',                   // 17 ← duplicate G
    'Image Mode layout redesigned with chat column back.',               // 18
    '',                                                                  // 19
    '---',                                                               // 20
    '## SESSION RESTORED — 2026-01-27 — 04:10',                          // 21
    '',                                                                  // 22
    '**Block H — Upload eval wiring** (04:25 → 04:41)',                  // 23 ← duplicate H
    'Upload eval wiring closed.',                                        // 24
    '',                                                                  // 25
    '**Block I — VIBE-8 evaluation** (21:46 → 23:06)',                   // 26 ← duplicate I (LAST by file position)
    'CD evaluated VIBE-8 + DS skipped.',                                 // 27
    '',                                                                  // 28
    '---',                                                               // 29 ← old walker silently consumed `---` as Block paragraph
    '',                                                                  // 30
    '---',                                                               // 31
    '- `steve-3.jpeg` — formal portrait',                                // 32 ← orphan bullets — old walker buried these inside Block I
    '- `steve-3-1.jpeg` — informal portrait',                            // 33
    '- `composed-gen-image.jpg` — Steve at the patisserie pass',         // 34
    '',                                                                  // 35
    '**Three title-slide registers I will hold in different lanes:**',   // 36 ← bold but NOT a Block — old walker buried this
    '',                                                                  // 37
    '- **Pitch** → variable-font axis settle',                           // 38
    '- **Weigh-In** → broadcast VS entrance',                            // 39
    '- **Decree** → SVG seal stroke-dasharray',                          // 40
    '',                                                                  // 41
    '### 2026-04-20T17:32:04.314Z — cd-rewrite',                         // 42 ← cd-rewrite event header
    '',                                                                  // 43
    '### 2026-04-20T21:58:39.705Z — cd-rewrite',                         // 44
    '',                                                                  // 45
    '---',                                                               // 46
    '',                                                                  // 47
    '#### User | 2026-05-01 21:12:35',                                   // 48 ← LIVE — must be protected
    '',                                                                  // 49
    'what you did with branding plan is Darth Goldfish work.',           // 50
    '',                                                                  // 51
    '#### CD | 2026-05-01 21:12:35',                                     // 52
    '',                                                                  // 53
    'Five compounding failures: bulldozing, deleting, rewriting…',       // 54
    // pad with ~250 lines so sectionEnd (lines.length - 200) is well past
    // the first live User turn
    ...Array(220).fill('… more conversation prose continues here …'),
  ]
}

describe('Sage 240/40 cut-anchor (Ralph 2026-05-02 fix)', () => {
  it('cutStart lands at the first `#### User | …` turn after the last Block (Ralph 2026-05-03 spec)', () => {
    // Algorithm per Ralph 2026-05-03:
    //   1. Find the last `**Block X — ` line by file position. ANY Block —
    //      stub, real, dated, undated — is fair game. In the cruft fixture,
    //      that's Block I at idx 26 (inside a SESSION RESTORED zone, but
    //      that doesn't matter — file position wins).
    //   2. Walk forward until the first `#### User | …` or `#### CD | …`
    //      turn header. Cross every separator, every SESSION RESTORED
    //      header, every stub Block, every blank line — they're all just
    //      content the walk steps past.
    //   3. cutStart = that turn header's line.
    //
    // In the cruft fixture, the first live `#### User | 2026-05-01 21:12:35`
    // sits at idx 48. Block I is at idx 26. Everything in between is
    // separators / stubs / SESSION RESTORED / orphan prose / cd-rewrite
    // event headers — all crossable. cutStart = 48.
    const lines = buildCruftySession()
    const usdIdx = lines.indexOf('## USER SESSION DATA')
    expect(usdIdx).toBeGreaterThan(0)
    const sectionEnd = lines.length - 200

    const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, sectionEnd)
    expect(anchor).not.toBeNull()
    expect(anchor!.cutStart).toBe(48)
    // Block I (last Block by file position) is at idx 26 → 1-indexed 27
    expect(anchor!.reason).toMatch(/after-block-at-line-27/)
  })

  it('walks past `---` separators, SESSION RESTORED headers, and stub Blocks looking for tissue', () => {
    // Targeted regression. The old algorithm STOPPED at structural
    // boundaries — `---`, `^##\s`, `^####`. The new algorithm crosses
    // them all and only stops at a real `#### User|CD |` turn header.
    const lines = buildCruftySession()
    const usdIdx = lines.indexOf('## USER SESSION DATA')
    const sectionEnd = lines.length - 200
    const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, sectionEnd)!

    // The walk MUST step past:
    //   - the `---` at idx 29 (NOT a stop boundary anymore)
    //   - the orphan bullet list at idx 32-34
    //   - the bold "Three title-slide registers" at idx 36
    //   - the cd-rewrite event headers at idx 42, 44
    //   - the `---` at idx 46
    // and land at idx 48, the first real User turn.
    expect(anchor.cutStart).toBe(48)
    // (For sanity: anchor must NOT have stopped on any of the structural
    // markers earlier in the run.)
    expect(anchor.cutStart).not.toBe(29)
    expect(anchor.cutStart).not.toBe(46)
  })

  it('time-protects: caps cutEnd at the first User turn newer than most recent Block', () => {
    const lines = buildCruftySession()
    const usdIdx = lines.indexOf('## USER SESSION DATA')
    const sectionEnd = lines.length - 200

    const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, sectionEnd)!
    const protectAfter = findMostRecentBlockEndTime(lines, usdIdx, sectionEnd)

    // Most recent Block end-time = Block DD's '2026-05-01 20:37'. The duplicate
    // Blocks G/H/I have legacy `(HH:MM → HH:MM)` titles without a date — they
    // contribute null endDate and don't affect the protection threshold.
    expect(protectAfter).toBe('2026-05-01 20:37')

    const naiveCutEnd = Math.min(anchor.cutStart + 200, sectionEnd)
    const protectedCutEnd = findLiveTissueLine(
      lines,
      anchor.cutStart,
      naiveCutEnd,
      protectAfter,
    )

    // The first live User turn is at line 48 (timestamp '2026-05-01 21:12:35'
    // > '2026-05-01 20:37'). Protection must cap cutEnd there.
    expect(protectedCutEnd).toBe(48)
  })

  it('returns -1 from findLiveTissueLine when nothing in window is newer than threshold', () => {
    const lines = [
      '## USER SESSION DATA',
      '',
      '**Block A — earlier work** (2026-04-20 10:00 → 11:00)',
      'Some narrative.',
      '',
      '#### User | 2026-04-20 09:30:00',
      '',
      'older user turn',
    ]
    const result = findLiveTissueLine(lines, 0, lines.length, '2026-04-20 11:00')
    // The User turn is at 09:30, OLDER than 11:00 — no live tissue.
    expect(result).toBe(-1)
  })

  it('falls back to findFirstLivingTissue for fresh sessions (no Blocks below USD)', () => {
    const lines = [
      '## STATE',
      '',
      '## USER SESSION DATA',
      '',
      '#### User | 2026-05-02 10:00:00',
      '',
      'fresh raw turn — no prior Blocks',
      '',
      '#### CD | 2026-05-02 10:00:01',
      '',
      'CD reply',
      // pad
      ...Array(220).fill('… more raw conversation …'),
    ]
    const usdIdx = 2
    const sectionEnd = lines.length - 200
    const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, sectionEnd)
    expect(anchor).not.toBeNull()
    expect(anchor!.reason).toBe('fresh-session-no-blocks')
    // Fresh-session walker lands on the first non-structural line (line 4
    // = the User turn itself counts as living tissue).
    expect(anchor!.cutStart).toBe(4)
  })

  it('returns null when no Blocks AND no living tissue (fully converged)', () => {
    const lines = [
      '## USER SESSION DATA',
      '',
      '',
      '---',
      '',
      // pad — all blank/structural, no Blocks, no User turns
      ...Array(220).fill(''),
    ]
    const anchor = findCutAnchorAfterLastBlock(lines, 0, lines.length - 200)
    expect(anchor).toBeNull()
  })

  it('handles dated AND undated Block titles when computing protectAfter', () => {
    const lines = [
      '## USER SESSION DATA',
      '',
      '**Block A — legacy undated** (10:00 → 11:00)',
      'Narrative.',
      '',
      '**Block B — modern dated** (2026-05-01 14:00 → 15:30)',
      'Narrative.',
      '',
    ]
    const result = findMostRecentBlockEndTime(lines, 0, lines.length)
    // Only the dated Block contributes; undated Block is ignored
    expect(result).toBe('2026-05-01 15:30')
  })
})
