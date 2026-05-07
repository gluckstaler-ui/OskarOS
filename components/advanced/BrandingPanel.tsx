'use client'

/**
 * BrandingPanel — WP-B3
 *
 * The Branding tab's body. Layout (top-to-bottom):
 *   1. Vibe selector dropdown
 *   2. Brand-data editor (auto-populated from the selected vibe; overrides
 *      are ephemeral and cleared when the vibe changes)
 *   3. Optional image-reference picker (pulls from session images list)
 *   4. Deliverable picker (7-tile grid)
 *   5. Generate button + inline result preview
 *
 * The heavy lifting (prompt assembly, Nano call, catalog) happens in
 * `/api/brand/generate`. This component is orchestration + display.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { brandDataFromVibe, type BrandData } from '@/lib/brand-data'
import { BRAND_DELIVERABLES, type DeliverableId } from '@/lib/brand-deliverables'
import { BrandDataEditor } from './BrandDataEditor'
import { DeliverablePicker } from './DeliverablePicker'
import type { VibeData } from '@/lib/types'
import {
  emitCDProofreadAdvisory,
  emitCDProofreadRewritten,
  emitCDVerdict,
} from '@/lib/session-events'

interface BrandingPanelProps {
  sessionId: string
  /** Currently-loaded vibes from session state. */
  vibes: VibeData[]
  /** Session business name (falls back to vibe name if empty). */
  businessName: string
}

interface BrandGenerateResult {
  success: boolean
  filename?: string
  url?: string
  deliverable?: DeliverableId
  aspectRatio?: string
  prompt?: string
  error?: string
}

