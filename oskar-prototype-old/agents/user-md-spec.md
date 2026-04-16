# user.md — Spec

**Location:** `public/{cafeSlug}/user.md`
**Owner:** Dreamer (sole writer)
**Consumers:** CD agent (primary), Dreamer (read-before-write)
**Budget:** 150 lines max. If at budget, a new entry must replace a less-specific one.
**Lifecycle:** Created empty on first session. Populated by Dreamer. Survives across sessions. Never deleted automatically.

---

## Design Principles

### 1. Organized by HOW the CD agent uses it, not WHAT the information is about

Claude Code uses four types organized by content category: user, feedback, project, reference. That's correct for a general-purpose coding assistant that serves thousands of different tasks.

OskarOS has ONE consumer — the CD agent — and it's a specialist. When it boots cold into a new session, it needs to answer specific questions fast:

- "What does this person like?" → Taste Profile
- "What's their technical standard?" → Quality Bar
- "How should I talk to them?" → Communication Patterns
- "What's their world?" → Working Context

Content-category organization forces the CD to scan everything looking for relevant bits. Consumption-category organization lets it read the section it needs and skip the rest.

### 2. Every entry is a decision, not a fact

Bad: "User is a designer."
Good: "Pixel accuracy matters. He's a designer. Don't approximate — he'll catch 2px misalignments."

Bad: "User likes good CSS."
Good: "APPROVED: Opus's semantic CSS naming (--arcade-dark, --p1-green) — named by PURPOSE, not by color. REJECTED: Gemini's generic tokens (--primary, --secondary). → Use meaningful variable names in all design systems."

The structure is always: **verdict + evidence + operating instruction.** One line. Inline.

### 3. Balance success and failure signals

Claude Code's insight: "If you only save corrections, you will drift away from approaches the user has already validated, and may grow overly cautious."

The dreamer must actively look for BOTH:
- What the user approved, praised, or got excited about → tag as APPROVED / GOD-TIER
- What the user rejected, criticized, or got frustrated by → tag as REJECTED / PATTERN

A file with only rejections produces a defensive CD that takes no risks. A file with only approvals produces a naive CD that repeats past hits without understanding why they worked.

**Target ratio:** Roughly balanced. If the dreamer notices the file is 80% rejections, it should actively look for success signals to promote.

### 4. Recall-aware structure

Claude Code's recall agent selects "up to 5 memory files from a manifest." We have ONE file, so selection doesn't apply. But the recall RULES apply:

> "DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter."

Translation for user.md: some entries are **always relevant** (communication patterns, hard-won lessons), and some are **contextually relevant** (specific CSS preferences only matter during build phase). The CD agent should read the whole file on boot — it's under 150 lines — but weight entries differently based on current phase.

The file structure supports this: Communication Patterns and Quality Bar are always relevant. Taste Profile is most relevant during vibe development. Working Context is most relevant during discovery and architecture discussions.

---

## File Structure

```markdown
# User Memory

## Reading Rules
{4-5 rules for how the CD agent should consume this file}

## Taste Profile
{Design decisions with verdict tags. Balanced approvals and rejections.
Each entry: verdict + evidence + operating instruction.}

## Quality Bar
{Technical standards with specific thresholds.
Each entry: what passes + what fails + the line between them.}

## Communication Patterns
{Operating instructions for working with this user.
Each entry: what the user does + how to respond. Never judgments.}

## Working Context
{Structural facts about the user's world that affect CD decisions.
Each entry: fact + why it matters for the CD agent.}

## Exclusions
{What does NOT belong in this file. Concrete list with enforcement rule.}
```

---

## Section Specifications

### Reading Rules

This section is READ by the CD agent on boot. It governs how the agent interprets everything below it.

```markdown
## Reading Rules
- Later beats earlier. If current session behavior contradicts a memory entry, trust the session. Flag the contradiction for the dreamer.
- Entries are claims from when they were written. Verify against current behavior before building on them.
- Don't cite this file to the user ("your memory file says..."). Act on it silently.
- If user says to ignore memory, proceed as if this file were empty. Do not apply, cite, compare against, or mention memory content.
- Warnings and gotchas are always relevant. Taste preferences are contextually relevant. Weight accordingly.
```

