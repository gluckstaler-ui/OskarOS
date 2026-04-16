#!/bin/bash
#
# Backfill user.md for all session folders using the dreamer agent.
# Reads SESSION.md, feeds it to claude --print with the real dreamer prompt,
# writes the resulting user.md.
#
# Usage:
#   ./scripts/backfill-user-md.sh                    # all sessions
#   ./scripts/backfill-user-md.sh 2026-04-08-4       # single session
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$SCRIPT_DIR/../public"
DREAMER_MD="$SCRIPT_DIR/../agents/dreamer-agent.md"
TARGET="${1:-}"
TMPDIR_BACKFILL="$SCRIPT_DIR/backfill-tmp"
mkdir -p "$TMPDIR_BACKFILL"
TMPFILE="$TMPDIR_BACKFILL/prompt.txt"
OUTFILE="$TMPDIR_BACKFILL/output.txt"

# The dreamer is a text pipeline — no Claude Code CLI.
# call-dreamer.mjs sends the full agent file + session data to the Anthropic API.
# No tools, no CLAUDE.md, no project memory. Just prompt in, text out.
CALL_DREAMER="$SCRIPT_DIR/call-dreamer.mjs"

agent_size=$(wc -c < "$DREAMER_MD" | tr -d ' ')
if [ "$agent_size" -lt 100 ]; then
  echo "ERROR: dreamer-agent.md too small (${agent_size}b)"
  exit 1
fi
echo "Dreamer agent: ${agent_size}b"

# Count sessions to process
total=0
for dir in "$PUBLIC_DIR"/2026-*/; do
  session="$(basename "$dir")"
  [ -n "$TARGET" ] && [ "$session" != "$TARGET" ] && continue
  [ -f "$dir/SESSION.md" ] && size=$(wc -c < "$dir/SESSION.md" | tr -d ' ') && [ "$size" -ge 500 ] && total=$((total + 1))
done
echo "Sessions to process: $total"
echo ""

current=0
for dir in "$PUBLIC_DIR"/2026-*/; do
  session="$(basename "$dir")"

  # Filter to target if specified
  [ -n "$TARGET" ] && [ "$session" != "$TARGET" ] && continue

  session_md="$dir/SESSION.md"
  user_md="$dir/user.md"

  # Skip if no SESSION.md
  if [ ! -f "$session_md" ]; then
    echo "[$session] No SESSION.md — skip"
    continue
  fi

  size=$(wc -c < "$session_md" | tr -d ' ')

  # Skip tiny sessions
  if [ "$size" -lt 500 ]; then
    echo "[$session] SESSION.md too small (${size}b) — skip"
    continue
  fi

  current=$((current + 1))
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "[$current/$total] $session  (SESSION.md: ${size}b)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  echo "  Mode: FIRST PASS"
  echo "  Calling dreamer via SDK..."
  echo ""

  if ! node "$CALL_DREAMER" "$DREAMER_MD" "$session_md" 2>"$TMPDIR_BACKFILL/stderr.txt" | tee "$OUTFILE"; then
    echo ""
    echo "  FAILED — $(head -1 "$TMPDIR_BACKFILL/stderr.txt")"
    continue
  fi
  echo ""

  echo ""
  output_size=$(wc -c < "$OUTFILE" | tr -d ' ')
  if [ "$output_size" -lt 10 ]; then
    echo "  FAILED — empty output (${output_size}b)"
    continue
  fi
  echo "  Claude returned ${output_size}b"

  # Parse USER.MD section from output file
  user_memory=$(awk '/^### USER\.MD/{found=1; next} /^### SESSION\.MD/{exit} found{print}' "$OUTFILE")

  # Parse SESSION.MD section (consolidated)
  # Stops at ### CD-MEMORY.MD if present, otherwise captures to end of file.
  # Strip markdown code fences the agent likes to wrap output in.
  consolidated_update=$(awk '/^### SESSION\.MD/{found=1; next} /^### CD-MEMORY\.MD/{exit} found{print}' "$OUTFILE" | sed '/^```\(markdown\)\{0,1\}$/d')

  # Parse CD-MEMORY.MD section (optional — agent appends system-level learnings)
  cd_memory=$(awk '/^### CD-MEMORY\.MD/{found=1; next} found{print}' "$OUTFILE")

  # --- user.md ---
  # Check first non-empty line — dreamer outputs "NO_CHANGE" followed by explanation
  user_first_line=$(echo "$user_memory" | sed '/^$/d' | head -1)
  if [ -z "$user_memory" ] || echo "$user_first_line" | grep -qi "^NO_CHANGE"; then
    echo "  user.md: NO_CHANGE"
  else
    mem_size=${#user_memory}
    echo ""
    echo "  ┌─── user.md (${mem_size} chars) ───"
    echo "$user_memory" | sed 's/^/  │ /'
    echo "  └───"
    printf '%s\n' "$user_memory" > "$user_md"
    echo "  Wrote user.md ($(wc -c < "$user_md" | tr -d ' ')b)"
  fi

  # --- session.md (consolidated) ---
  # Agent handles its own size logic (30KB rule in Step 3). Always write back.
  con_first_line=$(echo "$consolidated_update" | sed '/^$/d' | head -1)
  if [ -z "$consolidated_update" ] || echo "$con_first_line" | grep -qi "^NO_CHANGE"; then
    echo "  SESSION.md: NO_CHANGE"
  else
    con_size=${#consolidated_update}
    old_size=$(wc -c < "$session_md" | tr -d ' ')
    echo ""
    echo "  ┌─── SESSION.md consolidated (${con_size} chars, was ${old_size}b) ───"
    echo "$consolidated_update" | sed 's/^/  │ /'
    echo "  └───"
    # Backup original, write consolidated version
    cp "$session_md" "$dir/SESSION-bak.md"
    echo "  Backed up SESSION.md → SESSION-bak.md"
    printf '%s\n' "$consolidated_update" > "$session_md"
    echo "  Wrote SESSION.md ($(wc -c < "$session_md" | tr -d ' ')b)"
  fi

  # --- CD-MEMORY.md (append) ---
  cd_mem_first_line=$(echo "$cd_memory" | sed '/^$/d' | head -1)
  if [ -z "$cd_memory" ] || echo "$cd_mem_first_line" | grep -qi "^NO_CHANGE"; then
    echo "  CD-MEMORY.md: NO_CHANGE"
  else
    cd_mem_file="$SCRIPT_DIR/../agents/CD-MEMORY.md"
    echo "" >> "$cd_mem_file"
    printf '%s\n' "- [$session] $cd_memory" >> "$cd_mem_file"
    echo "  Appended to CD-MEMORY.md"
  fi

  echo ""
done

echo ""
echo "Done. Temp files kept in: $TMPDIR_BACKFILL"
