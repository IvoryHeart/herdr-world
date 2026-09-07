import { cp, mkdtemp, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { copyCandidate } from './environment.mjs';
import { errorExit } from './lib.mjs';

export async function writableFixture(source, parent = tmpdir()) {
  const target = await mkdtemp(join(parent, 'world-qa-'));
  await copyCandidate(source, target);
  // Vite writes inside node_modules/.vite-temp. A symlink to read-only dependencies
  // fails even when source and ordinary caches were copied successfully.
  for (const prefix of ['', 'web', 'harness']) {
    const path = join(source, prefix, 'node_modules');
    try { if (!(await lstat(path)).isDirectory()) throw new Error('Prepared dependencies must be a directory: ' + prefix); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await cp(path, join(target, prefix, 'node_modules'), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  }
  return target;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writableFixture(process.cwd()).then(path => console.log(path)).catch(errorExit);
}
