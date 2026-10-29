/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // corpus/*.test.mjs pins the corpus's judging logic (corpus/lib.mjs).
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'corpus/**/*.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      // `lcov` is required for the Codecov upload in .github/workflows/ci.yml.
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'tests/**'],
    },
  },
});
