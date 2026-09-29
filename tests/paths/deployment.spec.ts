import { test, expect } from '@playwright/test';
for (const path of ['/', '/Resolve/']) test(`relative production assets render and reload at ${path}`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.url().startsWith('http://127.0.0.1') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Explore Resolve as' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Explore Resolve as' })).toBeVisible();
  expect(await page.locator('script[type="module"]').getAttribute('src')).toMatch(/^\.\/assets\//);
  expect(errors).toEqual([]);
});
