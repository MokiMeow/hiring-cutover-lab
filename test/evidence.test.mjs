import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  snapshotSource,
  runEvidence,
  readEvidence,
  inspectFaultReport,
  unitTotals,
} from '../scripts/evidence.mjs';
import { buildReceipt } from '../scripts/receipt.mjs';

async function fixture(fn) {
  const root = await fs.mkdtemp(join(tmpdir(), 'relay-evidence-'));
  try {
    await fs.mkdir(join(root, 'src'));
    await fs.mkdir(join(root, 'test'));
    await fs.mkdir(join(root, 'artifacts'));
    await fs.writeFile(join(root, 'package.json'), JSON.stringify({ name: 'assessment-relay' }));
    await fs.writeFile(join(root, 'src/app.mjs'), 'export const value=1;\n');
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
const browser = (title, status = 'passed', marker = '') => ({
  stats: {
    expected: status === 'passed' ? 1 : 0,
    unexpected: status === 'passed' ? 0 : 1,
    skipped: 0,
    flaky: 0,
  },
  errors: [],
  suites: [
    {
      specs: [
        {
          title,
          tests: [
            {
              expectedStatus: 'passed',
              status: status === 'passed' ? 'expected' : 'unexpected',
              results: [
                {
                  status,
                  errors: status === 'passed' ? [] : [{ message: 'Injected API rejection' }],
                  stdout: marker ? [{ text: marker }] : [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

test('source fingerprints cover nested source additions and ignore generated data and secrets', async () =>
  fixture(async (root) => {
    const before = await snapshotSource(root);
    await fs.mkdir(join(root, 'public'));
    await fs.writeFile(join(root, 'public/style.css'), 'body{color:black}');
    const after = await snapshotSource(root);
    assert.notEqual(before.fingerprint, after.fingerprint);
    await fs.writeFile(join(root, '.env.private'), 'do not read');
    await fs.writeFile(join(root, 'artifacts/source-like.mjs'), 'not source');
    assert.equal((await snapshotSource(root)).fingerprint, after.fingerprint);
    await fs.writeFile(join(root, 'src/app.mjs'), 'export const value=2;');
    assert.notEqual((await snapshotSource(root)).fingerprint, after.fingerprint);
  }));
test('a completed bounded profile is bound to the source and actual Node version, then a changed source is rejected', async () =>
  fixture(async (root) => {
    const envelope = await runEvidence(root, {
      profile: 'fixture',
      args: ['-e', 'console.log("checked")'],
      timeoutMs: 3000,
    });
    assert.equal(envelope.passed, true);
    assert.equal(envelope.command.nodeVersion, process.version);
    assert.equal((await readEvidence(root, 'fixture', await snapshotSource(root))).passed, true);
    await fs.writeFile(join(root, 'src/app.mjs'), 'export const value=3;');
    assert.equal((await readEvidence(root, 'fixture', await snapshotSource(root))).passed, false);
  }));
test('signal termination and timeouts cannot be accepted as a successful profile', async () =>
  fixture(async (root) => {
    const aborted = await runEvidence(root, {
      profile: 'aborted',
      args: ['-e', 'process.kill(process.pid,"SIGTERM")'],
      timeoutMs: 3000,
    });
    assert.equal(aborted.passed, false);
    const timeout = await runEvidence(root, {
      profile: 'timeout',
      args: ['-e', 'setTimeout(()=>{},10000)'],
      timeoutMs: 60,
    });
    assert.equal(timeout.passed, false);
    assert.equal(timeout.timedOut, true);
  }));

test('a command that exits zero after changing source is recorded as failed verification', async () =>
  fixture(async (root) => {
    const result = await runEvidence(root, {
      profile: 'changed-during-run',
      args: ['-e', 'require("fs").writeFileSync("src/app.mjs","export const changed=true;")'],
      timeoutMs: 3000,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.sourceUnchanged, false);
    assert.equal(result.passed, false);
    assert.deepEqual(result.changedFiles, ['src/app.mjs']);
  }));
test('fault probes require one real unexpected failure, a matching title and the applied marker', () => {
  const title = 'approved journey',
    marker = 'QA_FAULT_APPLIED:invite_rejected';
  assert.equal(inspectFaultReport(browser(title, 'failed', marker), title, marker).passed, true);
  assert.equal(inspectFaultReport(browser(title), title, marker).passed, false);
  assert.equal(inspectFaultReport(browser(title, 'failed'), title, marker).passed, false);
  const empty = {
    stats: { expected: 0, unexpected: 1, skipped: 0, flaky: 0 },
    errors: [],
    suites: [],
  };
  assert.equal(inspectFaultReport(empty, title, marker).passed, false);
});
test('zero tests, skips and partial compatibility counts cannot create clean unit evidence', () => {
  assert.equal(
    unitTotals('# tests 0\n# pass 0\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0').passed,
    false,
  );
  assert.equal(
    unitTotals('# tests 2\n# pass 1\n# fail 0\n# skipped 1\n# cancelled 0\n# todo 0').passed,
    false,
  );
});

async function seedReceiptFixture(root, { compatCount = 2 } = {}) {
  const title = 'approved journey';
  await fs.writeFile(
    join(root, 'test/e2e-policy.json'),
    JSON.stringify({ requiredTitles: [title] }),
  );
  const source = await snapshotSource(root),
    stages = ['syntax', 'api', 'browser', 'gate', 'cli'];
  await fs.mkdir(join(root, 'artifacts/evidence'), { recursive: true });
  const totals = (count) =>
    '# tests ' + count + '\n# pass ' + count + '\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
  const files = {
    'verify-api.log': totals(2),
    'node24.log': totals(compatCount),
    'e2e.json': JSON.stringify(browser(title)),
    'e2e-strict.json': JSON.stringify(browser(title)),
    'e2e-fault.json': JSON.stringify(browser(title, 'failed', 'QA_FAULT_APPLIED:invite_rejected')),
    'cli-smoke.json': JSON.stringify({
      passed: true,
      health: 200,
      ready: 200,
      login: 200,
      records: 200,
      stopped: { code: 0 },
    }),
  };
  for (const name of ['syntax', 'browser', 'gate', 'cli'])
    files['verify-' + name + '.log'] = 'fixture execution\n';
  files['strict.log'] = 'fixture strict\n';
  files['fault.log'] = 'fixture marked failure\n';
  for (const [file, bytes] of Object.entries(files))
    await fs.writeFile(join(root, 'artifacts', file), bytes);
  for (const profile of [...stages.map((name) => 'verify-' + name), 'node24', 'strict', 'fault']) {
    const artifacts =
      profile === 'verify-browser'
        ? ['verify-browser.log', 'e2e.json']
        : profile === 'verify-cli'
          ? ['verify-cli.log', 'cli-smoke.json']
          : profile === 'strict'
            ? ['strict.log', 'e2e-strict.json']
            : profile === 'fault'
              ? ['fault.log', 'e2e-fault.json']
              : [profile === 'node24' ? 'node24.log' : profile + '.log'];
    const commands = {
      'verify-syntax': ['scripts/check.mjs'],
      'verify-api': ['--test', '--test-concurrency=1', 'test/*.test.mjs'],
      'verify-browser': ['node_modules/@playwright/test/cli.js', 'test'],
      'verify-gate': ['scripts/gate.mjs', 'artifacts/e2e.json'],
      'verify-cli': ['scripts/smoke.mjs'],
      node24: ['--test', '--test-concurrency=1', 'test/*.test.mjs'],
      strict: [resolve(root, 'tools/playwright/cli.js'), 'test'],
      fault: ['node_modules/@playwright/test/cli.js', 'test', '--grep', title],
    };
    const settings =
      profile === 'strict'
        ? {
            engine: 'Flashwright',
            isolation: 'strict',
            testPath: resolve(root, 'tools/playwright/test.js'),
          }
        : profile === 'fault'
          ? { injectedFault: true, requiredTitle: title }
          : {};
    const entry = {
      schemaVersion: 2,
      profile,
      passed: true,
      expectedExit: profile === 'fault' ? 1 : 0,
      exitCode: profile === 'fault' ? 1 : 0,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      error: null,
      sourceUnchanged: true,
      sourceBefore: source.fingerprint,
      sourceAfter: source.fingerprint,
      sourceFingerprint: source.fingerprint,
      settings,
      command: {
        nodeVersion: profile === 'node24' ? 'v24.22.3' : process.version,
        args: commands[profile],
      },
      artifacts: await Promise.all(
        artifacts.map(async (file) => ({
          file: 'artifacts/' + file,
          sha256: createHash('sha256')
            .update(await fs.readFile(join(root, 'artifacts', file)))
            .digest('hex'),
        })),
      ),
    };
    await fs.writeFile(join(root, 'artifacts/evidence', profile + '.json'), JSON.stringify(entry));
  }
  await fs.writeFile(
    join(root, 'artifacts/verification.json'),
    JSON.stringify({
      schemaVersion: 2,
      passed: true,
      sourceUnchanged: true,
      sourceBefore: source.fingerprint,
      sourceAfter: source.fingerprint,
      sourceFingerprint: source.fingerprint,
      files: source.files,
      stages: stages.map((name) => ({ name, passed: true, code: 0 })),
    }),
  );
}
test('consistent current fixture evidence passes functional acceptance while absent security remains unverified', async () =>
  fixture(async (root) => {
    await seedReceiptFixture(root);
    const result = await buildReceipt(root, { scanName: 'security-1' });
    assert.equal(
      result.localFunctionalVerificationPassed,
      true,
      JSON.stringify(result.evidenceErrors),
    );
    assert.equal(result.localVerificationPassed, false);
    assert.equal(result.securityStatus, 'not_scanned');
    assert.equal(result.unit.tests, 2);
    assert.equal(result.node24.tests, 2);
  }));
test('a passing older compatibility subset cannot certify a larger primary suite', async () =>
  fixture(async (root) => {
    await seedReceiptFixture(root, { compatCount: 1 });
    const result = await buildReceipt(root, { scanName: 'security-1' });
    assert.equal(result.localFunctionalVerificationPassed, false);
    assert.ok(result.evidenceErrors.some((error) => error.includes('same nonzero test count')));
  }));
test('post-run artifact replacement and new untested source both invalidate a receipt', async () =>
  fixture(async (root) => {
    await seedReceiptFixture(root);
    await fs.writeFile(
      join(root, 'artifacts/e2e-strict.json'),
      JSON.stringify(browser('different journey')),
    );
    let result = await buildReceipt(root, { scanName: 'security-1' });
    assert.equal(result.localFunctionalVerificationPassed, false);
    assert.ok(result.evidenceErrors.some((error) => error.includes('output changed')));
    await seedReceiptFixture(root);
    await fs.writeFile(join(root, 'src/new-module.mjs'), 'export const untouched=false;');
    result = await buildReceipt(root, { scanName: 'security-1' });
    assert.equal(result.localFunctionalVerificationPassed, false);
    assert.ok(result.evidenceErrors.some((error) => error.includes('stale')));
  }));
test('a partial historical security summary without source evidence remains unverified', async () =>
  fixture(async (root) => {
    await fs.writeFile(
      join(root, 'test/e2e-policy.json'),
      JSON.stringify({ requiredTitles: ['approved journey'] }),
    );
    await fs.mkdir(join(root, 'artifacts/security-1'));
    await fs.writeFile(
      join(root, 'artifacts/security-1/summary.json'),
      JSON.stringify({
        sourceUnchanged: true,
        missingRuntimeFiles: [],
        failed: [],
        skipped: [],
        importantFindings: 0,
      }),
    );
    const receipt = await buildReceipt(root, { scanName: 'security-1' });
    assert.equal(receipt.localFunctionalVerificationPassed, false);
    assert.equal(receipt.localVerificationPassed, false);
    assert.notEqual(receipt.securityStatus, 'scanned_with_documented_limits');
  }));

test('current runtime coverage with failed rules cannot pass security acceptance', async () =>
  fixture(async (root) => {
    await seedReceiptFixture(root);
    const source = await snapshotSource(root),
      directory = join(root, 'artifacts/security-1');
    await fs.mkdir(directory);
    const runtime = source.files.filter((item) =>
      /^(?:src\/.*\.(?:mjs|cjs|js)|public\/.*\.(?:mjs|js))$/.test(item.file),
    );
    for (const name of ['source-before.json', 'source-after.json'])
      await fs.writeFile(join(directory, name), JSON.stringify(runtime));
    const summary = {
      sourceUnchanged: true,
      missingRuntimeFiles: [],
      failed: [],
      skipped: [],
      importantFindings: 0,
      ruleErrors: [{ type: 'Rule parse error' }],
    };
    await fs.writeFile(join(directory, 'summary.json'), JSON.stringify(summary));
    let result = await buildReceipt(root, { scanName: 'security-1' });
    assert.equal(
      result.localFunctionalVerificationPassed,
      true,
      JSON.stringify(result.evidenceErrors),
    );
    assert.equal(result.localVerificationPassed, false, 'failed rules must not be accepted');
    summary.ruleErrors = [];
    await fs.writeFile(join(directory, 'summary.json'), JSON.stringify(summary));
    result = await buildReceipt(root, { scanName: 'security-1' });
    assert.equal(result.localVerificationPassed, true, JSON.stringify(result.securityErrors));
  }));
