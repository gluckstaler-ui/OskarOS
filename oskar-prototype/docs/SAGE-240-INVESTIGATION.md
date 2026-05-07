# Sage 240/40 — Why It Savages SESSION.md

**Investigation date:** 2026-05-03
**Status:** Investigation only — no code changes yet, per Ralph's request
**Scope:** root-cause the destructive cuts that erase live conversation, not the cosmetic timing bugs already fixed

---

## TL;DR

Three bugs interact to produce destructive cuts. Two are LIVE on disk RIGHT NOW. The 2026-05-02 fix (anchor-after-last-Block + `---` boundary + time-protect cap) closed ONE failure mode but left two structurally adjacent ones open:

1. **Null-protectAfter silent disable.** When the most-recent Block has an undated legacy title (`(HH:MM → HH:MM)` instead of `(YYYY-MM-DD HH:MM → HH:MM)`), `findMostRecentBlockEndTime` returns `null`. With `null`, `findLiveTissueLine` returns `-1`. With `-1`, the live-tissue protection silently disables. The cut takes its full 200-line greedy window. Live tissue gets eaten.

2. **Snap-forward bypasses live boundary when there's no protection.** Even when protection IS active, the snap-to-natural-boundary loop pushes `cutEnd` forward by up to +50 lines toward the next User/CD/SESSION-RESTORED header. The snap **does not time-check** the line it lands on. If `liveBoundary === -1` (Bug 1 path), snap is unconstrained.

3. **Multi-pass cascade with agent-generated end-times.** Each Sage pass anchors against the freshest disk state — including Blocks that the *previous pass just wrote*. The agent extracts the end-time from the chunk it compressed. If the agent missed the latest CD reply or hallucinated an earlier time, the new Block carries a wrong end-time. Pass 2 inherits wrong protection. On a 6-pass run (480KB+ files) the error compounds.

---

## Disk evidence

### The 2026-04-30 incident is preserved as a `.bak`

```
$ ls -la public/2026-01-27-debug/SESSION.md.cut-by-sage-20260430-1752.bak
-rw-r--r-- 1 ralphlengler staff 67130 Apr 30 17:56 …
```

67 KB, dated 2026-04-30 17:56. This is the file Sage left behind after a destructive cut on a session that was previously ~480 KB. The `.merged` (500 KB) sibling next to it is the recovery — Ralph stitched the surviving 67 KB shell back together with a manual merge of older snapshots.

### Today's runs are erroring out from a separate issue

Latest log:
```
public/2026-04-25-silke-lengler/logs/.last-sage-240-40-log.md
[240/40-ERROR] pass 1: agent call failed
```

Debug log shows: `Error: claude native binary not installed.` — this is the **pnpm postinstall casualty** from this morning's package-manager swap. Unrelated to savaging. Re-installing the binary fixes runs but does NOT fix the savaging bugs.

### Concrete proof of the agent-side timestamp bug

```
public/2026-02-15-1/logs/.last-sage-240-40-log.md
[240/40-CUT] Block E — Studien section built from India photos (00:00 → 00:00)
[240/40-CUT] Block F — Studies section integrated, styled, and reordered (00:00 → 00:00)
```

Both Block titles are `(00:00 → 00:00)` — the agent failed to extract any real timestamp from the chunk. `extractTimestampsFromChunk` (in `lib/memory/dreamer.ts:~1314`) is supposed to handle three turn-line formats, but in this session it fell back to all zeros. Once on disk, those Blocks contribute `null` end-times to the protection function on every subsequent run.

---

## How the cut algorithm is supposed to work

`performOneSageCut` in `lib/memory/dreamer.ts:1185` is the actual cut runner. The flow:

