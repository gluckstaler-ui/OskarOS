#!/bin/bash
# ==========================================
# Sage-240/40 Debugger — v4 (2026-04-21)
# Run from: oskar-prototype/
#
# Shows everything the agent does during a run so long silent windows
# aren't opaque:
#   - [thinking] with the actual reasoning text
#   - [Read] / [Edit] with file paths and old/new previews
#   - [tool_result] with content preview
#   - [api_retry] when the CLI retries a failed backend call
#   - Heartbeat every 15s during silence
#   - Post-mortem totals on exit (completion OR timeout)
#
# Usage:
#   ./docs/debug-sage-240-40.sh
#   SESSION=2026-01-27-31 ./docs/debug-sage-240-40.sh
#   FORCE=1 ./docs/debug-sage-240-40.sh        # agent runs even under 240KB
#   TIMEOUT_SECS=1200 ./docs/debug-sage-240-40.sh
#   THINKING_PREVIEW=2000 ./docs/debug-sage-240-40.sh
# ==========================================

set -e

SESSION="${SESSION:-2026-01-27-31}"
TIMEOUT_SECS="${TIMEOUT_SECS:-900}"
FORCE="${FORCE:-0}"
THINKING_PREVIEW="${THINKING_PREVIEW:-800}"
TRIGGER_BYTES=$((240 * 1024))

SESSION_PATH="$(pwd)/public/${SESSION}"
SESSION_MD="${SESSION_PATH}/SESSION.md"
AGENT_MD="$(pwd)/agents/sage-240-40.md"
LOG_DIR="${SESSION_PATH}/logs"
TS="$(date +%Y%m%d-%H%M%S)"
PROMPT_FILE="/tmp/sage-240-40-debug-${TS}.txt"
WATCHER_FILE="/tmp/sage-240-40-watcher-${TS}.py"
OUT_LOG="${LOG_DIR}/_debug-sage-240-40-${TS}.log"
SNAPSHOT_PATH="${SESSION_MD}.pre-prune-${TS}"

mkdir -p "$LOG_DIR"

echo "=========================================="
echo "Sage-240/40 Debug v3"
echo "Session:       ${SESSION}"
echo "Agent:         ${AGENT_MD}"
echo "SESSION.md:    ${SESSION_MD}"
echo "Trigger:       ${TRIGGER_BYTES} bytes (240KB)"
echo "Force:         ${FORCE}"
echo "Timeout:       ${TIMEOUT_SECS}s"
echo "Thinking prev: ${THINKING_PREVIEW} chars"
echo "Stream log:    ${OUT_LOG}"
echo "=========================================="
echo ""

# ---- Pre-flight ----
[ -f "$AGENT_MD" ]   || { echo "❌ Missing: $AGENT_MD"; exit 1; }
[ -f "$SESSION_MD" ] || { echo "❌ Missing: $SESSION_MD"; exit 1; }

SESSION_SIZE=$(wc -c < "$SESSION_MD")
SESSION_LINES=$(wc -l < "$SESSION_MD")
AGENT_SIZE=$(wc -c < "$AGENT_MD")
echo "✅ sage-240-40.md: ${AGENT_SIZE} bytes"
echo "✅ SESSION.md: ${SESSION_SIZE} bytes / ${SESSION_LINES} lines"
echo ""

# ---- Trigger check (fast-path skip) ----
if [ "$SESSION_SIZE" -lt "$TRIGGER_BYTES" ] && [ "$FORCE" != "1" ]; then
  echo ">>> SESSION.md under 240KB trigger. Fast-path SKIP (no agent call)."
  echo ">>> Set FORCE=1 to invoke the agent anyway."
  echo ""
  echo "Triage log: [240/40-SKIP] under trigger — file at ${SESSION_SIZE} bytes"
  exit 0
fi

# ---- Claude binary ----
CLAUDE_PATH=""
for p in /opt/homebrew/bin/claude /usr/local/bin/claude claude; do
  if command -v "$p" &>/dev/null || [ -x "$p" ]; then
    CLAUDE_PATH="$p"; break
  fi
done
[ -n "$CLAUDE_PATH" ] || { echo "❌ Claude binary not found"; exit 1; }
echo "✅ Claude: $CLAUDE_PATH ($($CLAUDE_PATH --version 2>&1))"
echo ""

