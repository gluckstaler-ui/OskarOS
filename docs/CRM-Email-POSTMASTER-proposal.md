# POSTMASTER — email as an island, like WhatsApp

_Decision spec · 2026-07-12 · rewritten by Jedi Opus from Fable's v3 + Ralph's v6 feedback_
_Interactive prototype: **`CRM-Email-POSTMASTER-mockup.html`** — real crm.css, fully clickable_
_Supersedes: v3 (IMAP Drafts architecture), v4 amendment (EmailComposeModal), and all prior bucket/inbox proposals_

---

## 00 · The contract

Email enters the CRM the same way WhatsApp entered: as an **island**. Click the Email bento → the middle column swaps to a message list grouped by client, sorted by incoming date. Expand a client → see messages, compose inline, send. The pattern is identical to `WhatsAppMessageList` + `WaUnmatchedBanner`. No new paradigm. No modals. No inbox screen. One more channel through the same door.

The CRM reads email via IMAP and sends email via SMTP — the same split as WhatsApp (Baileys reads + sends). The Consular prefills replies in the CRM's inline compose field, never in IMAP Drafts. Filippo edits and sends from the CRM, or discards. The diff between suggestion and sent message is the training signal, posted to the Consular chat.

Sent-folder ingest captures sends Filippo makes from his phone or webmail — the one thing no other channel has. The CRM is the primary email interface, but it's not the only one.

---

## 01 · Verified base (checked against the working tree 2026-07-12)

| Claim | Verified? | Where |
|---|---|---|
| Overview is a 3-column grid `400px minmax(0,1fr) 420px` | **REAL** | `app/crm/crm.css:1252` |
| Dead Emails triage bento exists — tone `email` #f97316, bucket `activity:Email`, `emailsCount` computed | **REAL** | `components/crm/TriageRail.tsx:128-141` · `crm.css:1396` |
| `E-mail Out` / `E-mail In` already in the ActivityType union | **REAL** | `lib/crm-store.ts:100-101` |
| `Activity` already carries `subject`, `media_path/mime` | **REAL** | `lib/crm-store.ts:113-129` |
| Feed renders email icons (`mail` / `mail-open`) | **REAL** | `components/crm/LeadDetail.tsx:121-122` |
| FlightDeck channel drives the verb — `▶ DRAFT` for non-phone channels is shipped code | **REAL** | `components/crm/FlightDeck.tsx:37,96` (`execVerb`) |
| WhatsApp island = the channel reference (compose → outbound route → activity → inbound dispatch → unmatched banner) | **REAL** | `WhatsAppMessageList.tsx` · `WaUnmatchedBanner.tsx` · `wa-outbound` route |
| `contacts` table (1:many, per-contact `email`) shipped with WP-121 | **REAL** | `lib/crm-store.ts` contacts block |
| Consular is read-only; sends route around the agent (WP-111) | **REAL** | corpus-verified; email satisfies it the same way WhatsApp does: gated outbound route |
| Any email transport anywhere in the repo | **NOT FOUND** | nodemailer only in the 3 public contact-form routes; zero IMAP |
| Native-addon builds possible on the el8 server | **NO** | better-sqlite3 → node:sqlite; mail deps must be pure JS |

---

## 02 · Surfaces — what POSTMASTER touches

| Surface | Component | Today | Under POSTMASTER |
|---|---|---|---|
| Triage rail | `TriageRail.tsx` | Emails bento counts 0 (dead) | counts prospects with email activity (mirrors WhatsApp count logic) |
| Email island | **NEW: `EmailMessageList.tsx`** | — | click bento → middle column swaps to email messages grouped by client, sorted by incoming date; mirrors `WhatsAppMessageList` |
| Unknown senders | **NEW: `EmailUnmatchedBanner.tsx`** | — | toggle to show unrecognized email addresses; Create Lead / Dismiss; mirrors `WaUnmatchedBanner` |
| Lead list | `LeadList.tsx` | email icon = `mailto:` | ✉ icon lights from email activity recency |
| Lead detail feed | `LeadDetail.tsx` | renders E-mail In/Out types, none exist | rows appear with attachment links to `media/{client}/` |
| Lead detail compose | **NEW: inline compose field** | — | 10+ line textarea BEFORE history; Consular-prefilled; `[▶ SEND EMAIL] [▶ SEND WHATSAPP] [DISCARD]` |
| Flight deck | `FlightDeck.tsx` | `▶ DRAFT` verb shipped, no email cards | pulse emits email cards; DRAFT opens the client card with prefilled compose |
| Consular chat | `ConversationPanel` | read-only advisor | narrates sweeps; receives sent-message posts for diff-loop |
| Attachments bento | **NEW** | — | separate triage entry; clients by latest attachment date; click → client media directory |
| Settings card | **NEW in `admin.html` Column 2** | — | email credentials (user, password, IMAP/SMTP servers); Test Connection; status dot |

---

## 03 · Architecture overview

