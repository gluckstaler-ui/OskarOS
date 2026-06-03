#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# Run this ON THE MAC (Paradiso). Double-click it in Finder, or run it
# from Terminal. It packages OskarOS — minus the heavy / regenerable /
# secret bits — and serves it over the local WiFi so the Windows laptop
# can pull it. Leave the window open during the download.
#
#   node_modules / .next / .cache  → rebuilt on Windows by `npm install`
#   .git / .claude                 → not needed on the target
#   db/                            → CRM data is NOT shipped (privacy);
#                                    the Windows box boots a fresh CRM
#   .env.local / .env              → the OAuth token is NEVER served;
#                                    you paste it on the Windows side
# ════════════════════════════════════════════════════════════════════
set -e
REPO="/Users/ralphlengler/OskarOS/oskar-prototype"
OUT="/tmp/oskar-transfer"
PORT=8080
mkdir -p "$OUT"

echo "Packaging $REPO  (this can take a moment — public/ + Fonts are large)…"
tar --exclude='node_modules' --exclude='.next' --exclude='.cache' \
    --exclude='.git' --exclude='.claude' --exclude='db' \
    --exclude='.env.local' --exclude='.env' \
    -czf "$OUT/oskar.tgz" -C "$(dirname "$REPO")" "$(basename "$REPO")"

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '<your-mac-ip>')"
SIZE="$(du -h "$OUT/oskar.tgz" | cut -f1)"

clear
echo "════════════════════════════════════════════════════════════"
echo "  OskarOS packaged   ·   $SIZE   ·   $OUT/oskar.tgz"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  On the WINDOWS laptop, inside Ubuntu (WSL), run:"
echo ""
echo "      cd ~ && curl -O http://$IP:$PORT/oskar.tgz \\"
echo "        && mkdir -p OskarOS && tar -xzf oskar.tgz -C OskarOS"
echo ""
echo "  → the repo lands at  ~/OskarOS/oskar-prototype"
echo ""
echo "  Keep this window OPEN until the download finishes."
echo "  Press Ctrl+C here when you're done sharing."
echo "════════════════════════════════════════════════════════════"
echo ""
cd "$OUT"
python3 -m http.server "$PORT"
