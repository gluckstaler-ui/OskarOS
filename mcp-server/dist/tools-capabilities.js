/**
 * Capability tools (Tier S/A/B of Phase 2 MCP refactor — 2026-04-30).
 *
 * Unlike the Family-1 submit/report tools (pure ack), these RPC tools do
 * real work: fire Nano Banana, capture a Playwright screenshot, publish a
 * snackbar event, ask the user a synchronous question, patch HTML in place,
 * lint a vibe for brand compliance, run Sharp pipelines, etc.
 *
 * Each handler POSTs to a dedicated /api/mcp/{slug} route that does the work
 * and returns a structured result.
 *
 * Per-agent permissions (tier S = mostly all agents; A/B = mostly CD-only):
 *   Tier S: generate_image (CD), screenshot (CD/WebDev),
 *           snackbar (all), ask_user (all)
 *   Tier A: apply_patch (CD), list_assets (CD/WebDev),
 *           find_assets (CD), session_meta (all),
 *           lint_brand_compliance (CD/WebDev)
 *   Tier B: image_ops (CD), vibe_diff (CD)
 *
 * Permission scoping is enforced at SPAWN time via --allowed-tools (see
 * lib/mcp-config.ts). The MCP server serves all tools; the CLI flag gates.
 */
import { postJson } from './api-client.js';
export const CAPABILITY_TOOL_DEFINITIONS = [
    // ── Tier S: generate_image ────────────────────────────────────────────
    {
        name: 'generate_image',
        description: 'Fire Nano Banana directly without waiting for the user to click Generate. ' +
            'Use after writing a prompt (or after the user agrees you should generate). ' +
            'Refs are filenames already in the session folder (matches Image Mode). ' +
            'Slot is optional — sets the suggested role for the new image. ' +
            'Returns the new filename + saved path + Nano\'s self-description. The ' +
            '`image_ready` event-bus publish (existing pipeline, Phase 1) still ' +
            'fires so the user sees the snackbar.',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Nano Banana prompt.' },
                ratio: {
                    type: 'string',
                    enum: ['1:1', '16:9', '9:16', '3:4', '4:3'],
                    description: 'Aspect ratio. Default 16:9 if omitted.',
                },
                refs: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional reference image filenames in the session folder. The server ' +
                        'loads them, base64-encodes, and passes them to Nano. Names must already ' +
                        'exist on disk; missing files cause the tool to error before the API call.',
                },
                slot: {
                    type: 'string',
                    description: 'Optional vibe slot the image targets (e.g. "hero", "menu-bg"). Becomes ' +
                        'the `purpose` field in IMAGES.md.',
                },
            },
            required: ['prompt'],
        },
    },
    // ── Tier S: screenshot ────────────────────────────────────────────────
    {
        name: 'screenshot',
        description: 'Render a built vibe HTML and return the actual visual output as an image. ' +
            'Replaces the "read HTML and pretend that\'s verification" failure mode. ' +
            'Target is a vibe slug (e.g. "vibe-3" → resolves to vibe-3-*.html) or a ' +
            'literal filename. Frame controls viewport (default desktop). ' +
            'Screenshots accumulate in `public/{session}/screenshots/` and are ' +
            'wiped by Order 66 on session close.',
        inputSchema: {
            type: 'object',
            properties: {
                target: {
                    type: 'string',
                    description: 'Vibe slug ("vibe-3") or filename ("vibe-3-the-deployment.html").',
                },
                frame: {
                    type: 'string',
                    enum: ['mobile', 'tablet', 'desktop'],
                    description: 'Viewport size. Default desktop (1280x800).',
                },
            },
            required: ['target'],
        },
    },
    // ── Tier S: snackbar (fire-and-forget) ────────────────────────────────
    {
        name: 'snackbar',
        description: 'Speak unprompted to the user via a snackbar. Fire-and-forget: no return ' +
            'value. Uses the SAME UI as every other snackbar in the app (image ' +
            'pipeline, hot-swap, etc.). Severity drives color + default persistence:\n' +
            '  • info     → blue,      auto-dismiss 5s\n' +
            '  • success  → green,     auto-dismiss 5s\n' +
            '  • progress → cyan,      sticky (an op is in flight; dismiss when done)\n' +
            '  • warning  → yellow,    sticky\n' +
            '  • error    → red,       sticky\n\n' +
            '`sticky` is ORTHOGONAL to severity. Pass sticky:true to keep info/success ' +
            'visible; pass sticky:false to auto-dismiss warning/error/progress. Fire ' +
            'whenever you want — there is no penalty for snackbar volume. For questions, ' +
            'use `ask_user`.',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Snackbar message.' },
                severity: {
                    type: 'string',
                    enum: ['info', 'success', 'progress', 'warning', 'error'],
                    description: 'Default `info`. `info`=blue, `success`=green, `progress`=cyan, ' +
                        '`warning`=yellow, `error`=red. `warn` is accepted as an alias for ' +
                        '`warning` for back-compat.',
                },
                sticky: {
                    type: 'boolean',
                    description: 'Override the per-severity default. true → stay until dismissed; ' +
                        'false → auto-dismiss after 5s. Defaults: info/success auto, ' +
                        'progress/warning/error sticky.',
                },
            },
            required: ['text'],
        },
    },
    // ── Tier S: ask_user (synchronous question with options) ──────────────
    {
        name: 'ask_user',
        description: 'Ask the user a question with discrete options. Synchronous from your POV: ' +
            'this tool blocks until the user picks (or 10 minutes pass, in which case ' +
            'it returns the cancel sentinel "__cancelled__"). Use for: "you have three ' +
            'vibes failing AA contrast, want me to fix?" / "should I commit this prompt ' +
            'or keep iterating?" / "OK to ship the deck as-is?" Returns the chosen option ' +
            'string (or "__cancelled__"). Do NOT use this in a tight loop — it blocks the ' +
            'agent until the user responds.',
        inputSchema: {
            type: 'object',
            properties: {
                question: {
                    type: 'string',
                    description: 'The question to display in the modal.',
                },
                options: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 2,
                    description: 'Discrete option strings. The user picks one. Returned verbatim.',
                },
            },
            required: ['question', 'options'],
        },
    },
    // ── Tier A: session_meta ─────────────────────────────────────────────
    {
        name: 'session_meta',
        description: 'Snapshot of the entire session in one call. Returns vibesBuilt, vibesPending, ' +
            'imagesByStatus histogram, deckFiles, brokenRefs (IMAGES.md entries pointing ' +
            'to missing files), and currentPhase (discovery/vibes/final/unknown). Cheap — ' +
            'no Sharp, no JSDOM. Call this at the start of any decision rather than ' +
            'reading six files separately.',
        inputSchema: { type: 'object', properties: {} },
    },
    // ── Tier A: list_assets (state index — no thumbnails) ────────────────
    {
        name: 'list_assets',
        description: 'State index of every image in the session. Returns metadata only — NO ' +
            'thumbnails, NO base64. If you need to look at a file, FileRead it (Claude ' +
            'is multimodal; the actual file beats a 160px shrink). Per-asset shape: ' +
            'filename, status, broken, sizeKB, dimensions ("WxH"), aspectRatio ("W:H"), ' +
            'mtime, vibeUsage (["vibe-3:hero", "vibe-7:portrait"]), cdNote (one line ' +
            '≤120 chars from IMAGES.md). Filters: tag, vibe, broken (true=isolate dead ' +
            'refs), usedIn (false=orphans on disk with zero HTML refs). Paginated: ' +
            'limit default 50, max 200. Response envelope: { assets, total, truncated }.',
        inputSchema: {
            type: 'object',
            properties: {
                filter: {
                    type: 'object',
                    properties: {
                        tag: {
                            type: 'string',
                            description: 'HERO | USED | B-ROLL | TRASH | READY | INGESTED | APPROVED | REDO | UNTAGGED',
                        },
                        vibe: { type: 'string', description: 'Vibe slug (e.g. "vibe-3"). Matches usage in HTML or suggestedVibes in IMAGES.md.' },
                        broken: { type: 'boolean', description: 'true → only dead refs; false → exclude them.' },
                        usedIn: { type: 'boolean', description: 'true → only assets referenced in HTML; false → orphans.' },
                    },
                },
                limit: { type: 'number', description: 'Default 50, max 200.' },
                offset: { type: 'number', description: 'Default 0. Use with limit for paging.' },
            },
        },
    },
    // ── Tier A: find_assets ──────────────────────────────────────────────
    {
        name: 'find_assets',
        description: 'Keyword search over filenames + Nano CD analysis text. Returns ranked ' +
            '{filename, score, snippet}[]. Score: filename match=3, word-boundary desc ' +
            'match=2, partial desc match=1, +1 bonus when matched in BOTH sources. v1 ' +
            'has no embedding — use literal terms. Use to recover a specific shot you ' +
            'remember describing without remembering the filename.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'One or more keywords. Whitespace-separated.',
                },
                limit: { type: 'number', description: 'Default 10, max 50.' },
            },
            required: ['query'],
        },
    },
    // ── Tier A: lint_brand_compliance ────────────────────────────────────
    {
        name: 'lint_brand_compliance',
        description: 'Lint a vibe HTML file for the v1 rule set: (1) every <img> must have BOTH ' +
            'data-slot AND data-usage; (2) every <img src> must point to a file that ' +
            'exists on disk. Returns {violations:[{rule, severity, snippet, suggestion}]}. ' +
            'No banned phrases, no AI-default palette detection, no contrast checks in ' +
            'v1 — these are the two failures we have actually seen ship.',
        inputSchema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    description: 'Filename in the session folder, must end in .html.',
                },
            },
            required: ['file'],
        },
    },
    // ── Tier A: apply_patch ──────────────────────────────────────────────
    {
        name: 'apply_patch',
        description: 'Surgically edit a built vibe HTML in place — no full rebuild. The edit ' +
            'must be one of the typed kinds: css-var-set / text-replace / attr-set / ' +
            'class-toggle / delete / insert. Anything more complex goes through ' +
            'build_vibe. Refuses any selector that targets <script> or descendants. ' +
            'Records a diff for Director Mode revert. Use to: tweak a CSS var, fix a ' +
            'typo, swap an attribute, toggle a class on the body, delete a stray ' +
            'element, insert a small block. ' +
            'css-var-set: pass NO selector to edit `:root { --foo: ... }` in the ' +
            'inline <style>; pass a selector to set inline style on matched elements. ' +
            'insert: requires `anchor` (not `selector`).',
        inputSchema: {
            type: 'object',
            properties: {
                target: {
                    type: 'string',
                    description: 'Vibe slug ("vibe-3") or filename ("vibe-3-the-deployment.html").',
                },
                edit: {
                    type: 'object',
                    description: 'Discriminated by `kind`. Each kind has its own required params; ' +
                        'see lib/html-patch-engine.ts for the type unions.',
                    properties: {
                        kind: {
                            type: 'string',
                            enum: ['css-var-set', 'text-replace', 'attr-set', 'class-toggle', 'delete', 'insert'],
                        },
                        selector: { type: 'string' },
                        anchor: { type: 'string', description: 'For kind=insert (instead of selector).' },
                        position: { type: 'string', enum: ['before', 'after', 'append', 'prepend'] },
                        html: { type: 'string', description: 'For kind=insert.' },
                        varName: { type: 'string', description: 'For kind=css-var-set.' },
                        value: { type: 'string' },
                        text: { type: 'string', description: 'For kind=text-replace.' },
                        attr: { type: 'string', description: 'For kind=attr-set.' },
                        className: { type: 'string', description: 'For kind=class-toggle.' },
                        force: { type: 'boolean', description: 'For kind=class-toggle (force on/off).' },
                    },
                    required: ['kind'],
                },
            },
            required: ['target', 'edit'],
        },
    },
    // ── Tier B: image_ops ────────────────────────────────────────────────
    {
        name: 'image_ops',
        description: 'Sharp pipeline. Operations: crop ({x,y,w,h} or {aspect}), slice ({rows,cols}), ' +
            'resize ({w?,h?,fit?}), chroma-key ({color?,tolerance?}), format-convert ({to}), ' +
            'composite ({source,output,position,scale?,opacity?,source_alpha?}). New files ' +
            'are appended to IMAGES.md as B-ROLL for your evaluation. No blend modes, no ' +
            'rotation in v1.',
        inputSchema: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'Source filename in the session folder.',
                },
                operation: {
                    type: 'string',
                    enum: ['crop', 'slice', 'resize', 'chroma-key', 'format-convert', 'composite'],
                },
                params: {
                    type: 'object',
                    description: 'Op-specific parameters; see operation enum + lib/image-ops.ts for shape.',
                },
            },
            required: ['filename', 'operation', 'params'],
        },
    },
    // ── Tier B: vibe_diff ────────────────────────────────────────────────
    {
        name: 'vibe_diff',
        description: 'Compare a vibe HTML to its `last-build` snapshot. Returns unified diff + ' +
            'summary {linesAdded, linesRemoved, sectionsChanged}. v1 SPEC LOCK: only ' +
            '`since=last-build` is supported. Director-Mode changes are PUSHED via the ' +
            'director_save event-bus event — do NOT poll vibe_diff for that case.',
        inputSchema: {
            type: 'object',
            properties: {
                target: {
                    type: 'string',
                    description: 'Vibe slug or filename.',
                },
                since: {
                    type: 'string',
                    enum: ['last-build'],
                    description: 'v1 spec lock — only "last-build" is supported.',
                },
            },
            required: ['target'],
        },
    },
    // ── Preview card (Ralph 2026-05-06): on-demand visual sample ───────────
    {
        name: 'preview_card',
        description: 'Render a SAMPLE of a chat-surface card with given payload, marked as a ' +
            'preview (no real backend writes). Use when the user asks to "show me [a ' +
            'card]" — fire this tool instead of pasting source code. Supported kinds: ' +
            'upload_eval, upload_eval_batch, screenshot, apply_patch, diagnostic_chip, ' +
            'discovery_questions, confirm_understanding. Payload must match the matching ' +
            'AssistantCardPayload shape minus `kind` (see lib/types.ts).',
        inputSchema: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    enum: [
                        'upload_eval',
                        'upload_eval_batch',
                        'screenshot',
                        'apply_patch',
                        'diagnostic_chip',
                        'discovery_questions',
                        'confirm_understanding',
                    ],
                    description: 'Which card to preview.',
                },
                payload: {
                    type: 'object',
                    description: 'Card-specific fields (omit `kind` — it is set from the top-level ' +
                        'param). Shape per lib/types.ts AssistantCardPayload.',
                },
            },
            required: ['kind', 'payload'],
        },
    },
];
export async function callCapabilityTool(name, args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId)
        return { text: 'sessionId missing from tool context', isError: true };
    switch (name) {
        // 2026-04-30 (Ralph + CD): same escrow refactor as the build tools.
        // /api/mcp/generate-image returns `{status:'running', jobId,
        // deduped, originalStartedAt}` immediately. The Nano call runs in
        // the background; CD polls via job_status to get the filename.
        case 'generate_image': {
            const prompt = String(args.prompt || '').trim();
            if (!prompt)
                return { text: 'Error: prompt is required', isError: true };
            const r = await postJson('/api/mcp/generate-image', {
                sessionId,
                prompt,
                ratio: args.ratio,
                refs: args.refs,
                slot: args.slot,
            });
            if (!r.ok)
                return { text: `generate_image failed: ${r.error}`, isError: true };
            if (r.body?.status === 'running' && r.body.jobId) {
                const dedupNote = r.body.deduped
                    ? ` (deduped — already running since ${r.body.originalStartedAt})`
                    : '';
                return {
                    text: `generate_image enqueued: jobId=${r.body.jobId}${dedupNote}. ` +
                        `Poll via job_status; do 1–2 turns of other work between polls. ` +
                        `On complete, FileRead the result.filename and evaluate.`,
                    isError: false,
                };
            }
            return { text: `generate_image error: ${r.body?.error || 'unknown'}`, isError: true };
        }
        case 'screenshot': {
            const target = String(args.target || '').trim();
            if (!target)
                return { text: 'Error: target is required', isError: true };
            const r = await postJson('/api/mcp/screenshot', {
                sessionId,
                target,
                frame: args.frame || 'desktop',
            });
            if (!r.ok)
                return { text: `screenshot failed: ${r.error}`, isError: true };
            // Return text payload only — the image content block is opt-in (the MCP
            // SDK lets us return image content blocks but the test harness keeps
            // text-only for simplicity). The caller can inspect the saved file.
            if (r.body?.savedPath)
                return { text: `Screenshot saved: ${r.body.savedPath}`, isError: false };
            return { text: `screenshot error: ${r.body?.error || 'unknown'}`, isError: true };
        }
        case 'preview_card': {
            const kind = String(args.kind || '').trim();
            const payload = args.payload;
            if (!kind || !payload || typeof payload !== 'object') {
                return { text: 'Error: kind + payload (object) required', isError: true };
            }
            const r = await postJson('/api/mcp/preview-card', {
                sessionId,
                kind,
                payload,
            });
            if (!r.ok)
                return { text: `preview_card failed: ${r.error}`, isError: true };
            return { text: `preview_card published: kind=${kind}`, isError: false };
        }
        case 'snackbar': {
            const text = String(args.text || '').trim();
            if (!text)
                return { text: 'Error: text is required', isError: true };
            // Accept the full 5-severity set + 'warn' alias for 'warning'.
            const sevIn = String(args.severity || 'info');
            const sev = sevIn === 'success' ? 'success' :
                sevIn === 'progress' ? 'progress' :
                    sevIn === 'warning' || sevIn === 'warn' ? 'warning' :
                        sevIn === 'error' ? 'error' :
                            'info';
            const sticky = typeof args.sticky === 'boolean' ? args.sticky : undefined;
            const r = await postJson('/api/mcp/snackbar', {
                sessionId,
                text,
                severity: sev,
                sticky,
            });
            if (!r.ok)
                return { text: `snackbar failed: ${r.error}`, isError: true };
            return { text: 'snackbar published', isError: false };
        }
        case 'ask_user': {
            const question = String(args.question || '').trim();
            const options = Array.isArray(args.options)
                ? args.options.filter((o) => typeof o === 'string')
                : [];
            if (!question)
                return { text: 'Error: question is required', isError: true };
            if (options.length < 2)
                return { text: 'Error: need at least 2 options', isError: true };
            const r = await postJson('/api/mcp/ask-user', { sessionId, question, options });
            if (!r.ok)
                return { text: `ask_user failed: ${r.error}`, isError: true };
            const choice = r.body?.choice;
            if (!choice)
                return { text: `ask_user error: ${r.body?.error || 'no choice'}`, isError: true };
            return { text: choice, isError: false };
        }
        // ── Tier A ────────────────────────────────────────────────────────
        case 'session_meta': {
            const r = await postJson('/api/mcp/session-meta', { sessionId });
            if (!r.ok)
                return { text: `session_meta failed: ${r.error}`, isError: true };
            return { text: JSON.stringify(r.body), isError: false };
        }
        case 'list_assets': {
            const r = await postJson('/api/mcp/list-assets', {
                sessionId,
                filter: args.filter,
                limit: args.limit,
                offset: args.offset,
            });
            if (!r.ok)
                return { text: `list_assets failed: ${r.error}`, isError: true };
            // Return the full envelope (assets + total + truncated) so the caller
            // can decide whether to page. The agent sees the truncation signal
            // and re-calls with offset if needed.
            return {
                text: JSON.stringify({
                    assets: r.body?.assets || [],
                    total: r.body?.total ?? 0,
                    truncated: r.body?.truncated ?? false,
                }),
                isError: false,
            };
        }
        case 'find_assets': {
            const query = String(args.query || '').trim();
            if (!query)
                return { text: 'Error: query is required', isError: true };
            const r = await postJson('/api/mcp/find-assets', {
                sessionId,
                query,
                limit: args.limit,
            });
            if (!r.ok)
                return { text: `find_assets failed: ${r.error}`, isError: true };
            return { text: JSON.stringify(r.body?.hits || []), isError: false };
        }
        case 'lint_brand_compliance': {
            const file = String(args.file || '').trim();
            if (!file)
                return { text: 'Error: file is required', isError: true };
            const r = await postJson('/api/mcp/lint-brand', {
                sessionId,
                file,
            });
            if (!r.ok)
                return { text: `lint_brand_compliance failed: ${r.error}`, isError: true };
            return { text: JSON.stringify(r.body?.violations || []), isError: false };
        }
        case 'apply_patch': {
            const target = String(args.target || '').trim();
            const edit = args.edit;
            if (!target || !edit) {
                return { text: 'Error: target + edit required', isError: true };
            }
            const r = await postJson('/api/mcp/apply-patch', { sessionId, target, edit });
            if (!r.ok)
                return { text: `apply_patch failed: ${r.error}`, isError: true };
            if (!r.body?.ok) {
                return { text: `apply_patch error: ${r.body?.error || 'unknown'}`, isError: true };
            }
            return {
                text: `Patched ${target} (${r.body.affected} node(s) affected).`,
                isError: false,
            };
        }
        // ── Tier B ────────────────────────────────────────────────────────
        case 'image_ops': {
            const filename = String(args.filename || '').trim();
            const operation = String(args.operation || '').trim();
            if (!filename || !operation) {
                return { text: 'Error: filename + operation required', isError: true };
            }
            const r = await postJson('/api/mcp/image-ops', { sessionId, filename, operation, params: args.params });
            if (!r.ok)
                return { text: `image_ops failed: ${r.error}`, isError: true };
            if (!r.body?.ok)
                return { text: `image_ops error: ${r.body?.error}`, isError: true };
            // 2026-04-30 (Ralph bug C): surface dimensions + sizeKB in the agent
            // result so the caller can verify the op landed (e.g. resize w=400
            // → "400x600 (37KB)") — not just that some file got written.
            const summary = (r.body.outputs || [])
                .map((o) => `${o.filename} (${o.dimensions || '?'}, ${o.sizeKB}KB)`)
                .join(', ');
            return {
                text: `image_ops ${operation} → ${summary}`,
                isError: false,
            };
        }
        case 'vibe_diff': {
            const target = String(args.target || '').trim();
            if (!target)
                return { text: 'Error: target is required', isError: true };
            const since = args.since || 'last-build';
            const r = await postJson('/api/mcp/vibe-diff', { sessionId, target, since });
            if (!r.ok)
                return { text: `vibe_diff failed: ${r.error}`, isError: true };
            if (r.body?.error)
                return { text: `vibe_diff error: ${r.body.error}`, isError: true };
            const note = r.body?.note ? `\n${r.body.note}` : '';
            const summary = r.body?.summary
                ? `\nSummary: +${r.body.summary.linesAdded}/-${r.body.summary.linesRemoved} lines, ${r.body.summary.sectionsChanged} sections changed`
                : '';
            return { text: `${r.body?.diff || ''}${summary}${note}`, isError: false };
        }
        default:
            return { text: `Unknown capability tool: ${name}`, isError: true };
    }
}
//# sourceMappingURL=tools-capabilities.js.map