import fs from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runEvidence, unitTotals, inspectFaultReport, escapePattern } from './evidence.mjs';
import { inspectReport } from './qa-gate.mjs';
const root = resolve(import.meta.dirname, '..'),
  [profile, ...args] = process.argv.slice(2),
  option = (name) => {
    const at = args.indexOf(name);
    return at < 0 ? null : args[at + 1];
  };
const titles = JSON.parse(
  await fs.readFile(join(root, 'test/e2e-policy.json'), 'utf8'),
).requiredTitles;
let definition;
if (profile === 'node24') {
  const executable = option('--node');
  if (!executable || args.length !== 2 || args[0] !== '--node')
    throw Error('Usage: supplementary.mjs node24 --node absolute-node-executable');
  definition = {
    profile,
    executable,
    args: ['--test', '--test-concurrency=1', 'test/*.test.mjs'],
    logFile: 'node24.log',
  };
} else if (profile === 'strict') {
  const testPath = option('--flashwright');
  if (!testPath || args.length !== 2 || args[0] !== '--flashwright')
    throw Error('Usage: supplementary.mjs strict --flashwright absolute-test.js');
  const absolute = resolve(testPath),
    cli = resolve(absolute, '..', 'cli.js');
  definition = {
    profile,
    args: [cli, 'test'],
    env: { FLASHWRIGHT_TEST_PATH: absolute, QA_REPORT: 'artifacts/e2e-strict.json' },
    outputs: ['artifacts/e2e-strict.json'],
    logFile: 'strict.log',
    settings: { engine: 'Flashwright', isolation: 'strict', testPath: absolute },
  };
} else if (profile === 'fault') {
  if (args.length || !Array.isArray(titles) || !titles[0])
    throw Error('Fault profile needs a required healthy title and no extra options');
  definition = {
    profile,
    args: ['node_modules/@playwright/test/cli.js', 'test', '--grep', escapePattern(titles[0])],
    env: { QA_INJECT_FAULT: '1', QA_REPORT: 'artifacts/e2e-fault.json' },
    outputs: ['artifacts/e2e-fault.json'],
    logFile: 'fault.log',
    expectedExit: 1,
    settings: { injectedFault: true, requiredTitle: titles[0] },
  };
} else throw Error('Choose node24, strict or fault');
const result = await runEvidence(root, definition);
let valid = result.passed;
if (profile === 'node24')
  valid &&=
    /^v24\./.test(result.command.nodeVersion ?? '') &&
    unitTotals(await fs.readFile(join(root, 'artifacts/node24.log'), 'utf8')).passed;
if (profile === 'strict' && valid)
  valid = inspectReport(
    JSON.parse(await fs.readFile(join(root, 'artifacts/e2e-strict.json'), 'utf8')),
    titles,
  ).passed;
if (profile === 'fault' && valid) {
  const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'));
  valid = inspectFaultReport(
    JSON.parse(await fs.readFile(join(root, 'artifacts/e2e-fault.json'), 'utf8')),
    titles[0],
    pkg.name === 'assessment-relay'
      ? 'QA_FAULT_APPLIED:invite_rejected'
      : 'QA_FAULT_APPLIED:run_rejected',
  ).passed;
}
console.log(
  JSON.stringify({
    profile,
    passed: valid,
    node: result.command.nodeVersion,
    sourceUnchanged: result.sourceUnchanged,
    sourceFingerprint: result.sourceFingerprint,
    log: 'artifacts/' + definition.logFile,
  }),
);
if (!valid) process.exitCode = 1;
