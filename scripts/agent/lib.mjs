import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { lstat, readFile, readlink, mkdir, writeFile, rename } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function git(args, cwd = process.cwd()) {
  const safeArgs = args[0] === 'diff' ? ['diff', '--no-ext-diff', '--no-textconv', ...args.slice(1)] : args;
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...safeArgs], {
    cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trimEnd();
}
export function primaryCheckout(cwd = process.cwd()) {
  const first = git(['worktree', 'list', '--porcelain'], cwd).split('\n')[0];
  if (!first.startsWith('worktree ')) throw new Error('Cannot resolve primary checkout');
  return first.slice(9);
}
export function slug(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value ?? '')) throw new Error('Use a lowercase task slug (letters, digits, hyphens; max 64)');
  return value;
}
export async function jsonFile(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + process.pid + '.tmp';
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}
export async function sourceFiles(cwd) {
  return [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd).split('\0').filter(Boolean))].sort();
}
export async function assertSourceParents(cwd, file) {
  const parts = file.split('/');
  for (let i = 1; i < parts.length; i++) {
    try {
      if ((await lstat(join(cwd, ...parts.slice(0, i)))).isSymbolicLink()) {
        throw new Error('Source parent is a symbolic link: ' + file);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
export async function fingerprint(cwd = process.cwd()) {
  const hash = createHash('sha256');
  for (const file of await sourceFiles(cwd)) {
    await assertSourceParents(cwd, file);
    let stat;
    try { stat = await lstat(join(cwd, file)); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('Unsupported source entry: ' + file);
    const data = stat.isSymbolicLink() ? Buffer.from(await readlink(join(cwd, file))) : await readFile(join(cwd, file));
    hash.update(JSON.stringify([file, stat.isSymbolicLink() ? 'link' : (stat.mode & 0o111) ? 'executable' : 'file', data.length]));
    hash.update(data);
  }
  return hash.digest('hex');
}
export const profiles = {
  check: [['npm', 'run', 'check']],
  acceptance: [['npm', 'run', 'check:acceptance']],
  'acceptance-offline': [['npm', 'run', 'check'], ['npm', 'run', 'test:e2e'], ['npm', 'run', 'test:independence']],
  harness: [['npm', 'run', 'test:agent'], ['npm', 'run', 'spec:check'], ['npm', 'run', 'eval:check']],
};
function processParents() {
  if (process.platform === 'linux') {
    // Read procfs directly: spawning `ps` during cancellation can stall until its own
    // timeout under load, allowing detached descendants to run after our deadline.
    const rows = [];
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync('/proc/' + name + '/stat', 'utf8');
        // comm is parenthesized and can itself contain spaces or closing parentheses.
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        rows.push([Number(name), Number(fields[1])]);
      } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
    }
    return rows;
  }
  return execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 2000 })
    .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
}
export async function command(argv, { cwd = process.cwd(), env = process.env, timeoutMs = 1200000, log, input, stream = true } = {}) {
  if (!Array.isArray(argv) || !argv.length) throw new Error('Command must be a nonempty argv array');
  const start = Date.now();
  const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks = [];
  const stdoutChunks = [];
  const stderrChunks = [];
  let timedOut = false;
  let interrupted = false;
  const terminate = () => {
    // Ralph/backends can create their own process groups. Capture descendants before
    // killing their parent so a detached worker cannot keep running after a stop.
    const descendants = new Set([child.pid]);
    if (process.platform !== 'win32') {
      try {
        const rows = processParents();
        let added = true;
        while (added) {
          added = false;
          for (const [pid, parent] of rows) if (descendants.has(parent) && !descendants.has(pid)) {
            descendants.add(pid); added = true;
          }
        }
      } catch { /* Process-group cleanup still applies if the process table is unavailable. */ }
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    for (const pid of [...descendants].reverse()) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
    }
  };
  const kill = () => { timedOut = true; terminate(); };
  const timer = setTimeout(kill, timeoutMs);
  const interrupt = () => { interrupted = true; terminate(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  child.stdout.on('data', chunk => { chunks.push(chunk); stdoutChunks.push(chunk); if (stream) process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { chunks.push(chunk); stderrChunks.push(chunk); if (stream) process.stderr.write(chunk); });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  let result;
  try {
    result = await new Promise((resolveResult, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolveResult({ argv, code, signal, timedOut, interrupted, elapsedMs: Date.now() - start }));
    });
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  const output = Buffer.concat(chunks).toString();
  if (log) { await mkdir(dirname(log), { recursive: true }); await writeFile(log, output, { mode: 0o600 }); }
  return { ...result, output, stdout: Buffer.concat(stdoutChunks).toString(), stderr: Buffer.concat(stderrChunks).toString() };
}
export async function verify({ cwd = process.cwd(), profile = 'check', commands = profiles[profile], output = join(cwd, '.agents/state/verification.json'), timeoutMs = 1200000, stream = true } = {}) {
  if (!commands) throw new Error('Unknown verification profile: ' + profile);
  const before = await fingerprint(cwd);
  const receipt = { schemaVersion: 1, status: 'running', profile, sourceRevision: git(['rev-parse', 'HEAD'], cwd),
    fingerprint: before, startedAt: new Date().toISOString(), checks: [] };
  await jsonFile(output, receipt);
  for (const [index, argv] of commands.entries()) {
    const log = join(dirname(output), 'verify-' + index + '.log');
    const { output: ignored, stdout: ignoredStdout, stderr: ignoredStderr, ...result } = await command(argv, { cwd, timeoutMs, stream, log });
    receipt.checks.push({ ...result, log: 'verify-' + index + '.log' });
    if (result.code !== 0 || result.timedOut) break;
  }
  receipt.status = receipt.checks.length === commands.length && receipt.checks.every(r => r.code === 0 && !r.timedOut)
    && before === await fingerprint(cwd) ? 'passed' : 'failed';
  receipt.finishedAt = new Date().toISOString();
  await jsonFile(output, receipt);
  return receipt;
}
export async function assertReceipt(cwd, receipt, allowedProfiles = ['check', 'acceptance']) {
  if (receipt.status !== 'passed' || !allowedProfiles.includes(receipt.profile)
    || !receipt.checks?.length || receipt.checks.some(r => r.code !== 0 || r.timedOut)
    || receipt.fingerprint !== await fingerprint(cwd)) throw new Error('Verification is missing, failed, insufficient, or stale; run agent:verify');
}
export function errorExit(error) { console.error(error.message); process.exitCode = 1; }
