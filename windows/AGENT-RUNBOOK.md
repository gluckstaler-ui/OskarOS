# OskarOS — Windows Install Runbook (for a Claude Code agent)

> **Feed this whole file to the Claude Code agent running on the Windows laptop.**
> It is self-contained: the agent has no prior context. It installs OskarOS into
> WSL2 and leaves it serving at `http://localhost:3000/crm`, pulling the code from
> a Mac (`Paradiso`) on the same WiFi.

---

## 0. Mission & operating rules — read before doing anything

**You are a Claude Code agent on a Windows 10/11 laptop.** Your mission: get OskarOS
running inside **WSL2 (Ubuntu)** and serving its CRM at **`http://localhost:3000/crm`**,
using source code copied **from a Mac on the same WiFi** (no GitHub clone). OskarOS is a
Next.js app (Node) with a SQLite CRM; it spawns the `claude` CLI as a subprocess.

**Definition of Done (DoD):** `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/crm`
returns **`200`** (or `30x`), from a server you started inside WSL, with the `claude` binary
resolvable on PATH and `CLAUDE_CODE_OAUTH_TOKEN` set in `.env.local`.

**Your contract — follow these or you will break things or stall:**
1. **Go one step at a time. After every command, run its `✔ verify` and confirm the expected result before continuing.** Do not batch past a failed verify.
2. **You cannot reboot the machine or click GUI dialogs.** When you hit a `⛔ STOP·HUMAN` marker, stop, tell the user *exactly* what to do in plain words, and wait for them to confirm before continuing.
3. **Never read, print, type, invent, or guess the `CLAUDE_CODE_OAUTH_TOKEN`.** It is the user's secret (§5). You scaffold the file; the user pastes the value.
4. **`sudo` is interactive and your shell can't answer a password prompt.** The one `sudo` line is a `⛔ STOP·HUMAN` step (§4a). Everything you run yourself is sudo‑free.
5. **Idempotent / resumable.** Every step is safe to re-run. If you were restarted mid-install (e.g. after the reboot in §2), re-verify from the top and skip what's already done.
6. **Don't edit OskarOS source.** You're installing, not developing. The only files you create are `.env.local` (empty scaffold) — nothing else.
7. **On failure:** capture the *exact* error text, check §9 Troubleshooting, try the named fix once, and if still blocked **report the error + your hypothesis to the user** — do not improvise destructive workarounds (no `rm -rf`, no `--force`, no disabling the SSRF/security code).
8. **Report at the end** using the template in §11.

---

## 1. Orient — detect your shell & WSL

Linux commands in this runbook are written as `$ <cmd>`. First, find out how to run them.

```
$ uname -a            # works → you're in a Unix-y shell; note if it says "Microsoft"/"WSL"
```

Decide your **RUN convention** and use it consistently for every `$` command below:
- **(A) You're already inside WSL/Ubuntu** — `uname -a` prints `Linux ... microsoft ... WSL2`. Run `$` commands directly in your Bash tool.
- **(B) You're on the Windows side** — your shell is PowerShell / cmd / Git-Bash (`uname` errors or says `MINGW`/`MSYS`). Run each `$` command wrapped: `wsl -d Ubuntu -- bash -lic '<cmd>'` (swap `Ubuntu` for the real distro from §2). Prefer this if unsure.

✔ **verify:** you can state which convention (A or B) you're using and the WSL distro name. If neither works (`wsl` not found *and* not in Linux) → go to §2.

---

## 2. Ensure WSL2 + Ubuntu exists  ⛔ STOP·HUMAN (reboot)

```
# From the Windows side (PowerShell/cmd):
wsl -l -v             # lists installed distros + version
```

- **If a distro (e.g. `Ubuntu`) is listed as VERSION 2** → good, note its exact name, go to §3.
- **If WSL is not installed / no distro:** this needs an **elevated install and a reboot**, which you cannot do. ⛔ **STOP·HUMAN** — tell the user, verbatim:
  > "Open **PowerShell as Administrator** and run `wsl --install -d Ubuntu`, then **reboot**. After the reboot an Ubuntu window will open and ask you to create a **username and password** — do that and remember the password (it's needed for `sudo`). Then re-launch me and say 'WSL is ready.'"
  Then **wait.** After they confirm, re-run `wsl -l -v` and continue.

✔ **verify:** `wsl -l -v` shows your target distro at VERSION 2 and you can run `wsl -d <distro> -- echo ok` → prints `ok`.

---

## 3. Pull the OskarOS code from the Mac (over the WiFi)

The code lives on a Mac (`Paradiso`, default LAN IP **`192.168.0.121`**) that shares it over
HTTP. **First, coordinate with the user:**

