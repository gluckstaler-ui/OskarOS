'use client'

/**
 * AdvancedMode — 4-zone image workstation overlay.
 *
 * Five modes (tabs): View | Generate | Edit | Compose | Layout.
 *
 * Layout:
 *   ┌────────────┬──────────────────────────────────────┐
 *   │            │ Tab bar                              │
 *   │            ├──────────────────────────────────────┤
 *   │  Zone 1:   │ Tab help text                        │
 *   │  Asset     ├──────────────────────────────────────┤
 *   │  Library   │ Zone 2: Canvas / preview / bento     │
 *   │  (spans    ├───────────────────┬──────────────────┤
 *   │  rows)     │ Zone 3:           │ Zone 4:          │
 *   │            │ Presets/Staging/  │ Prompt/Ratio/    │
 *   │            │ Ask CD            │ Res/Generate     │
 *   └────────────┴───────────────────┴──────────────────┘
 *
 * This is WP-1A: shell + tabs + basic grid.
 * Version sidebar comes in WP-1C.
 * Prompt pre-loading from IMAGES.md comes in WP-1D.
 * Presets + generation pipeline come in WP-2A/2B/2C.
 *
 * === Cross-Tab State Preservation ===
 *
 * Switching tabs does NOT nuke your work. Each tab keeps its own state
 * (selected image, prompt, aspect ratio, resolution) in `perTabState`.
 * When you switch tabs: save current state under old tab, load state under new tab.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { SourceImage, ImageManifest, AspectRatio, ImageSize, VibeData } from '@/lib/types'
import { AssetGrid } from './advanced/AssetGrid'
import { CanvasPreview } from './advanced/CanvasPreview'
import { PresetsStaging } from './advanced/PresetsStaging'
import { PromptEditor, PromptEditorHandle } from './advanced/PromptEditor'
import { ImageChatPanel, type ImageChatContent } from './advanced/ImageChatPanel'
import type { ConversationMessage } from '@/lib/types'
import { findPreset as findPresetByLabel } from '@/lib/image-presets'
import type { Preset, ComposeData, LayoutData } from '@/lib/image-presets'
import { brandDataFromVibe, type BrandData } from '@/lib/brand-data'
import { resolvePrompt, type PromptSource } from '@/lib/image-prompt-resolver'
import {
  emitHotSwap,
  emitCDProofreadAdvisory,
  emitCDProofreadRewritten,
  emitCDVerdict,
  emitCDComment,
} from '@/lib/session-events'
// (WP-8A rewrite 2026-04-17): inferSlotFromFilename helper removed. Auto-swap
// now uses source-image lookup via /api/sessions/[id]/vibe-slots — see
// handleGenerate body. hotSwapAction is no longer called from this file.

// ============================================================================
// Types
// ============================================================================

export type AdvancedTab = 'view' | 'generate' | 'edit' | 'compose' | 'layout' | 'brand'

/** Compose staging: scene image + ordered subject images. */
export interface ComposeStaging {
  sceneImage: SourceImage | null
  subjectImages: SourceImage[]
}

/** Layout staging: ordered slots, length driven by preset grid config. */
export interface LayoutStaging {
  slots: (SourceImage | null)[]
  /** Which slot index gets the next click (-1 = none available). */
  activeSlotIndex: number
}

interface TabState {
  /** The image selected/focused in this tab. */
  selectedImage: SourceImage | null
  /** The current prompt text in Zone 4. */
  prompt: string
  /** Aspect ratio for generation. */
  aspectRatio: AspectRatio
  /** Resolution for generation. */
  resolution: ImageSize
  /** Currently selected preset (label), or null if none. */
  activePresetLabel: string | null
  /** Compose-tab staging (scene + subjects). */
  composeStaging: ComposeStaging
  /** Layout-tab staging (ordered slots). */
  layoutStaging: LayoutStaging
  /** WP-1D: Where the current prompt came from (tracks user edits). */
  promptSource: PromptSource | 'modified'
  /** WP-13A: Last "loaded" prompt value — what Reset should restore to.
   *  Set whenever a prompt is populated by the system (waterfall / preset / Ask CD),
   *  not when the user types. Enables one-click restore to the pre-edit state. */
  loadedPrompt: string
  /** WP-13A: Source label to restore alongside `loadedPrompt`. */
  loadedPromptSource: PromptSource | 'modified'
}

export interface AdvancedModeProps {
  sessionId: string
  sourceImages: SourceImage[]
  imageManifests: ImageManifest[]
  /** Which tab to land on when opened. */
  initialTab?: AdvancedTab
  /** Which image to pre-select when opened (optional). */
  initialImage?: SourceImage | null
  onClose?: () => void
  /** Called after successful generation — parent appends new SourceImage to state. */
  onImageGenerated?: (newImage: SourceImage) => void
  /** WP-11A: Called after a delete — parent removes the image from state. */
  onRemoveImage?: (imageId: string) => void
  /** Ralph 2026-04-25: Upload from inside Image mode. Same handler the
   *  BRIEF/STUDIO AssetsPanel uses; parent owns disk write + state add. */
  onUpload?: (file: File) => void
  /** Ralph 2026-04-25: Re-read IMAGES.md and refresh tag + usedIn on
   *  every source image. Called after Replace-everywhere succeeds — the
   *  server's reconcile updated tags on disk, this pulls them back into
   *  React state so the panel shows the new USED / B-ROLL state. */
  onSourceImagesRefresh?: () => void | Promise<void>
  /** WP-B5: Vibes loaded in the session (for the Brand tab's vibe picker). */
  vibes?: VibeData[]
  /** WP-B5: Session business name (falls back to vibe name if empty). */
  businessName?: string

  // ── Chat column (added 2026-04-18): shared conversation w/ Briefing. ──
  /** The same `messages` array Studio Briefing reads. One CD, one log. */
  chatMessages?: ConversationMessage[]
  /** Append a user turn to the shared log (called by ImageChatPanel on Send). */
  onAppendUserMessage?: (content: string) => void
  /** Append a CD assistant turn to the shared log (called after /api/ask-cd returns). */
  onAppendAssistantMessage?: (content: string) => void
  /** List of vibe HTML files for the Vibe Preview mode inside the chat column. */
  vibeOptions?: { label: string; htmlPath: string }[]
}

// ============================================================================
// Constants
// ============================================================================

const TABS: { id: AdvancedTab; label: string }[] = [
  { id: 'view', label: 'View' },
  { id: 'generate', label: 'Generate' },
  { id: 'edit', label: 'Edit' },
  { id: 'compose', label: 'Compose' },
  { id: 'layout', label: 'Layout' },
  { id: 'brand', label: 'Brand' },
]

const TAB_COLORS: Record<AdvancedTab, string> = {
  view: 'var(--text-dim)',
  generate: '#F59E0B',
  edit: '#3B82F6',
  compose: '#8B5CF6',
  layout: '#10B981',
  brand: '#EC4899',
}

const TAB_HELP: Record<AdvancedTab, string> = {
  view: 'Full-size preview. Click any image in the library on the left to view it.',
  generate: 'Create images from scratch using presets. No source image needed — describe what you want and Nano Banana generates it.',
  edit: 'Select an image from the library, then choose a preset to transform it. The image description is automatically included in your prompt.',
  compose: 'Pick a scene image, then add subjects to place into it. Choose a preset to define the composition style. The prompt updates live as you select.',
  layout: 'Arrange multiple images into a grid layout. Pick a preset, then click images to fill the grid slots. The bento preview updates in real-time.',
  brand: 'Pick a vibe, pick a deliverable — generate logo, business card, pitch slide, website hero, and social kit in the vibe\'s brand.',
}

const INITIAL_LAYOUT_SLOTS = 4

function makeInitialTabState(): TabState {
  return {
    selectedImage: null,
    prompt: '',
    aspectRatio: '16:9',
    resolution: '2K',
    activePresetLabel: null,
    composeStaging: { sceneImage: null, subjectImages: [] },
    layoutStaging: {
      slots: Array(INITIAL_LAYOUT_SLOTS).fill(null),
      activeSlotIndex: 0,
    },
    promptSource: 'none',
    loadedPrompt: '',
    loadedPromptSource: 'none',
  }
}

// ============================================================================
// Preset → Prompt builder
// ============================================================================

/**
 * Build ComposeData from compose staging state.
 */
