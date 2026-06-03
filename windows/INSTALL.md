# Installing OskarOS on a Windows laptop (over the WiFi, from the Mac)

OskarOS is a Linux/macOS app — there is **no native Windows `.exe`**. It runs inside
**WSL2** (a real Linux kernel that ships with Windows), and Windows forwards
`localhost` into it, so the end result is: click an icon → the CRM opens in your
browser. This guide installs it on the Windows machine, pulling the code **from the
Mac (`Paradiso`, `192.168.0.121`) over the same WiFi** — no GitHub / internet clone needed.

> **Why no `.exe` installer?** A `.exe` can't reliably automate `wsl --install` (it
> needs a reboot + the Microsoft Store) or compile the native modules. The robust
> "installer" is Microsoft's own `wsl --install` **plus** the one-shot `setup.sh` below.

**You'll need:** Windows 10/11 + admin rights · both laptops on the same WiFi · your
`CLAUDE_CODE_OAUTH_TOKEN` · ~20–30 min (mostly downloads). One reboot.

---

## Part A — on the MAC: share the code over WiFi

1. In Finder, open `oskar-prototype/windows/` and **double-click `serve-from-mac.command`**
   (or run `bash windows/serve-from-mac.command` in Terminal).
2. It packages the repo (skipping `node_modules`, the CRM database, and your token —
   those are rebuilt / set fresh on Windows) and prints a block like:

   ```
   On the WINDOWS laptop, inside Ubuntu (WSL), run:
       cd ~ && curl -O http://192.168.0.121:8080/oskar.tgz \
         && mkdir -p OskarOS && tar -xzf oskar.tgz -C OskarOS
   ```
3. **Leave that Terminal window open** — it's the file server. Copy the `curl` line.
   *(If the Mac's IP isn't `192.168.0.121`, the script prints the real one — use that.)*

---

## Part B — on the WINDOWS laptop

### 1. Install WSL2 + Ubuntu  *(the real "installer" — once)*
Open **PowerShell as Administrator** and run:
```powershell
wsl --install -d Ubuntu
```
**Reboot when it asks.** After the reboot an Ubuntu window opens and asks you to create
a **username + password** (this is your Linux user — remember the password, `sudo` needs it).
Already have WSL? Just `wsl --install -d Ubuntu` to add the distro, or use your existing one.

### 2. Pull the code from the Mac
In the **Ubuntu** window, paste the `curl` line from Part A:
```bash
cd ~ && curl -O http://192.168.0.121:8080/oskar.tgz \
  && mkdir -p OskarOS && tar -xzf oskar.tgz -C OskarOS
```
The repo is now at `~/OskarOS/oskar-prototype`. *(You can Ctrl+C the Mac's share window now.)*

### 3. Run the one-shot setup
```bash
cd ~/OskarOS/oskar-prototype
bash windows/setup.sh
```
This installs build tools + Chromium, Node 20, the `claude` CLI, and the project deps
(it compiles `better-sqlite3`, ~1–2 min), and creates an empty `.env.local`.

### 4. Paste your token
```bash
nano .env.local
```
Put your token after the `=` so the line reads `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-...`,
then `Ctrl+O`, `Enter`, `Ctrl+X`. *(No Keychain on Linux — this file is how the CLI authenticates.)*

### 5. Start it
```bash
bash start.wsl.sh
```
Leave it running, then open **`http://localhost:3000/crm`** in any Windows browser.
That's it — the CRM is live.

### 6. (Optional) the desktop icon
So you don't type commands next time: in Windows, copy `OskarOS-launch.bat` and
`OskarOS.vbs` (from `oskar-prototype/windows/`) to your Desktop, open `OskarOS-launch.bat`
in Notepad and confirm `WSL_DISTRO=Ubuntu` + `OSKAR_DIR=~/OskarOS/oskar-prototype`, then
make a shortcut to `OskarOS.vbs` and give it an icon. Full steps in **`README.md`** (same folder).

---

## Troubleshooting

- **`curl` can't reach the Mac** — confirm both are on the *same* WiFi (not a guest network);
  re-check the Mac's IP (`ipconfig getifaddr en0` on the Mac); if a macOS firewall prompt
  appeared when the share started, allow it. Test from Windows: `curl -I http://192.168.0.121:8080/oskar.tgz`.
- **`chromium-browser` not found** — on some Ubuntu builds it's `chromium`: `sudo apt-get install -y chromium`. Or skip it for now (only thumbnails/screenshots need it) and set `CHROMIUM_BIN` later.
- **`npm install -g` permission error** — you likely have a system Node; either re-run setup so nvm's Node is used, or `sudo npm install -g @anthropic-ai/claude-code`.
- **Port 3000 busy** — `pkill -f "next dev"` then re-run `start.wsl.sh`.
- **`claude` not found at runtime** — make sure step 4's token is set and `claude` is on PATH (`which claude`); if you used nvm, run `start.wsl.sh` from the same Ubuntu shell.

---

## Alternative — *don't* install, just use the Mac's instance

If you only want to **view** OskarOS from the Windows laptop (not run it there): on the
Mac run `./start.sh`, then on Windows just browse to **`http://192.168.0.121`** (or
`http://paradiso.local`). Nothing to install — but the Mac has to be on and running.
This guide is for a real, standalone install on the Windows box.