⛔ **STOP·HUMAN (briefly):** ask the user to **double-click `serve-from-mac.command`** on the
Mac (in `oskar-prototype/windows/`) and **tell you the IP/URL it prints** (it may differ from
`192.168.0.121`). Wait for "it's serving" + the URL.

Then, as a `$` (Linux/WSL) command, set the IP and pull:

```
$ MAC=192.168.0.121          # ← replace with the IP the Mac printed
$ curl -I --max-time 8 http://$MAC:8080/oskar.tgz     # reachability check
```
✔ **verify:** you get `HTTP/... 200 OK`. If it times out / refuses → §9 "can't reach the Mac".

```
$ cd ~ && curl -O http://$MAC:8080/oskar.tgz \
    && mkdir -p OskarOS && tar -xzf oskar.tgz -C OskarOS
```
✔ **verify:** `$ test -f ~/OskarOS/oskar-prototype/package.json && echo OK` prints `OK`.
The repo root for the rest of this runbook is **`~/OskarOS/oskar-prototype`**.

(Tell the user they can now Ctrl+C the Mac's share window.)

---

## 4. Install dependencies

### 4a. System packages  ⛔ STOP·HUMAN (sudo password)
These need `sudo`, which you can't answer. ⛔ **STOP·HUMAN** — ask the user to run this **in
the Ubuntu window** and enter their Linux password:
```
sudo apt-get update && sudo apt-get install -y build-essential python3 chromium-browser
```
(That's: a C toolchain + python3 so the CRM's `better-sqlite3` compiles, and Chromium for the
thumbnail/screenshot features.) Wait for "done."

✔ **verify (you run):** `$ command -v gcc python3 && (command -v chromium-browser || command -v chromium)` prints paths. If `chromium-browser` is missing, see §9.

### 4b. Node 20 + project deps  (you run — no sudo)
```
$ cd ~/OskarOS/oskar-prototype
$ if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 18 ]; then \
    curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash; \
    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 20; nvm use 20; fi
$ export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"   # ensure node on PATH this shell
$ node -v        # expect v20.x (or ≥18)
$ npm install -g @anthropic-ai/claude-code      # provides the `claude` binary; nvm → no sudo
$ npm install                                    # compiles better-sqlite3 — 1–2 min, no sudo
```
✔ **verify:** `node -v` ≥ 18; `command -v claude` prints a path; `npm install` exits 0 and `node_modules/` exists.
> If `npm install -g` fails with EACCES/permission, you are on a *system* Node, not nvm's — re-run the nvm block above so global installs land in `~/.nvm` (never `sudo npm`).

> Convenience: `bash windows/setup.sh` does 4a+4b in one shot — but it calls `sudo` internally, so only use it if the user is sitting at the Ubuntu terminal to type the password. The split above is the agent-safe path.

---

## 5. Set the OAuth token  ⛔ STOP·HUMAN (secret — do NOT handle the value)

```
$ cd ~/OskarOS/oskar-prototype
$ test -f .env.local || printf 'CLAUDE_CODE_OAUTH_TOKEN=\n' > .env.local
```
⛔ **STOP·HUMAN** — tell the user, verbatim:
> "Open `~/OskarOS/oskar-prototype/.env.local` and paste your token after the `=`, so the line
> reads `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-...`. In the Ubuntu terminal: `nano .env.local`, paste,
> `Ctrl+O Enter Ctrl+X`. Tell me when it's saved."

✔ **verify WITHOUT printing the secret:**
`$ grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' .env.local && echo TOKEN_SET || echo TOKEN_EMPTY`
must print `TOKEN_SET`. (This checks the var is non-empty; it does not reveal the value — keep it that way.)

---

## 6. Launch & verify

Start the server **in the background** (it's long-running — do not block on it):
```
$ cd ~/OskarOS/oskar-prototype
$ export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
$ nohup bash start.wsl.sh > /tmp/oskar.log 2>&1 &
```
Wait ~20–40s (first boot compiles Next.js), then poll up to ~20 times:
```
$ for i in $(seq 1 20); do code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/crm); \
    echo "try $i → $code"; [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "308" ] && break; sleep 3; done
```
✔ **verify (DoD):** you see `200` (or a 30x). Also sanity-check the log: `$ tail -n 30 /tmp/oskar.log`
should show Next.js "ready"/"Local: http://localhost:3000" and **no fatal stack trace**.
If you got a code but the log shows errors, note them in your report (§11) — partial success.

> From the **Windows browser**, the same URL works: `http://localhost:3000/crm` (WSL2 forwards localhost).

---

## 7. Definition of Done — final checklist

- [ ] `wsl -l -v` shows the distro at VERSION 2.
- [ ] `~/OskarOS/oskar-prototype/package.json` exists (code transferred).
- [ ] `node -v` ≥ 18 and `command -v claude` resolves.
- [ ] `.env.local` → `grep` check prints `TOKEN_SET`.
- [ ] `start.wsl.sh` is running (`pgrep -f "next dev"` returns a PID).
- [ ] `curl …/crm` → `200`/`30x`; `/tmp/oskar.log` shows "ready", no fatal error.

All checked → done. Report per §11.

---

## 8. Optional — the clickable desktop icon (Windows side, after DoD)

So the user doesn't type commands next time. From the **Windows** side:
1. Copy `OskarOS-launch.bat` and `OskarOS.vbs` from (in WSL) `~/OskarOS/oskar-prototype/windows/`
   to the Windows Desktop. (WSL files are reachable at `\\wsl$\<distro>\home\<user>\OskarOS\oskar-prototype\windows\`.)
2. Open `OskarOS-launch.bat` in Notepad; confirm `WSL_DISTRO=` matches §2's distro and `OSKAR_DIR=~/OskarOS/oskar-prototype`.
3. Right-click `OskarOS.vbs` → Send to → Desktop (create shortcut); on the shortcut → Properties → Change Icon → pick an `.ico`. Rename it "OskarOS".
Full clicks are in `windows/README.md`. Double-click it → boots in WSL → opens `/crm`.

---

## 9. Troubleshooting (known failure modes)

- **Can't reach the Mac (`curl` to `:8080` times out/refuses).** Same WiFi? (not a "guest"/isolated network). Right IP? (ask the user to re-read the Mac's printout, or run `ipconfig getifaddr en0` on the Mac). Did macOS pop a firewall prompt when sharing started — allow it. The Mac's share window must still be open. From WSL, you can also try the Windows host's view: nothing — it's a direct LAN IP, so the issue is network/firewall/IP.
- **`chromium-browser` not found.** On some Ubuntu it's `chromium`: `⛔ STOP·HUMAN` → ask user to `sudo apt-get install -y chromium`. Not fatal for the CRM — only thumbnails/screenshots need it; you may proceed and note it. Alternatively the app honors `CHROMIUM_BIN=<path>`.
- **`npm install` fails compiling `better-sqlite3`.** Missing `build-essential`/`python3` → re-do §4a. Re-run `npm install`.
- **`npm install -g` EACCES.** You're on system Node → re-run the nvm block (§4b) so node/npm come from `~/.nvm`; never `sudo npm`.
- **`claude` not found at runtime (server boots, agent calls fail).** `command -v claude` empty → the global install didn't land on PATH. Ensure you sourced nvm (`. ~/.nvm/nvm.sh`) and re-ran `npm i -g @anthropic-ai/claude-code` in that shell; confirm `claude --version`. As a last resort the app honors `CLAUDE_BIN=<abs path>` in `.env.local`.
- **Port 3000 already in use.** `$ pkill -f "next dev"`, then re-run §6.
- **`start.wsl.sh` exits immediately.** `tail -n 50 /tmp/oskar.log` for the cause (usually a missing dep or a bad `.env.local`). Fix the named cause; don't loop blindly.
- **A `sudo`/password prompt appears in something you ran.** You triggered an interactive prompt — abort that command, and route the privileged step through `⛔ STOP·HUMAN` instead.

---

## 10. What works vs. doesn't on WSL (so you don't misdiagnose)

- **Works:** the CRM (`/crm`), the Consular chat, the admin dashboard, the CD/WebDev agent bridges (they resolve `claude` via PATH). This is the DoD surface.
- **Needs Chromium (§4a):** vibe thumbnails (admin Sessions view) and the `/api/mcp/screenshot` route. If Chromium isn't installed, those error *gracefully* — they do **not** block the CRM. Don't treat a thumbnail error as install failure.
- **Not relevant here:** the macOS `:80` port-forwarder (`start.sh`) — WSL uses `start.wsl.sh` on `:3000` with no sudo. Don't run `start.sh`.

---

## 11. Report back to the user (use this template)

```
OskarOS Windows install — <DONE | BLOCKED>
• WSL: <distro> v2 ✓ / ✗
• Code: ~/OskarOS/oskar-prototype ✓ / ✗  (from Mac <IP>)
• Node: <version> · claude: <path|missing>
• Token: TOKEN_SET / TOKEN_EMPTY
• Server: <http code at /crm> · log tail: <one line>
• Chromium: installed / missing (thumbnails only)
• Open in Windows browser: http://localhost:3000/crm
<If BLOCKED: the exact step, the exact error, and what you need from the human.>
```
