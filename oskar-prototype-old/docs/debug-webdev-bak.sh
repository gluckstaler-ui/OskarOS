#!/bin/bash
# ==========================================
# WebDev Pipeline Debugger
# Run from: oskar-prototype/
# ==========================================
set -e
SESSION="2026-01-27-31"
SESSION_PATH="$(pwd)/public/${SESSION}"
AGENT_MD="$(pwd)/../webdev-agent.md"
echo "=========================================="
echo "WebDev Pipeline Debug"
echo "=========================================="
echo ""
# ---- Discover vibes from VIBE-*.md files ----
declare -a VIBE_INDICES=()
declare -A VIBE_NAMES=()
declare -A VIBE_SLUGS=()
for vibe_file in "$SESSION_PATH"/VIBE-*.md; do
  [ -f "$vibe_file" ] || continue
  idx=$(basename "$vibe_file" | sed 's/VIBE-\([0-9]*\)\.md/\1/')
  name=$(grep -m1 '^# VIBE' "$vibe_file" | sed 's/^# VIBE [0-9]*: *//; s/"//g')
  slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed "s/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//")
  VIBE_INDICES+=("$idx")
  VIBE_NAMES[$idx]="$name"
  VIBE_SLUGS[$idx]="$slug"
done
if [ ${#VIBE_INDICES[@]} -eq 0 ]; then
  echo "❌ No VIBE-*.md files found in $SESSION_PATH"
  exit 1
fi
# Terminal vibe picker
echo "Which vibe to build?"
echo ""
SORTED_INDICES=($(echo "${VIBE_INDICES[@]}" | tr ' ' '\n' | sort -n))
for idx in "${SORTED_INDICES[@]}"; do
  echo "  ${idx}) ${VIBE_NAMES[$idx]}"
done
echo ""
read -p "Pick [1-${SORTED_INDICES[-1]}]: " VIBE_INDEX

if [ -z "${VIBE_NAMES[$VIBE_INDEX]}" ]; then
  echo "❌ Invalid selection: $VIBE_INDEX"
  exit 1
fi
VIBE_NAME="${VIBE_NAMES[$VIBE_INDEX]}"
VIBE_SLUG="${VIBE_SLUGS[$VIBE_INDEX]}"
VIBE_FILE="VIBE-${VIBE_INDEX}.md"
FILENAME="vibe-${VIBE_INDEX}-${VIBE_SLUG}.html"
TARGET="${SESSION_PATH}/${FILENAME}"
echo ""
echo "Selected: Vibe ${VIBE_INDEX} — ${VIBE_NAME}"
echo "File: ${FILENAME}"
echo ""
# ---- Step 1: Check session folder ----
echo "--- STEP 1: Session folder ---"
if [ -d "$SESSION_PATH" ]; then
  echo "✅ Session path exists: $SESSION_PATH"
  echo "   Files: $(ls "$SESSION_PATH" | wc -l)"
else
  echo "❌ Session path MISSING: $SESSION_PATH"
  exit 1
fi
# ---- Step 2: Check required files ----
echo ""
echo "--- STEP 2: Required files ---"
if [ -f "$SESSION_PATH/$VIBE_FILE" ]; then
  SIZE=$(wc -c < "$SESSION_PATH/$VIBE_FILE")
  echo "✅ $VIBE_FILE exists (${SIZE} bytes)"
else
  echo "❌ $VIBE_FILE MISSING"
fi
for f in CREATIVE-BRIEF.md BUILD.md; do
  if [ -f "$SESSION_PATH/$f" ]; then
    SIZE=$(wc -c < "$SESSION_PATH/$f")
    echo "✅ $f exists (${SIZE} bytes)"
  else
    echo "❌ $f MISSING"
  fi
done
# ---- Step 3: Check webdev-agent.md ----
echo ""
echo "--- STEP 3: Agent prompt ---"
if [ -f "$AGENT_MD" ]; then
  SIZE=$(wc -c < "$AGENT_MD")
  echo "✅ webdev-agent.md exists (${SIZE} bytes)"
  BACKTICKS=$(grep -c '`' "$AGENT_MD" || true)
  DOLLARS=$(grep -c '\$' "$AGENT_MD" || true)
  echo "   Contains: ${BACKTICKS} lines with backticks, ${DOLLARS} lines with \$ signs"
  if grep -q "VIBE-N.md" "$AGENT_MD"; then
    echo "✅ Agent prompt references VIBE-N.md (updated)"
  else
    echo "⚠️  Agent prompt may still reference CREATIVE-BRIEF.md instead of VIBE-N.md"
  fi
else
  echo "❌ webdev-agent.md MISSING at: $AGENT_MD"
fi
# ---- Step 4: Find Claude binary ----
echo ""
echo "--- STEP 4: Claude binary ---"
CLAUDE_PATH=""
for p in /opt/homebrew/bin/claude /usr/local/bin/claude claude; do
  if command -v "$p" &>/dev/null || [ -x "$p" ]; then
    CLAUDE_PATH="$p"
    break
  fi
done
if [ -n "$CLAUDE_PATH" ]; then
  echo "✅ Claude binary: $CLAUDE_PATH"
  echo "   Version: $($CLAUDE_PATH --version 2>&1 || echo 'unknown')"
else
  echo "❌ Claude binary NOT FOUND"
  exit 1
fi
# ---- Step 5: Test --print with tool use ----
echo ""
echo "--- STEP 5: Test --print with tool use ---"
echo "   Asking Claude to write a test file via --print..."
TEST_FILE="${SESSION_PATH}/_debug-test.txt"
rm -f "$TEST_FILE"
"$CLAUDE_PATH" --print \
  --model claude-sonnet-4-6 \
  --permission-mode bypassPermissions \
  "Write the text 'debug-ok' to the file ${TEST_FILE}. Use your file writing tool. Then say 'Done.'" \
  2>/dev/null
sleep 2
if [ -f "$TEST_FILE" ]; then
  CONTENT=$(cat "$TEST_FILE")
  echo "✅ --print mode CAN use tools. File written with content: '$CONTENT'"
  rm -f "$TEST_FILE"
else
  echo "❌ --print mode did NOT write the file. Tools may not work in --print mode."
  echo ""
  echo "   Retrying WITHOUT --print (interactive mode, 30s timeout)..."
  rm -f "$TEST_FILE"
  timeout 30 "$CLAUDE_PATH" \
    --model claude-sonnet-4-6 \
    --permission-mode bypassPermissions \
    "Write the text 'debug-ok' to the file ${TEST_FILE}. Use your file writing tool. Then say 'Done.'" \
    2>/dev/null || true
  sleep 2
  if [ -f "$TEST_FILE" ]; then
    echo "✅ Interactive mode CAN use tools. File written."
    echo "   ⚠️  This means --print prevents tool use. Must NOT use --print for WebDev."
    rm -f "$TEST_FILE"
  else
    echo "❌ Neither mode wrote the file. Something else is wrong."
  fi
fi
# ---- Step 6: Test argument size ----
echo ""
echo "--- STEP 6: Argument size test ---"
if [ -f "$AGENT_MD" ]; then
  AGENT_CONTENT=$(cat "$AGENT_MD")
  PROMPT_SIZE=${#AGENT_CONTENT}
  echo "   Agent prompt: ${PROMPT_SIZE} chars"
else
  PROMPT_SIZE=0
  echo "   Agent prompt: MISSING"
fi
echo "   getconf ARG_MAX: $(getconf ARG_MAX)"
if [ "$PROMPT_SIZE" -gt 200000 ]; then
  echo "⚠️  Prompt is very large — may hit ARG_MAX limit"
else
  echo "✅ Prompt size is within ARG_MAX"
fi
# ---- Step 7: Live vibe build (5 min timeout) ----
echo ""
echo "--- STEP 7: Live vibe build (5 min timeout) ---"
echo "   Building: ${FILENAME}"
echo "   Target: ${TARGET}"
echo ""
rm -f "$TARGET"
timeout 300 "$CLAUDE_PATH" \
  --print \
  --model claude-sonnet-4-6 \
  --permission-mode bypassPermissions \
  "Read ${SESSION_PATH}/${VIBE_FILE} and build a complete HTML landing page for Vibe ${VIBE_INDEX}: ${VIBE_NAME}. Write it to ${TARGET}." \
  2>"${SESSION_PATH}/_debug-stderr.log" || true
echo ""
if [ -f "$TARGET" ]; then
  SIZE=$(wc -c < "$TARGET")
  echo "✅ VIBE ${VIBE_INDEX} BUILT! File: ${TARGET} (${SIZE} bytes)"
else
  echo "❌ Vibe ${VIBE_INDEX} NOT built."
  echo ""
  echo "   Last 20 lines of stderr:"
  tail -20 "${SESSION_PATH}/_debug-stderr.log" 2>/dev/null || echo "   (no stderr)"
fi
echo ""
echo "=========================================="
echo "Debug complete. Review output above."
echo "=========================================="
