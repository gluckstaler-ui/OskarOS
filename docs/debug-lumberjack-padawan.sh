#!/bin/bash
# ==========================================
# Lumberjack-Padawan Debugger
# Run from: oskar-prototype/
#
# Single CLI invocation with agents/lumberjack-padawan.md loaded as the full
# system prompt. No stage loop, no orchestrator — just one agent, the padawan
# identity, and the session file.
#
# Usage:
#   ./docs/debug-lumberjack-padawan.sh
#   SESSION=2026-01-27-30 ./docs/debug-lumberjack-padawan.sh
#   TIMEOUT_SECS=1200 ./docs/debug-lumberjack-padawan.sh   # 20-min budget
# ==========================================

set -e

SESSION="${SESSION:-2026-01-27-31}"
TIMEOUT_SECS="${TIMEOUT_SECS:-600}"

SESSION_PATH="$(pwd)/public/${SESSION}"
SESSION_MD="${SESSION_PATH}/SESSION.md"
PADAWAN_MD="$(pwd)/agents/lumberjack-padawan.md"
LOG_DIR="${SESSION_PATH}/logs"
TS="$(date +%Y%m%d-%H%M%S)"
PROMPT_FILE="/tmp/lj-padawan-debug-${TS}.txt"
OUT_LOG="${LOG_DIR}/_debug-padawan-${TS}.log"

mkdir -p "$LOG_DIR"

echo "=========================================="
echo "Lumberjack-Padawan Debug"
echo "=========================================="
echo "Session:   ${SESSION}"
echo "Padawan:   ${PADAWAN_MD}"
echo "Target:    ${SESSION_MD}"
echo "Timeout:   ${TIMEOUT_SECS}s"
echo "Log:       ${OUT_LOG}"
echo "=========================================="
echo ""

# ---- Pre-flight ----
[ -f "$PADAWAN_MD" ] || { echo "❌ Missing: $PADAWAN_MD"; exit 1; }
[ -f "$SESSION_MD" ] || { echo "❌ Missing: $SESSION_MD"; exit 1; }

PADAWAN_SIZE=$(wc -c < "$PADAWAN_MD")
SESSION_SIZE=$(wc -c < "$SESSION_MD")
SESSION_LINES=$(wc -l < "$SESSION_MD")
SESSION_TOKENS=$((SESSION_SIZE / 4))

echo "✅ lumberjack-padawan.md: ${PADAWAN_SIZE} bytes"
echo "✅ SESSION.md: ${SESSION_SIZE} bytes / ${SESSION_LINES} lines / ≈${SESSION_TOKENS} tokens"
[ "$SESSION_TOKENS" -gt 25000 ] && echo "   ⚠️  > 25K tokens — Read tool will page through it"
echo ""

# ---- Find Claude binary ----
CLAUDE_PATH=""
for p in /opt/homebrew/bin/claude /usr/local/bin/claude claude; do
  if command -v "$p" &>/dev/null || [ -x "$p" ]; then
    CLAUDE_PATH="$p"; break
  fi
done
[ -n "$CLAUDE_PATH" ] || { echo "❌ Claude binary not found"; exit 1; }
echo "✅ Claude: $CLAUDE_PATH ($($CLAUDE_PATH --version 2>&1))"
echo ""

# ---- Build the prompt ----
# The padawan file is the full agent identity. We then inline the complete
# SESSION.md content as a fenced code block so the model has the live state in
# context from turn 1 — skips the Read tool's 25K-token output ceiling that
# otherwise forces a multi-round paging cycle on files >~90KB.
# Mirrors the 2026-04-20 fix in lib/memory/lumberjack.ts.
{
  cat "$PADAWAN_MD"
  echo ""
  echo ""
  echo "## CURRENT SESSION.md CONTENT"
  echo ""
  echo "File: ${SESSION_MD}"
  echo "Size: $(wc -c < "$SESSION_MD") bytes"
  echo ""
  echo "The complete live content is below. Do NOT call the Read tool —"
  echo "the content here IS the current state. Use ONLY the Edit tool to"
  echo "write changes back to the file path above, then report what you did."
  echo ""
  echo '```markdown'
  cat "$SESSION_MD"
  echo '```'
} > "$PROMPT_FILE"

PROMPT_SIZE=$(wc -c < "$PROMPT_FILE")
echo "✅ Built prompt: $PROMPT_FILE (${PROMPT_SIZE} bytes)"
echo ""
echo ">>> Launching. Expect 1-3 minutes of work."
echo ">>> Full JSON stream → ${OUT_LOG}"
echo ">>> Stderr → ${OUT_LOG}.stderr"
echo ""

START_TS=$(date +%s)

# ---- Single invocation, streaming ----
# Events are pretty-printed to STDOUT as they arrive. Raw JSON goes to the log.
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
    2>"${OUT_LOG}.stderr" | tee "$OUT_LOG" | while IFS= read -r line; do
  case "$line" in
    *'"type":"system"'*'"subtype":"init"'*)
      echo "[init] CLI ready" ;;
    *'"name":"Read"'*'"input"'*)
      fp=$(echo "$line" | sed -n 's/.*"file_path":"\([^"]*\)".*/\1/p')
      off=$(echo "$line" | sed -n 's/.*"offset":\([0-9]*\).*/\1/p')
      lim=$(echo "$line" | sed -n 's/.*"limit":\([0-9]*\).*/\1/p')
      echo "[tool_use Read] $(basename "$fp") ${off:+offset=$off }${lim:+limit=$lim}" ;;
    *'"name":"Edit"'*'"input"'*)
      fp=$(echo "$line" | sed -n 's/.*"file_path":"\([^"]*\)".*/\1/p')
      echo "[tool_use Edit] $(basename "$fp")" ;;
    *'"is_error":true'*)
      err=$(echo "$line" | sed -n 's/.*"content":"\([^"]*\)".*/\1/p')
      echo "[tool_result ERROR] ${err:0:180}" ;;
    *'"type":"tool_result"'*)
      echo "[tool_result OK]" ;;
    *'"thinking"'*)
      echo "[thinking]" ;;
    *'"type":"result"'*'"subtype":"success"'*)
      # Use python3 to decode the JSON properly — sed breaks on escaped quotes
      # inside the "result" string and truncates the report.
      echo ""
      python3 -c '
import json, sys
obj = json.loads(sys.argv[1])
dur = obj.get("duration_ms", "?")
turns = obj.get("num_turns", "?")
cost = obj.get("total_cost_usd", "?")
print(f"[RESULT] duration={dur}ms turns={turns} cost=${cost}")
print("[RESULT TEXT]")
print(obj.get("result", "(empty)"))
' "$line" ;;
  esac
done || true

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

echo ""
echo "=========================================="
echo "Done in ${ELAPSED}s."
echo "Full stream:  $OUT_LOG"
echo "Stderr:       ${OUT_LOG}.stderr"
echo "Prompt sent:  $PROMPT_FILE"
echo "=========================================="
