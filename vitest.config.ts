import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000, // Testcontainers pulls an image on a cold machine
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The domain is where coverage means something; adapters are covered by integration tests.
      thresholds: { 'src/domain/**': { statements: 95, branches: 90 } },
    },
  },
});
