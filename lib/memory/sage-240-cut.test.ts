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
  findCutSeam,
  extractTimestampsFromChunk,
  diagnoseSageTopology,
} from './dreamer'

// SPEC CHANGE (Ralph 2026-07-04, barbazza anchored-at-1067 run): image-mode
// entry headers (`### <ISO> — user|cd-*`) are TISSUE, not cruft. The anchor
// walk stops on them; the Block scan is whole-file (Blocks live above USD
// since 2026-05-18). Tests below that asserted "walk past cd-rewrite event
// headers" were updated to the new spec.

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
  it('cutStart lands at the first tissue header of EITHER dialect after the last Block (Ralph 2026-07-04 spec)', () => {
    // Algorithm:
    //   1. Find the last `**Block X — ` line by file position, WHOLE FILE.
    //      In the cruft fixture that's Block I at idx 26 (inside a SESSION
    //      RESTORED zone below USD — file position wins).
    //   2. Walk forward until the first tissue header — a `#### User|CD |`
    //      chat turn OR a `### <ISO> — user|cd-*` image-mode entry. Cross
    //      every separator, SESSION RESTORED header, stub Block, blank
    //      line, orphan prose.
    //   3. cutStart = that header's line.
    //
    // In the cruft fixture the first tissue header after Block I is the
    // cd-rewrite event header at idx 42 (2026-07-04: image-mode entries
    // are tissue to fold, not cruft to skip — the pre-2026-05-03 walker
    // skipped them and they piled up as a permanently uncut floor).
    const lines = buildCruftySession()
    const usdIdx = lines.indexOf('## USER SESSION DATA')
    expect(usdIdx).toBeGreaterThan(0)
    const sectionEnd = lines.length - 200

    const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, sectionEnd)
    expect(anchor).not.toBeNull()
    expect(anchor!.cutStart).toBe(42)
    // Block I (last Block by file position) is at idx 26 → 1-indexed 27
    expect(anchor!.reason).toMatch(/after-block-at-line-27/)
  })

  it('walks past `---` separators, SESSION RESTORED headers, stub Blocks and orphan prose', () => {
    // The walk crosses structural cruft — `---`, orphan bullets, bold
    // non-Block lines — and stops at the first REAL tissue header. Since
    // 2026-07-04 that includes image-mode entry headers (idx 42), which
    // the 2026-05-03 spec wrongly classified as cruft.
    const lines = buildCruftySession()
    const usdIdx = lines.indexOf('## USER SESSION DATA')
    const sectionEnd = lines.length - 200
    const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, sectionEnd)!

    // The walk MUST step past:
    //   - the `---` at idx 29/31 (not stop boundaries)
    //   - the orphan bullet list at idx 32-34
    //   - the bold "Three title-slide registers" at idx 36
    // and stop at idx 42, the first image-mode event header — NOT skip on
    // to the chat turn at idx 48.
    expect(anchor.cutStart).toBe(42)
    expect(anchor.cutStart).not.toBe(29)
    expect(anchor.cutStart).not.toBe(48)
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

// ─── Ralph 2026-07-04 — barbazza anchored-at-1067 regression ────────────────
// Canonical post-2026-05-18 layout: Blocks live in `## BLOCKS` ABOVE the USD
// marker; tissue below USD opens with ~870 lines of image-mode entries. The
// old anchor (below-USD block scan + chat-turn-only walk) reported
// `fresh-session-no-blocks` and skipped ALL image tissue to the first chat
// turn — image tissue was permanently unfoldable.
describe('Sage 240/40 canonical layout + image-mode dialect (Ralph 2026-07-04)', () => {
  function buildCanonicalSession(): string[] {
    return [
      '## Todos',                                                          // 0
      '- [ ] (id:t-1) something',                                          // 1
      '',                                                                  // 2
      '# Session 2026-05-31-weingut-barbazza',                             // 3
      '',                                                                  // 4
      '## LEDGER',                                                         // 5
      '',                                                                  // 6
      '## COMPACTS',                                                       // 7
      '',                                                                  // 8
      '## BLOCKS',                                                         // 9
      '',                                                                  // 10
      '### 2026-05-31',                                                    // 11
      '',                                                                  // 12
      '**Block A — Barbazza fix, portrait relighting** (2026-05-31 18:27 → 18:27)', // 13
      'Narrative of Block A.',                                             // 14
      '',                                                                  // 15
      '## USER SESSION DATA',                                              // 16 ← USD
      '',                                                                  // 17
      '### 2026-05-31T16:27:25.157Z — user — Dokument-grb.jpg',            // 18 ← first tissue
      '',                                                                  // 19
      '_source: image-mode:edit_',                                         // 20
      '',                                                                  // 21
      'Review the IMAGE PROMPT I currently have in Zone 4 below.',         // 22
      '',                                                                  // 23
      '### 2026-05-31T16:27:25.162Z — cd-reply — Dokument-grb.jpg',        // 24
      '',                                                                  // 25
      '**CD committed prompt** (routed to Zone 4):',                       // 26
      '',                                                                  // 27
      '### 2026-06-16T18:23:48.192Z — cd-verdict-fail',                    // 28
      '',                                                                  // 29
      'verdict body',                                                      // 30
      '',                                                                  // 31
      '### 2026-06-17T10:00:00.000Z — user — followup.jpg',                // 32 ← image entry — skipped by the seam walk
      '',                                                                  // 33
      'follow-up request body',                                            // 34
      '',                                                                  // 35
      '---',                                                               // 36
      '#### User | 2026-06-24 13:07:57',                                   // 37 ← next CHAT User turn = the seam
      '',                                                                  // 38
      'chat body',                                                         // 39
      ...Array(300).fill('… image prompt prose …'),
    ]
  }

  it('anchors at the FIRST image-mode entry right after the USD marker, not at a distant chat turn', () => {
    const lines = buildCanonicalSession()
    const usdIdx = lines.indexOf('## USER SESSION DATA')
    const sectionEnd = lines.length - 200
    const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, sectionEnd)
    expect(anchor).not.toBeNull()
    expect(anchor!.cutStart).toBe(18)
    // Block A sits ABOVE USD (idx 13 → 1-indexed 14) — the whole-file scan
    // sees it; the old below-USD scan reported `fresh-session-no-blocks`.
    expect(anchor!.reason).toBe('blocks-above-usd-last-at-line-14')
  })

  it('does NOT anchor on BLOCKS-section date sub-headers or bold non-Block lines', () => {
    const lines = buildCanonicalSession()
    const usdIdx = lines.indexOf('## USER SESSION DATA')
    const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, lines.length - 200)!
    // `### 2026-05-31` (idx 11, no T-time+role) and `**CD committed prompt**`
    // (idx 26, bold but not a header) must never be anchors.
    expect(anchor.cutStart).not.toBe(11)
    expect(anchor.cutStart).not.toBe(26)
  })

  it('findCutSeam: the seam is the next CHAT `#### User |` turn — CD turns and ALL image entries are skipped (Ralph 2026-07-04)', () => {
    const lines = buildCanonicalSession()
    // The walk must skip the cd-reply (24), the cd-verdict-fail (28) AND
    // the image-mode `— user —` entry (32) — image entries are never cut
    // boundaries. The seam is the chat User turn at 37; it is directly
    // preceded by `---` (36), so cutEnd = the `---` line (pre-existing
    // placement — the separator stays in the file above the next turn).
    expect(findCutSeam(lines, 19, lines.length)).toBe(36)
    expect(findCutSeam(lines, 25, lines.length)).toBe(36)
    // Past the last chat User turn → no seam (caller aborts).
    expect(findCutSeam(lines, 38, lines.length)).toBeNull()
  })

  it('findCutSeam: skips `#### CD |` turns; lands on the User line itself when no `---` precedes', () => {
    const chat = [
      'prose',                            // 0
      '---',                              // 1
      '#### CD | 2026-06-24 13:07:57',    // 2 ← CD turn — NOT a seam
      'cd body',                          // 3
      '#### User | 2026-06-24 14:03:19',  // 4 ← seam (no `---` directly above)
      'body',                             // 5
    ]
    expect(findCutSeam(chat, 0, chat.length)).toBe(4)
    // With a `---` directly above the User turn, cutEnd = the `---` line.
    const dashed = ['prose', '---', '#### User | 2026-06-24 13:07:57', 'body']
    expect(findCutSeam(dashed, 0, dashed.length)).toBe(1)
    // A bare `---` with no User turn after it is NOT a seam.
    const bare = ['prose', '---', 'more prose', '']
    expect(findCutSeam(bare, 0, bare.length)).toBeNull()
  })

  it('extractTimestampsFromChunk reads image-mode ISO headers (no 00:00/sessionId fallback)', () => {
    const chunk = [
      '### 2026-05-31T16:27:25.157Z — user — Dokument-grb.jpg',
      '',
      'Review the IMAGE PROMPT…',
      '',
      '### 2026-06-16T18:23:48.192Z — cd-rewrite',
      '',
      'rewrite body',
    ]
    const ts = extractTimestampsFromChunk(
      chunk,
      'public/2026-05-31-weingut-barbazza/SESSION.md',
    )
    expect(ts.chunkStartDate).toBe('2026-05-31')
    expect(ts.chunkStartTime).toBe('16:27')
    expect(ts.chunkEndDate).toBe('2026-06-16')
    expect(ts.chunkEndTime).toBe('18:23')
  })

  it('extractTimestampsFromChunk handles a MIXED chunk (image entries then chat turns)', () => {
    const chunk = [
      '### 2026-06-16T18:23:48.192Z — cd-reply — file.jpg',
      '',
      'body',
      '',
      '---',
      '#### User | 2026-06-24 13:07:57',
      '',
      'chat body',
    ]
    const ts = extractTimestampsFromChunk(
      chunk,
      'public/2026-05-31-weingut-barbazza/SESSION.md',
    )
    expect(ts.chunkStartDate).toBe('2026-06-16')
    expect(ts.chunkStartTime).toBe('18:23')
    expect(ts.chunkEndDate).toBe('2026-06-24')
    expect(ts.chunkEndTime).toBe('13:07')
  })
})

