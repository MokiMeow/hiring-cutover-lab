import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generate } from '../src/synthetic.mjs';
import { csvCell } from '../src/export.mjs';
test('CLI produces the same deterministic report and refuses overwriting output', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cutover-cli-'));
  try {
    const input = join(dir, 'input.json'),
      out = join(dir, 'report.json');
    await fs.writeFile(input, JSON.stringify(generate(3)));
    const run = () =>
      spawnSync(process.execPath, ['src/cli.mjs', 'compare', input, '--out', out], {
        encoding: 'utf8',
        windowsHide: true,
      });
    assert.equal(run().status, 0);
    assert.equal(JSON.parse(await fs.readFile(out, 'utf8')).verdict, 'ready');
    assert.notEqual(run().status, 0);
    assert.equal(JSON.parse(await fs.readFile(out, 'utf8')).verdict, 'ready');
    await fs.writeFile(input, JSON.stringify(generate(3, 'missing')));
    const bad = spawnSync(process.execPath, ['src/cli.mjs', 'compare', input], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(bad.status, 2);
    assert.equal(JSON.parse(bad.stdout).verdict, 'blocked');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('CSV export quotes and neutralizes formula prefixes including whitespace', () => {
  for (const v of ['=1+1', ' +cmd', '-1', '@SUM(A1)', '\t=evil'])
    assert.ok(csvCell(v).startsWith('"\''));
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(0), '"0"');
});
