'use client'

/**
 * VideoWorkshop — the Z3+Z4 surface of Image mode's two video tabs
 * (2026-10-23), one card like the Img Ops workshop:
 *
 *   VIDEO      text / image(s) → video. Left: first frame, last frame and
 *              ingredient slots; no slot filled = text → video. The filled
 *              slots decide what Omni does (lib/omni-tasks.ts).
 *   VID → VID  extend or edit an existing video. Left: the video slot plus
 *              ingredient images.
 *
 *   ┌ [EXTEND|EDIT]  SEC · RATIO · RES · THINKING ─────────────────── 42 px ┐
 *   ├ SOURCES ────── Reset ┬ VIDEO PROMPT  mode   Presets ▾  ✂ Cut ─────┤
 *   │ frames / ingredients │ one prompt — Review by AI sees all of it   │
 *   │ (Layout-style slots) │ ✂ lines cut it into 10 s parts · parts/status│
 *   ├ FILE name.mp4 · cost / problem ─── Reset · Review by AI · Generate ┤
 *   └──────────────────────────────────────────────────────────── 52 px ┘
 *
 * Library clicks fill the slots (AdvancedMode → video-slots.ts toggleSlot).
 * Generate runs one generation per part (run-video.ts); later parts extend
 * the part before by its generation ID.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SourceImage } from '@/lib/types'
import {
  VIDEO_RATIOS, VIDEO_RESOLUTIONS, MAX_TOTAL_SECONDS, MAX_EDIT_SOURCE_SECONDS, MAX_EXTEND_SOURCE_SECONDS,
  MAX_REF_VIDEO_SECONDS, INTERACTION_KEPT_MS, MODE_LABEL, videoModeFor, slotsProblem, ingredientRoom,
  type VideoAspectRatio, type VideoThinking, type VideoMode,
} from '@/lib/omni-tasks'
import { estimateVideoUsd, USD_PER_M_INPUT, type VideoResolution } from '@/lib/omni-pricing'
import { VIDEO_PRESETS, PRESET_GROUP_LABEL, type VideoPreset, type VideoPresetGroup } from '@/lib/video-presets'
import {
  VIDEO_LENGTHS, PART_SECONDS, partSeconds, countCuts, addMissingCuts, removeCuts, renumberCuts,
  partsProblem, cutLine,
} from './video-parts'
import {
  ingredientImages, ingredientVideos, ingredientTag, isVideoAsset, emptySlots,
  type VideoSlots, type VideoSlotKey, type VideoTab,
} from './video-slots'
import { runVideo, type VideoResume, type VideoPartResult, type VideoRecipe } from './run-video'

export interface VideoSettings {
  /** VIDEO: total length; VID → VID extend: seconds to add. */
  length: number
  ratio: 'auto' | VideoAspectRatio
  resolution: VideoResolution
  thinking: VideoThinking
  /** VID → VID only. */
  action: 'extend' | 'edit'
  /** null = a new take each Generate; otherwise render this earlier take again. */
  take: VideoTake | null
}

/**
 * A take is one rendering of a recipe (prompt, slots, settings) with one
 * seed. Omni renders the same recipe + seed into the same video (tested:
 * identical frames); at 1080p/4K that is the same video sharper (upscales of
 * the 720p render), from 360p to 720p the scene stays but the motion changes,
 * and any change of prompt, slots, length, ratio or thinking gives a
 * different video (one word in the prompt → a new scene). So "Same take"
 * restores the whole recipe, and the user changes only the resolution.
 */
export interface VideoTake {
  seed: number
  /** The video it came from (its file in the session). */
  from: string
  recipe: VideoRecipe
}

export function defaultVideoSettings(tab: VideoTab): VideoSettings {
  return { length: tab === 'video' ? 8 : 10, ratio: '16:9', resolution: '720p', thinking: 'high', action: 'extend', take: null }
}

/** A video as GET /api/generate-video returns it (its LINEAGE.json record). */
interface VideoIndexEntry {
  interactionId: string
  createdAt: string
  mode?: VideoMode
  tab?: VideoTab
  prompt?: string
  aspectRatio?: string
  resolution?: string
  durationSeconds?: number
  seed?: number
  thinking?: VideoThinking
  sources?: string[]
  chain?: string[]
  part?: { index: number; total: number }
  recipe?: VideoRecipe
}

/** The tab a video belongs to: recorded, or from what Omni did (a multi-part video by its first part). */
export function tabOf(e: VideoIndexEntry, first: VideoIndexEntry): VideoTab {
  if (e.tab || e.recipe) return e.tab || e.recipe!.tab
  return first.mode === 'extend' || first.mode === 'edit' ? 'vid2vid' : 'video'
}

/**
 * The recipe of a video: recorded since the Take option exists, otherwise
 * rebuilt from its lineage record (prompt, sources by mode, length,
 * ratio, thinking; a multi-part video from its parts, joined with ✂ cuts).
 * null when the seed is unknown (videos made before seeds were recorded,
 * 2026-10-23) — Vertex doesn't report the seed it used.
 */
