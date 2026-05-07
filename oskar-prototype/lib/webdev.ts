// ==========================================
// WebDev Agent - Builds HTML files
// Claude writes files directly - NO HTML parsing from stdout
// ==========================================

import { spawn } from 'child_process'
import { existsSync, readFileSync, createWriteStream, appendFileSync } from 'fs'
import { readFile, writeFile, readdir, mkdir } from 'fs/promises'
import { join } from 'path'
import type { ParsedVibe } from './creative-brief-parser'
import { trackUsageFromCLIOutput } from './usage-tracker'
import { verifyVibeHtml, parseTrailingJson } from './vibe-verify'
import { ensureMcpConfig, WEBDEV_ALLOWED_TOOLS } from './mcp-config'
import { collectFromStdout } from './mcp-tool-collector'
import { publish } from './event-bus'

// ==========================================
// Load WebDev Agent Prompt from MD file
// ==========================================

function loadWebDevAgentPrompt(): string {
  try {
    // Load from agents/ directory, matching the CD/Sage/Sentinel TI pattern
    const mdPath = join(process.cwd(), 'agents', 'webdev-agent.md')
    return readFileSync(mdPath, 'utf-8')
  } catch (error) {
    console.error('Failed to load webdev-agent.md:', error)
    console.error('Expected location:', join(process.cwd(), 'agents', 'webdev-agent.md'))
    // Return empty string — the vibe prompt still works, just without the full agent context
    return ''
  }
}

// ==========================================
// Phase 2 (2026-04-30) — manifest extraction from MCP tool call
// ==========================================

/**
 * Read `report_build_complete` args from the agent's stream-json output.
 * Returns the manifest in the same shape as parseTrailingJson did, so all
 * downstream code keeps working unchanged. This is the PRIMARY path; the
 * trailing-JSON parser + fallbacks remain as safety net.
 */
function readReportBuildCompleteFromStdout(
  stdout: string,
): { filename: string; vibeIndex: number; vibeName: string } | null {
  const calls = collectFromStdout(stdout, ['report_build_complete'])
  const args = calls.report_build_complete as
    | { filename?: unknown; vibeIndex?: unknown; vibeName?: unknown }
    | undefined
  if (!args) return null
  if (typeof args.filename !== 'string' || !args.filename.endsWith('.html')) return null
  if (typeof args.vibeIndex !== 'number') return null
  if (typeof args.vibeName !== 'string') return null
  return { filename: args.filename, vibeIndex: args.vibeIndex, vibeName: args.vibeName }
}

/**
 * Append a fallback-fired entry to `_debug-webdev-fallback.log` per Phase 2
 * plan. Used by the monitoring story: if the rate climbs we know the tool
 * contract is breaking somewhere (network, permission misconfig, agent
 * prompt drift). Best-effort write; failure is non-fatal.
 */
function logFallbackFired(sessionPath: string, target: string, fallbackName: string): void {
  try {
    const logPath = join(sessionPath, 'logs', '_debug-webdev-fallback.log')
    const entry = `${new Date().toISOString()}\ttarget="${target}"\tfallback=${fallbackName}\n`
    appendFileSync(logPath, entry, 'utf-8')
  } catch {
    // logs/ may not exist on a brand-new session before the bridge ran;
    // we tried, that's enough for the metric story.
  }
}

// ==========================================
// Find Claude CLI Binary
// ==========================================

export function findClaudeBinary(): string {
  const possiblePaths = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(process.env.HOME || '', '.npm-global/bin/claude'),
    join(process.env.HOME || '', 'node_modules/.bin/claude'),
    'claude'
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p
    }
  }

  return 'claude'
}

export function findGeminiBinary(): string {
  const possiblePaths = [
    '/opt/homebrew/bin/gemini',
    '/usr/local/bin/gemini',
    join(process.env.HOME || '', '.npm-global/bin/gemini'),
    'gemini'
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p
    }
  }

  return 'gemini'
}

// ==========================================
// Bridge Script for Live Preview
// ==========================================

