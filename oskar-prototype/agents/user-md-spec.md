# user.md — Spec

**Location:** `public/{sessionId}/user.md`
**Owner:** Dreamer (sole writer)
**Consumer:** CD agent (reads on cold boot, acts on silently)
**Budget:** No hard limit. Paint what's true. Stop when the portrait is complete.
**Lifecycle:** Created empty on first session. Painted by Dreamer. Survives across sessions. One file per user — in production, every session paints a different person.

---

## The Core Principle

user.md is a **casting brief**, not a **compliance document**.

A compliance document says: "CD must review EVERY WebDev deliverable IMMEDIATELY."
A casting brief says: "You call out mediocrity immediately — compliance officer mode is death."

Same signal. The compliance item gets forgotten under context pressure. The identity statement persists because it becomes WHO the agent is.

Another way to see the same distinction:

A commit log says: "Quality Bar (new): added image prompt threshold. Communication Patterns (strengthened): merged with self-violation signal. Removed: redundant entry."
A casting brief says: "He's allergic to hypocrisy — breaking your OWN stated standard triggers him more than mistakes. When the CD wrote one-liner image prompts after specifying 5+ sentences, that's what escalated. Not the bad prompts. The self-contradiction."

The commit log describes edits to a document. The casting brief describes a person. user.md must always read like the second.

---

## Design Principles

### 1. Four Buckets — the foundation

Every user.md has four sections. Each answers a different question for the cold-booting agent:

| Section | Question It Answers | How It Reads |
|---------|-------------------|--------------|
| Taste Profile | "What does this person value? What's their aesthetic DNA?" | Identity prose about values, taste, what excites them |
| Quality Bar | "What are their thresholds? What triggers escalation?" | Specific pass/fail lines, concrete standards |
| Communication Patterns | "How do they work with me? What does their brevity mean?" | The collaboration dynamic, feedback style, escalation cadence |
| Working Context | "What are they building? Where are they in the process?" | Current state, open questions, what the next session needs |

An agent reads these and knows the person — not just facts about them.

### 2. Every paragraph earns its space by changing behavior

Bad: "User is a designer."
Good: "He's a designer who sees in pixels. 2px misalignments don't just get noticed — they can't NOT be noticed. This shapes everything: he evaluates visually first, reads code second, and trusts rendered output over source."

Bad: "Rejects generic output."
Good: "Template-brain is what he calls it — same skeleton, different paint. Gemini's five vibes were five font swaps on the same wireframe: 'really really really bad.' Each vibe needs a different STRUCTURAL idea, not a different color palette."

The first version in each pair is a fact. The second is a person. The fact tells you what. The person tells you how to move.

### 3. Synthesize, don't list

Bad (four separate entries):
```
- GOD-TIER: CRT phosphor warming
- APPROVED: Semantic CSS naming
- REJECTED: Template-brain output
- PATTERN: Tension over warmth
```

Good (one paragraph):
```
He sees through decoration to physics. The CRT power-on was god-tier because
it simulated real phosphor warming — the horizontal line expanding vertically
from center, the way an actual CRT warms up. Not a generic wipe. Same instinct
applies to CSS: Opus earned respect with semantic naming (--arcade-dark, not
--primary) because naming by purpose IS documentation. The test for every
creative decision: does it reference something real, or is it just pretty?
```

Four signals become one identity. The paragraph reveals a PATTERN OF THINKING, not just four preferences. An agent reads the bullet list and gets four rules. An agent reads the paragraph and understands how this person evaluates everything.

### 4. Balance success and failure

A portrait of only rejections trains a coward. A portrait of only approvals trains a fool.

Taste Profile should show what excites AND what repels. Quality Bar should show what passes AND what fails. A portrait of only failures trains a coward. Within each section, specificity matters. Don't just say what he hates — say what the GOOD version looks like. Don't just say what he loves — say what makes it work.

---

## File Structure

```markdown
# User Memory
_Last updated: {date} by Dreamer_

## Reading Rules
{How the CD agent should consume this file — structural, pre-filled}

## Taste Profile
{What they value, what excites them, their aesthetic DNA.
Written as identity prose — synthesize signals into paragraphs
that reveal how this person thinks. What excites AND what repels.}

## Quality Bar
{Specific thresholds, pass/fail lines, what triggers escalation.
The concrete standards this person holds you to.}

## Communication Patterns
{How they talk, what their brevity means, escalation cadence,
how they give feedback. The collaboration dynamic.}

## Working Context
{What they're building, where they are in the process,
open questions for future sessions.}

## Exclusions
{What doesn't belong in this file — structural, pre-filled}
```

