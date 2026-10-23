// ============================================================================
// lib/omni.ts — video generation and editing with Gemini Omni Flash on Vertex
// AI (Agent Platform), through the Interactions API. 2026-10-23.
//
// Rules found by live tests against gemini-omni-1.1-flash-preview (2026-10-22),
// see docs/ops/vertex-setup.md:
// - POST …/v1beta1/projects/<p>/locations/global/interactions with
//   background:true returns status in_progress; GET …/interactions/<id> until
//   completed (23-47 s for 3 s at 360p). A synchronous call took 103 s, and
//   Node's fetch gives up on a response that takes over 5 minutes, so always poll.
// - The finished video comes back inline (base64 mp4) when no gcs_uri is set.
// - previous_interaction_id (continue a stored interaction, kept 14 days)
//   must NOT be combined with video_config.task → 400.
// - aspect_ratio must NOT be set for edit or extend (400: they keep the
//   source's); an edit also keeps the source's length.
// - Editing and extending an uploaded (inline) video works on Vertex from
//   Switzerland, unlike the Gemini API.
// - Limits a request breaks after it was accepted (2 s, an 11 s edit, a 33 s
//   extend) end as status "failed" with the reason in errors[].message.
// - seed: the same seed and settings give the same video; thinking_level
//   takes only "low" or "high". Task limits: lib/omni-tasks.ts.
// ============================================================================
import { vertexAccount, vertexHeaders } from '@/lib/vertex'
import { USD_PER_M_INPUT, USD_PER_M_VIDEO_OUT, type VideoResolution } from '@/lib/omni-pricing'
import { MIN_SECONDS, MAX_SECONDS, type VideoApiTask, type VideoAspectRatio, type VideoThinking } from '@/lib/omni-tasks'

export type { VideoResolution } from '@/lib/omni-pricing'

export const VIDEO_MODEL = process.env.OSKAR_VIDEO_MODEL || 'gemini-omni-1.1-flash-preview'

export interface VideoMedia { data: string; mimeType: string }

export interface VideoRequest {
  prompt: string
  /** First + last frame is image_to_video with two images. */
  task: VideoApiTask
  resolution: VideoResolution
  /** Unset = the model picks from the prompt/images. Ignored for edit/extend. */
  aspectRatio?: VideoAspectRatio
  /** 3-10 s; ignored for edits. For extend: the length of the added part. */
  durationSeconds?: number
  seed?: number
  thinkingLevel?: VideoThinking
  /** First frame, first + last frame, or reference images (<IMAGE_REF_n>, in order). */
  images?: VideoMedia[]
  /** Reference videos (<VIDEO_REF_n>, in order). */
  videos?: VideoMedia[]
  /** Source video for edit/extend when there is no stored interaction to continue. */
  video?: VideoMedia
  /** Continue an interaction Oskar created (edit/extend a video it generated). */
  previousInteractionId?: string
}

export interface VideoResult {
  video: Buffer
  mimeType: string
  interactionId: string
  outputTokens: number
  inputTokens: number
  estUsd: number
  elapsedSeconds: number
}

const POLL_MS = 5000
const MAX_WAIT_MS = 15 * 60 * 1000
const CREATE_429_ATTEMPTS = 5 // waits 2, 4, 8, 16 s (shared capacity, like images)

function interactionsUrl(): string {
  const a = vertexAccount()
  if (!a) throw new Error('Video needs the Vertex service account (ops/vertex/oskar-ai.json; docs/ops/vertex-setup.md)')
  return `https://aiplatform.googleapis.com/v1beta1/projects/${a.projectId}/locations/global/interactions`
}

