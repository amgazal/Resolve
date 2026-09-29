import { defineConfig } from '@playwright/test';
// These journeys use explicit demo-role controls. They cannot sign into or mutate
// a hosted account and intentionally fail if production switches to live mode.
export default defineConfig({
  testDir: './tests/browser', workers: 2,
  use: { baseURL: 'https://resolve.amgazal.com/', trace: 'retain-on-failure' },
});
