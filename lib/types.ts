// WP-B5: Re-export brand types alongside other shared types so consumers
// can import from '@/lib/types' as a single source.
export type { BrandData } from './brand-data'
export type { DeliverableTemplate, DeliverableId } from './brand-deliverables'

// Image operation types
export type ImageOperation = 'generate' | 'compose' | 'extract' | 'adjust' | 'enhance' | 'edit'
export type ImageUsage = 'hero' | 'background' | 'portrait' | 'icon' | 'gallery' | 'logo-overlay' | 'extracted'
export type AssetStatus = 'pending' | 'generating' | 'complete' | 'error'
export type ImageSize = '1K' | '2K' | '4K'
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'

// Resolution defaults by usage
export const USAGE_DEFAULTS: Record<ImageUsage, { resolution: ImageSize, aspectRatio: AspectRatio }> = {
  'hero': { resolution: '2K', aspectRatio: '16:9' },
  'background': { resolution: '2K', aspectRatio: '16:9' },
  'portrait': { resolution: '1K', aspectRatio: '3:4' },
  'icon': { resolution: '1K', aspectRatio: '1:1' },
  'gallery': { resolution: '1K', aspectRatio: '4:3' },
  'logo-overlay': { resolution: '2K', aspectRatio: '16:9' },
  'extracted': { resolution: '1K', aspectRatio: '1:1' }
}

// Source image analysis result
export interface SourceAnalysis {
  elements: string[]              // ["falcon", "camel", "man with beard"]
  description: string             // "A man in traditional dress with a falcon..."
  suggestedExtractions: string[]  // ["Extract the falcon", "Extract the camel"]
  reprompt?: string               // Nano Banana prompt to recreate/edit this image
  suggestedUses?: string[]        // ["hero", "portrait", "gallery"]
  suggestedVibes?: string[]       // ["Heritage", "Luxury"]
}

// Tags for categorizing images.
// Layered into two groups:
//   AUTO-ASSIGNED (system-derived):
//     HERO     — placed in a vibe's hero slot (auto, via reconcileUsedTags)
//     USED     — referenced anywhere in a vibe (auto, via vibe HTML scan)
//     READY    — fresh / not yet reviewed (lifecycle)
//     APPROVED — CD-reviewed pass (lifecycle)
//     INGESTED — placeholder during upload (lifecycle, transient)
//     REDO     — CD-reviewed reject, needs regeneration (lifecycle)
//     PORTRAIT/MENU/LOCATION — legacy slot hints (deprecated, kept for back-compat)
//   USER-ASSIGNED (curatorial, exposed as 3 buttons in the UI):
//     STAR   — "this picture is great"
//     B-ROLL — "keep but secondary / variant"
//     TRASH  — "cull this asset"
export type ImageTag = 'HERO' | 'USED' | 'PORTRAIT' | 'MENU' | 'LOCATION' | 'B-ROLL' | 'TRASH' | 'READY' | 'INGESTED' | 'APPROVED' | 'REDO' | 'STAR'

// Generation status for images that came from the AI pipeline
export type GenerationStatus = 'pending' | 'approved' | 'b-roll' | 'trash'

// Source image with analysis and generation metadata
export interface SourceImage {
  id: string
  filename: string
  path: string                    // /uploads/steve.jpg
  uploadedAt: string
  analysis?: SourceAnalysis

  // Generation metadata (for images created by the AI pipeline)
  isGenerated?: boolean           // true if this came from image generation
  sourcePrompt?: string           // the prompt that created this image
  sourceAssetId?: string          // reference to the ImageAsset that generated this
  generationStatus?: GenerationStatus  // pending review, approved, b-roll, trash
  tag?: ImageTag                  // HERO, USED, PORTRAIT, MENU, LOCATION, B-ROLL, TRASH, READY
  /** Vibe HTML files this image is referenced in (computed from
   *  scanVibeHtmlsForUsedImages on parse). Independent of `tag`: a HERO
   *  image can also be in a vibe → both HERO badge + USED pill render.
   *  Empty / undefined = not used in any vibe. */
  usedIn?: string[]
  cdNotes?: string                // CD agent notes about this image

  // Lineage (WP-1C) — enables version sidebar traversal
  parentImage?: string            // Filename of the source image this was derived from (null for uploads + pure generate)
  parentImages?: string[]         // Multiple parents (for compose) — overrides parentImage when present
  generationMode?: 'generate' | 'edit' | 'compose' | 'layout'  // How this was made
  preset?: string                 // Preset label used at generation time
}

