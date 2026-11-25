import fs from 'node:fs/promises';
import { reconcile } from './engine.mjs';
import { reportCSV } from './export.mjs';
try {
  const [command, input, ...args] = process.argv.slice(2);
  if (
    command !== 'compare' ||
    !input ||
    !(args.length === 0 || (args.length === 2 && args[0] === '--out')) ||
    !input.toLowerCase().endsWith('.json')
  )
    throw Error('Usage: node src/cli.mjs compare bundle.json [--out report.json|report.csv]');
  if ((await fs.stat(input)).size > 8388608) throw Error('Input exceeds 8 MB');
  let inputText;
  try {
    inputText = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(input));
  } catch (error) {
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') throw Error('Input is not valid UTF-8');
    throw error;
  }
  const report = reconcile(JSON.parse(inputText));
  if (args.length) {
    const out = args[1];
    if (!/\.(json|csv)$/i.test(out)) throw Error('Output must be .json or .csv');
    await fs.writeFile(
      out,
      out.toLowerCase().endsWith('.csv')
        ? reportCSV(report)
        : JSON.stringify(report, null, 2) + '\n',
      { encoding: 'utf8', flag: 'wx' },
    );
    console.log('Wrote report: ' + out);
  } else console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verdict === 'ready' ? 0 : 2;
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Output exists; choose a new path' : error.message);
  process.exitCode = 1;
}
