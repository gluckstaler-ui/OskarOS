/**
 * WebDev-side MCP tools (Phase 2, 2026-04-30).
 *
 * Replaces the trailing-JSON-manifest contract:
 *
 *   OLD: agent ends response with `{"filename":"vibe-3.html","vibeIndex":3,...}`;
 *        lib/vibe-verify.ts:parseTrailingJson scans last 20 lines + scrapes
 *        tool_use events + scans disk by mtime when manifest is missing.
 *   NEW: agent calls `build_done({...})` after writing the file.
 *        lib/webdev.ts captures the tool_use args via lib/mcp-tool-collector.
 *
 * The OLD parseTrailingJson stays as a defensive fallback for ALL backends
 * (Claude CLI, Claude API loop, Gemini) — see plan, Risk + rollback section.
 *
 * As with CD's submit_* tools, the MCP server's job here is trivial: validate
 * args, return ack. The structured manifest flows via tool_use; runWebDev
 * reads it from the captured event.
 */

import type { ToolCallContext } from './tools.js'

export const WEBDEV_TOOL_DEFINITIONS = [
  {
    name: 'build_done',
    description:
      'Call this AFTER writing the vibe HTML to disk. Reports the structured ' +
      'manifest the orchestrator needs (filename, vibeIndex, vibeName, sections ' +
      'built, images used). Replaces the old "end your response with a JSON ' +
      'manifest line" contract — that parser was retired 2026-04-30. Do NOT ' +
      'write `## BUILD COMPLETE` or trailing JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description:
            'The file you wrote, relative to the session folder. Must end in .html. ' +
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
          description:
            'Sections actually present in the HTML (e.g. ["hero", "menu", ' +
            '"residents", "location", "footer"]). Used by the verifier.',
        },
        imagesUsed: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filenames of images referenced in the HTML. Cross-checked against ' +
            'session folder by the verifier.',
        },
      },
      required: ['filename', 'vibeIndex', 'vibeName', 'sectionsBuilt', 'imagesUsed'],
    },
  },
  {
    name: 'build_fail',
    description:
      'Call when the build cannot complete — e.g. the spec is incoherent, a ' +
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
    name: 'build_progress',
    description:
      'Emit a progress signal mid-build. Two shapes:\n' +
      '  1. STAGE TRANSITION (BuildJobCard timeline):\n' +
      '       build_progress({stage: "verify", milestone: "Screenshotting"})\n' +
      '       build_progress({stage: "critique", milestone: "Filling surfaces"})\n' +
      '     Note: "html" is route-fired at spawn; WebDev rarely fires it.\n' +
      '     "critique" is wireframes only (build_wireframes — Phase 7 of\n' +
      '     webdev-agent-rewrite.md).\n' +
      '  2. FREE-FORM MILESTONE (no stage): "Hero section built", etc.\n' +
      '     Surfaces as a bullet under the row. Optional.\n' +
      'Routing is automatic — the route binds your target slug into the\n' +
      'per-subprocess onToolCall handler at spawn. Every call you fire\n' +
      'flows through THAT handler; the route auto-tags the published event\n' +
      'with target=<your-slug>, which page.tsx matches to row.id. You do\n' +
      'NOT carry slug/filename in this payload.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['html', 'verify', 'critique'],
          description:
            'Pipeline-stage transition. Route auto-fires "html" at spawn. ' +
            'Fire "verify" before screenshotting (every build). Fire ' +
            '"critique" before filling in-page surfaces (wireframes only). ' +
            'Omit for free-form milestone bullets.',
        },
        milestone: {
          type: 'string',
          description:
            'Human-readable status line. With stage: a one-line "what just ' +
            'happened". Without stage: a free-form bullet for the row.',
        },
      },
      required: ['milestone'],
    },
  },
] as const

export type WebDevToolName = (typeof WEBDEV_TOOL_DEFINITIONS)[number]['name']

export async function callWebDevTool(
  name: WebDevToolName,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<{ text: string; isError: boolean }> {
  // All three are pure-ack tools. lib/webdev.ts captures the typed args
  // from the agent's stream via mcp-tool-collector. The server's only
  // responsibility is "this tool exists, the call is valid, continue."
  const sessionId = ctx.sessionId
  if (!sessionId) return { text: 'sessionId missing from tool context', isError: true }

  switch (name) {
    case 'build_done': {
      const filename = String(args.filename || '')
      if (!filename || !filename.endsWith('.html')) {
        return { text: 'Error: filename must be a .html path', isError: true }
      }
      if (typeof args.vibeIndex !== 'number') {
        return { text: 'Error: vibeIndex must be a number', isError: true }
      }
      return { text: `build_done acked for ${filename}`, isError: false }
    }
    case 'build_fail': {
      if (!args.error) return { text: 'Error: error message required', isError: true }
      return { text: 'build_fail acked', isError: false }
    }
    case 'build_progress':
      // Ralph 2026-05-18 (Job-Card Ladder Fix, revert): closure-based
      // routing handles target tagging in the route's onToolCall. WebDev
      // does NOT carry slug/filename in build_progress payloads — row.id
      // is the SLUG (no .html), so a filename-based routing key would
      // mismatch page.tsx:1083's `r.id === target` matcher.
      return { text: 'progress acked', isError: false }
    default:
      return { text: `Unknown WebDev tool: ${name as string}`, isError: true }
  }
}
