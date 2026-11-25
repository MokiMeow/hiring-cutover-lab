import { createApp } from './server.mjs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
export function configuration(env = process.env, args = process.argv.slice(2)) {
  if (args.some((a) => a !== '--demo')) throw Error('Only --demo is supported');
  const demo = args.includes('--demo');
  const port = env.PORT === undefined ? 4312 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be 1 to 65535');
  const database = resolve(
    env.CUTOVER_DATABASE ?? (demo ? 'data/demo.sqlite' : 'data/cutover.sqlite'),
  );
  if (demo && existsSync(database) && !env.CUTOVER_BOOTSTRAP_PASSWORD)
    throw Error(
      'Existing demo database: set CUTOVER_BOOTSTRAP_PASSWORD to your existing password, or select a new CUTOVER_DATABASE',
    );
  const password =
    env.CUTOVER_BOOTSTRAP_PASSWORD ?? (demo ? randomBytes(20).toString('base64url') : undefined);
  if (typeof password !== 'string' || password.length < 16 || password.length > 128)
    throw Error('Set CUTOVER_BOOTSTRAP_PASSWORD with 16 to 128 characters');
  return { port, password, database, demo };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = configuration(),
      app = await createApp(config);
    await app.listen(config.port);
    console.log('Hiring Cutover Lab: ' + app.origin + ' (synthetic offline only)');
    if (config.demo && !process.env.CUTOVER_BOOTSTRAP_PASSWORD) {
      console.log('Username: admin');
      console.log('Bootstrap password (applies only to a new demo database): ' + config.password);
    }
    let stopping = false;
    const close = async () => {
      if (stopping) return;
      stopping = true;
      await app.close();
    };
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
