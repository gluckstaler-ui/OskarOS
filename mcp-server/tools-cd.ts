/**
 * CD-side MCP tools.
 *
 * Two groups:
 *   1. Orchestration tools (Phase 1, 2026-04-29) — build_vibe, hotswap, etc.
 *      Phase-1 magic-word triggers ported to typed MCP. POST to /api/mcp/{slug}
 *      to do the work; ack returned to the agent.
 *
 *   2. Submit tools (Phase 2, 2026-04-30) — submit_proofread / submit_image_verdict /
 *      submit_upload_eval / submit_image_prompt. Replace the `## SEVERITY` /
 *      `## VERDICT` / `## IMAGE PROMPT` text-output parsers in lib/cd-*.ts.
 *      The MCP server's job for these is TRIVIAL: validate args by schema,
 *      return ack. The structured data flows through the bridge's tool_use
 *      events; the wrapping code (callCDBridge) reads them via
 *      lib/mcp-tool-collector. No HTTP callback, no shared state.
 */

import { postJson } from './api-client.js'
import type { ToolCallContext } from './tools.js'

export const CD_TOOL_DEFINITIONS = [
  // ── Orchestration (Phase 1) ────────────────────────────────────────────
  {
    name: 'build_vibe',
    description:
      'Build N vibes from their `vibe-N-{slug}.md` specs. Array-based: pass ' +
      'one slug for a single rebuild, or the full set for a batch. Phase 4 ' +
      'commit-build AND Phase 5 final-build both use this tool — the ' +
      'orchestrator derives strictness from session state. Replaces the old ' +
      '`build_all_vibes` and `build_final` tools (collapsed 2026-05-18). ' +
      'Each slug enqueues one job; jobs run serially under the per-session ' +
      'WebDev mutex; the live BuildJobCard renders one row per slug.',
    inputSchema: {
      type: 'object',
      properties: {
        slugs: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Non-empty list of vibe slugs to build. Each entry is either ' +
            '`vibe-N` (e.g. `vibe-3`) or the full `vibe-N-{name}` form ' +
            '(e.g. `vibe-3-grandmas-cliff`). Single slug = single rebuild; ' +
            'full set = batch build. The server resolves each against ' +
            'vibe-*.md on disk.',
        },
      },
      required: ['slugs'],
    },
  },
  {
    name: 'hotswap',
    description:
      'Swap an approved image into a vibe slot. Resolution rule (2026-04-30):\n' +
      '  1. If `sourceImage` is passed → use it directly, skip IMAGES.md lookup.\n' +
      '  2. Else read IMAGES.md for a `### filename.jpg` block with `**Slot:** X` + `**Status:** READY`.\n' +
      '  3. Vibe slug → newest-mtime `.html` matching `${slug}-*.html` (was: alphabetical first match).\n' +
      'The HTML edit accepts BOTH `data-slot="X"` and `data-usage="X"` (CD\'s convention writes both).',
    inputSchema: {
      type: 'object',
      properties: {
        vibe: {
          type: 'string',
          description: 'Vibe name (e.g. `qahwa` or `vibe-3`) — slug or short name, NOT a filename.',
        },
        slot: {
          type: 'string',
          description: 'Slot name (e.g. `hero`, `portrait`, `menu-bg`).',
        },
        sourceImage: {
          type: 'string',
          description: 'Optional. Filename of the image to swap in. If omitted, hotswap looks it up in IMAGES.md by slot.',
        },
      },
      required: ['vibe', 'slot'],
    },
  },
  {
    name: 'images_needed',
    description:
      'Signal that you have written/updated image prompts in IMAGES.md and want ' +
      'the Assets panel to refresh. Replaces `## IMAGES NEEDED`. The server ' +
      're-reads IMAGES.md and pushes the manifest to the frontend.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'refresh_assets',
    description:
      'Force the Assets panel to re-read IMAGES.md. Replaces `## UPDATE ASSETS`. ' +
      'Use after ANY change to IMAGES.md — evaluations, status changes, site ' +
      'imports, reprompts, slot assignments.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Submit tools (Phase 2 — replace text-output parsers) ────────────────
  {
    name: 'submit_proofread',
    description:
      'Submit the structured proofread of an image prompt. Replaces the ' +
      '`## SEVERITY` / `## NOTE` / `## REWRITTEN_PROMPT` header format ' +
      '(parsers retired 2026-04-30). Call this when the app sends ' +
      '`[OSKAR-SYSTEM PROOFREAD]`. Do NOT write the headers in chat.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['pass', 'advisory', 'rewritten'],
          description:
            '`pass` — prompt is fine as-is. `advisory` — flagged but not rewritten ' +
            '(note explains why). `rewritten` — replaced; rewrittenPrompt MUST be set.',
        },
        note: {
          type: 'string',
          description: 'One-to-three-sentence explanation. Always required.',
        },
        rewrittenPrompt: {
          type: 'string',
          description: 'Required iff severity=rewritten. The new prompt to send to Nano.',
        },
      },
      required: ['severity', 'note'],
    },
  },
  {
    name: 'submit_image_verdict',
    description:
      'Submit a structured verdict on a generated image. Replaces the ' +
      '`## VERDICT` / `## NOTE` / `## ADJUSTED_DESCRIPTION` headers (parsers ' +
      'retired 2026-04-30). Call this when the app sends `[OSKAR-SYSTEM VERDICT]`.',
    inputSchema: {
      type: 'object',
      properties: {
        verdict: {
          type: 'string',
          enum: ['✓', '≈', '✗'],
          description: '`✓` ship. `≈` ship-with-caveats. `✗` reject — needs regen.',
        },
        note: { type: 'string', description: 'Why. Always required.' },
        adjustedDescription: {
          type: 'string',
          description:
            'Optional. If set, replaces Nano\'s self-description in IMAGES.md ' +
            '(use when Nano\'s description was wrong but the image is fine).',
        },
      },
      required: ['verdict', 'note'],
    },
  },
  {
    // WP-SCOUT-3 (Ralph 2026-06-03). The typed verdict the Jedi Scout calls
    // after tasting a captured website. Mirrors submit_image_verdict's
    // tool-as-channel shape — the dispatch case is a no-op return; the
    // verdict is captured by makeToolCollector inside lib/scout-bridge-call.ts
    // and the heat is derived server-side (gap = palate − execution; locked
    // 3-tier per §17 [SCOUT-J]). Never trust gap/heat from the model.
    name: 'submit_scout_verdict',
    description:
      'Submit a structured taste-verdict on a captured website. Call this ONCE ' +
      'after reading the full-page + inner screenshots and the imported lead ' +
      "fields. Returns palate (1-5), execution (1-5), the visual choice the eye " +
      "actually saw, a one-line verdict, and a photos read. The server derives " +
      'gap = palate − execution and bands heat (≥2 hot · 1 warm · ≤0 cold).',
    inputSchema: {
      type: 'object',
      properties: {
        palate: {
          type: 'integer',
          minimum: 1,
          maximum: 5,
          description:
            'The taste the BUSINESS would have if it could see itself clearly — ' +
            'the design ceiling implied by the product, the location, the people ' +
            '(not how the current site executes it). 1 = generic / no taste / ' +
            'no identity to defend; 5 = a clear, durable identity worth ' +
            'displacing a site to honour.',
        },
        palate_choice: {
          type: 'string',
          description:
            'ONE specific visual decision the business has ALREADY made — the ' +
            "named thing the eye saw (e.g. \"a real winemaker's photo, not a " +
            'stock glass" · "the stone-built courtyard, lit at dusk" · "the ' +
            'family handwriting on the labels"). Concrete, not abstract — a ' +
            'reader should be able to find that decision on the site or in the ' +
            'photos. NOT the colour palette.',
        },
        execution: {
          type: 'integer',
          minimum: 1,
          maximum: 5,
          description:
            'How well the current website CARRIES that taste. 1 = generic ' +
            'WordPress theme, stock imagery, the design contradicts the ' +
            'product; 5 = the design IS the business at full strength, nothing ' +
            'to displace.',
        },
        verdict: {
          type: 'string',
          description:
            'One line, plain prose. The Scout\'s read in a sentence — what the ' +
            'gap MEANS for the lead (e.g. "Taste outruns the site." · ' +
            '"Nothing to defend — greenfield." · "Tired stock photos against ' +
            'real terroir."). No bullet lists, no scores duplicated as text.',
        },
        photos: {
          type: 'string',
          description:
            'A short read on the imagery (10-30 words). Art-directed vs stock, ' +
            'people visible vs not, the hero image\'s decision. Whether photos ' +
            'do or do not match the palate_choice.',
        },
      },
      required: ['palate', 'palate_choice', 'execution', 'verdict', 'photos'],
    },
  },
  {
    name: 'submit_upload_eval',
    description:
      'Submit your evaluation of a user upload. Replaces the ' +
      '`## VERDICT` / `## NOTE` / `## SUGGESTED_USES` headers (parsers retired ' +
      '2026-04-30). Call when app sends `[OSKAR-SYSTEM EVAL-UPLOAD]`.',
    inputSchema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['✓', '≈', '✗'] },
        note: { type: 'string' },
        suggestedUses: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of slot names this image could fill. Empty if verdict=✗.',
        },
      },
      required: ['verdict', 'note', 'suggestedUses'],
    },
  },
  {
    name: 'submit_image_prompt',
    description:
      'Submit a structured Ask-CD response with an image prompt. Replaces the ' +
      '`## IMAGE PROMPT` / `## FEEDBACK` headers (lib/cd-response-parser.ts deleted ' +
      '2026-04-30). Call this in Image-Mode Ask-CD when the user wants you to ' +
      'commit to a prompt. Plain conversation = no tool call (the route falls ' +
      'through to the text reply).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The Nano-ready image prompt you are committing to.',
        },
        feedback: {
          type: 'string',
          description:
            'Optional context the user might want — what changed from their ask, ' +
            'why this framing, what trade-offs.',
        },
      },
      required: ['prompt'],
    },
  },

  // ── Phase 2.5 (Ralph 2026-04-30): build/image escrow polling ──────────
  {
    name: 'job_status',
    description:
      'Poll the status of a long-running job (build_vibe / build_wireframes / ' +
      'generate_image). Returns a `job` object with the ' +
      'authoritative status: "running" | "complete" | "failed" | "cancelled" ' +
      '| "stuck" (server-derived when running > 15 min). On "complete", read ' +
      'job.result.filename — that is your next action.\n\n' +
      'POLLING CADENCE — read this twice: after firing a build/generation, do ' +
      '1–2 turns of OTHER useful work, THEN poll. If still running, do 1–2 ' +
      'more turns of other work, THEN poll again. NEVER poll twice in the ' +
      'same turn — it costs context and tells you nothing more than one poll. ' +
      'If the job is "stuck", DO NOT poll again — surface to the user or call ' +
      'cancel_job.\n\n' +
      'When jobId is omitted, returns ALL jobs for the session (newest first).',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'The jobId returned by build_vibe / build_wireframes / generate_image. Omit to list all session jobs.',
        },
      },
    },
  },
  {
    name: 'cancel_job',
    description:
      'Cancel a running build or image-generation job. Sends SIGTERM to the ' +
      'underlying Claude/Gemini child (for builds) or aborts the Nano fetch ' +
      '(for generate_image). The job\'s status flips to "cancelled" ' +
      'immediately; the underlying spawn may take a few seconds to exit.\n\n' +
      'Use when: a job is "stuck" per job_status, or you want to redirect ' +
      'effort. After cancel, you may immediately fire a fresh build_vibe / ' +
      'generate_image with corrected args.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The jobId to cancel.' },
      },
      required: ['jobId'],
    },
  },

  // ── Bug I (Ralph 2026-05-04): propose_image_prompt ─────────────────────
  // Closes the doctrine gap CD flagged: update_image_metadata writes the
  // wrong shape (#### filename — that's the generated-image record under
  // a parent prompt block), and generate_image skips the prompt block
  // entirely (fires Nano right away). Neither path lets CD propose a
  // prompt for user approval before firing. This tool writes a clean
  // `### img-N` PENDING block that the Assets panel renders as a card
  // with a Generate button.
  {
    name: 'propose_image_prompt',
    description:
      'Propose a new image prompt by writing a `### img-N` PENDING block to ' +
      'IMAGES.md. Renders in the Assets panel as a prompt card with a ' +
      'Generate button. Use when you want to draft an image idea WITHOUT ' +
      'firing Nano immediately — get user approval first, or draft multiple ' +
      'variants and let the user pick. After write, panel auto-refreshes ' +
      'via the existing assets_updated event-bus path.',
    inputSchema: {
      type: 'object',
      properties: {
        vibe: {
          type: 'string',
          description:
            'Vibe slug (e.g. "vibe-3"), display name, or "shared"/"all" for ' +
            'cross-vibe assets. Same field the Assets panel groups by.',
        },
        purpose: {
          type: 'string',
          description: 'Slot/usage label: hero, portrait, menu-bg, gallery, etc.',
        },
        aspectRatio: {
          type: 'string',
          enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '3:2', '2:3', '4:5', '5:4'],
          description: 'Aspect ratio for Nano when the user clicks Generate.',
        },
        prompt: {
          type: 'string',
          description:
            'The Nano-ready prompt — proofread, ready to fire as-is when ' +
            'the user clicks Generate. Use the same level of polish you would ' +
            'in submit_image_prompt.',
        },
        id: {
          type: 'string',
          description:
            'Optional explicit id (e.g. "img-goofy-v1"). Must match `img-<slug>` ' +
            '(lowercase, alphanumerics + hyphens). Omit to auto-number as ' +
            'img-NNN where NNN is one past the highest existing numeric img-N.',
        },
      },
      required: ['vibe', 'purpose', 'aspectRatio', 'prompt'],
    },
  },

  // ── Phase 2 discovery flow (Ralph 2026-05-04) ─────────────────────────
  // Promoted from inline tools in /api/chat/route.ts so BOTH the CLI mode
  // (chat-stream + bridge subprocess) AND the API mode (chat + api-mcp-bridge)
  // can call them via the same MCP path. Each handler POSTs to its
  // /api/mcp/{slug} route, which publishes to the event-bus. Frontend
  // renders <DiscoveryQuestionsCard> / <ConfirmUnderstandingCard> in the
  // chat surface — same render slot as UnfinishedTodosPanel (WP-2.8).
  {
    name: 'tc_discovery',
    description:
      'Ask the user N structured questions during initial brand discovery. ' +
      'Use when ≥3 things still need clarification, or for ANY multiple-choice ' +
      'question (≥1 MCQ → card, never prose-numbered). Each question is either ' +
      'a bare string (text input) OR a typed object — kind: text · textarea · ' +
      'radio · checkbox · select. Radio/checkbox/select REQUIRE `options[]`. ' +
      'User answers return as a regular user message in the next turn.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Non-empty list. Each entry is a string (text input) or a typed-question object {kind, prompt, options?, required?, help?, placeholder?, defaultValue?}.',
          items: {
            oneOf: [
              {
                type: 'string',
                description: 'Shorthand for a plain text question. Equivalent to {kind:"text", prompt:<string>}.',
              },
              {
                type: 'object',
                description: 'Typed question. `prompt` is the user-facing label. Radio/checkbox/select REQUIRE non-empty `options[]`.',
                properties: {
                  kind: {
                    type: 'string',
                    enum: ['text', 'textarea', 'radio', 'checkbox', 'select'],
                  },
                  prompt: { type: 'string', description: 'User-facing label.' },
                  id: { type: 'string', description: 'Stable form-field id. Defaults to position index.' },
                  required: { type: 'boolean', description: 'Render red * indicator and block submit when empty.' },
                  help: { type: 'string', description: 'Small grey helper line under the label.' },
                  placeholder: { type: 'string', description: 'Placeholder for text / textarea kinds only.' },
                  options: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Required for radio / checkbox / select. Ignored for text / textarea.',
                  },
                  defaultValue: {
                    description: 'Pre-filled answer. String for text/textarea/radio/select; string[] for checkbox.',
                  },
                },
                required: ['kind', 'prompt'],
              },
            ],
          },
        },
        preamble: {
          type: 'object',
          description: 'CD-speaking preamble — the cyan-bordered "Why I\'m asking" callout above the questions. Universal "CD speaking" channel across all tc_* cards per docs/toolcards-mockup.html. Distinct from `title` (head-bar) and `context` (deprecated flat string).',
          properties: {
            label: {
              type: 'string',
              description: 'Mono-caps role tag — "Why I\'m asking" / "Why six, not three" / etc. Short, declarative.',
            },
            body: {
              type: 'string',
              description: 'Prose explanation of CD\'s reasoning — what you\'re probing for and why. 2-4 sentences max.',
            },
          },
          required: ['label', 'body'],
        },
        context: {
          type: 'string',
          description: '@deprecated — flat-string preamble. Use `preamble: {label, body}` instead. Kept for back-compat with older CD calls.',
        },
        title: {
          type: 'string',
          description: 'Optional head-bar title (mockup: "Discovery — about FalCaMel"). Defaults to "A few quick questions".',
        },
        progress: {
          type: 'object',
          description: 'Optional progress chip in head (mockup: "step 1 / 3"). Pure cosmetic; the renderer does not enforce multi-step flow yet.',
          properties: {
            current: { type: 'number' },
            total: { type: 'number' },
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'tc_understanding',
    description:
      'Phase 1 → Phase 2 gate. Surface the brand on one screen: ' +
      'CD-speaking preamble (cyan callout), 6-chip distillation grid (Business / ' +
      'Location / Who-we-are / How-it-works / Customer(s) / Voice), Conversion + ' +
      'Pricing band (mechanism pills + pricing prose), two pull-quotes (green ' +
      'weirdDetail + violet signatureMoment), 9-dot Discovery completeness signal, ' +
      'and a build CTA gated on completeness (auto-enables when all 9 fields filled, ' +
      'click fires the track-appropriate junior pass). UNIFIED single-state ' +
      '(Ralph 2026-05-15): all 9 fields render as inline-editable inputs always. ' +
      'Fire any time after the first Discovery round — same card serves as the ' +
      'in-progress workbench AND the handoff gate.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Fallback prose used only when literally nothing structured (preamble, chips, callouts) is provided.',
        },
        readyToGenerate: {
          type: 'boolean',
          description: 'DEPRECATED (Ralph 2026-05-15). Accepted for back-compat with old call sites; no longer branches behavior. The component derives readiness from inline-input state.',
        },
        preamble: {
          type: 'object',
          description: 'CD-speaking preamble — the cyan-bordered callout above the chips. READY: "What I heard". CHECK-IN: "What\'s still needed". Universal "CD speaking" channel.',
          properties: {
            label: { type: 'string', description: 'Mono-caps role tag — "What I heard" / "What\'s still needed" / etc.' },
            body: { type: 'string', description: 'Prose explanation — what CD interpreted and where they\'re uncertain. 2-4 sentences.' },
          },
          required: ['label', 'body'],
        },
        distillation: {
          type: 'object',
          description: 'The brand distilled into 6 chips per mockup §3.5. Each chip is a 1-2 sentence punch line.',
          properties: {
            business: { type: 'string', description: 'What it is, in one line. e.g. "Third-wave coffee bar — neighborhood regulars by day, late-night tourists."' },
            location: { type: 'string', description: 'Geography + context. e.g. "Vienna\'s 7th. Drift-up from MuseumsQuartier after dark."' },
            whoWeAre: { type: 'string', description: 'The proprietors/operators. e.g. "Yemeni-Austrian roaster, third generation coffee man. Solo operator, no franchise."' },
            howItWorks: { type: 'string', description: 'The operational model. e.g. "Counter walk-in by day. Reservations-only after 21:00. No app, no loyalty card."' },
            customers: { type: 'string', description: 'The target customer in one line. Price ceiling welcome. e.g. "Locals first, tourists second. Price ceiling €7."' },
            voice: { type: 'string', description: 'Voice/tone in one line. e.g. "Spare, confident, no kitsch. No fusion-speak."' },
          },
        },
        conversion: {
          type: 'object',
          description: 'Operational specifics — conversion paths + pricing prose. Mechanism pills (PHONE/FORM/BOOK/SHOP); applicable ones highlight green, others render dimmed. Pricing is multi-line because real pricing rarely fits one value.',
          properties: {
            mechanisms: {
              type: 'array',
              items: { type: 'string', enum: ['PHONE', 'FORM', 'BOOK', 'SHOP'] },
              description: 'Which conversion mechanisms apply for this brand. Empty array = none specified.',
            },
            pricing: {
              type: 'string',
              description: 'Pricing prose. Multi-line. Numbers render tabular-mono. e.g. "€4 espresso · €5 cortado · €6 cappuccino · €7 specialty pour-over. Beans by the bag €18–€32. Cash, card. Tip jar at the counter."',
            },
          },
        },
        weirdDetail: {
          type: 'string',
          description: 'The load-bearing line — what makes this brand unrepeatable. Renders as a green left-bordered italic pull-quote. If this feels generic, Discovery wasn\'t done.',
        },
        signatureMoment: {
          type: 'string',
          description: 'The scene that PROVES the brand (distinct from weirdDetail: a SCENE, not a line). Renders as a violet left-bordered italic pull-quote. e.g. "Late-night tourist orders cappuccino at 23:30. He brings out Sanaani-style mocha with cardamom and watches their face."',
        },
        discoveryProgress: {
          type: 'object',
          description: 'Defaults to derived state from filled fields. Drives the 9-dot completeness signal (green=filled, red=missing).',
          properties: {
            done: { type: 'number' },
            total: { type: 'number' },
          },
        },
        stillNeed: {
          type: 'array',
          items: { type: 'string' },
          description: 'DEPRECATED (Ralph 2026-05-15). The component no longer renders this — the inline-editable inputs themselves signal what is still needed via dashed borders + placeholder text.',
        },
        phaseLabel: {
          type: 'string',
          description: 'Sub-line in the header. Defaults to "Phase 1 · N/9 Discovery items".',
        },
      },
      required: ['summary'],
    },
  },

  // ── WP-70 + WP-71 (Ralph 2026-05-10): Image Strategy Card ──────────
  // Phase 3/5 slot plan. Shows every slot for one vibe with assigned/generate/
  // optional-empty states. Two layouts: webpage-vertical and keynote-multi-row.
  {
    name: 'tc_image_strategy',
    description:
      'Present a vibe\'s complete image plan as a card with slot states. ' +
      'Use at Phase 3 (image-strategy review) or Phase 4→5 (pre-build canon lock). ' +
      'Two layouts: "webpage-vertical" (vertical slot list, 6-10 slots) or ' +
      '"keynote-multi-row" (M×5 slide grid, 15-40 slots). User can generate ' +
      'individual slots, batch-generate all, or approve the canon. Response ' +
      'arrives as a regular user message with { action, generatedSlotName?, freeformText }.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Session slug identifying the webpage project.',
        },
        vibeSlug: {
          type: 'string',
          description: 'Vibe identifier, e.g. "vibe-3-grandmas-cliff".',
        },
        vibeName: {
          type: 'string',
          description: 'Display name from the Gallery Card.',
        },
        layout: {
          type: 'string',
          enum: ['webpage-vertical', 'keynote-multi-row'],
          description: 'Layout variant. webpage-vertical = vertical slot list; keynote-multi-row = M×5 slide grid.',
        },
        phaseLabel: {
          type: 'string',
          description: 'Free-form phase context, e.g. "Phase 3 / Phase 4→5 review".',
        },
        preamble: {
          type: 'object',
          description: 'CD-speaking preamble — the cyan-bordered "How the image plan fits" callout above the slot list. Universal "CD speaking" channel per docs/toolcards-mockup.html.',
          properties: {
            label: { type: 'string', description: 'Mono-caps role tag — "How the image plan fits" / "What\'s missing" / etc.' },
            body: { type: 'string', description: 'Prose explanation of the image canon — what\'s assigned, what to generate, what\'s optional. 2-4 sentences.' },
          },
          required: ['label', 'body'],
        },
        slots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slotName: { type: 'string', description: 'e.g. "Hero", "Slide 7"' },
              slotKind: { type: 'string', description: 'e.g. "hero", "portrait", "section-bg", "type-only"' },
              aspectRatio: { type: 'string', description: 'e.g. "16:9", "3:4"' },
              state: { type: 'string', enum: ['assigned', 'generate', 'optional-empty'] },
              filename: { type: 'string', description: 'Present when state=assigned.' },
              promptPreview: { type: 'string', description: 'Present when state=generate. First 2 lines of Nano prompt.' },
              promptId: { type: 'string', description: 'Present when state=generate. References IMAGES.md block.' },
            },
            required: ['slotName', 'slotKind', 'aspectRatio', 'state'],
          },
          description: 'Ordered list of image slots for this vibe.',
        },
      },
      required: ['slug', 'vibeSlug', 'vibeName', 'layout', 'phaseLabel', 'slots'],
    },
  },

  // ── WP-77 (Ralph 2026-05-10): Design System Card ────────────────────
  // Phase 4→5 sign-off. CD pre-loads N vibes' design-system payloads;
  // user toggles between them via dropdown and picks one (or creates new).
  {
    name: 'tc_design_system',
    description:
      'Present N candidate design systems for the user to pick one. ' +
      'Phase 4→5 sign-off: user toggles between vibes via dropdown, CSS vars ' +
      'swap live. Response arrives as a user message with ' +
      '{ action: "select"|"create-new", selectedVibeSlug?, freeformText }.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Session slug identifying the project.',
        },
        vibes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              vibeSlug: { type: 'string', description: 'e.g. "vibe-3-grandmas-cliff"' },
              label: { type: 'string', description: 'Display name for the dropdown.' },
              system: {
                type: 'object',
                properties: {
                  displayName: { type: 'string' },
                  h2Sample: { type: 'string' },
                  bodySample: { type: 'string' },
                  palette: {
                    type: 'object',
                    properties: {
                      bg: { type: 'string' },
                      surface: { type: 'string' },
                      primary: { type: 'string' },
                      ink: { type: 'string' },
                      accent: { type: 'string' },
                    },
                  },
                  typography: {
                    type: 'object',
                    properties: {
                      displayFont: { type: 'string' },
                      bodyFont: { type: 'string' },
                      h1Caption: { type: 'string' },
                      bodyCaption: { type: 'string' },
                    },
                  },
                  buttons: {
                    type: 'object',
                    properties: {
                      primaryLabel: { type: 'string' },
                      secondaryLabel: { type: 'string' },
                    },
                  },
                  imageTreatment: { type: 'string' },
                  animationPosture: { type: 'string' },
                },
              },
            },
            required: ['vibeSlug', 'label', 'system'],
          },
          description: 'Array of vibe design systems to present.',
        },
        prompt: {
          type: 'string',
          description: 'Optional CD commentary shown above the card.',
        },
      },
      required: ['slug', 'vibes'],
    },
  },

  // ── WP-75 (Ralph 2026-05-10): Descent Selection Card ────────────────
  // Variable-cap vibe picker. CD specifies how many picks the user must
  // make (cap=1 for final-pick, cap=2 for wireframe pick-2, cap=3 for
  // top-3 narrow, etc.). Same yellow chassis as Design Directions.
  {
    name: 'tc_descent_selection',
    description:
      'Surface the descent-selection card for vibe picking. CD specifies the ' +
      'pick cap (cap=1 for final-pick "Ship This Vibe", cap=2 for wireframe ' +
      'pick "Advance These 2", cap=N for any narrow). Response arrives as ' +
      'a user message with { picks: string[] }. cap=1 renders as radio ' +
      '(single pick); cap>1 renders as multi-select with that maximum.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Card identity slug, e.g. "wireframe-pick" or "descent-final".',
        },
        cap: {
          type: 'number',
          description:
            'Maximum number of vibes the user can pick. Must be ≥1 and ' +
            '≤vibes.length. cap=1 → radio (single pick). cap>1 → multi-select ' +
            'with that maximum (clicking a (cap+1)th deselects warning).',
        },
        ctaLabel: {
          type: 'string',
          description:
            'Primary CTA button label, e.g. "Ship This Vibe" (cap=1), ' +
            '"Advance These 2" (cap=2), "Narrow to Top 3" (cap=3). CD writes ' +
            'this verbatim — pick a label that reads cleanly for the chosen cap.',
        },
        contextLabel: {
          type: 'string',
          description:
            'Optional sub-line shown in the card header below "Descent Selection". ' +
            'Use to give phase context, e.g. "Phase 2→3 wireframe pick" or ' +
            '"Phase 4→5 final pick". Free-form; CD writes verbatim.',
        },
        vibes: {
          type: 'array',
          description: 'Candidate vibes (1-6 items typical; cap must be ≤length).',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'Vibe slug (matches vibe-{n}-{slug}.html).' },
              name: { type: 'string', description: 'Display name (Title Case).' },
              heroImage: { type: 'string', description: 'Hero image URL or filename.' },
              tagline: { type: 'string', description: 'Optional one-line summary (~10 words).' },
              palette: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional 3-color palette swatch (hex strings).',
              },
              displayFont: { type: 'string', description: 'Optional display-font sample name.' },
            },
            required: ['slug', 'name', 'heroImage'],
          },
        },
        preamble: {
          type: 'object',
          description: 'CD-speaking preamble — the cyan-bordered "What to weigh" callout above the candidates. Universal "CD speaking" channel per docs/toolcards-mockup.html.',
          properties: {
            label: { type: 'string', description: 'Mono-caps role tag — "What to weigh" / "How to choose" / etc.' },
            body: { type: 'string', description: 'Prose explanation — what dimensions matter, what trade-offs to consider. 2-4 sentences.' },
          },
          required: ['label', 'body'],
        },
        prompt: {
          type: 'string',
          description: '@deprecated — flat-string preamble. Use `preamble: {label, body}` instead.',
        },
      },
      required: ['slug', 'cap', 'ctaLabel', 'vibes'],
    },
  },

  // ── Ralph 2026-05-06: on-demand card preview ───────────────────────────
  // When the user asks to "show me [a card]" / "what does X look like",
  // CD must NOT paste React source code. Call this tool with sample data;
  // the chat surface renders a real instance (`card.__preview: true` so
  // the renderer marks it as a sample with no backend side-effects).
  {
    name: 'preview_card',
    description:
      'Render a chat-surface card with sample data so the user sees what ' +
      'it looks like. Call this when the user asks to "show me [a card/' +
      'component]" or wants to preview a UI surface visually. Do NOT ' +
      'paste source code in response to such asks.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'discovery_questions',
            'confirm_understanding',
            'upload_eval',
            'upload_eval_batch',
            'screenshot',
            'apply_patch',
            'diagnostic_chip',
            // Ralph + CD 2026-05-06: build job card (Archetype 1).
            // payload = { title: string, jobId?: string, rows: BuildCardRow[] }.
            // Each row carries { id, label, state, hasCritique?, juniorDev?,
            // eta?, thumb?, milestones?, error? }.
            // state ∈ queued|html|verify|critique|done|failed|cancelled.
            // (Ralph 2026-05-18: 'wf' alias renamed to 'critique'; ladder is
            // 5-stage when hasCritique:true, 4-stage otherwise.)
            'build',
            // WP-70 + WP-71 (Ralph 2026-05-10): Image Strategy Card.
            'image_strategy',
            // WP-74 (Ralph 2026-05-10): Design Directions Card.
            'design_directions',
            // WP-77 (Ralph 2026-05-10): Design System Card.
            'design_system',
            // WP-75 (Ralph 2026-05-14): Descent Selection Card. Route at
            // /api/mcp/preview-card line 217 already handles this kind;
            // schema enum was missing it (source-to-route drift).
            'descent_selection',
          ],
          description: 'The card kind to render. Match a discriminator in lib/types.ts.',
        },
        payload: {
          type: 'object',
          description:
            'Sample data for the card. Shape matches the corresponding ' +
            'CardPayload type in lib/types.ts (omit `kind` here — it lives ' +
            'in the sibling field). Make the data realistic so the user ' +
            'sees the card looking like it would in the wild.',
        },
      },
      required: ['kind', 'payload'],
    },
  },

  // ── WP-66 (Ralph 2026-05-06): TodoWrite persistence ────────────────────
  // CD's TodoWrite calls land here; the route writes the `## Todos` section
  // in SESSION.md and broadcasts `todos_updated`. LiveOverlay (WP-22)
  // re-reads + re-renders. Single-writer model — user-add flows through
  // normal chat, CD encodes as a TodoWrite on its next turn.
  {
    name: 'todo_write',
    description:
      'Write the current task list. Full-list replace (not incremental). ' +
      'Persists to the `## Todos` section of SESSION.md; the panel updates ' +
      'live on the user side. Use for any task spanning 3+ steps. Tag the ' +
      'in-progress item with status="in_progress" + an `activeForm` (present-' +
      'continuous phrasing) so the user sees what you are doing right now.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable id (optional but recommended).' },
              content: { type: 'string', description: 'Imperative phrasing — what to do.' },
              activeForm: { type: 'string', description: 'Present-continuous — shown while in_progress.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Lifecycle state.',
              },
            },
            required: ['content', 'status'],
          },
          description: 'Full task list. Sending an empty array clears all todos.',
        },
      },
      required: ['todos'],
    },
  },

  // ── Bug 18 (2026-04-30): typed gateway for IMAGES.md mutations ──────────
  {
    name: 'update_image_metadata',
    description:
      'Patch (or create) an IMAGES.md entry for a generated/uploaded image. ' +
      'Replaces raw FileEdit against the markdown — that path corrupted ' +
      'entries by adding off-spec fields and masking Status. This tool writes ' +
      'a parser-clean entry. Status vocabulary (frozen): HERO, USED, B-ROLL, ' +
      'READY, APPROVED, REDO, INGESTED, TRASH, PENDING, STAR. Use after ' +
      'evaluating a generation to set verdict / re-tag / assign a slot. ' +
      'STAR is the user-curation marker for "this picture is great" — ' +
      'distinct from APPROVED (CD review pass) and HERO (placement-derived).',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The image filename (e.g. "hero-night.jpeg"). Required.',
        },
        status: {
          type: 'string',
          enum: ['HERO', 'USED', 'B-ROLL', 'READY', 'APPROVED', 'REDO', 'INGESTED', 'TRASH', 'PENDING', 'STAR'],
          description: 'Frozen vocabulary. No "ACTIVE" — that was a derived pseudo-status; use APPROVED/USED instead. STAR = user-curation "great picture" marker.',
        },
        evaluation: {
          type: 'string',
          description: 'CD verdict text (≤400 chars). Maps to **CD Evaluation:**.',
        },
        vibe: {
          type: 'string',
          description: 'Vibe slug or "all" — maps to **Vibe:**.',
        },
        slot: {
          type: 'string',
          description: 'Slot label (hero, portrait, menu-bg, …) — maps to **Slot:**.',
        },
        note: {
          type: 'string',
          description: 'Free-form note appended as **Note:** ...',
        },
      },
      required: ['filename'],
    },
  },
] as const

