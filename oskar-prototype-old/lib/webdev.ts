// ==========================================
// WebDev Agent - Builds HTML files
// Claude writes files directly - NO HTML parsing from stdout
// ==========================================

import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ParsedVibe } from './creative-brief-parser'
import { trackUsageFromCLIOutput } from './usage-tracker'

// ==========================================
// Load WebDev Agent Prompt from MD file
// ==========================================

function loadWebDevAgentPrompt(): string {
  try {
    // Go up one level from oskar-prototype to OskarOS base directory
    const mdPath = join(process.cwd(), '..', 'webdev-agent.md')
    return readFileSync(mdPath, 'utf-8')
  } catch (error) {
    console.error('Failed to load webdev-agent.md:', error)
    console.error('Expected location:', join(process.cwd(), '..', 'webdev-agent.md'))
    // Return empty string — the vibe prompt still works, just without the full agent context
    return ''
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
  vibe: ParsedVibe,
  sessionPath: string,
  sessionImages: string[],
  model: string = 'claude-sonnet-4-6'
): Promise<VibeBuildResult> {
  const filename = `vibe-${vibe.index}-${vibe.slug}.html`
  const filePath = join(sessionPath, filename)
  const requestId = Date.now()

  // Build the vibe details
  const vibeDetails = buildVibePrompt(vibe, sessionImages)

  // Load the full agent prompt from webdev-agent.md
  const agentPrompt = loadWebDevAgentPrompt()

  // User prompt: agent identity + session context + vibe details + action
  const userPrompt = `
${agentPrompt}

---

## SESSION CONTEXT

**Session Path:** ${sessionPath}
**Target File:** ${filePath}
**Target Filename:** ${filename}

### Required Reading Files
- **VIBE-${vibe.index}.md:** ${join(sessionPath, `VIBE-${vibe.index}.md`)} ← Contains creative brief + image assignments for THIS vibe
- **BUILD.md:** ${join(sessionPath, 'BUILD.md')}

---

## YOUR TASK

Build the complete HTML landing page for **Vibe ${vibe.index}: ${vibe.name}**.

**Read VIBE-${vibe.index}.md first.** It contains the full creative brief, image map, and image assignments for this vibe. Then follow your process (Step 0 through Step 6).

Write the HTML file to: \`${filePath}\`

Do NOT output the HTML in chat. Use your file writing capability to create the file directly.
After writing, confirm with exactly: "File written: ${filename}"

### Vibe Details (Quick Reference)

${vibeDetails}

NOW READ VIBE-${vibe.index}.md AND BUILD.
`

  return new Promise((resolve) => {
    const cleanup = () => {}  // No temp files to clean up anymore

    const claudePath = findClaudeBinary()

    console.log(`[WebDev] Building vibe ${vibe.index}: ${vibe.name}...`)
    console.log(`[WebDev] Target file: ${filePath}`)
    console.log(`[WebDev] Claude binary: ${claudePath}`)
    console.log(`[WebDev] Prompt length: ${userPrompt.length} chars`)
    console.log(`[WebDev] Session path exists: ${existsSync(sessionPath)}`)

    // Spawn Claude Code directly with args array — NO shell expansion.
    // Previously used sh -c with $(cat promptFile) which broke on backticks/$/{} in the agent prompt.
    // Now we pass the prompt as a direct positional arg to avoid shell interpretation.
    const child = spawn(claudePath, [
      '--verbose',
      '--output-format', 'stream-json',
      '--model', model,
      '--permission-mode', 'bypassPermissions',
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

    let fullOutput = ''

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      cleanup()
      // Check if the file was written BEFORE the timeout killed the process
      if (existsSync(filePath)) {
        console.log(`[WebDev] ⏱️ Timeout fired but file EXISTS: ${filePath}`)
        resolve({
          vibeIndex: vibe.index,
          vibeName: vibe.name,
          filename,
          status: 'complete'
        })
      } else {
        resolve({
          vibeIndex: vibe.index,
          vibeName: vibe.name,
          filename,
          status: 'error',
          error: `Vibe ${vibe.index} build timed out after 8 minutes and no file was written`
        })
      }
    }, 480000) // 8 min timeout per vibe

    child.stdout.on('data', (data) => {
      fullOutput += data.toString()
    })

    child.stderr.on('data', (data) => {
      const stderr = data.toString()
      console.error(`[WebDev] vibe ${vibe.index} stderr:`, stderr.substring(0, 500))
    })

    child.stdout.on('end', () => {
      console.log(`[WebDev] vibe ${vibe.index} stdout ended. Output length: ${fullOutput.length} chars`)
      if (fullOutput.length < 100) {
        console.log(`[WebDev] Full output: ${fullOutput}`)
      }
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      cleanup()
      resolve({
        vibeIndex: vibe.index,
        vibeName: vibe.name,
        filename,
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
        await trackUsageFromCLIOutput(sessionId, 'WebDev', fullOutput, `Build vibe ${vibe.index}: ${vibe.name}`)
      } catch (usageError) {
        console.error(`[WebDev] Failed to track usage:`, usageError)
      }

      // VERIFY: Check if the file was actually written — regardless of exit code.
      // The agent often writes the HTML file successfully but gets killed (code 143)
      // while doing post-build work (logging to BUILD.md, etc.)
      if (!existsSync(filePath)) {
        if (code !== 0) {
          resolve({
            vibeIndex: vibe.index,
            vibeName: vibe.name,
            filename,
            status: 'error',
            error: `CLI exited with code ${code} and no file was written`
          })
          return
        }
        console.error(`[WebDev] ❌ File not created: ${filePath}`)
        console.error(`[WebDev] CLI output:`, fullOutput.substring(0, 2000))
        resolve({
          vibeIndex: vibe.index,
          vibeName: vibe.name,
          filename,
          status: 'error',
          error: `WebDev failed to create file: ${filename}`
        })
        return
      }

      // File exists - inject bridge script and scrollbar CSS
      try {
        let html = await readFile(filePath, 'utf-8')

        // Inject scrollbar CSS into <head> if not already present
        if (!html.includes('data-oskar-scrollbar')) {
          if (html.includes('</head>')) {
            html = html.replace('</head>', SCROLLBAR_CSS + '</head>')
          } else if (html.includes('<style>')) {
            // Insert after first <style> tag
            html = html.replace('<style>', '<style>' + SCROLLBAR_CSS.replace(/<\/?style[^>]*>/g, ''))
          }
        }

        // Inject bridge script for live preview
        if (!html.includes('oskar-selected')) {
          if (html.includes('</body>')) {
            html = html.replace('</body>', BRIDGE_SCRIPT + '</body>')
          } else {
            html += BRIDGE_SCRIPT
          }
        }

        await writeFile(filePath, html, 'utf-8')

        console.log(`[WebDev] ✅ Vibe ${vibe.index} built: ${filename}`)
        resolve({
          vibeIndex: vibe.index,
          vibeName: vibe.name,
          filename,
          status: 'complete'
        })
      } catch (err) {
        resolve({
          vibeIndex: vibe.index,
          vibeName: vibe.name,
          filename,
          status: 'error',
          error: `Failed to inject bridge script: ${err}`
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
  vibe: ParsedVibe,
  sessionPath: string,
  sessionImages: string[]
): Promise<VibeBuildResult> {
  const filename = `vibe-${vibe.index}-${vibe.slug}.html`
  const filePath = join(sessionPath, filename)
  const requestId = Date.now()

  const vibeDetails = buildVibePrompt(vibe, sessionImages)
  const agentPrompt = loadWebDevAgentPrompt()

  const userPrompt = `
${agentPrompt}

---

## SESSION CONTEXT

**Session Path:** ${sessionPath}
**Target File:** ${filePath}
**Target Filename:** ${filename}

### Required Reading Files
- **VIBE-${vibe.index}.md:** ${join(sessionPath, `VIBE-${vibe.index}.md`)}
- **BUILD.md:** ${join(sessionPath, 'BUILD.md')}

---

## YOUR TASK

Build the complete HTML landing page for **Vibe ${vibe.index}: ${vibe.name}**.

**Read VIBE-${vibe.index}.md first** using shell commands (cat). It contains the full creative brief, image map, and image assignments for this vibe.

Write the HTML file to: \`${filePath}\`

Do NOT output the HTML in chat. Use your file writing capability to create the file directly.
After writing, confirm with exactly: "File written: ${filename}"

### Vibe Details (Quick Reference)

${vibeDetails}

NOW READ VIBE-${vibe.index}.md AND BUILD.
`

  return new Promise((resolve) => {
    const geminiPath = findGeminiBinary()

    console.log(`[WebDev-Gemini] Building vibe ${vibe.index}: ${vibe.name}...`)
    console.log(`[WebDev-Gemini] Target file: ${filePath}`)
    console.log(`[WebDev-Gemini] Gemini binary: ${geminiPath}`)
    console.log(`[WebDev-Gemini] Prompt length: ${userPrompt.length} chars`)

    const child = spawn(geminiPath, [
      '-m', 'gemini-3.1-pro-preview',
      '--yolo',
      '-o', 'stream-json',
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

    // Close stdin so Gemini doesn't wait for input
    child.stdin.end()

    let fullOutput = ''

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      if (existsSync(filePath)) {
        console.log(`[WebDev-Gemini] Timeout but file EXISTS: ${filePath}`)
        resolve({ vibeIndex: vibe.index, vibeName: vibe.name, filename, status: 'complete' })
      } else {
        resolve({ vibeIndex: vibe.index, vibeName: vibe.name, filename, status: 'error', error: 'Gemini build timed out after 10 minutes' })
      }
    }, 600000) // 10 min timeout

    child.stdout.on('data', (data) => { fullOutput += data.toString() })
    child.stderr.on('data', (data) => { console.error(`[WebDev-Gemini] stderr:`, data.toString().substring(0, 500)) })

    child.on('error', (error) => {
      clearTimeout(timeout)
      resolve({ vibeIndex: vibe.index, vibeName: vibe.name, filename, status: 'error', error: error.message })
    })

    child.on('close', async (code) => {
      clearTimeout(timeout)
      console.log(`[WebDev-Gemini] Gemini exited with code ${code}. Output: ${fullOutput.length} chars`)

      if (!existsSync(filePath)) {
        resolve({ vibeIndex: vibe.index, vibeName: vibe.name, filename, status: 'error', error: `Gemini exited with code ${code}, no file written` })
        return
      }

      // Inject bridge script and scrollbar CSS
      try {
        let html = await readFile(filePath, 'utf-8')

        if (!html.includes('data-oskar-scrollbar')) {
          if (html.includes('</head>')) {
            html = html.replace('</head>', SCROLLBAR_CSS + '</head>')
          }
        }

        if (!html.includes('oskar-selected')) {
          if (html.includes('</body>')) {
            html = html.replace('</body>', BRIDGE_SCRIPT + '</body>')
          } else {
            html += BRIDGE_SCRIPT
          }
        }

        await writeFile(filePath, html, 'utf-8')
        console.log(`[WebDev-Gemini] Vibe ${vibe.index} built: ${filename}`)
        resolve({ vibeIndex: vibe.index, vibeName: vibe.name, filename, status: 'complete' })
      } catch (err) {
        resolve({ vibeIndex: vibe.index, vibeName: vibe.name, filename, status: 'error', error: `Failed to inject bridge script: ${err}` })
      }
    })
  })
}
