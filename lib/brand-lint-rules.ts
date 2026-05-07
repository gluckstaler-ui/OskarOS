/**
 * brand-lint-rules.ts — v1 rule engine for `lint_brand_compliance`.
 *
 * Phase 2 v1 (2026-04-30) ships exactly TWO rules:
 *   1. missing-image-attributes — every <img> must have BOTH data-slot AND data-usage
 *   2. broken-image-refs        — every <img src> must point to a file on disk
 *
 * No banned phrases, no AI-default palette detection, no WCAG contrast.
 * Adding a third rule requires updating the v1 scope assertion test in
 * lib/__tests__/brand-lint-scope.test.ts.
 *
 * Why two rules and not zero or twenty: these are the two failures we've
 * seen ship in real builds (vibe-3 hero with no data-slot → hot-swap broken;
 * IMG src pointing to a generated filename that was retried with a new name
 * → 404 in production). Everything else can be checked by hand or punted to
 * a future tier without losing real safety.
 */

import { JSDOM } from 'jsdom'
import { existsSync } from 'fs'
import { join, dirname } from 'path'

export type BrandLintSeverity = 'error' | 'warning'

export interface BrandLintViolation {
  rule: 'missing-image-attributes' | 'broken-image-refs'
  severity: BrandLintSeverity
  /** Selector or hint for the offending element. */
  snippet: string
  suggestion: string
}

export interface BrandLintResult {
  violations: BrandLintViolation[]
}

/**
 * v1 rule registry — frozen so the scope-assertion test can verify exactly
 * two rules ship. Adding a rule = updating this array AND the scope test.
 */
export const BRAND_LINT_RULES = [
  'missing-image-attributes',
  'broken-image-refs',
] as const

/**
 * Lint a single HTML file. The `fileDir` is used to resolve relative <img src>
 * paths during the broken-refs check.
 *
 * If `fileDir` is undefined, broken-refs check is skipped (callers that pass
 * raw HTML without a base path get rule 1 only).
 */
export function lintHtmlForBrandCompliance(
  html: string,
  fileDir?: string,
): BrandLintResult {
  const violations: BrandLintViolation[] = []
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const imgs = Array.from(doc.querySelectorAll('img')) as Element[]

  // Rule 1: missing-image-attributes
  for (const img of imgs) {
    const hasSlot = img.hasAttribute('data-slot') && img.getAttribute('data-slot')!.trim() !== ''
    const hasUsage = img.hasAttribute('data-usage') && img.getAttribute('data-usage')!.trim() !== ''
    if (!hasSlot || !hasUsage) {
      const src = img.getAttribute('src') || '(no src)'
      const missing: string[] = []
      if (!hasSlot) missing.push('data-slot')
      if (!hasUsage) missing.push('data-usage')
      violations.push({
        rule: 'missing-image-attributes',
        severity: 'error',
        snippet: `<img src="${src}"> missing ${missing.join(' + ')}`,
        suggestion: `Add ${missing.join(' and ')} attributes so hot-swap can target this image.`,
      })
    }
  }

  // Rule 2: broken-image-refs (only when we have a directory to resolve against)
  if (fileDir) {
    for (const img of imgs) {
      const src = img.getAttribute('src')
      if (!src) continue
      // Skip data: URIs and absolute http(s) URLs — out of scope for v1.
      if (src.startsWith('data:') || /^https?:\/\//i.test(src)) continue
      // Resolve relative to the HTML file's directory.
      const resolved = join(fileDir, src)
      if (!existsSync(resolved)) {
        violations.push({
          rule: 'broken-image-refs',
          severity: 'error',
          snippet: `<img src="${src}"> → ${resolved} not found on disk`,
          suggestion: `Check filename. Common cause: image was regenerated under a new name; update the src.`,
        })
      }
    }
  }

  return { violations }
}

/**
 * Convenience wrapper: lint by file path (reads + passes the dir).
 */
export async function lintHtmlFile(absPath: string): Promise<BrandLintResult> {
  const { readFile } = await import('fs/promises')
  const html = await readFile(absPath, 'utf-8')
  return lintHtmlForBrandCompliance(html, dirname(absPath))
}
