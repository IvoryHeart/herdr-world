import { fileURLToPath } from 'node:url';
import { mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { git, primaryCheckout, slug, errorExit } from './lib.mjs';

export async function createWorktree(name, ref, cwd = process.cwd()) {
  slug(name);
  const primary = primaryCheckout(cwd);
  for (const part of [join(primary, '.agents'), join(primary, '.agents/.worktrees')]) {
    try { if ((await lstat(part)).isSymbolicLink()) throw new Error('Worktree parent cannot be a symbolic link'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(part, { recursive: true });
  }
  if (!ref) { git(['fetch', 'origin'], cwd); ref = 'origin/main'; }
  git(['rev-parse', '--verify', ref + '^{commit}'], cwd);
  const destination = join(primary, '.agents/.worktrees', name);
  git(['worktree', 'add', '--no-track', '-b', 'agent/' + name, destination, ref], cwd);
  return destination;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, name, ref] = process.argv.slice(2);
  try {
    if (action === 'create') console.log(await createWorktree(name, ref));
    else if (action === 'list') console.log(git(['worktree', 'list']));
    else if (action === 'doctor') console.log(JSON.stringify({ primary: primaryCheckout(), directory: join(primaryCheckout(), '.agents/.worktrees'), branch: git(['branch', '--show-current']) }, null, 2));
    else throw new Error('Usage: agent:worktree -- create <slug> [ref] | list | doctor');
  } catch (error) { errorExit(error); }
}