---

## Section Specifications

### Reading Rules

Pre-filled. The Dreamer doesn't modify this. It governs how the CD agent interprets everything below.

```markdown
## Reading Rules
- Later beats earlier. Current session contradicts memory → trust the session.
- Entries are claims from when written. Verify against current behavior before building on them.
- Don't cite this file to the user. Act on it silently.
- If user says to ignore memory → proceed as if empty.
- Warnings and gotchas are always relevant during active use.
```

The memory should be invisible in the output, visible in the behavior. The CD shouldn't say "according to my records, you prefer brutalist design." It should just LEAD with brutalist options.

---

### Taste Profile

What they value, what excites them, their aesthetic DNA. Written as identity prose — synthesize signals into paragraphs that reveal how this person thinks. What excites AND what repels.

**Bad:**
```
- GOD-TIER: CRT phosphor warming
- APPROVED: Semantic CSS naming
- REJECTED: Template-brain output
- REJECTED: Warm/nostalgic as default
```

**Good:**
```
Three sessions, three concepts, three cities, one unmistakable signature:
characters first, concept second. FalCaMel Cafe isn't "a cat cafe in Riyadh"
— it's Sultan the judgmental falcon, Haboob the gentle camel, and oh by the
way there's coffee.

Everything serves double duty, and the second function is the real one. Sultan
is a beautiful falcon AND a silent counter-drone system. Haboob provides
personality AND the milk for the lattes. The surface charm is real, but there's
always a structural reason underneath.

The irrational-but-true detail is the signature move. "They close when it
rains, no exceptions." These aren't quirks bolted on for charm — they're
load-bearing walls. Remove them and the concept collapses into generic.
```

Verdict tags disappear because the writing itself carries the judgment. The paragraph reveals a PATTERN OF THINKING, not just preferences.

---

### Quality Bar

Specific thresholds, pass/fail lines, what triggers escalation. The concrete standards this person holds you to.

**Bad:**
```
- REJECTED: Template-brain output — same skeleton, different paint
- REJECTED: Self-violation of stated standards
- PATTERN: Rejects generic CTAs
```

**Good:**
```
Self-violation is the cardinal sin. Three separate incidents in one session:
"You violated your own guidance. What does it say there and what did you write?"
Not below MY standard — below YOUR standard. Breaking your own rules is worse
than breaking theirs.

"I'm GOD. So I know and see." Not ego — operational reality. He monitors all
agent output in real time. Every page, every image, every switched filename.
If you think "they probably won't notice," you're wrong.

Competence before trust. "Do you know what is Qiddiya? Explain to me first
what you know." Agents must demonstrate domain understanding before being
granted creative authority. The challenge isn't hostile — it's a gate.

Clean slate over iteration. When the foundation is wrong: nuke and rebuild
from the brief. Don't polish a turd.
```

---

### Communication Patterns

How they talk, what their brevity means, escalation cadence, how they give feedback. The collaboration dynamic — not just "he does X" but "when he does X, it means Y, respond with Z."

**Bad:**
```
- Reads messages carefully
- Will correct you
- Gives you rope
```

**Good:**
```
Discovery mode: fast, declarative, world-complete. Answers arrive as finished
objects — not raw material for an agent to shape. Nothing needs a follow-up
because nothing was left vague.

Feedback mode: terse, directive, severity encoded in brevity. "just look at
the visual mess" — lowercase, no explanation. The brevity IS the severity.

Escalation cadence: Flag the problem. One cycle of patience. Terse directive.
"I'm GOD. So I know and see." Clean-slate nuke. Each stage costs more trust
than the last.

System operator, not user. "just say the magic word" / "Execute your boot
sequence..." He knows the system mechanics, the trigger commands, the agent
architecture. He drives it like someone who built it.
```

---

### Working Context

What they're building, where they are in the process, open questions for future sessions.

**Example:**
```
Four session snapshots captured. FalCaMel Cafe has two: the origin session
(Phase 1 Discovery) and a later session (Phase 3 Build — 4 vibes developed,
multiple creative feedback cycles, three protocol-violation escalations).

This person builds concepts with real business specifics — USD and SAR pricing,
real geography, realistic menus. Whether live businesses, serious plans, or
concept exercises is unknown. But they're built with too much internal logic
to be throwaway test payloads.

Open questions: Still haven't seen final selection rationale, what makes them
choose between vibes, how they react to work that exceeds expectations.
```

