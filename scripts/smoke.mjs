import fs from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..'),
  database = join(root, 'artifacts', 'smoke-' + randomUUID() + '.sqlite');
await fs.mkdir(join(root, 'artifacts'), { recursive: true });
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = Object.fromEntries(
  [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'LOCALAPPDATA',
    'APPDATA',
    'USERPROFILE',
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
Object.assign(env, {
  PORT: String(port),
  CUTOVER_DATABASE: database,
  CUTOVER_BOOTSTRAP_PASSWORD: 'local-demo-password-29',
});
const child = spawn(process.execPath, ['src/main.mjs', '--demo'], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '',
  result;
const exited = new Promise((resolve) =>
  child.once('close', (code, signal) => resolve({ code, signal })),
);
try {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CLI did not become ready')), 10000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:[0-9]+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.stderr.on('data', () => {});
    child.once('exit', () => {
      clearTimeout(timer);
      reject(Error('CLI exited before readiness'));
    });
  });
  const health = await fetch(origin + '/healthz'),
    ready = await fetch(origin + '/readyz');
  const login = await fetch(origin + '/api/login', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'local-demo-password-29' }),
  });
  const records = await fetch(origin + '/api/runs', {
    headers: { cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '' },
  });
  result = {
    cliStarted: true,
    health: health.status,
    ready: ready.status,
    login: login.status,
    records: records.status,
    mode: (await ready.json()).mode,
    passed: [health, ready, login, records].every((response) => response.status === 200),
  };
} finally {
  child.kill('SIGTERM');
  const stopped = await exited;
  if (result) result.stopped = stopped;
  for (const suffix of ['', '-wal', '-shm']) await fs.rm(database + suffix, { force: true });
}
await fs.writeFile(join(root, 'artifacts/cli-smoke.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!result?.passed) process.exitCode = 1;
