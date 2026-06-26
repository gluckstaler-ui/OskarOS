#!/usr/bin/env bash
# ============================================================================
# scripts/deploy-server.sh — reliable codebase deploy to awesome-ux.ch.
# (WP-28 "Sync Codebase" / the fix for WP-BUG-BUILD-SKEW.)
#
# WHY THIS EXISTS — two brittleness bugs this session, both fixed here:
#
#  1. THE TRANSPORT IS rsync, INCREMENTAL — only content-changed files move.
#     History: an early attempt blamed rsync for "dropping new files", switched
#     to tar, then tar's single stream DIED on big payloads (and re-shipped the
#     WHOLE .next every deploy). The real culprit was never rsync — it was macOS
#     bsdtar's *pax* format mangling turbopack's `[root-of-the-server]__hash._.js`
#     bracket names. rsync copies by EXACT name and lands new files fine (proven
#     on this box; the cPanel/Imunify scanner does NOT eat rsync'd files).
#     We use `--checksum` (compare by content hash, NOT mtime — a fresh build has
#     all-new mtimes, which would otherwise re-send everything) so ONLY genuinely
#     changed files transfer. NOTE: macOS ships `openrsync`; it supports
#     -rltz/--checksum/--partial/--out-format but NOT `--info=progress2` (use
#     `--progress`).
#
#  2. BUILDING IN THE LIVE DEV DIR clobbers the running `next dev`'s `.next`
#     AND re-hammers Google Fonts (rate-limit). FIX: build in an ISOLATED copy,
#     never the working dir.
#
# Plus a route-PARITY gate: every source route must be present in the artifact
# before we ship — fail loudly on drift (the old `/api/claude-code` 404 skew).
#
# Usage:  bash scripts/deploy-server.sh
# ============================================================================
set -euo pipefail

# --- config -----------------------------------------------------------------
KEY="${OSKAR_DEPLOY_KEY:-$HOME/.ssh/oskar_key}"
SSH_PORT="${OSKAR_DEPLOY_PORT:-21098}"
HOST="${OSKAR_DEPLOY_HOST:-aweseybn@198.177.120.118}"
REMOTE_ROOT="${OSKAR_DEPLOY_ROOT:-webbuilder}"        # ~/webbuilder on the box
PUBLIC_URL="${OSKAR_DEPLOY_URL:-https://awesome-ux.ch}"
MAIN="$(cd "$(dirname "$0")/.." && pwd)"             # the live working copy
SSH=(ssh -i "$KEY" -p "$SSH_PORT" -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR)

say() { printf '\n\033[1;36m=== %s\033[0m\n' "$*"; }

# --- 1. isolated build copy (NEVER build in the live dir) --------------------
# Copy the WORKING TREE (incl. uncommitted changes — so we deploy exactly what's
# on disk, not just HEAD) into a temp dir, minus the heavy/generated dirs. Link
# node_modules in so the build resolves. The live `.next` is never touched →
# your running `next dev` keeps its build + font cache.
WT="$(mktemp -d "${TMPDIR:-/tmp}/oskar-deploy.XXXXXX")"
cleanup() { rm -rf "$WT"; }
trap cleanup EXIT

# --- version: every deploy is "a number up" (Ralph) -------------------------
# A deploy IS a codebase commit to the server, so it bumps package.json's patch.
# Done BEFORE staging so the copy + the DEPLOY_VERSION stamp both carry the new
# number. package.json is the source of truth; the bump lands on disk (uncommitted)
# so the spoke's panel reflects it immediately and the next deploy continues from it.
say "bump version (every deploy → patch +1)"
node -e '
  const fs = require("fs"), p = process.argv[1] + "/package.json";
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const v = String(j.version || "0.0.0").split(".").map((n) => parseInt(n, 10) || 0);
  v[2] = (v[2] || 0) + 1;
  j.version = v.join(".");
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  console.log("  package.json → v" + j.version);
' "$MAIN"