```
                     ┌─ IMAP read ──────────────┐
  mail.privateemail.com                          │
  ┌──────────────────┐                           │
  │ INBOX            │ ◄── counterparts write    │
  │ Sent             │ ◄── Filippo (any device)  │
  └──────────────────┘                           │
         │                                       │
         │ Eyes: IMAP sweep (§04)                │
         ▼                                       │
  media/{client-slug}/eml/*.eml (raw, one copy)  │
         │                                       │
         └──► activities (E-mail In / Out)        │
                      │                          │
                      ▼                          │
           existing activity log                 │
           (same feed as WhatsApp, calls, etc.)  │
                      │                          │
         ┌────────────┼──────────────┐           │
         ▼            ▼              ▼           │
  pulse · bento    Consular (§06)   feed · deck  │
                 sees new email in                │
                 the feed it already              │
                 watches → suggest_reply          │
                      │                          │
                      ▼                          │
              inline compose                     │
              │                                  │
   Filippo    │                                  │
   edits &    │                                  │
   sends      │                                  │
              ▼                                  │
    POST /email-outbound (§05)                   │
              │                                  │
              ├──► SMTP send ───────────────────►│ mail.privateemail.com
              ├──► log E-mail Out activity
              └──► post to Consular chat (diff = lesson)
              
  Attachments (both directions):
    inbound  → Eyes extracts from .eml → media/{client-slug}/
    outbound → compose file picker → upload → media/{client-slug}/ → attach to SMTP
    history links to media/{client-slug}/filename
```

---

## 04 · Eyes — `lib/mail-eyes.ts` (~200 LOC)

**Deps.** `imapflow` + `mailparser` — pure JS (el8 constraint, §01).

**Owner.** The hub (single-owner rule, WhatsApp `:38` precedent). `media/` (incl. the per-client `eml/` dirs) is per-node and excluded from the Button-A sync tar exactly like `public/_whatsapp/`; only activity events travel.

**Config** — managed via the Settings card (§10), stored in `.env.local` (plaintext by design):

```
OSKAR_MAIL_USER=filippo@paradiso.dev
OSKAR_MAIL_PASS=…
OSKAR_MAIL_IMAP_HOST=mail.privateemail.com
OSKAR_MAIL_IMAP_PORT=993
OSKAR_MAIL_SMTP_HOST=mail.privateemail.com
OSKAR_MAIL_SMTP_PORT=465
OSKAR_MAIL_SWEEP_SEC=3600        # hourly — email is not chat
```

**Sweep triggers, two:** the hourly timer, and **`POST /api/admin/mail/sweep`** — the CHECK EMAIL button (island header + Overview strip). Same serialized sweep; if one is already running, the manual call joins it and returns the live progress (never a stacked second sweep, never 409-noise).

**Progress is visible, not implied — and the operation is ONE serialized chain.** connect → list → download → file → brief: the sweep is not "done" until the Consular briefing call returns, so there is no window where a second sweep slips in behind the gate. The operation updates a module-level progress object after every step — `{ phase: connecting | listing | downloading | filing | briefing | done | failed, folder, done_n, total_n, attachment?, error?, failed_phase? }`.

**Where the status shows — two surfaces, same source (`GET /api/admin/mail/status`, polled at 2s while busy):**
1. **The CHECK-EMAIL button itself** becomes the live ticker: `verbinde… → INBOX 3/12 → lade terrazza-01.jpg → abgelegt → Consular liest… → ✓ 09:44`.
2. **The POSTMASTER strip** on Overview shows the same phase: idle `● swept 09:44 · INBOX+Sent · corpus 215 sends`, busy `◌ INBOX 3/12 · lade Anhänge…`, briefing `◌ Consular liest die neuen Mails…`.

The `briefing` phase is the explicit BUSY state — Filippo always sees when the agent is working. A CHECK-EMAIL click during any phase starts nothing new; it joins the running operation and renders its live progress.

**`failed` is a first-class phase — a crash must never read as a verdict that didn't come (the WP-23 rule).** Any step that throws — IMAP mid-download, the bridge dying mid-briefing — sets `phase: failed` with `failed_phase` + `error`, releases the sweep lock, and surfaces RED on both surfaces: the button shows `✗ fehlgeschlagen — <phase>` and the strip holds a red sticky (`✗ Consular-Briefing abgebrochen · 3 Mails abgelegt, nicht gemeldet`) until the next sweep starts. Work already done stays done (filed mails are filed — idempotence, §04.4). **The un-briefed batch is not lost — and nothing is stored:** the briefing list is a SELECT (§06), derived fresh at every trigger from crm.db. After any crash the next trigger re-derives exactly the prospects still owed a briefing — nothing to write, nothing to clear, nothing to lose. A failed briefing means "delayed," never "silently skipped." The red strip carries a `RETRY` affordance that is simply the CHECK-EMAIL trigger.

**Sweep algorithm** (per trigger, serialized — never two sweeps concurrently):