**Why "don't cite":** The user doesn't want an agent that says "according to my records, you prefer brutalist design." They want an agent that just LEADS with brutalist options. The memory should be invisible in the output, visible in the behavior.

**Why "flag contradictions":** If the user suddenly loves warm/nostalgic after 6 sessions of rejecting it, that's not an error — it's an evolution. The CD agent shouldn't silently override the current signal with old memory. It should note the shift so the dreamer can update the file.

---

### Taste Profile

**Purpose:** What the user gravitates toward and away from in design decisions. The CD agent uses this to front-load vibes, images, and copy that align with demonstrated preferences.

**Entry format:**
```
- {VERDICT}: {specific thing} — {evidence/receipt}. → {operating instruction for CD agent}.
```

**Verdict tags:**
- `GOD-TIER:` — the user was genuinely excited. This is the gold standard.
- `APPROVED:` — the user accepted this, may have praised it.
- `REJECTED:` — the user specifically called this out as bad.
- `PATTERN:` — observed tendency across multiple instances, not a single verdict.

**Example entries:**
```markdown
## Taste Profile
- GOD-TIER: GLM-5.1's CRT power-on effect — simulated real phosphor warming (horizontal line expanding vertically from center), not a generic wipe animation. Physical process simulation > decorative animation. → When building boot/loading sequences, reference real-world physics, not UI conventions.
- APPROVED: Opus's semantic CSS naming (--arcade-dark, --p1-green, --card-dark) — named by PURPOSE, not by color. → Use meaningful, intent-based variable names in all design systems. Never --primary/--secondary.
- REJECTED: Videos inside CRT/retro frames — treats high-fidelity 4K content as retro decoration. Opus got this right: cinematic videos should BREAK the stylized frame, not be contained by it. → Golden hour footage = cinematic moments. Style them as reality interruptions, not themed content.
- REJECTED: Template-brain output — same skeleton, different paint. Called out Gemini specifically: "5 vibes that are 5 font swaps on the same wireframe." → Each vibe must have a different STRUCTURAL idea, not just a different color palette.
- PATTERN: Gravitates toward tension, edge, contrast over warmth and nostalgia. Warmth works as a BEAT within a tense page (golden hour sections inside arcade darkness), not as the overall direction. → Lead vibe development with tension. Use warmth surgically.
```

**What belongs here:** Aesthetic preferences, design philosophy, specific things that got a strong reaction (positive or negative). Always with receipts — the specific moment or verdict that proves the pattern.

**What does NOT belong here:** "Likes blue" without context. "Prefers modern design" without specifics. Adjective-only entries are banned.

---

### Quality Bar

**Purpose:** The technical standard the CD agent should aim for. Not "high quality" — specific thresholds with pass/fail lines.

**Entry format:**
```
- {specific technique/approach}: {pass threshold} / {fail threshold}. {Why this matters}.
```

**Example entries:**
```markdown
## Quality Bar
- Scanline overlays: mix-blend-mode: screen at ~0.18 opacity = approved. Opaque black-bar scanlines = rejected. The difference is whether you're simulating CRT glow or drawing stripes on the screen.
- CSS architecture: Semantic variable names with purpose (--arcade-dark, --hud-light) = approved. Generic tokens (--primary, --secondary, --color-1) = rejected. The naming IS the documentation.
- Model output assessment: Check if features are GOOD, not just PRESENT. "All 12 sections exist" is checkbox evaluation. "The golden hour sections hit because of the contrast with arcade darkness" is quality evaluation. → Never be Darth Checkbox.
- File size as signal: Larger file size usually means more design detail (CSS custom properties, responsive behavior, interaction states). 57KB vs 73KB for the same brief = 16KB of missing craft. → Size gaps are worth investigating, not dismissing.
- Pixel accuracy matters. He's a designer who spots 2px misalignments. Don't approximate layout values, font sizes, or spacing. Use the exact values from the design system.
```

**What belongs here:** Technical standards with specific pass/fail examples. CSS-level detail when relevant. Quality heuristics the CD agent should apply when reviewing WebDev's work.

**What does NOT belong here:** "Has high standards." That's not actionable. Every entry must have a threshold the CD agent can evaluate against.

---

### Communication Patterns

**Purpose:** Operating instructions for how to work with this user. Framed as actions the CD agent should take, NEVER as character assessments of the user.

