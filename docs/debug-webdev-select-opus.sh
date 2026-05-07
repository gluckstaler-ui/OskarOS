#!/bin/bash
# ==========================================
# WebDev Pipeline Debugger (Vibe Selector)
# Run from: oskar-prototype/
# ==========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

SESSION="2026-01-27-31"
SESSION_PATH="${PROJECT_DIR}/public/${SESSION}"
AGENT_MD="${PROJECT_DIR}/../webdev-agent.md"

echo "=========================================="
echo "WebDev Pipeline Debug"
echo "=========================================="
echo ""

# ---- Discover vibes from VIBE-*.md files ----
# bash 3.2 compatible — no associative arrays
VIBE_COUNT=0
declare -a _VIBE_IDX=()
declare -a _VIBE_NAME=()
declare -a _VIBE_SLUG=()

for vibe_file in "$SESSION_PATH"/VIBE-*.md; do
  [ -f "$vibe_file" ] || continue

  idx=$(basename "$vibe_file" | sed -E 's/VIBE-([0-9]+)\.md/\1/')
  name=$(grep -m1 '^# VIBE' "$vibe_file" | sed 's/^# VIBE [0-9]*: *//; s/"//g')
  slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed -E "s/[^a-z0-9]+/-/g; s/^-|-$//g")

  _VIBE_IDX[$VIBE_COUNT]="$idx"
  _VIBE_NAME[$VIBE_COUNT]="$name"
  _VIBE_SLUG[$VIBE_COUNT]="$slug"
  VIBE_COUNT=$((VIBE_COUNT + 1))
done

# Helper: look up position by vibe index
get_vibe_pos() {
  local target="$1" i=0
  while [ $i -lt $VIBE_COUNT ]; do
    if [ "${_VIBE_IDX[$i]}" = "$target" ]; then
      echo "$i"; return 0
    fi
    i=$((i + 1))
  done
  return 1
}

if [ "$VIBE_COUNT" -eq 0 ]; then
  echo "No VIBE-*.md files found in $SESSION_PATH"
  echo "Falling back to manual entry."
  echo ""
  printf "Enter vibe number: "
  read -r VIBE_INDEX
  printf "Enter vibe name: "
  read -r VIBE_NAME
  VIBE_SLUG=$(echo "$VIBE_NAME" | tr '[:upper:]' '[:lower:]' | sed -E "s/[^a-z0-9]+/-/g; s/^-|-$//g")
else
  # ---- Vibe Selection (terminal menu) ----
  echo "Which vibe to build?"
  echo ""

  i=0
  while [ $i -lt $VIBE_COUNT ]; do
    echo "  ${_VIBE_IDX[$i]}) ${_VIBE_NAME[$i]}"
    i=$((i + 1))
  done

  echo ""
  printf "Enter vibe number: "
  read -r VIBE_INDEX

  POS=$(get_vibe_pos "$VIBE_INDEX") || {
    echo "Invalid selection: $VIBE_INDEX"
    exit 1
  }

  VIBE_NAME="${_VIBE_NAME[$POS]}"
  VIBE_SLUG="${_VIBE_SLUG[$POS]}"
fi

VIBE_FILE="VIBE-${VIBE_INDEX}.md"
FILENAME="vibe-${VIBE_INDEX}-${VIBE_SLUG}-opus.html"
TARGET="${SESSION_PATH}/${FILENAME}"

echo ""
echo "Selected: Vibe ${VIBE_INDEX} — ${VIBE_NAME} (OPUS)"
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
for f in "$VIBE_FILE" IMAGES.md BUILD.md; do
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
  --model claude-opus-4-7 \
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
    --model claude-opus-4-7 \
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
AGENT_CONTENT=$(cat "$AGENT_MD")
PROMPT_SIZE=${#AGENT_CONTENT}
echo "   Agent prompt: ${PROMPT_SIZE} chars"
echo "   getconf ARG_MAX: $(getconf ARG_MAX)"
if [ "$PROMPT_SIZE" -gt 200000 ]; then
  echo "⚠️  Prompt is very large — may hit ARG_MAX limit"
else
  echo "✅ Prompt size is within ARG_MAX"
fi

# ---- Step 7: Test actual vibe build (5 min timeout) ----
echo ""
echo "--- STEP 7: Live vibe build test (5 min timeout) ---"
echo "   Building: ${FILENAME}"
echo "   Target: ${TARGET}"
echo ""

rm -f "$TARGET"

(timeout 600 "$CLAUDE_PATH" \
  --verbose \
  --output-format stream-json \
  --model claude-opus-4-7 \
  --permission-mode bypassPermissions \
  --print \
  "You are WEBDEV. Build Vibe ${VIBE_INDEX}: ${VIBE_NAME}.

RULES:
- Write the HTML yourself.
- Do NOT read other vibe HTML files for reference.
- Read ONLY the file below, then immediately start writing.

Read this file:
- ${SESSION_PATH}/${VIBE_FILE}

Then write the complete HTML landing page to: ${TARGET}

Say 'File written: ${FILENAME}' when done." \
  2>"${SESSION_PATH}/_debug-stderr.log" | tee "${SESSION_PATH}/_debug-stdout.log") || true

echo ""
if [ -f "$TARGET" ]; then
  SIZE=$(wc -c < "$TARGET")
  echo "✅ VIBE ${VIBE_INDEX} BUILT! File: ${TARGET} (${SIZE} bytes)"
else
  echo "❌ Vibe ${VIBE_INDEX} NOT built."
  echo ""
  echo "   Last 20 lines of stdout:"
  tail -20 "${SESSION_PATH}/_debug-stdout.log" 2>/dev/null || echo "   (no stdout)"
  echo ""
  echo "   Last 20 lines of stderr:"
  tail -20 "${SESSION_PATH}/_debug-stderr.log" 2>/dev/null || echo "   (no stderr)"
fi

echo ""
echo "=========================================="
echo "Debug complete. Review output above."
echo "=========================================="