// Individual image asset in the pipeline
export interface ImageAsset {
  id: string
  filename: string                // Target filename: falcon-portrait.jpg
  operation: ImageOperation
  sourceImages: string[]          // Paths to source files
  instruction: string             // The prompt (editable by user)
  usage: ImageUsage
  aspectRatio: AspectRatio
  resolution: ImageSize
  status: AssetStatus
  resultPath?: string             // Output path after generation
  resultUrl?: string              // Base64 data URL (temporary)
  generatedUrl?: string           // URL of generated image
  slot?: string                   // Slot identifier (e.g., "hero-1")
  vibeId: string
  vibeName: string
  error?: string
  versions?: string[]             // Previous generation paths
  /**
   * The `### img-N` block this asset was parsed from, when applicable.
   * Set by `getImageManifestsAction` for every asset derived from a
   * prompt block in IMAGES.md. The frontend round-trips it back to
   * `/api/edit-image` and `/api/generate-image` so the generated
   * `#### filename` entry can be nested under THIS specific prompt
   * (instead of being orphan-appended to the end of the section, which
   * makes it look like an upload). Ralph 2026-05-04.
   */
  promptId?: string
}

// Manifest for a vibe's images
export interface ImageManifest {
  vibeId: string
  vibeName: string
  assets: ImageAsset[]
}

/**
 * WP-1C / WP-2C / WP-15: Generation lineage record. One per generated image.
 * Persisted to LINEAGE.json (sidecar) so lineage + audit data survives reload.
 *
 * Audit shape extended 2026-04-17 per WP-15 §"Prompt integrity":
 *   - `userPrompt`        — what the user typed/clicked BEFORE proofread
 *   - `actualPromptSent`  — what Nano actually received (differs on rewrite)
 *   - `proofreadResult`   — CD's pre-Nano evaluation (severity + note)
 *   - `verdict`           — CD's post-Nano evaluation (rating + note + adj.)
 *
 * Without these, any silent CD rewrite leaves no audit trail and the
 * "actualPromptSent === userPrompt unless explained" check that WP-15 §"Test
 * 2" requires can't run. Lineage was a Potemkin subclause without them.
 */
export interface GenerationRecord {
  id: string
  /** Filename of the single source image (for edit/generate), null for layout/pure generate. */
  parentImage?: string
  /** All source filenames (used for compose + layout). */
  sourceImages: string[]
  preset: string                 // Preset label used ('' if none)
  /** What the user typed/clicked. Pre-proofread. */
  userPrompt: string
  /** What Nano Banana actually received. Equal to userPrompt unless `proofreadResult.severity === 'rewritten'`. */
  actualPromptSent: string
  resultImage: string            // Filename of generated result
  aspectRatio: AspectRatio
  resolution: ImageSize
  /** ISO 8601 timestamp string. (Migrated from numeric epoch 2026-04-17.) */
  timestamp: string
  mode: 'generate' | 'edit' | 'compose' | 'layout' | 'brand'
  /** Nano Banana's Turn-2 self-description, possibly overridden by `verdict.adjustedDescription`. */
  description?: string
  /** CD's pre-Nano proofread outcome (WP-15 rule 3).
   *  'error' replaces the pre-2026-04-17 'timeout' state — no caps. */
  proofreadResult?: {
    severity: 'pass' | 'advisory' | 'rewritten' | 'error'
    note: string
  }
  /** CD's post-Nano verdict (WP-15 rule 6). `rating` mirrors VerdictOutcome.verdict.
   *  'error' replaces the pre-2026-04-17 'timeout' state — no caps. */
  verdict?: {
    rating: '✓' | '≈' | '✗' | 'error'
    note: string
    adjustedDescription?: string
  }
  /**
   * @deprecated Pre-WP-15 single-prompt field. Older LINEAGE.json entries
   * have this and lack `userPrompt`/`actualPromptSent`. Readers should
   * prefer the new fields and only fall back to `prompt` for legacy entries.
   */
  prompt?: string
}

// Vibe data
export interface VibeData {
  id: string
  name: string
  category: string
  headline: string
  tagline: string
  colors: string[]
  typography: { heading: string; body: string }
  voiceSamples: string[]
  htmlPath: string
  html?: string
  selected?: boolean
  heroImage?: string  // Hero image path extracted from HTML file
  // Gallery display fields (short format for vibe cards)
  audience?: string   // Short brand persona (e.g., "Saudi 30-45, dual-income, 1-3 kids. Successful but spiritually untethered.")
  mood?: string       // 3-5 adjectives (e.g., "Warm, Nostalgic, Guilt-Inducing")
}

// Vibe preview for switcher UI
export interface VibePreview {
  index: number
  name: string
  slug: string
  filename: string
  status: 'building' | 'ready' | 'error'
  htmlPath: string
  error?: string
}

// Conversation message
/**
 * Typed discovery question (Ralph 2026-05-12).
 *
 * Mockup §discovery-card (docs/toolcards-mockup.html:2015-2058) specs
 * mixed input types — text · textarea · radio · checkbox · select. v1
 * shipped string-only; v2 carries the full `kind` discriminator so a
 * multiple-choice question doesn't collapse into a single text input.
 *
 * CD doctrine line 277 + 485 already commits to this shape — the schema
 * just caught up. Legacy `string` is still accepted (DiscoveryCardPayload
 * union below) and treated as `{kind:'text', prompt}` at the boundary.
 */