# ---- Snapshot before any cut ----
cp "$SESSION_MD" "$SNAPSHOT_PATH"
echo "✅ Snapshot: $SNAPSHOT_PATH ($(wc -c < "$SNAPSHOT_PATH") bytes)"
echo ""

# ---- Build prompt ----
{
  cat "$AGENT_MD"
  echo ""
  echo "---"
  echo ""
  echo "## RUNTIME CONTEXT"
  echo ""
  echo "**Session path:** ${SESSION_PATH}"
  echo "**SESSION.md:** ${SESSION_MD}"
  echo "**Current size:** ${SESSION_SIZE} bytes ($((SESSION_SIZE / 1024))KB) — over the 240KB trigger"
  echo "**Snapshot (already written by runner):** ${SNAPSHOT_PATH}"
  echo ""
  echo "**Step 0 (mandatory, before any reasoning):** Call the Read tool on SESSION.md with offset=0 limit=500 to load the first chunk. Do NOT reason about the file's structure or LEDGER contents before you have read them. Reasoning about contents you haven't read is hallucination. Page through with Read until the file is fully mapped, THEN decide which two blocks to fold."
  echo ""
  echo "Use the Edit tool to apply your cuts in place. Do NOT emit the rewritten file as text output — your response should contain ONLY the TRIAGE_LOG section."
} > "$PROMPT_FILE"

PROMPT_SIZE=$(wc -c < "$PROMPT_FILE")
echo "✅ Prompt: $PROMPT_FILE (${PROMPT_SIZE} bytes)"
echo ""

# ---- Write the Python watcher to a separate file ----
# Using a separate file (not inline heredoc) avoids every quote-escaping trap.
cat > "$WATCHER_FILE" <<'WATCHER_EOF'
"""
Claude CLI stream-json watcher for the Sage-240/40 debug script.

Reads one JSON event per line from stdin and pretty-prints every event.
Maintains a heartbeat on a background thread so long silent windows surface.
On stdin EOF (normal completion OR SIGTERM from `timeout`), prints a
post-mortem with counts.
"""
import json
import os
import sys
import time
import threading

START = float(os.environ.get("START_TS", time.time()))
THINKING_PREVIEW = int(os.environ.get("THINKING_PREVIEW", 800))

counters = {
    "reads": 0,
    "edits": 0,
    "tool_ok": 0,
    "tool_errors": 0,
    "thinking_chars": 0,
    "text_chars": 0,
    "api_retries": 0,
}

last_event_ts = time.time()
last_action = "(no event yet)"
lock = threading.Lock()

# Optional raw-log file path (argv[1]). Every event line we receive is
# appended verbatim so post-run forensic inspection has the untouched stream.
raw_log_path = sys.argv[1] if len(sys.argv) > 1 else None
raw_log_fh = open(raw_log_path, "w", buffering=1) if raw_log_path else None

# Tracks in-progress streaming content blocks keyed by (message_id, index)
# — for --include-partial-messages mode, where thinking/text arrives as
# content_block_delta events before the full message is emitted.
partial_blocks = {}


def elapsed_s():
    return int(time.time() - START)


def ts_prefix():
    return "[{:>4}s]".format(elapsed_s())


def trunc(s, n):
    s = s or ""
    if len(s) <= n:
        return s
    return s[:n] + "\n  ... [truncated, total {} chars]".format(len(s))


def emit(label, *lines):
    """Thread-safe print with bookkeeping."""
    global last_event_ts, last_action
    with lock:
        last_event_ts = time.time()
        last_action = label
        print("{} {}".format(ts_prefix(), label), flush=True)
        for line in lines:
            if line is None or line == "":
                continue
            for sub in str(line).split("\n"):
                print("  {}".format(sub), flush=True)


def heartbeat_loop():
    """Every 15s, if no event has fired, tell the user we're alive."""
    while True:
        time.sleep(15)
        with lock:
            since = int(time.time() - last_event_ts)
        if since >= 15:
            print(
                "{} [heartbeat] alive, {}s since last event. Last action: {}".format(
                    ts_prefix(), since, last_action
                ),
                flush=True,
            )


