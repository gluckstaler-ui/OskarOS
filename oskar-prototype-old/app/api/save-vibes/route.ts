import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'

// Bridge script for Live Preview & Director Mode (postMessage communication)
const BRIDGE_SCRIPT = `
<script>
(function() {
  // Director Mode state
  var directorModeEnabled = false;

  // Inject Director Mode styles
  var directorStyle = document.createElement('style');
  directorStyle.id = 'oskar-director-styles';
  directorStyle.textContent = \`
    .oskar-director-active [data-editable],
    .oskar-director-active [data-usage] {
      outline: 2px dashed rgba(59, 130, 246, 0.4) !important;
      outline-offset: 2px;
      cursor: pointer !important;
      transition: outline 0.2s, background 0.2s;
    }
    .oskar-director-active [data-editable]:hover,
    .oskar-director-active [data-usage]:hover {
      outline: 2px solid rgba(59, 130, 246, 0.8) !important;
      background: rgba(59, 130, 246, 0.1) !important;
    }
    .oskar-selected {
      outline: 3px solid #3b82f6 !important;
      outline-offset: 2px;
      background: rgba(59, 130, 246, 0.15) !important;
    }
    .oskar-director-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: white;
      padding: 8px 16px;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      z-index: 99999;
      display: none;
    }
    .oskar-director-banner.active { display: block; }
  \`;
  document.head.appendChild(directorStyle);

  // Add Director Mode banner
  var banner = document.createElement('div');
  banner.className = 'oskar-director-banner';
  banner.innerHTML = '🎬 DIRECTOR MODE — Click any element to select and edit';
  document.body.appendChild(banner);

  // Listen for messages from parent React app
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || !data.type) return;

    // SET_DIRECTOR_MODE: Toggle Director Mode
    if (data.type === 'SET_DIRECTOR_MODE') {
      directorModeEnabled = data.enabled;
      if (data.enabled) {
        document.body.classList.add('oskar-director-active');
        banner.classList.add('active');
      } else {
        document.body.classList.remove('oskar-director-active');
        banner.classList.remove('active');
        // Clear selection
        document.querySelectorAll('.oskar-selected').forEach(function(e) {
          e.classList.remove('oskar-selected');
        });
      }
    }

    // UPDATE_IMAGE: Replace image src when asset is generated
    if (data.type === 'UPDATE_IMAGE') {
      var images = document.querySelectorAll('[data-usage="' + data.usage + '"]');
      images.forEach(function(img) {
        img.src = data.url;
        img.style.opacity = '0';
        img.onload = function() { img.style.opacity = '1'; };
      });
    }

    // UPDATE_TEXT: Replace text content
    if (data.type === 'UPDATE_TEXT') {
      var el = document.querySelector('[data-editable="' + data.id + '"]');
      if (el) el.textContent = data.text;
    }

    // HIGHLIGHT_ELEMENT: Visual feedback for selection
    if (data.type === 'HIGHLIGHT_ELEMENT') {
      document.querySelectorAll('.oskar-selected').forEach(function(e) {
        e.classList.remove('oskar-selected');
      });
      if (data.id) {
        var target = document.querySelector('[data-editable="' + data.id + '"], [data-usage="' + data.id + '"]');
        if (target) target.classList.add('oskar-selected');
      }
    }
  });

  // Director Mode: Click-to-select elements (only when enabled)
  document.addEventListener('click', function(e) {
    if (!directorModeEnabled) return;

    var target = e.target;
    var editable = target.dataset ? target.dataset.editable : null;
    var usage = target.dataset ? target.dataset.usage : null;

    if (editable || usage) {
      e.preventDefault();
      e.stopPropagation();

      var rect = target.getBoundingClientRect();

      // Notify parent of selection
      window.parent.postMessage({
        type: 'ELEMENT_SELECTED',
        elementType: target.tagName === 'IMG' ? 'image' : 'text',
        id: editable || usage,
        currentValue: target.tagName === 'IMG' ? target.src : target.textContent,
        tagName: target.tagName,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      }, '*');

      // Visual feedback
      document.querySelectorAll('.oskar-selected').forEach(function(e) {
        e.classList.remove('oskar-selected');
      });
      target.classList.add('oskar-selected');
    }
  });

  // Notify parent that bridge is ready
  window.parent.postMessage({ type: 'BRIDGE_READY' }, '*');
})();
</script>
`

interface VibeInput {
  id: string
  name: string
  html: string
  headline?: string
  tagline?: string
  colors?: string[]
  typography?: { heading: string; body: string }
  voiceSamples?: string[]
}

export async function POST(req: NextRequest) {
  try {
    const { vibes, sessionId } = await req.json() as { vibes: VibeInput[], sessionId?: string }

    if (!vibes || vibes.length === 0) {
      return NextResponse.json({ error: 'No vibes to save' }, { status: 400 })
    }

    // Determine output directory based on sessionId
    let vibesDir: string
    let publicPathPrefix: string

    if (sessionId) {
      vibesDir = path.join(process.cwd(), 'public', sessionId)
      publicPathPrefix = `/${sessionId}`
      console.log(`📁 Saving vibes to session folder: ${sessionId}`)
    } else {
      vibesDir = path.join(process.cwd(), 'public', 'vibes')
      publicPathPrefix = '/vibes'
      console.log(`📁 No session - saving vibes to /vibes/`)
    }

    if (!existsSync(vibesDir)) {
      mkdirSync(vibesDir, { recursive: true })
    }

    const vibePaths: string[] = []

    for (const vibe of vibes) {
      // Inject bridge script before </body>
      let htmlWithBridge = vibe.html
      if (htmlWithBridge.includes('</body>')) {
        htmlWithBridge = htmlWithBridge.replace('</body>', `${BRIDGE_SCRIPT}</body>`)
      } else {
        htmlWithBridge = htmlWithBridge + BRIDGE_SCRIPT
      }

      // Save HTML file
      const filename = `${vibe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.html`
      const filepath = path.join(vibesDir, filename)
      writeFileSync(filepath, htmlWithBridge, 'utf-8')

      const publicPath = `${publicPathPrefix}/${filename}`
      vibePaths.push(publicPath)

      console.log(`Saved vibe "${vibe.name}" to ${publicPath}`)
    }

    return NextResponse.json({
      success: true,
      vibePaths,
      count: vibes.length
    })

  } catch (error) {
    console.error('Save vibes error:', error)
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    )
  }
}
