# Checkpointing Protocol

## The Problem

Agents have a fixed context window. When an agent does heavy work (editing large HTML files, processing multiple files), the context fills up and the agent **dies mid-operation**. No warning. No graceful degradation. Just gone.

Without checkpointing, the next agent has no idea:
- What operation was in progress
- Which files were completed
- Where to resume

## The Solution

**Before ANY multi-file operation, write to BUILD.md.**

### The Active Checkpoint Section

```markdown
## Active Checkpoint

**Started:** HH:MM:SS
**Operation:** [What you're doing — e.g., "Updating About section in 4 vibe HTML files"]
**Content Source:** [Where the content lives — e.g., "CREATIVE-BRIEF.md § About Section"]
**Files Remaining:** vibe-1.html, vibe-2.html, vibe-3.html, vibe-4.html
**Files Complete:** —
```

### After EACH File Completes

Update immediately:

```markdown
## Active Checkpoint

**Started:** 14:50:00
**Operation:** Updating About section in 4 vibe HTML files
**Content Source:** CREATIVE-BRIEF.md § About Section
**Files Remaining:** vibe-2.html, vibe-3.html, vibe-4.html
**Files Complete:** vibe-1.html ✓
```

### When Operation Completes

Clear and log:

```markdown
## Active Checkpoint

_No active operation._
```

Add to Checkpoint History:
```markdown
| 14:50:00 | Update About section | 4 files | ✓ Complete |
```

---

## What TO Store

- Operation name (short description)
- Content SOURCE (file + section reference)
- File list (remaining vs complete)
- Timestamp

## What NOT TO Store

- Actual content (too large — causes the problem)
- Full file contents
- Large blocks of HTML/CSS/code

The content already exists in CREATIVE-BRIEF.md or elsewhere. Just reference it.

---

## Boot Sequence — Checking for Interrupted Operations

When an agent boots, it MUST:

1. Read BUILD.md
2. Check Active Checkpoint section
3. If checkpoint exists:
   - The previous agent died mid-work
   - Resume from checkpoint
   - Use the Content Source reference
   - Continue with Files Remaining
   - Skip Files Complete
4. If no checkpoint:
   - Proceed normally

---

## Why This Works

| Without Checkpointing | With Checkpointing |
|----------------------|-------------------|
| Agent dies mid-operation | Agent dies mid-operation |
| Next agent starts blind | Next agent reads checkpoint |
| Work is duplicated or lost | Work resumes from failure point |
| Files may be inconsistent | Files are consistent |

---

## Example Flow

### 1. Agent starts updating 4 vibe files

```markdown
## Active Checkpoint

**Started:** 14:50:00
**Operation:** Adding About section to vibes
**Content Source:** CREATIVE-BRIEF.md § About Section
**Files Remaining:** vibe-1.html, vibe-2.html, vibe-3.html, vibe-4.html
**Files Complete:** —
```

### 2. Agent completes first file

```markdown
## Active Checkpoint

**Started:** 14:50:00
**Operation:** Adding About section to vibes
**Content Source:** CREATIVE-BRIEF.md § About Section
**Files Remaining:** vibe-2.html, vibe-3.html, vibe-4.html
**Files Complete:** vibe-1.html ✓
```

### 3. Agent completes second file

```markdown
## Active Checkpoint

**Started:** 14:50:00
**Operation:** Adding About section to vibes
**Content Source:** CREATIVE-BRIEF.md § About Section
**Files Remaining:** vibe-3.html, vibe-4.html
**Files Complete:** vibe-1.html ✓, vibe-2.html ✓
```

### 4. Agent dies during third file (context exhaustion)

Checkpoint shows:
- 2 files complete
- 2 files remaining

### 5. New agent boots

1. Reads BUILD.md
2. Sees active checkpoint
3. Reads Content Source (CREATIVE-BRIEF.md § About Section)
4. Resumes with vibe-3.html
5. Completes remaining files
6. Clears checkpoint

---

## The Rule

**Never start a multi-file operation without checkpointing first.**

If you're about to touch more than one file, checkpoint. Period.
