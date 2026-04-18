# OskarOS — Audit

**Auditor:** External script doctor, brought in for a holistic read.
**Date:** 2026-04-18
**Scope:** Agent layer, TypeScript spec layer, Next.js prototype, generated outputs.

---

## What this actually is

Not a "booking page generator." Three layers stacked:

1. **A multi-agent creative discovery system** (COO ↔ Creative Director ↔ WebDev). The COO is a *character* — a fictional witness who holds the brand truth and refuses to let the CD go generic. The CD must discover that truth through interview, *not* by reading the inputs folder. Information barriers between agents are enforced by file-system permissions in the agent prompts. Discovery is logged verbatim.

2. **A booking-archetype taxonomy** (Library Seat / Lab Booking / Sports Facility / Creative Studio / Entertainment Venue / Workspace / Fitness Class / Workshop / Tour / Accommodation / Equipment Rental / Healthcare / Beauty / Professional). Five archetype questions reduce any business to a known pattern. This is a real classification, not a marketing list.

3. **A serious Next.js 16 / React 19 product** (`oskar-prototype/`) with 40+ API routes, dual-model orchestration (Claude Code SDK subprocess + Anthropic API loop + Gemini), persistent conversation bridges (Order 65/66 — yes, Star Wars), a memory-compaction system (Lumberjack + Dreamer), live-preview iframes with Director-mode editing, image lineage with proofread/verdict loops, hot-swap slot mapping, and a thumbnail generator powered by Puppeteer.

If you only saw the HTML in `/outputs/`, you'd think this is a static-site generator. It's not. Those outputs are *artifacts*. The thing being built is a **creative workflow platform that uses fictional character agents to fight against the gravitational pull of generic AI copy.**

---

## Round 1 — Verdict before market context

Ten criteria. 1–10. No grade inflation.

| # | Criterion | Score | Why |
|---|-----------|-------|-----|
| 1 | **Conceptual ambition** | **9** | The agent-as-character idea (COO holds the truth, CD must dig) is the thesis. Brilliant framing. |
| 2 | **Voice & copy quality (the actual deliverable)** | **8** | Costantino, 20:47, The Loop pages have lines that stop you. "D'Buechig isch immer für nächst Wuche gsi." That's craft. |
| 3 | **Agent prompt design** | **8** | COO prompt is itself a piece of writing — Schwiizerdütsch, push-back phrases, evaluation rubric, benchmark CTAs. Information barriers are real. |
| 4 | **System architecture (prototype)** | **7** | Lumberjack/Dreamer memory, hot-swap, image lineage, bridge persistence — all clean abstractions. Some code is gorgeous. |
| 5 | **Code quality / typing rigor** | **4** | `app/page.tsx` is 2500+ lines of state soup with `any` casts. No `tsc --strict`. The libs are typed; the app shell isn't. |
| 6 | **Testing** | **4** | Vitest + Playwright wired up. Real unit tests on hot-swap, creative-brief-parser, memory. Zero E2E coverage on the chat → vibe → build path. |
| 7 | **Security / production-readiness** | **2** | `app/api/test-backdoor/route.ts` is an unauthenticated stateful handler. Order66 has a race. Subprocess spawn paths are unvalidated. **Demo-only.** |
| 8 | **Booking flow completion (the stated deliverable)** | **3** | Eleven beautiful Bareggcenter landing pages. **Zero functional booking flows.** CTAs link to `#booking` and die. The Archetype Checklist Phase 2 hasn't actually shipped. |
| 9 | **Logging discipline** | **9** | The verbatim-Q&A rule is enforced and the logs prove it. That's how WebDev preserved Costantino's exact quotes. |
| 10 | **Internal consistency (does the meta match the delivery?)** | **6** | The system tells you to be weird. Most outputs *are* weird. But FalCaMel slipped into Aman-hotel mush. The Nein button page is conceptually wild but the surrounding layout is generic Helvetica. |

**Round 1 verdict: 60/100. Brilliant ideas, half-built product, security debt, and the booking-flow promise hasn't been kept.**

---

## What I went and Googled

I focused on the parts that *felt* unique. Six searches.

### Verified unique-ish

**The fictional-COO-as-character pattern.** I couldn't find any AI website builder that uses a "the business owner is a literary character who pushes back on generic copy" model. Wix, Manus, involve.me, LandingHero — they all converge on "give us your business name, we generate polish." The OskarOS approach (CD has *no* read access to `/inputs/`, must extract truth through Q&A) is genuinely uncommon. Closest analogues are agentic marketing systems (Jasper, Adobe Experience Platform agents) but those are pipeline tools for B2B teams, not opinionated character actors.

