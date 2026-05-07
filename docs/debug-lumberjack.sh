#!/bin/bash
# ==========================================
# Lumberjack Debug — single-call padawan
# Run from: oskar-prototype/
#
# Usage:
#   ./docs/debug-lumberjack.sh                     # uses default session
#   SESSION=2026-01-27-31 ./docs/debug-lumberjack.sh
#   TIMEOUT_SECS=1200 ./docs/debug-lumberjack.sh   # override 15-min default
#
# Invokes `claude --print` with `agents/lumberjack-padawan.md` as the system
# prompt and the full current SESSION.md inlined at the end. One CLI call,
# one agent. Events are pretty-printed to stdout as they arrive and the raw
# stream-json is tee'd to a log under public/$SESSION/logs/ for later review.
#
# 2026-04-21: rewritten to match the single-call design in lib/memory/lumberjack.ts
# (same payload shape). The previous --stages / --stage / --single modes are
# gone; the 7-stage multi-CLI approach was scrapped.
# ==========================================

set -e

# ---- Config (override via env) ----
SESSION="${SESSION:-2026-01-27-31}"
TIMEOUT_SECS="${TIMEOUT_SECS:-900}"   # 15 min — matches lib/memory/lumberjack.ts

SESSION_PATH="$(pwd)/public/${SESSION}"
SESSION_MD="${SESSION_PATH}/SESSION.md"
PADAWAN_MD="$(pwd)/agents/lumberjack-padawan.md"
LOG_DIR="${SESSION_PATH}/logs"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

echo "=========================================="
echo "Lumberjack Debug (single-call padawan)"
echo "Session:       ${SESSION}"
echo "SESSION.md:    ${SESSION_MD}"
echo "Agent file:    ${PADAWAN_MD}"
echo "Timeout:       ${TIMEOUT_SECS}s"
echo "Log dir:       ${LOG_DIR}"
echo "=========================================="
echo ""

# ---- STEP 1: Pre-flight ----
echo "--- STEP 1: Pre-flight ---"
[ -d "$SESSION_PATH" ] || { echo "❌ Session missing: $SESSION_PATH"; exit 1; }
[ -f "$SESSION_MD" ]   || { echo "❌ SESSION.md missing: $SESSION_MD"; exit 1; }
[ -f "$PADAWAN_MD" ]   || { echo "❌ lumberjack-padawan.md missing: $PADAWAN_MD"; exit 1; }

SESSION_SIZE=$(wc -c < "$SESSION_MD")
SESSION_LINES=$(wc -l < "$SESSION_MD")
PADAWAN_SIZE=$(wc -c < "$PADAWAN_MD")
SESSION_TOKENS=$((SESSION_SIZE / 4))
echo "✅ SESSION.md:              ${SESSION_SIZE} bytes / ${SESSION_LINES} lines (~${SESSION_TOKENS} tokens)"
echo "✅ lumberjack-padawan.md:   ${PADAWAN_SIZE} bytes"
echo ""

# ---- STEP 2: Claude binary ----
echo "--- STEP 2: Claude binary ---"
CLAUDE_PATH=""
for p in /opt/homebrew/bin/claude /usr/local/bin/claude claude; do
  if command -v "$p" &>/dev/null || [ -x "$p" ]; then
    CLAUDE_PATH="$p"; break
  fi
done
[ -n "$CLAUDE_PATH" ] || { echo "❌ Claude binary not found"; exit 1; }
echo "✅ ${CLAUDE_PATH}"
echo "   Version: $(${CLAUDE_PATH} --version 2>&1)"
echo ""

# ---- STEP 3: Build the prompt ----
# Mirrors lib/memory/lumberjack.ts's prompt assembly exactly:
#   padawan.md + "## CURRENT SESSION.md CONTENT" header + fenced markdown block
# So the shell-script run reproduces what /api/order65 and /api/order66 send.
PROMPT_FILE="/tmp/lj-debug-${TS}.txt"

{
  cat "$PADAWAN_MD"
  echo ""
  echo "## CURRENT SESSION.md CONTENT"
  echo ""
  echo "File: ${SESSION_MD}"
  echo "Size: ${SESSION_SIZE} bytes"
  echo ""
  echo "The complete live content is below. Do NOT call the Read tool —"
  echo "the content here IS the current state. Use ONLY the Edit tool to"
  echo "write changes back to the file path above."
  echo ""
  echo '```markdown'
  cat "$SESSION_MD"
  echo '```'
} > "$PROMPT_FILE"

echo "--- STEP 3: Prompt built ---"
echo "✅ ${PROMPT_FILE} ($(wc -c < "$PROMPT_FILE") bytes)"
echo ""

# ---- STEP 4: Run the CLI ----
OUT_LOG="${LOG_DIR}/_debug-lumberjack-${TS}.log"
STDERR_LOG="${OUT_LOG}.stderr"

echo "--- STEP 4: Running agent ---"
echo "Raw stream → ${OUT_LOG}"
echo "Stderr     → ${STDERR_LOG}"
echo "Expect 8–12 min on a large SESSION.md. Events appear live below."
echo ""

START=$(date +%s)