threading.Thread(target=heartbeat_loop, daemon=True).start()


def handle_assistant(ev):
    msg = ev.get("message") or {}
    for block in msg.get("content", []):
        btype = block.get("type")
        if btype == "thinking":
            text = block.get("thinking") or ""
            counters["thinking_chars"] += len(text)
            emit(
                "[thinking] +{} chars (total {})".format(len(text), counters["thinking_chars"]),
                trunc(text, THINKING_PREVIEW),
            )
        elif btype == "text":
            text = block.get("text") or ""
            counters["text_chars"] += len(text)
            emit("[text] +{} chars".format(len(text)), trunc(text, 600))
        elif btype == "tool_use":
            name = block.get("name")
            inp = block.get("input") or {}
            if name == "Read":
                counters["reads"] += 1
                fp = inp.get("file_path", "?")
                off = inp.get("offset")
                lim = inp.get("limit")
                emit(
                    "[Read #{}] {}".format(counters["reads"], fp),
                    "offset={} limit={}".format(off, lim),
                )
            elif name == "Edit":
                counters["edits"] += 1
                fp = inp.get("file_path", "?")
                ra = inp.get("replace_all", False)
                old = inp.get("old_string", "") or ""
                new = inp.get("new_string", "") or ""
                emit(
                    "[Edit #{}] {} replace_all={}".format(counters["edits"], fp, ra),
                    "old ({} chars): {}".format(len(old), trunc(old, 300)),
                    "new ({} chars): {}".format(len(new), trunc(new, 300)),
                )
            else:
                emit(
                    "[tool_use {}]".format(name),
                    trunc(json.dumps(inp), 300),
                )
        else:
            emit("[assistant/{}]".format(btype), trunc(json.dumps(block), 200))


def handle_user(ev):
    """Tool results arrive as user messages in Claude Code stream-json."""
    msg = ev.get("message") or {}
    for block in msg.get("content", []):
        if block.get("type") != "tool_result":
            continue
        is_err = bool(block.get("is_error"))
        content = block.get("content", "")
        if isinstance(content, list):
            parts = []
            for x in content:
                if isinstance(x, dict):
                    parts.append(x.get("text", ""))
                else:
                    parts.append(str(x))
            content = "\n".join(parts)
        if is_err:
            counters["tool_errors"] += 1
            emit(
                "[tool_result ERROR #{}]".format(counters["tool_errors"]),
                trunc(content, 400),
            )
        else:
            counters["tool_ok"] += 1
            emit(
                "[tool_result OK #{}] {} chars".format(counters["tool_ok"], len(content)),
                trunc(content, 300),
            )


def handle_result(ev):
    is_err = bool(ev.get("is_error"))
    dur = ev.get("duration_ms", "?")
    turns = ev.get("num_turns", "?")
    cost = ev.get("total_cost_usd", "?")
    result = ev.get("result") or ""
    label = "[RESULT ERROR]" if is_err else "[RESULT]"
    emit(
        "{} duration={}ms turns={} cost=${}".format(label, dur, turns, cost),
        "--- result text ({} chars) ---".format(len(result)),
        result,
    )


def handle_system(ev):
    sub = ev.get("subtype", "?")
    if sub == "init":
        emit(
            "[init] CLI started",
            "model={} cwd={} permission={}".format(
                ev.get("model"), ev.get("cwd"), ev.get("permissionMode")
            ),
            "session_id={}".format(ev.get("session_id")),
        )
    elif sub == "api_retry":
        counters["api_retries"] += 1
        emit(
            "[api_retry #{}]".format(counters["api_retries"]),
            "attempt={}/{}  backoff={}ms  error={}  error_status={}".format(
                ev.get("attempt"),
                ev.get("max_retries"),
                int(ev.get("retry_delay_ms") or 0),
                repr(ev.get("error")),
                ev.get("error_status"),
            ),
        )
    elif sub == "status":
        # Benign per-turn status beat — one-liner, no JSON dump.
        emit("[status] {}".format(ev.get("status", "?")))
    else:
        emit("[system/{}]".format(sub), trunc(json.dumps(ev), 300))