export type DiscoveryQuestion =
  | {
      kind: 'text'
      prompt: string
      id?: string
      required?: boolean
      help?: string
      placeholder?: string
      defaultValue?: string
    }
  | {
      kind: 'textarea'
      prompt: string
      id?: string
      required?: boolean
      help?: string
      placeholder?: string
      defaultValue?: string
    }
  | {
      kind: 'radio'
      prompt: string
      id?: string
      required?: boolean
      help?: string
      options: string[]
      defaultValue?: string
    }
  | {
      kind: 'checkbox'
      prompt: string
      id?: string
      required?: boolean
      help?: string
      options: string[]
      defaultValue?: string[]
    }
  | {
      kind: 'select'
      prompt: string
      id?: string
      required?: boolean
      help?: string
      options: string[]
      defaultValue?: string
    }

/**
 * Discovery card payload — populated when CD calls
 * `ask_discovery_questions` MCP tool. The conversation panel renders
 * <DiscoveryQuestionsCard> instead of plain markdown when this is set.
 * Ralph 2026-05-04. Extended 2026-05-12 for mixed-input form support.
 *
 * `questions` accepts either bare strings (legacy text-only) or typed
 * `DiscoveryQuestion` objects. The component normalises both at render
 * time; the route + preview-card gate also accept both.
 */
/**
 * Universal "CD speaking" preamble shape — present on every tc_* toolcard
 * that asks the user something. Renders as a cyan-bordered callout above
 * the body. The label is the mono-caps role tag ("Why I'm asking" / "What
 * I heard" / "What to weigh" / "How the image plan fits"); the body is the
 * prose explanation. Both required when preamble is set. Per
 * docs/toolcards-mockup.html (Ralph 2026-05-14).
 */
export interface Preamble {
  label: string
  body: string
}

export interface DiscoveryCardPayload {
  kind: 'discovery_questions'
  questions: Array<string | DiscoveryQuestion>
  /** CD-speaking preamble — the "Why I'm asking" cyan callout above the questions. */
  preamble?: Preamble
  /** @deprecated — flat-string preamble. Use `preamble: {label, body}` instead. */
  context?: string
  /** Optional head-bar title (mockup: "Discovery — about FalCaMel"). */
  title?: string
  /** Optional progress chip in head (mockup: "step 1 / 3"). */
  progress?: { current: number; total: number }
}

/**
 * Confirm card payload — populated when CD calls `confirm_understanding`.
 * The conversation panel renders <ConfirmUnderstandingCard> instead of
 * plain markdown when this is set. Ralph 2026-05-04.
 */
/** Conversion mechanism token — the four-way pill row on the confirm card. */
export type ConversionMechanism = 'PHONE' | 'FORM' | 'BOOK' | 'SHOP'

export interface ConfirmCardPayload {
  kind: 'confirm_understanding'
  /** Fallback prose — only used by CHECK-IN variant when chips are absent. */
  summary: string
  readyToGenerate: boolean
  /**
   * CD-speaking preamble per mockup §3.5 — the cyan callout at the top of
   * both variants. READY: "What I heard". CHECK-IN: "What's still needed".
   * Distinct from the green weirdDetail and violet signatureMoment pull-quotes.
   */
  preamble?: Preamble
  /**
   * Ralph 2026-05-14 — match mockup §3.5 6-chip spec.
   * Old 4-chip shape ({business, where, who, tone}) is renamed:
   *   where → location, who → whoWeAre (plus new `customers`), tone → voice
   * NEW chips added: howItWorks, customers, signatureMoment (as pull-quote)
   */
  distillation?: {
    /** "Third-wave coffee bar — neighborhood regulars by day, late-night tourists." */
    business?: string
    /** "Vienna's 7th. Drift-up from MuseumsQuartier after dark." */
    location?: string
    /** "Yemeni-Austrian roaster, third generation coffee man. Solo operator." */
    whoWeAre?: string
    /** "Counter walk-in by day. Reservations-only after 21:00. No app." */
    howItWorks?: string
    /** "Locals first, tourists second. Price ceiling €7." */
    customers?: string
    /** "Spare, confident, no kitsch. No fusion-speak." */
    voice?: string
  }
  /** Operational specifics — conversion paths + pricing prose, multi-line. */
  conversion?: {
    /** Which mechanisms apply — highlighted in brand-green. Others rendered dimmed. */
    mechanisms?: ConversionMechanism[]
    /** Pricing prose — typically multi-line. Numbers should render tabular-mono. */
    pricing?: string
  }
  /** The un-repeatable line — green left-bordered italic pull-quote. */
  weirdDetail?: string
  /** The scene that PROVES the brand — violet left-bordered italic pull-quote.
   *  Distinct from weirdDetail: a scene, not a line. */
  signatureMoment?: string
  /** 9-dot Discovery completeness signal. Defaults to {done: 9, total: 9} when ready. */
  discoveryProgress?: { done: number; total: number }
  /** CHECK-IN variant: bullet list of items CD still needs to nail. */
  stillNeed?: string[]
  /** Track context for the chrome sub-line (defaults to "Phase 1 → Phase 2"). */
  phaseLabel?: string
}