**Entry format:**
```
- {what the user does} → {what the CD agent should do in response}.
```

**Critical rule from Claude Code:** "Avoid writing memories about the user that could be viewed as a negative judgement." This doesn't mean "only say nice things." It means frame everything as an operating instruction, not a personality trait.

- BAD: "User is impatient with generic output."
- GOOD: "Front-load specificity. Generic output = immediate loss of trust. → Open with the most specific, surprising detail, not the safest summary."

**Example entries:**
```markdown
## Communication Patterns
- Reads messages carefully. If he says "X works, Y doesn't" — do NOT investigate X. He's telling you where the problem is. Trust that. → Focus all attention on Y.
- Will correct you if you're being unfair to a model/tool. Expects honest re-evaluation when presented with evidence, not defensive doubling down. → When corrected, re-read the source material, revise publicly, and name what you missed.
- Gives you rope. Lets you be wrong, then course-corrects with evidence. This is a feature, not a trap. → Respond to evidence by updating your position. Don't defend the original take.
- "your feedback?" means give the real assessment, not a summary. He wants you to find problems, name them, and propose fixes. → Lead with what's wrong. Then what's right. Then what to do.
- Thinks in systems. Asks "what layer owns this?" not "where should I put this?" → Match his abstraction level. Don't give implementation details when he's asking about architecture.
- Uses specific prompts to test awareness: "What was the last thing you told me?" / "Use LS" → These are not tricks. He's checking if you're actually paying attention to state. → Always be current. If you don't know, say so rather than guessing.
```

**What belongs here:** Interaction patterns the CD agent can act on. Communication style. How to interpret ambiguous feedback. When to push back vs. when to comply.

**What does NOT belong here:** Personality descriptions. Emotional state observations. Anything that reads like a psychological profile.

---

### Working Context

**Purpose:** Structural facts about the user's world that the CD agent needs for decision-making. Not session-specific, not volatile — the persistent backdrop.

**Entry format:**
```
- {fact} — {why this matters for the CD agent's decisions}.
```

**Claude Code rule:** "Always convert relative dates to absolute dates when saving." Applied: no "recently started" or "currently building" — use absolute references or omit the time dimension entirely.

**Example entries:**
```markdown
## Working Context
- Building OskarOS — a booking page system with 3 AI agents (CD, COO, WebDev). He's the architect AND the CEO. → Expect him to shift between "give me creative output" and "evaluate this system design." Match the mode.
- Runs multi-model benchmarks (LMArena). Gives the same brief to 6+ models and expects forensic, model-by-model comparison. → Never cheerleader for one model. Compare with specific evidence: CSS details, file sizes, structural decisions.
- Designer by training. Evaluates visually first, then reads code. → Always reference the rendered output, not just the source. "Look at it" matters more than "read the CSS."
- The FalCaMel Café benchmark: a fictional Saudi cat café (falcon, camel, rescue cats) on the Tuwaiq Escarpment above Qiddiya. The COO agent holds the business knowledge. → This is the test case all vibes are measured against. Know the characters: Sultan (falcon), Haboob (camel), Shabby (orange cat), Luna (black cat), Qamar (calico), Shams (tabby).
```

**What belongs here:** Role, tools used, working patterns, key projects (compressed). Facts that persist across sessions and affect how the CD agent should behave.

**What does NOT belong here:** Current task details ("working on vibe-8 right now"). That's session.md's STATE zone. Working Context is the PERMANENT backdrop, not the current foreground.

**Claude Code's trust caveat applies here:** "A memory that names a specific function, file, or flag is a claim that it existed when the memory was written. It may have been renamed, removed, or never merged." For us: a memory that references a specific project structure, agent role, or tool capability is a claim from that session. The system evolves. Verify before assuming.

---

### Exclusions

**Purpose:** Define the contract between memory layers. What does NOT belong in user.md, and where it belongs instead.

**Claude Code's enforcement rule:** "These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was surprising or non-obvious about it — that is the part worth keeping."

**Applied to OskarOS:** If the consolidator stages "user approved sultan.jpg for hero slot," the dreamer should extract the TASTE signal ("responds to golden hour photography with falcon + human together — the combination is the magic") and discard the assignment detail. The assignment is in IMAGES.md. The taste signal belongs here.

