const { test: base, expect } = require(process.env.FLASHWRIGHT_TEST_PATH ?? '@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const fs = require('node:fs/promises');
const password = 'local-test-password-29';
const errors = new WeakMap();
const test = base.extend({
  app: async ({}, use) => {
    const { createApp } = await import('../src/server.mjs');
    const app = await createApp({ database: ':memory:', password });
    await app.listen(0);
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});
async function signIn(page, username = 'admin') {
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
}
test.beforeEach(async ({ page, app }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page).push(error.message));
  await page.goto(app.origin);
  await signIn(page);
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
async function noOverflow(page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'document must stay inside its viewport',
  ).toBe(true);
}
async function scan(page, name) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  await fs.mkdir('artifacts/accessibility', { recursive: true });
  await fs.writeFile(
    'artifacts/accessibility/' + name + '.json',
    JSON.stringify(
      {
        url: page.url(),
        violations: result.violations,
        incomplete: result.incomplete,
        passes: result.passes.map((rule) => rule.id),
      },
      null,
      2,
    ),
  );
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
test('workspace forms, evidence and team controls reflow across seven widths with accessible keyboard dialogs', async ({
  page,
  app,
}) => {
  test.setTimeout(90000);
  const { generate } = await import('../src/synthetic.mjs'),
    label = 'A'.repeat(100),
    username = 'u'.repeat(60);
  app.store.createRun({ label, bundle: generate(2, 'mismatch') }, 'responsive-case', 'admin');
  app.store.createUser({ username, password, role: 'viewer' }, 'admin');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open ' + label, exact: true })).toBeVisible();
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    for (const selector of ['#generate-submit', '#import-submit', '#password-open', '#logout']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    await page.locator('#team>summary').click();
    await noOverflow(page);
    const disable = page.getByRole('button', { name: 'Disable ' + username, exact: true });
    expect((await disable.boundingBox()).width).toBeLessThan(width);
    await page.locator('#team>summary').click();
    await page.getByRole('button', { name: 'Open ' + label, exact: true }).click();
    await expect(page.locator('#detail')).toBeVisible();
    await noOverflow(page);
    const bounds = await page.locator('#detail').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#detail'))).toBe(true);
    if (width === 390 || width === 1440) await scan(page, 'cutover-details-' + width);
    await page.screenshot({
      path: 'artifacts/ui-round2/details-' + width + '.png',
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#detail')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open ' + label, exact: true })).toBeFocused();
    await page.screenshot({
      path: 'artifacts/ui-round2/workspace-' + width + '.png',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 640, height: 450 });
  await noOverflow(page);
  await page.getByRole('button', { name: 'Password', exact: true }).click();
  await expect(page.locator('#password-dialog')).toBeVisible();
  await scan(page, 'cutover-password-reflow');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#team>summary').click();
  await scan(page, 'cutover-team-mobile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#login')).toBeVisible();
  await scan(page, 'cutover-login-mobile');
  const ids = await page.locator('[id]').evaluateAll((nodes) => nodes.map((n) => n.id));
  expect(new Set(ids).size).toBe(ids.length);
});
test('malformed UTF-8 file is rejected visibly without creating a rehearsal', async ({
  page,
  app,
}) => {
  const { generate } = await import('../src/synthetic.mjs'),
    bundle = generate(1);
  bundle.source.candidates[0].name = bundle.target.candidates[0].name = 'BYTE_A';
  const bytes = Buffer.from(JSON.stringify(bundle));
  let at = -1;
  for (const byte of [0x80, 0x81]) {
    at = bytes.indexOf('BYTE_A', at + 1);
    bytes[at] = byte;
  }
  await page
    .getByLabel('Canonical bundle (.json)')
    .setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: bytes });
  await page.getByRole('button', { name: 'Import and compare' }).click();
  await expect(page.locator('#import-error')).toContainText('UTF-8');
  await expect(page.getByLabel('Canonical bundle (.json)')).toHaveAttribute('aria-invalid', 'true');
  expect(app.store.listRuns()).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Import and compare' })).toBeEnabled();
});
test('lost comparison response keeps input and retries the same request without duplicate runs', async ({
  page,
  app,
}) => {
  let firstKey;
  await page.route('**/api/runs', async (route) => {
    if (route.request().method() === 'POST') {
      firstKey = route.request().headers()['idempotency-key'];
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Generate and compare' }).click();
  await expect(page.locator('#generate-error')).toContainText('Connection lost');
  expect(app.store.listRuns()).toHaveLength(1);
  await expect(page.locator('#generate-form input[name=label]')).toHaveValue(
    'Hiring cohort rehearsal',
  );
  await expect(page.locator('#generate-form input[name=label]')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.unroute('**/api/runs');
  const requestPromise = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/api/runs'),
  );
  await page.getByRole('button', { name: 'Generate and compare' }).click();
  expect((await requestPromise).headers()['idempotency-key']).toBe(firstKey);
  await expect(page.locator('#detail')).toBeVisible();
  expect(app.store.listRuns()).toHaveLength(1);
});
test('expired sessions close open dialogs and clear the workspace before sign-in', async ({
  page,
  app,
}) => {
  await page.getByRole('button', { name: 'Password', exact: true }).click();
  app.store.db.prepare('DELETE FROM sessions').run();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('New password', { exact: true }).fill('next-password-for-test');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#password-dialog')).toBeHidden();
  await expect(page.locator('#workspace-nav')).toBeHidden();
  await expect(page.locator('#login-error')).toContainText('session');
  await expect(page.locator('#password-form input[name=currentPassword]')).toHaveValue('');
  await expect(page.locator('#password-form input[name=newPassword]')).toHaveValue('');
});
test('older refresh and unauthorized responses cannot suppress or sign out a newer session', async ({
  page,
  app,
}) => {
  test.setTimeout(30000);
  app.store.createUser({ username: 'reader', password, role: 'viewer' }, 'admin');
  const { generate } = await import('../src/synthetic.mjs');
  app.store.createRun(
    { label: 'Visible after account switch', bundle: generate(1) },
    'switch-fixture',
    'admin',
  );
  let release, started;
  const oldStarted = new Promise((resolve) => (started = resolve)),
    hold = new Promise((resolve) => (release = resolve));
  let held = false;
  await page.route('**/api/runs', async (route) => {
    if (!held && route.request().method() === 'GET') {
      held = true;
      started();
      await hold;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Expired earlier session' }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await oldStarted;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#login')).toBeVisible();
  await signIn(page, 'reader');
  await expect(
    page.getByRole('button', { name: 'Open Visible after account switch', exact: true }),
  ).toBeVisible();
  const oldResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/runs') && response.status() === 401,
  );
  release();
  await (await oldResponsePromise).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('#identity')).toContainText('reader / viewer');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('#stat-total')).toHaveText('1');
  await page.unroute('**/api/runs');
});
test('team revocation records a reason, ends access and protects the final administrator', async ({
  page,
  app,
}) => {
  await page.locator('#team>summary').click();
  await page.getByLabel('New username').fill('temporary-member');
  await page.getByLabel('Temporary password').fill(password);
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.locator('#team-status')).toContainText('temporary-member');
  await page.getByRole('button', { name: 'Disable temporary-member', exact: true }).click();
  await page.getByLabel('Reason for disabling access').fill('Synthetic access review complete');
  await page.getByRole('button', { name: 'Disable access', exact: true }).click();
  await expect(page.locator('#disable-dialog')).toBeHidden();
  expect(app.store.users().find((u) => u.username === 'temporary-member').active).toBe(0);
  await expect(page.locator('#team>summary')).toBeFocused();
  await page.getByRole('button', { name: 'Disable admin', exact: true }).click();
  await page.getByLabel('Reason for disabling access').fill('Must stay protected');
  await page.getByRole('button', { name: 'Disable access', exact: true }).click();
  await expect(page.locator('#disable-error')).toContainText('last administrator');
  await expect(page.locator('#disable-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
});
test('late detail responses cannot replace the selected rehearsal or redirect its approval', async ({
  page,
  app,
}) => {
  const { generate } = await import('../src/synthetic.mjs');
  const a = app.store.createRun(
      { label: 'Earlier cohort', bundle: generate(1) },
      'earlier',
      'admin',
    ).run,
    b = app.store.createRun(
      { label: 'Selected cohort', bundle: generate(2) },
      'selected',
      'admin',
    ).run;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Earlier cohort', exact: true }),
  ).toBeVisible();
  let release, started;
  const startedPromise = new Promise((resolve) => (started = resolve)),
    hold = new Promise((resolve) => (release = resolve));
  await page.route('**/api/runs/' + a.id, async (route) => {
    const response = await route.fetch();
    started();
    await hold;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Open Earlier cohort', exact: true }).click();
  await startedPromise;
  await page.getByRole('button', { name: 'Open Selected cohort', exact: true }).click();
  await expect(page.locator('#detail-title')).toHaveText('Selected cohort');
  await page.getByLabel('Review evidence and reason').fill('Selected cohort manifest verified');
  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/runs/' + a.id));
  release();
  await (await responsePromise).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('#detail-title')).toHaveText('Selected cohort');
  await page.getByRole('button', { name: 'Approve rehearsal', exact: true }).click();
  await expect(page.locator('#detail-body')).toContainText('Reviewed by admin');
  expect(app.store.run(a.id).review).toBeNull();
  expect(app.store.run(b.id).review.reason).toBe('Selected cohort manifest verified');
  await page.getByRole('button', { name: 'Close report', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Selected cohort', exact: true }),
  ).toBeFocused();
});
test('malformed initial session responses cannot clear a newer signed-in account', async ({
  page,
  app,
}) => {
  app.store.createUser({ username: 'reader', password, role: 'viewer' }, 'admin');
  let release, started;
  const hold = new Promise((resolve) => (release = resolve)),
    ready = new Promise((resolve) => (started = resolve));
  await page.route('**/api/me', async (route) => {
    started();
    await hold;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
  });
  await page.reload();
  await ready;
  await signIn(page, 'reader');
  const oldResponse = page.waitForResponse((response) => response.url().endsWith('/api/me'));
  release();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('#identity')).toContainText('reader / viewer');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();
});
test('a failed earlier review cannot overwrite or unlock a different review context', async ({
  page,
  app,
}) => {
  const { generate } = await import('../src/synthetic.mjs');
  const a = app.store.createRun(
      { label: 'First review', bundle: generate(1) },
      'review-a',
      'admin',
    ).run,
    b = app.store.createRun(
      { label: 'Second review', bundle: generate(2) },
      'review-b',
      'admin',
    ).run;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Open First review', exact: true }).click();
  await page.getByLabel('Review evidence and reason').fill('First manifest review');
  let release, started;
  const hold = new Promise((resolve) => (release = resolve)),
    ready = new Promise((resolve) => (started = resolve));
  await page.route('**/api/runs/' + a.id + '/approve', async (route) => {
    started();
    await hold;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Earlier review rejected' }),
    });
  });
  await page.getByRole('button', { name: 'Approve rehearsal', exact: true }).click();
  await ready;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Second review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve rehearsal', exact: true })).toBeEnabled();
  await page.getByLabel('Review evidence and reason').fill('Second manifest review');
  const oldResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/runs/' + a.id + '/approve'),
  );
  release();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('#detail-title')).toHaveText('Second review');
  await expect(page.locator('#review-error')).toBeEmpty();
  await expect(page.getByLabel('Review evidence and reason')).toHaveValue('Second manifest review');
  await page.getByRole('button', { name: 'Approve rehearsal', exact: true }).click();
  await expect(page.locator('#detail-body')).toContainText('Reviewed by admin');
  expect(app.store.run(a.id).review).toBeNull();
  expect(app.store.run(b.id).review.reason).toBe('Second manifest review');
});
test('late member revocation responses preserve a newer member dialog and its draft', async ({
  page,
  app,
}) => {
  for (const username of ['member-a', 'member-b'])
    app.store.createUser({ username, password, role: 'viewer' }, 'admin');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('#team>summary').click();
  const a = app.store.users().find((u) => u.username === 'member-a'),
    b = app.store.users().find((u) => u.username === 'member-b');
  let release, started;
  const hold = new Promise((resolve) => (release = resolve)),
    ready = new Promise((resolve) => (started = resolve));
  await page.route('**/api/users/' + a.id + '/disable', async (route) => {
    const response = await route.fetch();
    started();
    await hold;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Disable member-a', exact: true }).click();
  await page.getByLabel('Reason for disabling access').fill('Remove first member');
  await page.getByRole('button', { name: 'Disable access', exact: true }).click();
  await ready;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Disable member-b', exact: true }).click();
  await page.getByLabel('Reason for disabling access').fill('Keep this second draft');
  await expect(page.getByRole('button', { name: 'Disable access', exact: true })).toBeEnabled();
  const prior = page.waitForResponse((response) =>
    response.url().endsWith('/api/users/' + a.id + '/disable'),
  );
  release();
  await (await prior).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator('#disable-dialog')).toBeVisible();
  await expect(page.locator('#disable-description')).toContainText('member-b');
  await expect(page.getByLabel('Reason for disabling access')).toHaveValue(
    'Keep this second draft',
  );
  expect(app.store.users().find((u) => u.id === a.id).active).toBe(0);
  expect(app.store.users().find((u) => u.id === b.id).active).toBe(1);
  await page.keyboard.press('Escape');
});
test('an initial unauthorized session check preserves credentials already being entered', async ({
  page,
}) => {
  let release, started;
  const hold = new Promise((resolve) => (release = resolve)),
    ready = new Promise((resolve) => (started = resolve));
  await page.route('**/api/me', async (route) => {
    started();
    await hold;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'No existing session' }),
    });
  });
  await page.reload();
  await ready;
  await page.getByLabel('Password', { exact: true }).fill(password);
  const prior = page.waitForResponse((response) => response.url().endsWith('/api/me'));
  release();
  await (await prior).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#identity')).toContainText('admin / admin');
});
