import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/synthetic.mjs';
import { reconcile, InputError } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';
import { scryptSync } from 'node:crypto';
test('a seeded matrix of 240 broken migrations never produces a ready verdict', () => {
  let checked = 0;
  for (let n = 1; n <= 60; n++)
    for (const scenario of ['missing', 'mismatch', 'orphan', 'duplicate']) {
      const b = generate(n, scenario);
      const r = reconcile(b);
      assert.equal(r.verdict, 'blocked', n + ':' + scenario);
      assert.ok(r.summary.blockingIssues > 0);
      checked++;
    }
  assert.equal(checked, 240);
});
test('all four source scopes and target extras require explicit one-to-one mappings', () => {
  for (const kind of ['jobs', 'candidates', 'applications', 'assessments']) {
    const b = generate(3);
    b.mapping[kind].pop();
    assert.equal(reconcile(b).verdict, 'blocked');
    const c = generate(3);
    const extra = structuredClone(c.target[kind][0]);
    extra.id = 'unexpected';
    c.target[kind].push(extra);
    c.target.expectedCounts[kind]++;
    assert.equal(reconcile(c).verdict, 'blocked');
  }
});
test('issue cap retains the full failure count and cannot turn a large failure into a pass', () => {
  const b = generate(1000);
  for (const row of b.target.candidates) {
    row.name = 'Different name';
    row.email = 'different@example.test';
  }
  for (const row of b.target.applications) row.stage = 'Changed';
  const r = reconcile(b);
  assert.equal(r.summary.blockingIssues, 3000);
  assert.equal(r.issues.length, 2000);
  assert.equal(r.summary.issuesTruncated, true);
  assert.equal(r.verdict, 'blocked');
});
test('resource limits reject excessive node counts, large arrays and invalid JSON values', () => {
  const b = generate(3);
  b.rules.extra = Array(200001).fill(null);
  assert.throws(() => reconcile(b), InputError);
  const c = generate(1);
  c.source.jobs = Array(20001).fill(null);
  assert.throws(() => reconcile(c), InputError);
  assert.throws(() => reconcile({ x: 'a'.repeat(8388609) }), InputError);
  for (const v of [null, [], true, 1, 'text']) assert.throws(() => reconcile(v), InputError);
});
test('schema and policy inputs fail closed without prototype pollution', () => {
  for (const mutate of [
    (b) => (b.schemaVersion = 2),
    (b) => (b.rules = { stageMap: [] }),
    (b) => (b.rules = { stageMap: { '': 42 } }),
    (b) => (b.source.jobs[0].title = ''),
    (b) => b.mapping.jobs.push({ sourceId: 'j1', targetId: 'new-j1', extra: true }),
    (b) => (b.source.candidates[0].id = 'bad id'),
  ]) {
    const b = generate(3);
    mutate(b);
    assert.equal(reconcile(b).verdict, 'blocked');
  }
  const b = generate(3);
  b.rules = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal(reconcile(b).verdict, 'blocked');
  assert.equal({}.polluted, undefined);
});
test('successful legacy sign-in upgrades the hash and expired sessions are rejected', () => {
  let now = 100000;
  const s = new Store(':memory:', { password: 'bootstrap-password-long', clock: () => now });
  try {
    const salt = '0123456789abcdef0123456789abcdef';
    s.db
      .prepare('UPDATE users SET password=?')
      .run(salt + ':' + scryptSync('legacy-password-long', salt, 64).toString('hex'));
    const login = s.login('admin', 'legacy-password-long', 'loopback');
    assert.match(s.db.prepare('SELECT password FROM users').get().password, /^\$argon2id\$/);
    assert.equal(s.session(login.token).role, 'admin');
    now += 14400001;
    assert.throws(() => s.session(login.token), /expired/);
    for (let i = 0; i < 8; i++)
      assert.throws(() => s.login('unknown', 'incorrect', 'bad-address'), /Invalid/);
    assert.throws(() => s.login('unknown', 'incorrect', 'bad-address'), /Too many/);
  } finally {
    s.close();
  }
});