export type CDToolName = (typeof CD_TOOL_DEFINITIONS)[number]['name']

/**
 * Dispatch handler for CD tools. Orchestration tools POST to backend; submit
 * tools just ACK (data flows via tool_use events captured by callCDBridge).
 */
export async function callCDTool(
  name: CDToolName,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<{ text: string; isError: boolean }> {
  const sessionId = ctx.sessionId
  if (!sessionId) {
    return { text: 'sessionId missing from tool context', isError: true }
  }

  switch (name) {
    // ── Orchestration ──────────────────────────────────────────────────────
    // 2026-04-30 (Ralph + CD): wrappers refactored for the escrow contract.
    // The build routes now return `{status:'running', jobId, target,
    // deduped, originalStartedAt}` immediately — they NEVER return
    // `{status:'complete'}` (completion is a polled property of the
    // job, not a tool result). The previous wrapper checked for
    // `status === 'complete'` and reported every running job as
    // "build_vibe error: unknown" — the running build was real, the
    // error was a lie. Logged in docs/INSTITUTIONAL-MEMORY.md.
    case 'build_vibe': {
      // Array-based shape (Ralph 2026-05-18 — collapsed build API).
      // Old `{name}` callers are accepted as fallback (auto-wrapped into
      // `{slugs: [name]}`) so in-flight CD turns don't break mid-session.
      // New canonical shape: `{slugs: string[]}`.
      let slugs: string[] = []
      if (Array.isArray(args.slugs)) {
        slugs = (args.slugs as unknown[])
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
      } else if (typeof args.name === 'string' && args.name.trim()) {
        // Back-compat for old single-slug callers
        slugs = [args.name.trim()]
      } else if (typeof args.slug === 'string' && (args.slug as string).trim()) {
        slugs = [(args.slug as string).trim()]
      }
      if (slugs.length === 0) {
        return {
          text:
            'Error: `slugs` (non-empty array of strings) is required. ' +
            'Example: build_vibe({slugs: ["vibe-3"]}) or build_vibe({slugs: ["vibe-1","vibe-2","vibe-3","vibe-4"]}).',
          isError: true,
        }
      }
      const r = await postJson<{
        slugCount?: number
        jobs?: { jobId: string; target: string; status: string; deduped?: boolean; originalStartedAt?: string }[]
        error?: string
      }>('/api/mcp/build-vibe', { sessionId, slugs })
      if (!r.ok) return { text: r.error || 'build_vibe failed', isError: true }
      if (Array.isArray(r.body?.jobs) && r.body.jobs.length > 0) {
        const lines = r.body.jobs.map((j) => {
          const dedupNote = j.deduped ? ` (deduped, since ${j.originalStartedAt})` : ''
          return `  - ${j.target}: jobId=${j.jobId}${dedupNote}`
        })
        const wording =
          r.body.jobs.length === 1
            ? `build_vibe enqueued: ${r.body.jobs[0].target} (jobId=${r.body.jobs[0].jobId})`
            : `build_vibe enqueued ${r.body.slugCount ?? r.body.jobs.length} vibe(s):\n${lines.join('\n')}`
        return {
          text: `${wording}\nPoll job_status(jobId) for each; do other work between polls.`,
          isError: false,
        }
      }
      return { text: `build_vibe error: ${r.body?.error || 'unknown'}`, isError: true }
    }
    case 'hotswap': {
      const vibe = String(args.vibe || '').trim()
      const slot = String(args.slot || '').trim()
      const sourceImage = args.sourceImage ? String(args.sourceImage).trim() : undefined
      if (!vibe || !slot) return { text: 'Error: `vibe` and `slot` are required', isError: true }
      const r = await postJson<{ ok: boolean; sourceImage?: string; error?: string }>(
        '/api/mcp/hotswap', { sessionId, vibe, slot, sourceImage },
      )
      if (!r.ok) return { text: `hotswap failed: ${r.error}`, isError: true }
      if (r.body?.ok) return { text: `Swapped ${r.body.sourceImage} → ${vibe}/${slot}`, isError: false }
      return { text: `hotswap error: ${r.body?.error || 'unknown'}`, isError: true }
    }
    case 'images_needed': {
      const r = await postJson<{ manifestCount: number; promptCount: number }>(
        '/api/mcp/images-needed', { sessionId },
      )
      if (!r.ok) return { text: `images_needed failed: ${r.error}`, isError: true }
      return {
        text: `IMAGES.md re-read. ${r.body.promptCount} prompts across ${r.body.manifestCount} vibes pushed to Assets panel.`,
        isError: false,
      }
    }
    case 'refresh_assets': {
      const r = await postJson<{ ok: boolean; parsedAt?: string; entryCount?: number }>(
        '/api/mcp/refresh-assets',
        { sessionId },
      )
      if (!r.ok) return { text: `refresh_assets failed: ${r.error}`, isError: true }
      return {
        text: `Assets panel refreshed at ${r.body?.parsedAt} — ${r.body?.entryCount ?? 0} entries in IMAGES.md.`,
        isError: false,
      }
    }

    // ── Submit tools — pure acks ──────────────────────────────────────────
    // The wrapping code (lib/cd-bridge-call.ts:callCDBridge) captures the
    // typed args from the bridge's stream-json output via the
    // lib/mcp-tool-collector helper. The server's only job here is to:
    //   1. Validate args via the JSON schema (already done by the MCP transport).
    //   2. Return success so the agent's tool_use turn completes cleanly.
    // No backend work, no event-bus publish, no DB write.
    case 'submit_proofread': {
      const sev = String(args.severity || '')
      if (!['pass', 'advisory', 'rewritten'].includes(sev)) {
        return { text: 'Error: severity must be pass|advisory|rewritten', isError: true }
      }
      if (sev === 'rewritten' && !args.rewrittenPrompt) {
        return { text: 'Error: rewrittenPrompt required when severity=rewritten', isError: true }
      }
      return { text: 'submitted', isError: false }
    }
    case 'submit_image_verdict':
    case 'submit_upload_eval':
    case 'submit_image_prompt':
    case 'submit_scout_verdict':  // WP-SCOUT-3 — same tool-as-channel shape
      return { text: 'submitted', isError: false }

    // ── Phase 2.5: escrow polling + cancel ───────────────────────────────
    case 'job_status': {
      const jobId = args.jobId ? String(args.jobId).trim() : undefined
      const r = await postJson<{ job?: unknown; jobs?: unknown[]; error?: string }>(
        '/api/mcp/job-status',
        { sessionId, jobId },
      )
      if (!r.ok) return { text: r.error || 'job_status failed', isError: true }
      // Return the structured payload — CD reads job.status / job.result / job.error.
      return { text: JSON.stringify(r.body), isError: false }
    }
    case 'cancel_job': {
      const jobId = String(args.jobId || '').trim()
      if (!jobId) return { text: 'Error: `jobId` is required', isError: true }
      const r = await postJson<{ job?: unknown; note?: string; error?: string }>(
        '/api/mcp/cancel-job',
        { sessionId, jobId },
      )
      if (!r.ok) return { text: r.error || 'cancel_job failed', isError: true }
      return { text: JSON.stringify(r.body), isError: false }
    }

    // ── Bug I (Ralph 2026-05-04): propose_image_prompt ──────────────────
    case 'propose_image_prompt': {
      const vibe = String(args.vibe || '').trim()
      const purpose = String(args.purpose || '').trim()
      const aspectRatio = String(args.aspectRatio || '').trim()
      const prompt = String(args.prompt || '').trim()
      const id = args.id ? String(args.id).trim() : undefined
      if (!vibe || !purpose || !aspectRatio || !prompt) {
        return {
          text: 'Error: vibe, purpose, aspectRatio, and prompt are all required',
          isError: true,
        }
      }
      const r = await postJson<{
        ok: boolean
        id?: string
        bytesWritten?: number
        section?: string
        error?: string
      }>('/api/mcp/propose-image-prompt', {
        sessionId,
        vibe,
        purpose,
        aspectRatio,
        prompt,
        ...(id ? { id } : {}),
      })
      if (!r.ok) return { text: `propose_image_prompt failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `propose_image_prompt error: ${r.body.error}`, isError: true }
      return {
        text:
          `Wrote prompt block ${r.body?.id} to IMAGES.md (${r.body?.section}). ` +
          `Panel will refresh via assets_updated. The user sees a Generate ` +
          `button on the new card; do other work until they click it.`,
        isError: false,
      }
    }

    // ── Phase 2 discovery flow (Ralph 2026-05-04) ────────────────────────
    // Ralph 2026-05-12 — schema widened to accept typed-question objects
    // (text/textarea/radio/checkbox/select). The string-coerce that lived
    // here used to fold an MCQ object into "[object Object]"; now we
    // pass-through and let the route validate per-kind. Pre-2026-05-12
    // string[] callers still work — the route flattens bare strings to
    // {kind:'text', prompt}.
    case 'tc_discovery': {
      const questions = Array.isArray(args.questions) ? args.questions : []
      if (questions.length === 0) {
        return { text: 'Error: questions must be a non-empty array', isError: true }
      }
      const context = typeof args.context === 'string' ? args.context : undefined
      const title = typeof args.title === 'string' ? args.title : undefined
      const progress = args.progress && typeof args.progress === 'object' ? args.progress : undefined
      const preamble = args.preamble && typeof args.preamble === 'object' ? args.preamble : undefined
      const r = await postJson<{ ok: boolean; questionCount?: number; error?: string }>(
        '/api/mcp/ask-discovery-questions',
        { sessionId, questions, context, title, progress, preamble },
      )
      if (!r.ok) return { text: `tc_discovery failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `tc_discovery error: ${r.body.error}`, isError: true }
      return {
        text:
          `Discovery questions surfaced (${r.body?.questionCount ?? questions.length}). ` +
          `Wait for the user's answers before continuing — they will arrive as a regular user message.`,
        isError: false,
      }
    }
    case 'tc_understanding': {
      const summary = String(args.summary || '').trim()
      if (!summary) return { text: 'Error: summary is required', isError: true }
      const readyToGenerate = args.readyToGenerate === true
      // Bug fix (Ralph 2026-05-14): dispatcher was forwarding only
      // {sessionId, summary, readyToGenerate} and silently dropping the
      // structured fields (distillation / weirdDetail / discoveryProgress
      // / stillNeed / phaseLabel). Result: same CD payload rendered as
      // chips+pull-quote via preview_card and as prose-fallback via the
      // live tc_understanding path. Same-shape drift as the build_vibe
      // wrapper from 2026-04-30 — protocol on one end, contract on the
      // other, no shared schema enforcing the pass-through. Forward
      // everything CD sent; the route's own validator + the component's
      // own defensive coerce handle shape policing downstream.
      //
      // Bug fix #2 (Ralph 2026-05-14): some MCP transports deliver
      // object/array tool args as JSON-encoded STRINGS instead of native
      // objects (depends on the harness's JSON Schema coercion behavior).
      // The route's `typeof body.X === 'object'` checks then silently drop
      // these fields. Defensive parse here: if an arg looks like a JSON
      // object/array string, parse it. Native objects pass through unchanged.
      const coerceObj = (raw: unknown): unknown => {
        if (raw === null || raw === undefined) return undefined
        if (typeof raw === 'object') return raw
        if (typeof raw === 'string') {
          const s = raw.trim()
          if (s.startsWith('{') || s.startsWith('[')) {
            try { return JSON.parse(s) } catch { return undefined }
          }
        }
        return undefined
      }
      const r = await postJson<{ ok: boolean; readyToGenerate?: boolean; error?: string }>(
        '/api/mcp/confirm-understanding',
        {
          sessionId,
          summary,
          readyToGenerate,
          preamble: coerceObj(args.preamble),
          distillation: coerceObj(args.distillation),
          conversion: coerceObj(args.conversion),
          weirdDetail: args.weirdDetail,
          signatureMoment: args.signatureMoment,
          discoveryProgress: coerceObj(args.discoveryProgress),
          stillNeed: coerceObj(args.stillNeed),
          phaseLabel: args.phaseLabel,
        },
      )
      if (!r.ok) return { text: `tc_understanding failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `tc_understanding error: ${r.body.error}`, isError: true }
      return {
        text: readyToGenerate
          ? 'Understanding confirmed; user will trigger build via UI button.'
          : 'Understanding summarized; user will continue clarifying or steer.',
        isError: false,
      }
    }

    // ── WP-70 + WP-71 (Ralph 2026-05-10): tc_image_strategy ─────
    case 'tc_image_strategy': {
      const slug = String(args.slug || '').trim()
      const vibeSlug = String(args.vibeSlug || '').trim()
      const vibeName = String(args.vibeName || '').trim()
      const layout = String(args.layout || '').trim()
      const phaseLabel = String(args.phaseLabel || '').trim()
      const slots = Array.isArray(args.slots) ? args.slots : []
      if (!slug || !vibeSlug || !vibeName || !layout || slots.length === 0) {
        return { text: 'Error: slug, vibeSlug, vibeName, layout, and non-empty slots are required', isError: true }
      }
      if (!['webpage-vertical', 'keynote-multi-row'].includes(layout)) {
        return { text: 'Error: layout must be webpage-vertical or keynote-multi-row', isError: true }
      }
      const r = await postJson<{ ok: boolean; slotCount?: number; error?: string }>(
        '/api/mcp/present-image-strategy',
        { sessionId, slug, vibeSlug, vibeName, layout, phaseLabel, slots, preamble: args.preamble },
      )
      if (!r.ok) return { text: `tc_image_strategy failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `tc_image_strategy error: ${r.body.error}`, isError: true }
      return {
        text:
          `Image Strategy card surfaced for ${vibeName} (${layout}, ${r.body?.slotCount ?? slots.length} slots). ` +
          `Wait for the user's response — it arrives as a regular user message with { action, freeformText }.`,
        isError: false,
      }
    }

    // ── WP-77 (Ralph 2026-05-10): tc_design_system ──────────────
    case 'tc_design_system': {
      const dsSlug = String(args.slug || '').trim()
      const dsVibes = Array.isArray(args.vibes) ? args.vibes : []
      if (!dsSlug || dsVibes.length === 0) {
        return { text: 'Error: slug and non-empty vibes array are required', isError: true }
      }
      const r = await postJson<{ ok: boolean; vibeCount?: number; error?: string }>(
        '/api/mcp/present-design-system',
        { sessionId, slug: dsSlug, vibes: dsVibes, prompt: args.prompt },
      )
      if (!r.ok) return { text: `tc_design_system failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `tc_design_system error: ${r.body.error}`, isError: true }
      return {
        text:
          `Design System card surfaced (${r.body?.vibeCount ?? dsVibes.length} vibes). ` +
          `Wait for the user's response — it arrives as a regular user message with { action, selectedVibeSlug?, freeformText }.`,
        isError: false,
      }
    }

    // ── WP-75 (Ralph 2026-05-10): tc_descent_selection ──────────
    // Variable-cap vibe picker. CD passes cap (1..vibes.length) + ctaLabel
    // verbatim. cap=1 → radio (final-pick). cap>1 → multi-select.
    case 'tc_descent_selection': {
      const dscSlug = String(args.slug || '').trim()
      const dscCap = typeof args.cap === 'number' ? Math.floor(args.cap) : NaN
      const dscCtaLabel = String(args.ctaLabel || '').trim()
      const dscContextLabel = typeof args.contextLabel === 'string' ? args.contextLabel.trim() : undefined
      const dscVibes = Array.isArray(args.vibes) ? args.vibes : []
      if (!dscSlug || dscVibes.length === 0) {
        return { text: 'Error: slug and non-empty vibes array are required', isError: true }
      }
      if (!Number.isFinite(dscCap) || dscCap < 1 || dscCap > dscVibes.length) {
        return {
          text: `Error: cap must be an integer between 1 and vibes.length (=${dscVibes.length}); got ${args.cap}`,
          isError: true,
        }
      }
      if (!dscCtaLabel) {
        return { text: 'Error: ctaLabel is required (e.g. "Ship This Vibe", "Advance These 2", "Narrow to Top 3")', isError: true }
      }
      const r = await postJson<{ ok: boolean; vibeCount?: number; error?: string }>(
        '/api/mcp/present-descent-selection',
        {
          sessionId,
          slug: dscSlug,
          cap: dscCap,
          ctaLabel: dscCtaLabel,
          contextLabel: dscContextLabel,
          vibes: dscVibes,
          prompt: args.prompt,
          preamble: args.preamble,
        },
      )
      if (!r.ok) return { text: `tc_descent_selection failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `tc_descent_selection error: ${r.body.error}`, isError: true }
      return {
        text:
          `Descent selection card surfaced (${r.body?.vibeCount ?? dscVibes.length} candidates, cap=${dscCap}). ` +
          `Wait for the user's response — it arrives as a regular user message with { picks: string[] }.`,
        isError: false,
      }
    }

    // ── Ralph 2026-05-06: on-demand card preview ─────────────────────────
    case 'preview_card': {
      const kind = String(args.kind || '').trim()
      const payload = (args.payload && typeof args.payload === 'object') ? args.payload : null
      if (!kind) return { text: 'Error: kind is required', isError: true }
      if (!payload) return { text: 'Error: payload object is required', isError: true }
      const r = await postJson<{ ok: boolean; kind?: string; error?: string }>(
        '/api/mcp/preview-card',
        { sessionId, kind, payload },
      )
      if (!r.ok) return { text: `preview_card failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `preview_card error: ${r.body.error}`, isError: true }
      return {
        text:
          `Card preview rendered (kind=${r.body?.kind ?? kind}). The user ` +
          `now sees a visual instance in chat.`,
        isError: false,
      }
    }

    // ── WP-66 (Ralph 2026-05-06): TodoWrite persistence ─────────────────
    case 'todo_write': {
      const todos = Array.isArray(args.todos) ? args.todos : null
      if (!todos) return { text: 'Error: todos must be an array', isError: true }
      const r = await postJson<{ ok: boolean; count?: number; error?: string }>(
        '/api/mcp/todo-write',
        { sessionId, todos },
      )
      if (!r.ok) return { text: `todo_write failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `todo_write error: ${r.body.error}`, isError: true }
      return {
        text:
          `Todos written (${r.body?.count ?? todos.length} items). ` +
          `Panel updates via todos_updated event.`,
        isError: false,
      }
    }

    // ── Bug 18: typed IMAGES.md mutation ────────────────────────────────
    case 'update_image_metadata': {
      const filename = String(args.filename || '').trim()
      if (!filename) return { text: 'Error: `filename` is required', isError: true }
      const r = await postJson<{ ok: boolean; created?: boolean; error?: string }>(
        '/api/mcp/update-image-metadata',
        {
          sessionId,
          filename,
          status: args.status,
          evaluation: args.evaluation,
          vibe: args.vibe,
          slot: args.slot,
          note: args.note,
        },
      )
      if (!r.ok) return { text: `update_image_metadata failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `update_image_metadata error: ${r.body.error}`, isError: true }
      return {
        text: r.body?.created ? `Created entry for ${filename}` : `Updated entry for ${filename}`,
        isError: false,
      }
    }

    default:
      return { text: `Unknown CD tool: ${name as string}`, isError: true }
  }
}
