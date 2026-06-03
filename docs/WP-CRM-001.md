# WP-CRM-001 — Complete CRM State, Audit & Forward Plan

**Owner:** Jedi Claude (engineering)
**Requested by:** Ralph (CD) on behalf of Filippo (sales)
**Status:** LIVING DOCUMENT — captures every CRM-related decision, fix, and pending item discussed in this work session
**Date opened:** 2026-05-22
**Last revised:** 2026-05-24

This document is the **single source of truth** for the current CRM state and forward plan. It supersedes the "next steps" thinking in any prior thread but does **not** replace `docs/WP-CRM.md` — that file remains the canonical record of the original Phase A–D plan (v6.3, 24 WPs). When the two documents disagree on what's *shipped*, this one wins.

---

## 0. Table of contents

1. [Context — who this CRM is for and what shape it takes](#1-context)
2. [Architectural axes — what's orthogonal to what (locked decisions)](#2-architectural-axes)
3. [Data model — current Prospect & Activity schema](#3-data-model)
4. [What's already shipped (with detail per WP)](#4-shipped)
5. [Audit — every identified stub (S1–S17)](#5-audit)
6. [Work packages to ship next (F1–F19)](#6-forward-wps)
6a. [Group B — local foundation for multi-machine sync (F20–F25)](#6a-group-b) — SQLite + event log + content-hashed media + xlsx fallback. Companion to **Feature-X.md §15** (the server-dependent sync WPs WP-104..108). Group B has no server dependency and is independently shippable.
7. [Explicitly NOT building (with reasoning)](#7-not-building)
8. [Open questions & deferred decisions](#8-open)
9. [Recommended ship sequence](#9-sequence)
10. [Acceptance criteria for v1 complete](#10-acceptance)

---

## 1. Context

### User
**Filippo.** Solo outbound salesperson for Oskar. Sells brand/landing-page design services to small/medium B2B businesses in Switzerland (bars, dental clinics, hotels, ateliers, garages — mostly Tessin and German-speaking cantons).

### Scale
- **~30–50 active leads** at any time (will grow but not to enterprise scale)
- **One contact per deal** (decision-maker is the bar owner / clinic director / garage owner — no enterprise buying committees)
- Deal sizes CHF 3'600 – 50'000
- Sales cycle: weeks to a few months
- Filippo works from his laptop + phone, not a CRM workstation

### Where the CRM lives
**Inside Oskar.** Not a standalone app. Three surfaces:

1. **`public/admin.html`** — full-screen dashboard at `/admin` with top-nav pills (Sessions / CRM / Analytics)
2. **CRM subtab inside BRIEF/STUDIO Assets panel** — so Filippo edits the lead while a discovery session runs alongside
3. **No external CRM.** No HubSpot, no Salesforce, no Pipedrive — those are explicit non-goals

### The integration thesis
The CRM **inside** Oskar means:
- Kanban is one tab away from the discovery flow
- Starting a discovery session navigates Filippo into Oskar's BRIEF/STUDIO with the CRM subtab right there for live edits during the call
- Returning to the kanban from a session is one click
- Filippo never tab-switches between two apps; he switches views inside one
- The closed loop is preserved: production economics (token cost, session phase) surface back on the lead card

A standalone CRM linked-to-Oskar would force tab-switching during calls and lose this loop. CRM-as-an-Oskar-subtab IS the integration.

---

## 2. Architectural axes

These are **locked** — every WP defers to them.

### 2.1 No modals
Every "open" UI is **inline-expand**: the kanban card hoists out of its column and overlays 2 of the 4 kanban columns. No backdrop, no slide-in panel, no centered dialog. The only modal in the entire CRM is the Bulk Import paste box, kept because pasting CSV/vCard text deserves a dedicated focus surface.

### 2.2 No shadow databases
**Two stores only:** Excel + filesystem.
- `docs/crm-feature/prospects.xlsx` — Prospects sheet + Activities sheet
- `public/<sessionId>/logs/_session-config.json` — session linkage (`prospect_id` lives here)
- That's it. No SQLite, no Redis, no `links.json` (retired in WP-CRM-A11), no shadow tables.

### 2.3 No MCP tools for CRM
The CD agent **does not write to the CRM**. CD writes to `CREATIVE-BRIEF.md`. The CRM is Filippo's tool, edited by his fingers (or by the Discovery Bridge — see F1).

### 2.4 No i18n
English UI. German placeholders are not in scope. Filippo reads English fine; localization is a v3 problem if ever.

### 2.5 All text fields save inline
**No Save buttons.** Every text input / textarea / number input commits via `crmPersistFieldDebounced` (500ms debounce) or `crmPatchEcon` (on blur). The dead `crmSaveModal` function — a relic of the original Save-button modal — was deleted (S9).

### 2.6 Excel writes preserve the Activities sheet
The xlsx package's naive write is destructive (rewrites the whole workbook). The CRM's `writeSheet()` and `writeActivitiesSheet()` both use a **read-then-replace** pattern: read the existing workbook, replace only the target sheet, write back. This is load-bearing — without it, every prospect edit would wipe the Activities sheet.

### 2.7 Inline-expand spans 2 columns (overlay positioning)
When a card opens, it becomes an absolute-positioned overlay on top of `#crm-board` (which is `position: relative`). The overlay width = `calc(2 * var(--col-width) + var(--gap-app))`. `left` is computed from the source column index, clamped so a rightmost-column expansion shifts one column to the left rather than overflowing. The other 2 columns stay in flow and remain interactive.

### 2.8 No new entities for scheduled tasks
Follow-ups and "next actions" are represented by **`next_action_date` + `next_action_label` on the Prospect row** — not a separate Task entity. The Activities sheet records what *happened*; the Prospect's next-action fields record what *should* happen next. One row, two roles, no parallel state.

---

## 3. Data model

### 3.1 Prospect (21 columns in `prospects.xlsx` → "Prospects" sheet)

| Column | Type | Purpose |
|---|---|---|
| `id` | string `P001..P999` | Stable identifier |
| `company` | string | Display title of the card |
| `contact_name` | string | Single contact (one per prospect) |
| `phone` | string | Used for tap-to-call icon |
| `email` | string | Used for tap-to-email icon |
| `website` | string | Auto-prefixed with `https://` when rendered |
| `stage` | `'Incoming' \| 'Contacted' \| 'Demo done' \| 'Closing'` | Kanban column |
| `status` | `'To do' \| 'Standby' \| 'Won' \| 'Lost' \| 'Cancelled'` | Pill row in expanded card |
| `amount_chf` | number | Deal size; column subtotal |
| `confidence_pct` | number (0–100) | Win probability; drives weighted pipeline |
| `next_action_date` | ISO date `YYYY-MM-DD` | Drives Today filter, chip color, scheduled-follow-up row |
| `next_action_label` | string | **Now fallback only** — live label is computed from date (S2 fix) |
| `tags` | comma-separated string | Free-text classifier ("Cold-call, Tessin") |
| `starred` | boolean | Filippo's manual priority flag |
| `owner` | string | Reserved for multi-rep future; always 'Filippo' today |
| `notes` | string | General free-text comment |
| `created_at` | ISO datetime | Used for stage-age fallback (when no `stage_changed` activity yet) |
| `standby_plan` | string | Free-text "what I'm waiting on" when status=Standby (WP-A4) |
| `lost_reason` | string | "Price" / "Competitor" / "Timing" / "No budget" / "No response" / `Other: ...` |
| `needs_analysis` | string | **Pre-demo:** gaps Filippo sees about the customer (old website, ancient phone, no social, etc) |
| `solutions_bought` | string | **Post-demo:** itemized record of what the customer ordered |
| `post_mortem` | string | **Post-close** (planned, F14): narrative of what worked / what blocked / lesson for next time. Empty when status is not terminal. |
| `recurring_pattern` | string | **Planned (F18):** recurrence rule for the next-action date. `''` (one-shot), `'every-Nd'` (every N days), or `'every-<weekday>'` (`mon`/`tue`/…/`sun`). Auto-clears on positive-outcome activities (Answered/Connected/Completed) — "until they answer" semantics. |

### 3.2 Activity (in `prospects.xlsx` → "Activities" sheet, written by `appendActivity` in `lib/crm-store.ts`)

| Column | Type | Purpose |
|---|---|---|
| `id` | `A0001..A9999` | Stable identifier |
| `prospect_id` | FK to Prospects | |
| `timestamp` | ISO datetime | Sort key (newest first by `readActivities`) |
| `type` | ActivityType enum | See list below |
| `icon` | Lucide icon name | Rendered in compose form |
| `color` | Hex | Type accent |
| `duration_min` | number | For Call/Meeting/Zoom Call types |
| `notes` | string | Free-text body (also holds email body for E-mail types) |
| `session_id` | string | Only set for `Started Discovery Session` |
| `user_id` | string | Reserved for multi-user; always 'Filippo' |
| `outcome` | string | **Planned (F15):** discrete outcome picked at log-time (`no_answer`, `voicemail`, `sent`, `cancelled`, etc). Drives the Action Chain auto-snooze. Empty for activity types without outcomes (Note, E-mail In, Started Discovery). |

**ActivityType values:**
- User-logged: `Call`, `Qualification Call`, `Meeting`, `Zoom Call`, `Onsite Visit`, `E-mail Out`, `E-mail In`, `Proposal`, `Note`
- Auto-written: `Started Discovery Session`, `stage_changed`, `status_changed`, `delivery_started`, `session_archived`

### 3.3 SessionConfig (in `public/<sessionId>/logs/_session-config.json`)

| Field | Type | Purpose |
|---|---|---|
| `prospect_id` | string | **The link.** Set when session created from CRM. Drives `scanProspectSessions()` |
| `createdAt` | ISO datetime | When the session was first created |
| `outcome` | `'won' \| 'lost' \| 'abandoned' \| null` | Set when terminal status reached |

Phase + token cost are **derived elsewhere** (not stored here):
- Phase comes from `lib/session-phase.ts → deriveSessionPhase()` (file-presence heuristics)
- Token cost comes from `logs/USAGE.json` via `lib/usage-tracker.ts → readSessionCostSync()`

---

## 4. What's already shipped

This section catalogs the full state of `/admin.html` CRM as of 2026-05-24.

### 4.1 Original WP-CRM Phase A (per `docs/WP-CRM.md`, v6.3)

| WP | What | Status |
|---|---|---|
| A1 | Quick-add input at top of each kanban column | ✓ Shipped |
| A2 | Activities sheet (Excel 2nd sheet) + Log Activity picker + history timeline | ✓ Shipped |
| A3 | History reads real Activities sheet (was synthesized timeline) | ✓ Shipped |
| A4 | Standby panel with date + plan inputs, separate `standby_plan` column | ✓ Shipped |
| A5 | Inline-edit of compact card star | ✓ Shipped |
| A6 | Drop attachments — deferred (not in v1 scope) | ⏸ Deferred |
| A7 | Drag-drop between kanban stages | ✓ Shipped |
| A8 | Tap-to-call + tap-to-email icons on compact card | ✓ Shipped |
| A9 | (Deleted by Ralph) | — |
| A10 | Inline-expand on card (replaces centered modal) | ✓ Shipped |
| A11 | Retire `_crm/links.json`, scan filesystem for `prospect_id` | ✓ Shipped |
| A12 | Move `_session-config.json` into `logs/` | ✓ Shipped |

### 4.2 Filippo's four additions (mid-session asks)

| Feature | Detail | Status |
|---|---|---|
| Lost / Cancelled reason picker | 6-chip picker (Price / Competitor / Timing / No budget / No response / Other) on status pill click | ✓ Shipped |
| Next-action prompt after activity log | After logging Call/Note, prompt "follow-up when?" with 1d / 3d / 1w / custom date chips | ✓ Shipped |
| Stage-age whisper on cards | Silent <14d, grey 14–20d, amber ≥21d, computed from latest `stage_changed` activity (server) | ✓ Shipped |
| iCal export | Meeting-shaped activities (Meeting / Zoom Call / Onsite Visit) offer "Add to calendar" checkbox; downloads `.ics` file | ✓ Shipped |

### 4.3 Inline-expand 2-column overlay (from this session)

- Card clicked → hoisted out of column → overlays 2 of 4 kanban columns
- Column position computed from source column index, clamped to avoid overflow
- ESC / X / header-click collapses
- Two click zones on compact card:
  - **Header zone** → expand inline (always)
  - **Body zone** → navigate to session if one exists; expand inline otherwise

### 4.4 2-column expanded card body layout

Above History:
```
Row 0:  [ Tags — full-width chip strip ]
Row 1:  [ Personal Info — 2×2 sub-grid ]   |   [ Sessions Rail ]
Row 2:  [ Comment — full-width textarea ]
Row 3:  [ Needs Analysis (5 rows) ]         |   [ Solutions Bought (5 rows) ]
```

Below: History timeline (composer pending in F4 + scheduled row + activity rows).

### 4.5 Inline-editable fields (NO Save buttons anywhere)

| Field | Input type | Persist mechanism |
|---|---|---|
| `company` (header) | borderless text input | `crmPersistFieldDebounced` |
| `contact_name` | text input | `crmPersistFieldDebounced` |
| `phone` | text input | `crmPersistFieldDebounced` |
| `email` | text input | `crmPersistFieldDebounced` |
| `website` | text input | `crmPersistFieldDebounced` |
| `notes` | textarea (3 rows) | `crmPersistFieldDebounced` |
| `needs_analysis` | textarea (5 rows) | `crmPersistFieldDebounced` |
| `solutions_bought` | textarea (5 rows) | `crmPersistFieldDebounced` |
| `amount_chf` | number input | `crmPatchEcon` on blur or Enter |
| `confidence_pct` | number input | `crmPatchEcon` on blur or Enter |
| `tags` | chip cloud + add input | `crmTagsSave` |
| `status` | pill buttons (5) | `crmSetStatus` (+ reason picker for Lost/Cancelled) |
| `standby_plan` | text input (Standby panel) | `crmStandbyPersistDebounced` |
| `next_action_date` | date input (Standby + Scheduled row) | `crmStandbyPersist` / `crmFollowupSetCustom` |
| `lost_reason` | chip picker (re-openable via Change ▾) | `crmLostReasonPersist` |
| `starred` | star icon toggle | `crmPatch` (no full re-render — S15 fix) |

### 4.6 Toolbar & filters

| Control | Behavior | Status |
|---|---|---|
| Search box (`/` shortcut) | Substring match across company, contact, notes, tags, phone, email, id | ✓ |
| Today pill | Filters to `next_action_date <= today`; counter shows count; click toggles; persisted in localStorage | ✓ |
| Cmd+K | Global quick switcher (sessions ∪ prospects ∪ vibes) — bound at top of document keydown handler | ✓ |
| `?` overlay | Documents shortcuts (/, n, ↑↓←→, ↵, ⌘K, Esc, ?) | ✓ |
| New Lead button | Creates placeholder + opens expanded card with company input focused (S17 fix) | ✓ |
| Bulk Import | Paste CSV/TSV/vCard/XLSX; column mapping UI; duplicate detection; preview before commit | ✓ |
| Reload | Re-read Excel file; calls `crmLoad()` | ✓ |

### 4.7 Kanban columns

- 4 columns: Incoming (blue) / Contacted (violet) / Demo done (amber) / Closing (emerald)
- Header: stage name, lead count, CHF subtotal, quick-add input
- Body: drop zone for drag-and-drop between stages
- Drop → calls PATCH which now auto-writes `stage_changed` activity (S13)
- CHF subtotal updates inline when amount edited (no full re-render — uses `data-column-total` attribute)

### 4.8 Compact card features

- Avatar (company initial)
- Company name (highlighted on search match via `crmHighlight`)
- Tap-to-call icon (phone) — `<a href="tel:...">`
- Tap-to-email icon (mail) — `<a href="mailto:...">`
- Star (toggleable, visible only on hover unless starred)
- Amount + confidence + **live-computed** next-action chip (S2)
- Stage-age chip (silent / grey / amber)
- Phase pill (when session exists, shows production phase)
- Session badge (visible on hover, shows session id)
- Two click zones (header + body)
- Drag handle (entire card draggable)

### 4.9 Expanded card features

**Header row:**
- Avatar, **editable company input** (S17), star
- ID · stage (read-only display)
- Prev / Next chevrons (currently walks full prospect list — F7 will fix to respect filter)
- Close (X) button

**Status row:**
- 5 status pills (To do / Standby / Won / Lost / Cancelled)
- **Inline lost-reason label** when terminal (S1) — `— Price` next to active pill

**Econ row:**
- CHF amount input (10px mono, 88px wide)
- % confidence input (10px mono, 48px wide)
- **Scheduled-follow-up badge** (S3) — color-coded chip `📅 2026-05-29 · 3d upcoming`; click scrolls to scheduled row in History
- "saved ✓" indicator (fades after persistence)

**Conditional panels:**
- Standby panel (amber, when status=Standby) — date + plan inputs, debounced persist
- **Lost reason panel** (rose, when terminal+reason set — S1) — displays stored reason + `Change ▾` button to re-open picker

**Body (above History):**
- Row 0: Tags strip
- Row 1: Personal Info 2×2 grid | Sessions Rail (with Start Discovery CTA)
- Row 2: Comment textarea (full width)
- Row 3: Needs Analysis | Solutions Bought (both 5-row textareas)

**History block:**
- Title "History" + Log Activity dropdown
- **Scheduled row** (S3) — pinned at top when `next_action_date` set; color-coded (red overdue / amber today / blue upcoming); inline `+1d / +3d / +1w / [date picker] / Done` actions
- Activity timeline (newest first), with email body collapsible at >200 chars

### 4.10 Activity picker (9 types)

Call · Qualification Call · Meeting · Zoom Call · Onsite Visit · E-mail Out · E-mail In · Proposal · Started Discovery Session

Each opens an inline compose form:
- Notes textarea (2 rows for most, 5 for emails; now 4 rows for non-email after E1 fix)
- Duration input for Call-shaped types
- Date+time picker + iCal checkbox for Meeting-shaped types
- Save / Cancel buttons

After save: prompt "follow-up when?" with 1d/3d/1w/date chips → updates `next_action_date`.

### 4.11 Backend routes

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/crm/prospects` | GET | Returns prospects with `stage_age_days` enriched |
| `/api/admin/crm/prospects` | POST | Create single new prospect |
| `/api/admin/crm/prospects/[id]` | PATCH | Update; **auto-writes `stage_changed` activity** on stage diff (S13) |
| `/api/admin/crm/prospects/bulk` | POST | Bulk import (CSV/vCard/XLSX) |
| `/api/admin/crm/activities` | GET | List activities (optionally filtered by `prospect_id`) |
| `/api/admin/crm/activities` | POST | Append new activity |
| `/api/admin/crm/activities/[id]` | PUT | Update activity (backend exists — no UI yet, F6 will add) |
| `/api/admin/crm/sessions` | GET | Filesystem scan of `public/*/logs/_session-config.json`, cached 5s |
| `/api/admin/crm/sessions` | POST | Create session folder + `_session-config.json` with `prospect_id` |
| `/api/admin/crm/parse` | POST | Bulk-import parser |

### 4.12 WP-CRM-E1 (shipped in this session) — Quick visual fixes

- **Textarea min-height** for `rows="3"` → 4.5rem, `rows="4"` → 6rem, `rows="5"` → 7.5rem (fixes flex/grid collapse that hid multi-line placeholders)
- **Inline-input font-size** 11px → 10px (matches surrounding `text-[10px]` econ row)
- **Tags moved to top** of body (Row 0); Comment becomes full-width Row 2
- **Activity compose textarea** `rows="2"` → `rows="4"` for non-email types

### 4.13 WP-CRM-E2 part 1 (shipped in this session) — Data-rot fixes

- **S1 — Lost reason now visible** (was write-only): inline label next to active status pill (e.g., `— Price`) + dedicated rose-tinted panel with full reason text + `Change ▾` button that re-opens the picker via `crmChangeLostReason()`
- **S2 — Live next-action chip** (was stale stored string): `crmComputeNextAction(p)` computes label from `next_action_date` vs today every render; chip class derived from `kind` (overdue/today/upcoming/static); stored label is fallback only
- **S3 — Scheduled follow-ups visible** (were invisible): pinned colored row at top of History with snooze (+1d / +3d / +1w / date picker) + Done; colored badge in econ row; `crmSnoozeFollowup` anchors on current scheduled date; `crmClearFollowup` writes a Note audit row
- **Bonus** — `crmRender` now auto-refreshes history + tag editor whenever the overlay rebuilds, so star/status toggles no longer wipe the History timeline

### 4.14 WP-CRM-E2 part 2 (shipped in this session) — Cleanup batch

- **S9** — Deleted dead `crmSaveModal` (was never called from anywhere; relic of the modal era)
- **S13** — Server-side auto-write of `stage_changed` activity on PATCH route when `patch.stage !== before.stage`; removed duplicate frontend write in `crmDrop` to avoid double-rows
- **S15** — `crmToggleStar` no longer calls `crmRender()` (only toggles class on `#crm-modal-star`); snappier + bonus: history no longer wipes on star click
- **S16** — False alarm in audit: Cmd+K already globally bound at top of document keydown handler and documented in `?` overlay
- **S17** — `crmNewLead` rewritten: creates placeholder prospect, reloads, opens expanded card, focuses + selects company input; required making company name **editable** in expanded card header (was a read-only `<span>`, now an input wired to `crmPersistFieldDebounced('company', ...)`)

---

## 5. Audit — every identified stub

Format: `Sx · severity · status · short description`. Severity colors match the original audit; status reflects 2026-05-24.

| # | Sev | Status | Description |
|---|---|---|---|
| **S1** | 🔴 | ✓ Fixed | `lost_reason` was write-only; now displayed inline + in dedicated panel |
| **S2** | 🔴 | ✓ Fixed | `next_action_label` chip was stale stored string; now live-computed from date |
| **S3** | 🔴 | ✓ Fixed | Scheduled follow-ups were invisible; now pinned in History + econ badge |
| **S4** | 🟠 | ⏳ Pending (F5) | Terminal cards (Lost/Won/Cancelled) look identical to live cards in kanban |
| **S5** | 🟠 | ⏳ Pending (F7) | Navigation prev/next ignores active filter (walks full prospect list) |
| **S6** | 🟠 | ⏳ Pending (F6) | Activity timeline is append-only — no edit, no delete (backend `PUT` exists, no UI) |
| **S7** | 🟠 | ⏳ Pending (F4) | Activity picker missing "Note" type — F4 makes Note the *default* via composer |
| **S8** | 🟠 | ⏳ Pending (F6) | E-mail Out/In activities have no subject field |
| **S9** | 🟡 | ✓ Fixed | Dead `crmSaveModal` deleted |
| **S10** | 🟡 | ⏳ Pending (F5) | Lost/Cancelled stays in stage → column totals include terminal deals |
| **S11** | 🟡 | ⏳ Pending (F8) | "Phase 3/7" pill semantics conflicts with sales-stage mental model |
| **S12** | 🟡 | ⏳ Pending (F5) | Today pill counts terminal deals as "due today" |
| **S13** | 🟡 | ✓ Fixed | Stage-age computation now resilient to non-drag PATCH paths (server hook) |
| **S14** | 🟢 | ⏳ Pending (F9) | Email show-full toggle uses `JSON.stringify` in button — ugly but works |
| **S15** | 🟢 | ✓ Fixed | Star toggle no longer re-renders entire kanban |
| **S16** | 🟢 | ✓ N/A | False alarm — Cmd+K already globally bound |
| **S17** | 🟠 | ✓ Fixed | New Lead button now creates placeholder + opens editable form |

**Total: 9 fixed, 7 pending, 1 N/A**

The 7 pending items map to F4–F9 below.

---

## 6. Forward WPs (F1–F19)

### WP-CRM-F1 — Discovery Bridge (~30m, standalone, **ship first**)

**The single highest-leverage item.** Every discovery session today starts cold — the CD agent asks Filippo to re-tell everything that's already in the CRM. With CRM context injected as a between-turn user note, CD opens warm AND the `needs_analysis` field (currently write-only display) finally has a consumer.

**Mechanism (revised 2026-05-24, after Ralph caught the original spec over-engineering this):**

Reuse the existing **between-turn user-message injection pipeline** that the chat UI already uses (`page.tsx:2419 pushUserMessageToCD`) and the orchestrator's `send_user_input(mode='inbox-note')` tool dispatches through. That route is `POST /api/mcp/notify-agent` with `from: 'user'`, target: 'cd', priority: 'high'. The message lands in CD's inbox; CD picks it up on its next `agent_inbox()` poll (which happens at the start of every turn). CD's *very first response to Filippo's first chat message* references the CRM context, because by then the inbox-note is already in CD's context as a user-shaped message.

**No file write. No CD-agent prompt change. No new entity. No parallel state.** The pipeline already exists, has been exercised in production (chat UI between-turn pushes), and is the canonical mechanism for "give CD context outside the normal user-types-in-chat path."

**Files touched:**
- `app/api/admin/crm/sessions/route.ts` — POST handler (one extra `fetch` after `writeSessionConfig`)
- Nothing else. No new files. No prompt edits. No new exports.

**Implementation:**

In the POST handler, AFTER `writeSessionConfig(sessionId, {prospect_id, ...})` and BEFORE the redirect response, build the CRM-context message and POST it to `/api/mcp/notify-agent`:

```ts
// Build the context message — plain text, formatted to read naturally as if
// Filippo himself had pasted it. CD's pattern for handling user notes already
// treats them as "user gave me context"; framing matters less than substance.
function buildCrmSeed(prospect: Prospect, recent: Activity[]): string {
  const lines = [
    `[CRM context — Filippo's working notes for this prospect]`,
    ``,
    `Company: ${prospect.company} (${prospect.id})`,
    `Contact: ${prospect.contact_name}${prospect.phone ? ' · ' + prospect.phone : ''}${prospect.email ? ' · ' + prospect.email : ''}`,
    `Stage / status: ${prospect.stage} · ${prospect.status} · CHF ${prospect.amount_chf} · ${prospect.confidence_pct}% confidence`,
    prospect.tags ? `Tags: ${prospect.tags}` : '',
    ``,
    `Why I approached:`,
    prospect.notes || '(no notes yet)',
    ``,
    `Gaps I see (Needs Analysis):`,
    prospect.needs_analysis || '(none captured yet — please probe in discovery)',
    ``,
    `Solutions already discussed (Solutions Bought):`,
    prospect.solutions_bought || '(none yet — first contact)',
    ``,
    recent.length ? `Recent activities (newest first):` : '',
    ...recent.slice(0, 5).map(a => {
      const stamp = (a.timestamp || '').slice(0, 16).replace('T', ' ');
      const dur = a.duration_min ? ` (${a.duration_min}min)` : '';
      const note = a.notes ? ` — "${a.notes.slice(0, 140)}"` : '';
      return `- ${stamp} · ${a.type}${dur}${note}`;
    }),
    ``,
    `Please use this as the starting context for our discovery — don't re-ask what's already here.`,
  ];
  return lines.filter(l => l !== undefined).join('\n');
}

// In POST handler, after writeSessionConfig:
const recent = readActivities(prospectId);
const message = buildCrmSeed(prospect, recent);
try {
  await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/mcp/notify-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      from: 'user',
      fromInstance: 'crm-bridge',  // distinguishes from chat-UI-typed user input
      target: 'cd',
      message,
      priority: 'high',
      replyTo: null,
    }),
  });
} catch (err) {
  // Non-fatal: the session is still created and usable. Filippo just won't
  // get the warm-open benefit for this session.
  console.warn('[CRM] Discovery Bridge inject failed (non-fatal):', err);
}
```

**Source data:** pulled via existing `readSheet()` + `readActivities(prospect_id)` from `lib/crm-store.ts`. Zero new imports beyond the `fetch`.

**Why this beats the original CRM-SEED.md-on-disk spec (rejected):**

| Aspect | Old spec (file write + prompt change) | New spec (inbox-note injection) |
|---|---|---|
| Files created | `logs/CRM-SEED.md` per session | None |
| CD agent edits | New paragraph in agent prompt | None — already polls inbox |
| Round trips | Server writes file → CD does `Read(...)` tool call → integrates | Server posts once → CD receives in next inbox poll |
| Parallel state | Yes — file on disk + Excel row could drift | No — Excel row IS the source, message is a snapshot at session-creation |
| Pipeline reuse | Invents a new pattern | Reuses `notify-agent` (chat UI, send_user_input, peer-agent messaging all use this) |
| Failure mode if CD never reads file | Silent — CD just doesn't reference it | Same — inbox note ages out, but the inbox-poll-at-turn-start makes "never reads" highly unlikely |

**Edge cases:**
- Prospect not found → skip injection (don't fail session creation)
- Activities fetch fails → inject context without "Recent activities" section
- notify-agent endpoint 500s → log warning, session still works (no warm open this time)
- Re-creating an existing session → inject anyway (CD will get a fresh context dump; harmless if redundant)

**No frontend changes.**

**Verification after ship:**
1. Open Bar Olimpia (P003) in kanban → Start Discovery
2. New session loads with Filippo at the chat input
3. Filippo types "hi" or "ready when you are"
4. CD's first response should reference Bar Olimpia, Walk-in/Lugano context, and the absence of needs_analysis content rather than asking generic "tell me about the customer"
5. Confirm via DevTools network tab that POST to `/api/mcp/notify-agent` fired during session creation

---

### WP-CRM-F2 — Admin nav restructure: 5 tabs + Overview-only single bar (~1h)

**Revised 2026-05-24** (Ralph, three times — every revision was me misreading):

- **First revision** replaced an earlier "Day | Pipeline tabs inside the CRM view" proposal. Overview becomes a top-level admin tab.
- **Second revision** corrected toolbar scope: bars live INSIDE Overview, not as siblings shared with Kanban. Kanban is a naked board.
- **Third revision** (this one): the second-level bar (CRM heading with title + Reload/Bulk/New) is **removed entirely**. The third-level bar (Search/Today/?) stays and **absorbs** the Reload/Bulk/New buttons on its right side. Net result in Overview: **one single combined bar**, no separate heading bar above it.

**The five top-level admin tabs (bar 1):**

| Tab | Status today | Action in F2 |
|---|---|---|
| **Sessions** | Exists (`#view-sessions`, `#nav-sessions`) | None — keep as-is |
| **Kanban** | Exists as `CRM` (`#view-crm`, `#nav-crm`, label "CRM") | **Rename:** id `view-crm` → `view-kanban`, `nav-crm` → `nav-kanban`, label "CRM" → "Kanban"; update all `switchView('crm')` callers; legacy `?tab=crm` URL param mapped to `kanban`. **Strip the existing CRM heading-bar and filter-bar out of this view** (they move into Overview). Kanban becomes a pure 4-column board. |
| **Overview** | New | Insert tab button + `#view-overview` container that contains bar 2 + bar 3 + the 2-col list/context grid (F3 fills the list/context). |
| **Analytics** | Exists (`#view-analytics`, `#nav-analytics`) — placeholder | None — keep as-is |
| **Settings** | Exists (`#view-settings`, `#nav-settings`) — already populated (agent config, formerly the Agents tab) | None — verify route survives rename; content untouched |

**Final layout:**

```
┌── Bar 1 · Admin nav (always visible, full-width) ────────────────────────────┐
│   Sessions    Kanban    Overview    Analytics    Settings                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   when KANBAN active:                                                        │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  Incoming      Contacted    Demo done    Closing                     │  │
│   │  (4-col kanban, per-column quick-add at the top of each column.       │  │
│   │   No secondary toolbar. No search. No Today. No Reload/Bulk/New.)    │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   when OVERVIEW active:                                                      │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  Bar 2 · Overview · 6 tasks · 2 overdue · …    [Reload][Bulk][New] │  │
│   │  Bar 3 · [Search company, tags, notes…]            [Today ·6]  [?]  │  │
│   │  ┌──────────────────────────────┬─────────────────────────────────┐│  │
│   │  │ Task list (1fr)              │ Context panel (380px)           ││  │
│   │  └──────────────────────────────┴─────────────────────────────────┘│  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Visibility rules:**
- **Bar 1** (admin nav) — always visible
- **Bar 2 + Bar 3** — live INSIDE `#view-overview`. They inherit visibility from their parent. When Overview is hidden (any other tab active), bars 2+3 are hidden too. No separate JS toggle plumbing.
- **Sessions sidebar** — hidden when Kanban OR Overview is active (both CRM-data views reclaim the width); visible for Sessions/Analytics/Settings.

**Why Kanban-naked:**
- Kanban is a *visual* surface — drag cards, click to expand, scan columns. Toolbar steals vertical real estate from the board.
- Per-column **quick-add inputs** (the `+ Add lead (Company, Name, Phone, Email)…` input that already exists at the top of each column from WP-CRM-A1) cover the "I want to add a lead while looking at the kanban" use case. Reload / Bulk Import are rare operations — they live in Overview because Overview IS the management cockpit.
- Search is more useful in Overview where Filippo is *processing* a queue; Kanban is for *seeing* the state.

**DOM structure (final):**
```html
<!-- Bar 1 — admin nav (top-level pills, always visible) -->
<nav class="pill-group ml-4">
    <button id="nav-sessions"  onclick="switchView('sessions')"  class="pill-btn">Sessions</button>
    <button id="nav-kanban"    onclick="switchView('kanban')"    class="pill-btn">Kanban</button>
    <button id="nav-overview"  onclick="switchView('overview')"  class="pill-btn">Overview</button>
    <button id="nav-analytics" onclick="switchView('analytics')" class="pill-btn">Analytics</button>
    <button id="nav-settings"  onclick="switchView('settings')"  class="pill-btn">Settings</button>
</nav>

<!-- ... -->

<!-- View: KANBAN (naked board, no secondary toolbar) -->
<div id="view-kanban" class="hidden flex-1 min-h-0 flex flex-col gap-[var(--gap-app)] fade-in overflow-hidden">
    <div id="crm-board" class="flex-1 min-h-0 grid grid-cols-4 gap-[var(--gap-app)] overflow-hidden">
        <!-- Columns injected by crmRender(); each column has its own quick-add at the top -->
    </div>
</div>

<!-- View: OVERVIEW (bars 2+3 INSIDE, then the 2-col main grid) -->
<div id="view-overview" class="hidden flex-1 min-h-0 flex flex-col gap-[var(--gap-app)] fade-in overflow-hidden">
    <!-- Bar 2 — CRM context (Overview-exclusive) -->
    <div id="crm-bar-2" class="bento-card p-4 flex items-center justify-between shrink-0">
        <div>
            <h1>
                <i data-lucide="briefcase"></i>
                <span>Overview</span>
                <span id="crm-summary">— loading</span>
            </h1>
            <p>source · <span class="text-accent">docs/crm-feature/prospects.xlsx</span></p>
        </div>
        <div>
            <button onclick="crmReload()">Reload</button>
            <button onclick="crmBulkOpen()">Bulk Import</button>
            <button onclick="crmNewLead()">New Lead</button>
        </div>
    </div>
    <!-- Bar 3 — filters + shortcuts (Overview-exclusive) -->
    <div id="crm-bar-3" class="flex items-center gap-3 shrink-0 px-1">
        <input id="crm-search-input" placeholder="Search company, contact, notes, tags…  ( / )" oninput="crmSearchInput(event)">
        <button id="crm-today-pill" onclick="crmToggleToday()">Today <span id="crm-today-count"></span></button>
        <button onclick="crmShortcutsOpen()">?</button>
    </div>
    <!-- Main 2-col grid: task list (1fr) | context panel (380px) -->
    <div class="flex-1 min-h-0 grid grid-cols-[1fr_380px] gap-[var(--gap-app)] overflow-hidden">
        <div id="crm-overview-list" class="bento-card p-3 overflow-y-auto flex flex-col gap-2">…</div>
        <div id="crm-overview-context" class="bento-card p-4 overflow-y-auto">…</div>
    </div>
</div>
```

**State + toggle (simplified after refactor):**
```js
function switchView(view) {
    const valid = ['sessions', 'kanban', 'overview', 'analytics', 'settings'];
    if (!valid.includes(view)) return;

    // Toggle view visibility + nav active state
    valid.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        const nav = document.getElementById(`nav-${v}`);
        if (!el) return;
        el.classList.toggle('hidden', v !== view);
        el.classList.toggle('flex', v === view);
        nav?.classList.toggle('active', v === view);
    });

    // bars 2+3 live INSIDE #view-overview — they're hidden automatically when
    // Overview is hidden. NO JS visibility toggling needed.

    // Sessions sidebar hides for both CRM-data views (Kanban + Overview)
    const isCrmContext = view === 'kanban' || view === 'overview';
    document.getElementById('sessions-sidebar')?.classList.toggle('hidden', isCrmContext);

    // Per-view post-switch hooks
    if (view === 'settings') renderAgentsOverview();
    if (isCrmContext) {
        crmLoad();
        if (view === 'overview') crmRenderOverview?.();
    }
    try { localStorage.setItem('admin-view', view); } catch {}
}
```

Removed from the previous implementation:
- `crm-bar-2` / `crm-bar-3` `classList.toggle('hidden', !isCrmContext)` — bars live inside Overview, no toggle needed
- `crm-bar-title` swap — title is hardcoded "Overview" inside the bar
- grid/flex display swap — all views use `flex`; the 2-col list/context grid is INSIDE `#view-overview`

**Cache strategy:** every view's DOM stays mounted; only `display: none` toggles. An expanded card in Kanban survives a trip to Overview and back.

**Bar-2 summary text:** when Overview is active, `crmRenderOverview()` sets `#crm-summary` to the Overview-specific counts (`${tasks} tasks · ${overdue} overdue · ${todayDue} today · ${upcoming} upcoming`). When Overview is closed and re-opened, render fires again and the text reflects current data.

**Edge cases:**
- URL deep-link: `/?view=overview` selects Overview on load; legacy `?tab=crm` maps to `kanban`
- First-time user (no localStorage): default `sessions` (existing static default)
- Search input value persists across Overview close/reopen (same element, never destroyed)
- Today filter state persists across view switches (same `crmTodayOn` flag, used by `crmRender` for Kanban and `crmRenderOverview` for Overview)

**What's NOT in this WP:**
- Settings view content — already populated (agent config). F2 only verifies the route works after the rename.
- Analytics view content — existing placeholder, untouched
- Sessions view content — existing implementation, untouched
- Overview view content (list, context, sort, quick actions) — that's WP-CRM-F3

---

### WP-CRM-F3 — Overview view content (~2h, depends on F2)

**Note:** previously titled "Day View" in the pre-revision spec. Now lives as the **OVERVIEW** top-level admin tab per the F2 restructure. The content design is unchanged — only the framing (top-level tab, not a sub-tab inside CRM) and the names ("Overview" not "Day", "Kanban" not "Pipeline") were updated.

**Why:** Kanban is lead-shaped (one card = one company). Overview is task-shaped (one row = one thing to do today). Per reference 5.1 A1, proportioned for Filippo's 30–50 leads.

**Files touched:** `public/admin.html` (the `#view-overview` block created by F2 — render function + sort helper + quick-action handlers)

**Inherited from F2:**
- Bar 1 active state: `Overview` pill highlighted
- Bar 2 title: "Overview" + summary `${todayCount} tasks · ${overdueCount} overdue · ${todayDueCount} today · ${upcomingCount} upcoming`
- Bar 3: same Search + Today + ? as in Kanban (search filters tasks; Today toggle hides upcoming)
- New Lead button (in bar 2) still works — creates a placeholder lead in Incoming, then either Filippo stays in Overview (the new lead won't show because it's not due today) or he switches to Kanban to find it

**Layout (the `#view-overview` content):**
```
┌── view-overview · 2-col grid: list(1fr) | context(380px) ────────────────────┐
│ ┌─── left list ────────────────────┐ ┌── context panel ────────────────────┐ │
│ │ ▌ 2d overdue · Bar Olimpia       │ │ Bar Olimpia                         │ │
│ │   Cold-call, Tessin              │ │ Incoming · CHF 3'600 · 35%          │ │
│ │   CHF 3'600 · 35%  [📞][✓][+1d]  │ │                                     │ │
│ │ ───────────────────────────────  │ │ RECENT CONTEXT                      │ │
│ │ ▌ 1d overdue · Café Hofmann      │ │ • Today 14:32  Call  8 min          │ │
│ │ ───────────────────────────────  │ │   "Owner said send WhatsApp"        │ │
│ │ ▌ TODAY · Pizzeria Vesuvio ★     │ │ • Yesterday Note                    │ │
│ │ ───────────────────────────────  │ │   "Saw new espresso machine"        │ │
│ │ ▌ TODAY · Trattoria Da Luigi     │ │                                     │ │
│ │ ───────────────────────────────  │ │ NEEDS                               │ │
│ │ ▌ TODAY · Hotel Bellevue         │ │ – old website                       │ │
│ │ ───────────────────────────────  │ │ – NOKIA 3130 → iPhone               │ │
│ │ ▌ +1d · Caffè S. Ambrogio        │ │                                     │ │
│ └──────────────────────────────────┘ │ ┌─────────────────────────────────┐ │ │
│                                      │ │ Open full record  →             │ │ │
│                                      │ │ ⚡ Start Discovery               │ │ │
│                                      │ │ + Log activity ▾                 │ │ │
│                                      │ └─────────────────────────────────┘ │ │
│                                      └─────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

The "Open full record →" CTA switches to KANBAN view AND calls `crmOpenModal(id)` so the expanded card opens in its native context.

**Sort helper (the only useful piece kept from the rejected Health Score proposal):**
```js
function crmOverviewPriority(p) {
    const na = crmComputeNextAction(p);
    if (!na || na.kind === 'static') return [1, 0, 0];   // no date → bottom
    const starredKey = p.starred ? 0 : 1;                 // starred first
    const dayKey = na.days;                               // most-overdue (negative) first
    const weightKey = -((p.amount_chf || 0) * (p.confidence_pct || 0));
    return [starredKey, dayKey, weightKey];
}

function crmOverviewList() {
    const isTerminal = s => s === 'Won' || s === 'Lost' || s === 'Cancelled';
    return crmProspects
        .filter(p => crmIsToday(p) && !isTerminal(p.status))
        .sort((a, b) => {
            const A = crmOverviewPriority(a), B = crmOverviewPriority(b);
            for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return A[i] - B[i];
            return 0;
        });
}
```

**Row template** (color-coded left rail, urgency label, company, meta, econ, inline actions):
```html
<div class="crm-overview-row ${selected ? 'is-selected' : ''}"
     data-prospect-id="${p.id}"
     onclick="crmOverviewSelect('${p.id}')">
    <span class="crm-overview-rail" style="background:${railColor}"></span>
    <div class="crm-overview-main">
        <div class="flex items-center gap-2">
            <span class="crm-chip ${chipClass}">${escapeHtml(label)}</span>
            <span class="font-bold text-primary text-sm">${escapeHtml(p.company)}</span>
            ${p.starred ? '<i data-lucide="star" width="11" class="text-amber-400"></i>' : ''}
        </div>
        <div class="text-[11px] text-secondary mt-0.5">
            ${escapeHtml(p.contact_name)} · ${escapeHtml(p.tags)}
        </div>
        <div class="text-[10px] font-mono text-secondary mt-0.5">
            CHF ${crmFmtCHF(p.amount_chf)} · ${p.confidence_pct}%
        </div>
    </div>
    <div class="crm-overview-actions">
        <button onclick="event.stopPropagation();crmOverviewQuickCall('${p.id}')" title="Log Call">📞</button>
        <button onclick="event.stopPropagation();crmClearFollowup('${p.id}')" title="Done">✓</button>
        <button onclick="event.stopPropagation();crmSnoozeFollowup('${p.id}', 1)" title="Snooze +1d">+1d</button>
    </div>
</div>
```

**Context panel** (fires on `crmOverviewSelect(id)`):
```js
async function crmOverviewSelect(id) {
    crmOverviewSelectedId = id;
    document.querySelectorAll('.crm-overview-row').forEach(r =>
        r.classList.toggle('is-selected', r.dataset.prospectId === id));
    const p = crmProspects.find(x => x.id === id);
    const panel = document.getElementById('crm-overview-context');
    panel.innerHTML = '<div class="text-secondary italic">Loading…</div>';
    const res = await fetch(`/api/admin/crm/activities?prospect_id=${encodeURIComponent(id)}`);
    const data = await res.json();
    const recent = (data.activities || []).slice(0, 2);
    panel.innerHTML = `
        <div class="crm-overview-context-card">${escapeHtml(p.company)}</div>
        <div class="text-[10px] font-mono text-secondary uppercase mb-2">RECENT CONTEXT</div>
        ${recent.length ? recent.map(a => `
            <div class="text-[11px] mb-2">
                <div class="text-secondary">${a.timestamp.slice(0,16).replace('T',' ')} · ${escapeHtml(a.type)}</div>
                <div class="text-primary">${escapeHtml((a.notes||'').slice(0,120))}</div>
            </div>`).join('') : '<div class="text-secondary italic text-[11px]">No prior activity.</div>'}
        ${p.needs_analysis ? `
            <div class="text-[10px] font-mono text-secondary uppercase mt-3 mb-1">NEEDS</div>
            <pre class="text-[11px] text-primary whitespace-pre-wrap">${escapeHtml(p.needs_analysis.slice(0, 200))}</pre>
        ` : ''}
        <div class="crm-overview-cta-stack mt-4">
            <button onclick="switchView('kanban');crmOpenModal('${id}')">Open full record →</button>
            <button onclick="crmStartSessionFromDay('${id}')">⚡ Start Discovery</button>
            <button onclick="crmDayLogActivity('${id}')">+ Log activity ▾</button>
        </div>`;
    lucide.createIcons();
}
```

**Quick actions reuse existing functions** (no new backend):
- `📞 Call` → `crmLogActivity('Call', 'phone', '#a78bfa')` (needs `crmCurrentId` set to selected id first)
- `✓ Done` → `crmClearFollowup(id)` (S3 work)
- `+1d` → `crmSnoozeFollowup(id, 1)` (S3 work)

**Empty state:**
```html
<div class="text-center py-16 text-secondary">
    🌴 Nothing on the queue today.<br>
    <a onclick="switchView('kanban')" class="text-emerald-400 cursor-pointer">Pick something from Kanban →</a>
</div>
```

**Edge cases:**
- Selected lead becomes terminal during session → row fades out, context panel clears
- User snoozes top row → row animates out (250ms fade-collapse), next row auto-selected
- Keyboard nav (`j/k` move, `Enter` open, `s` snooze, `c` call) — defer to v2 if time-constrained

**Explicit non-features:**
- ❌ No flame / pulsing-dot icons (would require Health Score detection — see §7)
- ❌ No hover-to-context (Filippo's on laptop+trackpad; hover is fragile)
- ❌ No AI talk-track / NBA summary (LLM call per-row — premature)

---

### WP-CRM-F4 — Persistent note composer (~30m, standalone, closes S7)

**Why:** logging a quick note today = 3 clicks (Log Activity → pick type → write → save), AND there's no Note option in the picker. Composer = one keystroke flow. Makes Note the canonical path.

**Files touched:** `public/admin.html` (History block template + one new function)

**Implementation:**

Modify `renderCrmHistory` to render composer ABOVE the scheduled row + activity timeline:
```html
<div class="crm-composer-row mb-2"
     style="background:var(--bg-app);border:1px solid var(--border-card);border-radius:8px;padding:6px 10px;">
    <input type="text" id="crm-note-composer"
           class="w-full bg-transparent border-none outline-none text-[12px] text-primary placeholder-secondary"
           placeholder="Type — or hit Fn-Fn (Mac) / Win+H (Win) to dictate. Press ⏎ to save."
           onkeydown="crmComposerKey(event)">
</div>
<!-- scheduled row -->
<!-- activity timeline -->
```

```js
function crmComposerKey(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const input = e.currentTarget;
    const value = input.value.trim();
    if (!value || !crmCurrentId) return;
    input.disabled = true;
    fetch('/api/admin/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prospect_id: crmCurrentId,
            type: 'Note',
            icon: 'file-text',
            color: '#a1a1aa',
            notes: value,
        }),
    }).then(async () => {
        input.value = '';
        input.disabled = false;
        const p = crmProspects.find(x => x.id === crmCurrentId);
        if (p) await renderCrmHistory(p);
        input.focus();
    }).catch(err => {
        input.disabled = false;
        alert('Note save failed: ' + err.message);
    });
}
```

**Edge cases:**
- Empty submit = no-op
- Shift+Enter = ignored (no multi-line; use Log Activity picker for that)
- Network fail → input refills with typed value + alert

**Note picker entry NOT added** — composer IS the canonical path. Picker stays for Call/Meeting/Email (extra fields).

---

### WP-CRM-F5 — Terminal-deal handling (~1h, closes S4, S10, S12)

**Why:** Lost/Won/Cancelled cards today look identical to live cards. A Lost deal from 6 months ago in Closing has the same visual weight as a live deal closing this week. Compounds over time. Also column totals include terminals → inflated subtotals. Also Today pill counter includes terminals → false urgency.

**Files touched:** `public/admin.html` (compact card template, column total computation, Today filter, `crmIsToday`)

**Implementation:**

**1. Visual differentiation on compact cards:**
```js
const isTerminal = p.status === 'Won' || p.status === 'Lost' || p.status === 'Cancelled';
// Card class:
class="crm-card ${isTerminal ? 'is-terminal' : ''} crm-card-${cursorClass}"
```
CSS:
```css
.crm-card.is-terminal {
    opacity: 0.55;
    filter: grayscale(40%);
}
.crm-card.is-terminal::before {
    content: attr(data-terminal-label);
    position: absolute; top: 6px; right: 6px;
    font-size: 9px; font-weight: 700; letter-spacing: 0.05em;
    padding: 1px 6px; border-radius: 999px;
}
.crm-card.is-terminal[data-status="Won"]::before { background: #15B981; color: #fff; content: "✓ WON"; }
.crm-card.is-terminal[data-status="Lost"]::before { background: #ef4444; color: #fff; content: "✕ LOST"; }
.crm-card.is-terminal[data-status="Cancelled"]::before { background: #71717a; color: #fff; content: "⊘ CANCELLED"; }
```

**2. Column totals exclude terminals:**
```js
const stageTotal = inStage
    .filter(p => !isTerminal(p.status))
    .reduce((s, p) => s + (p.amount_chf || 0), 0);
```

**3. Today pill counter excludes terminals:**
```js
const todayCount = crmProspects
    .filter(p => crmIsToday(p) && !isTerminal(p.status))
    .length;
```

**4. `crmIsToday` excludes terminals:**
```js
function crmIsToday(p) {
    if (isTerminal(p.status)) return false;
    // existing date logic
}
```

**5. Optional column-header "show terminals" toggle** (eye icon next to count): defer unless Filippo asks. By default terminals stay hidden from totals but visible (at 55% opacity) in the column body.

**Edge cases:**
- Won deal in Closing: shows at 55% opacity with `✓ WON` corner pill. Still draggable but probably shouldn't be re-staged.
- Reverting Lost → To do: opacity returns to 100%, corner pill removed (re-render handles it).

---

### WP-CRM-F6 — Activity edit + Email subject (~1h, closes S6, S8)

**Why:**
- (S6) Activity timeline is append-only. Typo in a Call note? Stuck forever. Backend `PUT /api/admin/crm/activities/[id]` exists — no UI calls it.
- (S8) E-mail Out/In activities capture body but no subject. History preview shows first line of body — which might be a greeting, not the topic. Subject is the spine of email triage.

**Files touched:**
- `public/admin.html` — activity row template (add edit pencil + email subject input/display)
- `lib/crm-store.ts` — add `subject` field to Activity (or store in `notes` with a structured prefix — see decision below)

**Decision — subject storage:**

Option A: add a new `subject` column to Activities sheet. Cleanest schema; requires writeActivitiesSheet update.

Option B: prefix the notes with `Subject: ...\n\n<body>`. Zero schema change; render parses it. Loses "subject as first-class field" for queries.

**Recommendation: Option A.** The Excel write-replace pattern handles schema growth fine; precedent is `standby_plan` and `needs_analysis`. New column `subject` added to ACTIVITY_HEADERS and ACTIVITY_COL_WIDTHS.

**Implementation:**

**1. Activity compose for email types — add subject input above body:**
```html
${isEmail ? `
    <input type="text" class="crm-compose-subject crm-field-input"
           placeholder="Subject…"
           style="width:100%;border:1px solid var(--border-card);padding:4px 8px;border-radius:4px;font-size:12px;margin-bottom:6px;">
` : ''}
<textarea class="crm-compose-notes …" rows="${isEmail ? 5 : 4}" placeholder="…"></textarea>
```

In `crmLogActivityConfirm`, read subject and POST as `subject: subjectEl.value`.

**2. Activity row display:**
- Email type: render `📧 OUT · Subject of the email` as the title; body in collapsible block (as today)
- Non-email: unchanged

**3. Inline edit on hover:**
```html
<div class="crm-timeline-item" data-activity-id="${a.id}">
    <div class="text-[10px] font-mono text-secondary">${stamp}${dur}</div>
    <div class="text-primary font-semibold mt-0.5">
        ${escapeHtml(a.type)}${subjectSpan}
        <button class="crm-activity-edit-btn opacity-0 hover:opacity-100 transition-opacity"
                onclick="crmEditActivity('${a.id}')"><i data-lucide="pencil" width="11"></i></button>
    </div>
    ${notesBlock}
</div>
```

`crmEditActivity(id)`:
- Replace the row's notes div with an inline textarea pre-filled with current notes
- Save on blur via `PUT /api/admin/crm/activities/[id]`
- For Call types, also reveal a duration input

**Edge cases:**
- Activity belongs to a different prospect (shouldn't happen given filter) → skip edit
- PUT fails → show inline error, keep textarea editable
- `stage_changed` and `status_changed` activities are auto-written; should they be editable? **No** — only user-logged types (Call/Note/Email/Meeting/etc) are editable. Add a `canEdit` check.

---

### WP-CRM-F7 — Navigation prev/next respects filter (~15m, closes S5)

**Files touched:** `public/admin.html` (`crmNavigate`)

**Current:**
```js
function crmNavigate(dir) {
    if (!crmCurrentId) return;
    const idx = crmProspects.findIndex(p => p.id === crmCurrentId);
    if (idx < 0) return;
    const next = (idx + dir + crmProspects.length) % crmProspects.length;
    crmOpenModal(crmProspects[next].id);
}
```

**Fixed:**
```js
function crmNavigate(dir) {
    if (!crmCurrentId) return;
    const filtered = crmGetFiltered();
    const idx = filtered.findIndex(p => p.id === crmCurrentId);
    if (idx < 0) return;   // current card isn't in filter — fall back to no-op
    const next = (idx + dir + filtered.length) % filtered.length;
    crmOpenModal(filtered[next].id);
}
```

**Edge case:** if user opened a card then applied a filter that excludes it, `findIndex` returns -1 → no-op. Could fall back to `filtered[0]` if non-empty; defer unless requested.

---

### WP-CRM-F8 — Dual-phase indicator: CRM-phase (prominent) + Oskar-phase (secondary) (~1.5h, closes S11)

**Revised 2026-05-24** (Ralph): the original "just rename Phase → Production" spec was wrong. Filippo needs to see **both** phases at once because they answer different questions:

- **CRM-phase** = where this lead is in the **sales funnel** (Incoming → Contacted → Demo done → Closing, plus sub-stages within Closing like "contract sent → invoiced → paid"). Answers "what's the next sales move?"
- **Oskar-phase** = where the linked discovery session is in **production** (Discovery → Image Eval → Gen Vibes → User Select → Handoff → Archetype → Brief WD). Answers "is our production crew on track with this deal?"

**CRM-phase is more important** because it drives Filippo's next move (call the customer, send proposal, follow up on contract). Oskar-phase is contextual — useful when a deal is mid-production but doesn't change Filippo's daily action.

**Two-pill compact-card layout:**

```
┌─────────────────────────────────────────┐
│  ◯ Hotel Bellevue Lugano    📞 ✉ ☆     │
│                                          │
│  CHF 32'600  ·  75%  ·  2d upcoming     │
│                                          │
│  ▰▰▰▰░░░ Closing 3/4 · contract sent    │   ← CRM-phase (large, prominent)
│  · Prod 3/7                              │   ← Oskar-phase (small, muted)
└─────────────────────────────────────────┘
```

The CRM-phase pill is the primary visual signal. The Oskar-phase pill is rendered smaller and lower-contrast — present for context, never demanding attention.

---

#### Data model addition

Add **one** new optional column to the Prospect schema:

| Column | Type | Purpose |
|---|---|---|
| `sub_stage` | string | Free-text sub-position within the current sales stage (e.g., "contract sent", "invoiced", "discovery scheduled"). Empty when no sub-stage applies. |

Why free-text instead of enum:
- Filippo's sub-stages vary by deal type. A bar deal might be: signed → invoiced → installed. A consulting deal: discovery → proposal → countersigned. An enum forces premature standardization.
- The CRM-phase visual computation only needs `stage` + `sub_stage` together as display strings — no business logic depends on specific values.
- If Ralph wants a controlled vocabulary later (Pipedrive does this per-pipeline), it's a future WP.

#### CRM-phase visual computation

```js
// 4-segment progress bar mirrors the 4 sales stages (Incoming → Closing).
// Segment is "filled" when the lead has reached or passed that stage.
const STAGE_ORDER = ['Incoming', 'Contacted', 'Demo done', 'Closing'];
function crmStageProgress(p) {
    const idx = STAGE_ORDER.indexOf(p.stage);
    if (idx < 0) return { filled: 0, label: p.stage || '—' };
    const filled = idx + 1;  // 1..4
    const stageLabel = `${p.stage} ${filled}/4`;
    const sub = (p.sub_stage || '').trim();
    return { filled, label: sub ? `${stageLabel} · ${sub}` : stageLabel };
}
```

Rendered as 4 little blocks + label:
```html
<div class="crm-phase-crm" title="Sales stage position">
    <span class="crm-phase-seg ${filled >= 1 ? 'is-on' : ''}"></span>
    <span class="crm-phase-seg ${filled >= 2 ? 'is-on' : ''}"></span>
    <span class="crm-phase-seg ${filled >= 3 ? 'is-on' : ''}"></span>
    <span class="crm-phase-seg ${filled >= 4 ? 'is-on' : ''}"></span>
    <span class="crm-phase-label">${escapeHtml(label)}</span>
</div>
```

CSS:
```css
.crm-phase-crm {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-family: 'JetBrains Mono', monospace;
    color: var(--text-main); font-weight: 700;
    padding: 2px 0; margin-top: 4px;
}
.crm-phase-seg {
    width: 14px; height: 4px; border-radius: 2px;
    background: var(--border-card);
}
.crm-phase-seg.is-on {
    background: var(--stage, var(--accent));
}
.crm-phase-label { margin-left: 4px; }
```

The `--stage` CSS var is already set per-column by the `.crm-stage-color-*` classes (defined in §3.7-ish of admin.html CSS). So the filled segments inherit the column's accent color (blue/violet/amber/emerald).

#### Oskar-phase pill demotion

Existing `.crm-phase-pill` styling stays but the label changes from `Phase N/7` to `Prod N/7` (shorter so it doesn't dominate). The pill itself gets a `.crm-phase-secondary` modifier class that drops opacity to ~0.7 and removes the colored background — making it a muted text-only chip below the CRM-phase progress.

```js
const phaseLabel = `Prod ${latest.phase}/7`;
// rendered with class="crm-phase-pill crm-phase-secondary"
```

```css
.crm-phase-pill.crm-phase-secondary {
    background: transparent !important;
    border: none !important;
    color: var(--text-dim);
    opacity: 0.75;
    padding: 0;
    font-size: 9px;
    letter-spacing: 0.04em;
}
.crm-phase-pill.crm-phase-secondary::before { content: '· '; }
```

#### Sub-stage editor in expanded card

Add a small inline input below the status pills row in the expanded card:

```html
<div class="px-3 pt-1 flex items-center gap-2 text-[10px] text-secondary">
    <span class="font-mono uppercase tracking-wider">Sub-stage:</span>
    <input class="crm-inline-input" id="crm-modal-sub-stage"
           style="width: 180px; font-weight: 600;"
           value="${escapeHtml(p.sub_stage || '')}"
           placeholder="e.g. contract sent, invoiced, …"
           onclick="event.stopPropagation()"
           onkeydown="event.stopPropagation(); if(event.key==='Enter'){this.blur();}"
           oninput="crmPersistFieldDebounced('sub_stage', this.value)">
</div>
```

Free-text. Saves via the existing debounced inline-persist pipeline. Filippo types whatever he wants; the compact card's CRM-phase label includes it.

#### Files touched

- `lib/crm-store.ts` — add `sub_stage: string` to `Prospect` interface + HEADERS + COL_WIDTHS + readSheet mapper + writeSheet row builder (mirrors the pattern used for `needs_analysis` and `solutions_bought`)
- `app/api/admin/crm/prospects/route.ts` + `bulk/route.ts` — defaults `sub_stage: ''` (same pattern as other added fields)
- `docs/crm-feature/generate-seed.mjs` — add column to HEADERS + COL_WIDTHS
- `public/admin.html`:
  - Compact card template — add CRM-phase progress + demote Oskar-phase pill
  - Expanded card — add sub-stage input below status pills
  - CSS — new `.crm-phase-crm` + `.crm-phase-seg` + `.crm-phase-secondary` rules

#### Edge cases

- Empty `sub_stage` → progress bar shows just `Stage N/4` (no `· suffix`)
- Lead has no linked session → no Oskar-phase pill rendered (unchanged behavior)
- Stage changes via drag-drop → CRM-phase pill updates automatically (computed from `p.stage`); `sub_stage` is NOT auto-cleared (Filippo's text might still apply, e.g. "contract sent" carries from Demo done → Closing)
- Sub-stage too long → CSS `text-overflow: ellipsis` on `.crm-phase-label` (or just `overflow: hidden`); tooltip shows full text

#### Why dual-pill, not a single combined indicator

Could collapse into one pill: `Closing · Prod 3` — but it conflates two axes (sales position vs production position) into one string, hiding the relationship. The dual layout makes the hierarchy clear (CRM-phase big, Oskar small) and Filippo can scan for "any sales stage stalled at sub-stage X" or "any production lagging vs sales stage" at a glance.

#### Time estimate

Was 15m (simple rename). Now ~1.5h:
- ~20m: schema + reader/writer changes (4 files)
- ~30m: compact card rendering + CSS for progress bar + secondary pill
- ~15m: sub-stage input in expanded card
- ~25m: testing on real seed data (1 prospect per stage) + edge cases

---

### WP-CRM-F9 — Email show-full cleanup (~15m, closes S14)

**Why:** Current implementation:
```html
<button onclick="crmEmailToggle(this, ${JSON.stringify(a.notes).replace(/"/g, '&quot;')})">
    Show full
</button>
```
Embeds the full email body as a JSON-encoded HTML attribute. Ugly. Works. But a 5KB email body becomes 5KB of HTML attribute per row.

**Fixed:** store the full body in a hidden `data-` attribute on the body div, toggle via class:

```html
<div class="crm-email-body" data-full="${escapeHtml(a.notes)}" data-state="collapsed">
    ${preview}
</div>
${isLong ? `<button onclick="crmEmailToggle('${a.id}')">Show full</button>` : ''}
```

```js
function crmEmailToggle(activityId) {
    const block = document.querySelector(`[data-activity-id="${activityId}"] .crm-email-body`);
    if (!block) return;
    const full = block.dataset.full;
    if (block.dataset.state === 'collapsed') {
        block.textContent = full;
        block.dataset.state = 'expanded';
        block.style.maxHeight = '500px';
    } else {
        block.textContent = full.length > 200 ? full.slice(0, 200) + '…' : full;
        block.dataset.state = 'collapsed';
        block.style.maxHeight = '80px';
    }
}
```

Cleaner. Removes the JSON-in-onclick antipattern.

---

### WP-CRM-F10 — Activity-type filter chips on the History timeline (~15m)

**Why:** the History timeline mixes everything — Calls, Emails, Notes, auto-events (`stage_changed`, `status_changed`, Started Discovery), Proposals, Meetings, etc. When Filippo asks himself "what calls did I have with this lead?", he has to eyeball-filter while scrolling. A chip row above the timeline that filters by type collapses that to one click. Trivial code — the `type` field already exists on every Activity.

**Files touched:** `public/admin.html` (`renderCrmHistory()` + small CSS for chip row + per-session JS state)

**Behavior:**

```
┌─ History ───────────────────────── + Log Activity ▾ ─┐
│ [ All · 12 ] [ 📞 Calls · 4 ] [ 📧 Emails · 3 ]      │   ← F10 chip row
│ [ 📝 Notes · 2 ] [ 📅 Meetings · 1 ] [ ⚙ Auto · 2 ] │
├────────────────────────────────────────────────────────┤
│ • Today 14:32  Call  8 min  · "Owner said send Wh…"   │
│ • Yesterday    Note          · "Saw new espresso ma…" │
│ ...                                                     │
└────────────────────────────────────────────────────────┘
```

**Chip groups** (map ActivityType → group):
- `All` → no filter
- `📞 Calls` → `Call`, `Qualification Call`, `Zoom Call`
- `📧 Emails` → `E-mail Out`, `E-mail In`
- `📝 Notes` → `Note`
- `📅 Meetings` → `Meeting`, `Onsite Visit`
- `📄 Proposals` → `Proposal`
- `⚙ Auto` → `stage_changed`, `status_changed`, `Started Discovery Session`, `delivery_started`, `session_archived`

**State:** per-prospect filter is ephemeral (resets when card collapses/reopens):
```js
let crmHistoryFilter = 'all';  // group key
```

**Implementation:**
- `renderCrmHistory(p)` pre-computes count-per-group from the fetched activities
- Renders the chip row above the timeline, with counts shown on chips that have ≥1 match
- Each chip's onclick sets `crmHistoryFilter = '<group>'` + calls `crmRenderHistoryFiltered(p, activities)` which re-renders the timeline body only (the activities are already in memory — no re-fetch)
- Active chip gets `is-active` styling (existing pattern)
- Scheduled-row (S3) sits ABOVE the chip row — it's a single pinned action, not part of the activity history

**Edge cases:**
- Filter with 0 matches → render an empty-state "No activities in this category" message; don't auto-revert to `all`
- New activity logged while filter is active → activity appears if it matches; otherwise it's silently in the underlying data, visible when filter switches back to `all`
- Composer (F4) submission always renders into the underlying activity list; if current filter is not `📝 Notes` or `All`, the new note will be invisible until filter changes. Acceptable — minor edge case.

**Time estimate:** 15m. Pure rendering work; data already has `type`.

---

### WP-CRM-F11 — Per-prospect realized-profit-if-won + fix currency unit-mismatch (~25m)

**Why:** the CrmLeadPanel header (the React `<CrmLeadPanel/>` rendered inside BRIEF/STUDIO's CRM subtab) already shows `production cost: $X.XX` per prospect. Filippo's missing the answer to "is this deal still worth chasing?" — a single number that says "if you close this at the deal amount, you net CHF Y after our production burn." Add an **ROI** line: `ROI: CHF (amount × winProbability − cost·rate)` — or for Won deals, `Realized: CHF (amount − cost·rate)`.

**Bonus — fix a real unit bug:** the existing kanban summary computes `net = weighted − prodCost`. `weighted` is CHF, `prodCost` is USD. Subtracting them is a silent ~10% error (current ratio CHF→USD ~1.10). The comment at admin.html ~line 3437 acknowledges "pipeline is CHF (whole francs), cost is USD (cents)" but rounds without converting. F11 fixes this in both surfaces (admin kanban summary + CrmLeadPanel).

**Files touched:**
- `lib/crm-store.ts` or a new tiny `lib/fx.ts` — single source of truth for the USD→CHF rate
- `public/admin.html` (`crmRender()` summary line) — convert `prodCost` before subtracting
- `components/admin/CrmLeadPanel.tsx` (~line 425 area) — add ROI / Realized line

**Implementation:**

1. **Rate constant** in a new `lib/fx.ts`:
```ts
// USD → CHF conversion rate. Manual constant; refresh when off by >2%.
// Source: 2026-05-24 FX. Update note + value when revisiting.
export const USD_TO_CHF = 0.90;

export function usdToChf(usdAmount: number): number {
  return usdAmount * USD_TO_CHF;
}
```
Single source of truth. If we ever auto-fetch FX, this file is the only one that changes.

2. **Fix kanban summary** in `admin.html`:
```js
// Was: const net = weighted - prodCost;  // ← mixed units
const prodCostChf = prodCost * 0.90;        // USD → CHF (matches lib/fx.ts)
const net = weighted - prodCostChf;
```
Update the rendered string:
```js
`cost <span class="text-rose-400 font-bold">$${prodCost.toFixed(2)}</span> ` +
`<span class="text-secondary text-[10px]">(≈ CHF ${crmFmtCHF(Math.round(prodCostChf))})</span> · ` +
`net <span class="font-bold" style="color:${net >= 0 ? '#15B981' : '#fb7185'}">CHF ${crmFmtCHF(Math.round(net))}</span>`;
```
Now the user sees the USD cost AND its CHF equivalent, AND the net is computed in CHF correctly.

3. **CrmLeadPanel ROI line** — add a third pill next to weighted + production cost:
```tsx
// In the existing header row at ~line 425, after the production cost span:
{sessions.length > 0 && (() => {
  const totalCostUsd = sessions.reduce((s, x) => s + (x.tokenBurn ?? 0), 0)
  const costChf = totalCostUsd * 0.90  // USD → CHF
  const isWon = prospect.status === 'Won'
  const headline = isWon
    ? Math.round(prospect.amount_chf - costChf)               // realized
    : Math.round(prospect.amount_chf * (prospect.confidence_pct / 100) - costChf)  // expected
  const label = isWon ? 'realized' : 'expected ROI'
  const color = headline >= 0 ? '#15B981' : '#fb7185'
  return (
    <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color }}>
      {label}: CHF {headline.toLocaleString('de-CH')}
    </span>
  )
})()}
```

**Edge cases:**
- Cost = 0 (no sessions linked) → ROI = expected/realized amount itself; still useful
- Negative ROI (cost > amount × confidence) → render in rose; surfaces "this deal is losing us money" instantly
- Status changes Won → Lost → Won → recompute every render (already happens via React)
- USD rate stale → it's a constant; documented refresh policy in `lib/fx.ts`

**Why not a live FX feed:** the rate moves <2%/year on long horizons; a manual constant updated quarterly is fine. Live FX = API key + caching + failure handling. Not worth it for this scale.

**Time estimate:** 25m.
- ~5m: `lib/fx.ts`
- ~5m: admin.html summary fix
- ~10m: CrmLeadPanel ROI rendering + status-conditional copy
- ~5m: verify against P015 (Closing/95%) and P019 (Closing/90%) seed data

---

### WP-CRM-F12 — Composer placeholder hint for dictation (~5m, extends F4)

**Why:** the F4 composer is a plain `<input>`. macOS and Windows both have system-wide dictation shortcuts (Fn-Fn on Mac, Win+H on Windows) that work on any focused input. Filippo speaks Italian/German faster than he types — dictation in the note composer is a real workflow upgrade if he knows it exists. The placeholder is the cheapest way to surface that hint.

**Files touched:** `public/admin.html` (F4 composer placeholder)

**Change:** the F4 spec currently has:
```html
placeholder="Type a quick note and press ⏎…"
```
Update to:
```html
placeholder="Type — or hit Fn-Fn (Mac) / Win+H (Win) to dictate. Press ⏎ to save."
```

**Notes:**
- This is **not a standalone WP** — it's a 1-line edit applied during F4 implementation. Filed separately at Ralph's request so the audit trail captures the rationale, but ship-time it folds into F4.
- The hint is deliberately platform-aware: Filippo's Mac shortcut isn't the same as the future-Win-user's. Naming both keeps the hint universal without adding any logic.
- No `aria-` or i18n work — placeholder is plain text, English, fine for v1.
- F4's spec will be amended in-place to use this placeholder when F4 ships.

**Time estimate:** 5m (already 0m if F4 hasn't shipped yet — just apply during F4).

---

### WP-CRM-F13 — Market-native follow-ups: WhatsApp icon (~20m)

**The gap:** in Filippo's market (Switzerland, especially Tessin), **WhatsApp is the dominant business-messaging channel** for SMBs — bars, dental clinics, garages, hotels routinely prefer a WhatsApp ping over a formal email. Today the compact + expanded cards have **tap-to-call** (phone) and **tap-to-email** (mail) icons but no WhatsApp surface. Filippo's actual workflow (the "laptop + phone" pattern documented in §1) leans on WhatsApp constantly — yet to reach a prospect via WhatsApp he currently has to copy the phone number, paste it elsewhere, and open the app manually.

**Feature:** add a **WhatsApp icon** next to phone + email on both compact and expanded cards. Single click opens `https://wa.me/<international-phone>?text=<draft>` in a new tab — WhatsApp Web (or the mobile app if the user has it linked) opens directly to a chat with that contact **with a pre-filled personalized draft message** that Filippo reviews + sends.

**Honest scope (set expectations explicitly):**
- ✅ Opens the correct chat by phone number — 1:1 deterministic (no "which Mario?" picker even with 5,000 WhatsApp contacts)
- ✅ Pre-fills draft message with contact name + company so Filippo skims + sends in ~5 sec (vs ~35 sec for copy-paste workflow)
- ✅ Works on **personal/consumer WhatsApp** — no WhatsApp Business app or Cloud API needed
- ❌ Cannot send without Filippo pressing Send (browser can't see WhatsApp Web's state)
- ❌ Cannot read inbound messages or confirm delivery (no consumer-side read API)
- ❌ Cannot auto-create activity rows for sent WhatsApp messages — manual logging via the picker's new "WhatsApp Out" type (mirrors "E-mail Out" today)

At Filippo's volume (5–20 personalized outreach messages/day) the personal-account spam threshold is irrelevant — the only ban vector is sending **identical** text to many strangers, and the pre-fill template substitutes `{name}` + `{company}` so every outbound message is unique.

**Where the icons go:**

```
Compact card header row:
   ◯ Hotel Bellevue Lugano    📞  💬  ✉️  ☆

Expanded card header (Personal Info → Phone row):
   Phone     📞  💬                      ← icons right of the "Phone" label
   +41 91 234 56 78
```

Ordering: **Phone · WhatsApp · Email** — escalating formality. WhatsApp sits between phone and email because for Filippo's market it slots between "voice call" and "long-form letter" in the channel hierarchy.

**Files touched:** `public/admin.html` (compact card + expanded card templates)

#### URL format

WhatsApp's [click-to-chat](https://faq.whatsapp.com/general/chats/how-to-use-click-to-chat) endpoint:
```
https://wa.me/<international-phone-digits-only>?text=<url-encoded-draft>
```

**Phone normalization (Swiss-aware):**
- Strip everything except digits (no `+`, no spaces, no dashes, no parens)
- If the number starts with `0` and the rest looks like a Swiss number (9 digits, beginning with `7`/`6`/etc), prepend `41` and drop the leading `0` (`0791234567` → `41791234567`). This handles Swiss-domestic format which is what Filippo's prospects most often enter.
- If the number starts with `00` (international prefix), drop the `00` and use the rest
- If the number is already in international form (no leading `0`, 10+ digits), use as-is
- If we still can't produce a plausible international number, **skip rendering the icon** (no muted/disabled state — keeps the row clean)

**Draft pre-fill:**
- Greeting uses the contact's first name when available, plain "Hi" otherwise
- One short context line referencing the company name
- Filippo edits before sending — this is a starting point, not a final message
- Per-message uniqueness (name + company substitution) keeps every outbound message distinct, which is what keeps the personal account away from WhatsApp's spam heuristics

```js
function crmWhatsAppNumber(phone) {
    let digits = String(phone || '').replace(/\D+/g, '');
    if (!digits) return null;
    // 00<cc> form → strip the 00
    if (digits.startsWith('00')) digits = digits.slice(2);
    // Swiss-domestic: 0XX XXX XX XX → 41XX XXX XX XX
    else if (digits.startsWith('0') && digits.length === 10) digits = '41' + digits.slice(1);
    if (digits.length < 8) return null;  // implausible international number
    return digits;
}

function crmWhatsAppDraft(p) {
    const first = (p.contact_name || '').trim().split(/\s+/)[0];
    const opener = first ? `Hi ${first}, ` : 'Hi, ';
    return `${opener}quick follow-up on ${p.company || 'your business'}.`;
}

function crmWhatsAppHref(p) {
    const num = crmWhatsAppNumber(p.phone);
    if (!num) return null;
    return `https://wa.me/${num}?text=${encodeURIComponent(crmWhatsAppDraft(p))}`;
}
```

#### Compact card update

In `crmCardHtml(p)`, add the WhatsApp icon between phone and email:
```js
const whatsAppHref = crmWhatsAppHref(p);
const whatsAppIcon = whatsAppHref
    ? `<a href="${whatsAppHref}" target="_blank" rel="noopener" class="crm-whatsapp-icon" onclick="event.stopPropagation()" title="WhatsApp ${escapeHtml(p.phone)}"><i data-lucide="message-circle" width="13"></i></a>`
    : '';
```
Rendered in the header `<div class="flex items-center gap-2">` block between `phoneIcon` and `emailIcon`.

#### Expanded card update

In `crmExpandedCardHtml(p)` → Personal Info row → Phone field, append the WhatsApp link next to the existing tap-to-call link:
```html
<span class="crm-field-label flex items-center justify-between">
    <span>Phone</span>
    <span class="flex items-center gap-1">
        <a id="crm-modal-phone-link" href="${phoneHref}" class="text-emerald-400 hover:text-emerald-300 ${p.phone ? '' : 'hidden'}" title="Call" onclick="event.stopPropagation()"><i data-lucide="phone" width="12"></i></a>
        ${crmWhatsAppHref(p) ? `
            <a href="${crmWhatsAppHref(p)}" target="_blank" rel="noopener" class="crm-whatsapp-icon" title="WhatsApp" onclick="event.stopPropagation()"><i data-lucide="message-circle" width="12"></i></a>
        ` : ''}
    </span>
</span>
```

#### Activity-type additions

Even though F13 doesn't auto-log sent messages (no WhatsApp Web API), Filippo can still **manually** log a WhatsApp outreach via the activity picker — mirrors how E-mail Out works today. Add two new types to the picker:

| ActivityType | Icon (Lucide) | Color | When |
|---|---|---|---|
| `WhatsApp Out` | `message-circle` | `#25D366` (WhatsApp green) | Filippo sent a WhatsApp message |
| `WhatsApp In` | `message-circle` | `#25D366` | Customer replied via WhatsApp (Filippo pastes the gist into Notes) |

```js
// admin.html activity picker — insert between E-mail In and Proposal
<button class="crm-activity-btn" onclick="event.stopPropagation();crmLogActivity('WhatsApp Out', 'message-circle', '#25D366')">
    <i data-lucide="message-circle" width="14" class="ico" style="color:#25D366"></i> WhatsApp Out
</button>
<button class="crm-activity-btn" onclick="event.stopPropagation();crmLogActivity('WhatsApp In', 'message-circle', '#25D366')">
    <i data-lucide="message-circle" width="14" class="ico" style="color:#25D366"></i> WhatsApp In
</button>
```

`ActivityType` union in `lib/crm-store.ts` gains two members. Same change in `components/admin/CrmLeadPanel.tsx` `ACTIVITY_TYPES` constant (the BRIEF/STUDIO CRM-subtab picker).

#### CSS (one rule for the compact icon)

```css
.crm-whatsapp-icon {
    color: #25D366;  /* WhatsApp brand green — recognizable */
    opacity: 0.75;
    transition: opacity 0.12s ease;
}
.crm-whatsapp-icon:hover { opacity: 1; }
```

Brand color is intentional — `#25D366` is universally recognized as WhatsApp, no caption needed.

#### Edge cases

- **No phone number at all** → no icon rendered (same as existing tap-to-call behavior)
- **Phone without country code** (e.g. `076 234 56 78`) → the normalizer auto-prepends `41` for Swiss-domestic format, so the icon DOES render. If the number still looks implausible after normalization (< 8 digits), skip rendering.
- **Non-Swiss number stored without country code** (`+44 ...` typed as `0044 ...`) → handled by the `00` prefix branch.
- **`target="_blank"`** opens in a new tab; `rel="noopener"` prevents the spawned window from getting `window.opener` reference (security best practice for arbitrary external nav)
- **No `event.preventDefault()`** — the browser's native `<a target="_blank">` does the right thing; we just stopPropagation so the card's click-zone handlers don't also fire
- **Tooltip uses full phone number** as a sanity check ("am I about to message the right number?")
- **Mobile** (future): the same URL works — clicking `https://wa.me/...` on iOS/Android opens the WhatsApp app directly via universal links. Zero extra work.
- **Phone-number-not-on-WhatsApp** → WhatsApp shows its own "The phone number shared via URL is not on WhatsApp" page; we can't pre-detect this from our side. Filippo closes the tab and falls back to a call/email.

#### Time estimate

~20m total:
- ~5m: `crmWhatsAppNumber` + `crmWhatsAppDraft` + `crmWhatsAppHref` helpers
- ~3m: compact card icon
- ~3m: expanded card icon inside Personal Info
- ~3m: `WhatsApp Out` / `WhatsApp In` added to activity picker (admin.html + CrmLeadPanel.tsx) + ActivityType union in crm-store.ts
- ~2m: CSS rule (`.crm-whatsapp-icon`)
- ~4m: smoke-test against seed prospects: P001 (`+41 76 234 56 78` → `41762345678`), one Swiss-domestic edited to `076 234 56 78` (should still resolve), one cleared phone (icon hidden); verify pre-fill text loads in WhatsApp Web

---

### WP-CRM-F14 — Won/Loss Post-Mortem textarea (~30m)

**The gap:** when a deal goes Won or Lost or Cancelled, the data trail stops. We capture a one-word reason (S1 fix · `lost_reason` = "Price") and an itemized record of what was sold (`solutions_bought`), but **no narrative** of *why* this deal landed (or didn't) and *what we'd do differently*. That narrative is the highest-leverage signal for future Analytics — clustering Won deals by what worked, clustering Lost deals by what blocked.

**The feature:** when status becomes terminal (Won / Lost / Cancelled), reveal a **Post-Mortem** textarea on the expanded card. Filippo writes 1–3 sentences after every close. The text is the v1 fuel for the future Analytics tab.

```
Status: ● Won
┌─ ✓ Won — what worked ─────────────────────────────────┐
│  Owner had been burned by a flat-rate web agency      │
│  before. Our session-based discovery + transparent    │
│  CHF per phase landed. Heritage angle on the          │
│  Bellevue's 1920s photos sealed it. Lesson: lead with │
│  process clarity for hospitality owners over 55.      │
└────────────────────────────────────────────────────────┘
```

Or, when Lost:
```
Status: ● Lost   — Competitor
┌─ ✕ Lost — lessons learned ─────────────────────────────┐
│  Head chef pushed for Hugo Boss-style minimalism, we   │
│  didn't have a competing reference. Owner deferred to  │
│  chef. Lesson: build a "classic European restaurant"   │
│  portfolio so we can match this aesthetic next time.   │
└─────────────────────────────────────────────────────────┘
```

#### How it differs from existing fields

| Field | Captures | Length | When |
|---|---|---|---|
| `lost_reason` | One categorical tag ("Price", "Competitor", "Other: …") | <40 chars | At terminal-status transition (6-chip picker) |
| `notes` | General freeform comment about the prospect | Any | Anytime |
| `needs_analysis` | Pre-demo gaps Filippo identifies | Multi-line list | Before/during discovery |
| `solutions_bought` | Itemized record of what was sold | Multi-line list | Post-demo / post-close |
| `post_mortem` (NEW) | **Narrative** of what worked / what blocked / lesson for next time | 1–3 sentences | After terminal status |

`lost_reason` answers "what bucket?". `post_mortem` answers "what's the story, and what do we change going forward?" Different surface, different shape, different consumer.

#### Schema addition

One new column, mirroring the precedent of `lost_reason` / `needs_analysis` / `solutions_bought`:

| Column | Type | Purpose |
|---|---|---|
| `post_mortem` | string | Free-text narrative captured after terminal status. Empty when status is not terminal (Won / Lost / Cancelled). |

#### UI placement

Sibling of the Lost-reason display panel (S1) and Standby panel — sits inside the expanded card header region, below status pills, above the body Tags/Personal Info rows. Visibility tied to status:

```ts
const isTerminal = p.status === 'Won' || p.status === 'Lost' || p.status === 'Cancelled'
```

When terminal: panel is visible. Label and accent color swap by outcome:
- Won → emerald accent, label "✓ Won — what worked"
- Lost → rose accent, label "✕ Lost — lessons learned"
- Cancelled → grey accent, label "⊘ Cancelled — context"

Textarea is `rows="4"` (consistent with `min-height` rules from E1) and persists via `crmPersistFieldDebounced('post_mortem', this.value)` like every other inline text field. The "saved ✓" indicator at the top of the expanded card flashes on commit.

#### Files touched

- `lib/crm-store.ts` — add `post_mortem: string` to Prospect interface + HEADERS + COL_WIDTHS + readSheet mapper + writeSheet row builder (5-line pattern, identical to `needs_analysis` add)
- `app/api/admin/crm/prospects/route.ts` + `bulk/route.ts` — defaults `post_mortem: ''`
- `docs/crm-feature/generate-seed.mjs` — add column to HEADERS + COL_WIDTHS (width 80, same as `needs_analysis`)
- `public/admin.html` — new conditional panel rendered alongside the existing Lost-reason display + Standby panel in `crmExpandedCardHtml`

#### Implementation sketch

```html
<!-- After the lost-reason display panel (#crm-lost-reason-display), before BODY -->
<div id="crm-post-mortem-panel" class="${isTerminal ? '' : 'hidden'} mx-3 mt-3 p-3 rounded border ${
    p.status === 'Won' ? 'border-emerald-500/30 bg-emerald-500/5'
    : p.status === 'Lost' ? 'border-rose-500/30 bg-rose-500/5'
    : 'border-zinc-500/30 bg-zinc-500/5'
}">
    <div class="text-[10px] font-bold uppercase tracking-wider mb-2 ${
        p.status === 'Won' ? 'text-emerald-400'
        : p.status === 'Lost' ? 'text-rose-400'
        : 'text-zinc-400'
    }">
        ${p.status === 'Won' ? '✓ Won — what worked'
          : p.status === 'Lost' ? '✕ Lost — lessons learned'
          : '⊘ Cancelled — context'}
    </div>
    <textarea class="crm-field-textarea" id="crm-modal-post-mortem" rows="4"
              placeholder="${p.status === 'Won'
                ? 'Why did this land? What worked? What would you double down on next time?'
                : 'Why did it stall? Who or what blocked? What would you do differently?'}"
              oninput="crmPersistFieldDebounced('post_mortem', this.value)">${escapeHtml(p.post_mortem || '')}</textarea>
</div>
```

The panel re-renders when status changes (visibility toggles, accent + label swap). Stored text is preserved across status changes (Lost → To do → Lost would show the same post-mortem) — Filippo's prose isn't auto-cleared.

#### Why this matters for Analytics

This is the **only** field in the Prospect schema that captures *causation*. Every other field is *state* (stage, status, amount) or *attribute* (contact, tags). Post-mortems let future Analytics:

- **Win-pattern clustering** — surface phrases common across Won deals' post-mortems ("heritage angle", "transparent pricing", "champion advocated")
- **Lost-pattern clustering** — same for Lost ("competitor X", "chef pushed back", "budget pulled mid-cycle")
- **Cross-reference with `lost_reason`** — of 12 deals tagged "Competitor", which specific competitors keep surfacing in the post-mortems?
- **Win-rate by approach** — if 80% of Filippo's "heritage angle"-mentioning post-mortems are Won, that's the dominant winning play

All of that is downstream — for v1 we just need to *capture* the data so it exists when Analytics ships. No clustering, no NLP, no charts here.

#### Edge cases

- Status changes Won → To do: panel hides; stored text preserved (don't auto-clear)
- Status changes Lost → Won: panel re-renders with green accent + new placeholder + label, but the existing text remains (Filippo might want to keep the narrative; he can edit/clear manually)
- Empty post-mortem on Won deal: no error, just an empty textarea — Filippo's choice
- Long post-mortem (>500 chars): no truncation; the textarea grows up to its `rows="4"` height, then scrolls internally
- Cancelled status: panel appears with neutral grey accent; same field, different framing in the label

#### What this WP is NOT

- Not a writeup template / structured form — pure free text. Templates die when usage diverges from the form.
- Not auto-suggested from activity history (no LLM in the loop)
- Not multi-language detection (English UI; Filippo writes in whatever language he wants — the data is opaque text)

#### Time estimate

~30m:
- ~5m: schema (lib/crm-store.ts + both routes + generate-seed.mjs)
- ~15m: conditional panel render + status-aware accent/label + placeholder
- ~10m: smoke-test against P011 (Won candidate) + P008 (Lost candidate from `standby_plan` precedent)

---

### WP-CRM-F15 — Action Chains & Smart Snoozing (~1h)

> **Numbering note:** Ralph initially proposed this as "F11" but F11 was already taken by the ROI + currency fix WP. Filed as F15 (next available). If you want to renumber, swap is mechanical — but most call-sites for both already cite their current numbers in commit history.

**The gap:** sales is repetitive. "No answer" almost always means "call again tomorrow." "Email sent" almost always means "wait three days for reply." Today every logged activity ends with the same "Follow up when?" chip prompt (S3 work) — Filippo has to click `1d` / `3d` / `1w` literally every time, and 80% of the time the choice is deterministic from the activity outcome. That's friction we can eliminate.

**Feature:** add **outcome-based Action Chains** that auto-snooze the lead after specific activity outcomes. The follow-up prompt is **bypassed** when an Action Chain rule fires; the existing prompt still appears for activities without a rule (so judgment-call follow-ups stay user-driven).

**Headline examples:**
- `Call · No Answer` → auto-snooze **+1d**, label `Follow up (no answer)`
- `Call · Voicemail` → auto-snooze **+2d**, label `Follow up (after VM)`
- `E-mail Out · Sent` → auto-snooze **+3d**, label `Wait for reply`
- `Proposal · Sent` → auto-snooze **+5d**, label `Follow up on proposal`
- `Meeting · Cancelled` → auto-snooze **+1d**, label `Reschedule`
- `Meeting · No-show` → auto-snooze **+1d**, label `Reschedule (no-show)`

Everything else (Call → Answered, Meeting → Completed, Note, etc.) keeps the existing S3 follow-up prompt — those outcomes need human judgment on the next action.

#### Schema addition

One new optional field on Activity:

| Column | Type | Purpose |
|---|---|---|
| `outcome` | string | Discrete outcome chosen at log-time. Empty when the activity type has no outcomes (Note, E-mail In, etc). Values are free-string but populated from a small fixed set per type (see rule table). |

Stored in the Activities sheet as a new column (mirrors precedent: `standby_plan`, `lost_reason`, `needs_analysis`, `solutions_bought`).

#### Outcome chip set (per activity type)

| Activity type | Outcome chips | Default (no chip clicked) |
|---|---|---|
| Call | Answered · No Answer · Voicemail · Busy | (none — Filippo must pick) |
| Qualification Call | same as Call | (none) |
| Zoom Call | Connected · No-show · Tech issue | (none) |
| Meeting | Completed · Cancelled · No-show | Completed |
| Onsite Visit | Completed · Cancelled · No-show | Completed |
| E-mail Out | (no chips — always "Sent") | Sent |
| E-mail In | (no chips — always "Received") | Received |
| Proposal | Sent · Discussed · Revised | Sent |
| Note | (no chips) | — |
| Started Discovery Session | (no chips) | — |

For activity types with chips: chips render in the compose form between the type label and the notes textarea. Picking a chip is required to enable Save (when chips are listed but optional, defaults apply on Save).

#### Action Chain rules table

```js
// Key: '<ActivityType>.<outcome_snake_case>' or '<ActivityType>' for outcome-free types.
// Value: { days: int, label: string } — days added to today's date, label written to next_action_label.
const CRM_ACTION_CHAINS = {
    'Call.no_answer':              { days: 1, label: 'Follow up (no answer)' },
    'Call.voicemail':              { days: 2, label: 'Follow up (after VM)' },
    'Call.busy':                   { days: 1, label: 'Try again (was busy)' },
    'Qualification Call.no_answer': { days: 1, label: 'Follow up (no answer)' },
    'Qualification Call.voicemail': { days: 2, label: 'Follow up (after VM)' },
    'Qualification Call.busy':     { days: 1, label: 'Try again (was busy)' },
    'Zoom Call.no_show':           { days: 1, label: 'Reschedule (no-show)' },
    'Zoom Call.tech_issue':        { days: 0, label: 'Re-try today (tech issue)' },
    'Meeting.cancelled':           { days: 1, label: 'Reschedule' },
    'Meeting.no_show':             { days: 1, label: 'Reschedule (no-show)' },
    'Onsite Visit.cancelled':      { days: 1, label: 'Reschedule' },
    'Onsite Visit.no_show':        { days: 1, label: 'Reschedule (no-show)' },
    'E-mail Out':                  { days: 3, label: 'Wait for reply' },
    'Proposal.sent':               { days: 5, label: 'Follow up on proposal' },
    'Proposal.discussed':          { days: 3, label: 'Follow up (post-discussion)' },
    'Proposal.revised':            { days: 2, label: 'Follow up on revised proposal' },
};
// E-mail In, Note, Started Discovery, Call.answered, Meeting.completed,
// Onsite Visit.completed, Zoom Call.connected → NO entry → fall through to
// existing S3 follow-up prompt (Filippo decides timing manually).
```

#### Behavior in crmLogActivityConfirm

After the POST succeeds:

```js
async function crmLogActivityConfirm(type, icon, color) {
    // ... existing compose-read + POST logic ...
    if (!res.ok) throw new Error(await res.text());

    const p = crmProspects.find(x => x.id === crmCurrentId);
    const outcome = compose.querySelector('.crm-compose-outcome[data-selected="true"]')?.dataset.value || '';

    // After history refresh + iCal export (existing flow):

    // F15 · Action Chain dispatch
    const ruleKey = outcome ? `${type}.${outcome}` : type;
    const rule = CRM_ACTION_CHAINS[ruleKey];
    if (rule && p) {
        const target = new Date();
        target.setDate(target.getDate() + rule.days);
        const iso = target.toISOString().slice(0, 10);
        await crmFollowupSet(p.id, iso, rule.label);
        crmShowActionChainToast(p, rule);  // small feedback, see below
        return;  // skip the S3 prompt — the chain handled the follow-up
    }

    // No rule → fall through to existing S3 follow-up prompt
    if (p) crmShowFollowupPrompt(p);
}
```

`crmFollowupSet` is reused (it already PATCHes `next_action_date` + `next_action_label`, re-renders, and refreshes history including the S3 scheduled-row badge). Existing infrastructure does the work.

#### Override toast

After auto-snooze fires, surface a small dismissible toast at the top of the History timeline so Filippo sees what happened and can override:

```
┌─ ⚡ Auto-snoozed +1d · "Follow up (no answer)" ──── Override ─ × ─┐
```

Click `Override` → opens the existing S3 follow-up prompt (1d/3d/1w/date chips) pre-populated with the rule's date so Filippo can pick a different option without re-typing. Click `×` → toast dismisses; the auto-snooze stays.

```js
function crmShowActionChainToast(p, rule) {
    const container = document.getElementById('crm-modal-history');
    if (!container) return;
    container.querySelector('.crm-action-chain-toast')?.remove();
    const node = document.createElement('div');
    node.className = 'crm-action-chain-toast crm-timeline-item';
    node.style.cssText = 'background:rgba(167,139,250,0.06);border:1px dashed rgba(167,139,250,0.4);border-radius:8px;padding:6px 10px;margin-bottom:8px;display:flex;align-items:center;gap:8px;';
    node.innerHTML = `
        <span class="text-[11px] font-mono text-violet-300">⚡ Auto-snoozed +${rule.days}d · "${escapeHtml(rule.label)}"</span>
        <button onclick="event.stopPropagation();crmActionChainOverride('${p.id}');" class="ml-auto text-[10px] text-secondary hover:text-primary underline">Override</button>
        <button onclick="event.stopPropagation();this.closest('.crm-action-chain-toast').remove();" class="text-secondary hover:text-primary"><i data-lucide="x" width="11"></i></button>
    `;
    container.prepend(node);
    lucide.createIcons();
    // Auto-dismiss after 8s so the toast doesn't accumulate visual debt
    setTimeout(() => node.remove(), 8000);
}
```

#### UI for outcome chips in compose form

Outcome chips render between the activity-type label row and the notes textarea. Single-select (radio behavior). Required for types listed in the rule table; optional for others.

```html
<!-- Inside crmLogActivity's compose template, before the notes textarea -->
${outcomes.length > 0 ? `
    <div class="crm-compose-outcomes flex flex-wrap gap-1 mb-2">
        ${outcomes.map(o => `
            <button class="crm-compose-outcome px-2 py-1 rounded text-[10px] border border-border bg-background hover:bg-surface-hover text-primary"
                    data-value="${o.value}" data-selected="false"
                    onclick="event.stopPropagation();crmComposePickOutcome(this)">
                ${escapeHtml(o.label)}
            </button>
        `).join('')}
    </div>
` : ''}
```

```js
const ACTIVITY_OUTCOMES = {
    'Call':              [{value:'answered',label:'Answered'},{value:'no_answer',label:'No Answer'},{value:'voicemail',label:'Voicemail'},{value:'busy',label:'Busy'}],
    'Qualification Call':[{value:'answered',label:'Answered'},{value:'no_answer',label:'No Answer'},{value:'voicemail',label:'Voicemail'},{value:'busy',label:'Busy'}],
    'Zoom Call':         [{value:'connected',label:'Connected'},{value:'no_show',label:'No-show'},{value:'tech_issue',label:'Tech issue'}],
    'Meeting':           [{value:'completed',label:'Completed'},{value:'cancelled',label:'Cancelled'},{value:'no_show',label:'No-show'}],
    'Onsite Visit':      [{value:'completed',label:'Completed'},{value:'cancelled',label:'Cancelled'},{value:'no_show',label:'No-show'}],
    'Proposal':          [{value:'sent',label:'Sent'},{value:'discussed',label:'Discussed'},{value:'revised',label:'Revised'}],
};

function crmComposePickOutcome(btn) {
    const wrap = btn.closest('.crm-compose-outcomes');
    wrap.querySelectorAll('.crm-compose-outcome').forEach(b => {
        b.dataset.selected = 'false';
        b.classList.remove('is-active');
    });
    btn.dataset.selected = 'true';
    btn.classList.add('is-active');
}
```

CSS reuses existing chip styling; add `.crm-compose-outcome.is-active` modifier for selected state (accent border + filled background).

#### Files touched

- `lib/crm-store.ts` — add `outcome: string` to Activity interface + ACTIVITY_HEADERS + ACTIVITY_COL_WIDTHS + `rowsToActivities` mapper + `writeActivitiesSheet` row builder + accept `outcome` in `appendActivity` input
- `app/api/admin/crm/activities/route.ts` (POST) — pass through `outcome` to `appendActivity`
- `public/admin.html`:
  - `ACTIVITY_OUTCOMES` map + `CRM_ACTION_CHAINS` rules table near the top of the CRM JS block
  - `crmLogActivity` template — inject outcome chips conditionally
  - `crmComposePickOutcome` — single-select handler
  - `crmLogActivityConfirm` — dispatch rule, call `crmFollowupSet`, show toast, skip S3 prompt when chain fires
  - `crmShowActionChainToast` + `crmActionChainOverride` — feedback + override path
  - CSS — `.crm-compose-outcome.is-active`, `.crm-action-chain-toast`

#### Edge cases

- **No outcome picked on Call** → existing S3 prompt fires (Filippo wants to manually pick when no rule applies; this is the "Answered" case + escape hatch for unexpected outcomes)
- **Activity logged from Overview's quick-Call button (F3)** → opens the compose form pre-selected on Call type; same outcome chip flow applies
- **Override clicked** → toast removes itself, S3 follow-up prompt opens with rule's date pre-filled (`crmShowFollowupPrompt` with optional pre-fill arg)
- **Auto-snooze + scheduled row** → S3's pinned scheduled row in History timeline updates automatically (it computes from `next_action_date` live)
- **Stale outcome on edit** (F6 future): if Filippo edits a logged activity's notes later, the outcome stays; we don't re-fire the chain (one-shot at log-time)
- **Same prospect, multiple Action Chains in one session** (call → no answer at 10am, email at 2pm) → each fires its own chain; the LAST one wins (overwrites `next_action_date`). Filippo can override via the toast or via the scheduled-row's snooze chips.

#### What this WP is NOT

- Not a state machine — rules are dumb lookups; no "if call was at 9am AND no answer THEN…" chains
- Not configurable per Filippo — the rule table is hardcoded for v1. If he wants per-user tuning, that's a Settings WP
- Not learning from history — no "Filippo usually picks 3d after Voicemail, let's update the rule." That's analytics-tab territory
- Not multi-step (e.g. "after 3 No Answers in a row, escalate to email") — sequential logic compounds badly, defer indefinitely

#### Time estimate

~1h:
- ~10m: schema (Activity.outcome + ACTIVITY_HEADERS + writer/reader)
- ~15m: outcome chips in compose form + single-select handler
- ~10m: rules table + dispatcher in `crmLogActivityConfirm`
- ~10m: toast + override path
- ~5m: CSS for active outcome chip + toast styling
- ~10m: smoke-test the rule table — Call/No Answer, Email Out, Meeting/Cancelled, plus a "no rule" path (Call/Answered → S3 prompt fires)

---

### WP-CRM-F16 — Overview row-level keyboard shortcuts (~30m)

**Why:** Filippo's morning queue in Overview is a list of leads he works through in order. Today he has to mouse-click between rows + click the right action button each time. Outreach / Apollo / Close all give single-keystroke shortcuts at the queue level — pure keyboard flow lets a rep clear a 20-row queue in ~3 minutes instead of ~10. This was deferred from F3 v1 (the "Defer to F3 v2 if time-constrained" note in §8); promoting to its own WP.

**Scope:** keyboard shortcuts fire **only when**:
- Active view is Overview (`adminCurrentView === 'overview'`)
- No input/textarea/contenteditable is focused
- No modal/picker is open (bulk import modal, activity picker, shortcuts overlay, cmd-K)
- A row IS selected (`crmOverviewSelectedId` is set)

#### Shortcut table

| Key | Action |
|---|---|
| `j` / `↓` | Move selection to next row (wraps at bottom) |
| `k` / `↑` | Move selection to previous row (wraps at top) |
| `Enter` | Open full record — `switchView('kanban')` + `crmOpenModal(id)` |
| `c` | Log Call — opens compose pre-typed to Call for the selected prospect (requires opening expanded card first; one combined action) |
| `e` | Log Email Out — same flow, type=`E-mail Out` |
| `m` | Log Meeting — same flow, type=`Meeting` |
| `n` | Log Note — focuses F4 composer (if F4 has shipped, expanded card opens; otherwise opens picker on Note) |
| `s` | Snooze +1d (`crmOverviewSnooze(id, 1)`) — row visually fades out, next row auto-selects |
| `d` | Done — `crmOverviewDone(id)` — clears scheduled follow-up; row disappears |
| `Esc` | Deselect — clear selection, context panel shows "Click a task on the left…" |

#### Implementation

```js
// In the existing document keydown handler (~line 3245 area where CRM
// shortcuts already live), add a section that only fires when Overview
// is the active CRM-context view:

const overviewView = document.getElementById('view-overview');
const inOverview = overviewView && !overviewView.classList.contains('hidden');
if (inOverview && !inField && crmOverviewSelectedId) {
    const id = crmOverviewSelectedId;
    switch (ev.key) {
        case 'j': case 'ArrowDown':
            ev.preventDefault();
            crmOverviewMoveSelection(+1);
            return;
        case 'k': case 'ArrowUp':
            ev.preventDefault();
            crmOverviewMoveSelection(-1);
            return;
        case 'Enter':
            ev.preventDefault();
            crmOverviewOpenFull(id);
            return;
        case 'c': ev.preventDefault(); crmOverviewQuickAction(id, 'Call', 'phone', '#a78bfa'); return;
        case 'e': ev.preventDefault(); crmOverviewQuickAction(id, 'E-mail Out', 'mail', '#a1a1aa'); return;
        case 'm': ev.preventDefault(); crmOverviewQuickAction(id, 'Meeting', 'handshake', '#15B981'); return;
        case 'n': ev.preventDefault(); crmOverviewQuickAction(id, 'Note', 'file-text', '#a1a1aa'); return;
        case 's': ev.preventDefault(); crmOverviewSnooze(id, 1); return;
        case 'd': ev.preventDefault(); crmOverviewDone(id); return;
        case 'Escape':
            ev.preventDefault();
            crmOverviewSelectedId = null;
            document.querySelectorAll('.crm-overview-row.is-selected').forEach(r => r.classList.remove('is-selected'));
            document.getElementById('crm-overview-context').innerHTML =
                '<div class="text-secondary italic text-xs">Click a task on the left to see its context.</div>';
            return;
    }
}

function crmOverviewMoveSelection(delta) {
    const list = crmOverviewList();
    if (!list.length) return;
    const idx = list.findIndex(p => p.id === crmOverviewSelectedId);
    const nextIdx = idx < 0 ? 0 : ((idx + delta) % list.length + list.length) % list.length;
    crmOverviewSelect(list[nextIdx].id);
    // Scroll the newly-selected row into view
    document.querySelector(`.crm-overview-row[data-prospect-id="${list[nextIdx].id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Unified quick-action wrapper — used by both c/e/m/n shortcuts AND the
// existing 📞 row button (F3). DRYs the switchView + crmOpenModal + delay +
// crmLogActivity sequence.
function crmOverviewQuickAction(id, type, icon, color) {
    switchView('kanban');
    setTimeout(() => {
        crmOpenModal(id);
        setTimeout(() => crmLogActivity(type, icon, color), 80);
    }, 50);
}
```

#### Discoverability

Update the `?` shortcuts overlay (existing WP-CRM-D3 overlay at admin.html ~line 1438) to list the Overview-specific shortcuts in a new section:

```
Overview · row-level actions (when a task is selected)
  c  Log call           e  Log email
  m  Log meeting        n  Log note
  s  Snooze +1d         d  Done
  ↵  Open full record   ↑↓/jk  Navigate
  Esc  Deselect
```

#### Edge cases

- **Search input focused** → `inField` guard skips all shortcuts. Filippo types in search normally.
- **No row selected** → keyboard shortcuts no-op. The `j` key on first entry can auto-select first row (small UX nicety): if `crmOverviewSelectedId` is null AND key is `j`/`ArrowDown`/`k`/`ArrowUp`, select first row.
- **List empty** → all shortcuts no-op.
- **Selected row gets filtered out** (e.g., user edits search to exclude it) → `crmRenderOverview` resets selection to first visible row.
- **Cmd+K / Esc collisions** → Esc has multiple meanings; the existing handler ordering already handles "close modal first, then deselect" because the modal-close branch returns before reaching the Overview deselect branch.

#### Time estimate

~30m:
- ~15m: shortcuts switch in the existing keydown handler + `crmOverviewMoveSelection` + `crmOverviewQuickAction` wrapper
- ~10m: update `?` shortcuts overlay with the new section
- ~5m: smoke-test j/k navigation, c/s/d on a real seed row, Esc deselect

---

### WP-CRM-F17 — Lead deletion (~45m)

**Why:** there's no Delete button anywhere. Filippo creates a duplicate prospect, fat-fingers a bulk import, or a lead is later identified as spam — today the row stays forever. Lost/Cancelled status hides the urgency (F5) but the row still pollutes search, totals, and column counts. Hard delete is a small operation that matters when it matters. Promoted from §8 deferred list.

**Scope:** **hard delete from Prospects sheet only.** Activities orphan (kept for historical record, accessible via direct REST query). Session folders are NEVER touched (user-content sanctity — they contain art, briefs, hours of CD-agent work).

#### Backend

`app/api/admin/crm/prospects/[id]/route.ts` — add `DELETE` handler alongside the existing `PATCH`:

```ts
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const rows = readSheet()
        const idx = rows.findIndex(r => r.id === id)
        if (idx < 0) {
            return NextResponse.json({ error: `prospect ${id} not found` }, { status: 404 })
        }
        const removed = rows[idx]
        rows.splice(idx, 1)
        await writeSheet(rows)
        // Activities for this prospect orphan — they still live in the
        // Activities sheet but their prospect_id no longer resolves. This
        // is intentional: a future Analytics WP can either GC orphaned
        // activities or treat them as historical "deleted-lead" cohort data.
        return NextResponse.json({ ok: true, removed })
    } catch (err) {
        console.error('[CRM] DELETE prospect failed:', err)
        return NextResponse.json({ error: String(err) }, { status: 500 })
    }
}
```

#### UI

Inside the expanded card, at the very bottom (after History), a small **Danger zone** panel — collapsed by default behind a single tiny chevron link. Two-step confirmation.

```html
<!-- After the History block in crmExpandedCardHtml -->
<div class="crm-danger-zone mt-6 pt-3 border-t border-border/30">
    <button onclick="event.stopPropagation();crmDangerZoneToggle()"
            class="text-[10px] text-secondary hover:text-rose-400 font-mono uppercase tracking-wider">
        ⌄ danger zone
    </button>
    <div id="crm-danger-zone-body" class="hidden mt-3">
        <div class="p-3 rounded border border-rose-500/30 bg-rose-500/5">
            <div class="text-[10px] text-rose-400 font-bold uppercase mb-2">Delete lead</div>
            <p class="text-[11px] text-secondary mb-3">
                Removes <b>${escapeHtml(p.company)}</b> (${p.id}) from the Prospects sheet.
                Activities for this lead are kept in the Activities sheet (orphaned).
                Linked session folders in <code>public/</code> are NOT touched.
                <b>Cannot be undone.</b>
            </p>
            <div class="flex gap-2">
                <button onclick="event.stopPropagation();crmDangerZoneToggle()" class="px-3 py-1.5 rounded text-[11px] text-secondary hover:text-primary border border-border">
                    Cancel
                </button>
                <button onclick="event.stopPropagation();crmDeleteLead('${p.id}')" class="px-3 py-1.5 rounded text-[11px] font-bold text-white bg-rose-500 hover:bg-rose-600">
                    Delete forever
                </button>
            </div>
        </div>
    </div>
</div>
```

```js
function crmDangerZoneToggle() {
    document.getElementById('crm-danger-zone-body')?.classList.toggle('hidden');
}

async function crmDeleteLead(id) {
    try {
        const res = await fetch(`/api/admin/crm/prospects/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error(await res.text());
        crmCloseModal();
        await crmLoad();  // refreshes the kanban + Overview to drop the row
    } catch (err) {
        console.error('[CRM] delete failed:', err);
        alert('Delete failed: ' + err.message);
    }
}
```

#### Edge cases

- **Two-step confirmation** (chevron → reveal → "Delete forever" button) prevents accidental click. No `confirm()` dialog (Ralph's "no modals" doctrine).
- **Active card was deleted** → `crmCloseModal` runs first; `crmCurrentId` is cleared. Re-render happens against the new (smaller) prospect list. Other expanded-card state (history, scheduled row) is automatically cleared by the close.
- **Cascade ambiguity** — explicitly documented in the UI text ("Activities kept; sessions not touched"). Filippo never wonders what happened.
- **Bulk delete** — out of scope for v1. Not asked.
- **Undo** — out of scope. Filippo can re-create from memory or re-import from a backup of the xlsx (which Excel auto-versions if Filippo opened it).

#### Time estimate

~45m:
- ~5m: DELETE handler in the existing prospects/[id] route
- ~20m: Danger zone UI + two-step confirm
- ~10m: `crmDeleteLead` + post-delete cleanup
- ~10m: smoke-test on a throwaway seed row (P019 if Filippo's OK with it)

---

### WP-CRM-F18 — Recurring follow-ups (~1.5h)

**Why:** today every follow-up is one-shot. Filippo schedules `+3d` on a No-Answer call → after that follow-up fires (he calls again) he has to re-schedule manually each time. For long-cycle prospects ("call this customer every Monday until they answer") that's 12+ manual reschedules over 3 months. A simple recurrence pattern automates the loop.

**Scope:** add a `recurring_pattern` field on Prospect; when present, follow-up "Done" / Action Chain firing computes the NEXT next-action-date from the pattern, not from a flat `+1d`. Auto-clears on positive outcomes ("until they answer" semantics).

#### Schema addition

| Column | Type | Purpose |
|---|---|---|
| `recurring_pattern` | string | `''` (no recurrence), `'every-Nd'` (every N days where N is 1-31), or `'every-<weekday>'` (`mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`). |

Mirrors the precedent of other added fields (one column, free-string-with-validation, default empty).

Examples:
- `every-mon` → next Monday after today (or this Monday if today is before)
- `every-3d` → today + 3 days
- `every-fri` → next Friday

#### UI

Inside the expanded card's Scheduled row (S3) — add a small "Recurring:" pill row that opens a picker:

```html
<!-- Inside the scheduled row (crmScheduledRowHtml), append: -->
<div class="flex items-center gap-2 mt-2 pt-2 border-t border-border/30">
    <span class="text-[10px] font-mono text-secondary uppercase tracking-wider">Recurring:</span>
    <select class="crm-recurring-picker text-[11px] bg-background border border-border rounded px-2 py-1"
            onchange="event.stopPropagation();crmSetRecurring('${p.id}', this.value)">
        <option value=""             ${!p.recurring_pattern ? 'selected' : ''}>None (one-shot)</option>
        <option value="every-1d"     ${p.recurring_pattern === 'every-1d' ? 'selected' : ''}>Every day</option>
        <option value="every-3d"     ${p.recurring_pattern === 'every-3d' ? 'selected' : ''}>Every 3 days</option>
        <option value="every-7d"     ${p.recurring_pattern === 'every-7d' ? 'selected' : ''}>Every week</option>
        <option value="every-mon"    ${p.recurring_pattern === 'every-mon' ? 'selected' : ''}>Every Monday</option>
        <option value="every-tue"    ${p.recurring_pattern === 'every-tue' ? 'selected' : ''}>Every Tuesday</option>
        <option value="every-wed"    ${p.recurring_pattern === 'every-wed' ? 'selected' : ''}>Every Wednesday</option>
        <option value="every-thu"    ${p.recurring_pattern === 'every-thu' ? 'selected' : ''}>Every Thursday</option>
        <option value="every-fri"    ${p.recurring_pattern === 'every-fri' ? 'selected' : ''}>Every Friday</option>
    </select>
    ${p.recurring_pattern ? `
        <span class="text-[10px] text-secondary italic">— auto-clears on Answered/Connected/Completed</span>
    ` : ''}
</div>
```

#### Pattern → next-date computation

```js
// Compute next next_action_date from a recurring pattern. Anchored on today.
function crmComputeRecurringNext(pattern) {
    if (!pattern) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const m = pattern.match(/^every-(\d+)d$/);
    if (m) {
        const days = parseInt(m[1], 10);
        if (!days || days < 1 || days > 31) return null;
        const next = new Date(today);
        next.setDate(next.getDate() + days);
        return next.toISOString().slice(0, 10);
    }
    const weekdays = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const wd = weekdays[(pattern.replace('every-', ''))];
    if (wd !== undefined) {
        const next = new Date(today);
        const todayDow = next.getDay();
        let delta = wd - todayDow;
        if (delta <= 0) delta += 7;  // next occurrence, not today
        next.setDate(next.getDate() + delta);
        return next.toISOString().slice(0, 10);
    }
    return null;
}

async function crmSetRecurring(prospectId, pattern) {
    const p = crmProspects.find(x => x.id === prospectId);
    if (!p) return;
    p.recurring_pattern = pattern;
    await crmPatch(prospectId, { recurring_pattern: pattern });
    crmRenderExpandedOverlay?.();  // refresh the scheduled row's hint
}
```

#### Integration with F3 + F15

**F3 Done button** (`crmClearFollowup`): if `recurring_pattern` is set, INSTEAD of clearing `next_action_date`, compute the next occurrence and set it. The "Done" semantics shift: "done with this cycle, schedule next."

```js
// Modify crmClearFollowup to respect recurring:
async function crmClearFollowup(prospectId) {
    const p = crmProspects.find(x => x.id === prospectId);
    if (!p) return;
    if (p.recurring_pattern) {
        // Recurring: compute next + reschedule, don't clear
        const nextIso = crmComputeRecurringNext(p.recurring_pattern);
        if (nextIso) {
            await crmFollowupSetCustom(prospectId, nextIso);
            return;
        }
        // Pattern invalid → fall through to one-shot clear
    }
    // One-shot: existing clear behavior
    // ...
}
```

**F15 Action Chains** (`crmLogActivityConfirm`): when a chain rule would fire AND `recurring_pattern` is set, prefer the recurring date over the chain's flat offset — unless the activity outcome is "positive" (which clears recurring).

```js
const POSITIVE_OUTCOMES = new Set(['answered', 'connected', 'completed']);

// In crmLogActivityConfirm after Action Chain dispatch:
if (rule && p) {
    if (POSITIVE_OUTCOMES.has(outcome) && p.recurring_pattern) {
        // "Until they answer" — clear recurring + clear next_action_date
        await crmPatch(p.id, { recurring_pattern: '', next_action_date: '', next_action_label: '' });
        crmShowActionChainToast(p, { days: 0, label: '✓ Cycle complete — recurring cleared' });
        return;
    }
    if (p.recurring_pattern && !POSITIVE_OUTCOMES.has(outcome)) {
        // Use recurring date instead of chain offset
        const nextIso = crmComputeRecurringNext(p.recurring_pattern);
        if (nextIso) {
            await crmFollowupSetCustom(p.id, nextIso);
            crmShowActionChainToast(p, { days: '∞', label: `Recurring: next ${nextIso}` });
            return;
        }
    }
    // Fall through to normal chain dispatch
    // ...existing logic
}
```

#### Files touched

- `lib/crm-store.ts` — add `recurring_pattern: string` to Prospect (~5 lines, mirrors `needs_analysis` pattern)
- `app/api/admin/crm/prospects/route.ts` + `bulk/route.ts` — defaults `''`
- `docs/crm-feature/generate-seed.mjs` — add to HEADERS + COL_WIDTHS
- `public/admin.html`:
  - `crmComputeRecurringNext` helper
  - `crmSetRecurring` persist function
  - Recurring picker inside `crmScheduledRowHtml`
  - `crmClearFollowup` branch for recurring
  - `crmLogActivityConfirm` branch for recurring × Action Chain interaction

#### Edge cases

- **Pattern set but no scheduled action** → picker visible inside the static "no scheduled" placeholder; selecting a pattern immediately sets the first next-action-date
- **Pattern with past/today date** → `crmComputeRecurringNext` always returns FUTURE date (the `if (delta <= 0) delta += 7` guard ensures "next Monday" is genuinely next, not today)
- **Recurring + manual snooze** (user clicks `+3d` snooze chip on a recurring lead) → manual snooze wins for THIS occurrence; the pattern still applies on next Done
- **Recurring + status change to Won/Lost/Cancelled** → status PATCH should also clear `recurring_pattern` (terminal leads don't need recurring follow-ups). Add this to the status-change side-effects.
- **Pattern format invariant** → only the dropdown can set it. No free-text input. If someone manually edits the xlsx with an invalid pattern, `crmComputeRecurringNext` returns null and the pattern silently no-ops on next iteration.

#### Time estimate

~1.5h:
- ~10m: schema (one column, four files)
- ~15m: picker UI inside scheduled row + persist
- ~15m: `crmComputeRecurringNext` + unit-test it mentally (every-3d on a Wed → Sat; every-mon on a Tue → next Mon)
- ~25m: `crmClearFollowup` + `crmLogActivityConfirm` branches
- ~15m: status-change side-effect (clear recurring on Won/Lost/Cancelled)
- ~10m: smoke-test cycle — set "every-mon", call → no-answer → see next Monday computed; then call → answered → see cycle clear

---

### WP-CRM-F19 — WhatsApp live sync via Baileys (~6.5h, depends on F13)

**The flagship integration.** F13 (the `wa.me` icon) makes outreach 5× faster but the loop stays half-open: Filippo still presses Send manually, replies still arrive in WhatsApp Web invisibly to Oskar, no activity rows are auto-created. F19 closes the loop. After this WP, every WhatsApp message in and out of the paired number is a first-class CRM activity, written automatically, matched to the right prospect, surfaced in the History timeline next to calls and emails.

**Mechanism:** a long-running Node.js subprocess (`oskar-wa-bridge`) holds a Baileys (`@whiskeysockets/baileys`) socket. Baileys negotiates the WhatsApp Multi-Device protocol — to WhatsApp's servers, Oskar appears as a linked device exactly like WhatsApp Web does. Pairing happens once via QR scan from Filippo's phone; thereafter Oskar receives every inbound message over WebSocket and can send programmatically with `sock.sendMessage(...)`. See doc-level explanation of Baileys above (`### Baileys explained`).

**Risk acknowledgement up front:** Baileys is reverse-engineered and against WhatsApp's ToS. Detection outcomes are usually a benign linked-device disconnect (re-pair via QR, 30 sec recovery). Phone-number bans are rare at personal volume but possible.

---

#### Scope — what ships in F19

✅ **In scope:**
- New Settings → WhatsApp card (Ralph's UI spec below)
- `oskar-wa-bridge` Node.js subprocess (Baileys host)
- Install + autostart guides for macOS and Windows
- QR-code pairing flow (Filippo scans once, creds persist to disk)
- Inbound: every received message → POST to Oskar → matched to prospect by phone → `WhatsApp In` activity row created
- Outbound: Oskar UI "Send WhatsApp" button → bridge → Baileys → ack → `WhatsApp Out` activity row created automatically (no manual log needed; the F13 `wa.me` icon becomes a fallback "launch the real WhatsApp Web" launcher rather than the primary send path)
- Media handling: inbound images/audio/docs save to `public/_whatsapp/media/<sessionId>/` and the activity row's `notes` carries a `[Media: filename]` reference (rendering is v2)
- Send/receipt status badges (✓ sent, ✓✓ delivered, ✓✓ read) on `WhatsApp Out` activity rows
- Reconnect logic: handle `DisconnectReason.connectionClosed | connectionLost | restartRequired` with exponential backoff; surface `loggedOut` to UI as "Re-pair needed"

❌ **Out of scope (defer to v2 if needed):**
- Voice / video calls (Baileys doesn't support them; never will)
- Groups (sales is 1:1 — no group support needed)
- Stories / Status (irrelevant)
- Old chat history backfill (Baileys only delivers recent ~50–250 messages per chat; full history requires the manual chat-export upload — separate WP if requested)
- Sending media from Oskar (text-only outbound in v1; can attach via wa.me launcher fallback)
- Multiple WhatsApp accounts (one bridge, one paired number)

---

#### UI spec — Settings → WhatsApp card

Per Ralph 2026-05-24: the existing Settings page is a 3-column grid (340px Settings forms | 240px Agents | 1fr preview+messages). **The WhatsApp card sits below the Agents column** — same 240px width, stacked vertically under the existing Agents list. The COL 2 container gets split into a 2-row flex column: top row Agents (existing), bottom row WhatsApp (new).

```
┌── COL 2 (240px) ────────────────────────┐
│ ┌── AGENTS (existing) ───────────────┐  │
│ │ • CD         active               │  │
│ │ • WebDev     active               │  │
│ │ • Sentinel-Ti idle                │  │
│ │ …                                  │  │
│ └────────────────────────────────────┘  │
│ ┌── WHATSAPP (new) ──────────────────┐  │
│ │  ● Connected                       │  │
│ │  +41 76 234 56 78                  │  │
│ │  Device · :7                       │  │
│ │  Linked 2026-05-22 14:32           │  │
│ │  Last activity 30s ago             │  │
│ │                                     │  │
│ │  Baileys 6.7.18 ✓                   │  │
│ │  [ Disconnect ]                    │  │
│ └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

States: **`not-installed`** (Baileys npm package missing — show install steps), **`installed-not-running`** (package present but bridge subprocess offline — show start command), **`installed-not-paired`** (bridge running, no saved creds — show Generate QR), **`pairing`** (QR shown, waiting for scan), **`connected`** (paired + socket alive), **`error`** (logged-out / unrecoverable).

**Detection logic** (every poll of `/api/admin/whatsapp/status`):

```ts
// 1. Is the npm package installed?
const baileysPkg = resolveFromDisk('node_modules/@whiskeysockets/baileys/package.json')
if (!baileysPkg) return { status: 'not-installed' }
const version = JSON.parse(readFileSync(baileysPkg, 'utf-8')).version  // e.g. "6.7.18"

// 2. Is the bridge subprocess alive?
const bridgeAlive = await fetch('http://127.0.0.1:7001/health')
  .then(r => r.ok).catch(() => false)
if (!bridgeAlive) return { status: 'installed-not-running', version }

// 3. Bridge alive — ask it for the pair status
const bridgeStatus = await fetch('http://127.0.0.1:7001/status').then(r => r.json())
return { ...bridgeStatus, version }
  // bridge returns: 'installed-not-paired' | 'pairing' | 'connected' | 'error'
```

The **Baileys version string** is shown in every state EXCEPT `not-installed` — visible as a tiny mono-caps line near the bottom of the card. Acts as both a status confirmation ("yes the package is here") and a maintenance signal (Filippo / Ralph can see at a glance whether `npm update` is overdue).

---

##### State 1 · `not-installed` — Baileys npm package missing

```
┌── WHATSAPP ────────────────────────────┐
│  ⚠  Baileys not installed              │
│                                         │
│  WhatsApp live sync needs Baileys.     │
│  Pick your OS:                          │
│                                         │
│  [ macOS ] [ Windows ]   ← OS tabs      │
│                                         │
│  Prerequisites: Node.js 18+             │
│  • macOS:   brew install node           │
│  • Windows: nodejs.org → installer      │
│                                         │
│  1. Open Terminal (mac) / PowerShell    │
│     (Windows) in the Oskar project root│
│  2. Run:                                │
│     ┌─────────────────────────────────┐ │
│     │ npm install \                    │ │
│     │   @whiskeysockets/baileys \      │ │
│     │   qrcode-terminal pino           │ │
│     └─────────────────────────────────┘ │
│  3. Start the bridge:                   │
│     • macOS:                            │
│       node oskar-wa-bridge.mjs          │
│     • Windows (PowerShell):             │
│       node .\oskar-wa-bridge.mjs        │
│  4. Reload this page                    │
│                                         │
│  ── Autostart (optional) ──             │
│  • macOS:   [ Generate launchd plist ]  │
│  • Windows: [ Generate Task XML ]       │
│                                         │
│  [ Re-check ]                          │
└─────────────────────────────────────────┘
```

- This is the **only** state that shows install instructions. After a successful install + bridge start, the card transitions to one of the other states and the install block is gone.
- OS tabs (`[ macOS ] [ Windows ]`) toggle which step-3 launch command is highlighted. Both columns are visible in the doc above; in the UI only the active one renders to keep the card compact.
- `[ Re-check ]` button → re-hits `/api/admin/whatsapp/status`. The status poll already runs on a 5s interval, so this is just a "scan now" affordance for impatient Filippos.
- The autostart generators (`[ Generate launchd plist ]` / `[ Generate Task XML ]`) produce ready-to-install files (download attachment) that Filippo drops into `~/Library/LaunchAgents/` on mac or imports into Task Scheduler on Windows. Without autostart, `oskar-wa-bridge.mjs` must be started manually after every reboot — once installed, this surfaces in State 2 as a chip.
- **No version line in this state** — there's no installed Baileys to report a version for. (Per Ralph's spec: install instructions OR version, never both at the same time.)

---

##### State 2 · `installed-not-running` — package present, bridge subprocess offline

```
┌── WHATSAPP ────────────────────────────┐
│  ○ Bridge offline                       │
│                                         │
│  Start the bridge to pair:              │
│  ┌────────────────────────────────────┐ │
│  │ node oskar-wa-bridge.mjs           │ │
│  └────────────────────────────────────┘ │
│                                         │
│  [ Re-check ]                          │
│                                         │
│  Baileys 6.7.18                         │
└─────────────────────────────────────────┘
```

- Detected when `require.resolve('@whiskeysockets/baileys/package.json')` succeeds but `GET 127.0.0.1:7001/health` fails
- Shows only the start command (no `npm install` step — package is already there)
- Version line visible at the bottom — Filippo / Ralph can confirm at a glance the package isn't broken
- `[ Re-check ]` polls immediately

---

##### State 3 · `installed-not-paired` — bridge alive, no saved creds

```
┌── WHATSAPP ────────────────────────────┐
│  ○ Not paired                          │
│                                         │
│  [ Generate QR code ]                  │
│                                         │
│  Baileys 6.7.18                         │
└─────────────────────────────────────────┘
```

- Bridge subprocess responded but `creds.json` is missing or empty → never paired (or just disconnected via the UI)
- `Generate QR code` → transition to `pairing` (State 4)
- Version visible at bottom

---

##### State 4 · `pairing` — QR shown

```
┌── WHATSAPP ────────────────────────────┐
│  ◐ Waiting for scan…                   │
│                                         │
│   ▓▓▓▓▓▓▓▓▓▓▓                          │
│   ▓ QR CODE ▓                          │
│   ▓▓▓▓▓▓▓▓▓▓▓                          │
│                                         │
│  On your phone:                         │
│  WhatsApp → Settings → Linked Devices  │
│  → Link a Device → scan this QR        │
│                                         │
│  QR refreshes every 60s.                │
│  [ Cancel ]                            │
│                                         │
│  Baileys 6.7.18                         │
└─────────────────────────────────────────┘
```

- QR generated by Baileys (`connection.update` event with `qr` field)
- Rendered as data-URL `<img>` in the card
- Refresh every 60s (Baileys regenerates) — keep latest version
- `Cancel` button → kill the pair attempt, return to `installed-not-paired`
- On successful pair (`connection.update` with `connection: 'open'`) → transition to `connected`
- Version visible at bottom

---

##### State 5 · `connected` — paired + socket alive

```
┌── WHATSAPP ────────────────────────────┐
│  ● Connected                            │
│  +41 76 234 56 78                       │
│  Device · 41762345678:7@s.whatsapp.net │
│  Linked 2026-05-22 14:32                │
│  Last activity 30 sec ago               │
│                                         │
│  Inbound today    12                    │
│  Outbound today    8                    │
│                                         │
│  [ Disconnect ]                        │
│                                         │
│  Baileys 6.7.18                         │
└─────────────────────────────────────────┘
```

- Status dot green
- Phone number = `creds.me.id.split(':')[0]` formatted with country-code separators
- Device id = full jid `41762345678:N@s.whatsapp.net` where `:N` is the WhatsApp-assigned linked-device index
- Linked-since = first-pair timestamp persisted to `public/_whatsapp/auth/meta.json`
- Last activity = elapsed time since last inbound or outbound message
- Inbound / outbound today = count of `WhatsApp In` + `WhatsApp Out` activity rows with `timestamp` matching today
- `Disconnect` button → `sock.logout()` + delete auth state files + transition to `installed-not-paired`. Confirmation strip required: "Disconnecting unlinks Oskar from this WhatsApp account. Future messages won't be captured until re-paired. Continue?"
- Version visible at bottom

---

##### State 6 · `error` — logged-out or unrecoverable

```
┌── WHATSAPP ────────────────────────────┐
│  ✕ Disconnected                        │
│                                         │
│  WhatsApp closed this device's session.│
│  Last error: connection_replaced       │
│  (paired from another browser)          │
│                                         │
│  [ Re-pair ]    [ View logs ]          │
│                                         │
│  Baileys 6.7.18                         │
└─────────────────────────────────────────┘
```

- Surfaces when Baileys reports `DisconnectReason.loggedOut` or `connectionReplaced`
- `Re-pair` = generate fresh QR (same as Generate QR code button — jumps to `pairing`)
- `View logs` = expand the bridge subprocess's last 50 log lines (helps Filippo diagnose)
- Version visible at bottom

---

#### Architecture

```
                       ┌─────────────────────┐
                       │  Filippo's iPhone   │
                       │                     │
                       └──────────┬──────────┘
                                   │ Multi-device pairing
                                   │ (QR scanned once)
                                   ▼
        Meta servers ◀────────────────────────────▶  WhatsApp
              ▲                                          Web in Chrome
              │ WebSocket                                (Filippo's primary)
              │
              ▼
        ┌──────────────────────────┐
        │  oskar-wa-bridge.mjs     │       ┌────────────────────────┐
        │  ─ Baileys socket        │ HTTP  │  Oskar (Next.js)        │
        │  ─ auth state on disk    │◀─────▶│   /api/admin/crm/        │
        │  ─ message events        │       │   ├── activities/wa-in  │
        │  ─ outbound queue        │       │   ├── activities/wa-out │
        │  ─ media saver           │       │   └── whatsapp/status   │
        │                          │       └────────────────────────┘
        │  Port 7001 (loopback)    │
        └──────────────────────────┘
                  │
                  ▼
        public/_whatsapp/
          ├── auth/        ← Baileys session creds (gitignored)
          │   ├── creds.json
          │   ├── pre-keys.json
          │   └── meta.json (linked-since timestamp, etc)
          └── media/       ← inbound media files
              └── 2026-05-24/
                  ├── A0042-photo.jpg
                  └── A0043-voice.ogg
```

**Why a subprocess and not in-process with Next.js:**
- Baileys holds a stateful WebSocket; Next.js dev mode HMR would kill it on every code edit
- Process isolation = bridge crashes don't take down Oskar's UI
- Easier autostart story (launchd / Task Scheduler points at one .mjs file)
- IPC over loopback HTTP is dead-simple and debuggable with curl

**Why loopback HTTP (not Unix domain socket / named pipe):**
- Cross-platform without OS-specific code paths
- Bridge is `127.0.0.1:7001` only — no external exposure
- Same pattern as Oskar's existing `/api/active-session` sidecar already uses

---

#### Inbound message path

```
WhatsApp servers
  → bridge `messages.upsert` event fires
  → for each message:
       skip if m.key.fromMe (we'll handle our own sends via outbound ack)
       phone = m.key.remoteJid.split('@')[0]                  // '41761234567'
       body  = m.message?.conversation
            || m.message?.extendedTextMessage?.text
            || m.message?.imageMessage?.caption
            || '[Media]'
       media = m.message?.imageMessage | audioMessage | documentMessage
       if (media) downloadAndPersist(media) → mediaPath
       POST localhost:3000/api/admin/crm/activities/wa-inbound
         { phone, body, mediaPath, timestamp, wa_message_id }
  → Oskar matches phone vs every prospect.phone via crmWhatsAppNumber()
  → If matched: append `WhatsApp In` activity row with prospect_id, body, mediaPath
  → If unmatched: stash in a "WhatsApp Inbox" view (deferred WP — for v1 just log + drop)
```

**Deduplication:** `wa_message_id` is unique per message. The wa-inbound endpoint maintains a small LRU of recent `wa_message_id`s to drop duplicates that arrive when the bridge reconnects mid-flight and re-delivers.

**Phone matching:** the existing `crmWhatsAppNumber(phone)` helper in admin.html already does the Swiss-aware normalization. Server-side mirror in `lib/crm-store.ts` (new export `normalizeWhatsAppNumber(phone)`). The activities endpoint loops the prospects sheet, normalizes each `p.phone`, exact-matches against the incoming digit string.

**Multi-match (rare):** if two prospects share the same normalized number (typo, husband/wife on same household line), the activity goes to whichever has the most recent activity timestamp; a comment is appended `[Multi-match: also could be P011]` so Filippo can re-assign manually via the activity-edit UI (F6).

---

#### Outbound message path

```
Oskar UI "Send WhatsApp" button (replaces F13's wa.me icon for connected accounts)
  → opens a small compose dialog inside the expanded card:
      Recipient (read-only): +41 76 234 56 78
      Message: <textarea, pre-filled with F13's draft template>
      [ Send ]   [ Cancel ]
  → on Send: POST localhost:3000/api/admin/crm/activities/wa-outbound
      { prospect_id, body }
  → Oskar's endpoint POSTs to bridge: http://127.0.0.1:7001/send
      { phone, body }
  → Bridge: sock.sendMessage(jid, { text: body })
            await ack → returns wa_message_id
  → Oskar writes `WhatsApp Out` activity row { prospect_id, body, wa_message_id, status: 'sent' }
  → As receipts arrive (delivered, read), bridge POSTs status updates → activity row's status field updates → UI shows ✓/✓✓/✓✓ blue accordingly
```

**Fallback:** if the bridge isn't connected, the "Send WhatsApp" button gracefully degrades to the F13 `wa.me` launcher. Filippo always has a working path. UI surfaces a small warning chip `bridge disconnected — using wa.me fallback` when applicable.

---

#### Schema additions

`lib/crm-store.ts`:
- `Activity` interface gets two optional fields: `wa_message_id?: string` and `wa_status?: 'sent' | 'delivered' | 'read' | 'failed'`
- Activities sheet gets two new columns
- `normalizeWhatsAppNumber(phone): string | null` exported (mirrors admin.html's `crmWhatsAppNumber`)

`docs/crm-feature/generate-seed.mjs`:
- Activity header gets two new columns (no seed data needed — both empty by default)

`public/_whatsapp/` directory:
- Add to `.gitignore`
- Bridge owns it entirely; Next.js never writes here directly

---

#### Files touched

**New:**
- `oskar-wa-bridge.mjs` — Baileys host subprocess (~250 LOC)
- `app/api/admin/crm/activities/wa-inbound/route.ts` — inbound endpoint
- `app/api/admin/crm/activities/wa-outbound/route.ts` — outbound endpoint
- `app/api/admin/whatsapp/status/route.ts` — discriminated-union health endpoint:
  ```ts
  type Status =
    | { status: 'not-installed' }
    | { status: 'installed-not-running'; version: string }
    | { status: 'installed-not-paired'; version: string }
    | { status: 'pairing';               version: string; qr: string /* dataURL */ }
    | { status: 'connected';             version: string; phone: string; deviceId: string;
                                         linkedSince: string; lastActivityAt: string;
                                         inboundToday: number; outboundToday: number }
    | { status: 'error';                 version: string; reason: string; logs: string[] }
  ```
  `version` is sourced once per poll from `node_modules/@whiskeysockets/baileys/package.json`. UI shows it as a `Baileys X.Y.Z` line in every state except `not-installed`.
- `app/api/admin/whatsapp/pair/route.ts` — POST to trigger QR generation, GET to poll for pair completion
- `app/api/admin/whatsapp/disconnect/route.ts` — POST to logout + clear creds

**Modified:**
- `public/admin.html` — Settings → COL 2 split (Agents top, WhatsApp bottom); WhatsApp card render + state transitions; QR poller; F13's wa.me icon adds graceful upgrade to "Send via Oskar" when bridge is connected
- `components/admin/CrmLeadPanel.tsx` — same graceful upgrade for the BRIEF/STUDIO subtab WhatsApp icon
- `lib/crm-store.ts` — Activity schema additions, `normalizeWhatsAppNumber` export
- `docs/crm-feature/generate-seed.mjs` — activity column additions
- `package.json` — `@whiskeysockets/baileys`, `qrcode-terminal`, `pino` deps
- `.gitignore` — `public/_whatsapp/`

---

#### Risk mitigations

| Risk | Mitigation |
|---|---|
| Personal WhatsApp ban | Rare at personal volume. Filippo decides which number to pair. |
| Library breaks when WhatsApp updates protocol | Pin Baileys version; `npm outdated` weekly; surface `bridge: outdated` status when current version is > 30 days old |
| Bridge crash mid-session | PM2 / launchd / Task Scheduler auto-restart. Status badge in UI shows `bridge: restarting` |
| Duplicate message rows | LRU of recent `wa_message_id`s on the inbound endpoint |
| Unmatched inbound (number not in CRM) | Stash in `public/_whatsapp/unmatched.jsonl` for now; UI Inbox view is deferred WP |
| Lost activity write during ack-pending crash | Bridge persists pending sends to `public/_whatsapp/outbox.jsonl`; on restart, retries pending and reconciles with sent receipts |
| Detection-triggered disconnect | Auto-reconnect with exponential backoff (1s, 2s, 4s, ..., max 5min). Surface as `bridge: reconnecting` |
| Send-too-fast spam flag | Outbound rate limiter in bridge: ≤ 1 message / 2 seconds. Configurable. Per the F13 doc, Filippo's volume is well under any real threshold but this hardcodes safety. |

---

#### Time estimate

~6.5h total:

- ~20m: status endpoint with the 6-state detection ladder (`not-installed` / `installed-not-running` / `installed-not-paired` / `pairing` / `connected` / `error`) — including `require.resolve` for Baileys + bridge health-ping + version read from `node_modules/@whiskeysockets/baileys/package.json`
- ~30m: scaffold `oskar-wa-bridge.mjs` + Baileys boilerplate + auth-state persistence
- ~45m: QR pair flow (bridge generates QR → polled by Oskar status endpoint → Oskar shows in UI)
- ~45m: inbound message handler + dedup + phone matching + activity append
- ~45m: outbound endpoint + receipt status updates
- ~45m: Media download + storage for inbound images/audio
- ~60m: Settings UI card — **all 6 states** + transitions + status counters + version footer
- ~30m: Install-step content for State 1 only (mac + Windows tabs); autostart generators (plist + Task XML templates) wired to download links
- ~30m: Reconnect logic + disconnect-reason handling
- ~30m: End-to-end smoke test (pair, send Filippo→test number, send test→Filippo, verify activity rows appear)

---

#### Verification checklist

1. Fresh checkout, no `node_modules/@whiskeysockets/baileys` → Settings → WhatsApp shows **State 1 `not-installed`** with install steps + OS tabs. NO version line. NO QR button.
2. Run `npm install @whiskeysockets/baileys qrcode-terminal pino`, do NOT start the bridge → reload → shows **State 2 `installed-not-running`** with start command + version line ("Baileys 6.7.18")
3. Run `node oskar-wa-bridge.mjs` → status poll detects bridge alive, no creds → **State 3 `installed-not-paired`** with Generate QR button + version line
4. Click `Generate QR` → **State 4 `pairing`** with QR image + version line, scan from the paired phone → **State 5 `connected`** within 5s
5. Card in State 5 displays phone number, device id, linked-since, last-activity, inbound/outbound today counts, and version line at the bottom
6. Send WhatsApp from another phone to the paired number → Oskar's `oskar-wa-bridge` logs the inbound; if the sender's number is in a prospect → `WhatsApp In` row appears in that prospect's history
7. Click "Send WhatsApp" on Bar Olimpia card → text field + Send → message arrives on Bar Olimpia's phone within 3s → `WhatsApp Out` row appears with status `sent`; updates to `delivered` then `read` as receipts arrive
8. Kill the bridge process → Oskar Settings shows **State 2 `installed-not-running`** within 10s (NOT back to State 1 — package is still installed); F13 wa.me fallback still works
9. Restart bridge → reconnects to WhatsApp using cached creds (no QR re-scan) → state returns to `connected`
10. WhatsApp on the paired phone → Settings → Linked Devices → Oskar entry visible with platform string "Oskar CRM"
11. From the paired phone, unlink the device → Oskar surfaces **State 6 `error: loggedOut`** with `Re-pair` button + version line still visible
12. Delete `node_modules/@whiskeysockets/baileys` while bridge isn't running → status poll detects missing package → Oskar transitions back to **State 1 `not-installed`**, install steps re-appear

---

#### Decisions (locked, not open)

1. **Which number to pair** — Filippo's call at pair time. No gating, no warnings.
2. **F13's `wa.me` icon when bridge is connected** — both icons stay. The new "Send via Oskar" button sends through the bridge (logged automatically). The existing `wa.me` icon launches WhatsApp Web for ad-hoc messaging (still useful when Filippo wants to send media, attach a file, or just doesn't want it logged). Filippo picks per click.
3. **Unmatched inbound** (someone messages the paired number who isn't in the CRM) — append to `public/_whatsapp/unmatched.jsonl` (one JSON object per line: `{ phone, body, mediaPath, timestamp, wa_message_id }`). No UI for it in v1. If volume of unmatched messages becomes painful, a follow-up WP adds a "WhatsApp Inbox" view. Until then, the file is the audit trail.

---

#### Out of scope reminders

- This WP does NOT replace F13. F13's `wa.me` icon stays. F19 adds a parallel logged path. Filippo can use either; they coexist.
- This WP does NOT integrate WhatsApp Business Cloud API. We are NOT a verified Meta business. We are a linked device.
- This WP does NOT support multiple linked accounts. One bridge, one paired number.

---

<a name="6a-group-b"></a>
## 6a. Group B — local foundation for multi-machine sync (F20–F25)

**Status (Ralph 2026-05-25):** Planning locked. Six work packages that retire the xlsx-as-database model and replace it with per-machine SQLite + append-only event log + content-hashed media. **No server dependency.** Each machine independently runs OskarOS on this foundation; the daily hub-and-spoke sync that connects the three machines is the server-dependent companion work, captured in **`docs/Feature-X.md` §15 as WP-104..108** (do NOT collapse F20–F25 into Feature-X — they're disjoint surfaces with disjoint blast radii).

### Why this exists

The current xlsx-as-database model breaks at the next-scale workload (10k+ scraped prospects, hundreds of inbound WhatsApp/day, three writers across machines). Specifically:

- `readSheet()` parses the full xlsx on every call (~5–10 MB at 10k rows ≈ 300–800 ms parse).
- Every mutation rewrites the entire file (~1–2 s per write). A scraper bulk-inserting 10k rows one-at-a-time = literal hours, fully serialized.
- Two writers on a single xlsx = corruption on the first overlapping write.
- `appendActivity` dedup is O(activity-count) — 200+ ms per inbound at 100k activities.
- WhatsApp credentials at `public/_whatsapp/auth/creds.json` are statically served at HTTPS URLs (security bomb).

F20–F25 collectively close all of these. After Group B lands, each machine has: SQLite as the indexed projection, append-only events.jsonl as truth, content-hashed media outside `public/`, WhatsApp protocol state outside `public/`, and an Import/Export xlsx button as a permanent manual fallback.

### Locked architectural decisions (do not re-litigate)

These are mirrored in `Feature-X.md` §15 `[SYNC-*]` for the multi-machine sync layer. Restated here for completeness:

- **Database:** SQLite via `better-sqlite3`. Per-machine local DB at `db/crm.db`, WAL mode.
- **Event log:** Append-only `db/events/events-<thismachine>.jsonl`. Locked envelope shape (see `Feature-X.md` `[SYNC-C]`) with `schema_version: 1`, ULID `id`, separate `ts` (event creation, always known) and `payload.historical_created_at` (prospect's birth time, may be NULL).
- **Write order:** log first, SQLite second. If SQLite write fails, log a warning and return success; next boot's replay re-derives the row. This makes the system self-healing across single-step failures.
- **Durability:** every append calls `fsync`. Multi-process safety via `proper-lockfile`. Events stay <4 KB (Linux O_APPEND effectively atomic at that size).
- **Lamport:** in-memory counter, rehydrated at boot from `MAX(lamport)` across all log files. No separate persistence file.
- **Media:** content-hashed (`<sha256>.<ext>`), flat `media/` directory at the project root. WhatsApp media + everything else in the same store.
- **Directory layout:** everything under the `oskar-prototype/` project root. `db/` and `media/` are siblings at the root, both gitignored.

---

<a name="wp-crm-f20"></a>
### WP-CRM-F20 — Move WhatsApp state + content-hash media + auth-gated media route (~55m)

**Problem.** Three coupled defects of the current `public/_whatsapp/` layout:

1. **Security.** `public/_whatsapp/auth/creds.json` is statically served by Next.js at `https://<host>/_whatsapp/auth/creds.json`. Anyone who can reach the dev server can extract live WhatsApp session keys → full account impersonation. Same for `public/_whatsapp/messages/` (decrypted envelopes) and `public/_whatsapp/unmatched.jsonl` (PII of every stranger who messaged the paired number).
2. **Filename collisions on dedup.** Media files are saved as `public/_whatsapp/media/<date>/<wa_message_id>.<ext>`. Two prospects sending the same image → two files, two database rows pointing at different paths. No deduplication.
3. **Public URLs leak data.** Any media file is at `https://<host>/_whatsapp/media/<date>/<id>.<ext>` — guessable enough that someone with a date + message ID can fetch it without auth.

**Architectural decision (Ralph 2026-05-25).**

- WhatsApp state moves from `public/_whatsapp/*` to `db/whatsapp/*` (outside any statically-served path).
- Media moves from `public/_whatsapp/media/<date>/<id>.<ext>` to a flat content-hashed layout at `media/<sha256>.<ext>` (sibling of `db/` at the project root, NOT under `db/`).
- A new auth-gated API route serves media to authenticated UI requests: `GET /api/admin/media/[hash]` reads from `media/<hash>.<ext>`, sets Content-Type from mime metadata stored on the activity row (the only place mime survives after migration), enforces admin auth via the same gate the rest of `/api/admin/*` uses.
- Migration script `scripts/migrate-media-to-content-hash.ts` walks `public/_whatsapp/media/<date>/`, computes SHA256 of each file's bytes, writes via `safeWriteMediaMigration` (which **byte-compares** when the destination exists to catch hash-wiring bugs strictly during migration). Writes a manifest `(old_path → new_hash)` then rewrites every `activity.media_path` in the xlsx (transitional — replaced by SQLite in F22).
- `.gitignore` grows entries for `db/` and `media/`.

**Scope.**

- **CREATE `lib/media-store.ts`** (~80 LOC). Exports two functions:
  - `safeWriteMediaMigration(hash, ext, sourceBytes)` — byte-compare on existence; strict mode for the one-shot migration.
  - `safeWriteMediaRuntime(hash, ext, sourceBytes)` — size-compare on existence; honest comment that this catches hash-wiring bugs, NOT crypto collisions; used by `wa-runtime.ts` for inbound media downloads.
- **CREATE `app/api/admin/media/[hash]/route.ts`** (~60 LOC). GET-only. Validates admin auth, looks up the file extension from the activity row's `media_mime`, streams the bytes from `media/<hash>.<ext>`. Returns 404 if no row references this hash (orphan prevention).
- **CREATE `scripts/migrate-media-to-content-hash.ts`** (~120 LOC):
  - Walks `public/_whatsapp/media/<date>/`. For each file: compute SHA256, write to `media/<hash>.<ext>` via `safeWriteMediaMigration`, record `(old_path, new_hash, new_mime)` in a manifest.
  - After migration, opens `public/_crm/prospects.xlsx`, rewrites every Activities row's `media_path` from the old form to the new `/api/admin/media/<hash>` URL.
  - Deletes the old `public/_whatsapp/media/` directory only after the manifest write + xlsx rewrite both succeed (atomic-ish — if either fails, the old dir is still there for retry).
- **CREATE `scripts/migrate-whatsapp-state.ts`** (~40 LOC) — moves `public/_whatsapp/auth/`, `public/_whatsapp/messages/`, `public/_whatsapp/unmatched.jsonl` to `db/whatsapp/auth/`, `db/whatsapp/messages/`, `db/whatsapp/unmatched.jsonl`. `fs.rename` for each. Idempotent.
- **MODIFY `lib/wa-runtime.ts`** (~30 LOC delta):
  - Replace path constants `AUTH_DIR`, `MEDIA_DIR`, `MESSAGES_DIR` with their `db/whatsapp/*` and `media/*` equivalents.
  - `maybeDownloadMedia` now writes to `media/<sha256>.<ext>` via `safeWriteMediaRuntime`. Computes the hash via `crypto.createHash('sha256').update(buf).digest('hex')`.
  - `appendActivity` payload's `media_path` field is set to `/api/admin/media/<hash>` (the URL the UI will fetch).
- **MODIFY `lib/wa-routing.mjs`** — no behavior change, but verify the `media_path` field is forwarded through unchanged.
- **MODIFY `public/admin.html`** (~20 LOC delta) — wa-rendering code currently uses `media_path` as a direct URL. Already works because the URL becomes `/api/admin/media/<hash>` post-migration; just verify the auth cookie is sent on `<img src>` / `<audio src>` requests (it is by default same-origin).
- **MODIFY `.gitignore`** — add `db/` and `media/`.
- **DELETE `public/_whatsapp/`** — only after migration succeeds end-to-end; manual `git rm -r` after verification.

**Files affected.**

| File | Change | LOC |
|---|---|---|
| `lib/media-store.ts` | NEW | ~80 |
| `app/api/admin/media/[hash]/route.ts` | NEW | ~60 |
| `scripts/migrate-media-to-content-hash.ts` | NEW | ~120 |
| `scripts/migrate-whatsapp-state.ts` | NEW | ~40 |
| `lib/wa-runtime.ts` | path constants + safeWriteMediaRuntime hookup | ~30 delta |
| `.gitignore` | +`db/`, +`media/` | 2 |
| `public/_whatsapp/*` | DELETE after migration succeeds | — |

**Dependencies.** None — F20 is the first WP and is independent of every other WP in Group B.

**Risk.** Medium. The migration touches live data (existing media files + xlsx references). Failure modes:
- Hash-wiring bug → caught by `safeWriteMediaMigration`'s byte-compare. Aborts the migration cleanly.
- xlsx rewrite fails partway → the old `public/_whatsapp/media/` is still present (we delete it last). Re-run is safe.
- Auth route bug → media can't be served. Fix the route; data is intact.

**Acceptance criteria.**
- `curl https://<host>/_whatsapp/auth/creds.json` returns 404 (was 200 before).
- `curl https://<host>/_whatsapp/media/2026-05-22/abc.jpg` returns 404 (was 200 before).
- `curl -b admin_cookie https://<host>/api/admin/media/<sha256>` returns 200 + correct Content-Type.
- Every activity row in xlsx has `media_path` updated to the new `/api/admin/media/<hash>` form.
- `media/` contains exactly one file per unique hash; identical-content originals are dedup'd to one file.
- Bridge can still receive new WhatsApp media and writes them to `media/<hash>.<ext>` correctly.

**LOC estimate.** ~350 LOC total.

---

<a name="wp-crm-f21"></a>
### WP-CRM-F21 — Schema DDL + event envelope locked (~30m, design only)

**Problem.** Before any code lands, the SQL DDL for the four tables (`prospects`, `activities`, `raw_prospects`, `merge_conflicts`) and the event envelope shape need to be locked on paper. Otherwise F22 and F23 invent schemas that don't survive contact with the scraper (F-future) or the sync layer (Feature-X WP-104..108).

**Architectural decision (Ralph 2026-05-25).** SQL DDL written down in this section (not yet code). Event envelope shape locked in `Feature-X.md` `[SYNC-C]`. Both treated as immutable from F22 onward — schema changes after that point require a `schema_version` bump on the event envelope and a corresponding migration script.

**Scope.**

This WP produces no code. It produces three locked artifacts:

#### F21.A — SQL DDL

```sql
-- ─── prospects ────────────────────────────────────────────────────────
-- The CRM's primary entity. Mutable; field-level LWW during sync (Feature-X
-- WP-106). Per-field tracking columns (`*_last_event_lamport`,
-- `*_last_event_node`) added by Feature-X WP-106, not here — only the
-- baseline columns are F21's scope.
CREATE TABLE prospects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  company         TEXT,
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  status          TEXT NOT NULL DEFAULT 'Active',  -- 'Active'|'Won'|'Lost'|'Stale'|'On hold'
  stage           TEXT NOT NULL,                    -- 'Incoming'|'Contacted'|'Demo done'|'Closing'
  sub_stage       TEXT,                             -- free-form within a stage (F8)
  notes           TEXT,
  owner           TEXT,                             -- 'filippo' | 'ralph'
  source          TEXT,                             -- 'cold' | 'inbound' | 'referral' | etc
  deal_value_chf  INTEGER,                          -- in cents to avoid float precision
  weighted_pct    INTEGER,                          -- 0-100
  next_action     TEXT,
  next_action_date TEXT,                            -- ISO 8601 or NULL
  created_at      TEXT,                             -- ISO 8601 or NULL when unknown
                                                    --   (F24 tier-3 case: never lies via sentinel)
  closed_at       TEXT,                             -- ISO 8601 or NULL
  closed_reason   TEXT,
  loss_reason     TEXT,
  prospect_score  INTEGER,                          -- 0-100 from scraper, NULL when human-entered
  last_activity_ts TEXT                             -- denormalized for ORDER BY perf;
                                                    --   updated by activity inserts (trigger or
                                                    --   reducer-side; F22 picks)
);
CREATE INDEX idx_prospects_phone ON prospects(phone);
CREATE INDEX idx_prospects_stage_status ON prospects(stage, status);
CREATE INDEX idx_prospects_owner ON prospects(owner);
CREATE INDEX idx_prospects_next_action_date ON prospects(next_action_date) WHERE next_action_date IS NOT NULL;

-- ─── activities ───────────────────────────────────────────────────────
-- Append-only timeline. Per [SYNC-C] activities never conflict during sync
-- (each machine's events get unioned and sorted). Edits and deletes are
-- modeled as additional superseding events, not in-place row updates.
CREATE TABLE activities (
  id              TEXT PRIMARY KEY,
  prospect_id     TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  timestamp       TEXT NOT NULL,                    -- ISO 8601, the activity's actual time
                                                    --   (e.g. when the call happened or the
                                                    --    WhatsApp arrived), NOT event-creation time
  type            TEXT NOT NULL,                    -- 'Call'|'WhatsApp In'|'WhatsApp Out'|'E-mail Out'|...
  icon            TEXT,
  color           TEXT,
  duration_min    INTEGER,
  notes           TEXT,
  session_id      TEXT,                             -- link to Director Mode session if any
  user_id         TEXT,                             -- who logged it ('filippo' / 'ralph' / 'system')
  subject         TEXT,                             -- for email-type rows
  wa_message_id   TEXT,                             -- for WhatsApp rows; dedup key
  wa_status       TEXT,                             -- ''|'sent'|'delivered'|'read'|'failed'
  media_path      TEXT,                             -- '/api/admin/media/<sha256>' URL
  media_mime      TEXT,                             -- content-type for the auth-gated route
  soft_deleted    INTEGER NOT NULL DEFAULT 0        -- 0|1; superseding 'delete' events flip this
);
CREATE INDEX idx_activities_prospect_id_timestamp ON activities(prospect_id, timestamp DESC);
CREATE INDEX idx_activities_wa_message_id ON activities(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX idx_activities_type ON activities(type);

-- ─── raw_prospects ────────────────────────────────────────────────────
-- Scraper-owned write-heavy table. Scraper inserts here; humans never edit
-- these. A separate "promote_to_prospect" step (UI button at first; scored
-- auto-promotion later) graduates a raw_prospect to the main prospects
-- table. Single-writer (scraper) so no conflict surface during sync.
CREATE TABLE raw_prospects (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,                    -- scraper source identifier
  scraped_at      TEXT NOT NULL,                    -- ISO 8601
  raw_payload     TEXT NOT NULL,                    -- JSON blob from scraper
  -- denormalized fields for cheap filtering before promotion
  name            TEXT,
  company         TEXT,
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  country         TEXT,
  industry        TEXT,
  -- promotion state
  promoted_at     TEXT,                             -- NULL until promoted
  promoted_to     TEXT REFERENCES prospects(id),    -- NULL until promoted
  rejected_at     TEXT,                             -- NULL unless explicitly rejected
  rejected_reason TEXT
);
CREATE INDEX idx_raw_prospects_source_scraped_at ON raw_prospects(source, scraped_at DESC);
CREATE INDEX idx_raw_prospects_phone ON raw_prospects(phone);
CREATE INDEX idx_raw_prospects_unpromoted ON raw_prospects(scraped_at) WHERE promoted_at IS NULL AND rejected_at IS NULL;

-- ─── merge_conflicts (populated by Feature-X WP-106) ──────────────────
-- Defined here for completeness; first populated only when sync runs.
CREATE TABLE merge_conflicts (
  id              TEXT PRIMARY KEY,
  detected_ts     TEXT NOT NULL,
  entity          TEXT NOT NULL,                    -- 'prospect' (only entity with LWW today)
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
  loser_event_id  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'unreviewed', -- 'unreviewed'|'accepted-winner'|'overridden-to-loser'
  reviewed_ts     TEXT,
  reviewed_by     TEXT
);
CREATE INDEX idx_merge_conflicts_status_detected ON merge_conflicts(status, detected_ts DESC);

-- ─── events_seen (replay cursor + lamport rehydration) ────────────────
-- Tiny housekeeping table. Holds the highest (lamport, id) seen during the
-- last replay so subsequent boots can skip already-applied events instead
-- of re-replaying from scratch. NOT the source of truth — the JSONL files
-- are. Deleting this table forces a full replay on next boot.
CREATE TABLE events_seen (
  node            TEXT PRIMARY KEY,                  -- 'ralph-mac', 'filippo-mac', 'server'
  highest_lamport INTEGER NOT NULL,
  highest_event_id TEXT NOT NULL,
  applied_at      TEXT NOT NULL
);
```

#### F21.B — Event envelope (mirrored from Feature-X `[SYNC-C]`)

See `docs/Feature-X.md` §15 `[SYNC-C]` for the canonical definition. Pinned here so changes are tracked in both docs:

```ts
interface Event {
  schema_version: 1
  id: string                         // 'evt_<ulid>'
  ts: string                         // ISO 8601, event creation time (always known)
  lamport: number
  node: string                       // 'ralph-mac' | 'filippo-mac' | 'server'
  actor: string
  entity: 'prospect' | 'activity' | 'raw_prospect' | 'merge_conflict'
  entity_id: string
  op: 'insert' | 'update' | 'delete' | 'soft_delete'
  field?: string                     // present iff op === 'update'
  prev?: unknown
  next?: unknown
  payload?: Record<string, unknown>  // includes historical_created_at (string|null) for prospects
  source: 'live' | 'backfill' | 'sync' | 'manual_import'
}
```

Events stay <4 KB by convention. `appendEvent` asserts on serialize. The convention is enforced by writing notes >2 KB to a separate `large_notes/<id>.txt` file with the event payload carrying only the path — but no actual event today comes close to 4 KB so this is documented contingency, not built code.

#### F21.C — Durability + concurrency model

The properties `lib/event-log.ts` must guarantee, locked here:

1. **Atomicity of single append.** Open file with `O_APPEND`, single `writeSync` call. On Linux, atomic in practice for ≤ ~4 KB writes.
2. **Durability.** `fsyncSync` before close. Returns only when bytes are on disk.
3. **Multi-process safety.** `proper-lockfile` lock around the entire open-write-fsync-close sequence. Lock retries: 5 attempts with 50ms minTimeout (≤250ms worst-case wait when two processes contend).
4. **Truncated-line tolerance.** Replay reads JSONL line-by-line; on a malformed terminal line (typically a partial write from a process kill mid-append), logs a warning and skips. Earlier lines are always intact (per atomicity).

**Files affected.** None — design artifact only. The DDL ends up in F22's migration code; the envelope ends up in F22's `lib/event-log.ts`; the durability properties ends up in F22's implementation comments + F23's tests.

**Dependencies.** None.

**Risk.** Low. Design-only.

**Acceptance criteria.** All three artifacts (DDL, envelope shape, durability model) reviewed and locked before F22 starts coding. Schema changes after F21 ships require a `schema_version` bump.

**LOC estimate.** 0 code; the DDL/envelope spec lives in this section, ~150 LOC of structured text.

---

<a name="wp-crm-f22"></a>
### WP-CRM-F22 — Port `lib/crm-store.ts` to SQLite + events.jsonl (~95m)

**Problem.** Replace the xlsx-as-database write path. Every read becomes a SQL query against an indexed local file; every write becomes (event-append, then SQLite update). The `crm-store.ts` TypeScript surface stays mostly the same so callers (`wa-runtime.ts`, `wa-inbound-dispatch.ts`, all the API routes) don't have to change.

**Architectural decision (Ralph 2026-05-25).**

- **`better-sqlite3`** for SQLite access. Synchronous API — correct for in-process file DB where each query is microseconds. Open one connection at boot, pin to `globalThis` (HMR-safe).
- **`lib/event-log.ts`** is the single append point for the JSONL. Open file with `O_APPEND` + write + fsync + close, wrapped in `proper-lockfile`. **Async** because of the lockfile.
- **Write order: log first, SQLite second.** Per `[SYNC-L]`. If SQLite write fails, log a warning, return success — replay rebuilds.
- **All `crm-store.ts` write functions become `async`** (because `appendEvent` is async). Callers `await` them. The current `appendActivity` already is async; `updateActivity`, `updateMediaByMessageId`, etc. all flip.
- **Read functions stay sync** (they only touch SQLite, no event log writes).
- **No migrations table in v1.** Schema is checked at boot — if the four tables don't exist, run the F21 DDL. If they exist with wrong shape (schema drift between branches in dev), throw loudly. Future migrations get a proper migrations table when the first real one ships.

**Scope.**

#### F22.A — New file: `lib/event-log.ts`

```ts
// lib/event-log.ts — single append point for the per-machine event log
//
// Properties guaranteed (see WP-CRM-F21.C):
//   1. Atomic single-line append (Linux O_APPEND, events <4 KB).
//   2. Durable: fsync before close.
//   3. Multi-process-safe: proper-lockfile around open-write-fsync-close.
//   4. Truncated-line tolerant on replay.
//
// Used by both lib/crm-store.ts (live writes) and scripts/backfill-from-xlsx.ts
// (one-shot backfill) so there's exactly one code path that touches the log.

import { openSync, writeSync, fsyncSync, closeSync } from 'fs'
import { join } from 'path'
import * as lockfile from 'proper-lockfile'

const EVENTS_DIR = join(process.cwd(), 'db', 'events')
const NODE_ID = process.env.OSKAR_NODE_ID || 'unknown'
const LOG_PATH = join(EVENTS_DIR, `events-${NODE_ID}.jsonl`)

export interface Event {
  schema_version: 1
  id: string                         // 'evt_<ulid>'
  ts: string
  lamport: number
  node: string
  actor: string
  entity: 'prospect' | 'activity' | 'raw_prospect' | 'merge_conflict'
  entity_id: string
  op: 'insert' | 'update' | 'delete' | 'soft_delete'
  field?: string
  prev?: unknown
  next?: unknown
  payload?: Record<string, unknown>
  source: 'live' | 'backfill' | 'sync' | 'manual_import'
}

function assertEnvelopeShape(event: Event): void {
  if (event.schema_version !== 1) throw new Error(`invalid schema_version: ${event.schema_version}`)
  if (!event.id?.startsWith('evt_')) throw new Error(`invalid id: ${event.id}`)
  if (!event.ts) throw new Error('event.ts required')
  if (typeof event.lamport !== 'number') throw new Error('event.lamport required')
  if (!event.node) throw new Error('event.node required')
  if (!event.entity || !event.entity_id || !event.op) throw new Error('entity/entity_id/op required')
}

export async function appendEvent(event: Event): Promise<void> {
  assertEnvelopeShape(event)
  const line = JSON.stringify(event) + '\n'
  if (Buffer.byteLength(line) > 4096) {
    throw new Error(`event ${event.id} exceeds 4 KB (${Buffer.byteLength(line)} bytes); split or store large payload as a separate file`)
  }
  const release = await lockfile.lock(LOG_PATH, { retries: { retries: 5, minTimeout: 50 } })
  try {
    const fd = openSync(LOG_PATH, 'a')
    try {
      writeSync(fd, line)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } finally {
    await release()
  }
}

// Lamport counter — in-memory, rehydrated from MAX(lamport) at boot.
let _lamport = 0
export function nextLamport(): number {
  return ++_lamport
}
export function bumpLamport(received: number): void {
  _lamport = Math.max(_lamport, received) + 1
}
export function setLamportFromReplay(maxSeen: number): void {
  _lamport = maxSeen
}
```

#### F22.B — Modified: `lib/crm-store.ts`

Replace the xlsx-backed `readSheet`, `appendActivity`, `updateActivity`, `updateWaStatusByMessageId`, `updateMediaByMessageId`, `removeActivity`, `removeProspect`, and the rest of the existing surface. Each function:

1. **Reads** via `better-sqlite3` prepared statements against the projection.
2. **Writes** via the (event-append-first, SQLite-second) pattern from `[SYNC-L]`:

```ts
import Database from 'better-sqlite3'
import { ulid } from 'ulid'
import { appendEvent, nextLamport, Event } from './event-log'

const db: Database.Database = (() => {
  const existing = (globalThis as { __crmDb?: Database.Database }).__crmDb
  if (existing) return existing
  const path = join(process.cwd(), 'db', 'crm.db')
  const fresh = new Database(path)
  fresh.pragma('journal_mode = WAL')
  ;(globalThis as { __crmDb?: Database.Database }).__crmDb = fresh
  ensureSchema(fresh)
  return fresh
})()

export async function appendActivity(input: { ... }): Promise<Activity> {
  const id = `act_${ulid()}`
  const event: Event = {
    schema_version: 1,
    id: `evt_${ulid()}`,
    ts: new Date().toISOString(),
    lamport: nextLamport(),
    node: process.env.OSKAR_NODE_ID || 'unknown',
    actor: input.user_id || 'system',
    entity: 'activity',
    entity_id: id,
    op: 'insert',
    payload: { ...input, id },
    source: 'live',
  }
  // STEP 1: log first (truth).
  await appendEvent(event)
  // STEP 2: SQLite (cache). On failure, log warning and return success;
  // boot replay re-derives.
  try {
    db.prepare(`INSERT INTO activities (id, prospect_id, ...) VALUES (?, ?, ...)`)
      .run(id, input.prospect_id, ...)
  } catch (err) {
    console.warn('[crm-store] SQLite write failed; will recover on next boot replay:', err)
  }
  return { id, ...input }
}
// ... same pattern for every other write function ...
```

#### F22.C — Modified: every caller that writes via `crm-store.ts`

- `lib/wa-runtime.ts` — `updateWaStatusByMessageId`, calls to `appendActivity`, all become awaited (most already are).
- `lib/wa-inbound-dispatch.ts` — awaits `appendActivity` (already async there).
- `app/api/admin/crm/activities/*/route.ts` (the existing API routes that wrap crm-store) — each route handler awaits the relevant store function. Most already do.

#### F22.D — Boot wiring (instrumentation hook)

`instrumentation.ts` already calls `getRuntime().boot()` for WhatsApp. Add a sibling call to a new `lib/crm-boot.ts` that:

1. Opens the SQLite connection (the singleton above).
2. Runs `ensureSchema` (creates tables if absent; verifies if present).
3. Calls `lib/crm-replay.ts` (defined in F23) to bring the projection up to date from the event log.
4. Initializes the lamport counter via `setLamportFromReplay`.

**Files affected.**

| File | Change | LOC |
|---|---|---|
| `lib/event-log.ts` | NEW | ~120 |
| `lib/crm-store.ts` | rewrite (was xlsx-backed) | ~500 (rewrite) |
| `lib/crm-boot.ts` | NEW | ~60 |
| `instrumentation.ts` | + crm-boot call | ~5 delta |
| `lib/wa-runtime.ts` | await stays correct | ~5 delta |
| `lib/wa-inbound-dispatch.ts` | await stays correct | ~3 delta |
| `package.json` | + `better-sqlite3`, `ulid`, `proper-lockfile` deps | 3 |

**Dependencies.** F20 (gitignore + dir layout), F21 (DDL + envelope shape).

**Risk.** High during the migration window. Mitigations: F22 ships side-by-side with the existing xlsx write path initially (every write goes to BOTH stores) — verified for 24 hours of normal use — then xlsx writes are turned off. The xlsx is renamed to `prospects.xlsx.legacy` at the moment of cutover (preserved as a read-only audit artifact).

**Acceptance criteria.**
- Boot the dev server. Verify `db/crm.db`, `db/crm.db-wal`, `db/events/events-<thismachine>.jsonl` are created on first boot.
- Trigger an inbound WhatsApp message. Verify (a) a new line in events-*.jsonl, (b) a new row in `activities`, (c) the row's `media_path` references a real file in `media/<hash>.<ext>`.
- Kill the dev server mid-write (`SIGKILL`). Restart. Verify no orphaned rows in SQLite — either both event + row exist, or neither does.
- Run two processes that write concurrently (`npm run dev` + `npm run backfill`). Verify no log corruption (every line in events-*.jsonl parses).
- Read paths (`readActivities`, `readSheet`, etc.) return SQLite-backed data, faster than the xlsx baseline (measure with `time curl ...`).

**LOC estimate.** ~700 LOC including the rewrite of `crm-store.ts` (which goes from ~400 lines of xlsx code to ~500 lines of SQL + event-log code).

---

<a name="wp-crm-f23"></a>
### WP-CRM-F23 — Boot-time replay + Lamport rehydration + 4 idempotency tests (~50m)

**Problem.** The architecture's load-bearing invariant is "events are truth, SQLite is a rebuildable projection." Without a replay path AND a test suite that exercises the invariant, the system rests on faith. F23 ships both.

**Architectural decision (Ralph 2026-05-25).**

- **`lib/crm-replay.ts`** is the single source of truth for "given an ordered stream of events, produce the SQLite state." Same code runs at boot AND from the test suite — no separate "test reducer" code path that could drift from production.
- Replay reads all JSONL files in `db/events/` (own + any inbound from sync, F104..108), parses them, sorts by `(lamport, node)`, applies each event in order.
- **Lamport rehydration** at the end of replay: `setLamportFromReplay(max(lamport across all applied events))`. The in-memory counter is now ready for live writes.
- **Idempotent up to `(node, highest_lamport)` cursor.** The `events_seen` table tracks the highest event applied per node. On subsequent boots, replay starts from `events_seen.highest_lamport[node] + 1` instead of from scratch — same final state, but faster boot for large logs.
- **Truncated terminal lines** logged at WARN and skipped. The next valid line continues replay.
- **Four CI-required tests** ship with the WP (see F23.B below).

**Scope.**

#### F23.A — `lib/crm-replay.ts`

```ts
// lib/crm-replay.ts — rebuild SQLite from the event log.
//
// Single code path used by:
//   - Boot (lib/crm-boot.ts) — incremental, from events_seen cursor
//   - Test suite (scripts/__tests__/idempotency.test.ts) — cold, from scratch
//
// Same reducer runs in both modes; only the input event set differs.

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import type { Event } from './event-log'
import { setLamportFromReplay } from './event-log'

const EVENTS_DIR = join(process.cwd(), 'db', 'events')

export interface ReplayResult {
  appliedEventCount: number
  highestLamportPerNode: Record<string, number>
  malformedLineCount: number
}

/**
 * Cold replay: drop SQLite state, rebuild from scratch.
 * Used by the test suite and by manual recovery ("the SQLite file got
 * corrupted, give me a fresh copy from the log").
 */
export function coldReplay(db: Database.Database): ReplayResult {
  truncateProjection(db)
  const events = readAllEvents()
  return applyEventsToDb(db, events)
}

/**
 * Incremental replay: start from events_seen cursors, apply only what's new.
 * Used at boot for fast startup on large logs.
 */
export function incrementalReplay(db: Database.Database): ReplayResult {
  const cursors = readCursors(db)
  const events = readEventsAfterCursors(cursors)
  return applyEventsToDb(db, events)
}

/**
 * Apply a known-ordered event sequence to SQLite. The reducer's job is
 * mechanical: dispatch on (entity, op), call the right INSERT / UPDATE /
 * DELETE. NO derived field computation here — derived fields belong in
 * the live-write code path AND must be re-emitted as events so replay
 * sees them. (This rule is what test 4 enforces.)
 */
export function applyEventsToDb(
  db: Database.Database,
  events: Event[],
): ReplayResult {
  // Defensive sort — the reducer's ordering must not depend on input order.
  const sorted = [...events].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport
    return a.node.localeCompare(b.node)
  })

  let applied = 0
  const maxLamportPerNode: Record<string, number> = {}

  const tx = db.transaction(() => {
    for (const event of sorted) {
      try {
        applyOne(db, event)
        applied++
        maxLamportPerNode[event.node] = Math.max(
          maxLamportPerNode[event.node] ?? 0,
          event.lamport,
        )
      } catch (err) {
        console.error(`[crm-replay] event ${event.id} failed:`, err)
        throw err  // abort the whole transaction on any reducer error
      }
    }
  })
  tx()

  // Update cursors
  const cursorStmt = db.prepare(`
    INSERT INTO events_seen (node, highest_lamport, highest_event_id, applied_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(node) DO UPDATE SET
      highest_lamport = excluded.highest_lamport,
      highest_event_id = excluded.highest_event_id,
      applied_at = excluded.applied_at
  `)
  for (const [node, lamport] of Object.entries(maxLamportPerNode)) {
    const last = sorted.filter(e => e.node === node).at(-1)
    if (last) cursorStmt.run(node, lamport, last.id, new Date().toISOString())
  }

  // Set in-memory lamport counter to the highest seen overall.
  const overallMax = Math.max(0, ...Object.values(maxLamportPerNode))
  setLamportFromReplay(overallMax)

  return {
    appliedEventCount: applied,
    highestLamportPerNode: maxLamportPerNode,
    malformedLineCount: 0,  // tracked in readAllEvents instead; merge upstream
  }
}

function applyOne(db: Database.Database, e: Event): void {
  if (e.entity === 'prospect') {
    if (e.op === 'insert') {
      const p = e.payload ?? {}
      db.prepare(`INSERT INTO prospects (...) VALUES (...)`).run(...)
    } else if (e.op === 'update') {
      db.prepare(`UPDATE prospects SET ${e.field} = ? WHERE id = ?`).run(e.next, e.entity_id)
    } else if (e.op === 'delete') {
      db.prepare(`DELETE FROM prospects WHERE id = ?`).run(e.entity_id)
    }
  } else if (e.entity === 'activity') {
    if (e.op === 'insert') {
      db.prepare(`INSERT INTO activities (...) VALUES (...)`).run(...)
    } else if (e.op === 'update') {
      db.prepare(`UPDATE activities SET ${e.field} = ? WHERE id = ?`).run(e.next, e.entity_id)
    } else if (e.op === 'soft_delete') {
      db.prepare(`UPDATE activities SET soft_deleted = 1 WHERE id = ?`).run(e.entity_id)
    }
  } else if (e.entity === 'raw_prospect') {
    // Scraper-owned, single-writer; ops are always 'insert' or 'update' (for promotion).
    if (e.op === 'insert') {
      db.prepare(`INSERT INTO raw_prospects (...) VALUES (...)`).run(...)
    } else if (e.op === 'update') {
      db.prepare(`UPDATE raw_prospects SET ${e.field} = ? WHERE id = ?`).run(e.next, e.entity_id)
    }
  }
}

function readAllEvents(): Event[] {
  if (!existsSync(EVENTS_DIR)) return []
  const events: Event[] = []
  let malformed = 0
  for (const filename of readdirSync(EVENTS_DIR)) {
    if (!filename.startsWith('events-') || !filename.endsWith('.jsonl')) continue
    const raw = readFileSync(join(EVENTS_DIR, filename), 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line) continue
      try {
        events.push(JSON.parse(line) as Event)
      } catch {
        malformed++
        console.warn(`[crm-replay] malformed line in ${filename} (truncated tail?): ${line.slice(0, 80)}…`)
      }
    }
  }
  if (malformed > 0) console.warn(`[crm-replay] skipped ${malformed} malformed line(s) total`)
  return events
}

function truncateProjection(db: Database.Database): void {
  // Truncate in FK-safe order. Leaves schema intact.
  db.exec(`
    DELETE FROM merge_conflicts;
    DELETE FROM activities;
    DELETE FROM raw_prospects;
    DELETE FROM prospects;
    DELETE FROM events_seen;
  `)
}
```

#### F23.B — Idempotency test suite (4 tests, CI-required)

```ts
// scripts/__tests__/idempotency.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { coldReplay, applyEventsToDb } from '@/lib/crm-replay'
import { appendEvent, type Event } from '@/lib/event-log'
import { fixtureEvents10, fixtureEvents10More, snapshotDb } from '@/lib/test-helpers'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  ensureSchema(db)
})

describe('B3+B4 idempotency invariants', () => {
  it('test 1 — replay determinism: same events twice → identical state', () => {
    const events = fixtureEvents10()
    applyEventsToDb(db, events)
    const a = snapshotDb(db)
    truncate(db)
    applyEventsToDb(db, events)
    const b = snapshotDb(db)
    expect(a).toEqual(b)
  })

  it('test 2 — incremental = cold: applying in batches matches replay from scratch', () => {
    const e1 = fixtureEvents10()
    const e2 = fixtureEvents10More()  // includes updates that supersede earlier values

    // Incremental
    applyEventsToDb(db, e1)
    applyEventsToDb(db, e2)
    const incremental = snapshotDb(db)

    // Cold
    truncate(db)
    applyEventsToDb(db, [...e1, ...e2])
    const cold = snapshotDb(db)

    expect(incremental).toEqual(cold)
  })

  it('test 3 — order independence: shuffled input → identical final state', () => {
    const events = fixtureEvents10()
    const shuffled = shuffleDeterministically(events)
    applyEventsToDb(db, events)
    const a = snapshotDb(db)
    truncate(db)
    applyEventsToDb(db, shuffled)
    const b = snapshotDb(db)
    expect(a).toEqual(b)
  })

  it('test 4 — live writes converge to cold replay (LOAD-BEARING)', async () => {
    const events = fixtureEvents10()

    // Live path: simulate B3's pattern. appendEvent first, then SQLite write.
    // The crm-store.ts functions encapsulate this; here we call them directly.
    for (const ev of events) {
      await appendEventThenApplyToDb(ev, db)  // mirrors crm-store.ts write path
    }
    const live = snapshotDb(db)

    // Cold replay path: drop SQLite, read events from JSONL, replay.
    truncate(db)
    const fromLog = readAllEvents()  // reads what live writes appended
    applyEventsToDb(db, fromLog)
    const replayed = snapshotDb(db)

    expect(live).toEqual(replayed)
    // If this test ever fails, the live-write path and the replay path have
    // drifted (e.g. live computes a derived field that replay doesn't, or
    // vice versa). This is the silent-killer bug class.
  })
})
```

#### F23.C — `lib/test-helpers.ts`

`snapshotDb(db)` returns a JSON-serializable representation of every table (rows ordered by primary key) so two `expect().toEqual()` calls compare structurally. `fixtureEvents10()` and `fixtureEvents10More()` hand-construct event sequences with edge cases: insert+update on same entity, soft_delete, two different ts but same lamport (deterministic tiebreaker test), historical_created_at: null path. ~80 LOC.

**Files affected.**

| File | Change | LOC |
|---|---|---|
| `lib/crm-replay.ts` | NEW | ~250 |
| `lib/crm-boot.ts` | + replay call on boot | ~10 delta |
| `lib/test-helpers.ts` | NEW | ~80 |
| `scripts/__tests__/idempotency.test.ts` | NEW | ~200 (4 tests + helpers) |

**Dependencies.** F21 (envelope), F22 (event-log + crm-store + boot wiring).

**Risk.** Medium. The replay reducer is the only code in the system that has to be 100% deterministic across machines. Test 4 catches drift; tests 1–3 catch the narrower reducer bug classes.

**Acceptance criteria.**
- All 4 tests pass before F24 fires.
- Manually break the reducer (e.g. omit `ORDER BY lamport, node` in the sort, or skip handling `op: 'delete'`) — at least one test fails with a clear diff.
- `npm test` runs the suite as part of CI; a failing test blocks merge.
- Boot a fresh dev server. Verify `events_seen` table populates correctly. Restart — verify boot is faster the second time (incremental replay).

**LOC estimate.** ~540 LOC including tests.

---

<a name="wp-crm-f24"></a>
### WP-CRM-F24 — One-shot backfill from `prospects.xlsx` (~25m)

**Problem.** Filippo's and Ralph's existing CRM data lives in `public/_crm/prospects.xlsx`. F24 converts those rows into events appended to the local event log, so the SQLite projection (built by F23's replay) ends up identical to the xlsx baseline at the moment of cutover.

**Architectural decision (Ralph 2026-05-25).**

- One-shot script: `scripts/backfill-from-xlsx.ts`. Run manually (`npm run backfill`). Idempotent in the sense that re-running creates a new timestamped backup, but appending the same events twice is NOT idempotent — the recovery procedure is "stop, clean log, re-run."
- **Timestamped backup at step 0:** `prospects.xlsx` → `prospects.xlsx.pre-backfill.<ISO timestamp>`. Every run preserves its input.
- **Original timestamps preserved.** Activity rows: use the row's existing `timestamp` column directly. Prospect rows: use `created_at` if present in the xlsx; else use tiered fallback for `historical_created_at` in the event payload.
- **Tiered fallback for prospect `historical_created_at`:**
  - **Tier 1.** xlsx has `created_at` for this row → use it directly.
  - **Tier 2.** No column, but prospect has activities → `MIN(activity.timestamp WHERE activity.prospect_id = prospect.id)`.
  - **Tier 3.** No source for historical date → `historical_created_at: null` in the event payload. SQLite `prospects.created_at` ends up NULL — honest about "we don't know" instead of a `1970-01-01` sentinel that pollutes sorts.
- **Event `ts` is always backfill-run time.** Backfill events represent log entries created today, not historical moments. The historical moment lives in `payload.historical_created_at`. The two distinctions matter for audit ("when did this row enter the log?") vs display ("when did this lead enter the system?").
- **`source: 'backfill'`** on every event emitted by this script. Future queries can filter on this.

**Scope.**

#### F24.A — `scripts/backfill-from-xlsx.ts`

```ts
// scripts/backfill-from-xlsx.ts
// One-shot: read public/_crm/prospects.xlsx → append events to local log.
// Run manually: npm run backfill

import { existsSync, copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import XLSX from 'xlsx'
import { ulid } from 'ulid'
import { appendEvent, nextLamport, type Event } from '@/lib/event-log'

const NODE = process.env.OSKAR_NODE_ID || 'unknown'
const ACTOR = 'system'

async function main() {
  const src = join(process.cwd(), 'public', '_crm', 'prospects.xlsx')
  if (!existsSync(src)) throw new Error(`B5: source file not found at ${src}`)

  // Step 0: timestamped backup. Every run preserves its input.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${src}.pre-backfill.${stamp}`
  copyFileSync(src, backup)
  console.log(`[backfill] backed up ${src} → ${backup}`)

  const wb = XLSX.read(readFileSync(src), { type: 'buffer' })
  const prospects = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Prospects'])
  const activities = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Activities'])

  // Index activities by prospect_id once for Tier 2 fallback.
  const earliestActivityTsPerProspect = new Map<string, string>()
  for (const a of activities) {
    const pid = String(a.prospect_id)
    const ts = String(a.timestamp)
    const existing = earliestActivityTsPerProspect.get(pid)
    if (!existing || ts < existing) earliestActivityTsPerProspect.set(pid, ts)
  }

  const xlsxMtime = await import('fs').then(m => m.statSync(src).mtime.toISOString())

  // Emit one event per prospect.
  for (const p of prospects) {
    const id = String(p.id)
    let historicalCreatedAt: string | null = null
    if (p.created_at) historicalCreatedAt = String(p.created_at)
    else if (earliestActivityTsPerProspect.has(id)) historicalCreatedAt = earliestActivityTsPerProspect.get(id)!
    // Tier 3: null — honest about "unknown."

    const event: Event = {
      schema_version: 1,
      id: `evt_${ulid()}`,
      ts: new Date().toISOString(),  // event creation time (backfill run)
      lamport: nextLamport(),
      node: NODE,
      actor: ACTOR,
      entity: 'prospect',
      entity_id: id,
      op: 'insert',
      payload: { ...p, historical_created_at: historicalCreatedAt },
      source: 'backfill',
    }
    await appendEvent(event)
  }

  // Emit one event per activity. timestamps used directly.
  for (const a of activities) {
    const event: Event = {
      schema_version: 1,
      id: `evt_${ulid()}`,
      ts: new Date().toISOString(),
      lamport: nextLamport(),
      node: NODE,
      actor: ACTOR,
      entity: 'activity',
      entity_id: String(a.id),
      op: 'insert',
      payload: { ...a, timestamp: String(a.timestamp) /* preserve original */ },
      source: 'backfill',
    }
    await appendEvent(event)
  }

  console.log(`[backfill] appended ${prospects.length} prospect + ${activities.length} activity events`)
  console.log('[backfill] restart Next.js to trigger boot replay → SQLite populates from log')
}

main().catch(err => {
  console.error('[backfill] FAILED:', err)
  process.exit(1)
})
```

#### F24.B — Recovery procedure (documented)

If backfill produces wrong data (bug in event mapping, missed column, miscoded tier):

```
1. Stop Next.js.
2. Inspect db/events/events-<thismachine>.jsonl. If it contains ONLY events
   with source: 'backfill', delete the file entirely.
   Otherwise: keep only non-backfill lines (grep -v '"source":"backfill"' …).
3. Delete db/crm.db and db/crm.db-wal.
4. cp public/_crm/prospects.xlsx.pre-backfill.<stamp> public/_crm/prospects.xlsx
5. Fix the bug in scripts/backfill-from-xlsx.ts.
6. npm run backfill
7. Restart Next.js. Boot replay rebuilds SQLite from the corrected events.
```

#### F24.C — npm script

```json
"backfill": "tsx scripts/backfill-from-xlsx.ts"
```

**Files affected.**

| File | Change | LOC |
|---|---|---|
| `scripts/backfill-from-xlsx.ts` | NEW | ~120 |
| `package.json` | + `backfill` script, + `xlsx`, `tsx` deps if missing | 2 |
| `docs/WP-CRM-001.md` | this section (you're reading it) | — |

**Dependencies.** F20 (`db/` exists), F21 (envelope), F22 (`lib/event-log.ts`), F23 (replay path will run on next boot to pick up the backfilled events).

**Risk.** Medium. Backfill writes to the canonical event log; getting it wrong corrupts the log. Mitigations: (a) timestamped backup of xlsx at step 0, (b) recovery procedure documented, (c) `source: 'backfill'` tag lets us identify and surgically remove backfilled events.

**Acceptance criteria.**
- Running backfill produces a timestamped backup `.pre-backfill.<stamp>` of the xlsx.
- Re-running backfill produces a second timestamped backup; both backups have identical bytes (original xlsx untouched between runs).
- After backfill + Next.js restart, the SQLite projection has every prospect + activity from the xlsx. Verified by row-count + spot-check on `prospect_id = P021` (Filomax Wolf, has activities + media).
- Prospects with no `created_at` column AND no activities show `created_at IS NULL` in SQLite (not `1970-01-01`).
- An emitted event picked at random parses cleanly and matches the envelope shape from F21.
- The recovery procedure copy-pastes runnable without modification.

**LOC estimate.** ~120 LOC.

---

<a name="wp-crm-f25"></a>
### WP-CRM-F25 — xlsx Import/Export button (permanent fallback) (~50m)

**Problem.** Two coupled needs:

1. **Pre-sync:** Between F24 (one-shot backfill, runs once) and the day the sync layer ships (Feature-X WP-104..108), there's no automated way to move data between machines. Filippo needs to be able to export his SQLite to xlsx and email it to Ralph, who imports it on his side.
2. **Post-sync:** Sync can fail (server down, token expired, network outage). When it does, Filippo needs a manual escape hatch. xlsx Import/Export stays alive as a permanent fallback — not retired when sync goes live.

**Architectural decision (Ralph 2026-05-25).**

- A single Settings → "Import / Export xlsx" panel with two buttons: **Export current state to xlsx** (downloads a file) and **Import xlsx into local DB** (uploads a file, appends events with `source: 'manual_import'`).
- **Export:** reads the current SQLite projection, writes a `prospects.xlsx` matching the original 2-sheet shape (Prospects + Activities). Includes a 3rd sheet `_meta` with the export timestamp, node id, and event-log tail cursor (so an Import knows what the Export was based on).
- **Import:** for each row in the uploaded xlsx, emits a superseding event (`op: 'update'` for existing entities, `op: 'insert'` for new ones — `entity_id` collision detection). Every emitted event carries `source: 'manual_import'`. Boot replay picks them up on next restart, OR a same-session in-process replay (F23's `applyEventsToDb`) applies them immediately.
- **Idempotent across re-imports.** Importing the same xlsx twice produces the same final state. Achieved because import events update each field to the value the xlsx specifies; second import is a no-op against an already-updated row.
- **Conflict handling:** if the import sees a row whose SQLite value is newer than the xlsx value (via per-field tracking columns from Feature-X WP-106), the import event is still appended but logged as "this import overrode a more-recent live edit." This is the safety net for "Filippo imports an old export and accidentally rolls back fresh changes."

**Scope.**

#### F25.A — Backend: `/api/admin/crm/xlsx-export` + `/api/admin/crm/xlsx-import`

```ts
// app/api/admin/crm/xlsx-export/route.ts
export async function GET() {
  const prospects = db.prepare('SELECT * FROM prospects').all()
  const activities = db.prepare('SELECT * FROM activities WHERE soft_deleted = 0').all()
  const meta = {
    exported_at: new Date().toISOString(),
    exported_by_node: process.env.OSKAR_NODE_ID || 'unknown',
    highest_lamport: maxLamportAcrossAllLogs(),
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prospects), 'Prospects')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(activities), 'Activities')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([meta]), '_meta')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="oskar-export-${new Date().toISOString()}.xlsx"`,
    },
  })
}

// app/api/admin/crm/xlsx-import/route.ts
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File
  const buf = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buf, { type: 'buffer' })
  const prospects = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Prospects'])
  const activities = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Activities'])

  let imported = 0
  let overridden_recent = 0  // import overrode a value the local DB had more recently

  // For each xlsx row, emit superseding events.
  for (const p of prospects) {
    const id = String(p.id)
    const existing = db.prepare('SELECT * FROM prospects WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!existing) {
      // INSERT
      await appendEvent({
        schema_version: 1, id: `evt_${ulid()}`, ts: new Date().toISOString(),
        lamport: nextLamport(), node: NODE, actor: 'import',
        entity: 'prospect', entity_id: id, op: 'insert',
        payload: { ...p, historical_created_at: p.created_at ?? null },
        source: 'manual_import',
      })
    } else {
      // UPDATE per field — only fields that differ
      for (const [field, value] of Object.entries(p)) {
        if (existing[field] === value) continue
        await appendEvent({
          schema_version: 1, id: `evt_${ulid()}`, ts: new Date().toISOString(),
          lamport: nextLamport(), node: NODE, actor: 'import',
          entity: 'prospect', entity_id: id, op: 'update',
          field, prev: existing[field], next: value,
          source: 'manual_import',
        })
      }
    }
    imported++
  }

  // Same pattern for activities. Activities are append-only — for each xlsx
  // activity row, if it doesn't already exist (matched by id), emit an insert.
  for (const a of activities) {
    const id = String(a.id)
    const exists = db.prepare('SELECT 1 FROM activities WHERE id = ?').get(id)
    if (!exists) {
      await appendEvent({
        schema_version: 1, id: `evt_${ulid()}`, ts: new Date().toISOString(),
        lamport: nextLamport(), node: NODE, actor: 'import',
        entity: 'activity', entity_id: id, op: 'insert',
        payload: a,
        source: 'manual_import',
      })
    }
    // existing activity rows are immutable — skip (idempotent re-import)
  }

  // Apply to SQLite immediately (so the UI sees the import without a restart).
  // Reads the events we just appended.
  const newEvents = readEventsTail(imported * 2)  // generous bound
  applyEventsToDb(db, newEvents.filter(e => e.source === 'manual_import'))

  return NextResponse.json({ ok: true, imported, overridden_recent })
}
```

#### F25.B — UI: Settings → "Import / Export xlsx" panel

```html
<!-- public/admin.html, Settings tab, new section -->
<div class="settings-card">
  <h3>Import / Export xlsx</h3>
  <p class="text-secondary text-[11px]">
    Fallback for manual data transfer between machines (pre-sync) or when
    automatic sync is unavailable (post-sync). Export downloads the current
    state as an xlsx file; Import reads an xlsx and applies its rows as new
    events to the local log.
  </p>
  <div class="flex gap-2 mt-2">
    <a href="/api/admin/crm/xlsx-export" download
       class="px-3 py-1 rounded border border-border text-[11px] text-primary hover:bg-bg-hover">
      ⬇ Export to xlsx
    </a>
    <button onclick="xlsxImportPick()"
            class="px-3 py-1 rounded border border-border text-[11px] text-primary hover:bg-bg-hover">
      ⬆ Import from xlsx
    </button>
    <input type="file" id="xlsx-import-file" accept=".xlsx" style="display:none"
           onchange="xlsxImportSubmit(this.files[0])"/>
  </div>
  <div id="xlsx-import-status" class="text-[11px] text-secondary mt-2"></div>
</div>
```

```js
function xlsxImportPick() {
  document.getElementById('xlsx-import-file').click();
}
async function xlsxImportSubmit(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  document.getElementById('xlsx-import-status').textContent = 'Importing…';
  const res = await fetch('/api/admin/crm/xlsx-import', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('xlsx-import-status').textContent =
      `Imported ${data.imported} rows.` + (data.overridden_recent ? ` ${data.overridden_recent} were newer locally and got overridden.` : '');
  } else {
    document.getElementById('xlsx-import-status').textContent = 'Import failed: ' + (data.error || 'unknown');
  }
}
```

**Files affected.**

| File | Change | LOC |
|---|---|---|
| `app/api/admin/crm/xlsx-export/route.ts` | NEW | ~50 |
| `app/api/admin/crm/xlsx-import/route.ts` | NEW | ~100 |
| `public/admin.html` | + Settings panel + handlers | ~80 delta |

**Dependencies.** F22 (SQLite + event log), F23 (replay path used for in-process application of import events).

**Risk.** Low–medium. Import path emits events; same code path as live writes, same safety properties.

**Acceptance criteria.**
- Export downloads a 3-sheet xlsx (Prospects, Activities, _meta).
- Importing an xlsx produced by Export on the same machine produces no events (no-op — idempotent).
- Importing Filippo's exported xlsx on Ralph's machine appends events for every row Ralph didn't have; existing rows get per-field updates only where values differ.
- Restarting Next.js after an import produces an identical SQLite state to what was visible immediately post-import (proves the events were appended correctly).
- The "newer locally than imported" counter increments when applicable (test by editing a prospect locally, then importing an older xlsx).

**LOC estimate.** ~230 LOC.

---

### Group B sequencing

```
F20 — independent — runs first (security defuse + media migration)
  ↓
F21 — depends only on F20 having migrated dirs in place — design only
  ↓
F22 — depends on F20, F21 — port crm-store.ts to SQLite + events.jsonl
  ↓
F23 — depends on F22 — boot replay + idempotency tests (BLOCKS F24)
  ↓
F24 — depends on F22 + F23 — one-shot backfill from xlsx
  ↓
F25 — depends on F22 + F23 — xlsx Import/Export permanent fallback
```

Total Claude-time across F20–F25: **~310 min (~5.2 hrs)**.

After all six land, each machine independently runs OskarOS with:
- SQLite as the indexed projection.
- Append-only event log as truth.
- Content-hashed media outside `public/`.
- WhatsApp protocol state outside `public/`.
- xlsx Import/Export as a permanent manual fallback.
- 4 CI-required idempotency tests gating reducer regressions.
- No data publicly served anymore.

But Ralph's machine and Filippo's machine still can't see each other's data. That gap is closed by **Feature-X WP-104..108** (the sync layer).

---

## 7. Explicitly NOT building

Each rejection has a reason. We keep this list to push back against future scope creep.

### Health Score Engine (Critical / Hot / Stale / Healthy)
**Verdict: don't implement.**
- 3 of 4 tiers duplicate existing signals: stage-age chip already handles Stale (14–20d grey, 21+d amber); overdue chip handles Critical; upcoming chip handles Healthy
- The differentiator (Hot = "3+ buying signals in 7d: emails opened, site visited") requires email tracking pixels + web analytics infrastructure we don't have and won't build (Filippo sells to bars and dental clinics — no Mixpanel)
- Adding another scoring layer = more code + more cognitive load on top of signals Filippo already reads correctly
- **Only kept:** the 4-line `crmOverviewPriority` sort helper for Overview (F3)

### 3-column Spine layout (Details / Timeline / Buying Committee)
**Verdict: don't implement.**
- Just shipped the 2-column inline-expand; refactoring to 3-col is major surgery
- "Buying Committee" assumes multiple contacts per deal — Filippo sells to single decision-makers (bar owner, clinic director). We have **one contact per prospect**.
- 3-col spine is built for enterprise deals with 100+ activities and 7+ stakeholders. Filippo has 5–10 activities and one contact. Wrong tool for the job.
- **Only kept:** the persistent composer at top of timeline → became F4

### Sidebar (instead of tabs) for view switcher
**Verdict: don't implement; use tabs (F2).**
- 140px sidebar steals 12% of kanban width — we just clawed that real-estate back
- Adds a third nav level (top admin nav → CRM sidebar → toolbar)
- Tabs are consistent with existing Today/`?` pill pattern

### AI command bar (top of screen "Ask anything")
**Verdict: don't implement.**
- Premature without a backing LLM-with-CRM-context flow
- Filippo's queries are concrete ("call P003"), not natural-language ("what should I do today?")
- Overview answers the same need without an LLM in the loop

### NBA AI suggestions ("Next-Best-Action")
**Verdict: don't implement.**
- Same reason as command bar — needs LLM-with-CRM-context
- The "recent context" panel in Overview (F3) is the human-readable equivalent; humans pattern-match faster than an LLM at 30-lead scale

### Health score circles / dots (5.3 visual)
**Verdict: don't implement.**
- Health Score is rejected (above); the circles have nothing to render

### Buying-committee panel (multi-contact with engaged/unmet status)
**Verdict: don't implement.**
- Data model has one contact per prospect
- Filippo's deal shape doesn't have committees

### Multi-rep presence / collaboration
**Verdict: don't implement.**
- Solo seller. Owner field exists for future multi-rep but isn't surfaced anywhere

### Forecast / Reports modules
**Verdict: don't implement.**
- Weighted pipeline already in the toolbar summary (CHF pipeline · weighted · net)
- Real forecasting requires ML or rep-judgment input — neither exists

### Sequence / cadence builder
**Verdict: don't implement.**
- This is Salesloft replacement scope. Way out of bounds.

### Universal inbox
**Verdict: don't implement.**
- Filippo uses Gmail directly. No need to mirror it.

### Call library / Gong-style call analysis
**Verdict: don't implement.**
- No call recording infrastructure
- 30-lead scale doesn't justify recording

### List view (spreadsheet view of leads)
**Verdict: don't implement.**
- Kanban + Overview cover the use cases
- List view is reporting; defer until we have data to report on (Q3+)

### Status icons (flames, pulsing dots) on cards
**Verdict: don't implement.**
- Requires Hot / Critical detection from rejected Health Score
- Color-coded chips already handle urgency

### Hover-to-context (right panel updates on row hover)
**Verdict: don't implement; use click-to-select.**
- Trackpad hover is fragile (accidental fly-overs)
- Click selection matches Mail.app and is the more learnable affordance

### Talk-track / AI-drafted email
**Verdict: defer to v2+.**
- Requires LLM and prompt-engineering effort
- "Recent context" panel in Overview covers 80% of the value

---

## 8. Open questions & deferred decisions

### Sub-stage tracking inside sales stages
Filippo's sales stages (Incoming/Contacted/Demo done/Closing) have no sub-stages. A Closing deal could be at "contract sent", "invoice sent", "paid" — same column, no progress indicator. Pipedrive solves this with checkbox sub-stages per pipeline stage.

**Decision deferred.** Add when Filippo asks. Likely WP-CRM-G* if it materializes.

### Activity per-row keyboard shortcut
~~Defer to F3 v2.~~ **Promoted to WP-CRM-F16** (2026-05-24, Ralph).

### Bulk-edit (multi-select cards → change stage / tag / owner)
Not asked for. Would need shift-click multi-select infrastructure. **Defer.**

### Lead deletion
~~Defer.~~ **Promoted to WP-CRM-F17** (2026-05-24, Ralph).

### Archive policy
After N months as Lost/Won, should leads move to an "Archive" view? No. F5 already opacity-dims them; that's enough until volume forces a real decision.

### Snooze beyond +1d/+3d/+1w
The Overview Snooze chips offer those three. The date picker handles arbitrary. **No other shortcuts planned.**

### Recurring follow-ups
~~Defer.~~ **Promoted to WP-CRM-F18** (2026-05-24, Ralph).

---

## 9. Recommended ship sequence

```
Day 1 (~3.5h) — SHIPPED 2026-05-24
  ✓ F1 · Discovery Bridge          — 30m, ✅ shipped (notify-agent inbox-note)
  ✓ F2 · Admin nav restructure      — 1h,  ✅ shipped (5 tabs + 3-bar header)
  ✓ F3 · Overview view content      — 2h,  ✅ shipped (task queue + context panel)

Day 2 (~2.9h) — quick wins + terminal-deal cluster
  ⬜ F4 · Note composer + F12       — 30m, includes dictation placeholder
  ⬜ F13 · WhatsApp icon            — 10m, market-native follow-up launcher
  ⬜ F10 · History filter chips     — 15m, chip row above timeline
  ⬜ F5 · Terminal-deal handling    — 1h, declutters Kanban
  ⬜ F14 · Won/Loss Post-Mortem     — 30m, captures causation narrative
  ⬜ F11 · ROI + currency fix       — 25m, lib/fx.ts + admin summary + CrmLeadPanel

Day 3 (~4.0h) — heavier features
  ⬜ F8 · Dual-phase indicator      — 1.5h, CRM-phase + Oskar-phase pills + sub_stage column
  ⬜ F15 · Action Chains            — 1h, outcome chips + auto-snooze rules
  ⬜ F6 · Activity edit + subject   — 1h
  ⬜ F7 · Nav respects filter       — 15m
  ⬜ F9 · Email show-full cleanup   — 15m

Day 4 (~2.75h) — Overview polish + lifecycle ops
  ⬜ F16 · Overview keyboard shortcuts — 30m, j/k/c/e/m/n/s/d/Enter/Esc
  ⬜ F17 · Lead deletion              — 45m, DELETE route + danger zone UI
  ⬜ F18 · Recurring follow-ups       — 1.5h, recurring_pattern column + F3/F15 integration

Day 5 (~6.5h) — WhatsApp live sync (the flagship integration)
  ⬜ F19 · Baileys WhatsApp bridge    — 6.5h, oskar-wa-bridge subprocess + Settings → WhatsApp UI
                                        Depends on F13 (wa.me icon coexists, not replaced).
```

**Total: ~19.65h across 5 focused sessions.** Day 1 (~3.5h, three WPs) already shipped. Day 4 promotes three items from §8's deferred list (Ralph's call 2026-05-24). Day 5 is the bidirectional WhatsApp integration.

Each F-WP is independently revertable via `git revert` since they touch disjoint surfaces.

---

## 10. Acceptance criteria for "v1 complete"

| Criterion | Verification |
|---|---|
| All 9 F-WPs shipped | Each WP has a commit; this doc updated with ✓ |
| All 17 audit findings fixed or explicitly deferred | Table in §5 has no ⏳ entries |
| Overview used as morning queue | Filippo opens Overview at 9am; works through tasks until empty; reports it shaved 15+ min from his morning |
| Discovery Bridge produces seed file | CD agent opens with "I see you've been talking to X about Y — let's explore Z" referencing CRM-SEED.md content |
| Zero write-only fields | Every captured field has a display surface (`lost_reason`, `needs_analysis`, `solutions_bought` all rendered back) |
| Zero stale-string displays | Every chip/badge computed live from source data (no rotting `next_action_label` strings) |
| Zero dead code | `crmSaveModal` deleted; no other un-referenced exports/functions remain (verify via `grep -rn "function crm" public/admin.html` + cross-reference) |
| Filippo's stress test | Filippo runs CRM for 1 full week with 30+ active leads; no data loss, no UI confusion, no "wait, why doesn't X work" |

---

## 11. References

- **`docs/WP-CRM.md`** — original Phase A–D plan (v6.3, 24 WPs). Authoritative for Phase A scope and architectural-axes history.
- **`/Users/ralphlengler/OskarOS/fonts/docs/sales-crm-feature-and-screen-inventory.html`** — Ralph's reference inventory of 17 CRM screens (5.1 A1 Overview, 5.2 A2 Pipeline Kanban, 5.3 B3 Deal Record are the three we benchmark against).
- **`public/admin.html`** — implementation (single file, ~4900 lines as of 2026-05-24).
- **`lib/crm-store.ts`** — data layer (Excel I/O, Activities sheet, file-system session scan).
- **`lib/session-config.ts`** — `_session-config.json` writer (used by `crmStartSession` → POST `/api/admin/crm/sessions`).
- **`docs/crm-feature/generate-seed.mjs`** — seed file generator. Regenerate via `node docs/crm-feature/generate-seed.mjs`.

---

_End of WP-CRM-001._
