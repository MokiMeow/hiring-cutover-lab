import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { repairApiiro } from '../security/repair-apiiro.mjs';
const project = resolve(import.meta.dirname, '..');
async function fixture(t) {
  const parent = join(project, 'artifacts/rule-hook-tests');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, 'case-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(join(root, 'security/apiiro-fixes'), { recursive: true });
  await fs.cp(join(project, 'security/apiiro-fixes'), join(root, 'security/apiiro-fixes'), {
    recursive: true,
  });
  const pins = JSON.parse(await fs.readFile(join(root, 'security/apiiro-fixes/pins.json'), 'utf8'));
  const originals = JSON.parse(
    await fs.readFile(join(root, 'security/apiiro-fixes/original-rules.json'), 'utf8'),
  );
  const config = join(root, 'artifacts/security-1/repos/apiiro-malicious-code-ruleset');
  for (const pin of pins) {
    const file = join(config, pin.file);
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, originals[pin.id]);
  }
  return { root, config, pins, originals };
}
test('scanner repair restores all three pinned rules and is idempotent', async (t) => {
  const { root, config, pins } = await fixture(t);
  const records = await repairApiiro(root, config);
  assert.equal(records.length, 3);
  assert.ok(records.every((r) => !r.alreadyRepaired));
  for (const p of pins)
    assert.equal(
      await fs.readFile(join(config, p.file), 'utf8'),
      await fs.readFile(join(root, 'security/apiiro-fixes', p.id + '.yaml'), 'utf8'),
    );
  assert.ok((await repairApiiro(root, config)).every((r) => r.alreadyRepaired));
  assert.equal(
    JSON.parse(await fs.readFile(join(config, '../../rule-repairs.json'), 'utf8')).length,
    3,
  );
});
test('unreviewed upstream content fails before any rule is modified', async (t) => {
  const { root, config, pins, originals } = await fixture(t);
  await fs.appendFile(join(config, pins[2].file), '# unexpected upstream update\n');
  await assert.rejects(repairApiiro(root, config), /Unreviewed upstream/);
  assert.equal(await fs.readFile(join(config, pins[0].file), 'utf8'), originals[pins[0].id]);
});
test('tampered local replacement fails closed', async (t) => {
  const { root, config, pins } = await fixture(t);
  await fs.appendFile(join(root, 'security/apiiro-fixes', pins[0].id + '.yaml'), '# tampered\n');
  await assert.rejects(repairApiiro(root, config), /Unreviewed upstream or local/);
});
test('registry configurations are untouched and out-of-scope clone paths are rejected', async (t) => {
  const { root } = await fixture(t);
  assert.deepEqual(await repairApiiro(root, 'p/nodejs'), []);
  const outside = join(root, 'outside/apiiro-malicious-code-ruleset');
  await fs.mkdir(outside, { recursive: true });
  await assert.rejects(repairApiiro(root, outside), /outside the generated scan/);
});

test('pinned scanner repairs accept equivalent upstream CRLF files', async (t) => {
  const { root, config, pins, originals } = await fixture(t);
  for (const pin of pins)
    await fs.writeFile(
      join(config, pin.file),
      originals[pin.id].replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'),
    );
  const records = await repairApiiro(root, config);
  assert.equal(records.length, 3);
  assert.ok(records.every((record) => !record.alreadyRepaired));
});
