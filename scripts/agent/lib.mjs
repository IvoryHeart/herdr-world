import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
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

function processParents() {
  if (process.platform === 'linux') {
    const rows = [];
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync('/proc/' + name + '/stat', 'utf8');
        // comm is parenthesized and can contain spaces or closing parentheses.
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        rows.push([Number(name), Number(fields[1])]);
      } catch (error) {
        if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
      }
    }
    return rows;
  }
  return execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 2000 })
    .trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/).map(Number));
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
  let interrupted = false;
  const append = chunk => { if (log) appendFileSync(log, chunk); chunks.push(chunk); };
  const terminationTargets = new Set([child.pid]);
  const terminate = () => {
    if (process.platform !== 'win32') {
      try {
        const rows = processParents();
        let added = true;
        while (added) {
          added = false;
          for (const [pid, parent] of rows) {
            if (terminationTargets.has(parent) && !terminationTargets.has(pid)) {
              terminationTargets.add(pid);
              added = true;
            }
          }
        }
      } catch { /* Process-group cleanup still applies if procfs is unavailable. */ }
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    for (const pid of [...terminationTargets].reverse()) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
    }
  };
  const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
  const interrupt = () => { interrupted = true; terminate(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
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
      child.once('close', (code, signal) => resolveResult({ argv, code, signal, timedOut, interrupted, elapsedMs: Date.now() - startedAt }));
    });
  } finally {
    clearTimeout(timer);
    if (timedOut || interrupted) terminate();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
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
