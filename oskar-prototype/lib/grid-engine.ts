/**
 * Grid Engine — WP-5 (built 2026-04-17)
 *
 * Transforms a Layout preset's `GridConfig` plus the staged-image array into
 * a concrete CSS grid spec the renderer can consume directly.
 *
 * Why this exists: until 2026-04-17, `BentoPreview` ignored every layout
 * preset's `grid` metadata and used a single hardcoded `getGridLayout(count)`
 * that produced the same shape for every preset. The audit
 * (`WP-AUDIT.md` §WP-5) flagged it as the textbook Potemkin case: rich data
 * structure in `image-presets.ts`, no consumer.
 *
 * Two cell-declaration modes are supported:
 *   1. STATIC — `cells[]` is non-empty. The engine maps each declared cell
 *      directly to the staged slot at its `slotIndex`. This is how Bento
 *      2×2, Triptych, Side-by-Side, Magazine work.
 *   2. DYNAMIC — `cells[]` is empty AND `allowsExpansion: true`. The engine
 *      generates cells on the fly based on `filled` slot count and the
 *      preset label. This is how Filmstrip, Editorial Stack, Portfolio Grid,
 *      Vertical Stack, Feature+Detail, Detail Inset work.
 *
 * Returned `areas` is one entry per ORIGINAL slot in the staging order
 * (so renderer can iterate `staging.slots.map((img, i) => areas[i])` even if
 * the underlying grid has different row/col arrangement).
 */

import type { GridConfig, LayoutPreset } from './image-presets'

export interface GridArea {
  col: string
  row: string
  /** True for the hero/feature cell (gets visual emphasis). */
  isHero?: boolean
}

export interface GridSpec {
  columns: string
  rows: string
  /** One entry per slot in document order. `null` = slot not visible in this layout. */
  areas: (GridArea | null)[]
}

/**
 * Compute a grid spec from a layout preset + the slot array.
 * `slots` carries one entry per UI slot (image | null); the engine looks at
 * `slots.length` and the count of non-null entries to drive dynamic layouts.
 */
