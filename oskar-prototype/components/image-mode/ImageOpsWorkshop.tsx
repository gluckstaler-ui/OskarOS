'use client'

/**
 * ImageOpsWorkshop — the Z3+Z4 surface for IMAGE-mode → image-ops tab
 * (WP-IMG-1, 2026-05-06).
 *
 * Replaces the regular Zone 3 (presets/staging) + Zone 4 (prompt editor) when
 * `activeTab === 'image-ops'`. Renders as a single bento card spanning the
 * combined Z3+Z4 area at a FIXED 320 px content height — switching sub-tabs
 * never reflows the body's outer dimensions (mockup invariant).
 *
 * Layout (per spec §14.1):
 *
 *   ┌──────────────────────────────────────────────┐  ← 42 px ops-bar
 *   │ [crop][slice][resize][format-convert]   ▒▒▒  │
 *   ├──────────────────────────────────────────────┤
 *   │                                              │  ← 220 px body
 *   │   Body left column     │   Body right column │
 *   │   (op-specific)        │   (op-specific)     │
 *   │                                              │
 *   ├──────────────────────────────────────────────┤
 *   │ [READY APPROVED HERO B-ROLL REDO TRASH]  [Generate] │  ← 58 px footer
 *   └──────────────────────────────────────────────┘
 *
 * The ops-bar's right slot holds aspect chips (crop) / aspect lock chips
 * (resize) / muted "preserved from source" text (format-convert) / nothing
 * (slice). Per-op behavior dispatched inside the bar component.
 *
 * Per-op bodies (WP-IMG-2..5) render inside `body-slot`. Each is required to
 * fit in 220 px tall (the LayoutInvariant constraint).
 */

import { useCallback, useState, useEffect } from 'react'
import type { SourceImage } from '@/lib/types'
import {
  type ImageOpsState,
  type ImageOpsTool,
  type ImageOpsTagChip,
  TAG_CHIP_ORDER,
  TAG_CHIP_COLORS,
} from './types'
import { CropBody, CropOpsBarRight } from './CropTool'
import { SliceBody } from './SliceTool'
import { ResizeBody, ResizeOpsBarRight } from './ResizeTool'
import { FormatBody } from './FormatTool'
import { runImageOpsCall, type RunOpResult } from './run-op'

// ── Sub-tab spec ─────────────────────────────────────────────────────────────
const TOOLS: { id: ImageOpsTool; label: string; disabled?: boolean }[] = [
  { id: 'crop', label: 'CROP' },
  { id: 'slice', label: 'SLICE' },
  { id: 'resize', label: 'RESIZE' },
  { id: 'format-convert', label: 'FORMAT' }, // WP-IMG-5 — landed 2026-05-06
]

const TOOL_COLOR: Record<ImageOpsTool, string> = {
  crop: '#22C55E',          // green (matches marquee)
  slice: '#06B6D4',         // cyan (grid)
  resize: '#F59E0B',         // amber
  'format-convert': '#8B5CF6', // violet — disabled in v1; visible so layout doesn't shift
}

// ── Props ────────────────────────────────────────────────────────────────────
export interface ImageOpsWorkshopProps {
  selectedImage: SourceImage | null
  /** Image-native dimensions (from the displayed `<img>`). Null until the img loads. */
  imageNaturalSize: { naturalW: number; naturalH: number } | null

  state: ImageOpsState
  onStateChange: (next: ImageOpsState) => void

  sessionId: string
  /** Called after a successful op so the parent can refresh the asset list. */
  onOpComplete: (newFilenames: string[]) => void
}

// ─────────────────────────────────────────────────────────────────────────────