1. Connect IMAPS to `IMAP_HOST:IMAP_PORT`. Per folder (`INBOX`, `Sent`): read `UIDVALIDITY` + `UIDNEXT`. **No cursor file — the eml store IS the cursor:** cursor = highest uid across all `media/*/eml/<folder>-<uidvalidity>-<uid>.eml` filenames (nothing yet = 0); the server's `UIDVALIDITY` is compared against the newest eml FILENAME's uidvalidity segment.
2. `UIDVALIDITY` changed → the server renumbered: re-list the folder from 0, rely on Message-ID dedup (§11) to avoid re-filing. Log loudly.
3. Fetch UIDs in `[cursor, UIDNEXT)`. For each:
   - Write `media/{client-slug}/eml/<folder>-<uidvalidity>-<uid>.eml` (raw — the ONLY copy besides the activity row; unmatched → `media/unmatched/eml/`). **No sidecars, no db/mail (Filippo 2026-07-13):** the filename carries folder + uidvalidity + uid; subject/excerpt/message-id/thread live on the activity row; anything else is re-parsed from the eml on demand.
   - **Extract attachments** from inbound messages → save to `media/{client-slug}/` (§09).
4. The cursor "advances" by the files landing on disk — a crash between fetch and write means the filename never appeared, so the next sweep refetches; dedup absorbs it. Idempotent by construction, zero cursor state.
5. **Re-match pass (locked 2026-07-13: sweep-only, no other hook).** Before the briefing step, re-check ALL `media/unmatched/eml/` INBOX mail against the CURRENT `contacts` table. An address added to an account since the last sweep — by hand, by Create Lead, by import — makes its prior mail file as `E-mail In` on that prospect now, and its eml MOVES to `media/{client-slug}/eml/` (filename unchanged); Message-ID dedup absorbs re-runs. The unmatched pool is never stored — it IS the unmatched dir, so it empties by itself. And because this runs BEFORE the briefing, freshly-matched unanswered mail enters the §06 SELECT the same sweep: add the address, hit CHECK EMAIL, and the Consular briefs on the history it just gained.
6. New INBOX mail → the draft-gated Consular briefing (§06), one call for the whole batch. **Zero new mail → log one line, disconnect — the Consular is NOT called. The system only bothers the agent when something new came in; a quiet sweep is silent end to end.**

**Sent-folder ingest** — the sweep covers `Sent` with the same algorithm. Mails Filippo sends from his phone, webmail, or any device appear as `E-mail Out` activities within one cycle. No other channel has this — WhatsApp sends outside the CRM are invisible; email sends outside the CRM are captured.

**Backfill** = the same sweep pointed at Sent history (cursor 0, batched 200/sweep). This seeds the voice corpus — no separate import script.

**IDLE upgrade** (later, inside this organ): hold the INBOX connection with IDLE for push-latency; the poll remains as the fallback heartbeat. No architectural change.

---

## 05 · Voice — `app/api/admin/crm/activities/email-outbound/route.ts` (~120 LOC)

Mirrors `wa-outbound`. The CRM sends email directly via SMTP, like it sends WhatsApp directly via Baileys.

**Endpoint:**

```
POST /api/admin/crm/activities/email-outbound
{
  prospect_id: "P017",
  to: "chiara@bistrot-olmo.ch",
  subject: "Re: Your new website — proposal",
  body: "Ciao Chiara — …",
  in_reply_to: "<c-1042@bistrot-olmo.ch>",   // optional; sets In-Reply-To + References
  attachments: ["media/bistrot-olmo/proposal.pdf"]  // optional; paths in media dir
}
→ { ok, email_message_id: "<out-xxx@paradiso.dev>" }
```

**Implementation:**

1. Compose RFC 5322 message (headers + `Message-ID` minted under `@paradiso.dev`, plain text body, MIME attachments from paths)
2. Connect SMTP to `SMTP_HOST:SMTP_PORT` (SSL). Send.
3. Log `E-mail Out` activity: subject, body excerpt, `email_message_id`, `email_thread_id` (walked from `in_reply_to`), attachment paths
4. If a Consular suggestion existed for this prospect+channel: compute diff (suggestion vs. sent body), post to Consular chat, clear the suggestion
5. If sent verbatim (no diff): post "voice held · corpus +1" to chat

**Dep.** `nodemailer` — pure JS, no native addons (el8 constraint). Already present in the repo for contact-form routes.

**WP-111 compliance:** The send goes through a gated API route — same architecture as `wa-outbound`. The Consular suggests; the route sends. The agent never touches the transport.

---

## 06 · Brain — extend the Consular, don't spawn a new one

Email activities flow through the same activity log as WhatsApp, calls, and meetings. The Consular already watches that log. No new doctrine, no padawan instructions. One minimal trigger after each sweep: prospect IDs only — the agent reads the feed and decides.

**One change to the Consular:** add `suggest_reply` to its MCP tool allowlist.

```jsonc
suggest_reply({
  prospect_id: "P017",
  channel: "email",                           // or "whatsapp"
  body: "Ciao Chiara — …",                   // plain text
  in_reply_to: "<c-1042@bistrot-olmo.ch>",   // for email threading
  subject: "Re: Your new website — proposal"  // for email subject line
}) → { ok, prospect_id, channel }
```

Writes a row to the `suggestions` table in crm.db (§11 — one pending draft per prospect per channel, enforced by the primary key; typed SQL columns, no JSON blob). The inline compose UI reads this and shows the prefilled text. Sending or discarding deletes the row.

