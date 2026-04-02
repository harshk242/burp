import { defineConfig } from 'vitest/config';

// Config for real-API contract tests (run weekly, not on every PR)
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.contract.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    // Real HTTP calls need generous timeouts
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Retry once on flaky network
    retry: 1,
    // Sequential to avoid hammering rate limits
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
