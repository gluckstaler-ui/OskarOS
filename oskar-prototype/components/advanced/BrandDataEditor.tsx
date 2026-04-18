'use client'

/**
 * BrandDataEditor — WP-B3
 *
 * Inline-editable view over a BrandData object. Each field shows the current
 * value (pulled from the selected vibe on mount / vibe change by the parent)
 * and overrides are ephemeral — parent clears them when the vibe changes.
 *
 * Shape is intentionally flat: businessName, fontHeading, fontBody, audience,
 * mood, colors (4 hex fields), voiceSample. Matches `BrandData`.
 */

import { useCallback } from 'react'
import type { BrandData } from '@/lib/brand-data'

interface BrandDataEditorProps {
  value: BrandData
  /** Baseline vibe-derived data — used to detect overrides and render "reset". */
  baseline: BrandData
  onChange: (next: BrandData) => void
  onResetToVibe: () => void
  disabled?: boolean
}

export function BrandDataEditor({
  value,
  baseline,
  onChange,
  onResetToVibe,
  disabled = false,
}: BrandDataEditorProps) {
  const patch = useCallback(
    (field: keyof BrandData, v: string | string[] | undefined) => {
      onChange({ ...value, [field]: v } as BrandData)
    },
    [onChange, value]
  )

  const setColorAt = useCallback(
    (idx: number, hex: string) => {
      const next = [...value.colors]
      next[idx] = hex
      // Trim trailing empties so the data block doesn't render "| | |" for blanks
      while (next.length && !next[next.length - 1]) next.pop()
      patch('colors', next)
    },
    [value.colors, patch]
  )

  const isOverridden = (field: keyof BrandData): boolean => {
    const a = value[field]
    const b = baseline[field]
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length !== b.length || a.some((x, i) => x !== b[i])
    }
    return a !== b
  }

  const anyOverridden =
    isOverridden('businessName') ||
    isOverridden('fontHeading') ||
    isOverridden('fontBody') ||
    isOverridden('audience') ||
    isOverridden('mood') ||
    isOverridden('colors') ||
    isOverridden('voiceSample')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}
        >
          Brand data
          {anyOverridden && (
            <span
              style={{
                marginLeft: 8,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#F59E0B',
                fontSize: 9,
                letterSpacing: 0.5,
              }}
            >
              Overridden
            </span>
          )}
        </div>
        {anyOverridden && (
          <button
            onClick={onResetToVibe}
            disabled={disabled}
            style={{
              padding: '4px 8px',
              fontSize: 10,
              borderRadius: 4,
              border: '1px solid var(--border-card)',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
            title="Reset all fields to the vibe's declared values"
          >
            Reset to vibe
          </button>
        )}
      </div>

      <Row label="Business" field="businessName">
        <TextInput
          value={value.businessName}
          onChange={(v) => patch('businessName', v)}
          overridden={isOverridden('businessName')}
          disabled={disabled}
        />
      </Row>

      <Row label="Primary Font" field="fontHeading">
        <TextInput
          value={value.fontHeading}
          onChange={(v) => patch('fontHeading', v)}
          overridden={isOverridden('fontHeading')}
          disabled={disabled}
          placeholder="e.g. Playfair Display"
        />
      </Row>

      <Row label="Secondary Font" field="fontBody">
        <TextInput
          value={value.fontBody}
          onChange={(v) => patch('fontBody', v)}
          overridden={isOverridden('fontBody')}
          disabled={disabled}
          placeholder="e.g. Inter"
        />
      </Row>

      <Row label="Target" field="audience">
        <TextInput
          value={value.audience}
          onChange={(v) => patch('audience', v)}
          overridden={isOverridden('audience')}
          disabled={disabled}
          placeholder="Who this is for"
        />
      </Row>

      <Row label="Mood" field="mood">
        <TextInput
          value={value.mood}
          onChange={(v) => patch('mood', v)}
          overridden={isOverridden('mood')}
          disabled={disabled}
          placeholder="3-5 adjectives, comma-separated"
        />
      </Row>

      <Row label="Colors" field="colors">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[0, 1, 2, 3].map((i) => (
            <ColorSwatch
              key={i}
              hex={value.colors[i] || ''}
              onChange={(hex) => setColorAt(i, hex)}
              disabled={disabled}
              overridden={isOverridden('colors')}
              label={['Primary', 'Secondary', 'Accent', 'Text'][i]}
            />
          ))}
        </div>
      </Row>

      <Row label="Voice sample" field="voiceSample">
        <TextInput
          value={value.voiceSample}
          onChange={(v) => patch('voiceSample', v)}
          overridden={isOverridden('voiceSample')}
          disabled={disabled}
          placeholder="A sentence in the brand voice"
        />
      </Row>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Row({
  label,
  field: _field,
  children,
}: {
  label: string
  field: keyof BrandData
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  overridden,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  overridden: boolean
  disabled: boolean
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '6px 8px',
        background: 'var(--bg-app)',
        border: overridden ? '1px solid #F59E0B' : '1px solid var(--border-card)',
        borderRadius: 5,
        color: 'var(--text-main)',
        fontSize: 12,
        fontFamily: 'inherit',
        outline: 'none',
      }}
    />
  )
}

function ColorSwatch({
  hex,
  onChange,
  disabled,
  overridden,
  label,
}: {
  hex: string
  onChange: (hex: string) => void
  disabled: boolean
  overridden: boolean
  label: string
}) {
  const safe = /^#[0-9A-Fa-f]{6}$/.test(hex)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        width: 72,
      }}
      title={`${label}: ${hex || '(empty)'}`}
    >
      <div
        style={{
          width: '100%',
          height: 28,
          borderRadius: 5,
          background: safe ? hex : 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05), rgba(255,255,255,0.05) 4px, transparent 4px, transparent 8px)',
          border: overridden ? '1px solid #F59E0B' : '1px solid var(--border-card)',
        }}
      />
      <input
        type="text"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#RRGGBB"
        disabled={disabled}
        style={{
          width: '100%',
          padding: '3px 4px',
          background: 'var(--bg-app)',
          border: '1px solid var(--border-card)',
          borderRadius: 4,
          color: 'var(--text-main)',
          fontSize: 9,
          textAlign: 'center',
          fontFamily: 'monospace',
          outline: 'none',
        }}
      />
    </div>
  )
}
