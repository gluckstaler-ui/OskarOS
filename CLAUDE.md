# OskarOS — Booking Pages That Don't Look Like Booking Pages

## What This Is

A system for creating high-end, narrative-driven booking pages for any business. Two AI agents, one human COO, one human CEO.

**The problem we're solving:** Most booking pages are generic. Select a service. Pick a time. Enter your email. Submit. No voice. No story. No feeling.

**What we produce:** Pages where the booking experience feels like part of the brand, not a form bolted onto it.

---

## Architecture

```
CEO (Human)
    ↓ "Build booking pages for [business]"
    ↓ Provides images (generates via Nano Banana if needed)
    ↓ Provides fonts (if custom)
    
COO (Claude in claude.ai Project)
    ↓ Holds all business knowledge
    ↓ Answers agent questions
    ↓ Approves vibes
    ↓ Reviews output
    
Creative Director Agent (Claude Code)
    ↓ Interviews COO to discover the brand
    ↓ Develops 3-5 vibe options
    ↓ Outputs Creative Brief + Image Brief
    
WebDeveloper Agent (Claude Code)
    ↓ Receives Creative Brief + Images
    ↓ Builds landing page + booking flow
    ↓ Outputs production-ready HTML
```

---

## The Agents

### Creative Director Agent
**File:** `creative-director-agent.md`

**Knows:** How to ask questions. How to develop vibes. How to write a brief.

**Does NOT know:** Anything about the specific business. Must discover everything through conversation with the COO.

**Outputs:**
- 3-5 Vibe options for approval
- Creative Brief (for WebDeveloper)
- Image Brief (for CEO → Nano Banana)

### WebDeveloper Agent
**File:** `webdeveloper-agent.md`

**Knows:** How to build HTML. How to maintain voice through booking flows. Technical implementation.

**Receives:**
- Creative Brief from Creative Director
- Images from CEO
- Fonts from CEO (if custom)

**Outputs:**
- Landing page HTML
- Booking flow HTML
- All files to `/outputs/`

---

## Workflow

### Step 1: CEO Initiates
CEO tells Claude Code: "Build booking pages for [business]"

### Step 2: Creative Director Interviews COO
Creative Director Agent asks questions. CEO copies questions to claude.ai Project. COO (in that Project) answers. CEO pastes answers back.

### Step 3: Vibes Developed
Creative Director presents 3-5 vibes. COO picks one (or requests iteration).

### Step 4: Brief Output
Creative Director outputs:
- Creative Brief → goes to WebDeveloper
- Image Brief → goes to CEO

### Step 5: Image Generation (if needed)
CEO uses Image Brief with Nano Banana to generate images. Places them in `/assets/images/`.

### Step 6: WebDeveloper Builds
WebDeveloper Agent receives Brief + Images. Builds pages. Outputs to `/outputs/`.

### Step 7: COO Reviews
CEO syncs repo to claude.ai Project. COO reviews output. Provides feedback if needed.

### Step 8: Iteration or Ship
Repeat until COO approves. Then ship.

---

## Folder Structure

```
OskarOS/
├── CLAUDE.md                    (this file)
├── creative-director-agent.md   (Creative Director prompt)
├── webdeveloper-agent.md        (WebDeveloper prompt)
├── assets/
│   ├── images/                  (business images)
│   └── fonts/                   (custom fonts if any)
└── outputs/                     (generated HTML pages)
```

---

## Running the Agents

### Run Creative Director:
```bash
cd ~/OskarOS
claude --prompt "$(cat creative-director-agent.md)"
```

### Run WebDeveloper:
```bash
cd ~/OskarOS
claude --prompt "$(cat webdeveloper-agent.md)"
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

## What "Great" Looks Like

**Generic CTA:** "Book Now"
**Great CTA:** "Grandma's Waiting. She's already made too much food."

**Generic offering:** "2-hour pottery workshop with materials included"
**Great offering:** "Two hours. Your hands in clay. Whatever emerges, we fire it. Even the disasters. Especially the disasters."

**Generic form label:** "Select party size"
**Great form label:** "Who's coming to dinner?"

The voice never drops. From hero to footer to booking form.