export function recipeOf(e: VideoIndexEntry, index: Record<string, VideoIndexEntry>): VideoRecipe | null {
  if (e.seed === undefined) return null
  if (e.recipe) return e.recipe
  let parts: VideoIndexEntry[] = [e]
  if (e.part && e.part.total > 1 && e.chain) {
    const ids = e.chain.slice(-e.part.total)
    const found = ids.map((id) => Object.values(index).find((x) => x.interactionId === id))
    if (found.some((x) => !x || x.prompt === undefined)) return null
    parts = found as VideoIndexEntry[]
  }
  const first = parts[0]
  const tab = tabOf(e, first)
  const src = first.sources || []
  const prompt = parts.map((x, i) => (i === 0 ? x.prompt || '' : `${cutLine(i + 1)}\n${x.prompt || ''}`)).join('\n\n')
  const length = parts.length > 1 ? parts.length * PART_SECONDS : first.durationSeconds || (tab === 'video' ? 8 : 10)
  const base = { tab, prompt, length, ratio: (first.aspectRatio as VideoAspectRatio | undefined) || 'auto' as const, thinking: first.thinking || 'high' as const }
  if (tab === 'vid2vid') {
    return { ...base, action: first.mode === 'edit' ? 'edit' : 'extend', ratio: 'auto', source: src[0], ingredients: src.slice(1) }
  }
  const m = first.mode
  return {
    ...base, action: 'extend',
    first: m === 'image' || m === 'frames' || m === 'image-refs' ? src[0] : undefined,
    last: m === 'frames' ? src[1] : undefined,
    ingredients: m === 'refs' ? src : m === 'image-refs' ? src.slice(1) : [],
  }
}

export const VIDEO_TAB_COLOR: Record<VideoTab, string> = { video: '#EF4444', vid2vid: '#F97316' }
const MONO = 'var(--font-mono, "JetBrains Mono", monospace)'
const RES_LABEL: Record<string, string> = { '360p': '360p', '720p': '720p', '1080p': '1080p↑', '4k': '4K↑' }
const RES_TITLE: Record<string, string> = {
  '360p': 'Draft quality, cheapest (≈ $0.03 per second)',
  '720p': "Omni's own resolution (≈ $0.10 per second)",
  '1080p': 'The 720p render, upscaled by Google: same picture, crisper detail (≈ $0.15 per second)',
  '4k': 'The 720p render, upscaled by Google (≈ $0.30 per second)',
}

export interface VideoWorkshopProps {
  tab: VideoTab
  sessionId: string
  slots: VideoSlots
  onSlotsChange: (slots: VideoSlots) => void
  settings: VideoSettings
  onSettingsChange: (patch: Partial<VideoSettings>) => void
  prompt: string
  onPromptChange: (prompt: string) => void
  activePresetLabel: string | null
  onPresetSelect: (preset: VideoPreset) => void
  canReset: boolean
  onResetPrompt: () => void
  filename: string
  onFilenameChange: (value: string) => void
  /** Sends a review request (with the full context) to the CD. */
  onReviewAI: (message: string) => void
  isReviewingAI: boolean
  /** A finished video: add it to the library and select it. */
  onVideoReady: (video: SourceImage) => void
  /** VIDEO tab: open the result in VID → VID. */
  onOpenInVid2Vid?: (video: SourceImage) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** The session's images and videos — to put a take's sources back into the slots. */
  library: SourceImage[]
}

