# OskarOS on Windows (via WSL)

A double-click launcher that boots OskarOS inside **WSL** (Windows Subsystem for
Linux) and opens the CRM at `/crm` in your browser.

OskarOS is a Linux/macOS app — there is no native Windows build. WSL runs the
exact same code on a real Linux kernel, and Windows forwards `localhost` into it
automatically, so the experience is: **click icon → CRM opens**.

## Files

| File | What it does |
|------|--------------|
| `OskarOS-launch.bat` | The launcher. Starts the dev server in WSL, waits for it, opens `/crm`. Double-clickable; shows a small console. |
| `OskarOS.vbs` | Same thing with **no** launcher console (cleaner "app" feel). The WSL server still opens its own window — that's your live log. |
| `../start.wsl.sh` | The WSL-side start script the launcher calls (dev server on `:3000`, no sudo). |

## One-time setup

1. **Install WSL2 + a distro** (Ubuntu recommended), in PowerShell:
   ```powershell
   wsl --install -d Ubuntu
   ```
   Confirm the name later with `wsl -l -q`.

2. **Inside WSL**, install system deps + Chromium, Node 20+, the `claude` CLI,
   and clone the repo:
   ```bash
   # System deps: build-essential + python3 let better-sqlite3 (the CRM's DB)
   # compile if no prebuilt matches your Node ABI; chromium-browser powers the
   # thumbnails + screenshot route (and pulls the headless libs chromium needs).
   sudo apt update && sudo apt install -y build-essential python3 chromium-browser

   # Node (nvm shown; any Node 20+ is fine)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   nvm install 20

   # The agent binary OskarOS spawns — must end up on PATH (see Caveat)
   npm i -g @anthropic-ai/claude-code        # provides the `claude` binary
   # (optional) install the Gemini CLI too if you use the Gemini bridge

   # The repo — WSL home is fast; /mnt/c is much slower
   git clone <your-oskar-remote> ~/OskarOS/oskar-prototype
   cd ~/OskarOS/oskar-prototype && npm install
   ```
   `npm install` skips Puppeteer's ~150 MB browser download (`.puppeteerrc.cjs`) —
   OskarOS uses the system Chromium above, never Puppeteer's bundled one. If
   `chromium-browser` isn't available on your distro, install `chromium` instead
   (or set `CHROMIUM_BIN` to any Chromium binary).

3. **Auth**: put your token in `~/OskarOS/oskar-prototype/.env.local`:
   ```
   CLAUDE_CODE_OAUTH_TOKEN=...
   ```
   (On Linux there's no Keychain — the token in `.env.local` is how the CLI
   subprocess authenticates.)

4. **Point the launcher at your setup**: open `OskarOS-launch.bat` in Notepad and
   edit the CONFIG lines if they don't match:
   - `WSL_DISTRO` — your distro name from `wsl -l -q` (default `Ubuntu`)
   - `OSKAR_DIR` — repo path **inside WSL** (default `~/OskarOS/oskar-prototype`)
   - `PORT` — dev-server port (default `3000`; must match `start.wsl.sh`)

## Make it a clickable icon

1. Right-click `OskarOS.vbs` (or the `.bat`) → **Show more options** → **Send to**
   → **Desktop (create shortcut)**.
2. Right-click the new desktop shortcut → **Properties** → **Change Icon…** →
   **Browse…** and pick an `.ico` file. (OskarOS ships `app/favicon.ico` you can
   reuse, or use any `.ico`. A `.png` won't work — Windows shortcuts need `.ico`.)
3. Rename the shortcut to **OskarOS**. Optionally pin it to Start or the taskbar.

Double-click it → a WSL window opens with the server log → your browser opens at
`http://localhost:3000/crm`.

## Stopping

Close the **"OskarOS (WSL)"** window, or press `Ctrl+C` in it. To fully reset
WSL: `wsl --shutdown` in PowerShell.

## What runs on WSL (all of it, as of 2026-06-02)

WP-40 + WP-128 shipped, so the whole app is Linux/WSL-clean:

- **CRM (`/crm`), Consular chat, admin dashboard** — run once `claude` is on PATH
  (step 2's `npm i -g` handles that) and the OAuth token is in `.env.local`.
- **Vibe thumbnails + screenshot route** — work once `chromium-browser` is
  installed (step 2) or `CHROMIUM_BIN` points at a Chromium. Both launchers now
  resolve the binary via `lib/cli-paths.ts` instead of the old hardcoded macOS path.
- **Sentinel Ti** — resolves its agent file relative to the project now; no
  hardcoded path.

Notes:
- **Chromium package name varies.** Resolution tries `/usr/bin/chromium`,
  `/usr/bin/chromium-browser`, `/snap/bin/chromium`, the macOS path, then
  `CHROMIUM_BIN`. Install whichever your distro ships, or set `CHROMIUM_BIN`.
- **`claude` on a non-standard layout** (e.g. nvm-only): the agents still resolve
  it via PATH, but the model-badge probe wants an absolute path — set `CLAUDE_BIN`
  if the badge shows an error.
- **Dev vs build.** The launcher runs `next dev` — correct for this use. `next
  build` is currently red on a handful of **pre-existing** type errors (present on
  macOS too, unrelated to the port); only relevant if you later switch to a
  production `next build` / `next start`.

Implementation record: `docs/Feature-X.md` §4 (WP-40) + §4.7 (WP-128).
