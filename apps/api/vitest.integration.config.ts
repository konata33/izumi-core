import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.spec.ts'],
    environment: 'node',
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