**The booking archetype taxonomy.** Academic papers on booking system patterns exist (a 2009 paper from researchgate on "patterns for online-booking systems" is the canonical one, plus a TUI Medium piece on architecture patterns). Nobody productizes these archetypes as a customer-facing classification with friendly names. SimplyBook, SuperSaaS, Calendly — all configure rather than classify. **The 5-question Archetype Checklist is a small but real contribution.**

**Lumberjack + Dreamer memory pattern.** Zero search results for the names. Padawan Sage, six-stage compaction passes, `_sageLock`, clock-block — this is bespoke. Adjacent work exists (Anthropic's own context-management writing, MemGPT, Letta) but the specific "two-phase forester + portrait painter" framing isn't in the corpus. Could be publishable as a pattern.

**Image lineage + proofread + verdict loop.** "Image lineage" returned data-lineage tools (Atlan, Solidatus, Relyance) — but those are governance/compliance tooling for *training data*. The OskarOS thing is different: a per-asset audit trail of `userPrompt → CD-rewrite → actualPromptSent → returned image → CD-verdict → ✓/✗ → regenerate`. As a creative-workflow pattern this is real — closest analogue is Midjourney's `--seed` history but without the editorial loop.

### Not unique

**Runaway button.** This is a 2010-era CodePen gimmick. GitHub repos: `delnolan/runaway-button`, `sparpo/runawayButton`, `DenisGas/Runaway-button-v1`. There's even an "Anti-AI UI Framework" that lists it as a pattern. **What's novel here is not the JS — it's the framing.** "Öise Nei-Böttön chönd nur fiti Lüt klicke" turns a tired prank into a brand statement: *we're a sport center; even our UI requires fitness.* That's the move. The implementation is competent (real `mouseenter` + proximity detection, jump counter, the 0.3s pause from the brief). But strip the frame and you're back to CodePen 2014.

**AI landing page builders with "voice."** Manus, LandingHero, involve.me, Wix AI — they all *claim* brand voice. The actual market output (per the searches) is "handcrafted, perfect for any space, elevate your home" — generic mush. That's the exact failure mode this whole project is built to refuse. Which is the strongest argument for the COO-as-character pattern: nothing on the market produces a "Costantino sieht alles" hero or a "Du hesch dich nie meh dihei gfühlt" closer. You can't get there with chat-it-up onboarding because nobody answering "describe your brand" types the truth.

---

## Round 2 — Verdict with market context

Re-scoring against the field, not against the spec.

| # | Criterion | R1 | R2 | Why moved |
|---|-----------|----|----|-----------|
| 1 | Conceptual ambition | 9 | **9** | Holds. The character-agent thesis is genuinely contrarian to the industry. |
| 2 | Voice & copy quality | 8 | **9** | After reading Wix/Manus output samples, the OskarOS copy is in a different league. The bar is *that* low. |
| 3 | Agent prompt design | 8 | **9** | Compared to the "AI brand voice agent" output everyone else ships, the COO prompt is a piece of dramaturgy. The "push back" library alone is rare craft. |
| 4 | System architecture | 7 | **8** | Lumberjack/Dreamer with no search hits = either novel or under-published. Image lineage with proofread/verdict loop is a real pattern. Bumped one for novelty. |
| 5 | Code quality | 4 | **4** | The market doesn't grade on this; users don't see types. But it's risk debt for the team. |
| 6 | Testing | 4 | **5** | The memory-system integration tests are better than anything Wix/SimplyBook publish. Slight bump. |
| 7 | Security | 2 | **2** | `test-backdoor` route stays terrifying regardless of context. |
| 8 | Booking flow completion | 3 | **3** | The market *has* booking. OskarOS doesn't. This gap is more painful in context, not less. The whole archetype taxonomy work is wasted if no archetype is wired up. |
| 9 | Logging discipline | 9 | **9** | The verbatim Q&A rule is a safeguard against the exact way these systems usually decay. Holds. |
| 10 | Internal consistency | 6 | **6** | FalCaMel-going-Aman is still the canary. Means the prompt isn't strong enough to resist genericization when the COO isn't pushing back. |

**Round 2 verdict: 64/100.**

The score barely moved, but the *meaning* changed. In Round 1 this looked like an ambitious half-built product. In Round 2 it looks like an ambitious half-built product **that is solving the right problem nobody else is solving.** The booking-page market is a generic-copy graveyard. OskarOS is one of the few attempts to fight that with structure (information barriers, character agents, verbatim logging, archetype taxonomy) rather than just better prompts.

---

## What's amazing

1. **The COO agent file is a piece of literary work.** "De 6:30-Phänomen," "Die Vier hend e Buechig wo älter isch als s'Gebäude," "Costantino: Ich merk mir's nöd. Ich BIN's." This isn't system-prompt engineering, it's playwriting. And it works — the WebDev preserved exact phrasings into the HTML.

2. **The information-barrier architecture.** CD *cannot* read `/inputs/`. WebDev can *only* read the brief. This forces discovery-through-interview, which is what makes the output non-generic. Nobody in the AI-website-builder space does this — they all give the model maximum context and pray.

3. **The Lumberjack + Dreamer memory pattern.** Six-stage compaction with `_sageLock`, plus a long-term portrait painter (Padawan Sage) that paints the user across sessions. Conceptually elegant, no public analogues found. Worth writing up.

4. **20:47.** Read `outputs/2047/2-index.html`. The entire page is built around one specific minute — the moment the court lights and bar lights overlap into orange. That's product design done as literature. *That's* the bar.

5. **The Archetype Checklist.** Five questions that collapse the booking-design space. "What's the atomic unit? Does the customer pick the specific unit? Concurrent or exclusive? Rigid or flexible duration? How is one unit priced?" — that's the kind of taxonomy that should be in a textbook.

6. **The verbatim-logging discipline.** Most AI-product systems hand-wave conversation history into "summarized turns" and lose the gold. The CLAUDE.md explicitly forbids summarizing and the logs prove it works. Costantino's exact quote made it from COO interview to HTML hero because nobody compressed it on the way.

---

## What's broken

1. **The booking flow doesn't exist.** This is the single biggest issue. The whole Phase 2 of the workflow — Archetype Checklist → CEO confirmation → WebDev builds booking — has not actually been executed for either FalCaMel or Bareggcenter. CTAs link to `#booking` anchors that go nowhere. The system is named "OskarOS — booking pages that don't look like booking pages" and ships eleven beautiful pages with no booking.

2. **`app/api/test-backdoor/route.ts` exists.** Unauthenticated stateful endpoint that runs the full chat → image → build pipeline. Delete before any external eyes see this.

3. **`app/page.tsx` is a 2500-line god component.** Heavy `any` casting. State explosion problems. This is the file that will eat the next refactor.

4. **FalCaMel slipped to "Aman-hotel" voice.** When the COO isn't actively pushing back (as the Bareggcenter COO does in Schwiizerdütsch), the system reverts to generic luxury copy. Means the voice work is COO-prompt-dependent, not system-property.

5. **Bare Repo Hygiene.** `coo-agent_old.md`, `creative-director-agent_old.md`, `coo-agent-3.md`, `coo-agent-normalBaregg.md`, `assets/PROMPT.rtf`, `oskar-prototype-old/` — the tree is full of forks and snapshots. Either commit to versioning or delete. Right now it's hard to tell which file is canonical.

6. **No connection between agents and prototype.** The `.claude/agents/` definitions and the Next.js `lib/cd-agent-prompt.ts` are two separate sources of truth for the CD agent. Drift is inevitable.

---

## What I'd do next, in order

1. **Build one complete vertical slice.** Pick Bareggcenter Padel booking. CD runs Archetype Checklist → "Sports Facility, with concurrent court bookings, time blocks, per-hour pricing." WebDev builds the booking flow with voice ("Wele Platz? Platz 3 isch belegt. Sit immer."). Wire the CTAs. Demo end-to-end. Until this exists, the whole project is half a thesis.

2. **Delete `app/api/test-backdoor/route.ts`.** Today.

3. **Promote the COO-as-character pattern to a primary brand asset.** This is the differentiator. Write the playbook: "How to build a COO character that holds the brand truth." It's the pattern that makes the whole thing work.

4. **Publish the Lumberjack/Dreamer pattern.** Zero search results means either nobody's found it or you have to claim the term first. Write the post.

5. **Strip `app/page.tsx` into a shell + 6–8 sub-views.** Refactor before adding features.

6. **Delete the `_old` files and `oskar-prototype-old/`.** The tree is the documentation.

7. **Consolidate agent prompt sources.** One source of truth for the CD agent. Either the .md or the .ts, not both.

---

## The line

If OskarOS were sold as "an AI booking page generator," it would be a confused 6/10.

It's not. It's a **creative-workflow platform built on the bet that the way to defeat generic AI copy is dramaturgy: give the AI a character to interview, force discovery, log verbatim, refuse summary, and produce something that another business literally couldn't use.** Under that frame, the COO agent is the product, the booking flow is the proof, the prototype is the studio, and the HTML is the artifact.

The COO is finished. The studio is half-built. The proof — the actual booking flow — hasn't shipped.

Ship the proof.
