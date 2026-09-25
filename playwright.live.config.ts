import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/live', outputDir: './test-results-live', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4174/Resolve/', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/serve-live-test.mjs', url: 'http://127.0.0.1:4174/Resolve/', timeout: 60000 },
});
