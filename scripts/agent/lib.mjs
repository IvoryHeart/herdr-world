import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function git(args, cwd = process.cwd(), extraEnv = {}) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...extraEnv, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trimEnd();
}

export function primaryCheckout(cwd = process.cwd()) {
  const first = git(['worktree', 'list', '--porcelain'], cwd).split('\n')[0];
  if (!first.startsWith('worktree ')) throw new Error('Cannot resolve primary checkout');
  return first.slice('worktree '.length);
}

export function slug(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value ?? '')) {
    throw new Error('Use a lowercase task slug (letters, digits, hyphens; max 64)');
  }
  return value;
}

export async function jsonFile(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + process.pid + '.tmp';
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}

export async function command(argv, { cwd = process.cwd(), env = process.env, timeoutMs = 1200000, log, input, stream = true } = {}) {
  if (!Array.isArray(argv) || !argv.length) throw new Error('Command must be a nonempty argv array');
  if (log) {
    await mkdir(dirname(log), { recursive: true });
    await writeFile(log, '', { mode: 0o600 });
  }
  const startedAt = Date.now();
  const child = spawn(argv[0], argv.slice(1), {
    cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
  });
  const chunks = [], stdoutChunks = [], stderrChunks = [];
  let timedOut = false;
  const append = chunk => { if (log) appendFileSync(log, chunk); chunks.push(chunk); };
  const terminate = () => {
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
    }
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  };
  const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
  child.stdout.on('data', chunk => {
    append(chunk); stdoutChunks.push(chunk); if (stream) process.stdout.write(chunk);
  });
  child.stderr.on('data', chunk => {
    append(chunk); stderrChunks.push(chunk); if (stream) process.stderr.write(chunk);
  });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  let result;
  try {
    result = await new Promise((resolveResult, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolveResult({ argv, code, signal, timedOut, elapsedMs: Date.now() - startedAt }));
    });
  } finally {
    clearTimeout(timer);
    if (timedOut) terminate();
  }
  return {
    ...result,
    output: Buffer.concat(chunks).toString(),
    stdout: Buffer.concat(stdoutChunks).toString(),
    stderr: Buffer.concat(stderrChunks).toString(),
  };
}

export function errorExit(error) {
  console.error(error.message);
  process.exitCode = 1;
}