export function ImageOpsWorkshop({
  selectedImage,
  imageNaturalSize,
  state,
  onStateChange,
  sessionId,
  onOpComplete,
}: ImageOpsWorkshopProps) {
  const [running, setRunning] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [statusKind, setStatusKind] = useState<'success' | 'error' | null>(null)

  const patch = useCallback(
    (p: Partial<ImageOpsState>) => onStateChange({ ...state, ...p }),
    [onStateChange, state],
  )

  const setTool = useCallback((tool: ImageOpsTool) => patch({ tool }), [patch])

  // Clear `lastOutput` when the user switches tool — a CROP preview shouldn't
  // leak into a SLICE view. The cache repopulates after the next Generate.
  useEffect(() => {
    if (state.lastOutput && state.lastOutput.tool !== state.tool) {
      patch({ lastOutput: null })
    }
  }, [state.tool, state.lastOutput, patch])

  const handleGenerate = useCallback(async () => {
    if (!selectedImage || running) return

    setRunning(true)
    setStatusMsg(null)
    setStatusKind(null)

    const result: RunOpResult = await runImageOpsCall({
      sessionId,
      filename: selectedImage.filename,
      state,
      imageNaturalSize,
    })

    if (result.ok) {
      // ── WP-IMG-8 (2026-05-06): snackbar on success ──
      const ops = result.outputs
      const opName = state.tool
      const text =
        ops.length === 1
          ? `${opName} complete — ${ops[0].filename}`
          : ops.length > 4
            ? `${opName} → ${ops.length} files`
            : `${opName} → ${ops.map((o) => o.filename).join(', ')}`
      void emitSnackbar(sessionId, text, 'success')
      setStatusKind('success')
      setStatusMsg(text)
      // Cache the most recent output URL for the preview pane (right half
      // of Zone 2 when showPreview === true). For multi-output ops (slice),
      // we show the first tile — full grid is in the asset library.
      patch({
        lastOutput: {
          tool: state.tool,
          url: `/${sessionId}/${ops[0].filename}`,
        },
      })
      onOpComplete(ops.map((o) => o.filename))
    } else {
      // ── WP-IMG-8 failure path: ERROR pill, sticky (so the user can read
      // the error before it disappears). Spec also calls for "Show details"
      // action — same plumbing-not-yet-built note as above.
      const text = `${state.tool} failed — ${result.error}`
      void emitSnackbar(sessionId, text, 'error')
      setStatusKind('error')
      setStatusMsg(text)
    }
    setRunning(false)
  }, [selectedImage, running, state, imageNaturalSize, sessionId, onOpComplete])

  // ── Render ────────────────────────────────────────────────────────────────
  const body = (() => {
    if (!selectedImage) {
      return (
        <div style={emptyMsgStyle}>
          Select an image from the library on the left to start a workshop session.
        </div>
      )
    }
    if (!imageNaturalSize) {
      return <div style={emptyMsgStyle}>Loading source dimensions…</div>
    }
    switch (state.tool) {
      case 'crop':
        return <CropBody state={state} patch={patch} natural={imageNaturalSize} sourceFilename={selectedImage.filename} />
      case 'slice':
        return <SliceBody state={state} patch={patch} natural={imageNaturalSize} sourceFilename={selectedImage.filename} />
      case 'resize':
        return <ResizeBody state={state} patch={patch} natural={imageNaturalSize} sourceFilename={selectedImage.filename} />
      case 'format-convert':
        return (
          <FormatBody
            state={state}
            patch={patch}
            natural={imageNaturalSize}
            sourceFilename={selectedImage.filename}
          />
        )
      default:
        return null
    }
  })()

  const opsBarRight = (() => {
    switch (state.tool) {
      case 'crop':
        return <CropOpsBarRight state={state} patch={patch} natural={imageNaturalSize} />
      case 'resize':
        return <ResizeOpsBarRight state={state} patch={patch} natural={imageNaturalSize} />
      case 'slice':
        return null
      case 'format-convert':
      default:
        return (
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            preserved from source
          </span>
        )
    }
  })()

  return (
    <div
      className="bento-card"
      style={{
        // The card FILLS its grid row (Ralph 2026-05-06). The body sub-zone
        // is still 220px so switching CROP/SLICE/RESIZE/FORMAT never reflows
        // the ops-stage — but the card itself flexes. Layout:
        //   42px  ops-bar   (fixed)
        //   220px body      (fixed — no-reflow invariant)
        //   1fr   filler    (eats leftover space)
        //   58px  footer    (fixed)
        display: 'grid',
        gridTemplateRows: '42px 220px 1fr 58px',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* ── 42px OPS-BAR ── */}
      <div
        style={{
          gridRow: 1,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 12,
          borderBottom: '1px solid var(--border-card)',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 3,
            background: 'var(--pill-bg)',
            borderRadius: 6,
            border: '1px solid var(--pill-border)',
          }}
        >
          {TOOLS.map((t) => {
            const active = t.id === state.tool
            const color = TOOL_COLOR[t.id]
            return (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: 'none',
                  background: active ? color : 'transparent',
                  color: active ? '#fff' : 'var(--text-muted)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                  textTransform: 'uppercase',
                  fontFamily: 'inherit',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {opsBarRight}
        </div>

        {/* Preview-pane toggle (Ralph 2026-05-06).
            Right slot of the ops-bar. When ON, Zone 2 splits into input |
            output halves so the user can compare. Works for ALL tools, not
            just FORMAT — useful for crop/resize/slice too once they've
            generated a result. */}
        <PreviewToggleButton
          on={state.showPreview}
          onToggle={() => patch({ showPreview: !state.showPreview })}
        />
      </div>

      {/* ── 220px BODY ── */}
      <div
        style={{
          gridRow: 2,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          padding: '14px 16px',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {body}
      </div>

      {/* ── 58px FOOTER ── */}
      <div
        style={{
          gridRow: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          borderTop: '1px solid var(--border-card)',
          minHeight: 0,
        }}
      >
        {/* Tag chip row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: 3,
            background: 'var(--pill-bg)',
            borderRadius: 6,
            border: '1px solid var(--pill-border)',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {TAG_CHIP_ORDER.map((chip) => (
            <TagChipButton
              key={chip}
              chip={chip}
              active={chip === state.tagChip}
              onClick={() => patch({ tagChip: chip })}
            />
          ))}
        </div>

        {/* Status text + Generate button */}
        {statusMsg && (
          <span
            style={{
              fontSize: 10,
              color: statusKind === 'error' ? '#f87171' : '#86efac',
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={statusMsg}
          >
            {statusMsg}
          </span>
        )}

        <button
          onClick={handleGenerate}
          disabled={!selectedImage || running}
          style={{
            padding: '7px 18px',
            borderRadius: 6,
            border: '1px solid rgba(34,197,94,0.55)',
            background:
              !selectedImage || running
                ? 'rgba(34,197,94,0.10)'
                : 'rgba(34,197,94,0.18)',
            color: '#22C55E',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: !selectedImage || running ? 'not-allowed' : 'pointer',
            opacity: !selectedImage || running ? 0.55 : 1,
            fontFamily: 'inherit',
            transition: 'all 0.12s',
          }}
        >
          {running ? 'Running…' : 'Generate'}
        </button>
      </div>
    </div>
  )
}

// ── Tag chip ────────────────────────────────────────────────────────────────

function TagChipButton({
  chip,
  active,
  onClick,
}: {
  chip: ImageOpsTagChip
  active: boolean
  onClick: () => void
}) {
  const color = TAG_CHIP_COLORS[chip]
  return (
    <button
      onClick={onClick}
      title={`Tag new output as ${chip}`}
      style={{
        padding: '3px 7px',
        borderRadius: 4,
        border: 'none',
        background: active ? color : 'transparent',
        color: active ? '#fff' : 'var(--text-muted)',
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'all 0.12s',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {chip}
    </button>
  )
}

// ── Preview pane toggle ──────────────────────────────────────────────────

/**
 * On/off toggle for the Zone 2 input | output split (Ralph 2026-05-06).
 * Lives at the right edge of the ops-bar — same row as CROP/SLICE/RESIZE/
 * FORMAT — so the user can flip it from any tool's context. Visual: small
 * pill button with a 2-pane glyph; tinted brand color when active.
 */
function PreviewToggleButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={on ? 'Hide preview pane' : 'Show preview pane (input | output)'}
      aria-pressed={on}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        border: `1px solid ${on ? 'rgba(34,197,94,0.55)' : 'var(--border-card)'}`,
        background: on ? 'rgba(34,197,94,0.18)' : 'transparent',
        color: on ? '#22C55E' : 'var(--text-muted)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.12s',
        flexShrink: 0,
      }}
    >
      {/* 2-pane glyph: two side-by-side rectangles, second is filled when ON */}
      <svg
        width="14"
        height="11"
        viewBox="0 0 14 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <rect x="0.75" y="0.75" width="5.5" height="9.5" rx="1" />
        <rect
          x="7.75"
          y="0.75"
          width="5.5"
          height="9.5"
          rx="1"
          fill={on ? 'currentColor' : 'none'}
          fillOpacity={on ? 0.35 : 0}
        />
      </svg>
      <span>Preview</span>
    </button>
  )
}

// ── WP-IMG-8 snackbar emitter ────────────────────────────────────────────
/**
 * Fire-and-forget POST to /api/mcp/snackbar. The route publishes a
 * `cd_snackbar` event; SnackbarProvider renders it. Severity drives the
 * auto-dismiss + color (success=green/auto, error=red/sticky).
 *
 * Errors here are caught and discarded — the inline status pill is the
 * fallback signal so the user still sees something even if the snackbar
 * route is offline.
 */
async function emitSnackbar(
  sessionId: string,
  text: string,
  severity: 'success' | 'error' | 'info' | 'warning',
): Promise<void> {
  try {
    await fetch('/api/mcp/snackbar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text, severity }),
    })
  } catch {
    // Snackbar is best-effort — never block the op-complete flow.
  }
}

// ── Shared style ────────────────────────────────────────────────────────────

const emptyMsgStyle: React.CSSProperties = {
  gridColumn: '1 / span 2',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  fontSize: 11,
  color: 'var(--text-dim)',
  fontStyle: 'italic',
  padding: 20,
  textAlign: 'center',
}
