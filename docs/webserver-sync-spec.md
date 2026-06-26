# Webserver Sync — Implementation Spec

Sync a session's files to a webserver. Three transports (FTPS / FTP / Local), all session state in **one file** (`_session-config.json`), tested with a real harness in-process.

**Primary source of truth:** `public/2026-05-31-weingut-barbazza/webserver-sync-prototype.html`. Where this spec disagrees with the prototype, the prototype wins.

This spec encodes Ralph's directives, not generic best practice. Where the two disagree, Ralph wins.

---

## 1. Scope & phasing

cPanel shared hosting has two completely different user types:

1. **Main cPanel user** (e.g. `aweseybn`) — real Unix account, full shell access via SSH/SFTP. The account *owner*.
2. **FTP sub-accounts** (e.g. `marin@awesome-ux.ch`) — virtual users in **Pure-FTPd**, NO Unix shell, NO SSH access, daemon-level chroot. The accounts you hand to *clients*.

The whole point of this product is per-client accounts. SFTP would silently fail for every client and only work for the owner — a bad asymmetry. More importantly, **SSH means full shell on the account**: a leaked SSH credential lets an attacker read every site, every mailbox, every backup, plant cron jobs, exfiltrate `~/.ssh/`, the lot. **FTP sub-account compromise = one folder, full stop.** Compartmentalization beats elegance. SFTP is dropped from this spec entirely.

For Ralph's own deploys, `scripts/deploy-server.sh` still uses SSH/rsync — that's the owner deploying his own app, different threat model, different transport. Different job.

---

## 2. Architecture

### UI placement — the 4th tab of the session panel

```
┌──────────────────────────────────────────┐
│  [Assets] [CRM] [Meta] [Sync] · 103 items│   ← tab row
├──────────────────────────────────────────┤
│                                          │
│  (active pane scrolls)                   │
│                                          │
└──────────────────────────────────────────┘
```

Sync is a sibling of Assets/CRM/Meta inside the existing session-level panel, **not** nested in MetaPanel. The panel itself is container-query responsive (Brief mode ~420px, Studio mode ~220px). Tabs in Studio mode collapse labels to icons; the active tab keeps its label.

### Code layout

```
lib/site/
  transport.ts    // interface: connect/close, list(dir), manifest(dir), upload, download, mkdirp, remove
  ftp.ts          // FtpTransport   — basic-ftp, handles BOTH FTPS (secure:true) and plain FTP
  local.ts        // LocalTransport — node:fs (File mode — OskarOS running on the server)
  compare.ts      // transport-agnostic diff (local manifest ⇄ remote manifest)
  config.ts       // read/write _session-config.json
  essential.ts    // the hardcoded essential-extensions allowlist (see §7)
app/api/site/{connect,list,compare,sync,config}/route.ts
components/studio/WebserverSync.tsx   // the Sync tab pane
lib/sync/stream.ts                    // SHARED with /api/admin/sync/run — SYNC_FILE/SYNC_OK/SYNC_ERR/SYNC_DONE emitter
scripts/site-sync-harness.mjs         // in-process FTPS + FTP server, exit 0/1
```

`compare`/`sync` are written once against `Transport`. FTPS, FTP, and Local all share the diff and transfer logic — the only difference is the adapter.

---

## 3. Config & credentials — ALL in `_session-config.json`

**Path:** `public/<session>/logs/_session-config.json` — the `logs/` subdir, NOT the session root (moved there 2026-05-22, WP-CRM-A12; `lib/session-config.ts` `getConfigPath()` is authoritative). Underscore-prefixed = system file. A config written to the session root (`public/<session>/_session-config.json`) is **invisible to the code** — it is never read. Always read/write through `readSessionConfig`/`writeSessionConfig`, never by hand-authoring a path.

