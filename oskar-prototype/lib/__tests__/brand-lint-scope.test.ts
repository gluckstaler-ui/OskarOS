/**
 * brand-lint-scope.test.ts — Phase 2 v1 SCOPE LOCK (2026-04-30).
 *
 * Locks the v1 rule registry to EXACTLY two rules. Adding a third rule
 * requires updating both this test AND lib/brand-lint-rules.ts; the test
 * is intentional friction so spec creep gets reviewed.
 */
import { describe, it, expect } from 'vitest'
import { BRAND_LINT_RULES, lintHtmlForBrandCompliance } from '../brand-lint-rules'

describe('lint_brand_compliance — v1 scope lock', () => {
  it('exposes EXACTLY two rule identifiers (v1 spec)', () => {
    expect(BRAND_LINT_RULES).toHaveLength(2)
    expect([...BRAND_LINT_RULES].sort()).toEqual([
      'broken-image-refs',
      'missing-image-attributes',
    ])
  })

  it('clean fixture: zero violations', () => {
    const html = `<html><body><img src="hero.jpg" data-slot="hero" data-usage="background"></body></html>`
    const result = lintHtmlForBrandCompliance(html)
    expect(result.violations).toHaveLength(0)
  })

  it('flags <img> missing data-slot', () => {
    const html = `<html><body><img src="hero.jpg" data-usage="background"></body></html>`
    const result = lintHtmlForBrandCompliance(html)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].rule).toBe('missing-image-attributes')
    expect(result.violations[0].snippet).toContain('data-slot')
  })

  it('flags <img> missing data-usage', () => {
    const html = `<html><body><img src="hero.jpg" data-slot="hero"></body></html>`
    const result = lintHtmlForBrandCompliance(html)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].snippet).toContain('data-usage')
  })

  it('flags BOTH attributes missing as ONE violation listing both', () => {
    const html = `<html><body><img src="hero.jpg"></body></html>`
    const result = lintHtmlForBrandCompliance(html)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].snippet).toContain('data-slot')
    expect(result.violations[0].snippet).toContain('data-usage')
  })
})
