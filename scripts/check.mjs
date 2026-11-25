import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
let count = 0;
for (const directory of ['src', 'test', 'scripts', 'public', 'e2e', 'security'])
  for (const file of await fs.readdir(directory)) {
    if (!/\.(mjs|cjs|js)$/.test(file)) continue;
    const path = join(directory, file),
      result = spawnSync(process.execPath, ['--check', path], {
        encoding: 'utf8',
        windowsHide: true,
      });
    if (result.status) throw Error(path + ': ' + result.stderr);
    count++;
  }
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')),
  lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
if (pkg.version !== lock.version) throw Error('Lockfile version mismatch');
if (!(await fs.readFile('public/vendor/BOOTSTRAP-LICENSE', 'utf8')).includes('MIT License'))
  throw Error('Missing Bootstrap license');
console.log(JSON.stringify({ syntaxFiles: count, locked: true, vendorLicense: true }));
