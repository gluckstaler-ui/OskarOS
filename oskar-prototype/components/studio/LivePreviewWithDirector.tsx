'use client'

/**
 * LivePreviewWithDirector — live-preview iframe with BULLETPROOF Director.
 *
 * No injected patch script. No dependency on the vibe HTML cooperating. No
 * data-slot attributes required. Parent-side control over the iframe's
 * same-origin contentDocument.
 *
 * When Director is ON:
 *   1. `body.contentEditable = 'true'` — stone-age-simple inline text editing
 *      on any element. Browser handles caret, selection, typing, paste.
 *   2. A floating gear icon tracks the hovered <img> or background-image
 *      element. Gear is positioned absolute, centered over the element.
 *   3. Clicking the image itself (not the gear) swaps it with the image
 *      currently selected in Zone 1 (passed via `zone1SelectedImage`).
 *   4. Clicking the gear opens a styling popover with two panels:
 *        Panel 1 — Color/Filter (brightness, contrast, saturation, sepia,
 *                                blur, grayscale, hue-shift)
 *        Panel 2 — Image/Fit (fit mode, position, zoom, rotate, flip,
 *                             rounded corners, repeat for bg-images)
 *   5. Every mutation is snapshotted. Turning Director OFF without clicking
 *      "Save" reverts everything. Turning it OFF via "Save" persists.
 *
 * When Director is OFF:
 *   - iframe behaves like a normal rendered page. No overlays, no editing.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { parseHtmlPath, humanizeSlot } from '@/lib/studio-bridge'
import { StudioImagePicker, type StudioPickTarget } from './StudioImagePicker'
import { emitCDComment } from '@/lib/session-events'

interface LivePreviewWithDirectorProps {
  htmlPath: string | null | undefined
  title?: string
  emptyMessage?: string
  showOpenInNewTab?: boolean
  onSlotSwapped?: (info: {
    sessionId: string
    pageFilename: string
    slot: string
    newImage: string
    oldImage?: string
  }) => void
  /** Controlled Director Mode (host renders its own toggle). */
  directorMode?: boolean
  onDirectorModeChange?: (enabled: boolean) => void
  /** Suppress the default overlay Director button. */
  hideBuiltInDirectorButton?: boolean
  /**
   * The image currently selected in Zone 1 (asset grid). Primary click on
   * an image in the preview swaps it with this. If null, the primary click
   * falls back to opening the StudioImagePicker.
   */
  zone1SelectedImage?: { filename: string; sessionId: string } | null
  /**
   * Suppress the built-in "Ask CD" overlay (textarea at the bottom of the
   * preview when Director is ON). Image Mode sets this to `true` because
   * its Zone 3 already provides an Ask CD input. Gallery leaves it `false`
   * so users can ask CD directly from the preview.
   */
  hideAskCDOverlay?: boolean
}

// ────────────────────────────────────────────────────────────────────────
// Style state model (per-element)
// ────────────────────────────────────────────────────────────────────────

interface FilterState {
  brightness: number // 0–2, default 1
  contrast: number // 0–2, default 1
  saturate: number // 0–2, default 1 (pulled to 0 = grayscale, no need for separate slider)
  sepia: number // 0–1, default 0
  blur: number // px, default 0
  hue: number // deg, default 0
}

interface TransformState {
  fit: 'cover' | 'contain' | 'fill' | 'auto' | null
  // Position as two percentages (0-100) for pixel-level control. Default
  // (50, 50) = center. The 3×3 grid is kept as quick-preset buttons that
  // snap these to 0/50/100.
  positionX: number
  positionY: number
  zoom: number // 1–2
  rotate: number // deg, ±45
  flipH: boolean
  flipV: boolean
  radius: number // percent, 0–50 (scales to element size; 50 = pill/circle)
  repeat: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y' | null
}

const defaultFilters: FilterState = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  sepia: 0,
  blur: 0,
  hue: 0,
}

const defaultTransform: TransformState = {
  fit: null,
  positionX: 50,
  positionY: 50,
  zoom: 1,
  rotate: 0,
  flipH: false,
  flipV: false,
  radius: 0,
  repeat: null,
}

function buildFilterString(f: FilterState): string {
  const parts: string[] = []
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`)
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`)
  if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`)
  if (f.sepia > 0) parts.push(`sepia(${f.sepia})`)
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`)
  if (f.hue !== 0) parts.push(`hue-rotate(${f.hue}deg)`)
  return parts.join(' ')
}

function buildTransformString(t: TransformState): string {
  const parts: string[] = []
  if (t.flipH && t.flipV) parts.push('scale(-1, -1)')
  else if (t.flipH) parts.push('scaleX(-1)')
  else if (t.flipV) parts.push('scaleY(-1)')
  if (t.zoom !== 1) parts.push(`scale(${t.zoom})`)
  if (t.rotate !== 0) parts.push(`rotate(${t.rotate}deg)`)
  return parts.join(' ')
}

// ────────────────────────────────────────────────────────────────────────
// Snapshot (for undo)
// ────────────────────────────────────────────────────────────────────────

