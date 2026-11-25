import fs from 'node:fs/promises';
import { generate } from '../src/synthetic.mjs';
await fs.mkdir('public/vendor', { recursive: true });
for (const [source, target] of [
  ['node_modules/bootstrap/dist/css/bootstrap.min.css', 'public/vendor/bootstrap.min.css'],
  ['node_modules/bootstrap/LICENSE', 'public/vendor/BOOTSTRAP-LICENSE'],
])
  await fs.copyFile(source, target);
await fs.writeFile('public/contract.json', JSON.stringify(generate(2), null, 2) + '\n');