**Auto-briefing is email only.** The automatic Consular call after each sweep exists for ONE channel: email. WhatsApp drafting stays behind Filippo's explicit Ask-AI button — it is manual, not triggered by inbound messages. (The `suggestions` table still carries a `whatsapp` channel key for the Ask-AI button's output; the AUTO-call is email-exclusive.)

**The draft-gate rule — ONE derived SELECT, no stored list anywhere.** The briefing list is computed fresh at the end of every sweep, from crm.db alone: **every prospect whose latest `E-mail In` is newer than ALL of** — the latest `E-mail Out` on that prospect · the pending email draft's `created_at` (`suggestions` table) · the latest Consular note on the thread («Entwurf verworfen» or a decline note). New mail that nobody answered, nobody drafted for, and nobody declined = owed a briefing. This one query is simultaneously the draft-gate (a pending draft clears it), the "only when something new" rule (empty result = no call), and the crash recovery (§04: after a failed briefing the next trigger re-derives exactly what's still owed — nothing was stored, nothing can be lost or stale).

A prospect with a pending draft is NEVER re-briefed — the draft gets sent, edited, or discarded by Filippo first. The Consular does not talk over its own suggestion, and it does not talk over Filippo. **Every outcome leaves a SQL trace, or the SELECT can't clear:** a drafted reply fills the `suggestions` row; a discard writes «Entwurf verworfen» to the thread (§14); a Consular DECLINE writes a one-line note activity («Keine Antwort nötig — Newsletter») — chat alone clears nothing. Empty briefing list → no call (see §04 step 5: quiet sweeps are silent end to end).

**The call goes through the ask-AI route, not raw session injection.** **One call per sweep, the whole batch in one directive** (locked 2026-07-12 — the Consular holds the batch; cross-lead reading is its one structural advantage, and per-mail calls would lose it): `POST /api/admin/crm/consular/email-inbound` (NEW, ~60 LOC, mirror of `consular/ask` → `callConsularBridge`) with `[OSKAR-SYSTEM EVAL-INBOUND] channel=email` carrying **only the prospect IDs — nothing else.** No sidecar paths, no thread positions, no envelope: the agent is smart, don't write the fallback the agent already is. The Consular SQL-reads the fresh `E-mail In` activities for those IDs, and when the excerpt isn't enough, reads the raw mail in `media/{client-slug}/eml/` itself. Expected tools: `suggest_reply` (0–N calls — the agent may decline per prospect) plus a chat report: what came in, what it moves in each deal, what was drafted or why not.

---

## 07 · The island — `components/crm/EmailMessageList.tsx` (NEW, ~250 LOC)

Mirrors `WhatsAppMessageList.tsx` exactly. Replaces the lead list when the Email bento is active (`page.tsx` filter check, same pattern as `activity:WhatsApp`).

**Structure:**

- Groups all `E-mail In` and `E-mail Out` activities by `prospect_id` (via the `contacts` table, which maps multiple email addresses to one account)
- Each group = one client account. Header shows: company name, message count badge, identity count badge if >1 email address ("2 addresses · one account"), latest snippet with directional arrow (← inbound, → outbound), relative time
- **Default state: all collapsed.** Click header to expand.
- Expand/Collapse All toggle when >1 group

**Expanded group (top to bottom):**

1. **Inline compose** (at the TOP — the action leads, messages follow):
   - Textarea, min-height 170px (~10 lines)
   - If Consular suggestion exists: prefilled, with label "CONSULAR PREFILLED THIS REPLY — discard, or edit & send"
   - Attachment button (📎): file picker → upload to `media/{client-slug}/` → chip appears below textarea
   - Buttons: `[▶ SEND EMAIL]` `[DISCARD]`
   - Note: "send also posts to the Consular chat — the diff is the lesson"
   - Enter = send, Shift+Enter = newline
2. **Messages** (sorted by date, newest first):
   - Each row: direction arrow (← orange for in, → dim for out), sender address (mono), body (with subject in bold), attachment chips (clickable → open file), time
   - Each row is a `<button>` — click opens `LeadDetail` for that prospect

**Unknown senders — `EmailUnmatchedBanner.tsx`** (NEW, ~120 LOC):

Mirrors `WaUnmatchedBanner.tsx`. Toggle button: "Show unknown senders" / "Hide unknown senders". Shows inbound email from addresses not matching any `contacts.email` row.

Per unknown sender:
- Header: email address, "unknown sender" badge, latest snippet
- **Create Lead** button → creates prospect seeded with sender data, dismisses, opens new lead
- **Dismiss** button → removes from unmatched pool
- Inline reply textarea (for replying before creating a lead — sends via `email-outbound` with `email` instead of `prospect_id`)

---

## 08 · Client card compose — inline, multi-channel, with attachments

The compose field sits on the client card (`LeadDetail.tsx`) **between the deal info section and HISTORY**. No modal. The same field serves both email and WhatsApp.

**Anatomy:**