interface ElementSnapshot {
  style: string // the element's inline style at Director-ON time
  src?: string // <img>.src
  textHtml?: string // for text edits (captured on edit start)
  innerHtml?: string
  bgImage?: string // parsed background-image
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export interface LivePreviewWithDirectorHandle {
  /** Revert every edit made since Director last turned ON. */
  revertAll: () => void
  /** Commit: clear the undo snapshots without reverting anything. Default
   *  behavior on director-off or unmount. Idempotent. */
  saveAll: () => void
  /** Number of elements with pending (unreverted) edits. */
  pendingChangeCount: () => number
}

export const LivePreviewWithDirector = forwardRef<
  LivePreviewWithDirectorHandle,
  LivePreviewWithDirectorProps
>(function LivePreviewWithDirector({
  htmlPath,
  title,
  emptyMessage = 'No vibe selected',
  showOpenInNewTab = true,
  onSlotSwapped,
  directorMode: controlledDirectorMode,
  onDirectorModeChange,
  hideBuiltInDirectorButton = false,
  zone1SelectedImage = null,
  hideAskCDOverlay = false,
}, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [internalDirectorMode, setInternalDirectorMode] = useState(false)
  const isControlled =
    controlledDirectorMode !== undefined && onDirectorModeChange !== undefined
  const directorMode = isControlled ? (controlledDirectorMode as boolean) : internalDirectorMode
  const setDirectorMode = (next: boolean | ((prev: boolean) => boolean)) => {
    const value =
      typeof next === 'function' ? (next as (p: boolean) => boolean)(directorMode) : next
    if (isControlled) {
      onDirectorModeChange?.(value)
    } else {
      setInternalDirectorMode(value)
    }
  }
  const [studioTarget, setStudioTarget] = useState<StudioPickTarget | null>(null)

  // Gear overlay: which element is currently being hovered that's a swap target
  const [gearEl, setGearEl] = useState<HTMLElement | null>(null)
  const [gearRect, setGearRect] = useState<{ x: number; y: number } | null>(null)

  // Styling popover: element being styled, and its current state
  const [styleTarget, setStyleTarget] = useState<HTMLElement | null>(null)

  // Parse sessionId + pageFilename up-front — used by multiple handlers below.
  const { sessionId, pageFilename } = parseHtmlPath(htmlPath || undefined)

  // Ask CD overlay (Gallery uses this; Image Mode suppresses via hideAskCDOverlay)
  const [askInput, setAskInput] = useState('')
  const [askBusy, setAskBusy] = useState(false)

  const handleAskOverlay = useCallback(async () => {
    const msg = askInput.trim()
    if (!msg || askBusy || !sessionId) return
    setAskBusy(true)
    try {
      const res = await fetch('/api/ask-cd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'advanced-mode',
          mode: 'generate',
          currentPrompt: '',
          userMessage: msg,
          sessionId,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        emitCDComment(sessionId, {
          content: `Ask CD failed: ${body.error || res.status}`,
          source: 'director-overlay',
        })
        return
      }
      const parsed = await res.json()
      const reply = parsed.feedback || parsed.imagePrompt || '(no reply)'
      emitCDComment(sessionId, { content: reply, source: 'director-overlay' })
      setAskInput('')
    } catch (err) {
      emitCDComment(sessionId, {
        content: `Ask CD failed: ${err instanceof Error ? err.message : String(err)}`,
        source: 'director-overlay',
      })
    } finally {
      setAskBusy(false)
    }
  }, [askInput, askBusy, sessionId])

  // Snapshot map for undo (WeakMap so GC'd elements get cleaned up)
  const snapshotsRef = useRef<WeakMap<HTMLElement, ElementSnapshot>>(new WeakMap())
  // Also track the set of elements we've modified so we can iterate on revert
  const modifiedElsRef = useRef<Set<HTMLElement>>(new Set())

  // ───────────────────────────────────────────────────────────────────────
  // Snapshot helpers
  // ───────────────────────────────────────────────────────────────────────

  const snapshotElement = useCallback((el: HTMLElement) => {
    if (snapshotsRef.current.has(el)) return // first snapshot wins
    const snap: ElementSnapshot = {
      style: el.getAttribute('style') || '',
    }
    if (el.tagName === 'IMG') {
      snap.src = (el as HTMLImageElement).getAttribute('src') || ''
    }
    const cs = el.ownerDocument?.defaultView?.getComputedStyle(el)
    if (cs && cs.backgroundImage && cs.backgroundImage !== 'none') {
      snap.bgImage = cs.backgroundImage
    }
    snap.innerHtml = el.innerHTML
    snapshotsRef.current.set(el, snap)
    modifiedElsRef.current.add(el)
  }, [])

  const revertAll = useCallback(() => {
    modifiedElsRef.current.forEach((el) => {
      const snap = snapshotsRef.current.get(el)
      if (!snap) return
      // Restore inline style
      if (snap.style) el.setAttribute('style', snap.style)
      else el.removeAttribute('style')
      // Restore <img> src
      if (snap.src !== undefined && el.tagName === 'IMG') {
        ;(el as HTMLImageElement).src = snap.src
      }
      // Restore inner HTML (for text edits)
      if (snap.innerHtml !== undefined) {
        el.innerHTML = snap.innerHtml
      }
    })
    modifiedElsRef.current.clear()
    snapshotsRef.current = new WeakMap()
    // Collapse any open styling popover — its snapshot just got wiped.
    setStyleTarget(null)
  }, [])

  const saveAll = useCallback(async () => {
    // Commit: persist every modified element to disk, then clear the undo map.
    // Text edits already persist via /api/director/text-edit on blur; this
    // pass handles image swaps + inline styling (filter/transform/etc).
    const els = Array.from(modifiedElsRef.current)
    const edits = els
      .map((el) => {
        const snap = snapshotsRef.current.get(el)
        if (!snap) return null
        const styleNow = el.getAttribute('style') || ''
        const srcNow = el.tagName === 'IMG' ? (el as HTMLImageElement).getAttribute('src') || '' : null
        const styleChanged = styleNow !== (snap.style || '')
        const srcChanged = srcNow !== null && srcNow !== (snap.src ?? '')
        if (!styleChanged && !srcChanged) return null
        // CSS selector path the server can resolve via jsdom.querySelector.
        const selector = buildSelectorPath(el)
        return {
          selector,
          ...(styleChanged ? { style: styleNow } : {}),
          ...(srcChanged && srcNow !== null ? { src: srcNow } : {}),
        }
      })
      .filter((e): e is { selector: string; style?: string; src?: string } => e !== null)

    // Always wipe the undo map first — UX-wise the user pressed Save, so
    // they want commitment regardless of whether the network succeeds.
    modifiedElsRef.current.clear()
    snapshotsRef.current = new WeakMap()

    if (edits.length === 0 || !sessionId || !pageFilename) return

    try {
      const res = await fetch('/api/director/save-edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, pageFilename, edits }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        console.warn('[save-edits] Server rejected:', body)
      } else {
        const result = await res.json()
        const failed = (result.results || []).filter((r: { ok: boolean }) => !r.ok)
        if (failed.length > 0) {
          console.warn('[save-edits] Some edits failed:', failed)
        }
      }
    } catch (err) {
      console.warn('[save-edits] Network error:', err)
    }
  }, [sessionId, pageFilename])

  // Default on component unmount (user navigates away, switches panes, etc.)
  // is COMMIT — fire saveAll() so pending edits land on disk before unmount.
  // Use a ref so the cleanup doesn't capture a stale saveAll closure.
  const saveAllRef = useRef(saveAll)
  saveAllRef.current = saveAll
  useEffect(() => {
    return () => {
      // Best-effort: fire and forget. Browser will keep the request alive
      // even after the React tree unmounts (fetch is window-scoped).
      saveAllRef.current()
    }
  }, [])

  // Expose save/revert/pending-count to the host via imperative handle.
  useImperativeHandle(
    ref,
    () => ({
      revertAll,
      saveAll,
      pendingChangeCount: () => modifiedElsRef.current.size,
    }),
    [revertAll, saveAll]
  )

  // ───────────────────────────────────────────────────────────────────────
  // Swap helpers
  // ───────────────────────────────────────────────────────────────────────

  const swapImage = useCallback((el: HTMLElement, newUrl: string) => {
    snapshotElement(el)
    if (el.tagName === 'IMG') {
      const img = el as HTMLImageElement
      img.style.transition = 'opacity 0.2s'
      img.style.opacity = '0.3'
      const onload = () => {
        img.style.opacity = '1'
        img.removeEventListener('load', onload)
      }
      img.addEventListener('load', onload)
      img.src = newUrl
    } else {
      const existing = window.getComputedStyle(el).backgroundImage
      const replaced = existing.replace(
        /url\(['"]?[^'"\)]+['"]?\)/,
        `url("${newUrl}")`
      )
      el.style.backgroundImage = replaced || `url("${newUrl}")`
    }
  }, [snapshotElement])

  const isSwapTarget = useCallback((el: HTMLElement): boolean => {
    if (el.tagName === 'IMG') return true
    const bg = el.ownerDocument?.defaultView?.getComputedStyle(el).backgroundImage
    if (bg && bg !== 'none' && /url\(/i.test(bg)) return true
    return false
  }, [])

  const findSwapTarget = useCallback(
    (start: HTMLElement): HTMLElement | null => {
      let node: HTMLElement | null = start
      const body = start.ownerDocument?.body
      while (node && node !== body) {
        if (isSwapTarget(node)) return node
        node = node.parentElement
      }
      return null
    },
    [isSwapTarget]
  )

  // ───────────────────────────────────────────────────────────────────────
  // Director setup inside the iframe
  // ───────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const iframeEl = iframeRef.current
    if (!iframeEl || !htmlPath) return
    // Save text edits on blur
    const textSnapshots = new WeakMap<HTMLElement, string>()

    function installStyles(doc: Document) {
      if (doc.getElementById('oskar-director-styles')) return
      const s = doc.createElement('style')
      s.id = 'oskar-director-styles'
      s.textContent = `
        html.oskar-director body { cursor: text; }
        html.oskar-director img,
        html.oskar-director [data-oskar-bg="1"] {
          outline: 2px dashed rgba(16,185,129,0.35);
          outline-offset: 2px;
          transition: outline 0.12s, filter 0.12s;
        }
        html.oskar-director img:hover,
        html.oskar-director [data-oskar-bg="1"]:hover {
          outline: 2px solid rgba(16,185,129,0.85);
        }
      `
      doc.head?.appendChild(s)
    }

    function tagBgImages(doc: Document) {
      // Mark every element that actually has a background-image URL so the
      // CSS selector can find them. We re-check on every setup (in case
      // the vibe page loaded images lazily after first render).
      doc.querySelectorAll('[data-oskar-bg]').forEach((el) =>
        el.removeAttribute('data-oskar-bg')
      )
      const win = iframeEl?.contentWindow
      if (!win) return
      doc.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const tag = el.tagName
        if (['SCRIPT','STYLE','LINK','META','HEAD','TITLE'].includes(tag)) return
        if (el === doc.documentElement || el === doc.body) return
        const bg = win.getComputedStyle(el).backgroundImage
        if (!bg || bg === 'none') return
        if (!/url\(/i.test(bg)) return
        el.setAttribute('data-oskar-bg', '1')
      })
    }

    function onMouseOver(e: MouseEvent) {
      if (!doc.documentElement.classList.contains('oskar-director')) return
      const t = e.target as HTMLElement | null
      if (!t) return
      const swap = findSwapTarget(t)
      if (!swap) {
        setGearEl(null)
        return
      }
      // Position gear in element center (in viewport coordinates — the gear
      // will render in the PARENT document's coordinate space via absolute
      // position + iframe offset).
      const rect = swap.getBoundingClientRect()
      const iframeRect = iframeEl!.getBoundingClientRect()
      setGearEl(swap)
      setGearRect({
        x: iframeRect.left + rect.left + rect.width / 2,
        y: iframeRect.top + rect.top + rect.height / 2,
      })
    }

    function onClick(e: MouseEvent) {
      if (!doc.documentElement.classList.contains('oskar-director')) return
      const t = e.target as HTMLElement | null
      if (!t) return
      // Only primary-swap on direct <img> clicks. BG-image sections contain
      // text (headlines, CTAs); clicking those should EDIT TEXT natively via
      // contentEditable, not swap the whole background. For bg-images the
      // gear icon is the deliberate swap/styling entry.
      if (t.tagName !== 'IMG') return
      const swap = t

      // Primary action: swap with Zone 1 selected image
      if (zone1SelectedImage) {
        e.preventDefault()
        e.stopPropagation()
        const url = `/${zone1SelectedImage.sessionId}/${zone1SelectedImage.filename}`
        swapImage(swap, url)
        // Notify parent of the swap
        if (sessionId && pageFilename) {
          onSlotSwapped?.({
            sessionId,
            pageFilename,
            slot:
              swap.tagName === 'IMG'
                ? `img:${(swap as HTMLImageElement).src}`
                : `bgimg:${swap.getAttribute('data-oskar-bg') || ''}`,
            newImage: zone1SelectedImage.filename,
          })
        }
        return
      }

      // Fallback: no Zone 1 selection → open the picker modal
      if (sessionId && pageFilename) {
        e.preventDefault()
        e.stopPropagation()
        const src =
          swap.tagName === 'IMG'
            ? (swap as HTMLImageElement).src
            : window.getComputedStyle(swap).backgroundImage
        setStudioTarget({
          pageFilename,
          slot: swap.tagName === 'IMG' ? `img:${src}` : `bgimg:${src}`,
          humanLabel: humanizeSlot(
            swap.tagName === 'IMG' ? `img:${src}` : `bgimg:${src}`
          ),
          currentImage: src,
          context: null,
        })
      }
    }

    function onFocusIn(e: FocusEvent) {
      if (!doc.documentElement.classList.contains('oskar-director')) return
      const t = e.target as HTMLElement | null
      if (!t) return
      // Record the "before" text so we can detect changes on blur.
      if (!textSnapshots.has(t)) {
        textSnapshots.set(t, t.innerHTML)
      }
    }

    function onFocusOut(e: FocusEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      const before = textSnapshots.get(t)
      if (before === undefined) return
      if (t.innerHTML === before) return
      // Snapshot the element so we can revert on director-off-without-save
      snapshotElement(t)
      // Persist via the text-edit API
      if (!sessionId || !pageFilename) return
      // Best-effort oskar-id: use any existing [data-oskar-id], else generate
      // a stable path-based one using a CSS selector from body.
      let oskarId = t.getAttribute('data-oskar-id')
      if (!oskarId) {
        oskarId = buildStablePath(t)
        t.setAttribute('data-oskar-id', oskarId)
      }
      fetch('/api/director/text-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pageFilename,
          oskarId,
          newText: (t.textContent || '').trim(),
          tagName: t.tagName.toLowerCase(),
        }),
      }).catch((err) => console.warn('[text-edit] persist failed', err))
    }

    const doc = iframeEl.contentDocument
    function setup() {
      const d = iframeEl?.contentDocument
      if (!d) return
      installStyles(d)
      tagBgImages(d)
      d.addEventListener('mouseover', onMouseOver, true)
      d.addEventListener('click', onClick, true)
      d.addEventListener('focusin', onFocusIn, true)
      d.addEventListener('focusout', onFocusOut, true)
    }
    function teardown() {
      const d = iframeEl?.contentDocument
      if (!d) return
      d.removeEventListener('mouseover', onMouseOver, true)
      d.removeEventListener('click', onClick, true)
      d.removeEventListener('focusin', onFocusIn, true)
      d.removeEventListener('focusout', onFocusOut, true)
    }

    if (doc?.readyState === 'complete') setup()
    else iframeEl.addEventListener('load', setup)
    return () => {
      iframeEl.removeEventListener('load', setup)
      teardown()
    }
  }, [htmlPath, findSwapTarget, swapImage, zone1SelectedImage, sessionId, pageFilename, onSlotSwapped, snapshotElement])

  // Apply director class + contentEditable live when directorMode flips
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    doc.documentElement.classList.toggle('oskar-director', directorMode)
    if (doc.body) {
      if (directorMode) {
        doc.body.setAttribute('contenteditable', 'true')
        doc.body.setAttribute('spellcheck', 'false')
      } else {
        doc.body.removeAttribute('contenteditable')
        doc.body.removeAttribute('spellcheck')
        // Turning Director OFF = COMMIT. saveAll persists pending image swaps
        // and inline-style edits to disk via /api/director/save-edits, then
        // clears the undo map. Explicit revert happens via the "Revert all"
        // button (exposed through the imperative handle).
        void saveAllRef.current()
        setGearEl(null)
        setStyleTarget(null)
      }
    }
  }, [directorMode])

  // Keep gear in sync when scrolling the iframe
  useEffect(() => {
    if (!directorMode) return
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    function update() {
      if (!gearEl) return
      const iframeRect = iframeRef.current?.getBoundingClientRect()
      if (!iframeRect) return
      const rect = gearEl.getBoundingClientRect()
      setGearRect({
        x: iframeRect.left + rect.left + rect.width / 2,
        y: iframeRect.top + rect.top + rect.height / 2,
      })
    }
    doc.addEventListener('scroll', update, true)
    window.addEventListener('scroll', update, true)
    return () => {
      doc.removeEventListener('scroll', update, true)
      window.removeEventListener('scroll', update, true)
    }
  }, [directorMode, gearEl])

  // ───────────────────────────────────────────────────────────────────────
  // Styling popover: apply filter/transform changes inline
  // ───────────────────────────────────────────────────────────────────────

  const [filterState, setFilterState] = useState<FilterState>(defaultFilters)
  const [transformState, setTransformState] = useState<TransformState>(defaultTransform)

  // Initialize panel state when a new element is targeted
  useEffect(() => {
    if (!styleTarget) return
    // Snapshot before any styling change
    snapshotElement(styleTarget)
    setFilterState(defaultFilters)
    setTransformState(defaultTransform)
  }, [styleTarget, snapshotElement])

  // Apply filter whenever filterState changes
  useEffect(() => {
    if (!styleTarget) return
    const f = buildFilterString(filterState)
    styleTarget.style.filter = f
  }, [filterState, styleTarget])

  // Apply transform + fit + position + radius whenever transformState changes
  useEffect(() => {
    if (!styleTarget) return
    const t = transformState
    const tf = buildTransformString(t)
    const isImg = styleTarget.tagName === 'IMG'
    // Both X and Y as CSS percentages. `object-position` / `background-position`
    // accept percentage values where 0% 0% = top-left and 100% 100% = bottom-right.
    // Default (50, 50) = center. Sliders give pixel-level control.
    const posString = `${t.positionX}% ${t.positionY}%`
    styleTarget.style.transform = tf
    // Percentage-based so the corners scale with element size. 50% = pill/circle.
    // We also set overflow:hidden so bg-images / inner content actually clip
    // against the rounded border (without it the bg extends past the radius).
    if (t.radius > 0) {
      styleTarget.style.borderRadius = `${t.radius}%`
      styleTarget.style.overflow = 'hidden'
    } else {
      styleTarget.style.borderRadius = ''
      // Only reset overflow if WE set it (don't clobber the vibe's own style)
      if (styleTarget.style.overflow === 'hidden') styleTarget.style.overflow = ''
    }
    if (isImg) {
      styleTarget.style.objectFit = t.fit || ''
      styleTarget.style.objectPosition = posString
      // Zoom for <img> uses transform: scale — already baked into tf.
    } else {
      if (t.fit === 'fill') styleTarget.style.backgroundSize = '100% 100%'
      else if (t.fit === 'auto') styleTarget.style.backgroundSize = 'auto'
      else if (t.fit === 'cover' || t.fit === 'contain')
        styleTarget.style.backgroundSize = t.fit
      else if (t.zoom !== 1)
        styleTarget.style.backgroundSize = `${100 * t.zoom}%`
      else styleTarget.style.backgroundSize = ''
      styleTarget.style.backgroundPosition = posString
      styleTarget.style.backgroundRepeat = t.repeat || ''
    }
  }, [transformState, styleTarget])

  // ───────────────────────────────────────────────────────────────────────
  // Picker result (fallback modal)
  // ───────────────────────────────────────────────────────────────────────

  const handlePicked = useCallback(
    (result: { filename: string; slot: string; pageFilename: string; oldImage?: string }) => {
      const doc = iframeRef.current?.contentDocument
      if (doc) {
        const el = resolveSlotToElement(doc, result.slot)
        if (el) swapImage(el, `/${sessionId}/${result.filename}`)
      }
      setStudioTarget(null)
      if (sessionId) {
        onSlotSwapped?.({
          sessionId,
          pageFilename: result.pageFilename,
          slot: result.slot,
          newImage: result.filename,
          oldImage: result.oldImage,
        })
      }
    },
    [sessionId, onSlotSwapped, swapImage]
  )

  // ───────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────

  if (!htmlPath) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        {emptyMessage}
      </div>
    )
  }

  const canUseDirector = !!sessionId

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'white',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {canUseDirector && !hideBuiltInDirectorButton && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 30,
            display: 'flex',
            gap: 6,
          }}
        >
          {directorMode && (
            <>
              <button
                onClick={saveAll}
                title="Commit pending edits (default on leave)"
                style={{
                  padding: '8px 12px', borderRadius: 8,
                  border: '1px solid rgba(16,185,129,0.55)',
                  background: 'rgba(16,185,129,0.18)', color: 'rgba(16,185,129,1)',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                  textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Save
              </button>
              <button
                onClick={revertAll}
                title="Undo every edit since Director was turned on"
                style={{
                  padding: '8px 12px', borderRadius: 8,
                  border: '1px solid rgba(239,68,68,0.55)',
                  background: 'rgba(239,68,68,0.18)', color: 'rgba(239,68,68,1)',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                  textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Revert
              </button>
            </>
          )}
          <button
            onClick={() => setDirectorMode((m) => !m)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: directorMode
                ? '1px solid rgba(16,185,129,0.8)'
                : '1px solid var(--border-card)',
              background: directorMode ? 'rgba(16,185,129,0.95)' : 'var(--bg-card)',
              color: directorMode ? 'white' : 'var(--text-main)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {directorMode ? 'Director ON' : 'Director'}
          </button>
        </div>
      )}

      <iframe
        ref={iframeRef}
        key={htmlPath}
        src={htmlPath}
        title={title || 'Live preview'}
        style={{
          width: '100%',
          flex: 1,
          border: 'none',
          background: 'white',
        }}
      />

      {/* Gear icon — centered over the hovered swap target. Rendered in parent
          document so it's above the iframe. */}
      {directorMode && gearEl && gearRect && (
        <div
          style={{
            position: 'fixed',
            left: gearRect.x - 22,
            top: gearRect.y - 22,
            width: 44,
            height: 44,
            borderRadius: 22,
            background: 'rgba(0,0,0,0.65)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 40,
            pointerEvents: 'auto',
            backdropFilter: 'blur(4px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
          onClick={(e) => {
            e.stopPropagation()
            setStyleTarget(gearEl)
          }}
          title="Image styling options"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
      )}

      {/* Styling popover */}
      {directorMode && styleTarget && (
        <StylingPopover
          targetTag={styleTarget.tagName}
          filterState={filterState}
          onFilterChange={setFilterState}
          transformState={transformState}
          onTransformChange={setTransformState}
          onClose={() => setStyleTarget(null)}
          onReset={() => {
            const snap = snapshotsRef.current.get(styleTarget)
            if (snap) {
              if (snap.style) styleTarget.setAttribute('style', snap.style)
              else styleTarget.removeAttribute('style')
            }
            setFilterState(defaultFilters)
            setTransformState(defaultTransform)
          }}
          onSwap={() => {
            if (!sessionId || !pageFilename) return
            const src =
              styleTarget.tagName === 'IMG'
                ? (styleTarget as HTMLImageElement).src
                : window.getComputedStyle(styleTarget).backgroundImage
            setStudioTarget({
              pageFilename,
              slot: styleTarget.tagName === 'IMG' ? `img:${src}` : `bgimg:${src}`,
              humanLabel: humanizeSlot(
                styleTarget.tagName === 'IMG' ? `img:${src}` : `bgimg:${src}`
              ),
              currentImage: src,
              context: null,
            })
            setStyleTarget(null)
          }}
          zone1SelectedImage={zone1SelectedImage}
          onSwapWithZone1={
            zone1SelectedImage
              ? () => {
                  const url = `/${zone1SelectedImage.sessionId}/${zone1SelectedImage.filename}`
                  swapImage(styleTarget, url)
                  if (sessionId && pageFilename) {
                    onSlotSwapped?.({
                      sessionId,
                      pageFilename,
                      slot:
                        styleTarget.tagName === 'IMG'
                          ? `img:${(styleTarget as HTMLImageElement).src}`
                          : `bgimg:${styleTarget.getAttribute('data-oskar-bg') || ''}`,
                      newImage: zone1SelectedImage.filename,
                    })
                  }
                  setStyleTarget(null)
                }
              : undefined
          }
        />
      )}

      {showOpenInNewTab && (
        <a
          href={htmlPath}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            padding: '6px 12px',
            background: 'var(--bg-card)',
            color: 'var(--accent, #3B82F6)',
            fontSize: 12,
            textDecoration: 'none',
            borderRadius: 6,
            border: '1px solid var(--border-card)',
            zIndex: 20,
          }}
        >
          Open in new tab ↗
        </a>
      )}

      {/* Ask CD overlay — only when Director is ON and host didn't suppress.
          Sits bottom-center of the preview. Reply comes back as a snackbar
          (emitCDComment) so the user doesn't lose context of the iframe. */}
      {directorMode && !hideAskCDOverlay && canUseDirector && (
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(560px, calc(100% - 28px))',
            zIndex: 35,
            background: 'rgba(0,0,0,0.78)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 10,
          }}
        >
          <textarea
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleAskOverlay()
              }
            }}
            placeholder="Ask CD about this vibe — reply appears as a snackbar"
            rows={3}
            disabled={askBusy}
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 13,
              lineHeight: 1.4,
              color: 'white',
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              opacity: askBusy ? 0.5 : 1,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              onClick={handleAskOverlay}
              disabled={askBusy || !askInput.trim()}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: askBusy || !askInput.trim() ? 'rgba(255,255,255,0.1)' : '#F59E0B',
                color: 'white',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: askBusy || !askInput.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {askBusy ? 'Thinking…' : 'Send to CD'}
            </button>
          </div>
        </div>
      )}

      {studioTarget && sessionId && (
        <StudioImagePicker
          sessionId={sessionId}
          target={studioTarget}
          onClose={() => setStudioTarget(null)}
          onPicked={handlePicked}
        />
      )}
    </div>
  )
})

