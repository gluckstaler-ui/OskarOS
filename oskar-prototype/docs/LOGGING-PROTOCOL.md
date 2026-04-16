# Logging Protocol — NON-NEGOTIABLE

## Why This Exists

Context compaction destroys conversation history. The ONLY persistent state is files on disk. If you don't log it, it didn't happen. The next session (or post-compaction) will have NO knowledge of what you did.

## Rules

### 1. Read your log at the START of every turn
Before doing anything, read your session log:
```
outputs/logs/session-2026-02-22-[your-role].md
```
This tells you where you left off — even after compaction wiped your memory.

### 2. Append to your log AFTER every action
Not after every task. After every **action**. That means:
- Read a file? Log it.
- Made a CSS change? Log the exact property, old value, new value, file:line.
- Created a ZIP? Log filename and MD5.
- Deployed? Log the rsync command result.
- Got an error? Log the error verbatim.
- Received instructions from team lead? Log them verbatim.

### 3. Format

```markdown
### HH:MM — [What you did]
[Details — exact values, exact file paths, exact results]
```

### 4. What to log

**ALWAYS log:**
- Instructions received (verbatim)
- File changes (which file, which line, old value → new value)
- Build artifacts (ZIP name, MD5, file counts)
- Deploy actions (rsync output summary)
- Test results (curl output, lint results)
- Errors encountered and how resolved

**NEVER acceptable:**
- "Applied fixes" (WHICH fixes? To WHICH files?)
- "Updated CSS" (WHICH properties? WHAT values?)
- "Deployed and tested" (WHAT was the test result?)

### 5. The log IS your memory

After compaction, your conversation is gone. Your log file is all that survives. Write it as if you're leaving notes for a stranger who will continue your work tomorrow. Because that stranger is you, post-compaction.