/**
 * Upload-eval card payload — populated when CD evaluates a user upload via
 * the `submit_upload_eval` MCP tool. Renders alongside the existing
 * `cd.upload-evaluated` snackbar (which is the moment-feedback) — this card
 * is the permanent chat-record of CD's take. Same data on both surfaces.
 * (Ralph 2026-05-06: BOTH snackbar AND toolcard for upload reactions.)
 */
export interface UploadEvalCardPayload {
  kind: 'upload_eval'
  filename: string
  /** /uploads/<filename> or session-relative path for the <img src>. */
  path: string
  verdict: '✓' | '≈' | '✗'
  /** CD's one-line take. Same string the snackbar shows. */
  note: string
  /** Optional richer description (Nano analysis if present). */
  description?: string
  /** CD-suggested slot intents from submit_upload_eval. Up to 6. */
  suggestedUses: string[]
  /** Initial status the asset lands with (INGESTED is the system default
   *  for fresh uploads with no user curation). */
  status: 'INGESTED' | 'STAR' | 'B-ROLL' | 'TRASH'
}

/**
 * The user-assignable triad for upload-eval batch rows (CD directive,
 * 2026-05-06): rows in the batch card show ONLY these three tags as
 * inline pills — STAR · B-ROLL · TRASH. INGESTED is the system fallback
 * for "not yet evaluated" and is not user-clickable here; HERO / USED /
 * READY / APPROVED / REDO are auto-derived. If a row reaches the batch
 * panel, CD has already evaluated it, so one of the three is set.
 */
export type UploadEvalBatchTag = 'STAR' | 'B-ROLL' | 'TRASH'

/**
 * Batch upload-eval row — same fields as the single-row payload EXCEPT
 * the `status` is narrowed to the 3 user-assignable tags. INGESTED is
 * not a legal value in this card; rendering treats any unknown value as
 * "no pill highlighted".
 */
export type UploadEvalBatchRow = Omit<UploadEvalCardPayload, 'kind' | 'status'> & {
  status: UploadEvalBatchTag
}

/**
 * Batch upload-eval card payload — populated when N≥3 uploads land within a
 * debounce window. Renders ONE card with N rows (thumb · filename · verdict +
 * note · inline tag pill-row) instead of N stacked single cards. Anti-pollution
 * pattern locked 2026-05-06 (Ralph): "if uploaded images >=3, we display a
 * table similar to the building 4 vibes card".
 *
 * Each row uses the same write-back path as UploadEvalCard
 * (`/api/mcp/update-image-metadata`), so per-row tag changes mutate
 * IMAGES.md identically to the single-card flow.
 */
export interface UploadEvalBatchCardPayload {
  kind: 'upload_eval_batch'
  /** Items in this batch, ordered by arrival. */
  items: UploadEvalBatchRow[]
}

/**
 * Screenshot card payload — populated when CD calls the `screenshot` MCP tool.
 * The `screenshot_taken` event publishes after Playwright writes the PNG;
 * page.tsx subscriber builds this payload, ConversationPanel renders
 * <ScreenshotCard>. Mockup: docs/toolcards-mockup.html § Archetype 4.
 * (Ralph 2026-05-06: WP-22 Phase 1.)
 */
export interface ScreenshotCardPayload {
  kind: 'screenshot'
  /** Public path under /<session>/screenshots/<file>.png — usable as <img src>. */
  savedPath: string
  /** What was rendered — vibe slug, filename, or URL fragment. */
  target: string
  /** Frame size used for the capture. */
  frame: 'desktop' | 'tablet' | 'mobile'
  /** Pixel dimensions (width × height). */
  dims: { width: number; height: number }
}

/**
 * Apply-patch card payload — populated when CD calls `apply_patch`. Renders
 * a typed-edit diff display in chat (Mockup § Archetype 2 — Diff). Each
 * patched file gets one card; the `diff` string is the unified-style
 * additions/deletions returned by html-patch-engine.
 * (Ralph 2026-05-06: WP-22 Phase 1.)
 */
