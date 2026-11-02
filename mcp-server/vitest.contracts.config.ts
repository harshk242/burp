import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.contract.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 150_000,
    hookTimeout: 150_000,
    retry: 0,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
