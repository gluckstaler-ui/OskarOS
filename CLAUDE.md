# OskarOS — Booking Pages That Don't Look Like Booking Pages

## What This Is

A system for creating high-end, narrative-driven booking pages. Three AI agents working together in Claude Code.

**The benchmark:** FalCaMel Café — a fictional Saudi cat café with a falcon, camel, and rescue cats on the Tuwaiq Escarpment. The COO agent holds this complete brand universe as the quality standard.

**The problem we solve:** Most booking pages are generic. "Book Now." "Select a service." No voice. No feeling.

**What we produce:** Pages where the booking experience feels like part of the brand.

---

## The Three Agents

### 1. COO Agent
**File:** `coo-agent.md`
**Role:** Brand guardian. Holds all business knowledge. Answers questions from other agents. Approves vibes. Reviews output. Demands quality.
**For FalCaMel:** Knows the five vibes, four residents, all copy, all pricing, everything.
**For other businesses:** Would be customized with that business's knowledge.

### 2. Creative Director Agent  
**File:** `creative-director-agent.md`
**Role:** Discovery and branding. Interviews the COO to understand the business. Develops 3-5 vibe options. Outputs Creative Brief + Image Brief.
**Knows:** How to ask questions, develop vibes, write briefs.
**Does NOT know:** Anything about the business until COO tells them.

### 3. WebDeveloper Agent
**File:** `webdeveloper-agent.md`
**Role:** Builder. Takes Creative Brief + images and builds production-ready HTML.
**Outputs:** Landing pages + booking flows that maintain voice throughout.

---

## Setup in Claude Code

### Step 1: Open Claude Code in the project folder
```bash
cd ~/OskarOS
claude
```

### Step 2: Start the workflow
Tell Claude Code which agent to run:

**To run as COO:**
```
Read coo-agent.md and become the COO. Wait for questions from the Creative Director.
```

**To run as Creative Director:**
```
Read creative-director-agent.md and become the Creative Director. Interview the COO about the business.
```

**To run as WebDeveloper:**
```
Read webdeveloper-agent.md and become the WebDeveloper. I'll provide the Creative Brief.
```

### Step 3: Agent Communication
For now, you (CEO) facilitate communication:
- Creative Director asks a question → you paste it to COO
- COO answers → you paste answer back to Creative Director
- Continue until vibes are developed and approved
- Then hand the Creative Brief to WebDeveloper

---

## Workflow for FalCaMel

1. **Start Creative Director** — interviews COO about FalCaMel
2. **COO responds** — from the complete brand knowledge in coo-agent.md
3. **Creative Director develops vibes** — should rediscover something close to our five vibes
4. **COO approves** — picks a vibe or requests changes
5. **Creative Director outputs** — Creative Brief (we already have images, skip Image Brief)
6. **Start WebDeveloper** — receives Creative Brief + images from /assets/images/
7. **WebDeveloper builds** — landing page + booking flow to /outputs/
8. **COO reviews** — accepts or requests changes

---

## Workflow for New Businesses

Same flow, but:
- COO agent gets customized with that business's knowledge (or CEO provides answers)
- Image Brief goes to CEO for generation via Nano Banana
- Images placed in /assets/images/ before WebDeveloper builds

---

## Folder Structure

```
OskarOS/
├── CLAUDE.md                    (this file)
├── coo-agent.md                 (COO — brand guardian)
├── creative-director-agent.md   (Creative Director — discovery & vibes)
├── webdeveloper-agent.md        (WebDeveloper — builder)
├── assets/
│   ├── images/                  (sultan.jpg, haboob.jpg, etc.)
│   └── fonts/                   (DINPro-*.ttf)
└── outputs/                     (generated HTML pages)
```

---

## Quality Standard

A page passes if:

1. Someone would say "This looks like a proper website, not a booking tool"
2. Every piece of copy is specific to THIS business
3. The page has narrative flow, not just sections
4. There's a distinctive voice throughout
5. The CTA makes people feel something
6. The booking flow maintains the voice (doesn't drop to generic forms)
7. Zero generic language anywhere

---

## The Benchmark

**Generic CTA:** "Book Now"
**Great CTA:** "Grandma's Waiting. She's already made too much food. Don't be late."

That's the standard. Everything we produce must hit that bar.

---

## Conversation Logging

Every agent exchange must be logged. This creates an audit trail of decisions, allows review, and helps debug issues.

### Log File Location
```
outputs/logs/session-YYYY-MM-DD-HHMMSS.md
```

### Log Format
After each agent response, append:

```markdown
---
## [AGENT NAME] | [TIMESTAMP]

**Prompt/Question:**
[What was asked]

**Response:**
[What the agent said]
```

### Starting a Session
At the start of each session, create the log file with a header:

```markdown
# Session Log — [DATE]

**Business:** [Business name]
**Goal:** [What we're building]
**Agents involved:** [COO, Creative Director, WebDeveloper]

---
```

### Example Log Entry

```markdown
---
## CREATIVE DIRECTOR | 2025-01-03 14:32

**Prompt/Question:**
Tell me about your business. What do you actually do?

**Response:**
We're FalCaMel Café — a Saudi-themed cat café with a falcon, a camel, and rescue cats, perched on the Tuwaiq Escarpment overlooking Qiddiya...

---
## COO | 2025-01-03 14:35

**Prompt/Question:**
[Creative Director's question above]

**Response:**
[COO's answer with full brand details]
```

### Why This Matters
- Track how vibes evolved
- See what questions led to breakthroughs
- Review COO approvals
- Debug if output misses the mark
