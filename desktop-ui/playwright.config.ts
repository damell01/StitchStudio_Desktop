import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Most workflow tests drive power-user commands; simple mode has its own spec.
    storageState: 'tests/all-tools.storage.json',
    launchOptions: { executablePath: process.env.STITCH_TEST_CHROMIUM },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
