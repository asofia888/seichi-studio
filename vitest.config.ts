import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Browser tests in e2e/ are run by Playwright (npm run test:e2e)
    include: ['src/**/*.test.ts'],
  },
});