function buildComposeData(staging: ComposeStaging): ComposeData {
  const sc = staging.sceneImage?.filename || '[scene]'
  const sceneDesc = staging.sceneImage?.analysis?.description || ''
  const suFilenames = staging.subjectImages.map((img) => img.filename)
  const su = suFilenames.length > 0 ? suFilenames : ['[subjects]']
  const sl = suFilenames.length > 0 ? suFilenames.join(', ') : '[subjects]'
  const allNames = [sc, ...suFilenames]
  return { sc, su, sl, ing: allNames.join(', '), sceneDesc }
}

/**
 * WP-4 (added 2026-04-17): build a "Reference images" block that lists every
 * staged compose image with its Nano Banana description in parens.
 * Spec example: `sultan.jpg (peregrine falcon...) into cliff-majlis.jpg (...)`
 * The compose preset functions use bare filenames in the prompt body — this
 * block is appended after so Nano sees both the filename references AND the
 * grounded descriptions for each. Skips entries whose description is empty.
 */
function buildComposeReferenceBlock(staging: ComposeStaging): string {
  const lines: string[] = []
  const scene = staging.sceneImage
  if (scene?.filename) {
    const desc = scene.analysis?.description || ''
    lines.push(
      desc.trim()
        ? `- ${scene.filename} (scene): ${desc.trim()}`
        : `- ${scene.filename} (scene)`
    )
  }
  for (const subj of staging.subjectImages) {
    const desc = subj.analysis?.description || ''
    lines.push(
      desc.trim()
        ? `- ${subj.filename} (subject): ${desc.trim()}`
        : `- ${subj.filename} (subject)`
    )
  }
  if (lines.length === 0) return ''
  return 'Reference images:\n' + lines.join('\n')
}

/**
 * Build LayoutData from layout staging state.
 */
function buildLayoutData(staging: LayoutStaging): LayoutData {
  return {
    s: staging.slots.map((img) => img?.filename || '[empty]'),
  }
}

/**
 * Build prompt from preset + staging state.
 * Uses real compose/layout data from staging slots.
 */
function buildPromptFromPreset(
  preset: Preset,
  selectedImage: SourceImage | null,
  _activeTab: AdvancedTab,
  composeStaging?: ComposeStaging,
  layoutStaging?: LayoutStaging,
  brandData?: BrandData
): string {
  const description =
    selectedImage?.analysis?.description || selectedImage?.cdNotes || '[select an image first]'

  switch (preset.kind) {
    case 'generate':
      return preset.prompt

    case 'edit':
      return preset.editFn(description)

    case 'compose': {
      const data = composeStaging
        ? buildComposeData(composeStaging)
        : { sc: '[scene]', su: ['[subjects]'], sl: '[subjects]', ing: '[scene], [subjects]', sceneDesc: '' }
      let prompt = preset.composeFn(data)
      // WP-4 (2026-04-17): append per-image references with descriptions for
      // EVERY staged image (scene + every subject) so Nano sees the grounded
      // description, not just the filename. Old code only appended sceneDesc.
      if (composeStaging) {
        const refBlock = buildComposeReferenceBlock(composeStaging)
        if (refBlock) prompt += '\n\n' + refBlock
      }
      return prompt
    }

    case 'layout': {
      const data = layoutStaging
        ? buildLayoutData(layoutStaging)
        : { s: ['[empty]', '[empty]', '[empty]', '[empty]'] }
      return preset.layoutFn(data)
    }

    case 'brand': {
      // Brand presets bake in the active vibe's brand tokens (fonts,
      // colors, voice, audience) and the selected image's description.
      // If no brand data is available, emit a clear error prompt so the
      // user knows they need an active vibe rather than shipping a
      // placeholder-ridden generic.
      if (!brandData) {
        return `[Brand tab requires an active vibe with declared fonts, colors, mood, and audience. Pick a vibe first, then click this preset.]`
      }
      const imageDesc = selectedImage?.analysis?.description || selectedImage?.cdNotes || ''
      return preset.brandFn(brandData, imageDesc)
    }

    default:
      return ''
  }
}

/**
 * Build a compose/layout prompt WITHOUT a preset — neutral listing of staged images.
 */
function buildNeutralComposePrompt(staging: ComposeStaging): string {
  const data = buildComposeData(staging)
  if (data.sc === '[scene]' && data.su[0] === '[subjects]') return ''
  const parts: string[] = []
  if (data.sc !== '[scene]') parts.push(`Scene: ${data.sc}`)
  if (data.su[0] !== '[subjects]') parts.push(`Subjects: ${data.sl}`)
  let prompt = `Compose ${parts.join(' with ')}. Seamlessly integrate the subjects into the scene with matched lighting and natural placement.`
  // WP-4 (2026-04-17): per-image reference block instead of scene-only desc.
  const refBlock = buildComposeReferenceBlock(staging)
  if (refBlock) prompt += '\n\n' + refBlock
  return prompt
}

function buildNeutralLayoutPrompt(staging: LayoutStaging): string {
  const filled = staging.slots.filter(Boolean).map((img) => img!.filename)
  if (filled.length === 0) return ''
  return `Arrange ${filled.join(', ')} in a clean grid layout. Consistent lighting and color grade across all panels. 10px white gutters.`
}

// ============================================================================
// Main Component
// ============================================================================