// ── Topology diagnosis (Ralph 2026-07-04 — Job 2, system's detect half) ────
// A session restore stacking a fresh skeleton on an old file leaves TWO
// section sets; new entries then land in the wrong one (~line 870 on
// Barbazza). The system only DETECTS and reports line numbers — the merge
// itself is Sage's (agents/sage-240-40.md Job 2, tools, 20-min SIGTERM).
describe('diagnoseSageTopology — duplicate section sets', () => {
  it('reports 1-based line numbers for every duplicated heading (Barbazza shape)', () => {
    const file = [
      '# Session 2026-05-31-weingut-barbazza', // 1
      '',                                       // 2
      '## LEDGER',                              // 3  ← top skeleton
      '',                                       // 4
      '## COMPACTS',                            // 5
      '',                                       // 6
      '## BLOCKS',                              // 7
      '',                                       // 8
      '## USER SESSION DATA',                   // 9  ← first marker
      '### 2026-05-31T16:27:25.157Z — user — Dokument-grb.jpg',
      'upload event body',                      // 11
      '## LEDGER',                              // 12 ← legacy mid-file set
      '',                                       // 13
      '## COMPACTS',                            // 14
      '',                                       // 15
      '## BLOCKS',                              // 16
      '**Block A — Old work** (2026-05-31 18:27 → 18:27)', // 17
      '',                                       // 18
      '## USER SESSION DATA',                   // 19 ← second marker
      '#### User | 2026-07-04 13:00',           // 20
    ].join('\n')
    const d = diagnoseSageTopology(file)!
    expect(d).not.toBeNull()
    expect(d.ledger).toEqual([3, 12])
    expect(d.compacts).toEqual([5, 14])
    expect(d.blocks).toEqual([7, 16])
    expect(d.usd).toEqual([9, 19])
  })

  it('returns null on a clean single-set file', () => {
    const file = [
      '# Session x', '', '## LEDGER', '', '## COMPACTS', '', '## BLOCKS', '',
      '## USER SESSION DATA', '#### User | 2026-07-04 13:00', 'tissue',
    ].join('\n')
    expect(diagnoseSageTopology(file)).toBeNull()
  })

  it('returns null on a virgin file with no sections at all', () => {
    const file = ['# Session x', '', '## USER SESSION DATA', '#### User | 2026-07-04 13:00'].join('\n')
    expect(diagnoseSageTopology(file)).toBeNull()
  })

  it('fires when only the USD marker is duplicated', () => {
    const file = [
      '## LEDGER', '', '## COMPACTS', '', '## BLOCKS', '',
      '## USER SESSION DATA', 'tissue', '## USER SESSION DATA', 'more tissue',
    ].join('\n')
    const d = diagnoseSageTopology(file)!
    expect(d).not.toBeNull()
    expect(d.usd).toEqual([7, 9])
  })
})
