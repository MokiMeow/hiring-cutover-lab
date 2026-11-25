import fs from 'node:fs/promises';
import { inspectReport } from './qa-gate.mjs';
const report = JSON.parse(await fs.readFile(process.argv[2] ?? 'artifacts/e2e.json', 'utf8'));
const requiredTitles = JSON.parse(
  await fs.readFile(new URL('../test/e2e-policy.json', import.meta.url), 'utf8'),
).requiredTitles;
const result = inspectReport(report, requiredTitles);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
