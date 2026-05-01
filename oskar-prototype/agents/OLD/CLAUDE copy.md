# OskarOS — Booking Pages That Don't Look Like Booking Pages

## What This Is

A system for creating high-end, narrative-driven booking pages. Three AI agents working together automatically in Claude Code.

**The benchmark:** FalCaMel Café — a fictional Saudi cat café with a falcon, camel, and rescue cats on the Tuwaiq Escarpment. The COO agent holds the complete business knowledge. The Creative Director discovers and develops. The WebDeveloper builds.

**The problem we solve:** Most booking pages are generic. "Book Now." "Select a service." No voice. No feeling.

**What we produce:** A complete landing page with booking flow where the experience feels like part of the brand.

---

## The Three Agents

### 1. COO Agent
**File:** `coo-agent.md`
**Role:** Business owner. Holds all business knowledge. Answers discovery questions from Creative Director. Evaluates vibes against the benchmark.
**Knows:** The business facts, residents, menu, pricing, operations, tone, audience, enemy.
**Does NOT know:** What vibes the Creative Director will develop. That's the CD's job.
**CAN read:** `/inputs/` and `/outputs/` directories.

### 2. Creative Director Agent
**File:** `creative-director-agent.md`
**Role:** Discovery and branding. Interviews the COO to understand the business. Develops five distinct vibes. Presents to CEO for selection. Maintains the Creative Brief. Prepares Archetype Checklist before booking development.
**Knows:** How to ask questions, develop vibes, write briefs, iterate on feedback.
**Does NOT know:** Anything about the business until COO tells them.
**CANNOT read:** `/inputs/` or `/outputs/` — must discover through questions only.

### 3. WebDeveloper Agent
**File:** `webdeveloper-agent.md`
**Role:** Builder. Works with Creative Director to build landing pages and booking flows.
**Outputs:** HTML pages that maintain voice throughout — including form labels, CTAs, and microcopy.
**ONLY reads:** The Creative Brief provided by CD. Nothing else.

---

## The Workflow

### Phase 1: Discovery & Vibes

#### Step 1: Discovery — CD ←→ COO
Creative Director interviews COO about the business.

CD asks questions about:
- Identity, concept, location
- Signature experience
- Audience (who it's for, who it's NOT for)
- Tone and voice
- The residents/characters
- Offerings and pricing
- The enemy (what they hate about generic hospitality)

COO answers with specificity and conviction. If CD goes generic, COO pushes back.

Continue until CD can:
- Describe the business in one sentence that only fits THIS business
- Name the specific customer (not a demographic)
- Identify at least one weird detail that surprises
- Write a sample headline that sounds like the brand

#### Step 2: Vibe Development — CD + WebDev
Creative Director develops five distinct vibes based on discovery.
WebDeveloper builds landing pages ONLY (no booking yet).

Each vibe must include:
- Name and one-liner
- Voice (tone, attitude, word choice)
- Who it's for (specific person)
- Colors (with hex codes)
- Fonts
- Hero, hook, residents, menu, location, CTA, footer
- Full menu with prices (this is a café — people need to order drinks)

**Critical:** Landing pages only. No booking flows yet.

#### Step 3: Present to CEO — STOP
**STOP.** Present all five vibes to CEO (Ralph) for selection.

CEO chooses or mixes: "I want the hook from Qahwa, the menu section from Jareen, and the look of Majlis."

**Do not proceed without CEO selection.**

---

### Phase 2: Booking Development

#### Step 4: Update Creative Brief — CD
Creative Director updates the Creative Brief with CEO's selection.

Document:
- Which vibe(s) selected
- Which elements from which vibes
- Final voice and tone
- Final visual direction

#### Step 5: Archetype Checklist — CD → CEO
Before building booking, CD must verify the booking logic.

**The Five Archetype Questions:**

CD reviews discovery answers and compiles:

