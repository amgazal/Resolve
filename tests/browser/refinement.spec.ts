import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function enter(page: Page) { await page.goto('./'); await page.getByRole('button', { name: /Requester/ }).click(); }
async function diagnose(page: Page) {
  await page.getByRole('button', { name: 'Wi-Fi & Network' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const name of ['Yes','Yes','All of them','Nothing changed']) await page.getByRole('button', { name, exact: true }).click();
}
async function axe(page: Page) { expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]); }
test.beforeEach(async ({ page }) => { page.on('pageerror', e => { throw e; }); });

test('attachment is deferred until final review and landing stays uncluttered', async ({ page }) => {
  await enter(page);
  await expect(page.getByLabel('Add a screenshot or photo (optional)')).toHaveCount(0);
  await page.getByLabel('Describe the problem').fill('Wi-Fi connects but websites won\'t load.');
  await page.getByRole('button', { name: 'Wi-Fi & Network' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByLabel('Attach image')).toHaveCount(0);
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: 'All of them', exact: true }).click();
  await page.getByRole('button', { name: 'Nothing changed', exact: true }).click();
  await page.getByRole('button', { name: 'Skip ahead and send this to IT' }).click();
  await expect(page.getByLabel('Attach image')).toHaveCount(1);
  await expect(page.locator('.handoff')).toContainText('Review your request');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('initial evidence stays local, review edits persist, and a skipped handoff is truthful', async ({ page }) => {
  await enter(page);
  await page.getByLabel('Describe the problem').fill('Wrong description');
  await page.getByLabel('Add a screenshot or photo (optional)').setInputFiles('tests/fixtures/support.png');
  await expect(page.getByRole('button', { name: 'Remove support.png' })).toBeVisible();
  await diagnose(page);
  await page.getByRole('button', { name: 'Skip ahead and send this to IT' }).click();
  await expect(page.getByRole('region', { name: 'Supporting screenshots and photos' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit issue details', exact: true }).click();
  await page.getByLabel('Problem description').fill('Corrected Wi-Fi report');
  await page.getByRole('region', { name: 'Edit issue details', exact: true }).getByRole('combobox', { name: 'Device', exact: true }).selectOption('Phone');
  await page.getByRole('region', { name: 'Edit issue details', exact: true }).getByRole('combobox', { name: 'System', exact: true }).selectOption('iOS');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('button', { name: 'Edit issue details', exact: true })).toBeFocused();
  await expect(page.locator('.handoff')).toContainText('Corrected Wi-Fi report');
  await expect(page.locator('.handoff')).toContainText('Phone · iOS');
  await page.getByLabel('Additional note for IT (optional)').fill('The exact error appears in the screenshot.');
  await axe(page);
  await page.getByRole('button', { name: 'Send to IT', exact: true }).click();
  await expect(page.getByText('IT will receive your answers and issue details', { exact: false })).toBeVisible();
  await expect(page.locator('.closing')).not.toContainText('steps you');
  await page.getByRole('button', { name: 'View my requests' }).click();
  await expect(page.locator('.request-detail')).toContainText('Corrected Wi-Fi report');
  await expect(page.locator('.group-with-it')).toContainText('Sent to IT');
  await page.getByRole('button', { name: 'View support.png' }).click();
  await expect(page.getByRole('dialog', { name: 'support.png' }).locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await axe(page);
});

test('review removal, invalid files, and confirmed restart release staged images', async ({ page }) => {
  const revoked: string[] = [];
  await page.exposeFunction('trackRevoke', (url: string) => revoked.push(url));
  await page.addInitScript(() => { const original = URL.revokeObjectURL; URL.revokeObjectURL = url => { (window as unknown as { trackRevoke: (s: string) => void }).trackRevoke(url); original(url); }; });
  await enter(page);
  const picker = page.getByLabel('Add a screenshot or photo (optional)');
  await picker.setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toContainText('JPEG, PNG, or WebP');
  await picker.setInputFiles('tests/fixtures/support.png');
  await expect(page.getByRole('button', { name: 'Remove support.png' })).toBeVisible();
  await diagnose(page);
  await page.getByRole('button', { name: 'Skip ahead and send this to IT' }).click();
  await page.getByRole('button', { name: 'Remove support.png' }).click();
  await expect(page.getByRole('region', { name: 'Supporting screenshots and photos' })).toHaveCount(0);
  await picker.setInputFiles('tests/fixtures/support.png');
  await expect(page.getByRole('button', { name: 'Remove support.png' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Change category / Start over' }).click();
  await expect(page.getByRole('heading', { name: "What's going wrong?" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove support.png' })).toHaveCount(0);
  expect(revoked.length).toBeGreaterThanOrEqual(2);
});

test('answer correction clears attempts and lets the requester work backward safely', async ({ page }) => {
  await enter(page); await diagnose(page);
  await page.getByRole('button', { name: 'Try this', exact: true }).click();
  await page.getByRole('button', { name: 'Still not working' }).click();
  await page.getByRole('button', { name: 'Skip ahead and send this to IT' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Change my last answer' }).click();
  await page.getByRole('button', { name: 'VPN or security tool', exact: true }).click();
  await page.getByRole('button', { name: 'Skip ahead and send this to IT' }).click();
  await expect(page.locator('.handoff')).toContainText('No troubleshooting attempted');
  await expect(page.locator('.handoff')).not.toContainText('Reconnect to the network');
});

for (const [os, path] of [['Windows','Time & language'], ['macOS','System Settings'], ['iOS','Set Automatically'], ['Android','System → Date & time']]) test(`MFA guidance follows ${os}`, async ({ page }) => {
  await enter(page);
  await page.getByRole('combobox', { name: 'System', exact: true }).selectOption(os!);
  await page.getByRole('button', { name: 'Login & Account' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: "The verification code won't work", exact: true }).click();
  await expect(page.locator('.step.is-now')).toContainText(path!);
  await expect(page.locator('.security-hint')).toContainText('Never paste passwords');
  await axe(page);
});

test('visual review of changed screens at desktop, tablet, phone and enlarged text', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  async function review(name: string) {
    await expect(page.locator('.toast')).toHaveCount(0);
    for (const width of [320,375,390,393,430,768,1024,1280,1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at ${width}`).toBe(true);
      if ([390,768,1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 844, height: 390 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} landscape`).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    // Text-only enlargement: capture all original computed sizes before changing them.
    await page.evaluate(() => {
      const elements = [...document.querySelectorAll<HTMLElement>('.rsv, .rsv *')].filter(e => e.namespaceURI === 'http://www.w3.org/1999/xhtml');
      const sizes = elements.map(e => parseFloat(getComputedStyle(e).fontSize));
      elements.forEach((e,i) => { e.dataset.originalStyle = e.getAttribute('style') ?? ''; e.style.fontSize = `${sizes[i]! * 2}px`; });
    });
    await page.screenshot({ path: testInfo.outputPath(`${name}-text200.png`), fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} 200% text: ${await page.evaluate(() => JSON.stringify([...document.querySelectorAll("body *")].filter(e => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1).map(e => ({ tag: e.tagName, cls: e.className, scroll: e.scrollWidth, width: e.clientWidth })) ))}`).toBe(true);
    await page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-original-style]').forEach(e => { e.setAttribute('style', e.dataset.originalStyle!); delete e.dataset.originalStyle; }));
    await axe(page);
  }
  await enter(page);
  await page.getByLabel('Describe the problem').fill('My verification code is rejected.');
  await page.getByLabel('Add a screenshot or photo (optional)').setInputFiles('tests/fixtures/support.png');
  await expect(page.getByRole('button', { name: 'Remove support.png' })).toBeVisible();
  await review('landing');
  await page.getByRole('button', { name: 'Login & Account' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.ask-q')).toBeVisible();
  await review('question');
  await page.getByRole('button', { name: "The verification code won't work", exact: true }).click();
  await expect(page.locator('.step.is-now')).toBeVisible();
  await review('troubleshooting');
  await page.getByRole('button', { name: 'Skip ahead and send this to IT' }).click();
  await review('handoff');
  await page.getByRole('button', { name: 'Edit issue details', exact: true }).click();
  await review('editing');
  await page.getByRole('button', { name: 'Cancel details edit' }).click();
  await page.getByRole('button', { name: 'Send to IT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'On its way.' })).toBeVisible();
  await review('confirmation');
  await page.getByRole('button', { name: 'View my requests' }).click();
  await expect(page.locator('.request-detail .col-title')).toBeVisible();
  await review('my-requests');
  await page.getByRole('button', { name: /^Sign out/ }).click();
  await page.getByRole('button', { name: /IT Technician/ }).click();
  await expect(page.getByRole('button', { name: 'Refresh queue' })).toBeVisible();
  await review('desk');
  await page.getByRole('button', { name: /Open RSV-2481 from Maya/ }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  await review('ticket');
  await page.getByLabel('Message', { exact: true }).fill('Please confirm what you see.');
  await page.getByRole('button', { name: 'Send & wait for reply', exact: true }).click();
  await expect(page.locator('.ticket-workflow')).toContainText('waiting');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Sign out/ }).click();
  await page.getByRole('button', { name: /Requester/ }).click();
  await page.getByRole('button', { name: 'My requests', exact: true }).click();
  await expect(page.locator('.group-reply')).toContainText('RSV-2481');
  await review('action-needed');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /RSV-2481/ }).click();
  await expect(page.locator('.request-detail .col-title')).toBeFocused();
  await expect(page.locator('.request-detail .col-title')).toBeInViewport();
  await page.getByRole('button', { name: /^Sign out/ }).click();
  await page.getByRole('button', { name: /Administrator/ }).click();
  await expect(page.getByLabel('Answer text').first()).toBeVisible();
  await review('admin');
});
