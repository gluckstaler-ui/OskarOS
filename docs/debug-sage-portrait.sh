#!/bin/bash
# ==========================================
# Sage-Portrait Debugger
# Run from: oskar-prototype/
#
# Reproduces what lib/memory/dreamer.ts::runSagePortrait does:
#   - Loads agents/sage-portrait.md as the system prompt
#   - Adds a runtime-context block (session paths, mode)
#   - Enables Read + Edit tools
#   - Does NOT inline SESSION.md or user.md — the model Reads them itself
#   - Streams every event so you can see exactly what the agent does
#
# Usage:
#   ./docs/debug-sage-portrait.sh
#   SESSION=2026-01-27-31 ./docs/debug-sage-portrait.sh
#   TIMEOUT_SECS=1200 ./docs/debug-sage-portrait.sh   # 20-min budget
# ==========================================

set -e

SESSION="${SESSION:-2026-01-27-31}"
TIMEOUT_SECS="${TIMEOUT_SECS:-900}"   # 15 min — matches runSagePortrait's SAGE_TIMEOUT_MS

SESSION_PATH="$(pwd)/public/${SESSION}"
SESSION_MD="${SESSION_PATH}/SESSION.md"
USER_MD="${SESSION_PATH}/user.md"
AGENT_MD="$(pwd)/agents/sage-portrait.md"
LOG_DIR="${SESSION_PATH}/logs"
TS="$(date +%Y%m%d-%H%M%S)"
PROMPT_FILE="/tmp/sage-portrait-debug-${TS}.txt"
OUT_LOG="${LOG_DIR}/_debug-sage-portrait-${TS}.log"

mkdir -p "$LOG_DIR"

echo "=========================================="
echo "Sage-Portrait Debug"
echo "Session:   ${SESSION}"
echo "Agent:     ${AGENT_MD}"
echo "SESSION:   ${SESSION_MD}"
echo "user.md:   ${USER_MD}"
echo "Timeout:   ${TIMEOUT_SECS}s"
echo "Log:       ${OUT_LOG}"
echo "=========================================="
echo ""

# ---- Pre-flight ----
[ -f "$AGENT_MD" ]   || { echo "❌ Missing: $AGENT_MD"; exit 1; }
[ -f "$SESSION_MD" ] || { echo "❌ Missing: $SESSION_MD"; exit 1; }

SESSION_SIZE=$(wc -c < "$SESSION_MD")
SESSION_LINES=$(wc -l < "$SESSION_MD")
AGENT_SIZE=$(wc -c < "$AGENT_MD")
echo "✅ sage-portrait.md: ${AGENT_SIZE} bytes"
echo "✅ SESSION.md: ${SESSION_SIZE} bytes / ${SESSION_LINES} lines"

# Ensure user.md exists (the agent has Edit only, not Write — if user.md is
# missing the agent will fail). Write the template here like runSagePortrait does.
if [ ! -s "$USER_MD" ]; then
  cat > "$USER_MD" <<EOF
# User Memory
_Last updated: ${TS} by Padawan Sage_

## Taste Profile
(no signals yet)

## Quality Bar
(no signals yet)

## Communication Patterns
(no signals yet)

## Working Context
(no signals yet)
EOF
  echo "✅ user.md created with initial template ($(wc -c < "$USER_MD") bytes)"
  MODE="FIRST PASS (portrait has the initial template only — paint the full person)"
else
  USER_SIZE=$(wc -c < "$USER_MD")
  echo "✅ user.md exists: ${USER_SIZE} bytes"
  MODE="SUBSEQUENT PASS (portrait exists, refine conservatively)"
fi
echo ""

# ---- Find Claude ----
CLAUDE_PATH=""
for p in /opt/homebrew/bin/claude /usr/local/bin/claude claude; do
  if command -v "$p" &>/dev/null || [ -x "$p" ]; then
    CLAUDE_PATH="$p"; break
  fi
done
[ -n "$CLAUDE_PATH" ] || { echo "❌ Claude binary not found"; exit 1; }
echo "✅ Claude: $CLAUDE_PATH ($($CLAUDE_PATH --version 2>&1))"
echo ""