def handle_partial_message(ev):
    """Handle --include-partial-messages events that stream as deltas
    BEFORE the full assistant message is emitted. This is where live
    thinking-in-progress shows up.

    Event shapes we care about:
      content_block_start  — a new block (thinking / text / tool_use) begins
      content_block_delta  — incremental content (thinking_delta / text_delta /
                             input_json_delta)
      content_block_stop   — block finishes
      message_start / message_stop — the whole assistant turn begins / ends
    """
    inner = ev.get("event") or {}
    etype = inner.get("type") or ev.get("type_partial") or "?"
    msg_id = (ev.get("parent_message_id") or inner.get("message", {}).get("id") or "msg")
    idx = inner.get("index", 0)
    key = (msg_id, idx)

    if etype == "message_start":
        emit("[message_start]")
    elif etype == "content_block_start":
        block = inner.get("content_block") or {}
        btype = block.get("type")
        partial_blocks[key] = {"type": btype, "buf": "", "name": block.get("name")}
        if btype == "thinking":
            emit("[thinking start]")
        elif btype == "text":
            emit("[text start]")
        elif btype == "tool_use":
            emit("[tool_use start] name={}".format(block.get("name")))
        else:
            emit("[block start/{}]".format(btype))
    elif etype == "content_block_delta":
        delta = inner.get("delta") or {}
        dtype = delta.get("type")
        blk = partial_blocks.get(key)
        if dtype == "thinking_delta":
            piece = delta.get("thinking", "") or ""
            if blk is not None:
                blk["buf"] += piece
            counters["thinking_chars"] += len(piece)
            # Stream each delta as it arrives — NO truncation here; user
            # wants to see the model's reasoning live.
            emit("[thinking Δ+{}]".format(len(piece)), piece)
        elif dtype == "text_delta":
            piece = delta.get("text", "") or ""
            if blk is not None:
                blk["buf"] += piece
            counters["text_chars"] += len(piece)
            emit("[text Δ+{}]".format(len(piece)), piece)
        elif dtype == "input_json_delta":
            piece = delta.get("partial_json", "") or ""
            if blk is not None:
                blk["buf"] += piece
            # Don't print raw partial JSON — too noisy. Just show we got one.
            # The full tool_use will be emitted on content_block_stop.
        elif dtype == "signature_delta":
            # Anthropic crypto signature chunks for thinking blocks.
            # Zero human value — silence them.
            pass
        else:
            emit("[delta/{}]".format(dtype), trunc(json.dumps(delta), 200))
    elif etype == "content_block_stop":
        blk = partial_blocks.pop(key, None)
        if blk and blk.get("type") == "thinking":
            emit("[thinking end] total {} chars".format(len(blk["buf"])))
        elif blk and blk.get("type") == "text":
            emit("[text end] total {} chars".format(len(blk["buf"])))
        elif blk and blk.get("type") == "tool_use":
            # input_json_delta assembled — try to parse
            try:
                inp = json.loads(blk["buf"]) if blk["buf"] else {}
            except Exception:
                inp = {"<partial>": blk["buf"]}
            name = blk.get("name") or "?"
            if name == "Read":
                counters["reads"] += 1
                emit(
                    "[Read #{}] {}".format(counters["reads"], inp.get("file_path", "?")),
                    "offset={} limit={}".format(inp.get("offset"), inp.get("limit")),
                )
            elif name == "Edit":
                counters["edits"] += 1
                old = inp.get("old_string", "") or ""
                new = inp.get("new_string", "") or ""
                emit(
                    "[Edit #{}] {} replace_all={}".format(
                        counters["edits"], inp.get("file_path", "?"), inp.get("replace_all", False)
                    ),
                    "old ({} chars): {}".format(len(old), trunc(old, 300)),
                    "new ({} chars): {}".format(len(new), trunc(new, 300)),
                )
            else:
                emit("[tool_use {} end]".format(name), trunc(json.dumps(inp), 300))
    elif etype == "message_stop":
        emit("[message_stop]")
    else:
        emit("[stream/{}]".format(etype), trunc(json.dumps(inner), 200))


