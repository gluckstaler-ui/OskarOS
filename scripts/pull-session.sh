#!/usr/bin/env bash
# ============================================================================
# scripts/pull-session.sh <session-id> — DOWNLOAD one session folder hub → spoke.
# (WP-28 · the DOWNLOAD half of "Session" — mirror of sync-session.sh's push.)
#
# sync-session.sh PUSHES public/<id>/ spoke → hub. This pulls the same folder
# the other way: hub → this machine. Additive (NO --delete) — a download never
# destroys local files. File-by-file rsync, deltas only, each printed as
# SYNC_FILE. NO archives (skip *.zip/*.tar/… — same rule as the push).
#
# Usage:  bash scripts/pull-session.sh 2026-05-31-weingut-barbazza
# ============================================================================
set -euo pipefail

ID="${1:-}"
case "$ID" in
  '' )         echo "usage: pull-session.sh <session-id>"; exit 2 ;;
  */* | *..* ) echo "bad session id: $ID"; exit 2 ;;
esac

KEY="${OSKAR_DEPLOY_KEY:-$HOME/.ssh/oskar_key}"
SSH_PORT="${OSKAR_DEPLOY_PORT:-21098}"
HOST="${OSKAR_DEPLOY_HOST:-aweseybn@198.177.120.118}"
REMOTE_ROOT="${OSKAR_DEPLOY_ROOT:-webbuilder}"
MAIN="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$KEY" -p "$SSH_PORT" -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR)
RSH="ssh -i $KEY -p $SSH_PORT -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR"
say() { printf '\n\033[1;36m=== %s\033[0m\n' "$*"; }

cd "$MAIN"

# does the hub even have this session?
remote_n="$("${SSH[@]}" "$HOST" "find '$REMOTE_ROOT/public/$ID' -type f 2>/dev/null | wc -l" | tr -d ' ')"
[ "${remote_n:-0}" -gt 0 ] || { echo "hub has no session public/$ID (or it's empty). Nothing to pull."; exit 1; }

RFLAGS=(-rltz --no-perms --omit-dir-times --partial
  --exclude='.DS_Store'
  --exclude='*.zip' --exclude='*.tar' --exclude='*.tar.gz' --exclude='*.tgz'
  --exclude='*.tar.bz2' --exclude='*.tar.xz' --exclude='*.7z' --exclude='*.rar')
SRC="$HOST:$REMOTE_ROOT/public/$ID/"
DST="public/$ID/"
mkdir -p "$DST"

# how many files will actually move (dry run) → drives the progress bar
say "scan hub '$ID' for files we lack / that changed"
total="$(rsync "${RFLAGS[@]}" --dry-run --out-format='%n' -e "$RSH" "$SRC" "$DST" | wc -l | tr -d ' ')"
echo "SYNC_TOTAL $total"

say "pull session '$ID' ← hub — $total file(s), one by one (additive)"
rsync "${RFLAGS[@]}" --progress --out-format='SYNC_FILE %n' -e "$RSH" "$SRC" "$DST"

local_n="$(find "public/$ID" -type f ! -name '.DS_Store' | wc -l | tr -d ' ')"
say "session '$ID' downloaded — hub had $remote_n files, local now has $local_n"
