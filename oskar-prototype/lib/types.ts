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

// Tags for categorizing images (assigned by CD agent or user)
export type ImageTag = 'HERO' | 'PORTRAIT' | 'MENU' | 'LOCATION' | 'B-ROLL' | 'TRASH' | 'READY' | 'INGESTED' | 'APPROVED' | 'REDO'

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
  tag?: ImageTag                  // HERO, PORTRAIT, MENU, LOCATION, B-ROLL, TRASH, READY
  cdNotes?: string                // CD agent notes about this image
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
}

// Manifest for a vibe's images
export interface ImageManifest {
  vibeId: string
  vibeName: string
  assets: ImageAsset[]
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
export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  images?: string[]
}

// Workflow phases (legacy - kept for compatibility)
export type WorkflowPhase = 'discovery' | 'moodboard' | 'selection' | 'generation' | 'preview'

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
export type LayoutMode = '2-panel' | '3-panel' | 'gallery'

// Moodboard quadrant position
export type QuadrantPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

// Moodboard vibe concept
export interface MoodboardConcept {
  name: string
  visualStyle: string
  colorPalette: string[]
  headline: string
  oneWord: string
  position: QuadrantPosition
}

// Moodboard data
export interface MoodboardData {
  id: string
  imagePath: string            // /generated-images/moodboard-{timestamp}.jpg
  concepts: MoodboardConcept[]
  selectedConcept?: string     // name of selected concept
  generatedAt: string
}

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
  moodboard?: MoodboardData
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
