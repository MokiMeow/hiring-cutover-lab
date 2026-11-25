import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuration } from '../src/main.mjs';
test('startup is fail-closed without a bootstrap password and accepts only bounded ports', () => {
  assert.throws(() => configuration({}, []), /BOOTSTRAP_PASSWORD/);
  for (const port of ['0', '-1', '65536', 'NaN', '1.5'])
    assert.throws(() => configuration({ PORT: port }, ['--demo']), /PORT/);
  assert.throws(() => configuration({}, ['--live']), /Only/);
  const c = configuration(
    { CUTOVER_BOOTSTRAP_PASSWORD: 'fresh-test-password-123', PORT: '4314' },
    [],
  );
  assert.equal(c.port, 4314);
  assert.equal(c.password, 'fresh-test-password-123');
  assert.equal(c.demo, false);
});
test('fresh demo generates a bounded random credential and never enables a live mode', () => {
  const c = configuration({ CUTOVER_DATABASE: 'artifacts/config-never-opened.sqlite' }, ['--demo']);
  assert.ok(c.password.length >= 16 && c.password.length <= 128);
  assert.equal(c.demo, true);
  assert.equal(c.port, 4312);
});
