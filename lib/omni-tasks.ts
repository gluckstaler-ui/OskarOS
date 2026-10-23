// ============================================================================
// lib/omni-tasks.ts — what Gemini Omni Flash on Vertex
// (gemini-omni-1.1-flash-preview) takes, and which API task each VIDEO tab
// situation maps to. Pure module: used by the two VIDEO tabs and by
// /api/generate-video. 2026-10-23.
//
// Sources: Vertex model and per-task pages, the Interactions OpenAPI spec,
// Google's Omni guide, and live tests (docs/ops/vertex-setup.md step 9):
// - aspect_ratio: only 16:9 and 9:16 (1:1, 4:3, 21:9 → 400); unset = the
//   model picks. Not allowed on extend or edit (400; they keep the source's).
// - duration: 3–10 s per generation ("Requested duration 2 less than minimum
//   duration 3."). Longer videos: generate, then extend (≤ 40 s in all).
//   Extend returns the whole video plus the new part; only the new seconds
//   are billed.
// - resolution: 360p, 720p (default), 1080p, 4k. Google: 1080p and 4k are
//   upscaled from Omni's 720p render (billed 1.5× and 3×).
// - seed: same seed + same settings = the same video (SSIM 1.0).
// - thinking_level: only "low" and "high"; it changes the result.
// - Images: ≤ 10 per prompt. Videos: ≤ 3 reference videos (Google advises
//   ≤ 3 s each; 6 s was accepted). Edit takes a video ≤ 10 s ("Editing
//   duration 11.1667 exceeds maximum duration 10."), extend ≤ 30 s ("Videos
//   longer than 30s are not supported for extension."), and both take
//   exactly ONE video — reference videos there → 400. Reference images work
//   in extend and edit.
// - Frames OR ingredients: image_to_video takes at most 2 images ("a first
//   frame and an optional last frame") and no video ("Video input is not
//   supported for the image_to_video task"); reference_to_video does not keep
//   a first frame. A first frame + one ingredient image with the declaration
//   "[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]"
//   worked in a 3 s test but a 10 s run still ended on the ingredient image
//   as if it were the last frame — not reliable, so the tab offers frames or
//   ingredients, not both. Ingredients alone: up to 10 images and 3 videos
//   (reference_to_video).
// - Audio input is undocumented (Google: not supported) — not offered.
// - Failed generations report why in errors[].message.
// ============================================================================
import type { VideoResolution } from '@/lib/omni-pricing'

export type VideoApiTask = 'text_to_video' | 'image_to_video' | 'reference_to_video' | 'edit' | 'extend'
/** What a request does: a new video (VIDEO tab) or a change of one (VID → VID). */
export type VideoKind = 'video' | 'extend' | 'edit'
/** The situation recorded in the video's LINEAGE.json record and shown in the tab.
 *  ('image-refs' only in records from the 2026-10-23 tests.) */
export type VideoMode = 'text' | 'image' | 'frames' | 'refs' | 'image-refs' | 'extend' | 'edit'

export const VIDEO_RATIOS = ['16:9', '9:16'] as const
export type VideoAspectRatio = (typeof VIDEO_RATIOS)[number]
export const VIDEO_RESOLUTIONS: VideoResolution[] = ['360p', '720p', '1080p', '4k']
/** Rendered at 720p and upscaled (Google). */
export const UPSCALED_RESOLUTIONS: VideoResolution[] = ['1080p', '4k']
export const THINKING_LEVELS = ['low', 'high'] as const
export type VideoThinking = (typeof THINKING_LEVELS)[number]

export const MIN_SECONDS = 3
export const MAX_SECONDS = 10
export const MAX_TOTAL_SECONDS = 40
export const MAX_IMAGES = 10
export const MAX_REF_VIDEOS = 3
/** Google's advice for reference videos; the API accepted 6 s, so the tab warns but lets it run. */
export const MAX_REF_VIDEO_SECONDS = 3
export const MAX_EDIT_SOURCE_SECONDS = 10
export const MAX_EXTEND_SOURCE_SECONDS = 30
/** Vertex keeps stored (background) interactions — the generation ID — this long. */
export const INTERACTION_KEPT_MS = 14 * 24 * 3600 * 1000

export interface VideoModeInfo {
  mode: VideoMode
  apiTask: VideoApiTask
  label: string
  /** What Omni does with the slots, one line. */
  help: string
}

export interface SlotFill { first: boolean; last: boolean; images: number; videos: number }

/** How many ingredients the frames leave room for: none (frames OR ingredients). */
export function ingredientRoom(f: Pick<SlotFill, 'first' | 'last'>): { images: number; videos: number } {
  if (f.first || f.last) return { images: 0, videos: 0 }
  return { images: MAX_IMAGES, videos: MAX_REF_VIDEOS }
}

/** Why Omni can't take this slot combination, or null. */
export function slotsProblem(f: SlotFill): string | null {
  if (f.last && !f.first) return 'A last frame needs a first frame.'
  if ((f.first || f.last) && f.images + f.videos > 0) return 'Omni takes frames or ingredients, not both. Remove the ingredients or the frames.'
  if (f.images > MAX_IMAGES) return `At most ${MAX_IMAGES} images.`
  if (f.videos > MAX_REF_VIDEOS) return `At most ${MAX_REF_VIDEOS} ingredient videos.`
  return null
}

/** VIDEO tab: the mode follows from the filled slots. */
export function videoModeFor(f: SlotFill): VideoModeInfo {
  const ingredients = f.images + f.videos > 0
  if (f.first && f.last) {
    return { mode: 'frames', apiTask: 'image_to_video', label: 'First + last frame', help: 'Starts on the first frame and ends on the last; describe the way between. The same image twice makes a loop.' }
  }
  if (f.first) {
    return { mode: 'image', apiTask: 'image_to_video', label: 'Image → video', help: 'The image is the first frame; describe the motion, the camera and the sound.' }
  }
  if (ingredients) {
    return { mode: 'refs', apiTask: 'reference_to_video', label: 'Ingredients → video', help: 'Subjects, products or style from the ingredients — not used as frames. Name them by their tags; videos work best for likeness and motion.' }
  }
  return { mode: 'text', apiTask: 'text_to_video', label: 'Text → video', help: 'From the prompt alone. Omni may cut between shots unless you write "single continuous shot".' }
}

export const MODE_LABEL: Record<VideoMode, string> = {
  text: 'Text → video', image: 'Image → video', frames: 'First + last frame', refs: 'Ingredients → video',
  'image-refs': 'First frame + ingredient (early test)',
  extend: 'Extend', edit: 'Edit',
}