export const BRIDGE_SCRIPT = `
<script>
  (function() {
    var directorModeEnabled = false;
    var elementIdCounter = 0;
    var currentSelectedElement = null;
    var elementIdMap = {};

    // Generate unique ID for elements without one
    function getElementId(el) {
      if (el.dataset && el.dataset.editable) return el.dataset.editable;
      if (el.dataset && el.dataset.usage) return el.dataset.usage;
      if (el.id) return el.id;
      // Generate ID based on tag + counter
      var id = el.tagName.toLowerCase() + '-' + (++elementIdCounter);
      // Store mapping so we can find it later
      elementIdMap[id] = el;
      return id;
    }

    // Check if element is editable (text or image)
    function isEditable(el) {
      if (!el || !el.tagName) return false;
      var tag = el.tagName.toLowerCase();
      // Images are always editable
      if (tag === 'img') return true;
      // Elements with data-editable are always editable
      if (el.dataset && el.dataset.editable) return true;
      // Skip structural elements (but not if they have text content and aren't containers)
      var skipTags = ['html','body','head','script','style','meta','link','nav','header','footer','main','section','article','aside','ul','ol','table','tbody','thead','tr','form'];
      if (skipTags.indexOf(tag) !== -1) return false;
      // Allow divs/spans with direct text content
      var text = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) { // Text node
          text += el.childNodes[i].textContent;
        }
      }
      // If no direct text, use full textContent but be more lenient
      if (!text.trim()) text = el.textContent || '';
      return text.trim().length > 0 && text.trim().length < 500;
    }

    // Listen for messages from parent
    window.addEventListener('message', function(event) {
      var data = event.data;
      if (data.type === 'SET_DIRECTOR_MODE') {
        directorModeEnabled = data.enabled;
        console.log('🎬 Director Mode:', directorModeEnabled ? 'ON' : 'OFF');
        // Update cursor and highlight editable elements
        if (directorModeEnabled) {
          document.body.classList.add('oskar-director-active');
        } else {
          document.body.classList.remove('oskar-director-active');
          document.querySelectorAll('.oskar-selected').forEach(function(e) {
            e.classList.remove('oskar-selected');
          });
          currentSelectedElement = null;
        }
      }
      if (data.type === 'UPDATE_IMAGE') {
        var el = currentSelectedElement || elementIdMap[data.usage];
        if (!el) el = document.querySelector('[data-usage="' + data.usage + '"]');
        if (!el) el = document.querySelector('img[src*="' + data.usage + '"]');
        if (el && el.tagName === 'IMG') {
          el.src = data.url;
          console.log('🎬 Updated image:', data.usage);
        }
      }
      if (data.type === 'UPDATE_TEXT') {
        var el = currentSelectedElement || elementIdMap[data.id];
        if (!el) el = document.querySelector('[data-editable="' + data.id + '"]');
        if (!el) el = document.getElementById(data.id);
        if (el) {
          el.textContent = data.text;
          console.log('🎬 Updated text:', data.id, '->', data.text.substring(0, 30) + '...');
        } else {
          console.log('🎬 Could not find element:', data.id);
        }
      }
    });

    // Handle clicks - only when director mode is enabled
    document.addEventListener('click', function(e) {
      if (!directorModeEnabled) return;

      var target = e.target;

      // Walk up to find editable element if clicked on child
      var el = target;
      var maxWalk = 8;
      console.log('🎬 Click on:', target.tagName, '| text:', (target.textContent || '').substring(0, 30));
      while (el && !isEditable(el) && maxWalk > 0) {
        console.log('🎬 Walking up:', el.tagName, '-> parent:', el.parentElement?.tagName);
        el = el.parentElement;
        maxWalk--;
      }
      if (!el || !isEditable(el)) {
        console.log('🎬 No editable element found. Final el:', el?.tagName, '| isEditable:', isEditable(el));
        return;
      }
      console.log('🎬 Found editable:', el.tagName, '| text:', (el.textContent || '').substring(0, 30));

      e.preventDefault();
      e.stopPropagation();

      // Store selected element for later updates
      currentSelectedElement = el;

      var rect = el.getBoundingClientRect();
      var id = getElementId(el);

      window.parent.postMessage({
        type: 'ELEMENT_SELECTED',
        elementType: el.tagName === 'IMG' ? 'image' : 'text',
        id: id,
        currentValue: el.tagName === 'IMG' ? el.src : el.textContent,
        tagName: el.tagName,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      }, '*');

      document.querySelectorAll('.oskar-selected').forEach(function(e) {
        e.classList.remove('oskar-selected');
      });
      el.classList.add('oskar-selected');
    });

    // Style for selected elements and hover hints
    var style = document.createElement('style');
    style.textContent = [
      '.oskar-selected { outline: 3px solid #3b82f6 !important; outline-offset: 2px; cursor: pointer !important; }',
      '.oskar-director-active h1, .oskar-director-active h2, .oskar-director-active h3, .oskar-director-active h4, .oskar-director-active h5, .oskar-director-active h6,',
      '.oskar-director-active p, .oskar-director-active span, .oskar-director-active a, .oskar-director-active button,',
      '.oskar-director-active li, .oskar-director-active td, .oskar-director-active th, .oskar-director-active label,',
      '.oskar-director-active strong, .oskar-director-active em, .oskar-director-active b, .oskar-director-active i,',
      '.oskar-director-active [data-editable],',
      '.oskar-director-active img { cursor: pointer !important; transition: outline 0.15s ease; }',
      '.oskar-director-active h1:hover, .oskar-director-active h2:hover, .oskar-director-active h3:hover, .oskar-director-active h4:hover,',
      '.oskar-director-active p:hover, .oskar-director-active span:hover, .oskar-director-active a:hover, .oskar-director-active button:hover,',
      '.oskar-director-active li:hover, .oskar-director-active td:hover, .oskar-director-active label:hover,',
      '.oskar-director-active strong:hover, .oskar-director-active em:hover,',
      '.oskar-director-active [data-editable]:hover,',
      '.oskar-director-active img:hover { outline: 2px dashed #3b82f6; outline-offset: 2px; }'
    ].join('\\n');
    document.head.appendChild(style);

    // Notify parent that bridge is ready
    window.parent.postMessage({ type: 'BRIDGE_READY' }, '*');
    console.log('🎬 OskarOS Bridge Script loaded');
  })();
</script>
`

// ==========================================
// Scrollbar CSS - Minimal, non-intrusive scrollbar
// ==========================================