export function VideoWorkshop(props: VideoWorkshopProps) {
  const {
    tab, sessionId, slots, onSlotsChange, settings, onSettingsChange, prompt, onPromptChange,
    activePresetLabel, onPresetSelect, canReset, onResetPrompt, filename, onFilenameChange,
    onReviewAI, isReviewingAI, onVideoReady, onOpenInVid2Vid, textareaRef, library,
  } = props
  const color = VIDEO_TAB_COLOR[tab]
  const isEdit = tab === 'vid2vid' && settings.action === 'edit'

  // --- Generation IDs, seeds and recipes of this session's videos (LINEAGE.json)
  const [index, setIndex] = useState<Record<string, VideoIndexEntry>>({})
  const loadIndex = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/generate-video?sessionId=${encodeURIComponent(sessionId)}`)
      if (res.ok) setIndex((await res.json()).videos || {})
    } catch { /* the hints just stay without IDs */ }
  }, [sessionId])
  useEffect(() => { void loadIndex() }, [loadIndex])

  // --- Lengths of the video sources (from the files' metadata) -------------
  const [lengths, setLengths] = useState<Record<string, number>>({})
  const onLength = useCallback((p: string, s: number) => setLengths((m) => (m[p] === s ? m : { ...m, [p]: s })), [])
  const sourceLen = slots.source ? lengths[slots.source.path] : undefined
  const sourceEntry = slots.source ? index[slots.source.path.split('/').pop() || ''] : undefined
  const sourceDaysLeft = sourceEntry ? Math.floor((Date.parse(sourceEntry.createdAt) + INTERACTION_KEPT_MS - Date.now()) / 86400000) : -1
  const sourceContinues = !!sourceEntry && sourceDaysLeft >= 0

  // --- What the slots and settings add up to --------------------------------
  const fill = { first: !!slots.first, last: !!slots.last, images: ingredientImages(slots).length, videos: ingredientVideos(slots).length }
  const modeInfo = tab === 'video' ? videoModeFor(fill) : null
  const presetGroup: VideoPresetGroup = tab === 'vid2vid' ? settings.action
    : (modeInfo!.mode as VideoPresetGroup)
  const seconds = isEdit ? [] : partSeconds(settings.length)
  const parts = isEdit ? 1 : seconds.length
  const cutOffset = tab === 'vid2vid' && sourceLen !== undefined ? Math.round(sourceLen) : 0
  const room = ingredientRoom(fill)

  const problem = useMemo((): string | null => {
    if (tab === 'video') {
      const p = slotsProblem(fill)
      if (p) return p
    } else {
      if (!slots.source) return `Pick the video to ${settings.action}: click a video in the library.`
      if (sourceLen !== undefined) {
        if (isEdit && sourceLen > MAX_EDIT_SOURCE_SECONDS + 0.3) return `Edit takes videos up to ${MAX_EDIT_SOURCE_SECONDS} s; this one is ${sourceLen.toFixed(1)} s.`
        if (!isEdit && !sourceContinues && sourceLen > MAX_EXTEND_SOURCE_SECONDS + 0.3) return `Extend takes uploaded videos up to ${MAX_EXTEND_SOURCE_SECONDS} s; this one is ${sourceLen.toFixed(1)} s.`
        if (!isEdit && sourceLen + settings.length > MAX_TOTAL_SECONDS + 0.5) return `${Math.round(sourceLen)} s + ${settings.length} s is over the ${MAX_TOTAL_SECONDS} s Omni allows.`
      }
      if (isEdit && countCuts(prompt) > 0) return 'An edit is one generation: remove the ✂ cuts.'
    }
    if (!prompt.trim()) return null
    return isEdit ? null : partsProblem(prompt, parts)
  }, [tab, fill.first, fill.last, fill.images, fill.videos, slots.source, sourceLen, sourceContinues, isEdit, settings.action, settings.length, prompt, parts])

  const refVideoTooLong = ingredientVideos(slots).find((v) => (lengths[v.path] ?? 0) > MAX_REF_VIDEO_SECONDS + 0.5)

  // Cost: output per second at the resolution (new seconds; an edit re-renders
  // the whole source) plus ≈ 1,200 input tokens per second of source video.
  const estimate = (() => {
    const inputUsd = sourceLen ? (sourceLen * 1200 * USD_PER_M_INPUT) / 1e6 : 0
    if (isEdit) return sourceLen ? estimateVideoUsd(settings.resolution, sourceLen) + inputUsd : null
    return estimateVideoUsd(settings.resolution, settings.length) + inputUsd
  })()

  // --- Prompt helpers -------------------------------------------------------
  const setLength = (length: number) => {
    onSettingsChange({ length })
    const n = partSeconds(length).length
    if (n > 1 && countCuts(prompt) < n - 1) {
      onPromptChange(renumberCuts(addMissingCuts(prompt, n, cutOffset), cutOffset))
      // Cursor to the end: that's where the new part is written.
      requestAnimationFrame(() => {
        const t = textareaRef.current
        if (!t) return
        t.focus()
        t.setSelectionRange(t.value.length, t.value.length)
        t.scrollTop = t.scrollHeight
      })
    }
  }

  const insertAtCursor = (text: string, block: boolean) => {
    const ta = textareaRef.current
    const start = ta?.selectionStart ?? prompt.length
    const end = ta?.selectionEnd ?? start
    const before = prompt.slice(0, start)
    const after = prompt.slice(end)
    const insert = block
      ? `${before && !before.endsWith('\n') ? '\n\n' : ''}${text}\n`
      : `${before && !/\s$/.test(before) ? ' ' : ''}${text}${/^\s/.test(after) ? '' : ' '}`
    const next = before + insert + after
    onPromptChange(block ? renumberCuts(next, cutOffset) : next)
    requestAnimationFrame(() => {
      const t = textareaRef.current
      if (!t) return
      t.focus()
      const pos = Math.min(start + insert.length, t.value.length)
      t.setSelectionRange(pos, pos)
    })
  }

  // --- Takes (seed + recipe) ------------------------------------------------------
  const recipe: VideoRecipe = {
    tab, action: settings.action, prompt: prompt.trim(), length: settings.length, ratio: settings.ratio, thinking: settings.thinking,
    first: slots.first?.path, last: slots.last?.path, ingredients: slots.ingredients.map((x) => x.path), source: slots.source?.path,
  }
  const take = settings.take
  /** What differs from the chosen take — each makes it a new take. */
  const takeChanges: string[] = []
  if (take) {
    const r = take.recipe
    if (r.prompt !== recipe.prompt) takeChanges.push('prompt')
    if (r.first !== recipe.first || r.last !== recipe.last || r.source !== recipe.source || r.ingredients.join('|') !== recipe.ingredients.join('|')) takeChanges.push('slots')
    if (r.action !== recipe.action && tab === 'vid2vid') takeChanges.push('extend/edit')
    if (r.length !== recipe.length && !isEdit) takeChanges.push('length')
    if (r.ratio !== recipe.ratio && tab === 'video') takeChanges.push('ratio')
    if (r.thinking !== recipe.thinking) takeChanges.push('thinking')
  }
  const takeName = (key: string) => key.replace(/\.mp4$/i, '')

  // The tab's own videos with a recorded take, newest first.
  // Videos made before seeds were recorded are listed too, greyed out.
  const takes = useMemo(() => Object.entries(index)
    .filter(([key]) => !key.startsWith('video-parts/'))
    .map(([key, e]) => ({ key, e, recipe: recipeOf(e, index) }))
    .filter((t) => (t.recipe ? t.recipe.tab : tabOf(t.e, t.e)) === tab)
    .sort((a, b) => Date.parse(b.e.createdAt) - Date.parse(a.e.createdAt))
    .slice(0, 16), [index, tab])

  const [takesOpen, setTakesOpen] = useState(false)
  const [takeNote, setTakeNote] = useState<string | null>(null)
  const applyTake = (key: string, e: VideoIndexEntry, r: VideoRecipe) => {
    const find = (p?: string) => (p ? library.find((x) => x.path === p) || library.find((x) => x.filename === p.split('/').pop()) || null : null)
    const restored = {
      first: find(r.first), last: find(r.last), source: find(r.source),
      ingredients: r.ingredients.map(find).filter((x): x is SourceImage => !!x),
    }
    const missing = [r.first, r.last, r.source].filter(Boolean).length + r.ingredients.length
      - [restored.first, restored.last, restored.source].filter(Boolean).length - restored.ingredients.length
    onSlotsChange({ ...emptySlots(tab), ...restored, active: tab === 'video' ? (restored.first ? 'last' : 'first') : restored.ingredients.length })
    onPromptChange(r.prompt)
    onSettingsChange({ take: { seed: e.seed!, from: key, recipe: r }, length: r.length, ratio: r.ratio, thinking: r.thinking, action: r.action })
    setTakeNote(missing > 0 ? `${missing} source${missing > 1 ? 's' : ''} of ${key} ${missing > 1 ? 'are' : 'is'} no longer in the library — that makes it a new take.` : null)
    setTakesOpen(false)
  }

  // --- Generate ---------------------------------------------------------------
  const [running, setRunning] = useState<{ part: number; total: number; startedAt: number } | null>(null)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  const [error, setError] = useState<string | null>(null)
  const [resume, setResume] = useState<VideoResume | null>(null)
  const [done, setDone] = useState<{ video: SourceImage; take: VideoTake; text: string } | null>(null)
  const startedRef = useRef(0)

  // A changed source or task invalidates a half-finished run.
  useEffect(() => { setResume(null) }, [tab, settings.action, slots.first?.id, slots.source?.id])

  const generate = useCallback(async () => {
    if (running || !prompt.trim() || problem) return
    // The chosen take's seed, or a new random one. Either way it is recorded
    // with the recipe in LINEAGE.json (the API doesn't report the seed it used).
    const seed = take ? take.seed : Math.floor(Math.random() * 2147483647)
    setError(null)
    setDone(null)
    startedRef.current = Date.now()
    const outcome = await runVideo(
      {
        sessionId, tab, action: settings.action, slots, prompt, seconds,
        ratio: settings.ratio, resolution: settings.resolution, thinking: settings.thinking, seed, filename, recipe,
      },
      (part, total) => setRunning({ part, total, startedAt: Date.now() }),
      resume,
    )
    setRunning(null)
    void loadIndex()
    if ('error' in outcome) {
      setError(outcome.error)
      setResume(outcome.resume)
      return
    }
    setResume(null)
    const f: VideoPartResult = outcome.final
    const parents = [slots.source, slots.first, slots.last, ...slots.ingredients].filter((x): x is SourceImage => !!x).map((x) => x.filename)
    const video: SourceImage = {
      id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      filename: f.filename,
      path: f.savedPath,
      uploadedAt: new Date().toISOString(),
      isGenerated: true,
      sourcePrompt: prompt,
      parentImage: parents[0],
      parentImages: parents.length > 1 ? parents : undefined,
    }
    onVideoReady(video)
    const secs = Math.round((Date.now() - startedRef.current) / 1000)
    setDone({
      video,
      take: { seed, from: f.filename, recipe },
      text: `Done in ${secs} s · ${f.filename}${outcome.parts > 1 ? ` · ${outcome.parts} parts` : ''} · ≈ $${outcome.estUsd.toFixed(2)} · generation ID …${f.interactionId.slice(-8)}`,
    })
  }, [running, prompt, problem, settings, take, sessionId, tab, slots, seconds, filename, resume, recipe, loadIndex, onVideoReady])

  // --- Review by AI: the CD gets the whole context of the tab --------------
  const review = () => {
    const tags: string[] = []
    if (tab === 'video') {
      if (slots.first) tags.push(`<FIRST_FRAME> = ${slots.first.filename}`)
      if (slots.last) tags.push(`<LAST_FRAME> = ${slots.last.filename}`)
    } else if (slots.source) {
      tags.push(`video to ${settings.action} = ${slots.source.filename}${sourceLen ? ` (${sourceLen.toFixed(1)} s)` : ''}`)
    }
    slots.ingredients.forEach((x, i) => tags.push(`${ingredientTag(slots, i)} = ${x.filename}`))
    const what = tab === 'video'
      ? `${modeInfo!.label} — ${modeInfo!.help} Length ${settings.length} s${parts > 1 ? ` in ${parts} parts of ${PART_SECONDS} s` : ''}, ratio ${settings.ratio}, ${settings.resolution}.`
      : isEdit
        ? 'Edit: one short change to the whole video; it keeps its length and ratio.'
        : `Extend the video by ${settings.length} s${parts > 1 ? ` in ${parts} parts of ${PART_SECONDS} s` : ''}; each part starts with "Extend this video:" and describes how the scene continues.`
    const cuts = parts > 1
      ? ` The prompt is cut into ${parts} parts by lines starting with ✂ — keep every ✂ line exactly. Each part is one generation of up to ${PART_SECONDS} s; every part after the first continues the video before it, so start it with "Extend this video:" and keep subject, look and sound consistent. Timecodes inside a part count from 0 of that part ([0-3s]).`
      : ''
    onReviewAI(
      `Review the VIDEO PROMPT below for Gemini Omni Flash (video with sound) — follow agents/CD-VIDEO-PROMPTING.md. ${what}` +
        `${tags.length ? ` Sources: ${tags.join('; ')}.` : ''}${cuts} ` +
        'Make it ready for Omni: scene and subject, motion, camera, lighting and mood, and the sound (music, effects, or "No dialogue"); ' +
        'write "single continuous shot" when one shot is meant, otherwise the cuts with timecodes like [0-3s]. ' +
        `${isEdit ? 'Keep an edit to one short change ending with "Keep everything else the same." ' : ''}` +
        'Negatives go into the prompt ("No dialogue", "no music"); there is no negative-prompt field. ' +
        'Keep my intent and every tag like <IMAGE_REF_0>. Return the refined prompt inside a `## IMAGE PROMPT` block so it replaces the prompt. ' +
        "If it's already excellent, return it unchanged.\n\nCurrent prompt:\n```\n" + prompt + '\n```',
    )
  }

  // --- Presets menu -----------------------------------------------------------
  const [presetsOpen, setPresetsOpen] = useState(false)
  const presetGroups: VideoPresetGroup[] = tab === 'video'
    ? [presetGroup, ...(['text', 'image', 'frames', 'refs'] as VideoPresetGroup[]).filter((g) => g !== presetGroup)]
    : [presetGroup]

  const runLabel = running
    ? `${running.total > 1 ? `Part ${running.part + 1}/${running.total} · ` : ''}${Math.round((Date.now() - running.startedAt) / 1000)} s…`
    : resume ? `Continue from part ${resume.index + 1}` : 'Generate'
  const canGenerate = !running && !!prompt.trim() && !problem

  const statusText = running
    ? `Generating${running.total > 1 ? ` part ${running.part + 1} of ${running.total}` : ''} · usually 30 s–3 min per part`
    : problem || takeNote || (take && takeChanges.length
      ? `Changed ${takeChanges.join(', ')} — this renders a new take, not ${takeName(take.from)} again`
      : null) || (estimate !== null
      ? `≈ $${estimate.toFixed(2)} · ${isEdit ? 'whole video re-rendered' : `${parts} generation${parts > 1 ? 's' : ''}`}`
      : 'Cost follows from the video length')

  return (
    <div
      className="bento-card"
      style={{ position: 'relative', display: 'grid', gridTemplateRows: '42px minmax(0, 1fr) 52px', gridTemplateColumns: 'minmax(250px, 1fr) 2fr', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}
    >
      {/* ── 42 px OPTIONS BAR (like the Img Ops ops-bar) ── */}
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: '1px solid var(--border-card)', minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        {tab === 'vid2vid' && (
          <div style={pillBoxStyle}>
            {(['extend', 'edit'] as const).map((a) => {
              const on = settings.action === a
              return (
                <button
                  key={a}
                  onClick={() => onSettingsChange({ action: a })}
                  title={a === 'extend' ? 'Continue the video at its end (up to 40 s in all)' : 'Change the video (≤ 10 s); it keeps its length and ratio'}
                  style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: on ? color : 'transparent', color: on ? '#fff' : 'var(--text-muted)', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {a}
                </button>
              )
            })}
          </div>
        )}
        {isEdit ? (
          <Fixed label="Length" text="from video" />
        ) : (
          <Pills
            label={tab === 'video' ? 'Sec' : 'Add s'}
            options={VIDEO_LENGTHS.map(String)}
            titles={Object.fromEntries(VIDEO_LENGTHS.map((l) => [String(l), l > PART_SECONDS ? `${partSeconds(l).length} generations of ${PART_SECONDS} s, cut with ✂ in the prompt` : 'One generation']))}
            disabled={tab === 'vid2vid' && sourceLen !== undefined ? VIDEO_LENGTHS.filter((l) => sourceLen + l > MAX_TOTAL_SECONDS + 0.5).map(String) : []}
            value={String(settings.length)}
            onChange={(v) => setLength(Number(v))}
          />
        )}
        {tab === 'video' && (
          <Pills label="Ratio" options={['auto', ...VIDEO_RATIOS]} labels={{ auto: 'Auto' }}
            titles={{ auto: 'Not set: Omni picks 16:9 or 9:16 from the prompt and images' }}
            value={settings.ratio} onChange={(v) => onSettingsChange({ ratio: v as VideoSettings['ratio'] })} />
        )}
        <Pills label="Res" options={VIDEO_RESOLUTIONS} labels={RES_LABEL} titles={RES_TITLE}
          value={settings.resolution} onChange={(v) => onSettingsChange({ resolution: v as VideoResolution })} />
        <Pills label="Think" options={['low', 'high']} labels={{ low: 'Low', high: 'High' }}
          titles={{ low: 'Plans less before rendering: one simple shot', high: 'Plans shots, cuts and timing before rendering: stories, several shots, exact timing' }}
          value={settings.thinking} onChange={(v) => onSettingsChange({ thinking: v as VideoThinking })} />
        <div
          style={{ ...pillBoxStyle, flexShrink: 0 }}
          title={'A take is one rendering of the prompt. New: a new rendering every time. Same as …: renders an earlier video of this tab again — its prompt, slots and settings come back; pick a higher resolution for a sharper copy (1080p/4K are upscales of 720p). Any other change gives a new take.'}
        >
          <span style={pillLabelStyle}>Take</span>
          <button
            onClick={() => setTakesOpen((o) => !o)}
            style={{
              padding: '4px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
              maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis',
              border: `1px solid ${take ? (takeChanges.length ? '#F59E0B' : '#10B981') : '#10B981'}`,
              background: take && takeChanges.length ? '#F59E0B20' : '#10B98120',
              color: take && takeChanges.length ? '#F59E0B' : '#10B981',
            }}
          >
            {take ? `Same as ${takeName(take.from)}` : 'New'} ▾
          </button>
          {take && (
            <button onClick={() => { onSettingsChange({ take: null }); setTakeNote(null) }} title="Back to a new take" style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}>×</button>
          )}
        </div>
      </div>

      {/* Take menu: New, or one of this tab's earlier videos (from LINEAGE.json) */}
      {takesOpen && (
        <div style={{ position: 'absolute', top: 40, right: 12, zIndex: 30, width: 340, maxHeight: '80%', overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-active)', borderRadius: 8, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
          <button
            onClick={() => { onSettingsChange({ take: null }); setTakeNote(null); setTakesOpen(false) }}
            style={{ ...menuRowStyle, background: !take ? '#10B98118' : 'transparent' }}
          >
            <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>New take</span>
            <span style={{ color: 'var(--text-muted)' }}>A new rendering every time</span>
          </button>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '8px 8px 4px' }}>Same take as</div>
          {takes.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 8px 8px', lineHeight: 1.5 }}>
              No video made in this tab yet.
            </div>
          )}
          {takes.map(({ key, e, recipe: r }) => {
            const p = library.find((x) => x.filename === key)?.path || `/${sessionId}/${key}`
            const d = new Date(e.createdAt)
            const when = d.toDateString() === new Date().toDateString()
              ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
            const mode = !r ? 'made before takes were recorded — can\'t be repeated'
              : r.tab === 'vid2vid' ? (r.action === 'edit' ? 'Edit' : `Extend +${r.length} s`)
                : `${MODE_LABEL[(r.first ? (r.last ? 'frames' : 'image') : r.ingredients.length ? 'refs' : 'text') as VideoMode]} · ${r.length} s`
            return (
              <button
                key={key}
                disabled={!r}
                onClick={() => r && applyTake(key, e, r)}
                title={r ? `Render ${key} again: its prompt, slots and settings come back` : 'Oskar recorded no seed for this video (made before 2026-10-23), so its take can\'t be repeated.'}
                style={{ ...menuRowStyle, flexDirection: 'row', alignItems: 'center', gap: 10, background: take?.from === key ? '#10B98118' : 'transparent', opacity: r ? 1 : 0.45, cursor: r ? 'pointer' : 'not-allowed' }}
              >
                <video src={`${p}#t=0.5`} muted playsInline preload="metadata" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 3, flexShrink: 0, background: 'var(--bg-card-hover)' }} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}>
                  <span style={{ color: 'var(--text-main)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
                  <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mode}{r ? ` · ${e.resolution === '4k' ? '4K' : e.resolution}` : ''} · {when}</span>
                </span>
              </button>
            )
          })}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 8px 4px', lineHeight: 1.5, borderTop: '1px solid var(--border-card)', marginTop: 4 }}>
            Same take brings back that video's prompt, slots and settings. Generate renders the same video again; at 1080p or 4K the same video sharper. Changing anything else gives a new take.
          </div>
        </div>
      )}

      {/* ── LEFT: the sources ── */}
      <div style={{ borderRight: '1px solid var(--border-card)', overflowY: 'auto', minHeight: 0, padding: '0 16px 12px' }}>
        <div style={{ ...headerStyle, justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FilmIcon /> {tab === 'video' ? 'Sources' : 'Video'}</span>
          {(slots.first || slots.last || slots.source || slots.ingredients.length > 0) && (
            <button onClick={() => onSlotsChange(emptySlots(tab))} style={resetBtnStyle} title="Empty all slots">✕ Reset</button>
          )}
        </div>

        {tab === 'video' ? (
          <Row label="Frames">
            <Tile label="First" asset={slots.first} slot="first" slots={slots} onSlotsChange={onSlotsChange} color={color} tag="<FIRST_FRAME>" onTag={(t) => insertAtCursor(t, false)} onLength={onLength} />
            <span style={{ color: 'var(--text-dim)', fontSize: 12, alignSelf: 'center', marginTop: -14 }}>→</span>
            <Tile label="Last" asset={slots.last} slot="last" slots={slots} onSlotsChange={onSlotsChange} color={color} tag="<LAST_FRAME>" onTag={(t) => insertAtCursor(t, false)} onLength={onLength} />
            {slots.first && slots.last?.id !== slots.first.id && (
              <button onClick={() => onSlotsChange({ ...slots, last: slots.first, active: 'last' })} title="Last frame = first frame: a seamless loop" style={{ ...smallBtnStyle(), alignSelf: 'center', marginTop: -14 }}>Loop</button>
            )}
          </Row>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
            <Tile label={settings.action === 'edit' ? 'To edit' : 'To extend'} asset={slots.source} slot="source" slots={slots} onSlotsChange={onSlotsChange} color={color} wide onLength={onLength} />
            <div style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--text-muted)', minWidth: 0, paddingTop: 2 }}>
              {!slots.source ? 'Click a video in the library' : (
                <>
                  {sourceLen !== undefined && <div style={{ fontFamily: MONO, color: 'var(--text-main)' }}>{sourceLen.toFixed(1)} s</div>}
                  <div title={sourceContinues ? `Generation ID ${sourceEntry!.interactionId}` : undefined}>
                    {sourceContinues
                      ? `Oskar's generation …${sourceEntry!.interactionId.slice(-6)} · ${sourceDaysLeft} d left · no upload`
                      : `Uploaded with the request · ${isEdit ? `≤ ${MAX_EDIT_SOURCE_SECONDS}` : `≤ ${MAX_EXTEND_SOURCE_SECONDS}`} s`}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <Row label={tab === 'video' ? (room.images === 0 ? 'Ingredients · or frames' : 'Ingredients') : 'Ingredients · optional'}>
          {slots.ingredients.map((x, i) => (
            <Tile key={x.id} label={String(i + 1)} asset={x} slot={i} slots={slots} onSlotsChange={onSlotsChange} color={color}
              tag={ingredientTag(slots, i)} onTag={(t) => insertAtCursor(t, false)} onLength={onLength}
              over={tab === 'video' && room.images === 0} />
          ))}
          {(tab === 'vid2vid' ? slots.ingredients.length < 10 : room.images + room.videos > slots.ingredients.length) && (
            <Tile label="Add" asset={null} slot={slots.ingredients.length} slots={slots} onSlotsChange={onSlotsChange} color={color} onLength={onLength}
              hint={tab === 'video' ? 'Up to 10 images and 3 short videos — subjects, products, style. Name them in the prompt by their tags.' : 'Images to bring into the video, named by their tags.'} />
          )}
        </Row>
        {refVideoTooLong && (
          <div style={{ fontSize: 10, color: '#F59E0B' }}>{refVideoTooLong.filename}: Google advises ingredient videos ≤ {MAX_REF_VIDEO_SECONDS} s.</div>
        )}
      </div>

      {/* ── RIGHT: the prompt ── */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, position: 'relative' }}>
        <div style={{ ...headerStyle, padding: '0 16px', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg xmlns="http://www.w3.org/2000/svg" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            Video prompt
          </span>
          <span title={tab === 'video' ? modeInfo!.help : undefined} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color, padding: '3px 8px', borderRadius: 4, border: `1px solid ${color}`, background: `${color}14`, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {tab === 'video' ? modeInfo!.label : isEdit ? 'Edit' : 'Extend'}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setPresetsOpen((o) => !o)} style={smallBtnStyle(presetsOpen ? color : undefined)}>Presets ▾</button>
          {!isEdit && (
            <button
              onClick={() => insertAtCursor(`${cutLine(countCuts(prompt) + 2, cutOffset)}\nExtend this video: `, true)}
              title="Start the next 10 s part here: the text below is generated as an extension of the part above"
              style={smallBtnStyle()}
            >
              ✂ Cut
            </button>
          )}
        </div>

        {presetsOpen && (
          <div style={{ position: 'absolute', top: 40, right: 16, zIndex: 20, width: 280, maxHeight: '85%', overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-active)', borderRadius: 8, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
            {presetGroups.map((g) => (
              <div key={g} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: g === presetGroup ? color : 'var(--text-dim)', padding: '6px 8px 2px' }}>
                  {PRESET_GROUP_LABEL[g]}{g === presetGroup && tab === 'video' ? ' · your slots' : ''}
                </div>
                {VIDEO_PRESETS[g].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => { onPresetSelect(p); setPresetsOpen(false) }}
                    title={p.prompt}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, background: p.label === activePresetLabel ? `${color}20` : 'transparent', color: p.label === activePresetLabel ? color : 'var(--text-main)' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 60, margin: '0 16px', background: 'var(--bg-card-hover)', border: '1px solid var(--border-active)', borderRadius: 10, overflow: 'hidden', display: 'flex' }}>
          <textarea
            ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onBlur={() => {
              // Tidy the cut lines (numbers, spans, text typed onto a marker line).
              if (!countCuts(prompt)) return
              const tidy = renumberCuts(prompt, cutOffset)
              if (tidy !== prompt) onPromptChange(tidy)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate() }
              if (e.key === 'Escape') { e.preventDefault(); (e.target as HTMLElement).blur() }
            }}
            placeholder={tab === 'video'
              ? 'Describe the video — scene, subject and motion, camera, lighting, sound ("No dialogue"). Longer than 10 s: ✂ Cut starts each next 10 s part.'
              : isEdit ? 'One change, e.g. "Make it night. Keep everything else the same."' : 'Extend this video: how the scene continues…'}
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, padding: '12px 16px', resize: 'none', outline: 'none' }}
          />
        </div>

        <div style={{ minHeight: 24, padding: '4px 16px 6px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: MONO, color: 'var(--text-muted)' }}>
          {error && !running ? (
            <span style={{ color: '#f87171', fontFamily: 'inherit', lineHeight: 1.4 }}>{error}</span>
          ) : done && !running ? (
            <>
              <span style={{ color: '#22C55E', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={done.text}>{done.text}</span>
              {take?.from !== done.take.from && (
                <button
                  onClick={() => { onSettingsChange({ take: done.take }); setTakeNote(null) }}
                  title="Keep this take: Generate renders this video again — e.g. at 1080p or 4K for a sharper copy"
                  style={smallBtnStyle('#10B981')}
                >
                  Same take
                </button>
              )}
              {tab === 'video' && onOpenInVid2Vid && (
                <button onClick={() => onOpenInVid2Vid(done.video)} style={smallBtnStyle(VIDEO_TAB_COLOR.vid2vid)}>Extend or edit →</button>
              )}
            </>
          ) : !isEdit && parts > 1 ? (
            <span>{Array.from({ length: parts }, (_, i) => `${i + 1}: ${i === 0 && tab === 'video' ? 'new' : '+'} ${cutOffset + i * PART_SECONDS}–${cutOffset + (i + 1) * PART_SECONDS} s`).join('  ·  ')}</span>
          ) : null}
        </div>
      </div>

      {/* ── 52 px FOOTER: filename · cost · buttons ── */}
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', borderTop: '1px solid var(--border-card)', minWidth: 0 }}>
        <div style={{ ...pillBoxStyle, padding: '3px 3px 3px 8px', flexShrink: 0 }}>
          <span style={pillLabelStyle}>File</span>
          <input
            value={filename}
            onChange={(e) => onFilenameChange(e.target.value)}
            placeholder="name"
            style={{ width: 170, height: 22, border: 'none', background: 'transparent', color: 'var(--text-main)', fontSize: 11, fontFamily: MONO, outline: 'none', padding: '0 4px' }}
          />
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: MONO, paddingRight: 6 }}>.mp4</span>
        </div>
        <span
          title={statusText}
          style={{ flex: 1, minWidth: 0, fontSize: 10, fontFamily: MONO, color: (problem || takeNote || (take && takeChanges.length)) && !running ? '#F59E0B' : 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {statusText}
        </span>
        {problem && !running && /✂ cuts?|cuts\./.test(problem) && countCuts(prompt) > 0 && (
          <button onClick={() => onPromptChange(removeCuts(prompt))} style={smallBtnStyle('#F59E0B')}>Remove cuts</button>
        )}
        {problem && !running && /needs \d+ ✂/.test(problem) && (
          <button onClick={() => onPromptChange(renumberCuts(addMissingCuts(prompt, parts, cutOffset), cutOffset))} style={smallBtnStyle('#F59E0B')}>Add cuts</button>
        )}
        <button onClick={onResetPrompt} disabled={!canReset || !!running} title="Back to the last loaded prompt (preset or review)" style={footBtnStyle(!canReset || !!running)}>Reset</button>
        <button onClick={review} disabled={isReviewingAI || !!running || !prompt.trim()} title="Ask the CD to review and refine this prompt" style={{ ...footBtnStyle(isReviewingAI || !!running || !prompt.trim()), border: '1px solid #F59E0B', color: '#F59E0B', background: 'transparent' }}>
          {isReviewingAI ? 'Reviewing…' : 'Review by AI'}
        </button>
        <button
          onClick={() => void generate()}
          disabled={!canGenerate}
          title={problem || 'Generate (⌘↵)'}
          style={{ width: 170, flexShrink: 0, height: 34, borderRadius: 8, border: 'none', background: color, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'inherit', cursor: canGenerate ? 'pointer' : 'not-allowed', opacity: canGenerate || running ? 1 : 0.5, whiteSpace: 'nowrap' }}
        >
          {runLabel}
        </button>
      </div>
    </div>
  )
}

// ── Slot row and tile ────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>{children}</div>
    </div>
  )
}

function Tile({ label, asset, slot, slots, onSlotsChange, color, tag, onTag, onLength, wide, over, hint }: {
  label: string
  asset: SourceImage | null
  slot: VideoSlotKey
  slots: VideoSlots
  onSlotsChange: (s: VideoSlots) => void
  color: string
  tag?: string
  onTag?: (tag: string) => void
  onLength: (path: string, seconds: number) => void
  wide?: boolean
  /** Omni won't take it with the other slots (frames OR ingredients). */
  over?: boolean
  hint?: string
}) {
  const active = slots.active === slot
  const video = isVideoAsset(asset)
  const w = wide ? 112 : 64
  const remove = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (slot === 'first' || slot === 'last' || slot === 'source') onSlotsChange({ ...slots, [slot]: null, active: slot })
    else onSlotsChange({ ...slots, ingredients: slots.ingredients.filter((_, i) => i !== slot), active: slots.ingredients.length - 1 })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: w }}>
      <div
        onClick={() => onSlotsChange({ ...slots, active: slot })}
        title={asset ? `${asset.filename}${over ? ' — Omni takes frames or ingredients, not both' : ' — click, then a library item to replace it'}` : hint || 'Active slot: the next library click goes here'}
        style={{
          position: 'relative', width: w, height: wide ? 63 : 48, borderRadius: 5, overflow: 'hidden', cursor: 'pointer',
          border: over ? '1.5px solid #f87171' : asset ? `1.5px solid ${active ? color : 'var(--border-active)'}` : active ? `1.5px dashed ${color}` : '1.5px dashed var(--border-card)',
          background: !asset && active ? `${color}0D` : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {asset ? (video
          ? <video src={`${asset.path}#t=0.5`} muted playsInline preload="metadata"
              onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) onLength(asset.path, d) }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <img src={asset.path} alt={asset.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />)
          : <span style={{ fontSize: 14, color: active ? color : 'var(--text-dim)' }}>+</span>}
        {asset && (
          <button onClick={remove} title="Remove" style={{ position: 'absolute', top: 2, right: 2, width: 15, height: 15, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9, lineHeight: '15px', padding: 0, cursor: 'pointer' }}>×</button>
        )}
        {video && <span style={{ position: 'absolute', bottom: 1, left: 3, fontSize: 8, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>▶</span>}
      </div>
      {asset && tag && onTag ? (
        <button onClick={() => onTag(tag)} title={`${label}: put ${tag} into the prompt`} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: MONO, fontSize: 8, color, whiteSpace: 'nowrap', maxWidth: w, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tag}
        </button>
      ) : (
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: active ? color : 'var(--text-dim)' }}>{label}</span>
      )}
    </div>
  )
}

// ── Pills: the image tabs' Ratio/Res pill group ──────────────────────────────

function Pills({ label, options, labels, titles, value, onChange, disabled = [] }: {
  label: string
  options: readonly string[]
  labels?: Record<string, string>
  titles?: Record<string, string>
  value: string
  onChange: (v: string) => void
  disabled?: string[]
}) {
  return (
    <div style={{ ...pillBoxStyle, flexShrink: 0 }}>
      <span style={pillLabelStyle}>{label}</span>
      {options.map((o) => {
        const active = o === value
        const off = disabled.includes(o)
        return (
          <button
            key={o}
            onClick={() => !off && onChange(o)}
            title={off ? 'Not possible here' : titles?.[o]}
            style={{
              padding: '4px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', fontFamily: 'inherit',
              border: active ? '1px solid #10B981' : '1px solid transparent', background: active ? '#10B98120' : 'transparent',
              color: active ? '#10B981' : off ? 'var(--text-dim)' : 'var(--text-muted)', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.4 : 1,
              boxShadow: active ? '0 1px 3px rgba(16,185,129,0.3)' : 'none',
            }}
          >
            {labels?.[o] ?? o}
          </button>
        )
      })}
    </div>
  )
}

/** An option this situation takes from the video. */
function Fixed({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ ...pillBoxStyle, padding: '3px 8px', flexShrink: 0 }}>
      <span style={pillLabelStyle}>{label}</span>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '4px 0' }}>{text}</span>
    </div>
  )
}

function FilmIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
  )
}

const headerStyle: React.CSSProperties = {
  fontFamily: MONO, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em',
  color: 'var(--text-main)', minHeight: 40, display: 'flex', alignItems: 'center', flexShrink: 0,
}
const pillBoxStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 2, padding: 3, background: 'var(--pill-bg)', borderRadius: 6, border: '1px solid var(--pill-border)',
}
const pillLabelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '0 4px', whiteSpace: 'nowrap',
}
const menuRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 5,
  border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
}
const resetBtnStyle: React.CSSProperties = {
  height: 22, padding: '0 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)',
  color: '#EF4444', fontSize: 8, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 0,
}
function smallBtnStyle(color?: string): React.CSSProperties {
  return {
    height: 24, padding: '0 10px', borderRadius: 6, border: `1px solid ${color || 'var(--border-card)'}`, background: color ? `${color}14` : 'transparent',
    color: color || 'var(--text-muted)', fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', letterSpacing: '0.03em',
  }
}
function footBtnStyle(off: boolean): React.CSSProperties {
  return {
    height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'var(--bg-card-hover)', flexShrink: 0,
    color: off ? 'var(--text-dim)' : 'var(--text-main)', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
    cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.5 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap',
  }
}
