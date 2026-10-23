// ============================================================================
// video-slots.ts — the source slots of the two VIDEO tabs (2026-10-23).
//
// VIDEO (text/image(s) → video): first frame, last frame, or ingredients —
//   frames OR ingredients, Omni doesn't mix them reliably (lib/omni-tasks.ts).
//   No slot filled = text → video. Ingredients are images, or short videos
//   (likeness, motion) — up to 10 images and 3 videos in all.
// VID → VID: the video to extend or edit, plus ingredient images (Omni takes
//   exactly one video for extend/edit: "Exactly one input video is required").
//
// Filling works like Layout: one slot is active (dashed), a click on an
// image or video in the library fills it and moves on to the next empty
// slot; clicking a staged asset in the library again takes it out. Clicking a
// slot makes it the active one (a filled slot is then replaced). Pure module.
// ============================================================================
import type { SourceImage } from '@/lib/types'
import { MAX_IMAGES, MAX_REF_VIDEOS } from '@/lib/omni-tasks'

export type VideoTab = 'video' | 'vid2vid'
/** 'first' | 'last' | 'source', or the index of an ingredient (= length → the empty "+" slot). */
export type VideoSlotKey = 'first' | 'last' | 'source' | number

export interface VideoSlots {
  first: SourceImage | null
  last: SourceImage | null
  ingredients: SourceImage[]
  source: SourceImage | null
  active: VideoSlotKey
}

export function emptySlots(tab: VideoTab): VideoSlots {
  return { first: null, last: null, ingredients: [], source: null, active: tab === 'video' ? 'first' : 'source' }
}

export const isVideoAsset = (img: SourceImage | null | undefined) =>
  !!img && /\.(mp4|webm|mov)($|\?)/i.test(img.path || img.filename || '')

export const ingredientImages = (s: VideoSlots) => s.ingredients.filter((x) => !isVideoAsset(x))
export const ingredientVideos = (s: VideoSlots) => s.ingredients.filter((x) => isVideoAsset(x))

/** The prompt tag of ingredient i: <IMAGE_REF_n> / <VIDEO_REF_n>, numbered per kind. */
export function ingredientTag(s: VideoSlots, i: number): string {
  const item = s.ingredients[i]
  const video = isVideoAsset(item)
  const n = s.ingredients.slice(0, i).filter((x) => isVideoAsset(x) === video).length
  return video ? `<VIDEO_REF_${n}>` : `<IMAGE_REF_${n}>`
}

function imageCount(s: VideoSlots): number {
  return (s.first ? 1 : 0) + (s.last ? 1 : 0) + ingredientImages(s).length
}

function canAdd(s: VideoSlots, img: SourceImage): boolean {
  return isVideoAsset(img) ? ingredientVideos(s).length < MAX_REF_VIDEOS : imageCount(s) < MAX_IMAGES
}

/** The slot after filling a frame: the first, then the last frame; with both set the last stays active (a click replaces it). */
function nextActive(s: VideoSlots): VideoSlotKey {
  if (!s.first) return 'first'
  return 'last'
}

/** A library click on a VIDEO tab. Returns the new slots (unchanged when there's no room). */
export function toggleSlot(tab: VideoTab, s: VideoSlots, img: SourceImage): VideoSlots {
  // Staged already → take it out; its slot becomes the active one.
  if (s.first?.id === img.id) return { ...s, first: null, active: 'first' }
  if (s.last?.id === img.id) return { ...s, last: null, active: 'last' }
  if (s.source?.id === img.id) return { ...s, source: null, active: 'source' }
  const at = s.ingredients.findIndex((x) => x.id === img.id)
  if (at >= 0) {
    const ingredients = s.ingredients.filter((_, k) => k !== at)
    return { ...s, ingredients, active: ingredients.length }
  }

  const video = isVideoAsset(img)
  if (tab === 'vid2vid') {
    // The one video is the source; images are ingredients.
    if (video) return { ...s, source: img, active: s.ingredients.length }
    if (typeof s.active === 'number' && s.active < s.ingredients.length) return replaceIngredient(s, s.active, img)
    return canAdd(s, img) ? { ...s, ingredients: [...s.ingredients, img], active: s.ingredients.length + 1 } : s
  }

  // VIDEO tab: frames take images only; videos always go to the ingredients
  // — but not while frames are set (frames OR ingredients).
  if (video && (s.first || s.last)) return s
  if (!video && (s.active === 'first' || s.active === 'last')) {
    const replacing = !!s[s.active]
    if (!replacing && !canAdd(s, img)) return s
    const next = { ...s, [s.active]: img }
    return { ...next, active: nextActive(next) }
  }
  if (!video && typeof s.active === 'number' && s.active < s.ingredients.length) return replaceIngredient(s, s.active, img)
  if (!canAdd(s, img)) return s
  const ingredients = [...s.ingredients, img]
  return { ...s, ingredients, active: video ? s.active : ingredients.length }
}

function replaceIngredient(s: VideoSlots, i: number, img: SourceImage): VideoSlots {
  if (isVideoAsset(img) !== isVideoAsset(s.ingredients[i]) && !canAdd(s, img)) return s
  const ingredients = s.ingredients.map((x, k) => (k === i ? img : x))
  return { ...s, ingredients, active: ingredients.length }
}

/** Badges for the library tiles (like Layout's Hero / 2 / 3). */
export function slotBadges(tab: VideoTab, s: VideoSlots, color: string): Record<string, { label: string; color: string }> {
  const map: Record<string, { label: string; color: string }> = {}
  if (tab === 'video') {
    if (s.first) map[s.first.id] = { label: 'First', color }
    if (s.last) map[s.last.id] = { label: s.last.id === s.first?.id ? 'First+Last' : 'Last', color }
  } else if (s.source) {
    map[s.source.id] = { label: 'Source', color }
  }
  s.ingredients.forEach((x, i) => {
    map[x.id] = { label: `Ing ${i + 1}`, color }
  })
  return map
}
