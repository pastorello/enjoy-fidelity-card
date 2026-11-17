import { defineConfig } from 'vitest/config';

/**
 * Integration tests: they run against the LOCAL Supabase stack (`npm run db:start`), never
 * against a hosted project. `npm run test:integration`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One stack, shared state: run the files one after the other.
    fileParallelism: false,
  },
});