export function AdvancedMode({
  sessionId,
  sourceImages,
  imageManifests,
  initialTab = 'view',
  initialImage = null,
  onClose,
  onImageGenerated,
  onRemoveImage,
  onUpload,
  onSourceImagesRefresh,
  vibes = [],
  businessName = '',
  chatMessages = [],
  onAppendUserMessage,
  onAppendAssistantMessage,
  vibeOptions = [],
}: AdvancedModeProps) {
  // --- Tab state machine ------------------------------------------------------
  const [activeTab, setActiveTab] = useState<AdvancedTab>(initialTab)

  // WP-8B (2026-04-17): Assign-to-Vibe drawer state lives here so the
  // toggle button can live in the tab bar while the drawer renders inside
  // CanvasPreview (it's positioned absolute within Zone 2).
  const [assignOpen, setAssignOpen] = useState(false)

  // Chat column (2026-04-18): shared conversation w/ Briefing.
  // User's preference is `chatExpanded` (narrow vs wide). But when
  // contentMode === 'vibe' we FORCE wide — vibe pages with `100vh` heroes
  // can't be safely scaled (background stretches to fill the inflated iframe
  // height and clips to a cropped slice). Preview is always wide; the
  // NARROW/WIDE toggle is hidden in preview mode.
  const [chatExpanded, setChatExpanded] = useState(false)
  const [chatContent, setChatContent] = useState<ImageChatContent>('chat')
  const [selectedVibePath, setSelectedVibePath] = useState<string | null>(null)
  // Effective expanded state — preview always forces wide.
  const effectiveExpanded = chatContent === 'vibe' ? true : chatExpanded

  // Per-tab state map — save-on-leave / restore-on-return
  // Keyed by tab id; each tab has its own selectedImage/prompt/ratio/res
  const [perTabState, setPerTabState] = useState<Record<AdvancedTab, TabState>>(() => {
    const initial: Record<AdvancedTab, TabState> = {
      view: makeInitialTabState(),
      generate: makeInitialTabState(),
      edit: makeInitialTabState(),
      compose: makeInitialTabState(),
      layout: makeInitialTabState(),
      brand: makeInitialTabState(),
    }
    // Pre-seed the initial tab with the initial image if provided
    if (initialImage) {
      initial[initialTab].selectedImage = initialImage
    }
    return initial
  })

  // Derived: current tab's state
  const currentState = perTabState[activeTab]

  // --- Active brand data (Brand tab) -----------------------------------------
  // The Brand tab is stateful: entering it locks in a brand identity from
  // the active vibe. For v1 the active vibe is simply the first vibe the
  // session has — a vibe picker lives inside the Brand tab UI for later.
  // When no vibe exists or the vibe lacks brand tokens, activeBrandData is
  // null and Brand presets emit an explicit "pick a vibe first" prompt.
  const activeBrandData: BrandData | null = useMemo(() => {
    if (!vibes || vibes.length === 0) return null
    const vibe = vibes[0]
    const data = brandDataFromVibe(vibe, businessName)
    // Minimum viable signal — must have a business name and at least one color
    if (!data.businessName && !data.fontHeading && data.colors.length === 0) return null
    return data
  }, [vibes, businessName])

  // --- State updaters scoped to active tab -----------------------------------
  const patchCurrentTab = useCallback(
    (patch: Partial<TabState>) => {
      setPerTabState((prev) => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], ...patch },
      }))
    },
    [activeTab]
  )

  const handleSelectImage = useCallback(
    (img: SourceImage) => {
      const tabState = perTabState[activeTab]

      // --- Compose mode: toggle-fill staging slots ---
      if (activeTab === 'compose') {
        setPerTabState((prev) => {
          const ts = { ...prev.compose }
          let staging = { ...ts.composeStaging, subjectImages: [...ts.composeStaging.subjectImages] }

          // Is this image already staged? → Remove it (toggle off).
          if (staging.sceneImage?.id === img.id) {
            staging.sceneImage = null
          } else {
            const subIdx = staging.subjectImages.findIndex((s) => s.id === img.id)
            if (subIdx >= 0) {
              staging.subjectImages.splice(subIdx, 1)
            } else {
              // Not staged yet → fill next empty slot (scene first, then subjects)
              if (!staging.sceneImage) {
                staging.sceneImage = img
              } else {
                staging.subjectImages.push(img)
              }
            }
          }

          // Show scene image in Zone 2 if filled
          const previewImage = staging.sceneImage || img

          // Rebuild prompt from staging
          const preset = ts.activePresetLabel ? findPresetByLabel('compose', ts.activePresetLabel) : null
          const prompt = preset
            ? (() => {
                let p = (preset as any).composeFn
                  ? buildPromptFromPreset(preset, previewImage, 'compose', staging, undefined)
                  : ts.prompt
                return p
              })()
            : buildNeutralComposePrompt(staging)

          return {
            ...prev,
            compose: { ...ts, composeStaging: staging, selectedImage: previewImage, prompt },
          }
        })
        return
      }

      // --- Layout mode: toggle-fill staging slots ---
      if (activeTab === 'layout') {
        setPerTabState((prev) => {
          const ts = { ...prev.layout }
          const slots = [...ts.layoutStaging.slots]
          let { activeSlotIndex } = ts.layoutStaging

          // Is this image already in a slot? → Remove it (toggle off).
          const existingIdx = slots.findIndex((s) => s?.id === img.id)
          if (existingIdx >= 0) {
            slots[existingIdx] = null
            // Make the emptied slot active
            activeSlotIndex = existingIdx
          } else {
            // Fill the active slot (or first empty)
            let targetIdx = activeSlotIndex >= 0 && activeSlotIndex < slots.length && !slots[activeSlotIndex]
              ? activeSlotIndex
              : slots.findIndex((s) => s === null)
            if (targetIdx < 0) return prev // No empty slots
            slots[targetIdx] = img
            // Advance to next empty slot
            const nextEmpty = slots.findIndex((s, i) => i > targetIdx && s === null)
            activeSlotIndex = nextEmpty >= 0 ? nextEmpty : slots.findIndex((s) => s === null)
            if (activeSlotIndex < 0) activeSlotIndex = -1
          }

          const newStaging: LayoutStaging = { slots, activeSlotIndex }

          // Rebuild prompt
          const preset = ts.activePresetLabel ? findPresetByLabel('layout', ts.activePresetLabel) : null
          const prompt = preset
            ? buildPromptFromPreset(preset, null, 'layout', undefined, newStaging)
            : buildNeutralLayoutPrompt(newStaging)

          return {
            ...prev,
            layout: { ...ts, layoutStaging: newStaging, prompt },
          }
        })
        return
      }

      // --- Edit / Generate / View: standard select ---
      const currentPresetLabel = tabState.activePresetLabel
      if (currentPresetLabel) {
        const preset = findPresetByLabel(activeTab, currentPresetLabel)
        if (preset) {
          const newPrompt = buildPromptFromPreset(preset, img, activeTab, undefined, undefined, activeBrandData || undefined)
          // WP-13A: mirror prompt → loadedPrompt so Reset has a baseline.
          patchCurrentTab({
            selectedImage: img,
            prompt: newPrompt,
            promptSource: 'none',
            loadedPrompt: newPrompt,
            loadedPromptSource: 'none',
          })
          return
        }
      }
      // WP-1D: Run the 4-tier prompt-resolution waterfall.
      // Tier 1 (manifest) → Tier 2 (reprompt) → Tier 3 (sourcePrompt) → Tier 4 (empty).
      const resolved = resolvePrompt(img, imageManifests)
      patchCurrentTab({
        selectedImage: img,
        prompt: resolved.prompt,
        promptSource: resolved.source,
        // WP-13A: waterfall output is the Reset baseline for this image.
        loadedPrompt: resolved.prompt,
        loadedPromptSource: resolved.source,
      })
    },
    [patchCurrentTab, activeTab, perTabState, setPerTabState, imageManifests, activeBrandData]
  )

  const handlePromptChange = useCallback(
    (prompt: string) => {
      // WP-1D: When the user types, mark the prompt as 'modified' so the
      // source indicator flips away from "From IMAGES.md" etc.
      // WP-13A: loadedPrompt is intentionally NOT updated here — that's what
      // Reset restores the field to.
      patchCurrentTab({ prompt, promptSource: 'modified' })
    },
    [patchCurrentTab]
  )

  // WP-13A: Restore the last-loaded prompt (waterfall / preset / CD output).
  // Disabled in the UI when prompt already equals loadedPrompt.
  const handleReset = useCallback(() => {
    patchCurrentTab({
      prompt: currentState.loadedPrompt,
      promptSource: currentState.loadedPromptSource,
    })
  }, [patchCurrentTab, currentState.loadedPrompt, currentState.loadedPromptSource])

  const handleAspectRatioChange = useCallback(
    (aspectRatio: AspectRatio) => {
      patchCurrentTab({ aspectRatio })
    },
    [patchCurrentTab]
  )

  const handleResolutionChange = useCallback(
    (resolution: ImageSize) => {
      patchCurrentTab({ resolution })
    },
    [patchCurrentTab]
  )

  // --- Preset selection → prompt builder -------------------------------------
  const handlePresetSelect = useCallback(
    (preset: Preset) => {
      const prompt = buildPromptFromPreset(
        preset,
        currentState.selectedImage,
        activeTab,
        currentState.composeStaging,
        currentState.layoutStaging,
        activeBrandData || undefined
      )

      // WP-5 (added 2026-04-17): preset-driven Layout slot count.
      // When a layout preset declares minSlots/maxSlots, resize the staging
      // array to fit. Filled slots are preserved; new slots come in empty.
      // Without this, switching presets had zero visual effect on staging.
      if (activeTab === 'layout' && preset.kind === 'layout') {
        setPerTabState((prev) => {
          const ts = prev.layout
          const cur = ts.layoutStaging.slots
          const minS = preset.grid.minSlots
          const maxS = preset.grid.maxSlots
          // Snap to `minSlots` for fixed-size presets (Bento, Triptych, etc.).
          // Expandable presets keep extra slots up to `maxSlots`.
          let nextSize = preset.grid.allowsExpansion
            ? Math.max(cur.length, minS)
            : minS
          if (nextSize > maxS) nextSize = maxS

          // Preserve filled slots first; truncate empties from the tail.
          const filled = cur.filter(Boolean) as Array<NonNullable<typeof cur[number]>>
          const newSlots: typeof cur = [
            ...filled.slice(0, nextSize),
            ...Array(Math.max(0, nextSize - filled.length)).fill(null),
          ]

          return {
            ...prev,
            layout: {
              ...ts,
              activePresetLabel: preset.label,
              prompt,
              promptSource: 'none',
              // WP-13A: preset output is the Reset baseline for this tab.
              loadedPrompt: prompt,
              loadedPromptSource: 'none',
              layoutStaging: {
                slots: newSlots,
                activeSlotIndex: Math.min(
                  ts.layoutStaging.activeSlotIndex,
                  nextSize - 1
                ),
              },
            },
          }
        })
        return
      }

      // Preset-generated prompts are treated as 'none' (user hasn't modified them yet).
      // WP-13A: mirror prompt → loadedPrompt so Reset can restore the preset output.
      patchCurrentTab({
        activePresetLabel: preset.label,
        prompt,
        promptSource: 'none',
        loadedPrompt: prompt,
        loadedPromptSource: 'none',
      })
    },
    [patchCurrentTab, currentState.selectedImage, currentState.composeStaging, currentState.layoutStaging, activeTab, setPerTabState, activeBrandData]
  )

  // --- Compose/Layout staging controls ----------------------------------------
  const handleComposeReset = useCallback(() => {
    setPerTabState((prev) => ({
      ...prev,
      compose: {
        ...prev.compose,
        composeStaging: { sceneImage: null, subjectImages: [] },
        activePresetLabel: null,
        prompt: '',
      },
    }))
  }, [])

  const handleLayoutReset = useCallback(() => {
    setPerTabState((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layoutStaging: { slots: Array(INITIAL_LAYOUT_SLOTS).fill(null), activeSlotIndex: 0 },
        activePresetLabel: null,
        prompt: '',
      },
    }))
  }, [])

  const handleLayoutAddSlot = useCallback(() => {
    setPerTabState((prev) => {
      const ls = prev.layout.layoutStaging
      if (ls.slots.length >= 8) return prev // Max 8 slots
      const newSlots = [...ls.slots, null]
      const activeIdx = ls.activeSlotIndex < 0 ? newSlots.length - 1 : ls.activeSlotIndex
      return {
        ...prev,
        layout: {
          ...prev.layout,
          layoutStaging: { slots: newSlots, activeSlotIndex: activeIdx },
        },
      }
    })
  }, [])

  const handleLayoutSlotClick = useCallback((index: number) => {
    setPerTabState((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        layoutStaging: { ...prev.layout.layoutStaging, activeSlotIndex: index },
      },
    }))
  }, [])

  // --- Role badge map for AssetGrid ------------------------------------------
  // Maps image id → role label for compose/layout modes
  const roleBadgeMap = useMemo(() => {
    const map: Record<string, { label: string; color: string }> = {}
    if (activeTab === 'compose') {
      const { sceneImage, subjectImages } = currentState.composeStaging
      if (sceneImage) map[sceneImage.id] = { label: 'Scene', color: '#8B5CF6' }
      subjectImages.forEach((img) => {
        map[img.id] = { label: 'Subj', color: '#F59E0B' }
      })
    } else if (activeTab === 'layout') {
      currentState.layoutStaging.slots.forEach((img, i) => {
        if (img) {
          map[img.id] = { label: i === 0 ? 'Hero' : String(i + 1), color: '#10B981' }
        }
      })
    }
    return map
  }, [activeTab, currentState.composeStaging, currentState.layoutStaging])

  // --- Tab switching ---------------------------------------------------------
  const handleTabClick = useCallback((tab: AdvancedTab) => {
    setActiveTab(tab)
    // No need to save/restore — perTabState already holds all tabs' state
  }, [])

  // --- Copy description to prompt (non-destructive, insert at cursor) --------
  const promptEditorRef = useRef<PromptEditorHandle>(null)
  const handleCopyDescription = useCallback((description: string) => {
    // Insert description into prompt at current cursor position.
    // Uses setPerTabState directly — avoids stale-closure issues with useImperativeHandle.
    const ta = promptEditorRef.current?.getTextarea?.() ?? null
    setPerTabState((prev) => {
      const cur = prev[activeTab]
      const curPrompt = cur.prompt
      let newPrompt: string
      if (ta && typeof ta.selectionStart === 'number') {
        const start = ta.selectionStart
        const end = ta.selectionEnd ?? start
        const before = curPrompt.slice(0, start)
        const after = curPrompt.slice(end)
        const separator = before && !before.endsWith('\n') ? '\n\n' : ''
        const trailer = after && !after.startsWith('\n') ? '\n\n' : ''
        newPrompt = before + separator + description + trailer + after
      } else {
        newPrompt = curPrompt ? `${curPrompt}\n\n${description}` : description
      }
      return { ...prev, [activeTab]: { ...cur, prompt: newPrompt } }
    })
  }, [activeTab])

  // --- Generation pipeline (WP-2C) ------------------------------------------
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  // Track consecutive failures for escalation
  const consecutiveFailsRef = useRef(0)

  /**
   * Map Advanced Mode tab → API operation field.
   * 'generate' = pure generation (no source images).
   * Everything else goes through edit pipeline with source images.
   */
  function tabToOperation(tab: AdvancedTab): string {
    if (tab === 'generate') return 'generate'
    if (tab === 'compose') return 'compose'
    // edit, layout, view(shouldn't happen) all use 'edit'
    return 'edit'
  }

  /**
   * Build source image paths for the API call.
   * Generate: no sources. Edit: selected image. Compose/Layout: all staged images.
   */
  function getSourcePaths(tab: AdvancedTab, selected: SourceImage | null): string[] {
    if (tab === 'generate') return []
    if (tab === 'compose') {
      const staging = currentState.composeStaging
      const paths: string[] = []
      if (staging.sceneImage) paths.push(staging.sceneImage.path)
      staging.subjectImages.forEach((img) => paths.push(img.path))
      return paths
    }
    if (tab === 'layout') {
      return currentState.layoutStaging.slots.filter(Boolean).map((img) => img!.path)
    }
    // Edit: selected image
    if (selected) return [selected.path]
    return []
  }

  /**
   * Walk an image's parent chain back to the original upload / pure-generate
   * root. Used to build filenames that don't accumulate prefixes on
   * successive edits — `vibrant-warm-night-sultan.jpg` becomes just
   * `night-sultan.jpg` because the slug is `night` + the root `sultan`,
   * regardless of intermediate edits.
   *
   * Returns the root's basename (no extension). Capped at 8 hops so a
   * cycle in parentImage links can't infinite-loop. (Ralph 2026-04-25.)
   */
  const findRootBasename = useCallback(
    (start: SourceImage): string => {
      const seen = new Set<string>()
      let curr: SourceImage = start
      for (let i = 0; i < 8; i++) {
        if (!curr.parentImage || seen.has(curr.filename)) break
        seen.add(curr.filename)
        const parent = sourceImages.find((img) => img.filename === curr.parentImage)
        if (!parent) break
        curr = parent
      }
      return curr.filename.replace(/\.[^/.]+$/, '')
    },
    [sourceImages],
  )

  /**
   * Build the filename hint sent to /api/edit-image.
   *
   * Formula:
   *   - Edit / Compose / Layout (have a source): `{actionSlug}-{rootBasename}`
   *     where actionSlug is the preset label slugged (e.g. "vibrant",
   *     "night-scene") or the tab name as fallback. rootBasename is the
   *     original upload's name, found by walking parentImage links — so
   *     repeated edits don't grow `vibrant-warm-night-sultan.jpg`; instead
   *     each edit produces `{newAction}-sultan.jpg`.
   *   - Generate (no source): just `{actionSlug}` (preset slug, or 'generated').
   *
   * Returns undefined when no meaningful hint can be built; the server
   * then falls back to its description-slug pipeline.
   */
  const buildFilenameHint = useCallback(
    (
      tab: AdvancedTab,
      source: SourceImage | null,
      presetLabel: string | null,
      stagedSources: SourceImage[],
    ): string | undefined => {
      const slugify = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const action = presetLabel ? slugify(presetLabel) : tab
      if (tab === 'generate') {
        return action || undefined
      }
      // For edit/compose/layout, anchor on a root source name.
      const anchor =
        source ?? stagedSources.find(Boolean) ?? null
      if (!anchor) return action || undefined
      const root = findRootBasename(anchor)
      const trimmed = root.length > 32 ? root.slice(0, 32) : root
      return action ? `${action}-${trimmed}` : trimmed
    },
    [findRootBasename],
  )

  const handleGenerate = useCallback(async () => {
    const { prompt, selectedImage, aspectRatio, resolution, activePresetLabel } = currentState
    if (!prompt.trim()) return

    setIsGenerating(true)
    setGenerationError(null)

    const operation = tabToOperation(activeTab)
    const sourceImagePaths = getSourcePaths(activeTab, selectedImage)

    // Build a meaningful filename hint from preset + source root. Server
    // uses this when present (and not generic) — falls back to slugging
    // Nano's description otherwise. Restored Ralph 2026-04-25 after the
    // server-only path produced names like `close-low-2.jpg` from camera
    // vocabulary in Nano descriptions.
    const stagedSources: SourceImage[] = []
    if (activeTab === 'compose') {
      const s = currentState.composeStaging
      if (s.sceneImage) stagedSources.push(s.sceneImage)
      s.subjectImages.forEach((i) => stagedSources.push(i))
    } else if (activeTab === 'layout') {
      currentState.layoutStaging.slots
        .filter((i): i is SourceImage => Boolean(i))
        .forEach((i) => stagedSources.push(i))
    }
    const filenameHint = buildFilenameHint(
      activeTab,
      selectedImage,
      activePresetLabel || null,
      stagedSources,
    )

    const payload = {
      sourceImagePaths,
      instruction: prompt,
      filename: filenameHint,
      imageSize: resolution,
      aspectRatio,
      operation,
      sessionId,
      // WP-1C/2C: extra metadata so the server can persist a complete
      // GenerationRecord to LINEAGE.json (lineage survives page refresh).
      preset: activePresetLabel || '',
      mode: activeTab,
    }

    // eslint-disable-next-line no-console
    console.log('[AdvancedMode] Generate payload:', payload)

    try {
      const response = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API error ${response.status}`)
      }

      const result = await response.json()

      // Reset consecutive failures on success
      consecutiveFailsRef.current = 0

      // Build a new SourceImage for the generated result.
      // WP-1C: attach lineage (parentImage(s), generationMode, preset) so the
      // version sidebar can walk the chain.
      const parentFilenames = sourceImagePaths.map((p) => p.split('/').pop() || p)
      const newImage: SourceImage = {
        id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        // Server owns filename generation now; fallback covers the rare
        // case where the API didn't echo one back (e.g. non-base64 result).
        filename: result.filename || 'generated-image.jpg',
        path: result.savedPath || '',
        uploadedAt: new Date().toISOString(),
        isGenerated: true,
        sourcePrompt: prompt,
        generationStatus: 'pending',
        analysis: result.geminiText
          ? {
              elements: [],
              description: result.geminiText,
              suggestedExtractions: [],
            }
          : undefined,
        // Lineage (WP-1C)
        parentImage: parentFilenames[0],            // single parent for edit/generate chains
        parentImages: parentFilenames.length > 1 ? parentFilenames : undefined,
        generationMode: activeTab as 'generate' | 'edit' | 'compose' | 'layout',
        preset: activePresetLabel || undefined,
      }

      // eslint-disable-next-line no-console
      console.log('[AdvancedMode] Generation success:', newImage.filename, '→', newImage.path)

      // Notify parent to add the new image to sourceImages
      onImageGenerated?.(newImage)

      // ── WP-15 (added 2026-04-17): CD outcomes → snackbars ──
      // edit-image returns structured proofread + verdict objects from the
      // Big CD bridge. We surface them as snackbars in the order they
      // happened (proofread first because it shaped the prompt; verdict
      // second because it judges the result).
      if (sessionId && result.proofread) {
        const pr = result.proofread as {
          severity: 'pass' | 'advisory' | 'rewritten' | 'error'
          note: string
          finalPrompt: string
        }
        if (pr.severity === 'rewritten') {
          // Reflect CD's rewrite back to Zone 4 so the user sees what was sent.
          patchCurrentTab({ prompt: pr.finalPrompt, promptSource: 'reprompt' })
          emitCDProofreadRewritten(sessionId, {
            note: pr.note,
            oldPrompt: prompt,
            newPrompt: pr.finalPrompt,
            mode: activeTab,
          })
        } else if ((pr.severity === 'advisory' || pr.severity === 'error') && pr.note) {
          // Surface advisory + error both — silent failures are exactly what
          // we are trying to avoid. 'pass' is the only silent case.
          emitCDProofreadAdvisory(sessionId, {
            note: pr.severity === 'error' ? `Proofread failed: ${pr.note}` : pr.note,
            mode: activeTab,
            filename: newImage.filename,
          })
        }
      }

      if (sessionId && result.verdict) {
        const vd = result.verdict as {
          verdict: '✓' | '≈' | '✗' | 'error'
          note: string
        }
        // Always emit — including 'error'. Silent failures hide bugs.
        emitCDVerdict(sessionId, {
          verdict: vd.verdict === 'error' ? '✗' : vd.verdict,
          note: vd.verdict === 'error' ? `Verdict failed: ${vd.note}` : vd.note,
          filename: newImage.filename,
          mode: activeTab,
        })
      }

      // Select the new image in the current tab so it shows in Zone 2
      patchCurrentTab({ selectedImage: newImage })

      // WP-8A (rewritten 2026-04-17 per audit P1):
      // Auto hot-swap by SOURCE LOOKUP, not by filename inference.
      //
      // The spec wants us to "check IMAGES.md vibe assignments for matching
      // slot." The previous implementation inferred slot from the new
      // filename's regex pattern (`{prefix}-{slot}-v{n}`) — but `buildFilename`
      // produces names like `edited-vibrant-sultan.jpg` which never match.
      // Result: pipeline was wired but never fired in practice.
      //
      // The fix: look up where the SOURCE/PARENT image is currently used
      // across all vibe pages, and swap each of those slots to the new
      // generated image. This matches the spec's intent ("Generate a new
      // image FROM sultan.jpg → does it auto-swap into vibes that use
      // sultan.jpg?") and works regardless of generated-filename shape.
      try {
        const parentFilename = parentFilenames[0]
        if (parentFilename && sessionId) {
          // Discover where the parent is currently used.
          const slotsRes = await fetch(
            `/api/sessions/${sessionId}/vibe-slots`
          )
          if (slotsRes.ok) {
            const { groups = [] } = await slotsRes.json() as {
              groups?: Array<{
                pages: Array<{
                  filename: string
                  slots: Array<{ slot: string; currentImage: string }>
                }>
              }>
            }

            const matches: Array<{ vibe: string; slot: string; oldImage: string }> = []
            for (const g of groups) {
              for (const p of g.pages) {
                for (const s of p.slots) {
                  if (s.currentImage === parentFilename) {
                    matches.push({ vibe: p.filename, slot: s.slot, oldImage: s.currentImage })
                  }
                }
              }
            }

            // Fire one targeted swap per (vibe, slot) match.
            const updatedVibes: string[] = []
            for (const m of matches) {
              const r = await fetch(
                `/api/sessions/${sessionId}/assign-slot`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    vibe: m.vibe,
                    slot: m.slot,
                    filename: newImage.filename,
                  }),
                }
              )
              if (r.ok) {
                updatedVibes.push(m.vibe)
                // 2026-04-29 Phase 2: removed `emitHotSwap(...)` here.
                // /api/sessions/[id]/assign-slot now publishes
                // `hotswap_complete` to the event-bus server-side; the
                // /api/events SSE delivers it to BOTH the frontend (sessionEvents)
                // AND the MCP server (CD as logging notification).
              }
            }

            if (updatedVibes.length > 0) {
              // eslint-disable-next-line no-console
              console.log(
                `[AdvancedMode] 🔄 Auto-swapped ${parentFilename} → ${newImage.filename} in ${updatedVibes.length} slot(s) across ${new Set(updatedVibes).size} page(s)`
              )
            }
          }
        }
      } catch (err) {
        // Auto-swap is best-effort — never block the main flow
        // eslint-disable-next-line no-console
        console.warn('[AdvancedMode] Auto hot-swap failed:', err)
      }
    } catch (err: unknown) {
      consecutiveFailsRef.current++
      const message =
        err instanceof Error ? err.message : 'Generation failed — unknown error'
      const escalated = consecutiveFailsRef.current >= 3
      setGenerationError(
        escalated
          ? `${message} (${consecutiveFailsRef.current} consecutive failures — check network / API status)`
          : message
      )
      // eslint-disable-next-line no-console
      console.error('[AdvancedMode] Generation failed:', message)
    } finally {
      setIsGenerating(false)
    }
  }, [sessionId, activeTab, currentState, patchCurrentTab, onImageGenerated])

  /** Retry: re-runs generate with the exact same payload (prompt untouched). */
  const handleRetry = useCallback(() => {
    handleGenerate()
  }, [handleGenerate])

  // --- Ask CD (WP-6A) -------------------------------------------------------
  const [cdMessage, setCDMessage] = useState('')
  const [isCDLoading, setIsCDLoading] = useState(false)
  const [cdFeedback, setCDFeedback] = useState<string | null>(null)

  const handleAskCD = useCallback(
    async (messageOverride?: string) => {
      // Two call sites — PresetsStaging (uses cdMessage state) and the new
      // ImageChatPanel (passes message directly to sidestep React's
      // batched-state-update tick). Override wins so the chat column doesn't
      // have to await a re-render before sending.
      const userMessage = (messageOverride ?? cdMessage).trim()
      if (!userMessage || isCDLoading) return

      setIsCDLoading(true)
      setCDFeedback(null)

      // Build context about what the user is looking at
      const selectedImage = currentState.selectedImage
      const imageCtx = selectedImage
        ? {
            filename: selectedImage.filename,
            description:
              selectedImage.analysis?.description || selectedImage.cdNotes || '',
          }
        : undefined

      // Staged images context (compose/layout)
      let stagedImages: { scene?: string; subjects?: string[]; slots?: string[] } | undefined
      if (activeTab === 'compose') {
        const { sceneImage, subjectImages } = currentState.composeStaging
        stagedImages = {
          scene: sceneImage?.filename,
          subjects: subjectImages.map((img) => img.filename),
        }
      } else if (activeTab === 'layout') {
        stagedImages = {
          slots: currentState.layoutStaging.slots
            .filter(Boolean)
            .map((img) => img!.filename),
        }
      }

      const body = {
        source: 'advanced-mode' as const,
        mode: activeTab === 'view' ? 'generate' : activeTab,
        image: imageCtx,
        currentPrompt: currentState.prompt,
        stagedImages,
        userMessage,
        // 2026-04-17: required by the WP-15-refactored /api/ask-cd route.
        // Without it the route rejects with 400 ("Big CD only — no stateless
        // fallback") because every CD interaction must go through the session's
        // own bridge, not an anonymous spawn.
        sessionId,
      }

      try {
        const response = await fetch('/api/ask-cd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `CD error ${response.status}`)
        }

        const parsed = await response.json()

        // Route image prompt to Zone 4 ONLY when CD explicitly committed one
        // via `## IMAGE PROMPT` (tier 1 or 2). Tier 5 = conversational reply,
        // Zone 4 stays untouched so the user doesn't accidentally Generate
        // CD's question text. (Heuristic tiers 3+4 dropped 2026-04-17 — they
        // were the cause of the bug Ralph caught.)
        if (parsed.imagePrompt && (parsed.tier === 1 || parsed.tier === 2)) {
          // WP-13A: CD's prompt is the new Reset baseline (replaces waterfall output).
          patchCurrentTab({
            prompt: parsed.imagePrompt,
            promptSource: 'reprompt',
            loadedPrompt: parsed.imagePrompt,
            loadedPromptSource: 'reprompt',
          })
          // Clear the CD message after successful routing
          setCDMessage('')
        }

        // Show feedback inline (always — feedback or full conversational reply)
        if (parsed.feedback) {
          setCDFeedback(parsed.feedback)
        }

        // Snackbar rule: only surface CD's conversational reply as a snackbar
        // when the chat feed isn't visible (i.e. content mode = preview). In
        // chat mode, the reply already lands in the chat feed, so a snackbar
        // would be noise. Image-related snackbars (proofread, verdict) still
        // fire from elsewhere — this gate only affects free-chat replies.
        if (
          sessionId &&
          parsed.tier === 5 &&
          parsed.feedback &&
          chatContent === 'vibe'
        ) {
          emitCDComment(sessionId, {
            content: parsed.feedback,
            source: `image-mode:${activeTab}`,
          })
        }

        // Append CD's reply to the shared chat log (visible in the new
        // ImageChatPanel AND in Studio Briefing — one CD, one log).
        // For tier 1/2 we include a marker that the prompt was committed to
        // Zone 4 so the chat thread reflects what actually happened.
        if (onAppendAssistantMessage) {
          const committed =
            parsed.imagePrompt && (parsed.tier === 1 || parsed.tier === 2)
          const logBody = committed
            ? `**Committed to Zone 4 prompt:**\n\n\`\`\`\n${parsed.imagePrompt}\n\`\`\`${parsed.feedback ? `\n\n${parsed.feedback}` : ''}`
            : parsed.feedback || '(no reply)'
          onAppendAssistantMessage(logBody)
        }

        // eslint-disable-next-line no-console
        console.log(
          `[AdvancedMode] Ask CD result: tier=${parsed.tier}, prompt=${!!parsed.imagePrompt && (parsed.tier === 1 || parsed.tier === 2)}`,
        )
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Ask CD failed'
        setCDFeedback(`Error: ${message}`)
        // eslint-disable-next-line no-console
        console.error('[AdvancedMode] Ask CD failed:', message)
      } finally {
        setIsCDLoading(false)
      }
    },
    [
      cdMessage,
      isCDLoading,
      activeTab,
      currentState,
      patchCurrentTab,
      sessionId,
      onAppendAssistantMessage,
      chatContent,
    ],
  )

  /**
   * Review by AI — Ralph 2026-04-23.
   *
   * Hands the CURRENT Zone 4 prompt to CD for refinement. CD returns a
   * `## IMAGE PROMPT` block; handleAskCD's existing tier-1/2 routing puts
   * it back into Zone 4 (replacing the user's text). Messaging is crafted
   * so CD understands "review my prompt and commit a refined version,"
   * not "chat about my prompt."
   *
   * Why we reuse handleAskCD rather than a new endpoint:
   *   - All the session/bridge wiring already exists there
   *   - The tier-1/2 imagePrompt → Zone 4 routing is proven
   *   - Chat log paper-trail fires automatically
   */
  const handleReviewByAI = useCallback(() => {
    const current = currentState.prompt.trim()
    if (!current || isCDLoading) return
    const review =
      `Review the IMAGE PROMPT I currently have in Zone 4 below. ` +
      `Improve clarity, specificity, and Nano Banana readiness — fix ` +
      `ambiguity, tighten phrasing, keep my intent. Return the refined ` +
      `version inside a \`## IMAGE PROMPT\` block so it replaces Zone 4. ` +
      `If it's already excellent, return it unchanged.\n\n` +
      `Current prompt:\n\`\`\`\n${current}\n\`\`\``
    handleAskCD(review)
  }, [currentState.prompt, isCDLoading, handleAskCD])

  // WP-11A: Delete with orphan guard.
  // Ralph 2026-04-23: orphan guard now only blocks on HTML references
  // (where deleting actually breaks a rendered page). Metadata-only
  // references (SESSION.md, CREATIVE-BRIEF.md, BUILD.md, IMAGES.md,
  // vibe-*.md) are scrubbed silently — they're logs/drafts, safe to
  // delete through. The `kind` field comes from /api/director/delete-image.
  type DeleteRef = { file: string; context: string; kind: 'html' | 'metadata' }
  const [deleteDialog, setDeleteDialog] = useState<{
    image: SourceImage
    references: DeleteRef[]
  } | null>(null)
  const [undoBackup, setUndoBackup] = useState<{
    image: SourceImage
    timer: ReturnType<typeof setTimeout>
  } | null>(null)

  const handleDeleteImage = useCallback(async (image: SourceImage) => {
    if (!sessionId) return
    try {
      // Step 1: Scan for references
      const res = await fetch('/api/director/delete-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, filename: image.filename, action: 'scan' }),
      })
      const data = await res.json()
      const refs: DeleteRef[] = data.references || []
      const blocking = refs.filter((r) => r.kind === 'html')

      if (blocking.length > 0) {
        // Show guard dialog — only when an HTML page actually renders this
        // image. The dialog lists ALL refs (blocking + metadata) so the
        // user sees the full picture when they confirm the override.
        setDeleteDialog({ image, references: refs })
      } else {
        // No HTML references — delete directly even if metadata mentions
        // exist. IMAGES.md gets scrubbed by the delete action; other
        // markdown is left as historical record.
        await executeDelete(image)
      }
    } catch (err) {
      console.error('[delete] Scan failed:', err)
    }
  }, [sessionId])

  const executeDelete = useCallback((image: SourceImage) => {
    if (!sessionId) return
    setDeleteDialog(null)

    // Delete UX (Ralph 2026-04-23):
    //   - Remove from React state immediately so the tile disappears.
    //   - Keep the file on DISK for the 5-second undo window.
    //   - Fire the actual DELETE API call only when the timer expires.
    //   - If Undo is clicked: clearTimeout → API never runs → file stays.
    //
    // This is the only way the file-restore semantics can actually work
    // given there's no snapshot/backup on the server side. The previous
    // implementation deleted the file immediately and left Undo as a
    // lying button that re-added a broken reference.
    const timer = setTimeout(() => {
      // Committed delete — fire and forget. Errors stay in the console;
      // we don't re-surface the tile because from the user's POV the
      // delete was already "done" 5 seconds ago.
      fetch('/api/director/delete-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          filename: image.filename,
          action: 'delete',
        }),
      })
        .then((res) => {
          if (!res.ok) {
            console.error('[delete] Server rejected:', res.status)
          } else {
            console.log(`[delete] Committed ${image.filename}`)
          }
        })
        .catch((err) => console.error('[delete] Commit failed:', err))
      setUndoBackup(null)
    }, 5000)

    setUndoBackup({ image, timer })
    if (onRemoveImage) onRemoveImage(image.id)
  }, [sessionId, onRemoveImage])

  // WP-11B: Replace all occurrences
  const [replaceDialog, setReplaceDialog] = useState<{
    source: SourceImage
    scanResult: { totalCount: number; vibeCount: number; occurrences: Array<{ file: string; count: number; types: string[] }> } | null
    selectedTarget: SourceImage | null
  } | null>(null)

  const handleReplaceAll = useCallback(async (image: SourceImage) => {
    if (!sessionId) return
    try {
      const res = await fetch('/api/director/replace-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, sourceFilename: image.filename, action: 'scan' }),
      })
      const data = await res.json()
      setReplaceDialog({ source: image, scanResult: data, selectedTarget: null })
    } catch (err) {
      console.error('[replace-all] Scan failed:', err)
    }
  }, [sessionId])

  const executeReplaceAll = useCallback(async () => {
    if (!sessionId || !replaceDialog?.source || !replaceDialog?.selectedTarget) return
    try {
      const res = await fetch('/api/director/replace-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          sourceFilename: replaceDialog.source.filename,
          targetFilename: replaceDialog.selectedTarget.filename,
          action: 'replace',
        }),
      })
      const result = await res.json().catch(() => ({}))
      console.log(
        `[replace-all] Replaced ${replaceDialog.source.filename} → ${replaceDialog.selectedTarget.filename}` +
        (result?.reconcile
          ? ` | tags: +${result.reconcile.promoted?.length ?? 0} USED, -${result.reconcile.demoted?.length ?? 0} demoted`
          : ''),
      )
      setReplaceDialog(null)
      // Ralph 2026-04-25: server reconciled IMAGES.md tags after the swap.
      // Pull them back into React state so the displaced source drops its
      // USED pill and the new target picks it up. Without this the panel
      // stays stale until the next chat-driven refresh.
      await onSourceImagesRefresh?.()
    } catch (err) {
      console.error('[replace-all] Failed:', err)
    }
  }, [sessionId, replaceDialog, onSourceImagesRefresh])

  // --- Derived rendering flags -----------------------------------------------
  const isViewMode = activeTab === 'view'
  // 2026-04-17: Brand tab now rides the normal Zone 1/2/3/4 layout like every
  // other tab. The old BrandingPanel special case was removed — Brand is just
  // a preset category defined in lib/image-presets.ts (BRAND_PRESETS).

  // Zone 2 + Zone 3 + Zone 4 layout inside .content
  // View mode:  Zone 2 fills entirely (no Zone 3/4)
  // Other modes (inc. Brand): Zone 2 top half, Zone 3 bottom-left, Zone 4 bottom-right

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <div
      style={{
        flex: 1,
        color: 'var(--text-main)',
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: 13,
        display: 'grid',
        // Match BRIEF mode's 12-col grid + gap between bento cards
        gridTemplateColumns: 'repeat(12, 1fr)',
        gridTemplateRows: isViewMode ? '1fr' : '3fr 2fr',
        gap: 'var(--gap-app)',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* LEFT BENTO CARD: Asset library — spans all content rows.
          Width: 4 cols (collapsed) / 2 cols (expanded chat). */}
      <div
        className="bento-card"
        style={{
          gridColumn: `span ${effectiveExpanded ? 2 : 4}`,
          gridRow: isViewMode ? '1' : '1 / 3',
          overflow: 'hidden',
          display: 'flex',
          minHeight: 0,
        }}
      >
        <AssetGrid
          sourceImages={sourceImages}
          selectedImageId={currentState.selectedImage?.id ?? null}
          onSelect={handleSelectImage}
          roleBadgeMap={roleBadgeMap}
          onDelete={handleDeleteImage}
          onReplaceAll={handleReplaceAll}
          onUpload={onUpload}
        />
      </div>

      {/* ZONE 2 BENTO CARD: Canvas preview + tab bar (bar at BOTTOM per Ralph 2026-04-18).
          Zone 2 spans the same cols as Zone 3 + Zone 4 combined.
          Collapsed: cols 5/11 (span 6 = Z3:2 + Z4:4).
          Expanded:  cols 3/7  (span 4 = Z3:2 + Z4:2).
          Grid: 1fr canvas | 56px tab bar. DOM order reversed (body first, bar second)
          so the bar naturally lands in row 2. Border flips to borderTop so the
          separator still sits between the two — just on the bar's upper edge. */}
      <div
        className="bento-card"
        style={{
          gridColumn: effectiveExpanded ? '3 / span 4' : '5 / span 6',
          gridRow: '1',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: '1fr 56px',
          minHeight: 0,
        }}
      >
        {/* Tab bar = card FOOTER (explicit gridRow: 2 pins it to the bottom track).
            The canvas body below uses gridRow: 1 so DOM order stays as-is. */}
        <div
          style={{
            height: 56,
            minHeight: 56,
            borderTop: '1px solid var(--border-card)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            gap: 12,
            gridRow: 2,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: 4,
              background: 'var(--pill-bg)',
              borderRadius: 8,
              border: '1px solid var(--pill-border)',
            }}
          >
            {TABS.map((tab) => {
              const active = tab.id === activeTab
              const color = TAB_COLORS[tab.id]
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: active ? color : 'transparent',
                    color: active ? '#fff' : 'var(--text-muted)',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textTransform: 'uppercase',
                    boxShadow: active ? `0 1px 3px ${color}4D` : 'none',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--text-main)'
                      ;(e.currentTarget as HTMLElement).style.background = 'var(--hover-overlay)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
                      ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                    }
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1 }} />

          {/* WP-8B (2026-04-17): Assign-to-Vibe toggle — right side of the
              tab bar. Feather-style panel-right-open icon indicates that
              clicking will slide out the assign drawer from the right. */}
          {(() => {
            const canAssign = Boolean(
              sessionId && currentState.selectedImage && activeTab !== 'layout'
            )
            const iconColor = assignOpen ? '#10B981' : 'var(--text-muted)'
            return (
              <button
                onClick={() => {
                  if (canAssign) setAssignOpen((v) => !v)
                }}
                disabled={!canAssign}
                aria-pressed={assignOpen}
                title={
                  canAssign
                    ? assignOpen
                      ? 'Close assign drawer'
                      : 'Assign this image to a vibe slot'
                    : activeTab === 'layout'
                      ? 'Layout mode — assign not available'
                      : 'Select an image to assign'
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: `1px solid ${assignOpen ? '#10B981' : 'var(--pill-border)'}`,
                  background: assignOpen ? 'rgba(16,185,129,0.08)' : 'transparent',
                  color: iconColor,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  cursor: canAssign ? 'pointer' : 'not-allowed',
                  opacity: canAssign ? 1 : 0.4,
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!canAssign || assignOpen) return
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--text-main)'
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--hover-overlay)'
                }}
                onMouseLeave={(e) => {
                  if (!canAssign || assignOpen) return
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <span>Assign</span>
                {/* Feather-style panel-right-open icon (Lucide, inlined to
                    match the rest of the app which uses inline SVG).
                    rect = panel boundary; vertical line at x=15 marks the
                    drawer gutter; chevron inside points rightward when
                    closed, leftward when open. */}
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
                  style={{ flexShrink: 0 }}
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M15 3v18" />
                  {assignOpen ? (
                    // Chevron pointing left = "close / retract"
                    <path d="m10 15-3-3 3-3" />
                  ) : (
                    // Chevron pointing right = "open / expand from right"
                    <path d="m8 9 3 3-3 3" />
                  )}
                </svg>
              </button>
            )
          })()}
        </div>

        {/* Canvas body — explicit gridRow: 1 (above the tab-bar footer). */}
        <div style={{ position: 'relative', overflow: 'hidden', minHeight: 0, gridRow: 1 }}>
          {/* Help text — floats on image, no background */}
          {!isViewMode && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    padding: '8px 20px',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    lineHeight: 1.5,
                    zIndex: 1,
                    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    pointerEvents: 'none',
                  }}
                >
                  {TAB_HELP[activeTab]}
                </div>
              )}
              <CanvasPreview
                selectedImage={currentState.selectedImage}
                onCopyDescription={handleCopyDescription}
                onSelectVersion={(img) => patchCurrentTab({ selectedImage: img })}
                activeTab={activeTab}
                layoutStaging={currentState.layoutStaging}
                sourceImages={sourceImages}
                sessionId={sessionId}
                assignOpen={assignOpen}
                onCloseAssign={() => setAssignOpen(false)}
                isGenerating={isGenerating}
                activePresetLabel={currentState.activePresetLabel}
                onAssignedToVibe={(_result) => {
                  // 2026-04-29 Phase 2: snackbar is now driven by server-side
                  // `publish('hotswap_complete')` from /api/sessions/[id]/assign-slot.
                  // /api/events SSE → frontend useEffect → sessionEvents → snackbar.
                  // No client-side emit needed.
                }}
              />
        </div>

      </div>

      {/* ZONE 3 BENTO CARD: Presets / Staging. Ask CD moved to chat column (2026-04-18).
          Width: 2 cols, always. Starts at col 5 (collapsed) or col 3 (expanded). */}
      {!isViewMode && (
        <div
          className="bento-card"
          style={{
            gridColumn: effectiveExpanded ? '3 / span 2' : '5 / span 2',
            gridRow: 2,
            overflow: 'hidden',
            display: 'flex',
            minHeight: 0,
          }}
        >
          <PresetsStaging
            activeTab={activeTab}
            activePresetLabel={currentState.activePresetLabel}
            onPresetSelect={handlePresetSelect}
            composeStaging={currentState.composeStaging}
            layoutStaging={currentState.layoutStaging}
            onComposeReset={handleComposeReset}
            onLayoutReset={handleLayoutReset}
            onLayoutAddSlot={handleLayoutAddSlot}
            onLayoutSlotClick={handleLayoutSlotClick}
            sourceImages={sourceImages}
            // Ask CD — visible ONLY when the chat column is covered by the
            // vibe preview iframe. Otherwise the chat column's own input
            // is the entry point. Reply surfaces as snackbar via the same
            // handleAskCD path (emitCDComment for tier-5 conversational).
            showAskCD={chatContent === 'vibe'}
            cdMessage={cdMessage}
            onCDMessageChange={setCDMessage}
            onSendToCD={() => handleAskCD()}
            isCDLoading={isCDLoading}
            cdFeedback={cdFeedback}
          />
        </div>
      )}

      {/* ZONE 4 BENTO CARD: Prompt editor.
          Hidden only in View mode. */}
      {!isViewMode && (
        <div
          className="bento-card"
          style={{
            // Zone 4: prompt editor. Collapsed=4 cols (col 7/10), expanded=2 cols (col 5/6).
            gridColumn: effectiveExpanded ? '5 / span 2' : '7 / span 4',
            gridRow: 2,
            overflow: 'hidden',
            display: 'flex',
            minHeight: 0,
          }}
        >
          <PromptEditor
            ref={promptEditorRef}
            activeTab={activeTab}
            prompt={currentState.prompt}
            onPromptChange={handlePromptChange}
            aspectRatio={currentState.aspectRatio}
            onAspectRatioChange={handleAspectRatioChange}
            resolution={currentState.resolution}
            onResolutionChange={handleResolutionChange}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
            generationError={generationError}
            onRetry={handleRetry}
            promptSource={currentState.promptSource}
            onReset={handleReset}
            canReset={currentState.prompt !== currentState.loadedPrompt}
            onReviewAI={sessionId ? handleReviewByAI : undefined}
            isReviewingAI={isCDLoading}
          />
        </div>
      )}

      {/* CHAT BENTO CARD (2026-04-18): shared bridge conversation with Briefing.
          Always visible. Collapsed=2 cols (cols 11/12), expanded=6 cols (cols 7/12).
          Spans all rows so it's full-height next to the assets + canvas. */}
      <div
        className="bento-card"
        style={{
          gridColumn: effectiveExpanded ? '7 / span 6' : '11 / span 2',
          gridRow: isViewMode ? '1' : '1 / 3',
          overflow: 'hidden',
          display: 'flex',
          minHeight: 0,
        }}
      >
        <ImageChatPanel
          sessionId={sessionId}
          messages={chatMessages}
          isLoading={isCDLoading}
          onAskCD={async (userMessage) => {
            // Pass the message DIRECTLY to handleAskCD via the override
            // argument — setCDMessage + read-from-state-in-same-tick would
            // read the old closure value. Override bypasses React's
            // batched-update tick. Append the user turn to the shared log
            // first so Briefing sees it land before CD's reply does.
            onAppendUserMessage?.(userMessage)
            await handleAskCD(userMessage)
          }}
          expanded={effectiveExpanded}
          onToggleExpand={() => setChatExpanded((v) => !v)}
          contentMode={chatContent}
          onContentModeChange={setChatContent}
          vibeOptions={vibeOptions}
          selectedVibePath={selectedVibePath}
          onSelectVibePath={setSelectedVibePath}
          zone1SelectedImage={
            currentState.selectedImage
              ? { filename: currentState.selectedImage.filename, sessionId }
              : null
          }
          // Ralph 2026-04-23: AI edits performed inside Director Mode of
          // the embedded preview surface in Zone 1 via the same pipeline
          // Zone 4 generations use — `onImageGenerated` is the single
          // entry point parents have already wired to `setSourceImages`.
          onImageGenerated={onImageGenerated}
        />
      </div>

      {/* WP-11A: Delete guard dialog */}
      {deleteDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setDeleteDialog(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', marginBottom: 12 }}>
              Delete {deleteDialog.image.filename}?
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
              This image is referenced in:
            </div>
            <div style={{ marginBottom: 16 }}>
              {deleteDialog.references.map((ref, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text-dim)', padding: '2px 0', display: 'flex', gap: 6 }}>
                  <span style={{ color: '#F59E0B' }}>•</span>
                  <span>{ref.file} ({ref.context})</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 16, fontStyle: 'italic' }}>
              HTML references will be replaced with placeholder.jpg.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteDialog(null)}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border-card)',
                  background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => executeDelete(deleteDialog.image)}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Delete anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WP-11B: Replace all dialog */}
      {replaceDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setReplaceDialog(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 500,
              width: '90%',
              maxHeight: '80vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
              Replace {replaceDialog.source.filename} everywhere
            </div>
            {replaceDialog.scanResult && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12 }}>
                Found {replaceDialog.scanResult.totalCount} reference{replaceDialog.scanResult.totalCount !== 1 ? 's' : ''} across {replaceDialog.scanResult.vibeCount} vibe{replaceDialog.scanResult.vibeCount !== 1 ? 's' : ''}
              </div>
            )}

            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Replace with:
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 6, marginBottom: 16, maxHeight: 200 }}>
              {sourceImages
                .filter((img) => img.id !== replaceDialog.source.id)
                .map((img) => {
                  const isTarget = replaceDialog.selectedTarget?.id === img.id
                  return (
                    <div
                      key={img.id}
                      onClick={() => setReplaceDialog((d) => d ? { ...d, selectedTarget: img } : null)}
                      style={{
                        aspectRatio: '1',
                        borderRadius: 6,
                        border: `2px solid ${isTarget ? '#3B82F6' : 'transparent'}`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        backgroundImage: `url(${img.path})`,
                        cursor: 'pointer',
                        transition: 'border-color 0.12s',
                      }}
                      title={img.filename}
                    />
                  )
                })}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setReplaceDialog(null)}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border-card)',
                  background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={executeReplaceAll}
                disabled={!replaceDialog.selectedTarget}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: '1px solid rgba(59,130,246,0.4)',
                  background: replaceDialog.selectedTarget ? 'rgba(59,130,246,0.15)' : 'transparent',
                  color: replaceDialog.selectedTarget ? '#60a5fa' : 'var(--text-dim)',
                  fontSize: 11, fontWeight: 700,
                  cursor: replaceDialog.selectedTarget ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  opacity: replaceDialog.selectedTarget ? 1 : 0.5,
                }}
              >
                {replaceDialog.selectedTarget
                  ? `Replace ${replaceDialog.scanResult?.totalCount || 0} refs with ${replaceDialog.selectedTarget.filename}`
                  : 'Select target image'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WP-11A: Undo toast */}
      {undoBackup && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 8,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 9999,
            fontSize: 11,
            color: 'var(--text-main)',
          }}
        >
          <span>Deleted {undoBackup.image.filename}</span>
          <button
            onClick={() => {
              // Undo (Ralph 2026-04-23 fix): the executeDelete flow now
              // defers the actual disk delete for 5s. Clearing the timer
              // cancels that pending DELETE call — the file stays on disk,
              // IMAGES.md is untouched, HTML references are intact. All
              // we need to do on our side is re-add to React state.
              clearTimeout(undoBackup.timer)
              setUndoBackup(null)
              onImageGenerated?.(undoBackup.image)
            }}
            style={{
              padding: '3px 10px', borderRadius: 4, border: '1px solid #F59E0B',
              background: 'rgba(245,158,11,0.1)', color: '#F59E0B', fontSize: 10, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
