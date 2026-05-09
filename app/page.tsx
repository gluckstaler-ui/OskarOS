'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  createSessionAction,
  appendToSessionLogAction,
  logImageUploadAction,
  logImageGenerationAction,
  updateWorkflowStateAction,
  hotSwapAction,
  populateCreativeBriefAction,
  moveImagesToSessionAction,
  getImageManifestsAction,
  getImageEntriesAction,
  renameSessionAction,
} from '@/lib/session-actions'
import type { CreativeBriefContent } from '@/lib/session'
import { AssetsPanel } from '@/components/AssetsPanel'
import { AdvancedMode, type AdvancedTab } from '@/components/AdvancedMode'
import { VibesGallery, type VibeCardData } from '@/components/VibesGallery'
import { CanvasPanel } from '@/components/CanvasPanel'
import { LivePreviewWithDirector } from '@/components/studio/LivePreviewWithDirector'
// Phase 2 Tier S (2026-04-30): agent-initiated user-facing UI.
import { AskUserModal } from '@/components/AskUserModal'
// 2026-04-30 (Ralph): CDSnackbar deleted — its `cd.snackbar` events now
// route through the existing SnackbarProvider (same component every other
// snackbar in the app uses). The parallel CDSnackbar component never
// rendered properly. See components/SnackbarProvider.tsx case 'cd.snackbar'.
import { ConversationPanel } from '@/components/ConversationPanel'
import { useImagePipeline } from '@/lib/hooks/useImagePipeline'
import { resolveVibes } from '@/lib/vibe-resolver'
import { TopBar, type Order66Status } from '@/components/TopBar'
import { CompactionOverlay } from '@/components/CompactionOverlay'
import { FinalApprovalModal } from '@/components/PhaseGate'
import {
  emitImageReady,
  emitHotSwap,
  emitVibeReady,
  emitRegenerating,
  emitError,
  emitCDUploadEvaluated,
  sessionEvents,
  SessionEvent
} from '@/lib/session-events'
import {
  SourceImage,
  ImageAsset,
  ImageManifest,
  VibeData,
  VibePreview,
  ConversationMessage,
  WorkflowPhase,
  LayoutMode,
  MoodboardData,
  ImageQueueItem,
  SelectedElement,
  VibeEdits,
  StreamingProgress,
  StreamEvent,
  OskarPhase,
  WorkflowProgress,
  UploadEvalCardPayload,
} from '@/lib/types'