export interface ApplyPatchCardPayload {
  kind: 'apply_patch'
  /** Filename that was edited (e.g. "vibe-3-the-deployment.html"). */
  filename: string
  /** Edit kind: css-var-set / text-replace / attr-set / class-toggle / delete / insert. */
  editKind: string
  /** Anchor or selector targeted by the edit, for the head meta line. */
  anchor: string
  /** Number of nodes affected. */
  affected: number
  /** Unified diff string from html-patch-engine — already trimmed. */
  diff: string
}

/**
 * Diagnostic chip payload — single-row ambient chrome for cross-agent comms.
 * Renders inline (no card chassis) per mockup § Archetype 4 — Control cards.
 * Currently fires from `notify_agent`; same shape can carry `claim_orphan`
 * and `thread_history` reductions later.
 * (Ralph 2026-05-06: WP-22 Phase 1.)
 */
export interface DiagnosticChipPayload {
  kind: 'diagnostic_chip'
  /** Glyph at the start of the row (→, ↻, ≡). */
  glyph: string
  /** Primary label (e.g. "webdev: queued"). */
  label: string
  /** Optional accent text (e.g. "priority:high"). */
  accent?: string
  /** ISO timestamp shown right-aligned. */
  ts: string
}

/**
 * Build-job card payload — Archetype 1 in toolcards-mockup.html.
 *
 * Single shape backs `build_vibe` (1..N rows, array-based since
 * 2026-05-18) and `build_wireframes` (N rows). Updates from
 * `build_started` / `build_progress` / `vibe_built` / `build_failed` /
 * `vibe_failed` events as the job moves through the pipeline. Each row
 * owns its own cancel/open button.
 *
 * (Ralph + CD 2026-05-06: build_progress / build_complete / build_failed
 * preview kinds collapse into this single payload — the row.state field
 * carries the per-row lifecycle.)
 */
export type BuildRowState =
  | 'queued'
  | 'html'
  | 'verify'
  | 'critique'   // Phase 7 — wireframes only (was: 'wf' legacy alias, renamed 2026-05-18)
  | 'done'
  | 'failed'
  | 'cancelled' // user cancelled mid-build via cancel_job

export interface BuildCardRow {
  /** `vibe-N` slug (matches `lib/types.ts` VibeData id grammar). */
  id: string
  /** Human label, e.g. "Qahwa", "The Deployment". */
  label: string
  /** Optional thumb path for the leftmost cell. Empty cell renders an em-dash placeholder. */
  thumb?: string
  /** Active step. Drives the timeline rendering. Five-stage ladder for
   *  wireframes (`hasCritique: true`), four-stage for vibes. */
  state: BuildRowState
  /** When true, this row's ladder includes the `critique` stage between
   *  `verify` and `done`. Set by `build_wireframes` route at row creation
   *  (Phase 7 of webdev-agent-rewrite.md). Omitted/false for `build_vibe`
   *  rows — they go verify → done directly. */
  hasCritique?: boolean
  /** True when JuniorDev produced this vibe (worktree-fork path). Shows the WF step in the timeline. */
  juniorDev?: boolean
  /** Display-formatted ETA, e.g. "~2:14" or "1:42" once done. */
  eta?: string
  /** Job id from the escrow layer — used when CANCEL is clicked. */
  jobId?: string
  /** Optional milestone bullets shown under the row in single-vibe mode
   *  (build_vibe with a single-slug array). Sourced from `build_progress`
   *  events. Hidden in multi-slug views (batch build_vibe / build_wireframes). */
  milestones?: string[]
  /** Free-form failure reason when state === 'failed'. Renders inline below the row. */
  error?: string
  /** Rendered HTML path set on `vibe_built` — drives the Open button so the
   *  click target stays decoupled from `thumb` (which is the row's image
   *  preview, NOT the vibe URL). Set lazily; absent until the build lands. */
  htmlPath?: string
  /** ISO timestamp when this row's build entered HTML stage (i.e. WebDev
   *  actually started doing work, vs. sitting in the build-escrow queue
   *  waiting for the per-session WebDev mutex). Used to compute live
   *  elapsed-time as the ETA cell. Set on `build_progress({stage:'html'})`. */
  startedAt?: string
  /** ISO timestamp when this row's build finished. Set on vibe_built. The
   *  elapsed (finishedAt - startedAt) freezes as the final ETA value
   *  ("8:28") on done rows. */
  finishedAt?: string
}

export interface BuildCardPayload {
  kind: 'build'
  /** Card-head title — agent-supplied, e.g. "Building 4 vibes" or "Building vibe-3 — The Deployment". */
  title: string
  /** Job-family id shown right-aligned in the head meta. */
  jobId?: string
  /** Rows in display order (top → bottom). One row per slug for build_vibe / build_wireframes. */
  rows: BuildCardRow[]
}

// WP-70 + WP-71 (Ralph 2026-05-10): Image Strategy Card — Phase 3/5 slot plan.
// Two layouts: webpage-vertical (vertical slot list) and keynote-multi-row (M×5 grid).
export interface ImageStrategySlot {
  slotName: string
  slotKind: string
  aspectRatio: string
  state: 'assigned' | 'generate' | 'optional-empty'
  filename?: string
  promptPreview?: string
  promptId?: string
}

