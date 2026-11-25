import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, InputError } from '../src/engine.mjs';
import { knownBundle } from './fixture.mjs';
for (const [name, mutate] of [
  ['orphan source relation', (b) => (b.source.applications[0].candidateId = 'missing')],
  ['wrong mapped target relation', (b) => (b.target.applications[0].candidateId = 'candidate-2')],
  ['mapping collision', (b) => (b.mapping.candidates[1].targetId = 'candidate-1')],
  ['dangling mapping', (b) => (b.mapping.candidates[0].targetId = 'missing')],
  [
    'pending score',
    (b) => {
      b.source.assessments[0].status = 'reports_pending';
      b.target.assessments[0].status = 'reports_pending';
    },
  ],
  ['invalid boolean policy', (b) => (b.rules.trimDisplayText = 'yes')],
  ['null snapshot', (b) => (b.target = null)],
  [
    'unsafe email',
    (b) => {
      b.source.candidates[0].email = 'real@example.org';
      b.target.candidates[0].email = 'real@example.org';
    },
  ],
  ['unknown mapping scope', (b) => (b.mapping.attachments = [])],
  ['missing mapping', (b) => delete b.mapping.jobs],
])
  test(name + ' blocks readiness', () => {
    const b = knownBundle();
    mutate(b);
    assert.equal(reconcile(b).verdict, 'blocked');
  });
test('canonical hashes are independent of object key order and repeatable', () => {
  const b = knownBundle(),
    a = reconcile(b),
    c = reconcile(JSON.parse(JSON.stringify(b)));
  assert.deepEqual(a, c);
  const reversed = Object.fromEntries(Object.entries(b).reverse());
  assert.equal(a.evidence.bundleHash, reconcile(reversed).evidence.bundleHash);
});
test('stage transformations are explicit and unsupported values are blocked', () => {
  const b = knownBundle();
  delete b.rules.stageMap;
  assert.equal(reconcile(b).verdict, 'blocked');
  b.rules.stageMap = { Technical: 'Technical interview' };
  assert.equal(reconcile(b).verdict, 'ready');
});
test('display trim is opt-in and does not change email matching', () => {
  const b = knownBundle();
  b.target.candidates[0].name += ' ';
  assert.equal(reconcile(b).verdict, 'blocked');
  b.rules.trimDisplayText = true;
  assert.equal(reconcile(b).verdict, 'ready');
  b.target.candidates[0].email = 'other@example.test';
  assert.equal(reconcile(b).verdict, 'blocked');
});
test('deep and nonfinite inputs fail with controlled input errors', () => {
  const b = knownBundle();
  let nested = {};
  for (let i = 0; i < 12; i++) nested = { a: nested };
  b.rules.nested = nested;
  assert.throws(() => reconcile(b), InputError);
  assert.throws(() => reconcile({ schemaVersion: Infinity }), InputError);
});
