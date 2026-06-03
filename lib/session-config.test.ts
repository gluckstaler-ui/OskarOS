/**
 * Unit tests for lib/session-config.ts (Ralph 2026-05-04).
 *
 * Locks in the 3-tier resolveConfig precedence and the atomic write
 * semantics. The toggle UX depends on these — if precedence regresses,
 * the TopBar pill goes dead again.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  readSessionConfig,
  writeSessionConfig,
  resolveConfig,
  resolveWebDevExecution,
  DEFAULT_SESSION_CONFIG,
} from './session-config'
import { existsSync, rmSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

const TEST_SESSION_ID = '__test-session-config__'
const TEST_SESSION_DIR = join(process.cwd(), 'public', TEST_SESSION_ID)

beforeEach(() => {
  if (existsSync(TEST_SESSION_DIR)) {
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true })
  }
  mkdirSync(TEST_SESSION_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_SESSION_DIR)) {
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true })
  }
})

describe('readSessionConfig', () => {
  it('returns DEFAULT_SESSION_CONFIG when file does not exist', () => {
    const cfg = readSessionConfig(TEST_SESSION_ID)
    expect(cfg.webDevModel).toBe(DEFAULT_SESSION_CONFIG.webDevModel)
    expect(cfg.cdModel).toBe(DEFAULT_SESSION_CONFIG.cdModel)
    expect(cfg.billingMode).toBe(DEFAULT_SESSION_CONFIG.billingMode)
  })

  it('returns DEFAULT_SESSION_CONFIG on malformed JSON', () => {
    const path = join(TEST_SESSION_DIR, 'logs', '_session-config.json')
    require('fs').mkdirSync(join(TEST_SESSION_DIR, 'logs'), { recursive: true })
    require('fs').writeFileSync(path, '{ not valid json', 'utf-8')
    const cfg = readSessionConfig(TEST_SESSION_ID)
    expect(cfg.webDevModel).toBe(DEFAULT_SESSION_CONFIG.webDevModel)
  })

  it('merges partial file over defaults so a missing field still resolves', () => {
    const path = join(TEST_SESSION_DIR, 'logs', '_session-config.json')
    require('fs').mkdirSync(join(TEST_SESSION_DIR, 'logs'), { recursive: true })
    require('fs').writeFileSync(path, JSON.stringify({ webDevModel: 'claude-opus-4-8' }), 'utf-8')
    const cfg = readSessionConfig(TEST_SESSION_ID)
    expect(cfg.webDevModel).toBe('claude-opus-4-8')
    // Other fields fall back to default
    expect(cfg.cdModel).toBe(DEFAULT_SESSION_CONFIG.cdModel)
    expect(cfg.billingMode).toBe(DEFAULT_SESSION_CONFIG.billingMode)
  })
})

describe('writeSessionConfig', () => {
  it('creates the file with merged values + fresh updatedAt', () => {
    const before = new Date().toISOString()
    const result = writeSessionConfig(TEST_SESSION_ID, { webDevModel: 'gemini-3.1-pro-preview' })
    expect(result.webDevModel).toBe('gemini-3.1-pro-preview')
    expect(result.updatedAt >= before).toBe(true)
    // Other fields keep defaults
    expect(result.cdModel).toBe(DEFAULT_SESSION_CONFIG.cdModel)
    // Round-trip — read should match
    const readBack = readSessionConfig(TEST_SESSION_ID)
    expect(readBack.webDevModel).toBe('gemini-3.1-pro-preview')
  })

  it('partial updates merge over existing values', () => {
    writeSessionConfig(TEST_SESSION_ID, { webDevModel: 'claude-opus-4-8', billingMode: 'api' })
    const second = writeSessionConfig(TEST_SESSION_ID, { webDevModel: 'claude-sonnet-4-6' })
    expect(second.webDevModel).toBe('claude-sonnet-4-6')
    // billingMode preserved from the prior write
    expect(second.billingMode).toBe('api')
  })

  it('does not leave orphaned .tmp files after a successful write', () => {
    writeSessionConfig(TEST_SESSION_ID, { webDevModel: 'claude-sonnet-4-6' })
    const files = readdirSync(TEST_SESSION_DIR)
    const tmps = files.filter((f) => f.endsWith('.tmp'))
    expect(tmps).toEqual([])
  })
})

describe('resolveConfig — 3-tier precedence', () => {
  it('override wins over file value', () => {
    writeSessionConfig(TEST_SESSION_ID, { cdModel: 'claude-sonnet-4-6' })
    const resolved = resolveConfig(
      'cdModel',
      'claude-opus-4-8',  // override
      TEST_SESSION_ID,
      'claude-opus-4-8[1m]',  // default — should be ignored
    )
    expect(resolved).toBe('claude-opus-4-8')
  })

  it('file wins over default when override is undefined', () => {
    writeSessionConfig(TEST_SESSION_ID, { cdModel: 'claude-sonnet-4-6' })
    const resolved = resolveConfig(
      'cdModel',
      undefined,
      TEST_SESSION_ID,
      'claude-opus-4-8[1m]',
    )
    expect(resolved).toBe('claude-sonnet-4-6')
  })

  it('default wins when neither override nor file specifies a non-default value', () => {
    // No file written → file value will equal DEFAULT_SESSION_CONFIG.cdModel,
    // so resolveConfig should return the caller's defaultValue.
    const resolved = resolveConfig(
      'cdModel',
      undefined,
      TEST_SESSION_ID,
      'claude-opus-4-8',  // caller-specified default differs from schema default
    )
    expect(resolved).toBe('claude-opus-4-8')
  })

  it('treats null override the same as undefined', () => {
    writeSessionConfig(TEST_SESSION_ID, { cdModel: 'claude-sonnet-4-6' })
    const resolved = resolveConfig(
      'cdModel',
      null,
      TEST_SESSION_ID,
      'claude-opus-4-8[1m]',
    )
    expect(resolved).toBe('claude-sonnet-4-6')
  })
})

describe('resolveWebDevExecution — combo helper', () => {
  it('returns both fields with override precedence', () => {
    writeSessionConfig(TEST_SESSION_ID, { webDevModel: 'claude-sonnet-4-6', webDevMode: 'cli' })
    const result = resolveWebDevExecution(
      { mode: 'api', model: 'gemini-3.1-pro-preview' },
      TEST_SESSION_ID,
    )
    expect(result.mode).toBe('api')
    expect(result.model).toBe('gemini-3.1-pro-preview')
  })

  it('falls back to file when no override', () => {
    writeSessionConfig(TEST_SESSION_ID, { webDevModel: 'claude-opus-4-8', webDevMode: 'api' })
    const result = resolveWebDevExecution(undefined, TEST_SESSION_ID)
    expect(result.model).toBe('claude-opus-4-8')
    expect(result.mode).toBe('api')
  })

  it('falls back to default when no override and no file', () => {
    const result = resolveWebDevExecution(undefined, TEST_SESSION_ID)
    expect(result.mode).toBe('cli')
    expect(result.model).toBe('claude-sonnet-4-6')
  })
})
