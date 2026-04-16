# Agent Orchestration

How the three agents coordinate.

---

## The Agents

| Agent | Responsibility | Reads | Writes |
|-------|---------------|-------|--------|
| **COO** | Testing, workarounds | Everything | Everything (for testing) |
| **CD** | Discovery, vibes, prompts | SESSION.md, IMAGES.md, CREATIVE-BRIEF.md | SESSION.md, IMAGES.md, CREATIVE-BRIEF.md |
| **WebDev** | Build HTML, hot-swap | CREATIVE-BRIEF.md, BUILD.md | BUILD.md, vibe HTML files |

---

## Information Barriers

```
CD CANNOT read: BUILD.md
WebDev CANNOT read: SESSION.md
COO CAN read: Everything (for testing/debugging)
```

The barrier is about focus:
- CD focuses on WHAT to build
- WebDev focuses on HOW to build
- COO focuses on making sure it WORKS

---

## The Four Phases

```
┌────────────────────┬──────────────────────┬───────────────────────┬───────────────────────────┐
│ PHASE 1: DISCOVERY │ PHASE 2: VIBES       │ PHASE 3: BUILD        │ PHASE 4: POLISH           │
├────────────────────┼──────────────────────┼───────────────────────┼───────────────────────────┤
│                    │                      │                       │                           │
│  User uploads      │  CD develops         │  WebDev building      │  User reviews vibes       │
│  images            │  5 vibes             │  (already started)    │        ↓                  │
│        ↓           │        ↓             │        ↓              │  User selects/mixes       │
│  CD asks           │  CD writes           │  Mini-buses           │  (Director Mode)          │
│  questions         │  CREATIVE-BRIEF      │  leaving as user      │        ↓                  │
│        ↓           │        ↓             │  approves             │  Final page assembled     │
│  User answers      │  WebDev STARTS       │        ↓              │        ↓                  │
│        ↓           │  (brief handoff)     │  Images arrive        │  User approves            │
│  CD analyzes       │        ↓             │  → hot-swap           │        ↓                  │
│  uploaded images   │  CD crafts image     │  → snackbar           │  DONE                     │
│        ↓           │  prompts             │        ↓              │                           │
│  Discovery         │        ↓             │  User clicks [View]   │                           │
│  complete          │  User approves       │  whenever ready       │                           │
│        ↓           │  prompts             │        ↓              │                           │
│  ════════════      │        ↓             │  All complete         │                           │
│  STOP              │  ════════════════    │        ↓              │                           │
│  (user greenlights)│  NO STOP             │  ════════════         │                           │
│                    │  TRAIN LEFT          │  STOP                 │                           │
│                    │  ════════════════    │  (await user)         │                           │
└────────────────────┴──────────────────────┴───────────────────────┴───────────────────────────┘
```

---

## Stops and Handoffs

| End of Phase | What Happens | User Action Required |
|--------------|--------------|---------------------|
| Phase 1 → Phase 2 | STOP | User greenlights discovery |
| Phase 2 → Phase 3 | NO STOP | WebDev starts when brief ready |
| Phase 3 → Phase 4 | STOP | User reviews vibes |
| Phase 4 → Done | STOP | User approves final |

---

## The Key Handoff: CD → WebDev

```
CD finishes discovery
         │
         ▼
CD writes CREATIVE-BRIEF.md
         │
         ├──────────────────────────────────┐
         │                                  │
         ▼                                  ▼
    WebDev STARTS                   CD crafts image
    BUILDING IMMEDIATELY            prompts
    (reads brief, begins Vibe 1)          │
         │                                  │
         │                                  ▼
         │                          User reviews prompt 1
         │                                  │
    Building Vibe 1...                      ▼
         │                          [Approve] → mini-bus leaves
         │                                  │
    Building Vibe 2...                      ▼
         │                          User reviews prompt 2
         │                                  │
         │  ←───── IMAGE ARRIVES ───────────┤
         │         (interrupt!)             │
         ▼                                  ▼
    Hot-swap into                   [Approve] → mini-bus leaves
    appropriate vibe                        .
    Resume building                         .
```

Key points:
1. **WebDev starts FIRST** — before prompts are even approved
2. **Parallel work** — CD crafts prompts while WebDev builds
3. **Mini-bus architecture** — each approved prompt leaves immediately
4. **Interrupts** — WebDev handles image arrivals as they come

---

## Mini-Bus vs Freight Train

**FREIGHT TRAIN (wrong):**
```
Wait for all prompts → Wait for all approvals → Wait for all images → THEN ship
```

**MINI-BUS (right):**
```
Each prompt approved → that bus leaves → image arrives → hot-swap → next
```

User sees progress immediately. Not everything at once at the end.

---

## Snackbar Events

| Event | Snackbar | Action |
|-------|----------|--------|
| Vibe ready | ✅ "Qahwa ready" | [View] |
| Image ready | 🖼️ "Hero ready" | [View] [Re-prompt] |
| Hot-swap | 🔄 "Qahwa updated" | [View] |
| Re-prompt sent | ⏳ "Regenerating..." | (progress) |
| All complete | 🎉 "All vibes ready!" | [Compare] |
| Error | ❌ "Failed" | [Retry] |

No "show me" moment. User discovers through notifications.

---

## File Flow

```
                    PHASE 1                    PHASE 2                      PHASE 3
                   Discovery                    Vibes                        Build
                      │                           │                            │
                      ▼                           ▼                            ▼
              ┌──────────────┐           ┌────────────────────┐        ┌─────────────┐
    User ───▶│  SESSION.md  │◀── CD     │ CREATIVE-BRIEF.md  │──────▶ │  BUILD.md   │
              └──────────────┘           └────────────────────┘        └─────────────┘
                      │                           │                            │
                      ▼                           │                            ▼
              ┌──────────────┐                    │                   ┌─────────────────┐
    User ───▶│  IMAGES.md   │◀── CD ◀────────────┘                   │ vibe-*.html     │
    images   └──────────────┘                                        │ final-*.html    │
                                                                     └─────────────────┘
```

---

## Error Recovery

| Error | Who Handles | Recovery |
|-------|-------------|----------|
| Image generation fails | CD | Re-prompt, log to IMAGES.md |
| Vibe build fails | WebDev | Retry, log to BUILD.md |
| Hot-swap fails | WebDev | Retry, log to BUILD.md |
| Brief update during build | WebDev | Adjust affected vibes |
| File permission error | COO | Use workaround, log |

---

## Two Tracks, Same Output

```
CLI Track                              API Track
─────────                              ─────────
spawn('claude')                        fetch(anthropic API)
     │                                      │
     ▼                                      ▼
Reads/writes                           Returns content
/public/{session}/                     Node.js writes to
directly                               /public/{session}/
     │                                      │
     └──────────────┬───────────────────────┘
                    │
                    ▼
            SAME FOLDER
            SAME FILES
```

Both tracks produce identical folder structure.
Switching between CLI and API should be transparent.
