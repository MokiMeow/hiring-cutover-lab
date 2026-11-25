import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, relative, isAbsolute } from 'node:path';

const execFileAsync = promisify(execFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'artifacts',
  'data',
  'test-results',
  'playwright-report',
  'coverage',
  '.reanimate',
  '__pycache__',
]);
const sourceRoots = new Set([
  'src',
  'public',
  'test',
  'e2e',
  'scripts',
  'security',
  '.github',
  'docs',
]);
const sourceExtensions =
  /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|py|sh|bash|json|html|css|md|yaml|yml|ps1|svg|ico|png|gif|avif|webp|jpg|jpeg|woff2?|ttf|otf|txt|wasm)$/i;
const rootFiles = new Set([
  'package.json',
  'package-lock.json',
  'playwright.config.cjs',
  'Start-Demo.ps1',
  '.gitignore',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierignore',
  'README.md',
  'AGENTS.md',
  'CONTEXT.md',
  'LICENSE',
  'LICENSE.txt',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'NOTICE.md',
  '.gitattributes',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'NOTICE.md',
  '.gitattributes',
]);
export async function snapshotSource(root) {
  root = resolve(root);
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = prefix ? prefix + '/' + entry.name : entry.name;
      if (
        entry.name.toLowerCase().startsWith('.env') ||
        /\.(?:key|pem|sqlite|db|log)$/i.test(entry.name) ||
        excludedDirectories.has(entry.name) ||
        file === 'docs/research'
      )
        continue;
      if (!prefix && !(sourceRoots.has(entry.name) || rootFiles.has(entry.name))) continue;
      if (entry.isSymbolicLink())
        throw Error('Source symlinks require an explicit verification policy: ' + file);
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name), file);
        continue;
      }
      if (!entry.isFile()) continue;
      if (
        !sourceExtensions.test(file) &&
        !rootFiles.has(file) &&
        !file.startsWith('security/bin/') &&
        !file.endsWith('-LICENSE')
      )
        continue;
      files.push({ file, sha256: sha(await fs.readFile(join(root, file))) });
    }
  }
  await walk(root);
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  if (!files.length) throw Error('No project source files were selected');
  return { fingerprint: sha(JSON.stringify(files)), files };
}
export function changedFiles(before, after) {
  const a = new Map(before.files.map((x) => [x.file, x.sha256])),
    b = new Map(after.files.map((x) => [x.file, x.sha256]));
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((file) => a.get(file) !== b.get(file))
    .sort();
}
function artifactPath(root, file) {
  if (
    typeof file !== 'string' ||
    file.includes('\\') ||
    isAbsolute(file) ||
    !file.startsWith('artifacts/') ||
    file.split('/').some((part) => part === '..' || !part || part.startsWith('.env')) ||
    /\.(?:key|pem)$/.test(file)
  )
    throw Error('Expected a relative, non-secret artifact file');
  const path = resolve(root, file),
    rel = relative(resolve(root, 'artifacts'), path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Artifact escapes its project');
  return path;
}
export async function writeJSON(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp';
  await fs.mkdir(resolve(path, '..'), { recursive: true });
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temp, path);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export function cleanEnvironment(extra = {}) {
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
      'BROWSER_PATH',
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  return { ...env, NO_COLOR: '1', ...extra };
}
export async function runEvidence(
  root,
  {
    profile,
    executable = process.execPath,
    args = [],
    env = {},
    outputs = [],
    timeoutMs = 300000,
    expectedExit = 0,
    logFile = profile + '.log',
    settings = {},
  },
) {
  if (
    !/^[a-z][a-z0-9-]{0,60}$/.test(profile) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000
  )
    throw Error('Invalid bounded verification profile');
  root = resolve(root);
  await fs.mkdir(join(root, 'artifacts', 'evidence'), { recursive: true });
  const before = await snapshotSource(root),
    logRelative = 'artifacts/' + logFile,
    logPath = artifactPath(root, logRelative),
    outputPaths = outputs.map((file) => ({ file, path: artifactPath(root, file) }));
  for (const output of outputPaths) await fs.rm(output.path, { force: true });
  const startedAt = new Date().toISOString(),
    started = performance.now(),
    childEnv = cleanEnvironment(env),
    log = await fs.open(logPath, 'w');
  let code = null,
    signal = null,
    timedOut = false,
    outputLimitExceeded = false,
    nodeVersion = null,
    error = null,
    bytes = 0,
    writes = Promise.resolve();
  try {
    const probe = await execFileAsync(executable, ['--version'], {
      cwd: root,
      env: childEnv,
      timeout: 5000,
      maxBuffer: 16384,
      windowsHide: true,
    });
    nodeVersion = probe.stdout.trim();
    if (!/^v\d+\.\d+\.\d+$/.test(nodeVersion))
      throw Error('Executable did not report a Node version');
    await log.writeFile('Node ' + nodeVersion + '\n');
    const child = spawn(executable, args, {
      cwd: root,
      env: childEnv,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let terminating = false;
    function terminate() {
      if (terminating) return;
      terminating = true;
      if (process.platform === 'win32') {
        if (child.pid) {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('error', () => child.kill());
          killer.unref();
        } else child.kill();
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > 67108864) {
        outputLimitExceeded = true;
        terminate();
        return;
      }
      writes = writes.then(() => log.write(chunk));
      writes.catch(() => terminate());
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    try {
      ({ code, signal } = await new Promise((yes, no) => {
        child.once('error', no);
        child.once('close', (code, signal) => yes({ code, signal }));
      }));
    } finally {
      clearTimeout(timer);
    }
  } catch (cause) {
    error = cause.message;
    await log.writeFile('Runner error: ' + cause.message + '\n');
  } finally {
    await writes;
    await log.close();
  }
  const after = await snapshotSource(root),
    artifacts = [],
    missingOutputs = [];
  for (const output of outputPaths) {
    try {
      artifacts.push({ file: output.file, sha256: sha(await fs.readFile(output.path)) });
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw cause;
      missingOutputs.push(output.file);
    }
  }
  const sourceUnchanged = before.fingerprint === after.fingerprint;
  const evidence = {
    schemaVersion: 2,
    profile,
    startedAt,
    completedAt: new Date().toISOString(),
    wallMs: performance.now() - started,
    command: { executable: resolve(executable), args, nodeVersion },
    settings,
    sourceBefore: before.fingerprint,
    sourceAfter: after.fingerprint,
    sourceFingerprint: before.fingerprint,
    sourceUnchanged,
    changedFiles: changedFiles(before, after),
    expectedExit,
    exitCode: code,
    signal,
    timedOut,
    outputLimitExceeded,
    error,
    missingOutputs,
    artifacts: [{ file: logRelative, sha256: sha(await fs.readFile(logPath)) }, ...artifacts],
    passed:
      code === expectedExit &&
      signal === null &&
      !timedOut &&
      !outputLimitExceeded &&
      !error &&
      sourceUnchanged &&
      !missingOutputs.length,
  };
  await writeJSON(join(root, 'artifacts', 'evidence', profile + '.json'), evidence);
  return evidence;
}
export async function readEvidence(
  root,
  profile,
  snapshot,
  { expectedExit = 0, requiredOutputs = [], expectedArgs } = {},
) {
  const errors = [];
  let evidence = null;
  try {
    evidence = JSON.parse(
      await fs.readFile(join(root, 'artifacts', 'evidence', profile + '.json'), 'utf8'),
    );
  } catch (cause) {
    if (cause.code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause;
    errors.push('Missing or invalid ' + profile + ' evidence');
  }
  if (evidence) {
    if (
      evidence.schemaVersion !== 2 ||
      evidence.profile !== profile ||
      evidence.passed !== true ||
      evidence.expectedExit !== expectedExit ||
      evidence.exitCode !== expectedExit ||
      evidence.signal !== null ||
      evidence.timedOut !== false ||
      evidence.outputLimitExceeded !== false ||
      evidence.error !== null
    )
      errors.push(profile + ' did not complete successfully');
    if (
      evidence.sourceUnchanged !== true ||
      evidence.sourceBefore !== snapshot.fingerprint ||
      evidence.sourceAfter !== snapshot.fingerprint ||
      evidence.sourceFingerprint !== snapshot.fingerprint
    )
      errors.push(profile + ' source fingerprint is stale or changed during execution');
    if (
      !/^v\d+\.\d+\.\d+$/.test(evidence.command?.nodeVersion ?? '') ||
      !Array.isArray(evidence.command?.args)
    )
      errors.push(profile + ' lacks actual Node version or command evidence');
    if (expectedArgs && JSON.stringify(evidence.command?.args) !== JSON.stringify(expectedArgs))
      errors.push(profile + ' ran a different command from the required profile');
    const artifacts = evidence.artifacts;
    if (!Array.isArray(artifacts) || !artifacts.length)
      errors.push(profile + ' has no output hashes');
    else {
      const seen = new Set();
      for (const item of artifacts) {
        const file = item?.file;
        try {
          if (!item || seen.has(file) || !/^[a-f0-9]{64}$/.test(item.sha256))
            throw Error('Invalid output entry');
          seen.add(file);
          if (sha(await fs.readFile(artifactPath(root, file))) !== item.sha256)
            errors.push(profile + ' output changed: ' + file);
        } catch {
          errors.push(profile + ' output missing or invalid: ' + String(file));
        }
      }
      for (const file of requiredOutputs)
        if (!seen.has(file)) errors.push(profile + ' lacks required output: ' + file);
    }
  }
  return { passed: !errors.length, errors, evidence };
}
export function unitTotals(log) {
  const count = (name) => {
    const matches = [...log.matchAll(new RegExp('^(?:ℹ|#) ' + name + ' ([0-9]+)\\s*$', 'gm'))];
    return Number(matches.at(-1)?.[1] ?? NaN);
  };
  const tests = count('tests');
  return {
    tests,
    passed:
      tests > 0 &&
      count('pass') === tests &&
      count('fail') === 0 &&
      count('skipped') === 0 &&
      count('cancelled') === 0 &&
      count('todo') === 0,
  };
}
export const escapePattern = (value) =>
  [...value]
    .map((character) => ('\\^$.*+?()[]{}|'.includes(character) ? '\\' + character : character))
    .join('');
function inspectFaultReportUnsafe(report, title, marker) {
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) tests.push({ ...test, title: spec.title });
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report?.suites ?? []) visit(suite);
  const test = tests[0],
    result = test?.results?.[0],
    errors = [];
  if (
    tests.length !== 1 ||
    test?.title !== title ||
    test?.expectedStatus !== 'passed' ||
    test?.status !== 'unexpected' ||
    test?.results?.length !== 1 ||
    !['failed', 'timedOut'].includes(result?.status) ||
    !result?.errors?.length
  )
    errors.push('Probe needs one actual unexpected failure of the required healthy journey');
  if (
    report?.stats?.expected !== 0 ||
    report?.stats?.unexpected !== 1 ||
    report?.stats?.skipped !== 0 ||
    report?.stats?.flaky !== 0 ||
    report?.errors?.length
  )
    errors.push('Invalid probe runner totals');
  if (
    !(result?.stdout ?? []).some((item) =>
      (typeof item === 'string' ? item : (item.text ?? '')).includes(marker),
    )
  )
    errors.push('Applied fault marker missing from the failed test output');
  return { passed: !errors.length, executed: tests.length, errors };
}
export function inspectFaultReport(...args) {
  try {
    return inspectFaultReportUnsafe(...args);
  } catch {
    return { passed: false, executed: 0, errors: ['Malformed fault report'] };
  }
}
