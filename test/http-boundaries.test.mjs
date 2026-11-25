import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.mjs';
import { generate } from '../src/synthetic.mjs';
test('HTTP rejects malformed bodies and unsupported methods, requires auth for exports and returns the exact bundle', async () => {
  const app = await createApp({ database: ':memory:', password: 'boundary-test-password' });
  await app.listen(0);
  try {
    const post = (path, body, headers = {}) =>
      fetch(app.origin + path, {
        method: 'POST',
        headers: { origin: app.origin, 'content-type': 'application/json', ...headers },
        body,
      });
    for (const [value, status] of [
      ['{', 400],
      ['null', 422],
      ['[]', 422],
    ])
      assert.equal((await post('/api/runs', value)).status, status);
    assert.equal((await fetch(app.origin + '/api/runs/unknown/report')).status, 401);
    assert.equal((await fetch(app.origin + '/api/runs', { method: 'PUT' })).status, 405);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = http.get(app.origin + '/healthz', { headers: { host: 'evil.test' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
    });
    assert.equal(wrongHost, 403);
    const login = await post(
        '/api/login',
        JSON.stringify({ username: 'admin', password: 'boundary-test-password' }),
      ),
      session = await login.json(),
      headers = {
        cookie: login.headers.get('set-cookie').split(';')[0],
        'x-csrf-token': session.csrf,
      };
    const bundle = generate(3, 'mismatch'),
      saved = await post('/api/runs', JSON.stringify({ label: 'Exact evidence', bundle }), {
        ...headers,
        'idempotency-key': 'exact-evidence',
      }),
      run = (await saved.json()).run;
    assert.equal(saved.status, 201);
    const read = await fetch(app.origin + '/api/runs/' + run.id + '/bundle', { headers });
    assert.match(read.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(await read.json(), bundle);
    const csv = await fetch(app.origin + '/api/runs/' + run.id + '/csv', { headers });
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(await csv.text(), /FIELD_MISMATCH/);
    assert.equal((await fetch(app.origin + '/contract.json')).status, 200);
    assert.equal((await post('/api/logout', '{}', headers)).status, 200);
    assert.equal((await fetch(app.origin + '/api/me', { headers })).status, 401);
  } finally {
    await app.close();
  }
});
