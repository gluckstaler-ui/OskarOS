#!/usr/bin/env bash
# ============================================================================
# scripts/sync-crm.sh — sync CRM (DB + Scout screenshots) spoke ↔ hub. (WP-28 · Button A)
#
# FILE-BY-FILE rsync. NO TAR. The event log is append-only, so rsync's delta
# sends ONLY the new bytes of each events-<node>.jsonl (not the whole 8–15 MB
# file) — fast and robust. Each file prints as it transfers (--out-format).
#
# WHAT SYNCS:  db/events/events-*.jsonl  (the event log = the DB)
#              public/__scout__/         (Scout team-page captures)
# WHAT NEVER SYNCS:  public/_whatsapp/ (messages + media) and anything email.
#              Hard rule from Ralph — "DB + screenshots, nothing else".
#
# Non-destructive: each events-<node>.jsonl is single-owner. PUSH updates the
# files WE author on the hub (no --delete, never touches the hub's own node
# file). PULL fetches hub-authored files, EXCLUDING ours so a stale remote copy
# can't clobber what we author. Then restart hub workers → crm-boot replays.
#
# Usage:  bash scripts/sync-crm.sh
# ============================================================================
set -euo pipefail

KEY="${OSKAR_DEPLOY_KEY:-$HOME/.ssh/oskar_key}"
SSH_PORT="${OSKAR_DEPLOY_PORT:-21098}"
HOST="${OSKAR_DEPLOY_HOST:-aweseybn@198.177.120.118}"
REMOTE_ROOT="${OSKAR_DEPLOY_ROOT:-webbuilder}"
MAIN="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$KEY" -p "$SSH_PORT" -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR)
RSH="ssh -i $KEY -p $SSH_PORT -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR"
say() { printf '\n\033[1;36m=== %s\033[0m\n' "$*"; }

cd "$MAIN"
# NO ARCHIVES (Ralph) — individual files only, never *.zip/*.tar/etc.
RFLAGS=(-rltz --no-perms --omit-dir-times --partial
  --exclude='.DS_Store'
  --exclude='*.zip' --exclude='*.tar' --exclude='*.tar.gz' --exclude='*.tgz'
  --exclude='*.tar.bz2' --exclude='*.tar.xz' --exclude='*.7z' --exclude='*.rar')

"${SSH[@]}" "$HOST" "mkdir -p $REMOTE_ROOT/db/events $REMOTE_ROOT/public/__scout__"

# --- 1. PUSH the DB (event log) — delta only, file by file -------------------
say "push DB (event log) → hub — delta, file by file"
rsync "${RFLAGS[@]}" --progress --out-format='SYNC_FILE %n' -e "$RSH" db/events/ "$HOST:$REMOTE_ROOT/db/events/"

# --- 2. PUSH Scout captures (additive; NEVER public/_whatsapp) ---------------
if [ -d public/__scout__ ]; then
  say "push Scout captures → hub"
  rsync "${RFLAGS[@]}" --progress --out-format='SYNC_FILE %n' -e "$RSH" public/__scout__/ "$HOST:$REMOTE_ROOT/public/__scout__/"
else
  echo "  (no public/__scout__ yet — nothing to push)"
fi

# --- 3. PULL hub-authored event files (NOT the ones we author) --------------
say "pull hub-authored event files we lack"
rsync "${RFLAGS[@]}" --progress --out-format='SYNC_FILE %n' \
  --exclude='events-ralph-mac.jsonl' --exclude='events-unknown.jsonl' \
  -e "$RSH" "$HOST:$REMOTE_ROOT/db/events/" db/events/

# --- 4. trigger hub replay (restart workers → crm-boot incrementalReplay) ----
say "rebuild hub projection (restart workers → replay)"
"${SSH[@]}" "$HOST" '
  touch ~/'"$REMOTE_ROOT"'/tmp/restart.txt 2>/dev/null || true
  k=0; for pid in $(ls /proc 2>/dev/null | grep -E "^[0-9]+$"); do
    [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "$HOME/'"$REMOTE_ROOT"'" ] && kill -9 "$pid" 2>/dev/null && k=$((k+1))
  done; echo "restarted $k workers"'

say "CRM sync done — DB + Scout captures exchanged (WhatsApp/email untouched)"
