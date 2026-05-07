/**
 * WebDev-side MCP tools (Phase 2, 2026-04-30).
 *
 * Replaces the trailing-JSON-manifest contract:
 *
 *   OLD: agent ends response with `{"filename":"vibe-3.html","vibeIndex":3,...}`;
 *        lib/vibe-verify.ts:parseTrailingJson scans last 20 lines + scrapes
 *        tool_use events + scans disk by mtime when manifest is missing.
 *   NEW: agent calls `report_build_complete({...})` after writing the file.
 *        lib/webdev.ts captures the tool_use args via lib/mcp-tool-collector.
 *
 * The OLD parseTrailingJson stays as a defensive fallback for ALL backends
 * (Claude CLI, Claude API loop, Gemini) — see plan, Risk + rollback section.
 *
 * As with CD's submit_* tools, the MCP server's job here is trivial: validate
 * args, return ack. The structured manifest flows via tool_use; runWebDev
 * reads it from the captured event.
 */
export const WEBDEV_TOOL_DEFINITIONS = [
    {
        name: 'report_build_complete',
        description: 'Call this AFTER writing the vibe HTML to disk. Reports the structured ' +
            'manifest the orchestrator needs (filename, vibeIndex, vibeName, sections ' +
            'built, images used). Replaces the old "end your response with a JSON ' +
            'manifest line" contract — that parser was retired 2026-04-30. Do NOT ' +
            'write `## BUILD COMPLETE` or trailing JSON.',
        inputSchema: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'The file you wrote, relative to the session folder. Must end in .html. ' +
                        'Convention: `vibe-{N}-{slug}.html`.',
                },
                vibeIndex: {
                    type: 'number',
                    description: 'The numeric index from VIBE-N.md you built.',
                },
                vibeName: {
                    type: 'string',
                    description: 'Human-readable vibe name (e.g. "The Deployment").',
                },
                sectionsBuilt: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Sections actually present in the HTML (e.g. ["hero", "menu", ' +
                        '"residents", "location", "footer"]). Used by the verifier.',
                },
                imagesUsed: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Filenames of images referenced in the HTML. Cross-checked against ' +
                        'session folder by the verifier.',
                },
            },
            required: ['filename', 'vibeIndex', 'vibeName', 'sectionsBuilt', 'imagesUsed'],
        },
    },
    {
        name: 'report_build_failed',
        description: 'Call when the build cannot complete — e.g. the spec is incoherent, a ' +
            'required image is missing AND has no fallback, or a verification step ' +
            'fails. Stops the build; do NOT continue with FileWrite after this.',
        inputSchema: {
            type: 'object',
            properties: {
                error: {
                    type: 'string',
                    description: 'One-to-three-sentence explanation of what blocked the build.',
                },
            },
            required: ['error'],
        },
    },
    {
        name: 'report_build_progress',
        description: 'Emit a progress signal mid-build. Two shapes:\n' +
            '  1. STAGE TRANSITION (required for live BuildJobCard timeline):\n' +
            '       report_build_progress({stage: "html", milestone: "HTML written to disk"})\n' +
            '       report_build_progress({stage: "verify", milestone: "Self-checking output"})\n' +
            '     Call once per stage. The route flips the row\'s timeline dot from\n' +
            '     queued → html → verify so the user sees progress in real time.\n' +
            '  2. FREE-FORM MILESTONE (no stage): "Hero section built", "Menu wired".\n' +
            '     Surfaces as a bullet under the row in single-vibe view. Optional.',
        inputSchema: {
            type: 'object',
            properties: {
                // Ralph 2026-05-06 fix: `stage` was missing from the schema even though
                // the agent prompt told WebDev to call with it. The MCP validator dropped
                // the arg silently → onToolCall forwarder never saw `stage` → live
                // timeline never advanced past queued. Both contracts now agree.
                stage: {
                    type: 'string',
                    enum: ['html', 'verify'],
                    description: 'Pipeline-stage transition signal. Call with "html" the moment ' +
                        'you start writing the .html file; call with "verify" right ' +
                        'after the file is on disk and you\'re self-checking. Omit for ' +
                        'free-form milestones.',
                },
                milestone: {
                    type: 'string',
                    description: 'Human-readable status line. With stage: a one-line "what just ' +
                        'happened". Without stage: a free-form bullet for the row.',
                },
            },
            required: ['milestone'],
        },
    },
];
export async function callWebDevTool(name, args, ctx) {
    // All three are pure-ack tools. lib/webdev.ts captures the typed args
    // from the agent's stream via mcp-tool-collector. The server's only
    // responsibility is "this tool exists, the call is valid, continue."
    const sessionId = ctx.sessionId;
    if (!sessionId)
        return { text: 'sessionId missing from tool context', isError: true };
    switch (name) {
        case 'report_build_complete': {
            const filename = String(args.filename || '');
            if (!filename || !filename.endsWith('.html')) {
                return { text: 'Error: filename must be a .html path', isError: true };
            }
            if (typeof args.vibeIndex !== 'number') {
                return { text: 'Error: vibeIndex must be a number', isError: true };
            }
            return { text: `report_build_complete acked for ${filename}`, isError: false };
        }
        case 'report_build_failed': {
            if (!args.error)
                return { text: 'Error: error message required', isError: true };
            return { text: 'report_build_failed acked', isError: false };
        }
        case 'report_build_progress':
            return { text: 'progress acked', isError: false };
        default:
            return { text: `Unknown WebDev tool: ${name}`, isError: true };
    }
}
//# sourceMappingURL=tools-webdev.js.map