**Credentials live in this file in plaintext.** No Keychain, no `.env`, no env vars, no separate vault. The file is a session asset; sync settings belong with it. Ralph's call — explicitly chosen against the "compliance officer" reflex. Per-session, never aggregated, never read across sessions.

### Field shape — example (Marin / Barbazza)

```json
{
  "site": {
    "domain": "barbazza.wine",
    "method": "ftp",
    "secure": "ftps",
    "host": "premium707.web-hosting.com",
    "port": 21,
    "user": "marin@awesome-ux.ch",
    "password": "MarlaSinger",
    "docroot": "/public_html/barbazza.wine",
    "defaultDirection": "up",
    "ignore": ["logs/", "screenshots/", "_session-config.json", ".git/", "node_modules/", ".env*", ".DS_Store", "OldVibes/", "LINEAGE.json"]
  }
}
```

For **File** (Local) mode:

```json
{
  "site": {
    "domain": "barbazza.wine",
    "method": "file",
    "destination": "/var/www/barbazza",
    "defaultDirection": "up",
    "ignore": [ ... ]
  }
}
```

### Field notes — these are correct for Namecheap shared cPanel (tested)

- **`method`** = `"ftp"` | `"file"`. The form's mode toggle writes this.
- **`secure`** = `"ftps"` | `"plain"`. UI default `"ftps"`; only set `"plain"` if the host can't do AUTH TLS. Drives the chip color (green vs yellow).
- **`host`** = the **server hostname** (e.g. `premium707.web-hosting.com`), NOT `ftp.<domain>`. The server cert is `*.web-hosting.com`; `ftp.<domain>` triggers a hostname mismatch every connect. Get the right value from cPanel → Email Setup → "Outgoing Server."
- **`user`** = **`<name>@<addon-domain>`** (e.g. `marin@barbazza.wine`). This is cPanel's canonical display + recommended form. (Earlier note in this file claimed it had to be `<name>@<MAIN-cPanel-domain>` — that was wrong; both forms happen to authenticate on Namecheap shared cPanel, but the addon-domain form is what the UI shows and is the right one to standardize on.)
- **`port`** = 21 (FTPS or plain FTP — both on 21).
- **`docroot`** = absolute path on the server, **inside the FTP user's chroot**. The cPanel sub-account is already chrooted by the daemon to its assigned folder; this is the path *as the user sees it*.
- **`ignore`** = minimal, lives in this file (no separate `.publishignore`). One canonical config, one place to edit. **`logs/`, `screenshots/`, and `_session-config.json` are always excluded** — they don't appear in the picker, don't appear in the diff, don't sync in either direction. Enforced by the walker, not by `site.ignore` alone — removing them from config doesn't sync them.

The user types these into the form, or the system pre-fills if `_session-config.json` already exists. Either path writes via `POST /api/site/config`.

---

## 4. Transport: FTPS + FTP (`basic-ftp`) + Local (`node:fs`)

### FTPS — the secure default (green chip)

```js
import { Client } from 'basic-ftp'
const c = new Client(30_000)
await c.access({
  host, port: 21, user, password,
  secure: true,                                       // FTPS: AUTH TLS on 21, then PBSZ 0 + PROT P
  secureOptions: { rejectUnauthorized: false, servername: host },
})
const list = await c.list()                           // prefer MLSD; falls back to LIST if MLSD not advertised
await c.ensureDir(parent)
await c.uploadFrom(localPath, remotePath)
await c.downloadTo(localPath, remotePath)
await c.close()
```

- `secure: true` → explicit FTPS (AUTH TLS on port 21, then PBSZ 0 + PROT P).
- `rejectUnauthorized: false` is set explicitly because the common shared-hosting case is hostname mismatch (cert covers `*.web-hosting.com`, user dialled `<host>`). No gate, no modal — the chip color and an info-only snackbar are the disclosure.

### Plain FTP — the fallback (yellow chip)

