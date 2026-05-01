#!/bin/bash
# OskarOS — start the dev server with :80 exposed to the LAN.
#
# Architecture:
#   - Next.js runs as YOU on :3000 (unprivileged, Keychain intact, CLI works).
#   - A tiny single-process Node forwarder runs as root on :80 and
#     proxies everything to 127.0.0.1:3000. No fork-per-connection —
#     fast under the parallel-request load of a Next.js dev page.
#   - Forwarder is killed automatically when this script exits.
#
# Run:   ./start.sh
# Stop:  Ctrl+C

set -e

cd "$(dirname "$0")"

clear
echo "──────────────────────────────────────────"
echo " 🪐  OskarOS"
echo "──────────────────────────────────────────"
echo ""

# Clean .next if a prior sudo run left root-owned files.
if [ -d ".next" ]; then
  rm -rf .next 2>/dev/null || sudo rm -rf .next
fi

# Free :80 in case a prior run's forwarder (or socat, or whatever else)
# is still holding it.
sudo pkill -f "port-forward.js" 2>/dev/null || true
sudo pkill -f "socat.*TCP-LISTEN:80" 2>/dev/null || true

# Start the Node forwarder in the background (needs sudo for :80).
echo "Starting :80 → :3000 forwarder (sudo)..."
sudo node scripts/port-forward.js &
FWD_PID=$!

# Kill the forwarder when this script exits — Ctrl+C, normal exit, error.
trap 'sudo kill $FWD_PID 2>/dev/null; exit' INT TERM EXIT

echo ""
echo "  LAN:    http://paradiso.local  or  http://paradiso"
echo "  Local:  http://localhost"
echo "  Stop:   Ctrl+C"
echo ""

npm run dev
