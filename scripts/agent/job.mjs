import { spawn } from 'node:child_process';
import { mkdir, readFile, open } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { command, jsonFile, primaryCheckout, errorExit } from './lib.mjs';

// A process supervises Ralph. No extra model turn is needed to keep a job alive.
export async function launchJob(argv, { cwd = process.cwd(), env = process.env, root = primaryCheckout(cwd) } = {}) {
  const id = randomUUID(), directory = join(root, '.agents/jobs', id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await jsonFile(join(directory, 'job.json'), { id, status: 'starting', startedAt: new Date().toISOString() });
  // Only supervisor argv/cwd are saved; credentials and inherited environment are not serialized.
  await jsonFile(join(directory, 'command.json'), { argv, cwd });
  const log = await open(join(directory, 'supervisor.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'execute', directory], {
      cwd, env, detached: true, stdio: ['ignore', log.fd, log.fd],
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { await log.close(); }
  return { id, directory, wait: 'npm run agent:job -- wait ' + id };
}
export async function waitJob(directory, { timeoutMs = 60000 } = {}) {
  const terminal = state => !['starting', 'running'].includes(state.status);
  const read = async () => JSON.parse(await readFile(join(directory, 'job.json'), 'utf8'));
  // Subscribe before reading to avoid missing completion between a read and watch.
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, state) => {
      if (finished) return; finished = true; watcher.close(); clearTimeout(timer);
      if (error) reject(error); else resolve(state);
    };
    const inspect = () => read().then(state => { if (terminal(state)) finish(null, state); }).catch(error => finish(error));
    const watcher = watch(directory, inspect);
    watcher.on('error', error => finish(error));
    const timer = setTimeout(() => read().then(state => finish(null, state)).catch(error => finish(error)), timeoutMs);
    inspect();
  });
}
async function main() {
  const [action, id] = process.argv.slice(2);
  if (action === 'execute') {
    const directory = id, path = join(directory, 'job.json');
    const job = JSON.parse(await readFile(path, 'utf8'));
    const { argv, cwd } = JSON.parse(await readFile(join(directory, 'command.json'), 'utf8'));
    await jsonFile(path, { ...job, status: 'running', pid: process.pid });
    try {
      const result = await command(argv, { cwd, env: { ...process.env, WORLD_AGENT_JOB_DIR: directory },
        timeoutMs: 88000000, graceMs: 10000 }); // Run deadlines remain enforced inside run.mjs.
      const latest = JSON.parse(await readFile(path, 'utf8'));
      await jsonFile(path, { ...latest, status: result.code === 0 ? 'completed' : 'needs-attention',
        code: result.code, finishedAt: new Date().toISOString() });
    } catch (error) {
      const latest = JSON.parse(await readFile(path, 'utf8'));
      await jsonFile(path, { ...latest, status: 'failed', reason: error.message, finishedAt: new Date().toISOString() });
      throw error;
    }
    return;
  }
  if (!['status', 'wait'].includes(action) || !/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('Usage: agent:job status|wait JOB_ID');
  const directory = join(primaryCheckout(), '.agents/jobs', id);
  const state = action === 'wait' ? await waitJob(directory) : JSON.parse(await readFile(join(directory, 'job.json'), 'utf8'));
  console.log(JSON.stringify(state, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(errorExit);
