import fs from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { snapshotSource, runEvidence, changedFiles, writeJSON, unitTotals } from './evidence.mjs';
import { inspectReport } from './qa-gate.mjs';
const root = resolve(import.meta.dirname, '..'),
  before = await snapshotSource(root),
  stages = [];
const definitions = [
  { name: 'syntax', args: ['scripts/check.mjs'] },
  { name: 'api', args: ['--test', '--test-concurrency=1', 'test/*.test.mjs'] },
  {
    name: 'browser',
    args: ['node_modules/@playwright/test/cli.js', 'test'],
    env: { QA_REPORT: 'artifacts/e2e.json' },
    outputs: ['artifacts/e2e.json'],
  },
  { name: 'gate', args: ['scripts/gate.mjs', 'artifacts/e2e.json'] },
  { name: 'cli', args: ['scripts/smoke.mjs'], outputs: ['artifacts/cli-smoke.json'] },
];
let error = null;
for (const stage of definitions) {
  const result = await runEvidence(root, {
    ...stage,
    profile: 'verify-' + stage.name,
    logFile: 'verify-' + stage.name + '.log',
  });
  stages.push({
    name: stage.name,
    profile: result.profile,
    code: result.exitCode,
    passed: result.passed,
    wallMs: result.wallMs,
  });
  console.log(stage.name, result.passed ? 'passed' : 'failed');
  if (!result.passed) {
    error = 'Verification failed at ' + stage.name;
    break;
  }
  if (
    stage.name === 'api' &&
    !unitTotals(await fs.readFile(join(root, 'artifacts/verify-api.log'), 'utf8')).passed
  ) {
    error = 'Unit run did not pass all nonzero tests without skips';
    break;
  }
  if (stage.name === 'browser') {
    const report = JSON.parse(await fs.readFile(join(root, 'artifacts/e2e.json'), 'utf8')),
      policy = JSON.parse(await fs.readFile(join(root, 'test/e2e-policy.json'), 'utf8'));
    if (!inspectReport(report, policy.requiredTitles).passed) {
      error = 'Browser report rejected by the required-title policy';
      break;
    }
  }
  if (
    stage.name === 'cli' &&
    !JSON.parse(await fs.readFile(join(root, 'artifacts/cli-smoke.json'), 'utf8')).passed
  ) {
    error = 'CLI smoke did not pass';
    break;
  }
}
const after = await snapshotSource(root),
  sourceUnchanged = before.fingerprint === after.fingerprint;
if (!sourceUnchanged) error = 'Source changed while verification was running';
const result = {
  schemaVersion: 2,
  capturedAt: new Date().toISOString(),
  node: process.version,
  sourceBefore: before.fingerprint,
  sourceAfter: after.fingerprint,
  sourceFingerprint: before.fingerprint,
  sourceUnchanged,
  changedFiles: changedFiles(before, after),
  stages,
  files: before.files,
  passed: !error && stages.length === definitions.length && stages.every((stage) => stage.passed),
  error,
  liveProviderVerified: false,
  realMigrationVerified: false,
  productionApproved: false,
};
await writeJSON(join(root, 'artifacts/verification.json'), result);
if (!result.passed) {
  console.error(error);
  process.exitCode = 1;
}