```
┌─ COMPOSE ──────────────────────────────────────────┐
│ CONSULAR PREFILLED THIS REPLY — discard or edit    │
│ FROM: [▾ chiara@bistrot-olmo.ch           ]        │
│ ┌────────────────────────────────────────────────┐ │
│ │ Ciao Chiara — this week works. Two things      │ │
│ │ before the signature: the menu photos we       │ │
│ │ talked about, and whether the booking button   │ │
│ │ goes to Teburio.                               │ │
│ │                                                │ │
│ │ Thursday afternoon I'm in Basel anyway —       │ │
│ │ I'll bring the papers.                         │ │
│ │                                                │ │
│ │ Filippo                                        │ │
│ └────────────────────────────────────────────────┘ │
│ 📎 attach file                                     │
│                                                    │
│ [▶ SEND EMAIL]  [▶ SEND WHATSAPP]  [DISCARD]       │
│ posts to history + Consular chat                   │
└────────────────────────────────────────────────────┘
```

- Same textarea content, channel chosen at SEND time
- `[▶ SEND EMAIL]` only appears if the account has email addresses
- `[▶ SEND WHATSAPP]` only appears if the account has phone numbers
- `[DISCARD]` clears the suggestion, logs to Consular chat
- **Attachment button** (📎): opens file picker, uploads to `media/{client-slug}/`, shows chip below textarea. Chips are removable (✕). Attachments travel with the send regardless of channel.

**Identity selector** — when an account has multiple contacts (= multiple email addresses or phone numbers), the compose field shows a FROM dropdown above the textarea:

```
FROM: [▾ chiara@bistrot-olmo.ch     ]   ← dropdown, all contacts for this account
      filippo@paradiso.dev              (for email; for WhatsApp: phone numbers)
      info@bistrot-olmo.ch
```

- Default: the contact whose address/number matches the most recent inbound message (reply goes to whoever wrote last)
- Override: Filippo picks from the dropdown before sending
- Applies to BOTH channels: email shows email addresses, WhatsApp shows phone numbers. Same dropdown, same logic.
- Single-contact accounts: no dropdown, FROM line hidden

**Below compose: HISTORY header** with quick-send buttons (`◍ SEND WHATSAPP`, `✉ SEND EMAIL`) that scroll to / focus the compose field above.

**Account identities** shown between deal info and compose: structured list of contacts with name + email + phone per person, not a flat dump of addresses.

---

## 09 · Attachments — shared media directory + triage bento

**Per-client media directory:** `media/{client-slug}/` (e.g., `media/bistrot-olmo/`).

Both WhatsApp and email attachments from clients are saved here:
- **Inbound email:** Eyes extracts attachments from `.eml` during sweep → saves to `media/{client-slug}/`
- **Inbound WhatsApp:** existing Baileys media download → saves to `media/{client-slug}/` (currently saves to flat `media/` with content hash — needs migration to per-client dirs)
- **Outbound:** compose file picker uploads to `media/{client-slug}/` before sending

Only client attachments (inbound) are automatically downloaded. Outbound attachments are user-initiated via the file picker.

**History links:** Activity feed rows with attachments show clickable chips: `📎 terrazza-01.jpg · 2.1 MB` → opens the file (image preview, PDF viewer, or download).

**Attachments bento** (triage rail, below Email and WhatsApp):

- Click → middle column shows clients sorted by most recent attachment date
- Each row: client name, file count badge, latest filename, time
- Click a client row → detail view showing the contents of `media/{client-slug}/`:
  - File list: icon (🖼/📄/🎨), filename, source (via Email / via WhatsApp), direction (← from client / → sent by us), size, date
  - Click a file → preview or download
  - Path shown: `media/{client-slug}/`

---

## 10 · Settings card — email account in `admin.html` Column 2

New `bento-card` in the Settings page, Column 2, next to the WhatsApp card. Same card anatomy.

**Card:**

```
┌─────────────────────────────────────────────┐
│ ✉ EMAIL ACCOUNT              ● connected    │
├─────────────────────────────────────────────┤
│ EMAIL        [filippo      @paradiso.dev  ] │
│ PASSWORD     [••••••••••••          👁     ] │
│                                             │
│ ── server (prefilled, editable) ──────────  │
│ IMAP HOST    [mail.privateemail.com       ] │
│ IMAP PORT    [993                         ] │
│ SMTP HOST    [mail.privateemail.com       ] │
│ SMTP PORT    [465                         ] │
│                                             │
│ [ TEST CONNECTION ]           [ SAVE ]      │
│                                             │
│ Last sweep: 09:44 · 214 in corpus           │
│ IMAP: connected · SMTP: connected           │
└─────────────────────────────────────────────┘
```

**Behavior:**

