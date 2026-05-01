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
      'Rebuild ONE vibe from its VIBE-N.md spec. Use after editing copy/structure ' +
      'in CREATIVE-BRIEF.md or VIBE-N.md. Replaces the old `## BUILD: vibe-N` magic ' +
      'word — call this tool, never write trigger strings into chat.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Vibe target. Either `vibe-N` (e.g. `vibe-3`) or the slug ' +
            '(e.g. `the-deployment`). The server resolves it against VIBE-*.md.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'build_all_vibes',
    description:
      'Build EVERY VIBE-N.md file in the session sequentially. Replaces ' +
      'the old `## VIBES READY` magic word. Use after writing the full vibe ' +
      'set; do NOT use to rebuild a single vibe (use `build_vibe`).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'build_final',
    description:
      'Build the final landing page (and booking flow if applicable) from ' +
      'CREATIVE-BRIEF.md. Replaces the old `## BUILD READY` magic word. Use ' +
      'after the user picks a vibe.',
    inputSchema: { type: 'object', properties: {} },
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
      'Poll the status of a long-running job (build_vibe / build_all_vibes / ' +
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

  // ── Bug 18 (2026-04-30): typed gateway for IMAGES.md mutations ──────────
  {
    name: 'update_image_metadata',
    description:
      'Patch (or create) an IMAGES.md entry for a generated/uploaded image. ' +
      'Replaces raw FileEdit against the markdown — that path corrupted ' +
      'entries by adding off-spec fields and masking Status. This tool writes ' +
      'a parser-clean entry. Status vocabulary (frozen): HERO, USED, B-ROLL, ' +
      'READY, APPROVED, REDO, INGESTED, TRASH, PENDING. Use after evaluating ' +
      'a generation to set verdict / re-tag / assign a slot.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The image filename (e.g. "hero-night.jpeg"). Required.',
        },
        status: {
          type: 'string',
          enum: ['HERO', 'USED', 'B-ROLL', 'READY', 'APPROVED', 'REDO', 'INGESTED', 'TRASH', 'PENDING'],
          description: 'Frozen vocabulary. No "ACTIVE" — that was a derived pseudo-status; use APPROVED/USED instead.',
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
      const target = String(args.name || '').trim()
      if (!target) return { text: 'Error: `name` is required', isError: true }
      const r = await postJson<{
        status: string
        jobId?: string
        target?: string
        deduped?: boolean
        originalStartedAt?: string
        error?: string
      }>('/api/mcp/build-vibe', { sessionId, target })
      if (!r.ok) return { text: r.error || 'build_vibe failed', isError: true }
      if (r.body?.status === 'running' && r.body.jobId) {
        const dedupNote = r.body.deduped
          ? ` (deduped — already running since ${r.body.originalStartedAt})`
          : ''
        return {
          text:
            `build_vibe enqueued: jobId=${r.body.jobId}, target=${r.body.target || target}${dedupNote}. ` +
            `Poll via job_status; do 1–2 turns of other work between polls.`,
          isError: false,
        }
      }
      return { text: `build_vibe error: ${r.body?.error || 'unknown'}`, isError: true }
    }
    case 'build_all_vibes': {
      const r = await postJson<{
        vibeCount: number
        jobs?: { jobId: string; target: string; status: string; deduped?: boolean; originalStartedAt?: string }[]
        error?: string
      }>('/api/mcp/build-all-vibes', { sessionId })
      if (!r.ok) return { text: r.error || 'build_all_vibes failed', isError: true }
      if (Array.isArray(r.body?.jobs) && r.body.jobs.length > 0) {
        const lines = r.body.jobs.map((j) => {
          const dedupNote = j.deduped ? ` (deduped, since ${j.originalStartedAt})` : ''
          return `  - ${j.target}: jobId=${j.jobId}${dedupNote}`
        })
        return {
          text:
            `build_all_vibes enqueued ${r.body.vibeCount} vibe(s). Per-vibe jobIds:\n` +
            lines.join('\n') +
            `\nPoll job_status(jobId) for each; do other work between polls.`,
          isError: false,
        }
      }
      return { text: `build_all_vibes error: ${r.body?.error || 'unknown'}`, isError: true }
    }
    case 'build_final': {
      const r = await postJson<{
        status: string
        jobId?: string
        deduped?: boolean
        originalStartedAt?: string
        error?: string
      }>('/api/mcp/build-final', { sessionId })
      if (!r.ok) return { text: r.error || 'build_final failed', isError: true }
      if (r.body?.status === 'running' && r.body.jobId) {
        const dedupNote = r.body.deduped
          ? ` (deduped — already running since ${r.body.originalStartedAt})`
          : ''
        return {
          text:
            `build_final enqueued: jobId=${r.body.jobId}${dedupNote}. ` +
            `Poll via job_status; do other work between polls.`,
          isError: false,
        }
      }
      return { text: `build_final error: ${r.body?.error || 'unknown'}`, isError: true }
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
