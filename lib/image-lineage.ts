/**
 * image-lineage.ts — WP-1C: Generation lineage traversal.
 *
 * Walks the parent/child chain of SourceImages to build the version sidebar.
 * Supports:
 *   - Parent chain walking (original → v1 → v2 → v3)
 *   - Children lookup (find everything derived from this image)
 *   - Branch detection (one parent, multiple children)
 *   - Compose lineage (multiple parents merge into one result)
 *
 * Pure data — no React, no side effects.
 */

import type { SourceImage } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * A node in the version tree.
 *   - selected: the image the user is currently viewing
 *   - root: the ultimate origin (uploaded or pure-generated image)
 *   - ancestors: walking from root → selected (exclusive of selected)
 *   - descendants: everything directly or transitively derived from selected
 *   - siblings: images sharing the same parent as selected (excluding selected)
 */
export interface LineageGroup {
  root: SourceImage
  ancestors: SourceImage[]
  selected: SourceImage
  descendants: SourceImage[]
  siblings: SourceImage[]
}

// ============================================================================
// Parent lookup
// ============================================================================

function findByFilename(images: SourceImage[], filename: string | undefined): SourceImage | null {
  if (!filename) return null
  return images.find((img) => img.filename === filename) ?? null
}

/**
 * Get the immediate parent of an image (or null if it's a root).
 * Uses `parentImage` (single) if set, otherwise first of `parentImages` (multi).
 */
function getParent(image: SourceImage, all: SourceImage[]): SourceImage | null {
  if (image.parentImage) return findByFilename(all, image.parentImage)
  if (image.parentImages && image.parentImages.length > 0) {
    return findByFilename(all, image.parentImages[0])
  }
  return null
}

/**
 * Walk parents until we hit a root (no parent). Returns ancestors in order
 * from nearest-parent → root.
 */
function walkAncestors(image: SourceImage, all: SourceImage[]): SourceImage[] {
  const chain: SourceImage[] = []
  let current = getParent(image, all)
  const visited = new Set<string>([image.id])
  while (current && !visited.has(current.id)) {
    chain.push(current)
    visited.add(current.id)
    current = getParent(current, all)
  }
  return chain
}

// ============================================================================
// Children lookup
// ============================================================================

/** Find all images whose parentImage === this image's filename. */
function getDirectChildren(image: SourceImage, all: SourceImage[]): SourceImage[] {
  return all.filter((candidate) => {
    if (candidate.id === image.id) return false
    if (candidate.parentImage === image.filename) return true
    if (candidate.parentImages?.includes(image.filename)) return true
    return false
  })
}

/**
 * BFS all descendants (children, grandchildren, ...) ordered by depth + timestamp.
 * Deduplicated by id.
 */
function walkDescendants(image: SourceImage, all: SourceImage[]): SourceImage[] {
  const out: SourceImage[] = []
  const visited = new Set<string>([image.id])
  const queue: SourceImage[] = [image]
  while (queue.length > 0) {
    const current = queue.shift()!
    const children = getDirectChildren(current, all)
    // Stable sort within same depth by uploadedAt (chronological)
    children.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id)
        out.push(child)
        queue.push(child)
      }
    }
  }
  return out
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the lineage group for a selected image.
 * Returns `null` if the image is not in the list.
 */
export function buildLineage(selected: SourceImage, all: SourceImage[]): LineageGroup {
  const ancestors = walkAncestors(selected, all)
  const root = ancestors.length > 0 ? ancestors[ancestors.length - 1] : selected

  const descendants = walkDescendants(selected, all)

  // Siblings = children of parent, minus selected
  const parent = getParent(selected, all)
  const siblings = parent
    ? getDirectChildren(parent, all).filter((img) => img.id !== selected.id)
    : []

  return {
    root,
    ancestors,
    selected,
    descendants,
    siblings,
  }
}

/**
 * Build the ordered list shown in the version sidebar:
 * root (always first), then all generations in chronological order.
 */
export function buildSidebarList(selected: SourceImage, all: SourceImage[]): SourceImage[] {
  const { root } = buildLineage(selected, all)
  const rootAndDescendants: SourceImage[] = [root, ...walkDescendants(root, all)]
  // Dedupe just in case
  const seen = new Set<string>()
  return rootAndDescendants.filter((img) => {
    if (seen.has(img.id)) return false
    seen.add(img.id)
    return true
  })
}
