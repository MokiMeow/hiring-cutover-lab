import { argon2Sync, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
const prefix = '$argon2id$v=19$m=65536,t=3,p=1$';
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length > 128 || !/^[a-f0-9]{32}$/.test(salt))
    throw Error('Invalid password input');
  const nonce = Buffer.from(salt, 'hex'),
    tag = argon2Sync('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce,
      parallelism: 1,
      memory: 65536,
      passes: 3,
      tagLength: 32,
    });
  return prefix + nonce.toString('base64') + '$' + tag.toString('base64');
}
export function passwordMatches(password, encoded) {
  try {
    if (typeof password !== 'string' || password.length > 128 || typeof encoded !== 'string')
      return false;
    if (encoded.startsWith(prefix)) {
      const parts = encoded.slice(prefix.length).split('$');
      if (parts.length !== 2) return false;
      const salt = Buffer.from(parts[0], 'base64');
      if (salt.length !== 16) return false;
      const actual = passwordHash(password, salt.toString('hex'));
      return (
        Buffer.byteLength(actual) === Buffer.byteLength(encoded) &&
        timingSafeEqual(Buffer.from(actual), Buffer.from(encoded))
      );
    }
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)) return false;
    const [salt, expected] = encoded.split(':');
    return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
export const dummyPasswordHash = passwordHash('unused-dummy-credential');
