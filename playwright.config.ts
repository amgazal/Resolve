import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:4173/Resolve/', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build:demo && VITE_BASE_PATH=/Resolve/ npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/Resolve/', reuseExistingServer: false,
  },
});
