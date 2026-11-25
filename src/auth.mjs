import { passwordHash, passwordMatches, dummyPasswordHash } from './password.mjs';
export { passwordHash, passwordMatches } from './password.mjs';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function text(value, name, max = 200) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new AppError(422, 'Invalid ' + name);
  return value.trim();
}
export class AuthStore {
  constructor(path, { password, clock = Date.now } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.clock = clock;
    try {
      const tables = new Set(
        this.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all()
          .map((row) => row.name),
      );
      if (tables.size) {
        const seal = tables.has('settings')
          ? this.db.prepare("SELECT value FROM settings WHERE name='application'").get()
          : null;
        if (seal?.value !== 'hiring-cutover-lab')
          throw Error('Database belongs to another application');
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;',
    );
    if (this.db.prepare('PRAGMA user_version').get().user_version > 1) {
      this.db.close();
      throw Error('Database schema is newer than this application');
    }
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')),active INTEGER NOT NULL DEFAULT 1) STRICT;
   CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,detail TEXT NOT NULL) STRICT;`);
    const seal = this.db.prepare("SELECT value FROM settings WHERE name='application'").get();
    if (seal && seal.value !== 'hiring-cutover-lab') {
      this.db.close();
      throw Error('Database belongs to another application');
    }
    this.db
      .prepare(
        "INSERT INTO settings VALUES('application','hiring-cutover-lab') ON CONFLICT DO NOTHING",
      )
      .run();
    if (!this.db.prepare('SELECT id FROM users LIMIT 1').get()) {
      if (typeof password !== 'string' || password.length < 16 || password.length > 128) {
        this.db.close();
        throw Error('A bootstrap password of 16 to 128 characters is required');
      }
      this.db
        .prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)')
        .run(randomUUID(), 'admin', passwordHash(password), 'admin');
    }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  audit(actor, action, entity, detail = {}) {
    this.db
      .prepare('INSERT INTO audit(at,actor,action,entity,detail) VALUES(?,?,?,?,?)')
      .run(this.clock(), actor, action, entity, JSON.stringify(detail));
  }
  rate(bucket, max = 10, window = 60000) {
    const now = this.clock();
    this.db.prepare('DELETE FROM limits WHERE reset<=?').run(now);
    const row = this.db
      .prepare(
        'INSERT INTO limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count,reset',
      )
      .get(bucket, now + window);
    if (row.count > max) throw new AppError(429, 'Too many requests; try again later');
  }
  login(username, password, address) {
    this.rate('login-address:' + address, 60);
    if (
      typeof username !== 'string' ||
      username.length > 60 ||
      typeof password !== 'string' ||
      password.length > 128
    )
      throw new AppError(401, 'Invalid sign-in details');
    this.rate('login-account:' + address + ':' + hash(username.toLowerCase()), 8);
    const user = this.db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
    const encoded = user?.password ?? dummyPasswordHash;
    if (!passwordMatches(password, encoded) || !user)
      throw new AppError(401, 'Invalid sign-in details');
    const upgraded = !user.password.startsWith('$argon2id$') ? passwordHash(password) : null;
    const raw = token(),
      csrf = token();
    this.transaction(() => {
      if (upgraded)
        this.db.prepare('UPDATE users SET password=? WHERE id=?').run(upgraded, user.id);
      this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(this.clock());
      this.db
        .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
        .run(hash(raw), user.id, csrf, this.clock() + 4 * 60 * 60 * 1000);
      this.audit(user.username, 'sign_in', user.id);
    });
    return { token: raw, csrf, user: { id: user.id, username: user.username, role: user.role } };
  }
  session(raw) {
    if (!raw) throw new AppError(401, 'Sign in to continue');
    const session = this.db
      .prepare(
        'SELECT s.id AS session_id,s.csrf,u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>? AND u.active=1',
      )
      .get(hash(raw), this.clock());
    if (!session) throw new AppError(401, 'Session expired; sign in again');
    return session;
  }
  logout(raw) {
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(hash(raw ?? ''));
  }
  listAudit() {
    return this.db
      .prepare('SELECT at,actor,action,entity,detail FROM audit ORDER BY id DESC LIMIT 200')
      .all()
      .map((row) => ({ ...row, detail: JSON.parse(row.detail) }));
  }
  createUser(input, actor) {
    const username = text(input.username, 'username', 60);
    if (
      !/^[a-zA-Z0-9._-]+$/.test(username) ||
      !['admin', 'operator', 'viewer'].includes(input.role) ||
      typeof input.password !== 'string' ||
      input.password.length < 16 ||
      input.password.length > 128
    )
      throw new AppError(422, 'Invalid user details');
    const encoded = passwordHash(input.password);
    this.transaction(() => {
      try {
        this.db
          .prepare('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)')
          .run(randomUUID(), username, encoded, input.role);
      } catch (error) {
        if (error.errcode === 2067) throw new AppError(409, 'Username already exists');
        throw error;
      }
      this.audit(actor, 'user_created', username, { role: input.role });
    });
    return { username, role: input.role };
  }
  users() {
    return this.db.prepare('SELECT id,username,role,active FROM users ORDER BY username').all();
  }
  disableUser(id, actor, reason) {
    text(reason, 'reason', 300);
    return this.transaction(() => {
      const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!user) throw new AppError(404, 'User not found');
      if (!user.active) return;
      if (
        user.role === 'admin' &&
        this.db.prepare("SELECT count(*) AS count FROM users WHERE role='admin' AND active=1").get()
          .count <= 1
      )
        throw new AppError(409, 'The last administrator cannot be disabled');
      this.db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.audit(actor, 'user_disabled', id, { reason });
    });
  }
  changePassword(id, currentPassword, newPassword) {
    this.rate('password:' + id, 8);
    const user = this.db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(id);
    if (
      typeof currentPassword !== 'string' ||
      currentPassword.length > 128 ||
      !user ||
      !passwordMatches(currentPassword, user.password)
    )
      throw new AppError(422, 'Current password is incorrect');
    if (
      typeof newPassword !== 'string' ||
      newPassword.length < 16 ||
      newPassword.length > 128 ||
      newPassword === currentPassword
    )
      throw new AppError(422, 'Choose a different password of 16 to 128 characters');
    const encoded = passwordHash(newPassword);
    this.transaction(() => {
      this.db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded, id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.audit(user.username, 'password_changed', id);
    });
  }
  async backup(path) {
    await backup(this.db, path);
  }
  close() {
    this.db.close();
  }
}
