import fs from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectReport } from './qa-gate.mjs';
import {
  snapshotSource,
  readEvidence,
  unitTotals,
  inspectFaultReport,
  writeJSON,
  escapePattern,
} from './evidence.mjs';
function browserVerdict(report, titles) {
  try {
    return inspectReport(report ?? {}, titles);
  } catch {
    return { passed: false, executed: 0, errors: ['Malformed browser report'] };
  }
}
export async function buildReceipt(root, { scanName } = {}) {
  root = resolve(root);
  const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')),
    relay = pkg.name === 'assessment-relay';
  scanName ??= relay ? 'security-10' : 'security-3';
  if (!/^security-[1-9][0-9]*$/.test(scanName)) throw Error('Invalid scan directory');
  const snapshot = await snapshotSource(root),
    errors = [],
    stale = [],
    securityErrors = [];
  const read = async (file, { optional = false } = {}) => {
    try {
      return JSON.parse(await fs.readFile(join(root, 'artifacts', file), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      if (!optional) errors.push('Missing or invalid artifact: ' + file);
      return null;
    }
  };
  const log = async (file) => {
    try {
      return await fs.readFile(join(root, 'artifacts', file), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      errors.push('Missing log: ' + file);
      return '';
    }
  };
  const verification = await read('verification.json');
  if (
    verification?.schemaVersion !== 2 ||
    verification?.passed !== true ||
    verification?.sourceUnchanged !== true ||
    verification?.sourceBefore !== snapshot.fingerprint ||
    verification?.sourceAfter !== snapshot.fingerprint ||
    verification?.sourceFingerprint !== snapshot.fingerprint ||
    JSON.stringify(verification?.files) !== JSON.stringify(snapshot.files)
  ) {
    errors.push('Verification source evidence is stale, incomplete or unsuccessful');
    stale.push('verification.json');
  }
  const names = ['syntax', 'api', 'browser', 'gate', 'cli'];
  if (
    verification?.stages?.length !== names.length ||
    names.some(
      (name, index) =>
        verification?.stages?.[index]?.name !== name ||
        verification?.stages?.[index]?.passed !== true ||
        verification?.stages?.[index]?.code !== 0,
    )
  )
    errors.push('Required primary verification stages are missing or failed');
  const profiles = {};
  for (const name of names) {
    const extra =
      name === 'browser'
        ? ['artifacts/e2e.json']
        : name === 'cli'
          ? ['artifacts/cli-smoke.json']
          : [];
    profiles['verify-' + name] = await readEvidence(root, 'verify-' + name, snapshot, {
      requiredOutputs: ['artifacts/verify-' + name + '.log', ...extra],
    });
  }
  profiles.node24 = await readEvidence(root, 'node24', snapshot, {
    requiredOutputs: ['artifacts/node24.log'],
  });
  profiles.strict = await readEvidence(root, 'strict', snapshot, {
    requiredOutputs: ['artifacts/strict.log', 'artifacts/e2e-strict.json'],
  });
  profiles.fault = await readEvidence(root, 'fault', snapshot, {
    expectedExit: 1,
    requiredOutputs: ['artifacts/fault.log', 'artifacts/e2e-fault.json'],
  });
  for (const profile of Object.values(profiles)) errors.push(...profile.errors);
  if (!/^v24\./.test(profiles.node24.evidence?.command?.nodeVersion ?? ''))
    errors.push('Compatibility evidence did not run on Node 24');
  const unit = unitTotals(await log('verify-api.log')),
    node24 = unitTotals(await log('node24.log'));
  if (!unit.passed || !node24.passed || unit.tests !== node24.tests)
    errors.push('Primary and Node 24 must pass the same nonzero test count without skips');
  let titles = [];
  try {
    titles = JSON.parse(
      await fs.readFile(join(root, 'test/e2e-policy.json'), 'utf8'),
    ).requiredTitles;
    if (!Array.isArray(titles) || titles.some((title) => typeof title !== 'string' || !title))
      throw Error('Invalid browser title policy');
  } catch {
    titles = [];
    errors.push('Required browser-title policy is missing or invalid');
  }
  const commands = {
    'verify-syntax': ['scripts/check.mjs'],
    'verify-api': ['--test', '--test-concurrency=1', 'test/*.test.mjs'],
    'verify-browser': ['node_modules/@playwright/test/cli.js', 'test'],
    'verify-gate': ['scripts/gate.mjs', 'artifacts/e2e.json'],
    'verify-cli': ['scripts/smoke.mjs'],
    node24: ['--test', '--test-concurrency=1', 'test/*.test.mjs'],
    fault: [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--grep',
      escapePattern(titles?.[0] ?? ''),
    ],
  };
  for (const [profile, args] of Object.entries(commands))
    if (JSON.stringify(profiles[profile].evidence?.command?.args) !== JSON.stringify(args))
      errors.push(profile + ' command does not match its required profile');
  const strictSettings = profiles.strict.evidence?.settings;
  if (
    strictSettings?.engine !== 'Flashwright' ||
    strictSettings?.isolation !== 'strict' ||
    typeof strictSettings?.testPath !== 'string' ||
    JSON.stringify(profiles.strict.evidence?.command?.args) !==
      JSON.stringify([resolve(strictSettings?.testPath ?? '.', '..', 'cli.js'), 'test'])
  )
    errors.push('Strict profile did not use the declared strict Flashwright engine');
  if (
    profiles.fault.evidence?.settings?.injectedFault !== true ||
    profiles.fault.evidence?.settings?.requiredTitle !== titles?.[0]
  )
    errors.push('Fault profile is not bound to the required injected healthy journey');
  const stableReport = await read('e2e.json'),
    strictReport = await read('e2e-strict.json'),
    faultReport = await read('e2e-fault.json'),
    cli = await read('cli-smoke.json');
  const browser = browserVerdict(stableReport, titles),
    strict = browserVerdict(strictReport, titles),
    marker = relay ? 'QA_FAULT_APPLIED:invite_rejected' : 'QA_FAULT_APPLIED:run_rejected',
    fault = inspectFaultReport(faultReport, titles?.[0], marker);
  if (!browser.passed) errors.push(...browser.errors.map((error) => 'Stable: ' + error));
  if (!strict.passed) errors.push(...strict.errors.map((error) => 'Strict: ' + error));
  if (!fault.passed) errors.push(...fault.errors);
  if (
    cli?.passed !== true ||
    [cli?.health, cli?.ready, cli?.login, cli?.records].some((code) => code !== 200) ||
    !cli?.stopped
  )
    errors.push(
      'CLI evidence did not prove HTTP readiness, sign-in, records and owned-process cleanup',
    );
  let security = await read(scanName + '/summary.json', { optional: true }),
    securityPassed = false,
    securityStatus = 'not_scanned';
  if (security) {
    securityStatus = 'review_required';
    const before = await read(scanName + '/source-before.json', { optional: true }),
      after = await read(scanName + '/source-after.json', { optional: true });
    if (
      !Array.isArray(before) ||
      !Array.isArray(after) ||
      !before.length ||
      JSON.stringify(before) !== JSON.stringify(after)
    )
      securityErrors.push('Security source-before/source-after evidence is absent or changed');
    const runtimeFiles = snapshot.files.filter((item) =>
      /^(?:src\/.*\.(?:mjs|cjs|js)|public\/.*\.(?:mjs|js))$/.test(item.file),
    );
    const covered = new Set(),
      currentSource = new Map(snapshot.files.map((item) => [item.file, item.sha256]));
    for (const item of Array.isArray(after) ? after : []) {
      if (
        !item ||
        typeof item.file !== 'string' ||
        !currentSource.has(item.file) ||
        covered.has(item.file) ||
        !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')
      ) {
        securityErrors.push('Security manifest names an invalid or non-source file');
        continue;
      }
      covered.add(item.file);
      if (currentSource.get(item.file) !== item.sha256) {
        securityErrors.push('Security scan is stale: ' + item.file);
        stale.push(item.file + ' (security)');
      }
    }
    for (const item of runtimeFiles)
      if (!covered.has(item.file))
        securityErrors.push('Security source evidence omits runtime file: ' + item.file);
    if (
      security.sourceUnchanged !== true ||
      security.importantFindings !== 0 ||
      !Array.isArray(security.ruleErrors) ||
      security.ruleErrors.length ||
      !Array.isArray(security.missingRuntimeFiles) ||
      security.missingRuntimeFiles.length ||
      !Array.isArray(security.failed) ||
      security.failed.length ||
      !Array.isArray(security.skipped) ||
      security.skipped.length
    )
      securityErrors.push('Security summary requires review or is incomplete');
    securityPassed = !securityErrors.length;
    if (securityPassed) securityStatus = 'scanned_with_documented_limits';
    else if (securityErrors.some((error) => error.includes('stale'))) securityStatus = 'stale';
  }
  const functionalPassed = !errors.length;
  return {
    capturedAt: new Date().toISOString(),
    schemaVersion: 2,
    project: pkg.name,
    sourceFingerprint: snapshot.fingerprint,
    localFunctionalVerificationPassed: functionalPassed,
    localVerificationPassed: functionalPassed && securityPassed,
    staleFiles: stale,
    evidenceErrors: [...new Set(errors)],
    unit,
    node24,
    browser,
    strict,
    faultCaught: fault.passed,
    fault,
    cli,
    profiles,
    securityStatus,
    securityErrors,
    security,
    liveIntegrationVerified: false,
    productionApproved: false,
    files: snapshot.files,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..'),
    result = await buildReceipt(root, { scanName: process.argv[2] });
  await writeJSON(join(root, 'artifacts/release-receipt.json'), result);
  console.log(
    JSON.stringify({
      project: result.project,
      localFunctionalVerificationPassed: result.localFunctionalVerificationPassed,
      localVerificationPassed: result.localVerificationPassed,
      unitTests: result.unit.tests,
      browserPasses: result.browser.executed,
      strictPasses: result.strict.executed,
      faultCaught: result.faultCaught,
      securityStatus: result.securityStatus,
      evidenceErrors: result.evidenceErrors,
      securityErrors: result.securityErrors,
      staleFiles: result.staleFiles,
    }),
  );
  if (!result.localFunctionalVerificationPassed) process.exitCode = 1;
}