say "stage working tree → $WT"
# Respect .gitignore (skips node_modules/.next/Winery/Fonts/media/… without a
# brittle blocklist) + drop the few non-source things the build doesn't need.
rsync -a --filter=':- .gitignore' \
  --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='public' --exclude='db' \
  --exclude='118bbuilder' --exclude='CRMxterritoryxfathom' \
  "$MAIN/" "$WT/"
# node_modules: turbopack REJECTS a symlink that points out of the build root, so
# clone it (APFS copy-on-write → fast, and real files). Fall back to a full copy.
say "clone node_modules into the copy"
cp -Rc "$MAIN/node_modules" "$WT/node_modules" 2>/dev/null || cp -R "$MAIN/node_modules" "$WT/node_modules"

say "npm run build (in the copy — your dev server's .next + font cache are untouched)"
# Force NODE_ENV=production. When this script is spawned by the admin SYNC panel,
# the parent is `next dev` (NODE_ENV=development) and the child inherits that env.
# `next build` then runs production static-gen code against dev-mode React, which
# makes `useContext` return null on /_global-error and aborts the build. `unset`
# first so the `env` assignment isn't shadowed by an inherited value.
( cd "$WT" && unset NODE_ENV && NODE_ENV=production npm run build )

# stamp the deployed version → lands at ~/webbuilder/.next/DEPLOY_VERSION on the
# hub so the SYNC-panel "Codebase" indicator can report it (WP-28). The spoke
# never has this file (only the deploy writes it, into the copy) → spoke uses
# live git, hub uses the stamp; the indicator diffs the two.
ver="$(git -C "$MAIN" rev-parse --short HEAD 2>/dev/null || echo unknown)"
dirty=false; [ -n "$(git -C "$MAIN" status --porcelain 2>/dev/null)" ] && dirty=true
# human release (semver) — package.json is the source of truth; it isn't shipped
# to the hub, so stamp it here so the hub can report v1.0.0 not just the commit.
release="$(node -p "require('$MAIN/package.json').version" 2>/dev/null || echo 0.0.0)"
printf '{"release":"%s","version":"%s","dirty":%s,"builtAt":"%s"}\n' "$release" "$ver" "$dirty" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$WT/.next/DEPLOY_VERSION"
echo "  stamped DEPLOY_VERSION: v$release ($ver, dirty=$dirty)"

# --- 2. route-parity gate (source routes must all be in the artifact) -------
say "route-parity gate"
missing=0
while IFS= read -r src; do
  rel="${src#"$WT"/app/}"; rel="${rel%/route.ts}"
  built="$WT/.next/server/app/${rel}/route.js"
  if [ ! -f "$built" ]; then echo "  MISSING in artifact: app/${rel}/route.ts"; missing=$((missing+1)); fi
done < <(find "$WT/app" -name route.ts)
if [ "$missing" -gt 0 ]; then echo "PARITY FAIL: $missing source route(s) not in the build — aborting."; exit 1; fi
echo "  ok — every source route is in the build"

# --- 3. ship .next via rsync — INCREMENTAL (only content-changed files) ------
# --checksum, not mtime: a fresh build re-stamps every mtime, so without it
# rsync would re-send the whole .next. With it, ONLY files whose CONTENT changed
# since the last deploy go over the wire — and the panel's SYNC_FILE stream then
# shows exactly what changed, nothing more.
RSH="ssh -i $KEY -p $SSH_PORT -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR"
# Stage into a hardlink-CLONE of the live build, NEVER the live .next itself.
# `cp -al` clones it instantly (same fs, shared inodes, ~no extra disk); rsync
# then writes only changed content into the clone via temp+rename, so changed
# files land on FRESH inodes and the live .next is never mutated. The running
# worker keeps a complete, consistent build for the whole transfer — no more
# mid-flight "Cannot find module" from chunks added/deleted under it.
say "ship .next → staging clone (live build untouched during transfer)"
"${SSH[@]}" "$HOST" "cd $REMOTE_ROOT && rm -rf .next.incoming && { cp -al .next .next.incoming 2>/dev/null || mkdir -p .next.incoming; }"
rsync -rltz --checksum --no-perms --omit-dir-times --partial --exclude='cache/' \
  --delete \
  --progress --out-format='SYNC_FILE %n' \
  -e "$RSH" "$WT/.next/" "$HOST:$REMOTE_ROOT/.next.incoming/"
