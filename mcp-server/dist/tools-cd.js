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
import { postJson } from './api-client.js';
export const CD_TOOL_DEFINITIONS = [
    // ── Orchestration (Phase 1) ────────────────────────────────────────────
    {
        name: 'build_vibe',
        description: 'Rebuild ONE vibe from its VIBE-N.md spec. Use after editing copy/structure ' +
            'in CREATIVE-BRIEF.md or VIBE-N.md. Replaces the old `## BUILD: vibe-N` magic ' +
            'word — call this tool, never write trigger strings into chat.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Vibe target. Either `vibe-N` (e.g. `vibe-3`) or the slug ' +
                        '(e.g. `the-deployment`). The server resolves it against VIBE-*.md.',
                },
            },
            required: ['name'],
        },
    },
    {
        name: 'build_all_vibes',
        description: 'Build EVERY VIBE-N.md file in the session sequentially. Replaces ' +
            'the old `## VIBES READY` magic word. Use after writing the full vibe ' +
            'set; do NOT use to rebuild a single vibe (use `build_vibe`).',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'build_final',
        description: 'Build the final landing page (and booking flow if applicable) from ' +
            'CREATIVE-BRIEF.md. Replaces the old `## BUILD READY` magic word. Use ' +
            'after the user picks a vibe.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'hotswap',
        description: 'Swap an approved image into a vibe slot. Resolution rule (2026-04-30):\n' +
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
        description: 'Signal that you have written/updated image prompts in IMAGES.md and want ' +
            'the Assets panel to refresh. Replaces `## IMAGES NEEDED`. The server ' +
            're-reads IMAGES.md and pushes the manifest to the frontend.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'refresh_assets',
        description: 'Force the Assets panel to re-read IMAGES.md. Replaces `## UPDATE ASSETS`. ' +
            'Use after ANY change to IMAGES.md — evaluations, status changes, site ' +
            'imports, reprompts, slot assignments.',
        inputSchema: { type: 'object', properties: {} },
    },
    // ── Submit tools (Phase 2 — replace text-output parsers) ────────────────
    {
        name: 'submit_proofread',
        description: 'Submit the structured proofread of an image prompt. Replaces the ' +
            '`## SEVERITY` / `## NOTE` / `## REWRITTEN_PROMPT` header format ' +
            '(parsers retired 2026-04-30). Call this when the app sends ' +
            '`[OSKAR-SYSTEM PROOFREAD]`. Do NOT write the headers in chat.',
        inputSchema: {
            type: 'object',
            properties: {
                severity: {
                    type: 'string',
                    enum: ['pass', 'advisory', 'rewritten'],
                    description: '`pass` — prompt is fine as-is. `advisory` — flagged but not rewritten ' +
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
        description: 'Submit a structured verdict on a generated image. Replaces the ' +
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
                    description: 'Optional. If set, replaces Nano\'s self-description in IMAGES.md ' +
                        '(use when Nano\'s description was wrong but the image is fine).',
                },
            },
            required: ['verdict', 'note'],
        },
    },
    {
        name: 'submit_upload_eval',
        description: 'Submit your evaluation of a user upload. Replaces the ' +
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
                    description: 'List of slot names this image could fill. Empty if verdict=✗.',
                },
            },
            required: ['verdict', 'note', 'suggestedUses'],
        },
    },
    {
        name: 'submit_image_prompt',
        description: 'Submit a structured Ask-CD response with an image prompt. Replaces the ' +
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
                    description: 'Optional context the user might want — what changed from their ask, ' +
                        'why this framing, what trade-offs.',
                },
            },
            required: ['prompt'],
        },
    },
    // ── Phase 2.5 (Ralph 2026-04-30): build/image escrow polling ──────────
    {
        name: 'job_status',
        description: 'Poll the status of a long-running job (build_vibe / build_all_vibes / ' +
            'build_final / generate_image). Returns a `job` object with the ' +
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
                    description: 'The jobId returned by build_vibe / build_all_vibes / build_final / generate_image. Omit to list all session jobs.',
                },
            },
        },
    },
    {
        name: 'cancel_job',
        description: 'Cancel a running build or image-generation job. Sends SIGTERM to the ' +
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
        description: 'Propose a new image prompt by writing a `### img-N` PENDING block to ' +
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
                    description: 'Vibe slug (e.g. "vibe-3"), display name, or "shared"/"all" for ' +
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
                    description: 'The Nano-ready prompt — proofread, ready to fire as-is when ' +
                        'the user clicks Generate. Use the same level of polish you would ' +
                        'in submit_image_prompt.',
                },
                id: {
                    type: 'string',
                    description: 'Optional explicit id (e.g. "img-goofy-v1"). Must match `img-<slug>` ' +
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
        name: 'ask_discovery_questions',
        description: 'Ask the user N structured questions during initial brand discovery. ' +
            'Use when ≥3 things still need clarification. Renders as a card with ' +
            'one input per question; user answers come back as a regular user ' +
            'message in the next turn.',
        inputSchema: {
            type: 'object',
            properties: {
                questions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of questions to ask. Non-empty.',
                },
                context: {
                    type: 'string',
                    description: 'Optional one-line preamble shown above the questions.',
                },
            },
            required: ['questions'],
        },
    },
    {
        name: 'confirm_understanding',
        description: 'Show the user a summary of what you understand about their business + ' +
            'a build-readiness flag. Renders as a card; if readyToGenerate=true, ' +
            'the card includes a "Build it" button that fires build_all_vibes. Use ' +
            'right before recommending a build.',
        inputSchema: {
            type: 'object',
            properties: {
                summary: {
                    type: 'string',
                    description: 'Your summary: one-sentence description, target customer, unique details, tone.',
                },
                readyToGenerate: {
                    type: 'boolean',
                    description: 'true = enough info to build now; false = still learning.',
                },
            },
            required: ['summary', 'readyToGenerate'],
        },
    },
    // ── Ralph 2026-05-06: on-demand card preview ───────────────────────────
    // When the user asks to "show me [a card]" / "what does X look like",
    // CD must NOT paste React source code. Call this tool with sample data;
    // the chat surface renders a real instance (`card.__preview: true` so
    // the renderer marks it as a sample with no backend side-effects).
    {
        name: 'preview_card',
        description: 'Render a chat-surface card with sample data so the user sees what ' +
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
                        // Each row carries { id, label, state, juniorDev?, eta?, thumb?,
                        // milestones?, error? }. state ∈ queued|wf|html|verify|done|failed.
                        'build',
                    ],
                    description: 'The card kind to render. Match a discriminator in lib/types.ts.',
                },
                payload: {
                    type: 'object',
                    description: 'Sample data for the card. Shape matches the corresponding ' +
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
        description: 'Write the current task list. Full-list replace (not incremental). ' +
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
        description: 'Patch (or create) an IMAGES.md entry for a generated/uploaded image. ' +
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
];
/**
 * Dispatch handler for CD tools. Orchestration tools POST to backend; submit
 * tools just ACK (data flows via tool_use events captured by callCDBridge).
 */
