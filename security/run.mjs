import fs from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, sep, delimiter, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scanName = process.argv[2] ?? 'security-3';
if (process.argv.length > 3 || !/^security-[1-9][0-9]*$/.test(scanName))
  throw Error('Usage: node security/run.mjs [security-N]');
const output = join(root, 'artifacts', scanName);
if (
  (await fs.realpath(root)).toLowerCase() !== root.toLowerCase() ||
  !output.startsWith(root + sep)
)
  throw Error('Unexpected scan scope');
const tool = async (name, fallback) => {
  const path = process.env[name] ?? fallback;
  if (!path || !isAbsolute(path))
    throw Error('Set ' + name + ' to the approved absolute tool path');
  await fs.access(path);
  return path;
};
// Explicit local executables only. This driver does not install tools or log in.
const semgrep = await tool('SEMGREP_BINARY');
const jq = await tool('JQ_BINARY');
const script = await tool('SEMGREP_SCAN_RUNNER');
const bash = await tool(
  'BASH_BINARY',
  process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
    : '/bin/bash',
);
const posix = (path) =>
  process.platform === 'win32'
    ? '/' + path[0].toLowerCase() + path.slice(2).replaceAll('\\', '/')
    : path;
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
    'HOMEDRIVE',
    'HOMEPATH',
    'HOME',
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
env.PATH = join(root, 'security/bin') + delimiter + (env.PATH ?? env.Path ?? '');
delete env.Path;
Object.assign(env, {
  SEMGREP_BINARY: semgrep,
  JQ_BINARY: jq,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  SEMGREP_SEND_METRICS: 'off',
  SEMGREP_ENABLE_VERSION_CHECK: '0',
  TMPDIR: posix(join(output, 'tmp')),
});
const version = await promisify(execFile)(
  semgrep,
  ['--metrics=off', '--disable-version-check', '--version'],
  {
    cwd: root,
    env,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 16384,
  },
);
await fs.mkdir(output, { recursive: false });
await fs.mkdir(join(output, 'tmp'));
const snapshot = async () => {
  const files = (await fs.readdir(join(root, 'src')))
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => 'src/' + file)
    .concat(['public/app.js']);
  return await Promise.all(
    files.map(async (file) => ({
      file,
      sha256: createHash('sha256')
        .update(await fs.readFile(join(root, file)))
        .digest('hex'),
    })),
  );
};
const before = await snapshot();
await fs.writeFile(join(output, 'source-before.json'), JSON.stringify(before, null, 2));
await fs.writeFile(
  join(output, 'engine.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      engine: 'Semgrep CE',
      version: version.stdout.trim(),
      telemetry: false,
      sourceUploads: false,
      note: 'Explicit local CE scan; Pro and cross-file taint coverage are not claimed.',
    },
    null,
    2,
  ),
);
const log = await fs.open(join(output, 'run.log'), 'w');
const child = spawn(
  bash,
  [
    posix(script),
    '--target',
    posix(root),
    '--output-dir',
    posix(output),
    '--mode',
    'important-only',
    '--rulesets',
    posix(join(root, 'security/rulesets.json')),
    '--jobs',
    '1',
  ],
  {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', log.fd, log.fd],
  },
);
let result;
try {
  result = await new Promise((yes, no) => {
    child.once('error', no);
    child.once('close', (code, signal) => yes({ code, signal }));
  });
} finally {
  await log.close();
}
const after = await snapshot();
await fs.writeFile(join(output, 'source-after.json'), JSON.stringify(after, null, 2));
if (JSON.stringify(before) !== JSON.stringify(after))
  throw Error('Runtime source changed during scan');
console.log(JSON.stringify({ ...result, output }));
if (result.code !== 0 || result.signal) process.exitCode = 1;
