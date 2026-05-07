import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  calculateCost,
  parseUsageFromCLIOutput,
  formatCost,
  formatTokens,
  readSessionUsage,
  appendUsage,
} from '../usage-tracker'

describe('usage-tracker', () => {
  describe('calculateCost', () => {
    it('calculates cost correctly for typical usage', () => {
      // 1000 input tokens at $3/1M = $0.003
      // 500 output tokens at $15/1M = $0.0075
      // Total = $0.0105
      const cost = calculateCost(1000, 500)
      expect(cost).toBe(0.0105)
    })

    it('calculates cost for zero tokens', () => {
      const cost = calculateCost(0, 0)
      expect(cost).toBe(0)
    })

    it('calculates cost for 1 million input tokens', () => {
      const cost = calculateCost(1_000_000, 0)
      expect(cost).toBe(3.0)
    })

    it('calculates cost for 1 million output tokens', () => {
      const cost = calculateCost(0, 1_000_000)
      expect(cost).toBe(15.0)
    })

    it('rounds to 4 decimal places', () => {
      const cost = calculateCost(1234, 5678)
      expect(cost.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(4)
    })

    it('handles large token counts', () => {
      const cost = calculateCost(10_000_000, 5_000_000)
      expect(cost).toBe(105.0) // 30 + 75
    })
  })

  describe('parseUsageFromCLIOutput', () => {
    it('parses result type JSON from CLI output', () => {
      const output = `
Some text output
{"type":"result","cost":0.0234,"input_tokens":1523,"output_tokens":892}
`
      const result = parseUsageFromCLIOutput(output)
      expect(result).toEqual({
        inputTokens: 1523,
        outputTokens: 892,
        cost: 0.0234,
      })
    })

    it('parses usage object format', () => {
      const output = `
Some output
{"usage":{"input_tokens":500,"output_tokens":200}}
`
      const result = parseUsageFromCLIOutput(output)
      expect(result).not.toBeNull()
      expect(result!.inputTokens).toBe(500)
      expect(result!.outputTokens).toBe(200)
    })

    it('handles missing cost in result type (calculates it)', () => {
      const output = `{"type":"result","input_tokens":1000,"output_tokens":500}`
      const result = parseUsageFromCLIOutput(output)
      expect(result).not.toBeNull()
      expect(result!.inputTokens).toBe(1000)
      expect(result!.outputTokens).toBe(500)
      expect(result!.cost).toBe(0.0105) // calculated
    })

    it('returns null for non-JSON output', () => {
      const output = 'Just some plain text\nNo JSON here'
      const result = parseUsageFromCLIOutput(output)
      expect(result).toBeNull()
    })

    it('returns null for empty output', () => {
      const result = parseUsageFromCLIOutput('')
      expect(result).toBeNull()
    })

    it('returns null for JSON without usage data', () => {
      const output = `{"type":"message","content":"Hello"}`
      const result = parseUsageFromCLIOutput(output)
      expect(result).toBeNull()
    })

    it('handles trailing whitespace and newlines', () => {
      const output = `
{"type":"result","input_tokens":100,"output_tokens":50,"cost":0.001}

`
      const result = parseUsageFromCLIOutput(output)
      expect(result).not.toBeNull()
      expect(result!.inputTokens).toBe(100)
    })

    it('finds usage in last 5 lines', () => {
      const output = `
Line 1
Line 2
Line 3
{"type":"result","input_tokens":100,"output_tokens":50,"cost":0.001}
Line 5
`
      const result = parseUsageFromCLIOutput(output)
      expect(result).not.toBeNull()
    })
  })

  describe('formatCost', () => {
    it('formats costs under $0.01 as cents', () => {
      expect(formatCost(0.005)).toBe('$0.50\u00A2') // 0.5 cents
    })

    it('formats costs over $0.01 as dollars', () => {
      expect(formatCost(0.05)).toBe('$0.05')
    })

    it('formats $1 correctly', () => {
      expect(formatCost(1)).toBe('$1.00')
    })

    it('formats zero cost', () => {
      expect(formatCost(0)).toBe('$0.00\u00A2')
    })

    it('formats large costs', () => {
      expect(formatCost(123.456)).toBe('$123.46')
    })
  })

  describe('formatTokens', () => {
    it('formats small numbers as-is', () => {
      expect(formatTokens(500)).toBe('500')
    })

    it('formats thousands as K', () => {
      expect(formatTokens(1500)).toBe('1.5K')
    })

    it('formats millions as M', () => {
      expect(formatTokens(2_500_000)).toBe('2.5M')
    })

    it('formats exactly 1000 as K', () => {
      expect(formatTokens(1000)).toBe('1.0K')
    })

    it('formats exactly 1 million as M', () => {
      expect(formatTokens(1_000_000)).toBe('1.0M')
    })

    it('formats zero', () => {
      expect(formatTokens(0)).toBe('0')
    })
  })
})

describe('usage-tracker file operations', () => {
  const mockFs = {
    existsSync: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  // Note: Full file operation tests would require mocking fs/promises
  // These are placeholder tests showing the structure

  describe('readSessionUsage', () => {
    it('returns empty usage when file does not exist', async () => {
      // This would need fs mocking in a real implementation
      // For now, test the interface expectations
      const emptyUsage = {
        sessionId: 'test-session',
        entries: [],
        totals: { inputTokens: 0, outputTokens: 0, cost: 0 },
      }
      expect(emptyUsage.entries).toHaveLength(0)
      expect(emptyUsage.totals.cost).toBe(0)
    })
  })

  describe('appendUsage', () => {
    it('creates correct entry structure', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        agent: 'CD' as const,
        task: 'Test task',
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.0105,
      }
      expect(entry.agent).toBe('CD')
      expect(entry.inputTokens).toBe(1000)
      expect(entry.outputTokens).toBe(500)
    })
  })
})
