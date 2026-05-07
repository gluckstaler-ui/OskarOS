# WP-4.1 — Hyperframes integration

**Status:** SCAFFOLD / DECISION-PENDING (2026-05-02)
**Owner:** Jedi Code, with Ralph deciding hosting model
**Reference plan:** `docs/FEATURE-X.md` §1.4.5 WP-4.1
**Upstream:** [`heygen-com/hyperframes`](https://github.com/heygen-com/hyperframes), Apache-2.0

---

## What hyperframes does

HTML-based video compositions: a project folder with `index.html` (GSAP-driven
animation timeline + `data-duration` attribute) → renderer plays it through
Puppeteer with frame capture → ffmpeg encodes the captured frames into an
`.mp4`. Out the other side: a single video artifact.

OD's pattern (visible in `external/open-design/skills/hyperframes/SKILL.md`):

```
npx hyperframes init <comp-name> --example blank
# author index.html — palette + clip <div>s + GSAP tweens
# daemon dispatches: `npx hyperframes render <comp-name>` (NOT raw shell)
# poll: `od media wait <taskId>` long-polling 25s windows
# final mp4 lands; only the .mp4 ships as a project chip — the
# composition source files cache in `.hyperframes-cache/`
```

OskarOS already has animation doctrine (huashu visual-styles) but no
compile-to-video path. WP-4.1 closes that gap.

---

## The decision Ralph hasn't made yet

**Local-host the renderer (Puppeteer + sandbox-exec dance) vs. HeyGen's
hosted API.**

OD chose local-host because their daemon already runs unsandboxed Bash, so
`npx hyperframes render` works without the Chrome-in-sandbox-exec hang that
Claude Code triggers when running Puppeteer through the CLI sandbox. OskarOS
runs in a similar Claude-Code shape — same problem.

| Option | Pro | Con | Cost shape |
|---|---|---|---|
| **A — Local Puppeteer** (OD pattern) | No external dep · full control · all rendering happens on Ralph's box · brand assets stay local | macOS sandbox-exec dance for Claude Code; needs the daemon to spawn the renderer in an unsandboxed child · adds Puppeteer dep · Chrome auto-update breakage risk · slow on long compositions | One-time integration: 1-2 weeks. Then $0/render, ~5-15s per second of output on M-series. |
| **B — HeyGen hosted API** | Zero local infrastructure · scales effortlessly · no Puppeteer headaches · rendering decoupled from app process | External dep · per-render cost · brand assets leave the box · API surface evolves on their schedule · vendor-lock | Integration: 3-5 days. Then per-render cost (HeyGen pricing TBD; check before deciding). |
| **C — Both, behind a flag** | Optionality · dev-friendly local renders, ship-friendly hosted renders | Doubled integration surface · drift risk between paths | 2-3 weeks. |

**Decision needed from Ralph:** A, B, or C. Without it, no code lands.

---

## What's prepped already

Nothing in code yet. Hyperframes is a Phase 4 active-scope item, but
WP-4.1 specifically needs Ralph's hosting decision before integration
starts. The scaffolding below is the rails, not the train.

### Files / directories that DO NOT exist yet (will land per choice)

```
oskar-prototype/
├── lib/hyperframes/
│   ├── client.ts           — typed wrapper. ONE of: local-spawn (option A),
│   │                          fetch HeyGen (option B), feature-flagged (C)
│   ├── compositions.ts     — read/write composition templates from /templates/
│   └── render-poll.ts      — long-poll wrapper matching OD's `od media wait`
├── app/api/mcp/render-video/route.ts
│                           — MCP server endpoint backing a future
│                             `render_video` tool (Family 2 capability)
├── mcp-server/tools-hyperframes.ts
│                           — `render_video(composition, duration?)` tool
│                             definition + dispatch handler
├── templates/hyperframes/
│   ├── product-launch/
│   ├── case-study/
│   └── brand-reveal/
│                           — starter compositions per OskarOS deliverable
│                             type. Authored later.
└── public/{session}/.hyperframes-cache/
                            — per-session render cache (option A only).
                              Cleaned by Order 66.
```

### Agent doctrine additions (also pending)

- `agents/creative-director-agent.md` — section "Video deliverables: when
  to call `render_video`". Triggers: customer asked for a launch video,
  case study reel, brand reveal, animated logo.
- `docs/INSTITUTIONAL-MEMORY.md` — Don't-Do entries:
  - "Never run `npx hyperframes render` from a Claude Code Bash call —
    sandbox-exec hangs Puppeteer's Chrome." (only matters in option A)
  - "Composition source files belong under `.hyperframes-cache/` — only
    the `.mp4` lands as a session artifact."

---

## Integration checkpoints (post-decision)

Per FEATURE-X.md §1.4.5 estimate ("2-3 weeks of integration work, depending
on whether we host the renderer locally or use HeyGen's hosted API"). Below
is the path for each option.

### Option A — Local Puppeteer

1. Add `puppeteer` + `hyperframes` to `package.json`. Verify Chrome
   downloads on first install.
2. Decide where the renderer process spawns. Two viable parents:
   - **MCP server** (the one at `app/api/mcp/server/route.ts`) — runs
     unsandboxed; spawning Puppeteer here mirrors OD's daemon pattern.
   - **A fresh sidecar process** spawned at app start — clearer boundary
     but more lifecycle to manage.
3. Implement `lib/hyperframes/client.ts` that takes a composition path,
   dispatches `npx hyperframes render`, polls until done, returns the
   final .mp4 path.
4. Wire `/api/mcp/render-video` POST endpoint that delegates to the client.
5. Define `render_video(composition, duration?)` MCP tool in
   `mcp-server/tools-hyperframes.ts` and register it in `mcp-server/index.ts`.
6. Add agent permission scoping — CD gets `render_video` in its allowed
   tools; WebDev / Sentinel do not.
7. Author 3 starter composition templates under `templates/hyperframes/`.
8. Add Order 66 cleanup: `rm -rf public/{session}/.hyperframes-cache/` to
   the death protocol.
9. E2E case `video-render-success` (new flow added to `e2e/cases/`) —
   nightly tier; mock-strategy 'live' only (real Puppeteer + ffmpeg).
10. Doctrine entries land in CD's prompt + INSTITUTIONAL-MEMORY.

### Option B — HeyGen hosted

1. BYOK pattern: HeyGen API key entered in BRANDING tab (lift WP-B1
   pattern). Stored encrypted alongside other tenant credentials.
2. Implement `lib/hyperframes/client.ts` as a thin fetch wrapper around
   HeyGen's render endpoints. Retry / backoff per their rate-limit docs.
3. `/api/mcp/render-video` POST → forwards to HeyGen, polls status, returns
   the rendered .mp4 url (or downloads + caches locally so the chip points
   at a session-folder file rather than an external URL).
4. Same `render_video` MCP tool as option A (interface contract identical).
5. Same templates, same doctrine, same e2e case — but mock-strategy can
   be 'mock' for unit-cost-sensitive runs and 'live' for nightly.

### Option C — Feature flag

Both implementations behind `OSKAR_HYPERFRAMES_BACKEND=local|hosted`. Same
MCP tool surface, same templates, same agent doctrine. Doubles integration
surface and adds drift risk; only sane if you have a real reason to want
both (e.g. dev local, prod hosted).

---

## Risks worth naming

- **Composition authoring is its own skill.** `templates/hyperframes/<name>/`
  needs hand-authored GSAP timelines per template type. That's CD/WebDev
  territory in the current Order, but neither has experience yet. First
  production render will be rough.
- **macOS sandbox-exec is a moving target.** Apple changes the rules. OD
  noticed this; we will too. Local-host (option A) inherits this risk.
- **HeyGen pricing is unknown.** Option B's per-render cost could make
  video deliverables uneconomic at scale. Check before committing.
- **Render duration scales with composition length × resolution.** A
  60-second 4K reveal at 60fps → 14,400 frames captured at ~50ms each
  → 12 minutes per render on M-series. Not interactive.

---

## What happens after WP-4.1 ships

- `render_video` MCP tool callable from CD with `composition` + optional
  `duration` and `outputName`.
- ToolCard render: video thumbnail (lazy), duration chip, "View full"
  expand. Slot in the 3-tier card system at Tier 2 (Action receipt).
- Templates available via direction-cards-style picker in the discovery
  flow when "video deliverable" is one of the 5-direction options.
- Sentinel Ti gains a `submit_video_critique` variant if needed (TBD).

---

## Pointer

Owner of next move: Ralph picks A / B / C. No code lands until that
decision. Once chosen, WP-4.1 splits into a 1-2 week integration sprint
plus a 3-template authoring pass (CD-led).

— JC (2026-05-02)
