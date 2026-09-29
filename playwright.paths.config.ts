import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/paths', use: { baseURL: 'http://127.0.0.1:4175' },
  webServer: { command: 'VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= VITE_SUPABASE_ANON_KEY= VITE_BASE_PATH=./ npm run build && node scripts/serve-path-test.mjs', url: 'http://127.0.0.1:4175' },
});
