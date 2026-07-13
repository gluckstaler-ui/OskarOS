#!/usr/bin/env bash
# ============================================================================
# scripts/pull-codebase.sh — DOWNLOAD the hub's deployed build to THIS spoke.
# (WP-28 · the DOWNLOAD half of "Codebase" — mirror of deploy-server.sh's ship.)
#
# deploy-server.sh PUSHES: build on the spoke → ship .next to the hub.
# This PULLS the other way: fetch the hub's live .next (+ public top-level +
# capture-worker + DEPLOY_VERSION) DOWN to this machine, so a spoke that never
# builds (e.g. the Windows box that predates sync) runs the hub's exact build.
#
# TRANSPORT: rsync --checksum (content, not mtime — a fresh build re-stamps every
# mtime), file-by-file, each printed as SYNC_FILE (the panel streams them). Same
# engine as the push.
#
# SAFE ON THE BUILDER / DEV MACHINE:  if a dev server owns :3000 we STAGE the
# pulled build into .next.incoming and STOP — swapping would yank .next out from
# under a running `next dev`. On a prod spoke (node server.js, no dev on :3000)
# we atomic-swap .next.incoming → .next (keeping .next.prev for rollback) and
# touch tmp/restart.txt so the server reboots against the new build.
#
# Usage:  bash scripts/pull-codebase.sh
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

# --- 0. what are we about to pull? (report the hub's stamped version) --------
say "read hub version (its .next/DEPLOY_VERSION)"
hubver="$("${SSH[@]}" "$HOST" "cat '$REMOTE_ROOT/.next/DEPLOY_VERSION' 2>/dev/null" || true)"
[ -n "$hubver" ] && echo "  hub → $hubver" || { echo "  hub has no .next/DEPLOY_VERSION — nothing deployed there yet. Aborting."; exit 1; }

# --- 1. pull the hub's .next → ./.next.incoming (staging; live .next untouched) ---
# Stage into a SEPARATE dir, never the live .next, so a running server keeps a
# complete build for the whole transfer. --delete so removed hub files don't
# linger; exclude cache/ (rebuilt locally, huge).
say "pull hub .next → ./.next.incoming (live build untouched during transfer)"
rm -rf .next.incoming && mkdir -p .next.incoming
rsync -rltz --checksum --no-perms --omit-dir-times --partial --exclude='cache/' --delete \
  --progress --out-format='SYNC_FILE %n' -e "$RSH" "$HOST:$REMOTE_ROOT/.next/" ./.next.incoming/
echo "pull-done"

# --- 2. dev-server guard: never swap under a running `next dev` --------------
# The download is meant for a spoke that RUNS the pulled build (prod server).
# On the builder/dev machine, :3000 is a live dev server whose compiler holds
# .next open — swapping would break it. Detect and stage-only.
dev_on_3000=false
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  dev_on_3000=true
fi

if [ "$dev_on_3000" = true ]; then
  say "dev server detected on :3000 — STAGED ONLY (not swapping)"
  echo "  Pulled the hub build into ./.next.incoming but did NOT replace ./.next,"
  echo "  because a server is live on :3000 (swapping would break it)."
  echo "  This is the builder/dev machine — you don't normally download here."
  echo "  To activate on a prod spoke: stop the dev server, then re-run this, OR"
  echo "  mv .next .next.prev && mv .next.incoming .next && touch tmp/restart.txt"
  say "codebase download staged — $hubver"
  exit 0
fi

# --- 3. prod spoke: also pull public top-level + capture-worker -------------
say "pull public/ top-level + capture-worker (prod spoke)"
mkdir -p public scripts
# top-level public files only (--dirs, no recursion into session dirs), additive
rsync -ltz --checksum --no-perms --omit-dir-times --partial --dirs --exclude='.DS_Store' \
  --progress --out-format='SYNC_FILE %n' -e "$RSH" "$HOST:$REMOTE_ROOT/public/" ./public/ || true
# capture-worker (lives in scripts/, not .next)
"${SSH[@]}" "$HOST" "cat '$REMOTE_ROOT/scripts/capture-worker.cjs' 2>/dev/null" > scripts/capture-worker.cjs.tmp 2>/dev/null || true
[ -s scripts/capture-worker.cjs.tmp ] && mv scripts/capture-worker.cjs.tmp scripts/capture-worker.cjs || rm -f scripts/capture-worker.cjs.tmp

# --- 4. atomic swap + restart (this machine runs the pulled build) ----------
say "atomic swap .next + restart"
rm -rf .next.prev
[ -d .next ] && mv .next .next.prev
mv .next.incoming .next || { echo "ATOMIC SWAP FAILED: .next.incoming missing"; exit 1; }
mkdir -p tmp && touch tmp/restart.txt
echo "  swapped in the hub build; touched tmp/restart.txt"

# --- 5. smoke check ---------------------------------------------------------
say "smoke check"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://localhost:3000/" 2>/dev/null) || code=000
echo "  http://localhost:3000/ → HTTP $code"
say "codebase download live — $hubver"