export const SCROLLBAR_CSS = `
<style data-oskar-scrollbar>
  /* Minimal scrollbar - works for both light and dark themes */
  html {
    scrollbar-width: thin;
    scrollbar-color: rgba(128,128,128,0.8) rgba(128,128,128,0.1);
  }
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-track {
    background: rgba(128,128,128,0.1);
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(128,128,128,0.8);
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(128,128,128,1);
  }
</style>
`

// ==========================================
// Build Vibe Prompt
// ==========================================

function buildVibePrompt(vibe: ParsedVibe, sessionImages: string[]): string {
  const imageList = sessionImages.length > 0
    ? `\n\nAVAILABLE IMAGES IN SESSION:\n${sessionImages.map(img => `- ${img}`).join('\n')}`
    : '\n\n(No images available yet)'

  return `
## Vibe Details

**Name:** ${vibe.name}
**One-liner:** ${vibe.oneLiner}
**Voice:** ${vibe.voice}
**Target Audience:** ${vibe.whoFor}

**Colors:**
- Primary: ${vibe.colors.primary}
- Secondary: ${vibe.colors.secondary}
- Accent: ${vibe.colors.accent}

**Fonts:**
- Headings: ${vibe.fonts.headings}
- Body: ${vibe.fonts.body}

## Full Vibe Content

${vibe.content}
${imageList}

## Technical Requirements

### HTML Structure
- All CSS inline (in <style> tag) for portability
- Use CSS variables for the colors above
- Mobile-first, responsive design
- Include data-usage attributes on images for the preview system
- Include data-editable attributes on text elements

### Image References
Use relative paths:
\`\`\`html
<img src="[filename].jpg" alt="[Descriptive alt text]" data-usage="hero">
\`\`\`

### Fonts
Use Google Fonts:
\`\`\`html
<link href="https://fonts.googleapis.com/css2?family=${vibe.fonts.headings.replace(/\s+/g, '+')}:wght@400;700&family=${vibe.fonts.body.replace(/\s+/g, '+')}:wght@400;500&display=swap" rel="stylesheet">
\`\`\`

## Required Sections

Build a landing page with these sections based on the vibe content:
1. Hero with headline, tagline, and CTA
2. Hook/Story section
3. How It Works section
4. Residents section (the six animals)
5. Menu section with items and prices
6. Location section
7. Final booking CTA
8. Footer with tagline

## Voice Requirements
- Every piece of copy must match the "${vibe.name}" voice: ${vibe.voice}
- Distinctive tone throughout
- CTA that makes people feel something
- Zero generic language ("Book Now", "About Us", "Our Services")
`
}

// ==========================================
// Build Result Interface
// ==========================================

export interface VibeBuildResult {
  vibeIndex: number
  vibeName: string
  filename: string
  status: 'complete' | 'error'
  error?: string
}

// ==========================================
// Build Single Vibe HTML
// Claude writes the file directly - we do NOT parse HTML from stdout
// ==========================================