| # | Question | Answer from Discovery |
|---|----------|----------------------|
| 1 | What is the **Atomic Unit** of inventory? | [what is being booked — a seat? a room? an hour?] |
| 2 | Does customer pick **WHICH specific unit**? | [Yes: "Seat 4" / No: "any available"] |
| 3 | Can different parties book different units for **same time**? | [Yes: concurrent / No: exclusive] |
| 4 | Is duration **Rigid or Flexible**? | [Rigid: fixed slots / Flexible: pick hours] |
| 5 | How is **one unit** priced? | [per hour / per session / per person / flat] |

If any question wasn't answered in discovery, CD asks COO now.

CD then presents to CEO:

```
BOOKING LOGIC VERIFICATION

Based on discovery, here's how I understand your booking:

1. Atomic Unit: [answer]
2. Specific Unit Selection: [answer]
3. Concurrent Booking: [answer]
4. Duration Model: [answer]
5. Pricing Model: [answer]

Closest Archetype: [Library Seat / Lab Booking / Sports Facility / etc.]
Adjustments Needed: [specific changes for this business]

Is this correct?
```

**STOP.** Wait for CEO confirmation or correction.

#### Step 6: Build Final Page + Booking — CD + WebDev
Once CEO confirms booking logic:

CD gives final brief to WebDeveloper including:
- Selected vibe elements
- Archetype selection + adjustments
- Voice requirements for booking flow

WebDeveloper builds:
1. **Final landing page** — incorporating CEO's selections
2. **Booking flow** — based on approved archetype + adjustments

**Critical:** Voice must carry through the entire booking flow. Form labels, microcopy, CTAs — everything stays in character.

#### Step 7: Present to CEO — STOP
Present final landing page + booking flow to CEO for approval.

---

## Logging Requirements

### NON-NEGOTIABLE

Every question and answer must be logged **VERBATIM**.

DO NOT summarize.
DO NOT paraphrase.
DO NOT write "discussed X" or "Key insights provided."
PASTE the actual exchange.

### Session Log File
Create at session start:
```
outputs/logs/session-YYYY-MM-DD-HHMMSS.md
```

### Log Header
```markdown
# Session Log
**Date:** [DATE]
**Business:** [Business Name]
**Goal:** Discovery → Five vibes → CEO selection → Booking → Final approval
**Agents:** Creative Director, COO, WebDeveloper

---
```

### Log Format for Discovery (MANDATORY)

```markdown
---
## CD → COO | [TIME]

Q1: [EXACT question as asked]

Q2: [EXACT question as asked]

Q3: [EXACT question as asked]

---
## COO → CD | [TIME]

A1: [EXACT answer as given]

A2: [EXACT answer as given]

A3: [EXACT answer as given]
```

**NOT acceptable:**
```markdown
## COO | 02:08
**Action:** Discovery response to all 10 questions
**Key insights provided:**
1. Previous vibes: Qahwa hit the benchmark...
```

**This is a summary. This is forbidden. Paste the actual Q&A.**

### Log Format for Other Actions

```markdown
---
## [AGENT] | [TIME]
**Action:** [what they did]
**Content:** [the actual content — full, not summarized]
```

### Why Verbatim Logging Matters
- Audit trail for how vibes evolved
- See exactly what questions led to what answers
- Debug if output misses the mark
- The CD cannot claim to have asked something it didn't
- The COO cannot claim to have answered something it didn't

---

## Archetype Reference

When selecting closest archetype, use this guide:

### Pattern: Specific Unit + Concurrent Bookings + Time Blocks

| Archetype | Example | Atomic Unit |
|-----------|---------|-------------|
| **Library Seat** | Study spaces | Desk 4 in Zone A |
| **Lab Booking** | Research benches | Bench 3 |
| **Sports Facility** | Courts, lanes | Lane 3 in pool |

Use when: Customer picks specific unit. Multiple parties book different units same time. Time blocks.