# ---- Build prompt = agent file + runtime context (NO inlining) ----
{
  cat "$AGENT_MD"
  echo ""
  echo "---"
  echo ""
  echo "## RUNTIME CONTEXT"
  echo ""
  echo "**Session path:** ${SESSION_PATH}"
  echo "**SESSION.md:** ${SESSION_MD}"
  echo "**user.md:** ${USER_MD}"
  echo "**Mode:** ${MODE}"
  echo ""
  echo "Use the Read tool to read SESSION.md and user.md. Use the Edit tool to update user.md in place. Do NOT emit the new user.md as text output — your response should contain ONLY the TRIAGE_LOG section."
} > "$PROMPT_FILE"

PROMPT_SIZE=$(wc -c < "$PROMPT_FILE")
echo "✅ Prompt built: $PROMPT_FILE (${PROMPT_SIZE} bytes — agent file + context, NOT inlined)"
echo ""
echo ">>> Launching. Expect 1-5 minutes of work."
echo ">>> Stream → ${OUT_LOG}"
echo ""

START=$(date +%s)

# ---- Run ----
timeout "$TIMEOUT_SECS" "$CLAUDE_PATH" \
  --print \
  --verbose \
  --output-format stream-json \
  --model claude-sonnet-4-6 \
  --tools "Read,Edit" \
  --system-prompt-file "$PROMPT_FILE" \
  --dangerously-skip-permissions \
  --no-session-persistence \
  "Execute the task described in your system prompt." \
  2>"${OUT_LOG}.stderr" | stdbuf -oL tee "$OUT_LOG" | while IFS= read -r line; do
    ELAPSED=$(( $(date +%s) - START ))
    PREFIX=$(printf "[%4ds]" "$ELAPSED")
    case "$line" in
      *'"type":"system"'*'"subtype":"init"'*)
        printf '%s [init] CLI ready\n' "$PREFIX" ;;
      *'"thinking"'*)
        printf '%s [thinking]\n' "$PREFIX" ;;
      *'"name":"Read"'*'"input"'*)
        fp=$(printf '%s' "$line" | sed -n 's/.*"file_path":"\([^"]*\)".*/\1/p')
        off=$(printf '%s' "$line" | sed -n 's/.*"offset":\([0-9]*\).*/\1/p')
        lim=$(printf '%s' "$line" | sed -n 's/.*"limit":\([0-9]*\).*/\1/p')
        printf '%s [Read] %s %s%s\n' "$PREFIX" "${fp##*/}" "${off:+offset=$off }" "${lim:+limit=$lim}" ;;
      *'"name":"Edit"'*'"input"'*)
        fp=$(printf '%s' "$line" | sed -n 's/.*"file_path":"\([^"]*\)".*/\1/p')
        printf '%s [Edit] %s\n' "$PREFIX" "${fp##*/}" ;;
      *'"is_error":true'*)
        err=$(printf '%s' "$line" | sed -n 's/.*"content":"\([^"]*\)".*/\1/p')
        printf '%s [tool_result ERROR] %.180s\n' "$PREFIX" "$err" ;;
      *'"type":"tool_result"'*)
        printf '%s [tool_result OK]\n' "$PREFIX" ;;
      *'"type":"result"'*)
        printf '\n%s [RESULT]\n' "$PREFIX"
        python3 -c '
import json, sys
obj = json.loads(sys.argv[1])
print(f"  duration: {obj.get(\"duration_ms\",\"?\")}ms  turns: {obj.get(\"num_turns\",\"?\")}  cost: ${obj.get(\"total_cost_usd\",\"?\")}")
print("  result:")
print(obj.get("result", "(empty)"))
' "$line" ;;
    esac
  done || true

END=$(date +%s)
ELAPSED=$((END - START))

echo ""
echo "=========================================="
echo "Done in ${ELAPSED}s."
echo "Stream log:  $OUT_LOG"
echo "Stderr:      ${OUT_LOG}.stderr"
echo "Prompt:      $PROMPT_FILE"
echo "user.md diff check:"
echo "  Size now: $(wc -c < "$USER_MD") bytes"
echo "=========================================="