# Pretty-printer for stream-json events. Each CLI line is one JSON event;
# we translate to a human-readable line. Raw JSON is tee'd to OUT_LOG for
# post-run inspection. `stdbuf -oL` on tee forces line-buffering so each
# event appears immediately even when stdout is redirected to a file.
(
  # Matches the exact shape that completed P1 in 5:22 on 2026-04-21. The
  # prior version added `< /dev/null` and `stdbuf -oL` defensively — both
  # turned out to destabilize the pipeline on this machine. Back to the
  # proven-working invocation.
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
    2>"${STDERR_LOG}" | tee "$OUT_LOG" | while IFS= read -r line; do
      # Elapsed seconds prefix so you can see pacing
      ELAPSED=$(( $(date +%s) - START ))
      TS_PREFIX=$(printf "[%4ds]" "$ELAPSED")

      case "$line" in
        *'"type":"system"'*'"subtype":"init"'*)
          printf '%s [init] CLI started, model ready\n' "$TS_PREFIX" ;;
        # Note: rate_limit_event and api_retry handlers REMOVED 2026-04-21.
        # The CLI emits rate_limit_event on every turn as informational status
        # (status:"allowed" most of the time) — printing them made it look
        # like the script was being rate-limited when it wasn't. If a real
        # API failure happens, it arrives as a result event with is_error:true
        # — that handler is below.
        *'"type":"assistant"'*'"thinking"'*)
          printf '%s [thinking]\n' "$TS_PREFIX" ;;
        *'"name":"Read"'*'"input"'*)
          fp=$(printf '%s' "$line" | sed -n 's/.*"file_path":"\([^"]*\)".*/\1/p')
          off=$(printf '%s' "$line" | sed -n 's/.*"offset":\([0-9]*\).*/\1/p')
          lim=$(printf '%s' "$line" | sed -n 's/.*"limit":\([0-9]*\).*/\1/p')
          printf '%s [Read] %s %s%s\n' "$TS_PREFIX" "${fp##*/}" "${off:+offset=$off }" "${lim:+limit=$lim}" ;;
        *'"name":"Edit"'*'"input"'*)
          fp=$(printf '%s' "$line" | sed -n 's/.*"file_path":"\([^"]*\)".*/\1/p')
          # First 80 chars of old_string (escape newlines for single-line display)
          old=$(printf '%s' "$line" | python3 -c '
import sys, json
try:
    obj = json.loads(sys.stdin.read())
    for c in obj.get("message", {}).get("content", []):
        if c.get("type") == "tool_use" and c.get("name") == "Edit":
            old = c.get("input", {}).get("old_string", "")
            print(old.replace("\n", "\\n")[:80])
            break
except Exception:
    pass
' 2>/dev/null)
          printf '%s [Edit] %s  old=%q\n' "$TS_PREFIX" "${fp##*/}" "$old" ;;
        *'"is_error":true'*)
          err=$(printf '%s' "$line" | sed -n 's/.*"content":"\([^"]*\)".*/\1/p')
          printf '%s [tool_result ERROR] %.200s\n' "$TS_PREFIX" "$err" ;;
        *'"type":"tool_result"'*)
          printf '%s [tool_result OK]\n' "$TS_PREFIX" ;;
        *'"type":"result"'*'"is_error":true'*)
          printf '\n'
          printf '%s [RESULT ERROR]\n' "$TS_PREFIX"
          python3 -c '
import json, sys
obj = json.loads(sys.argv[1])
print(f"  duration: {obj.get(\"duration_ms\",\"?\")}ms  turns: {obj.get(\"num_turns\",\"?\")}  cost: ${obj.get(\"total_cost_usd\",\"?\")}")
print("  result:")
print(obj.get("result", "(empty)"))
' "$line" ;;
        *'"type":"result"'*)
          printf '\n'
          printf '%s [RESULT]\n' "$TS_PREFIX"
          python3 -c '
import json, sys
obj = json.loads(sys.argv[1])
print(f"  duration: {obj.get(\"duration_ms\",\"?\")}ms  turns: {obj.get(\"num_turns\",\"?\")}  cost: ${obj.get(\"total_cost_usd\",\"?\")}")
print("  result:")
print(obj.get("result", "(empty)"))
' "$line" ;;
      esac
    done
) || true

END=$(date +%s)
ELAPSED=$((END - START))

# ---- STEP 5: Outcome ----
echo ""
echo "=========================================="
POST_SIZE=$(wc -c < "$SESSION_MD")
COMPRESS_PCT=$(( 100 - (POST_SIZE * 100 / SESSION_SIZE) ))
echo "DONE in ${ELAPSED}s"
echo "  SESSION.md: ${SESSION_SIZE} → ${POST_SIZE} bytes  (${COMPRESS_PCT}% compressed)"
echo ""
echo "Logs:"
echo "  full stream:    ${OUT_LOG}"
echo "  stderr:         ${STDERR_LOG}"
echo "  agent receipt:  ${LOG_DIR}/.last-lumberjack-log.md  (written by Next.js runs only)"
echo "=========================================="

# Clean up the temp prompt file
rm -f "$PROMPT_FILE"
