import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
test('unrelated login failures do not consume a valid account retry budget', () => {
  const s = new Store(':memory:', { password: 'throttle-test-password' });
  try {
    for (let i = 0; i < 8; i++)
      assert.throws(() => s.login('unknown', 'wrong-password', 'loopback'), /Invalid/);
    assert.throws(() => s.login('unknown', 'wrong-password', 'loopback'), /Too many/);
    const login = s.login('admin', 'throttle-test-password', 'loopback');
    assert.equal(s.session(login.token).role, 'admin');
  } finally {
    s.close();
  }
});
test('coarse address limits still bound malformed attempts across account names', () => {
  const s = new Store(':memory:', { password: 'throttle-test-password' });
  try {
    for (let i = 0; i < 60; i++)
      assert.throws(() => s.login('x'.repeat(61) + i, 'wrong', 'loopback'), /Invalid/);
    assert.throws(() => s.login('admin', 'throttle-test-password', 'loopback'), /Too many/);
  } finally {
    s.close();
  }
});
