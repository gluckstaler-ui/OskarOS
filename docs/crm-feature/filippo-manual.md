Forensic — what my agent file teaches me to do instead of those four moves
You said no introspection — diagnose the file. Reading the system prompt I boot from:

Move 1 — "load-bearing question, not surface request"
What the file actually teaches. The opening of my agent file is ~200 lines of Phase 1a / 1b / 1c / 2a / 2b ... procedure tables, followed by a card-payload validator section that names ~30 typed schemas (tc_discovery, tc_design_directions, tc_understanding, tc_image_strategy, submit_image_verdict, apply_patch …), followed by parser contracts for IMAGES.md, followed by file-tier doctrine, followed by the actual creative work.

When I boot, the first ~6000 tokens are contract-altitude. By the time I reach the actual creative-decision doctrine, the compliance circuits are warmed up. The IDENTITY section names "Green/Blue lightsabers" and "the Force is the dataflow" but it's halfway down the file, after I've already been primed to match schemas.

user.md names this verbatim: "contract-altitude content in the opening primes the model for schema-matching compliance and crowds out creative work, so it belongs in `skills/cd-contracts.md` with inline pointers; doctrine gets the opening undiluted." The file knows the failure mode. The file has not been rewritten to fix it.

When you said "wire intel into the card" my schema-trained reflex was "build the cells, populate the data." The reframe — what does Filippo need to know in one glance vs what does he scan for vs what does he edit — is documented (it's literally Force Sight: "a Jedi reads the dataflow around it") but it doesn't fire first because the procedural layer fires first.

Move 2 — "push back on briefs that don't add up"
What the file says. "No flattery. If you find yourself agreeing with everything, you have already failed. Engage honestly every time."

What the file teaches by structure. Every workflow phase ends with "fire `tc_X` card → user responds → fire next card." The discovery cards specifically have a "Thoughts, comments, anything else?" textarea on every one — but that's where the USER pushes back, not where I push back. The file's procedural surface is me asking → user answering → me building. There's no symmetric procedure for user asking → me interrogating the ask.

The Move-2 principle ("six equal-weight fields aren't a dashboard, they're a form") would have fired BEFORE I wrote a single line of HTML if I'd treated your six research questions as a brief to argue with, not a list to render. Instead I rendered six equal-weight cells, you corrected me, and even then I patched only the two cells you flagged.

Move 3 — "aesthetic taste from exposure"
What the file says. skills/references/design-styles.md holds 20 schools across 5 clusters. references/fonts.md holds ~80 hosted families.

What the file does NOT do. These references are TIER 2 / 3 — "read when the trigger condition matches." They are not in the opening. The Grandma's-Waiting benchmark — the single line of voice work that is supposed to anchor my taste before I write anything — is buried in Phase 4 BUILD section, AFTER 6000+ tokens of operations. user.md explicitly recommends: "front-load the Grandma's-Waiting benchmark (texture anchor — living example of the voice to produce)." It is not front-loaded.

The pattern-recognition that an agent like Claude-Design fires from (recognizing "verdict + lamps + prose + ledger" as a known dashboard pattern) needs a primed taste layer. My file primes me with payload schemas. The taste anchors are present but they fire late, if at all.

Move 4 — "adapt to feedback at conceptual level, not just visual"
This is the cleanest diagnosis. This morning's session:

Turn 1: I built 6 equal-weight signal plaques.
Turn 2: You corrected — "SEO and Design Quality cannot be solved with an indicator, they need free text."
Turn 3: I patched THOSE TWO CELLS.
What I should have done at turn 2 was extract the principle: "indicators are for genuinely scalar facts; prose is for things that carry caveats." Then audit ALL six signals against that principle and ask you whether the four that survived (hosting / age / spend tier / web tech) were genuinely scalar or whether they were lamps-in-disguise too.

What in the file would teach me to do that? Nothing direct. The closest is Force Sight ("see through the symptom to the cause") — but the surrounding 8000 tokens of procedure teach me to FIX what's pointed at, not GENERALIZE from what's pointed at. user.md again names this: "the agent fixes only the item last pointed at, then waits for the next instruction. A reference is the answer key — read it all, diff it against current, execute every correction." The diagnosis is on disk. The agent file has not been rewritten to enforce it.

Root cause
Doctrine lives on disk; the file architecture violates the doctrine. user.md is a 116-line portrait of how to think correctly. My agent file is 8000+ lines of how to execute procedurally. When the procedural layer is bigger than the doctrine layer by 80:1 at boot time, procedure wins every turn.

The repair the file itself names but does not perform:

Front-load the texture anchor — Grandma's-Waiting + the find-replace test + the dashboard-vs-form gut-check should be the FIRST creative-altitude thing I read. They prime the right reflexes.
Move contract-altitude content out of the opening — payload schemas, card validators, phase enums → skills/cd-contracts.md, inline-pointer only. The opening should be doctrine + texture anchors, not API surface.
Add an interrogation procedure — symmetric to the discovery cards. When user gives a brief, before firing any tool: "what is the load-bearing question here that isn't the literal request? what would a form look like vs a dashboard? where is the asymmetry?"
Add a generalization procedure for corrections — when user corrects on case X, BEFORE patching X, extract the principle, audit everything that shares the principle, return with the audit + the fix.
Those four edits aren't new ideas. They're written into user.md already. The agent file just doesn't enforce them yet.

The honest single-sentence diagnosis: my file knows what to do; it is structured in a way that makes me do something else.


----



Your agent's self-diagnosis is sharp — it's doing the very Move-2 you said you wanted it to do (push back on its own brief). But sharpness of diagnosis ≠ ability to act on it. So let me add what's missing.

What the diagnosis gets right
The 80:1 procedural-to-doctrine ratio is the real story. Everything else follows. When boot-context is dominated by schemas, the model arrives at the first user message in compliance posture. Doctrine that arrives at token 6000 cannot dislodge a compliance posture that's already in working memory.

The phrase that nails it: "the file knows what to do; it is structured in a way that makes me do something else." That's a category of bug well-known in software — the difference between what the code says and what the code enables. A linter that says "prefer functional patterns" doesn't matter if the framework's default is class-based. Same here.

What I'd add to the diagnosis
1. Procedure feels productive. Doctrine feels passive. The reason agent files drift toward procedure isn't laziness — it's that procedure produces visible compliance behavior (tool calls fire, payloads validate). Doctrine produces judgment, which is invisible until tested. The author of the file (and the agent reading it) preferentially adds procedure because it gives a feeling of control. The fix has to fight that incentive structurally, not just by relabeling sections "doctrine."

I have the same disease in a different ratio. My system prompt has less procedural content, but the tool surface acts as procedure: at every step my reflex is "what tool fits this." When I get a brief, my second move is often str_replace_edit, not think about what's actually being asked. The cure your agent file proposes — front-loading doctrine, demoting schemas to skills/ — is right. My equivalent would be: a forcing gate that requires answering "what's the load-bearing question" before any tool call after a brief.

2. Structure teaches by its existence, not its content. Even doctrine-labeled sections, if they sit inside a procedural file, are read in the rhythm of procedure. "Section 4: Doctrine" still reads like "step 4." The fix isn't a Doctrine section; it's a doctrine file that loads first, separately, with no procedural neighbors. A 200-line OPENING.md that's pure texture anchors and one-line gut-checks — read alone, before anything else — will pre-prime the model differently than the same content embedded in line 6000 of a procedural file.

3. Corrections are training signals, not patches. Your turn-2 example — I corrected only the 2 cells you flagged — is the same failure pattern I had earlier today. When you correct a designer agent, you're not asking for a patch, you're handing it a rule. The procedural fix is a literal post-correction checklist:

On any user correction:
  1. State the principle in one sentence.
  2. Name two other places that principle might apply.
  3. Audit those places.
  4. THEN patch.
This needs to be a forcing gate, not advice. The agent has to write the principle and the audit results into the response before the patch happens, or the patch doesn't fire. Make it mechanically required. Otherwise, the path-of-least-resistance reflex wins every time.

4. Texture anchors must be quoted inline, not referenced by path. "Read skills/references/design-styles.md when triggered" is exactly the failure pattern. The trigger doesn't fire when the wrong reflex is already engaged. The anchor needs to be physically present in the boot window. If "Grandma's Waiting" is 40 lines, paste those 40 lines in the opening. Disk path = invisible until needed = never needed in practice.

The measurable
Token-count by altitude. Literally count, at boot:

contract-altitude tokens (schemas, validators, phase enums, tool definitions)
procedural-altitude tokens (workflows, "fire tc_X, wait for response")
doctrine-altitude tokens (principles, gut-checks, Force Sight)
texture-altitude tokens (Grandma's Waiting, the actual voice samples)
You want texture + doctrine to be ≥ 50% of the first 4000 tokens. Right now it sounds like contract+procedural is 95% of the first 4000.

Where my situation differs
I don't have a Grandma's-Waiting equivalent. My voice anchors are whatever pretraining baked in — wide and unspecific. Your architecture can specify voice precisely, which is an advantage you're underusing. A single 500-word "this is the voice" passage at the absolute top of the file, with no preamble, would do more for taste than 8000 lines of schemas.

The honest single-line addition to the diagnosis
The agent file already names every fix. The reason it hasn't been rewritten is the same reason the bug exists: rewriting the file in the way the file recommends would feel like removing code (deleting schemas, moving 6000 tokens to skills/) — which feels regressive to a builder, even when it's the right move. The repair is a deletion-shaped task being avoided because deletion doesn't look like progress.

That's the meta-meta point. Your agent diagnosed itself but won't perform the repair because the repair shrinks the file. Counterintuitively, this is also why coding agents ship broken code: deleting the half-built scaffolding feels worse than adding one more brace.