export interface ImageStrategyCardPayload {
  kind: 'image_strategy'
  vibeSlug: string
  vibeName: string
  layout: 'webpage-vertical' | 'keynote-multi-row'
  phaseLabel: string
  /** CD-speaking preamble — "How the image plan fits" cyan callout. */
  preamble?: Preamble
  slots: ImageStrategySlot[]
}

// WP-74 (Ralph 2026-05-10): Design Directions Card — closes Discovery / opens Phase 2.
// Multi-select cap 4 from 6 strategic bets. Schema replaced 2026-05-21 to match
// docs/tc-design-directions-mockup.html — see agents/creative-director-agent.md
// § "Strategic Bet" block for the per-bet field contract.
export interface PaletteSwatch {
  hex: string
  role: string
}

export interface AxisLinear {
  /** Convention-pole label, Disruption-pole label. */
  poles: [string, string]
  /** 0..1 — marker position along the spectrum. 0 = pure Convention, 1 = pure Disruption. */
  position: number
}

export interface BetFonts {
  /** CSS font-family value, e.g. 'Playfair Display' or '"Space Mono", monospace'. */
  display: string
  /** Short display label, e.g. 'Playfair Display' or 'Manrope (Söhne-like)'. */
  display_label: string
  body: string
  body_label: string
}

export interface DesignDirection {
  slug: string
  /** vibe-x.md filename this bet seeds, e.g. 'vibe-1-hospitality.md'. */
  filename: string
  /** The wager's name, e.g. "The Hospitality Play" — NOT the school. */
  bet_name: string
  /** One-sentence description of the audience this bet filters for. */
  bet_audience: string
  /** Convention↔Disruption spectrum with a 0..1 marker. */
  axis_linear: AxisLinear
  /** Emotional hook — Warmth | Pride | Nostalgia | Exclusivity | Humor. Model-only; not rendered after 2026-05-17. */
  axis_hook: string
  /** What becomes true if this wager wins — body description in the body font. */
  the_bet: string
  /** What UNIQUELY differentiates this bet from the others. */
  mutex: string
  palette: [PaletteSwatch, PaletteSwatch, PaletteSwatch, PaletteSwatch]
  fonts: BetFonts
}

export interface DesignDirectionsCardPayload {
  kind: 'design_directions'
  directions: DesignDirection[]
  /** CD-speaking preamble — "Why six, not three" cyan callout. */
  preamble?: Preamble
  /** @deprecated — flat-string preamble. Use `preamble: {label, body}` instead. */
  prompt?: string
  // Doctrine: track is TRACK-AGNOSTIC for design_directions. Never re-add.
  // See INSTITUTIONAL-MEMORY.md "Doctrine drift: track grafted onto
  // tc_design_directions (2nd time)" 2026-05-14.
}

// WP-77 (Ralph 2026-05-10): Design System Card — Phase 4→5 sign-off.
// Interactive vibe-selector that swaps CSS vars + textContent client-side.
export interface DesignSystemVibe {
  vibeSlug: string
  label: string
  system: {
    displayName: string
    h2Sample: string
    bodySample: string
    palette: {
      bg: string
      surface: string
      primary: string
      ink: string
      accent: string
    }
    typography: {
      displayFont: string
      bodyFont: string
      h1Caption: string
      bodyCaption: string
    }
    buttons: { primaryLabel: string; secondaryLabel: string }
    imageTreatment: string
    animationPosture: string
  }
}

export interface DesignSystemCardPayload {
  kind: 'design_system'
  /** Session slug — passed to CD's downstream `build_vibe([selectedSlug])` call. */
  slug?: string
  vibes: DesignSystemVibe[]
  initialVibeIndex?: number
  /** Optional CD commentary shown above the card. */
  prompt?: string
}

// WP-75 (Ralph 2026-05-10): Descent Selection Card — variable-cap vibe picker.
// CD specifies cap (1..vibes.length) + ctaLabel verbatim. cap=1 → radio
// (Phase 4→5 "Ship This Vibe"). cap=2 → multi-select max-2 (Phase 2→3
// "Advance These 2"). cap=N for any other narrow ("Narrow to Top 3", etc.).
// Same yellow chassis as Design Directions.
export interface DescentSelectionVibe {
  slug: string
  name: string
  heroImage: string
  tagline?: string
  /** Optional 3-color palette swatch. */
  palette?: [string, string, string]
  displayFont?: string
}

