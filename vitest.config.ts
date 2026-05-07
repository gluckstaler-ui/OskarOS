import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 2026-04-30 Phase 2: also pick up colocated tests (lib/foo.test.ts beside
    // lib/foo.ts), per the Phase 2 testing plan. Existing __tests__ folders
    // keep working too.
    include: [
      '**/__tests__/**/*.test.ts',
      '**/__tests__/**/*.test.tsx',
      'lib/**/*.test.ts',
      'lib/**/*.test.tsx',
      'components/**/*.test.tsx',
      'components/**/*.test.ts',
      'mcp-server/**/*.test.ts',
      'app/api/**/*.test.ts',
      // 2026-05-02 Phase 3 — UICase registry sanity tests (NOT Playwright specs)
      'e2e/cases/**/*.test.ts',
    ],
    exclude: ['node_modules', '.next', 'mcp-server/dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.ts', 'app/api/**/*.ts', 'mcp-server/**/*.ts'],
      exclude: ['**/__tests__/**', '**/*.d.ts', '**/*.test.ts', 'mcp-server/dist/**'],
    },
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