export async function callCDTool(name, args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
        return { text: 'sessionId missing from tool context', isError: true };
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
            const target = String(args.name || '').trim();
            if (!target)
                return { text: 'Error: `name` is required', isError: true };
            const r = await postJson('/api/mcp/build-vibe', { sessionId, target });
            if (!r.ok)
                return { text: r.error || 'build_vibe failed', isError: true };
            if (r.body?.status === 'running' && r.body.jobId) {
                const dedupNote = r.body.deduped
                    ? ` (deduped — already running since ${r.body.originalStartedAt})`
                    : '';
                return {
                    text: `build_vibe enqueued: jobId=${r.body.jobId}, target=${r.body.target || target}${dedupNote}. ` +
                        `Poll via job_status; do 1–2 turns of other work between polls.`,
                    isError: false,
                };
            }
            return { text: `build_vibe error: ${r.body?.error || 'unknown'}`, isError: true };
        }
        case 'build_all_vibes': {
            const r = await postJson('/api/mcp/build-all-vibes', { sessionId });
            if (!r.ok)
                return { text: r.error || 'build_all_vibes failed', isError: true };
            if (Array.isArray(r.body?.jobs) && r.body.jobs.length > 0) {
                const lines = r.body.jobs.map((j) => {
                    const dedupNote = j.deduped ? ` (deduped, since ${j.originalStartedAt})` : '';
                    return `  - ${j.target}: jobId=${j.jobId}${dedupNote}`;
                });
                return {
                    text: `build_all_vibes enqueued ${r.body.vibeCount} vibe(s). Per-vibe jobIds:\n` +
                        lines.join('\n') +
                        `\nPoll job_status(jobId) for each; do other work between polls.`,
                    isError: false,
                };
            }
            return { text: `build_all_vibes error: ${r.body?.error || 'unknown'}`, isError: true };
        }
        case 'build_final': {
            const r = await postJson('/api/mcp/build-final', { sessionId });
            if (!r.ok)
                return { text: r.error || 'build_final failed', isError: true };
            if (r.body?.status === 'running' && r.body.jobId) {
                const dedupNote = r.body.deduped
                    ? ` (deduped — already running since ${r.body.originalStartedAt})`
                    : '';
                return {
                    text: `build_final enqueued: jobId=${r.body.jobId}${dedupNote}. ` +
                        `Poll via job_status; do other work between polls.`,
                    isError: false,
                };
            }
            return { text: `build_final error: ${r.body?.error || 'unknown'}`, isError: true };
        }
        case 'hotswap': {
            const vibe = String(args.vibe || '').trim();
            const slot = String(args.slot || '').trim();
            const sourceImage = args.sourceImage ? String(args.sourceImage).trim() : undefined;
            if (!vibe || !slot)
                return { text: 'Error: `vibe` and `slot` are required', isError: true };
            const r = await postJson('/api/mcp/hotswap', { sessionId, vibe, slot, sourceImage });
            if (!r.ok)
                return { text: `hotswap failed: ${r.error}`, isError: true };
            if (r.body?.ok)
                return { text: `Swapped ${r.body.sourceImage} → ${vibe}/${slot}`, isError: false };
            return { text: `hotswap error: ${r.body?.error || 'unknown'}`, isError: true };
        }
        case 'images_needed': {
            const r = await postJson('/api/mcp/images-needed', { sessionId });
            if (!r.ok)
                return { text: `images_needed failed: ${r.error}`, isError: true };
            return {
                text: `IMAGES.md re-read. ${r.body.promptCount} prompts across ${r.body.manifestCount} vibes pushed to Assets panel.`,
                isError: false,
            };
        }
        case 'refresh_assets': {
            const r = await postJson('/api/mcp/refresh-assets', { sessionId });
            if (!r.ok)
                return { text: `refresh_assets failed: ${r.error}`, isError: true };
            return {
                text: `Assets panel refreshed at ${r.body?.parsedAt} — ${r.body?.entryCount ?? 0} entries in IMAGES.md.`,
                isError: false,
            };
        }
        // ── Submit tools — pure acks ──────────────────────────────────────────
        // The wrapping code (lib/cd-bridge-call.ts:callCDBridge) captures the
        // typed args from the bridge's stream-json output via the
        // lib/mcp-tool-collector helper. The server's only job here is to:
        //   1. Validate args via the JSON schema (already done by the MCP transport).
        //   2. Return success so the agent's tool_use turn completes cleanly.
        // No backend work, no event-bus publish, no DB write.
        case 'submit_proofread': {
            const sev = String(args.severity || '');
            if (!['pass', 'advisory', 'rewritten'].includes(sev)) {
                return { text: 'Error: severity must be pass|advisory|rewritten', isError: true };
            }
            if (sev === 'rewritten' && !args.rewrittenPrompt) {
                return { text: 'Error: rewrittenPrompt required when severity=rewritten', isError: true };
            }
            return { text: 'submitted', isError: false };
        }
        case 'submit_image_verdict':
        case 'submit_upload_eval':
        case 'submit_image_prompt':
            return { text: 'submitted', isError: false };
        // ── Phase 2.5: escrow polling + cancel ───────────────────────────────
        case 'job_status': {
            const jobId = args.jobId ? String(args.jobId).trim() : undefined;
            const r = await postJson('/api/mcp/job-status', { sessionId, jobId });
            if (!r.ok)
                return { text: r.error || 'job_status failed', isError: true };
            // Return the structured payload — CD reads job.status / job.result / job.error.
            return { text: JSON.stringify(r.body), isError: false };
        }
        case 'cancel_job': {
            const jobId = String(args.jobId || '').trim();
            if (!jobId)
                return { text: 'Error: `jobId` is required', isError: true };
            const r = await postJson('/api/mcp/cancel-job', { sessionId, jobId });
            if (!r.ok)
                return { text: r.error || 'cancel_job failed', isError: true };
            return { text: JSON.stringify(r.body), isError: false };
        }
        // ── Bug I (Ralph 2026-05-04): propose_image_prompt ──────────────────
        case 'propose_image_prompt': {
            const vibe = String(args.vibe || '').trim();
            const purpose = String(args.purpose || '').trim();
            const aspectRatio = String(args.aspectRatio || '').trim();
            const prompt = String(args.prompt || '').trim();
            const id = args.id ? String(args.id).trim() : undefined;
            if (!vibe || !purpose || !aspectRatio || !prompt) {
                return {
                    text: 'Error: vibe, purpose, aspectRatio, and prompt are all required',
                    isError: true,
                };
            }
            const r = await postJson('/api/mcp/propose-image-prompt', {
                sessionId,
                vibe,
                purpose,
                aspectRatio,
                prompt,
                ...(id ? { id } : {}),
            });
            if (!r.ok)
                return { text: `propose_image_prompt failed: ${r.error}`, isError: true };
            if (r.body?.error)
                return { text: `propose_image_prompt error: ${r.body.error}`, isError: true };
            return {
                text: `Wrote prompt block ${r.body?.id} to IMAGES.md (${r.body?.section}). ` +
                    `Panel will refresh via assets_updated. The user sees a Generate ` +
                    `button on the new card; do other work until they click it.`,
                isError: false,
            };
        }
        // ── Phase 2 discovery flow (Ralph 2026-05-04) ────────────────────────
        case 'ask_discovery_questions': {
            const questions = Array.isArray(args.questions) ? args.questions.map((q) => String(q ?? '').trim()).filter(Boolean) : [];
            if (questions.length === 0) {
                return { text: 'Error: questions must be a non-empty array of strings', isError: true };
            }
            const context = typeof args.context === 'string' ? args.context : undefined;
            const r = await postJson('/api/mcp/ask-discovery-questions', { sessionId, questions, context });
            if (!r.ok)
                return { text: `ask_discovery_questions failed: ${r.error}`, isError: true };
            if (r.body?.error)
                return { text: `ask_discovery_questions error: ${r.body.error}`, isError: true };
            return {
                text: `Discovery questions surfaced (${r.body?.questionCount ?? questions.length}). ` +
                    `Wait for the user's answers before continuing — they will arrive as a regular user message.`,
                isError: false,
            };
        }
        case 'confirm_understanding': {
            const summary = String(args.summary || '').trim();
            if (!summary)
                return { text: 'Error: summary is required', isError: true };
            const readyToGenerate = args.readyToGenerate === true;
            const r = await postJson('/api/mcp/confirm-understanding', { sessionId, summary, readyToGenerate });
            if (!r.ok)
                return { text: `confirm_understanding failed: ${r.error}`, isError: true };
            if (r.body?.error)
                return { text: `confirm_understanding error: ${r.body.error}`, isError: true };
            return {
                text: readyToGenerate
                    ? 'Understanding confirmed; user will trigger build via UI button.'
                    : 'Understanding summarized; user will continue clarifying or steer.',
                isError: false,
            };
        }
        // ── Ralph 2026-05-06: on-demand card preview ─────────────────────────
        case 'preview_card': {
            const kind = String(args.kind || '').trim();
            const payload = (args.payload && typeof args.payload === 'object') ? args.payload : null;
            if (!kind)
                return { text: 'Error: kind is required', isError: true };
            if (!payload)
                return { text: 'Error: payload object is required', isError: true };
            const r = await postJson('/api/mcp/preview-card', { sessionId, kind, payload });
            if (!r.ok)
                return { text: `preview_card failed: ${r.error}`, isError: true };
            if (r.body?.error)
                return { text: `preview_card error: ${r.body.error}`, isError: true };
            return {
                text: `Card preview rendered (kind=${r.body?.kind ?? kind}). The user ` +
                    `now sees a visual instance in chat.`,
                isError: false,
            };
        }
        // ── WP-66 (Ralph 2026-05-06): TodoWrite persistence ─────────────────
        case 'todo_write': {
            const todos = Array.isArray(args.todos) ? args.todos : null;
            if (!todos)
                return { text: 'Error: todos must be an array', isError: true };
            const r = await postJson('/api/mcp/todo-write', { sessionId, todos });
            if (!r.ok)
                return { text: `todo_write failed: ${r.error}`, isError: true };
            if (r.body?.error)
                return { text: `todo_write error: ${r.body.error}`, isError: true };
            return {
                text: `Todos written (${r.body?.count ?? todos.length} items). ` +
                    `Panel updates via todos_updated event.`,
                isError: false,
            };
        }
        // ── Bug 18: typed IMAGES.md mutation ────────────────────────────────
        case 'update_image_metadata': {
            const filename = String(args.filename || '').trim();
            if (!filename)
                return { text: 'Error: `filename` is required', isError: true };
            const r = await postJson('/api/mcp/update-image-metadata', {
                sessionId,
                filename,
                status: args.status,
                evaluation: args.evaluation,
                vibe: args.vibe,
                slot: args.slot,
                note: args.note,
            });
            if (!r.ok)
                return { text: `update_image_metadata failed: ${r.error}`, isError: true };
            if (r.body?.error)
                return { text: `update_image_metadata error: ${r.body.error}`, isError: true };
            return {
                text: r.body?.created ? `Created entry for ${filename}` : `Updated entry for ${filename}`,
                isError: false,
            };
        }
        default:
            return { text: `Unknown CD tool: ${name}`, isError: true };
    }
}
//# sourceMappingURL=tools-cd.js.map