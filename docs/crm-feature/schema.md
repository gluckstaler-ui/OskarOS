# CRM Prospects Schema

The CRM tab in `/admin.html` reads prospects from **one Excel file**:

```
docs/crm-feature/prospects.xlsx
```

This file is the single source of truth. Edits made via the CRM UI write back to the same file. The API route at `/api/admin/crm/prospects` reads it on every request (no caching). The seed file is regenerable via `node docs/crm-feature/generate-seed.mjs`.

## Sheet structure

Single sheet named **Prospects** with the following columns (header row at row 1, data from row 2):

| Column | Type | Required | Allowed values | Notes |
|---|---|---|---|---|
| `id` | string | yes | `P001`–`P999` | Unique. Auto-generated on new lead. |
| `company` | string | yes | — | Display name on cards + modal. |
| `contact_name` | string | yes | — | Person to call/email. |
| `phone` | string | no | Swiss format | `+41 76 234 56 78` |
| `email` | string | no | email | — |
| `website` | string | no | URL | No `https://` prefix needed. |
| `stage` | enum | yes | `Incoming` · `Contacted` · `Demo done` · `Closing` | Determines which board column. |
| `status` | enum | yes | `To do` · `Standby` · `Won` · `Lost` · `Cancelled` | Inside-modal status state machine. |
| `amount_chf` | number | yes | integer | CHF, no decimals. |
| `confidence_pct` | number | yes | 0–100 | Integer. |
| `next_action_date` | date | yes | ISO `YYYY-MM-DD` | When the next action is due. |
| `next_action_label` | string | yes | `1d upcoming` · `3d upcoming` · `1d overdue` · `TODAY` · etc. | Derived from `next_action_date` on render. Stored for fidelity. |
| `tags` | string | no | comma-separated | e.g. `Cold-call, Tessin, Referral` |
| `starred` | boolean | yes | `TRUE` · `FALSE` | Card star indicator. |
| `owner` | string | yes | — | Default `Filippo`. |
| `notes` | string | no | free text | Comment field in modal. |
| `created_at` | datetime | yes | ISO `YYYY-MM-DDTHH:mm:ssZ` | When the lead entered the CRM. |

## Session links

When Filippo clicks **+ Start New Session** in the lead modal, the new session ID is appended to `public/_crm/links.json`:

```json
{
  "P011": [
    {
      "sessionId": "2026-05-22-hotel-bellevue-lugano",
      "createdAt": "2026-05-22T14:30:00Z",
      "outcome": null
    }
  ]
}
```

Each prospect maps to an array of session entries. `outcome` is `null` until the session reaches Phase 5 (Handoff), then `"won"` / `"lost"` / `"abandoned"`.

## Activity log (Phase 2)

The History timeline in the lead modal is currently rendered from a hardcoded list per lead. Phase 2 will persist activities to a second sheet `Activities` with columns: `prospect_id`, `timestamp`, `type`, `duration_min`, `notes`. Out of scope for v1.

## Stages — Filippo's working language

The 4 stages reflect Filippo's LED-services sales pipeline:

- **Incoming** — lead identified, not yet contacted (cold list, walk-in, referral)
- **Contacted** — first call made, qualified, awaiting next action
- **Demo done** — proposal/demo presented, awaiting decision
- **Closing** — verbal yes, contract in flight, payment pending

These are mutable — Filippo can rename them in v2 without breaking the schema (stored as plain strings).

## Status state machine

Inside any stage, status tracks the *current micro-step*:

- **To do** — next action is due, on Filippo's plate
- **Standby** — waiting on the prospect; reminder set for a future date
- **Won** — closed, terminal
- **Lost** — declined, terminal
- **Cancelled** — abandoned (no-show, ghosted), terminal
