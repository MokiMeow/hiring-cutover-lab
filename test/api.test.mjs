import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { generate } from '../src/synthetic.mjs';
const password = 'local-test-password-29';
async function fixture(fn) {
  const app = await createApp({ database: ':memory:', password });
  await app.listen(0);
  let cookie = '',
    csrf = '';
  const call = async (path, body, extra = {}) => {
    const r = await fetch(app.origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined
          ? {}
          : { origin: app.origin, 'content-type': 'application/json', 'x-csrf-token': csrf }),
        cookie,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await r.json();
    if (path === '/api/login' && r.ok) {
      cookie = r.headers.get('set-cookie').split(';')[0];
      csrf = data.csrf;
    }
    return { status: r.status, data, headers: r.headers };
  };
  try {
    await fn({ app, call });
  } finally {
    await app.close();
  }
}
test('authenticated API creates, reads, downloads and reviews a complete synthetic rehearsal', () =>
  fixture(async ({ call }) => {
    assert.equal((await call('/api/runs')).status, 401);
    assert.equal((await call('/api/login', { username: 'admin', password })).status, 200);
    const { status, data } = await call(
      '/api/runs',
      { label: 'API cohort', bundle: generate(3) },
      { 'idempotency-key': 'api-1' },
    );
    assert.equal(status, 201);
    const id = data.run.id;
    assert.equal((await call('/api/runs/' + id)).data.report.verdict, 'ready');
    assert.equal(
      (
        await call('/api/runs/' + id + '/approve', {
          reportHash: data.run.reportHash,
          reason: 'Manifest reviewed',
        })
      ).status,
      200,
    );
    assert.equal((await call('/api/audit')).data[0].action, 'rehearsal_approved');
  }));
test('API enforces same-origin JSON, CSRF, roles and blocked approval', () =>
  fixture(async ({ call }) => {
    await call('/api/login', { username: 'admin', password });
    assert.equal((await call('/api/runs', {}, { origin: 'https://attacker.test' })).status, 403);
    assert.equal((await call('/api/runs', {}, { 'x-csrf-token': 'wrong' })).status, 403);
    const bad = await call(
      '/api/runs',
      { label: 'Broken', bundle: generate(3, 'missing') },
      { 'idempotency-key': 'bad' },
    );
    assert.equal(bad.status, 201);
    assert.equal(
      (
        await call('/api/runs/' + bad.data.run.id + '/approve', {
          reportHash: bad.data.run.reportHash,
          reason: 'Cannot bypass',
        })
      ).status,
      409,
    );
    assert.equal(
      (await call('/api/users', { username: 'viewer', password, role: 'viewer' })).status,
      201,
    );
    await call('/api/login', { username: 'viewer', password });
    assert.equal((await call('/api/runs')).status, 200);
    assert.equal(
      (await call('/api/runs', { label: 'No', bundle: generate(1) }, { 'idempotency-key': 'no' }))
        .status,
      403,
    );
    assert.equal((await call('/api/users')).status, 403);
  }));
test('health, security headers, input limits and static allowlist behave correctly', () =>
  fixture(async ({ call, app }) => {
    const h = await call('/healthz');
    assert.equal(h.status, 200);
    assert.match(h.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await call('/src/engine.mjs')).status, 401);
    await call('/api/login', { username: 'admin', password });
    assert.equal((await call('/api/no-such-route')).status, 404);
    assert.equal(
      (
        await call(
          '/api/runs',
          { label: 'x', bundle: { schemaVersion: 1 } },
          { 'idempotency-key': 'invalid' },
        )
      ).status,
      201,
    );
    const r = await fetch(app.origin + '/api/runs', {
      method: 'POST',
      headers: { origin: app.origin, 'content-type': 'application/json' },
      body: 'x'.repeat(8388609),
    });
    assert.equal(r.status, 413);
  }));
test('password rotation and disabling users revoke sessions and protect the last admin', () =>
  fixture(async ({ call }) => {
    await call('/api/login', { username: 'admin', password });
    const me = (await call('/api/me')).data;
    assert.equal(
      (await call('/api/users/' + me.user.id + '/disable', { reason: 'Should fail' })).status,
      409,
    );
    await call('/api/users', { username: 'second', password, role: 'admin' });
    const users = (await call('/api/users')).data;
    assert.equal(
      (
        await call('/api/users/' + users.find((u) => u.username === 'second').id + '/disable', {
          reason: 'No longer needed',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call('/api/password', {
          currentPassword: password,
          newPassword: 'rotated-test-password-30',
        })
      ).status,
      200,
    );
    assert.equal((await call('/api/me')).status, 401);
    assert.equal(
      (await call('/api/login', { username: 'admin', password: 'rotated-test-password-30' }))
        .status,
      200,
    );
  }));
