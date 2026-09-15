import { fileURLToPath } from 'node:url';
import { mkdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export function git(args, cwd = process.cwd()) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trimEnd();
}

export function primaryCheckout(cwd = process.cwd()) {
  const first = git(['worktree', 'list', '--porcelain'], cwd).split('\n')[0];
  if (!first.startsWith('worktree ')) throw new Error('Cannot resolve primary checkout');
  return first.slice('worktree '.length);
}

function validateSlug(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value ?? '')) {
    throw new Error('Use a lowercase task slug (letters, digits, hyphens; max 64)');
  }
}

export async function createWorktree(name, ref, cwd = process.cwd()) {
  validateSlug(name);
  const primary = primaryCheckout(cwd);
  for (const part of [join(primary, '.agents'), join(primary, '.agents/worktrees')]) {
    try { if ((await lstat(part)).isSymbolicLink()) throw new Error('Worktree parent cannot be a symbolic link'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(part, { recursive: true });
  }
  if (!ref) { git(['fetch', 'origin'], cwd); ref = 'origin/main'; }
  git(['rev-parse', '--verify', ref + '^{commit}'], cwd);
  const destination = join(primary, '.agents/worktrees', name);
  git(['worktree', 'add', '--no-track', '-b', 'agent/' + name, destination, ref], cwd);
  return destination;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, name, ref] = process.argv.slice(2);
  try {
    if (action === 'create') console.log(await createWorktree(name, ref));
    else if (action === 'list') console.log(git(['worktree', 'list']));
    else throw new Error('Usage: agent:worktree -- create <slug> [ref] | list');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