export async function buildVibeHTML(
  sessionId: string,
  target: string,
  sessionPath: string,
  model: string = 'claude-sonnet-4-6',
  abortSignal?: AbortSignal,
): Promise<VibeBuildResult> {
  const requestId = Date.now()

  // Load the full agent prompt from webdev-agent.md
  const agentPrompt = loadWebDevAgentPrompt()

  // Ralph 2026-04-26: agent-friendly prompt. WebDev (a Claude instance) finds
  // the matching VIBE file itself by reading the session folder. We DON'T
  // pre-parse the brief into a struct — that path was the silent-failure surface
  // (case-sensitive header regex etc.). Hand WebDev the target string and let
  // it figure out which vibe file matches.
  //
  // The agent ends with a JSON manifest line so we can parse the actual
  // filename + index it produced (it picks the slug, we accept it).
  // The inline prompt below contains ONLY per-build dynamic context (session
  // folder, target string). The static operational contract (report_build_*,
  // notify_agent milestones, inbox drain) lives in agents/webdev-agent.md
  // under "## Orchestration Contract" and is included via ${agentPrompt}.
  // Don't add tool-contract instructions here — edit the agent file instead.
  // Ralph + Jedi Code 2026-05-06.
  const userPrompt = `
${agentPrompt}

---

## SESSION CONTEXT (per-build, runtime-injected)

**Session folder:** ${sessionPath}
**Target the user asked for:** "${target}"

The session folder contains one or more vibe spec files (\`VIBE-N.md\` or
\`vibe-N.md\` where N is a number). Find the one that matches "${target}" by:
- File name (target "vibe-5" matches VIBE-5.md or vibe-5.md)
- The \`#\` heading inside the file ("# Vibe 5: Oskar Home Staging")
- The vibe slug or display name in the heading

If no file matches, list the vibe files you DID find and ask the user to
clarify — don't guess. There may also be a BUILD.md in the folder with
cross-vibe context.

## YOUR TASK

Build the complete HTML landing page for the vibe matching "${target}".
Write to \`vibe-{N}-{slug}.html\` where {N} is the vibe number and {slug} is
a kebab-case version of the vibe name (e.g. \`vibe-5-oskar-home-staging.html\`).
Do NOT output the HTML in chat. Use your file writing capability.

Follow the Orchestration Contract above for tool calls
(\`report_build_complete\`, \`report_build_progress\`, \`notify_agent\`,
inbox drain).
`

  // Ralph 2026-04-25: when images are present, WebDev "overthinks" them —
  // analyzes each image, plans placement, second-guesses, and routinely
  // blows past the 8-min budget. Double the timeout to 16 min on
  // image-bearing vibes. Image-free vibes keep the original budget so
  // simple builds don't sit waiting on a stuck process.
  // Detected by checking the session folder for any image files.
  const sessionImages = await readdir(sessionPath).catch(() => [] as string[])
    .then(files => files.filter(f => /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(f)))
  const hasImages = sessionImages.length > 0
  const TIMEOUT_MS = hasImages ? 16 * 60 * 1000 : 8 * 60 * 1000
  const TIMEOUT_LABEL = hasImages ? '16 min (images present)' : '8 min'

  // ── Set up the per-build debug log up here (outside the Promise executor)
  // so we can `await mkdir` safely. Inside `new Promise(...)` an async executor
  // would swallow rejections — antipattern. (Ralph 2026-04-26)
  const logTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const logsDir = join(sessionPath, 'logs')
  const debugLogPath = join(logsDir, `_debug-webdev-${logTimestamp}-${target.replace(/[^a-zA-Z0-9-]/g, '_')}.log`)
  let debugStream: ReturnType<typeof createWriteStream> | null = null
  try {
    await mkdir(logsDir, { recursive: true })
    debugStream = createWriteStream(debugLogPath, { flags: 'a' })
    debugStream.write(`# WebDev debug log — target="${target}" — ${new Date().toISOString()}\n`)
    debugStream.write(`# model=${model} timeout=${TIMEOUT_LABEL} hasImages=${hasImages} (${sessionImages.length} files)\n`)
    debugStream.write(`# raw stream-json from claude --print follows:\n\n`)
    console.log(`[WebDev] Debug log: ${debugLogPath}`)
  } catch (err) {
    console.error(`[WebDev] Failed to open debug log ${debugLogPath}:`, err)
    debugStream = null
  }

  return new Promise((resolve) => {
    const cleanup = () => {}  // No temp files to clean up anymore

    const claudePath = findClaudeBinary()

    console.log(`[WebDev] Building vibe target="${target}"...`)
    console.log(`[WebDev] Session path: ${sessionPath}`)
    console.log(`[WebDev] Claude binary: ${claudePath}`)
    console.log(`[WebDev] Prompt length: ${userPrompt.length} chars`)
    console.log(`[WebDev] Session path exists: ${existsSync(sessionPath)}`)
    console.log(`[WebDev] Timeout budget: ${TIMEOUT_LABEL} (${sessionImages.length} images)`)

    // Spawn Claude Code directly with args array — NO shell expansion.
    // Previously used sh -c with $(cat promptFile) which broke on backticks/$/{} in the agent prompt.
    // Now we pass the prompt as a direct positional arg to avoid shell interpretation.
    //
    // Ralph 2026-04-26: --include-partial-messages surfaces extended-thinking
    // text in the JSONL/stream-json. Without it, opus-4-7 returns thinking blocks
    // with empty `thinking` text + signature only — same redaction we hit on
    // every prior failed build. Adding it makes the debug log actually useful.
    //
    // Phase 2 (2026-04-30): WebDev now gets --mcp-config + the WebDev-scoped
    // allowed-tools whitelist. The agent calls `report_build_complete` after
    // writing the file; we capture the args from the stream-json output via
    // lib/mcp-tool-collector. parseTrailingJson + the disk-mtime fallback
    // chain stay as defensive last-resort — when the tool call is missing,
    // we log to _debug-webdev-fallback.log so we can monitor the rate.
    const mcpConfigFile = ensureMcpConfig({ sessionId, cwd: process.cwd(), agentRole: 'webdev' })
    const child = spawn(claudePath, [
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--model', model,
      '--permission-mode', 'bypassPermissions',
      '--mcp-config', mcpConfigFile,
      '--allowed-tools', WEBDEV_ALLOWED_TOOLS,
      '--print',
      userPrompt  // direct arg — no shell, no expansion, no backtick issues
    ], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: process.env.HOME,
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || ''),
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || ''
      }
    })

    // Debug log was opened above the Promise — `debugStream` is closed-over here.

    let fullOutput = ''

    // Phase 2.5 (Ralph 2026-04-30): cancel_job propagates here. When the
    // escrow's AbortController fires, kill the child the same way the
    // existing timeout path does. The result returned upstream is
    // {status:'error', error:'cancelled'} so the escrow records 'failed'
    // (the escrow itself sets status='cancelled' before this path runs,
    // so the runner result is discarded by the escrow's already-cancelled
    // check).
    const onAbort = () => {
      try { child.kill('SIGTERM') } catch {}
    }
    if (abortSignal) {
      if (abortSignal.aborted) onAbort()
      else abortSignal.addEventListener('abort', onAbort, { once: true })
    }

    const timeout = setTimeout(async () => {
      child.kill('SIGTERM')
      cleanup()
      // Wait briefly for any in-flight stdout to drain, so our recovery scan
      // sees the agent's last events (especially the tool_result from the
      // wc/ls call after writing the file).
      await new Promise<void>((r) => setTimeout(r, 1000))

      // Try every recovery path — same logic as the close handler. The agent
      // very often writes the file successfully but gets killed before it can
      // emit the manifest line / call the tool. We don't want to throw away that work.
      let manifest = readReportBuildCompleteFromStdout(fullOutput)
      if (!manifest) {
        manifest = parseTrailingJson(fullOutput)
        if (manifest) logFallbackFired(sessionPath, target, 'parseTrailingJson (timeout path)')
      }
      if (!manifest) {
        const recovered = recoverFilenameFromOutput(fullOutput, sessionPath)
        if (recovered) {
          manifest = { filename: recovered, vibeIndex: extractVibeIndexFromFilename(recovered), vibeName: target }
          logFallbackFired(sessionPath, target, 'recoverFilenameFromOutput (timeout path)')
        }
      }
      if (!manifest) {
        const recent = await findRecentlyWrittenVibeHtml(sessionPath, target, requestId)
        if (recent) {
          manifest = { filename: recent, vibeIndex: extractVibeIndexFromFilename(recent), vibeName: target }
          logFallbackFired(sessionPath, target, 'findRecentlyWrittenVibeHtml (timeout path)')
        }
      }

      if (manifest && existsSync(join(sessionPath, manifest.filename))) {
        console.log(`[WebDev] ⏱️ Timeout fired but file EXISTS: ${manifest.filename} (recovered)`)
        resolve({
          vibeIndex: manifest.vibeIndex,
          vibeName: manifest.vibeName,
          filename: manifest.filename,
          status: 'complete',
        })
      } else {
        resolve({
          vibeIndex: 0,
          vibeName: target,
          filename: '',
          status: 'error',
          error: `Build for "${target}" timed out after ${TIMEOUT_LABEL} and no output file was found`,
        })
      }
    }, TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      fullOutput += data.toString()
      if (debugStream) debugStream.write(data)
    })

    child.stderr.on('data', (data) => {
      const stderr = data.toString()
      console.error(`[WebDev] target="${target}" stderr:`, stderr.substring(0, 500))
      if (debugStream) {
        debugStream.write(`\n[STDERR ${new Date().toISOString()}]\n`)
        debugStream.write(data)
      }
    })

    child.stdout.on('end', () => {
      console.log(`[WebDev] target="${target}" stdout ended. Output length: ${fullOutput.length} chars`)
      if (fullOutput.length < 100) {
        console.log(`[WebDev] Full output: ${fullOutput}`)
      }
      if (debugStream) {
        debugStream.write(`\n# stdout ended — total ${fullOutput.length} chars\n`)
        debugStream.end()
      }
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      cleanup()
      resolve({
        vibeIndex: 0,
        vibeName: target,
        filename: '',
        status: 'error',
        error: error.message
      })
    })

    child.on('close', async (code) => {
      clearTimeout(timeout)
      cleanup()

      console.log(`[WebDev] CLI exited with code ${code}. Output length: ${fullOutput.length} chars`)
      if (code !== 0 && fullOutput.length > 0) {
        console.error(`[WebDev] Last 500 chars of output:`, fullOutput.substring(fullOutput.length - 500))
      }

      // Track WebDev token usage (even on error - we still used tokens)
      try {
        await trackUsageFromCLIOutput(sessionId, 'WebDev', fullOutput, `Build target: ${target}`)
      } catch (usageError) {
        console.error(`[WebDev] Failed to track usage:`, usageError)
      }

      // Phase 2 PRIMARY: read the agent's `report_build_complete` tool call.
      // This is the structured-args contract — typed, validated, no regex.
      let manifest = readReportBuildCompleteFromStdout(fullOutput)

      // FALLBACK 1: parseTrailingJson — legacy contract. Kept as defensive
      // safety net for ALL backends per Phase 2 plan: Claude's MCP tool call
      // can fail for the same reasons Gemini's can (network blip, permission
      // misconfig, agent forgetting the contract on a long run). When this
      // fires, log to _debug-webdev-fallback.log for monitoring.
      if (!manifest) {
        manifest = parseTrailingJson(fullOutput)
        if (manifest) {
          console.warn(`[WebDev] ⚠️ report_build_complete missing; recovered via parseTrailingJson`)
          logFallbackFired(sessionPath, target, 'parseTrailingJson')
        }
      }

      // FALLBACK 2 (Ralph 2026-04-26): when the agent gets killed by the
      // timeout BEFORE it can emit the manifest, scan the agent's output
      // for any `tool_result` that mentions a `vibe-*.html` file in this
      // session folder — that's the file the agent wrote. The work was
      // done; we just lost the receipt.
      if (!manifest) {
        const recovered = recoverFilenameFromOutput(fullOutput, sessionPath)
        if (recovered) {
          console.warn(`[WebDev] ⚠️ No manifest line; recovered filename from tool output: ${recovered}`)
          manifest = {
            filename: recovered,
            vibeIndex: extractVibeIndexFromFilename(recovered),
            vibeName: target,
          }
          logFallbackFired(sessionPath, target, 'recoverFilenameFromOutput')
        }
      }

      // FALLBACK 3: scan the session folder for any vibe-*.html modified
      // during the build window. Last-ditch — useful when the agent wrote
      // via Bash heredocs that don't surface as parseable tool_result paths.
      if (!manifest) {
        const recent = await findRecentlyWrittenVibeHtml(sessionPath, target, requestId)
        if (recent) {
          console.warn(`[WebDev] ⚠️ No manifest, no tool_result hit; found recent vibe HTML on disk: ${recent}`)
          manifest = {
            filename: recent,
            vibeIndex: extractVibeIndexFromFilename(recent),
            vibeName: target,
          }
          logFallbackFired(sessionPath, target, 'findRecentlyWrittenVibeHtml')
        }
      }

      if (!manifest) {
        console.error(`[WebDev] ❌ No manifest, no tool_result file path, no recent vibe HTML on disk. Last 500 chars:`)
        console.error(fullOutput.substring(Math.max(0, fullOutput.length - 500)))
        resolve({
          vibeIndex: 0,
          vibeName: target,
          filename: '',
          status: 'error',
          error: `Agent finished but produced no manifest and no detectable output file. CLI exit=${code}.`,
        })
        return
      }
      const filePath = join(sessionPath, manifest.filename)

      // VERIFY: file exists on disk
      if (!existsSync(filePath)) {
        resolve({
          vibeIndex: manifest.vibeIndex,
          vibeName: manifest.vibeName,
          filename: manifest.filename,
          status: 'error',
          error: `Manifest claims ${manifest.filename} was written, but the file isn't on disk (CLI exit=${code})`,
        })
        return
      }

      // Stage transition html → verify (Ralph 2026-05-06): the file landed,
      // verifyVibeHtml is about to run. Publishing here keeps the timeline
      // deterministic — independent of whether the WebDev agent emitted
      // its optional report_build_progress milestone. Console.log left in
      // (cheap, dev-only signal) so "did verify fire?" is greppable in
      // server logs after a build.
      console.log(`[WebDev] verify stage starting for target="${target}"`)
      publish(sessionId, { type: 'build_progress', target, stage: 'verify' })

      // VERIFY: HTML parses, image refs resolve, no obvious corruption
      const issues = await verifyVibeHtml(manifest.filename, sessionPath)
      if (issues.length > 0) {
        const summary = issues.slice(0, 5).map((i) => `${i.kind}: ${i.detail}`).join('; ')
        console.warn(`[WebDev] ⚠️ Verification found ${issues.length} issue(s) in ${manifest.filename}: ${summary}`)
        // For now, log the issues but still mark as complete unless ALL images are missing.
        // Eventually this should be configurable per-issue-kind.
        const fatalKinds = new Set(['parse', 'no-body'])
        const fatalCount = issues.filter((i) => fatalKinds.has(i.kind)).length
        if (fatalCount > 0) {
          resolve({
            vibeIndex: manifest.vibeIndex,
            vibeName: manifest.vibeName,
            filename: manifest.filename,
            status: 'error',
            error: `Build wrote file but failed verification: ${summary}`,
          })
          return
        }
      }

      // POST-PROCESS: inject scrollbar CSS only.
      // (Bridge-script injection removed 2026-04-26 — was the source of the
      // Director Mode click-eating bug. Parent app owns Director Mode now.)
      try {
        let html = await readFile(filePath, 'utf-8')
        if (!html.includes('data-oskar-scrollbar')) {
          if (html.includes('</head>')) {
            html = html.replace('</head>', SCROLLBAR_CSS + '</head>')
          } else if (html.includes('<style>')) {
            html = html.replace('<style>', '<style>' + SCROLLBAR_CSS.replace(/<\/?style[^>]*>/g, ''))
          }
        }
        await writeFile(filePath, html, 'utf-8')

        console.log(`[WebDev] ✅ Built: ${manifest.filename} (${issues.length} non-fatal verify issues)`)
        resolve({
          vibeIndex: manifest.vibeIndex,
          vibeName: manifest.vibeName,
          filename: manifest.filename,
          status: 'complete',
        })
      } catch (err) {
        resolve({
          vibeIndex: manifest.vibeIndex,
          vibeName: manifest.vibeName,
          filename: manifest.filename,
          status: 'error',
          error: `Failed to inject scrollbar CSS: ${err}`,
        })
      }
    })
  })
}

