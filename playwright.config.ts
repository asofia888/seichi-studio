import { defineConfig, devices } from '@playwright/test';
import { FAKE_MIC_FILE } from './e2e/media';

const PORT = 4173;

/**
 * Browser tests: the built app is served and driven in Chromium like a person would use it.
 * Every test starts with an empty browser profile (no saved project, no stored media).
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    // The app is laid out for a PC screen
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        // A microphone that needs no permission prompt and "hears" a known tone
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${FAKE_MIC_FILE}`,
      ],
    },
  },
  // The production build, as people use it (the dev server reloads while it optimizes dependencies)
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