export default function Home() {
  // Session state - CRITICAL: This is the anchor for all filesystem operations
  const [sessionId, setSessionIdState] = useState<string | null>(null)
  const [businessName, setBusinessName] = useState<string>('')

  // Sentinel Ti — manual critique trigger from TopBar 🛡 button.
  // Switches AssetsPanel to FEEDBACK view and seeds the panel with a target;
  // the panel auto-runs the critique then clears pendingCritiqueTarget.
  const [assetsView, setAssetsView] = useState<'assets' | 'feedback'>('assets')
  const [pendingCritiqueTarget, setPendingCritiqueTarget] = useState<string | null>(null)

  // Persist sessionId so refresh reloads the same session
  const setSessionId = useCallback((id: string | null) => {
    setSessionIdState(id)
    if (id) {
      localStorage.setItem('oskar-session-id', id)
    } else {
      localStorage.removeItem('oskar-session-id')
    }
  }, [])

  // Sidecar pointer for the MCP stdio proxy (Ralph + JC, 2026-05-06).
  // Every sessionId change writes `.runtime/active-session` so the proxy
  // (which Claude Code spawned at startup with a frozen OSKAR_SESSION env
  // var) can pick up the new id without a Claude Code restart. The proxy
  // re-reads this file before each MCP message and re-handshakes when
  // the value changes. Fire-and-forget — failure is tolerable because
  // the env-var fallback covers the boot case.
  useEffect(() => {
    if (!sessionId) return
    void fetch('/api/active-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {
      // Sidecar write failed — proxy will keep using its previous session
      // until the next successful write. Not user-visible.
    })
  }, [sessionId])
  // Session management now handled via Admin page

  // Workflow state (legacy - kept for layout transitions)
  const [workflowPhase, setWorkflowPhase] = useState<WorkflowPhase>('discovery')

  // Layout mode — user's choice, persisted, NOTHING overrides it
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>('2-panel')
  useEffect(() => {
    const saved = localStorage.getItem('oskar-layout-mode')
    if (saved === '2-panel' || saved === '3-panel' || saved === 'image' || saved === 'gallery') {
      setLayoutModeState(saved)
    }
  }, [])
  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setLayoutModeState(mode)
    localStorage.setItem('oskar-layout-mode', mode)
  }, [])

  // OskarOS Phase System - simple 4-phase flow, ONE blocking modal at end
  const [workflowProgress, setWorkflowProgress] = useState<WorkflowProgress>({
    currentPhase: 'discovery',
    vibesGenerated: 0,
    vibesComplete: 0,
    selectedVibeIds: [],
    finalApproved: false
  })
  const [showFinalApproval, setShowFinalApproval] = useState(false)

  // Moodboard
  const [moodboard, setMoodboard] = useState<MoodboardData | undefined>(undefined)

  // Source images (uploaded by user)
  const [sourceImages, setSourceImages] = useState<SourceImage[]>([])

  // Vibes from CD agent
  const [vibes, setVibes] = useState<VibeData[]>([])
  const [selectedVibe, setSelectedVibe] = useState<VibeData | undefined>(undefined)

  // All HTML files in the session directory — used to widen the Director Mode
  // picker beyond just the resolved vibes (mockups, prototypes, raw HTML
  // dropped into public/{session}/ should also be openable).
  const [sessionHtmlFiles, setSessionHtmlFiles] = useState<{ name: string; path: string; vibeIndex?: number; title?: string }[]>([])

  // Available vibes for switcher (tracks build status)
  const [availableVibes, setAvailableVibes] = useState<VibePreview[]>([])
  const [selectedVibeFile, setSelectedVibeFile] = useState<string | null>(null)

  // Currently-viewed asset in the image editor UI.
  const [selectedAsset, setSelectedAsset] = useState<ImageAsset | undefined>(undefined)

  // Image pipeline subsystem — owns imageQueue + imageManifests + generateAsset.
  // See lib/hooks/useImagePipeline.ts for the full state machine.
  const {
    imageQueue,
    setImageQueue,
    imageManifests,
    setImageManifests,
    generateAsset,
  } = useImagePipeline({
    sessionId,
    selectedAssetId: selectedAsset?.id ?? null,
    onSelectedAssetUpdate: setSelectedAsset,
    onAssetRegenerated: (newImage) =>
      setSourceImages((prev) => [...prev, newImage]),
  })

  // Advanced Mode overlay (WP-1A)
  const [advancedMode, setAdvancedMode] = useState<{
    open: boolean
    initialTab: AdvancedTab
    initialImage: SourceImage | null
  }>({ open: false, initialTab: 'view', initialImage: null })

  const openAdvancedMode = useCallback(
    (opts: { tab?: AdvancedTab; image?: SourceImage | null } = {}) => {
      setAdvancedMode({
        open: true,
        initialTab: opts.tab ?? 'view',
        initialImage: opts.image ?? null,
      })
      // Switch to IMAGE layout mode
      setLayoutMode('image')
    },
    [setLayoutMode]
  )

  // Conversation
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Director Mode state
  const [directorMode, setDirectorMode] = useState(false)
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [vibeEdits, setVibeEdits] = useState<VibeEdits[]>([])
  const textEditDebounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Streaming state
  const [streamingText, setStreamingText] = useState('')
  const [streamingProgress, setStreamingProgress] = useState<StreamingProgress>({
    phase: 'idle',
    message: ''
  })
  const [useStreaming, setUseStreaming] = useState(true) // Toggle streaming mode
  const [billingMode, setBillingMode] = useState<'smpl' | 'cli' | 'api'>('smpl') // Execution mode: SMPL (tier alias), CLI (Claude ID), API (Anthropic direct)
  const [webDevModel, setWebDevModel] = useState<'claude-opus-4-7' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'>('claude-sonnet-4-6') // WebDev model
  const [theme, setThemeState] = useState<'onyx' | 'polar'>('onyx') // Theme: ONYX (dark) or POLAR (light)

  // Apply theme synchronously at click time (before React commits). Without
  // this, the data-theme attribute is set in a useEffect AFTER the render,
  // which pushes the CSS-variable cascade one frame later than the click.
  // Toggles should feel instant.
  const setTheme = useCallback((next: 'onyx' | 'polar') => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next)
      // Persist in the same synchronous step so a refresh mid-animation is safe
      try { localStorage.setItem('oskar_theme', next) } catch { /* SSR / incognito */ }
    }
    setThemeState(next)
  }, [])

  // Ref that always holds the latest webDevModel. handleStreamingMessage is
  // a 532-line useCallback that reads webDevModel but can't list it in its
  // dep array without re-creating every callback in the chain on every model
  // toggle. Instead, read from the ref — which is always fresh — at the
  // exact moment the fetch body is built. Click OPUS → ref updates this
  // render → next send uses OPUS. No stale closure.
  const webDevModelRef = useRef(webDevModel)
  webDevModelRef.current = webDevModel
  const [contextPct, setContextPct] = useState(0) // Context window fill percentage
  const [cachedInputTokens, setCachedInputTokens] = useState(0) // Cached input tokens (system prompt, session files)
  const [realInputTokens, setRealInputTokens] = useState(0) // Real input tokens (new this turn)

  // Order 65 (soft) + Order 66 (hard) — idle → running → complete
  const [order65Status, setOrder65Status] = useState<Order66Status>('idle')
  const [order66Status, setOrder66Status] = useState<Order66Status>('idle')
  const [compactionEndpoint, setCompactionEndpoint] = useState<'order65' | 'order66'>('order66')

  // CLI Session persistence - UUID maintained across streaming calls
  // This allows Claude CLI to maintain conversation state via --session-id flag
  const [cliSessionId, setCliSessionId] = useState<string | null>(null)
  // Bug M (Ralph 2026-05-04): the actual model running on the wire.
  // CLI mode: populated from Claude CLI's system/init event (forwarded
  // by chat-stream as `model_info`). API mode: set immediately from the
  // billing/model toggle since the API request goes out with that exact
  // value. Displayed in the input-bar badge so the user can see whether
  // they're on Claude or Z.ai/GLM at a glance.
  const [currentModel, setCurrentModel] = useState<string | null>(null)

  // Session resume flag - set when loading an existing session
  // Cleared after first message is sent so CD agent knows to run boot sequence
  const [isResumedSession, setIsResumedSession] = useState(false)

  // Boot sequence refs - must be defined before loadSession
  const pendingBootSequenceRef = useRef(false)
  const bootSequenceTriggeredRef = useRef(false)
  const hasBridgeMappingRef = useRef(false)  // true = bridge can --resume (skip boot sequence)

  // Model badge trust ladder (Ralph 2026-05-05). Sources in ascending trust:
  //   config (0) = request alias  → init (1) = CLI's claim  → wire (2) = actual served model
  // A model_info event only updates the badge if its trust level >= current.
  const modelTrustRef = useRef<number>(-1)

  // Single-flight dedup for ensureSession. Without this, double-click-send or
  // paste+Enter while auto-inject is running causes two concurrent callers to
  // both see `sessionId === null` (React state hasn't flushed yet), both call
  // createSessionAction, and disk gets two orphan session folders. The promise
  // cache makes the first caller "own" the creation; subsequent callers await
  // the same promise. Cleared in `finally` so a future fresh session can also
  // be created if this one ever resolves to null/error.
  const sessionPromiseRef = useRef<Promise<string> | null>(null)

  // Ref to hold the message handler for session events (allows effect to access latest handler)
  const messageHandlerRef = useRef<((content: string) => void) | null>(null)

  // Transform vibes into VibeCardData format for the gallery
  // Uses actual vibe data - colors, fonts, voice samples from the vibe itself
  const vibeCards = useMemo((): VibeCardData[] => {
    if (!vibes || vibes.length === 0) return []

    // Fallback colors matching the actual FalCaMel vibes from CREATIVE-BRIEF.md
    const fallbackColors = [
      ['#8B4513', '#F5F5DC', '#722F37', '#2C1810'],  // QAHWA - warm browns, beige, burgundy
      ['#2F4F4F', '#DEB887', '#006400', '#1A1A1A'],  // JAREEN - slate, burlywood, green
      ['#1C1C1C', '#FFD700', '#DC143C', '#FFFFFF'],  // THE RACE - black, gold, crimson
      ['#1A1A2E', '#C9A227', '#4A0E0E', '#F5F5F0'],  // MAJLIS - deep navy, gold, burgundy
    ]

    return vibes.map((vibe, index) => {
      // Hero image = whatever the CD set. No fallbacks, no heuristics.
      //
      // Previously this had 6 "strategies" (keyword match, slug match, HERO
      // tag, index rotation, any-HERO, numbered placeholder) that combined
      // to produce *a* hero even when the CD hadn't picked one. The first
      // two were FalCaMel-specific heuristics (hardcoded qahwa/jareen/race/
      // majlis keyword map) — useless for any other brand. The last three
      // were pure facade (index math, arbitrary pick). An agent reading
      // this couldn't tell real signal from fallback.
      //
      // New rule: `vibe.heroImage` or null. When null, VibesGallery renders
      // a gradient-colored placeholder using the vibe's own palette so the
      // user sees "no hero assigned yet" clearly instead of a random image
      // pretending to be the chosen one.
      const heroImage: string | null = vibe.heroImage || null

      // Use actual vibe colors - handle both array and object formats
      // vibe.colors can be: string[] (from API) or { primary, secondary, accent, text } (from parser)
      let colors: string[]
      if (Array.isArray(vibe.colors) && vibe.colors.length >= 4) {
        // Already an array with 4+ colors
        colors = vibe.colors.slice(0, 4)
      } else if (vibe.colors && typeof vibe.colors === 'object' && !Array.isArray(vibe.colors)) {
        // Object format from parser: { primary, secondary, accent, text }
        const colorObj = vibe.colors as { primary?: string; secondary?: string; accent?: string; text?: string }
        colors = [
          colorObj.primary || '#1C1C1E',
          colorObj.secondary || '#F5F5F5',
          colorObj.accent || '#C76B00',
          colorObj.text || '#1A1A1A'
        ]
      } else {
        // Fallback colors
        colors = fallbackColors[index % fallbackColors.length]
      }

      // Use actual vibe typography - with meaningful fallbacks per vibe
      const fallbackFonts = [
        { heading: 'Playfair Display', body: 'Source Sans Pro' },   // QAHWA
        { heading: 'Crimson Text', body: 'Open Sans' },             // JAREEN
        { heading: 'Oswald', body: 'Roboto' },                       // THE RACE
        { heading: 'Cormorant Garamond', body: 'Libre Baskerville' } // MAJLIS
      ]
      const fonts = vibe.typography?.heading && vibe.typography?.body
        ? vibe.typography
        : fallbackFonts[index % fallbackFonts.length]

      // Use NEW audience/mood fields if available, fallback to voiceSamples for backward compat
      // vibe.audience = short brand persona (e.g., "Saudi 30-45, dual-income, 1-3 kids. Successful but spiritually untethered.")
      // vibe.mood = 3-5 adjectives (e.g., "Warm, Nostalgic, Guilt-Inducing")
      // Fallback: voiceSamples[1] = whoFor (detailed), voiceSamples[0] = voice (detailed)
      const whoItsFor = vibe.audience
        || vibe.voiceSamples?.[1]
        || 'For those who appreciate authentic experiences'
      const mood = vibe.mood
        || vibe.voiceSamples?.[0]
        || 'Distinctive, memorable, impactful'

      // Extract filename from htmlPath (e.g., "/2026-01-27-31/vibe-1-grandmas-cliff.html" → "vibe-1-grandmas-cliff.html")
      const filename = vibe.htmlPath?.split('/').pop() || ''

      return {
        id: vibe.id,
        name: vibe.name,
        heroImage,
        whoItsFor,
        mood,
        colors,
        fonts,
        filename
      }
    })
  }, [vibes, sourceImages, sessionId])

  // Scroll to top on mount to ensure vibe bar is visible below top bar
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // Auto-inject test images if ?inject=true in URL (backdoor for testing)
  // Optional: ?business=zurich or ?business=falcamel to select test image set
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('inject') === 'true') {
      const business = params.get('business') || 'zurich'
      fetch(`/api/inject-images?business=${business}`)
        .then(res => res.json())
        .then(data => {
          if (data.images && data.images.length > 0) {
            setSourceImages(data.images)
            console.log(`Injected ${data.business} test images:`, data.images.map((i: any) => i.filename))
          }
        })
        .catch(err => console.error('Failed to inject images:', err))
    }
  }, [])

  // Session resume — MUST be after loadSession definition

  // Load session state from markdown files
  const loadSession = useCallback(async (loadSessionId: string) => {
    try {
      // Fetch session detail from admin API
      const res = await fetch(`/api/admin/sessions/${loadSessionId}`)
      if (!res.ok) {
        console.error('Failed to load session:', res.status, loadSessionId)
        // 2026-05-03 (Ralph) — KNOWN ROOT CAUSE for the 404 path:
        // **Did you just rename the project?**
        // The "rename project" feature changes the project's directory name
        // on disk. The saved sessionId in localStorage (or in the ?session=
        // URL param) still points to the OLD directory name, which no longer
        // exists → 404 on every refresh until the stale ID is cleared or the
        // URL is updated. This isn't a backend bug; it's a stale-pointer bug
        // introduced by the rename feature.
        //
        // Real fix (TODO): when the rename happens, propagate the new
        // sessionId to localStorage + emit an event so any open tab updates
        // its in-memory state and URL. Until then, scrub on 404 so the next
        // boot starts clean instead of looping the same failure.
        //
        // 500s are NOT scrubbed — backend hiccups should not nuke client
        // state.
        if (res.status === 404) {
          try { localStorage.removeItem('oskar-session-id') } catch { /* ignore */ }
        }
        return
      }
      const data = await res.json()

      // Set session ID and business name
      setSessionId(loadSessionId)
      setBusinessName(data.name || loadSessionId)

      // Note: Images are loaded later with their CD analysis from IMAGES.md

      // Load vibes from htmlFiles - show ALL vibe files (no deduplication).
      // Filename parsing, sorting (by index, then version), and joining against
      // parsed CREATIVE-BRIEF / VIBE-N.md data all live in lib/vibe-resolver.ts
      // as a pure function. Previously this was ~150 lines inline here.
      const htmlFiles = data.htmlFiles || []
      const parsedVibes = data.vibes || []
      // Stash the raw htmlFiles list for the Director Mode picker so it can
      // surface non-vibe HTML files (mockups, prototypes) too — not just the
      // ones that resolve to vibe-N-slug.html.
      setSessionHtmlFiles(htmlFiles)
      // Exposed for the availableVibes block below — kept as a local so the
      // existing VibePreview construction logic still has the htmlFiles list
      // to iterate without re-fetching.
      const allVibeFiles = htmlFiles
      if (htmlFiles.length > 0) {
        const loadedVibes = resolveVibes({
          htmlFiles,
          parsedVibes,
          // Toggle debug tracing when something is off. Leaving off by default
          // so normal loads stay quiet in the console.
          debug: false,
        })
        console.log(
          `📁 Loaded ${loadedVibes.length} vibe(s) from ${htmlFiles.length} HTML file(s):`,
          loadedVibes.map((v) => v.name).join(', ')
        )
        setVibes(loadedVibes)
        if (loadedVibes.length > 0) {
          setSelectedVibe(loadedVibes[0])
          setWorkflowPhase('generation')
        }

        // Also populate availableVibes for the vibe switcher (use parsed vibe names)
        const vibePreviewsLoaded: VibePreview[] = allVibeFiles.map((h: any, idx: number) => {
          const filename = h.name || ''

          // Parse vibe index from filename
          let vibeIndex = idx + 1
          const vibeIdxMatch = filename.match(/vibe-(\d+)-/)
          if (vibeIdxMatch) {
            vibeIndex = parseInt(vibeIdxMatch[1])
          }

          // Find matching parsed vibe for the real name
          const matchedParsed = parsedVibes.find((pv: any) => pv.index === vibeIndex)
          // Extract the slug portion from filename (after vibe-N-)
          const slugFromFile = filename.replace('.html', '').replace(/^vibe-\d+-/, '')
          // Use parsed name if available, otherwise title-case the slug
          const name = matchedParsed?.name || slugFromFile.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
          const slug = matchedParsed?.slug || filename.replace('.html', '')

          return {
            index: vibeIndex,
            name: name,
            slug: slug,
            filename: filename,
            status: 'ready' as const,
            htmlPath: h.path
          }
        })
        // Sort by index so vibes appear in order
        vibePreviewsLoaded.sort((a, b) => a.index - b.index)
        console.log('📦 Setting availableVibes:', vibePreviewsLoaded.length, vibePreviewsLoaded.map(v => `${v.name}(${v.index})`))
        setAvailableVibes(vibePreviewsLoaded)
        if (vibePreviewsLoaded.length > 0) {
          setSelectedVibeFile(vibePreviewsLoaded[0].filename)
        }
      }

      // Parse conversation from SESSION.md
      if (data.rawFiles?.session) {
        const sessionMd = data.rawFiles.session
        const conversationLog = sessionMd.split('## Conversation Log')[1] || ''

        // Parse entries like:
        //   #### CD → User | 06:18:32
        //   #### User → CD | 06:18:32
        //   #### CD | 2026-04-20 14:32:05      (new DATE + TIME format)
        // The timestamp capture accepts an optional `YYYY-MM-DD ` prefix so
        // historical sessions written before the format change still load.
        const entryRegex = /####\s+(CD|User|COO)\s*(?:→|->)?\s*(User|CD)?\s*\|\s*((?:\d{4}-\d{2}-\d{2}\s+)?\d{2}:\d{2}:\d{2})\n([\s\S]*?)(?=####|$)/gi
        const loadedMessages: ConversationMessage[] = []
        let match

        while ((match = entryRegex.exec(conversationLog)) !== null) {
          const sender = match[1]
          const time = match[3]
          const content = match[4].trim()

          // Skip empty or system entries
          if (!content || content.startsWith('**Action:**')) continue

          const role = sender === 'User' ? 'user' : 'assistant'
          loadedMessages.push({
            id: `loaded-${time}-${loadedMessages.length}`,
            role,
            content,
            timestamp: new Date().toISOString()
          })
        }

        if (loadedMessages.length > 0) {
          setMessages(loadedMessages)
          console.log('📝 Loaded', loadedMessages.length, 'messages from SESSION.md')
        }
      }

      // Set workflow progress based on phase
      const phase = data.phase || 1
      let currentPhase: OskarPhase = 'discovery'
      if (phase >= 4) currentPhase = 'review'
      else if (phase >= 3) currentPhase = 'review'
      else if (phase >= 2) currentPhase = 'discovery'

      setWorkflowProgress({
        currentPhase,
        vibesGenerated: data.vibes?.length || 0,
        vibesComplete: data.vibes?.filter((v: any) => v.htmlPath).length || 0,
        selectedVibeIds: [],
        finalApproved: false
      })

      // Restore image manifests from IMAGES.md (pending generation tasks)
      console.log('📸 Calling getImageManifestsAction for:', loadSessionId)
      const manifestResult = await getImageManifestsAction(loadSessionId)
      console.log('📸 manifestResult:', manifestResult)
      if (manifestResult.success && manifestResult.manifests && manifestResult.manifests.length > 0) {
        setImageManifests(manifestResult.manifests)
        console.log('📸 Restored', manifestResult.manifests.length, 'image manifests from IMAGES.md')
      } else {
        console.log('📸 No manifests found or error:', manifestResult.error || 'empty manifests')
      }

      // Load image entries from IMAGES.md to populate CD analysis for source images
      const entriesResult = await getImageEntriesAction(loadSessionId)
      const entries = entriesResult.success && entriesResult.entries ? entriesResult.entries : {}

      // ALWAYS set source images from API data, enriched with IMAGES.md entries if available
      const updatedImages: SourceImage[] = (data.images || []).map((img: any) => {
        const imgFilename = img.filename.replace(/^\d+-/, '')
        const entry = Object.values(entries).find((e: any) =>
          e.filename === img.filename || e.filename === imgFilename
        )
        return {
          id: img.filename,
          filename: img.filename,
          path: img.path,
          uploadedAt: new Date().toISOString(),
          // Session-restored images: use the tag from IMAGES.md when present;
          // fall back to INGESTED so the image doesn't slide into Studio's
          // "Uploads (pending)" section after a refresh. INGESTED is a SILENT
          // gate now — the checkmark badge only renders for `APPROVED` (genuine
          // CD review), so falling back here is no longer a false-approval. */
          tag: entry?.tag || 'INGESTED' as const,
          analysis: entry ? {
            elements: [],
            description: entry.cdAnalysis || entry.reprompt || '',
            suggestedExtractions: [],
            reprompt: entry.reprompt,
            suggestedUses: entry.suggestedUses,
            suggestedVibes: entry.suggestedVibes
          } : {
            elements: [],
            description: '',
            suggestedExtractions: []
          }
        }
      })
      // ── WP-1C/2C (2026-04-17): hydrate generation lineage ──
      // For every record in LINEAGE.json, either enrich an existing
      // SourceImage with parentImage/generationMode/preset/isGenerated, OR
      // synthesize a fresh entry for generated images that aren't in `data.images`
      // (the admin route currently filters them out).
      //
      // Ralph 2026-04-25 — ghost-deletion fix: synth path used to trust
      // every LINEAGE record blindly. When a user deleted a generated image,
      // the file went away on disk, IMAGES.md entry was scrubbed, BUT
      // LINEAGE.json kept the record (history). Next session reload, the
      // synth branch hydrated from LINEAGE → image reappeared as a ghost
      // tile pointing at a 404 path. Fix: cross-reference against
      // `data.files` (every file actually on disk) and skip records whose
      // resultImage no longer exists. LINEAGE history stays intact for
      // audit; the panel just stops resurrecting deleted assets.
      const filesOnDisk: Set<string> = new Set(
        (data.files || [])
          .filter((f: { type?: string }) => f.type === 'image')
          .map((f: { name: string }) => f.name),
      )
      try {
        const lineageRes = await fetch(`/api/sessions/${loadSessionId}/lineage`)
        if (lineageRes.ok) {
          const { records = [] } = await lineageRes.json() as { records?: any[] }
          const existingByName = new Map<string, SourceImage>(
            updatedImages.map((img) => [img.filename, img])
          )
          for (const rec of records) {
            // WP-15 audit fields: prefer the new prompt fields, fall back to
            // the deprecated `prompt` for legacy LINEAGE.json entries written
            // before 2026-04-17. The actually-sent prompt drives sourcePrompt
            // because that's what produced THIS specific result.
            const sourcePrompt: string =
              rec.actualPromptSent || rec.userPrompt || rec.prompt || ''
            const existing = existingByName.get(rec.resultImage)
            if (existing) {
              // Enrich in place — preserve any analysis already loaded
              existing.parentImage = rec.parentImage
              existing.parentImages = rec.sourceImages?.length > 1
                ? rec.sourceImages
                : undefined
              existing.generationMode = rec.mode
              existing.preset = rec.preset || undefined
              existing.isGenerated = true
              existing.sourcePrompt = sourcePrompt
              if (rec.description && !existing.analysis?.description) {
                existing.analysis = {
                  elements: existing.analysis?.elements || [],
                  description: rec.description,
                  suggestedExtractions: existing.analysis?.suggestedExtractions || [],
                }
              }
            } else if (!filesOnDisk.has(rec.resultImage)) {
              // Ghost guard (Ralph 2026-04-25): the record points at a file
              // that has been deleted from disk. Skip — don't synth a tile
              // for something that no longer exists. LINEAGE.json keeps
              // the record so history/audit isn't lost.
              continue
            } else {
              // Synthesize — generated image not present in admin file list
              // but DOES exist on disk (admin's pattern filter excluded it).
              const synth: SourceImage = {
                id: rec.id || rec.resultImage,
                filename: rec.resultImage,
                path: `/${loadSessionId}/${rec.resultImage}`,
                uploadedAt: rec.timestamp || new Date().toISOString(),
                isGenerated: true,
                sourcePrompt,
                parentImage: rec.parentImage,
                parentImages: rec.sourceImages?.length > 1
                  ? rec.sourceImages
                  : undefined,
                generationMode: rec.mode,
                preset: rec.preset || undefined,
                analysis: { elements: [], description: '', suggestedExtractions: [] },
              }
              updatedImages.push(synth)
              existingByName.set(synth.filename, synth)
            }
          }
          if (records.length > 0) {
            console.log(`📸 Hydrated ${records.length} lineage records`)
          }
        }
      } catch (lineageErr) {
        console.warn('Failed to load lineage:', lineageErr)
      }

      setSourceImages(updatedImages)
      console.log('📸 Loaded', updatedImages.length, 'source images:', updatedImages.map(i => i.filename))

      // Track bridge mapping for resume detection
      hasBridgeMappingRef.current = !!data.hasBridgeMapping

      // Mark as resumed session so CD agent runs boot sequence on first message
      // Reset the boot sequence guard so it can trigger again for this new session
      bootSequenceTriggeredRef.current = false
      setIsResumedSession(true)

      console.log('📁 Session loaded:', loadSessionId, 'Phase:', phase, 'Vibes:', data.vibes?.length || 0)

    } catch (error) {
      console.error('Failed to load session:', error)
    }
  }, [])

  // Restore session on mount — from URL param OR localStorage
  // Skip restore if ?new=true (fresh session requested from admin)
  const sessionRestored = useRef(false)
  useEffect(() => {
    if (sessionRestored.current) return
    sessionRestored.current = true
    const params = new URLSearchParams(window.location.search)

    // ?new=true means admin requested a fresh session — don't restore
    if (params.get('new') === 'true') {
      console.log('📁 New session requested — starting fresh')
      localStorage.removeItem('oskar-session-id')
      // Clean the URL without reloading
      window.history.replaceState({}, '', '/')
      return
    }

    const urlSession = params.get('session')
    const savedSession = localStorage.getItem('oskar-session-id')
    const resumeId = urlSession || savedSession
    if (resumeId) {
      console.log('📁 Restoring session:', resumeId, urlSession ? '(from URL)' : '(from localStorage)')
      loadSession(resumeId)
    }
  }, [loadSession])

  // Load billing preference from localStorage. localStorage is the
  // pre-Phase-2 persistence layer; we keep it as a hot-cache so the pill
  // shows the right state instantly on first paint, BEFORE the GET to
  // the session-config endpoint resolves. The session-config file is the
  // server-side source of truth (so MCP routes can read it). Ralph
  // 2026-05-04.
  useEffect(() => {
    const saved = localStorage.getItem('oskar_billing_mode')
    if (saved === 'smpl' || saved === 'cli' || saved === 'api') {
      setBillingMode(saved)
    }
    const savedModel = localStorage.getItem('oskar_webdev_model')
    if (
      savedModel === 'claude-opus-4-7' ||
      savedModel === 'claude-sonnet-4-6' ||
      savedModel === 'gemini-3.1-pro-preview'
    ) {
      setWebDevModel(savedModel)
    }
  }, [])

  // Hydrate from server-side session config (Ralph 2026-05-04). Runs once
  // sessionId resolves. Server value wins over localStorage because the
  // user may have toggled in another tab / from a different device.
  // Sticky bit: writes are immediate (see effect below) so this only
  // matters on first load of a session.
  const hydratedFromConfigRef = useRef(false)
  useEffect(() => {
    if (!sessionId) return
    if (hydratedFromConfigRef.current) return
    hydratedFromConfigRef.current = true
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/config`)
      .then((r) => r.ok ? r.json() : null)
      .then((cfg) => {
        if (!cfg) return
        if (cfg.billingMode === 'smpl' || cfg.billingMode === 'cli' || cfg.billingMode === 'api') setBillingMode(cfg.billingMode)
        if (
          cfg.webDevModel === 'claude-opus-4-7' ||
          cfg.webDevModel === 'claude-sonnet-4-6' ||
          cfg.webDevModel === 'gemini-3.1-pro-preview'
        ) setWebDevModel(cfg.webDevModel)
        // Bug M (Ralph 2026-05-04): seed the input-bar model badge from
        // session config. CLI mode will override this when Claude CLI's
        // Badge is NOT seeded from config. The badge displays truth-on-wire
        // only — cfg.cdModel is the request, not the receipt. On Z.ai,
        // seeding 'claude-opus-4-7[1m]' would show a lie until the first
        // init event flips it to 'glm-4.7'. Leave null until wire truth
        // arrives. Ralph 2026-05-04.
      })
      .catch((err) => console.warn('[page] session config fetch failed:', err))
  }, [sessionId])

  // Save billing preference to localStorage AND to the server-side
  // session-config file. The server write is what makes the toggle
  // INSTANT for MCP build routes — no debounce, no startup-load delay
  // (the file is sub-ms to write/read; the next agent action runs after
  // the click so there's no race). Ralph 2026-05-04.
  // Save billing mode AND cdModel to session config. When mode changes,
  // cdModel is set to the mode default (SMPL→'opus', CLI→'claude-opus-4-7[1m]',
  // API→'claude-opus-4-7'). Ralph 2026-05-04.
  useEffect(() => {
    localStorage.setItem('oskar_billing_mode', billingMode)
    if (!sessionId) return
    if (!hydratedFromConfigRef.current) return  // skip the write that would race the hydration GET
    const modeCdModels = { smpl: 'opus', cli: 'claude-opus-4-7[1m]', api: 'claude-opus-4-7' } as const
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billingMode, cdModel: modeCdModels[billingMode] }),
    }).catch((err) => console.warn('[page] session config POST (billingMode) failed:', err))
  }, [billingMode, sessionId])

  // Save WebDev model to localStorage AND to the server-side session
  // config. Same instant-write pattern as billingMode above. The MCP
  // build routes read this on every call.
  useEffect(() => {
    localStorage.setItem('oskar_webdev_model', webDevModel)
    if (!sessionId) return
    if (!hydratedFromConfigRef.current) return
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webDevModel }),
    }).catch((err) => console.warn('[page] session config POST (webDevModel) failed:', err))
  }, [webDevModel, sessionId])

  // Bug M follow-up (Ralph 2026-05-04): on billingMode change, ACTIVELY
  // probe the chosen mode's actual model. CLI mode → backend either
  // returns the cached actualModel from a running bridge, or spawns a
  // claude probe to read the system/init event. API mode → the model
  // we'd send. NOT inferred from config; the probe endpoint is the
  // single source of truth so the badge reflects the wire, not our
  // intent.
  useEffect(() => {
    if (!sessionId) return
    if (!hydratedFromConfigRef.current) return
    // Reset trust ladder on mode change — the new mode's probe/model_info
    // events start from scratch.
    modelTrustRef.current = -1
    setCurrentModel(null)
    let cancelled = false
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/probe-model?mode=${billingMode}`)
      .then((r) => r.ok ? r.json() : null)
      .then((res) => {
        if (cancelled || !res || typeof res.model !== 'string') return
        modelTrustRef.current = 0  // probe is config-level trust
        setCurrentModel(res.model)
        console.log(`🏷️ Probed ${billingMode} model: ${res.model} (source=${res.source})`)
      })
      .catch((err) => console.warn('[page] probe-model failed:', err))
    return () => { cancelled = true }
  }, [billingMode, sessionId])

  // Load theme preference from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('oskar_theme')
    if (savedTheme === 'onyx' || savedTheme === 'polar') {
      setTheme(savedTheme)
    }
  }, [])

  // AUTO-TRIGGER: Mark session for boot sequence when resumed
  useEffect(() => {
    if (isResumedSession && sessionId && !bootSequenceTriggeredRef.current) {
      console.log('🔄 Session resumed - marking for boot sequence')
      pendingBootSequenceRef.current = true
    }
  }, [isResumedSession, sessionId])

  // Theme → document + localStorage is now handled synchronously inside the
  // setTheme wrapper so the toggle feels instant instead of waiting for
  // React's commit phase. No effect needed here.

  // ── No more `[SYSTEM:]` chat injection (Phase-1 MCP cutover, 2026-04-29) ──
  //
  // This effect used to subscribe to the in-browser `sessionEvents` bus and,
  // for vibe-ready / image-ready / hot-swap / error, either inject a fake
  // user message into the chat (firing a CD turn) or push an assistant
  // bubble into the message list.
  //
  // That path produced the stale system-tagged "Vibe X has been built…"
  // bubbles polluting active sessions: any event for the current sessionId
  // — even
  //
  // a leaked one from a stale bus subscriber, or a re-emit triggered by SSE
  // bridging — became a synthetic chat turn.
  //
  // CD now learns about server events through the MCP notification channel
  // (mcp-server/notifications.ts), not through synthetic user messages.
  // Snackbars are handled by SnackbarProvider, which has its own
  // sessionEvents.onAll subscription. Vibe gallery / Assets panel refresh
  // is handled by the SSE bridge below (re-emits to sessionEvents in
  // hyphenated form so SnackbarProvider sees them).
  //
  // This hook is intentionally empty. Removing the empty hook entirely
  // would force a re-numbering of every following hook in this file and
  // risk breaking React's rule-of-hooks ordering on a Fast Refresh; the
  // empty body is the lowest-risk way to retire the side effect.
  useEffect(() => {
    // intentionally empty — see comment above.
  }, [sessionId])

  // ── /api/events subscription ──────────────────────────────────────────────
  // 2026-04-29 (Phase 1 MCP migration): the orchestrator now publishes to a
  // per-session in-memory event-bus when /api/mcp/* tools complete (build,
  // hotswap, refresh, etc.). The MCP server reads that bus to send CD
  // notifications; the frontend reads the same bus here to keep snackbars,
  // vibe cards, and Assets-panel refreshes flowing without waiting for
  // chat-stream's per-turn SSE. Translates server event-bus shape into the
  // hyphenated `sessionEvents` shape the legacy handler above expects.
  useEffect(() => {
    if (!sessionId) return
    const es = new EventSource(`/api/events?session=${encodeURIComponent(sessionId)}`)
    es.onmessage = (evt) => {
      // 2026-04-30 (Ralph): defend against non-JSON SSE payloads. The
      // server's heartbeat now uses SSE-comments which the EventSource
      // drops before onmessage fires, so this branch protects against
      // future rogue routes that send `data: <non-json>\n\n`. Without
      // this, the JSON.parse throw was caught but surfaced in the
      // Next.js dev overlay as a noisy runtime warning.
      if (typeof evt.data !== 'string') return
      const trimmed = evt.data.trimStart()
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return
      try {
        const payload = JSON.parse(evt.data)
        if (!payload || typeof payload !== 'object') return
        switch (payload.type) {
          case 'build_started': {
            // Ralph 2026-05-06: live build job card — Archetype 1 from
            // toolcards-mockup.html. Mount once on build_started; rows
            // update in place from subsequent vibe_built / vibe_failed
            // events. Matches the mockup's "long-running, mounts at
            // tool-fire, keeps updating from the event bus" pattern.
            //
            // Three modes:
            //   - mode:'all'  — N rows, one per vibe (vibeCount carries N).
            //                   Labels fill in as vibes land (vibe_built
            //                   carries vibeName + vibeIndex).
            //   - mode:'final' — 1 row for the final landing page build.
            //   - mode:'vibe' (default) — 1 row for the explicit `target`.
            const mode = payload.mode === 'all' || payload.mode === 'final' ? payload.mode : 'vibe'
            const vibeCount = typeof payload.vibeCount === 'number' ? Math.max(1, payload.vibeCount) : 1
            const target = typeof payload.target === 'string' ? payload.target : ''
            // Phase 2 fix (CD 2026-05-06): the build_all_vibes route now ships
            // `rows: [{id, label, thumb?}]` so the card mounts with real
            // names + thumbs. Fall back to id-only stubs if the route is old
            // (legacy clients) or for single-vibe / final builds.
            const enrichedRows = Array.isArray(payload.rows)
              ? payload.rows.filter((r: { id?: unknown }) => typeof r?.id === 'string')
              : null
            // CD 2026-05-06: build-vibe/route.ts now also ships
            // rows[] (single-element) so single-vibe builds mount
            // with the hero thumb + label, matching build-all-vibes.
            const singleRow = enrichedRows && enrichedRows.length === 1
              ? (enrichedRows[0] as { id: string; label?: string; thumb?: string })
              : null
            const rows = mode === 'all'
              ? (enrichedRows && enrichedRows.length > 0
                  ? enrichedRows.map((r: { id: string; label?: string; thumb?: string }) => ({
                      id: r.id,
                      label: typeof r.label === 'string' ? r.label : '',
                      thumb: typeof r.thumb === 'string' ? r.thumb : undefined,
                      state: 'queued' as const,
                    }))
                  : Array.from({ length: vibeCount }, (_, i) => ({
                      id: `vibe-${i + 1}`,
                      label: '',
                      state: 'queued' as const,
                    })))
              : [{
                  id: singleRow?.id ?? (mode === 'final' ? 'final' : (target || 'vibe')),
                  label: typeof singleRow?.label === 'string' && singleRow.label
                    ? singleRow.label
                    : (mode === 'final' ? 'Final landing page' : ''),
                  thumb: typeof singleRow?.thumb === 'string' ? singleRow.thumb : undefined,
                  state: 'queued' as const,
                }]
            const title = mode === 'all'
              ? `Building ${vibeCount} vibes`
              : mode === 'final'
                ? 'Building final landing page'
                : `Building ${target || 'vibe'}`
            const cardMessage: ConversationMessage = {
              id: `msg-${Date.now()}-build-${mode}`,
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              card: {
                kind: 'build',
                title,
                jobId: typeof payload.jobId === 'string' ? payload.jobId : undefined,
                rows,
              },
            }
            setMessages((prev) => [...prev, cardMessage])
            break
          }
          case 'build_progress': {
            // CD 2026-05-06: flip the matched row to html / verify mid-build
            // OR append a milestone bullet (single-vibe view). Match by
            // `target` (e.g. 'vibe-3'). No-op if no card or no row found.
            const target = typeof payload.target === 'string' ? payload.target : ''
            const stage = payload.stage === 'html' || payload.stage === 'verify'
              ? payload.stage as 'html' | 'verify'
              : null
            const milestone = typeof payload.milestone === 'string' ? payload.milestone : null
            if (!target || (!stage && !milestone)) break
            setMessages((prev) => {
              const next = [...prev]
              for (let i = next.length - 1; i >= 0; i--) {
                const m = next[i]
                if (m.card?.kind !== 'build') continue
                const rows = m.card.rows
                const idx = rows.findIndex((r) => r.id === target)
                if (idx === -1) continue
                const updated = [...rows]
                const row = updated[idx]
                // Don't downgrade terminal rows (done/failed) on a late
                // progress event.
                if (row.state === 'done' || row.state === 'failed') break
                updated[idx] = {
                  ...row,
                  ...(stage ? { state: stage } : {}),
                  ...(milestone
                    ? { milestones: [...(row.milestones ?? []), milestone] }
                    : {}),
                  // Stamp startedAt the FIRST time the row leaves
                  // queued (transitions to html). The row is "actively
                  // building" from this moment; ETA = now - startedAt.
                  ...(stage === 'html' && !row.startedAt
                    ? { startedAt: new Date().toISOString() }
                    : {}),
                }
                next[i] = { ...m, card: { ...m.card, rows: updated } }
                break
              }
              return next
            })
            break
          }
          case 'vibe_built':
            // Update the most-recent build card's matching row → state='done'.
            // Match by id (vibe-N) — the row's `state` flips and the htmlPath
            // becomes the thumb (server-rendered HTML, can be screenshotted
            // separately later by the screenshot tool if we want a real preview).
            setMessages((prev) => {
              const next = [...prev]
              for (let i = next.length - 1; i >= 0; i--) {
                const m = next[i]
                if (m.card?.kind !== 'build') continue
                const rows = m.card.rows
                const idx = rows.findIndex((r) =>
                  r.id === `vibe-${payload.vibeIndex}` ||
                  r.label === payload.vibeName ||
                  // Empty-label row case: first un-started row claims this
                  // vibe_built event so we don't lose it on a vibeIndex
                  // mismatch (e.g. when the row count was approximated).
                  (r.state === 'queued' && !r.label && rows.findIndex((rr) => rr.state === 'queued') === idx)
                )
                if (idx === -1) continue
                const updatedRows = [...rows]
                const finishedAt = new Date().toISOString()
                const startedAt = updatedRows[idx].startedAt ?? finishedAt
                // Compute final elapsed string (m:ss) so the eta cell
                // freezes at "8:28" etc on done rows.
                const ms = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
                const totalSec = Math.floor(ms / 1000)
                // Ralph 2026-05-06: rename `m` → `mins` because the outer
                // for-loop also binds `m` to the iterated message. ESLint
                // / TS catch this as a shadow / redeclare; the bundler
                // surfaces it as "name `m` defined multiple times".
                const mins = Math.floor(totalSec / 60)
                const s = (totalSec % 60).toString().padStart(2, '0')
                const finalEta = `${mins}:${s}`
                updatedRows[idx] = {
                  ...updatedRows[idx],
                  label: payload.vibeName || updatedRows[idx].label,
                  state: 'done',
                  finishedAt,
                  eta: finalEta,
                  // CD 2026-05-06: keep `thumb` as the hero IMAGE preview
                  // (don't overwrite with an HTML path — that broke the
                  // <img src=...> rendering). `htmlPath` drives the Open
                  // button instead.
                  htmlPath: typeof payload.htmlPath === 'string'
                    ? payload.htmlPath
                    : updatedRows[idx].htmlPath,
                }
                next[i] = { ...m, card: { ...m.card, rows: updatedRows } }
                break
              }
              return next
            })
            sessionEvents.emit({
              type: 'vibe-ready',
              sessionId,
              data: { vibeName: payload.vibeName, vibeFile: payload.filename },
            })
            break
          case 'image_ready':
            sessionEvents.emit({
              type: 'image-ready',
              sessionId,
              data: {
                imageName: payload.imageName || payload.filename,
                imageSlot: payload.slot,
                geminiText: payload.geminiText || payload.nanoText,
              },
            })
            // 2026-05-04 (Ralph): also refresh AssetsPanel state. The
            // image_ready event ONLY drove a snackbar before — it never
            // updated imageManifests, so the user saw "image ready" toast
            // but the panel showed stale data until the next chat
            // round-trip. /api/generate-image + /api/edit-image don't
            // publish assets_updated either, so we have to do the refresh
            // here. Same wrapper as the assets_updated case.
            ;(async () => {
              try {
                const manifestResult = await getImageManifestsAction(sessionId)
                if (manifestResult.success && manifestResult.manifests) {
                  setImageManifests(manifestResult.manifests)
                }
                await refreshSourceImageTags()
              } catch (err) {
                console.error('[/api/events] image_ready refresh failed:', err)
              }
            })()
            break
          case 'hotswap_complete':
            sessionEvents.emit({
              type: 'hot-swap',
              sessionId,
              data: {
                oldImage: payload.oldImage || '(prior)',
                newImage: payload.sourceImage,
                vibesUpdated: [payload.vibe],
              },
            })
            break
          case 'vibe_failed':
          case 'build_failed':
            // Update the most-recent build card's matching row → state='failed'.
            // Match by `target` (e.g. 'vibe-3') for vibe_failed; build_failed
            // marks every still-running row as failed because the whole job
            // crashed, not just one vibe.
            setMessages((prev) => {
              const next = [...prev]
              for (let i = next.length - 1; i >= 0; i--) {
                const m = next[i]
                if (m.card?.kind !== 'build') continue
                const rows = m.card.rows
                const isWhole = payload.type === 'build_failed'
                const targetId = typeof payload.target === 'string' ? payload.target : ''
                const updatedRows = rows.map((r) => {
                  const hit = isWhole
                    ? r.state !== 'done' && r.state !== 'failed'
                    : r.id === targetId
                  if (!hit) return r
                  return {
                    ...r,
                    state: 'failed' as const,
                    error: typeof payload.error === 'string' ? payload.error : 'build failed',
                  }
                })
                next[i] = { ...m, card: { ...m.card, rows: updatedRows } }
                break
              }
              return next
            })
            sessionEvents.emit({
              type: 'error',
              sessionId,
              data: { message: payload.error || payload.message || `${payload.type}` },
            })
            break
          case 'hotswap_failed':
          case 'image_failed':
          case 'error':
            sessionEvents.emit({
              type: 'error',
              sessionId,
              data: { message: payload.error || payload.message || `${payload.type}` },
            })
            break
          // Phase 2 Tier S (2026-04-30): agent-initiated user-facing events.
          case 'cd_snackbar':
            // Preserve `sticky` as undefined when the agent didn't pass it,
            // so the SnackbarProvider applies per-severity defaults (progress/
            // warning/error sticky; info/success auto). Coercing to boolean
            // here used to clobber those defaults — see route comment.
            sessionEvents.emit({
              type: 'cd.snackbar',
              sessionId,
              data: {
                text: payload.text,
                severity: payload.severity || 'info',
                ...(typeof payload.sticky === 'boolean'
                  ? { sticky: payload.sticky }
                  : {}),
              },
            })
            break
          case 'cd_ask_user':
            sessionEvents.emit({
              type: 'cd.ask-user',
              sessionId,
              data: {
                requestId: payload.requestId,
                question: payload.question,
                options: payload.options,
              },
            })
            break
          // 2026-05-04 (Ralph): discovery flow cards. CD's MCP tools
          // ask_discovery_questions / confirm_understanding publish
          // these events; we push a synthetic assistant message into the
          // conversation with a `card` payload, and ConversationPanel
          // renders the matching component instead of markdown. Same
          // path for both CLI and API mode (the MCP server is the
          // single source).
          case 'discovery_questions': {
            const questions = Array.isArray(payload.questions)
              ? payload.questions.map((q: unknown) => String(q ?? '').trim()).filter(Boolean)
              : []
            if (questions.length === 0) break
            const cardMessage: ConversationMessage = {
              id: `msg-${Date.now()}-discovery`,
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              card: {
                kind: 'discovery_questions',
                questions,
                context: typeof payload.context === 'string' ? payload.context : undefined,
              },
            }
            setMessages((prev) => [...prev, cardMessage])
            break
          }
          case 'confirm_understanding': {
            if (typeof payload.summary !== 'string' || !payload.summary.trim()) break
            const cardMessage: ConversationMessage = {
              id: `msg-${Date.now()}-confirm`,
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              card: {
                kind: 'confirm_understanding',
                summary: payload.summary,
                readyToGenerate: payload.readyToGenerate === true,
              },
            }
            setMessages((prev) => [...prev, cardMessage])
            break
          }
          // WP-22 Phase 1 (Ralph 2026-05-06) — Screenshot / ApplyPatch /
          // DiagnosticChip cards. Each MCP route publishes a typed event after
          // its primary work; we push a synthetic assistant message with a
          // `card` payload, ConversationPanel routes by kind to the right
          // component. Mockup: docs/toolcards-mockup.html § Archetypes 2 + 4.
          case 'screenshot_taken': {
            const savedPath = typeof payload.savedPath === 'string' ? payload.savedPath : ''
            if (!savedPath) break
            const dimsRaw = (payload.dims || {}) as { width?: unknown; height?: unknown }
            const cardMessage: ConversationMessage = {
              id: `msg-${Date.now()}-screenshot`,
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              card: {
                kind: 'screenshot',
                savedPath,
                target: typeof payload.target === 'string' ? payload.target : '',
                frame: (payload.frame === 'tablet' || payload.frame === 'mobile' ? payload.frame : 'desktop') as 'desktop' | 'tablet' | 'mobile',
                dims: {
                  width: typeof dimsRaw.width === 'number' ? dimsRaw.width : 1280,
                  height: typeof dimsRaw.height === 'number' ? dimsRaw.height : 800,
                },
              },
            }
            setMessages((prev) => [...prev, cardMessage])
            break
          }
          case 'apply_patch_complete': {
            const filename = typeof payload.filename === 'string' ? payload.filename : ''
            const diff = typeof payload.diff === 'string' ? payload.diff : ''
            if (!filename || !diff) break
            const cardMessage: ConversationMessage = {
              id: `msg-${Date.now()}-applypatch`,
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              card: {
                kind: 'apply_patch',
                filename,
                editKind: typeof payload.editKind === 'string' ? payload.editKind : 'edit',
                anchor: typeof payload.anchor === 'string' ? payload.anchor : '(no-selector)',
                affected: typeof payload.affected === 'number' ? payload.affected : 0,
                diff,
              },
            }
            setMessages((prev) => [...prev, cardMessage])
            break
          }
          case 'notify_agent_sent': {
            const label = typeof payload.label === 'string' ? payload.label : ''
            if (!label) break
            const cardMessage: ConversationMessage = {
              id: `msg-${Date.now()}-notify-${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              card: {
                kind: 'diagnostic_chip',
                glyph: typeof payload.glyph === 'string' ? payload.glyph : '→',
                label,
                accent: typeof payload.accent === 'string' ? payload.accent : undefined,
                ts: typeof payload.ts === 'string' ? payload.ts : new Date().toISOString(),
              },
            }
            setMessages((prev) => [...prev, cardMessage])
            break
          }
          // Ralph 2026-05-06: on-demand card preview. CD calls
          // `preview_card({kind, payload})` when the user asks "show me
          // [a card]" so they see a visual instance instead of pasted
          // source. Push a synthetic assistant message with the same
          // shape ConversationPanel already routes — the only difference
          // is the `__preview: true` marker so the renderer can tag it
          // as a sample (no real backend writes).
          case 'card_preview': {
            const kind = typeof payload.kind === 'string' ? payload.kind : ''
            const cardPayload =
              payload.payload && typeof payload.payload === 'object'
                ? (payload.payload as Record<string, unknown>)
                : null
            if (!kind || !cardPayload) break
            const cardMessage: ConversationMessage = {
              id: `msg-${Date.now()}-preview-${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              // Cast through `unknown`: the AssistantCardPayload union has
              // strict per-kind shapes (e.g. DiagnosticChipPayload requires
              // glyph/label/ts). Preview payloads come from the agent's
              // `payload` arg loosely — runtime guards in each card's
              // component handle malformed input gracefully. The `__preview`
              // flag lives on the MESSAGE (not the card), so renderers can
              // opt-in to sample-styling without affecting the union shape.
              card: ({ kind, ...cardPayload } as unknown) as ConversationMessage['card'],
              __preview: true,
            }
            setMessages((prev) => [...prev, cardMessage])
            break
          }
          // 2026-05-04 (Ralph) — `assets_updated` was previously marked
          // silent on the assumption that AssetsPanel polled IMAGES.md
          // on its own cadence. It doesn't — the panel is prop-driven
          // and only re-reads after a chat round-trip via getImageManifestsAction.
          // Result: when CD called `images_needed` or `refresh_assets`
          // via MCP (no chat involved), the panel stayed stale and Ralph
          // never saw the new prompts. Now we actually act on the event:
          // re-fetch manifests + reconcile source-image tags.
          case 'assets_updated': {
            console.log(
              `[/api/events] 📥 assets_updated received (reason=${payload.reason || 'unknown'}, ` +
              `route-counted manifestCount=${payload.manifestCount ?? '?'}, promptCount=${payload.promptCount ?? '?'})`,
            )
            ;(async () => {
              try {
                const manifestResult = await getImageManifestsAction(sessionId)
                if (manifestResult.success && manifestResult.manifests) {
                  setImageManifests(manifestResult.manifests)
                  if (manifestResult.manifests.length === 0) {
                    console.warn(
                      `[/api/events] ⚠️ assets_updated fired but parser returned 0 manifests. ` +
                      `Most common cause: CD wrote prompts to a section other than ` +
                      `\`## Image Prompts + Generated\` (e.g. \`## What's Missing\` or a ` +
                      `numbered list elsewhere). Check IMAGES.md format vs lib/session-actions.ts:503.`,
                    )
                  } else {
                    console.log(
                      `[/api/events] ✅ refreshed ${manifestResult.manifests.length} manifest(s) ` +
                      `with ${manifestResult.manifests.reduce((n, m) => n + m.assets.length, 0)} asset(s) total`,
                    )
                  }
                } else {
                  console.error('[/api/events] getImageManifestsAction failed:', manifestResult.error)
                }
                await refreshSourceImageTags()
              } catch (err) {
                console.error('[/api/events] assets_updated refresh failed:', err)
              }
            })()
            break
          }
          // build_started / connected / heartbeat — still silent.
        }
      } catch (err) {
        console.error('[/api/events] parse error', err)
      }
    }
    es.onerror = (err) => {
      // EventSource auto-reconnects; just log.
      console.warn('[/api/events] connection error (auto-retrying):', err)
    }
    return () => { es.close() }
  }, [sessionId])

  // Upload a new image
  /**
   * Re-read IMAGES.md and refresh tag + usedIn on every existing source
   * image. Used by AdvancedMode after Replace-everywhere completes —
   * server reconciles tags into IMAGES.md, this pulls them back. Same
   * logic as the inline post-handleSend hydration paths but extracted so
   * non-chat actions can trigger it. (Ralph 2026-04-25.)
   */
  /**
   * Upload-eval batch debouncer (Ralph 2026-05-06).
   *
   * When the user drops N images at once, each upload independently calls
   * /api/cd-evaluate-upload. Without batching, that pushes N individual
   * UploadEvalCards into the chat — wall-of-cards pollution at N≥3.
   *
   * Strategy: trailing-edge debounce. Each evaluated upload appends to a
   * ref-backed buffer and (re)starts a 1500ms timer. After 1500ms of no new
   * arrivals the buffer flushes:
   *   - buffer.length ≥ 3 → ONE batch card (UploadEvalBatchCard, table layout)
   *   - buffer.length  < 3 → N individual cards (UploadEvalCard, rich layout)
   *
   * The 1500ms window is empirical: long enough to capture a multi-file drag-
   * and-drop's CD evaluations (sequential async, ~200-400ms each), short
   * enough that a true single-image upload doesn't feel artificially delayed.
   */
  const uploadEvalBufferRef = useRef<Array<Omit<UploadEvalCardPayload, 'kind'>>>([])
  const uploadEvalFlushTimerRef = useRef<NodeJS.Timeout | null>(null)

  const flushUploadEvalBuffer = useCallback(() => {
    const buffer = uploadEvalBufferRef.current
    uploadEvalBufferRef.current = []
    uploadEvalFlushTimerRef.current = null
    if (buffer.length === 0) return
    if (buffer.length >= 3) {
      // CD directive 2026-05-06: batch card schema is STAR | B-ROLL | TRASH
      // only — INGESTED is the system fallback and not user-assignable in
      // this surface. Coerce any INGESTED row to 'B-ROLL' (safe-default
      // secondary tag) at the flush boundary. CD's submit_upload_eval call
      // normally tags before this fires; this is the defensive path for
      // rows that arrive untagged.
      const cardMessage: ConversationMessage = {
        id: `msg-${Date.now()}-upload-eval-batch`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        card: {
          kind: 'upload_eval_batch',
          items: buffer.map((item) => ({
            ...item,
            status: item.status === 'INGESTED' ? 'B-ROLL' : item.status,
          })),
        },
      }
      setMessages((prev) => [...prev, cardMessage])
    } else {
      const cardMessages: ConversationMessage[] = buffer.map((item, i) => ({
        id: `msg-${Date.now()}-upload-eval-${item.filename}-${i}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        card: { kind: 'upload_eval', ...item },
      }))
      setMessages((prev) => [...prev, ...cardMessages])
    }
  }, [])

  const enqueueUploadEval = useCallback(
    (item: Omit<UploadEvalCardPayload, 'kind'>) => {
      uploadEvalBufferRef.current.push(item)
      if (uploadEvalFlushTimerRef.current) {
        clearTimeout(uploadEvalFlushTimerRef.current)
      }
      uploadEvalFlushTimerRef.current = setTimeout(flushUploadEvalBuffer, 1500)
    },
    [flushUploadEvalBuffer],
  )

  const refreshSourceImageTags = useCallback(async () => {
    if (!sessionId) return
    const entriesResult = await getImageEntriesAction(sessionId)
    if (!entriesResult.success || !entriesResult.entries) return
    const entries = entriesResult.entries
    setSourceImages(prev => prev.map(img => {
      const imgFilename = img.filename.replace(/^\d+-/, '')
      const entry = Object.values(entries).find(e =>
        e.filename === img.filename || e.filename === imgFilename,
      )
      if (!entry) {
        // Same INGESTED-fallback discipline as the load-time hydration:
        // keep an existing tag, otherwise mark INGESTED (silent — no badge).
        return img.tag ? img : { ...img, tag: 'INGESTED' as const }
      }
      return {
        ...img,
        tag: entry.tag || img.tag || 'INGESTED' as const,
        usedIn: entry.usedIn,
      }
    }))
  }, [sessionId])

  const handleUpload = useCallback(async (file: File) => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      // Pass sessionId if we have one - saves directly to session folder
      if (sessionId) {
        formData.append('sessionId', sessionId)
      }

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      })

      const data = await response.json()

      if (data.error) {
        console.error('Upload error:', data.error)
        return
      }

      const newSource: SourceImage = {
        id: data.id,
        filename: data.filename,
        path: data.path,
        uploadedAt: data.uploadedAt,
        analysis: data.analysis
      }

      setSourceImages(prev => [...prev, newSource])
      console.log('Uploaded:', newSource.path, 'Elements:', newSource.analysis?.elements)

      // Log to IMAGES.md if we have a session
      if (sessionId) {
        await logImageUploadAction(sessionId, data.filename, data.analysis)
        await updateWorkflowStateAction(sessionId, { imagesUploaded: true })

        // ── WP-15 rule 7 (added 2026-04-17): every upload triggers CD eval ──
        // Fire-and-emit pattern: don't block the upload UX, but surface CD's
        // take as a snackbar a beat later. SnackbarProvider already
        // subscribes to `cd.upload-evaluated`; emitter was missing.
        try {
          const evalRes = await fetch('/api/cd-evaluate-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, filename: data.filename }),
          })
          if (evalRes.ok) {
            const ev = await evalRes.json() as {
              verdict: '✓' | '≈' | '✗' | 'error'
              note: string
              suggestedUses?: string[]
            }
            const renderVerdict: '✓' | '≈' | '✗' = ev.verdict === 'error' ? '✗' : ev.verdict
            const renderNote = ev.verdict === 'error' ? `Eval failed: ${ev.note}` : ev.note
            // Always emit — including 'error'. Silent failures hide bugs.
            emitCDUploadEvaluated(sessionId, {
              filename: data.filename,
              verdict: renderVerdict,
              note: renderNote,
            })
            // (Ralph 2026-05-06.) Phase 2: BOTH snackbar (above) + chat
            // toolcard (below). Snackbar carries the moment; this card is
            // the permanent record of CD's take, with image + verdict +
            // status/tag controls + CD-suggested slot intents.
            //
            // Batch-debounce (Ralph 2026-05-06): when N≥3 uploads land within
            // 1500ms of each other, consolidate into ONE batch card instead of
            // stacking N individual cards (anti-pollution rule). Uses a ref-
            // backed trailing-edge debouncer; flushUploadEvalBuffer decides
            // batch-vs-individual based on buffer length.
            enqueueUploadEval({
              filename: data.filename,
              path: data.path,
              verdict: renderVerdict,
              note: renderNote,
              description: data.analysis?.description,
              suggestedUses: Array.isArray(ev.suggestedUses) ? ev.suggestedUses : [],
              status: 'INGESTED',
            })
          }
        } catch (evalErr) {
          console.warn('[upload] CD eval failed:', evalErr)
        }
      }
    } catch (error) {
      console.error('Upload failed:', error)
    }
  }, [sessionId])

  // Create session on first message - extracts business name from content
  // Per AUDIT Section 9.1: "Call createSessionAction(businessName) when user starts first chat"
  //
  // Race-safe via sessionPromiseRef: the first caller starts the create flow
  // and stores its promise on the ref; subsequent concurrent callers await
  // the SAME promise instead of starting their own create. Without this,
  // double-click-send / paste-and-enter spawned duplicate session folders.
  const ensureSession = useCallback(async (messageContent: string): Promise<string> => {
    if (sessionId) return sessionId
    if (sessionPromiseRef.current) return sessionPromiseRef.current

    sessionPromiseRef.current = (async (): Promise<string> => {
      // Extract business name from message patterns like "my business is X", "I run X", "called X"
      const nameMatch = messageContent.match(/(?:called|named|is|run|own|for)\s+["']?([A-Z][^"'\n,.!?]+)/i)
      const extractedName = nameMatch?.[1]?.trim() || businessName || 'New Business'

      console.log('📁 Creating session for:', extractedName)
      const result = await createSessionAction(extractedName)

      if (!result.success || !result.sessionId) {
        throw new Error(result.error || 'Failed to create session')
      }

      const newSessionId = result.sessionId
      setSessionId(newSessionId)
      setBusinessName(extractedName)
      console.log('📁 Session created:', newSessionId)

      // If there are images uploaded to /uploads/ staging area, move them to session folder
      const uploadedImages = sourceImages.filter(img => img.path.startsWith('/uploads/'))
      if (uploadedImages.length > 0) {
        console.log('📦 Moving', uploadedImages.length, 'images from uploads to session folder')
        const moveResult = await moveImagesToSessionAction(
          newSessionId,
          uploadedImages.map(img => img.path)
        )

        if (moveResult.success && moveResult.movedImages) {
          // Update sourceImages with new paths
          setSourceImages(prev => prev.map(img => {
            const moved = moveResult.movedImages?.find(m => m.oldPath === img.path)
            if (moved) {
              console.log('📦 Updated path:', img.path, '->', moved.newPath)
              return { ...img, path: moved.newPath }
            }
            return img
          }))

          // Log each moved image to IMAGES.md
          for (const movedImg of moveResult.movedImages) {
            const originalImg = uploadedImages.find(img => img.path === movedImg.oldPath)
            await logImageUploadAction(newSessionId, movedImg.filename, originalImg?.analysis)
            console.log('📝 Logged to IMAGES.md:', movedImg.filename)
          }
          await updateWorkflowStateAction(newSessionId, { imagesUploaded: true })
        }
      }

      return newSessionId
    })()

    try {
      return await sessionPromiseRef.current
    } finally {
      // Clear the ref so a NEW session can be created later if the user
      // clears state. The committed sessionId is now in React state, so
      // future callers hit the `if (sessionId)` short-circuit above.
      sessionPromiseRef.current = null
    }
  }, [sessionId, businessName, sourceImages])

  // Send message to CD agent
  const handleSendMessage = useCallback(async (content: string, images?: File[], opts?: { skipUserAppend?: boolean }) => {
    console.log('🔴 API MODE - handleSendMessage called')
    // Upload any images first
    if (images && images.length > 0) {
      for (const file of images) {
        await handleUpload(file)
      }
    }

    // Inject Director Mode edits into context so AI preserves manual changes
    const activeEdits = selectedVibe ? vibeEdits.find(e => e.vibeId === selectedVibe.id) : null
    let finalContent = content

    if (activeEdits && activeEdits.textEdits.length > 0) {
      const editSummary = activeEdits.textEdits
        .map(e => `Element '${e.id}' was manually changed to: "${e.newText}"`)
        .join('\n')

      finalContent += `\n\n[SYSTEM NOTE: The user manually edited the current vibe. Ensure these text changes are preserved exactly in the next generation:\n${editSummary}]`
    }

    const userMessage: ConversationMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: finalContent,
      timestamp: new Date().toISOString()
    }

    // skipUserAppend: when this call is being dispatched from the message
    // queue (handleSend already appended the user message to chat history
    // for instant visibility), don't add it again. Otherwise the chat
    // shows duplicate user turns.
    const newMessages = opts?.skipUserAppend ? messages : [...messages, userMessage]
    if (!opts?.skipUserAppend) setMessages(newMessages)
    setIsLoading(true)

    try {
      // CRITICAL: Ensure session exists before ANY API call
      const currentSessionId = await ensureSession(content)

      // Prepare source image info for the CD prompt
      const sourceImageInfo = sourceImages.map(img => ({
        path: img.path,
        analysis: img.analysis
      }))

      // Build messages for API. In the queued-batch case (skipUserAppend),
      // `messages` already contains the individual queued user messages (B,
      // C, D…) appended for INSTANT chat-history visibility — but the
      // request CD should respond to is the COMBINED prompt (`finalContent`,
      // a "[N messages…] 1. B 2. C 3. D" assembly built by the drain
      // effect). API mode sends the full messages array to Anthropic; if
      // we don't replace those individual user turns with the combined
      // prompt, Claude responds to whichever happens to be last (msg D)
      // and the batch framing disappears — same disappearing-message
      // class that bit chat-stream/route.ts.
      //
      // Fix: truncate trailing queued user messages (everything after the
      // last assistant turn) and replace with ONE user message carrying
      // finalContent. Display history is unchanged (the user still sees
      // separate B / C / D bubbles in the UI). Ralph 2026-05-07.
      const messagesForAPI: Array<{ role: 'user' | 'assistant'; content: string }> =
        opts?.skipUserAppend
          ? (() => {
              const lastAssistantIdx = newMessages
                .map(m => m.role)
                .lastIndexOf('assistant')
              const baseHistory = lastAssistantIdx >= 0
                ? newMessages.slice(0, lastAssistantIdx + 1)
                : []
              return [
                ...baseHistory.map(m => ({ role: m.role, content: m.content })),
                { role: 'user' as const, content: finalContent },
              ]
            })()
          : newMessages.map(msg => ({ role: msg.role, content: msg.content }))

      // API route for CD chat (CLI/SMPL modes use handleStreamingMessage → chat-stream)
      const endpoint = '/api/chat'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesForAPI,
          sourceImages: sourceImageInfo,
          uploadedFiles: [],
          sessionId: currentSessionId,  // Pass sessionId to API
          isResume: isResumedSession  // Tell CD agent if this is a resumed session
        })
      })

      // Clear the resume flag after first message
      if (isResumedSession) {
        setIsResumedSession(false)
      }

      const data = await response.json()

      if (data.message) {
        const assistantMessage: ConversationMessage = {
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: data.message,
          timestamp: new Date().toISOString()
        }
        // Functional update — `newMessages` is stale if the user queued
        // additional messages mid-stream (handleSend appends them via
        // setMessages((prev) => …)). Overwriting with [...newMessages,
        // assistantMessage] wipes those queued appends. Always merge
        // against the latest state. Ralph 2026-05-02 bug.
        setMessages((prev) => [...prev, assistantMessage])

        // Log conversation to SESSION.md
        await appendToSessionLogAction(currentSessionId, 'User', content)
        await appendToSessionLogAction(currentSessionId, 'CD', data.message)
      }

      // Process vibes
      if (data.vibes && data.vibes.length > 0 && data.vibePaths) {
        const newVibes: VibeData[] = data.vibes.map((v: any, i: number) => ({
          id: `vibe-${Date.now()}-${i}`,
          name: v.name,
          category: v.category || 'premium',
          headline: v.headline,
          tagline: v.tagline,
          colors: v.colors,
          typography: v.typography,
          voiceSamples: v.voiceSamples,
          htmlPath: data.vibePaths[i],
          html: v.html,
          heroImage: v.heroImage,  // FIXED: Include heroImage
          audience: v.audience,    // FIXED: Include audience
          mood: v.mood             // FIXED: Include mood
        }))
        setVibes(newVibes)
        if (!selectedVibe && newVibes.length > 0) {
          setSelectedVibe(newVibes[0])
        }
        // Transition to 3-panel layout when vibes are generated

        setWorkflowPhase('generation')
      }

      // Process image manifests
      if (data.imageManifests && data.imageManifests.length > 0) {
        setImageManifests(data.imageManifests)
      }

      // Update context window fill from API response
      if (data.contextPct !== undefined) {
        setContextPct(data.contextPct)
      }
      if (data.cachedInputTokens !== undefined) {
        setCachedInputTokens(data.cachedInputTokens)
      }
      if (data.realInputTokens !== undefined) {
        setRealInputTokens(data.realInputTokens)
      }

      // Process moodboard
      if (data.moodboard) {
        setMoodboard({
          id: data.moodboard.id,
          imagePath: data.moodboard.imagePath,
          concepts: data.moodboard.concepts,
          generatedAt: data.moodboard.generatedAt
        })
        setWorkflowPhase('moodboard')
      }

      // After Claude finishes, read IMAGES.md and populate AssetsPanel
      const manifestResult = await getImageManifestsAction(currentSessionId)
      if (manifestResult.success && manifestResult.manifests && manifestResult.manifests.length > 0) {
        setImageManifests(manifestResult.manifests)

        setWorkflowPhase('generation')
        console.log('📸 Loaded', manifestResult.manifests.length, 'manifests from IMAGES.md')
      }

      // Read image entries from IMAGES.md to get reprompts and update sourceImages
      const entriesResult = await getImageEntriesAction(currentSessionId)
      if (entriesResult.success && entriesResult.entries) {
        setSourceImages(prev => prev.map(img => {
          const imgFilename = img.filename.replace(/^\d+-/, '')
          const entry = Object.values(entriesResult.entries!).find(e =>
            e.filename === img.filename || e.filename === imgFilename
          )
          if (entry) {
            // Use reprompt as description if cdAnalysis is missing (new format)
            const description = entry.cdAnalysis || entry.reprompt || img.analysis?.description || ''
            return {
              ...img,
              tag: entry.tag || img.tag || 'INGESTED' as const,
              // usedIn (Ralph 2026-04-25): independent of tag so HERO+USED
              // can coexist visually. Computed from vibe HTML scan in
              // parseImagesMd. Always overwrite from the parser so toggling
              // a vibe slot updates the bottom-right pill on next refresh.
              usedIn: entry.usedIn,
              analysis: {
                ...img.analysis,
                elements: img.analysis?.elements || [],
                description,
                suggestedExtractions: img.analysis?.suggestedExtractions || [],
                reprompt: entry.reprompt,
                suggestedUses: entry.suggestedUses,
                suggestedVibes: entry.suggestedVibes
              }
            }
          }
          // No IMAGES.md entry — keep existing tag; otherwise default to
          // INGESTED so the image doesn't slip into the pending-uploads
          // bucket on next render. INGESTED is a SILENT gate — no badge.
          return img.tag ? img : { ...img, tag: 'INGESTED' as const }
        }))
        console.log('📸 Updated sourceImages with reprompts and tags from IMAGES.md (API mode)')
      }

    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage: ConversationMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: 'Sorry, there was an error processing your request.',
        timestamp: new Date().toISOString()
      }
      // Functional update preserves any messages queued mid-stream.
      setMessages((prev) => [...prev, errorMessage])
    }

    setIsLoading(false)
  }, [messages, sourceImages, selectedVibe, vibeEdits, handleUpload, billingMode, ensureSession, isResumedSession])

  // Send message with streaming response
  const handleStreamingMessage = useCallback(async (content: string, images?: File[], opts?: { skipUserAppend?: boolean }) => {
    console.log('🟢 CLI MODE - handleStreamingMessage called')
    // Upload any images first
    if (images && images.length > 0) {
      for (const file of images) {
        await handleUpload(file)
      }
    }

    // Inject Director Mode edits into context
    const activeEdits = selectedVibe ? vibeEdits.find(e => e.vibeId === selectedVibe.id) : null
    let finalContent = content

    if (activeEdits && activeEdits.textEdits.length > 0) {
      const editSummary = activeEdits.textEdits
        .map(e => `Element '${e.id}' was manually changed to: "${e.newText}"`)
        .join('\n')
      finalContent += `\n\n[SYSTEM NOTE: The user manually edited the current vibe. Ensure these text changes are preserved exactly in the next generation:\n${editSummary}]`
    }

    const userMessage: ConversationMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: finalContent,
      timestamp: new Date().toISOString()
    }

    // skipUserAppend: see handleSendMessage above. Queue-dispatched calls
    // already had their user message appended in handleSend.
    const newMessages = opts?.skipUserAppend ? messages : [...messages, userMessage]
    if (!opts?.skipUserAppend) setMessages(newMessages)
    setIsLoading(true)
    setStreamingText('')
    setStreamingProgress({ phase: 'idle', message: 'Connecting...' })

    try {
      // CRITICAL: Ensure session exists before ANY API call
      const currentSessionId = await ensureSession(content)

      const sourceImageInfo = sourceImages.map(img => ({
        path: img.path,
        analysis: img.analysis
      }))

      const messagesForAPI = newMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))

      const response = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesForAPI,
          // Explicit current message — the one CD should respond to
          // THIS turn. Without this, the route .pop()'s the user-filter
          // on history and silently picks the wrong message when the
          // queue dispatches an out-of-order item (multiple mid-stream
          // queued messages all land in history but are dispatched one
          // per turn). Ralph 2026-05-02 disappearing-message bug.
          currentMessage: finalContent,
          sourceImages: sourceImageInfo,
          sessionId: currentSessionId,  // Pass sessionId to API (for file storage)
          selectedMoodboardConcept: moodboard?.selectedConcept,  // Pass moodboard selection
          cliSessionId,  // Pass CLI session UUID (for --session-id flag)
          isResume: isResumedSession,  // Tell CD agent if this is a resumed session
          executionMode: billingMode,  // 'smpl' | 'cli' | 'api'
          cdModel: { smpl: 'opus', cli: 'claude-opus-4-7[1m]', api: 'claude-opus-4-7' }[billingMode],
          // Read from ref — always latest. If we referenced `webDevModel`
          // directly, the enclosing useCallback would need it in deps, which
          // would re-create the whole 532-line callback on every model toggle.
          webDevModel: webDevModelRef.current
        })
      })

      // Clear the resume flag after first message
      if (isResumedSession) {
        setIsResumedSession(false)
      }

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''
      let buffer = ''
      const collectedManifests: ImageManifest[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const dataStr = line.slice(5).trim()
          if (!dataStr || dataStr === '[DONE]') continue

          try {
            const event: StreamEvent = JSON.parse(dataStr)

            switch (event.type) {
              case 'start':
                setStreamingProgress({ phase: 'idle', message: event.message })
                // Store CLI session UUID for subsequent calls
                if ((event as any).cliSessionId) {
                  setCliSessionId((event as any).cliSessionId)
                  console.log('📎 CLI session started:', (event as any).cliSessionId)
                }
                break

              case 'model_info':
                // Badge trust ladder (Ralph 2026-05-05). Only update if
                // incoming trust >= current. config(0) → init(1) → wire(2).
                // A late-firing init after wire must NOT clobber truth.
                {
                  const src = (event as any).source as string | undefined
                  const mdl = (event as any).model as string | undefined
                  const trustMap: Record<string, number> = { config: 0, init: 1, wire: 2 }
                  const incoming = trustMap[src ?? ''] ?? 0
                  if (mdl && mdl.length > 0 && incoming >= modelTrustRef.current) {
                    modelTrustRef.current = incoming
                    setCurrentModel(mdl)
                    console.log(`🏷️ Badge: ${mdl} (source=${src ?? 'unknown'}, trust=${incoming})`)
                  }
                }
                break

              case 'text':
                assistantContent += event.content
                setStreamingText(assistantContent)
                break

              case 'progress':
                setStreamingProgress({
                  phase: event.phase as StreamingProgress['phase'],
                  message: event.message,
                  vibesCurrent: event.current,
                  currentVibeName: event.name
                })
                break

              case 'tool_complete':
                // 2026-05-04 (Ralph): generate_vibe SSE handler removed.
                // Vibes flow through the vibe_built event-bus event after
                // build_vibe / build_all_vibes / build_final MCP tools.
                break

              case 'image_manifests':
                // Receive image prompts from CD - display in AssetsPanel for editing IMMEDIATELY
                if ((event as any).manifests && (event as any).manifests.length > 0) {
                  const newManifests: ImageManifest[] = (event as any).manifests.map((m: any) => ({
                    ...m,
                    assets: m.assets.map((a: any) => ({
                      ...a,
                      status: 'pending' as const
                    }))
                  }))
                  collectedManifests.push(...newManifests)
                  // Set manifests immediately so they appear in the UI
                  setImageManifests([...collectedManifests])
                  setStreamingProgress({
                    phase: 'vibe',
                    message: (event as any).message || `Found ${newManifests.length} vibes with image prompts`
                  })
                  console.log('📸 Image manifests received:', newManifests.length, 'vibes')
                }
                break

              case 'update_assets':
                // CD agent signaled IMAGES.md changed — re-read manifests + entries
                console.log('📸 UPDATE ASSETS detected — re-reading IMAGES.md')
                {
                  const currentSessionId = (event as any).sessionId || sessionId
                  if (currentSessionId) {
                    const manifestResult = await getImageManifestsAction(currentSessionId)
                    if (manifestResult.success && manifestResult.manifests && manifestResult.manifests.length > 0) {
                      setImageManifests(manifestResult.manifests)
                      console.log('📸 Refreshed', manifestResult.manifests.length, 'manifests from IMAGES.md')
                    }
                  }
                }
                break

              case 'done':
                setStreamingProgress({
                  phase: 'done',
                  message: `Generated ${event.vibeCount} vibes` + ((event as any).manifestCount ? ` with ${(event as any).manifestCount} image sets` : ''),
                  vibesTotal: event.vibeCount
                })
                // Update context window fill from bridge result
                if ((event as any).contextPct !== undefined) {
                  setContextPct((event as any).contextPct)
                }
                if ((event as any).cachedInputTokens !== undefined) {
                  setCachedInputTokens((event as any).cachedInputTokens)
                }
                if ((event as any).realInputTokens !== undefined) {
                  setRealInputTokens((event as any).realInputTokens)
                }
                break

              case 'build_ready':
                console.log('🔨 BUILD READY - WebDev is building...')
                setStreamingProgress({
                  phase: 'vibe',
                  message: 'WebDev is building the landing page...'
                })
                break

              case 'webdev_complete':
                console.log('✅ WebDev complete:', (event as any).paths)
                // Create a vibe from the WebDev output
                if ((event as any).paths?.landing) {
                  const landingPath = (event as any).paths.landing
                  const webdevVibe: VibeData = {
                    id: `vibe-webdev-${Date.now()}`,
                    name: 'Landing Page',
                    category: 'premium',
                    headline: '',
                    tagline: '',
                    colors: [],
                    typography: { heading: '', body: '' },
                    voiceSamples: [],
                    htmlPath: landingPath,
                    html: '' // Will load from htmlPath
                  }
                  setVibes(prev => [...prev, webdevVibe])
                  setSelectedVibe(webdevVibe)
          
                  setWorkflowPhase('generation')
                  console.log('🎨 WebDev vibe added:', webdevVibe.htmlPath)

                  // Add chat notification
                  setMessages(prev => [...prev, {
                    id: `webdev-complete-${Date.now()}`,
                    role: 'assistant',
                    content: `🔨 **Landing page built!** View it in the center panel or [open in new tab](${landingPath})`,
                    timestamp: new Date().toISOString()
                  }])
                }
                break

              case 'webdev_error':
                console.error('❌ WebDev failed:', (event as any).error)
                break

              // ==========================================
              // Vibe Generation Events (from VIBES READY trigger)
              // ==========================================

              case 'vibes_ready':
                console.log('🎨 VIBES READY - WebDev is building vibe pages...')
                setStreamingProgress({
                  phase: 'vibe',
                  message: 'Building vibe landing pages...'
                })
                break

              case 'vibe_complete':
                // A single vibe page was built - add it to the UI immediately
                const vibeData = (event as any).vibe
                console.log(`🎨 Vibe built: ${vibeData.name}`)

                // Add to availableVibes for vibe switcher
                const newVibePreview: VibePreview = {
                  index: vibeData.index,
                  name: vibeData.name,
                  slug: vibeData.slug,
                  filename: vibeData.filename,
                  status: 'ready',
                  htmlPath: vibeData.htmlPath
                }

                setAvailableVibes(prev => {
                  const exists = prev.some(v => v.filename === vibeData.filename)
                  if (exists) {
                    // Update existing entry (same filename)
                    return prev.map(v => v.filename === vibeData.filename ? newVibePreview : v)
                  }
                  return [...prev, newVibePreview]
                })

                // Auto-select first vibe when it arrives
                setSelectedVibeFile(current => current === null ? vibeData.filename : current)

                // Also add to vibes state for compatibility
                const newVibeFromEvent: VibeData = {
                  id: `vibe-${vibeData.slug}-${Date.now()}`,
                  name: vibeData.name,
                  category: 'premium',
                  headline: vibeData.oneLiner || '',
                  tagline: '',
                  colors: vibeData.colors ? [
                    vibeData.colors.primary,
                    vibeData.colors.secondary,
                    vibeData.colors.accent,
                    vibeData.colors.text || '#1A1A1A'
                  ] : [],
                  typography: {
                    heading: vibeData.fonts?.headings || '',
                    body: vibeData.fonts?.body || ''
                  },
                  voiceSamples: [vibeData.voice || '', vibeData.whoFor || ''],
                  htmlPath: vibeData.htmlPath,
                  html: '',
                  heroImage: vibeData.heroImage,  // FIXED: Include heroImage from event
                  audience: vibeData.audience,    // FIXED: Include audience from event
                  mood: vibeData.mood             // FIXED: Include mood from event
                }

                // Add vibe to state progressively
                setVibes(prev => {
                  // Check if already exists (by htmlPath)
                  const exists = prev.some(v => v.htmlPath === vibeData.htmlPath)
                  if (exists) return prev
                  return [...prev, newVibeFromEvent]
                })

                // Select first vibe if none selected
                setSelectedVibe(current => current || newVibeFromEvent)

                // Switch to 3-panel layout on first vibe
        
                setWorkflowPhase('generation')

                // Update progress
                setWorkflowProgress(prev => ({
                  ...prev,
                  currentPhase: 'review',
                  vibesComplete: prev.vibesComplete + 1
                }))

                setStreamingProgress(prev => ({
                  ...prev,
                  message: `Built "${vibeData.name}"`,
                  currentVibeName: vibeData.name
                }))

                // Emit vibe ready event for snackbar
                if (currentSessionId) {
                  emitVibeReady(currentSessionId, vibeData.name, vibeData.filename)
                }
                break

              case 'vibe_error':
                console.error(`❌ Vibe ${(event as any).vibeIndex} failed:`, (event as any).error)
                setStreamingProgress(prev => ({
                  ...prev,
                  message: `Error building "${(event as any).vibeName}": ${(event as any).error}`
                }))
                break

              case 'all_vibes_complete':
                console.log(`✅ All ${(event as any).vibeCount} vibes built`)
                setWorkflowProgress(prev => ({
                  ...prev,
                  currentPhase: 'review',
                  vibesGenerated: (event as any).vibeCount,
                  vibesComplete: (event as any).vibeCount
                }))
                setStreamingProgress({
                  phase: 'done',
                  message: `Built ${(event as any).vibeCount} vibe landing pages`
                })

                // Add chat notification
                setMessages(prev => [...prev, {
                  id: `vibes-complete-${Date.now()}`,
                  role: 'assistant',
                  content: `🎨 **${(event as any).vibeCount} vibes ready for review!** Switch between them using the tabs above the preview.`,
                  timestamp: new Date().toISOString()
                }])
                break

              case 'error':
                setStreamingProgress({
                  phase: 'error',
                  message: event.message
                })
                break
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }

      if (collectedManifests.length > 0) {
        setImageManifests(collectedManifests)
      }

      // Add final assistant message
      if (assistantContent) {
        const assistantMessage: ConversationMessage = {
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date().toISOString()
        }
        // Functional update — `newMessages` is stale if the user queued
        // additional messages mid-stream. See sibling fix in
        // handleSendMessage. Ralph 2026-05-02 bug.
        setMessages((prev) => [...prev, assistantMessage])

        // Log conversation to SESSION.md
        await appendToSessionLogAction(currentSessionId, 'User', content)
        await appendToSessionLogAction(currentSessionId, 'CD', assistantContent)
      }

      // After Claude finishes, read IMAGES.md and populate AssetsPanel
      const manifestResult = await getImageManifestsAction(currentSessionId)
      if (manifestResult.success && manifestResult.manifests && manifestResult.manifests.length > 0) {
        setImageManifests(manifestResult.manifests)

        setWorkflowPhase('generation')
        console.log('📸 Loaded', manifestResult.manifests.length, 'manifests from IMAGES.md')
      }

      // Read image entries from IMAGES.md to get reprompts and update sourceImages
      const entriesResult = await getImageEntriesAction(currentSessionId)
      if (entriesResult.success && entriesResult.entries) {
        setSourceImages(prev => prev.map(img => {
          const imgFilename = img.filename.replace(/^\d+-/, '')
          const entry = Object.values(entriesResult.entries!).find(e =>
            e.filename === img.filename || e.filename === imgFilename
          )
          if (entry) {
            // Use reprompt as description if cdAnalysis is missing (new format)
            const description = entry.cdAnalysis || entry.reprompt || img.analysis?.description || ''
            return {
              ...img,
              tag: entry.tag || img.tag || 'INGESTED' as const,
              // usedIn (Ralph 2026-04-25): independent of tag so HERO+USED
              // can coexist visually. Computed from vibe HTML scan in
              // parseImagesMd. Always overwrite from the parser so toggling
              // a vibe slot updates the bottom-right pill on next refresh.
              usedIn: entry.usedIn,
              analysis: {
                ...img.analysis,
                elements: img.analysis?.elements || [],
                description,
                suggestedExtractions: img.analysis?.suggestedExtractions || [],
                reprompt: entry.reprompt,
                suggestedUses: entry.suggestedUses,
                suggestedVibes: entry.suggestedVibes
              }
            }
          }
          // No IMAGES.md entry — keep existing tag; otherwise default to
          // INGESTED so the image doesn't slip into the pending-uploads
          // bucket on next render. INGESTED is a SILENT gate — no badge.
          return img.tag ? img : { ...img, tag: 'INGESTED' as const }
        }))
        console.log('📸 Updated sourceImages with reprompts and tags from IMAGES.md (streaming mode)')
      }

    } catch (error) {
      console.error('Streaming error:', error)
      setStreamingProgress({
        phase: 'error',
        message: String(error)
      })
      const errorMessage: ConversationMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: 'Sorry, there was an error processing your request.',
        timestamp: new Date().toISOString()
      }
      // Functional update preserves any messages queued mid-stream.
      setMessages((prev) => [...prev, errorMessage])
    }

    setIsLoading(false)
    setStreamingText('')
    setStreamingProgress({ phase: 'idle', message: '' })
  }, [messages, sourceImages, selectedVibe, vibeEdits, handleUpload, ensureSession, cliSessionId, moodboard, businessName, sessionId, isResumedSession])

  // ─────────────────────────────────────────────────────────────────────────
  // ChatCoordinator — SINGLE MESSAGE ENTRY POINT.
  //
  // Was: 8 call sites each branching `billingMode === 'cli' ? stream : api`.
  // Bugs in the branch logic had to be fixed in 8 places; agents (or us)
  // routinely forgot one. Now every send goes through `handleSend`, the one
  // branch lives here, and callers don't know or care about billing mode.
  //
  // handleStreamingMessage + handleSendMessage stay as the actual transports —
  // this is just the routing layer. Further extraction (merge transports,
  // hook-ify, etc.) can happen later without touching call sites.
  // ─────────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────
  // Message queue — lets the user send while CD is mid-stream.
  // ───────────────────────────────────────────────────────────────────────
  // Without this, the send button is disabled while `isLoading` is true.
  // CD turns can take 30s+, during which the user feels stuck. The queue
  // captures inputs sent during streaming and drains them via a useEffect
  // that watches `isLoading`. When the current stream completes
  // (isLoading flips false) and the queue is non-empty, the next message
  // dispatches automatically — chained as a follow-up turn.
  //
  // Two refs to avoid stale-closure problems:
  //  - isLoadingRef: handleSend reads it synchronously to decide queue vs.
  //    dispatch. Plain useState would lag a render.
  //  - messageQueueRef: same — drainQueue reads it inside the effect.
  const [messageQueue, setMessageQueue] = useState<{ content: string; images?: File[] }[]>([])
  const messageQueueRef = useRef(messageQueue)
  messageQueueRef.current = messageQueue
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading

  // Push a mid-stream user message to CD's MCP inbox. Fire-and-forget.
  // 2026-05-02 (Ralph): from-role is `user` (added to the bus today).
  // The bus also publishes an `agent_inbox_message` event, so any client
  // with an open MCP transport receives a push notification before its
  // next polled drain.
  //
  // Honest caveat: CD-as-CLI-subprocess doesn't reliably surface push
  // events as model-context updates mid-generation. The push lands in
  // her transport's incoming queue but won't necessarily reach her
  // active reasoning loop until she takes a tool call or completes the
  // current generation. The chat queue (auto-dispatch when stream ends)
  // remains the durable delivery mechanism. When CD migrates to MCP
  // server peer per WP-F1b, mid-stream immediacy will work end-to-end.
  const pushUserMessageToCD = useCallback((content: string) => {
    if (!sessionId) return
    fetch('/api/mcp/notify-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        from: 'user',
        fromInstance: `web-chat-${sessionId}`,
        target: 'cd',
        priority: 'high',
        message: content,
        replyTo: null,
      }),
    }).catch((err) => {
      // Non-fatal — the chat queue is the primary delivery mechanism.
      // MCP push is the supplementary channel for inbox visibility.
      console.warn('[handleSend] MCP push to CD failed (non-fatal):', err)
    })
  }, [sessionId])

  const handleSend = useCallback(
    (content: string, images?: File[]) => {
      // CD is currently streaming → queue the message instead of dispatching.
      // BUT: append the user message to chat history IMMEDIATELY so the
      // user sees it land in the conversation right away. Without this,
      // queued messages were invisible until they dispatched — Ralph
      // 2026-05-02: "the messages are not seen at all." Now the chat
      // shows: [user msg 1] · CD streaming response… · [user msg 2 just
      // landed] · [user msg 3 just landed] — fully visible.
      //
      // The MCP push also lands the message in CD's inbox immediately so
      // her next turn boot drains them before she responds.
      if (isLoadingRef.current) {
        const userMessage: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          content,
          timestamp: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, userMessage])
        setMessageQueue((q) => [...q, { content, images }])
        pushUserMessageToCD(content)
        return
      }
      if (billingMode !== 'api') {
        return handleStreamingMessage(content, images)
      }
      return handleSendMessage(content, images)
    },
    [billingMode, handleStreamingMessage, handleSendMessage, pushUserMessageToCD]
  )

  // Drain the queue when CD finishes a turn. BATCHES every queued
  // message into ONE follow-up turn — joined into a single prompt CD
  // responds to holistically. NOT one-at-a-time chaining (which spawns
  // N sequential CD turns, takes forever, and risks contradictory
  // responses across them). Ralph 2026-05-02: "all of them delivered
  // at ONCE, not one by one."
  //
  // Format: each queued message becomes one numbered line in a single
  // user prompt. CD sees the sequence the user typed and answers as
  // one coherent response.
  useEffect(() => {
    if (isLoading) return
    if (messageQueueRef.current.length === 0) return

    // Snapshot ALL queued items, then clear the queue in one shot.
    const all = [...messageQueueRef.current]
    setMessageQueue([])

    // Combine into a single prompt. Single message → just send the
    // content as-is. Multiple messages → enumerate so CD knows they
    // arrived in sequence and treats them as a holistic batch.
    const combinedContent = all.length === 1
      ? all[0].content
      : `[${all.length} messages sent while you were responding — please address them together]\n\n` +
        all.map((m, i) => `${i + 1}. ${m.content}`).join('\n\n')

    // Collapse all attached images across the batch (rare path).
    const combinedImages = all.flatMap((m) => m.images || [])
    const imagesArg = combinedImages.length > 0 ? combinedImages : undefined

    // Defer to microtask so the setMessageQueue commit lands before the
    // dispatch flips isLoading=true again.
    queueMicrotask(() => {
      if (billingMode !== 'api') {
        handleStreamingMessage(combinedContent, imagesArg, { skipUserAppend: true })
      } else {
        handleSendMessage(combinedContent, imagesArg, { skipUserAppend: true })
      }
    })
  }, [isLoading, billingMode, handleStreamingMessage, handleSendMessage])

  // Keep messageHandlerRef updated with the current handler for session events
  useEffect(() => {
    messageHandlerRef.current = handleSend
  }, [handleSend])

  // AUTO-TRIGGER: Send boot/resume message through normal conversation flow
  // Two modes: bridge resume (has BRIDGE.json) = "I'm back." | cold start = boot protocol
  useEffect(() => {
    if (pendingBootSequenceRef.current && isResumedSession && sessionId && !isLoading && !bootSequenceTriggeredRef.current) {
      pendingBootSequenceRef.current = false
      bootSequenceTriggeredRef.current = true  // Prevent duplicate triggers

      // Bridge resume: agent already has full context, no boot needed
      // Cold start: agent needs to read files and report status
      const bootMessage = hasBridgeMappingRef.current
        ? `I'm back.`
        : `Executing boot protocol:
1. Read SESSION.md: cat public/${sessionId}/SESSION.md
2. Report what phase we're in
3. Report what's coming up next`

      console.log(`🔄 ${hasBridgeMappingRef.current ? 'Bridge resume' : 'Cold start'} → sending: "${bootMessage.split('\n')[0]}"...`)

      handleSend(bootMessage)
    }
  }, [isResumedSession, sessionId, isLoading, handleSend])

  // Select an asset to view/edit
  const handleAssetSelect = useCallback((asset: ImageAsset) => {
    setSelectedAsset(asset)
  }, [])

  // `handleAssetGenerate` has moved to lib/hooks/useImagePipeline.ts as
  // `generateAsset`. The state machine (generating → complete | error),
  // /api/edit-image call, IMAGES.md logging, and hot-swap all live in the
  // hook. Page.tsx no longer owns any of it. An alias preserves the old
  // name at call sites without re-exporting the pipeline internals.
  const handleAssetGenerate = generateAsset

  // Update asset (e.g., edited instruction)
  const handleAssetUpdate = useCallback((asset: ImageAsset) => {
    setImageManifests(prev => prev.map(manifest => ({
      ...manifest,
      assets: manifest.assets.map(a =>
        a.id === asset.id ? asset : a
      )
    })))
    setSelectedAsset(asset)
  }, [])

  // Dismiss/remove an asset from manifests
  const handleAssetDismiss = useCallback((asset: ImageAsset) => {
    setImageManifests(prev => prev.map(manifest => ({
      ...manifest,
      assets: manifest.assets.filter(a => a.id !== asset.id)
    })).filter(manifest => manifest.assets.length > 0))  // Remove empty manifests

    // Clear selected asset if it was the dismissed one
    if (selectedAsset?.id === asset.id) {
      setSelectedAsset(undefined)
    }

    console.log(`🗑️ Dismissed asset: ${asset.filename}`)
  }, [selectedAsset])

  // Clear selected asset
  const handleClearAsset = useCallback(() => {
    setSelectedAsset(undefined)
  }, [])

  // Edit source image with Nano Banana
  const handleSourceImageEdit = useCallback(async (
    sourceImage: SourceImage,
    instruction: string,
    operation: 'edit' | 'generate' = 'edit'
  ) => {
    const apiOperation = operation === 'edit' ? 'adjust' : 'generate'
    console.log(`🎨 ${operation === 'edit' ? 'Editing' : 'Generating from'} ${sourceImage.filename} with: ${instruction}`)

    try {
      // Build a filename hint: `{intent-slug}-{source-base}` for edits,
      // `{intent-slug}` for pure generates. Server uses this when present
      // and not generic. (Ralph 2026-04-25: previously this path discarded
      // the hint entirely, forcing camera-vocab names from Nano descriptions.)
      const intentSlug = instruction
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join('-')
      const sourceBase =
        operation === 'edit'
          ? sourceImage.filename.replace(/\.[^/.]+$/, '')
          : ''
      const filenameHint = sourceBase
        ? (intentSlug ? `${intentSlug}-${sourceBase}` : sourceBase)
        : (intentSlug || undefined)

      const response = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceImagePaths: operation === 'edit' ? [sourceImage.path] : [],
          instruction: instruction,
          filename: filenameHint,
          imageSize: '2K',
          aspectRatio: '16:9',
          operation: apiOperation,
          sessionId
        })
      })

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error)
      }

      console.log(`✅ Generated edited image: ${data.savedPath}`)

      // Add the new image to source images with generation metadata
      if (data.savedPath) {
        const newImage: SourceImage = {
          id: `${operation}-${Date.now()}`,
          filename: data.savedPath.split('/').pop() || `${operation}-${sourceImage.filename}`,
          path: data.savedPath,
          uploadedAt: new Date().toISOString(),
          analysis: {
            elements: operation === 'edit' ? (sourceImage.analysis?.elements || []) : [],
            description: operation === 'edit'
              ? `Edited from ${sourceImage.filename}: ${instruction}`
              : `Generated: ${instruction}`,
            suggestedExtractions: []
          },
          // Generation metadata - tracks lineage
          isGenerated: true,
          sourcePrompt: instruction,
          generationStatus: 'pending',  // Needs CD review
          tag: 'B-ROLL'  // Default tag until CD evaluates
        }
        setSourceImages(prev => [...prev, newImage])

        // Log to IMAGES.md if we have a session.
        // 2026-04-29 Phase 2: removed `emitImageReady(...)` here. /api/edit-image
        // now publishes `image_ready` to the event-bus server-side; the
        // /api/events SSE delivers it to BOTH the frontend (sessionEvents)
        // AND the MCP server (CD as logging notification). Single source.
        if (sessionId) {
          const logType = operation === 'edit' ? 'edited' : 'generated'
          await logImageGenerationAction(sessionId, newImage.filename, instruction, logType, undefined, data.geminiText || undefined)
        }
      }
    } catch (error) {
      console.error(`Source image ${operation} error:`, error)
      if (sessionId) {
        emitError(sessionId, `Failed to ${operation} ${sourceImage.filename}: ${error}`)
      }
    }
  }, [sessionId])

  // Compose two source images with Nano Banana
  const handleSourceImageCompose = useCallback(async (
    baseImage: SourceImage,
    extractImage: SourceImage,
    instruction: string
  ) => {
    console.log(`🎨 Composing images: base=${baseImage.filename}, extract=${extractImage.filename}`)
    console.log(`   Instruction: ${instruction}`)

    try {
      // Compose hint: anchor on the base image's name. (Ralph 2026-04-25.)
      const composeIntentSlug = instruction
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join('-')
      const composeBase = baseImage.filename.replace(/\.[^/.]+$/, '')
      const composeFilenameHint = composeIntentSlug
        ? `${composeIntentSlug}-${composeBase}`
        : composeBase

      const response = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceImagePaths: [baseImage.path, extractImage.path],  // Both images
          instruction: instruction,
          filename: composeFilenameHint,
          imageSize: '2K',
          aspectRatio: '16:9',
          operation: 'compose',
          sessionId
        })
      })

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error)
      }

      console.log(`✅ Generated composed image: ${data.savedPath}`)

      // Add the new image to source images with generation metadata
      if (data.savedPath) {
        const newImage: SourceImage = {
          id: `composed-${Date.now()}`,
          filename: data.savedPath.split('/').pop() || `composed.jpg`,
          path: data.savedPath,
          uploadedAt: new Date().toISOString(),
          analysis: {
            elements: [
              ...(baseImage.analysis?.elements || []),
              ...(extractImage.analysis?.elements || [])
            ],
            description: `Composed from ${baseImage.filename} + ${extractImage.filename}: ${instruction}`,
            suggestedExtractions: []
          },
          // Generation metadata - tracks lineage
          isGenerated: true,
          sourcePrompt: instruction,
          generationStatus: 'pending',  // Needs CD review
          tag: 'B-ROLL'  // Default tag until CD evaluates
        }
        setSourceImages(prev => [...prev, newImage])

        // Log to IMAGES.md if we have a session.
        // emitImageReady removed for the same reason as the edit branch above —
        // /api/edit-image publishes `image_ready` server-side now.
        if (sessionId) {
          await logImageGenerationAction(sessionId, newImage.filename, instruction, 'composed', undefined, data.geminiText || undefined)
        }
      }
    } catch (error) {
      console.error('Source image compose error:', error)
      if (sessionId) {
        emitError(sessionId, `Failed to compose ${baseImage.filename} + ${extractImage.filename}: ${error}`)
      }
    }
  }, [sessionId])

  // Update source image (e.g., reprompt edit saved on blur)
  const handleSourceImageUpdate = useCallback((updatedImage: SourceImage) => {
    setSourceImages(prev => prev.map(img =>
      img.id === updatedImage.id ? updatedImage : img
    ))
    console.log(`📝 Updated reprompt for ${updatedImage.filename}`)
  }, [])

  // Handle source image deletion
  const handleSourceImageDelete = useCallback(async (imageToDelete: SourceImage) => {
    // Always remove from UI state immediately
    setSourceImages(prev => prev.filter(img => img.id !== imageToDelete.id))

    // If no session, just remove from UI (pending upload, no disk file to clean)
    if (!sessionId) return

    // Delete file from disk
    try {
      const delRes = await fetch('/api/vibe-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, filename: imageToDelete.filename })
      })
      const delData = await delRes.json()
      if (delData.success) {
        console.log(`🗑️ Deleted from disk: ${sessionId}/${imageToDelete.filename}`)
      } else {
        console.error(`🗑️ Delete failed: ${delData.error} (session=${sessionId}, file=${imageToDelete.filename})`)
      }
    } catch (err) {
      console.error('Error deleting image file:', err)
    }

    // Remove entry from IMAGES.md
    try {
      await fetch('/api/session-md-remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, type: 'image', filename: imageToDelete.filename })
      })
      console.log(`🗑️ Removed "${imageToDelete.filename}" from IMAGES.md`)
    } catch (err) {
      console.error('Error removing image from IMAGES.md:', err)
    }

    // Notify CD agent — same pattern as image uploads
    const message = `I've deleted the image "${imageToDelete.filename}".`
    handleSend(message)
  }, [sessionId, handleSend])

  // Handle Director Mode element selection from iframe
  const handleElementSelect = useCallback((element: SelectedElement | null) => {
    setSelectedElement(element)
  }, [])

  // Handle Director Mode text edit
  const handleTextEdit = useCallback((elementId: string, newText: string) => {
    // Send update to iframe immediately (optimistic UI)
    const oskarCanvas = (window as unknown as { oskarCanvas?: { sendTextUpdate: (id: string, text: string) => void } }).oskarCanvas
    if (oskarCanvas) {
      oskarCanvas.sendTextUpdate(elementId, newText)
    }

    // Store edit in local state
    if (selectedVibe) {
      setVibeEdits(prev => {
        const existing = prev.find(e => e.vibeId === selectedVibe.id)
        if (existing) {
          const textEditIndex = existing.textEdits.findIndex(te => te.id === elementId)
          if (textEditIndex >= 0) {
            existing.textEdits[textEditIndex].newText = newText
          } else {
            existing.textEdits.push({ id: elementId, newText })
          }
          return [...prev]
        } else {
          return [...prev, {
            vibeId: selectedVibe.id,
            textEdits: [{ id: elementId, newText }],
            imageSwaps: []
          }]
        }
      })
    }

    // Debounce API call to persist to disk (300ms)
    if (sessionId && selectedVibeFile !== null) {
      // Clear existing debounce timer for this element
      const existingTimer = textEditDebounceRef.current.get(elementId)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Get the vibe file from availableVibes
      const currentVibe = availableVibes.find(v => v.filename === selectedVibeFile)
      if (!currentVibe?.filename) return

      // Set new debounce timer
      const timer = setTimeout(async () => {
        textEditDebounceRef.current.delete(elementId)

        try {
          const response = await fetch('/api/vibe-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              vibeFile: currentVibe.filename,
              editType: 'text',
              elementId,
              newValue: newText
            })
          })

          const data = await response.json()

          if (!response.ok) {
            emitError(sessionId!, `Failed to save edit: ${data.error || 'Unknown error'}`)
          } else {
            console.log(`✏️ Saved text edit: ${elementId} in ${currentVibe.filename}`)
          }
        } catch (error) {
          emitError(sessionId!, `Failed to save edit: ${error}`)
        }
      }, 300)

      textEditDebounceRef.current.set(elementId, timer)
    }
  }, [selectedVibe, sessionId, selectedVibeFile, availableVibes])

  // Watch for completed assets and update iframe preview
  useEffect(() => {
    const oskarCanvas = (window as unknown as { oskarCanvas?: { sendImageUpdate: (usage: string, url: string) => void } }).oskarCanvas
    if (!oskarCanvas) return

    // Find any assets that just completed
    imageManifests.forEach(manifest => {
      manifest.assets.forEach(asset => {
        if (asset.status === 'complete' && asset.resultPath) {
          // Send update to iframe for this image
          oskarCanvas.sendImageUpdate(asset.usage, asset.resultPath)
        }
      })
    })
  }, [imageManifests])

  // Handle moodboard selection
  const handleMoodboardSelect = useCallback((conceptName: string) => {
    if (moodboard) {
      setMoodboard({ ...moodboard, selectedConcept: conceptName })
      setWorkflowPhase('generation')
    }
  }, [moodboard])

  // Handle image queue approval
  const handleApproveImage = useCallback((itemId: string) => {
    setImageQueue(prev => prev.map(item =>
      item.id === itemId ? { ...item, approved: true, status: 'approved' } : item
    ))
  }, [])

  // Handle image queue skip
  const handleSkipImage = useCallback((itemId: string) => {
    setImageQueue(prev => prev.map(item =>
      item.id === itemId ? { ...item, status: 'skipped' } : item
    ))
  }, [])

  // Handle submit all images - respects billing mode
  // Only submits NEW images (those without a tag - i.e. not yet analyzed by CD agent)
  const handleSubmitImages = useCallback(() => {
    if (sourceImages.length === 0) return

    // Filter to only images that haven't been analyzed yet (no tag)
    const newImages = sourceImages.filter(img => !img.tag)

    if (newImages.length === 0) {
      console.log('📷 No new images to submit - all images already analyzed')
      return
    }

    const imageList = newImages.map(img => img.filename).join(', ')
    const message = `I've uploaded these images: ${imageList}`
    console.log(`📷 Submitting ${newImages.length} new images (${sourceImages.length - newImages.length} already analyzed)`)

    // Mark submitted images with INGESTED so they leave Studio's "Uploads
    // (pending)" section immediately, before CD's async evaluation lands.
    // INGESTED is now PURELY a pending-section gate — it renders no visual
    // badge (the green checkmark only fires for genuine APPROVED).
    // (Ralph 2026-04-25.)
    setSourceImages(prev => prev.map(img => {
      if (!img.tag && !img.analysis?.description) {
        return { ...img, tag: 'INGESTED' as const }
      }
      return img
    }))

    handleSend(message)
  }, [sourceImages, handleSend])

  // ==========================================
  // Final Approval Handlers (Simple 4-Phase Flow)
  // ==========================================

  // Handle final approval - the ONLY blocking modal
  const handleFinalApprove = useCallback((selectedVibeIds: string[]) => {
    setWorkflowProgress(prev => ({
      ...prev,
      currentPhase: 'complete',
      selectedVibeIds,
      finalApproved: true
    }))
    setShowFinalApproval(false)
    console.log('✅ Final approval complete. Selected vibes:', selectedVibeIds)

    // Update brief with final selection
    if (sessionId) {
      const briefContent: CreativeBriefContent = {
        businessName: businessName || 'Unknown Business',
        status: 'FINAL',
        vibes: vibes.map(v => ({
          id: v.id,
          name: v.name,
          headline: v.headline,
          tagline: v.tagline,
          colors: v.colors,
          typography: v.typography
        })),
        selectedVibeIds
      }
      populateCreativeBriefAction(sessionId, briefContent)
    }
  }, [sessionId, businessName, vibes])

  // Handle final approval rejection - go back to review
  const handleFinalReject = useCallback(() => {
    setShowFinalApproval(false)
    console.log('🔄 User requested changes, returning to review')
  }, [])

  // Toggle vibe selection in final approval modal
  // Delete a vibe: remove HTML file, remove from all state, add system message for CD
  /**
   * Vibe delete (Ralph 2026-04-23): DESTRUCTIVE — removes the HTML file
   * from disk, strips the vibe section from CREATIVE-BRIEF.md, and fires
   * a CD chat notification. Previously ran on one click from the red ×
   * overlay; Ralph nuked a vibe by accident. Now the red × calls
   * `requestVibeDelete` which stages a confirmation modal; only the
   * modal's "Delete" button runs the destructive chain below.
   */
  const executeVibeDelete = useCallback(async (filename: string) => {
    if (!sessionId) return

    // Optimistically remove from UI state
    setAvailableVibes(prev => prev.filter(v => v.filename !== filename))
    setVibes(prev => prev.filter(v => v.htmlPath !== `/${sessionId}/${filename}`))

    // If the deleted vibe was selected, select the first remaining one
    setSelectedVibeFile(current => {
      if (current === filename) {
        // Find next available vibe
        const remaining = availableVibes.filter(v => v.filename !== filename)
        return remaining.length > 0 ? remaining[0].filename : null
      }
      return current
    })

    // Also clear selectedVibe if it matches
    setSelectedVibe(prev => {
      if (prev?.htmlPath === `/${sessionId}/${filename}`) return undefined
      return prev
    })

    // Delete HTML file from disk
    try {
      await fetch('/api/vibe-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, filename })
      })
      console.log(`🗑️ Deleted vibe file: ${filename}`)
    } catch (err) {
      console.error('Error deleting vibe file:', err)
    }

    // Remove vibe section + preview entry from CREATIVE-BRIEF.md
    try {
      await fetch('/api/session-md-remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, type: 'vibe', filename })
      })
      console.log(`🗑️ Removed "${filename}" from CREATIVE-BRIEF.md`)
    } catch (err) {
      console.error('Error removing vibe from CREATIVE-BRIEF.md:', err)
    }

    // Notify CD agent — same pattern as image uploads
    const vibeName = filename.replace('.html', '').replace(/^vibe-\d+-/, '').replace(/-/g, ' ')
    const message = `I've deleted the vibe "${vibeName}" (${filename}).`

    handleSend(message)
  }, [sessionId, availableVibes, handleSend])

  /**
   * Vibe-delete confirmation gate (Ralph 2026-04-23). Both the Studio
   * tab overlay and the Gallery card overlay call `requestVibeDelete`,
   * which stages intent into this state. The modal rendered below
   * resolves the vibe's display name from `availableVibes` and requires
   * an explicit click to run `executeVibeDelete`.
   */
  const [vibeDeleteConfirm, setVibeDeleteConfirm] = useState<{
    filename: string
    name: string
  } | null>(null)

  const requestVibeDelete = useCallback((filename: string) => {
    const match = availableVibes.find(v => v.filename === filename)
    // Prefer the vibe's display name; fall back to a stripped filename
    // so the modal is meaningful even if availableVibes is stale.
    const name = match?.name
      ?? filename.replace(/^vibe-\d+-/, '').replace(/\.html$/, '').replace(/-/g, ' ')
    setVibeDeleteConfirm({ filename, name })
  }, [availableVibes])

  const handleVibeToggle = useCallback((vibeId: string) => {
    setWorkflowProgress(prev => {
      const newSelected = prev.selectedVibeIds.includes(vibeId)
        ? prev.selectedVibeIds.filter(id => id !== vibeId)
        : [...prev.selectedVibeIds, vibeId]
      return { ...prev, selectedVibeIds: newSelected }
    })
  }, [])

  // Expose test interface to window for automated testing backdoor
  // This MUST come after all handlers are defined
  useEffect(() => {
    const testInterface = {
      // State getters
      getState: () => ({
        workflowPhase,
        layoutMode,
        moodboard,
        sourceImages,
        vibes,
        selectedVibe,
        messages,
        isLoading,
        imageQueue,
        imageManifests
      }),

      // Actions
      sendMessage: (content: string) => {
        // Use the coordinator so the test hook respects the current billing mode
        handleSend(content)
        return { success: true, message: 'Message sent' }
      },

      submitImages: () => {
        handleSubmitImages()
        return { success: true, message: 'Images submitted' }
      },

      selectMoodboardConcept: (conceptName: string) => {
        handleMoodboardSelect(conceptName)
        return { success: true, message: `Selected concept: ${conceptName}` }
      },

      selectVibe: (vibeId: string) => {
        const vibe = vibes.find(v => v.id === vibeId)
        if (vibe) {
          setSelectedVibe(vibe)
          return { success: true, message: `Selected vibe: ${vibe.name}` }
        }
        return { success: false, message: 'Vibe not found' }
      },

      approveImage: (itemId: string) => {
        handleApproveImage(itemId)
        return { success: true, message: `Approved image: ${itemId}` }
      },

      skipImage: (itemId: string) => {
        handleSkipImage(itemId)
        return { success: true, message: `Skipped image: ${itemId}` }
      },

      generateAsset: (assetId: string) => {
        const asset = imageManifests.flatMap(m => m.assets).find(a => a.id === assetId)
        if (asset) {
          handleAssetGenerate(asset)
          return { success: true, message: `Generating asset: ${asset.filename}` }
        }
        return { success: false, message: 'Asset not found' }
      },

      // Generate all pending assets sequentially
      generateAllAssets: async () => {
        const allAssets = imageManifests.flatMap(m => m.assets)
        const pendingAssets = allAssets.filter(a => a.status === 'pending')
        console.log(`Starting generation of ${pendingAssets.length} assets...`)

        for (const asset of pendingAssets) {
          console.log(`Generating: ${asset.filename}`)
          handleAssetGenerate(asset)
          // Wait 2 seconds between requests to avoid rate limiting
          await new Promise(r => setTimeout(r, 2000))
        }

        return {
          success: true,
          message: `Started generation of ${pendingAssets.length} assets`,
          assets: pendingAssets.map(a => a.filename)
        }
      },

      // Direct state setters for testing
      _setSourceImages: (images: SourceImage[]) => {
        setSourceImages(images)
        return { success: true }
      },

      _setLayoutMode: (mode: LayoutMode) => {
        setLayoutMode(mode)
        return { success: true }
      },

      _setWorkflowPhase: (phase: WorkflowPhase) => {
        setWorkflowPhase(phase)
        return { success: true }
      },

      // Director Mode controls
      toggleDirectorMode: () => {
        setDirectorMode(prev => !prev)
        return { success: true, enabled: !directorMode }
      },

      editText: (elementId: string, newText: string) => {
        handleTextEdit(elementId, newText)
        return { success: true, message: `Updated ${elementId}` }
      },

      getVibeEdits: () => vibeEdits
    }

    // @ts-ignore
    window.__OSKAR_TEST__ = testInterface
    console.log('Test interface exposed at window.__OSKAR_TEST__')

    return () => {
      // @ts-ignore
      delete window.__OSKAR_TEST__
    }
  }, [
    workflowPhase, layoutMode, moodboard, sourceImages, vibes, selectedVibe,
    messages, isLoading, imageQueue, imageManifests, directorMode, vibeEdits,
    handleSend, handleSubmitImages, handleMoodboardSelect,
    handleApproveImage, handleSkipImage, handleAssetGenerate, handleTextEdit
  ])

  // Handle session selection from dropdown
  const handleSelectSession = useCallback(async (selectedSessionId: string) => {
    // Session dropdown removed - managed via Admin
    setCliSessionId(null)  // Reset CLI session - new conversation with loaded session
    await loadSession(selectedSessionId)
  }, [loadSession])

  // Handle creating new session from dropdown
  const handleCreateSession = useCallback(() => {
    setSessionId(null)
    setBusinessName('')
    setCliSessionId(null)  // Reset CLI session
    setMessages([])
    setVibes([])
    setSelectedVibe(undefined)
    setImageManifests([])
    setSourceImages([])
    setLayoutMode('2-panel')
    setWorkflowPhase('discovery')
    setWorkflowProgress({
      currentPhase: 'discovery',
      vibesGenerated: 0,
      vibesComplete: 0,
      selectedVibeIds: [],
      finalApproved: false
    })
    // Session dropdown removed - managed via Admin
    console.log('📁 Starting new session')
  }, [])

  // ── Order 66 — overlay manages SSE, callbacks update TopBar status ──
  const [showCompactionOverlay, setShowCompactionOverlay] = useState(false)

  const handleOrder65 = useCallback(() => {
    if (!sessionId || order65Status !== 'idle') return
    setOrder65Status('running')
    setCompactionEndpoint('order65')
    setShowCompactionOverlay(true)
  }, [sessionId, order65Status])

  const handleOrder66 = useCallback(() => {
    if (!sessionId || order66Status !== 'idle') return
    setOrder66Status('running')
    setCompactionEndpoint('order66')
    setShowCompactionOverlay(true)
  }, [sessionId, order66Status])

  // Called by CompactionOverlay when bridge-ready fires
  const handleCompactionComplete = useCallback(() => {
    if (compactionEndpoint === 'order65') setOrder65Status('complete')
    else setOrder66Status('complete')
  }, [compactionEndpoint])

  const handleCompactionContinue = useCallback(() => {
    setShowCompactionOverlay(false)
    // Reset button after brief flash
    if (compactionEndpoint === 'order65') {
      setTimeout(() => setOrder65Status('idle'), 3000)
    } else {
      setTimeout(() => setOrder66Status('idle'), 3000)
    }
  }, [compactionEndpoint])

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--bg-app)',
      padding: 'var(--padding-app)',
      gap: 'var(--gap-app)'
    }}>
      {/* Top Bar - Wrapped in bento-card container */}
      <div className="bento-card" style={{ height: '64px', flexShrink: 0 }}>
        <TopBar
          sessionName={businessName || sessionId}
          sessionId={sessionId}
          layoutMode={layoutMode}
          onLayoutChange={setLayoutMode}
          billingMode={billingMode}
          onBillingChange={setBillingMode}
          webDevModel={webDevModel}
          onModelChange={setWebDevModel}
          theme={theme}
          onThemeChange={setTheme}
          usageRefreshTrigger={messages.length}
          contextPct={contextPct}
          cachedInputTokens={cachedInputTokens}
          realInputTokens={realInputTokens}
          onOrder65={handleOrder65}
          order65Status={order65Status}
          onOrder66={handleOrder66}
          order66Status={order66Status}
          onSessionRename={async (newName) => {
            // Persist via the existing rename-session server action. Renames
            // the folder on disk + updates SESSION.md / CREATIVE-BRIEF.md
            // titles. The new sessionId is slug-based (date-prefix +
            // slugified name), so we swap state to it after success.
            // localStorage stays in sync via setSessionId.
            if (!sessionId) return
            const trimmed = newName.trim()
            if (!trimmed || trimmed === businessName) return
            try {
              const result = await renameSessionAction(sessionId, trimmed)
              if (result.success && result.newSessionId) {
                setBusinessName(trimmed)
                if (result.newSessionId !== sessionId) {
                  setSessionId(result.newSessionId)
                }
              } else {
                console.warn('[page] renameSessionAction failed:', result.error)
              }
            } catch (err) {
              console.error('[page] renameSession error:', err)
            }
          }}
        />
      </div>

      {/* App Container - All layouts rendered, visibility controlled by CSS */}
      {/* This keeps components mounted to preserve state (chat input, scroll position, etc.) */}

      {/* IMAGE LAYOUT - Advanced Mode fills content area below TopBar */}
      {layoutMode === 'image' && sessionId && (
        <AdvancedMode
          sessionId={sessionId}
          sourceImages={sourceImages}
          imageManifests={imageManifests}
          initialTab={advancedMode.initialTab}
          initialImage={advancedMode.initialImage}
          onImageGenerated={(newImage) => setSourceImages((prev) => [...prev, newImage])}
          // Ralph 2026-04-23: AdvancedMode.executeDelete calls this after
          // the server-side delete succeeds. Previously unset, so the
          // asset panel never refreshed — the image stayed visible even
          // though the file was gone on disk. (Undo path re-adds via the
          // existing onImageGenerated callback above.)
          onRemoveImage={(id) =>
            setSourceImages((prev) => prev.filter((img) => img.id !== id))
          }
          // Ralph 2026-04-25: Image-mode upload — same handler the BRIEF/STUDIO
          // AssetsPanel uses. Without this, the user couldn't add images
          // while inside an image manipulation workflow.
          onUpload={handleUpload}
          // Ralph 2026-04-25: re-read IMAGES.md after Replace-everywhere so
          // the freshly reconciled USED / B-ROLL tags reach the panel.
          onSourceImagesRefresh={refreshSourceImageTags}
          // WP-B5: Brand tab needs vibe data + session business name.
          vibes={vibes}
          businessName={businessName}
          // (2026-04-18) Chat column — shared conversation with Studio Briefing.
          // Same `messages` array, same bridge. One CD, one log.
          chatMessages={messages}
          onAppendUserMessage={(content) =>
            setMessages((prev) => [
              ...prev,
              {
                id: `img-user-${Date.now()}`,
                role: 'user',
                content,
                timestamp: new Date().toISOString(),
              },
            ])
          }
          onAppendAssistantMessage={(content) =>
            setMessages((prev) => [
              ...prev,
              {
                id: `img-cd-${Date.now()}`,
                role: 'assistant',
                content,
                timestamp: new Date().toISOString(),
              },
            ])
          }
          // Vibe Preview mode inside the chat column uses the same vibes the
          // session has built — picker lets the user audit a generated image
          // in the context of an assigned vibe without leaving Image mode.
          // Also surface any other HTML files in the session dir (mockups,
          // prototypes, hand-written pages) so Director Mode can edit them
          // too. Vibes come first; non-vibe HTML files appended below them
          // (deduped by path).
          vibeOptions={(() => {
            const vibeEntries = vibes
              .filter((v) => !!v.htmlPath)
              .map((v) => ({ label: v.name, htmlPath: v.htmlPath }))
            const usedPaths = new Set(vibeEntries.map((e) => e.htmlPath))
            const extraEntries = sessionHtmlFiles
              .filter((f) => !usedPaths.has(f.path))
              .map((f) => ({
                label: f.title || f.name.replace(/\.html$/, ''),
                htmlPath: f.path,
              }))
            return [...vibeEntries, ...extraEntries]
          })()}
        />
      )}

      {/* GALLERY LAYOUT - Vibes list on left, preview on right */}
      <div style={{
        display: layoutMode === 'gallery' ? 'grid' : 'none',
        gridTemplateColumns: 'clamp(320px, 25vw, 640px) 1fr',
        gap: 'var(--gap-app)',
        flex: layoutMode === 'gallery' ? 1 : undefined,
        overflow: 'hidden',
        minHeight: 0
      }}>
          {/* Left: Vibes List */}
          <div
            className="bento-card"
            style={{ overflow: 'hidden' }}
          >
            <VibesGallery
              vibes={vibeCards}
              selectedVibeId={selectedVibe?.id || null}
              onVibeSelect={(id) => {
                const vibe = vibes.find(v => v.id === id)
                if (vibe) setSelectedVibe(vibe)
              }}
              onVibeDelete={requestVibeDelete}
              title="Vibes"
            />
          </div>

          {/* Right: Preview — now with Director Mode + Studio image picker.
              Clicking any [data-slot] image (with Director ON) opens the
              picker and swaps via the shared hotSwapToVibe backend. */}
          <div
            className="bento-card"
            style={{
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <LivePreviewWithDirector
              htmlPath={selectedVibe?.htmlPath || null}
              title={selectedVibe ? `Preview: ${selectedVibe.name}` : undefined}
              surface="gallery"
              emptyMessage={
                vibes.length > 0 ? 'Select a vibe to preview' : 'No vibes generated yet'
              }
            />
          </div>
        </div>

      {/* STUDIO LAYOUT - 2-panel or 3-panel */}
      <div style={{
        display: (layoutMode === '2-panel' || layoutMode === '3-panel') ? 'grid' : 'none',
        gridTemplateColumns: 'repeat(12, 1fr)',
        // Without an explicit row template the grid rows default to `auto`
        // (content-sized). With one panel rendering 2000+px of report, the
        // row expands and the panel's internal scroll never activates.
        // `minmax(0, 1fr)` forces the row to fill available space and lets
        // children with `minHeight: 0` shrink/scroll properly.
        gridAutoRows: 'minmax(0, 1fr)',
        gap: 'var(--gap-app)',
        flex: (layoutMode === '2-panel' || layoutMode === '3-panel') ? 1 : undefined,
        overflow: 'hidden',
        minHeight: 0
      }}>
          {/* Left: Assets Panel */}
          <div
            className="bento-card"
            style={{ gridColumn: layoutMode === '2-panel' ? 'span 4' : 'span 2' }}
          >
            <AssetsPanel
            sessionId={sessionId || ''}
            sourceImages={sourceImages}
            imageManifests={imageManifests}
            imageQueue={imageQueue}
            onUpload={handleUpload}
            onAssetSelect={handleAssetSelect}
            onAssetGenerate={handleAssetGenerate}
            onAssetUpdate={handleAssetUpdate}
            onAssetDismiss={handleAssetDismiss}
            onApproveImage={handleApproveImage}
            onSkipImage={handleSkipImage}
            onSubmitImages={handleSubmitImages}
            onSourceImageEdit={handleSourceImageEdit}
            onSourceImageCompose={handleSourceImageCompose}
            onSourceImageUpdate={handleSourceImageUpdate}
            onSourceImageDelete={handleSourceImageDelete}
            selectedAssetId={selectedAsset?.id}
            layoutMode={layoutMode}
            onOpenAdvancedMode={openAdvancedMode}
            assetsView={assetsView}
            onAssetsViewChange={setAssetsView}
            pendingCritiqueTarget={pendingCritiqueTarget}
            onConsumePendingCritiqueTarget={() => setPendingCritiqueTarget(null)}
            vibeFilenames={vibes
              .map((v) => v.htmlPath?.split('/').pop() || '')
              .filter((fn) => fn.endsWith('.html'))}
          />
        </div>

        {/* Center: Canvas Panel (only shown in 3-panel mode) */}
        {layoutMode === '3-panel' && (
          <div
            className="bento-card"
            style={{ gridColumn: 'span 6' }}
          >
            <CanvasPanel
              vibes={vibes}
              selectedVibe={selectedVibe}
              selectedAsset={selectedAsset}
              moodboard={moodboard}
              onVibeSelect={setSelectedVibe}
              onAssetUpdate={handleAssetUpdate}
              onAssetRegenerate={handleAssetGenerate}
              onClearAsset={handleClearAsset}
              onMoodboardSelect={handleMoodboardSelect}
              directorMode={directorMode}
              onToggleDirectorMode={() => setDirectorMode(prev => !prev)}
              onElementSelect={handleElementSelect}
              selectedElement={selectedElement}
              onTextEdit={handleTextEdit}
              availableVibes={availableVibes}
              selectedVibeFile={selectedVibeFile}
              onVibeFileSelect={setSelectedVibeFile}
              onVibeDelete={requestVibeDelete}
              onImageEditRequest={(imageUrl, instruction) => {
                // Send image edit request through chat
                const message = `[Director Mode Image Edit]\n\nEdit this image: ${imageUrl}\n\nInstruction: ${instruction}`
                handleSend(message)
              }}
            />
          </div>
        )}

        {/* Right: Conversation Panel */}
        <div
          className="bento-card"
          style={{ gridColumn: layoutMode === '2-panel' ? 'span 8' : 'span 4' }}
        >
          <ConversationPanel
            messages={messages}
            moodboard={moodboard}
            onSendMessage={handleSend}
            onMoodboardSelect={handleMoodboardSelect}
            isLoading={isLoading}
            layoutMode={layoutMode}
            streamingText={streamingText}
            streamingProgress={streamingProgress}
            /* queuedMessages prop intentionally omitted — user messages
               now appear in the chat history immediately (handleSend
               appends them before queueing). No need for a redundant
               pill strip above the input. */
            // Phase 2 (Ralph 2026-05-04): ConfirmUnderstandingCard's
            // "Build it" button. Sends a synthetic user message —
            // simpler + safer than POSTing to /api/mcp/build-all-vibes
            // directly, because it lets CD orchestrate the build via
            // her normal MCP path (and write the proper audit trail).
            onTriggerBuildAll={() => handleSend('Build all vibes — looks good.')}
            // Bug M (Ralph 2026-05-04): CD's actual model on the wire
            // for the input-bar badge. CLI mode populates this from
            // Claude CLI's system/init event via chat-stream's model_info
            // SSE event; API mode populates from session-config hydration.
            currentModel={currentModel}
            // WP-22 / WP-66 (Ralph 2026-05-06): TodoWrite + builds overlay
            // hooks need the active session to subscribe SSE + read the
            // persisted ## Todos section. Pre-session sessionId is null,
            // overlay stays unmounted.
            sessionId={sessionId}
          />
        </div>
      </div>

      {/* Final Approval Modal - the ONLY blocking gate, shown when user is ready */}
      {showFinalApproval && (
        <FinalApprovalModal
          vibes={vibes}
          selectedVibeIds={workflowProgress.selectedVibeIds}
          onApprove={handleFinalApprove}
          onReject={handleFinalReject}
          onVibeToggle={handleVibeToggle}
        />
      )}

      {/* Order 66 Compaction Overlay */}
      {showCompactionOverlay && sessionId && (
        <CompactionOverlay
          sessionId={sessionId}
          endpoint={compactionEndpoint}
          onContinue={handleCompactionContinue}
          onComplete={handleCompactionComplete}
        />
      )}

      {/* Vibe-delete confirmation (Ralph 2026-04-23). Styling matches the
          image-delete dialog in AdvancedMode so the affordance is familiar.
          Click-outside dismisses (cancels); Cancel button dismisses;
          Delete button runs executeVibeDelete and then clears state. */}
      {vibeDeleteConfirm && (
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
          onClick={() => setVibeDeleteConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 420,
              width: '90%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)', marginBottom: 10 }}>
              Delete vibe “{vibeDeleteConfirm.name}”?
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.6 }}>
              This will remove <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{vibeDeleteConfirm.filename}</code> from disk,
              strip its section from <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>CREATIVE-BRIEF.md</code>,
              and notify CD. It cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setVibeDeleteConfirm(null)}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border-card)',
                  background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const target = vibeDeleteConfirm
                  setVibeDeleteConfirm(null)
                  void executeVibeDelete(target.filename)
                }}
                autoFocus
                style={{
                  padding: '6px 16px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Delete vibe
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Old overlay mode removed — Advanced Mode now lives in IMAGE tab */}

      {/* Phase 2 Tier S (2026-04-30): agent-initiated user UI.
          Both components are self-contained — they listen to sessionEvents
          and render only when an event fires. */}
      <AskUserModal />
    </div>
  )
}
