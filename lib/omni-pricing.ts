// Gemini Omni Flash prices on Vertex (pricing page, 2026-10-22). Pure module:
// used by the server (lib/omni.ts) and by the VIDEO tab's cost hint (client).
// Video output $17.50 per 1M tokens; input $1.50 per 1M tokens.

export type VideoResolution = '360p' | '720p' | '1080p' | '4k'

/** Output tokens per second of video (with audio). */
export const VIDEO_TOKENS_PER_SECOND: Record<VideoResolution, number> = { '360p': 1931, '720p': 5792, '1080p': 8688, '4k': 17376 }
export const USD_PER_M_VIDEO_OUT = 17.5
export const USD_PER_M_INPUT = 1.5

export function estimateVideoUsd(resolution: VideoResolution, seconds: number): number {
  return (VIDEO_TOKENS_PER_SECOND[resolution] * seconds * USD_PER_M_VIDEO_OUT) / 1e6
}