export function BrandingPanel({
  sessionId,
  vibes,
  businessName,
}: BrandingPanelProps) {
  // Which vibe the user is branding for
  const [selectedVibeId, setSelectedVibeId] = useState<string | null>(
    vibes[0]?.id ?? null
  )
  const selectedVibe = useMemo(
    () => vibes.find((v) => v.id === selectedVibeId) ?? null,
    [vibes, selectedVibeId]
  )

  // The vibe's declared brand data — resets whenever vibe changes
  const baseline: BrandData = useMemo(
    () =>
      selectedVibe
        ? brandDataFromVibe(selectedVibe, businessName)
        : {
            businessName: '',
            fontHeading: '',
            fontBody: '',
            audience: '',
            mood: '',
            colors: [],
            voiceSample: '',
          },
    [selectedVibe, businessName]
  )

  // Overridable working copy — cleared whenever vibe changes
  const [brand, setBrand] = useState<BrandData>(baseline)
  useEffect(() => {
    // Vibe changed → reset overrides to the new vibe's baseline
    setBrand(baseline)
    setResult(null)
    setError(null)
  }, [selectedVibeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Optional reference image
  const [imageRef, setImageRef] = useState<string>('')
  const [sessionImages, setSessionImages] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/images`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          setSessionImages((data.images || []).map((i: { filename: string }) => i.filename))
        }
      } catch {
        // Non-fatal — reference image is optional
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Deliverable selection
  const [deliverableId, setDeliverableId] = useState<DeliverableId | null>(null)

  // Generate flow
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState<BrandGenerateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = useCallback(async () => {
    if (!selectedVibeId || !deliverableId) return
    setIsGenerating(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/brand/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          vibeKey: vibeKeyFor(selectedVibe, selectedVibeId),
          deliverableId,
          brandOverrides: brand,
          imageRef: imageRef || undefined,
        }),
      })
      const data = (await res.json()) as BrandGenerateResult & {
        proofread?: { severity: 'pass' | 'advisory' | 'rewritten' | 'error'; note: string }
        verdict?: { verdict: '✓' | '≈' | '✗' | 'error'; note: string }
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setResult(data)

      // ── WP-15 rule 10: brand sub-tab emits the same cd.* snackbars ──
      if (sessionId && data.proofread) {
        if (data.proofread.severity === 'rewritten') {
          emitCDProofreadRewritten(sessionId, {
            note: data.proofread.note,
            oldPrompt: '(brand prompt — assembled by template)',
            newPrompt: '(see CD rewrite log)',
            mode: 'brand',
          })
        } else if ((data.proofread.severity === 'advisory' || data.proofread.severity === 'error') && data.proofread.note) {
          emitCDProofreadAdvisory(sessionId, {
            note: data.proofread.severity === 'error' ? `Proofread failed: ${data.proofread.note}` : data.proofread.note,
            mode: 'brand',
            filename: data.filename,
          })
        }
      }
      if (sessionId && data.verdict) {
        emitCDVerdict(sessionId, {
          verdict: data.verdict.verdict === 'error' ? '✗' : data.verdict.verdict,
          note: data.verdict.verdict === 'error' ? `Verdict failed: ${data.verdict.note}` : data.verdict.note,
          filename: data.filename,
          mode: 'brand',
        })
      }
    } catch (err) {
      setError(`Generation failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setIsGenerating(false)
    }
  }, [selectedVibeId, selectedVibe, deliverableId, brand, imageRef, sessionId])

  const canGenerate =
    !!selectedVibeId &&
    !!deliverableId &&
    !isGenerating &&
    !!brand.businessName.trim() &&
    !!brand.fontHeading.trim() &&
    brand.colors.filter(Boolean).length >= 2 &&
    !!brand.mood.trim()

  // Empty state — no vibes yet
  if (!vibes || vibes.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          color: 'var(--text-dim)',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>🎨</div>
        No vibes yet — build vibes first to generate brand assets from their data.
      </div>
    )
  }

  return (
    <div
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        overflow: 'auto',
        height: '100%',
      }}
    >
      {/* Vibe picker */}
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            marginBottom: 6,
          }}
        >
          Vibe
        </div>
        <select
          value={selectedVibeId || ''}
          onChange={(e) => setSelectedVibeId(e.target.value || null)}
          disabled={isGenerating}
          style={{
            width: '100%',
            maxWidth: 420,
            padding: '8px 10px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border-card)',
            borderRadius: 6,
            color: 'var(--text-main)',
            fontSize: 12,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        >
          {vibes.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      {/* Brand-data editor */}
      <BrandDataEditor
        value={brand}
        baseline={baseline}
        onChange={setBrand}
        onResetToVibe={() => setBrand(baseline)}
        disabled={isGenerating}
      />

      {/* Reference image (optional) */}
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            marginBottom: 6,
          }}
        >
          Reference image (optional)
        </div>
        <select
          value={imageRef}
          onChange={(e) => setImageRef(e.target.value)}
          disabled={isGenerating}
          style={{
            width: '100%',
            maxWidth: 420,
            padding: '8px 10px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border-card)',
            borderRadius: 6,
            color: 'var(--text-main)',
            fontSize: 12,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        >
          <option value="">— No reference image —</option>
          {sessionImages?.map((filename) => (
            <option key={filename} value={filename}>
              {filename}
            </option>
          ))}
        </select>
      </div>

      {/* Deliverable picker */}
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            marginBottom: 8,
          }}
        >
          Deliverable
        </div>
        <DeliverablePicker
          selectedId={deliverableId}
          onSelect={setDeliverableId}
          disabled={isGenerating}
        />
      </div>

      {/* Generate button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            background: canGenerate ? '#10B981' : 'var(--hover-overlay)',
            color: canGenerate ? '#fff' : 'var(--text-dim)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            cursor: canGenerate ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
        >
          {isGenerating ? 'Generating…' : 'Generate'}
        </button>
        {!canGenerate && !isGenerating && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            {!deliverableId
              ? 'Pick a deliverable.'
              : 'Brand data incomplete — fill in business, primary font, 2+ colors, and mood.'}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#F87171',
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      {/* Result */}
      {result && result.success && result.url && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-main)' }}>{result.filename}</strong>
              {' · '}
              {result.deliverable} · {result.aspectRatio}
            </div>
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 10,
                color: '#3B82F6',
                textDecoration: 'none',
                padding: '4px 8px',
                border: '1px solid #3B82F6',
                borderRadius: 4,
              }}
            >
              Open full size ↗
            </a>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.url}
            alt={result.filename}
            style={{
              width: '100%',
              maxHeight: 600,
              objectFit: 'contain',
              borderRadius: 6,
              background: '#000',
            }}
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a `vibeKey` from VibeData for the API call.
 * VibeData.id is the most stable handle; we try to extract `vibe-N` from it,
 * and fall back to the numeric index in the vibes array if needed.
 */
function vibeKeyFor(vibe: VibeData | null, fallback: string): string {
  if (vibe?.id) {
    const m = vibe.id.match(/vibe-\d+/i)
    if (m) return m[0].toLowerCase()
    return vibe.id
  }
  return fallback
}