- Email field splits: `username` (input) + `@` + `domain` (input, default `paradiso.dev`). Changing the domain does NOT auto-update server fields — the servers are a separate concern (Namecheap Private Email uses `mail.privateemail.com` regardless of domain).
- Server fields default to `mail.privateemail.com` (Namecheap Private Email). Editable for other providers.
- Password: eye-toggle, same pattern as API key rows in Column 1.
- **TEST CONNECTION:** `POST /api/admin/settings/mail/test` → attempts IMAP login + SMTP `EHLO` → returns `{imap: ok|error, smtp: ok|error, message}`.
- **SAVE:** writes all six values to `.env.local` via line-aware rewrite (same mechanism as `settings/keys/route.ts`). Restarts Eyes sweep.
- Status dot: green = both connected, amber = partial (IMAP ok, SMTP error means "inbound works, outbound will fail"), red = both down, grey = not configured.
- Footer: last sweep time + corpus count from `GET /api/admin/mail/status`.

**Card states:**

| State | Dot | Body |
|---|---|---|
| Not configured | grey | Empty fields, SAVE disabled until email + password filled |
| Configured, untested | amber | Fields filled, "not yet tested" |
| Connected | green | Last sweep time, corpus count, both protocols OK |
| IMAP error | red | Error message, "check credentials" |
| SMTP error | amber | IMAP OK, "inbound works, outbound will fail" |

**API route:** `app/api/admin/settings/mail/route.ts` (NEW, ~80 LOC). GET → current config (password masked) + status. POST → validate, write `.env.local`, restart Eyes, return test result.

---

## 11 · Data model

Two nullable columns on `activities`, added via the event-sourced migration path (idempotent + replay-safe — the WP-121 lesson):

```
email_message_id  TEXT   -- RFC 5322 Message-ID; global dedup key
email_thread_id   TEXT   -- root Message-ID (walk References to the top)
```

**Event shape:**

```jsonc
{ "entity":"activity", "op":"insert", "node":"server", "data":{
    "prospect_id":"P017", "type":"E-mail In", "timestamp":"2026-07-12T09:41:12+02:00",
    "subject":"Re: Your new website — proposal",
    "notes":"possiamo firmare questa settimana? …",
    "email_message_id":"<c-1042@bistrot-olmo.ch>",
    "email_thread_id":"<p-2231@awesome-ux.ch>",
    "media_path":"media/bistrot-olmo/terrazza-01.jpg" } }
```

**Dedup rule:** `email_message_id` already present → never re-filed. Sweeps are idempotent.

**Drafts — real SQL columns in crm.db, no JSON blobs (locked 2026-07-12: structured data gets typed columns, not a JSON field; and no store outside crm.db):**

```sql
CREATE TABLE suggestions (
  prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,              -- 'email' | 'whatsapp'
  body        TEXT NOT NULL,
  subject     TEXT,                       -- email only
  in_reply_to TEXT,                       -- email threading
  created_at  TEXT NOT NULL,
  PRIMARY KEY (prospect_id, channel)      -- one pending per prospect per channel, enforced by schema
);
```

`suggest_reply` UPSERTs the row; the compose UI reads it; send/discard DELETEs it (discard also writes the «Entwurf verworfen» note, §14). The §06 draft-gate is one SELECT against this table. Added via the same event-sourced migration path as the two activity columns above — same database, typed columns, queryable like everything else in crm.db.

---

## 12 · Pulse — `lib/mail-pulse.ts` (~100 LOC)

Derived from mailbox truth — replies and silence, never tracking pixels.

| State | Condition (per prospect, latest thread) | Effect |
|---|---|---|
| `awaiting` | E-mail Out, no In yet, < N days | WATCHING; status → Awaiting reply |
| `replied` | In after Out | reply-latency logged; BUYING signal; REPLY card if unanswered by us |
| `stalled` | Out + silence ≥ N days (N=5, per-stage overridable) | CHASE card on deck; confidence decay; lore to `intel_json` |
| `cooling` | thread active, then silence ≥ 2N on a previously warm lead | NUDGE card; Consular may pre-suggest the re-approach |

**Deck card shape:**

```jsonc
{ "kind":"CHASE", "prospect_id":"P009", "title":"Kanzlei Brunner & Cie",
  "line":"proposal 5d silent · nudge prefilled in your compose",
  "minutes":3, "channel":"email", "roi":9.2 }
```

**Kill rule:** a reply kills the card the same sweep it's filed.

---

## 13 · Status strip + endpoint

- **POSTMASTER strip** (Overview, above the pulse when email bento is active): `● swept 09:44 · INBOX+Sent · corpus 215 sends · replies not pixels`. Amber dot = healthy; grey + "swept 41 min ago" when sweeps stall.
- `GET /api/admin/mail/status` (NEW, ~30 LOC) → `{ last_sweep_at, sweep_no, filed_today, suggestions_pending, corpus_count, healthy, sweeping, progress: {phase, folder, done_n, total_n, failed_phase?, error?}, next_sweep_at, briefed: [prospect_ids], gated: [prospect_ids], pending_briefing: [prospect_ids] }` — `gated` = had new mail but a draft was already waiting (strip shows it as "2 warten auf dich"); `pending_briefing` = the §06 SELECT evaluated at request time — never stored, non-empty after a failed briefing = awaits retry (strip goes RED with the RETRY affordance, §04). UI polls at 2s while `sweeping`, else on the normal cadence.

---

## 14 · Failure modes & edge cases

