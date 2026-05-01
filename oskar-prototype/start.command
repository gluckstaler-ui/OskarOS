#!/bin/bash
# OskarOS — one-click startup. Double-click this file in Finder and it
# opens Terminal, asks for your sudo password once, and brings up the
# dev server on port 80 with the CLI bridge working.
#
# Assumes `.env.local` contains CLAUDE_CODE_OAUTH_TOKEN=... so the CLI
# subprocess can auth without your Keychain (root can't read it).
#
# Drag this file to your Dock or Desktop for truly one-click access.

set -e

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

clear
echo "──────────────────────────────────────────"
echo " 🪐  OskarOS — starting on port 80"
echo "──────────────────────────────────────────"
echo "Project: $PROJECT_DIR"
echo ""

# Kill any existing dev server so :80 is free.
sudo pkill -f "next-server|next dev" 2>/dev/null || true

# Clear .next so root perms from past sudo runs don't fight user perms.
echo "Clearing .next cache..."
sudo rm -rf .next

# Launch. Turbopack, port 80, LAN-reachable via -H 0.0.0.0.
# Bridge reads CLAUDE_CODE_OAUTH_TOKEN from .env.local and passes it to
# `claude --print` subprocesses, so the CLI works under root.
echo "Starting Next.js on :80..."
echo "────────────────────────────"
echo "  LAN:    http://paradiso.local  or  http://paradiso"
echo "  Local:  http://localhost"
echo "  Stop:   Ctrl+C"
echo "────────────────────────────"
echo ""

sudo npm run dev -- -H 0.0.0.0 -p 80
