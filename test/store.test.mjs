import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { generate } from '../src/synthetic.mjs';
import { reportCSV, csvCell } from '../src/export.mjs';
const password = 'local-test-password-29';
test('immutable run persists, deduplicates and requires matching report evidence for approval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutover-test-'));
  let s = new Store(join(dir, 'test.sqlite'), { password });
  try {
    const bundle = generate(2);
    const first = s.createRun({ label: 'Known cohort', bundle }, 'request-1', 'admin');
    assert.equal(first.created, true);
    assert.equal(first.run.report.verdict, 'ready');
    assert.equal(
      s.createRun({ label: 'Known cohort', bundle }, 'request-1', 'admin').created,
      false,
    );
    assert.throws(
      () => s.createRun({ label: 'Different', bundle }, 'request-1', 'admin'),
      /already used/,
    );
    assert.throws(() => s.approve(first.run.id, 'stale', 'Verified manifest', 'admin'), /changed/);
    assert.throws(() => s.approve(first.run.id, first.run.reportHash, '', 'admin'), /reason/);
    s.approve(first.run.id, first.run.reportHash, 'Verified against independent manifest', 'admin');
    assert.equal(s.run(first.run.id).review.actor, 'admin');
    assert.throws(() => s.approve(first.run.id, first.run.reportHash, 'Again', 'admin'), /already/);
    await s.backup(join(dir, 'backup.sqlite'));
    s.close();
    s = new Store(join(dir, 'backup.sqlite'), { password });
    assert.deepEqual(s.run(first.run.id).bundle, bundle);
    assert.equal(s.listAudit()[0].action, 'rehearsal_approved');
  } finally {
    s.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('blocked runs cannot be approved and tampered reports fail closed', () => {
  const s = new Store(':memory:', { password });
  try {
    const r = s.createRun(
      { label: 'Missing record', bundle: generate(2, 'missing') },
      'key',
      'admin',
    ).run;
    assert.equal(r.report.verdict, 'blocked');
    assert.throws(() => s.approve(r.id, r.reportHash, 'Reviewed', 'admin'), /blocked/);
    s.db.prepare('UPDATE runs SET report=? WHERE id=?').run('{}', r.id);
    assert.throws(() => s.run(r.id), /integrity/);
  } finally {
    s.close();
  }
});
test('CSV quotes cells and neutralizes formula prefixes including whitespace', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('  @SUM(A1)'), '"\'  @SUM(A1)"');
  assert.equal(csvCell('Casey "Example"'), '"Casey ""Example"""');
  assert.match(reportCSV({ issues: [{ actual: '-42' }] }), /"'-42"/);
});
test('synthetic generator has independently expected sizes and every fault blocks', () => {
  for (const kind of ['clean', 'missing', 'mismatch', 'orphan', 'duplicate']) {
    const s = new Store(':memory:', { password });
    try {
      const r = s.createRun({ label: kind, bundle: generate(10, kind) }, kind, 'admin').run;
      assert.equal(r.report.verdict, kind === 'clean' ? 'ready' : 'blocked');
      assert.equal(r.report.summary.sourceRecords, 33);
    } finally {
      s.close();
    }
  }
});
