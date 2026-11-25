import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { passwordHash, passwordMatches } from '../src/auth.mjs';
test('new credentials use Argon2id with random salts and fixed memory parameters', () => {
  const a = passwordHash('a-long-test-password'),
    b = passwordHash('a-long-test-password');
  assert.match(a, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.notEqual(a, b);
  assert.equal(passwordMatches('a-long-test-password', a), true);
  assert.equal(passwordMatches('incorrect-password', a), false);
  assert.equal(passwordMatches('x', '$argon2id$invalid'), false);
});
test('existing scrypt hashes remain verifiable during migration', () => {
  const salt = '0123456789abcdef0123456789abcdef',
    encoded = salt + ':' + scryptSync('existing-test-password', salt, 64).toString('hex');
  assert.equal(passwordMatches('existing-test-password', encoded), true);
  assert.equal(passwordMatches('incorrect', encoded), false);
});