// ────────────────────────────────────────────────────────────────────────
// StylingPopover — Panel 1 (Filter) + Panel 2 (Image/Transform)
// ────────────────────────────────────────────────────────────────────────

function StylingPopover({
  targetTag,
  filterState,
  onFilterChange,
  transformState,
  onTransformChange,
  onClose,
  onReset,
  onSwap,
  zone1SelectedImage,
  onSwapWithZone1,
}: {
  targetTag: string
  filterState: FilterState
  onFilterChange: (next: FilterState) => void
  transformState: TransformState
  onTransformChange: (next: TransformState) => void
  onClose: () => void
  onReset: () => void
  onSwap: () => void
  zone1SelectedImage?: { filename: string; sessionId: string } | null
  onSwapWithZone1?: () => void
}) {
  const [tab, setTab] = useState<'filter' | 'image'>('filter')
  const isBg = targetTag !== 'IMG'

  return (
    <div
      role="dialog"
      style={{
        position: 'absolute',
        top: 60,
        right: 10,
        width: 320,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
        zIndex: 50,
        padding: 14,
        fontFamily: 'inherit',
        color: 'var(--text-main)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--pill-bg)', border: '1px solid var(--pill-border)', borderRadius: 6 }}>
          {(['filter', 'image'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '4px 10px',
                border: 'none',
                borderRadius: 4,
                background: tab === t ? 'var(--accent, #3B82F6)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--text-muted)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t === 'filter' ? 'Color' : 'Image'}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={iconBtn}>✕</button>
      </div>

      {tab === 'filter' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Slider label="Brightness" min={0} max={2} step={0.02} value={filterState.brightness} onChange={(v) => onFilterChange({ ...filterState, brightness: v })} />
          <Slider label="Contrast" min={0} max={2} step={0.02} value={filterState.contrast} onChange={(v) => onFilterChange({ ...filterState, contrast: v })} />
          <Slider label="Saturation" min={0} max={2} step={0.02} value={filterState.saturate} onChange={(v) => onFilterChange({ ...filterState, saturate: v })} />
          <Slider label="Sepia" min={0} max={1} step={0.02} value={filterState.sepia} onChange={(v) => onFilterChange({ ...filterState, sepia: v })} />
          <Slider label="Blur" min={0} max={10} step={0.1} value={filterState.blur} onChange={(v) => onFilterChange({ ...filterState, blur: v })} />
          <Slider label="Hue shift" min={0} max={360} step={2} value={filterState.hue} onChange={(v) => onFilterChange({ ...filterState, hue: v })} />
        </div>
      )}

      {tab === 'image' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row label="Fit">
            <PillGroup
              value={transformState.fit || ''}
              options={['cover', 'contain', 'fill', 'auto']}
              onChange={(v) => onTransformChange({ ...transformState, fit: (v || null) as TransformState['fit'] })}
            />
          </Row>
          <Slider
            label="Position offset X"
            min={0}
            max={100}
            step={1}
            value={transformState.positionX}
            onChange={(v) => onTransformChange({ ...transformState, positionX: v })}
          />
          <Slider
            label="Position offset Y"
            min={0}
            max={100}
            step={1}
            value={transformState.positionY}
            onChange={(v) => onTransformChange({ ...transformState, positionY: v })}
          />
          <Slider label="Zoom" min={1} max={2} step={0.02} value={transformState.zoom} onChange={(v) => onTransformChange({ ...transformState, zoom: v })} />
          <Slider label="Rotate" min={-45} max={45} step={1} value={transformState.rotate} onChange={(v) => onTransformChange({ ...transformState, rotate: v })} />
          <div style={{ display: 'flex', gap: 6 }}>
            <Toggle label="Flip H" checked={transformState.flipH} onChange={(b) => onTransformChange({ ...transformState, flipH: b })} />
            <Toggle label="Flip V" checked={transformState.flipV} onChange={(b) => onTransformChange({ ...transformState, flipV: b })} />
          </div>
          <Slider label="Rounded corners (%)" min={0} max={50} step={1} value={transformState.radius} onChange={(v) => onTransformChange({ ...transformState, radius: v })} />
          {isBg && (
            <Row label="Repeat">
              <PillGroup
                value={transformState.repeat || ''}
                options={['no-repeat', 'repeat', 'repeat-x', 'repeat-y']}
                onChange={(v) => onTransformChange({ ...transformState, repeat: (v || null) as TransformState['repeat'] })}
              />
            </Row>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={onReset} style={secondaryBtn}>Reset</button>
        {zone1SelectedImage && onSwapWithZone1 && (
          <button
            onClick={onSwapWithZone1}
            style={{ ...secondaryBtn, background: '#10B981', color: '#fff', borderColor: '#10B981' }}
            title={`Swap with ${zone1SelectedImage.filename}`}
          >
            Swap w/ Zone 1
          </button>
        )}
        <button onClick={onSwap} style={secondaryBtn}>Replace…</button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Small UI helpers (kept local to this file)
// ────────────────────────────────────────────────────────────────────────

function Slider({
  label, min, max, step, value, onChange,
}: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{label}</span>
        <span style={{ color: 'var(--text-dim)' }}>{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: '100%' }} />
    </label>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {children}
    </div>
  )
}

function PillGroup({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(value === o ? '' : o)}
          style={{
            padding: '4px 8px', borderRadius: 4, border: '1px solid var(--pill-border)',
            background: value === o ? 'var(--accent, #3B82F6)' : 'transparent',
            color: value === o ? '#fff' : 'var(--text-muted)', fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >{o}</button>
      ))}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        padding: '4px 10px', borderRadius: 4, border: '1px solid var(--pill-border)',
        background: checked ? 'var(--accent, #3B82F6)' : 'transparent',
        color: checked ? '#fff' : 'var(--text-muted)', fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{label}</button>
  )
}

const iconBtn: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 4, border: '1px solid var(--pill-border)',
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontFamily: 'inherit',
}

const secondaryBtn: React.CSSProperties = {
  flex: 1, padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--pill-border)', background: 'transparent',
  color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit',
}

// ────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ────────────────────────────────────────────────────────────────────────

/** Build a stable CSS-selector path from body to the element. Used as a
 *  fallback data-oskar-id so the text-edit API can locate the element later. */
function buildStablePath(el: HTMLElement): string {
  // Used as a stable opaque ID by the text-edit API path. Server doesn't
  // resolve this back to a selector — text-edit uses positional indexing.
  return 'auto-' + buildSelectorPath(el)
}

/**
 * Build a real CSS selector path that the server can resolve via
 * `document.querySelector`. Walks from the element up to <body>, recording
 * `tag:nth-of-type(N)` at each level. Resilient to most edits because it
 * doesn't rely on classes or auto-generated ids — only DOM structure.
 *
 *   body > section:nth-of-type(1) > div:nth-of-type(2) > img:nth-of-type(1)
 */
function buildSelectorPath(el: HTMLElement): string {
  const parts: string[] = []
  let node: HTMLElement | null = el
  const body = el.ownerDocument?.body
  while (node && node !== body) {
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (!parent) break
    const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
    const idx = siblings.indexOf(node)
    parts.unshift(`${tag}:nth-of-type(${idx + 1})`)
    node = parent
  }
  return 'body > ' + parts.join(' > ')
}

/** For the fallback picker modal: resolve a slot id back to the element. */
function resolveSlotToElement(doc: Document, slot: string): HTMLElement | null {
  if (slot.startsWith('img:')) {
    const rest = slot.slice(4)
    const hashIdx = rest.lastIndexOf('#')
    let targetSrc = rest
    let occ = 1
    if (hashIdx >= 0) {
      const n = parseInt(rest.slice(hashIdx + 1), 10)
      if (!isNaN(n) && n >= 1) {
        targetSrc = rest.slice(0, hashIdx)
        occ = n
      }
    }
    const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>('img'))
    let seen = 0
    for (const img of imgs) {
      if (img.getAttribute('src') === targetSrc || img.src === targetSrc) {
        seen += 1
        if (seen === occ) return img
      }
    }
    return null
  }
  if (slot.startsWith('bgimg:')) {
    // We don't store the bg url on the element anymore (data-oskar-bg="1"),
    // so fall back to picking the first element whose current bg matches.
    const url = slot.slice(6)
    const els = Array.from(doc.querySelectorAll<HTMLElement>('[data-oskar-bg="1"]'))
    for (const el of els) {
      const bg = doc.defaultView?.getComputedStyle(el).backgroundImage || ''
      if (bg.includes(url)) return el
    }
    return els[0] || null
  }
  return doc.querySelector<HTMLElement>(`img[data-slot="${slot}"]`)
}

/** Helper: let callers force the iframe to reload after out-of-band changes. */
export function cacheBustSuffix(): string {
  return `?_ts=${Date.now()}`
}
