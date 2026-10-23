// ============================================================================
// video-parts.ts — one prompt, several generations (VIDEO tabs, 2026-10-23).
//
// Omni renders 3-10 s per generation. A longer video is made in passes of
// 10 s: part 1 is generated, every further part extends the video before it
// (continuing its stored generation, so nothing is uploaded again). The user
// keeps ONE prompt — so Review by AI can work on all of it — and marks where
// a part starts with a cut line:
//
//   ✂ PART 2 · 10–20 s
//
// A line starting with ✂ (or [CUT]) is a cut; only the marker itself
// ("✂ PART 2 · 10–20 s") is the cut — text typed after it on the same line
// belongs to the new part. Text before the first cut is part 1. Pure module:
// used by the workshop (parts, hints) and the run loop.
// ============================================================================

export const PART_SECONDS = 10
/** Lengths the VIDEO tabs offer; above 10 s each part is 10 s. */
export const VIDEO_LENGTHS = [5, 8, 10, 20, 30] as const

const CUT_LINE = /^[ \t]*(?:✂|\[cut\])(?:[ \t]*PART[ \t]*\d+)?(?:[ \t]*·?[ \t]*\d+(?:\.\d+)?[ \t]*[–-][ \t]*\d+(?:\.\d+)?[ \t]*s\b)?[ \t]*/gim
/** The placeholder a new part starts with — alone it is no content. */
const BARE_EXTEND = /(^|\n)[ \t]*extend this video:?[ \t]*$/i

/** Seconds of each generation for a total length. */
export function partSeconds(total: number): number[] {
  if (total <= PART_SECONDS) return [total]
  return Array.from({ length: Math.ceil(total / PART_SECONDS) }, (_, i) => Math.min(PART_SECONDS, total - i * PART_SECONDS))
}

export function cutLine(index: number, offset = 0): string {
  const from = offset + (index - 1) * PART_SECONDS
  return `✂ PART ${index} · ${from}–${from + PART_SECONDS} s`
}

/** The prompt split at the cut lines, each part trimmed (a bare "Extend this video:" left over is dropped). */
export function splitParts(prompt: string): string[] {
  return prompt.split(CUT_LINE).map((p) => {
    const t = p.trim()
    const rest = t.replace(BARE_EXTEND, '').trim()
    return rest && rest !== t ? rest : t
  })
}

export function countCuts(prompt: string): number {
  return (prompt.match(CUT_LINE) || []).length
}

/** Adds the cut lines a length needs (at the end, ready to fill in). */
export function addMissingCuts(prompt: string, parts: number, offset = 0): string {
  let out = prompt.replace(/\s+$/, '')
  for (let i = countCuts(prompt) + 2; i <= parts; i++) {
    out += `${out ? '\n\n' : ''}${cutLine(i, offset)}\nExtend this video: `
  }
  return out
}

/** Rewrites every cut line to its part number and time span. */
export function renumberCuts(prompt: string, offset = 0): string {
  let n = 1
  // Text typed on the marker's line moves to the next line.
  return prompt.replace(CUT_LINE, (m: string, at: number, all: string) => {
    const next = all[at + m.length]
    return cutLine(++n, offset) + (next !== undefined && next !== '\n' ? '\n' : '')
  })
}

/** Removes the cut lines, keeping the text. */
export function removeCuts(prompt: string): string {
  return splitParts(prompt).filter(Boolean).join('\n\n')
}

/**
 * Why the prompt doesn't fit the chosen length, or null.
 * `parts` = how many generations the length needs.
 */
export function partsProblem(prompt: string, parts: number): string | null {
  const cuts = countCuts(prompt)
  if (parts === 1 && cuts > 0) return `The prompt has ${cuts + 1} parts (✂) but the length is one generation. Choose a longer length or remove the cuts.`
  if (parts > 1 && cuts !== parts - 1) return `${parts * PART_SECONDS} s = ${parts} parts of ${PART_SECONDS} s: the prompt needs ${parts - 1} ✂ cut${parts > 2 ? 's' : ''}, it has ${cuts}.`
  const empty = splitParts(prompt).findIndex((p) => !p || /^extend this video:?$/i.test(p))
  if (parts > 1 && empty >= 0) return `Part ${empty + 1} is empty.`
  return null
}

/**
 * The prompt Omni gets for one part. Parts after the first continue the video,
 * so they start with "Extend this video:", and timecodes written for the whole
 * video ([12-15s] in part 2) are moved to the part's own clock ([2-5s]).
 */
export function partPrompt(part: string, index: number, extendsSource = false): string {
  // Vid → Vid extend: every part, the first too, continues a video.
  if (index === 0 && !extendsSource) return part
  const offset = index * PART_SECONDS
  const fmt = (n: number) => String(Math.round(n * 10) / 10)
  let text = part.replace(/\[(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s\]/g, (m, a, b) => {
    const from = Number(a), to = Number(b)
    return from >= offset && to <= offset + PART_SECONDS ? `[${fmt(from - offset)}-${fmt(to - offset)}s]` : m
  })
  if (!/^\s*extend this video/i.test(text)) text = `Extend this video: ${text}`
  return text
}
