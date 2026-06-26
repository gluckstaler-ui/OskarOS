#!/usr/bin/env bash
# ============================================================================
# scripts/sync-session.sh <session-id> — push ONE session folder spoke → hub.
# (WP-28 · Button B)
#
# FILE-BY-FILE rsync. NO TAR — a single tar stream over SSH dies on big folders
# (Barbazza, 1 GB → "Unexpected EOF in archive" at 5 min). rsync is resumable,
# transfers each file independently, sends only deltas, and prints every file as
# it goes (--out-format) → you SEE what's transferring. Additive: NO --delete,
# a sync never destroys files on the far end.
#
# Usage:  bash scripts/sync-session.sh 2026-05-31-weingut-barbazza
# ============================================================================
set -euo pipefail

ID="${1:-}"
case "$ID" in
  '' )         echo "usage: sync-session.sh <session-id>"; exit 2 ;;
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
[ -d "public/$ID" ] || { echo "no such session: public/$ID"; exit 1; }

# NO ARCHIVES (Ralph). Sync INDIVIDUAL files only — skip *.zip/*.tar/etc so a
# 670 MB Archive.zip can't masquerade as "the sync"; each real file streams by
# name. Same exclude set lives in lib/sync/state.ts so the indicator agrees.
RFLAGS=(-rltz --no-perms --omit-dir-times --partial
  --exclude='.DS_Store'
  --exclude='*.zip' --exclude='*.tar' --exclude='*.tar.gz' --exclude='*.tgz'
  --exclude='*.tar.bz2' --exclude='*.tar.xz' --exclude='*.7z' --exclude='*.rar')
SRC="public/$ID/"
DST="$HOST:$REMOTE_ROOT/public/$ID/"

"${SSH[@]}" "$HOST" "mkdir -p $REMOTE_ROOT/public/$ID"

# how many files will actually move (dry run) → drives the progress bar
say "scan '$ID' ($(du -sh "public/$ID" | cut -f1)) for changes"
total="$(rsync "${RFLAGS[@]}" --dry-run --out-format='%n' -e "$RSH" "$SRC" "$DST" | wc -l | tr -d ' ')"
echo "SYNC_TOTAL $total"

say "sync session '$ID' → hub — $total file(s), one by one"
# --progress → per-file byte % (so one big file doesn't look frozen; works on
#   macOS's openrsync, unlike --info=progress2); --out-format → one SYNC_FILE
#   line per file (what's transferring).
rsync "${RFLAGS[@]}" --progress --out-format='SYNC_FILE %n' -e "$RSH" "$SRC" "$DST"

# verify it landed
remote_n="$("${SSH[@]}" "$HOST" "find $REMOTE_ROOT/public/$ID -type f 2>/dev/null | wc -l" | tr -d ' ')"
local_n="$(find "public/$ID" -type f ! -name '.DS_Store' | wc -l | tr -d ' ')"
say "session '$ID' synced — local $local_n files, hub now has $remote_n"
