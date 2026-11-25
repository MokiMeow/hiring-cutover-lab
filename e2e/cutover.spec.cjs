const { test: base, expect } = require(process.env.FLASHWRIGHT_TEST_PATH ?? '@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const errors = new WeakMap();
const password = 'local-test-password-29';
const test = base.extend({
  app: async ({}, use) => {
    const { createApp } = await import('../src/server.mjs');
    const database = path.resolve('artifacts', 'browser-' + randomUUID() + '.sqlite');
    const app = await createApp({ database, password });
    await app.listen(0);
    try {
      await use(app);
    } finally {
      await app.close();
      for (const suffix of ['', '-wal', '-shm']) await fs.rm(database + suffix, { force: true });
    }
  },
});
test.beforeEach(async ({ page, app }) => {
  errors.set(page, []);
  page.on('pageerror', (e) => errors.get(page).push(e.message));
  await page.goto(app.origin);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#workspace')).toBeVisible();
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
async function generate(page, scenario = 'clean') {
  await page.getByLabel('Scenario', { exact: true }).selectOption(scenario);
  await page.getByRole('button', { name: 'Generate and compare' }).click();
  await expect(page.locator('#detail')).toBeVisible();
}
test('administrator compares a complete cohort, approves it and downloads verified evidence', async ({
  page,
  app,
}) => {
  if (process.env.QA_INJECT_FAULT === '1')
    await page.route('**/api/runs', async (route) => {
      if (route.request().method() === 'POST') {
        console.log('QA_FAULT_APPLIED:run_rejected');
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Injected unavailable comparison' }),
        });
      }
      return route.continue();
    });
  await generate(page);
  await expect(page.locator('#detail-body')).toContainText('39 source records');
  await expect(page.locator('#detail-body')).toContainText('0 blocking issues');
  await page
    .getByLabel('Review evidence and reason')
    .fill('Independent synthetic manifest and mapping reviewed');
  await page.getByRole('button', { name: 'Approve rehearsal', exact: true }).click();
  await expect(page.locator('#detail-body')).toContainText('Reviewed by admin');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download report JSON' }).click();
  const download = await downloadPromise;
  const report = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(report.verdict).toBe('ready');
  expect(report.review.actor).toBe('admin');
  expect(report.evidence.bundleHash).toBe(
    app.store.run(app.store.listRuns()[0].id).report.evidence.bundleHash,
  );
  await page.getByRole('button', { name: 'Close report', exact: true }).click();
  await expect(page.locator('#stat-approved')).toHaveText('1');
});
test('a broken migration shows precise blocking differences and cannot be approved', async ({
  page,
  app,
}) => {
  await generate(page, 'mismatch');
  await expect(page.locator('#detail-body')).toContainText('Blocked');
  await expect(page.locator('#issues')).toContainText('FIELD_MISMATCH');
  await expect(page.locator('#issues')).toContainText('score');
  await expect(page.getByRole('button', { name: 'Approve rehearsal', exact: true })).toBeHidden();
  expect(app.store.listRuns()[0].verdict).toBe('blocked');
  await page.getByLabel('Filter issues').fill('nonexistent');
  await expect(page.locator('#issues tr')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail')).toBeHidden();
});
test('file import uses safe text rendering, search, CSV export and mobile containment', async ({
  page,
}) => {
  const { generate } = await import('../src/synthetic.mjs');
  const bundle = generate(2, 'mismatch');
  bundle.source.candidates[0].name = '<img src=x onerror=alert(1)>';
  bundle.target.candidates[0].name = bundle.source.candidates[0].name;
  await page.locator('#import-form').getByLabel('Rehearsal label').fill('<script>bad()</script>');
  await page.getByLabel('Canonical bundle (.json)').setInputFiles({
    name: 'cohort.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await page.getByRole('button', { name: 'Import and compare' }).click();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail-title')).toHaveText('<script>bad()</script>');
  expect(await page.locator('#detail-title script').count()).toBe(0);
  const promise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download issues CSV' }).click();
  const download = await promise;
  expect(await fs.readFile(await download.path(), 'utf8')).toContain('FIELD_MISMATCH');
  await page.keyboard.press('Escape');
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('absent');
  await expect(page.locator('#runs tr')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
});
test('administrator creates a viewer and the viewer can inspect but cannot create or approve', async ({
  page,
}) => {
  await generate(page);
  await page.keyboard.press('Escape');
  await page.locator('#team').getByText('Team access', { exact: true }).click();
  await page.getByLabel('New username').fill('reader');
  await page.getByLabel('Temporary password').fill(password);
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.locator('#members')).toContainText('reader');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('reader');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate and compare' })).toBeDisabled();
  await page.getByRole('button', { name: 'Open Hiring cohort rehearsal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve rehearsal', exact: true })).toBeHidden();
  await expect(page.locator('#detail-body')).toContainText('39 source records');
});
test('password rotation revokes the browser session and the new credential works', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Password', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('New password', { exact: true }).fill('changed-password-for-test');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.locator('#login')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('changed-password-for-test');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#workspace')).toBeVisible();
});
test('desktop uses reduced motion, makes no external requests and shows the complete workspace', async ({
  page,
}) => {
  const external = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:')) external.push(r.url());
  });
  await page.reload();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('h1').filter({ hasText: 'Rehearse the move.' })).toBeVisible();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });
  expect(external).toEqual([]);
});
test('a 3000-candidate cohort completes through HTTP, SQLite, browser review and bundle export', async ({
  page,
  app,
}) => {
  await page.getByLabel('Candidates', { exact: true }).fill('3000');
  await generate(page);
  await expect(page.locator('#detail-body')).toContainText('9003 source records');
  await expect(page.locator('#detail-body')).toContainText('9003 records match');
  await page
    .getByLabel('Review evidence and reason')
    .fill('Large synthetic cohort manifest reviewed');
  await page.getByRole('button', { name: 'Approve rehearsal', exact: true }).click();
  await expect(page.locator('#detail-body')).toContainText('Reviewed by admin');
  const promise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download input bundle' }).click();
  const downloaded = await promise;
  const bundle = JSON.parse(await fs.readFile(await downloaded.path(), 'utf8'));
  expect(bundle.source.candidates.length).toBe(3000);
  expect(bundle.target.assessments.length).toBe(3000);
  expect(app.store.run(app.store.listRuns()[0].id).report.summary.blockingIssues).toBe(0);
  await page.getByRole('button', { name: 'Close report', exact: true }).click();
  await page.screenshot({ path: 'artifacts/populated-desktop.png', fullPage: true });
});