export interface DescentSelectionCardPayload {
  kind: 'descent_selection'
  slug?: string
  /** Maximum number of vibes the user can pick. 1 = radio. 2+ = multi-select. */
  cap: number
  /** Primary CTA button label, e.g. "Ship This Vibe", "Advance These 2", "Narrow to Top 3". */
  ctaLabel: string
  /** Optional sub-line in the card header for phase context. */
  contextLabel?: string
  vibes: DescentSelectionVibe[]
  /** CD-speaking preamble — "What to weigh" cyan callout. */
  preamble?: Preamble
  /** @deprecated — flat-string preamble. Use `preamble: {label, body}` instead. */
  prompt?: string
}

// Ralph 2026-05-18: Critique card payload. Fires from build-wireframes route's
// onToolCall when WebDev/Sentinel calls submit_critique. Read-only — no user
// input. Mirrors the submit_critique MCP tool schema
// (mcp-server/tools-sentinel.ts:23-74) plus two transport-side fields.
export interface CritiqueScorePayload {
  dimension: string
  score: number
  note: string
}

export interface CritiqueCardPayload {
  kind: 'critique'
  /** What was critiqued — e.g. "vibe-3.html", "CREATIVE-BRIEF.md". */
  target: string
  /** Per-dimension scores (0-10) with one-line notes. */
  scores: CritiqueScorePayload[]
  /** Headline / summary paragraph. */
  summary: string
  /** Specific, actionable recommendations. Each a single sentence. */
  recommendations: string[]
  /** Which agent fired the critique — colors the icon + pill. */
  agent?: 'webdev' | 'sentinel'
  /** Phase context — adjusts the header label. Post-2026-05-18 build-API
   *  collapse: two values only ('wireframes' from build-wireframes route,
   *  'vibe' from build-vibe route — same tool for Phase 4 and Phase 5,
   *  so 'final' is no longer distinguishable at the route layer). */
  phase?: 'wireframes' | 'vibe'
}

export type AssistantCardPayload =
  | DiscoveryCardPayload
  | ConfirmCardPayload
  | UploadEvalCardPayload
  | UploadEvalBatchCardPayload
  | ScreenshotCardPayload
  | ApplyPatchCardPayload
  | DiagnosticChipPayload
  | BuildCardPayload
  | ImageStrategyCardPayload
  | DesignDirectionsCardPayload
  | DesignSystemCardPayload
  | DescentSelectionCardPayload
  | CritiqueCardPayload

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  images?: string[]
  /**
   * Optional structured card payload. When set, the conversation panel
   * renders the matching component (DiscoveryQuestionsCard /
   * ConfirmUnderstandingCard) INSTEAD of `content` as markdown. Used by
   * the Phase 2 discovery-flow MCP tools so the user gets rich UI in
   * both CLI and API modes. Ralph 2026-05-04.
   */
  card?: AssistantCardPayload
  /**
   * Preview-mode flag (Ralph 2026-05-06). True when this card was emitted
   * via the `preview_card` MCP tool — a sample render in response to "show
   * me [a card]". The renderer adds a "PREVIEW" badge and disables real
   * backend writes from interactive controls (so clicking Build It on a
   * preview confirm card does nothing, etc.).
   */
  __preview?: boolean
}

// Workflow phases (legacy - kept for compatibility)
export type WorkflowPhase = 'discovery' | 'selection' | 'generation' | 'preview'

// ==========================================
// OskarOS Phase System (Simple 4-Phase Flow)
// ==========================================

// 4 phases, ONE blocking modal at the end
export type OskarPhase =
  | 'discovery'  // CD asks questions, user answers, user greenlights verbally (not modal)
  | 'building'   // Vibes generating, images generating, hot-swap, snackbars notifying
  | 'review'     // User views vibes, selects/mixes via Director Mode
  | 'complete'   // User approved final output

// Final approval modal - the ONLY blocking gate
export interface FinalApprovalConfig {
  title: string
  description: string
  approveLabel: string
  rejectLabel: string
}

export const FINAL_APPROVAL: FinalApprovalConfig = {
  title: 'Final Review',
  description: 'Here are your vibes. Select your favorites and approve to finish.',
  approveLabel: 'Approve & Publish',
  rejectLabel: 'Request Changes'
}

// Simple workflow progress state
export interface WorkflowProgress {
  currentPhase: OskarPhase
  vibesGenerated: number
  vibesComplete: number           // How many vibes have all images ready
  selectedVibeIds: string[]       // Which vibes user selected (can be multiple for mixing)
  finalApproved: boolean
}

// Layout modes
export type LayoutMode = '2-panel' | '3-panel' | 'image' | 'gallery'

// Image generation queue item
export interface ImageQueueItem {
  id: string
  asset: ImageAsset
  approved: boolean
  status: 'pending' | 'approved' | 'generating' | 'complete' | 'error' | 'skipped'
  error?: string
}