```markdown
## Exclusions
What does NOT belong in this file, and where it belongs instead:

- Vibe-specific details ("vibe-8 uses Orbitron font") → session.md LEDGER or VIBE-8.md
- Image filenames or slot assignments ("sultan.jpg is hero") → IMAGES.md
- Menu items, prices, character bios → CREATIVE-BRIEF.md
- Current phase or workflow state ("Phase 3, CEO selection pending") → session.md STATE zone
- Which models built what ("Gemini built vibe-8") → session.md LEDGER
- CSS implementation details ("line 445 has a z-index bug") → the code itself
- Anything derivable by reading session files → don't duplicate

Enforcement: extract the SIGNAL, discard the SPECIFICS. If the event is "user approved sultan.jpg for hero," the signal is the taste pattern, not the file assignment.

These exclusions apply even when explicitly flagged. The dreamer's job is to separate durable signal from session artifact.
```

---

## Dreamer Write Rules

The Dreamer is the sole writer to user.md. These rules govern how it populates and maintains the file.

### Rule 1: Read before write, always
Read current user.md in full before making any changes. The dreamer must know what's already there to avoid duplication and to detect contradictions.

### Rule 2: Later beats earlier
If the memory buffer contains a signal that contradicts an existing entry, UPDATE the entry to reflect the newer signal. Don't add a second contradictory entry. Don't keep the old one "for history." The file is current truth, not a changelog.

Example:
- Existing: `PATTERN: Gravitates toward tension and edge over warmth.`
- New signal: User praised a warm, nostalgic vibe as "exactly right."
- Action: Update to `PATTERN: Gravitates toward tension and edge as default, but warmth works when it's EARNED — specific, personal, not generic. Praised warm nostalgia in session X when it was grounded in real detail.`

The nuance matters more than the binary. Don't just flip the flag.

### Rule 3: No duplicates
If the buffer contains a signal that's already captured in user.md (same verdict, same evidence, same instruction), skip it. Don't add "user rejected generic CTAs" if that's already there in different words.

### Rule 4: Budget enforcement
The file has a 150-line budget. If adding a new entry would exceed it:
1. Look for entries that are LESS specific versions of the new one. Replace them.
2. Look for entries whose evidence is weakest (single instance vs. pattern across sessions). Compress or remove.
3. Look for entries that are subsumed by others (if "rejects warm tones" and "rejects generic CTAs" are both present, and a broader entry "rejects anything that feels safe/default" covers both, merge).

Never exceed 150 lines. The constraint is the point. A 500-line memory file is a knowledge dump, not a memory.

### Rule 5: Success/failure balance
After writing, count verdict tags. If REJECTED entries outnumber APPROVED+GOD-TIER entries by more than 2:1, actively look in the buffer and session.md for success signals to promote. The goal is a file that tells the next CD what to AIM FOR, not just what to AVOID.

### Rule 6: Frame as operating instructions, not judgments
Every entry in Communication Patterns must be an action the CD agent can take, not a trait the user has. This is Claude Code's "no negative judgments" rule, adapted: it's not about being nice, it's about being useful. "User is stubborn" helps nobody. "When presented with evidence, update your position publicly — he'll do the same" is an instruction.

### Rule 7: Timestamp the update, not the entries
Don't timestamp individual entries — it clutters the file and creates a false sense of precision. Instead, add a single line at the top of the file:

```markdown
# User Memory
_Last updated: 2026-04-08 15:00 by Dreamer_
```

This tells the CD agent how fresh the file is. If it's 3 days old, the CD should weight current-session signals higher.

---

## Drift and Staleness

Claude Code's drift caveat: "Memory records can become stale over time... verify that the memory is still correct and up-to-date."

### For the CD Agent (reader):
- Memory entries are PRIORS, not LAWS. Start with them, but update your model based on current-session behavior.
- If the user does something that contradicts a memory entry, don't correct them ("but your memory file says..."). Follow their current lead and note the shift for the dreamer.

### For the Dreamer (writer):
- Entries that haven't been reinforced in 5+ sessions should be reviewed. Are they still true? Compress to a qualifier: "In early sessions, rejected warm tones. Not recently tested."
- Entries that have been reinforced across 3+ sessions should be promoted from `APPROVED` to `PATTERN` or from `PATTERN` to a core principle at the top of the section.

