import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/engine.mjs';
import { knownBundle } from './fixture.mjs';
test('complete mapped snapshots match six known records and allow a rehearsal review', () => {
  const report = reconcile(knownBundle());
  assert.equal(report.verdict, 'ready');
  assert.equal(report.summary.sourceRecords, 6);
  assert.equal(report.summary.comparedRecords, 6);
  assert.equal(report.issues.length, 0);
  assert.match(report.evidence.bundleHash, /^[a-f0-9]{64}$/);
});

const mutations = [
  [
    'empty snapshots',
    (b) => {
      for (const side of ['source', 'target'])
        for (const kind of ['jobs', 'candidates', 'applications', 'assessments']) {
          b[side][kind] = [];
          b[side].expectedCounts[kind] = 0;
        }
      for (const kind of Object.keys(b.mapping)) b.mapping[kind] = [];
    },
  ],
  [
    'missing completeness manifest',
    (b) => {
      delete b.source.expectedCounts;
    },
  ],
  [
    'export count mismatch',
    (b) => {
      b.source.expectedCounts.candidates = 3;
    },
  ],
  [
    'duplicate source identity',
    (b) => {
      b.source.candidates.push({ ...b.source.candidates[0] });
      b.source.expectedCounts.candidates++;
    },
  ],
  [
    'duplicate target identity',
    (b) => {
      b.target.candidates.push({ ...b.target.candidates[0] });
      b.target.expectedCounts.candidates++;
    },
  ],
  [
    'duplicate mapping',
    (b) => {
      b.mapping.jobs.push({ ...b.mapping.jobs[0] });
    },
  ],
  [
    'unmapped extra target',
    (b) => {
      b.target.candidates.push({ id: 'extra', name: 'Extra Example', email: 'extra@example.test' });
      b.target.expectedCounts.candidates++;
    },
  ],
  [
    'unsupported fields cannot be silently ignored',
    (b) => {
      b.source.candidates[0].unsupported = 'not compared';
      b.target.candidates[0].unsupported = 'not compared';
    },
  ],
  [
    'completed score exceeds maximum in both snapshots',
    (b) => {
      b.source.assessments[0].score = 101;
      b.target.assessments[0].score = 101;
    },
  ],
  [
    'unknown application status',
    (b) => {
      b.source.applications[0].status = 'mystery';
      b.target.applications[0].status = 'mystery';
    },
  ],
  [
    'missing required fields on both sides',
    (b) => {
      delete b.source.candidates[0].name;
      delete b.target.candidates[0].name;
    },
  ],
  [
    'non-synthetic data',
    (b) => {
      b.source.synthetic = false;
    },
  ],
];
for (const [name, mutate] of mutations)
  test(name + ' blocks a rehearsal', () => {
    const b = knownBundle();
    mutate(b);
    const report = reconcile(b);
    assert.equal(report.verdict, 'blocked');
    assert.ok(report.issues.length > 0);
  });

test('score mismatch reports the independently known old and new values', () => {
  const b = knownBundle();
  b.target.assessments[0].score = 84;
  const report = reconcile(b);
  assert.equal(report.verdict, 'blocked');
  assert.ok(
    report.issues.some(
      (issue) =>
        issue.kind === 'assessments' &&
        issue.field === 'score' &&
        issue.expected === 85 &&
        issue.actual === 84,
    ),
  );
});