| Case | Behavior |
|---|---|
| IMAP down / auth fail | Settings card dot red; strip dot grey; retry next cycle. Nothing else degrades |
| SMTP down | Settings card dot amber ("inbound works, outbound will fail"); compose SEND button shows warning |
| UIDVALIDITY reset | detected via the newest eml FILENAME's uidvalidity segment vs. the server → re-list from 0; Message-ID dedup prevents re-filing; loud log |
| Crash mid-sweep | the maildir is the cursor: a file that never landed gets refetched next sweep; dedup absorbs the overlap; no loss, no dupes, no cursor state |
| Bridge dies mid-briefing | `phase: failed` + RED on button and strip («Briefing abgebrochen — Mails abgelegt, nicht gemeldet»); filed mails stay filed; nothing was stored — the next trigger's §06 SELECT re-derives the owed batch, draft-gated at call time. A crash never reads as "nothing came in" |
| HTML-only mail | activity excerpt = stripped text; `.eml` keeps the original; CRM shows plain text |
| Huge attachment | >25 MB: headers+text only in .eml, skip attachment download, log it |
| Same mail in INBOX and Sent (self-CC) | one Message-ID, one activity — dedup absorbs |
| Multiple email addresses, one account | `contacts` table groups them; island shows one client group with identity badge |
| Unknown sender, real business | enters via EmailUnmatchedBanner → Create Lead or Dismiss |
| Email address added to a contact AFTER its mail arrived | next sweep's re-match pass (§04.5) files the prior mail onto the account — hourly automatic, or instant via CHECK EMAIL; dedup absorbs re-runs; the banner empties by derivation, nothing to clean |
| Filippo sends from phone | Sent-folder ingest captures it next sweep; `E-mail Out` activity; "(captured off-CRM)" note |
| Consular suggestion discarded | DELETE the `suggestions` row + INSERT an activity note «Entwurf verworfen» on the thread (event-sourced, replay-safe) + log to chat. The next briefing reads the feed, sees the verdict, and never re-offers the thrown-away draft — the promise has memory in SQL, not in the session |
| Password rotation | change in Settings card → SAVE → Eyes restarts with new creds |

---

## 15 · Security & privacy

- **Scope:** ONE dedicated outreach mailbox (`@paradiso.dev`). Widening = config decision in Settings.
- **Creds:** `.env.local` on the hub, plaintext by design. Managed via Settings card, not hand-edited.
- **Transport:** IMAP read + SMTP send. Both over SSL (993/465). No unencrypted connections.
- **The Consular sees** what the mailbox sees — activity rows + per-client eml files, not raw IMAP access. `media/*/eml/` never syncs.
- **No tracking pixels, no link rewriting** — nothing that damages deliverability or relationships.
- **Attachments:** only inbound client attachments are auto-downloaded. Stored in `media/{client}/` alongside WhatsApp media.

---

## 16 · Sub-WPs

