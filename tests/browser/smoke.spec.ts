import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function enter(page: Page, role: string) {
  await page.goto('./');
  await page.getByRole('button', { name: role, exact: false }).click();
  if (role === 'Requester') await expect(page.getByRole('heading', { name: "What's going wrong?" })).toBeVisible();
  if (role === 'IT Technician') await expect(page.getByRole('button', { name: 'Refresh queue' })).toBeVisible();
  if (role === 'Administrator') await expect(page.getByLabel('Answer text').first()).toBeVisible();
}
async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

test('requester answers, tries a fix, and sends the reviewed handoff', async ({ page }) => {
  await enter(page, 'Requester');
  await page.getByLabel('Describe the problem').fill('Wi-Fi connects but websites do not load.');
  await page.getByRole('button', { name: 'Wi-Fi & Network' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).dblclick();
  for (const name of ['Yes', 'Yes', 'All of them', 'Nothing changed']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Try this', exact: true }).click();
  await page.getByRole('button', { name: 'Still not working' }).click();
  await page.getByRole('button', { name: 'Skip ahead' }).click();
  await accessible(page);
  await page.getByLabel('Anything else worth knowing?').fill('Started this morning.');
  await page.getByRole('button', { name: 'Send to IT', exact: true }).click();
  await expect(page.getByText(/RSV-\d+/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Explore Resolve as' })).toBeVisible();
});

test('technician modal traps focus, accepts a note, resolves and restores focus', async ({ page }) => {
  await enter(page, 'IT Technician');
  const first = page.getByRole('button', { name: /^Open RSV/ }).first();
  const name = await first.getAttribute('aria-label');
  const opener = page.getByRole('button', { name: name!, exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Mark resolved' })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save diagnostic path' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close ticket detail' })).toBeFocused();
  await dialog.getByLabel('Add an internal note').fill('Checked the connection.\nFollow-up complete.');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.locator('.notes p').filter({ hasText: 'Checked the connection.' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(dialog.getByRole('button', { name: 'Mark waiting for user' })).toHaveCount(0);
  await accessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('admin retains local answer edits, guards navigation and confirms deletion', async ({ page }) => {
  await enter(page, 'Administrator');
  const answer = page.getByLabel('Answer text').first();
  await answer.fill('Yes, confirmed');
  await page.getByLabel('What this records').first().fill('Confirmed working');
  await expect(page.getByRole('button', { name: 'Save answer', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'IT desk', exact: true }).click();
  await expect(answer).toHaveValue('Yes, confirmed');
  const category = await page.getByRole('combobox', { name: 'Category', exact: true }).inputValue();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption({ index: 1 });
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue(category);
  await page.getByRole('button', { name: 'Publish this version' }).click();
  await expect(page.getByRole('alert')).toContainText('Save or discard');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Save answer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save answer', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('What this records').first()).toHaveValue('Confirmed working');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Remove this answer' }).first().click();
  await expect(answer).toHaveValue('Yes, confirmed');
  await accessible(page);
});

test('all surfaces fit narrow and desktop widths', async ({ page }, testInfo) => {
  for (const role of ['Requester', 'IT Technician', 'Administrator']) {
    await enter(page, role);
    await expect(page.locator('.loading')).toHaveCount(0);
    for (const width of [320, 375, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${role}-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: /^Sign out/ }).click();
  }
});