echo extract-done

# ship the Scout-capture worker (esbuild bundle, built by prebuild in $WT). It
# lives in scripts/, NOT .next, so the rsync above doesn't carry it. The Next
# server spawns it (lib/capture-spawn) to run puppeteer out of the bundler's reach.
if [ -f "$WT/scripts/capture-worker.cjs" ]; then
  "${SSH[@]}" "$HOST" "mkdir -p $REMOTE_ROOT/scripts" 2>/dev/null || true
  < "$WT/scripts/capture-worker.cjs" "${SSH[@]}" "$HOST" "cat > ~/$REMOTE_ROOT/scripts/capture-worker.cjs"
  echo "shipped scripts/capture-worker.cjs"
fi

# ship the top-level public/ static assets (admin-topbar.js, crm.html, admin.html,
# _shell.{js,css}, overlays, source maps, etc.). Until 2026-06-25 the deploy only
# rsync'd .next/ and one specific flight-deck.jsx — every other top-level public
# file drifted on the server until manually patched. -d/--dirs copies the dir
# entries themselves WITHOUT recursing, which is exactly what we want: top-level
# files transfer, session/test/upload subdirs (2026-*, generated*, uploads/,
# vibes/, __studio-save-e2e__/, _diag_/, _probe/, test-session-*, etc.) are
# untouched. Server-side session data is therefore safe from this rsync.
say "ship public/ top-level files (no recursion into session dirs)"
"${SSH[@]}" "$HOST" "mkdir -p $REMOTE_ROOT/public"
rsync -ltz --checksum --no-perms --omit-dir-times --partial \
  --dirs --exclude='.DS_Store' \
  --progress --out-format='SYNC_FILE %n' \
  -e "$RSH" "$MAIN/public/" "$HOST:$REMOTE_ROOT/public/"

# also carry the runtime session asset that lives in the docroot (server-side cp, scanner-safe)
if [ -f "$MAIN/public/__crm__/flight-deck.jsx" ]; then
  "${SSH[@]}" "$HOST" "mkdir -p ~/$REMOTE_ROOT/public/__crm__" 2>/dev/null || true
  < "$MAIN/public/__crm__/flight-deck.jsx" "${SSH[@]}" "$HOST" "cat > ~/$REMOTE_ROOT/public/__crm__/flight-deck.jsx"
fi

# --- 4. ATOMIC swap, THEN restart (never edit the live .next in place) -------
# Swap the staged clone in with two renames, then restart. A running worker holds
# open fds to the old inodes (they survive the rename), so it never sees a partial
# build; the NEW worker boots instrumentation (crm-boot, wa-runtime) against a
# COMPLETE .next — the exact thing that failed when we rsync'd in place.
# .next.prev is kept as an instant rollback:
#   ssh … 'cd ~/REMOTE_ROOT && mv .next .next.broken && mv .next.prev .next && touch tmp/restart.txt'
say "atomic swap .next + restart workers"
"${SSH[@]}" "$HOST" '
  cd ~/'"$REMOTE_ROOT"' || exit 1
  rm -rf .next.prev
  [ -d .next ] && mv .next .next.prev
  mv .next.incoming .next
  touch tmp/restart.txt
  k=0; for pid in $(ls /proc 2>/dev/null | grep -E "^[0-9]+$"); do
    [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "$HOME/'"$REMOTE_ROOT"'" ] && kill -9 "$pid" 2>/dev/null && k=$((k+1))
  done; echo "killed $k workers"'

# --- 5. warm up + smoke check ----------------------------------------------
say "smoke check"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$PUBLIC_URL/") || code=000
echo "  $PUBLIC_URL/ → HTTP $code"
[ "$code" = "200" ] && echo "  ✅ deploy live" || { echo "  ⚠️  homepage not 200 — check the server"; exit 1; }