// ==========================================
// Build Vibe HTML via Gemini CLI
// ==========================================

export async function buildVibeHTMLGemini(
  sessionId: string,
  target: string,
  sessionPath: string,
  abortSignal?: AbortSignal,
): Promise<VibeBuildResult> {
  const requestId = Date.now()
  const agentPrompt = loadWebDevAgentPrompt()

  // Per-build dynamic context only. Static contract (tools, milestones,
  // notify_agent, inbox drain) lives in agents/webdev-agent.md and is
  // included via ${agentPrompt}. Mirrors the Claude CLI path above —
  // edit the .md file, not this template. Ralph + Jedi Code 2026-05-06.
  const userPrompt = `
${agentPrompt}

---

## SESSION CONTEXT (per-build, runtime-injected)

**Session folder:** ${sessionPath}
**Target the user asked for:** "${target}"

The session folder contains one or more vibe spec files (\`VIBE-N.md\` or
\`vibe-N.md\` where N is a number). Find the one that matches "${target}" by
file name, by the heading inside the file, or by slug/name.
If no file matches, list what you found and ask the user to clarify — don't guess.

## YOUR TASK

Build the complete HTML landing page for the vibe matching "${target}".
Write to \`vibe-{N}-{slug}.html\` in the session folder.
Do NOT output the HTML in chat. Use shell file writing.

Follow the Orchestration Contract above for tool calls.
`

  // Same overthink-on-images problem — double timeout when images are present
  const sessionImages = await readdir(sessionPath).catch(() => [] as string[])
    .then(files => files.filter(f => /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(f)))
  const hasImagesGem = sessionImages.length > 0
  const TIMEOUT_MS_GEM = hasImagesGem ? 20 * 60 * 1000 : 10 * 60 * 1000
  const TIMEOUT_LABEL_GEM = hasImagesGem ? '20 min (images present)' : '10 min'

  return new Promise((resolve) => {
    const geminiPath = findGeminiBinary()

    console.log(`[WebDev-Gemini] Building target="${target}"`)
    console.log(`[WebDev-Gemini] Session path: ${sessionPath}`)
    console.log(`[WebDev-Gemini] Gemini binary: ${geminiPath}`)
    console.log(`[WebDev-Gemini] Prompt length: ${userPrompt.length} chars`)
    console.log(`[WebDev-Gemini] Timeout budget: ${TIMEOUT_LABEL_GEM} (${sessionImages.length} images)`)

    // Phase 2 (2026-04-30): Gemini gets the same MCP wiring as Claude. The
    // Gemini CLI accepts `--mcp-config` and emits tool_use blocks in
    // stream-json, so the same tool collector reads `report_build_complete`
    // args. parseTrailingJson + fallbacks remain as defensive last-resort —
    // Gemini's MCP support is documented but less battle-tested than Claude's.
    const mcpConfigFileGemini = ensureMcpConfig({ sessionId, cwd: process.cwd(), agentRole: 'webdev' })
    const child = spawn(geminiPath, [
      '-m', 'gemini-3.1-pro-preview',
      '--yolo',
      '-o', 'stream-json',
      '--mcp-config', mcpConfigFileGemini,
      '--allowed-tools', WEBDEV_ALLOWED_TOOLS,
      '-p', userPrompt
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: process.env.HOME,
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || ''),
        GEMINI_API_KEY: process.env.GOOGLE_API_KEY || ''
      }
    })

    child.stdin.end()
    let fullOutput = ''

    // Phase 2.5 (Ralph 2026-04-30): cancel_job propagation, mirrors the
    // Claude path. Same SIGTERM kill, same orphan-tolerance.
    const onAbort = () => { try { child.kill('SIGTERM') } catch {} }
    if (abortSignal) {
      if (abortSignal.aborted) onAbort()
      else abortSignal.addEventListener('abort', onAbort, { once: true })
    }

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      // Phase 2: tool-call read first, then fallbacks
      let partial = readReportBuildCompleteFromStdout(fullOutput)
      if (!partial) {
        partial = parseTrailingJson(fullOutput)
        if (partial) logFallbackFired(sessionPath, target, 'parseTrailingJson (gemini timeout)')
      }
      if (partial && existsSync(join(sessionPath, partial.filename))) {
        resolve({ vibeIndex: partial.vibeIndex, vibeName: partial.vibeName, filename: partial.filename, status: 'complete' })
      } else {
        resolve({ vibeIndex: 0, vibeName: target, filename: '', status: 'error', error: `Gemini build for "${target}" timed out after ${TIMEOUT_LABEL_GEM}` })
      }
    }, TIMEOUT_MS_GEM)

    child.stdout.on('data', (data) => { fullOutput += data.toString() })
    child.stderr.on('data', (data) => { console.error(`[WebDev-Gemini] stderr:`, data.toString().substring(0, 500)) })

    child.on('error', (error) => {
      clearTimeout(timeout)
      resolve({ vibeIndex: 0, vibeName: target, filename: '', status: 'error', error: error.message })
    })

    child.on('close', async (code) => {
      clearTimeout(timeout)
      console.log(`[WebDev-Gemini] Gemini exited with code ${code}. Output: ${fullOutput.length} chars`)

      // Phase 2 PRIMARY: structured tool call.
      let manifest = readReportBuildCompleteFromStdout(fullOutput)

      // Same recovery fallbacks as the Claude path. Logged for monitoring.
      if (!manifest) {
        manifest = parseTrailingJson(fullOutput)
        if (manifest) {
          console.warn(`[WebDev-Gemini] ⚠️ report_build_complete missing; recovered via parseTrailingJson`)
          logFallbackFired(sessionPath, target, 'parseTrailingJson (gemini)')
        }
      }
      if (!manifest) {
        const recovered = recoverFilenameFromOutput(fullOutput, sessionPath)
        if (recovered) {
          manifest = { filename: recovered, vibeIndex: extractVibeIndexFromFilename(recovered), vibeName: target }
          logFallbackFired(sessionPath, target, 'recoverFilenameFromOutput (gemini)')
        }
      }
      if (!manifest) {
        const recent = await findRecentlyWrittenVibeHtml(sessionPath, target, requestId)
        if (recent) {
          manifest = { filename: recent, vibeIndex: extractVibeIndexFromFilename(recent), vibeName: target }
          logFallbackFired(sessionPath, target, 'findRecentlyWrittenVibeHtml (gemini)')
        }
      }
      if (!manifest) {
        resolve({ vibeIndex: 0, vibeName: target, filename: '', status: 'error', error: `Gemini finished but produced no manifest and no detectable output file` })
        return
      }
      const filePath = join(sessionPath, manifest.filename)
      if (!existsSync(filePath)) {
        resolve({ vibeIndex: manifest.vibeIndex, vibeName: manifest.vibeName, filename: manifest.filename, status: 'error', error: `Manifest claims ${manifest.filename} was written, but file isn't on disk (exit=${code})` })
        return
      }

      // Stage transition html → verify (Ralph 2026-05-06) — Gemini path,
      // mirrors the Claude CLI publish above so the live BuildJobCard
      // timeline behaves identically regardless of which model built the
      // vibe.
      console.log(`[WebDev-Gemini] verify stage starting for target="${target}"`)
      publish(sessionId, { type: 'build_progress', target, stage: 'verify' })

      // Verification floor (parse + image refs resolve)
      const issues = await verifyVibeHtml(manifest.filename, sessionPath)
      const fatalKinds = new Set(['parse', 'no-body'])
      const fatalCount = issues.filter((i) => fatalKinds.has(i.kind)).length
      if (fatalCount > 0) {
        const summary = issues.slice(0, 5).map((i) => `${i.kind}: ${i.detail}`).join('; ')
        resolve({ vibeIndex: manifest.vibeIndex, vibeName: manifest.vibeName, filename: manifest.filename, status: 'error', error: `Build wrote file but failed verification: ${summary}` })
        return
      }

      // Scrollbar CSS only — bridge script removed (was Director Mode bug source)
      try {
        let html = await readFile(filePath, 'utf-8')
        if (!html.includes('data-oskar-scrollbar')) {
          if (html.includes('</head>')) {
            html = html.replace('</head>', SCROLLBAR_CSS + '</head>')
          }
        }
        await writeFile(filePath, html, 'utf-8')
        console.log(`[WebDev-Gemini] ✅ Built: ${manifest.filename}`)
        resolve({ vibeIndex: manifest.vibeIndex, vibeName: manifest.vibeName, filename: manifest.filename, status: 'complete' })
      } catch (err) {
        resolve({ vibeIndex: manifest.vibeIndex, vibeName: manifest.vibeName, filename: manifest.filename, status: 'error', error: `Failed to inject scrollbar CSS: ${err}` })
      }
    })
  })
}