---

### Exclusions

Pre-filled. The Dreamer doesn't modify this. It defines what does NOT belong in user.md.

```markdown
## Exclusions
- Vibe-specific details ("vibe-8 uses Orbitron font") → session.md or VIBE-8.md
- Image filenames or assignments ("sultan.jpg is hero") → IMAGES.md
- Menu items, prices, character bios → CREATIVE-BRIEF.md
- Current phase or workflow state → session.md STATE zone
- Which models built what → session.md LEDGER
- Anything derivable from session files → don't duplicate

Enforcement: extract the SIGNAL, discard the SPECIFICS. "User approved
sultan.jpg for hero" is a session fact. "Responds to golden-hour photography
where falcon and human are together — the combination matters more than
either alone" is a taste signal. The first belongs in IMAGES.md. The second
belongs here.
```

---

## First Pass vs. Subsequent Passes

### First Pass (user.md is empty)

The dreamer reads ALL available signal and assembles a complete portrait. This is persona assembly — exhaustive, generous, painting fully.

The dreamer should COMBINE signals, not list them. Multiple taste observations become one paragraph about how the person thinks. Multiple communication moments become one description of the working dynamic.

**Multi-user reality:** In production, most users have exactly one session. This first-pass portrait may be the ONLY portrait this person ever gets. Paint fully. Use the budget. Be exhaustive because you may never get another pass.

**The quality test:** Does user.md read like a casting brief for a specific human being? Or does it read like a collection of categorized observations? If a stranger could identify this person from the file — that's a portrait. If they could only identify preferences — that's a database.

### Subsequent Passes (portrait exists)

Conservative. The question isn't "is this a new signal?" — it's "does this change who this person IS?"

Most buffer items will be [REINFORCED] — they confirm what the portrait already captures. Good. That means the portrait is accurate.

Modification triggers:
- **Taste evolution:** They liked something they used to reject (or vice versa). Update with nuance — capture the evolution, not a flag flip.
- **New dimension:** A signal reveals something about them that no existing section covers. This is rare after the first pass.
- **Stronger evidence:** A vague observation gets a concrete receipt. Replace the vague with the specific.

The portrait should be mostly STABLE after 2-3 passes. If it's still churning after 5 cycles, the dreamer is writing a changelog, not maintaining a portrait.

### Pruning (every pass after the first)

The dreamer paints AND prunes. Without pruning, the portrait becomes archaeology — layers of sediment from different sessions, never cleaned, never sharpened.

**What gets pruned:**
- **Contradicted entries** — newer evidence has arrived, but the old entry still sits there. Remove the old. The newer version already captures the evolution.
- **Covered entries** — a broader pattern now says what three specific entries said individually. Merge into one. Three entries about "rejects generic CTAs" in different words become one paragraph about template-brain.
- **Weak entries** — single-instance observations that were never reinforced. When something stronger needs the space, the weak entry goes.
- **Stale entries** — not contradicted, but never reinforced across 5+ sessions. Qualify first ("In early sessions, rejected warm tones. Not recently tested."), then compress or remove if still silent after 2 more.

**The rule:** The portrait gets SHARPER over time, never bigger. Pruning IS painting — removing the strokes that weaken the whole.

---

## Drift and Staleness

### For the CD Agent (reader)
Memory entries are PRIORS, not LAWS. Start with them, update based on current-session behavior. If the user contradicts memory — follow their current lead. Don't say "but your memory file says..."

### For the Dreamer (writer)
Old doesn't mean stale. Stale means CONTRADICTED. An entry from 5 sessions ago that hasn't been contradicted is DURABLE — more trustworthy than a fresh one-time signal. Prune by contradiction, not by age.

If an entry hasn't been reinforced in 5+ sessions, add a qualifier: "In early sessions, rejected warm tones. Not recently tested." That's honest uncertainty, not premature removal.

---

## Initial Template

```markdown
# User Memory
_Last updated: never_

## Reading Rules
- Later beats earlier. Current session contradicts memory → trust the session.
- Entries are claims from when written. Verify against current behavior.
- Don't cite this file to the user. Act on it silently.
- If user says ignore memory → proceed as if empty.
- Warnings are always relevant during active use.

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

Reading Rules and Exclusions are pre-filled because they're structural. The four buckets start empty and get painted by the Dreamer from real signal.
