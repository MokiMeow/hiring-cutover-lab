import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { generate } from '../src/synthetic.mjs';
import { reconcile } from '../src/engine.mjs';
const rows = [];
for (const count of [100, 1000, 3000]) {
  const bundle = generate(count);
  assert.equal(reconcile(bundle).summary.matchedRecords, 3 + count * 3);
  const samples = [];
  for (let i = 0; i < 9; i++) {
    const start = performance.now(),
      result = reconcile(bundle);
    samples.push(performance.now() - start);
    assert.equal(result.verdict, 'ready');
    assert.equal(result.summary.blockingIssues, 0);
  }
  samples.sort((a, b) => a - b);
  const bad = generate(count, 'mismatch');
  const start = performance.now(),
    fault = reconcile(bad);
  const faultMs = performance.now() - start;
  assert.equal(fault.verdict, 'blocked');
  assert.equal(fault.summary.blockingIssues, 1);
  assert.equal(fault.issues[0].expected, 50);
  assert.equal(fault.issues[0].actual, 49);
  rows.push({
    candidates: count,
    recordsPerSnapshot: 3 + count * 3,
    inputBytes: Buffer.byteLength(JSON.stringify(bundle)),
    medianMs: Number(samples[4].toFixed(2)),
    p95Ms: Number(samples[8].toFixed(2)),
    faultMs: Number(faultMs.toFixed(2)),
    samplesMs: samples,
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
  });
}
await fs.mkdir('artifacts', { recursive: true });
const report = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  method:
    'One warmup and nine serial engine runs per cohort. p95 is nearest-rank max for n=9. Hashing, validation and comparison included. File IO, HTTP and SQLite excluded. Not a browser-tool comparison.',
  rows,
};
await fs.writeFile('artifacts/benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