Same `basic-ftp` client, `secure: false`. Used only when FTPS refuses or `site.secure === "plain"`. UI surfaces it via yellow pulse chip — no warning dialog, no "are you sure," just the visual.

### Local — `node:fs` (teal chip)

For when OskarOS itself runs ON the server. Transport ops resolve to `fs.cp` / `fs.stat` / `fs.readdir` under the chosen `destination`. No network, no auth.

### Operational rules — all transports

- **One connection per API request.** `basic-ftp` is not concurrency-safe. A single `/api/site/sync` call opens one connection, processes the whole file batch on it, closes it.
- **No connection pooling across requests.** Each request reconnects.
- **The remote-path walker honors `site.ignore` + the hard-excludes** (see §3).

---

## 5. UI — the Sync pane

Implements `components/studio/WebserverSync.tsx`. Renders inside the session panel as the Sync tab. Anatomy follows the prototype exactly.

### 5.1 Connection accordion card (top of pane)

One card at the top owns the entire connection state. Two layers:

#### Summary view (always visible)
```
┌──────────────────────────────────────────┐
│  ⚲  barbazza.wine   [FTPS]               │
│     marin@awesome-ux.ch                  │
│     → /public_html/barbazza.wine     ▾  ⏻│
└──────────────────────────────────────────┘
```

- **Mark icon** (left): `⚲` offline, `🛰` FTPS/FTP, `🗂` File mode
- **Site label**: the domain
- **Badge**: `FTPS` (green) | `FTP · plain` (yellow) | `Local` (teal) | `offline` (red)
- **Line 1**: user@host (FTP/FTPS) or destination path (File)
- **Line 2**: `→ <docroot>` (FTP/FTPS) — absent in File mode
- **Chevron** (▾): rotates 180° when the form below is expanded
- **Power dot** (⏻): the **only** control that connects/disconnects

#### Pulsing border = state (subtle animated breathing)
- 🟢 green pulse — FTPS or File connected
- 🟡 yellow pulse — plain FTP connected
- 🔴 red static — offline or error
- *fast pulse during `connecting`*

#### Form view (expanded, toggled by clicking the card body — NOT the power dot)

```
┌──────────────────────────────────────────┐
│  ┌─────────────────┬──────────────────┐  │
│  │  FTP / FTPS     │       File       │  │  ← mode toggle
│  └─────────────────┴──────────────────┘  │
│                                          │
│  Domain                       Port       │
│  [premium707.web-host…]       [21]       │
│                                          │
│  FTP user                                │
│  [marin@awesome-ux.ch]                   │
│                                          │
│  Password                                │
│  [••••••••••••]                          │
│                                          │
│  Hit the power dot above to connect ·    │
│  tap the card to close                   │
└──────────────────────────────────────────┘
```

**Password reveal** (Ralph 2026-06-24). The password field carries an eye toggle, right-aligned inside the input, that switches it between masked (`type=password`, the default) and plaintext (`type=text`). The user reveals to verify what they typed. Credentials are stored plaintext on disk anyway (§3), so revealing in-form discloses nothing new — it only removes the guess-the-dots friction. Masked is the default each time the form opens.

In File mode, the FTP fields collapse to a single dropdown for destination folder with a few static suggestions (`/var/www/<X>`, `/home/<X>/public_html`, `/srv/sites/<X>`). No cPanel auto-detect — out of scope.

#### Stale bar (between summary and form)

When `status === 'on'` AND a connection field was edited since connect:

```
┌──────────────────────────────────────────┐
│  ↻ Settings changed — reconnect to apply │   ← yellow, clickable
└──────────────────────────────────────────┘
```

Click → re-runs `connect` with the new field values.

### 5.2 State machine

```
                       togglePower()
            off ──────────────────────────→ connecting
             ▲                                   │
             │                                   │ result
             │                                   ▼
             │ togglePower()                    on
             ◄────────────────────────────  ◄────┘
                                                 │
                                                 │ edit field
                                                 ▼
                                              on + stale
                                                 │
                                                 │ reconnect()
                                                 ▼
                                              connecting
```

