// ============================================================================
// run-video.ts — runs one VIDEO tab request: one generation per ✂ part
// (2026-10-23). Part 1 is the new video (VIDEO tab) or the first extension /
// the edit (VID → VID); every further part extends the part before by its
// generation ID, so nothing is uploaded again. Each part is its own POST to
// /api/generate-video, which keeps paid parts in video-parts/ and records
// every generation ID in VIDEOS.json. When a part fails, the result carries
// what is needed to resume at that part.
// ============================================================================
import { partPrompt, splitParts } from './video-parts'
import { ingredientImages, ingredientVideos, type VideoSlots, type VideoTab } from './video-slots'
import type { VideoAspectRatio, VideoThinking } from '@/lib/omni-tasks'
import type { VideoResolution } from '@/lib/omni-pricing'

export interface VideoRunInput {
  sessionId: string
  tab: VideoTab
  /** VID → VID only. */
  action: 'extend' | 'edit'
  slots: VideoSlots
  prompt: string
  /** Seconds per generation (from partSeconds); edit: [] (keeps the source's length). */
  seconds: number[]
  ratio: 'auto' | VideoAspectRatio
  resolution: VideoResolution
  thinking: VideoThinking
  seed: number
  filename: string
}

export interface VideoPartResult {
  filename: string
  savedPath: string
  intermediate: boolean
  interactionId: string
  chain: string[]
  elapsedSeconds: number
  estUsd: number
  seed?: number
}

/** Where to pick up after a failed part. */
export interface VideoResume {
  /** 0-based index of the part to run next. */
  index: number
  previous: VideoPartResult
}

export type VideoRunOutcome =
  | { ok: true; final: VideoPartResult; estUsd: number; parts: number }
  | { ok: false; error: string; resume: VideoResume | null; estUsd: number }

export async function runVideo(
  input: VideoRunInput,
  onPart: (index: number, total: number) => void,
  resume: VideoResume | null = null,
): Promise<VideoRunOutcome> {
  const parts = input.tab === 'vid2vid' && input.action === 'edit' ? [input.prompt.trim()] : splitParts(input.prompt)
  const total = parts.length
  const extendsSource = input.tab === 'vid2vid' && input.action === 'extend'
  let previous: VideoPartResult | null = resume?.previous ?? null
  let estUsd = 0

  for (let i = resume?.index ?? 0; i < total; i++) {
    onPart(i, total)
    const body: Record<string, unknown> = {
      sessionId: input.sessionId,
      prompt: partPrompt(parts[i], i, extendsSource),
      resolution: input.resolution,
      duration: input.seconds[i],
      seed: input.seed,
      thinking: input.thinking,
      filename: input.filename,
      part: total > 1 ? { index: i + 1, total } : undefined,
    }
    if (i > 0 && previous) {
      Object.assign(body, { kind: 'extend', continueFrom: previous.interactionId, chain: previous.chain })
    } else if (input.tab === 'video') {
      Object.assign(body, {
        kind: 'video',
        first: input.slots.first?.path,
        last: input.slots.last?.path,
        ingredients: [...ingredientImages(input.slots), ...ingredientVideos(input.slots)].map((x) => x.path),
        aspectRatio: input.ratio === 'auto' ? undefined : input.ratio,
      })
    } else {
      Object.assign(body, {
        kind: input.action,
        source: input.slots.source?.path,
        ingredients: ingredientImages(input.slots).map((x) => x.path),
      })
    }

    let result: VideoPartResult & { error?: string }
    try {
      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      result = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      const where = total > 1 ? `Part ${i + 1} of ${total} failed: ` : ''
      const kept = previous ? ` Part ${i} is kept (${previous.filename}); Generate continues from it.` : ''
      return { ok: false, error: `${where}${reason}${kept}`, resume: previous ? { index: i, previous } : null, estUsd }
    }
    estUsd += Number(result.estUsd) || 0
    previous = result
  }
  return { ok: true, final: previous!, estUsd, parts: total }
}
