# WP-CRM — Sales-Funnel CRM, Integrated via Subtab in BRIEF/STUDIO

**Owner:** Jedi Claude (engineering)
**Requested by:** Ralph (CD) on behalf of Filippo (sales)
**Status:** READY-FOR-EXECUTION (Phase A) · PROPOSED (Phases B–D)
**Estimated effort:** ~14 h Claude-hours across four phases (~5–7 days wall-clock)
**Date opened:** 2026-05-22
**Last revised:** 2026-05-22 (v6.3 — codebase audit caught hidden dependencies · new WP-A12 moves `_session-config.json` into `logs/` · A11 specifies adding `prospect_id` to SessionConfig + in-memory cache + folder filter · A4 adds ONE column `standby_plan` (not zero, not two) · C1 specs the link picker + per-session subtab memory · C4 acknowledges phase isn't in SessionConfig and reuses existing derivation · D4 drops atomic-move overengineering and the Standby daily-check entirely · D5 corrects cost source to `logs/USAGE.json`)

---

## Revision history

- **v1** (shipped 2026-05-22) — kanban + centered modal + Excel-backed API. Six Potemkin defects surfaced on review (`prompt()`-chain new-lead, mock activity log, fake history, dead standby inputs, native `confirm()` on Start Session, attachments placeholder).
- **v2–v4** (rejected during review) — over-redesigned: stages renamed to Oskar phases, slide-in side panel, Call Mode split-screen invented. All of it diverged from Filippo's noCRM-shaped mental model.
- **v5** (rejected during review) — re-anchored on noCRM layout but **still wrong on three counts**: (a) included MCP tools for CD to update the CRM, (b) preserved the centered modal, (c) declared i18n in-scope. CD is not involved in the CRM. Modal isn't Oskar's pattern. Language toggle isn't a need.
- **v6** — modal gone, MCP tools gone, CD-back-sync gone, language toggle gone. CRM is a **3rd subtab inside the Assets panel** of BRIEF and STUDIO views, with a "← back to CRM" button at the top of that panel. All Phase D advanced WPs stay in scope (not deferred). Lifts A's Phase A defect-naming, Activities schema, standby explicit WP, attachments-drop decision, Excel-locked 503 decision, Claude-hours estimation.
- **v6.1** — phantom "Discovery Session trigger contract" (the original WP-C1) deleted; its one real deliverable (writing a `Started Discovery Session` Activity row on session creation) folded into WP-A2 as a one-line hook. Phase C WPs C2-C6 renumbered to C1-C5.
- **v6.2** — three principle-driven cleanups: (a) WP-A4 reuses the existing `next_action_date` + `notes` columns instead of adding `standby_date` + `standby_plan`; no schema growth on Prospects. (b) New WP-CRM-A11 retires `public/_crm/links.json` — that was a shadow database. Two DBs only: Excel + file system. (c) WP-CRM-C5 (Sessions rail live state) dropped as redundant — when Filippo is in the CRM subtab he's already inside a session; phase + cost are surfaced on the kanban card (C4) and via per-prospect rollup (D5) instead.
- **v6.3** (this file) — codebase audit caught what v6.2 was missing or wrong about. Six cleanups: (a) **A4 reverses partially** — the notes-prefix scheme conflates two semantic domains and forces regex parsing across three code sites. Add ONE explicit column `standby_plan`; keep `next_action_date` reuse for the date. (b) **New WP-A12** moves `_session-config.json` from session root to `logs/` — consolidates metadata files (already there: `USAGE.json`, `BRIDGE.json`). Sequenced BEFORE A11 so subsequent writes land in the right path. (c) **A11 specified properly**: adds `prospect_id` field to the SessionConfig interface (which doesn't have it today — audit caught this), in-memory cache from day one (not "if it gets slow"), `existsSync` folder filter so the scan doesn't walk thumbnails/`_crm/`/fonts. Effort 0.4h → 1.0h with proper error handling. (d) **C1 link picker fully specced** (typeahead + click-to-link + writes `prospect_id`); subtab persistence becomes per-session not global. (e) **C4 phase-source audit**: phase isn't in `SessionConfig` either; reuse the existing derivation logic from the Sessions tab (file-presence heuristics). (f) **D4 simplified** — drop the "atomic move" framing (`fs.renameSync` is fine), drop the Standby daily-check + LaunchAgent integration entirely (Filippo sees the board daily, that IS the reminder), keep only Won and Lost terminals with explicit confirmation text. (g) **D5 source-file correction**: cost lives in `logs/USAGE.json` via `lib/usage-tracker.ts`, not in `_session-config.json` as I wrongly claimed.

---

## Why this exists

Filippo runs outbound sales for Oskar. His prospect tracking lives in nothing today — calls and follow-ups all in his head. The CRM lives **inside** Oskar so that:

- The kanban is one tab away from the rest of his workflow
- Starting a discovery session for a hot lead navigates him into Oskar's existing BRIEF/STUDIO flow with **the CRM subtab right there** for live edits during the call
- Returning to the kanban from a session is one click
- Filippo never tab-switches between two apps; he switches views inside one

A standalone CRM linked-to-Oskar would force tab-switching during calls and lose the closed loop on production economics. CRM-as-an-Oskar-subtab is the integration.

**Explicitly NOT integrations:**

- CD does not write to the CRM. CD writes to `CREATIVE-BRIEF.md`. The CRM is Filippo's tool, edited by his fingers.
- No MCP tools for the CRM. No agent enrichment columns. No `[CD]` provenance badges.
- The session state surfaces in the CRM subtab as **read-only display** (phase, vibe thumbs, cost). It does not pull data fields back into the lead row.

---

## First move — Force Anchor

Before any code change:

1. Confirm `docs/crm-feature/prospects.xlsx` exists with 19 seed leads. Regenerate via `node docs/crm-feature/generate-seed.mjs` if missing.
2. Confirm `public/_crm/links.json` exists (created by v1 — will be retired by WP-CRM-A11).
3. Boot `npm run dev`, hit `/admin.html`, click CRM nav tab, confirm v1 renders (4 columns, 19 cards, click → centered modal opens).
4. Note the six specific Potemkin defects at these line ranges in `public/admin.html`:
   - `2049–2073` — `crmNewLead()` `prompt()`-chain
   - `2011–2024` — `crmLogActivity()` mock-only
   - `1900–1933` — `renderCrmHistory()` synthesized timeline
   - `730–734` — Standby reminder inputs without persistence wiring
   - `2032` — `crmStartSession()` `confirm()` native popup
   - `882–887` — Attachments panel placeholder

---

## Architectural axes — what's orthogonal to what

| Axis | Domain | Who controls it | Visible as |
|---|---|---|---|
| **Stage** | Sales — where Filippo thinks the deal is | Filippo, by drag | Column the card sits in |
| **Phase** | Production — where Oskar's work is | CD / WebDev / Nano Banana, autonomously | Small pill on card (only if session exists) |

A "Contacted" lead might have a Phase-3 session running. A "Closing" lead might have no session at all (signed on first call). The axes don't collapse.

**A lead is the CRM entity** — exists from the moment Filippo writes a name down.
**A session is a production artifact** — only born when Filippo clicks "Start Discovery Session" because the prospect is engaged.

Most pipeline volume (Incoming / Contacted) has zero sessions. The board's high-frequency UX must be excellent at the no-session case.

---

## What stays untouched from v1

- **4 stages**: Incoming · Contacted · Demo done · Closing
- **9 activity types**: Call · Qualification Call · Meeting · Zoom Call · Onsite Visit · E-mail Out · E-mail In · Proposal · Started Discovery Session
- **Status state machine**: To do · Standby · Won · Lost · Cancelled
- **Card visual chrome** matching `public/admin.html` design tokens
- **Excel as source of truth**: `docs/crm-feature/prospects.xlsx`, openable by Filippo in Numbers without Oskar running

If a WP below proposes to change any of these, it's a regression.

---

## What goes away

- **The centered modal**. v1's `crm-modal-backdrop` overlay disappears. Lead detail editing happens in two surfaces instead:
  1. **Inline on the kanban card itself** — quick fields (company, amount, confidence, status, next-action, contact, phone, email) all click-to-edit on the card
  2. **In the CRM subtab inside BRIEF/STUDIO** — rich editing (long notes, full activity timeline, sessions rail, "+ Log Activity" picker) lives here. Only available once the lead has a session.
- **The 8-field "New Lead" form**. Replaced by single-line quick-add atop each column (parses `Company, Name, Phone, Email`, vCards, email signatures).
- **All native `prompt()` and `confirm()` calls**. Inline forms and inline confirmation strips replace them.
- **Attachments panel**. Hidden until a future file-upload WP. Frees ~80 px of vertical space.

---

# Phase A — Stop the bleeding (~3–4 h Claude)

Ten WPs that turn v1 from a viewer-with-mock-buttons into a kanban Filippo can actually drive. All ship in one PR.

## WP-CRM-A1 · Quick-add input atop each column

**Effort:** 0.5 h · **Depends on:** —

Replaces `crmNewLead()` `prompt()`-chain (`public/admin.html:2049`).

**Deliverables**
- Single input atop every column (Incoming first, others optional). Placeholder: `Add lead… (Company, Name, Phone, Email)`
- Keyboard shortcut `n` focuses the Incoming input
- Smart-parses:
  - `Caffè Sant'Ambrogio, Marco Brunetti, +41 76 234 56 78` → company/name/phone
  - `Hotel Splendid | direktion@hotelsplendid.ch` → company/email
  - Pasted vCard block → all fields populate
  - Pasted email signature → company + name + title + phone + email auto-extracted via regex
- Enter → `POST /api/admin/crm/prospects` → card appears → input clears → focus stays
- Parsers extracted to `lib/crm-parsers.ts` (shared with Phase B bulk import)
- The current "+ New Lead" button retires entirely (or stays as a fallback into the parser)

**Acceptance**
- Type "Hotel Splendid, Sabine Müller, +41 79 678 90 12" → Enter → card in Incoming, fields parsed
- Paste a 5-line email signature → name/email/phone parsed correctly
- No native `prompt()` survives anywhere

## WP-CRM-A2 · Activities sheet + persistence

**Effort:** 1.1 h · **Depends on:** —

Replaces mock-only `crmLogActivity()` (`public/admin.html:2011`).

**Deliverables**
- Add `Activities` sheet to `prospects.xlsx`. Columns: `id, prospect_id, timestamp, type, icon, color, duration_min, notes, session_id, user_id`
- `lib/crm-store.ts`: add `readActivities(prospect_id?)`, `appendActivity(row)`, `writeActivities(rows)`, `updateActivity(id, patch)`. Creates the sheet on first write if missing.
- New API routes:
  - `GET /api/admin/crm/activities?prospect_id=P011` → activities for one lead, newest first
  - `POST /api/admin/crm/activities` body `{ prospect_id, type, icon?, color?, duration_min?, notes?, session_id? }` → append, return saved row
  - `PATCH /api/admin/crm/activities/[id]` body `{ duration_min?, notes? }` → edit duration / notes post-hoc
- `crmLogActivity()` swap: from DOM-prepend mock to real POST → re-render history from server. Optimistic UI: prepend immediately, mark `is-saving`, swap to persisted row when response lands. On failure: toast error, undo.
- **Hook into existing `POST /api/admin/crm/sessions`**: when a new session is created (creates folder + writes `_session-config.json` with `prospect_id`), also append an Activity row `{ type: 'Started Discovery Session', session_id, prospect_id }`. One-line addition to the existing route. No new endpoint, no contract WP. (Note: the `links.json` write that v1 also performed gets removed by WP-CRM-A11.)

**Acceptance**
- Click any of the 9 activity-type buttons → row appears in Activities sheet → survives page reload
- Open `prospects.xlsx` in Numbers → sees both Prospects + Activities sheets
- Click "+ Start Discovery Session" → in addition to the existing redirect, a `Started Discovery Session` row appears in Activities

## WP-CRM-A3 · History timeline from real Activities

**Effort:** 0.5 h · **Depends on:** WP-CRM-A2

Replaces `renderCrmHistory()` synthesized timeline (`public/admin.html:1900-1933`).

**Deliverables**
- `renderCrmHistory(p)` becomes async, fetches `GET /api/admin/crm/activities?prospect_id=p.id`
- Renders entries in server-returned order (newest first)
- Fallback to a single synthesized `Created` entry if the Activities sheet is empty for this prospect (first-run grace)
- **Edit-in-place**: click an activity row → expands inline with two editable fields (`duration_min` number input, `notes` textarea). Save via `PATCH /api/admin/crm/activities/[id]`
- Solves the post-call workflow: log a Call now ("Call · 14:32"), edit duration + notes later when Filippo has 30 seconds

**Acceptance**
- Activity rows in History reflect actual Activities sheet content
- Click row → inline edit → blur → persists

## WP-CRM-A4 · Standby reminder persistence (one new column)

**Effort:** 0.3 h · **Depends on:** —

Wires the existing Standby panel inputs (`public/admin.html:730-734`) that today look-real-do-nothing. Reuses `next_action_date` for the date (one column, two consumers — clean). Adds ONE new column `standby_plan` for the free-text plan — instead of prefixing `notes` and forcing regex-based parsing across three code sites.

**Deliverables**
- The Standby panel's date input binds to the existing `next_action_date` column. Debounced PATCH (500 ms) via existing `crmPatch()`.
- The Standby panel's "plan" textarea binds to a **new** `standby_plan` column on the Prospects sheet (string, additive — `readSheet()` already uses `{ defval: '' }`, no migration risk).
- Pre-fill rule: when status switches **TO** Standby and `next_action_date` is empty → default to today + 7 days.
- Preservation rule: when status switches **FROM** Standby to anything else → keep both values (institutional memory; Filippo might re-Standby and want the previous plan as starting point).
- Small "saved ✓" indicator next to the panel header on successful PATCH.

**Why one column, not two:** the date genuinely overlaps with `next_action_date` (semantic identity, not coincidence). The plan does NOT overlap with `notes` — notes is Filippo's freeform prospect context; the standby_plan is a structured "what I'm waiting on" string. Mixing them via a `[STANDBY YYYY-MM-DD]` prefix in notes would force three code sites (read, write, edit) into regex parsing and would corrupt the moment Filippo edits notes freely.

**Acceptance**
- Set status Standby → enter a date + plan → blur → reload page → values still in inputs
- Open `prospects.xlsx` in Numbers → `next_action_date` reflects the standby date; `standby_plan` column holds the plan text
- One column added to the Prospects sheet (additive)

## WP-CRM-A5 · Inline confirmation for Start Session

**Effort:** 0.2 h · **Depends on:** —

Replaces `crmStartSession()` `confirm()` native popup (`public/admin.html:2032`).

**Deliverables**
- Inline confirmation strip inside the Sessions Rail block (which lives in the CRM subtab post-WP-C2, but for Phase A it lives wherever it currently lives in v1)
- Click "+ Start New Session" → block expands:
  ```
  ┌────────────────────────────────────────────────┐
  │ ⚡ Start session for Hotel Splendid?           │
  │   Creates new session folder + redirects.      │
  │           [Cancel]  [Start Discovery Session]  │
  └────────────────────────────────────────────────┘
  ```
- Confirm button calls existing `POST /api/admin/crm/sessions`. Cancel collapses the strip.
- No native `confirm()` ever fires.

**Acceptance**
- Click "+ Start New Session" → inline strip expands (no popup) → click Start → existing redirect flow fires

## WP-CRM-A6 · Drop Attachments panel

**Effort:** 0.1 h · **Depends on:** —

Removes the placeholder Attachments panel (`public/admin.html:882-887`) that today eats vertical space for zero value.

**Deliverables**
- Delete the Attachments panel block from the lead-detail right column
- Re-flow the Sessions Rail to fill the freed space
- When a future file-upload WP ships, the panel can come back

**Acceptance**
- No Attachments panel visible anywhere in the CRM surface

## WP-CRM-A7 · Drag-and-drop between stages

**Effort:** 0.5 h · **Depends on:** WP-CRM-A2

Today the kanban columns are decorative — no way to change a lead's stage from the board.

**Deliverables**
- Native HTML5 drag/drop on `.crm-card` (no library)
- Each `.crm-column-body` becomes a drop zone with hover highlight
- Drop fires `PATCH /api/admin/crm/prospects/[id]` with new `stage`
- Drop also writes Activity row `stage_changed` (from `<old>` to `<new>`)
- Optimistic UI: card moves immediately, snaps back with toast on PATCH failure

**Acceptance**
- Drag a card Incoming → Closing → persists after reload
- Activity log shows `stage_changed` row

## WP-CRM-A8 · Tap-to-call / mailto / website link

**Effort:** 0.2 h · **Depends on:** —

Filippo's primary verb is "call". The card itself should dial.

**Deliverables**
- On each card: small phone-icon button next to amount → `tel:<phone>` (one-click dial via Mac Continuity)
- Email field in expanded card / subtab → `mailto:`
- Website field → `target=_blank` external link
- All preserve inline-edit: click icon to dial, click field text to edit (separate hit targets)

**Acceptance**
- Click phone icon on a card → Mac Continuity prompts to call via iPhone
- Click email in subtab → default mail client opens with To: filled



## WP-CRM-A10 · Drop the modal — cards become inline-editable

**Effort:** 0.5 h · **Depends on:** WP-CRM-A3

Removes the entire centered modal (`<div id="crm-modal" class="crm-modal-backdrop">` and everything inside it).

**Deliverables**
- Delete the `#crm-modal` DOM block from `public/admin.html`
- Delete all `.crm-modal-*` CSS rules
- Delete `crmOpenModal()`, `crmCloseModal()`, `crmSaveModal()`, `crmNavigate()`, etc.
- Card click behavior changes per WP-CRM-C3 (Phase C):
  - **Pre-session lead** (no session folder has this prospect's id): click expands the card inline to show all editable fields + last 3 activities + "+ Start Discovery Session" button. Other cards collapse. Esc collapses.
  - **Post-session lead** (a session folder exists with this prospect's id): click navigates to `/?session=<id>` → BRIEF view → CRM subtab active (Phase C)
- All inline-edit machinery from WP-CRM-A3 (history) and WP-CRM-A7 (drag) survives — it just lives on the card / in the subtab now, not in a modal

**Acceptance**
- Click a Cold lead's card → expands in place, all fields editable, no modal overlay
- Click a Discovery-Live lead's card → navigates to its BRIEF view

## WP-CRM-A11 · Retire `links.json` (shadow DB) + add `prospect_id` to SessionConfig

**Effort:** 1.0 h · **Depends on:** WP-CRM-A12 (file lives in `logs/` after A12)

**Audit finding before specifying this WP:** the current `SessionConfig` interface (in `lib/session-config.ts`) is thin — it only stores `webDevModel`, `webDevMode`, `cdModel`, `billingMode`, `updatedAt`. **No `prospect_id`.** Adding it is part of this WP. Folder name is a mutable label — the `prospect_id` field inside `_session-config.json` is the immutable foreign key.

**Deliverables**
- Add `prospect_id?: string` (optional) field to the `SessionConfig` interface in `lib/session-config.ts`. Optional because pre-existing sessions (~15 today) don't have it and stay orphaned forever — that's correct, they predate the CRM linkage.
- Update `POST /api/admin/crm/sessions` to call `writeSessionConfig(sessionId, { prospect_id })` at session-creation time. No raw file writes.
- Drop the `links.json` write from `POST /api/admin/crm/sessions` — the prospect_id-in-config IS the linkage now.
- Replace `GET /api/admin/crm/sessions` (and any other read-from-links.json call) with a server-side scan:
  - `readdirSync(public/)`, filter to entries where `existsSync(public/<entry>/logs/_session-config.json)` returns true (post-A12 path). This excludes `_crm/`, font folders, thumbnail dirs, etc.
  - For each surviving folder, parse the config, extract `prospect_id`. Group results by prospect_id.
  - **In-memory cache** (5-line `Map<prospect_id, session[]>`) invalidated on every session-creation. Cache-from-day-one, not "if it gets slow" — the kanban renders all cards and each card needs the check; 19 cards × file scan = ~1900 IO-ops per page load otherwise.
- Defensive handling: corrupt JSON / partial writes / permission errors all degrade gracefully (treat folder as if no prospect_id). Log to server console; don't fail the request.
- Delete `public/_crm/links.json` from the repo (and the `public/_crm/` directory if it ends up empty).
- Update `lib/crm-store.ts` to remove `readLinks()` and `writeLinks()` helpers.
- The session file system becomes the sole source of truth for prospect→session linkage. Folder name can be renamed without breaking the link — the `prospect_id` field inside the config is the immutable key.

**Acceptance**
- Click "+ Start Discovery Session" → session folder created, `logs/_session-config.json` written with `prospect_id`, NO `links.json` write
- Rename a session folder → relink still works (scan finds it by `prospect_id` in config, not by folder name)
- CRM kanban renders prospect→session linkage correctly from file-system scan
- Second kanban render in same page load hits the in-memory cache (no re-scan)
- Corrupt `_session-config.json` in a stray folder → server logs the error, kanban still renders
- `public/_crm/links.json` is gone from the repo; `lib/crm-store.ts` no longer exports `readLinks`/`writeLinks`

## WP-CRM-A12 · Move `_session-config.json` into `/logs/`

**Effort:** 0.4 h · **Depends on:** —

Today `_session-config.json` sits at `public/<session-id>/_session-config.json` — at the session root, separate from the other metadata files in `logs/` (`USAGE.json`, `BRIDGE.json`). This is JSON-file inflation: there's no reason for some metadata to be at root and other metadata to be one level deep. Consolidate.

**Deliverables**
- Update `lib/session-config.ts`: change the path constant from `public/<id>/_session-config.json` to `public/<id>/logs/_session-config.json`. `readSessionConfig()` and `writeSessionConfig()` both flow through this path constant — one change point.
- One-shot migration: for the 15 existing session folders today, move `_session-config.json` → `logs/_session-config.json`. Either a small script or hand-move (it's 15 files). The new path is the only path after this WP.
- Verify the test in `lib/session-config.test.ts` still passes with the new path.
- The only caller writing today is the session-selector UI (which goes through `writeSessionConfig`). Subsequent CRM WPs (A11's `prospect_id` write) also go through `writeSessionConfig` — they all benefit from the path change for free.

**Why before A11**: A11 adds `prospect_id` to the config schema and reads it via scan. If the path moves AFTER A11 ships, we'd have a one-release window where some configs are in `logs/` and some are at root. Sequencing A12 first means A11's scan-and-filter walks the right path from day one.

**Acceptance**
- All 15 existing sessions have their config at `public/<id>/logs/_session-config.json`. None at root.
- `lib/session-config.ts` reads/writes the new path exclusively.
- Session selector still works (it goes through `writeSessionConfig`, doesn't know about the path).
- `npx tsc --noEmit` clean. `lib/session-config.test.ts` passes.

---

# Phase B — Bulk import (~2 h Claude)

## WP-CRM-B1 · Bulk-paste modal

**Effort:** 1.5 h · **Depends on:** WP-CRM-A1 (parser library)

Filippo prospects from LinkedIn Sales Navigator, trade shows, walk-ins. Adding 20 leads one-by-one is friction.

**Deliverables**
- "Bulk Import" button next to the (now-retired) "+ New Lead" affordance in the CRM header
- Modal opens with one big `<textarea>`. Filippo pastes any of:
  - CSV with or without headers
  - Newline-separated `Company, Name, Phone, Email`
  - Tab-separated from LinkedIn Sales Navigator
  - Multi-vCard block
  - Numbered lists (`1. X · 2. Y · 3. Z`)
- **Auto-detection**: delimiter (count `\t` vs `,` vs `;` in first 5 lines), header presence (>50% of cells match known column names → row 1 is headers)
- **Column mapping** dropdowns under the textarea — each detected column gets a dropdown of schema fields, auto-selected by header text, user-overrideable
- **Defaults for missing fields**: Stage `Incoming`, Status `To do`, Confidence 25 %, Owner `Filippo`, batch tag `bulk-import-<date>`
- **Duplicate detection**: for each row, check if `phone` OR `email` matches an existing prospect → flag candidates in an expandable section. User can skip or import-anyway.
- **Import action**: sequential POSTs to `/api/admin/crm/prospects` with `batch=true` header (server doesn't reload Excel between rows). Progress bar shows N of M. On completion: modal closes, toast "44 leads imported · 3 duplicates skipped".

**Acceptance**
- Paste 50-row CSV → preview shows 50 rows + detected delimiter + column mapping
- Toggle a mapping → preview updates
- 3 rows flagged as dup → skip → 47 leads imported → board refreshes

## WP-CRM-B2 · Optional CSV/XLSX file picker

**Effort:** 0.5 h · **Depends on:** WP-CRM-B1

**Deliverables**
- Same modal also accepts a file via `<input type="file" accept=".csv,.tsv,.xlsx">`
- File contents populate the textarea + trigger auto-detect
- `.xlsx` reads first sheet via the existing `xlsx` package

**Acceptance**
- Drag a `.xlsx` file → preview populates from first sheet

---

# Phase C — Subtab integration (~2.5 h Claude)

The integration moment. CRM becomes a 3rd subtab inside the Assets panel of BRIEF and STUDIO views. Four WPs (the rail block from v6 is gone — redundant inside a session).

## WP-CRM-C1 · CRM as 3rd subtab in Assets panel ⭐

**Effort:** 1.5 h · **Depends on:** WP-CRM-A2, WP-CRM-A11

**The load-bearing integration UX.**

```
BRIEF view (and STUDIO view) — Assets panel left column

┌─────────────────────────────────────────┐
│ [ ASSETS ] [ FEEDBACK ] [ CRM ]          │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ ← back to CRM    Hotel Bellevue ★    │ │
│ ├──────────────────────────────────────┤ │
│ │                                       │ │
│ │ Status: [ To do ] [ Standby ] [ Won ] │ │
│ │                                       │ │
│ │ Contact: Andrea Conti                 │ │
│ │ Phone:   +41 91 234 56 78  [📞]      │ │
│ │ Email:   a.conti@bellevue-lugano.ch  │ │
│ │                                       │ │
│ │ Comment (autosave):                   │ │
│ │ ┌───────────────────────────────────┐ │ │
│ │ │ Loves heritage angle. CHF 30-40k. │ │ │
│ │ └───────────────────────────────────┘ │ │
│ │                                       │ │
│ │ Tags: Hotel · Tessin · Trade Show     │ │
│ │                                       │ │
│ │ ── History ──                         │ │
│ │ 14:30  status → Demo done  (you)      │ │
│ │ 13:30  Zoom call · 45min  (you)       │ │
│ │ 09:00  discovery_session_started      │ │
│ │ 08:55  Call · 18min  (you)            │ │
│ │                                       │ │
│ │ [+ Log Activity ▼]                    │ │
│ └──────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Deliverables**
- Detect `prospect_id` from `_session-config.json` on view mount in BRIEF and STUDIO
- If present, register a 3rd subtab `CRM` next to `ASSETS` and `FEEDBACK` in the existing subtab strip
- If absent, the CRM subtab shows a **"Link to CRM lead"** picker — single text input with typeahead matching on `company` across all prospects in the Excel. Type "Hotel B..." → see "Hotel Bellevue Lugano (P011)" and "Hotel Splendid (P005)". Click one → calls `writeSessionConfig(sessionId, { prospect_id })`, refreshes the subtab, normal CRM content renders. ~30 LOC for the typeahead (debounced filter + click-to-select), no new endpoint (uses existing GET /api/admin/crm/prospects).
- CRM subtab content is the rich lead detail panel (what used to be in the v1 modal, minus the Attachments panel):
  - Status row pills (To do / Standby / Won / Lost / Cancelled) — clicking PATCHes + writes activity
  - Personal Information (Contact, Phone with `tel:`, Email with `mailto:`, Website)
  - Comment textarea (autosaves every 2 s)
  - Tags chips (editable)
  - Owner (read-only display)
  - History timeline (from Activities sheet — WP-CRM-A3)
  - "+ Log Activity" picker (the 9 activity types)
- All edits PATCH to existing `/api/admin/crm/prospects/[id]` endpoint
- **No new chat infrastructure** — the discovery chat lives in BRIEF view as it does today; the CRM subtab is alongside, not replacing
- Subtab choice persists **per-session** in localStorage (key: `crm-subtab-active::<session-id>`). Returning to the same session restores Filippo's last subtab choice for that session; switching to another session starts at that session's last choice (or ASSETS as default).

**Acceptance**
- Open a session linked to Hotel Bellevue → BRIEF view → CRM subtab visible next to ASSETS / FEEDBACK
- Click CRM → editable card panel renders
- Edit notes → blur → reload page → notes persisted in .xlsx
- Switch to STUDIO view → CRM subtab still there with same content
- Open a session with no linked prospect → CRM subtab hidden (or shows the linker)

**Files touched**
- `public/admin.html` retains the kanban (no CRM subtab there — kanban IS the CRM tab in admin)
- New component for the subtab: `components/admin/CrmLeadPanel.tsx` (or vanilla module mounted into the existing BRIEF/STUDIO subtab strip)
- BRIEF and STUDIO view components — register the new subtab when `prospect_id` is present in session config

## WP-CRM-C2 · "← back to CRM" button at top of CRM subtab panel

**Effort:** 0.3 h · **Depends on:** WP-CRM-C1

Reversible navigation. Filippo can jump from any session back to the kanban in one click.

**Deliverables**
- Button at the top-left of the CRM subtab content area: `← back to CRM`
- Click → navigates to `/admin.html#view-crm` (or however the admin CRM tab is addressed)
- Renders on hover-state similar to other Oskar nav affordances (subtle, mono uppercase, accent on hover)
- localStorage remembers the kanban's last-selected card so the user lands on the same one

**Acceptance**
- In BRIEF view's CRM subtab, click "← back to CRM" → admin CRM tab opens with the kanban + Hotel Bellevue card visually focused

## WP-CRM-C3 · Click-card navigation behavior

**Effort:** 0.4 h · **Depends on:** WP-CRM-A10, WP-CRM-A11

Two click behaviors based on session-existence:

**Deliverables**
- Pre-session lead (no session folder has this prospect's id — checked via the file-system scan from WP-CRM-A11): card click → inline-expand in place (per WP-CRM-A10). Inline expansion shows all fields, last 3 activities, "+ Start Discovery Session" button prominent.
- Post-session lead (at least one session folder's `_session-config.json` matches this `prospect_id`): card click → navigate to `/?session=<sessionId>` → BRIEF view → CRM subtab auto-active
- Hover state on cards differs: pre-session shows "click to expand"; post-session shows "click to open session"

**Acceptance**
- Click a Cold lead → inline expansion, no navigation
- Click a Discovery-Live lead → page navigates to the session's BRIEF view

## WP-CRM-C4 · Phase indicator pill on cards

**Effort:** 0.5 h · **Depends on:** WP-CRM-A11

Production state visible on the board.

**Audit finding before specifying:** `phase` is NOT currently a field in `SessionConfig`. Phase tracking in the existing app derives from elsewhere (file-presence heuristics: count of `vibe-*.html`, existence of `CREATIVE-BRIEF.md`, etc. — see `app/api/admin/sessions/route.ts` for how the Sessions tab does it today). C4 reuses that existing derivation logic — does NOT add a `phase` field to the config.

**Deliverables**
- Small pill on each kanban card next to the stage indicator, only renders if the card's prospect has at least one linked session (via A11's scan + cache): `Phase 3/7`
- Phase number derived from the same logic the Sessions tab uses today — file-presence checks against the session folder. Refactor that logic into a shared helper (`lib/session-phase.ts`) if it isn't already standalone.
- Color-coded: green for active sessions (last file mtime <7 days), amber for stalled (>7 days no file activity).
- No polling — phase is computed at kanban render time. The A11 cache also caches the phase per prospect; invalidate on session-creation.

**Acceptance**
- Lead with no session → no pill
- Lead with Phase 3 session (3 vibe-*.html files exist) → pill renders "Phase 3/7"
- Lead with session whose newest file is >7 days old → amber pill

---

# Phase D — Operational essentials (~5–6 h Claude)

Quality-of-life features that turn the CRM from "minimum viable" to "Filippo's home base."

## WP-CRM-D1 · Today view filter

**Effort:** 0.5 h · **Depends on:** WP-CRM-A2

**Deliverables**
- Pill in CRM header: "Today" toggles a filter
- Filters cards: `next_action_date ≤ today` OR `next_action_label = overdue`
- Sort by `amount_chf × confidence_pct` descending (highest-weighted first)
- Sticky in localStorage; default-on for next page load if last-used
- Counter on the pill ("Today · 8")

**Acceptance**
- Click Today → only cards with next_action ≤ today visible, ordered by weighted value
- Reload → Today still active

## WP-CRM-D2 · Search box

**Effort:** 0.5 h · **Depends on:** —

**Deliverables**
- Header search input
- Client-side filter across `company`, `contact_name`, `notes`, `tags`
- Highlight matched substrings in card text (yellow background)
- `/` shortcut focuses it
- Clear button (X) at right edge

**Acceptance**
- Type "tessin" → only cards with Tessin tag or in notes visible
- Backspace to clear → all cards return

## WP-CRM-D3 · Keyboard shortcuts

**Effort:** 0.7 h · **Depends on:** WP-CRM-A1, WP-CRM-D2

**Deliverables**
- `n` = focus Incoming column's quick-add input
- `/` = focus search
- `?` = show shortcuts overlay
- Arrow keys = navigate between cards (visible focus ring)
- Enter on focused card = inline-expand (pre-session) OR navigate to session (post-session)
- Esc = collapse expanded card / cancel inline-edit / close shortcuts overlay
- Cmd+K = quick switcher — type prospect name → fuzzy match → Enter to open

**Acceptance**
- Press `?` → overlay lists all shortcuts
- Arrow-navigate cards across columns → focus ring follows correctly

## WP-CRM-D4 · Status terminals — Won and Lost only

**Effort:** 1.0 h · **Depends on:** WP-CRM-A2, WP-CRM-A11

Two status terminals trigger production-side actions. Standby is intentionally NOT in scope — Filippo sees the board daily; a Standby card with its date IS the reminder. No daily-check LaunchAgent, no inbox notification, no integration with WP-MAC-DEPLOY. The kanban is the notification surface.

**Deliverables**
- Status → **Won** + Stage → Closing → fires a `POST /api/admin/deploy` call (placeholder until WP-DEPLOY ships). The placeholder writes an Activity row `delivery_started` and shows a toast `"Delivery workflow queued for <company>"`. No actual deployment yet.
- Status → **Lost** → explicit move via `fs.renameSync(public/<session-id>/, public/_archive/<session-id>/)`. Writes Activity row `session_archived`.
- **Safety: inline confirmation for Lost (only)** — Won doesn't move files, just writes an activity row, no confirmation needed. Lost moves the entire session folder out of `public/`, so it gets the explicit confirmation strip with the literal text:
  ```
  ┌─────────────────────────────────────────────────────────┐
  │ ⚠ Archive Hotel Bellevue Lugano?                        │
  │   Moves vibe-1 through vibe-N + brief + images          │
  │   to public/_archive/. Cannot be undone easily.         │
  │                                  [Cancel]  [Archive]    │
  └─────────────────────────────────────────────────────────┘
  ```
- No `confirm()` popup. The strip lives inside the status row of the inline-expanded card or the CRM subtab.

**Acceptance**
- Set lead to Won → POST to `/api/admin/deploy` fires (placeholder); Activity row `delivery_started` appears; toast shows
- Set lead to Lost → confirmation strip appears with the literal text above; click Archive → session folder moves to `public/_archive/<id>/`; Activity row `session_archived` appears
- Click Cancel → strip collapses; status stays at Lost only after second confirm-click

## WP-CRM-D5 · Per-prospect cost rollup + economics

**Effort:** 0.8 h · **Depends on:** WP-CRM-A11

The bridge a standalone CRM cannot build.

**Deliverables**
- Sum token burn from `public/<session-id>/logs/USAGE.json` (already populated today by `lib/usage-tracker.ts`) for all sessions belonging to a prospect. `_session-config.json` does NOT track cost — `USAGE.json` does. Use `readSessionUsage(sessionId)` from `lib/usage-tracker.ts`.
- Show in CRM subtab header: "Production cost: $4.23" alongside amount + confidence
- Aggregated pipeline forecast at top of the kanban:
  - Σ (amount × confidence%) per stage = weighted pipeline value
  - Σ production cost per stage
  - Net: weighted − cost
- Simple totals only — charts deferred

**Acceptance**
- Open a lead with Phase 3 session that's burned $4.23 → subtab header shows "Production cost: $4.23"
- Kanban header shows "Weighted pipeline: CHF 168k · Production cost: $X · Net: CHF Y"

## WP-CRM-D6 · Cross-link Sessions tab ↔ CRM tab

**Effort:** 0.5 h · **Depends on:** WP-CRM-C1

Bidirectional navigation between the two admin views.

**Deliverables**
- Sessions tab (in `admin.html`): each session entry reads its own `_session-config.json` to find `prospect_id`, then renders a "Linked prospect" breadcrumb → click jumps to CRM tab with that lead's card visually focused
- CRM subtab in BRIEF/STUDIO: the "← back to CRM" button from WP-C3 already provides one direction
- Additional: in the kanban card hover state, show the lead's session ID (if any) as a small mono-caps badge `S: 2026-05-18-hotel-bellevue`
- localStorage remembers last-viewed prospect across tab switches

**Acceptance**
- In Sessions tab, click breadcrumb "← Filippo's CRM · Hotel Bellevue" → CRM kanban opens with that card focused
- In CRM kanban, hover a card → session ID badge visible if linked

---

## Effort summary

| WP | Title | Phase | Claude-hours |
|---|---|---|---|
| **A1** | Quick-add input atop columns | A | 0.5 |
| **A2** | Activities sheet + persistence | A | 1.0 |
| **A3** | History from real Activities | A | 0.5 |
| **A4** | Standby reminder persistence | A | 0.3 |
| **A5** | Inline confirm (no `confirm()`) | A | 0.2 |
| **A6** | Drop Attachments panel | A | 0.1 |
| **A7** | Drag-and-drop between stages | A | 0.5 |
| **A8** | Tap-to-call / mailto / website | A | 0.2 |
| **A9** | Top-bar overflow fix | A | 0.2 |
| **A10** | Drop modal — cards inline-editable | A | 0.5 |
| **A11** | Retire `links.json` + add `prospect_id` to SessionConfig | A | 1.0 |
| **A12** | Move `_session-config.json` to `logs/` | A | 0.4 |
| **B1** | Bulk-paste modal | B | 1.5 |
| **B2** | CSV/XLSX file picker | B | 0.5 |
| **C1** | CRM subtab in BRIEF/STUDIO ⭐ | C | 1.5 |
| **C2** | "← back to CRM" button | C | 0.3 |
| **C3** | Click-card navigation behavior | C | 0.4 |
| **C4** | Phase indicator pill on cards | C | 0.5 |
| **D1** | Today view filter | D | 0.5 |
| **D2** | Search box | D | 0.5 |
| **D3** | Keyboard shortcuts | D | 0.7 |
| **D4** | Status terminals — Won + Lost only (no Standby daily-check) | D | 1.0 |
| **D5** | Per-prospect cost rollup | D | 0.8 |
| **D6** | Cross-link Sessions ↔ CRM | D | 0.5 |

- **Phase A**: ~5.5 h Claude (stop the bleeding + retire shadow DB + add `prospect_id` to schema + consolidate config under `/logs/`)
- **Phase B**: ~2.0 h Claude (bulk + intake)
- **Phase C**: ~2.7 h Claude (subtab integration — load-bearing UX + per-session subtab memory + link picker)
- **Phase D**: ~4.0 h Claude (operational essentials, D4 simpler without Standby daily-check)
- **Total**: ~14.2 h Claude ≈ **5–7 days wall-clock** with feedback latency

⭐ = the load-bearing piece. WP-C2 (CRM subtab in Assets panel) is what makes "CRM lives inside Oskar" mean anything.

---

## Files touched (full list)

**Modified**
- `public/admin.html` — drop modal (A10), inline-edit (A3/A7/A10), drag (A7), tap-to-call (A8), top-bar (A9), quick-add (A1), bulk-import button (B1), Today/Search/Keyboard hooks (D1/D2/D3), cross-link badges (D6)
- `lib/crm-store.ts` — Activities CRUD (A2), standby columns (A4), economics helpers (D5)
- `lib/crm-parsers.ts` *(new)* — vCard, CSV, signature, LinkedIn parsers shared between A1 and B1
- `docs/crm-feature/prospects.xlsx` — new `Activities` sheet (A2); no new columns on Prospects (A4 reuses existing `next_action_date` + `notes`)
- `docs/crm-feature/generate-seed.mjs` — emit new columns + initialize empty Activities sheet
- `docs/crm-feature/schema.md` — document Activities sheet + new columns
- BRIEF + STUDIO view components — register CRM subtab when `prospect_id` present (C2)

**New**
- `app/api/admin/crm/activities/route.ts` — GET list, POST append
- `app/api/admin/crm/activities/[id]/route.ts` — PATCH duration/notes
- `app/api/admin/deploy/route.ts` *(placeholder)* — invoked by D4 status terminal
- `app/api/admin/archive/route.ts` *(placeholder)* — invoked by D4 status terminal
- `components/admin/CrmLeadPanel.tsx` *(or vanilla module)* — the editable lead-detail panel embedded in the CRM subtab
- `components/admin/CrmBulkImport.tsx` — modal with paste/file/dup-detect

**Untouched**
- CD agent prompt — no MCP tools, no CRM-mode, no enrichment writes
- `mcp-server/*` — no new CRM tools
- Existing Oskar chat component — re-used as-is in BRIEF/STUDIO view (the CRM subtab is alongside it, not replacing)
- `app/api/admin/crm/prospects/route.ts` + `[id]/route.ts` — already correct from v1
- `app/api/admin/crm/sessions/route.ts` — already creates the session folder and writes `_session-config.json`; A11 removes its `links.json` writes and replaces the read path with a file-system scan

---

## Decisions (every open question gets answered)

1. **Activities sheet lives in the same xlsx file?** Yes. Filippo opens `prospects.xlsx` and sees both sheets in tabs at the bottom. Single source of truth.

2. **Duplicate detection key for bulk import?** `phone OR email`. Both empty → treat as fresh.

3. **Activity log: editable or append-only?** Append-only for `timestamp, prospect_id, type, icon, color`. Editable for `duration_min` and `notes` (Filippo can update post-call). No UI-delete (open `.xlsx` directly if a row must go).

4. **Modal vs subtab vs side-rail?** Modal is GONE. Lead detail editing lives in two places: (a) inline on the kanban card (quick fields + inline-expand for pre-session leads), (b) CRM subtab inside BRIEF/STUDIO's Assets panel (rich editing for post-session leads, available during discovery).

5. **CD writes to the CRM?** No. CD writes to `CREATIVE-BRIEF.md`. The CRM is Filippo's tool, edited by his fingers. No MCP tools for CRM. No `[CD]` enrichment columns. No back-sync.

6. **Tags via CD?** Same answer — no. CD does discovery and creative; tagging is Filippo's job.

7. **Excel file open in Excel/Numbers when CRM tries to write?** xlsx package fails on locked file → API returns 503 with body `"Excel file is currently open — please close it and try again"`. UI shows toast. Same as today. Future: write-queue, out of scope.

8. **Phase ordering?** A → A+B can ship together (disjoint code). C depends on A's Activities API. D depends on C's subtab. Sequence: A → A+B → A+B+C → +D.

9. **Localization (DE/IT/EN UI toggle)?** **Out of scope.** Cut. Filippo works in English-labeled UI; if Italian labels ever become a need, separate WP.

10. **Pre-session lead detail editing surface?** Inline-expand on the card. Click → card expands in place to show all fields editable + last 3 activities + "Start Discovery Session" button. Other cards stay collapsed. Esc collapses.

11. **What does "the CRM lives inside Oskar" mean in code?** Three concrete things: (a) the CRM kanban is a tab in `/admin.html`, not a separate app; (b) starting a discovery session navigates to BRIEF view of that session; (c) the CRM subtab in BRIEF/STUDIO renders the lead's editable detail next to the discovery chat. The "back to CRM" button (WP-C3) closes the loop.

12. **What does the CRM read from sessions (read-only)?** Phase number (surfaced as phase pill on kanban cards via WP-C4), aggregated token burn (surfaced as per-prospect cost rollup via WP-D5). All other production telemetry (vibe thumbs, build progress, agent activity) is visible natively in BRIEF/STUDIO chrome when Filippo is inside a session — no Sessions rail duplicating it inside the CRM subtab.

13. **What does Oskar do when status changes?** Won/Stage=Closing → deploy workflow (placeholder until WP-DEPLOY). Lost → archive session folder (explicit move to `public/_archive/`). Standby → pure CRM state (date stored in `next_action_date`, plan in `standby_plan`). No daily-check notification, no LaunchAgent integration — Filippo sees the board daily, that IS the reminder. Other status changes are pure CRM state.

---

## Non-goals (NOT in this WP)

- ❌ Email integration (forward-to-CRM, SMTP auth, send-from-CRM)
- ❌ Twilio / VoIP dialer / call recording / transcript ingestion
- ❌ Multiple owners / team rights / per-prospect ACL
- ❌ Lead scoring, AI next-best-action, deal velocity dashboards
- ❌ Forms / embeds for inbound leads
- ❌ Mobile-optimized layout (desktop-only for v1)
- ❌ Localization (DE/IT/EN toggle) — explicit kill in v6
- ❌ Forecasting / pipeline-revenue projections (beyond the simple weighted sum in D5)
- ❌ Workflow automations beyond the status terminals in D4
- ❌ File uploads to leads
- ❌ Per-call audio dictation → CRM auto-fill
- ❌ MCP tools for CD to write CRM data — explicit kill in v6
- ❌ CD enrichment of CRM columns (industry, voice, audience, etc.) — explicit kill in v6
- ❌ Braided activity log mixing agent events with Filippo's calls — agent events stay in `_session-config.json`, CRM Activities is Filippo-only
- ❌ Centered modal anywhere — explicit kill in v6

---

## Acceptance criteria — end-to-end Filippo flow

If Filippo can do all of this in one session, the WP is done:

1. Open `/admin.html` → click CRM nav tab → kanban renders with 19 cards, theme toggle visible at 1280 px
2. Paste 23 leads from LinkedIn Sales Navigator into Bulk Import → preview → Import → 23 cards in Incoming, .xlsx updated
3. Press `n` → quick-add input focused → type "Hotel Splendid, Sabine Müller, +41 79 678 90 12" → Enter → card appears
4. Click the phone icon on a card → Mac Continuity prompts to call
5. Drag the card Incoming → Contacted → Activity row `stage_changed` written
6. Click the Cold lead's card → inline-expands in place → edit notes → blur → persisted
7. Click the "+ Start Discovery Session" button on the expanded card → session created → redirects to BRIEF view of new session
8. In BRIEF view, click the CRM subtab → editable card panel renders alongside discovery chat
9. CD runs discovery in the chat. Filippo watches and types occasional notes into the CRM subtab's Comment field → autosaves
10. After Phase 3 vibes are built → BRIEF/STUDIO view shows the new vibes natively; the lead's card on the kanban shows phase pill "Phase 3/7" and total cost "$4.23" rolled up from WP-D5
11. Filippo clicks "← back to CRM" → kanban opens with Hotel Bellevue card visually focused
12. Drag to Closing → set status Won → deployment workflow fires → Activity row `delivery_started` written
13. Reload everything → all changes persisted in `prospects.xlsx`, weighted pipeline updated, no Potemkin defects remain

If all 13 steps pass, this WP ships.

---

## Pre-commit checks

- `npx tsc --noEmit` clean
- `node docs/crm-feature/generate-seed.mjs` regenerates .xlsx cleanly
- `npm run dev` boots, admin tab loads, CRM kanban renders
- No native `window.prompt()` or `window.confirm()` anywhere in the CRM surface
- No `crm-modal-backdrop` DOM remnants
- All 13 acceptance steps pass manually
- Header at 1280 × 800 shows all controls including theme toggle

---

## Rollback

Per-phase via `git revert <commit>`. Disjoint code:
- Phase A: `admin.html` JS + `Activities` API
- Phase B: bulk-import component + sub-route
- Phase C: BRIEF/STUDIO view components + CRM subtab module
- Phase D: independent feature additions

The single `.xlsx` schema addition (the `Activities` sheet) is additive — pre-WP `prospects.xlsx` still loads fine after this WP ships. No new Prospects columns (A4 reuses existing).

Phase D depends on Phase C (subtab must exist before D5 cost rollup renders there). Phase C depends on Phase A's Activities API. Rollback sequence if needed: D → C → B → A.

---

## Sequencing recommendation

**PR 1 — Phase A** (all 10 sub-WPs together). Small additive changes, no structural disruption to the kanban. Ship to Filippo. Get reactions.

**PR 2 — Phase B** (B1 + B2 together). Bulk-import alone. Independent code.

**PR 3 — Phase C** (C1 + C2 + C3 + C4 + C5 + C6 together). The integration. Touches BRIEF + STUDIO view components, plus subtab module. Single PR because the pieces interlock.

**PR 4 — Phase D** (D1–D6, individually committable but ship as one PR). Polish + economics + cross-link. After Filippo has used PR 3 for at least a few days.

---

## Critical files for the implementing engineer

- **READ FIRST**: `public/admin.html:706-902` (current CRM HTML) + `public/admin.html:1750-2083` (current CRM JS) + `lib/crm-store.ts` (full file) + `docs/crm-feature/schema.md` + the four noCRM screenshots in `public/2026-01-27-debug/`
- **MODIFY**: `public/admin.html`, `lib/crm-store.ts`, `docs/crm-feature/prospects.xlsx`, `docs/crm-feature/generate-seed.mjs`, `docs/crm-feature/schema.md`, BRIEF + STUDIO view components
- **CREATE**: `app/api/admin/crm/activities/route.ts`, `app/api/admin/crm/activities/[id]/route.ts`, `lib/crm-parsers.ts`, `components/admin/CrmLeadPanel.tsx`, `components/admin/CrmBulkImport.tsx`, `app/api/admin/deploy/route.ts`, `app/api/admin/archive/route.ts`
- **REUSE**: `app/api/admin/crm/prospects/route.ts` + `[id]/route.ts`, `app/api/admin/crm/sessions/route.ts`, existing Oskar chat component, existing build-vibe pipeline, existing `xlsx` package, existing Tailscale + Caddy setup for serving

---

*End of WP-CRM v6. Compiled 2026-05-22 after five design iterations. The sixth one finally listened.*
