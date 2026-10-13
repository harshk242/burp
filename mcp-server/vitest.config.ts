import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Unit tests only — contract tests use vitest.contracts.config.ts
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/shared/**/*.ts', 'src/server.ts', 'src/call-tool.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/__test-utils__/**'],
    },
  },
});
