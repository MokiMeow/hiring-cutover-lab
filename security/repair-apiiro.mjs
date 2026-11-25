import fs from 'node:fs/promises';
import { resolve, join, relative, sep, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
// Pin canonical UTF-8/LF content so Git line endings do not change trust.
const sha = (bytes) =>
  createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest('hex');
export async function repairApiiro(root, config) {
  if (!config || basename(config) !== 'apiiro-malicious-code-ruleset') return [];
  root = await fs.realpath(root);
  config = await fs.realpath(resolve(config));
  const rel = relative(join(root, 'artifacts'), config).split(sep);
  if (
    rel.length !== 3 ||
    !/^security-[0-9]+$/.test(rel[0]) ||
    rel[1] !== 'repos' ||
    rel[2] !== 'apiiro-malicious-code-ruleset'
  )
    throw Error('Apiiro config is outside the generated scan directory');
  const pins = JSON.parse(await fs.readFile(join(root, 'security/apiiro-fixes/pins.json'), 'utf8'));
  const planned = [];
  for (const pin of pins) {
    const target = join(config, pin.file),
      source = join(root, 'security/apiiro-fixes', pin.id + '.yaml');
    if (
      (await fs.realpath(target)) !== resolve(target) ||
      (await fs.realpath(source)) !== resolve(source)
    )
      throw Error('Rule symlink rejected');
    const before = await fs.readFile(target),
      after = await fs.readFile(source),
      beforeHash = sha(before);
    if (
      sha(after) !== pin.fixedSha256 ||
      ![pin.originalSha256, pin.fixedSha256].includes(beforeHash)
    )
      throw Error('Unreviewed upstream or local rule change: ' + pin.id);
    planned.push({
      target,
      after,
      record: {
        id: pin.id,
        file: pin.file,
        originalSha256: pin.originalSha256,
        fixedSha256: pin.fixedSha256,
        alreadyRepaired: beforeHash === pin.fixedSha256,
      },
    });
  }
  for (const item of planned) await fs.writeFile(item.target, item.after);
  const records = planned.map((item) => item.record);
  await fs.writeFile(
    join(config, '../../rule-repairs.json'),
    JSON.stringify(records, null, 2) + '\n',
  );
  return records;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    index = args.indexOf('--config');
  const config =
    index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith('--config='))?.slice(9);
  await repairApiiro(resolve(import.meta.dirname, '..'), config);
}