- **`togglePower()`** is the ONLY connect/disconnect control. Click while connecting → abort. Click while on → disconnect. Click while off → connect. **Never opens the form.**
- **Field edit while connected** → stale (yellow bar appears, doesn't disconnect).
- **Mode switch while connected** (FTP ⇄ File toggle) → auto-disconnects (different transport entirely; can't just "reconnect with the new settings").
- **`connect` flow** = close form → set status `connecting` → run transport `connect` → set status `on` → `compare()` auto-fires.

### 5.3 Action row (below the connection card)

```
┌─────────────────┬──────────────────────┐
│ ↑  Publish  ◯─● │      Sync · 5 ↑      │
└─────────────────┴──────────────────────┘
```

- **Direction toggle (left)**: pill, blue (download/off) ↔ green (publish/on). Arrow flips `↑`/`↓`. Label `Publish` (up) or `Download` (down).
- **Sync button (right)**: large primary action, color matches direction (green for up, blue for down). Shows count of currently-selected files. Disabled until `connect.status === 'on'` AND `selectedCount > 0`.
- **Direction change auto-fires `compare()`** — the diff is direction-sensitive (a file present on the source side but not the destination is "new"; switching direction inverts the picture).

### 5.4 Changes table

```
┌── 5 files to publish ───────────────  ↻ ──┐
├─ ☑ [up]  index.html              84.2 KB ─┤
├─ ☑ [ch]  index.html      84.2 KB › 81.6 KB┤
├─ ☑ [up]  assets/css/style.css    22.1 KB ─┤
├─ ☐ [up]  notes.md               2.0 KB ───┤  ← non-essential, NOT pre-checked
└─ ☐ [dn]  old-promo-2019.html   12.0 KB ───┘  ← server-only, NOT pre-checked
```

- **Header**: `<N> files to publish/download` + recompute button (↻) that re-runs `compare()`.
- **Per-row columns**: checkbox · status pill · path · size info.
- **Status pills** — color-coded:
  - 🟢 `up`   — new on the source side (will be uploaded)
  - 🟡 `ch`   — both sides have it, content differs
  - 🔵 `dn`   — only on the other side (will be downloaded — when in `↓ Download` direction)
- **Path display**: directory dimmed, filename normal (`<span class="d">assets/img/</span>edit-posip-grapes.jpg`).
- **Size cell**: changed → `<src>` › `<dst>`; new → `<src>`; unchanged → dimmed.
- **Default selection**: `essential && (new || changed)`. Non-essential files appear but are NOT pre-checked. User clicks to include.
- **Sort order**: changed-essential → new-essential → new-non-essential → changed-non-essential → unchanged.
- **Per-row sync states (during `sync` execution)**:
  - `work` — orange background + tiny spinner
  - `ok`   — green ✓ at right
  - `err`  — red background + `✕ <code>` (FTP error code, e.g. `550`)
- **Summary line below table** (after sync done):
  - success: `⛉ <N> live on <site> · backup saved`
  - partial: `✕ <fail> failed · ⛉ <ok> live · backup saved` + button `↻ Retry <fail>`

---

## 6. Essentiality

Hardcoded extension allowlist in code (`lib/site/essential.ts`). **No config field.** The user can't override per-session; if the rule needs to change, change the code.

```ts
export const ESSENTIAL_EXTS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf',
  '.json', '.pdf', '.mp4', '.webm', '.mp3',
  '.txt', '.xml', '.map', '.wasm'
])
export const isEssential = (path: string) => ESSENTIAL_EXTS.has(extname(path).toLowerCase())
```

Non-essential = everything else (`.md`, `.log`, `notes.md`, etc.). Both essential and non-essential are uploadable; the discouragement is purely UI (not auto-selected). If a user really wants to push `session.md`, they click the row and click Sync.

---

## 7. Compare / diff

Walk both sides (honoring `site.ignore` + the hard-excludes) into `{ relPath → { size, mtime } }`, then classify per-file:

| Condition | Status | Default flow |
|---|---|---|
| only on source side | `new` | publish (up) or download (down) |
| both, size differs | `changed` | publish or download, mtime labels which side is newer |
| both, size equal | `unchanged` | — (not shown in diff list by default) |

Size is the authoritative "differs" signal (FTP doesn't provide reliable server-side checksums; MDTM mtime is timezone-flaky). MDTM/MLSD mtime is used only to label which side is newer.

**Documented limitation:** same-size different-content is not flagged on FTP/FTPS. Acceptable for HTML/CSS/text/images; a future opt-in could add a content-hash pass.

`POST /api/site/compare` returns the file list + per-file status + a summary. The exact JSON shape is finalized when the UI is built against it.

---

## 8. API

| Endpoint | Does | Mutates? |
|---|---|---|
| `POST /api/site/connect`  | open FTPS→FTP fallback (or set up Local), return `{ok, method, secure, docroot}` | no |
| `GET  /api/site/list?session&path` | dir listing for the picker | no |
| `POST /api/site/compare`  | return the diff manifest | no |
| `POST /api/site/config`   | read/write `_session-config.json` | local file only |
| `POST /api/site/sync`     | upload/download the selected files, streamed per-file results | **yes — the only live-site write** |

`connect` is also the probe: same call returns whether the negotiated transport was FTPS (green) or fell back to plain FTP (yellow). No separate `/probe` endpoint.

`sync` streams via `ReadableStream`, **using `lib/sync/stream.ts` shared with `/api/admin/sync/run`** (the existing CRM/codebase sync). Same line format:

```
SYNC_FILE <name>
SYNC_OK <name>
SYNC_ERR <name> <reason>
SYNC_DONE ok=<n> fail=<m>
```

Same UI parser. Don't reimplement.

Each file is its own try/catch → partial success. Retry POSTs back only the failed names.

### Backup-on-overwrite — one sidecar, html/css only

Before any file is overwritten by sync:

```
if (ext is .html or .css) AND (target file exists at destination):
  1. if  <base>-bak.<ext>  exists at destination → delete it
  2. rename existing  <base>.<ext>  →  <base>-bak.<ext>
  3. write the new file in its place
```

Otherwise: direct overwrite, no backup.

- **One backup per file, always.** Not 100 snapshots, not a `-bak-<ts>.<ext>` chain. The latest `-bak` always reflects the *immediately previous* version. Older versions are intentionally discarded.
- **Scope: `.html` and `.css` only.** Backups exist to protect hand-edited text files, not regenerated assets.
- **Applies in both directions.** On upload the *remote* file is renamed before the new bytes land; on download the *local* file is renamed.
- **New files: no backup needed.**
- **`-bak` files are first-class.** Visible in the picker, present in the diff, syncable like anything else. The whole point is for the user to see/access/restore from them. The rotation rule fires only when the *base* file is about to be overwritten; touching `index-bak.html` directly is just a normal file transfer.
- **Sequence inside a single sync run is well-defined** — if a user picks both `index.html` and `index-bak.html`, base goes first (rotates), then explicit backup overwrites the just-rotated sidecar. No surprise.

### Sync-history log — `logs/sync-log.md`

Every sync run appends an entry to `public/<session>/logs/sync-log.md`. Markdown so it reads fine in any editor; `logs/` is hard-excluded so the log itself never travels to the server.

**Format — newest entry at the top:**

```markdown
# Sync log — <session>

## 2026-06-23 14:32:18Z · ↑ publish · ftps · marin@premium707.web-hosting.com → /public_html/barbazza.wine
- 5 ok, 0 fail, 124.3 KB, 1.4s
- ok   index.html        (-bak.html written)
- ok   history.html      (new)
- ok   assets/css/style.css   (-bak.css written)
- ok   assets/img/grapes.jpg  (new)
- ok   favicon-32.png    (overwrite)

## 2026-06-23 13:15:02Z · ↓ download · ftps · marin@premium707.web-hosting.com → /public_html/barbazza.wine
- 1 ok, 0 fail, 8.2 KB, 0.3s
- ok   index.html        (-bak.html written)
```

- Header: ISO-UTC timestamp · direction (↑ publish / ↓ download) · negotiated transport (ftps/ftp/file) · user@host → docroot.
- Summary: counts, total bytes, duration.
- Per-file bullet: `ok`/`fail` · path · note (`new` first-time; `overwrite` for non-html/css; `-bak.html written` / `-bak.css written` when a sidecar was rotated; for `fail` the reason).
- Newest entries at the top. No truncation, no rotation.

Written by `lib/sync/stream.ts` on observing `SYNC_DONE`.

---

## 9. Test harness — `scripts/site-sync-harness.mjs`

Same shape as `scripts/director-harness.mjs`. Boots real servers in-process (no Docker), tests against them with the real client code, prints `N/N green`, exits 0/1, CI-friendly.

Boots:
- `ftp-srv` plain FTP on a random port
- `ftp-srv` with self-signed TLS for explicit FTPS

Asserts:
1. FTPS `connect` succeeds (AUTH TLS + PROT P), works with self-signed cert (because `rejectUnauthorized: false` is the documented behavior). Returned `method` is `ftp`, `secure` is `ftps`.
2. Plain FTP `connect` succeeds when FTPS is unavailable. Returned `secure` is `plain`.
3. Bad password → clean auth error.
4. `list` (FTPS MLSD) returns sizes; picker traversal works within the docroot; `..` outside the docroot is rejected.
5. `compare`: seed local+remote dirs → assert classifications (`new` / `changed` / `unchanged`), correct sort order (changed-essential first, etc.), and that `essential && (new||changed)` files are pre-checked but non-essential ones are not.
6. `ignore` actually excludes — including the hard-excludes (`logs/`, `screenshots/`, `_session-config.json`) which hold even if the user removes them from `site.ignore`.
7. `sync` up and down: bytes land, size matches after, chmod-000 remote file → per-file failure reported (not whole-batch abort).
8. Backup-on-overwrite (one-sidecar rule): overwriting `index.html` creates `index-bak.html`; overwriting it again deletes the old `index-bak.html` and creates a fresh one (still exactly one). Overwriting `app.js` creates no `app-bak.js`. Overwriting a new file (no prior version) creates no `-bak`. Works on both upload and download paths.
9. Sync-log: after a successful `sync` run, `public/<session>/logs/sync-log.md` exists, the new entry is at the TOP, the header line includes timestamp + direction + method + user@host, the summary line has the right counts and total bytes, each bullet has the correct status + note. Run a second sync and assert the new entry is prepended above the first.
10. Stale + reconnect: after `connect`, mutate a field → assert UI receives "stale" state; call `connect` again → assert it succeeds with the new settings.
11. Mode switch tears down: connect via FTP, switch `method` to `file` → assert prior connection is closed.

`LocalTransport` unit tests with `node:test`: temp dirs via `fs.mkdtemp`, same compare/transfer assertions.

Compare unit tests: table-driven, two manifests → expected diff + sort order. No FTP needed.

Run: `node scripts/site-sync-harness.mjs` → prints `N/N green`.

---

## 10. Locked decisions

1. **Source of truth:** `webserver-sync-prototype.html` is canonical; this spec defers to it on UI and state behavior.
2. **`_session-config.json`** is the canonical config + credential store. Plaintext password lives in it. No Keychain, no env, no vault. Per-session, never aggregated.
3. **Transports = FTPS (green) + FTP (yellow) + File (teal).** SFTP/SSH not on the menu — security/blast-radius decision, not a tooling preference (see §1).
4. **No security UX gates.** Cert mismatch → snackbar + connect. Plain FTP → yellow chip, no warning. `rejectUnauthorized: false` is the documented default. The chip color is the disclosure.
5. **Sync, not mirror.** No destructive "delete extras on destination" mode.
6. **Explicitly NOT implemented — do not add in a future session:**
   - **No symlink rejection.** The walker uses normal `stat` semantics and follows symlinks like any file system traversal. Don't add `lstat`-and-skip logic. Don't add "skipped symlink" log lines.
   - **No upload extension allowlist with confirm dialogs.** There is no `site.allowUpload` field. No file gets a red icon or a "this can execute on the server, continue?" modal. The essential-extensions list in §6 is **only** a UI auto-select hint; it is NOT an upload gate. `.php`, `.htaccess`, `.cgi` etc. upload identically to `.html` — visible in the diff, tickable, syncable.
   - **No chmod / execute-bit handling.** Don't `SITE CHMOD` after upload. Don't cap modes at 0644. The FTP daemon and the user's umask decide file modes; the sync layer doesn't touch them.
   - **No dry-run, no probe endpoint, no Keychain, no rate-limit guard, no WordPress DB handling, no cert-fingerprint persistence.** All previously flagged as overengineering, all dropped.
7. **`host` example is `premium707.web-hosting.com`**, not `ftp.<domain>`. **`user` example is `<name>@<addon-domain>`** (e.g. `marin@barbazza.wine`) — cPanel's canonical display form. The host value is non-negotiable (cert mismatch otherwise); the user form was earlier mis-recorded as `<name>@<MAIN-cPanel-domain>` and has been corrected.
8. **Streaming progress format reuses `lib/sync/stream.ts`** from the existing CRM/codebase sync. One emitter, two consumers.
9. **Phase A = no live-site writes.** Harness writes against its own in-process servers — testing, not Potemkin.
10. **One-sidecar backup, html/css only.** Before overwrite: delete any existing `<base>-bak.<ext>`, rename current → `-bak`, write new. Exactly one backup per file. Both sync directions. No timestamps, no retention chain.
11. **Hard-excluded paths.** `logs/`, `screenshots/`, and `_session-config.json` are excluded from the picker, the diff, and the sync — in both directions. Enforced in the walker, not just `site.ignore`.
12. **Sync log = `logs/sync-log.md`**, newest-on-top, written by `lib/sync/stream.ts` on `SYNC_DONE`. Markdown for human-readability. No truncation. Lives under the hard-excluded `logs/`.
13. **Essential = hardcoded extension list in `lib/site/essential.ts`.** Non-essential = everything else. Both upload — non-essential just doesn't pre-check. No config override.
14. **UI placement:** Sync is the 4th tab of the session panel (Assets · CRM · Meta · Sync), sibling to Meta, NOT nested. Container-query responsive (Brief ~420px, Studio ~220px).
15. **Power dot** is the ONLY connect/disconnect control. Card body click toggles the form. Field edit while connected → stale bar. Mode switch while connected → auto-disconnect.
16. **Password reveal.** The password field has an eye toggle (masked ↔ plaintext, default masked). Since credentials are plaintext on disk (§2/§3), revealing discloses nothing new — it removes guess-the-dots friction when typing or verifying a credential.

---

## 11. Open for review

- **The 4-tab session panel** (Assets · CRM · Meta · Sync) — does this panel already exist somewhere I should mount into, or is it new scaffolding? If new, scope of *that* panel is out of this spec and gets its own minimal stub for the other three tabs (the prototype already shows stub content for them).
- **`secureOptions.servername`** for FTPS — set to `host` (matches the cert SAN check). Acceptable that we then turn off `rejectUnauthorized` because shared-host certs always mismatch? (Spec says yes, prototype agrees.)
