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
import { emitCDComment, emitError } from '@/lib/session-events'
import {
  // Types
  type Unit,
  type SpacingQuad,
  type RadiusQuad,
  type SizeUnit,
  type SizeDim,
  type BoxState,
  type TypeState,
  type FilterState,
  type TransformState,
  type ElementSnapshot,
  // Defaults
  defaultBox,
  defaultType,
  defaultFilters,
  defaultTransform,
  // Readers / parsers
  readBoxFromElement,
  readComputedSize,
  readTypeFromElement,
  parseLength,
  isTextElement,
  isTextLeafElement,
  // Discovery
  discoverFontsOnPage,
  discoverWeightsForFont,
  discoverLinksOnPage,
  // Serializers
  serializeQuad,
  serializeRadius,
  serializeSizeDim,
  spacingIsZero,
  radiusIsZero,
  buildFilterString,
  buildTransformString,
  // Humanization
  weightLabel,
  // Selector helpers
  buildSelectorPath,
  buildStablePath,
  resolveSlotToElement,
  cacheBustSuffix as cacheBustSuffixFromLib,
  // Shared iframe-contract constants
  DIRECTOR_CLASS,
  BG_IMAGE_FLAG_ATTR,
  OSKAR_ID_ATTR,
} from '@/lib/director-css'

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
  /**
   * Which UI surface this preview is mounted in. Tagged on outgoing
   * /api/ask-cd calls so CD knows whether the question came from Gallery,
   * Studio, or Image Mode. Defaults to 'gallery' — the most common host.
   */
  surface?: 'gallery' | 'studio' | 'image'
  /**
   * Ralph 2026-04-23: Fires when the Director's AI Edit pipeline creates
   * a new image file. Hosts mounted inside Advanced Mode wire this to
   * their onImageGenerated so the new asset shows up in the AssetsPanel.
   * Gallery/Studio leave it undefined — there's no asset panel there.
   */
  onImageGenerated?: (image: import('@/lib/types').SourceImage) => void
}