// ============================================================================
// Manifest-recovery fallbacks (Ralph 2026-04-26)
//
// When the timeout kills the agent before it can emit its final JSON manifest
// line, the FILE was usually written but we don't know its name. These two
// helpers scrape that information from anywhere we can find it:
//
//   1. recoverFilenameFromOutput — scan the agent's stream-json output for
//      tool_result events that mention a vibe-*.html path in the session
//      folder. The agent typically runs `wc -c` or `ls -la` after writing.
//
//   2. findRecentlyWrittenVibeHtml — last resort. Scan the session folder
//      for any vibe-*.html modified within the build window (matched against
//      the request's start time). Pick the closest match to the target name.
// ============================================================================

function recoverFilenameFromOutput(output: string, sessionPath: string): string | null {
  // Match any reference to a vibe-*.html under the session path. Look in the
  // last 8KB of output (where the most recent tool_results live).
  const tail = output.slice(-8192)
  const escaped = sessionPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}/(vibe-[A-Za-z0-9_-]+\\.html)`, 'g')
  const matches = [...tail.matchAll(re)]
  if (matches.length === 0) return null
  // Take the LAST match (most recent file the agent touched)
  return matches[matches.length - 1][1]
}

async function findRecentlyWrittenVibeHtml(
  sessionPath: string,
  target: string,
  buildStartMs: number,
): Promise<string | null> {
  try {
    const { stat } = await import('fs/promises')
    const files = await readdir(sessionPath)
    const vibeFiles = files.filter((f) => /^vibe-.+\.html$/i.test(f))
    if (vibeFiles.length === 0) return null

    // Find the candidate whose mtime is most recent AND newer than buildStartMs
    let best: { name: string; mtimeMs: number } | null = null
    for (const f of vibeFiles) {
      try {
        const s = await stat(join(sessionPath, f))
        if (s.mtimeMs < buildStartMs) continue
        if (!best || s.mtimeMs > best.mtimeMs) {
          best = { name: f, mtimeMs: s.mtimeMs }
        }
      } catch { /* skip */ }
    }
    if (!best) return null

    // Prefer a file whose name contains the target (or close to it). This is
    // a tiebreaker if the agent wrote multiple files during the build.
    const targetLower = target.toLowerCase()
    const targetMatching = vibeFiles.filter((f) => f.toLowerCase().includes(targetLower))
    if (targetMatching.length > 0) {
      // If our best-by-mtime is in the matching set, return it; otherwise
      // return the best of the matching set
      if (targetMatching.includes(best.name)) return best.name
      let bestMatching: { name: string; mtimeMs: number } | null = null
      for (const f of targetMatching) {
        try {
          const s = await stat(join(sessionPath, f))
          if (s.mtimeMs < buildStartMs) continue
          if (!bestMatching || s.mtimeMs > bestMatching.mtimeMs) {
            bestMatching = { name: f, mtimeMs: s.mtimeMs }
          }
        } catch { /* skip */ }
      }
      if (bestMatching) return bestMatching.name
    }
    return best.name
  } catch {
    return null
  }
}

function extractVibeIndexFromFilename(filename: string): number {
  const m = filename.match(/^vibe-(\d+)/i)
  return m ? parseInt(m[1], 10) : 0
}
