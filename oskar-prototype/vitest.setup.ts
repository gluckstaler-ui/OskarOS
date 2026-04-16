import { vi } from 'vitest'

// Mock fs/promises for tests
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return {
    ...actual,
  }
})

// Global test utilities
global.console = {
  ...console,
  // Suppress console.log in tests unless DEBUG is set
  log: process.env.DEBUG ? console.log : vi.fn(),
  error: console.error,
  warn: console.warn,
}