| WP | Scope | Files | LOC est. | Acceptance |
|---|---|---|---|---|
| **WP-PM-1 Eyes** | §04: IMAP sweep, cursors, sidecars, attachment extraction, Sent-ingest, backfill | `lib/mail-eyes.ts` (NEW) · `.env.local` | ~200 | Kill -9 mid-sweep → restart refiles nothing. iPhone-sent mail appears as `E-mail Out` within one cycle. Attachments land in `media/{client}/`. Backfill 200 Sent → 200 activities, 0 dupes on re-run |
| **WP-PM-2 Voice** | §05: SMTP outbound route, diff-loop posting to chat | `app/api/admin/crm/activities/email-outbound/route.ts` (NEW) | ~120 | Send from CRM → arrives in recipient's inbox threaded. Diff between suggestion and sent text appears in Consular chat. Attachment sends arrive intact. |
| **WP-PM-3 Suggest-tool** | §06: register `suggest_reply` + add it to the Consular's allowlist — the ONLY Consular change (no doctrine prose; unknown senders are the banner's job, §07, never the agent's) | `mcp-server/tools.ts` (+1) · Consular allowlist | ~40 | Suggestion prefills compose. Discard writes «Entwurf verworfen» and the draft-gate SELECT proves the thread is not re-briefed while a verdict stands. WhatsApp inbound triggers zero Consular calls. |
| **WP-PM-4 Island** | §07: email message list + unknown senders banner | `components/crm/EmailMessageList.tsx` (NEW) + `EmailUnmatchedBanner.tsx` (NEW) | ~370 | Click email bento → grouped message list. Expand → inline reply at TOP. Unknown senders toggle works. Click message → opens lead. Enter = send. |
| **WP-PM-5 Compose** | §08: inline compose on client card, multi-channel, attachments, identity selector | `components/crm/LeadDetail.tsx` (modify) | ~180 delta | Compose field before history. Consular-prefilled. Both channel buttons. FROM dropdown when >1 contact (defaults to last inbound sender). Attach file → chip → sends with message. Discard clears and logs. |
| **WP-PM-6 Attachments** | §09: per-client media dirs, attachments bento, file preview, WhatsApp media migration | Triage bento + detail view + migration script | ~200 | Click Attachments bento → client list sorted by latest attachment date. Click client → file directory with source channel + direction. Click file → preview/download. Both channels in same `media/{client-slug}/` dir. Migration moves existing flat WhatsApp media into per-client dirs (content-hash filenames preserved, symlinks from old paths for backwards compat during rollout). |
| **WP-PM-7 Settings** | §10: email card in admin.html, test connection, env write | `admin.html` (modify) + `app/api/admin/settings/mail/route.ts` (NEW) | ~160 | Fill creds → Test → green dot. Save → .env.local updated. Bad password → red dot + error message. |
| **WP-PM-8 Pulse** | §12: stall/cooling detection + deck cards + status strip | `lib/mail-pulse.ts` (NEW) + strip in Overview | ~130 | 5d-silent proposal (§12 N=5, per-stage overridable) → CHASE card on deck. Reply kills card same sweep. Cooling (2N=10d silence on warm lead) → NUDGE card. Strip goes grey + "swept X min ago" on stopped sweeper. |
| **WP-PM-9 Schema** | §11: two activity columns + `suggestions` table via event-sourced migration (typed SQL columns in crm.db — no JSON blobs, no store outside the database) | `lib/crm-store.ts` (~30 delta) | ~50 | Replay from empty log rebuilds identical, drafts included. Migration idempotent. Two drafts same prospect+channel → second UPSERTs, never duplicates. |
| **WP-PM-10 Ask-Gate** | §04+§06: manual sweep endpoint, progress object, draft-gate, batched Consular call via ask-AI route | `app/api/admin/mail/sweep/route.ts` (NEW ~40) · `app/api/admin/crm/consular/email-inbound/route.ts` (NEW ~60) · `lib/mail-eyes.ts` (+45) · CHECK-EMAIL button + ticker (+35) | ~180 | Zero new mail → zero Consular calls (log proves it). WhatsApp inbound → zero Consular calls, ever. New mail + pending draft → gated, no call, strip counts it. New mail + empty slot → ONE bridge call for the whole batch → report in chat + drafts prefilled. Button shows live phases while sweeping. Kill the bridge mid-briefing → button + strip go RED naming the phase, filed mails stay filed, and the un-briefed batch survives ANY restart because it is derived, not stored: the next trigger's §06 SELECT returns it, briefs it (draft-gated at call time), and the SELECT empties itself through the outcomes' SQL traces. Declined prospect without a note → SELECT still returns it → test fails. Re-match: add an email address to a contact whose mail sits unmatched → next sweep (or CHECK EMAIL) files that mail onto the account, zero dupes on re-sweep, banner empties without manual cleanup. |

---

## 17 · Phased rollout

| Phase | Ships | Value shipped | Effort |
|---|---|---|---|
| **P0** | PM-7 (Settings) + PM-9 (Schema) | email account configured; database ready | ~1 day |
| **P1** | PM-1 (Eyes) + PM-10a (sweep endpoint + progress + CHECK EMAIL button) | every conversation on the record; corpus seeded; bento + feed alive; attachments downloaded; manual sweep with live progress ticker | ~2 days |
| **P2** | PM-4 (Island) + PM-5 (Compose) | email island live; inline compose; identity selector; click-to-send; attachments | ~2 days |
| **P3** | PM-2 (Voice) + PM-3 (Suggest-tool) + PM-10b (draft-gate + batched Consular call) | CRM sends email; Consular prefills replies via `suggest_reply`; draft-gate prevents re-briefing; diff-loop; Sent-ingest captures off-CRM sends | ~2 days |
| **P4** | PM-6 (Attachments bento + WhatsApp migration) + PM-8 (Pulse) | attachments browsable across both channels; stall/cooling cards on deck; status strip | ~1.5 days |

P0 → P1 = email becomes visible (and manually triggerable). P2 = email becomes actionable. P3 = email becomes intelligent. P4 = email becomes proactive.

---

## 18 · Honest cons & open questions

- **Latency is minutes, not push** (until IDLE upgrade). Email is not chat — acceptable.
- **SMTP send from CRM means the CRM IS an email client** — deliverability depends on the mailbox's SPF/DKIM, not a dedicated send infrastructure. For a single-user outreach mailbox, this is fine.
- **Consular tokens per sweep** — scales with real correspondence only (§06).
- **Q1 — mailbox scope:** V1 = one outreach mailbox (`@paradiso.dev`). Multi-account = config + one Settings card per account; decide when a second account exists.
- **Q2 — sweep cadence:** 3600s default (hourly — email is not chat). Tune against real traffic; the strip shows staleness. CHECK EMAIL button for manual trigger between sweeps.
- **Q3 — N for stalled:** 5 days default (§12: N=5, cooling=2N=10). Per-stage override (Closing shorter). Tune with Filippo after P4.
- **Q4 — retention:** `db/mail/` grows unbounded (KB-scale text + occasional large attachments). Proposal: keep forever; revisit at 1 GB.
- **Q5 — WhatsApp media migration:** current media saves to flat `media/` with content hash. Per-client dirs (`media/{client-slug}/`) require a migration of existing media. Scope it as part of WP-PM-6.
