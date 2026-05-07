#!/bin/bash
# ==========================================
# WebDev Pipeline Debugger (Vibe Selector) — GEMINI CLI
# Run from: oskar-prototype/
# ==========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

SESSION="2026-01-27-31"
SESSION_PATH="${PROJECT_DIR}/public/${SESSION}"
AGENT_MD="${PROJECT_DIR}/../webdev-agent.md"
GEMINI_MODEL="gemini-3.1-pro-preview"

# Load GOOGLE_API_KEY from .env.local
if [ -f "${PROJECT_DIR}/.env.local" ]; then
  export GEMINI_API_KEY=$(grep '^GOOGLE_API_KEY=' "${PROJECT_DIR}/.env.local" | cut -d= -f2-)
fi

if [ -z "$GEMINI_API_KEY" ]; then
  echo "ERROR: No GOOGLE_API_KEY found in .env.local"
  exit 1
fi

echo "=========================================="
echo "WebDev Pipeline Debug — GEMINI CLI"
echo "Model: ${GEMINI_MODEL}"
echo "=========================================="
echo ""

# ---- Discover vibes from VIBE-*.md files ----
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
FILENAME="vibe-${VIBE_INDEX}-${VIBE_SLUG}-gemini.html"
TARGET="${SESSION_PATH}/${FILENAME}"

echo ""
echo "Selected: Vibe ${VIBE_INDEX} — ${VIBE_NAME} (GEMINI)"
echo "File: ${FILENAME}"
echo ""

# ---- Step 1: Check session folder ----
echo "--- STEP 1: Session folder ---"
if [ -d "$SESSION_PATH" ]; then
  echo "OK Session path exists: $SESSION_PATH"
  echo "   Files: $(ls "$SESSION_PATH" | wc -l)"
else
  echo "FAIL Session path MISSING: $SESSION_PATH"
  exit 1
fi

# ---- Step 2: Check required files ----
echo ""
echo "--- STEP 2: Required files ---"
for f in "$VIBE_FILE" IMAGES.md BUILD.md; do
  if [ -f "$SESSION_PATH/$f" ]; then
    SIZE=$(wc -c < "$SESSION_PATH/$f")
    echo "OK $f exists (${SIZE} bytes)"
  else
    echo "FAIL $f MISSING"
  fi
done

# ---- Step 3: Check webdev-agent.md ----
echo ""
echo "--- STEP 3: Agent prompt ---"
if [ -f "$AGENT_MD" ]; then
  SIZE=$(wc -c < "$AGENT_MD")
  echo "OK webdev-agent.md exists (${SIZE} bytes)"
else
  echo "FAIL webdev-agent.md MISSING at: $AGENT_MD"
fi

# ---- Step 4: Find Gemini binary ----
echo ""
echo "--- STEP 4: Gemini binary ---"
GEMINI_PATH=""
for p in /opt/homebrew/bin/gemini /usr/local/bin/gemini gemini; do
  if command -v "$p" &>/dev/null || [ -x "$p" ]; then
    GEMINI_PATH="$p"
    break
  fi
done

if [ -n "$GEMINI_PATH" ]; then
  echo "OK Gemini binary: $GEMINI_PATH"
  echo "   Version: $($GEMINI_PATH --version 2>&1 || echo 'unknown')"
else
  echo "FAIL Gemini binary NOT FOUND"
  exit 1
fi

# ---- Step 5: Quick API test ----
echo ""
echo "--- STEP 5: Quick API test ---"
echo "   Testing Gemini CLI responds..."

timeout 15 "$GEMINI_PATH" -m "$GEMINI_MODEL" -p "Reply with exactly: GEMINI OK" < /dev/null 2>/dev/null > /tmp/gemini-step5.txt || true

if grep -q "GEMINI OK" /tmp/gemini-step5.txt 2>/dev/null; then
  echo "OK Gemini CLI responds (model: ${GEMINI_MODEL})"
else
  echo "FAIL Gemini did not respond. Output:"
  cat /tmp/gemini-step5.txt 2>/dev/null || echo "   (empty)"
fi
rm -f /tmp/gemini-step5.txt

# ---- Step 6: Test argument size ----
echo ""
echo "--- STEP 6: Argument size test ---"
AGENT_CONTENT=$(cat "$AGENT_MD")
PROMPT_SIZE=${#AGENT_CONTENT}
echo "   Agent prompt: ${PROMPT_SIZE} chars"
echo "   getconf ARG_MAX: $(getconf ARG_MAX)"
if [ "$PROMPT_SIZE" -gt 200000 ]; then
  echo "WARNING Prompt is very large — may hit ARG_MAX limit"
else
  echo "OK Prompt size is within ARG_MAX"
fi

# ---- Step 7: Live vibe build (10 min timeout) ----
echo ""
echo "--- STEP 7: Live vibe build test (10 min timeout) ---"
echo "   Building: ${FILENAME}"
echo "   Target: ${TARGET}"
echo "   Model: ${GEMINI_MODEL}"
echo ""

rm -f "$TARGET"

(timeout 600 "$GEMINI_PATH" \
  -m "$GEMINI_MODEL" \
  --yolo \
  -o stream-json \
  -p "You are WEBDEV. Build Vibe ${VIBE_INDEX}: ${VIBE_NAME}.

RULES:
- Write the HTML yourself.
- Do NOT read other vibe HTML files for reference.
- Read ONLY the file below, then immediately start writing.
- Use shell commands (cat) to read files — do NOT use read_file on public/ paths.

Read this file using cat:
  cat ${SESSION_PATH}/${VIBE_FILE}

Then write the complete HTML landing page to: ${TARGET}

Say 'File written: ${FILENAME}' when done." \
  < /dev/null \
  2> >(tee "${SESSION_PATH}/_debug-gemini-stderr.log" >&2) | tee "${SESSION_PATH}/_debug-gemini-stdout.log") || true

echo ""
if [ -f "$TARGET" ]; then
  SIZE=$(wc -c < "$TARGET")
  echo "OK VIBE ${VIBE_INDEX} BUILT! File: ${TARGET} (${SIZE} bytes)"
else
  echo "FAIL Vibe ${VIBE_INDEX} NOT built."
  echo ""
  echo "   Last 20 lines of stdout:"
  tail -20 "${SESSION_PATH}/_debug-gemini-stdout.log" 2>/dev/null || echo "   (no stdout)"
  echo ""
  echo "   Last 20 lines of stderr:"
  tail -20 "${SESSION_PATH}/_debug-gemini-stderr.log" 2>/dev/null || echo "   (no stderr)"
fi

echo ""
echo "=========================================="
echo "Debug complete. Review output above."
echo "=========================================="
