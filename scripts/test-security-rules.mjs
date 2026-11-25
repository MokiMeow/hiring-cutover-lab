import fs from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { runEvidence } from './evidence.mjs';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
if (process.argv[2] === '--execute') {
  const [executable, directory] = process.argv.slice(3);
  if (
    process.argv.length !== 5 ||
    !isAbsolute(executable) ||
    !directory?.startsWith(join(root, 'artifacts/security-rule-tests-'))
  )
    throw Error('Invalid bounded rule test invocation');
  const child = spawn(
    executable,
    [
      '--metrics=off',
      '--disable-version-check',
      '--jobs=1',
      '--max-memory=1024',
      '--test',
      '--config',
      directory,
      directory,
    ],
    { windowsHide: true, stdio: 'inherit' },
  );
  process.exitCode = await new Promise((yes, no) => {
    child.once('error', no);
    child.once('close', (code, signal) =>
      signal ? no(Error('Rule tests interrupted')) : yes(code ?? 1),
    );
  });
} else {
  const executable = process.argv[2];
  if (process.argv.length !== 3 || !executable || !isAbsolute(executable))
    throw Error('Supply the absolute path to the approved native Semgrep executable');
  await fs.access(executable);
  const directory = join(root, 'artifacts/security-rule-tests-' + Date.now());
  await fs.mkdir(directory);
  const fixtures = JSON.parse(
    await fs.readFile(join(root, 'security/apiiro-fixes/rule-test-fixtures.json'), 'utf8'),
  );
  for (const [file, source] of Object.entries(fixtures)) {
    if (
      !/^(dart-obfuscation-conditions\.dart|java-obfuscation-declarations\.java|javascript-obfuscation-conditions\.(js|ts))$/.test(
        file,
      )
    )
      throw Error('Unexpected fixture filename');
    await fs.writeFile(join(directory, file), source);
  }
  for (const id of [
    'dart-obfuscation-conditions',
    'java-obfuscation-declarations',
    'javascript-obfuscation-conditions',
  ])
    await fs.copyFile(
      join(root, 'security/apiiro-fixes', id + '.yaml'),
      join(directory, id + '.yaml'),
    );
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
    ]
      .filter((k) => process.env[k] !== undefined)
      .map((k) => [k, process.env[k]]),
  );
  Object.assign(env, {
    SEMGREP_SEND_METRICS: 'off',
    SEMGREP_ENABLE_VERSION_CHECK: '0',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  });
  const evidence = await runEvidence(root, {
    profile: 'rule-tests',
    args: [resolve(import.meta.filename), '--execute', executable, directory],
    env,
    logFile: 'rule-tests.log',
    timeoutMs: 120000,
    settings: { engine: 'Semgrep CE', metrics: 'off', rules: 3, languages: 4 },
  });
  if (!evidence.passed) throw Error('Rule tests failed; inspect artifacts/rule-tests.log');
  console.log(
    'All repaired rules passed on positive and negative fixtures for Dart, Java, JavaScript and TypeScript. See artifacts/rule-tests.log and artifacts/evidence/rule-tests.json.',
  );
}