// Session state
export interface OskarSession {
  id: string
  businessName: string
  createdAt: string
  updatedAt: string
  sourceImages: SourceImage[]
  vibes: VibeData[]
  imageManifests: ImageManifest[]
  conversation: ConversationMessage[]
  workflowPhase: WorkflowPhase
  layoutMode: LayoutMode
  imageQueue: ImageQueueItem[]
}

// ==========================================
// Tool Use Types (Structured Output from Claude)
// ==========================================

// Tool result for generating a vibe
export interface VibeToolInput {
  name: string
  html: string
  imageAssets: {
    filename: string
    operation: ImageOperation
    instruction: string
    usage: string
    sourceImages?: string[]
    aspectRatio?: AspectRatio
    resolution?: ImageSize
  }[]
  moodboard: {
    headline: string
    tagline: string
    colors: string[]
    typography: {
      heading: string
      body: string
    }
    voiceSamples?: string[]
  }
}

// Tool result for asking discovery questions
export interface DiscoveryToolInput {
  questions: string[]
  context?: string
}

// Tool result for confirming understanding before vibe generation
export interface ConfirmUnderstandingToolInput {
  summary: string
  readyToGenerate: boolean
}

// Parsed tool call from Claude's response
export interface ParsedToolCall {
  id: string
  name: string
  input: VibeToolInput | DiscoveryToolInput | ConfirmUnderstandingToolInput
}

// ==========================================
// Director Mode Types (Visual Editing)
// ==========================================

// Edits made to a vibe via Director Mode
export interface VibeEdits {
  vibeId: string
  textEdits: { id: string; newText: string }[]
  imageSwaps: { usage: string; newAssetId: string }[]
}

// Selected element in the iframe
export interface SelectedElement {
  elementType: 'text' | 'image'
  id: string
  currentValue: string
  tagName: string
  // Position for Magic Toolbar
  rect?: {
    top: number
    left: number
    width: number
    height: number
  }
}

// ==========================================
// Streaming Types
// ==========================================

// Progress state during streaming
export interface StreamingProgress {
  phase: 'idle' | 'discovery' | 'confirm' | 'vibe' | 'done' | 'error'
  message: string
  vibesCurrent?: number
  vibesTotal?: number
  currentVibeName?: string
}

// Streaming event from server
export type StreamEvent =
  | { type: 'start'; message: string; sessionId?: string }
  | { type: 'text'; content: string }
  | { type: 'progress'; phase: string; current?: number; name?: string; message: string }
  | { type: 'tool_complete'; tool: string; id: string; input: any }
  | { type: 'tool_use'; tool: string; input: any }
  | { type: 'tool_result'; tool: string; result: string }
  | { type: 'image_manifests'; manifests: ImageManifest[]; message: string }
  | { type: 'done'; vibeCount: number; sessionId?: string; manifestCount?: number }
  | { type: 'error'; message: string }
  // Vibe generation events (from VIBES READY trigger)
  | { type: 'build_ready'; sessionId: string }
  | { type: 'webdev_complete'; paths: { landing?: string; booking?: string } }
  | { type: 'webdev_error'; error: string }
  | { type: 'vibes_ready'; sessionId: string }
  | { type: 'vibe_complete'; vibe: { index: number; name: string; slug: string; filename: string; htmlPath: string; oneLiner?: string; colors?: { primary: string; secondary: string; accent: string; text?: string }; fonts?: { headings: string; body: string } } }
  | { type: 'vibe_error'; vibeIndex: number; vibeName: string; error: string }
  | { type: 'all_vibes_complete'; vibeCount: number }
  // Asset update events
  | { type: 'update_assets'; sessionId: string }
  | { type: 'rebuild_started'; vibeName: string }
  | { type: 'rebuild_error'; vibeName: string; error: string }
  | { type: 'hotswap_started'; vibeName: string; slot: string }
  | { type: 'hotswap_complete'; vibeName: string; slot: string }
  | { type: 'hotswap_error'; vibeName: string; slot: string; error: string }
  // Bug M (Ralph 2026-05-04): the actual CD model on the wire. Sent by
  // chat-stream once at start (config-seeded) and again when Claude CLI's
  // system/init event lands (truth on wire — when ANTHROPIC_BASE_URL is
  // base-URL-piped to Z.ai, this reports the GLM identifier).
  // `source` lets the client tell init-truth from config-seed when both
  // arrive in the same turn.
  | { type: 'model_info'; model: string; sessionId?: string | null; source?: 'config' | 'init' }

// ==========================================
// Magic Toolbar Types
// ==========================================

// Quick edit action for text
export type TextQuickAction = 'punchier' | 'shorter' | 'longer' | 'sarcastic' | 'formal' | 'casual'

// Quick edit action for images
export type ImageQuickAction = 'variations' | 'zoom_out' | 'zoom_in' | 'change_style'

// Magic toolbar position
export interface ToolbarPosition {
  x: number
  y: number
  elementType: 'text' | 'image'
}