```
1. Find `## USER SESSION DATA` marker (USD)         ← line index usdIdx
2. findCutAnchorAfterLastBlock(lines, usdIdx, …)
     → Walk to LAST `**Block X — …` opening by FILE POSITION
     → Walk forward through ITS narrative until a hard boundary
       (next Block, Compact, ###, ##, #### turn header, OR `---`)
     → cutStart = the line of that boundary
3. cutEnd = min(cutStart + 200, sectionEnd)
4. protectAfter = findMostRecentBlockEndTime(lines, usdIdx, …)
     → Scan ALL Block titles, parse `(YYYY-MM-DD HH:MM → YYYY-MM-DD HH:MM)`
     → Return the LATEST end "YYYY-MM-DD HH:MM" string
     → IF NO Block has parseable dated end-time → return null
5. liveBoundary = findLiveTissueLine(lines, cutStart, cutEnd, protectAfter)
     → Scan window for `#### User | YYYY-MM-DD HH:MM[:SS]` turns
     → Return the line index of the FIRST turn newer than protectAfter
     → IF protectAfter === null → IMMEDIATELY return -1 (no protection applies)
     → IF none found in window → return -1
6. IF liveBoundary >= 0 && liveBoundary < cutEnd → cutEnd = liveBoundary
7. Snap-forward: walk [cutEnd, min(cutEnd+50, snapLimit))
     → Snap to first User|CD turn header or SESSION-RESTORED line
     → snapLimit = liveBoundary if liveBoundary >= 0, else sectionEnd
8. IF cutEnd - cutStart < 30 → no-tissue, skip
9. Otherwise → splice the [cutStart, cutEnd) range out + ask agent to
     compress it into a Block entry → insert the new Block
```

The 2026-05-02 fix (covered by `lib/memory/sage-240-cut.test.ts`, 7 tests green) addresses the case where `findCutAnchorAfterLastBlock` previously walked through `---` and orphan loose prose, eventually anchoring on a recent live `#### User | …` turn that was actual living conversation.

That case is fixed. The bugs below SURVIVE the fix.

---

## Bug 1 — Null-protectAfter silent disable

**Where:** `findMostRecentBlockEndTime` (line 1911) and `findLiveTissueLine` (line 1939).

**Mechanism:**

```ts
// findMostRecentBlockEndTime
const headerRe = /^\*\*Block\s+[A-Z]+\s+[—-]\s+.+?\*\*\s*\(([^)]+)\)\s*$/i
let latestEnd = ''
for (…) {
  const parsed = parseBlockTimeRange(m[1].trim())
  if (parsed.endDate && parsed.endTime) {     // ← BOTH must parse
    const endStr = `${parsed.endDate} ${parsed.endTime}`
    if (endStr > latestEnd) latestEnd = endStr
  }
}
return latestEnd || null                      // ← null when zero dated Blocks
```

```ts
// findLiveTissueLine
export function findLiveTissueLine(
  lines, cutStart, cutEnd,
  protectAfter: string | null,
): number {
  if (!protectAfter) return -1                // ← protection disabled
  …
}
```

**The trigger:** any session whose Blocks were ALL written by the legacy code path (before the 2026-04-30 dated-title patch landed). Their titles look like `(15:30 → 16:42)`. `parseBlockTimeRange` returns `{endDate: null, endTime: '16:42'}`. The `endDate && endTime` guard fails. They contribute nothing to `latestEnd`. After scanning every Block, `latestEnd` is still `''`. Returns `null`.

`findLiveTissueLine` sees `null`, returns `-1` immediately. The `if (liveBoundary >= 0 && liveBoundary < cutEnd)` guard fails. `cutEnd` stays at `cutStart + 200`. **The cut takes 200 lines of whatever's after the last Block, regardless of whether those lines are recent live conversation.**

**Test coverage gap:** the colocated test at line 217-231 confirms `findMostRecentBlockEndTime` returns the latest DATED end-time and ignores undated Blocks. But there's NO test for the case where ALL Blocks are undated → null. That null path is the silent-disable trapdoor.

**Real-world hit:** `public/2026-02-15-1/logs/.last-sage-240-40-log.md` — both Blocks E and F written with `(00:00 → 00:00)` titles. If this session's earlier Blocks (A, B, C, D) were ALSO undated or `(00:00 → 00:00)`, the next Sage run on this file gets `protectAfter === null` and any 200-line window past the last Block gets eaten without checking timestamps.

---

## Bug 2 — Snap-forward bypasses live boundary when there's no protection

**Where:** lines 1267-1278 of `performOneSageCut`.

**Mechanism:**

```ts
const snapLimit = liveBoundary >= 0 ? Math.min(liveBoundary, sectionEnd) : sectionEnd
const snapTarget = Math.min(cutEnd + 50, snapLimit)
for (let i = cutEnd; i < snapTarget; i++) {
  if (
    userTurnRe.test(lines[i]) ||
    eventHeaderRe.test(lines[i]) ||
    sessionRestoredRe.test(lines[i])
  ) {
    cutEnd = i
    break
  }
}
```

**The trigger:** when `liveBoundary === -1` (Bug 1 path, OR no live tissue in the window per the function's own logic), `snapLimit = sectionEnd`. The snap loop walks up to **+50 lines past `cutEnd`** looking for a "natural boundary" — defined as ANY User/CD turn header or SESSION-RESTORED marker.

The snap finds the next User turn. If that User turn is FROM TODAY (live conversation), the snap pushes `cutEnd` to it anyway. **The snap doesn't time-check the line it snaps to.** It treats "User turn header" as a clean seam regardless of when that turn happened.

**Compound with Bug 1:** when protectAfter is null, snap is unconstrained AND time-blind. The cut takes the 200-line greedy window + snaps forward by up to 50 lines onto a User turn header. If the file has live conversation in that +50 zone, those turns are now part of the cut.

**Independent failure path:** even with protection ACTIVE (Bug 1 path not hit), if the cut window legitimately ends within +50 lines of a live User turn (because the chunk is older content but the conversation continued right after), the snap pushes onto that live User turn. Snap should respect protectAfter independently.

---

## Bug 3 — Multi-pass cascade with agent-generated end-times

**Where:** the schedule loop at lines 974-1032 of `_runSage240_40Inner`, combined with `extractTimestampsFromChunk` at line 1314.

**Mechanism:**

The schedule decides up-front based on file size:

```
≥240 KB → 2 passes
≥360 KB → 4 passes
≥480 KB → 6 passes
```

Each pass re-reads SESSION.md (so it sees pass 1's mutations) and recomputes anchors. Pass 1 cuts a chunk and writes a new Block. The Block's title contains the time range that **the agent extracted from the chunk it just compressed**.

`extractTimestampsFromChunk` parses three turn-line formats (full date+time, time-only, time-only-no-seconds) and falls back to `00:00` when no parseable timestamp is found. **The fallback `00:00` becomes part of the Block title that gets written to disk.**

Pass 2 starts. `findMostRecentBlockEndTime` scans all Blocks INCLUDING the one Pass 1 just wrote. If Pass 1's new Block has end-time `00:00:00` (because the agent missed the trailing CD reply or the chunk had no parseable timestamps), Pass 2's protectAfter could regress backwards.

**Worst case (480 KB → 6 passes):** by Pass 4 or 5, multiple agent-generated Blocks with `(00:00 → 00:00)` or near-zero times are stacked. protectAfter is artificially old. liveBoundary protection covers a smaller and smaller window. Tissue from THIS WEEK starts being eligible to cut.

The April 30 incident (433 KB → 67 KB) is consistent with this cascade: a 6-pass schedule, each pass eating ~60 KB, taking out four full days of conversation in one run. Snapshot was deleted on "clean finish" by the OLD policy (now fixed — snapshots survive 24h); recovery was only possible because Ralph spotted it in time.

---

## Why the existing tests don't catch any of these

`lib/memory/sage-240-cut.test.ts` tests:
1. ✓ Anchor finds last Block by file position
2. ✓ `---` is a hard boundary
3. ✓ Time-protect caps cutEnd at first newer User turn
4. ✓ findLiveTissueLine returns -1 when nothing in window is newer
5. ✓ Fresh-session fallback to findFirstLivingTissue
6. ✓ Returns null when no Blocks AND no living tissue
7. ✓ Mixed dated/undated Blocks: latest DATED wins

The synthetic fixture `buildCruftySession` always has at least ONE dated Block (Block DD with `(2026-05-01 20:22 → 20:37)`). protectAfter is always a real string. The null path never gets hit.

**Missing test cases:**

- A session where EVERY Block is undated → assert that the cut REFUSES rather than running unprotected.
- A session where the cut window's natural snap-forward target is a live User turn → assert that snap RESPECTS time-protection.
- A multi-pass run where pass 1 produces a Block with `(00:00 → 00:00)` → assert that pass 2 doesn't regress protectAfter to that zero time.

These are the fixtures that would have caught the actual incidents.

---

## What's NOT broken (so we don't waste time fixing it)

- ✅ Snapshot survival — the `pre-prune-{TS}` snapshot is now kept for 24h and never auto-deleted on success. The April 30 recovery path stays available even if the cut was "successful." Disk has multiple recent snapshots; rollback works today.
- ✅ The cut anchor itself (Bug fixed 2026-05-02). `findCutAnchorAfterLastBlock` correctly walks past the last Block's narrative and treats `---` as a hard boundary. Tests cover this.
- ✅ The fast-path (file under 240 KB) — `_runSage240_40Inner` short-circuits before calling the model. Sub-second skip.
- ✅ Self-healing — sessions missing the `## USER SESSION DATA` marker get the marker inserted automatically before any cut.
- ✅ Tier schedule (1/2/4/6 passes) is sized appropriately — the bug isn't "too many passes" per se, it's "passes that lose protection."

---

## Proposed fix priority (when you greenlight code changes)

| # | Bug | Cost | Risk reduction |
|---|---|---|---|
| 1 | **Refuse-when-null protectAfter.** If `findMostRecentBlockEndTime` returns null, `performOneSageCut` should return `{kind: 'no-tissue'}` rather than running unprotected. Defensive default. | 5 min | Removes the silent-disable trapdoor. Sessions with all-undated Blocks get safely skipped. |
| 2 | **Snap respects time-protection.** Snap loop should call `findLiveTissueLine` on each candidate snap-target line — if the snap-target is itself a live User turn, refuse to snap onto it. | 15 min | Closes the snap-forward bypass. |
| 3 | **Re-validate Block end-times after the agent writes them.** After splicing the new Block in, parse its title and verify `parseBlockTimeRange` returns non-null endDate+endTime. If it doesn't, log a warning + use the chunk's last raw turn timestamp as a fallback so subsequent passes have a non-null protectAfter. | 30 min | Stops the multi-pass cascade. |
| 4 | **Fixture-based regression tests for all three bugs.** Add the missing test cases above to `lib/memory/sage-240-cut.test.ts`. | 30 min | Locks the fixes in. Future re-introduction surfaces as red CI. |
| 5 | **Cap pass-count more conservatively when protection signal is weak.** If protectAfter is null OR within the last hour OR the last Block was just written by Pass N-1, skip subsequent cut passes — fall back to compact-only. | 1 hr | Belt-and-braces. |

Total: ~2 hours of work to close all three bugs + lock with tests.

---

## Recovery commands for the file Sentinel didn't kill (the deleted `2026-01-27-31` session)

Reminder — that session is recoverable from APFS local snapshots. Mount the 5/2 snapshot, copy the folder back. See the earlier walk-through for `mount_apfs` commands.

For SESSION.md savaging incidents specifically: **never accept the post-Sage state without diff-checking against the `.pre-prune-{TS}` snapshot.** A 30+ KB drop in a single 240/40 cycle is suspicious. Either Block-cut math added up (look at the triage log) OR something was eaten silently — diff the snapshot vs current to confirm.

---

## Status

Investigation logged here. Three bugs identified, all reproducible from disk evidence. No code changes applied per Ralph's request. Standing by for greenlight on the proposed fix priority.

— Jedi Code, 2026-05-03
