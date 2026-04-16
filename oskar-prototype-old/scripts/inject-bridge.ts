#!/usr/bin/env npx tsx
/**
 * Injects the OskarOS bridge script into all existing HTML vibe files
 * Usage: npx tsx scripts/inject-bridge.ts
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { join } from 'path'

const BRIDGE_SCRIPT = `
<script>
  (function() {
    var directorModeEnabled = false;
    var elementIdCounter = 0;

    // Generate unique ID for elements without one
    function getElementId(el) {
      if (el.dataset && el.dataset.editable) return el.dataset.editable;
      if (el.dataset && el.dataset.usage) return el.dataset.usage;
      if (el.id) return el.id;
      // Generate ID based on tag + text content hash
      var text = el.textContent || el.src || '';
      return el.tagName.toLowerCase() + '-' + (++elementIdCounter);
    }

    // Check if element is editable (text or image)
    function isEditable(el) {
      if (!el || !el.tagName) return false;
      var tag = el.tagName.toLowerCase();
      // Images are always editable
      if (tag === 'img') return true;
      // Text elements with content
      var textTags = ['h1','h2','h3','h4','h5','h6','p','span','a','button','li','td','th','label','strong','em','b','i'];
      if (textTags.indexOf(tag) !== -1) {
        // Must have text content, not just child elements
        var text = el.textContent || '';
        return text.trim().length > 0 && text.trim().length < 500;
      }
      return false;
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
        }
      }
      if (data.type === 'UPDATE_IMAGE') {
        var images = document.querySelectorAll('[data-usage="' + data.usage + '"]');
        if (images.length === 0) {
          images = document.querySelectorAll('img[src*="' + data.usage + '"]');
        }
        images.forEach(function(img) {
          img.src = data.url;
        });
      }
      if (data.type === 'UPDATE_TEXT') {
        var el = document.querySelector('[data-editable="' + data.id + '"]');
        if (!el) el = document.getElementById(data.id);
        if (el) el.textContent = data.text;
      }
    });

    // Handle clicks - only when director mode is enabled
    document.addEventListener('click', function(e) {
      if (!directorModeEnabled) return;

      var target = e.target;

      // Walk up to find editable element if clicked on child
      var el = target;
      var maxWalk = 3;
      while (el && !isEditable(el) && maxWalk > 0) {
        el = el.parentElement;
        maxWalk--;
      }
      if (!el || !isEditable(el)) return;

      e.preventDefault();
      e.stopPropagation();

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
      '.oskar-director-active h1, .oskar-director-active h2, .oskar-director-active h3, .oskar-director-active h4,',
      '.oskar-director-active p, .oskar-director-active span, .oskar-director-active a, .oskar-director-active button,',
      '.oskar-director-active img { cursor: pointer !important; transition: outline 0.15s ease; }',
      '.oskar-director-active h1:hover, .oskar-director-active h2:hover, .oskar-director-active h3:hover,',
      '.oskar-director-active p:hover, .oskar-director-active span:hover, .oskar-director-active a:hover,',
      '.oskar-director-active img:hover { outline: 2px dashed #3b82f6; outline-offset: 2px; }'
    ].join('\\n');
    document.head.appendChild(style);

    // Notify parent that bridge is ready
    window.parent.postMessage({ type: 'BRIDGE_READY' }, '*');
    console.log('🎬 OskarOS Bridge Script loaded');
  })();
</script>
`

async function processDir(dir: string): Promise<number> {
  let count = 0
  const entries = await readdir(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const s = await stat(fullPath)

    if (s.isDirectory()) {
      // Recurse into subdirectories
      count += await processDir(fullPath)
    } else if (entry.endsWith('.html') && (entry.includes('vibe') || entry.includes('landing'))) {
      // Process HTML files
      let html = await readFile(fullPath, 'utf-8')

      // Skip if already has bridge
      if (html.includes('oskar-director-active') || html.includes('OskarOS Bridge Script')) {
        console.log(`⏭️  Skipping (already has bridge): ${fullPath}`)
        continue
      }

      // Remove old bridge script if present
      html = html.replace(/<script>\s*\(function\(\)\s*\{\s*var directorModeEnabled[\s\S]*?<\/script>/g, '')
      html = html.replace(/<script>\s*\(function\(\)\s*\{\s*window\.addEventListener\('message'[\s\S]*?<\/script>/g, '')

      // Inject new bridge before </body>
      if (html.includes('</body>')) {
        html = html.replace('</body>', BRIDGE_SCRIPT + '\n</body>')
      } else if (html.includes('</html>')) {
        html = html.replace('</html>', BRIDGE_SCRIPT + '\n</html>')
      } else {
        html += BRIDGE_SCRIPT
      }

      await writeFile(fullPath, html, 'utf-8')
      console.log(`✅ Injected bridge: ${fullPath}`)
      count++
    }
  }

  return count
}

async function main() {
  const publicDir = join(process.cwd(), 'public')
  console.log(`🔍 Scanning ${publicDir} for HTML files...`)

  const count = await processDir(publicDir)
  console.log(`\n✨ Done! Injected bridge script into ${count} files.`)
}

main().catch(console.error)