/** The request body, following the tested rules above. */
function buildBody(req: VideoRequest): Record<string, unknown> {
  const input: Record<string, unknown>[] = []
  for (const img of req.images || []) input.push({ type: 'image', data: img.data, mime_type: img.mimeType })
  for (const vid of req.videos || []) input.push({ type: 'video', data: vid.data, mime_type: vid.mimeType })
  if (req.video && !req.previousInteractionId) input.push({ type: 'video', data: req.video.data, mime_type: req.video.mimeType })
  input.push({ type: 'text', text: req.prompt })

  const format: Record<string, unknown> = { type: 'video', resolution: req.resolution }
  if (req.aspectRatio && req.task !== 'edit' && req.task !== 'extend') format.aspect_ratio = req.aspectRatio
  if (req.durationSeconds && req.task !== 'edit') {
    format.duration = `${Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(req.durationSeconds)))}s`
  }

  // A continued interaction must not name a task (400); the prompt carries it.
  const config: Record<string, unknown> = {}
  if (req.seed !== undefined) config.seed = req.seed
  if (req.thinkingLevel) config.thinking_level = req.thinkingLevel
  if (!req.previousInteractionId) config.video_config = { task: req.task }

  const body: Record<string, unknown> = {
    model: VIDEO_MODEL,
    background: true,
    store: true, // keeps the interaction 14 days, so the result can be edited/extended by id
    input,
    response_format: [format],
  }
  if (Object.keys(config).length) body.generation_config = config
  if (req.previousInteractionId) body.previous_interaction_id = req.previousInteractionId
  return body
}

function errorText(data: any, status?: number): string {
  // Rejected requests carry `error`; failed generations carry `errors[]`.
  const e = data?.error
  const many = Array.isArray(data?.errors) ? data.errors.map((x: any) => x?.message || JSON.stringify(x)).join('; ') : ''
  const msg = typeof e === 'string' ? e : e?.message || many || JSON.stringify(e || data).slice(0, 300)
  return status ? `HTTP ${status}: ${msg}` : msg
}

export async function generateVideo(req: VideoRequest): Promise<VideoResult> {
  const started = Date.now()
  const url = interactionsUrl()
  const payload = JSON.stringify(buildBody(req))

  let created: any
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: await vertexHeaders(), body: payload })
    created = await res.json().catch(() => ({}))
    if (res.ok) break
    if (res.status !== 429 || attempt >= CREATE_429_ATTEMPTS) throw new Error(`Omni video request rejected (${errorText(created, res.status)})`)
    const wait = 2000 * 2 ** (attempt - 1)
    console.warn(`[omni] 429, shared capacity busy (attempt ${attempt}/${CREATE_429_ATTEMPTS}), waiting ${wait / 1000}s...`)
    await new Promise(r => setTimeout(r, wait))
  }

  let data = created
  while (!['completed', 'failed', 'cancelled', 'incomplete'].includes(data.status)) {
    if (Date.now() - started > MAX_WAIT_MS) throw new Error(`Omni video not finished after ${MAX_WAIT_MS / 60000} minutes (interaction ${created.id})`)
    await new Promise(r => setTimeout(r, POLL_MS))
    const res = await fetch(`${url}/${created.id}`, { headers: await vertexHeaders() })
    const next = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) continue // keep polling through hiccups
      throw new Error(`Omni video status check failed (${errorText(next, res.status)})`)
    }
    data = next
  }
  if (data.status !== 'completed') throw new Error(`Omni video ${data.status}: ${errorText(data)}`)

  const output = (data.steps || [])
    .filter((s: any) => s.type === 'model_output')
    .flatMap((s: any) => s.content || [])
  const video = output.find((c: any) => c.type === 'video' && c.data)
  if (!video) {
    const text = output.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ').slice(0, 300)
    throw new Error(`Omni returned no video${text ? `. Model said: "${text}"` : ''}`)
  }

  const outputTokens = data.usage?.total_output_tokens || 0
  const inputTokens = data.usage?.total_input_tokens || 0
  return {
    video: Buffer.from(video.data, 'base64'),
    mimeType: video.mime_type || 'video/mp4',
    interactionId: data.id,
    outputTokens,
    inputTokens,
    estUsd: (outputTokens * USD_PER_M_VIDEO_OUT + inputTokens * USD_PER_M_INPUT) / 1e6,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  }
}
