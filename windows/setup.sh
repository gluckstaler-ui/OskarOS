#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# Run this INSIDE WSL (Ubuntu), AFTER the repo is at ~/OskarOS/oskar-prototype.
# One-shot install: system packages + Node 20 + project deps + env scaffold.
#
#   cd ~/OskarOS/oskar-prototype
#   bash windows/setup.sh
# ════════════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")/.."          # repo root (this script lives in windows/)
echo "🪐  OskarOS — WSL setup   ·   $(pwd)"
echo ""

echo "1/4 · system packages (asks for your sudo password)…"
sudo apt-get update -y
sudo apt-get install -y build-essential python3 chromium-browser
#   build-essential + python3 → so better-sqlite3 (the CRM DB) compiles
#   chromium-browser           → vibe thumbnails + the screenshot route

echo ""
echo "2/4 · Node 20…"
if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -ge 18 ] 2>/dev/null; then
  echo "    found $(node -v)"
else
  echo "    installing via nvm…"
  curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20 && nvm use 20
  echo "    installed $(node -v)"
fi

echo ""
echo "3/4 · claude CLI + project dependencies (compiles better-sqlite3 — a minute or two)…"
npm install -g @anthropic-ai/claude-code || echo "    (global claude install needs PATH/perms — see INSTALL.md §troubleshooting)"
npm install

echo ""
echo "4/4 · env file…"
if [ -f .env.local ]; then
  echo "    .env.local already exists — leaving it"
else
  printf 'CLAUDE_CODE_OAUTH_TOKEN=\n' > .env.local
  echo "    created .env.local — paste your token after the = sign"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅  Setup complete."
echo "    1) token:   nano .env.local      (paste after CLAUDE_CODE_OAUTH_TOKEN=)"
echo "    2) start:   bash start.wsl.sh"
echo "    3) open:    http://localhost:3000/crm   (in your Windows browser)"
echo "════════════════════════════════════════════════════════════"