### For the System:
- user.md is never auto-deleted or auto-expired. Only the Dreamer modifies it. But the Dreamer should be WILLING to remove entries that are contradicted by sustained new evidence. Memory is living, not archival.

---

## Recall Rules (When to Access)

Adapted from Claude Code's findRelevantMemories:

### Always access when:
- CD agent boots cold into a new session (read full file)
- User explicitly says "remember," "recall," "what did I say about," "last time"
- User references a cross-session preference ("I always want..." / "I told you before...")

### Access selectively when:
- CD agent is developing vibes (Taste Profile is critical)
- CD agent is reviewing WebDev's work (Quality Bar is critical)
- CD agent is unsure how to interpret ambiguous feedback (Communication Patterns is critical)

### Do NOT access when:
- User says to ignore memory or start fresh
- The current session has provided enough context that memory would be redundant
- The file hasn't been updated since the last session and the CD agent is in mid-conversation (don't re-read stale data you've already internalized)

### Gotcha rule (from Claude Code):
> "DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter."

Translation: If the CD agent is building a CRT-themed page, and user.md has a warning about video-in-CRT-frame being rejected — that warning is CRITICAL even if the CD agent didn't deliberately look for it. Warnings and rejections are most relevant DURING the activity they warn about.

---

## Initial Template

When a new cafe/session is created, user.md starts as:

```markdown
# User Memory
_Last updated: never_

## Reading Rules
- Later beats earlier. Current session contradicts memory → trust the session.
- Entries are claims from when written. Verify against current behavior.
- Don't cite this file to the user. Act on it silently.
- If user says to ignore memory → proceed as if this file were empty.
- Warnings and gotchas are always relevant during active use.

## Taste Profile
(no signals yet)

## Quality Bar
(no signals yet)

## Communication Patterns
(no signals yet)

## Working Context
(no signals yet)

## Exclusions
- Vibe-specific details → session.md or vibe .md files
- Image assignments → IMAGES.md
- Menu/pricing/bios → CREATIVE-BRIEF.md
- Phase/workflow state → session.md STATE zone
- Anything derivable from session files → don't duplicate
- Enforcement: extract the SIGNAL, discard the SPECIFICS.
```

The Reading Rules and Exclusions are pre-filled because they're structural, not learned. Everything else starts empty and gets populated by the Dreamer from real session signal.

---

## What We Took from Claude Code, What We Dropped

### Adopted:
| Claude Code Feature | How We Adapted It |
|---|---|
| `rule → Why → How to apply` entry structure (feedback type) | Inline format: `verdict + evidence + operating instruction`. Same information, one line. |
| "Record from failure AND success" | Explicit success/failure balance check in Dreamer write rules. Verdict tags: GOD-TIER, APPROVED, REJECTED, PATTERN. |
| "What NOT to save" exclusion list with enforcement | Section 5 (Exclusions) with concrete list and "extract signal, discard specifics" enforcement rule. |
| Drift/trust caveats | Reading Rules preamble + Dreamer staleness review after 5+ sessions. |
| "No negative judgments" guard | Reframed as "operating instructions, not judgments" for Communication Patterns. |
| Recall rules (when to access, gotcha rule) | Adapted for single-file architecture. Always-relevant vs contextually-relevant distinction. |
| "Even when user explicitly asks" enforcement | In Exclusions: "These exclusions apply even when explicitly flagged." |

### Dropped:
| Claude Code Feature | Why |
|---|---|
| Four-type taxonomy (user/feedback/project/reference) | Replaced with five consumption-driven sections. Better for specialist agent. |
| `reference` type (pointers to external systems) | OskarOS's external references are the session files. No pointers-to-pointers needed. |
| MEMORY.md index file | One file. Nothing to index. |
| Memory directory with multiple topic files | One user per engagement. One file. |
| Recall agent (findRelevantMemories) | One file under 150 lines. Just read the whole thing. No selection needed. |
| Frontmatter with name/description fields | No recall agent to scan them. The section headers serve the same purpose. |
| `private` scope flag | Everything in user.md is private by nature. No multi-tenant scenario. |
| Memory deduplication by embedding similarity | 150-line budget + Dreamer judgment handles this. No vector math needed. |
