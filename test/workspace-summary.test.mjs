import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.mjs';
import { generate } from '../src/synthetic.mjs';
test('workspace totals include runs beyond the 500-row ledger and separate reviewed ready runs', () => {
  const s = new Store(':memory:', { password: 'summary-test-password' });
  try {
    const bundle = generate(1);
    let first;
    for (let i = 0; i < 501; i++) {
      const run = s.createRun({ label: 'Run ' + i, bundle }, 'key-' + i, 'admin').run;
      first ??= run;
    }
    s.approve(first.id, first.reportHash, 'Manifest checked', 'admin');
    s.createRun({ label: 'Broken', bundle: generate(1, 'missing') }, 'broken', 'admin');
    assert.equal(s.listRuns().length, 500);
    assert.deepEqual(s.summary(), { total: 502, ready: 500, blocked: 1, approved: 1 });
  } finally {
    s.close();
  }
});
test('foreign database rejection leaves schema and stored content unchanged', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'cutover-foreign-'));
  const file = join(folder, 'foreign.sqlite');
  try {
    let db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES('application','another-tool'); CREATE TABLE important(value TEXT); INSERT INTO important VALUES('keep');",
    );
    const before = db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
    db.close();
    assert.throws(
      () => new Store(file, { password: 'foreign-test-password' }),
      /another application/,
    );
    db = new DatabaseSync(file);
    assert.deepEqual(db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all(), before);
    assert.equal(db.prepare('SELECT value FROM important').get().value, 'keep');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    db.close();
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