### Pattern: Exclusive Resource + Time Blocks

| Archetype | Example | Atomic Unit |
|-----------|---------|-------------|
| **Creative Studio** | Photo/podcast studio | The whole studio |
| **Entertainment Venue** | Escape room | The whole room |
| **Workspace** | Meeting room | The whole room |

Use when: One party books entire resource. Exclusive use. Time blocks.

### Pattern: Spot in Session + Shared Capacity

| Archetype | Example | Atomic Unit |
|-----------|---------|-------------|
| **Fitness Class** | Yoga, HIIT | A spot in the 9am class |
| **Workshop** | Cooking class | A seat in the session |
| **Tour** | City tour | A spot on the 2pm tour |

Use when: Customer joins a scheduled session. Doesn't pick specific spot. Shared capacity with strangers.

### Pattern: Stay + Date Range

| Archetype | Example | Atomic Unit |
|-----------|---------|-------------|
| **Accommodation** | Hotel, rental | Room for date range |
| **Equipment Rental** | Camera gear | Item for date range |

Use when: Check-in/check-out dates. Not hourly.

### Pattern: 1:1 Appointment

| Archetype | Example | Atomic Unit |
|-----------|---------|-------------|
| **Healthcare** | Doctor visit | Appointment with Dr. Smith |
| **Beauty/Salon** | Haircut | Session with Jessica |
| **Professional** | Legal consult | Meeting with attorney |

Use when: One customer, one provider, specific time.

---

## Quality Standard

A vibe passes when:

1. **Has a complete menu** — drinks, sweets, prices. This is a café.
2. **Landing page has narrative flow** — not just sections stacked
3. **Every piece of copy is specific** — another business couldn't use it
4. **CTA makes people feel something** — guilt, warmth, excitement, pride

A booking flow passes when:

1. **Archetype verified by CEO**
2. **Voice carries through** — form labels, CTAs, microcopy all in character
3. **Logic matches the business** — not forced into wrong archetype

---

## The Benchmark

**Generic CTA:** "Book Now"

**Great CTA:** "Grandma's Waiting. She's already made too much food. Don't be late."

That's the standard. It makes you feel guilt and warmth simultaneously. Every headline, every CTA, every piece of copy should hit like that.

If it doesn't hit, it doesn't ship.

---

## Folder Structure

```
OskarOS/
├── CLAUDE.md                    (this file — orchestrator)
├── coo-agent.md                 (COO agent)
├── creative-director-agent.md   (CD agent)
├── webdeveloper-agent.md        (WebDev agent)
├── images/                      (sultan.jpg, haboob.jpg, etc.)
├── inputs/                      (business documents — COO can read, CD cannot)
└── outputs/
    ├── logs/                    (session logs — verbatim)
    └── [vibe-name]/             (HTML outputs per vibe)
```

---

## To Start a Session

Tell Claude Code:

```
Run the OskarOS workflow:

Phase 1:
1. CD discovery with COO (log verbatim Q&A)
2. CD + WebDev build five vibes (landing pages only, no booking)
3. Present five vibes to me (CEO) for selection — STOP

Phase 2 (after CEO selection):
4. CD updates Creative Brief with my selections
5. CD presents Archetype Checklist to me for approval — STOP
6. CD + WebDev build final landing page + booking flow
7. Present final to me for approval — STOP

Log everything verbatim to outputs/logs/session-[DATE]-[TIME].md
```

---

## Information Barriers

| Agent | Can Read | Cannot Read |
|-------|----------|-------------|
| COO | `/images/`, `/inputs/`, `/outputs/`, all logs | — |
| CD | `/images/`, `/outputs/` | `/inputs/` (business docs, previous briefs) |
| WebDev | `/images/`, Creative Brief from CD | `/inputs/`, COO agent file |

The barrier is about **business knowledge**. The CD must discover it through questions, not by reading `/inputs/`.
