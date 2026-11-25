import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function inspectReport(report, requiredTitles) {
  if (
    !Array.isArray(requiredTitles) ||
    !requiredTitles.length ||
    requiredTitles.some((title) => typeof title !== 'string' || !title) ||
    new Set(requiredTitles).size !== requiredTitles.length
  )
    return {
      passed: false,
      executed: 0,
      errors: ['Policy requires distinct nonempty test titles'],
    };
  const errors = [];
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) tests.push({ ...test, title: spec.title });
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  if (!tests.length) errors.push('No tests executed');
  if (report.errors?.length) errors.push('Runner errors present');
  for (const key of ['unexpected', 'skipped', 'flaky'])
    if (report.stats?.[key] !== 0) errors.push('Nonzero or missing ' + key + ' count');
  if (report.stats?.expected !== tests.length) errors.push('Passing count does not match tests');
  const titles = new Set(tests.map((test) => test.title));
  for (const title of requiredTitles)
    if (!titles.has(title)) errors.push('Missing required test: ' + title);
  if (tests.length !== requiredTitles.length)
    errors.push('Test count differs from approved policy');
  for (const test of tests) {
    if (test.expectedStatus !== 'passed') errors.push('Expected failure or skip: ' + test.title);
    if (test.status !== 'expected') errors.push('Unexpected outcome: ' + test.title);
    if (test.results?.length !== 1) errors.push('Missing result or retry: ' + test.title);
    for (const result of test.results ?? [])
      if (result.status !== 'passed' || result.errors?.length)
        errors.push('Actual result did not pass: ' + test.title);
  }
  return { passed: errors.length === 0, executed: tests.length, errors: [...new Set(errors)] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [reportFile, policyFile] = process.argv.slice(2);
  if (!reportFile || !policyFile) throw Error('Usage: node qa-gate.mjs report.json policy.json');
  const report = JSON.parse(await fs.readFile(reportFile, 'utf8')),
    policy = JSON.parse(await fs.readFile(policyFile, 'utf8'));
  if (!Array.isArray(policy.requiredTitles) || !policy.requiredTitles.length)
    throw Error('Policy requires a nonempty requiredTitles list');
  const verdict = inspectReport(report, policy.requiredTitles);
  console.log(JSON.stringify(verdict, null, 2));
  process.exitCode = verdict.passed ? 0 : 1;
}
