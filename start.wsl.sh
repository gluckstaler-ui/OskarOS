#!/bin/bash
# OskarOS — WSL launcher (Windows Subsystem for Linux).
#
# Why this exists (vs start.sh): start.sh runs a sudo :80 port-forwarder,
# which pops a password prompt — bad for a double-click icon. Under WSL2,
# Windows forwards localhost into the distro automatically, so we just run
# the dev server on :3000 and Windows reaches it at http://localhost:3000.
# No sudo, no port-forwarder.
#
# Invoked by windows/OskarOS-launch.bat. Can also be run directly:
#   bash start.wsl.sh
set -e
cd "$(dirname "$0")"

echo "──────────────────────────────────────────"
echo " 🪐  OskarOS  (WSL)"
echo "──────────────────────────────────────────"
echo "  CRM:    http://localhost:3000/crm"
echo "  App:    http://localhost:3000"
echo "  Stop:   Ctrl+C  (or close this window)"
echo "──────────────────────────────────────────"
echo ""

# Free :3000 if a prior run is still holding it.
pkill -f "next dev" 2>/dev/null || true

# `npm run dev` runs predev (builds the MCP server) then Next.js dev.
# -H 0.0.0.0 so both Windows-localhost forwarding and the LAN can reach it.
npm run dev -- -H 0.0.0.0 -p 3000
