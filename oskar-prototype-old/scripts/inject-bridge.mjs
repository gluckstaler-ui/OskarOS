#!/usr/bin/env node
/**
 * Injects the OskarOS bridge script into all existing HTML vibe files
 * Usage: node scripts/inject-bridge.mjs
 * Add --force to replace existing bridge scripts
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const forceReplace = process.argv.includes('--force')

const BRIDGE_SCRIPT = `
<script>
  (function() {
    var directorModeEnabled = false;
    var elementIdCounter = 0;
    var currentSelectedElement = null;
    var elementIdMap = {};

    function getElementId(el) {
      if (el.dataset && el.dataset.editable) return el.dataset.editable;
      if (el.dataset && el.dataset.usage) return el.dataset.usage;
      if (el.id) return el.id;
      var id = el.tagName.toLowerCase() + '-' + (++elementIdCounter);
      elementIdMap[id] = el;
      return id;
    }

    function isEditable(el) {
      if (!el || !el.tagName) return false;
      var tag = el.tagName.toLowerCase();
      if (tag === 'img') return true;
      if (el.dataset && el.dataset.editable) return true;
      var skipTags = ['html','body','head','script','style','meta','link','nav','header','footer','main','section','article','aside','ul','ol','table','tbody','thead','tr','form'];
      if (skipTags.indexOf(tag) !== -1) return false;
      var text = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].textContent;
      }
      if (!text.trim()) text = el.textContent || '';
      return text.trim().length > 0 && text.trim().length < 500;
    }

    window.addEventListener('message', function(event) {
      var data = event.data;
      if (data.type === 'SET_DIRECTOR_MODE') {
        directorModeEnabled = data.enabled;
        console.log('🎬 Director Mode:', directorModeEnabled ? 'ON' : 'OFF');
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

    document.addEventListener('click', function(e) {
      if (!directorModeEnabled) return;
      var target = e.target;
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
      document.querySelectorAll('.oskar-selected').forEach(function(x) { x.classList.remove('oskar-selected'); });
      el.classList.add('oskar-selected');
    });

    var style = document.createElement('style');
    style.textContent = '.oskar-selected { outline: 3px solid #3b82f6 !important; outline-offset: 2px; cursor: pointer !important; }' +
      '.oskar-director-active h1, .oskar-director-active h2, .oskar-director-active h3, .oskar-director-active h4, .oskar-director-active h5, .oskar-director-active h6,' +
      '.oskar-director-active p, .oskar-director-active span, .oskar-director-active a, .oskar-director-active button,' +
      '.oskar-director-active li, .oskar-director-active td, .oskar-director-active th, .oskar-director-active label,' +
      '.oskar-director-active strong, .oskar-director-active em, .oskar-director-active b, .oskar-director-active i,' +
      '.oskar-director-active [data-editable],' +
      '.oskar-director-active img { cursor: pointer !important; transition: outline 0.15s ease; }' +
      '.oskar-director-active h1:hover, .oskar-director-active h2:hover, .oskar-director-active h3:hover, .oskar-director-active h4:hover,' +
      '.oskar-director-active p:hover, .oskar-director-active span:hover, .oskar-director-active a:hover, .oskar-director-active button:hover,' +
      '.oskar-director-active li:hover, .oskar-director-active td:hover, .oskar-director-active label:hover,' +
      '.oskar-director-active strong:hover, .oskar-director-active em:hover,' +
      '.oskar-director-active [data-editable]:hover,' +
      '.oskar-director-active img:hover { outline: 2px dashed #3b82f6; outline-offset: 2px; }';
    document.head.appendChild(style);
    window.parent.postMessage({ type: 'BRIDGE_READY' }, '*');
    console.log('🎬 OskarOS Bridge Script loaded v2');
  })();
</script>
`

async function processDir(dir) {
  let count = 0
  let entries
  try {
    entries = await readdir(dir)
  } catch (e) {
    return 0
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    let s
    try {
      s = await stat(fullPath)
    } catch (e) {
      continue
    }

    if (s.isDirectory()) {
      count += await processDir(fullPath)
    } else if (entry.endsWith('.html') && (entry.includes('vibe') || entry.includes('landing') || entry.includes('session') || entry.includes('test'))) {
      let html = await readFile(fullPath, 'utf-8')

      const hasBridge = html.includes('oskar-director-active') || html.includes('OskarOS Bridge Script')

      if (hasBridge && !forceReplace) {
        console.log(`⏭️  Skipping (use --force to replace): ${entry}`)
        continue
      }

      // Remove old bridge scripts - match any script with directorModeEnabled
      html = html.replace(/<script>\s*\(function\(\)\s*\{\s*var directorModeEnabled[\s\S]*?<\/script>/g, '')

      // Inject new bridge
      if (html.includes('</body>')) {
        html = html.replace('</body>', BRIDGE_SCRIPT + '\n</body>')
      } else if (html.includes('</html>')) {
        html = html.replace('</html>', BRIDGE_SCRIPT + '\n</html>')
      } else {
        html += BRIDGE_SCRIPT
      }

      await writeFile(fullPath, html, 'utf-8')
      console.log(`✅ ${hasBridge ? 'Replaced' : 'Injected'}: ${fullPath.split('/public/')[1] || entry}`)
      count++
    }
  }

  return count
}

const publicDir = join(__dirname, '..', 'public')
console.log(`🔍 Scanning for HTML files...${forceReplace ? ' (force replace mode)' : ''}`)
processDir(publicDir).then(count => {
  console.log(`\n✨ Done! Updated ${count} files.`)
}).catch(console.error)