for raw in sys.stdin:
    raw = raw.rstrip("\n")
    if not raw.strip():
        continue
    # Tee raw line to log file if one was given.
    if raw_log_fh is not None:
        raw_log_fh.write(raw + "\n")
        raw_log_fh.flush()
    try:
        ev = json.loads(raw)
    except json.JSONDecodeError:
        emit("[bad-json]", trunc(raw, 200))
        continue

    etype = ev.get("type")

    if etype == "system":
        handle_system(ev)
    elif etype == "assistant":
        handle_assistant(ev)
    elif etype == "user":
        handle_user(ev)
    elif etype == "result":
        handle_result(ev)
    elif etype == "rate_limit_event":
        # Ignored by design.
        pass
    elif etype == "stream_event":
        # --include-partial-messages wraps each Anthropic SSE event in a
        # stream_event envelope. Unwrap and handle the inner event.
        handle_partial_message(ev)
    else:
        emit("[{}]".format(etype), trunc(raw, 200))


# ---- Post-mortem (stdin EOF: completion OR SIGTERM from `timeout`) ----
print("", flush=True)
print("{} ========== POST-MORTEM ==========".format(ts_prefix()), flush=True)
print("  Thinking total:      {} chars".format(counters["thinking_chars"]), flush=True)
print("  Text total:          {} chars".format(counters["text_chars"]), flush=True)
print("  Read calls:          {}".format(counters["reads"]), flush=True)
print("  Edit calls:          {}".format(counters["edits"]), flush=True)
print("  Tool results OK:     {}".format(counters["tool_ok"]), flush=True)
print("  Tool results ERROR:  {}".format(counters["tool_errors"]), flush=True)
print("  API retries:         {}".format(counters["api_retries"]), flush=True)
print("  Last action:         {}".format(last_action), flush=True)
WATCHER_EOF

echo ">>> Launching agent. Events stream live below."
echo ""

START=$(date +%s)

# ---- Run agent, pipe stream-json DIRECTLY through watcher ----
# No `tee`: on macOS, tee block-buffers when its stdout is a pipe, which
# kills live streaming. The Python watcher writes the raw line to the log
# itself (passed as argv[1]) so you still get the untouched stream on disk.
#
# --include-partial-messages: makes the CLI emit content_block_delta events
# as the model generates (thinking/text/tool-args). Without this, stream-json
# emits ONE event per complete message turn — so a 5-min thinking pass is
# silent until it finishes. With it, you see thinking arrive incrementally.
timeout "$TIMEOUT_SECS" "$CLAUDE_PATH" \
  --print \
  --verbose \
  --output-format stream-json \
  --include-partial-messages \
  --model claude-sonnet-4-6 \
  --effort low \
  --system-prompt-file "$PROMPT_FILE" \
  --dangerously-skip-permissions \
  --no-session-persistence \
  "Execute the task described in your system prompt." \
  2>"${OUT_LOG}.stderr" \
  | START_TS="$START" THINKING_PREVIEW="$THINKING_PREVIEW" python3 -u "$WATCHER_FILE" "$OUT_LOG" \
  || true

END=$(date +%s)
ELAPSED=$((END - START))
AFTER_SIZE=$(wc -c < "$SESSION_MD")
CUT=$((SESSION_SIZE - AFTER_SIZE))

# Delete the pre-prune snapshot only if the agent ran to completion.
# Signal: the CLI emits a `{"type":"result", ...}` event when it finishes
# normally. If that event is missing (timeout, crash, kill), keep the
# snapshot for rollback.
if grep -q '"type":"result"' "$OUT_LOG" 2>/dev/null; then
  rm -f "$SNAPSHOT_PATH"
  echo "Snapshot:    ${SNAPSHOT_PATH}  (deleted — successful completion)"
else
  echo "Snapshot:    ${SNAPSHOT_PATH}  (KEPT — no result event; process killed or errored)"
fi

echo ""
echo "=========================================="
echo "Wall clock:  ${ELAPSED}s"
echo "SESSION.md:  ${SESSION_SIZE} → ${AFTER_SIZE} bytes (cut ${CUT})"
echo "Raw stream:  ${OUT_LOG}"
echo "Stderr:      ${OUT_LOG}.stderr"
echo "Prompt:      ${PROMPT_FILE}"
echo "Watcher:     ${WATCHER_FILE}"
echo "=========================================="
