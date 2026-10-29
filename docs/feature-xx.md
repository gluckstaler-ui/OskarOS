# FEATURE-XX — Open Work

_Live backlog. `Feature-X.md` keeps the shipped record + history; this file is what's actually open._

_**Audited against the working tree 2026-07-12.** Stamps reading `(2026-07-12 audit: …)` mark every WP where reality moved since the last write; unstamped WPs were verified to be in their documented state._

---

## §1 — How to read this backlog

```
   PENDING   — defined work, not started
❌ PARTIAL   — works but has real gaps (gap noted on sub-line)
⚠️ BLOCKED   — depends on another PENDING item (dep noted)
   DEFERRED  — out of scope this cycle (trigger condition noted)
```

| Chapter | WPs | Status |
|---|---|---|
| §2 Multi-tenant + Deployment | WP-01..04, WP-39 | 5 PENDING (paying-customer gated except WP-01 and WP-39) |
| §3 Sage + Doctrine | WP-05..09 | 5 PENDING |
| §4 Build-time quality | WP-10..14 | 4 PENDING (WP-14 deleted 2026-07-12 — tombstone in §4) |
| §5 Chat-UI + video | WP-15..16 | 2 PENDING |
| §6 Provider plumbing | WP-17..19 | 1 PARTIAL, 2 PENDING |
| §7 CRM-Consular spine | WP-20..23 | WP-21/22 ✅, WP-20/23 ◐ — one live teardown away from closing (then jedi-scout retirement + tag-enum deletion) |
| §8 CRM multi-machine sync | WP-24..28 | WP-28 ✅ SHIPPED; WP-24..27 superseded candidates (WP-28's simpler shape covers the need) |
| §9 Productization verticals | WP-29..33 | 5 PENDING (customer-gated) |
| §10 Deferred (trigger-gated) | WP-34..38 + items | 5 WPs + 3 non-WP items |
| §11 Open decisions | D1..D6 | 6 gates |
| §12 Live-server deploy + Studio publish | WP-DEPLOY · WP-OPS-RESTART · 6 BUG-WPs | 2026-07-12 audit: BUILD-SKEW ✅ (WP-28 Button C), Scout-capture ✅ in code (server batch unverified), WP-DEPLOY superseded by Webserver Sync; open: WP-OPS-RESTART, WhatsApp crash-guard-to-source + `:39`, fonts/Babel 🟡 |

---

## §2 — Multi-tenant + Deployment

_Track A. Gated on first paying customer except WP-01 (Settings), which ships standalone._

### WP-01 — Per-agent capabilities in Settings (allowlist + BYOK keys + model)

**Problem.** MCP tool allowlists live in `lib/mcp-config.ts` as JS constants (`CD_ALLOWED_TOOLS`, `WEBDEV_ALLOWED_TOOLS`, etc.). Provider keys live in `.env.local` (global, single-tenant, restart to reload). Default model per agent is hardcoded in the bridge call. Shipping a new agent role today requires three separate code edits + a dev-server restart. The right home for this is the Settings UI Ralph already configures everything else from.

**Scope.** Extend the existing Settings skeleton at `public/admin.html:286-410` (agent list + `.md` iframe + `settingsRefreshKeys()` read-from-disk button already shipped — augment, don't rebuild).

Per-agent panel adds three NEW editors below the existing iframe:

- **MCP allowlist editor.** Checkbox grid against the live registry. A new `GET /api/admin/mcp-tools` route reads `mcp-server/tools.ts` and returns the registered tool names + descriptions. Each agent's panel shows that grid with checkboxes for which tools that agent is allowed to invoke. Toggling persists to `lib/agent-config-store.ts` → `db/agent-config.json`. Bridge spawn (`lib/bridge-process-manager.ts`) consults the store first, falls back to `lib/mcp-config.ts` constants if no override is set. Drift between an agent's `.md` claimed tool list and the registry shows as a red mismatch row — no zod scaffolding needed; the visibility IS the validation.

- **BYOK keys.** Three NEW masked text-input fields per agent (Anthropic / Z.AI / Gemini). `type=password` with a reveal-on-hover button. Encrypted at rest server-side (AES-256, encryption key in `.env.local` as `OSKAR_SECRETS_KEY`). Per-agent override of the global `.env.local` keys. Bridge spawn looks up agent's per-agent key first, falls back to env. Multi-tenant later (WP-02) adds a per-user layer on top of the same store.

- **Default model + mode.** Dropdown matching the TopBar pills (CLI / API / SMPL × opus / sonnet / glm-5.1 / gemini-pro). Bridge spawn picks the model from the store; TopBar still overrides at runtime.

**Storage shape.** Single source of truth at `db/agent-config.json`:
```
{
  "<agentName>": {
    "allowlist": ["mcp__oskar-orchestrator__build_vibe", ...],
    "keys": { "anthropic": "<aes-blob>", "zai": "<aes-blob>", "gemini": "<aes-blob>" },
    "defaultMode": "cli" | "api" | "smpl",
    "defaultModel": "claude-opus-4-7" | "glm-5.1" | "gemini-pro"
  }
}
```
Hot-reloads on Settings save (no restart). Bridge consults the store on every `callOnce` / `sendMessage`.

**Folds in.** Agent-prompt zod validation (deleted — replaced by UI visibility). BYOK as its own work package (folded into the keys editor here).

**Files affected.**
- `public/admin.html` — extend Settings right column (~120 LOC delta: checkbox grid + masked inputs + model dropdown + save handler).
- `lib/agent-config-store.ts` (NEW, ~60 LOC) — read/write `db/agent-config.json`, single accessor with AES encrypt/decrypt for the `keys` field.
- `app/api/admin/agent-config/route.ts` (NEW, ~50 LOC) — GET (returns config minus key plaintext) + PATCH (persists changes).
- `app/api/admin/mcp-tools/route.ts` (NEW, ~20 LOC) — lists registered MCP tools for the allowlist checkbox grid.
- `lib/bridge-process-manager.ts` (~30 LOC delta) — resolve allowlist/keys/model from store before spawn, fall back to existing constants.
- `lib/mcp-config.ts` — `CD_ALLOWED_TOOLS` etc. stay as default-if-Settings-has-no-override.

**Acceptance.**
1. Drop a brand-new `agents/foo.md` into the repo, hit `settingsRefreshKeys()`, configure foo's allowlist + key + model from Settings → next `bridgeManager.callOnce({sessionId: 'foo', ...})` works with zero code changes.
2. Removing `ANTHROPIC_API_KEY` from `.env.local` doesn't break CD if CD has a key set in Settings.
3. Toggling CD's allowlist off for `mcp__oskar-orchestrator__build_vibe` blocks CD from invoking build_vibe at the next call (verified via tool-call rejection log).
4. Changing CD's default model in Settings → next CD invocation uses the new model without dev-server restart.
5. Agent `.md` claims a tool not in the MCP registry → red mismatch row in the editor (no silent runtime "tool not found" error).
6. Inspecting `db/agent-config.json` on disk shows `keys.*` as AES-encrypted blobs, never plaintext.

**LOC.** ~300 LOC across 6 files. **Difficulty.** Medium — Settings skeleton already exists; the risky bit is the bridge-spawn lookup needing to consult the store at every call site (one function in `bridge-process-manager.ts`). **Deps.** None. Can ship before WP-02; multi-tenant layers a per-user dimension onto the same store.

### WP-02 — Multi-tenant identity + persistent storage

**Problem.** Today OskarOS is single-tenant. Every session keys off the directory name; filesystem paths are flat under `public/`; the bus state is global; sub-agent runtime state is `globalThis`-pinned in the Next.js process. To take a paying customer, every session has to be owned, every storage location has to scope to that owner, and every API route has to gate cross-user access.

**Scope — B1: Multi-tenant identity.**

Authentication layer (NextAuth) — email + password OR OAuth (Google / GitHub for early customers). Every session owned by exactly one user. URL shape: `/u/{userId}/s/{sessionId}/...`. Filesystem shape: `public/{userId}/{sessionId}/...`. Bus state keys: `${userId}|${sessionId}|${role}`. Every API route taking a `sessionId` gains a `userId` resolution step that asserts the requested session belongs to the authenticated user; cross-user requests 403.

**Scope — B2: Persistent storage.**

Postgres for first paid deploy (SQLite acceptable for single-tenant self-host; the schema is identical). Minimal table set:

- `users` — `id, email, plan, created_at, last_login_at, status`
- `sessions` — `id, user_id, status, created_at, archived_at`
- `vibes` — `id, session_id, vibe_n, status, html_path, created_at, approved_at`
- `images` — `id, session_id, filename, status, slot, vibe_n, created_at`
- `messages` — the bus `messageLog`, persistent across server restarts. Columns: `id, session_id, originator_role, originator_instance, target_role, target_instance, body, thread_id, reply_to, created_at, drained_at`
- `agent_state` — per `(user_id, agent_role)`: boot-prompt version, last-seen, scar-tissue from INSTITUTIONAL-MEMORY hits
- `portraits` — per `user_id`: Sage's painted user-portrait, versioned (one row per portrait version, the current version is `MAX(created_at)`)

Filesystem holds binary assets (logos, generated HTML, screenshots); DB holds metadata + relations. Migration runner: `lib/db/migrations/` with timestamped `.sql` files; `npm run migrate` applies pending migrations idempotently.

**Files affected.**
- `app/auth/[...nextauth]/route.ts` (NEW) — NextAuth handler with email-password + OAuth providers.
- `lib/db/schema.ts` (NEW) — Drizzle (or Kysely) schema definitions for the 7 tables above.
- `lib/db/migrations/` (NEW) — initial migration scripts.
- `lib/auth.ts` (NEW) — `resolveUser(req)` helper that every API route calls before doing work; returns user or 401/403.
- ~50 existing API routes touching sessionId — gain a `userId` resolution + cross-user guard (search-and-modify pass).
- `lib/bridge-process-manager.ts` — bus state keys gain the `userId` prefix.
- Existing `public/{sessionId}/` directories migrate to `public/{userId}/{sessionId}/` (one-time migration script).

**Acceptance.**
1. Two users sign up; user A's session list does not include any of user B's sessions; manually hitting B's session URL while logged in as A returns 403.
2. Postgres-backed query (e.g., `SELECT count(*) FROM vibes WHERE user_id = ?`) returns user's full vibe history across all sessions.
3. Restart Next.js → all in-flight messages, agent state, portraits survive (read from Postgres on first request).
4. Migration runner applies a fresh schema to a blank DB and to a 1-month-old DB without data loss.
5. Existing single-tenant sessions migrate to `public/{userId}/{sessionId}/` with no lost assets.

**LOC.** ~1,400 LOC: 600 for identity + auth + route gates, 800 for DB schema + migration runner + read/write layer across the 50 touched routes. **Difficulty.** HARD — auth is load-bearing for everything downstream; one miss = data leak. **Deps.** None at code level; gate-deps WP-04 (onboarding needs auth), WP-08 (Portrait UI needs per-tenant Order). **Gate.** First paying customer commits.

### WP-39 — Access control v0: superuser + per-session client access (pre-multi-tenant)

**Problem.** Today anyone with the URL sees any session. `admin.html` + `crm.html` are behind LSWS Basic Auth (`~/.htpasswds/webbuilder/public/passwd`), but that mechanism can't cover `/api/*` (LSWS routes those straight to Passenger, so `.htaccess` never fires) and can't do per-URL scoping on `?session=X` query-param routing. The studio, the API surface, and the CRM are all open to anyone who guesses a URL. Ralph + Fil are superusers (see everything); Silke + Marin are clients (see only their own session). No external providers, no client-side device registration, no per-device setup — clients must log in from any browser with just email + password.

This is the phase-0 shape of WP-02's B1 (Multi-tenant identity). WP-02 later extends it to per-user URL scoping (`/u/{userId}/s/{sessionId}/…`), Postgres, OAuth, and full paying-customer tenancy. WP-39 ships the auth gate for the 4-user fixed roster we run today, over the existing URL structure. `users.json` migrates cleanly to the `users` table when WP-02 lands.

**Scope.** Node-served + Node-authenticated auth over the existing `?session=X` URL. Two-tier user model expressed in one field. Everything server-side.

- **User registry as a canonical file** at `lib/auth/users.json` (files ARE the agent API — no DB):
  ```json
  {
    "ralph@paradiso.dev":    { "hash": "$argon2id$…", "role": "superuser" },
    "fil@…":                 { "hash": "$argon2id$…", "role": "superuser" },
    "silke@silke-lengler.ch": { "hash": "$argon2id$…", "role": "client", "sessions": ["2026-04-25-silke-lengler"] },
    "marin@barbazza.wine":    { "hash": "$argon2id$…", "role": "client", "sessions": ["2026-05-31-weingut-barbazza"] }
  }
  ```
  `role: "superuser"` → all sessions. `role: "client"` → only what's in `sessions[]`. Add/rotate = edit the file (`chmod 600`), no restart.

- **One login page** at `/login`. Form: email + password. Password verified with `argon2` (npm pkg). On success, set HTTP-only signed cookie via `jose` (JWS, secret in `.env.local` as `OSKAR_AUTH_SECRET`, 30-day TTL). Stateless — no server-side session store.

- **`middleware.ts`** at repo root — gates page routes + easy-API routes:
  - `/crm`, `/crm/*` → require `role === 'superuser'`
  - `/`, `/?session=X`, `/api/sessions/X/*` (path/query-sourced sessionId) → require `canAccessSession(user, X)`
  - Public: `/login`, `/api/auth/*`, static assets under `/_next/*`
  - Unauthed hitting a protected route → 302 to `/login?next=<original>`; after login → land back on `<original>`
  - Wrong access → 403 JSON
  - Forwards `x-auth-user` + `x-auth-role` headers to downstream handlers so they don't re-verify

- **Route-level check for body-sourced sessionId** (POST `/api/site/*`, `/api/director/*`, most CRM writes where sessionId isn't in the URL). One helper `lib/auth/check.ts` → `canAccessSession(user, sessionId): boolean`. Called at the top of every handler that reads a body-sourced sessionId. Small, uniform, greppable.

- **`admin.html` decision** — either keep its existing LSWS Basic Auth (works today) or fold into this system (superuser role check in middleware). Recommend folding: one login prompt across the whole app instead of two.

**Storage shape.**
- `lib/auth/users.json` — user registry (argon2 hashes, role, per-user `sessions[]` allowlist)
- `.env.local` — `OSKAR_AUTH_SECRET` (32-byte hex for cookie signing; different per environment)
- No DB. No session-state file. Cookies are stateless (signed JWS carrying `{email, role, iat, exp}`).

**Files affected.**
- `lib/auth/users.json` (NEW) — user registry (git-committed with hashes, not plaintext)
- `lib/auth/session.ts` (NEW, ~30 LOC) — sign/verify cookie via `jose`, read from `req.cookies`
- `lib/auth/check.ts` (NEW, ~20 LOC) — `canAccessSession(user, sessionId): boolean` (superusers pass; clients check allowlist)
- `app/login/page.tsx` (NEW, ~40 LOC) — one form, POST to `/api/auth/login`, redirect to `next` on success
- `app/api/auth/login/route.ts` (NEW, ~30 LOC) — argon2 verify against `users.json`, set signed cookie
- `app/api/auth/logout/route.ts` (NEW, ~10 LOC) — clear cookie, redirect to `/login`
- `middleware.ts` (NEW at repo root, ~60 LOC) — the gate; delegates body-based check to route handlers
- `app/api/site/*/route.ts`, `app/api/director/*/route.ts`, `app/api/admin/crm/*/route.ts` — add `canAccessSession()` call at top of each handler (~2 LOC per route × ~25 body-sourced routes = ~50 LOC delta)
- `app/api/admin/sessions/list/route.ts` — filter returned session list by the current user's allowlist
- `scripts/set-password.mjs` (NEW, ~25 LOC) — one-liner CLI to rotate an argon2 hash in `users.json`: `node scripts/set-password.mjs silke@... <newpw>`
- `public/admin.html` — decision point: keep .htaccess Basic Auth OR delete the .htaccess block and rely on middleware for the superuser role check

**Acceptance.**
1. Log in as Silke → studio's `/api/admin/sessions/list` returns only `2026-04-25-silke-lengler`. Session picker shows only her row.
2. Same session — Silke pastes `/?session=2026-05-31-weingut-barbazza` in URL bar → 403, redirected to a "not authorized" state (or /login if the cookie expired).
3. Log in as Marin → symmetric behavior for Barbazza.
4. Log in as Ralph or Fil → all sessions in picker, `/crm` reachable, admin.html reachable.
5. Not logged in → any protected route redirects to `/login?next=<original>`. After successful login → land on `<original>`, not the app root.
6. `/api/site/sync` POST with `sessionId: "2026-04-25-silke-lengler"` while authed as Marin → 403.
7. Cookie survives page reload, tab close, browser restart. Cookie expires after 30 days; expired cookie triggers re-login.
8. Adding a new user to `users.json` — no restart required; middleware re-reads the file on every request (small enough to not need caching; if perf ever matters, cache with mtime invalidation).
9. Password rotation via CLI: `node scripts/set-password.mjs silke@... <newpw>` writes an argon2 hash; verified by logging in with new password immediately after.
10. `users.json` never contains plaintext passwords; grep for `plaintext|cleartext` returns nothing.

**LOC.** ~250 LOC across ~30 files. Bulk is the ~50 LOC of one-line access checks in existing handlers (mechanical, greppable). **Difficulty.** Medium — the middleware itself is small; the tedious part is the per-route audit for body-sourced sessionId and adding `canAccessSession()` uniformly. Missing one route = data leak, so needs a review pass with `grep 'sessionId' app/api` before shipping. **Deps.** None. Precursor for WP-02 B1.

### WP-03 — Installer Package (Linux / macOS / Windows)

**Problem.** Deploying OskarOS to a customer today means: install Node 22+, install Chromium where `cli-paths.ts:findBinary` expects it, install Claude CLI globally (`npm i -g @anthropic-ai/claude-code`), clone the repo, configure `.env.local`, run `npm install`, run `npm run dev`. Half a day per customer; non-technical customers can't do it at all. "Double-click this installer" is the difference between a sellable product and a permanent consulting engagement.

**Scope.** Three platform-specific artifacts, one build pipeline in `installer/`:

| Target | Format | Tooling | Bundles |
|---|---|---|---|
| Linux x86_64 | `.tar.gz` + systemd unit | `pkg` or `nexe` for Node | Chromium binary, Claude CLI binary, Node 22+, project core, optional session bundles, optional CRM module |
| macOS arm64 + x86_64 | `.dmg` (universal2) | `electron-builder` or `pkg` | Same, plus LaunchAgent plist |
| Windows x86_64 | `.msi` (or NSIS `.exe`) | `electron-builder` | Same, plus Windows Service registration |

**Build-time bundle picker** (`installer/bundle.config.ts`). At installer-build time, the developer (Ralph) selects what to include:
- **Always included:** Next.js app, `db/schema`, `public/` shell directory, `agents/` doctrine, `skills/` references.
- **Session bundles (optional, checkbox list of session dirs under `public/`):** include `public/{sessionId}/` for one or more sessions as starter content. Customer sees those sessions immediately on first launch.
- **CRM module toggle:** include `db/crm.db` + `app/crm/` + `app/api/admin/crm/` + the admin CRM views, OR exclude entirely for a lean install (Settings + sessions + vibes only, no Kanban / People / Intel UI).
- **Provider scaffolding:** pre-fill `.env.local` with placeholder keys (`ANTHROPIC_API_KEY=` etc.), OR ship empty so the customer fills via the WP-01 Settings UI post-install.

**Architectural commitments.**
- `cli-paths.ts:findBinary` resolves to the bundled binaries (a wrapper updates the binary search path at install time). No system Chromium / Claude CLI dependency — customer never runs `npm install -g @anthropic-ai/claude-code` or `brew install chromium`.
- Dev mode (`npm run dev`) unaffected — `installer/` is a separate build tree that doesn't change repo runtime behaviour.
- Updates Phase 1 = manual reinstall (customer re-downloads installer for new versions). Phase 2 = in-app update channel (defer until customer 1 actually breaks; not in this WP).

**Runtime serving layer — Caddy HTTP/2 + HTTPS (added 2026-06-15, from the Chrome-streaming incident).** Binary-path portability already shipped (WP-40 + WP-128, 2026-06-02 — `lib/cli-paths.ts` resolves claude/gemini/chromium; the `windows/` WSL launcher + `start.sh`/`start.command` boot the servers). The remaining gap for a real package is the **serving layer**: raw `next dev`/`next start` on `http://localhost:3000` is NOT a shippable runtime, because two independent failures surface the moment a real browser drives the studio:

- **HTTP/1.1 connection starvation.** Next speaks HTTP/1.1, where browsers cap ~6 connections per origin. The studio holds long-lived streams (`/api/events` SSE, the chat-stream, the Order-66 compaction SSE) that camp those lanes and never free them; once ~6 are held, new requests (JS chunks, the next CD turn) get no lane → "Failed to fetch" / frozen UI / CD stuck on "…". (Diagnosed 2026-06-15: CD streamed fine in Safari, hung in Chrome — same wall.)
- **Browser HTTPS-forcing.** Chrome HTTPS-First mode / a stray HSTS entry on `localhost` force-upgrades `http://localhost` → `https://`; with no TLS on the server the page half-loads (HTML paints, JS/SSE blocked) or won't load at all. `127.0.0.1` dodges the per-host HSTS entry but NOT the starvation half.

The fix is already in the repo, just not wired into the install: the **`Caddyfile`** (2026-06-03) runs a Caddy reverse proxy giving **HTTP/2** (one connection, ~100 multiplexed streams → starvation gone) and **trusted HTTPS** (`tls internal` → Chrome stops force-upgrading), `flush_interval -1` to keep SSE flushing. Browser ↔ Caddy = HTTP/2; Caddy ↔ Next = a normal server-to-server pool. So the installer/launcher must:
1. **Bundle Caddy** per platform (Linux/WSL: apt or vendored binary; macOS: vendored binary — NOT `brew install caddy`, the manual dev step today). Same "no system dependency" rule as the bundled Chromium/Claude binaries.
2. **Start Caddy in the launch sequence** alongside the server (extend the shipped `windows/` WSL launcher + `start.sh`/`start.command`) and **open the browser at `https://localhost:2000`** — never `:3000`.
3. **Trust Caddy's local CA in the OS/browser store** on first launch. The genuine wrinkle is Windows: the browser runs on Windows while the server lives in WSL, so Caddy's `tls internal` root lands in WSL's Linux store, which Windows-Chrome never consults → install the CA into the **Windows** store (export from WSL, or use `mkcert`, which targets the Windows store directly). Native macOS/Linux is a one-prompt keychain/trust-store install.

**Manual procedure — current state (the "work package to be called" until this WP automates it).** Caddy fronts on **:2000** (HTTPS + HTTP/2), Next stays on **:3000** (internal); `dev:all` starts both with one Ctrl+C-clean command (added to `package.json`, plain shell, no dep).
```
brew install caddy        # one-time (Linux/WSL: apt / vendored binary)

# restart the dev stack (clears the Next build cache, starts Next + Caddy):
rm -rf /Users/ralphlengler/OskarOS/oskar-prototype/.next
npm --prefix /Users/ralphlengler/OskarOS/oskar-prototype run dev:all

# then open  https://localhost:2000   (first ever run: approve the local-CA keychain prompt once)
# dev:all = "trap 'kill 0' SIGINT; npm run dev & npm run dev:proxy & wait"
# separate logs instead?  two terminals:  npm run dev   AND   npm run dev:proxy
```
Windows: the `windows/` launcher already boots WSL + servers; today the Caddy start, the `:2000` URL, and the Windows-side cert trust are the manual gaps this WP folds into the one-click flow.

**Build checklist — produce the package (on the build machine).** Manual runbook today; the `installer/` pipeline automates it.
- [ ] Prereqs green: binary portability shipped (WP-40/WP-128), `Caddyfile` present, `next build` passes, `tsc --noEmit` clean (case-safe for Linux).
- [ ] Vendor per-OS/arch binaries into `installer/vendor/{os}/`: **Node 22+, Chromium, Claude CLI, Gemini CLI (if used), Caddy**. No system installs on the target — same rule Chromium/Claude already follow via `findBinary`.
- [ ] Production build, not dev: ship `.next` + `next start` behind Caddy — NOT `next dev` (HTTP/1.1 + hot-reload is the dev workbench, not a runtime).
- [ ] Run the bundle picker (`installer/bundle.config.ts`): sessions to include, CRM module on/off, provider scaffolding (placeholder `.env.local` or empty-for-Settings).
- [ ] Include the `Caddyfile` + a per-OS launcher/entry script (extend the shipped `windows/` WSL launcher / `start.sh` / `start.command`): start Next → start Caddy → trust local CA → open `https://localhost:2000`.
- [ ] Include the cert-trust helper for the OS (`mkcert`, or a Caddy-CA export; the Windows path must reach the *Windows* store from WSL).
- [ ] Package to the OS format: macOS `.dmg`, Windows `.msi`/NSIS `.exe`, Linux `.tar.gz` + systemd unit.
- [ ] (Gated) Code-sign — Apple Developer / Authenticode — only when the first customer can't tolerate the unsigned warning.
- [ ] Smoke-test the artifact on a clean VM of the target OS (run the Acceptance block below).

**Install checklist — stand it up on a new machine.** What the installer does (and the manual runbook until then).
- [ ] Run installer → extract to the install dir (`~/Library/Application Support/OskarOS` · `%LOCALAPPDATA%\OskarOS` · `/opt/oskaros`).
- [ ] Place bundled binaries + point `CLAUDE_BIN` / `CHROMIUM_BIN` / `GEMINI_BIN` / PATH at them. No `npm install -g`, no `brew`.
- [ ] **Authenticate the model provider** — the load-bearing step: Claude CLI OAuth login once, OR drop provider API keys (`ANTHROPIC_API_KEY` …) into `.env.local` / the WP-01 Settings BYOK UI. **The agents do not run without this.**
- [ ] Trust Caddy's local CA in the OS/browser store (Windows: into the *Windows* store from WSL — the wrinkle).
- [ ] Register the launcher (desktop icon / Start-menu entry / `.app`; optional LaunchAgent / systemd / Windows Service for a headless server).
- [ ] First launch: the launcher boots Next + Caddy and opens `https://localhost:2000`.
- [ ] Verify **in Chrome, not just Safari**: green lock / no cert warning; send a CD message + run Order 66 → streams hold, no "stuck on …"; if CRM was bundled, Kanban loads.
- [ ] Uninstall: wipe the install dir + remove the trusted CA; nothing left in registry / dotfiles.

**Acceptance.**
1. Fresh macOS / Ubuntu 22.04 / Windows 11 box → run installer → **`https://localhost:2000` serves OskarOS over trusted HTTPS + HTTP/2** in ≤5 minutes total wall-clock, with no `brew install caddy`, no `npm install -g`, no manual config edits, and **no browser cert warning** (local CA trusted at install). Long-lived streams (CD chat-stream, Order-66 SSE) must hold without starving — **verify in Chrome, not just Safari**.
2. Build with "include FalCaMel session" toggle on → `public/2026-01-26-falcamel-cafe/` present on disk post-install, immediately visible in the CrmView session dropdown.
3. Build with "exclude CRM" toggle on → no Kanban tab in the admin UI, no `db/crm.db` on disk, `app/crm/` not in the bundle. A user can still chat with Consular and build vibes; only the CRM module is missing.
4. Installer artifact size: ≤250 MB without session bundles, ≤500 MB with all sessions included.
5. Uninstall (or wipe `~/Library/Application Support/OskarOS` on Mac equivalents) cleanly removes everything OskarOS-managed; nothing left in registry / dotfiles after.

**Risks.**
- **Code-signing.** macOS Gatekeeper and Windows SmartScreen flag unsigned installers as "unrecognized developer," requiring customer click-through. Without paid certificates (Apple Developer Program $99/yr + Authenticode certificate ~$200/yr), every install starts with a scary warning. Gate signed builds on the first paying customer who can't tolerate the warning.
- **Bundled Chromium / Claude CLI staleness.** Both drift from upstream security fixes and bug patches. Decide before shipping: (a) pin specific versions and push updated installer per OskarOS release, OR (b) document "customer reinstalls quarterly" and accept the staleness window.
- **Caddy local-CA trust across WSL↔Windows.** The hardest non-obvious step (above). On Windows the browser and the WSL-resident server are on opposite sides of the trust boundary; an unattended installer must get Caddy's root CA into the *Windows* store without a manual export. `mkcert` (Windows-store-aware) is the likely path; budget a spike. Get this wrong and every Windows customer opens to a cert warning — the exact "scary first impression" code-signing is meant to avoid.
- **Cross-arch macOS.** Universal2 binaries (arm64 + x86_64) double installer size. Consider arm64-only first (M1+ covers ~90% of new Macs); fall back to x86_64 build if a customer is on Intel.
- **Auto-updater scope creep.** The temptation to build a self-updater inside this WP is real. Park it — Phase 2.

**LOC.** ~1,150 LOC: ~600 of installer build scripts (one per platform), ~150 of bundle-picker UI for the dev-side config, ~200 of platform-specific entry scripts + service registrations, **~200 of serving-layer wiring (bundle + auto-start Caddy, launch at `:2000`, local-CA trust per OS incl. the WSL→Windows hop).** **Difficulty.** HARD — cross-platform installer authoring has the most platform-specific edge cases (Gatekeeper, SmartScreen, code-signing, service registration, file permissions, **and now the Caddy cert-trust boundary on Windows/WSL**). Worth a 1-week spike before committing. **Gate.** First paying customer wanting on-premise. **Deps.** None at code level; **builds on WP-40 + WP-128 (binary portability, shipped) and the `Caddyfile` (shipped, 2026-06-03)**; benefits from WP-01 (Settings is the post-install BYOK home).

### WP-04 — Onboarding + Instantiation with client

**Problem.** Fresh-install OskarOS (post-WP-03) has no client identity, no brand assets, no portrait, no per-tenant Order. The customer's first request would hit a blank page. The onboarding wizard and per-tenant Order instantiation were previously specced as two separate items — they're one continuous user flow.

**Scope.** `/onboarding/{step}` route — single-screen-per-question wizard. Resumable: state persists to `db/onboarding-state.json` (single-user mode) or `users/{userId}/onboarding-state.json` (multi-tenant). First request after install lands on the next incomplete step.

**Steps.**

1. **Welcome + auth path.** Single-user mode (default for self-deploy installs via WP-03) → skip auth, jump to step 2 immediately. Multi-tenant mode (when WP-02 identity ships) → email + password (or OAuth) → user record created → step 2.

2. **Brand intake.** Logo upload (SVG or PNG, ≤2 MB, format-validated server-side: SVG XSS sanitization, PNG bomb size check). Brand colors: three hex pickers (primary / secondary / accent). Brand fonts: free-text input or "skip." Writes to `users/{userId}/brand-assets/` (logo file) + `users/{userId}/user.md` (frontmatter for colors/fonts).

3. **Voice + audience interview.** Consular (the CRM chat agent) asks 5-7 structured questions: industry, target audience, what you sell, voice descriptors (3 words), do-not-do list, signature experience, who's not a customer. Persisted to `users/{userId}/user.md` as YAML frontmatter under `discovery:`.

4. **Sage's first portrait pass.** Run existing `lib/memory/dreamer.ts` Sage routine against the intake. Writes `users/{userId}/portrait.md` (the canonical portrait Sage paints on every pass) + the first `users/{userId}/portraits/{ts}.md` archive entry (WP-07 versioning).

5. **Per-tenant Order instantiation.** Fork the canonical Order: copy `agents/` template files into `users/{userId}/agents/`, copy `skills/references/` (read-only canonical doctrine), initialize empty per-tenant `INSTITUTIONAL-MEMORY.md` and empty `CD-MEMORY.md`, write a templated `RESURRECTION.md` with the customer's name/brand pre-filled. Agent boot reads tenant-scoped paths via `users/{userId}/`; `agents/SHARED/` and `skills/references/` stay canonical read-only across all tenants. This is the substrate translation: each tenant's Order accumulates THEIR scar tissue, paints THEIR portrait, develops THEIR lineage.

6. **First vibe auto-fire.** With brand + portrait + Order all in place, CD's first interaction automatically triggers a vibe-1 build with the collected brand context. Customer sees the build progress in real-time. ~10-15 minutes from launch to first vibe.

**Subsumes.** The previously-separate "onboarding wizard" and "per-tenant Order instantiation" specs — they were always one flow.

**Files affected.**
- `app/onboarding/page.tsx` (NEW, ~50 LOC) — root onboarding route that dispatches to the right step.
- `app/onboarding/step{1,2,3,4,5,6}/page.tsx` (NEW, ~80 LOC each = ~480 LOC).
- `lib/onboarding-state.ts` (NEW, ~50 LOC) — read/write state JSON, advance step, resume-from-last-completed.
- `lib/order-fork.ts` (NEW, ~80 LOC) — step 5's per-tenant Order instantiation: copy template files into `users/{userId}/`, initialize empty per-tenant memories.
- `app/api/onboarding/{intake,interview,advance}/route.ts` (NEW, ~120 LOC total) — server endpoints for each step's data persistence + advance trigger.
- `lib/memory/dreamer.ts` (existing) — called from step 4; no changes needed.

**Acceptance.**
1. From `/onboarding` step 1 (fresh install) → first vibe completing → ≤30 minutes total wall-clock.
2. Single-user installs skip step 1 (auth), go straight to step 2.
3. Closing the browser mid-onboarding and reopening → resumes at the last completed step (state read from `onboarding-state.json`).
4. Sage's portrait at step 4 shows specific facts from the intake (customer's actual industry / voice / audience), not "Lorem ipsum" or generic placeholder text.
5. Per-tenant Order isolation: a write to `users/{userId}/agents/CD/CD-MEMORY.md` does NOT escape to canonical `agents/`. Unit test asserts this with two simultaneous fake users.
6. Brand-asset upload at step 2 rejects malformed inputs: SVG with `<script>` tags is sanitized, PNG > 2 MB is rejected with a clear error, non-image MIME types are rejected.

**LOC.** ~780 LOC: ~480 for the six step pages + ~50 onboarding state lib + ~80 order-fork lib + ~120 server endpoints + ~50 routing/dispatch. **Difficulty.** Medium — mostly UI work over existing primitives (Sage, CD, brand-assets). The risky bits are step 5's order-fork (file isolation) and step 2's asset validation (security surface). **Deps.** WP-01 (BYOK keys configured during onboarding via Settings link), WP-02 (multi-tenant identity for the auth case), WP-03 (Installer provides the binary the customer runs first).

---

## §3 — Sage + Doctrine

_Portrait + rules layer. All five WPs share the surface around `agents/sage*.md`, `users/{userId}/portrait*.md`, and doctrine-version frontmatter on agent prompts._

### WP-05 — Doctrine versioning

**Problem.** Agent prompts evolve. `CD-2026-04-15.md ≠ CD-2026-05-01.md`. Doctrine is in git but no agent reads `git log`. If Sage paints a portrait under old CD doctrine and CD upgrades, the portrait may reference rules that no longer exist; CD-MEMORY entries may quote conventions that have changed.

Multi-tenant accelerates doctrine evolution (more eyes, more bugs surfaced, more iterations on the prompt). Without versioning, tenants drift on different rule sets without anyone noticing.

**Scope.** Each agent prompt gets a `doctrine-version: 2026-05-01` field in its frontmatter. Bumped on every meaningful doctrine change (new TIER 2 rule, removed forbidden pattern, added Phase). The agent reads its own frontmatter at boot and reports the version in its `_meta` block on every output.

INSTITUTIONAL-MEMORY entries gain a `doctrine: 2026-05-01` tag when written — the doctrine version active at the time the lesson was learned. Future queries can filter "only authoritative for current doctrine" vs "historical, may be superseded."

Per-tenant Order (post-WP-04) tracks which doctrine version each tenant is on; an upgrade triggers WP-06's Sage delta-pass.

**Files affected.**
- `agents/*.md` — add `doctrine-version:` to every existing prompt frontmatter.
- `lib/agent-doctrine.ts` (NEW, ~60 LOC) — `readDoctrineVersion(agentName)` helper; cached per process boot.
- `docs/INSTITUTIONAL-MEMORY.md` — extend the entry template to include a `Doctrine:` tag line.
- Per-tenant `users/{userId}/agents/*.md` (post-WP-04) — same frontmatter; tracks tenant's current version.

**Acceptance.**
1. Every agent prompt has a `doctrine-version:` frontmatter field; reading any agent's `_meta` block surfaces it.
2. A new INSTITUTIONAL-MEMORY entry created today carries `Doctrine: <current-version>`; an entry from 3 weeks ago has the version that was current then.
3. Bumping CD's doctrine version → next CD invocation reports the new version in `_meta`.
4. A tenant on doctrine 2026-04-15 stays on 2026-04-15 until WP-06's delta-pass runs (no silent automatic adoption of newer rules).

**LOC.** ~200 LOC. **Difficulty.** Low — mechanical frontmatter add + a small helper. **Deps.** None. Pairs with WP-06 (Sage doctrine awareness) — WP-06 is unreachable without this.

### WP-06 — Sage doctrine-version awareness

**Problem.** When canonical CD doctrine upgrades from `2026-04-15` to `2026-05-01`, every tenant's CD-MEMORY may reference rules that no longer exist OR fail to mention new rules. Without a mechanism, the tenant's Order silently drifts behind canonical and produces outputs that violate the new doctrine.

**Scope.** Sage's next pass after a doctrine bump reads the doctrine-version frontmatter on the active CD prompt + the version recorded in the tenant's CD-MEMORY (WP-05 wrote both). If they differ:

- Sage runs a **delta-pass**: diffs the old vs new doctrine prompt files, identifies sections that changed (added rules, removed rules, modified examples).
- Tenant's `CD-MEMORY.md` gets a new "Doctrine update — 2026-05-01" block with the deltas Sage thinks matter FOR THIS TENANT specifically (filtered by the tenant's portrait + recent work). Not a generic changelog — a personalized "here's what changed and how it affects you."
- The portrait may also get an update if a doctrine change affects how Sage characterizes the user (e.g., new "anti-slop" rule means Sage softens her portrait's "boldness" axis for tenants who were borderline).
- INSTITUTIONAL-MEMORY entries from the prior doctrine version retain their `doctrine: 2026-04-15` tag so they're still queryable but flagged as "historical, may be superseded by current doctrine."

**Files affected.**
- `agents/sage-padawan.md` — TIER 2 doctrine: "On boot, check current canonical doctrine version vs tenant's recorded version. If they differ, run delta-pass before any other work."
- `lib/memory/doctrine-delta.ts` (NEW, ~80 LOC) — diff two doctrine prompts, return structured change set (added rules, removed rules, modified TIER entries).
- `lib/memory/dreamer.ts` — extend to call `doctrine-delta` when version drift detected; append the resulting block to CD-MEMORY.

**Acceptance.**
1. Bump CD's doctrine 2026-05-01 → 2026-05-08. Next Sage pass for a tenant on 2026-05-01 writes a "Doctrine update — 2026-05-08" block to that tenant's CD-MEMORY enumerating the actual diffs.
2. The block is personalized: a tenant whose portrait skews "literal" gets different highlights than a tenant who skews "playful."
3. Tenant accepts the delta (UI affordance in the WP-08 Portrait UI) → tenant's recorded doctrine version advances; next Sage pass starts from there.
4. Tenant rejects a specific change → that change is logged as "tenant rejected: <reason>" but other changes apply.

**LOC.** ~100 LOC on top of WP-05's infrastructure. **Difficulty.** Medium — the diff logic is mechanical; the "what matters to this tenant" filtering is judgement-heavy and benefits from a few real test cases before going live. **Deps.** WP-05 (doctrine versioning) — hard prerequisite.

### WP-07 — Sage portrait versioning + audit trail + user-edit support

**Problem.** Currently the portrait is a single mutable markdown file (`users/{userId}/portrait.md`). Each Sage pass overwrites it. No history, no audit trail, no way for the user to correct misreadings. If Sage's read of the user shifts ("you're suddenly less risk-averse") the previous understanding is lost and the user has no way to push back.

**Scope.**

- **Versioning.** Every Sage pass writes the new portrait to `users/{userId}/portraits/{ts}.md` (ISO timestamp) AND updates the canonical `users/{userId}/portrait.md` (the file CD reads on boot). Storage is small — markdown, KB-scale per version; keep all history indefinitely.

- **Diff capture.** Alongside each version, write `users/{userId}/portraits/{ts}.diff.md` showing what changed from the immediately prior version (added lines, removed lines, edited paragraphs). Sage's narrative explanation ("This week the user shifted from `editorial-restraint` to `vibrant-confidence` after the Aequitas brief landed") gets appended to the diff file in a "## Why" section.

- **User-edit support.** The Portrait UI (WP-08) surfaces the current portrait with edit affordances. User edits are NOT written back to `portrait.md` directly (that's Sage's file). Instead they persist to `users/{userId}/portrait-corrections.md` — a separate file Sage reads on next pass. Sage's next pass starts by reading corrections, treating them as ground-truth user feedback, and incorporates them: "user disagreed with `risk-averse`; updating my model. They now describe themselves as `selective`, not `cautious`."

- **Audit trail.** Version timestamps + diffs + corrections give a full lineage for any portrait claim. CD reading "your audience is HNW Swiss German" can be traced back to the discovery turn that first established it, the subsequent Sage passes that refined it, any user corrections that shifted it.

**Files affected.**
- `lib/memory/dreamer.ts` — extend to write versioned file + diff file on every pass; read `portrait-corrections.md` on entry.
- `lib/memory/portrait-versions.ts` (NEW, ~80 LOC) — versioning helpers: write versioned file, compute diff vs prior, list versions for a tenant.
- `agents/sage-padawan.md` — TIER 2 doctrine: "On boot, read `portrait-corrections.md` if present; treat its contents as ground-truth user-flagged disagreements with prior portrait."

**Acceptance.**
1. Run Sage three times in sequence (with intervening user activity) → `users/{userId}/portraits/` has three timestamped files + three diff files.
2. The current `portrait.md` matches the most recent versioned file (symlink or content copy — implementation detail).
3. User edits the "Quality bar" section via Portrait UI → next Sage pass reads `portrait-corrections.md`, narrows the quality bar accordingly, the diff file records "user-flagged change: lowered bar from `pixel-perfect` to `mostly-pixel-perfect-but-pragmatic-on-deadline`."
4. Listing past versions in the UI shows a timeline + each version's "Why" excerpt.
5. Deleting `portrait-corrections.md` (corrections incorporated) does not lose information — Sage's narrative explains in the next diff that it consumed the corrections.

**LOC.** ~250 LOC. **Difficulty.** Medium — file IO + diff logic + an additional read in Sage's boot sequence. **Deps.** None at code level; complements WP-08 (Portrait UI) which surfaces this to the user.

### WP-08 — Sage portrait UI

**Problem.** The portrait lives at `users/{userId}/portrait.md`. The user has no way to see it, no way to correct it, no way to understand how it's evolving. Sage's read of the user is invisible — which makes the whole "OskarOS knows you" pitch a black box.

**Scope.** Surface the portrait in the admin dashboard. New route: `app/(dashboard)/profile/page.tsx`. The page reads `users/{userId}/portrait.md` + the version timeline + any open corrections, and renders:

- **Top row.** Current portrait headline (the one-liner Sage paints at the top of every portrait) + last-updated timestamp + "Updated by Sage pass N" badge.
- **Body.** Portrait sections (Audience, Voice, Don't-do list, Quality bar, etc.) each rendered as a card with an edit pencil affordance per card. Clicking the pencil opens a markdown editor for that section only; saving writes the change to `portrait-corrections.md` (NOT directly to portrait.md — that's Sage's file).
- **Sidebar.** Version timeline (compact). Click a version → diff view shows what Sage changed in that pass (consumes WP-07's diff files).
- **Footer.** "Recent Sage notes" — narrative diffs from the last 3 passes ("This week you pulled the audience anchor toward HNW Swiss German…").

**Files affected.**
- `app/(dashboard)/profile/page.tsx` (NEW, ~120 LOC) — main page render.
- `components/dashboard/PortraitCard.tsx` (NEW, ~80 LOC) — section card with edit affordance.
- `components/dashboard/PortraitTimeline.tsx` (NEW, ~50 LOC) — sidebar version timeline + diff viewer.
- `app/api/admin/portrait/{read,correction}/route.ts` (NEW, ~50 LOC) — GET current portrait + version list, PATCH a section correction.

**Acceptance.**
1. Tenant logs in → `/profile` shows their current portrait with all sections rendered + edit pencils visible.
2. Editing the "Voice" section + saving → `users/{userId}/portrait-corrections.md` contains the new voice text; `portrait.md` itself unchanged until next Sage pass.
3. Clicking a past version in the timeline → diff view shows exactly what changed in that pass with Sage's narrative "Why."
4. Empty state (no portrait yet, tenant just onboarded) → friendly placeholder + "Sage hasn't painted you yet" message.

**LOC.** ~300 LOC. **Difficulty.** Medium — straightforward CRUD UI over existing primitives (markdown render, diff render). **Deps.** WP-04 (per-tenant Order so the portrait file exists in the right place), WP-07 (versioning so the timeline + diffs have data).

### WP-09 — Auditor agent

**Problem.** External auditors miss structural leaps. They read `.md` files, look at file sizes, anchor on prior audits, give scores like "8/10 — solid foundation" without naming what's at risk. They never recommend the architectural bet that would unlock the next phase. The audit becomes a scoreboard, not an engagement.

**Scope.** A new agent role: Auditor. Boot prompt explicitly counter-trains the typical-LLM-audit failure modes:

- ❌ Don't read prior audit reports first (anchoring bias).
- ❌ Don't measure file size as a quality proxy.
- ✅ Read SESSION.md to understand the operational reality, not just the code structure.
- ✅ Required output: "What should exist but doesn't?" + "What would you tear out and rebuild?" — at least one concrete answer to each, named precisely (file path + function name + reason).
- ✅ Required: name the architectural bet that would unlock the next phase.
- ❌ Banned: any score above 7/10 without naming three specific issues that justify NOT being 10/10.
- ❌ Banned: any "this is impressive" framing — replace with "what's at risk."
- ❌ Banned: vague language. "The code could be cleaner" is rejected; "Lines 220-340 of `lib/x.ts` are a 120-line switch that should be a registry" is acceptable.

Lives at `agents/auditor.md`. Invoked by `mcp__oskar-orchestrator__run_audit({scope, model})`. Output written to `docs/AUDIT-{YYYY-MM-DD}-{model}.md` so multiple audits across models/dates are queryable.

**Files affected.**
- `agents/auditor.md` (NEW, ~100 LOC of doctrine + boot sequence).
- `mcp-server/tools-orchestrator.ts` — register `run_audit` tool (~30 LOC).
- `lib/run-auditor.ts` (NEW, ~70 LOC) — spawns Auditor with the right system prompt, captures output to the dated file.

**Acceptance.**
1. Run `mcp__oskar-orchestrator__run_audit({scope: 'memory-system', model: 'opus'})` → produces `docs/AUDIT-2026-06-05-opus.md` with the required sections filled.
2. The audit names at least one "should exist but doesn't" item by file path AND at least one "would tear out" item by file path.
3. No score line in the output ever reads ≥8/10 unless followed by ≥3 named specific issues.
4. Running two audits with different models (`opus` vs `sonnet`) produces meaningfully different outputs (different "tear out" picks), confirming the auditor isn't degenerating into a template.

**LOC.** ~200 LOC. **Difficulty.** Low-medium — the agent prompt design is the actual work; code-side is small. The risk is the prompt drifts back toward standard LLM auditor patterns (compliments, score-only) — needs initial tuning + a few real audits before locking. **Deps.** None.

---

## §4 — Build-time quality

_Sentinel Ti gates + brand-lint + doctrine. All wire into `mcp-server/tools-orchestrator.ts:report_build_complete`._

### WP-10 — Sentinel Ti verification floor (post-build smoke test)

_(2026-07-12 audit: NOT implemented. ⚠ Naming: `lib/sentinel-ti.ts` now EXISTS but is the Sentinel Ti agent RUNNER (subprocess spawn + critique writer) — the smoke battery specced below needs a different filename, e.g. `lib/sentinel-smoke.ts`. Do not touch the existing file.)_

**Problem.** Today when WebDev fires `report_build_complete`, the orchestrator trusts the build and the round-trip ends. Broken builds (missing `<title>`, empty `src` attributes, JS syntax errors, orphan `data-slot` references) only surface when a human opens the page. CD bears the cost of catching mechanical failures that a smoke test could catch in 500ms.

**Scope.** Post-`report_build_complete`, the orchestrator runs an automated smoke test via Sentinel Ti:

- **Parse rendered HTML with JSDOM:**
  - All `<img>` elements have `data-slot` + `data-usage` attributes set.
  - All `<img src>` paths resolve on disk (not relative paths pointing at non-existent files).
  - No orphan `data-slot` attributes pointing at unsold image slots.
  - No `<script>` parse errors (basic JS syntax check via `new Function()` or Acorn).
  - `<title>` element present and non-empty.
  - `<meta name="description">` present and non-empty.
  - At most one `<h1>` per page (multiple H1s break SEO + signal generic AI fluff).

- **On failure:** mark the build as `failed-validation` in escrow, surface the specific failure list to CD with file:line precision. CD decides whether to ask WebDev to fix (most cases) or escalate to user.
- **On pass:** build proceeds to CD's normal review. Sentinel Ti's verification is a fast-fail gate, not a quality judgment.

Reuses `lib/brand-lint-rules.ts` infrastructure (the same rule-engine surface).

**Files affected.**
- `lib/sentinel-ti.ts` (NEW, ~80 LOC) — JSDOM smoke battery.
- `mcp-server/tools-orchestrator.ts` — wire into `report_build_complete` handler (~20 LOC).
- `lib/brand-lint-rules.ts` — extend rule registry to include smoke-test rules alongside existing brand rules.

**Acceptance.**
1. WebDev ships an HTML with a missing `<title>` → orchestrator marks build `failed-validation`; CD receives "Missing `<title>` in `vibe-1.html` line 8."
2. WebDev ships an HTML with `<img src="hero.png">` but no `hero.png` on disk → caught with the missing path.
3. WebDev ships an HTML with `<img data-slot="abc">` where slot `abc` is not in IMAGES.md → caught with "Orphan data-slot: abc."
4. Clean build → no failure, build proceeds to CD review.

**LOC.** ~120 LOC. **Difficulty.** Low — mechanical checks over JSDOM. **Deps.** None.

### WP-11 — Brand-lint v1.5: content-guidelines integration

**Problem.** `content-guidelines.md` is currently doctrine-only — referenced in CD's TIER 2 but no lint code reads it. Banned phrases ("seamless," "leverage," "unlock," "delight," etc.), voice-locking rules, anti-slop checklist — all enforced by CD's eyeballs at review time, not by `lib/brand-lint-rules.ts` at build time. A banned phrase only gets caught if CD happens to notice it; consistency is uneven.

**Scope.**

1. **Parse `content-guidelines.md` into a structured rule set:** `{ bannedPhrases: string[], requiredVoice: VoiceSpec, antiSlopChecks: AntiSlopRule[] }`. The doctrine file already has structured sections; the parser walks them.

2. **Add 3 new rules to `lib/brand-lint-rules.ts`:**
   - `banned-phrase` — flag any banned phrase in rendered HTML body text.
   - `voice-mismatch` — detect tone drift via simple pattern detection (over-use of exclamation marks, hedge words like "perhaps"/"might possibly", marketing-speak triggers, sentence-length variance outside the declared voice's window).
   - `anti-slop` — concrete checklist items: no "Welcome to..." headers, no bullet-list-only sections, no over-capitalized headlines ("UNLOCK YOUR POTENTIAL"), no AI-cliché bridging phrases ("at the end of the day," "in today's fast-paced world").

3. **New rules surface as advisory by default** (warning, not block). Brand-DNA per-tenant config can promote specific banned phrases to hard-fail.

4. **Tests:** 3 fixtures per rule (clean / 1 violation / multiple violations) → expected lint output matches.

**Files affected.**
- `lib/content-guidelines-parser.ts` (NEW, ~60 LOC) — parse the doctrine file into structured rules.
- `lib/brand-lint-rules.ts` (~80 LOC delta) — add the 3 new rules.
- `lib/__tests__/brand-lint-rules.test.ts` — fixture tests.
- `content-guidelines.md` (existing) — extend `## Anti-Slop Checklist` if needed to be more parser-friendly (already well-structured).

**Acceptance.**
1. A vibe rendering "Unlock your seamless leverage today" produces three `banned-phrase` advisory violations.
2. A vibe with seven exclamation marks in 200 words triggers `voice-mismatch` advisory.
3. A vibe whose hero copy is "Welcome to ACME — your trusted partner in synergy" triggers `anti-slop`.
4. A clean vibe (one with measured copy that respects the guidelines) produces zero advisories.
5. Promoting `seamless` to `severity: error` per-tenant → that vibe now hard-fails the build, not just advisory.

**LOC.** ~200 LOC + fixtures. **Difficulty.** Low — text pattern matching. **Deps.** None.

### WP-12 — Sentinel Ti animation audit gate

**Problem.** OskarOS has five animation reference files (`animation-best-practices.md`, `animations.md`, `animation-pitfalls.md`, `cinematic-patterns.md`, `hero-animation-case-study.md`) vendored in `skills/references/`. But Sentinel Ti has no audit hook for animation work — animation bugs (font-preload races, `lastTick` issues, jitter, broken pause/resume) only surface in the rendered vibe and Ralph has to catch them by hand.

Cross-doc to `HUASHU-INTEGRATION-PROPOSAL.md` v4 §C1.

**Scope.** For any vibe declaring `Animation paired: YES` (specified in `vibe-N.md` metadata), Sentinel Ti runs an animation audit BEFORE marking the build complete:

- **Parse animation timeline.** Identify all `requestAnimationFrame` / `animate()` / CSS `@keyframes` declarations in the HTML + linked JS.
- **Check known pitfalls (from the reference files):**
  - Font preload race: is `document.fonts.ready` awaited before first frame?
  - `lastTick = null` reset on pause/resume so the next frame doesn't jump?
  - `__ready` flag set after first paint to gate user interaction?
  - No `setTimeout`-driven motion (rules out drift)?
- **Cinematic patterns:** declared scenes match `cinematic-patterns.md` taxonomy; transitions have proper easing (no linear unless intentional); ease-out for entrances, ease-in for exits.
- **Frame-by-frame Playwright capture:** record N seconds of the animation, run perceptual diff frame-vs-frame (ties to WP-13 infrastructure when shipped).
- **Output:** structured violations with timeline locations ("Frame 12 at 0.4s: hero text appears before font load completes — visible FOUT").

**Files affected.**
- `lib/sentinel-ti-animation.ts` (NEW, ~180 LOC) — the audit pipeline.
- `mcp-server/tools-orchestrator.ts` — gate `report_build_complete` on the animation audit when `Animation paired: YES`.
- `skills/references/animation-pitfalls.md` (existing) — used as the rules source.

**Acceptance.**
1. A vibe with paired animation that has a font-preload race → audit catches it with "Font race at frame 0-3."
2. A vibe with `setTimeout(100, advance)` for motion → audit flags `setTimeout-driven motion`.
3. A clean animated vibe → audit passes, build proceeds.
4. A vibe without paired animation → audit skipped (not run for static vibes).

**LOC.** ~300 LOC. **Difficulty.** Medium-high — Playwright timeline parsing has edge cases; the cinematic-patterns taxonomy match is fuzzy. **Deps.** Stand-alone, but WP-13 perceptual diff makes the frame-vs-frame check meaningful.

### WP-13 — Brand-lint v2: perceptual diff

**Problem.** Brand-lint v1.5 catches text-level violations. It can't catch "the hero color drifted 20% from the declared brand palette" or "this vibe rendered with the wrong font despite the CSS being correct" — those are visual regressions invisible to text inspection. Sentinel Ti needs eyes.

**Scope.** Render-time pixel diff. Sentinel Ti's existing screenshot tool captures the built vibe. A new comparator runs perceptual diff (SSIM or LPIPS via a small ONNX model) against:

- **(a) Brief's reference images** uploaded by user during onboarding or first discovery turn (the "make it look like THIS" reference).
- **(b) Prior approved vibe** in the same session — catches drift across iteration cycles (e.g., a color crept from `#1a4f8a` to `#2a6cb8` between vibe-2 and vibe-3 with no user request).
- **(c) Declared brand-DNA tokens** — color palette deltas (rendered hero color vs `--brand-blue` token); typography violations (rendered font vs declared family).

Output structured violations the agent can act on:
```json
{
  "rule": "color-drift",
  "selector": ".hero-bg",
  "expected": "#1a4f8a",
  "observed": "#2a6cb8",
  "delta": 0.18,
  "severity": "warning"
}
```

CD reads the violations, decides whether to action ("fix saturation") or accept ("it's the rebrand variant we agreed").

**Note: introduces the first non-trivial native dep (small ONNX model, ~10 MB).** Deployment-complexity step — gated on §11 D5.

**Files affected.**
- `lib/perceptual-diff.ts` (NEW, ~180 LOC) — SSIM/LPIPS runner over `Image` buffers.
- `models/lpips-small.onnx` (NEW, ~10 MB binary) — bundled ONNX model.
- `lib/brand-lint-rules.ts` — add `color-drift`, `typography-mismatch`, `layout-drift` rules.
- `mcp-server/tools-orchestrator.ts` — gate `report_build_complete` to run perceptual diff when reference images exist.

**Acceptance.**
1. Brief includes a reference hero image; rendered vibe's hero has +20% saturation → violation surfaces with `delta: 0.18`.
2. Brand-DNA declares `--brand-font: Inter`; rendered hero uses `Arial` (CSS fallback fired) → `typography-mismatch` violation.
3. Layout-equivalent re-render (same colors, same fonts, slightly different image crop) → no false positive (delta below threshold).
4. ONNX model loads in <500ms cold and <50ms warm; doesn't crash on M1, M2, Linux x86.

**LOC.** ~400 LOC including the perceptual-diff dependency surface. **Difficulty.** Medium-high — ONNX runtime integration + delta threshold tuning (false positives kill trust). **Deps.** WP-10 (Sentinel verification floor — same orchestrator hook). **Gate.** §11 D5 decision on adding the 10 MB native dep.

> _Deleted 2026-07-12 (Ralph): **WP-14 "INSTITUTIONAL-MEMORY doctrine entries (parser-cascade + structured-island lessons)"** — killed as a trojan horse. Refusal-framed "Don't-Do" doctrine installs halt-triggers in every agent that cold-boots on the file (the same wedge shape as the rejected symmetric-completion clause). If the parser-cascade / structured-island lessons ever ship, they ship action-framed in the owning agent's file ("pass structured data through at tool-call time"; "parse only the structured island") — never as Don't-Do entries. The full spec + both cascade histories live in git (this file, pre-2026-07-12). Do not resurrect._

---

## §5 — Chat-UI + video

### WP-15 — Card visual regression baselines

**Problem.** OskarOS has 13 distinct ToolCard variants × 2 themes (onyx + polar) = 26 visual surfaces. There's no automated way to catch a CSS regression that changes the look of any of them. Today regressions surface in Ralph's eyeballs hours later.

**Scope.**
- Capture screenshots in both themes for each of the 13 tools, file under `e2e/baselines/toolcards/`.
- Wire Playwright `toMatchSnapshot()` into the e2e suite so future renders compare against these baselines.
- On CI: any visual diff > 5% pixel delta fails the run with a side-by-side image diff.

**Files affected.**
- `e2e/baselines/toolcards/*.png` (NEW, 26 PNG fixtures).
- `e2e/toolcards.spec.ts` (NEW, ~60 LOC of Playwright snapshot tests).
- CI config — add the e2e suite to the gate set.

**Acceptance.**
1. Running `npm run e2e -- toolcards` on clean main passes with no diffs.
2. Intentionally bumping `--card-padding` by 4px in CSS → CI fails with named cards showing the diff.
3. Theme switch (onyx vs polar) doesn't false-positive (each baseline is theme-specific).

**LOC.** ~60 LOC of test code + 26 PNG fixtures. **Difficulty.** Low — Playwright snapshot is a standard pattern. **Deps.** All 13 tools must be in their stable form before baselining; if a tool is mid-redesign, defer that one. **DEFER candidate** — only fires value the first time a regression bites.

### WP-16 — Hyperframes integration (HTML → MP4)

**Problem.** OskarOS produces beautifully animated HTML vibes, but customers often need a video version (for social, for slide decks, for the website's auto-play hero). Today that's a manual screen-record. Hyperframes ([github.com/heygen-com/hyperframes](https://github.com/heygen-com/hyperframes), Apache-2.0) is the canonical pipeline for converting HTML animation to MP4.

**Scope.** Two deployment shapes to decide between:

- **Local hosting.** Run `hyperframes render` locally via `puppeteer` + `sandbox-exec` (macOS) / `firejail` (Linux). Source HTML stays in the session folder; only the final `.mp4` becomes a project chip.
- **HeyGen hosted API.** Upload the HTML bundle, poll for the rendered MP4. Lower local resource use; depends on HeyGen's availability + pricing.

Reference shape: OD's `skills/hyperframes/` already has the integration patterns — `npx hyperframes render` dispatched by daemon, source files cached in `.hyperframes-cache/`, only final `.mp4` lands as a project chip.

**Files affected.**
- `lib/hyperframes.ts` (NEW, ~150 LOC) — wrapper around the chosen deployment shape.
- `mcp-server/tools.ts` — register `render_to_mp4` tool.
- `skills/hyperframes/` (NEW, ~80 LOC of doctrine) — when to invoke, prompt patterns for naming/duration.
- `agents/creative-director-agent.md` — TIER 2 pointer to the skill, when to fire it.

**Acceptance.**
1. CD fires `render_to_mp4({vibe: 1, duration: 10})` → `.mp4` appears in the session folder within 60s (local) or 5min (hosted).
2. The MP4 visual matches the rendered HTML animation frame-for-frame (within perceptual-diff tolerance).
3. Failing render (e.g., HTML had a parse error) returns a structured error CD can show the user.

**LOC.** ~280 LOC. **Difficulty.** Medium — the integration surface depends on the deployment shape; HeyGen API integration is simpler but adds an external dependency. **Deps.** None at code level. **Estimate.** 2-3 weeks including the deployment-shape decision spike.

---

## §6 — Provider plumbing

_All hits `lib/run-webdev.ts` + `lib/mcp-config.ts`._

### WP-17 — API-mode deployment hardening (Sub-4 thinking blocks remaining)

❌ **PARTIAL.** Five subcomponents specced; four shipped or folded out:

- **Sub-1 — TopBar / mode plumbing ✅ SHIPPED.** CLI|API pill group, OPUS|SONNET|GEMINI model pill, `billingMode` state. Extended to SMPL/CLI/API tri-toggle.
- **Sub-2 — Anthropic SDK integration ✅ SHIPPED (with caveat).** `lib/claude-api-loop.ts` non-streaming tool-use loop, `lib/gemini-loop.ts`, `lib/tool-executor.ts` (9 tools), `lib/run-webdev.ts` router, `/api/chat` 970 LOC, Phase 2 `report_build_complete` tool intercept, token usage extraction. **Caveat:** loop FUNCTIONS but is not on parity with CLI bridge for an agentic CD workflow. The bridge in CLI mode handles tool-call orchestration, streaming, MCP transport, stream-json events for free; none of those come for free in API mode.
- **Sub-3 — Expose MCP tools to API-mode `/api/chat` ✅ SHIPPED.** MCP server in-process with `/api/chat`, API-mode imports + dispatches via `lib/api-mcp-bridge.ts`. 2026-05-04 inventory: 36 MCP tools (CD 15, WebDev 3, Sentinel 1, Capabilities 11, Orchestrator 6) + 3 inline. TOTAL: 39.
- **Sub-4 — Agentic-loop hardening ❌ PARTIAL.** SHIPPED: token usage tracking + cost calculation, tool-use intercept loop with maxTurns guard, `injectBridgeScripts` post-process, prompt caching (Anthropic native — system + tools + last-message `cache_control`), STREAMING, SSE event forwarding, retry/backoff with 5×exponential. **PENDING:** thinking blocks — preserve `<thinking>` blocks across tool-use turns. Without this, API-mode agentic loops lose the model's reasoning chain between tool calls, degrading multi-turn output quality.
- **Sub-5 — Production hardening — FOLDED INTO WP-91.** This was a one-line stub that overlapped WP-91 (Agent-SDK code-path, see Feature-X.md) — now the real production-deploy story (single-tenant, customer OAuth, no `claude` binary required). **Decision:** WP-91 owns production hardening for customer deploys; WP-17's remaining open scope narrows to **Sub-4 only** for the Ralph-owned `ANTHROPIC_API_KEY` / centralized-billing mode.

**Scope for the remaining work.**
- `lib/claude-api-loop.ts` — capture `<thinking>` block content from `content_block_start` + `content_block_delta` SSE events; persist across the tool_use → tool_result → next assistant turn so the model sees its own prior reasoning. The Anthropic API requires `thinking` blocks to be passed back in subsequent calls when `tool_use` blocks reference them.
- Same treatment in `lib/zai-api-loop.ts` once WP-19 lands (Z.AI mirrors the same protocol shape).
- Rate limiting was deleted from this WP (was speculation). Multi-tenant conversation state was deleted (BYOK moved to WP-01).

**Acceptance.**
1. Run a 4-turn agentic CD task in API mode (Anthropic, opus) → each turn's `<thinking>` block is visible to the next turn (verified by adding a sentinel string to turn 1's reasoning and checking it appears in turn 4's context).
2. Token cost reporting still matches: thinking tokens count against output budget.
3. No regression on simple single-turn calls.

**LOC.** ~50 LOC delta. **Difficulty.** Medium — the SSE event handling has edge cases (thinking_delta vs text_delta vs tool_use_delta), and the persistence across `tool_use` boundaries is fiddly. **Deps.** WP-91 (Agent-SDK code-path) — bumps to it on the customer-deploy side, leaving Sub-4 only here. _(2026-07-12 audit: Sub-4 confirmed still open — no thinking-block handling in `lib/claude-api-loop.ts`.)_

### WP-18 — Vertex AI Nano-Banana migration (image-gen path)

**Problem.** OskarOS's current image-generation path goes through AI Studio REST (`generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`). AI Studio's consumer-tier safety filters are aggressive on recognizable characters, celebrities, and named IP — examples blocked today include the Order 66 Yoda hero image, which currently ships as an out-of-band static asset because the REST path can't generate it. Vertex AI's enterprise-tier filtering exposes more granular knobs (`safetySetting`, `personGeneration`, `includeRaiReason`) that MAY permit content AI Studio's consumer surface doesn't.

This is the hypothesis a 10-prompt spike must verify before code lands.

**Scope.** Replace OskarOS's current backend image-gen path (REST) with the Vertex AI path via Google's official `mcp-nanobanana-go` MCP server (hitting `aiplatform.googleapis.com`). This is **not** a coexistence proposal — the AI Studio REST path goes away.

Five reasons to migrate (full detail in the sibling plan):
1. Less restrictive content policy (the spike must verify).
2. Unified Google Cloud auth surface (ADC instead of API key).
3. Agent-side tool access unlocks in-flow generation: WebDev can call `nanobanana_image_generation` mid-build instead of bailing out to ask CD to pre-stage.
4. One source of truth — two image-gen paths drift.
5. Provider-neutral tool surface — invokable from any agent that speaks MCP, including Claude on Z.AI (SMPL) and Gemini CLI.

**Three-phase plan.**
- **Phase 1 — Discovery spike (HARD GATE).** A 10-prompt test set including the canonical Order 66 Yoda prompt, run on BOTH routes with structured rejection telemetry. **Code migration does not start until the spike report shows ≥40% better pass rate on Vertex AI.** If delta is ≤20%, this WP closes without code changes.
- **Phase 2 — Backend migration.** `/api/generate-image` + `/api/edit-image` from REST to MCP. Agent allowlists extended to expose `nanobanana_image_generation` to CD and (newly) WebDev. ADC creds replace `GEMINI_API_KEY`.
- **Phase 3 — GenMedia siblings (optional).** Imagen, Veo, Lyria, Chirp registration + per-agent allowlists. Each independently gated on its own safety spike.

**Files affected.**
- `scripts/nano-safety-spike.ts` (NEW, ~80 LOC) — fires the 10 prompts via BOTH routes.
- `app/api/generate-image/route.ts` + `app/api/edit-image/route.ts` — REST removed, MCP added (~150 LOC delta).
- `lib/mcp-config.ts` — register `mcp-nanobanana-go`, extend `CD_ALLOWED_TOOLS` + `WEBDEV_ALLOWED_TOOLS` (~40 LOC delta).
- `agents/webdev-agent.md` — TIER 2 "Image generation in-flow" subsection.
- `.env.example` — `GEMINI_API_KEY` removed, `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` added.
- `docs/safety-spike-2026-06-XX.md` (NEW, ~50 LOC) — the spike report with 20-row results table.

**Acceptance.**
- **Phase 1:** Report committed with all 20 rows filled. Decision (migrate / stay / tune-and-rerun) documented and reproducible.
- **Phase 2:** `/api/generate-image` no longer references `generativelanguage.googleapis.com`; `GEMINI_API_KEY` removed from `.env.example`. Same image-gen works end-to-end via MCP; `total_cost_usd` flows through usage tracker. Existing pre-staging flow (CD calls `generate_image` → image lands → vibe builds reference it) works unchanged from the user's POV.
- **Phase 3:** WebDev mid-build, prompted with a missing-hero scenario, fires `nanobanana_image_generation` directly and the resulting image embeds in the rendered HTML.
- **Smoke test:** generate the same 10 prompts pre-migration vs post-migration; pass-rate on the migrate-list is materially better.

**LOC.** ~270 LOC if all phases ship. **Difficulty.** Medium-high — auth migration (API key → ADC service account) has friction; MCP server stability (pre-1.0 Google code) needs verification at spike. **Deps.** None.

**Full plan:** `docs/wp-19-vertex-spike.md` (test prompt set + canonical Yoda probe + Phase 2/3 detail + sub-WP table + risk register).

### WP-19 — SMPL-API + Z.AI MCP servers (provider routing + agent capabilities)

**Problem.** Two parts.

**Part 1: SMPL today is the workaround for a Z.AI compat-layer bug.** CLI-mode pointed at Z.AI passes `claude-opus-4-7` as the model name; Z.AI's compat layer maps that to `glm-4.7` (degraded, NOT their best model). SMPL-CLI dodges the bug by passing the tier alias `'opus'` instead, which Claude Code resolves locally via the user's `ANTHROPIC_DEFAULT_OPUS_MODEL` setting. With that set to `glm-5.1`, SMPL-CLI lands on the premium model. But SMPL-CLI still depends on (a) the Claude binary subprocess, (b) Z.AI's compat layer, (c) Claude Code's alias-resolution semantics not changing. A clean direct-API path eliminates all three coupling points.

**Part 2: Z.AI publishes three official MCP servers** (vision via npm/stdio, web search via HTTP, web reader via HTTP). Today our spawned agents (CD/WebDev/Sentinel Ti) only see `oskar-orchestrator`. Adding Z.AI's three gives them visual regression, web search, and web reading — capabilities today either bash-shelled, missing, or routed through inferior built-ins.

**Scope.**

**Part 1 — SMPL-API path.** New `lib/zai-api-loop.ts` direct fetch loop against Z.AI's Anthropic-compatible messages endpoint (`https://api.z.ai/api/anthropic`) with `glm-5.1` explicit (no alias, no compat layer in path). Same `runClaudeAgentLoop`-style signature so callers swap providers without rewiring. Routing fork in `lib/run-webdev.ts:runWebDev()`:

- `mode === 'cli' && model is claude-*` → existing CLI Anthropic path
- `mode === 'cli' && model is gemini-*` → existing Gemini CLI path
- `mode === 'api' && provider === 'anthropic'` → `runClaudeAgentLoop`
- `mode === 'api' && provider === 'zai'` → `runZaiAgentLoop` (NEW)
- `mode === 'smpl' && transport === 'cli'` → existing bridge subprocess + Z.AI base URL
- `mode === 'smpl' && transport === 'api'` → `runZaiAgentLoop` (NEW)

The `mode` enum stays `'smpl' | 'cli' | 'api'`; SMPL-API selected by `transport: 'cli' | 'api'` field on the SMPL branch.

CD on SMPL-API replaces the bridge subprocess with the in-memory async generator wrapping `runZaiAgentLoop`. Same `sendMessage()` / `BridgeEvent` interface so chat-stream code doesn't change.

TopBar UX: when SMPL is selected, a secondary CLI/API pill appears beneath the main pill row.

**Part 2 — Z.AI three-MCP-server integration.** Extend `lib/mcp-config.ts:ensureMcpConfig` to conditionally register Z.AI's three servers (vision npm/stdio, search HTTP, reader HTTP) when `Z_AI_API_KEY` is set. Per-agent allowlist additions:

| Agent | Vision (analyze_image, ui_diff_check, etc.) | Web (search, reader) |
|---|---|---|
| **CD** | analyze_image, extract_text_from_screenshot, ui_to_artifact, analyze_data_visualization | web_search_prime, webReader |
| **WebDev** | ui_diff_check, ui_to_artifact, extract_text_from_screenshot, diagnose_error_screenshot, analyze_image | webReader |
| **Sentinel Ti** | ui_diff_check (primary), diagnose_error_screenshot, analyze_image, understand_technical_diagram | (none) |

Quota tracker (`lib/zai-quota-tracker.ts`) counts `web_search_prime` + `webReader` calls per session; surfaces snackbar warning at 80% of the user's GLM Coding Plan cap. Vision is on a separate 5-hour pool — tracked independently.

**Files affected.**
- `lib/zai-api-loop.ts` (NEW, ~150 LOC).
- `lib/run-webdev.ts` (~50 LOC delta — routing fork).
- `lib/bridge-process-manager.ts` (~80 LOC delta — `transport: 'api'` branch wraps the async generator).
- `components/TopBar.tsx` (~30 LOC delta — secondary pill).
- `lib/mcp-config.ts` (~80 LOC delta — multi-server config + allowlist matrix).
- `lib/zai-quota-tracker.ts` (NEW, ~60 LOC).
- `agents/{cd,webdev,sentinel}.md` — TIER 2 "Z.AI MCP tools" sections.

**Acceptance.**
- **Part 1:** `runWebDev({mode: 'smpl', transport: 'api', model: 'glm-5.1', ...})` builds a vibe successfully against `https://api.z.ai/api/anthropic`. Stream of tool calls matches CLI mode. `report_build_complete` lands. `total_cost_usd` flows through `lib/usage-tracker.ts`. CD on SMPL-API spawns NO subprocess; chat-stream still emits the same SSE events; tool calls work end-to-end.
- **Part 2:** All three Z.AI MCP servers register at agent spawn. CD fires `web_search_prime` successfully; WebDev fires `ui_diff_check` successfully; Sentinel Ti fires `ui_diff_check` during an audit and the verdict appears in the critique. Quota tracker surfaces a snackbar at 80%.
- **Smoke test:** same vibe built under CLI (Anthropic), API (Anthropic), SMPL-CLI (Z.AI via tier-alias), SMPL-API (Z.AI direct) — all four produce comparable HTML; tool fidelity matches; cost reflects provider pricing.

**LOC.** ~630 LOC across 5 sub-WPs. **Difficulty.** Medium-high — Z.AI's response shape under direct API may differ from compat-layer-normalized shape; risk register in the full plan. **Deps.** None.

**Full plan:** `docs/wp-20-smpl-zai.md` (substrate-today table + per-agent applicability + Z.AI server endpoint configs + 5 sub-WPs + risk register).

---

## §7 — CRM-Consular spine

_The Consular is live (chat, SQL tool, Ask-AI modal, Order 66, People, Intel UI all shipped). The unfinished spine is the research teardown, split into WP-20 (field model) · WP-21 (backend) · WP-22 (renders) · WP-23 (button + doctrine)._

> _Deleted 2026-06-10 (Filippo): the old WP-20 "schema migration" (five new tables — `lead_intel`/`lead_lamps`/`lead_keywords` duplicated the live `intel_json` blob, `lead_notes` duplicated `activities`, `voice_corpus` duplicated sent messages already in `activities` — the corpus is a SELECT, not a table) and the old WP-21 "tone test + ship gate" (production already measures tone on every send; if history is thin, a one-time import into `activities` is a 30-LOC script, not a WP). Do not resurrect either._

### WP-20 — Intel teardown I: the field model (the stranger brief)

_Reframed 2026-06-09, split 2026-06-10 (Filippo). The old "WP-22 automatic vs WP-23 agentic Scout-taste agent" split is dead: **jedi-scout is retired** (it added nothing the two free screenshots didn't already give), and the **Consular** fills the teardown on demand. WP-20 = WHAT the teardown holds + what already exists. WP-21 = backend. WP-22 = the two renders. WP-23 = the button + doctrine._

_Updated 2026-06-10 (Ralph + CD, debug session): verdict = free tag text + an explicit **four-tone background** (green · phosphor · orange · red) — the tone is the contract, the tag is the Consular's words; PALAT bands settled at 400/600/800/1'000/2'000 and **code-derived** (agent never writes the band); CHF rate flexed to 200–300 by build weight; **availability (Verfügbarkeit)** added as the pitch-argument selector; `the_hook` as a field is **dead** (the hook survives as craft — the pitch's first line); § COLD-LEAD TEARDOWN rewritten in `agents/CONSULAR-agent.md` — **that file is the source of truth for the doctrine, not this WP.**_

**What Filippo needs from this feature — the whole point.** The report is a **stranger brief**: by the end of the research the Consular has met these people, and the card introduces them. In this order, in ten seconds:

1. **Go / no-go** — Verdict tag + tone. The **tone is the contract and the Consular's only structural output** — one of four background colors (**green · phosphor · orange · red**), set with the verdict. The **tag is words, end-to-end** — PURSUE / WARMING UP / WATCH / SKIP are house defaults, but the field is plain text: the Consular may overwrite it, and **Filippo may edit it on the card without anything breaking**, because nothing validates or coerces it. Legacy heat (Scout) and legacy tags (Kanban `DISQUALIFY` etc.) map to a tone read-side only.
2. **Who these people are** — the portrait (free-text): who runs it, how many heads, where they are in their arc, what their site betrays about them.
3. **Can they pay** — **PALAT 0–5** = CHF est ÷ heads, **code-derived** (`palateBand`) — the Consular writes `chf_est` + `heads`, never the band: ≤400→5 · ≤600→4 · ≤800→3 · ≤1'000→2 · ≤2'000→1 · else 0. **Heads = people registered by name** — the named registrants (FSP etc.) and the named team on the site — counted at Scout, where new business enters. Eight heads make a 2'000 site trivial; one head makes it a wall.
4. **Will they move** — **BUYING 0–5** — Scout: seeded from cited evidence; Kanban: ripened by real contact. Same lamp, same scale, on both surfaces.
5. **Are the books open** — **availability** (open / limited / closed / unknown): decides which pitch argument exists — demand (open) · selection/right-customers (limited) · referrer-and-recruiter, or park-with-a-trigger (closed; the register flipping back to open IS a trigger). Register-fed where the vertical has one (FSP — shipped); site signals elsewhere (waitlist, "ausgebucht", recruiting page); unknown is an honest finding, never a guess.
6. **What I'd displace** — **switching pain** (free-text: how dug-in is what they already run).
7. **What's wrong + what I pitch** — pain points + what-to-pitch, CHF anchor per row (incl. `/mo` retainer rows — deploy-and-operate made monetary). The hook lives here as **craft, not a field**: the pitch's first line is the one discerning observation Filippo can open with verbatim. (`the_hook` as a schema field was killed in implementation — the WHO block carries the Consular's discerning read.)
8. **What it's worth** — CHF est = **sections × rate**, rate 200–300 by build weight (plain text room → 200; imagery/artwork/custom → 300), suggested retail; the deterministic counter pre-counts, the Consular's walked count + rate judgment override; the per-page breakdown is the citation.

Everything else on the card is decoration unless it serves one of those eight. **The lamp pair is identical on both surfaces — that identity IS the Scout→Kanban move: a row move, zero field translation.**

◐ **HALF-LIVE** (2026-06-10 audit) — verdict vocabulary, PALAT derivation, section counter, availability, switching_pain, WHO, and the Scout TASTED render are shipped in code (inventory in §A); the remaining delta (explicit four-tone verdict, Kanban relabels, promote-carry) lives in WP-21/22. WP-23 wires the trigger.

#### A · Already built (keep)

- **Kanban render — DONE.** `components/crm/LeadDetail.tsx` parses `prospects.intel_json` and renders the full teardown today (verdict block · Big-6 lamps · ledger strip · `prose_design`/`prose_seo` · keywords · pain/pitch · facts) with contentEditable fields + a delegated PATCH persist path. Populated rows (e.g. P001) display end-to-end. A **"Scan / Re-scan" button already exists** (`rescan` cb, ~L868) — but today it only stamps `intel_scan_at`; it does NOT call research. That stub is WP-23's hook.
- **Deterministic Scout signals — shipped 2026-06-06** (these stay — they're the free collapsed-row signal):

- **Trackers split → Analytics + Marketing.** `lib/consular/research-queried.ts` `detectTrackers` retired; replaced by `detectAnalytics` (GA4 / Hotjar / Matomo / Plausible — measurement) + `detectMarketing` (Meta Pixel / Google Ads conversion `AW-…` / LinkedIn Insight Tag — retargeting). Both reuse one shared `formatTrackerHits` helper for the SPA-aware cookie-policy warning. `QueriedSignals` interface adds `analytics: string | null` + `marketing: string | null`; old `trackers` field removed. Three consumers updated: `ScoutDossier.tsx` (lamp strip), `app/api/admin/crm/scout/taste/route.ts` (queried block + Sonnet prompt), `app/api/admin/crm/scout/backfill-queried/route.ts` (lamp keys list). `QUERIED_SOURCES` + tone-mapping in `components/crm/scout/types.ts` updated. Type-check clean. Backfill-queried will refill `analytics`/`marketing` on existing rows that only have the old `trackers` field. ~120 LOC net.

- **Reviews lamp.** New `lib/consular/reviews.ts` — DDG HTML search (`html.duckduckgo.com/html/?q=…`) for `{domain} reviews`, then 4 regex patterns over the result snippet to extract `rating + count` (handles EN/DE/FR/IT review wording; ★/⭐ symbols; "4.7 stars · 87 reviews" / "Rating: 4.7" / "4.7/5 (87)" forms). `lookupReviews` returns `{rating, count, snippet}`; `formatReviewsLamp` produces the mockup's `4.7★·87`. Tone mapping: `≥4.5 good`, `3.5-4.4 mid`, `<3.5 bad`, null/no-listing `info`. ~150 LOC.

- **SaaS / CRM detector v1.** New `detectSaas` in `research-queried.ts`. HTML grep across 8 common platforms (HubSpot, Salesforce, Pipedrive, Intercom, Drift, Mailchimp, Zendesk, ActiveCampaign, Zoho). First-hit wins; "— none detected" when nothing matches (green tone — white-space pitch angle). ~30 LOC. **Honest V1 scope:** signatures may need quarterly refresh as platforms re-version their snippets; minified / SPA-lazy-loaded variants will miss. Add more platforms incrementally as real-prospect misses surface.

- **Industry + Location via JSON-LD.** New `detectIndustry` + `detectLocation` in `research-queried.ts`, both lifting from `<script type="application/ld+json">` blocks. Industry reads `Organization.@type` (or any subtype: LegalService, MedicalBusiness, FoodEstablishment, etc.) with explicit `industry` string preferred. Location reads `address.addressLocality` + `addressCountry` from PostalAddress, falling back to free-text address. Handles single objects, arrays, and `@graph` wrappers; tolerates malformed JSON by skipping. Null when no JSON-LD present — honest "—". ~120 LOC across both detectors + shared parser.

Total shipped: ~420 LOC across 6 files. 5 new lamps (`reviews`, `analytics`, `marketing`, `saas`, `industry`, `location` — the trackers split counts as net-new since it replaced the combined `trackers`). No new tables, no new routes, no Kanban work — pure extensions of the existing Scout pipeline + dossier.

**Honest caveats:**
- **Reviews (DDG):** DDG HTML layout changes will break the regex. Failures degrade to null (lamp shows "—"), never invent a rating. Small Swiss SMEs often have no Google Business listing → null. Upgrade path is ~50 LOC swap to Brave Search API (2k queries/mo free, needs key) or Google Places API (~$200/mo free credit via Google Cloud, needs billing). Same return shape — only the body of `lookupReviews` changes. Do that when DDG hit-rate falls below tolerable.
- **SaaS V1:** the 8-platform grep is a starter set, not production-complete. Hit-rate against real prospects is the open question — instrument which platforms light up in the wild, add patterns where Filippo flags misses. Expect quarterly maintenance.
- **Industry / Location via JSON-LD:** only fires on sites that bothered to ship schema.org. Big firms + SEO-conscious shops → reliable hit; small Swiss SMEs without SEO investment → null. That's actually a useful signal in itself ("no JSON-LD" = SEO debt = pitch angle). Vision-fallback for the JSON-LD-less case is WP-23 territory (agentic).

_(The 2026-06-06 deterministic lamps above stay exactly as shipped — analytics/marketing split, reviews, saas, industry, location. They are the free collapsed-row signal; nothing here changes them.)_

- **Shipped 2026-06-10 (TASTED redesign — Ralph):**
  - **`lib/verdict.ts`** — the unified vocabulary: `VERDICT_TAGS` (PERSUE / WARMING UP / WATCH / SKIP), `verdictTagTone`, `tagFromLegacyHeat` (read-side legacy map), `palateBand` (the 0–5 bands), `legacyBudgetTo5` (LOW→1 · MID→3 · HIGH→5). *(Review 2026-06-10: tag loosens to free text, tone becomes an explicitly stored four-value — the enum derivation demotes to fallback; WP-21.)*
  - **Section counter** — `countSiteSections` in `lib/consular/research-queried.ts` (~L362): buildable bands per page across crawled pages; surfaces as the QUERIED `sections` lamp ("18 · 5 pages"), source cited `HTML crawl · section count`.
  - **Availability** — `lib/scrapers/fsp.ts` `deriveAvailability` → `availability_status` (open/limited/closed/unknown) + `availability_label` + `availability_checked_at`; ScoutDossier renders it with ~14-day staleness marking. Merge guard: unrecognised text → `unknown` + raw label, never clobbers a prior known state with silence.
  - **ScoutDossier TASTED column** — verdict block with the CHF working (`· N SECTIONS × 300`), PALAT·BUYING meters, DESIGN·PHOTOS lamps, WHO block, SWITCHING PAIN, pitch rows with CHF anchors, editable `chf_est`/`heads`, Re-Taste button. (Screenshot-verified 2026-06-10.)
  - **LeadDetail (Kanban)** — `verdict_budget` now renders 0–5 via `legacyBudgetTo5` (tooltip: "same 0–5 scale as Scout's PALAT"), `switching_pain` field live with `prose_seo` read-fallback, `verdict_chf_est` editable.

#### B · The canonical teardown shape — field model

One shape, written by ONE Consular turn, rendered by each surface's own component. **Reuse the existing columns** — `scout_json.taste` (Scout) and the flat `intel_json` keys (Kanban). No new tables (consistent with §7's "scout_json/intel_json is the store").

| Concept | Scout `scout_json.taste` | Kanban `intel_json` | Disposition |
|---|---|---|---|
| Verdict (tag/tone/subline/prose) | `verdict_tag/tone/subline/prose` *(✅ unified 2026-06-10)* | same keys *(✅)* | **✅ SHIPPED** — tag = free text, user-editable, never validated (PURSUE / WARMING UP / WATCH / SKIP as house defaults); **tone = explicit four-value contract, stored values `good · mid · low · bad`** (rendered green · phosphor · orange · red — same vocabulary the frontend + CSS already speak; ONE language, no mapping layer). Stored tone wins; house-tag derivation is fallback; legacy heat / legacy Kanban tags map read-side only. Pool filter chips key off the TONE (tags can't be enumerated) |
| **Who they are** | `who` *(✅)* | `who` *(✅ card + promote-carry shipped 2026-06-10)* | **✅ SHIPPED both surfaces** — the Consular's read of these people, the report's centrepiece, written before the verdict can be; renders as the quoted block (Scout) / the WHO card between verdict and lamps (Kanban). Legacy `palate_choice` read-maps |
| **CHF estimate** | `chf_est` *(✅ editable)* | `chf_est` *(✅ unified 2026-06-10; legacy `verdict_chf_est` read-maps)* | **MODIFY** — `sections × rate`, rate 200–300 by build weight (plain → 200, imagery/artwork → 300), suggested retail; the working renders on the card |
| **Heads** | `heads` *(✅ editable, taste)* | `heads` *(✅ carried 2026-06-10)* + `facts_employees` bucket (1–4 / 5–9 / 10–24 / 25–49 / 50+, derived at promote) | The PALAT divisor = **people registered by name** (register entries + the named team on the site) — counted at Scout, where new business enters; carried at promote. The bucket feeds the EMPLOYEES strip — display, **never the divisor** |
| **Sections** | `sections` *(✅ QUERIED lamp; typing a count computes an empty `chf_est` ×300, never overwrites)* + `sections_detail` *(pending)* | `sections` *(✅ carried at promote 2026-06-10)*; `sections_detail` pending | Counter shipped (`countSiteSections`); Consular's walked count overrides |
| **PALAT (0–5)** | derived — `palateBand(chf_est, heads)` | same helper, `verdict_budget` legacy-mapped | **✅ SHIPPED + UNIFIED** — code derives, agent never writes the band: ≤400/head→5 · ≤600→4 · ≤800→3 · ≤1'000→2 · ≤2'000→1 · else 0. LOW/MID/HIGH is dead (legacy map LOW→1 · MID→3 · HIGH→5, read-side) |
| **Availability** | `availability_status/label/checked_at` *(✅ queried layer)* | carried at promote *(verify)* | **✅ SHIPPED (FSP)** — open/limited/closed/unknown; register-fed where the vertical has one, site signals elsewhere, `unknown` honest; ~14d staleness; selects which pitch argument exists |
| **BUYING (0–5)** | `buying` *(✅ unified 2026-06-10; legacy `execution` read-maps)* | `buying` *(✅ same key; legacy `verdict_buying` read-maps)* | Buying readiness. Scout seeds from cited evidence, one point each: paid-before (pro stack / footer credit) · live trigger (rebrand, new location, recruiting page) · embarrassment gap (site below their standing) · low switching pain · reachable decider. Kanban overrides the seed with observed behaviour (replied · asked price · brought a partner). Same field travels |
| **Switching pain** | `switching_pain` *(✅)* | `switching_pain` *(✅, `prose_seo` read-fallback)* | Consular free-text: "how dug-in is the incumbent" |
| ~~The hook~~ | — | — | **KILLED in implementation** (2026-06-10) — no `the_hook` field on either surface; the hook survives as craft (the pitch's first line, per the agent file), `who` carries the discerning read. Legacy `palate_choice` stays readable, never written again |
| Design quality | `design` *(new, 0–5 lamp + one-line citation)* | `lamp_design_*` *(new lamp)* | **PROMOTE to lamp** — evidence lamp, not decision lamp; its prose collapses into who/pain. `prose_design` stops being written (legacy stays readable) |
| Photos quality | `photos` **reused** (0–5 lamp + citation) | `lamp_photo_*` | **KEEP as lamp** — same 0–5 both sides |
| Pain / pitch | *(new in taste)* | `pain` / `pitch` | **KEEP** — pitch rows carry CHF |
| Close% | — | `verdict_close_pct` | **KEEP — Filippo's**; Consular never writes it |
| `gap` / `heat` / `+1 Warm` chip | derived | — | **RETIRE** — verdict tone carries heat; no derived formula |

**Obsolete:** the old *meanings* of `palate` (taste) and `execution` (build-realisation) and the palate−exec `gap`. The columns live on with new meanings; legacy rows stay readable (no destructive migration).

### WP-21 — Intel teardown II: backend (section counter + blob schema)

   **✅ SHIPPED** (2026-06-10, Consular implementation pass; type-check clean) — except the tag-enum deletion, which stays gated on jedi-scout's retirement (WP-23). **Deps.** WP-20 (the contract above).

**Shipped (verified in code):**
- **Section counter** ✅ — `countSiteSections` (`lib/consular/research-queried.ts`): buildable bands per page across all crawled pages, header/footer once; surfaces as the QUERIED `sections` lamp. Consular override per judgment stays doctrine, not code.
- **Taste blob** ✅ — `chf_est`, `heads`, `switching_pain`, `who`, `design`, `photos` editable in `scout_json.taste` via the ScoutDossier save path; `execution` carries BUYING.
- **PALAT** ✅ — never stored; derived render-side by `palateBand(chf_est, heads)`. Legacy maps (`tagFromLegacyHeat`, `legacyBudgetTo5`) read-side in `lib/verdict.ts`.
- **Kanban blob** ✅ — `switching_pain` on `intel_json` (with `prose_seo` read-fallback); `verdict_budget` consumed as 0–5.
- **Availability** ✅ — `availability_status/label/checked_at` on the queried payload (FSP import + refsp route).
- **Taste prompt speaks the contract** ✅ (2026-06-10, CD) — the per-row prompt now shows the **Sections** lamp (+ per-page breakdown) and **Availability** (from raw_payload) to the tasting agent, and its closing instruction matches the unified tool schema. The old `{palate, palate_choice, execution, verdict, photos}` + gap/heat closing line was contradicting the schema — prime suspect for the ~30–50% silent no-verdict rate the retry-once papered over.
- **`pitch` plumbed end-to-end** ✅ (2026-06-10, CD) — optional field on `submit_scout_verdict` (one row per line, CHF-anchored, full-books → right-customers doctrine in the description) → `ScoutVerdict` → `taste.pitch` → promote already carried it → dossier already edits it. The interim persona doesn't mandate it (pitch craft is the Consular's, WP-23); the schema invites it when anchored.

**Remaining:**
- **Explicit verdict tone** ✅ (2026-06-10) — `verdict_tone` stored on both blobs, values **`good · mid · low · bad`** (rendered green · phosphor · orange · red; ONE vocabulary with the frontend/CSS — the color names in this doc are rendering description, not stored values). Tag is free text (house defaults are suggestions; the interim scout agent still speaks the enum and the route derives+stores the tone at write). `verdictToneOf`: stored wins → house-tag derivation → legacy heat.
- **`sections` on `intel_json`** ✅ carried at promote (2026-06-10), with heads + bucket + tone + buying + chf_est — zero field translation, verified in `promote/route.ts`.
- **`sections_detail`** ✅ (2026-06-10, Consular) — `countSiteSections` now returns `{label, detail}`; the per-page breakdown ("/ 7 · /angebot 4") persists on `scout_json.queried.sections_detail` (taste route) and carries to `intel_json` at promote. The breakdown IS the citation. (Not in backfill's `LAMP_KEYS` — sections ships via the taste flow only, by design.)
- **Availability carried at promote** ✅ (2026-06-10, Consular) — promote lifts `availability_status/label/checked_at` to `intel_json` top-level; queried-layer value (non-register verticals) wins over the `raw_payload` scrape. The confirmed-lost-at-promote bug is closed.
- **Tag enum dies with jedi-scout** (Filippo 2026-06-10): once the interim scout agent retires (WP-23 — it's the last thing speaking the enum), delete `VERDICT_TAGS` + `isVerdictTag` from `lib/verdict.ts` — a user-edited verdict must never fail validation or get coerced; house defaults (PURSUE, spelled right) live in doctrine, not code. Stored legacy `PERSUE` rows render as-is (tags are just words).
- **Working label derives from the data** ✅ (2026-06-10, Ralph — landed in parallel with this pass): `ScoutDossier` renders `chf_est ÷ sections` as the implied per-section rate, no `rate` key; ×300 shows only as the seed anchor while no estimate exists.
- **Write-side retirement** of `prose_design`/`prose_seo` ✅ verified (2026-06-10, Consular) — no live write path emits them: the taste route's payload never carried them, the ScoutDossier save path doesn't write them, promote doesn't fold them. Remaining writers are one-off seed scripts (`scripts/fill-crm-intel.mjs`, `seed-opportunity-intel.ts`) — legacy, not in the teardown path. Read-fallbacks stay.
- **No change to the 2026-06-06 deterministic lamps** — they remain the automatic capture.

### WP-22 — Intel teardown III: the two renders (Kanban + Scout)

   **✅ SHIPPED** (2026-06-10, both surfaces, screenshot-verified — tone cycle, PALAT relabel, sections working, conditional prose cards all confirmed live).

#### Scout (`components/crm/scout/ScoutDossier.tsx` · `ScoutRow.tsx`) — mostly ✅

**Shipped:** the TASTED column end-to-end — verdict tag block (WARMING UP etc.) with the CHF working, PALAT·BUYING meters (relabeled), DESIGN·PHOTOS lamps, WHO block, SWITCHING PAIN, WHAT TO PITCH rows with CHF anchors, Re-Taste; availability lamp with staleness; row colour from Verdict tone — the `+1`/`Warm` gap-heat chip is dead (legacy heat maps read-side).

**Shipped 2026-06-10 (rest):**
- **Tone setter** ✅ — clicking the VERDICT kicker on the shared card cycles the stored four-value (good → mid → low → bad); same affordance both surfaces (components/crm/VerdictCard `onToneCycle`). Rows without a stored tone fall back to tag/heat derivation and enter the cycle at good.
- Collapsed row ✅ — `N Sections` fact shows once scanned (full label in the hover title).

#### Kanban (`components/crm/LeadDetail.tsx`) — the delta

- **Verdict** ✅ — free tag text + stored four-tone background + the kicker click-cycle setter (same shared card). Legacy tags (`DISQUALIFY` …) render as-is.
- Field renders ✅ — **who** (directly under the verdict block) and **sections** (the CHF working `· N SECTIONS × rate` with the rate derived chf ÷ sections; `sections_detail` per-page breakdown in the hover title).
- **BUDGET label → PALAT** ✅ — one name on both surfaces, the alias is dead.
- `prose_design`/`prose_seo` ✅ — DESIGN QUALITY card renders only while legacy content exists (auto-fit grid lets SWITCHING PAIN take the full row on new rows); prose_seo reads through the switching_pain fallback.
- Reuse the existing delegated PATCH/contentEditable path. **No dirty-tracking machinery** (Ralph 2026-06-10): the Consular is the master and admin of the SQL database — read-merge-write is his judgment, not a cage. The worst you can do is put limits on an ADMIN.

**Deps:** WP-20 (the contract) · WP-21 (tone + sections in the blobs) · WP-23 (the trigger writes them). No schema migration — JSON-blob extensions only.

### WP-23 — The Research button + Consular doctrine

_Reframed 2026-06-09. NOT "extend the Scout-taste agent" — that agent is **retired**. The button drops a directive into the Consular's existing chat stream; the same Consular that runs the OVERVIEW chat does the teardown and writes it back. No spawn, no fork, no second brain — the same module reached through one more door._

   **◐ BUILT, awaiting live verification** (2026-06-10, CD). Shipped: the route (`consular/research/route.ts` — escrow job `consular_research`, per-row dedup, start/done/RED-STICKY-fail beats), Kanban Scan wired (stamp kept), Scout gains **▸ Research** beside Re-Taste (un-scout keeps its own job), the `/crm` SSE→snackbar bridge (`subscribeApiEvents('__crm__')` → SnackbarProvider), and the § YOUR JOB tag entry in the agent file. **Not done, on purpose:** the jedi-scout retirement — it fires only after the first successful live teardown proves the Consular path (this WP's own sequencing rule). Cancel marks the escrow job but cannot abort an in-flight bridge turn — V1 limitation, the turn drains first.

_(2026-07-12 audit: unchanged — the research route is live on disk, but `agents/jedi-scout.md`, `submit_scout_verdict`, and the taste-route invocation are all still present. The retirement — and the WP-21 tag-enum deletion gated on it — remains open. Next concrete step: one successful live teardown, then delete the three.)_

#### What the button does

Pressing **Scan / Research** (Kanban `LeadDetail` or Scout `ScoutDossier`) POSTs the row id. A thin route injects one line into the Consular stream — `[OSKAR-SYSTEM RESEARCH-COMPANY] id=<…> name=<…> surface=<kanban|scout>` — exactly the way `[ASK-CONSULAR]` arrives today. The Consular runs its own tool loop (fetch every page, count sections, judge), writes back via the existing SQL tool, and reports through **snackbars** (the Scout/Kanban screens have no visible chat). In OVERVIEW the same directive needs no snackbar — the chat is visible.

#### Backend to build (so the button runs)

- **New route `app/api/admin/crm/consular/research/route.ts`** — accepts `{id, name, surface}`, injects the directive into the Consular session, returns immediately. The teardown runs **async** (60–120s) and **holds the `__crm__` session lock while it works — drafts and Ask-AI queue behind it; that is intended** (Ralph 2026-06-10). Abort signal + mid-loop snackbar progress.
- **Wire the existing Scan button** (`LeadDetail.tsx` `rescan` ~L868, and the Scout equivalent) to call this route instead of only stamping `intel_scan_at`.
- **`surface` routing** — tells the Consular which column to write (`raw_prospects.scout_json` vs `prospects.intel_json`) and that comms are snackbar-only.
- **Retire jedi-scout** — delete the agentic taste pass: `agents/jedi-scout.md`, `submit_scout_verdict`, and the agent invocation in `app/api/admin/crm/scout/taste/route.ts`. ⚠ Sequencing: `submit_scout_verdict` is TODAY's interim writer of `verdict_tag` (per `lib/verdict.ts` — the gap/heat derivation is already dead); it retires **together with** the taste route, only once the button routes the teardown to the Consular (who writes via SQL). Keep the deterministic capture (screenshots · DNS · PageSpeed · the 2026-06-06 lamps · FSP availability) running automatically.
- **Snackbar plumbing** — the route keeps the async session alive and delivers whatever the Consular narrates; the only fixed requirement is failure surfacing: if the tool loop dies, a red sticky snackbar fires so a crash never reads as a verdict that didn't come. What the beats say is the Consular's, not the route's.

#### Agent-file changes — `agents/CONSULAR-agent.md`

_Superseded 2026-06-10 (Ralph + CD, debug session). **The canonical § COLD-LEAD TEARDOWN was rewritten directly in `agents/CONSULAR-agent.md` and THAT FILE is the source of truth** — verdict colors (tone is the contract, tag is the Consular's words) · counting-the-rooms (sections × 200–300 ÷ heads) · two-ways-to-sell (full build vs OSKAR system, descend before you skip) · BUYING · Verfügbarkeit (three book-states, three arguments) · the pitch (the gap between what the site is and what they care about; the hook as the pitch's first line). The condensed ~25-line replacement that used to live in this WP is **dead — do not regenerate, condense, or "clean up" the agent file from this document.** The craft subsections (Wayback fingerprint · trackers · the two scores that lie · cite-it-or-don't-say-it) stay in the agent file untouched. Only the § YOUR JOB tag entry below still ships with this WP:_

**§ YOUR JOB — the tag entry becomes:**

```
`[OSKAR-SYSTEM RESEARCH-COMPANY] id=<…> name=<…> surface=<kanban|scout>` — Filippo pressed Scan/Research on a row. It's you, through one more door. Run the teardown (§ COLD-LEAD TEARDOWN) and write home through your own SQL tool — `prospects.intel_json` from Kanban, `raw_prospects.scout_json.taste` from Scout. From those screens the chat is invisible: the snackbar is your voice, and a failure says so in red.
```

**§ COLD-LEAD TEARDOWN** — already rewritten in the agent file (see note above); nothing ships from here.

_Two scars preserved for the record (history, not agent-file text):_
- _Wholesale tasting killed taste/exec/gap/heat: 44% of ~900 prospects landed on the identical 3/2 pair — millions of tokens to discriminate nothing. The columns carry PALAT and BUYING now; the old meanings are never written again. A score you can't defend per-prospect is noise wearing a number._
- _The Zolli dry run (2026-06-10): a Consular holding the whole doctrine counted 31 sections off a summarizer's band list and flipped its own anchors at the moment of use. Fluency is not verification — no number leaves the agent that it didn't read with its own eyes; "read" means read, not grepped. (This lesson lives in the agent file as "the walk IS the estimate" + the counter-override doctrine.)_

**Deps:** WP-20..22 (the contract, the fields, the renders). Once the button routes to the Consular, jedi-scout has no remaining consumer — safe to delete.

---

## §8 — CRM multi-machine sync

_Hub-and-spoke daily sync. Oskar-Webserver = master + hub; Ralph/Filippo laptops = spokes. The local events.jsonl/replay layer exists (`lib/crm-boot.ts` / `crm-replay.ts`)._

_(2026-07-12 audit: **WP-28 shipped** (2026-06-19) with a deliberately simpler shape — append-only per-node logs + whole-artifact tar, no LWW, no conflict table. That covers the daily need. **WP-24..27 are superseded candidates**: the LWW/merge-conflict machinery only earns its ~1,000 LOC if two machines actually edit the same prospect field concurrently — a pain that hasn't appeared. Un-gate on that trigger, not before; until then this is Darth Scaffolder territory.)_

### WP-24 — Sync architecture spec + Oskar-Webserver setup runbook

**Problem.** Before any sync code runs, the server side needs to be provisioned and the spokes need to know where to send their events. This WP is the deployment runbook + env-var contract, NOT Next.js code.

**Architectural decision.** Oskar-Webserver = the existing Namecheap hosting that already serves the public vibes pages. **No VPS provisioning.** OskarOS stays on Namecheap; the sync hub role gets added to the existing Next.js deployment. Clients wanting Swiss-resident hosting are recommended to use **Infomaniak** (Geneva-based, full CH data sovereignty) for their own deployments — that's a per-client recommendation, not the master hosting story. CRM database on the server has the same SQLite shape as laptops (no Postgres, no managed DB), lives at `oskar-prototype/db/crm.db`.

**Scope.**
- Define server's `oskar-prototype/` layout. Same root as laptops; `db/whatsapp/` is absent on the server (no WhatsApp socket).
- Define spoke `.env.local` contract:
  - `OSKAR_SYNC_SERVER_URL` (e.g., `https://oskar.example.ch`)
  - `OSKAR_SYNC_TOKEN` (shared bearer; one value across all three machines)
  - `OSKAR_NODE_ID` (`ralph-mac` / `filippo-mac` / `server`; identifies which events log this machine writes to)
- Define server's `.env.local`: same shared `OSKAR_SYNC_TOKEN`, `OSKAR_NODE_ID=server`.
- Operator runbook: how to wire up env vars on the Namecheap deployment, project root path on the host, sync token rotation procedure across all three machines, Infomaniak recommendation rationale for CH-resident clients.
- **No code changes in this WP** — design + runbook artifact only.

**Files affected.**
- `docs/sync-runbook.md` (NEW, ~120 LOC) — server provisioning + spoke setup + token rotation.
- Three `.env.local.example` updates (server + Ralph + Filippo) — documented as templates, no real tokens committed.

**Acceptance.**
1. Following the runbook on a fresh Namecheap deployment configures the server in <30 minutes.
2. Token rotation procedure works without sync downtime (rotate spoke 1, rotate spoke 2, rotate server, ≤5 min interruption).
3. Infomaniak recommendation includes the auth+data-sovereignty rationale a client can quote.

**LOC.** ~120 LOC of runbook docs + three env.local.example files. **Difficulty.** Low — design + ops work. **Deps.** None — can be done before/during/after any of WP-25..27.

### WP-25 — Sync HTTP endpoints (events + media + public)

**Problem.** Spokes need a way to push their new events + new media + new vibes to the server, and pull what they don't yet have. The endpoints run on the same Next.js process that already serves the rest of OskarOS — same auth model, same deployment unit, same logs.

**Architectural decision.** Six endpoints split into three pairs (events, media, public). Each pair is `upload` (POST, spoke → server) + `download` (GET, server → spoke), plus two manifest endpoints for diff computation. All gated by bearer-token check against `OSKAR_SYNC_TOKEN`. Content-addressed where possible (media by `<sha256>`; events by `(node, lamport)`; public files by `(path, mtime+size)` because vibes are HTML files where the path is load-bearing for client-facing URLs).

**Endpoints.**
```
POST /api/sync/events/upload
  body: { node, events: Event[], cursor?: { lamport: number } }
  → { accepted: N, server_cursor: number }

GET  /api/sync/events/download?since=<lamport>&exclude_node=<self>
  → { events: Event[], cursor: { lamport: number } }

POST /api/sync/media/upload
  body: multipart — { hash, mime, bytes }
  → { stored: bool, already_present: bool }

GET  /api/sync/media/manifest?since=<unix_ts>
  → { items: [{ hash, mime, size, first_seen_ts }] }

GET  /api/sync/media/download/<sha256>
  → binary blob with correct Content-Type

POST /api/sync/public/upload
  body: multipart — { relative_path, mtime, bytes }
  → { stored: bool }

GET  /api/sync/public/manifest?since=<unix_ts>
  → { items: [{ relative_path, mtime, size }] }

GET  /api/sync/public/download?path=<relative_path>
  → binary blob (with path-traversal guard)
```

**Scope.**
- All endpoints under `app/api/sync/`, gated by `validateSyncToken(req)` helper that reads `Authorization: Bearer <token>` and compares **in constant time** against `OSKAR_SYNC_TOKEN`.
- Events upload writes received events to `db/events/inbound/events-<node>.jsonl` on the server (server's projection rebuild then picks them up).
- Events download returns the union of `db/events/events-server.jsonl` + every `db/events/inbound/events-*.jsonl` EXCEPT the requester's own (avoids echo loops), filtered by `lamport > since`.
- Media upload writes binary to `media/<sha256>.<ext>` if not already present (idempotent — same hash = same file). Returns `already_present: true` so spokes can skip retransmits.
- Public upload writes to `public/<relative_path>` with **strict path-traversal guard**: `relative_path` must not contain `..`, must be relative, must resolve inside `public/`. Guard: `path.resolve(publicDir, relative_path).startsWith(publicDir + '/')` else 400.
- Manifest endpoints serve the "what do you have that I don't" diff query.

**Files affected.**
- `app/api/sync/events/upload/route.ts` (NEW, ~80 LOC)
- `app/api/sync/events/download/route.ts` (NEW, ~60 LOC)
- `app/api/sync/media/upload/route.ts` (NEW, ~80 LOC)
- `app/api/sync/media/manifest/route.ts` (NEW, ~40 LOC)
- `app/api/sync/media/download/[hash]/route.ts` (NEW, ~50 LOC)
- `app/api/sync/public/upload/route.ts` (NEW, ~80 LOC including path-traversal guard)
- `app/api/sync/public/manifest/route.ts` (NEW, ~40 LOC)
- `app/api/sync/public/download/route.ts` (NEW, ~50 LOC including path-traversal guard)
- `lib/sync/auth.ts` (NEW, ~30 LOC) — `validateSyncToken` constant-time compare.
- `lib/sync/manifests.ts` (NEW, ~60 LOC) — read local events/media/public dirs, return manifest shape.

**Acceptance.**
1. Bearer auth: requests without `Authorization: Bearer <correct-token>` return 401; with correct token → 200.
2. Path traversal attempts: `../../../etc/passwd`, URL-encoded variants, null bytes — all 400, NEVER serve outside `public/`.
3. Media dedup: uploading the same file twice returns `already_present: true` the second time; only one copy on disk.
4. Echo guard: spoke A uploads events; downloading with `exclude_node=A` returns A's events EXCEPT… actually filtered out (verify by checking returned event nodes).
5. Auth comparison timing: comparing a wrong token vs comparing a partial match takes within ±10% wall-clock (constant-time compare working).

**Risks.**
- **Path traversal in public/ is the highest-risk surface.** Hard guard + unit tests with attacker inputs (path injection, URL-encoded `..%2F`, null bytes, absolute paths). Test before merge.
- **Auth timing leak.** `===` compare leaks the prefix; use `crypto.timingSafeEqual` or equivalent.

**LOC.** ~570 LOC across 10 files + ~150 LOC of tests for path-traversal + auth surfaces. **Difficulty.** Medium — most of the LOC is mechanical. The security surfaces are the test-burden. **Deps.** events/replay layer (already shipped — `lib/crm-boot.ts` / `crm-replay.ts`), WP-24 (env-var contract documented).

### WP-26 — Spoke-side `npm run sync` + LWW merge for prospects

> **🚧 BLOCKER:** Cron-vs-button-only for spokes (§11 D6) must be resolved before this WP starts coding. (a) Does the spoke run a daily cron in addition to the manual "Sync now" button? (b) If yes, what time of day, and does the cron run on every spoke or only opt-in machines?

**Problem.** Spokes need a command that performs a full sync round-trip: push what's new locally, pull what's new from the server, replay incoming events into the local SQLite with the LWW merge rule for `prospects` field updates, log conflicts. Triggered via "Sync now" button in admin Settings (and optionally cron, per blocker).

**Architectural decision.** Sync runs in 6 steps, idempotent at every boundary. If any step fails, the next sync run picks up where the cursor left off — no partial-state corruption possible.

**Sync steps.**
```
1. Load cursors from local SQLite (last_pushed_event_lamport, last_pulled_event_lamport,
                                   last_media_manifest_ts, last_public_manifest_ts)
2. Push events: GET local events.jsonl past last_pushed_event_lamport → POST upload → update cursor
3. Push media: walk local media/ → GET server manifest → POST upload for each hash not on server
4. Push public: walk local public/{session-dirs} → GET server manifest → POST upload for each
                path with newer mtime or absent on server
5. Pull events: GET download?since=last_pulled_event_lamport → append to db/events/inbound/ →
                replay into local SQLite with LWW for prospects field updates → log conflicts to
                merge_conflicts table → update cursor
6. Pull media: GET manifest?since=last_media_manifest_ts → GET download for any missing hash →
               update cursor
7. Pull public: same shape as media — manifest diff → download missing → write to local public/
```

**LWW merge logic (the only smart code in the system).**
```
For each pulled event in (lamport, node) order:
  if event.entity == 'activity':
    INSERT INTO activities (...) ON CONFLICT(id) DO NOTHING
    // activities are append-only; superseding events handled at projection time
  if event.entity == 'prospect' and event.op == 'update':
    current = SELECT * FROM prospects WHERE id = event.entity_id
    if current[event.field + '_last_event_lamport'] is NULL or current[...] < event.lamport:
      UPDATE prospects SET <field> = event.next, <field>_last_event_lamport = event.lamport,
                          <field>_last_event_node = event.node WHERE id = event.entity_id
    else if current[event.field + '_last_event_lamport'] > event.lamport:
      INSERT INTO merge_conflicts (...)  // losing event preserved
    else if current[...] == event.lamport and current[...]_node < event.node:
      // tied lamport, smaller node-id wins (deterministic); larger node-id event = loser
      INSERT INTO merge_conflicts (...)
```

The `<field>_last_event_lamport` / `<field>_last_event_node` columns are per-field tracking on `prospects`. Schema cost: +2 columns per editable field. Worth it — without per-field tracking, two simultaneous edits to DIFFERENT fields of the same row look like a row-level conflict and one edit gets dropped.

**UI surface.**
- "Sync now" button in admin Settings → next to "Last synced: 2026-05-25 14:32, 12 events pushed, 47 events pulled, 0 conflicts."
- Optional cron: `crontab -e` → `0 6 * * * cd ~/OskarOS/oskar-prototype && npm run sync` runs at 6 AM local. Documented in WP-24's runbook, not auto-installed.

**Files affected.**
- `scripts/sync.ts` (NEW, ~250 LOC) — npm run sync entrypoint; implements the 7-step pipeline.
- `lib/sync/cursors.ts` (NEW, ~40 LOC) — read/write cursor state from SQLite.
- `lib/sync/merge.ts` (NEW, ~120 LOC) — LWW logic for prospects + conflict logging.
- `lib/sync/replay.ts` (NEW, ~80 LOC) — apply pulled events to local SQLite projection.
- `lib/crm-store.ts` (~50 LOC delta) — per-field tracking columns on prospects; surface through existing read API.
- `public/admin.html` (~80 LOC delta) — "Sync now" button + status display.
- `app/api/admin/sync/run/route.ts` (NEW, ~30 LOC) — admin endpoint invoking `scripts/sync.ts` via child_process.
- `package.json` — `"sync": "tsx scripts/sync.ts"` npm script.

**Acceptance.**
1. Two simultaneous edits to DIFFERENT fields of the same prospect (Ralph edits stage, Filippo edits owner_name) → both land; no conflict; both spokes converge.
2. Two simultaneous edits to the SAME field → later lamport wins; earlier preserved in `merge_conflicts`.
3. Tied lamport (same physical clock tick on two spokes) → deterministic resolution by node-id sort; losing event in conflicts.
4. Sync run interrupted at step 4 → next run picks up at step 4 cursor with no data loss / no duplicate uploads.
5. 10+ hand-constructed conflict scenarios pass.

**Risks.**
- **LWW merge is the only place in the entire system where "correctness under concurrent writes" is on the line.** Test rigorously.
- **Misordered events.** Events arriving out of (lamport, node) order can produce wrong projections — replay MUST always sort before applying.

**LOC.** ~650 LOC across 8 files + ~250 LOC of merge tests with 10+ conflict scenarios. **Difficulty.** Medium-high — LWW correctness is the load-bearing piece. **Deps.** WP-25 (endpoints exist); events/replay layer already shipped (`lib/crm-boot.ts` / `crm-replay.ts`). **Blocker:** §11 D6 (cron-vs-button) must resolve first.

### WP-27 — `merge_conflicts` table + admin UI surface

**Problem.** LWW silently picks a winner. Without UI, the losing edit is invisible — Filippo never knows his stage change got overwritten by Ralph's. The `merge_conflicts` table preserves every loser; this WP makes them visible and overridable.

**Scope.** New admin tab "Sync conflicts" lists every row in `merge_conflicts` with: detected timestamp, entity, field, winner (value + actor + ts), loser (value + actor + ts), and an "Apply loser as new write" button. Clicking creates a NEW event with current timestamp that overwrites the field — re-fires through the normal event log, propagates to all other machines on next sync.

**Schema.**
```sql
CREATE TABLE merge_conflicts (
  id              TEXT PRIMARY KEY,
  detected_ts     TEXT NOT NULL,
  entity          TEXT NOT NULL,   -- 'prospect' (only LWW entity today)
  entity_id       TEXT NOT NULL,
  field           TEXT NOT NULL,
  winner_value    TEXT NOT NULL,
  winner_ts       TEXT NOT NULL,
  winner_node     TEXT NOT NULL,
  winner_actor    TEXT NOT NULL,
  loser_value     TEXT NOT NULL,
  loser_ts        TEXT NOT NULL,
  loser_node      TEXT NOT NULL,
  loser_actor     TEXT NOT NULL,
  loser_event_id  TEXT NOT NULL,   -- original event line overridden
  status          TEXT NOT NULL    -- 'unreviewed' | 'accepted-winner' | 'overridden-to-loser'
                  DEFAULT 'unreviewed',
  reviewed_ts     TEXT,
  reviewed_by     TEXT
);
```

**UI.**
- New "Sync conflicts" tab in admin Settings next to "WhatsApp."
- Default: filtered to `status = 'unreviewed'`, sorted by detected_ts desc.
- Each row: prospect link → opens lead detail panel; field diff (winner vs loser side by side); "Accept winner" (marks status); "Apply loser" (creates new superseding event, marks status).
- Filter chips: All / Unreviewed / Accepted / Overridden.
- Empty state: "No sync conflicts." (Most of the time this is the case.)

**Files affected.**
- `lib/crm-store.ts` (~40 LOC delta) — schema add + `readMergeConflicts`, `markConflictAccepted`, `applyLoser` functions.
- `app/api/admin/sync/conflicts/route.ts` (NEW, ~50 LOC) — GET list, PATCH single row to accept/override.
- `public/admin.html` (~250 LOC delta) — Sync conflicts tab + list + accept/override buttons.

**Acceptance.**
1. After a conflict-producing sync, "Sync conflicts" tab shows the row with winner + loser fields.
2. "Apply loser" creates a new event; next sync propagates the override; on the other machine, that prospect's field reflects the override.
3. Filter chips work; empty state renders correctly when no unreviewed conflicts.

**LOC.** ~340 LOC across 3 files. **Difficulty.** Low — read-mostly UI; the "Apply loser" mutation re-uses the existing event-log append path. **Deps.** WP-26.

### WP-28 — SYNC admin panel: CRM · Session · Codebase, each with a diff indicator  ✅ IMPLEMENTED 2026-06-19 (part 2)  _(merges old WP-28 + WP-BUG-BUILD-SKEW — Ralph 2026-06-19)_

**Final design (Ralph, 2026-06-19): THREE buttons, each with an in-sync/diff indicator.** ONE "SYNC" card in the gated `admin.html` (Settings → COL 2, above the xlsx fallback card). Each row = a coloured dot + a 1-sentence diff + an action button. Dot: **green** = both ends identical · **amber** = drift (+ the diff sentence) · **grey** = hub unreachable / this machine is the hub. Polled every 15s while Settings is active (mirrors the WhatsApp poll).

**Button A — Sync CRM** = **DB contents + Scout screenshots, nothing else.** **NEVER WhatsApp/email** (hard rule). Non-destructive by construction: the event log is append-only + single-owner per node (`events-<node>.jsonl`), so PUSH overwrites the hub's stale copies of files we own (ours ⊇ theirs) and PULL only fetches hub-authored files we lack — a stale remote copy can never clobber a file we author. Then restart hub workers → `crm-boot` `incrementalReplay` re-derives the SQLite projection. Scout captures (`public/__scout__/`) ship additively; `public/_whatsapp/` is never in the tar. Script: `scripts/sync-crm.sh`. Indicator diffs per-node lamport high-water + screenshot counts.

**Button B — Sync session folder** = a **dropdown (one session at a time)** + push. Session folders (`public/<id>/`) are studio build outputs authored on the spoke; the action is a one-way ADDITIVE push (GNU-tar → server-side extract, **no `--delete`**). Script: `scripts/sync-session.sh <id>`. Indicator diffs the file manifest (only-local / only-server / differ, with newer-on-server count). _(Ralph: do NOT sync Barbazza or Silke-Lengler folders yet — the dropdown lists them but they're held back.)_

**Button C — Sync Codebase** = the heavy one (full build + ship). Absorbs **WP-BUG-BUILD-SKEW**. **The bug:** rsync/scp/default-tar transfer MODIFICATIONS but SILENTLY DROP brand-new files — esp. the new `[root-of-the-server]__<hash>._.js` turbopack chunks — because macOS bsdtar's default *pax* format mangles the `[...]` filename so the server's GNU tar can't recreate it (network-upload transport intercepted by Imunify360/cPanel scan also contributes; server-side writes persist). **Fix (shipped):** build off-box in an isolated copy → `COPYFILE_DISABLE=1 tar --format=gnutar` the WHOLE `.next` → **server-side `tar -x`** → restart — never rsync the delta. Plus a **route-parity gate** (every `app/**/route.ts` must be in the artifact; fail loudly) and a `.next/DEPLOY_VERSION` stamp so the indicator can report the deployed version. Script: `scripts/deploy-server.sh`. Indicator shows **a version number + a sentence** (`local <hash>+dirty vs server <hash>, deployed <ts>`), per Ralph's "codebase a version number plus sentence".

**Read-only indicator layer (the "both ends the same?" requirement).**
- `lib/sync/state.ts` — `crmState()` / `sessionState(id)` / `listSessions()` / `codebaseState()` + `diffCrm/diffSession/diffCodebase → { inSync, sentence, localVersion?, remoteVersion? }`. Zero mutation.
- `GET /api/admin/sync/state?target=crm|session|codebase[&id=]` — each machine reports ITS OWN state (the remote reads this).
- `GET /api/admin/sync/status?target=crm|session|codebase|sessions[&id=]` — the spoke computes local + fetches the hub's (`OSKAR_SYNC_HUB`) + diffs → the indicator. `target=sessions` returns the dropdown list. Never throws — hub-unreachable surfaces as a grey "hub unreachable" indicator.

**Mutating layer.** `POST /api/admin/sync/run?target=…[&id=]` runs the per-target script. **Guard:** only the spoke (the machine with `OSKAR_SYNC_HUB` set) runs syncs; the hub refuses (no deploy key, would sync to itself).

**Hub vs spoke.** Spoke = local Mac, `OSKAR_SYNC_HUB=https://awesome-ux.ch` in `.env.local`. Hub = server, env unset (→ "this machine is the hub"). `.env.local` is git-ignored so the deploy never ships it — the role stays per-machine.

**Files (shipped).**
- `lib/sync/state.ts` (NEW) · `app/api/admin/sync/{state,status,run}/route.ts` (NEW)
- `scripts/sync-crm.sh` · `scripts/sync-session.sh` (NEW) · `scripts/deploy-server.sh` (+DEPLOY_VERSION stamp)
- `public/admin.html` (SYNC card + indicator poll + `syncRun`) · `.env.local` (`OSKAR_SYNC_HUB`)

**Acceptance.**
1. Settings tab open → status card shows current state, updates every 5s.
2. Network down → server_reachable shows red within 5s of failure.
3. Pending counts reflect reality: push 12 events → counter says 12 until next sync.
4. Last error displays when present, hides when null.

**LOC.** ~260 LOC across 3 files. **Difficulty.** Low — read-only telemetry. **Deps.** WP-26 (cursors written), WP-27 (merge_conflicts table for unreviewed count).

---

## §9 — Productization verticals

_Track C. Vertical #1 = Swiss law-firm websites (offer CHF 25-40k yr1). Specs deferred to per-feature sub-docs; file manifests defer until a customer commits._

### WP-29 — SEO Optimization Layer

**This is a layer, not a feature.** Five subcomponents:

**Per-page SEO panel in Director Mode** — title, meta description, OG image, canonical, robots, schema type. Override anything per page; sane auto-generated defaults.

**Schema designer** — pick a type (`LegalService` / `Article` / `FAQPage` / `HowTo` / `Person` / `LocalBusiness`), get a form for fields, output a clean unified `@graph` JSON-LD block. What RankMath sells as Pro feature; we ship native.

**Sitemap + robots + redirects auto-generation** — including a redirects panel for migrating customers off WP (301 from `/anwalt/strafrecht` → new URL).

**Validation at publish time** — single H1, schema validates against schema.org, hreflang reciprocity, no orphan pages, no broken internal links. **Block publish on hard errors, warn on soft.**

**Programmatic-SEO bulk generate** — CSV (practice area × city × intent) → N pages, all with SEO panel auto-filled per row. **Unfair-advantage piece versus WordPress.**

**Math for FF (Falconieri Freedom):** 7 practice areas × ~80 ZH/AG/SH cities × ~6 user-intent variants = **~3,400 unique landing pages.** Each ranking for one specific local-intent long-tail query.

**Pipeline.**
- Template engine: row → HTML page with locally-targeted copy, FAQ block, schema (`LocalBusiness` + `LegalService` + `FAQPage`), internal links.
- Content generation: Opus/Sonnet writes body, partner reviews 50-100/month for legal accuracy, rest auto-publish.
- Static HTML output to `/orte/`, `/themen/`, or subdomain — bypasses Elementor entirely.
- Monthly drift detection: Google Search Console API → climbing pages refreshed, stagnant regenerated.

**Aequitas variant:** same engine tuned to authority-building (100-200 high-density pages on FINMA-Verfahren / internationale Rechtshilfe / Trust-Recht CH-IT).

**Spec target.** `FEATURE-X-SEO.md` (per-feature sub-doc, written when this WP kicks off).

**LOC estimate.** ~1.5 weeks development. **Difficulty.** Medium. **Deps.** None at OskarOS code level; per-customer at content level.

### WP-30 — Multilingual Layer

**Problem.** OskarOS already has multi-language vibes (FalCaMel ships IT/DE/FR/EN). What's missing is the **structural** layer that turns parallel vibes into an actually-multilingual *site*.

**The piece WPML charges CHF 100/year for and gets wrong half the time.** Doing it native and right is a real moat for the CH market — every Swiss professional-services site needs at least DE/FR or DE/IT, often all four.

**Components.**

- **Language family model.** Pages know they're variants of one canonical post. `/de/strafbefehl` ↔ `/it/decreto-d-accusa` ↔ `/fr/ordonnance-penale` ↔ `/en/criminal-order` linked **at the data level**, not just by URL parallelism.
- **Hreflang generation.** `<link rel="alternate" hreflang="de-CH" href="…">` for every variant on every page, including `x-default`. Generated from family graph at build time.
- **Translation pipeline.** Author writes DE → OskarOS auto-drafts IT/FR/EN → partner reviews each → publish all together OR independently. **DE source change prompts refresh others with diff preview.**
- **Language switcher widget.** Drop-in, pulls variant URLs from family graph. Falls back gracefully when variant doesn't exist.
- **Per-language sitemap + canonical handling** so Google doesn't penalize duplicate content across language paths.

**Spec target.** `FEATURE-X-MULTILINGUAL.md`.

**LOC estimate.** ~2.5 weeks. **Difficulty.** Medium-high — family-graph model + hreflang correctness has many edge cases. **Deps.** None at OskarOS code level.

### WP-31 — Blog (multilingual)

Two parts, cleanest if built together.

**Authoring loop.** "+ New Post" UI in Director Mode. Markdown editor (block-style nicer; markdown faster). Cover image (uses image pipeline), slug, excerpt, tags, category, author, publish date, status. Inherits design from chosen blog template vibe. Saves to disk, regenerates `/blog/index`, tag/category pages, RSS feed, redeploys.

**Multi-language sync (rides on WP-30).** Author writes DE post → OskarOS auto-drafts IT/FR/EN → partner reviews each in side-by-side mode → approves or edits. Hreflang per post. Index/tags/RSS feed per language.

**Schema integration.** Author schema (`Person` linked to attorney bio) and Article schema (`author`, `datePublished`, `dateModified`, `keywords`) drop in **automatically** because WP-29 already supports per-template schema.

**Architectural baseline.** Posts are HTML files (Option 1 of three architectures considered — markdown source and block-composition both rejected per the design-ceiling and editor-reuse constraints). Editor = existing Director Mode. Listing reuses gallery endpoint with a `parentDir` filter. AI augmentation goes through Next.js API routes calling CD/Sentinel Ti bridges, NOT through MCP tools (blog actions are user-initiated, not agent-callable; MCP overhead is dead weight here). Deploy is single-server stage→deploy via local rsync to webserver's document root.

**Sub-decomposition + DECIDE-A..J resolutions:** `docs/wp-31-blog-decomposition.md` (filesystem layout, sidecar shape, permalink rule, index regen trigger, authoring surface, master-template-only-one-template decision, etc.).

**Spec target.** `FEATURE-X-BLOG.md` (umbrella).

**LOC estimate.** ~2 weeks. **Difficulty.** Medium. **Deps.** WP-30 (multilingual layer for the i18n leg).

### WP-32 — AI-Overview / SGE optimization

**Thesis:** increasingly users don't click through to law-firm websites — they ask Claude / ChatGPT / Gemini / Google AI Overview. **The new SEO is getting cited by AI, not ranked by Google.**

**What OskarOS builds.**
- **Audit tool** — scan existing posts + practice areas, score each on AI-citability, output prioritized fix list.
- **Remediation engine** — rewrite each piece into AI-overview-ready format (TL;DR top, explicit Q&A, BGE-number citations, author byline schema, FAQ schema).
- **Wikidata + Knowledge Graph push** — get partners onto Wikidata as `Q[id]` entities (`instance of: human`, `occupation: lawyer`, `member of: Swiss Bar Association`). **What makes AI confident enough to cite a person.**
- **Monthly tracking** — query major LLMs with target queries → measure firm citation rate → iterate.

**Pricing reference:** CHF 12k-20k initial + CHF 800-1,500/mo ongoing tracking.

**For Aequitas more important than for FF:** peer-reviewed publications are gold for AI citation if structured + open-access.

**Spec target.** `FEATURE-X-AIOVERVIEW.md`.

**LOC estimate.** ~2-3 weeks. **Difficulty.** Medium-high — Wikidata push + LLM-citation tracking are novel infrastructure. **Deps.** WP-29 (SEO layer) for the schema substrate; WP-30 (multilingual) for per-language tracking.

### WP-33 — Static-shadow layer

**Migration tool for hybrid customers.** Customer keeps WordPress for editing; OskarOS serves Googlebot pre-rendered static via Cloudflare Worker / BunnyCDN / Vercel Edge dynamic-rendering. Real users get WP frontend; Googlebot gets clean static.

**Impact:** TTFB 1.6s → 150ms. LCP 3.5s → 0.8s. DOM 1,268 → 200.

Google-approved pattern. Used legitimately by every major SaaS that needs WP for CMS but can't afford SEO weight.

**Pricing reference:** CHF 8k-12k initial + CHF 100/mo edge hosting.

**Note for greenfield customers:** this layer is *unnecessary* — WP-29 already outputs static HTML. **Migration-only.**

**Spec target.** `FEATURE-X-SHADOW.md`.

**LOC estimate.** ~2 weeks. **Difficulty.** Medium — edge worker auth + cache invalidation are the load-bearing pieces. **Deps.** None at OskarOS code level.

---

## §10 — Deferred (trigger-gated)

### WP-34 — Skill-folder shape decision
**Trigger:** Multi-tenant productization push. The current single-folder `skills/` won't survive per-tenant scoping cleanly; need to decide on namespacing before WP-02 ships.

### WP-35 — Brand Library View (gallery + ZIP export)
**Trigger:** Customer ask. Today brand assets are scattered across session folders; customers haven't yet asked for a unified gallery view + downloadable kit.

### WP-36 — Persistent bus + bridge replacement

SQLite bus at `public/{session}/.cache/bus.sqlite` + per-agent MCP daemons replacing the `claude --print` subprocess. **Violates "Files ARE the agent API" doctrine** — a database breaks the bus by definition. ~970 LOC + ~80 LOC spike.

**Trigger:** globalThis-based bus actually breaks in production traffic (concurrent connections cause race conditions), OR a Next.js-restart-loses-state cost shows up in real workflows (today it doesn't — Option A sidecar at `.runtime/active-session` covers session-switch pain). Until then: not needed.

### WP-37 — Replay test framework

~640 LOC capture middleware + JSONL storage + deterministic replay runner + golden snapshot diff. Intended to make regressions reproducible above the unit-test layer.

**Trigger:** a "reproduce yesterday's crash" workflow actually appears in real debugging AND the cost of manual repro is documented (today Ralph's bug-find rate is fast enough that manual repro hasn't been a bottleneck). Until then: Darth Scaffolder — building for imagined need.

### WP-38 — Death Protocol generalized

Lift Order 66 / Order 65 / Sage 240 cut / bridge respawn under one `serializeContext()` + `bootFromContext()` contract. Every agent provides the two methods; death triggers become pluggable consumers. ~400 LOC + per-agent retrofit.

**Trigger:** 6th agent surfaces (today: CD / WebDev / Sentinel Ti / Sage / Scout = 5), OR a serialize bug bites in production. Until then: ad-hoc per-incident handling stays; the framework would be indirection without payoff.

### Non-WP deferred items

| Item | Trigger to un-defer |
|---|---|
| Open-design original skills (magazine-poster + image-poster + social-carousel) | FF or Aequitas commits to brand-asset deliverables. |
| Lewislulu html-ppt-skill (31 layouts + runtime + themes) | Deck output as a real customer deliverable. |
| Z.ai weekly-limit operational finding | Cross-doc to INSTITUTIONAL-MEMORY.md (note, not code). |

---

## §11 — Open decisions

1. **`docs/ARCHITECTURE-REDESIGN.md` close-out.** *Trigger: any plan-cleanup pass.* ~7 KB legacy proposal. Mark `[SUPERSEDED]` and link to current architecture, OR migrate live items into Feature-X. One read-and-decide session.
2. **Multi-tenant timing + pillar order.** *Trigger: first paying customer commits.* Track A (productization arc — §2 WP-02/03/04) before Track C (customer-funded — §9), or fork single-tenant for first paying customer and defer multi-tenant?
3. **BYOK vs OskarOS-fronted billing.** *Trigger: first paying customer commits.* BYOK is faster, lower-liability, lower-margin. OskarOS-fronted unlocks higher pricing but needs Anthropic enterprise terms + billing infra. Pick one, or ship BYOK first and add fronted as paid-tier upgrade.
4. **Death Protocol generalization (WP-38).** *Trigger: 6th agent surfaces, or a serialize bug bites.* Framework wins as N agents grow past 5; ad-hoc wins if N stays small.
5. **Brand-lint v2 perceptual diff (WP-13).** *Trigger: pixel-fidelity regression bites in production.* Adds ~10 MB ONNX model dep — first non-trivial native ML dep on the deploy bus. Confirm before take-on.
6. **Sync cron vs button-only (WP-26).** *Trigger: WP-26 implementation kickoff.* Daily cron in addition to manual button? If yes, what hour, opt-in per machine?

---

## §12 — Live-server deploy + Studio publish pipeline

_Track A-Ops. Added 2026-06-19 after the first real cPanel/Namecheap ("Oskar-Webserver", §8 WP-24) push: **barbazza.wine** shipped live with a dedicated `barbazza-api` Node app; **silke-api** staged; the **webbuilder** Next standalone serves awesome-ux.ch. The deploy worked ~99% but the system is brittle — this chapter is the hardening + the real publish pipeline. **CD-agent view:** it's all one directory per session; the entire stage/live duality lives in this layer, invisible to the agent._

**Status — this session**

```
✅ DONE      🔴 ASAP-prod      🟡 next      ⏸ upstream/wait
```

| Item | State | Note |
|---|---|---|
| barbazza.wine contact form → live | ✅ | Option A: isolated cPanel Node app `barbazza-api` at `barbazza.wine/api` (no PHP, no shared process). Verified delivering to Marin@barbazza.wine, sent as postmaster@. |
| `silke-api` (silke-lengler.ch contact) | ✅ staged | turnkey in `deploy/silke-api/` + `DEPLOY.md`; fill one SMTP password on domain launch. |
| `admin.html` access gate | ✅ | HTTP Basic Auth — `~/webbuilder/public/.htaccess` + `.htpasswd`, user `Ralph`. Survives app restarts; independent of the app. |
| webbuilder crash guard | ✅ partial | process-level `unhandledRejection`/`uncaughtException` guard on deployed `server.js`, verified catching the Baileys timeout storm while the app keeps serving 200s. **Gaps → WP-BUG-WHATSAPP-RECONNECT.** |
| nano-banana 2K image-compose → beige | ⏸ upstream | root-caused: Google's earlier Nano Banana preview model returns `IMAGE_RECITATION`/degraded beige for **2K image-edit**; **1K works**. Decision: wait for Google, **no workaround**. Cross-ref WP-18; memory `nano-banana-2k-compose-upstream-bug`. |
| Studio pages render error overlay | ✅? | **WP-BUG-PAGE-OVERLAY** — no repro since part-2; confirm once, then close. |
| stage↔live publish + rollback | ✅ | **WP-DEPLOY superseded** — shipped as Webserver Sync (`app/api/site/*` + `lib/site/*`, one-sidecar backup). |
| restart-Node-app control | 🔴 | **WP-OPS-RESTART** — top remaining §12 build item. |
| deploy build/source parity | ✅ | **WP-BUG-BUILD-SKEW** → WP-28 Button C, shipped (`deploy-server.sh`). |
| scout workers don't run on server | ✅ code | **WP-BUG-SCOUT-WORKERS-SERVER** — child-process capture shipped (`lib/capture-spawn.ts`); verify one batch on the box. |
| MCP bridge "flapping" (`fetch failed`) | ✅ | part-2: `orch` name collision (project `.mcp.json` stdio vs generated HTTP) — fixed via `--strict-mcp-config` + portable `.mcp.json`. Memory `oskar-bridge-mcp`. |
| WhatsApp reconnect STORM (2s hammer) | ✅ | part-2: → single 5-min semi-auto reconnect in `wa-runtime.ts` (uncommitted). Storm stopped. |
| WhatsApp server `:39` won't SUSTAIN | 🔴 | reaches `open` but `uploadPreKeysToServer` 408→428→0 activity. Likely el8 host. Mac `:38` handles WhatsApp today. → WP-BUG-WHATSAPP-RECONNECT part-2. |
| Scout capture (puppeteer EEXIST) | ✅ code | fixed via `lib/capture-spawn.ts` child process; server verification pending. |
| deploy of NEW files (routes/chunks) | ✅ | fixed — whole-artifact server-side `tar -x` in `deploy-server.sh` (WP-28 Button C). |
| flight-deck.jsx render host on server | ✅ | part-2: was missing on the box; re-deployed via server-side `cat`. |
| fonts pull from Google (build + runtime) | 🟡 | → WP-BUG-FONTS-GOOGLE (self-host). |
| FlightDeck loads 3 MB Babel from unpkg | 🟡 | → WP-BUG-FLIGHTDECK-BABEL (vendor / pre-compile). |

### WP-DEPLOY — Studio↔Live publish pipeline (deploy-to-live + restore-from-live + rollback)

**✅ SUPERSEDED (2026-07-12 audit) — the need shipped as Webserver Sync.** `app/api/site/{connect,list,compare,sync,config}` + `lib/site/*` + `components/studio/WebserverSync.tsx` publish a session dir to its live docroot over FTPS/FTP/local-file, with one-sidecar backup-on-overwrite as the restore story (`docs/webserver-sync-spec.md` §10, locked — dumb backup > clever caution). The CRM's `POST /api/admin/deploy` placeholder stays AS IS by design (activity-row contract for Status→Won). **Do not build the snapshot/rollback machinery below alongside the shipped sync layer** — if multi-version rollback ever becomes a real customer need, that's a new WP extending `lib/site/`, not this one.

**Problem.** The CD agent and the end-user edit a customer site in ONE directory — the session dir `public/<session-id>/` inside Studio (the oskar app on awesome-ux.ch = **stage**). The customer's **live** site is a *separate* cPanel docroot (`~/barbazza.wine/`, `~/silke-lengler.ch/`, …). There is no controlled path between them: no publish, no versioned backup, no rollback, and no way to pull live back into stage. The existing `POST /api/admin/deploy` (`app/api/admin/deploy/route.ts`) is a placeholder that writes a CRM `delivery_started` Activity row and returns `queued` with **zero disk side-effects** — and the CRM already fires it on Status→Won. If an end-user breaks their site, there is no "get it back."

**Scope.**
- **Deploy → Live.** Publish the current stage session's built output to its mapped live docroot, snapshotting the previous live first so every publish is reversible, applied atomically (never a half-written live). **Transport is NOT settled here** — WP-BUG-BUILD-SKEW (Part-2) found the naive rsync/scp delta drops brand-new files on this box; the transport choice is owned by that WP. (Requirements only — the specific paths/commands below are illustrative, not prescriptive.)
- **Rollback.** Restore live to any prior snapshot — the end-user "undo." One call, atomic swap.
- **Restore ← Live (live→stage).** Pull current live back into the stage session dir, so (a) editing always starts from the known-good live and (b) a broken stage can be reset.
- **Session→domain map.** Config (`db/deploy-map.json`): `2026-05-31-weingut-barbazza → barbazza.wine`, `2026-04-25-silke-lengler → silke-lengler.ch`, … The CD agent stays oblivious — it sees one dir; this layer owns the stage/live split + versions.
- **Wire into the real endpoint.** Replace the guts of `app/api/admin/deploy/route.ts` (keep its request/response contract so the CRM toast is unchanged). Add `action: 'publish' | 'rollback' | 'pull-from-live'` + `snapshotId`.

**Files affected.**
- `app/api/admin/deploy/route.ts` — replace placeholder body; keep contract.
- `lib/deploy/{publish,snapshot,restore,map}.ts` (NEW) — rsync + snapshot + atomic swap + the session↔domain map.
- `db/deploy-map.json` (NEW) — session → live docroot mapping.
- `public/admin.html` — Deploy / Rollback / Pull-from-Live controls + per-session snapshot list.

**Acceptance.**
1. Publish a session → its live domain updates; a timestamped snapshot of the *previous* live exists.
2. Rollback → live is byte-for-byte the prior snapshot.
3. Pull-from-Live → the stage session dir matches live; a subsequently-broken stage can be reset from live.
4. CD agent edits + builds exactly as today (one dir), unaware of the stage/live split.
5. A publish that fails mid-transfer leaves live intact (atomic swap, no half-state).

**LOC.** ~400. **Difficulty.** Medium-High — atomicity, snapshot retention, the box's path/permission reality. **Deps.** §8 WP-24 (server runbook); the per-domain cPanel Node-app pattern (shipped for barbazza). **Priority.** 🔴 ASAP — the "they can always get it back" promise rests entirely on this.

### WP-OPS-RESTART — Server control surface (restart Node apps + health, from the gated admin panel)

**Problem.** When a cPanel Node app wedges (the webbuilder Baileys-crash episode; a stale deploy; a stuck Passenger worker) the only recovery is SSH + `cloudlinux-selector restart` or `touch <app-root>/tmp/restart.txt`. Ralph needs a button — and a health readout — without a terminal. (Folds the user's "restart the node server" ask into the deploy story.)

**Scope.** In the gated `admin.html`, a control row per known app (`webbuilder`, `barbazza-api`, `silke-api`): **Restart** + a **health** readout (up/down, last-restart, recent `stderr` tail). Candidate restart mechanisms: touch `~/<app-root>/tmp/restart.txt` (Passenger graceful) or `cloudlinux-selector restart --app-root <x>`. **Open question (verify, don't assume):** whether the Studio Next process can reach those in-process or needs a box-local helper/endpoint — establish from the box before building.

**Files affected.** `public/admin.html` (controls + health); `app/api/admin/ops/{restart,health}/route.ts` (NEW); app registry `db/oskar-apps.json` (NEW).

**Acceptance.** "Restart webbuilder" → app restarts, health flips up; same for barbazza-api/silke-api; recent stderr visible; unauthorized callers blocked (behind the admin gate).

**LOC.** ~200. **Difficulty.** Medium — the privilege path is the only real risk. **Deps.** none hard. **Priority.** 🔴 ASAP. _(2026-07-12 audit: not started — no `app/api/admin/ops/`, no `db/oskar-apps.json`. With WP-DEPLOY superseded, this is §12's top remaining build item.)_

### WP-BUG-PAGE-OVERLAY — Studio pages throw a runtime error overlay (`/`, `/crm`)

**Observed.** `GET /` and `GET /crm` returned HTTP 200 with Next's error-overlay marker (`next-error-h1`) in the served HTML; API routes tested separately responded normally. (Part-2: this later appeared resolved locally — re-verify it still reproduces before acting.)

**Context (NOT a diagnosis).** Both pages were in a recent shared-edit window; files under the CRM/scout/mcp path were among those changed. A navigation starting point only — not a named cause.

**Open until investigated.** Capture the actual error/stack the overlay renders, then identify the failing module from that evidence — do not presume which file.

**Done when.** `/` and `/crm` render without the overlay and the root cause is identified with evidence. **Priority.** 🔴 if still reproducing (confirm first). _(2026-07-12 audit: no repro evidence since part-2 — treat as resolved-unverified; confirm both pages once on the next server check, then close.)_

### WP-BUG-WHATSAPP-RECONNECT — CRM WhatsApp (Baileys) dead session → skeleton CRM + unhandled-rejection storm

**Observed.** On the deployed server, `stderr.log` showed repeated `@whiskeysockets/baileys` `Timed Out` (408) entries surfacing as `unhandledRejection`, and the CRM view rendered its loading skeleton (no data observed populating). Why the handshake times out is open — do not assume "logged-out / expired"; see the Part-2 note for findings so far.

**Done this session (✅ partial).** A process-level crash guard (`unhandledRejection` + `uncaughtException`, log-and-continue) was inserted at the top of the deployed `~/webbuilder/server.js` and **verified catching the timeouts while the app keeps serving 200s**. Two gaps: (a) `server.js` is the **generated** standalone bootstrap — a `next build` **wipes the guard**; (b) the guard stops the crash but does **not** reconnect WhatsApp.

**Open items.** Give the crash guard a permanent home in source so a rebuild doesn't drop it (`instrumentation.ts` is one candidate). Whether reconnect/backoff and/or a re-pair flow is the right answer depends on the root cause — decide from the Part-2 evidence, not assumption.

**Done when.** The crash guard lives in source (survives a rebuild); the CRM data path works or WhatsApp state is correctly surfaced; no rejection storm. **Priority.** 🟡 (crash contained this session; data path open).

**Part-2 update (2026-06-19) — reconnect STORM fixed ✅.** The 2s-on-every-drop reconnect was replaced in source (`lib/wa-runtime.ts`) with a single 5-min semi-automatic reconnect (`restartRequired` stays fast for pairing; other drops wait the cycle) + a manual trigger. Deployed → the storm STOPPED (stderr stopped growing). **Two things remain:** (a) the `wa-runtime.ts` change is currently UNCOMMITTED; (b) the server `:39` device still can't SUSTAIN a connection — it reaches `connection:open` (status says 'connected') but baileys' `uploadPreKeysToServer` times out (408) → 428 close → 0 activity. NOT dual-session (WhatsApp allows 4 linked devices; Mac `:38` is healthy and handles real inbound, the server is a separate `:39`). Likely the el8 host can't sustain the WhatsApp app-layer handshake. The Mac does WhatsApp today; the server link is decorative. The crash-guard-to-source (`instrumentation.ts` already boots the runtime) + re-pair-QR-UX parts are still open. Memory `oskar-whatsapp`.

_(2026-07-12 audit: (a) closed — `lib/wa-runtime.ts` committed in v1.0.1. (b) `:39` sustain still open; Mac `:38` carries WhatsApp. The crash guard is still NOT in source — `instrumentation.ts` boots the runtime but has no `unhandledRejection`/`uncaughtException` handler, so a rebuild still wipes the server-side `server.js` patch. **Guard-to-source is the remaining ASAP item in this WP.**)_

### WP-BUG-BUILD-SKEW → MERGED INTO WP-28 (Sync Codebase button)  ✅ SHIPPED

_Canonical home for the deploy-transport fix + parity gate is now **WP-28 Button C**. Technical detail retained here for the implementer._

_(2026-07-12 audit: ✅ shipped — `scripts/deploy-server.sh` builds off-box and lands the whole artifact via server-side `tar -x`, with DEPLOY_VERSION stamp; memory `oskar-server-deploy`. The "#1 blocker" is closed.)_

**Observed.** `app/api/claude-code/route.ts` exists in source; `GET /api/claude-code` returns 404 on the deployed server, and the deployed `.next/server/app/api` does not contain every route present in source. (The original "the box can't `next build`, so the artifact drifts" line this WP first shipped with was a guess — the **Part-2 update below** establishes the actual transport mechanism and supersedes it.)

**Open until investigated.** How the deployed artifact is built and shipped, and what is or isn't landing on the box. Cause is open — see Part-2.

**Done when.** The deployed route/asset set matches source (a parity check passes), the divergence mechanism is identified, and `/api/claude-code` (plus other source routes) resolve live. **Priority.** 🔴.

**Part-2 update (2026-06-19) — it's worse than route-skew: NEW FILES don't deploy at all.** Confirmed empirically: rsync/scp/tar transfer MODIFICATIONS to existing files but SILENTLY DROP brand-new files — a new `route.js` AND the new `[root-of-the-server]__<hash>._.js` chunks it pulls in (verified: a new `/wake` route + its chunk never landed via rsync, scp, OR `tar`; the manifest entry didn't update either). Server-side `cat`/`echo` shell-writes DO persist (so it's the network-upload transport being intercepted, NOT a disk/perms/inode issue — box is 66919/300000 inodes). Per-chunk `cat` is whack-a-mole (a route drags a chunk-chain). **The parity gate must diff source-routes vs deployed-routes AND verify each route's chunks are present; the transport must be server-side `tar -x`/`cp` of the WHOLE artifact (a local write the scanner doesn't intercept), never rsync of the delta.** Likely Imunify360/cPanel real-time scan quarantining newly-uploaded `.js`. Memory `oskar-server-deploy`.

### WP-BUG-SCOUT-WORKERS-SERVER — Scout workers don't deploy on the server (CLI-worker model × box limits)

**Observed.** On the deployed server, a scout taste/discover batch does not produce results (works in local dev). The **actual** first failure, once reproduced on the box, is in the **Part-2 correction below** — read that; the original cause this WP first shipped with (worker resource exhaustion) was a guess and was wrong.

**Entry points (code, for navigation — NOT a diagnosis).** Scout spawn path: `lib/scout-bridge-call.ts` (`useWorker: true`) → `lib/bridge-process-manager.ts` (`spawnFreshWorker`, `MAX_WORKERS_PER_SESSION`); capture + pipeline under `app/api/admin/crm/scout/{taste,discover,pool}/`.

**Open until investigated.** Establish the failure mode from server logs/evidence before naming a cause or a fix. Resources, subprocess-spawn permission, the capture step, build/transport, and env are all candidate angles — none assumed.

**Done when.** A scout batch completes on the deployed server, OR the precise blocker is identified with evidence and a decision recorded.

_(2026-07-12 audit: ✅ the code fix from the Part-2 correction is shipped — `lib/capture-spawn.ts` + `scripts/capture-worker.cjs` run capture in a child process (same `captureUrl` signature), wired into the taste route. What remains is VERIFICATION only: run one taste batch on the box, then close.)_

**Part-2 correction (2026-06-19) — the real first failure is NOT worker-OOM.** Triggered a single-row taste on the deployed box: it 500s at the **CAPTURE** step on `Failed to load external module puppeteer-<hash>: Error: open EEXIST` (next-server turbopack `externalImport`, `.next/server/chunks/[turbopack]_runtime.js`), BEFORE any tasting worker spawns. DETERMINISTIC on ONE row; box idles at ~22/200 nproc — so the 32×232 MB-OOM theory is NOT what kills it (it never reaches the workers). The identical `import('puppeteer-<hash>')` SUCCEEDS in a fresh node process with the same cwd/env — it's `next-server`'s long-running-process external-load that throws, not puppeteer or chromium. Chromium itself launches + screenshots fine on the box (bundled `~/.cache/puppeteer/chrome` + `LD_LIBRARY_PATH=~/lib`, GLIBC ok). **Fix the capture first:** run `captureUrl` in a CHILD process (plain-node `require('puppeteer-core')` worker, bundled chrome + `LD_LIBRARY_PATH`) — bypasses the broken `externalImport` (proven end-to-end this session). Also: `findBinary('chromium')` doesn't check `~/.cache/puppeteer` and `CHROMIUM_BIN`/`LD_LIBRARY_PATH` aren't in the app env — wire those. The API-mode worker concern (WP-91) is a SEPARATE downstream issue; capture must work first.

---

**§12 do-first order (production), updated 2026-06-19 (part 2):** **WP-BUG-BUILD-SKEW is now the #1 blocker** — adding a NEW route/page to the box is flat broken (learning #1 below), and it gates WP-DEPLOY, the WhatsApp `/wake` route, and WP-BUG-SCOUT-WORKERS-SERVER. Order: WP-BUG-BUILD-SKEW + WP-DEPLOY (a transport the scanner doesn't eat + a parity gate) → WP-BUG-SCOUT-WORKERS-SERVER (real cause now known — its part-2 note) → WP-OPS-RESTART (restart-without-SSH) → WP-BUG-WHATSAPP-RECONNECT crash-guard-to-source. WP-BUG-PAGE-OVERLAY appears resolved locally (the pages render — gauge + deck — verify before relying). WP-BUG-FONTS-GOOGLE + WP-BUG-FLIGHTDECK-BABEL + the WhatsApp re-pair UX + a per-app health dashboard are 🟡 fast-follows.

**§12 do-first order, re-cut 2026-07-12 (audit):** BUILD-SKEW ✅ shipped, scout-capture ✅ in code, WP-DEPLOY superseded by Webserver Sync. Remaining, in order: **WP-OPS-RESTART** → **WhatsApp crash-guard-to-source** (small; a rebuild currently re-exposes the crash) → **WP-134 + WP-135** (self-host fonts/Babel) → one server pass verifying the scout batch + page overlay, then close both BUG-WPs.

---

### Session 2026-06-19 (part 2) — deploy-brittleness deep-dive: crossed off · still broken · learnings

_A second long hardening pass on the same live box. The "99% but brittle" became concrete. Logging it so the next agent doesn't re-bleed._

**✅ Crossed off (root-caused + verified live):**
- **MCP "flapping" — fixed.** Bridge agents flapped with `fetch failed`/`mcp_unavailable` even while curl-testing the backend passed. Cause: a NAME COLLISION on MCP server `orch` — the bridge's generated HTTP config AND the committed project `.mcp.json` (old stdio proxy) both define `orch`, and the bridge spawned `claude` WITHOUT `--strict-mcp-config`, loading both. The committed `.mcp.json` had a Mac absolute path + `localhost:3000` (unreachable on the Unix-socket box) + dead `OSKAR_SESSION=2026-01-27-debug`, shipped verbatim → the stdio `orch` couldn't spawn/fetch → flapped. **Fixes:** `--strict-mcp-config` on BOTH spawn sites (`lib/bridge-process-manager.ts`); both committed `.mcp.json` made portable (relative path, no hardcoded session — `.runtime/active-session` is authoritative); deployed the missing `scripts/mcp-stdio-proxy.mjs` + fixed the server URL. Verified Consular replies 12/1663, no more `fetch failed`. Memory `oskar-bridge-mcp`.
- **WhatsApp reconnect STORM — fixed** (part of WP-BUG-WHATSAPP-RECONNECT). See that WP's part-2 note.
- **FlightDeck render host on server — fixed.** `public/__crm__/flight-deck.jsx` (the 35 KB `window.FlightDeck.render` host) was missing on the box; re-deployed via server-side `cat`.

**🔴 Still broken on the server:**
- **Scout capture is dead** — every taste 500s on `puppeteer EEXIST`. The fix path is in WP-BUG-SCOUT-WORKERS-SERVER (corrected below).
- **WhatsApp `:39` can't sustain a connection** (separate from the storm fix) — see WP-BUG-WHATSAPP-RECONNECT part-2.
- **Manual `/wake` reconnect route built but un-deployable** (blocked by WP-BUG-BUILD-SKEW). Correct move: fold manual-reconnect into the EXISTING `/status` or `/pair` route, don't add a new route.

**🧠 Hard-won learnings:**
1. **Adding a NEW route/page to the server is BROKEN.** rsync/scp/tar land MODIFICATIONS to existing files (the reconnect fix deployed fine) but SILENTLY DROP brand-new files — a new `route.js` AND the chain of new `[root-of-the-server]__<hash>._.js` turbopack chunks it pulls in. Per-file `cat local | ssh 'cat > remote'` lands individual files, but a route drags a chunk-chain → whack-a-mole. Suspect Imunify360/cPanel real-time malware scan quarantining newly-UPLOADED `.js`. **This is the heart of WP-BUG-BUILD-SKEW** — transport must be one the scanner doesn't eat (server-side `tar -x`/`cp` of the WHOLE artifact, never rsync of just new files).
2. **NEVER `npm run build` in the live dev directory.** It clobbers the running `next dev`'s `.next` AND re-hammers Google Fonts (each build re-downloads → rate-limit). This session's "font crash" + "FlightDeck Babel failed to load" both traced to repeated local builds, NOT to any code change (git diff was clean on both). Build in a copy/worktree, or stop `next dev` first.
3. **`/connect` is a forbidden route segment on LiteSpeed** — the WAF 403s any path ending in `/connect` at the edge (proxy-CONNECT rule), while `disconnect` is fine. Don't name routes `connect`.
4. **Two runtime external-CDN deps should be self-hosted** → WP-BUG-FONTS-GOOGLE + WP-BUG-FLIGHTDECK-BABEL.

### WP-134 — Self-host Inter/JetBrains (kill the Google Fonts dependency)  _(was WP-BUG-FONTS-GOOGLE)_

**Problem.** UI fonts come from Google two ways: `next/font/google` in `app/layout.tsx` (Inter, JetBrains Mono — downloads at BUILD time, then self-hosts) AND a redundant raw `@import url('https://fonts.googleapis.com/...')` at `app/globals.css:4` (hits Google at RUNTIME, every page). Build-time fails on rate-limit; runtime @import fails on any CDN issue. (`public/fonts/` is the BRAND library — Caslon/Garamond/etc. — it has NO Inter.) Neither is a git change — they've always been there; repeated local builds just made the build-time download fail visibly.

**Scope.** Download Inter + Inter-Tight + JetBrains-Mono `.woff2` once → `app/fonts/`; switch `next/font/google` → `next/font/local`; delete `globals.css:4`. Zero Google dependency, build or runtime. Verify against a WORKING dev server (a font swap touches every page).

**Acceptance.** App renders Inter/JetBrains with no calls to fonts.googleapis.com / fonts.gstatic.com. **LOC.** ~60. **Difficulty.** Low. **Deps.** none. **Priority.** 🟡 (recurring + high-visibility; do it when calm). _(2026-07-12 audit: still open — `app/layout.tsx:3` on `next/font/google`, `app/globals.css:4` runtime @import still live.)_

### WP-135 — Vendor/pre-compile FlightDeck Babel (drop the 3 MB unpkg runtime dep)  _(was WP-BUG-FLIGHTDECK-BABEL)_

**Problem.** `components/crm/FlightDeckHost.tsx:27` loads `https://unpkg.com/@babel/standalone@7.29.0/babel.min.js` (3.1 MB) at runtime to compile `public/__crm__/flight-deck.jsx` IN THE BROWSER on every CRM load. Any CDN blip / cold-cache reload / restricted network → `Babel standalone failed to load` → no deck.

**Scope.** Either (a) vendor `babel.min.js` to `public/vendor/` and point `BABEL_SRC` at it, or — better — (b) PRE-COMPILE `flight-deck.jsx` at build time so no runtime Babel is needed (also drops the 3 MB client download).

**Acceptance.** FlightDeck renders with zero external-CDN requests. **LOC.** ~80 (vendor) / ~150 (pre-compile). **Difficulty.** Low / Medium. **Deps.** none. **Priority.** 🟡. _(2026-07-12 audit: still open — unpkg URL at `FlightDeckHost.tsx:27`, no `public/vendor/`.)_
