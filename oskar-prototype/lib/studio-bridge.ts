/**
 * Studio Mode bridge — shared by CanvasPanel (3-panel) and the Gallery
 * live-preview pane. Centralizes:
 *   - The iframe-side patch script that adds click-to-swap on [data-slot]
 *     images (injected at load time into every vibe iframe)
 *   - Helpers used on both sides of the postMessage boundary
 *
 * Kept as plain strings/functions (no React) so it can be imported by
 * server and client code alike without pulling in the React runtime.
 */

/**
 * Split an htmlPath like `/2026-01-27-31/vibe-1.html` into sessionId +
 * pageFilename. Returns { null, null } for paths served from `/vibes/`
 * (those aren't session-attached so aren't swap targets).
 */
export function parseHtmlPath(htmlPath?: string | null): {
  sessionId: string | null
  pageFilename: string | null
} {
  if (!htmlPath) return { sessionId: null, pageFilename: null }
  const m = htmlPath.match(/^\/([^/]+)\/([^/]+\.html)(?:[?#].*)?$/i)
  if (!m) return { sessionId: null, pageFilename: null }
  if (m[1].toLowerCase() === 'vibes') {
    return { sessionId: null, pageFilename: m[2] }
  }
  return { sessionId: m[1], pageFilename: m[2] }
}

/**
 * Human label for a slot name. Mirrors the server-side map in
 * `lib/vibe-slots.ts` — kept in sync manually. If the two drift, the
 * picker will still work (the slot name is the real identifier); only
 * the visible label differs.
 */
export function humanizeSlot(slot: string): string {
  if (!slot) return 'Image'
  // Bare-img pseudo-slot: "img:<src>" or "img:<src>#<n>" — produced by the
  // bridge when a user clicks an <img> without a data-slot attribute. The
  // src is already shown underneath as "Currently:", so the label stays
  // generic. We append the basename in parens so the header is specific
  // without being noisy.
  if (slot.startsWith('img:')) {
    const rest = slot.slice(4)
    const hashIdx = rest.lastIndexOf('#')
    const src = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest
    const occurrence = hashIdx >= 0 ? rest.slice(hashIdx + 1) : null
    const basename = src.split('?')[0].split('#')[0].split('/').pop() || src
    const truncated = basename.length > 28 ? basename.slice(0, 25) + '…' : basename
    return occurrence ? `Image (${truncated}, #${occurrence})` : `Image (${truncated})`
  }
  // WP-10A: Background-image pseudo-slot
  if (slot.startsWith('bgimg:')) {
    const src = slot.slice(6)
    const basename = src.split('?')[0].split('#')[0].split('/').pop() || src
    const truncated = basename.length > 28 ? basename.slice(0, 25) + '…' : basename
    return `Background (${truncated})`
  }
  const map: Record<string, string> = {
    hero: 'Opening image',
    portrait: 'Portrait',
    'menu-bg': 'Menu background',
    'menu-background': 'Menu background',
    icon: 'Icon',
    about: 'About section',
    'about-bg': 'About background',
    'footer-bg': 'Footer background',
    background: 'Background',
    gallery: 'Gallery',
    logo: 'Logo',
    location: 'Location',
    'location-bg': 'Location background',
    'cta-bg': 'CTA background',
    hook: 'Hook section',
  }
  if (map[slot]) return map[slot]
  const g = slot.match(/^gallery[-_]?(\d+)$/i)
  if (g) return `Gallery image ${g[1]}`
  return slot
    .split(/[-_]/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase()))
    .join(' ')
}

/**
 * Injected into each vibe iframe at load time. Adds click-to-swap on
 * [data-slot] images without touching the saved HTML. Runs entirely
 * inside the iframe document. See `LivePreviewWithDirector` / `CanvasPanel`
 * for the parent-side handlers.
 *
 * Invariants:
 *   - Idempotent: `window.__oskarStudioPatchInstalled` guards re-runs
 *   - Standalone: tracks its own `directorOn` flag via SET_DIRECTOR_MODE,
 *     so it works on HTML that lacks the original save-vibes bridge
 *   - Capture-phase click listener: runs BEFORE the older bridge to give
 *     data-slot elements priority when a slot swap is possible
 *   - Bails on elements that also have `data-usage` (old bridge owns those)
 *   - Phase 2 (WP-10A): background-image elements also get outlines + click-to-swap.
 */
export const STUDIO_BRIDGE_PATCH = `
(function() {
  if (window.__oskarStudioPatchInstalled) return;
  window.__oskarStudioPatchInstalled = true;

  // CSS for ALL director-mode swappable <img> — the data-slot contract is
  // no longer required. Marked (data-slot) images keep the solid green
  // treatment; bare images get a subtler dashed look so the hierarchy is
  // still readable at a glance.
  var style = document.createElement('style');
  style.id = 'oskar-studio-slot-styles';
  style.textContent =
    // Marked images (original contract)
    '.oskar-director-active img[data-slot]:not([data-usage]):not([data-editable]) {' +
    '  outline: 2px dashed rgba(16, 185, 129, 0.5) !important;' +
    '  outline-offset: 2px;' +
    '  cursor: pointer !important;' +
    '  transition: outline 0.2s, filter 0.2s;' +
    '}' +
    '.oskar-director-active img[data-slot]:not([data-usage]):not([data-editable]):hover {' +
    '  outline: 2px solid rgba(16, 185, 129, 0.9) !important;' +
    '  filter: brightness(1.05);' +
    '}' +
    // Bare images (no data-slot, no data-usage) — lighter emerald dash
    '.oskar-director-active img:not([data-slot]):not([data-usage]):not([data-editable]) {' +
    '  outline: 2px dashed rgba(16, 185, 129, 0.35) !important;' +
    '  outline-offset: 2px;' +
    '  cursor: pointer !important;' +
    '  transition: outline 0.2s, filter 0.2s;' +
    '}' +
    '.oskar-director-active img:not([data-slot]):not([data-usage]):not([data-editable]):hover {' +
    '  outline: 2px solid rgba(16, 185, 129, 0.85) !important;' +
    '  filter: brightness(1.05);' +
    '}' +
    // WP-10A: Background-image elements — dashed amber so they're distinct from <img>
    '.oskar-director-active [data-oskar-bgimg] {' +
    '  outline: 2px dashed rgba(245, 158, 11, 0.4) !important;' +
    '  outline-offset: -2px;' +
    '  cursor: pointer !important;' +
    '  transition: outline 0.2s, filter 0.2s;' +
    '}' +
    '.oskar-director-active [data-oskar-bgimg]:hover {' +
    '  outline: 2px solid rgba(245, 158, 11, 0.85) !important;' +
    '  filter: brightness(1.05);' +
    '}';
  document.head.appendChild(style);

  // WP-10A: Scan for background-image elements and tag them
  function scanBgImages() {
    // Remove stale tags
    document.querySelectorAll('[data-oskar-bgimg]').forEach(function(el) {
      el.removeAttribute('data-oskar-bgimg');
    });
    // Walk ALL elements looking for background-image — not just section/div.
    // Previously restricted to a small tag list; that missed custom elements
    // and styled spans that hold hero imagery in newer vibe templates.
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // Skip the iframe document root + the patch's own injected <style>
      if (el === document.documentElement || el === document.body) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
      var bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') continue;
      var urlMatch = bg.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
      if (!urlMatch) continue;
      var src = urlMatch[1];
      // Skip only true non-swappable URIs: inline data:-URIs can't be edited.
      // HTTP and protocol-relative URLs ARE kept now — the picker just rewrites
      // the bg-image to the chosen local path. That's how Gemini-generated
      // vibes with https://images.unsplash.com hero URLs used to be
      // unswappable; now they're fair game.
      if (/^data:/i.test(src)) continue;
      el.setAttribute('data-oskar-bgimg', src);
    }
  }

  // Track director state independently — works on HTML files that lack
  // the original save-vibes bridge (hand-written prototypes, imports, etc.)
  var directorOn = false;
  function isDirectorActive() {
    return directorOn || document.body.classList.contains('oskar-director-active');
  }

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'SET_DIRECTOR_MODE') {
      directorOn = !!e.data.enabled;
      if (directorOn) {
        document.body.classList.add('oskar-director-active');
        // Re-scan on every ON in case the DOM changed since last time.
        scanBgImages();
      } else {
        document.body.classList.remove('oskar-director-active');
        document.querySelectorAll('.oskar-selected').forEach(function(n) {
          n.classList.remove('oskar-selected');
        });
      }
    }
  });

  // Pre-scan on initial load so targets are tagged before the first director
  // toggle. Idempotent: safe to call again when director turns on.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanBgImages);
  } else {
    scanBgImages();
  }

  function nearestHeading(el) {
    var current = el;
    while (current && current !== document.body) {
      var sib = current.previousElementSibling;
      while (sib) {
        if (sib.matches && sib.matches('h1, h2, h3')) {
          return (sib.textContent || '').trim().slice(0, 80);
        }
        if (sib.querySelector) {
          var h = sib.querySelector('h1, h2, h3');
          if (h) return (h.textContent || '').trim().slice(0, 80);
        }
        sib = sib.previousElementSibling;
      }
      current = current.parentElement;
      if (current) {
        var directH = current.querySelector(':scope > h1, :scope > h2, :scope > h3');
        if (directH && (el.compareDocumentPosition(directH) & Node.DOCUMENT_POSITION_PRECEDING)) {
          return (directH.textContent || '').trim().slice(0, 80);
        }
      }
    }
    return null;
  }

  // Compute the bare-img slot identifier for an <img> that has no data-slot.
  // Accepts ANY non-data: src (relative paths, http URLs, protocol-relative).
  // The picker handles rewriting to a local source image regardless of the
  // original scheme — previously we rejected remote srcs up-front, which
  // meant Gemini-generated vibes with Unsplash heroes were unswappable.
  function bareImgSlot(el) {
    var src = el.getAttribute('src') || '';
    if (!src) return null;
    if (/^data:/i.test(src)) return null; // inline data URIs can't be swapped

    // Count occurrence index among same-src images that also lack data-slot
    var all = document.querySelectorAll('img:not([data-slot]):not([data-usage]):not([data-editable])');
    var occ = 0;
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute('src') === src) {
        occ += 1;
        if (all[i] === el) break;
      }
    }
    return occ <= 1 ? 'img:' + src : 'img:' + src + '#' + occ;
  }

  document.addEventListener('click', function(e) {
    if (!isDirectorActive()) return;

    // WP-10A: Check for background-image element first
    var bgEl = e.target && e.target.closest ? e.target.closest('[data-oskar-bgimg]') : null;
    if (bgEl) {
      var bgSrc = bgEl.getAttribute('data-oskar-bgimg');
      if (bgSrc) {
        e.preventDefault();
        e.stopPropagation();
        var bgRect = bgEl.getBoundingClientRect();
        window.parent.postMessage({
          type: 'SLOT_SELECTED',
          slot: 'bgimg:' + bgSrc,
          currentSrc: bgSrc,
          headingText: nearestHeading(bgEl),
          rect: { top: bgRect.top, left: bgRect.left, width: bgRect.width, height: bgRect.height }
        }, '*');
        document.querySelectorAll('.oskar-selected').forEach(function(n) {
          n.classList.remove('oskar-selected');
        });
        bgEl.classList.add('oskar-selected');
        return;
      }
    }

    // Accept any clickable <img> — either with data-slot (original contract)
    // or bare (fallback added 2026-04-17). data-usage images belong to the
    // old save-vibes bridge; leave those alone.
    var t = e.target && e.target.closest ? e.target.closest('img') : null;
    if (!t) return;
    if (t.hasAttribute && t.hasAttribute('data-usage')) return;
    if (t.tagName !== 'IMG') return;

    var slot;
    if (t.hasAttribute('data-slot')) {
      slot = t.getAttribute('data-slot');
    } else {
      slot = bareImgSlot(t);
      if (!slot) return; // non-swappable src (remote/data URI) → ignore click
    }

    e.preventDefault();
    e.stopPropagation();
    var rect = t.getBoundingClientRect();
    window.parent.postMessage({
      type: 'SLOT_SELECTED',
      slot: slot,
      currentSrc: t.getAttribute('src') || '',
      headingText: nearestHeading(t),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    }, '*');
    document.querySelectorAll('.oskar-selected').forEach(function(n) {
      n.classList.remove('oskar-selected');
    });
    t.classList.add('oskar-selected');
  }, true);

  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d.type !== 'UPDATE_SLOT_IMAGE' || !d.slot) return;

    // WP-10A: Background-image slot: "bgimg:<src>" — rewrite inline style
    if (d.slot.indexOf('bgimg:') === 0) {
      var bgSrc = d.slot.slice(6);
      var bgEls = document.querySelectorAll('[data-oskar-bgimg="' + bgSrc + '"]');
      bgEls.forEach(function(el) {
        el.style.transition = 'opacity 0.2s';
        el.style.opacity = '0.3';
        el.style.backgroundImage = 'url(' + d.url + ')';
        el.setAttribute('data-oskar-bgimg', d.url);
        setTimeout(function() { el.style.opacity = '1'; }, 100);
      });
      return;
    }

    // Bare-img slot: "img:<src>" or "img:<src>#<n>" — match by current src
    if (d.slot.indexOf('img:') === 0) {
      var rest = d.slot.slice(4);
      var hashIdx = rest.lastIndexOf('#');
      var targetSrc = rest;
      var targetOcc = 1;
      if (hashIdx >= 0) {
        var n = parseInt(rest.slice(hashIdx + 1), 10);
        if (!isNaN(n) && n >= 1) {
          targetSrc = rest.slice(0, hashIdx);
          targetOcc = n;
        }
      }
      var all = document.querySelectorAll('img:not([data-slot]):not([data-usage]):not([data-editable])');
      var occ = 0;
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('src') === targetSrc) {
          occ += 1;
          if (occ === targetOcc) {
            var el = all[i];
            el.style.transition = 'opacity 0.2s';
            el.style.opacity = '0.3';
            (function(node) {
              var onload = function() {
                node.style.opacity = '1';
                node.removeEventListener('load', onload);
              };
              node.addEventListener('load', onload);
              node.src = d.url;
            })(el);
            break;
          }
        }
      }
      return;
    }

    // Normal data-slot swap
    var targets = document.querySelectorAll('[data-slot="' + d.slot + '"]');
    targets.forEach(function(el) {
      if (el.tagName !== 'IMG') return;
      el.style.transition = 'opacity 0.2s';
      el.style.opacity = '0.3';
      var onload = function() {
        el.style.opacity = '1';
        el.removeEventListener('load', onload);
      };
      el.addEventListener('load', onload);
      el.src = d.url;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WP-10B: Text editing on bare HTMLs
  // Tags text-bearing leaf elements with data-oskar-editable="text" and a
  // stable ID. Click opens inline contentEditable; commit posts TEXT_EDITED.
  // ─────────────────────────────────────────────────────────────────────────

  var textEditableSelector = 'h1, h2, h3, h4, h5, h6, p, button, span, a, li, td, th, label, figcaption';
  var textIdCounter = 0;

  function isTextOnlyLeaf(el) {
    // Element must have text content and NO nested HTML elements (text-only)
    if (!el.textContent || !el.textContent.trim()) return false;
    var children = el.children;
    // Allow zero children or only inline formatting (<em>, <strong>, <br>)
    for (var i = 0; i < children.length; i++) {
      var tag = children[i].tagName;
      if (tag !== 'EM' && tag !== 'STRONG' && tag !== 'B' && tag !== 'I' &&
          tag !== 'BR' && tag !== 'SPAN' && tag !== 'A' && tag !== 'SMALL' &&
          tag !== 'SUB' && tag !== 'SUP' && tag !== 'MARK') {
        return false; // contains block-level or complex children
      }
    }
    return true;
  }

  function tagEditableText() {
    // Remove stale tags
    document.querySelectorAll('[data-oskar-editable]').forEach(function(el) {
      el.removeAttribute('data-oskar-editable');
      el.removeAttribute('data-oskar-id');
    });
    textIdCounter = 0;
    var elements = document.querySelectorAll(textEditableSelector);
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      // Skip images, slots, and already-tagged parents
      if (el.closest('[data-slot]') || el.closest('[data-usage]')) continue;
      if (el.closest('[data-oskar-bgimg]')) continue;
      if (!isTextOnlyLeaf(el)) continue;
      textIdCounter += 1;
      el.setAttribute('data-oskar-editable', 'text');
      el.setAttribute('data-oskar-id', 'txt-' + textIdCounter);
    }
  }

  // Add text-editing CSS
  var textStyle = document.createElement('style');
  textStyle.id = 'oskar-text-edit-styles';
  textStyle.textContent =
    '.oskar-director-active [data-oskar-editable="text"] {' +
    '  outline: 1px dashed rgba(59, 130, 246, 0.3) !important;' +
    '  outline-offset: 1px;' +
    '  cursor: text !important;' +
    '  transition: outline 0.2s;' +
    '}' +
    '.oskar-director-active [data-oskar-editable="text"]:hover {' +
    '  outline: 1px solid rgba(59, 130, 246, 0.7) !important;' +
    '  background: rgba(59, 130, 246, 0.04) !important;' +
    '}' +
    '.oskar-text-editing {' +
    '  outline: 2px solid rgba(59, 130, 246, 0.9) !important;' +
    '  outline-offset: 2px;' +
    '  background: rgba(59, 130, 246, 0.06) !important;' +
    '  min-width: 40px;' +
    '}';
  document.head.appendChild(textStyle);

  var activeTextEditor = null;

  // Re-scan when director mode toggles on
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'SET_DIRECTOR_MODE') {
      if (e.data.enabled) {
        tagEditableText();
      } else {
        // Commit any active edit
        if (activeTextEditor) {
          commitTextEdit(activeTextEditor);
          activeTextEditor = null;
        }
      }
    }
  });

  // Pre-tag editable text on initial load — same rationale as scanBgImages.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tagEditableText);
  } else {
    tagEditableText();
  }

  function commitTextEdit(el) {
    el.contentEditable = 'false';
    el.classList.remove('oskar-text-editing');
    var newText = el.textContent || '';
    var oskarId = el.getAttribute('data-oskar-id');
    if (oskarId && newText.trim()) {
      window.parent.postMessage({
        type: 'TEXT_EDITED',
        oskarId: oskarId,
        newText: newText.trim(),
        tagName: el.tagName.toLowerCase()
      }, '*');
    }
    activeTextEditor = null;
  }

  document.addEventListener('click', function(e) {
    if (!isDirectorActive()) return;
    var textEl = e.target && e.target.closest ? e.target.closest('[data-oskar-editable="text"]') : null;
    if (!textEl) return;
    // Don't enter text edit if clicking on an image or bgimg inside the text area
    if (e.target.closest('img') || e.target.closest('[data-oskar-bgimg]')) return;

    e.preventDefault();
    e.stopPropagation();

    // Commit previous edit if any
    if (activeTextEditor && activeTextEditor !== textEl) {
      commitTextEdit(activeTextEditor);
    }

    // Enter edit mode
    textEl.contentEditable = 'true';
    textEl.classList.add('oskar-text-editing');
    textEl.focus();
    activeTextEditor = textEl;

    // Select all text for easy replacement
    var range = document.createRange();
    range.selectNodeContents(textEl);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, false); // bubbling phase — runs AFTER the capture-phase image handler

  // Commit on Enter or blur
  document.addEventListener('keydown', function(e) {
    if (!activeTextEditor) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitTextEdit(activeTextEditor);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Revert: re-set from last saved state (server will re-inject on refresh)
      activeTextEditor.contentEditable = 'false';
      activeTextEditor.classList.remove('oskar-text-editing');
      activeTextEditor = null;
    }
  });
  document.addEventListener('focusout', function(e) {
    if (activeTextEditor && e.target === activeTextEditor) {
      // Small delay so click handler can fire first
      setTimeout(function() {
        if (activeTextEditor && activeTextEditor === e.target) {
          commitTextEdit(activeTextEditor);
        }
      }, 100);
    }
  });
})();
`
