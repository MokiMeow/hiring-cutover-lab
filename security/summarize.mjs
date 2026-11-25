import fs from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..'),
  directory = resolve(root, 'artifacts', process.argv[2] ?? 'security-3');
if (!/^security-[1-9][0-9]*$/.test(process.argv[2] ?? 'security-3') || process.argv.length > 3)
  throw Error('Usage: node security/summarize.mjs [security-N]');
const read = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));
const manifest = await read(directory + '/scans.json'),
  rows = [],
  findings = [],
  errors = [],
  covered = new Set();
for (const scan of manifest.scans) {
  const data = await read(scan.json),
    sourceFiles = data.paths?.scanned ?? [];
  for (const path of sourceFiles) covered.add(relative(root, path).replaceAll('\\', '/'));
  for (const item of data.results ?? []) {
    const metadata = item.extra.metadata ?? {};
    findings.push({
      rule: item.check_id,
      file: relative(root, item.path).replaceAll('\\', '/'),
      line: item.start.line,
      confidence: metadata.confidence ?? 'UNCLASSIFIED',
      impact: metadata.impact ?? 'UNCLASSIFIED',
      important:
        metadata.category === 'security' &&
        ['MEDIUM', 'HIGH'].includes(metadata.confidence) &&
        ['MEDIUM', 'HIGH'].includes(metadata.impact),
      message: item.extra.message,
    });
  }
  for (const error of data.errors ?? [])
    errors.push({
      ruleset: scan.ruleset,
      type: error.type,
      ruleId: error.rule_id,
      message: String(error.message ?? '').slice(0, 500),
    });
  rows.push({
    ruleset: scan.ruleset,
    files: sourceFiles.length,
    rawFindings: (data.results ?? []).length,
    ruleErrors: (data.errors ?? []).length,
    partial: scan.partial,
  });
}
const before = await read(directory + '/source-before.json'),
  after = await read(directory + '/source-after.json'),
  runtimeFiles = before.map((item) => item.file),
  missing = runtimeFiles.filter((file) => !covered.has(file));
const result = {
  capturedAt: new Date().toISOString(),
  engine: 'Semgrep CE',
  metrics: 'off',
  sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
  scans: rows,
  failed: manifest.failed,
  skipped: manifest.skipped,
  oversized: manifest.oversized,
  missingRuntimeFiles: missing,
  findings,
  importantFindings: findings.filter((item) => item.important).length,
  ruleErrors: errors,
  limitations: [
    'CE does not provide cross-file Pro taint analysis',
    ...(errors.length ? ['Rule parse failures reduce coverage'] : []),
    'Static analysis is not a complete security audit',
  ],
  adjudication:
    'Scanner launchers use explicitly configured local executable paths and argument arrays. No HTTP or candidate payload selects an executable, and shell execution is disabled. Raw findings still require review.',
};
await fs.writeFile(directory + '/summary.json', JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      sourceUnchanged: result.sourceUnchanged,
      scans: rows,
      importantFindings: result.importantFindings,
      ruleErrors: errors.length,
      missingRuntimeFiles: missing,
    },
    null,
    2,
  ),
);
if (
  !result.sourceUnchanged ||
  missing.length ||
  errors.length ||
  result.importantFindings ||
  manifest.failed.length ||
  manifest.skipped.length
)
  process.exitCode = 1;