// State types, defaults, pure CSS helpers, and the ElementSnapshot type
// are all imported from `@/lib/director-css` at the top of this file.
// That lib is the shared contract between Studio's CanvasPanel,
// studio-bridge.ts, and this component. Edit helpers in
// lib/director-css.ts, not here.

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
  surface = 'gallery',
  onImageGenerated,
}, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [internalDirectorMode, setInternalDirectorMode] = useState(false)
  const isControlled =
    controlledDirectorMode !== undefined && onDirectorModeChange !== undefined
  const directorMode = isControlled ? (controlledDirectorMode as boolean) : internalDirectorMode
  // Always-fresh ref for directorMode so iframe event handlers can read the
  // latest value without being torn down+rebuilt on every toggle. Handlers
  // are attached once per iframe load; they consult this ref at fire time.
  const directorModeRef = useRef(directorMode)
  directorModeRef.current = directorMode
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
  // Gear overlay: which element is currently being hovered that's a swap
  // target. Gear floats over IMG/bg-image elements; clicking it opens the
  // styling popover.
  const [gearEl, setGearEl] = useState<HTMLElement | null>(null)
  const [gearRect, setGearRect] = useState<{ x: number; y: number } | null>(null)

  // Director-Mode readiness — true once setup() has successfully run with
  // the iframe in a usable state (contentDocument + body + listeners
  // installed). Until true, the UI shows a spinning indicator so the user
  // knows Director Mode is initializing and clicks aren't reliable yet.
  const [directorReady, setDirectorReady] = useState(false)

  // When we restore an element from its snapshot (Undo), we don't want the
  // apply-effects (filter / transform / box / type) to fire and overwrite
  // the restored inline style. This ref gates those effects for one render
  // cycle. Set true → restore → state setters queued → apply effects see
  // the flag and return early → next render flips the flag back to false.
  const skipApplyRef = useRef(false)

  // Anchors we CREATED by wrapping a non-anchor element when the user
  // set a Link. These need to be unwrapped on Undo (distinguished from
  // pre-existing anchors in the page, which we only remove href from).
  const addedAnchorsRef = useRef<WeakSet<HTMLAnchorElement>>(new WeakSet())

  // Hover outline: bounding rect of ANY element the mouse is over. Shows
  // the user which DOM element they'd select if they click. Coordinates in
  // parent-doc space (iframe offset + element rect).
  const [hoverRect, setHoverRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // Selected outline: bounding rect of the currently-selected element (the
  // one loaded into the properties panel). Updates on scroll/resize so the
  // outline tracks the element as the page moves.
  const [selectedRect, setSelectedRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

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
          source: surface,
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
    if (el.tagName === 'A') {
      // null preserves the distinction "no href attribute" vs "empty href"
      snap.href = el.getAttribute('href')
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

  /** Build the edits payload from the current modified-elements set.
   *  Pure — no side effects, no clearing of refs. Used by both the
   *  fetch-based saveAll and the sendBeacon unload fallback. */
  const buildEditsPayload = useCallback((): {
    edits: { selector: string; style?: string; src?: string }[]
    elements: HTMLElement[]
  } => {
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
    return { edits, elements: els }
  }, [])

  const saveAll = useCallback(async () => {
    // Commit: persist every modified element to disk.
    //
    // 2026-04-20 — previously cleared modifiedElsRef BEFORE awaiting the
    // fetch, which meant a network failure silently dropped the user's
    // edits (snapshots gone → can't retry). Now we clear ONLY on success,
    // so a failure leaves the edits in place for the next save attempt.
    // Text edits already persist via /api/director/text-edit on blur; this
    // pass handles image swaps + inline styling.
    const { edits, elements } = buildEditsPayload()
    if (edits.length === 0 || !sessionId || !pageFilename) {
      // No pending edits (or no session) — nothing to persist. Safe to
      // clear the modified set now.
      modifiedElsRef.current.clear()
      snapshotsRef.current = new WeakMap()
      return
    }

    try {
      const res = await fetch('/api/director/save-edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, pageFilename, edits }),
        // Keep the request alive if the page is being unloaded. Chrome/Edge
        // honor this; Safari/Firefox mostly do. For hard unload we still
        // want sendBeacon (see saveAllBeacon).
        keepalive: true,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = `${edits.length} edit${edits.length === 1 ? '' : 's'} failed to save`
        console.warn('[save-edits] Server rejected:', body)
        if (sessionId) emitError(sessionId, msg)
        // DO NOT clear — user retains the edits for a retry.
        return
      }
      const result = await res.json()
      const failed = (result.results || []).filter((r: { ok: boolean }) => !r.ok)
      if (failed.length > 0) {
        const msg = `${failed.length} of ${edits.length} edits failed to save`
        console.warn('[save-edits] Some edits failed:', failed)
        if (sessionId) emitError(sessionId, msg)
        // Partial failure — leave modifiedEls intact so the user can retry.
        // Could refine to drop only the successful ones, but safer to retry
        // the whole batch since the server is idempotent.
        return
      }
      // Success — now it's safe to clear.
      modifiedElsRef.current.clear()
      snapshotsRef.current = new WeakMap()
      // Also clear the in-memory text snapshots, if any remain
      for (const el of elements) void el
    } catch (err) {
      console.warn('[save-edits] Network error:', err)
      if (sessionId) emitError(sessionId, 'Save failed — no network. Your changes are still here; try again.')
      // Network failure — keep edits for retry on next save.
    }
  }, [sessionId, pageFilename, buildEditsPayload])

  /** sendBeacon-based save for page-unload scenarios.
   *
   *  Fetch (even with keepalive: true) is NOT guaranteed to complete
   *  during `beforeunload` or `pagehide` — Safari and Firefox in
   *  particular will kill it. `navigator.sendBeacon` is the only API
   *  that guarantees the POST survives the browser's tab-close kill.
   *
   *  Trade-offs: sendBeacon is fire-and-forget. We can't observe the
   *  server's response, so we optimistically clear the modified set.
   *  Acceptable for unload (by definition, the user is leaving). */
  const saveAllBeacon = useCallback(() => {
    if (!sessionId || !pageFilename) return
    const { edits } = buildEditsPayload()
    if (edits.length === 0) return
    try {
      const body = JSON.stringify({ sessionId, pageFilename, edits })
      const blob = new Blob([body], { type: 'application/json' })
      const ok = navigator.sendBeacon?.('/api/director/save-edits', blob) ?? false
      if (ok) {
        modifiedElsRef.current.clear()
        snapshotsRef.current = new WeakMap()
      }
    } catch (err) {
      console.warn('[save-edits beacon] Failed to enqueue:', err)
    }
  }, [sessionId, pageFilename, buildEditsPayload])

  // Default on component unmount (user navigates away, switches panes, etc.)
  // is COMMIT — fire saveAll() so pending edits land on disk before unmount.
  // Use a ref so the cleanup doesn't capture a stale saveAll closure.
  const saveAllRef = useRef(saveAll)
  saveAllRef.current = saveAll
  const saveAllBeaconRef = useRef(saveAllBeacon)
  saveAllBeaconRef.current = saveAllBeacon
  useEffect(() => {
    return () => {
      // Best-effort: fire and forget. Browser will keep the request alive
      // even after the React tree unmounts (fetch is window-scoped).
      saveAllRef.current()
    }
  }, [])

  // Save-on-leave: catch tab close, window close, tab backgrounding, and
  // SPA-like navigations away. Fetch won't survive browser unload in all
  // browsers, so beforeunload/pagehide use sendBeacon for reliability.
  // visibilitychange catches "user tabbed away and then closed the tab
  // later" — at the moment of backgrounding, we commit whatever's pending.
  useEffect(() => {
    function onBeforeUnload() {
      if (modifiedElsRef.current.size > 0) {
        saveAllBeaconRef.current()
      }
    }
    function onPageHide() {
      // pagehide fires more reliably than beforeunload on mobile Safari
      // and for bfcache transitions. Dual-binding is belt-and-suspenders.
      if (modifiedElsRef.current.size > 0) {
        saveAllBeaconRef.current()
      }
    }
    function onVisibilityChange() {
      // Tab switched to another / minimized / device locked. Commit now
      // because the user may never return to click "save" explicitly.
      if (document.visibilityState === 'hidden' && modifiedElsRef.current.size > 0) {
        // fetch with keepalive is reliable here (we're not unloading yet).
        void saveAllRef.current()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
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
      // Do NOT mutate opacity here (Ralph 2026-04-23). The previous
      // "fade-out → fade-in" animation clobbered any custom opacity the
      // user set via the Box panel, and if the new image URL was already
      // cached the `load` event sometimes didn't fire — leaving the
      // element stuck at 0.3. The right signal for "busy" is an outer UI
      // indicator (button spinner, gear highlight), not the image's own
      // opacity which is a user-editable style.
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

  // ───────────────────────────────────────────────────────────────────────
  // AI Edit (Ralph 2026-04-23)
  // ───────────────────────────────────────────────────────────────────────
  // User clicks an image in Director Mode → types in the popover's AI box →
  // CD refines the prompt → Nano Banana runs the edit → result swaps into
  // the clicked element. Two-hop pipeline: /api/ask-cd → /api/edit-image.
  // CD's refined prompt is routed through the same `## IMAGE PROMPT` parser
  // Advanced Mode uses (tier 1 or 2 wins). If CD replies conversationally
  // (tier 5, no IMAGE PROMPT block), we fall back to the user's raw text +
  // a note — rather than failing closed — so the edit still fires.
  const [aiEditBusy, setAIEditBusy] = useState(false)

  /** Extract the source path that /api/edit-image can resolve. For IMG
   *  elements this is the `src` attribute stripped of origin + query.
   *  For bg-image elements we parse the `url()` out of computed style.
   *  Returns null when we can't produce a usable path. */
  const getSourcePathForEditImage = useCallback((el: HTMLElement): string | null => {
    if (el.tagName === 'IMG') {
      const raw = (el as HTMLImageElement).getAttribute('src') || (el as HTMLImageElement).src
      if (!raw) return null
      try {
        // Strip origin if absolute; strip any cache-bust query string.
        const u = raw.startsWith('http') ? new URL(raw).pathname : raw
        return u.split('?')[0]
      } catch {
        return null
      }
    }
    // bg-image fallback: pull the first url() out of computed style.
    const bg = window.getComputedStyle(el).backgroundImage
    const m = bg.match(/url\((['"]?)([^'")]+)\1\)/)
    if (!m) return null
    const raw = m[2]
    try {
      const u = raw.startsWith('http') ? new URL(raw).pathname : raw
      return u.split('?')[0]
    } catch {
      return null
    }
  }, [])

  const handleAIEditImage = useCallback(
    async (el: HTMLElement, userText: string) => {
      const text = userText.trim()
      if (!text || aiEditBusy) return
      // Defensive — in practice the popover only exposes `onAIEdit` when a
      // sessionId exists (see the StylingPopover mount below). If someone
      // mounts this without a session there's no bridge to reach, so we
      // log and return instead of routing through the error channel that
      // itself needs a sessionId.
      if (!sessionId) {
        console.warn('[director] AI Edit requested without a session — ignoring')
        return
      }
      const srcPath = getSourcePathForEditImage(el)
      if (!srcPath) {
        emitError(sessionId, 'Cannot read source image for AI edit.')
        return
      }
      const filename = srcPath.split('/').pop() || 'image'

      setAIEditBusy(true)
      try {
        // Step 1 — CD reviews + writes a Nano-ready prompt.
        const cdRes = await fetch('/api/ask-cd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: surface,
            mode: 'edit',
            image: { filename, description: '' },
            currentPrompt: text,
            userMessage:
              `Refine my edit intent below into a ready-to-fire Nano Banana ` +
              `edit instruction for ${filename}. Return the refined prompt ` +
              `inside a \`## IMAGE PROMPT\` block so it can be sent to Nano ` +
              `as-is. My intent: ${text}`,
            sessionId,
          }),
        })
        if (!cdRes.ok) {
          const body = await cdRes.json().catch(() => ({}))
          emitError(sessionId, `CD review failed: ${body.error || cdRes.status}`)
          return
        }
        const cd = await cdRes.json()
        // Tier 1/2 = CD explicitly committed a `## IMAGE PROMPT`. Otherwise
        // fall back to the user's raw text so the edit still fires (with
        // any CD feedback appended as context, not as a prompt).
        const refined =
          cd.imagePrompt && (cd.tier === 1 || cd.tier === 2)
            ? (cd.imagePrompt as string)
            : text

        // Build a filename hint from the user's intent + the source name.
        // Same idea as AdvancedMode.handleGenerate's hint — keeps the
        // semantic context the user actually cares about (what they asked
        // for + which image), not whatever camera vocabulary Nano leads
        // its description with. Cap intent at 3 words so names stay sane.
        const intentSlug = text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join('-')
        const sourceBase = filename.replace(/\.[^/.]+$/, '')
        const filenameHint =
          intentSlug ? `${intentSlug}-${sourceBase}` : sourceBase

        // Step 2 — Nano Banana runs the edit.
        const editRes = await fetch('/api/edit-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceImagePaths: [srcPath],
            instruction: refined,
            operation: 'edit',
            mode: 'edit',
            sessionId,
            filename: filenameHint,
          }),
        })
        if (!editRes.ok) {
          const body = await editRes.json().catch(() => ({}))
          emitError(sessionId, `Nano Banana failed: ${body.error || editRes.status}`)
          return
        }
        const edit = await editRes.json()
        const savedPath: string | null = edit.savedPath || null
        const savedFilename: string | null = edit.filename || null
        if (!savedPath) {
          emitError(sessionId, 'Nano Banana returned no image file.')
          return
        }

        // Step 3 — swap the clicked element to the new result. Cache-bust
        // so the browser doesn't show the stale image if the filename
        // collides with a prior edit.
        swapImage(el, savedPath + cacheBustSuffixFromLib())

        // Step 4 — surface the new file to the host's AssetsPanel (when
        // mounted inside Advanced Mode). Without this the newly created
        // image only lives inside the iframe; it wouldn't appear in Zone
        // 1 until a full session reload. Hosts without an asset panel
        // (Gallery/Studio) leave onImageGenerated undefined and this is
        // a no-op.
        if (onImageGenerated && savedFilename) {
          const newImage: import('@/lib/types').SourceImage = {
            id: `dir-edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            filename: savedFilename,
            path: savedPath,
            uploadedAt: new Date().toISOString(),
            isGenerated: true,
            sourcePrompt: refined,
            parentImage: filename,
            generationMode: 'edit',
            analysis: edit.geminiText
              ? {
                  elements: [],
                  description: edit.geminiText as string,
                  suggestedExtractions: [],
                }
              : undefined,
          }
          onImageGenerated(newImage)
        }

        emitCDComment(sessionId, {
          content: `✓ AI edited ${filename}`,
          source: 'director-popover',
        })
      } catch (err) {
        emitError(
          sessionId,
          `AI edit failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        setAIEditBusy(false)
      }
    },
    [aiEditBusy, sessionId, surface, swapImage, getSourcePathForEditImage, onImageGenerated],
  )

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
      // Interpolate the shared constants so these selectors can never drift
      // from what tagBgImages / the setup code actually writes to the DOM.
      const hostSel = `html.${DIRECTOR_CLASS}`
      const bgSel = `[${BG_IMAGE_FLAG_ATTR}="1"]`
      s.textContent = `
        ${hostSel} body { cursor: text; }

        /* Force pointer-events AUTO on every real DOM element so the user
           can click into deeply nested inner elements (e.g. a <p> inside a
           <section> inside a <div>). Vibes often have CSS that disables
           pointer-events on inner nodes (for hover effects, overlays) —
           that prevents click-to-select from reaching them. Director Mode
           overrides this so every element is selectable. */
        ${hostSel} * { pointer-events: auto !important; }

        /* But NEVER let a ::before/::after pseudo-element intercept clicks.
           Many design systems use absolute-positioned pseudo-elements as
           decorative overlays (gradients, corner brackets, scanlines). If
           those catch clicks, the user can never select the real DOM
           element beneath. Pseudo-elements are decoration; clicks should
           always fall through to the real DOM. */
        ${hostSel} *::before,
        ${hostSel} *::after { pointer-events: none !important; }

        ${hostSel} img,
        ${hostSel} ${bgSel} {
          outline: 2px dashed rgba(16,185,129,0.35);
          outline-offset: 2px;
          transition: outline 0.12s, filter 0.12s;
        }
        ${hostSel} img:hover,
        ${hostSel} ${bgSel}:hover {
          outline: 2px solid rgba(16,185,129,0.85);
        }
      `
      doc.head?.appendChild(s)
    }

    function tagBgImages(doc: Document) {
      // Mark every element that actually has a background-image URL so the
      // CSS selector can find them. We re-check on every setup (in case
      // the vibe page loaded images lazily after first render).
      doc.querySelectorAll(`[${BG_IMAGE_FLAG_ATTR}]`).forEach((el) =>
        el.removeAttribute(BG_IMAGE_FLAG_ATTR)
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
        el.setAttribute(BG_IMAGE_FLAG_ATTR, '1')
      })
    }

    // RAF-batched hover state — 20+/sec mouseover events would trigger a
    // React render each, causing noticeable jank on dense vibes. We store
    // the latest target in a ref and commit it to state once per frame.
    let pendingHoverTarget: HTMLElement | null = null
    let rafHandle: number | null = null
    function flushHover() {
      rafHandle = null
      const t = pendingHoverTarget
      const currentDoc = iframeEl?.contentDocument
      const iframeRect = iframeEl?.getBoundingClientRect()
      if (!iframeRect) return

      if (!t || t === currentDoc?.documentElement || t === currentDoc?.body) {
        setHoverRect(null)
      } else {
        const rect = t.getBoundingClientRect()
        setHoverRect({
          x: iframeRect.left + rect.left,
          y: iframeRect.top + rect.top,
          w: rect.width,
          h: rect.height,
        })
      }

      // Gear — same RAF-batched path. Only updates when target is an
      // image-capable swap target.
      const swap = t ? findSwapTarget(t) : null
      if (!swap) {
        setGearEl(null)
        return
      }
      const rect = swap.getBoundingClientRect()
      setGearEl(swap)
      setGearRect({
        x: iframeRect.left + rect.left + rect.width / 2,
        y: iframeRect.top + rect.top + rect.height / 2,
      })
    }

    function onMouseOver(e: MouseEvent) {
      if (!directorModeRef.current) return
      const t = e.target as HTMLElement | null
      if (!t) return
      pendingHoverTarget = t
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(flushHover)
      }
    }

    function onMouseLeave() {
      // Clear hover outline + gear when the mouse leaves the iframe.
      // Prevents "stuck" outlines when user moves to the panel.
      pendingHoverTarget = null
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle)
        rafHandle = null
      }
      setHoverRect(null)
      setGearEl(null)
    }

    function onClick(e: MouseEvent) {
      if (!directorModeRef.current) return
      const t = e.target as HTMLElement | null
      if (!t) return

      const currentDoc = iframeEl?.contentDocument
      // Skip <html> and <body> — they represent the page canvas, not a
      // meaningful styling target. Leave the current selection intact.
      if (t === currentDoc?.documentElement || t === currentDoc?.body) return

      // ALWAYS select the clicked element into the properties panel — this
      // is what lets the user edit text, heading, paragraph, or any
      // container's Box/Type properties. We snapshot then set target
      // unconditionally; we do NOT preventDefault here for non-IMG clicks
      // so contentEditable keeps placing the caret and typing keeps working.
      try {
        snapshotElement(t)
        // Also snapshot the ancestor <a> if one exists. The Link property
        // in the Box panel edits the ancestor anchor (not the selected
        // descendant), so Undo needs the anchor's original href.
        if (typeof t.closest === 'function') {
          const anchor = t.closest('a')
          if (anchor && anchor !== t) snapshotElement(anchor as HTMLElement)
        }
      } catch (err) {
        console.warn('[director] snapshotElement failed:', err)
      }
      setStyleTarget(t)

      // SECONDARY: IMG clicks do the existing Zone-1 swap flow. This is
      // additive — the panel still shows the image's properties, AND the
      // swap happens. preventDefault is only called here because we're
      // intercepting the image click.
      if (t.tagName === 'IMG') {
        const swap = t
        if (zone1SelectedImage) {
          e.preventDefault()
          e.stopPropagation()
          const url = `/${zone1SelectedImage.sessionId}/${zone1SelectedImage.filename}`
          swapImage(swap, url)
          if (sessionId && pageFilename) {
            onSlotSwapped?.({
              sessionId,
              pageFilename,
              slot: `img:${(swap as HTMLImageElement).src}`,
              newImage: zone1SelectedImage.filename,
            })
          }
          return
        }

        // Fallback: no Zone 1 selection → open the picker modal
        if (sessionId && pageFilename) {
          e.preventDefault()
          e.stopPropagation()
          const src = (swap as HTMLImageElement).src
          setStudioTarget({
            pageFilename,
            slot: `img:${src}`,
            humanLabel: humanizeSlot(`img:${src}`),
            currentImage: src,
            context: null,
          })
        }
      }
      // For non-IMG clicks, we intentionally DO NOT preventDefault or
      // stopPropagation. This lets contentEditable's native click→caret
      // behavior continue to work, so typing still edits text.
    }

    function onFocusIn(e: FocusEvent) {
      if (!directorModeRef.current) return
      const t = e.target as HTMLElement | null
      if (!t) return
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
      snapshotElement(t)
      if (!sessionId || !pageFilename) return
      let oskarId = t.getAttribute(OSKAR_ID_ATTR)
      if (!oskarId) {
        oskarId = buildStablePath(t)
        t.setAttribute(OSKAR_ID_ATTR, oskarId)
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
      // Body must exist too — without it we can't apply contentEditable
      // and the page isn't really usable yet.
      if (!d.body) return

      // Idempotency guard — the effect registers setup on THREE signals
      // (load, DOMContentLoaded, readystatechange) so we never miss the
      // ready window. But if the iframe is already loaded when the effect
      // runs, multiple signals can fire in quick succession and setup()
      // would install listeners twice (addEventListener with the same
      // function ref is deduped, but cleanup assumed single-install).
      // The dataset flag makes setup() safe to call N times.
      if (d.documentElement.dataset.oskarSetupDone === '1') {
        // Still re-apply director-mode class + contentEditable in case
        // directorModeRef.current changed between calls; that part IS
        // idempotent and must stay in sync.
        d.documentElement.classList.toggle(DIRECTOR_CLASS, directorModeRef.current)
        if (directorModeRef.current) {
          d.body.setAttribute('contenteditable', 'true')
          d.body.setAttribute('spellcheck', 'false')
        } else {
          d.body.removeAttribute('contenteditable')
          d.body.removeAttribute('spellcheck')
        }
        setDirectorReady(true)
        return
      }
      d.documentElement.dataset.oskarSetupDone = '1'

      installStyles(d)
      tagBgImages(d)
      // Re-apply director mode state on setup so iframe reloads / hot
      // reloads / initial-mount-before-iframe-loads all end up in the same
      // state without the user needing to toggle Director off/on.
      d.documentElement.classList.toggle(DIRECTOR_CLASS, directorModeRef.current)
      if (directorModeRef.current) {
        d.body.setAttribute('contenteditable', 'true')
        d.body.setAttribute('spellcheck', 'false')
      } else {
        d.body.removeAttribute('contenteditable')
        d.body.removeAttribute('spellcheck')
      }
      d.addEventListener('mouseover', onMouseOver, true)
      d.addEventListener('click', onClick, true)
      d.addEventListener('focusin', onFocusIn, true)
      d.addEventListener('focusout', onFocusOut, true)
      // mouseleave on the doc fires when the cursor exits the iframe —
      // clears stuck hover outlines / gear overlays.
      d.addEventListener('mouseleave', onMouseLeave, true)
      // Mark the preview as READY for Director Mode interaction. The
      // spinning-gear overlay flips off and clicks become reliable.
      setDirectorReady(true)
    }
    function teardown() {
      setDirectorReady(false)
      const d = iframeEl?.contentDocument
      if (!d) return
      // Clear the idempotency flag so the next effect run can re-install.
      delete d.documentElement.dataset.oskarSetupDone
      d.removeEventListener('mouseover', onMouseOver, true)
      d.removeEventListener('click', onClick, true)
      d.removeEventListener('focusin', onFocusIn, true)
      d.removeEventListener('focusout', onFocusOut, true)
      d.removeEventListener('mouseleave', onMouseLeave, true)
    }

    // Try setup on multiple ready-state signals so we NEVER miss the window
    // where the iframe becomes usable. `readystatechange` fires on every
    // document-state transition (loading → interactive → complete), and
    // `DOMContentLoaded` + `load` catch the typical transitions. setup() is
    // idempotent: it won't double-install styles or listeners.
    if (doc?.readyState === 'complete' || doc?.readyState === 'interactive') setup()
    iframeEl.addEventListener('load', setup)
    doc?.addEventListener('DOMContentLoaded', setup)
    doc?.addEventListener('readystatechange', setup)
    return () => {
      iframeEl.removeEventListener('load', setup)
      doc?.removeEventListener('DOMContentLoaded', setup)
      doc?.removeEventListener('readystatechange', setup)
      teardown()
    }
    // directorMode is in the deps so that toggling it forces setup to
    // re-run on the current (guaranteed-ready) iframe, applying state
    // authoritatively without depending on the separate directorMode
    // effect hitting an iframe that might not be ready yet.
  }, [htmlPath, directorMode, findSwapTarget, swapImage, zone1SelectedImage, sessionId, pageFilename, onSlotSwapped, snapshotElement])

  // Save-on-toggle-off. This is the ONLY job of this effect now — the
  // class + contentEditable application is handled by setup() above, which
  // is guaranteed to re-run on directorMode changes (via deps). This effect
  // only fires on the TRANSITION from true → false to persist changes.
  const prevDirectorModeRef = useRef(directorMode)
  useEffect(() => {
    const prev = prevDirectorModeRef.current
    prevDirectorModeRef.current = directorMode
    // Only act on the transition true → false (a real "turn off" event).
    if (prev === true && directorMode === false) {
      void saveAllRef.current()
      setGearEl(null)
      setStyleTarget(null)
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

  // Track the SELECTED element's bounding rect (for the "selected" outline).
  // Updates on scroll, resize, and when the element itself resizes.
  //
  // 2026-04-20 — uses a ref-based teardown pattern so we ALWAYS clean up
  // the prior observer/listeners at the start of each effect run, before
  // deciding whether to install new ones. Previously the early-return
  // path (directorMode=false or styleTarget=null) relied on React's
  // automatic cleanup of the previous effect — which it does, but
  // depending on that contract makes the teardown implicit. The ref
  // pattern is explicit and survives any edge case where the prior
  // cleanup might be skipped (e.g. StrictMode double-invoke, bailouts).
  const selectedRectTeardownRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    // Tear down anything from the previous run FIRST, unconditionally.
    selectedRectTeardownRef.current?.()
    selectedRectTeardownRef.current = null

    if (!directorMode || !styleTarget) {
      setSelectedRect(null)
      return
    }
    const frame = iframeRef.current
    const iframeDoc = frame?.contentDocument
    if (!frame || !iframeDoc) return

    function update() {
      const el = styleTarget
      const f = frame
      if (!el || !f) return
      const iframeRect = f.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      setSelectedRect({
        x: iframeRect.left + rect.left,
        y: iframeRect.top + rect.top,
        w: rect.width,
        h: rect.height,
      })
    }
    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(styleTarget)
    iframeDoc.addEventListener('scroll', update, true)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)

    const teardown = () => {
      ro?.disconnect()
      iframeDoc.removeEventListener('scroll', update, true)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
    selectedRectTeardownRef.current = teardown
    return teardown
  }, [directorMode, styleTarget])

  // (Text persistence is handled by the focusin/focusout handlers in the
  // iframe setup effect — contentEditable's native blur event triggers
  // /api/director/text-edit. No separate deselect-persistence needed.)

  // ───────────────────────────────────────────────────────────────────────
  // Styling popover: apply filter/transform changes inline
  // ───────────────────────────────────────────────────────────────────────

  const [filterState, setFilterState] = useState<FilterState>(defaultFilters)
  const [transformState, setTransformState] = useState<TransformState>(defaultTransform)
  const [boxState, setBoxState] = useState<BoxState>(defaultBox)
  const [typeState, setTypeState] = useState<TypeState>(defaultType)

  // Initialize panel state when a new element is targeted. Filter/transform
  // always reset to defaults (they don't round-trip from element since the
  // vibe's own transforms aren't our editing concern). Box/type DO read the
  // element's current state so the inspector shows current values.
  useEffect(() => {
    if (!styleTarget) return
    // Snapshot before any styling change
    snapshotElement(styleTarget)
    setFilterState(defaultFilters)
    setTransformState(defaultTransform)
    setBoxState(readBoxFromElement(styleTarget))
    setTypeState(readTypeFromElement(styleTarget))
  }, [styleTarget, snapshotElement])

  // Apply filter whenever filterState changes
  useEffect(() => {
    if (!styleTarget) return
    if (skipApplyRef.current) return
    const f = buildFilterString(filterState)
    styleTarget.style.filter = f
  }, [filterState, styleTarget])

  // Apply transform + fit + position + radius whenever transformState changes
  useEffect(() => {
    if (!styleTarget) return
    if (skipApplyRef.current) return
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

  // Apply box (opacity, size, padding, margin, radius, fill) whenever boxState changes
  useEffect(() => {
    if (!styleTarget) return
    if (skipApplyRef.current) return
    const s = styleTarget.style
    s.opacity = boxState.opacity === 1 ? '' : String(boxState.opacity)

    // Width / height — null clears the inline declaration so the element
    // falls back to its natural/flow size. A non-null SizeDim writes
    // `Npx` or `N%`. (Size field added Ralph 2026-04-23.)
    s.width = serializeSizeDim(boxState.width)
    s.height = serializeSizeDim(boxState.height)

    // Padding — use shorthand when unified, 4-value form when asymmetric.
    // Clear individual-side props first so shorthand isn't double-applied.
    s.paddingTop = ''; s.paddingRight = ''; s.paddingBottom = ''; s.paddingLeft = ''
    if (spacingIsZero(boxState.padding)) {
      s.padding = ''
    } else {
      s.padding = serializeQuad(boxState.padding)
    }

    s.marginTop = ''; s.marginRight = ''; s.marginBottom = ''; s.marginLeft = ''
    if (spacingIsZero(boxState.margin)) {
      s.margin = ''
    } else {
      s.margin = serializeQuad(boxState.margin)
    }

    // Border-radius — same shorthand vs. 4-corner serialization logic.
    s.borderTopLeftRadius = ''; s.borderTopRightRadius = ''
    s.borderBottomRightRadius = ''; s.borderBottomLeftRadius = ''
    if (radiusIsZero(boxState.radius)) {
      // Only clear if the transform panel's radius (which uses %) isn't active
      if (!(transformState.radius > 0)) s.borderRadius = ''
    } else {
      s.borderRadius = serializeRadius(boxState.radius)
    }

    if (boxState.fill === null) {
      s.backgroundColor = ''
    } else {
      s.backgroundColor = boxState.fill
    }

    // Href — universal Link behavior (per Ralph 2026-04-20):
    //   - If the element is already in an anchor chain: edit that anchor.
    //   - If not, and user set a link: WRAP the element in a new <a>.
    //   - Setting href to null/empty on a wrapper we added: unwrap.
    //   - Setting href to null/empty on a pre-existing anchor: just
    //     remove the attribute (don't unwrap — user might re-add later).
    const existingAnchor = styleTarget.closest('a') as HTMLAnchorElement | null
    const wantLink = boxState.href !== null && boxState.href !== ''

    if (existingAnchor && wantLink) {
      // Update the existing anchor (either styleTarget itself or an ancestor).
      existingAnchor.setAttribute('href', boxState.href!)
    } else if (existingAnchor && !wantLink) {
      if (addedAnchorsRef.current.has(existingAnchor)) {
        // We added this wrapper — unwrap on "none" so the DOM returns to
        // its pre-link state.
        const parent = existingAnchor.parentNode
        if (parent) {
          while (existingAnchor.firstChild) {
            parent.insertBefore(existingAnchor.firstChild, existingAnchor)
          }
          parent.removeChild(existingAnchor)
        }
        addedAnchorsRef.current.delete(existingAnchor)
      } else {
        // Pre-existing anchor — just strip the href attribute.
        existingAnchor.removeAttribute('href')
      }
    } else if (!existingAnchor && wantLink) {
      // No anchor in chain → wrap the styleTarget in a new <a>.
      // Don't wrap <html>, <body>, or any void elements; they'd break.
      if (
        styleTarget.tagName !== 'HTML' &&
        styleTarget.tagName !== 'BODY' &&
        styleTarget.tagName !== 'A'
      ) {
        const doc = styleTarget.ownerDocument
        if (doc) {
          const wrap = doc.createElement('a') as HTMLAnchorElement
          wrap.href = boxState.href!
          const parent = styleTarget.parentNode
          if (parent) {
            parent.insertBefore(wrap, styleTarget)
            wrap.appendChild(styleTarget)
            addedAnchorsRef.current.add(wrap)
            // Snapshot the wrapper so we can track it for undo + save.
            snapshotsRef.current.set(wrap, { style: '' })
            modifiedElsRef.current.add(wrap)
          }
        }
      }
    }
    // (existing anchor = null AND wantLink = false) → no-op, consistent state.
  }, [boxState, styleTarget, transformState.radius])

  // Apply typography whenever typeState changes
  useEffect(() => {
    if (!styleTarget) return
    if (skipApplyRef.current) return
    const s = styleTarget.style
    const t = typeState
    s.fontFamily = t.fontFamily
      ? (t.fontFamily.includes(' ') ? `"${t.fontFamily}"` : t.fontFamily)
      : ''
    s.fontSize = t.fontSize ? `${t.fontSize.value}${t.fontSize.unit}` : ''
    s.fontWeight = t.fontWeight !== null ? String(t.fontWeight) : ''
    s.color = t.color || ''
    s.textAlign = t.textAlign || ''
    s.lineHeight = t.lineHeight !== null ? String(t.lineHeight) : ''
    s.letterSpacing = t.letterSpacing ? `${t.letterSpacing.value}${t.letterSpacing.unit}` : ''
  }, [typeState, styleTarget])

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
            <button
              onClick={revertAll}
              title="Undo every edit since Edit HTML was turned on"
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
          )}
          <button
            type="button"
            aria-pressed={directorMode}
            aria-label={directorMode ? 'Disable Edit HTML mode' : 'Enable Edit HTML mode'}
            onClick={() => setDirectorMode((m) => !m)}
            style={{
              // The iframe backdrop is always white regardless of theme
              // (Onyx/Polar), so the button sits on white in both modes.
              // OFF = green CTA ("click to start editing"); ON = recessed
              // white with a visible border so it doesn't vanish against
              // the white backdrop.
              padding: '8px 12px',
              borderRadius: 8,
              border: directorMode
                ? '1px solid #cbd5e1'
                : '1px solid var(--success)',
              background: directorMode ? '#ffffff' : 'var(--success)',
              color: directorMode ? '#0f172a' : '#ffffff',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {/* Feather edit-3 — pencil on baseline */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Edit HTML
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

      {/* DIRECTOR-MODE INITIALIZING overlay — shown when directorMode was
          just turned ON but setup() hasn't completed yet (iframe still
          hydrating, body not yet available, listeners not attached).
          Prevents the "is it working?" uncertainty — user sees the
          spinning gear and knows to wait a moment. Disappears the instant
          setup() finishes and the preview is fully interactive. */}
      {directorMode && !directorReady && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 50,
            padding: '8px 14px',
            borderRadius: 20,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: 'oskar-spin 1s linear infinite' }}
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <style>{`@keyframes oskar-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          Preparing Director Mode…
        </div>
      )}

      {/* HOVER outline — the bounding box of the element the cursor is
          currently over. Shows the user WHICH DOM element they'd select
          if they click now. `pointer-events: none` so it doesn't intercept
          clicks on the element beneath. Hidden when hovering the selected
          element (no need to show two outlines on the same element). */}
      {directorMode && directorReady && hoverRect && styleTarget !== gearEl && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: hoverRect.x,
            top: hoverRect.y,
            width: hoverRect.w,
            height: hoverRect.h,
            pointerEvents: 'none',
            zIndex: 38,
            outline: '1px dashed rgba(124, 77, 255, 0.5)',
            outlineOffset: -1,
          }}
        />
      )}

      {/* SELECTED outline — persistent outline around the element currently
          loaded into the properties panel. Stays visible so the user always
          knows which element their edits are affecting. */}
      {directorMode && directorReady && styleTarget && selectedRect && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: selectedRect.x - 2,
            top: selectedRect.y - 2,
            width: selectedRect.w + 4,
            height: selectedRect.h + 4,
            pointerEvents: 'none',
            zIndex: 39,
            outline: '2px solid var(--accent, #7c4dff)',
            outlineOffset: 0,
            boxShadow: '0 0 0 4px rgba(124, 77, 255, 0.12)',
            borderRadius: 2,
          }}
        />
      )}

      {/* Gear icon — centered over the hovered swap target. Rendered in parent
          document so it's above the iframe. */}
      {directorMode && directorReady && gearEl && gearRect && (
        <button
          type="button"
          aria-label="Open image styling options"
          style={{
            position: 'fixed',
            left: gearRect.x - 22,
            top: gearRect.y - 22,
            width: 44,
            height: 44,
            borderRadius: 22,
            border: 'none',
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
            padding: 0,
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
        </button>
      )}

      {/* Styling popover */}
      {directorMode && directorReady && styleTarget && (
        <StylingPopover
          targetTag={styleTarget.tagName}
          isText={isTextElement(styleTarget)}
          isImage={
            styleTarget.tagName === 'IMG' ||
            styleTarget.hasAttribute(BG_IMAGE_FLAG_ATTR)
          }
          isAnchor={!!styleTarget.closest('a')}
          availableFonts={discoverFontsOnPage(iframeRef.current?.contentDocument)}
          availableWeights={discoverWeightsForFont(iframeRef.current?.contentDocument, typeState.fontFamily)}
          availableLinks={discoverLinksOnPage(iframeRef.current?.contentDocument)}
          textContent={styleTarget.textContent || ''}
          isTextLeaf={isTextLeafElement(styleTarget)}
          onTextChange={(next) => {
            // Live write to the DOM so the user sees their edits immediately.
            // Snapshot was already taken on select — revert restores it.
            // Persist happens via /api/director/text-edit on deselect (Director
            // OFF or selecting a different element triggers a save from the
            // effect below).
            //
            // CRITICAL (Ralph 2026-04-23): refuse to write textContent on a
            // container with element children. `.textContent = x` replaces
            // EVERY child with a single text node — setting it on a <section>
            // that holds 4 paragraphs obliterates all four. The Text tab
            // should already be hidden for containers via `isTextLeaf`, but
            // this guard is the load-bearing belt to that suspender.
            if (!styleTarget) return
            if (!isTextLeafElement(styleTarget)) {
              console.warn(
                '[director] Refusing to overwrite textContent on a container — would wipe children',
                styleTarget,
              )
              return
            }
            styleTarget.textContent = next
          }}
          computedSize={readComputedSize(styleTarget)}
          filterState={filterState}
          onFilterChange={setFilterState}
          transformState={transformState}
          onTransformChange={setTransformState}
          boxState={boxState}
          onBoxChange={setBoxState}
          typeState={typeState}
          onTypeChange={setTypeState}
          onClose={() => setStyleTarget(null)}
          onSelectParent={
            styleTarget.parentElement &&
            styleTarget.parentElement !== styleTarget.ownerDocument?.body
              ? () => {
                  const parent = styleTarget.parentElement
                  if (parent) {
                    snapshotElement(parent)
                    setStyleTarget(parent)
                  }
                }
              : undefined
          }
          onReset={() => {
            // Undo flow:
            //   1. Restore the element's inline style attribute to what it
            //      was when the popover first opened (from the snapshot).
            //   2. Re-read box/type state off the restored element so the
            //      inspector inputs reflect the true restored state.
            //   3. Prevent the apply-effects from firing this render —
            //      otherwise they'd immediately overwrite the restored
            //      inline styles with our re-read state (effectively
            //      UN-undoing the undo). The skipApplyRef gate causes
            //      each apply effect to short-circuit, then we clear the
            //      flag after the current render cycle via requestAnimationFrame.
            skipApplyRef.current = true

            // First: if the element is currently wrapped in an anchor we
            // ADDED (via the universal Link feature), unwrap it. Pre-existing
            // anchors from the page are left alone — we'll just restore
            // their href attribute via the snapshot below.
            const currentParent = styleTarget.parentElement
            if (
              currentParent &&
              currentParent.tagName === 'A' &&
              addedAnchorsRef.current.has(currentParent as HTMLAnchorElement)
            ) {
              const wrap = currentParent
              const grandparent = wrap.parentNode
              if (grandparent) {
                while (wrap.firstChild) {
                  grandparent.insertBefore(wrap.firstChild, wrap)
                }
                grandparent.removeChild(wrap)
              }
              addedAnchorsRef.current.delete(wrap as HTMLAnchorElement)
            }

            const snap = snapshotsRef.current.get(styleTarget)
            if (snap) {
              if (snap.style) styleTarget.setAttribute('style', snap.style)
              else styleTarget.removeAttribute('style')
              // If the element was an IMG and its src was changed, restore that too
              if (snap.src && styleTarget.tagName === 'IMG') {
                (styleTarget as HTMLImageElement).src = snap.src
              }
              // Restore href on anchors. Distinguish "no href attribute"
              // (snap.href === null) from "empty href" (snap.href === '').
              if (styleTarget.tagName === 'A' && 'href' in snap) {
                if (snap.href === null) {
                  styleTarget.removeAttribute('href')
                } else {
                  styleTarget.setAttribute('href', snap.href)
                }
              }
              // Restore the original inner HTML (captures text edits + any
              // decorative children that may have been touched).
              if (typeof snap.innerHtml === 'string' && styleTarget.innerHTML !== snap.innerHtml) {
                styleTarget.innerHTML = snap.innerHtml
              }
            }

            // Also restore any ancestor anchor's href from its own snapshot.
            // (User may have edited an ancestor's href while the descendant
            // was the selected element.)
            const ancestorAnchor = styleTarget.closest('a') as HTMLAnchorElement | null
            if (ancestorAnchor && ancestorAnchor !== styleTarget) {
              const ancSnap = snapshotsRef.current.get(ancestorAnchor)
              if (ancSnap && 'href' in ancSnap) {
                if (ancSnap.href === null) {
                  ancestorAnchor.removeAttribute('href')
                } else {
                  ancestorAnchor.setAttribute('href', ancSnap.href ?? '')
                }
              }
            }
            setFilterState(defaultFilters)
            setTransformState(defaultTransform)
            setBoxState(readBoxFromElement(styleTarget))
            setTypeState(readTypeFromElement(styleTarget))
            // Clear the skip flag after React has committed the state
            // updates and fired (and skipped) the apply effects.
            requestAnimationFrame(() => {
              skipApplyRef.current = false
            })
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
          aiEditBusy={aiEditBusy}
          onAIEdit={
            sessionId
              ? (userText) => handleAIEditImage(styleTarget, userText)
              : undefined
          }
          onSwapWithZone1={
            zone1SelectedImage
              ? () => {
                  const url = `/${zone1SelectedImage.sessionId}/${zone1SelectedImage.filename}`
                  swapImage(styleTarget, url)
                  if (sessionId && pageFilename) {
                    // NOTE: `BG_IMAGE_FLAG_ATTR` stores only "1" — a presence
                    // flag, not the URL. If this branch ever actually ships
                    // (no callers today), read the URL from computedStyle
                    // or switch to BG_IMAGE_SRC_ATTR if the studio bridge
                    // has also tagged it. Emitting `bgimg:1` is a bug.
                    onSlotSwapped?.({
                      sessionId,
                      pageFilename,
                      slot:
                        styleTarget.tagName === 'IMG'
                          ? `img:${(styleTarget as HTMLImageElement).src}`
                          : `bgimg:${styleTarget.getAttribute(BG_IMAGE_FLAG_ATTR) || ''}`,
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
            aria-label="Ask the Creative Director a question about this vibe"
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
// StylingPopover — 4 tabs: Color (filter), Image (transform), Box, Type
// ────────────────────────────────────────────────────────────────────────

type PopoverTab = 'text' | 'filter' | 'image' | 'box' | 'type'

function StylingPopover({
  targetTag,
  isText,
  isTextLeaf,
  isImage,
  isAnchor,
  availableFonts,
  availableWeights,
  availableLinks,
  textContent,
  onTextChange,
  computedSize,
  filterState,
  onFilterChange,
  transformState,
  onTransformChange,
  boxState,
  onBoxChange,
  typeState,
  onTypeChange,
  onClose,
  onReset,
  onSwap,
  zone1SelectedImage,
  onSwapWithZone1,
  onAIEdit,
  aiEditBusy,
  onSelectParent,
}: {
  targetTag: string
  isText: boolean
  /** True when writing to this element's textContent will NOT destroy
   *  sibling block elements (i.e. it's a leaf or inline-only container). */
  isTextLeaf: boolean
  isImage: boolean
  isAnchor: boolean
  availableFonts: string[]
  availableWeights: number[]
  availableLinks: string[]
  textContent: string
  onTextChange: (next: string) => void
  /** Rendered width/height of the selected element (computed style). Used
   *  by BoxPanel's Size row as a display prefill when the element has no
   *  inline size — otherwise the inputs would show blank on class-sized
   *  elements. Never written back automatically; the user's onChange is
   *  what commits to inline style. */
  computedSize: { width: SizeDim | null; height: SizeDim | null }
  filterState: FilterState
  onFilterChange: (next: FilterState) => void
  transformState: TransformState
  onTransformChange: (next: TransformState) => void
  boxState: BoxState
  onBoxChange: (next: BoxState) => void
  typeState: TypeState
  onTypeChange: (next: TypeState) => void
  onClose: () => void
  onReset: () => void
  onSwap: () => void
  zone1SelectedImage?: { filename: string; sessionId: string } | null
  onSwapWithZone1?: () => void
  /** Fires when the user writes an edit intent in the Image tab's AI
   *  field and clicks Send. Parent pipes it through CD → Nano Banana
   *  and swaps the result in. */
  onAIEdit?: (userText: string) => void | Promise<void>
  /** True while an AI edit round-trip is in flight. Disables the send
   *  button; the popover's own local text state stays editable so the
   *  user can keep typing while waiting. */
  aiEditBusy?: boolean
  onSelectParent?: () => void
}) {
  const isImg = targetTag === 'IMG'

  // Tab visibility rules (per Ralph 2026-04-20, revised 2026-04-23):
  //   Text element  → Type, Text*, Box, Color            — default Type
  //   Image element → Image, Box, Color                  — default Image
  //   Generic box   → Box, Color                         — default Box
  //
  // - Type tab: shown whenever the element is text-bearing (cascades to
  //   descendants; safe on containers).
  // - Text tab: shown ONLY when the element is a text LEAF — no block
  //   children. Writing textContent to a container obliterates every
  //   child; 2026-04-23 bug (Ralph): "edit one text, butchers the whole
  //   vibe" traced to exactly this. `isTextLeaf` is the gate.
  // - Image tab: gated to image-bearing elements (IMG or bg-image).
  // - Box + Color: universal — every element has a box and CSS filters
  //   apply to any element (not just images).
  const tabs: Array<{ id: PopoverTab; label: string; show: boolean }> = [
    { id: 'type', label: 'Type', show: isText },
    { id: 'text', label: 'Text', show: isText && isTextLeaf },
    { id: 'box', label: 'Box', show: true },
    { id: 'image', label: 'Image', show: isImage },
    { id: 'filter', label: 'Color', show: true },
  ]

  // Default tab based on what was clicked.
  const defaultTab: PopoverTab = isImage ? 'image' : isText ? 'type' : 'box'
  const [tab, setTab] = useState<PopoverTab>(defaultTab)

  return (
    <div
      role="dialog"
      aria-label={`Properties for ${targetTag.toLowerCase()} element`}
      style={{
        // Fixed bottom-right of the viewport so the panel doesn't cover
        // the element it's editing. Positioned OUTSIDE the iframe so the
        // iframe's scroll doesn't move the panel.
        position: 'fixed',
        bottom: 16,
        right: 16,
        width: 360,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
        zIndex: 50,
        padding: 14,
        fontFamily: 'inherit',
        color: 'var(--text-main)',
        maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto',
      }}
    >
      {/* Header row: tag name + parent-select + undo + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          &lt;{targetTag.toLowerCase()}&gt;
        </span>
        {onSelectParent && (
          <button
            onClick={onSelectParent}
            style={{ ...iconBtn, width: 22, height: 22 }}
            title="Select parent element"
          >
            ↑
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onReset}
          style={{ ...iconBtn, width: 22, height: 22 }}
          title="Undo all changes to this element"
        >
          {/* Undo icon — rotated arrow */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>
        <button onClick={onClose} style={iconBtn} title="Close (Esc)">✕</button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--pill-bg)', border: '1px solid var(--pill-border)', borderRadius: 6, flexWrap: 'wrap' }}>
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '4px 10px',
                border: 'none',
                borderRadius: 4,
                background: tab === t.id ? 'var(--accent, #3B82F6)' : 'transparent',
                color: tab === t.id ? '#fff' : 'var(--text-muted)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'text' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SectionLabel>Content</SectionLabel>
          <textarea
            value={textContent}
            onChange={(e) => onTextChange(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 6,
              border: '1px solid var(--pill-border)',
              background: 'var(--bg-input, transparent)',
              color: 'var(--text-main)',
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'vertical',
              minHeight: 80,
            }}
            placeholder="(empty)"
            autoFocus
          />
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Changes apply live. Saved when Director Mode is turned off.
          </div>
        </div>
      )}

      {tab === 'box' && (
        <BoxPanel
          boxState={boxState}
          onBoxChange={onBoxChange}
          isImg={isImg}
          isAnchor={isAnchor}
          availableLinks={availableLinks}
          computedSize={computedSize}
        />
      )}

      {tab === 'type' && (
        <TypePanel
          typeState={typeState}
          onTypeChange={onTypeChange}
          availableFonts={availableFonts}
          availableWeights={availableWeights}
        />
      )}

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
          {/* AI Edit — Ralph 2026-04-23. Click a picture → write what you
              want → CD refines into a ready prompt → Nano Banana executes →
              result swaps into this element. `onAIEdit` is undefined when
              the component is mounted without a session (can't reach CD). */}
          {onAIEdit && <AIEditRow onSend={onAIEdit} busy={!!aiEditBusy} />}
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
          {isImage && !isImg && (
            <Row label="Repeat">
              <PillGroup
                value={transformState.repeat || ''}
                options={['no-repeat', 'repeat', 'repeat-x', 'repeat-y']}
                onChange={(v) => onTransformChange({ ...transformState, repeat: (v || null) as TransformState['repeat'] })}
              />
            </Row>
          )}

          {/* Image-specific actions: Swap w/ Zone 1 + Replace (picker).
              These are ONLY in the Image tab because they make no sense on
              text or generic boxes. Ralph 2026-04-20: Replace clicked on a
              non-image threw an error — now it's unreachable when not an
              image because the Image tab itself is hidden. */}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
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
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Small UI helpers (kept local to this file)
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// BoxPanel — Opacity, Fill, Padding, Margin, Radius (per Claude Design)
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// Panels — rewritten 2026-04-20 to match Claude Design's inspector layout.
//
// Each field is a rounded, bordered "pill" containing a label on the left
// and its value on the right. Related fields share a 2-column row. Values
// look like plain right-aligned text that become editable inputs on focus.
// Compound controls (Padding/Margin/Border/Radius) collapse to a single
// value + chevron; expand to per-side inputs.
// ────────────────────────────────────────────────────────────────────────

function BoxPanel({
  boxState,
  onBoxChange,
  isImg,
  isAnchor,
  availableLinks,
  computedSize,
}: {
  boxState: BoxState
  onBoxChange: (next: BoxState) => void
  isImg: boolean
  isAnchor: boolean
  availableLinks: string[]
  /** Live computed W×H of the selected element — used to prefill the
   *  Size inputs when they have no inline declaration. If the user types
   *  nothing, we write nothing: `boxState.width/height` stays null. */
  computedSize: { width: SizeDim | null; height: SizeDim | null }
}) {
  // What the Size inputs DISPLAY. Explicit inline (boxState) wins; else
  // we show the rendered size so the user sees where they are starting.
  const displayW = boxState.width?.value ?? computedSize.width?.value ?? null
  const displayH = boxState.height?.value ?? computedSize.height?.value ?? null
  const unitW: SizeUnit = boxState.width?.unit ?? 'px'
  const unitH: SizeUnit = boxState.height?.unit ?? 'px'
  // Include the current href in the options even if it's not in the
  // discovered list (could be a new or stale link). Plus an explicit "—"
  // for "none" (unlink).
  const linkOptions = (() => {
    const opts = [{ value: '__none__', label: '— none —' }]
    for (const h of availableLinks) opts.push({ value: h, label: h })
    if (boxState.href && !availableLinks.includes(boxState.href)) {
      opts.push({ value: boxState.href, label: boxState.href })
    }
    return opts
  })()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionLabel>Box</SectionLabel>

      <FieldBox label="Opacity">
        <PlainNumberInput
          min={0}
          max={1}
          step={0.05}
          value={boxState.opacity}
          onChange={(v) => onBoxChange({ ...boxState, opacity: Math.max(0, Math.min(1, v ?? 0)) })}
        />
      </FieldBox>

      {/* Size — explicit W × H.
          Display: shows the element's current rendered size (inline if
          set, else computed px). Typing commits to inline style; clearing
          the input (empty) commits `null`, which clears inline and lets
          the element return to its natural / class-based size.
          (Ralph 2026-04-24: inputs were blank for class-sized elements
          because we were only reading inline — now we prefill from
          computed style so the user can see and nudge from a real number.)
          Unit toggle commits at the displayed value so switching px ↔ %
          doesn't silently do nothing on an unpinned element. */}
      <FieldBox label="Size">
        <span style={{ fontSize: 10, color: 'var(--text-dim)', marginRight: 2 }}>W</span>
        <PlainNumberInput
          value={displayW}
          min={0}
          step={1}
          onChange={(v) =>
            onBoxChange({
              ...boxState,
              width: v === null ? null : { value: v, unit: unitW },
            })
          }
        />
        <SizeUnitToggle
          unit={unitW}
          onToggle={() => {
            const next: SizeUnit = unitW === 'px' ? '%' : 'px'
            // If no inline value yet, commit the current display value at
            // the new unit so the toggle is meaningful on any element.
            const value = boxState.width?.value ?? displayW
            onBoxChange({
              ...boxState,
              width: value === null ? null : { value, unit: next },
            })
          }}
        />
        <span style={{ fontSize: 10, color: 'var(--text-dim)', margin: '0 4px 0 6px' }}>H</span>
        <PlainNumberInput
          value={displayH}
          min={0}
          step={1}
          onChange={(v) =>
            onBoxChange({
              ...boxState,
              height: v === null ? null : { value: v, unit: unitH },
            })
          }
        />
        <SizeUnitToggle
          unit={unitH}
          onToggle={() => {
            const next: SizeUnit = unitH === 'px' ? '%' : 'px'
            const value = boxState.height?.value ?? displayH
            onBoxChange({
              ...boxState,
              height: value === null ? null : { value, unit: next },
            })
          }}
        />
      </FieldBox>

      {/* Link — shown on EVERY element. If the element already is an <a>
          or sits inside one, setting this edits the existing anchor. If it
          doesn't, setting a link WRAPS the element in a new <a>. Setting
          to "none" removes the link (unwraps our wrapper, or removes href
          from a pre-existing anchor). */}
      <FieldBox label="Link">
        <PlainSelect
          value={boxState.href === null || boxState.href === '' ? '__none__' : boxState.href}
          onChange={(v) =>
            onBoxChange({ ...boxState, href: v === '__none__' ? null : v })
          }
          options={linkOptions}
        />
      </FieldBox>

      {!isImg && (
        <FieldBox label="Fill">
          <InlineColor
            value={boxState.fill}
            onChange={(hex) => onBoxChange({ ...boxState, fill: hex })}
          />
        </FieldBox>
      )}

      <ExpandableQuad
        label="Padding"
        value={boxState.padding}
        onChange={(next) => onBoxChange({ ...boxState, padding: next as SpacingQuad })}
        kind="spacing"
      />
      <ExpandableQuad
        label="Margin"
        value={boxState.margin}
        onChange={(next) => onBoxChange({ ...boxState, margin: next as SpacingQuad })}
        kind="spacing"
      />
      <FieldBox label="Border" trailing={<span style={plainValueStyle}>0 <UnitLabel unit="px" /></span>}>
        {/* Border width/style/color is a future add. Display-only for now
            to match the Claude Design inspector structure. */}
      </FieldBox>
      <ExpandableQuad
        label="Radius"
        value={boxState.radius}
        onChange={(next) => onBoxChange({ ...boxState, radius: next as RadiusQuad })}
        kind="radius"
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// TypePanel — Font, Size/Weight, Color/Align, Line/Tracking
// ────────────────────────────────────────────────────────────────────────

function TypePanel({
  typeState,
  onTypeChange,
  availableFonts,
  availableWeights,
}: {
  typeState: TypeState
  onTypeChange: (next: TypeState) => void
  availableFonts: string[]
  availableWeights: number[]
}) {
  const fs = typeState.fontSize
  const ls = typeState.letterSpacing
  const fontOptions = typeState.fontFamily && !availableFonts.includes(typeState.fontFamily)
    ? [typeState.fontFamily, ...availableFonts]
    : availableFonts
  const weightOptions = typeState.fontWeight && !availableWeights.includes(typeState.fontWeight)
    ? [...availableWeights, typeState.fontWeight].sort((a, b) => a - b)
    : availableWeights

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionLabel>Typography</SectionLabel>

      {/* Font — full-width row */}
      <FieldBox label="Font">
        <PlainSelect
          value={typeState.fontFamily ?? ''}
          onChange={(v) => onTypeChange({ ...typeState, fontFamily: v || null })}
          options={[{ value: '', label: '—' }, ...fontOptions.map((f) => ({ value: f, label: f }))]}
        />
      </FieldBox>

      {/* Size + Weight */}
      <PairRow>
        <FieldBox label="Size">
          <InlineUnitValue
            value={fs}
            onChange={(next) => onTypeChange({ ...typeState, fontSize: next })}
          />
        </FieldBox>
        <FieldBox label="Weight">
          <PlainSelect
            value={typeState.fontWeight ? String(typeState.fontWeight) : ''}
            onChange={(v) => onTypeChange({ ...typeState, fontWeight: v ? parseInt(v, 10) : null })}
            options={[
              { value: '', label: '—' },
              ...weightOptions.map((w) => ({ value: String(w), label: String(w) })),
            ]}
          />
        </FieldBox>
      </PairRow>

      {/* Color + Align */}
      <PairRow>
        <FieldBox label="Color">
          <InlineColor
            value={typeState.color}
            onChange={(hex) => onTypeChange({ ...typeState, color: hex })}
          />
        </FieldBox>
        <FieldBox label="Align">
          <PlainSelect
            value={typeState.textAlign ?? ''}
            onChange={(v) => onTypeChange({ ...typeState, textAlign: (v as TypeState['textAlign']) || null })}
            options={[
              { value: '', label: '—' },
              { value: 'start', label: 'left' },
              { value: 'center', label: 'center' },
              { value: 'end', label: 'right' },
              { value: 'justify', label: 'justify' },
            ]}
          />
        </FieldBox>
      </PairRow>

      {/* Line + Tracking */}
      <PairRow>
        <FieldBox label="Line">
          <PlainNumberInput
            min={0}
            max={4}
            step={0.05}
            value={typeState.lineHeight ?? null}
            onChange={(v) => onTypeChange({ ...typeState, lineHeight: v })}
          />
        </FieldBox>
        <FieldBox label="Tracking">
          <InlineUnitValue
            value={ls}
            onChange={(next) => onTypeChange({ ...typeState, letterSpacing: next })}
          />
        </FieldBox>
      </PairRow>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Shared building blocks for Box + Type panels
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// Inspector building blocks (Claude-Design-style)
//
// Design language:
//   - Section header: small uppercase text ("TYPOGRAPHY" / "BOX")
//   - FieldBox: rounded bordered rectangle containing a label (left) and a
//     value/control (right). Hover highlights; click-in focuses the input.
//   - PairRow: puts two FieldBoxes side-by-side in a 2-column grid.
//   - Inputs look like plain right-aligned text until focused; no separate
//     bordered input chrome (the FieldBox is the chrome).
// ────────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--text-dim)',
      marginTop: 8,
      marginBottom: 2,
    }}>
      {children}
    </div>
  )
}

/** Two FieldBoxes side-by-side in a 2-column grid. */
function PairRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {children}
    </div>
  )
}

/** The basic inspector row: rounded-bordered container with a label on
 *  the left and one or two value controls on the right. The whole row is
 *  click-focusable via `onClick` (used for the expandable Padding/Margin/
 *  Radius variants). */
function FieldBox({
  label,
  children,
  trailing,
  onClick,
}: {
  label: string
  children?: React.ReactNode
  trailing?: React.ReactNode
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 34,
        padding: '6px 12px',
        borderRadius: 6,
        border: '1px solid var(--pill-border)',
        cursor: onClick ? 'pointer' : 'default',
        background: 'transparent',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {children}
        {trailing}
      </div>
    </div>
  )
}

/** Plain number input: no border, right-aligned, looks like static text
 *  until focused. Optional min/max/step. Accepts a null value (empty). */
function PlainNumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder = '—',
}: {
  value: number | null
  onChange: (v: number | null) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const raw = e.target.value
        if (!raw) return onChange(null)
        const n = parseFloat(raw)
        onChange(isNaN(n) ? null : n)
      }}
      style={plainInputStyle}
    />
  )
}

/** Plain select: styled to blend with the FieldBox. Shows a chevron. */
function PlainSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      style={{
        ...plainInputStyle,
        minWidth: 72,
        // Keep the browser's default dropdown chevron
        appearance: 'auto',
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

/** A length value with its unit shown to the right. Editable number +
 *  "px"/"rem" label. Click label to toggle unit (if value is non-null). */
function InlineUnitValue({
  value,
  onChange,
}: {
  value: { value: number; unit: Unit } | null
  onChange: (next: { value: number; unit: Unit } | null) => void
}) {
  const v = value?.value ?? ''
  const unit = value?.unit ?? 'px'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number"
        value={v}
        placeholder="—"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const raw = e.target.value
          if (!raw) return onChange(null)
          const n = parseFloat(raw)
          onChange(isNaN(n) ? null : { value: n, unit })
        }}
        style={{ ...plainInputStyle, width: 52 }}
      />
      <UnitLabel
        unit={unit}
        onClick={() => {
          if (value === null) return
          onChange({ value: value.value, unit: value.unit === 'px' ? 'rem' : 'px' })
        }}
      />
    </div>
  )
}

/** Color swatch + inline hex text (click swatch to open native picker,
 *  click hex to edit as text). */
function InlineColor({
  value,
  onChange,
}: {
  value: string | null
  onChange: (next: string | null) => void
}) {
  const hex = value || '#000000'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        border: '1px solid var(--pill-border)',
        background: value ?? 'transparent',
        backgroundImage: value ? 'none' : 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)',
        backgroundSize: '6px 6px',
        backgroundPosition: '0 0, 3px 3px',
        cursor: 'pointer',
        flexShrink: 0,
      }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{ opacity: 0, width: 0, height: 0 }}
        />
      </label>
      <input
        type="text"
        value={value ?? ''}
        placeholder="—"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ ...plainInputStyle, width: 68, textAlign: 'right' }}
      />
    </div>
  )
}

/** Small "px" / "rem" label shown after a numeric input. */
function UnitLabel({ unit, onClick }: { unit: Unit; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: 11,
        color: 'var(--text-dim)',
        minWidth: 18,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
      }}
    >
      {unit}
    </span>
  )
}

/** Clickable px/% toggle for the Box Size row. `unit` parameterizes the
 *  type to the size-unit set (not the length-unit set) — this is the
 *  only place those two sets diverge. */
function SizeUnitToggle({
  unit,
  onToggle,
}: {
  unit: SizeUnit
  onToggle: () => void
}) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      title="Toggle px / %"
      style={{
        fontSize: 11,
        color: 'var(--text-dim)',
        minWidth: 18,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {unit}
    </span>
  )
}

/** Expandable spacing (Padding/Margin) or radius control.
 *  Collapsed: a single FieldBox with unified value + chevron.
 *  Expanded: FieldBox header + 4 per-side inputs in a 2x2 grid underneath. */
function ExpandableQuad({
  label,
  value,
  onChange,
  kind,
}: {
  label: string
  value: SpacingQuad | RadiusQuad
  onChange: (next: SpacingQuad | RadiusQuad) => void
  kind: 'spacing' | 'radius'
}) {
  const isSpacing = kind === 'spacing'
  const allEqual = isSpacing
    ? (() => {
        const q = value as SpacingQuad
        return q.t === q.r && q.r === q.b && q.b === q.l
      })()
    : (() => {
        const q = value as RadiusQuad
        return q.tl === q.tr && q.tr === q.br && q.br === q.bl
      })()

  const getRepresentative = (): number => {
    if (isSpacing) return (value as SpacingQuad).t
    return (value as RadiusQuad).tl
  }

  const setAll = (v: number) => {
    if (isSpacing) {
      onChange({ ...(value as SpacingQuad), t: v, r: v, b: v, l: v })
    } else {
      onChange({ ...(value as RadiusQuad), tl: v, tr: v, br: v, bl: v })
    }
  }

  const toggleExpanded = () => onChange({ ...value, expanded: !value.expanded })

  const sides: Array<{ key: string; label: string; value: number; set: (v: number) => void }> = isSpacing
    ? (() => {
        const q = value as SpacingQuad
        return [
          { key: 't', label: 'T', value: q.t, set: (v: number) => onChange({ ...q, t: v }) },
          { key: 'r', label: 'R', value: q.r, set: (v: number) => onChange({ ...q, r: v }) },
          { key: 'b', label: 'B', value: q.b, set: (v: number) => onChange({ ...q, b: v }) },
          { key: 'l', label: 'L', value: q.l, set: (v: number) => onChange({ ...q, l: v }) },
        ]
      })()
    : (() => {
        const q = value as RadiusQuad
        return [
          { key: 'tl', label: 'TL', value: q.tl, set: (v: number) => onChange({ ...q, tl: v }) },
          { key: 'tr', label: 'TR', value: q.tr, set: (v: number) => onChange({ ...q, tr: v }) },
          { key: 'br', label: 'BR', value: q.br, set: (v: number) => onChange({ ...q, br: v }) },
          { key: 'bl', label: 'BL', value: q.bl, set: (v: number) => onChange({ ...q, bl: v }) },
        ]
      })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <FieldBox
        label={label}
        onClick={toggleExpanded}
        trailing={
          <>
            {!value.expanded && (
              <input
                type="number"
                value={allEqual ? getRepresentative() : getRepresentative()}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setAll(parseFloat(e.target.value) || 0)}
                style={{ ...plainInputStyle, width: 44 }}
              />
            )}
            <UnitLabel unit={value.unit} />
            <span style={{ fontSize: 10, color: 'var(--text-dim)', opacity: 0.7, marginLeft: 2 }}>
              {value.expanded ? '▾' : '▸'}
            </span>
          </>
        }
      />
      {value.expanded && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 4,
          padding: '4px 10px 6px 10px',
        }}>
          {sides.map((s) => (
            <FieldBox
              key={s.key}
              label={s.label}
              trailing={
                <>
                  <input
                    type="number"
                    value={s.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => s.set(parseFloat(e.target.value) || 0)}
                    style={{ ...plainInputStyle, width: 44 }}
                  />
                  <UnitLabel unit={value.unit} />
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

const plainInputStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--text-main)',
  fontSize: 12,
  fontFamily: 'inherit',
  textAlign: 'right',
  padding: 0,
  margin: 0,
  outline: 'none',
  minWidth: 24,
}

const plainValueStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-main)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

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

/**
 * AIEditRow — write an edit intent; CD refines it; Nano Banana executes.
 *
 * Popover-local text state so each mount of the popover starts fresh.
 * Submitting clears the field on success. The parent handles the two
 * async hops (ask-cd + edit-image) and the ultimate swap; this row just
 * captures text + click.
 */
function AIEditRow({
  onSend,
  busy,
}: {
  onSend: (text: string) => void | Promise<void>
  busy: boolean
}) {
  const [text, setText] = useState('')
  const send = () => {
    const t = text.trim()
    if (!t || busy) return
    // Optimistically clear the input — if the round-trip fails the parent
    // surfaces an error snackbar; the user can retype. Losing 20 chars of
    // typing beats the "did I already click send?" ambiguity if we kept it.
    setText('')
    void onSend(t)
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        borderRadius: 6,
        border: '1px solid var(--pill-border)',
        background: 'rgba(245, 158, 11, 0.06)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: '#F59E0B',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        AI Edit — CD + Nano Banana
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter = send, matching the PromptEditor keybind.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            send()
          }
        }}
        rows={3}
        disabled={busy}
        placeholder={
          busy
            ? 'CD is reviewing + Nano is generating…'
            : 'Describe what to change — CD refines the prompt, Nano runs it.'
        }
        style={{
          width: '100%',
          padding: 8,
          borderRadius: 4,
          border: '1px solid var(--pill-border)',
          background: 'var(--bg-input, transparent)',
          color: 'var(--text-main)',
          fontSize: 12,
          fontFamily: 'inherit',
          resize: 'vertical',
          minHeight: 60,
          opacity: busy ? 0.6 : 1,
        }}
      />
      <button
        onClick={send}
        disabled={busy || !text.trim()}
        style={{
          alignSelf: 'flex-end',
          padding: '6px 14px',
          borderRadius: 4,
          border: 'none',
          background: busy || !text.trim() ? 'rgba(255,255,255,0.1)' : '#F59E0B',
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          cursor: busy || !text.trim() ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {busy ? 'Working…' : 'Send to CD & Generate'}
      </button>
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

// Re-export cacheBustSuffix for backward compatibility with external
// callers that imported it from this component file.
export { cacheBustSuffixFromLib as cacheBustSuffix }
