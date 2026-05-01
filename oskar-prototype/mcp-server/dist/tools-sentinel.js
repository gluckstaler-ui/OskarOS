/**
 * Sentinel Ti MCP tools (Phase 2, 2026-04-30).
 *
 * Replaces the text-block accumulation in lib/sentinel-ti.ts. Ti still writes
 * the narrative critique as text (streamed live to the feed), but the
 * STRUCTURED scores come via this tool call. The two flow in parallel from
 * the same stream — see lib/sentinel-ti.ts for the parallel-jobs architecture.
 *
 * Server-side handler is a pure ack (no backend work). The structured args
 * are captured by lib/sentinel-ti.ts via mcp-tool-collector; UI score badges
 * render from those args.
 */
export const SENTINEL_TOOL_DEFINITIONS = [
    {
        name: 'submit_critique',
        description: 'Call AFTER writing the narrative critique. Submits the structured ' +
            'scores the UI uses for badges/charts. Do NOT embed the scores in the ' +
            'narrative text — the parser was retired 2026-04-30.',
        inputSchema: {
            type: 'object',
            properties: {
                target: {
                    type: 'string',
                    description: 'What you critiqued — e.g. "vibe-3.html", "CREATIVE-BRIEF.md", ' +
                        '"vibe-3 + IMAGES.md".',
                },
                scores: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            dimension: {
                                type: 'string',
                                description: 'The huashu dimension scored: "philosophy_alignment", ' +
                                    '"visual_hierarchy", "craft", "functionality", "originality", ' +
                                    'or any other dimension you defined for this critique type.',
                            },
                            score: {
                                type: 'number',
                                description: 'Score on a 0–10 scale (decimals OK).',
                                minimum: 0,
                                maximum: 10,
                            },
                            note: {
                                type: 'string',
                                description: 'One-line explanation of the score.',
                            },
                        },
                        required: ['dimension', 'score', 'note'],
                    },
                    description: 'Per-dimension scores. At least one entry.',
                },
                summary: {
                    type: 'string',
                    description: 'One-paragraph summary of the verdict. The narrative text in ' +
                        'your reply is the long form; this is the headline.',
                },
                recommendations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Specific, actionable recommendations. Each one a single ' +
                        'sentence. Empty array if none.',
                },
            },
            required: ['target', 'scores', 'summary', 'recommendations'],
        },
    },
];
export async function callSentinelTool(name, args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId)
        return { text: 'sessionId missing from tool context', isError: true };
    switch (name) {
        case 'submit_critique': {
            if (!args.target || typeof args.target !== 'string') {
                return { text: 'Error: target required', isError: true };
            }
            if (!Array.isArray(args.scores) || args.scores.length === 0) {
                return { text: 'Error: scores must be a non-empty array', isError: true };
            }
            return { text: 'critique submitted', isError: false };
        }
        default:
            return { text: `Unknown Sentinel tool: ${name}`, isError: true };
    }
}
//# sourceMappingURL=tools-sentinel.js.map