export function computeGridSpec(
  preset: LayoutPreset | null,
  slots: ReadonlyArray<unknown>
): GridSpec {
  const totalSlots = slots.length
  const filled = slots.filter(Boolean).length

  // No preset selected → fall back to the legacy slot-count algorithm so
  // staging still renders something useful before the user picks a preset.
  if (!preset) {
    return fallbackGrid(totalSlots, filled)
  }

  const { grid } = preset

  // STATIC case — cells[] declared, just trust the preset.
  if (grid.cells.length > 0) {
    return computeStaticGrid(grid, totalSlots)
  }

  // DYNAMIC case — engine computes from preset label + slot count.
  return computeDynamicGrid(preset.label, grid, totalSlots, filled)
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC: cells[] is declared. Map slotIndex → grid area.
// ─────────────────────────────────────────────────────────────────────────────

function computeStaticGrid(grid: GridConfig, totalSlots: number): GridSpec {
  const areas: (GridArea | null)[] = Array.from({ length: totalSlots }, () => null)
  for (const cell of grid.cells) {
    if (cell.slotIndex < 0 || cell.slotIndex >= totalSlots) continue
    areas[cell.slotIndex] = {
      col: cell.gridColumn || '1',
      row: cell.gridRow || '1',
      isHero: cell.role === 'hero',
    }
  }
  return {
    columns: grid.columns,
    rows: grid.rows,
    areas,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC: per-preset label switch. Each branch returns a grid sized for
// the current slot count.
// ─────────────────────────────────────────────────────────────────────────────

function computeDynamicGrid(
  label: string,
  grid: GridConfig,
  totalSlots: number,
  filled: number
): GridSpec {
  const n = Math.max(1, totalSlots)

  switch (label) {
    case 'Filmstrip': {
      // N panels in one row.
      return {
        columns: `repeat(${n}, 1fr)`,
        rows: '1fr',
        areas: Array.from({ length: totalSlots }, (_, i) => ({
          col: String(i + 1),
          row: '1',
          isHero: false,
        })),
      }
    }

    case 'Portfolio Grid': {
      // Square grid: ceil(sqrt(N)) columns, ceil(N / cols) rows.
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
      const rows = Math.max(1, Math.ceil(n / cols))
      const areas = Array.from({ length: totalSlots }, (_, i) => ({
        col: String((i % cols) + 1),
        row: String(Math.floor(i / cols) + 1),
        isHero: false,
      }))
      return {
        columns: `repeat(${cols}, 1fr)`,
        rows: `repeat(${rows}, 1fr)`,
        areas,
      }
    }

    case 'Vertical Stack': {
      // N rows, one column.
      return {
        columns: '1fr',
        rows: `repeat(${n}, 1fr)`,
        areas: Array.from({ length: totalSlots }, (_, i) => ({
          col: '1',
          row: String(i + 1),
          isHero: false,
        })),
      }
    }

    case 'Editorial Stack': {
      // Hero (slot 0) full-width top; remaining slots share bottom row equally.
      const remaining = Math.max(1, totalSlots - 1)
      const areas: (GridArea | null)[] = Array.from(
        { length: totalSlots },
        () => null
      )
      areas[0] = { col: '1 / -1', row: '1', isHero: true }
      for (let i = 1; i < totalSlots; i++) {
        areas[i] = { col: String(i), row: '2' }
      }
      return {
        columns: `repeat(${remaining}, 1fr)`,
        rows: '2fr 1fr',
        areas,
      }
    }

    case 'Feature + Detail': {
      // Slot 0 = wide feature top, remaining 2-4 slots evenly under it.
      const remaining = Math.max(1, totalSlots - 1)
      const areas: (GridArea | null)[] = Array.from(
        { length: totalSlots },
        () => null
      )
      areas[0] = { col: '1 / -1', row: '1', isHero: true }
      for (let i = 1; i < totalSlots; i++) {
        areas[i] = { col: String(i), row: '2' }
      }
      return {
        columns: `repeat(${remaining}, 1fr)`,
        rows: '3fr 1fr',
        areas,
      }
    }

    case 'Detail Inset': {
      // Hero spans all rows on the left; insets stack on the right column.
      const insets = Math.max(1, totalSlots - 1)
      const areas: (GridArea | null)[] = Array.from(
        { length: totalSlots },
        () => null
      )
      areas[0] = { col: '1', row: `1 / ${insets + 1}`, isHero: true }
      for (let i = 1; i < totalSlots; i++) {
        areas[i] = { col: '2', row: String(i) }
      }
      return {
        columns: '3fr 1fr',
        rows: `repeat(${insets}, 1fr)`,
        areas,
      }
    }

    default: {
      // Unknown dynamic preset — degrade to fallback so we never render empty.
      return fallbackGrid(totalSlots, filled)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback when there's no preset OR a dynamic preset isn't known. Mirrors
// the legacy `getGridLayout` shape but stays in this module so callers don't
// have a third codepath to think about.
// ─────────────────────────────────────────────────────────────────────────────

function fallbackGrid(totalSlots: number, _filled: number): GridSpec {
  if (totalSlots <= 1) {
    return {
      columns: '1fr',
      rows: '1fr',
      areas: [{ col: '1', row: '1', isHero: true }],
    }
  }
  if (totalSlots === 2) {
    return {
      columns: '1fr 1fr',
      rows: '1fr',
      areas: [
        { col: '1', row: '1', isHero: true },
        { col: '2', row: '1' },
      ],
    }
  }
  if (totalSlots === 3) {
    return {
      columns: '2fr 1fr',
      rows: '1fr 1fr',
      areas: [
        { col: '1', row: '1 / 3', isHero: true },
        { col: '2', row: '1' },
        { col: '2', row: '2' },
      ],
    }
  }
  // 4+: hero left full-height, remaining stacked on right.
  const right = totalSlots - 1
  const areas: (GridArea | null)[] = [
    { col: '1', row: `1 / ${right + 1}`, isHero: true },
  ]
  for (let i = 1; i < totalSlots; i++) {
    areas.push({ col: '2', row: String(i) })
  }
  return {
    columns: '2fr 1fr',
    rows: `repeat(${right}, 1fr)`,
    areas,
  }
}
