import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { generate } from '../src/synthetic.mjs';
function brokenBytes(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  let offset = -1;
  for (const byte of [0x80, 0x81]) {
    offset = bytes.indexOf('BYTE_A', offset + 1);
    assert.ok(offset >= 0);
    bytes[offset] = byte;
  }
  return bytes;
}
test('HTTP refuses malformed UTF-8 instead of hiding different source and target bytes', async () => {
  const app = await createApp({ database: ':memory:', password: 'ingestion-test-password' });
  await app.listen(0);
  try {
    const bundle = generate(1);
    bundle.source.candidates[0].name = bundle.target.candidates[0].name = 'BYTE_A';
    const response = await fetch(app.origin + '/api/runs', {
      method: 'POST',
      headers: { origin: app.origin, 'content-type': 'application/json' },
      body: brokenBytes({ label: 'Broken encoding', bundle }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /UTF-8/);
    assert.equal(app.store.listRuns().length, 0);
  } finally {
    await app.close();
  }
});
test('CLI rejects malformed UTF-8 and still accepts valid Unicode with a UTF-8 BOM', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cutover-encoding-'));
  try {
    const file = join(dir, 'cohort.json'),
      bundle = generate(1);
    bundle.source.candidates[0].name = bundle.target.candidates[0].name = 'BYTE_A';
    await fs.writeFile(file, brokenBytes(bundle));
    let result = spawnSync(process.execPath, ['src/cli.mjs', 'compare', file], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /UTF-8/);
    bundle.source.candidates[0].name = bundle.target.candidates[0].name = 'Renée 李';
    await fs.writeFile(
      file,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(bundle))]),
    );
    result = spawnSync(process.execPath, ['src/cli.mjs', 'compare', file], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).verdict, 'ready');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('failed audit writes roll back account creation and login state changes', () => {
  const store = new Store(':memory:', { password: 'rollback-test-password' });
  try {
    store.db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    assert.throws(() =>
      store.createUser(
        { username: 'new-member', password: 'new-member-password-long', role: 'operator' },
        'admin',
      ),
    );
    assert.equal(store.users().length, 1);
    assert.throws(() => store.login('admin', 'rollback-test-password', 'loopback'));
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  } finally {
    store.close();
  }
});
