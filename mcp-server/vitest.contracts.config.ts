import { defineConfig } from 'vitest/config';

// Config for real-API contract tests (run weekly, not on every PR)
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.contract.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    // Retries live in each platform's contract client (shared HTTP retry,
    // 120s budget per request), so Vitest never re-runs a test. Each file sets
    // its own per-test timeout; the defaults sit above one request's budget.
    testTimeout: 150_000,
    hookTimeout: 150_000,
    retry: 0,
    // Sequential to avoid hammering rate limits
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
