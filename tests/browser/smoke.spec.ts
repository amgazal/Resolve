import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function enter(page: Page, role: string) {
  await page.goto('./');
  await page.getByRole('button', { name: role, exact: false }).click();
  if (role === 'Requester') { await expect(page.getByRole('heading', { name: "What's going wrong?" })).toBeVisible(); await page.getByRole('combobox', { name: 'Device', exact: true }).selectOption('Laptop'); await page.getByRole('combobox', { name: 'System', exact: true }).selectOption('macOS'); }
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
  await page.getByRole('button', { name: 'Still not working' }).click();
  await page.getByRole('button', { name: 'Skip ahead' }).click();
  await accessible(page);
  await page.getByLabel('Note for IT (optional)').fill('Started this morning.');
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
  await expect(dialog.getByRole('button', { name: /Path Library/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close ticket detail' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('region', { name: 'Ticket content' })).toBeFocused();
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

test('public conversation returns waiting work to the personal queue and saves a useful path', async ({ page }) => {
  await enter(page, 'IT Technician');
  await page.getByRole('button', { name: /Open RSV-2481 from Maya/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Assignee', exact: true }).selectOption('u_jordan');
  await dialog.getByLabel('Add an internal note').fill('Private cable inventory');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByLabel('Add an internal note')).toHaveValue('');
  await dialog.getByLabel('Message', { exact: true }).fill('Can you check the cable?');
  await dialog.getByRole('button', { name: 'Send & wait for reply', exact: true }).click();
  await expect(dialog.getByLabel('Message', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Save to Path Library' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to Path Library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Waiting \(/ }).click();
  await expect(page.getByRole('button', { name: /Open RSV-2481 from Maya/ })).toBeVisible();
  await page.getByRole('button', { name: /^Sign out/ }).click();
  await page.getByRole('button', { name: /Requester/ }).click();
  await page.getByRole('button', { name: 'My requests', exact: true }).click();
  await page.getByRole('button', { name: /RSV-2481/ }).click();
  await expect(page.getByText('Can you check the cable?', { exact: true })).toBeVisible();
  await expect(page.getByText('Private cable inventory')).toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('Cable is connected.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(page.locator('.requests .label').filter({ hasText: 'IT is reviewing your reply' })).toBeVisible();
  await accessible(page);
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /^Sign out/ }).click();
  await page.getByRole('button', { name: /IT Technician/ }).click();
  await page.getByRole('button', { name: /^Assigned to me \(/ }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: /Open RSV-2481 from Maya/ }) });
  await expect(row).toContainText('Needs review');
  await page.locator('.routes summary').first().click();
  await expect(page.locator('.routes details').first()).toContainText('Saved by Jordan Ellis');
  await expect(page.locator('.routes details ol li').first()).toBeVisible();
});

test('admin previews saved draft, validates changes, publishes and reads archived history', async ({ page }) => {
  await enter(page, 'Administrator');
  await page.getByRole('button', { name: 'Preview saved questions' }).click();
  const preview = page.getByRole('region', { name: 'Draft preview' });
  await expect(preview).toContainText('Preview / test mode');
  await preview.getByRole('button', { name: 'Yes', exact: true }).click();
  await preview.getByRole('button', { name: 'Restart preview' }).click();
  await preview.getByRole('button', { name: 'Exit preview' }).click();
  await page.getByRole('button', { name: 'Add a question', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish this version' })).toBeDisabled();
  await expect(page.getByText('Unreachable: New question', { exact: false })).toBeVisible();
  await page.getByRole('group', { name: 'New question', exact: true }).getByRole('button', { name: 'Remove this question', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove question', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish this version' })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish this version' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Publish version/ }).click();
  await expect(page.getByRole('button', { name: 'Start the next version' })).toBeVisible();
  await page.getByLabel('Version history').selectOption({ label: await page.getByLabel('Version history').locator('option').filter({ hasText: 'archived' }).first().textContent() ?? '' });
  await expect(page.getByLabel('Answer text').first()).toBeDisabled();
  await page.getByText('Recent admin activity', { exact: true }).click();
  await expect(page.getByText(/tree published ·/)).toBeVisible();
});

test('support image normalization, thread preview, keyboard viewer, and mobile layout', async ({ page }) => {
  await enter(page, 'IT Technician');
  await page.getByRole('button', { name: /Open RSV-2481 from Maya/ }).click();
  const panel = page.getByRole('dialog', { name: /./ });
  // Ordinary send claims an unassigned ticket and moves it to assigned.
  await panel.getByLabel('Attach image').setInputFiles('tests/fixtures/support.png');
  await expect(panel.getByRole('button', { name: 'Remove support.png' })).toBeVisible();
  await panel.getByLabel('Message', { exact: true }).fill('Check this setting.');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(panel.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(panel.locator('.ticket-workflow')).toContainText('assigned');
  await panel.locator('.support-image').first().scrollIntoViewIfNeeded();
  const thumbnail = panel.getByRole('button', { name: 'View support.png' });
  await expect(thumbnail).toBeVisible();
  await thumbnail.click();
  const viewer = page.getByRole('dialog', { name: 'support.png', exact: true });
  await expect(viewer).toBeVisible();
  await accessible(page);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  await expect(panel).toBeVisible();
  for (const width of [320,375,390,393,430,768,1024,1280,1440]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByLabel('Attach image').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(panel.getByRole('alert')).toContainText('JPEG, PNG, or WebP');
  // Browser-generated JPEG follows the same orientation/decode/re-encode pipeline.
  const jpeg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 30; c.height = 30; c.getContext('2d')!.fillRect(0,0,30,30); return c.toDataURL('image/jpeg').split(',')[1]!; });
  await panel.getByLabel('Attach image').setInputFiles({ name: '<script>alert(1)</script>.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
  await expect(panel.getByRole('button', { name: /Remove <script>/ })).toBeVisible();
  await panel.getByLabel('Message', { exact: true }).fill('Please reply with what you see.');
  await panel.getByRole('button', { name: 'Send & wait for reply', exact: true }).click();
  await expect(panel.locator('.ticket-workflow')).toContainText('waiting');
  await expect(panel.locator('.ticket-workflow')).toContainText('Jordan Ellis');
  await expect(panel.getByRole('button', { name: 'Send & wait for reply', exact: true })).toHaveCount(0);
});
