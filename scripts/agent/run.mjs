import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, cp, access, open, unlink, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { parse, stringify } from '../../harness/node_modules/yaml/dist/index.js';
import { command, repoRoot, primaryCheckout, git, fingerprint, errorExit } from './lib.mjs';
import { loadState, saveState, checkBudget, candidateGate } from './run-state.mjs';
import { copyCandidate, prepareDependencies } from './environment.mjs';
import { roleEvents, responseSchema, resolveModels, initialEvent, taskProfiles, invalidateCandidate } from './workflow.mjs';

export async function writeSchemas(control) {
  await mkdir(join(control, 'harness/schemas'), { recursive: true });
  for (const role of Object.keys(roleEvents)) await writeFile(join(control, 'harness/schemas', role + '.json'), JSON.stringify(responseSchema(role)));
}
export function materializeConfig(config, control) {
  config.cli.args[0] = join(control, config.cli.args[0]);
  for (const hat of Object.values(config.hats)) hat.backend.args[0] = join(control, hat.backend.args[0]);
  for (const hook of config.hooks.events['pre.loop.complete']) hook.command[1] = join(control, hook.command[1]);
  return config;
}
function positive(value, fallback, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error('Invalid bounded limit: ' + value);
  return n;
}
export async function cleanupContainers(id) {
  const prefix = 'world-agent-' + id + '-';
  const listed = await command(['docker', 'ps', '-a', '--filter', 'name=' + prefix, '--format', '{{.Names}}'], { stream: false, timeoutMs: 15000 });
  for (const name of listed.output.trim().split('\n').filter(n => n.startsWith(prefix))) {
    await command(['docker', 'rm', '-f', name], { stream: false, timeoutMs: 15000 });
  }
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'task-file': { type: 'string' }, model: { type: 'string' }, profile: { type: 'string' },
    iterations: { type: 'string' }, seconds: { type: 'string' }, image: { type: 'string' },
    'auth-file': { type: 'string' },
    'task-profile': { type: 'string' }, 'worker-model': { type: 'string' }, 'lead-model': { type: 'string' }, 'reasoning-effort': { type: 'string' },
  } });
  const action = positionals[0] ?? 'start';
  const runBase = join(primaryCheckout(), '.agents/runs');
  let runDir, state;
  if (['resume', 'status'].includes(action)) {
    if (!/^[a-f0-9-]{36}$/.test(positionals[1] ?? '')) throw new Error('Supply a recorded run ID');
    runDir = join(runBase, positionals[1]);
    state = await loadState(runDir);
    if (action === 'status') {
      console.log(JSON.stringify({ id: state.id, status: state.status, reason: state.reason,
        activations: state.activations, remainingMs: state.remainingMs, models: state.models, profile: state.profile, taskProfile: state.taskProfile }, null, 2));
      return;
    }
    if (!['interrupted', 'failed', 'blocked'].includes(state.status)) throw new Error('This outcome cannot resume; start a new authorized run');
    if (values.model || values.image || values.iterations || values.seconds || values.profile || values['auth-file']
      || values['worker-model'] || values['lead-model'] || values['reasoning-effort'] || values['task-profile']) {
      throw new Error('Resume preserves the original model, environment and limits; start a new run to change them');
    }
    if (state.schemaVersion !== 2) throw new Error('This run uses the previous workflow; start a new run with the updated harness');
    if (values['task-file']) {
      state.task += '\n\nOwner clarification:\n' + await readFile(values['task-file'], 'utf8');
      state.requirements = null; state.qaPlan = null; state.plan = null;
      state.lastEvent = initialEvent(state.taskProfile);
    } else if (state.status === 'blocked') state.lastEvent = state.requirements ? 'plan.start' : initialEvent(state.taskProfile);
    else if (['review.passed', 'qa.passed', 'candidate.verified', 'LOOP_COMPLETE', 'qa.start'].includes(state.lastEvent)) state.lastEvent = 'candidate.ready';
    state.deadline = Date.now() + state.remainingMs;
    checkBudget(state);
    state.status = 'running';
    state.reason = null;
    invalidateCandidate(state);
  } else if (action === 'start') {
    if (!values['task-file']) throw new Error('Usage: agent:run -- start --task-file <file> [--task-profile routine|feature|sensitive] [--model <all-role override>] [--profile check|acceptance] [--iterations 24] [--seconds 3600]');
    const branch = git(['branch', '--show-current']);
    if (!branch || branch === 'main') throw new Error('Start from a non-main task worktree');
    if (git(['status', '--porcelain'])) throw new Error('Commit the input first; runs require a clean source snapshot');
    const profile = values.profile ?? 'check';
    if (!['check', 'acceptance'].includes(profile)) throw new Error('Run profile must be check or acceptance');
    const taskProfile = values['task-profile'] ?? 'routine';
    if (!taskProfiles.includes(taskProfile)) throw new Error('Unknown task profile: ' + taskProfile);
    const models = resolveModels(JSON.parse(await readFile(join(repoRoot, 'harness/models.json'))), {
      model: values.model, workerModel: values['worker-model'], leadModel: values['lead-model'], reasoningEffort: values['reasoning-effort'],
    });
    const id = randomUUID();
    runDir = join(runBase, id);
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    const image = values.image ?? 'herdr-world-agent:1';
    const inspect = await command(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], { stream: false, timeoutMs: 15000 });
    if (inspect.code !== 0) throw new Error('Build the execution image first: npm run agent:image');
    const authFile = resolve(values['auth-file'] ?? join(homedir(), '.codex/auth.json'));
    await access(authFile);
    const limits = { iterations: positive(values.iterations, 24, 64), seconds: positive(values.seconds, 3600, 86400), failures: 3 };
    state = { schemaVersion: 2, id, status: 'preparing', sourceRevision: git(['rev-parse', 'HEAD']),
      sourceFingerprint: await fingerprint(), model: values.model ?? null, models, taskProfile, lastEvent: initialEvent(taskProfile), image: inspect.output.trim(), profile, authFile,
      task: await readFile(values['task-file'], 'utf8'), limits, activations: 0, consecutiveFailures: 0,
      turns: [], costUsd: null, remainingMs: limits.seconds * 1000, startedAt: new Date().toISOString() };
    const control = join(runDir, 'control');
    await mkdir(join(control, 'scripts'), { recursive: true });
    await cp(join(repoRoot, 'harness'), join(control, 'harness'), { recursive: true, verbatimSymlinks: true });
    await cp(join(repoRoot, 'scripts/agent'), join(control, 'scripts/agent'), { recursive: true });
    await writeSchemas(control);
    await copyCandidate(process.cwd(), join(runDir, 'workspace'));
    state.workspaceBaseline = git(['rev-parse', 'HEAD'], join(runDir, 'workspace'));
    await saveState(runDir, state);
    const prepared = await prepareDependencies(state, join(runDir, 'workspace'), control);
    if (prepared.code !== 0) {
      state.status = 'blocked'; state.reason = 'Dependency preparation failed; see bootstrap.log';
      await saveState(runDir, state); throw new Error(state.reason);
    }
    state.deadline = Date.now() + state.remainingMs;
    state.status = 'running';
    await saveState(runDir, state);
  } else throw new Error('Actions: start, resume <id>, status <id>');
  // Ralph 2.10.1 merges global hooks. Refuse that implicit execution surface.
  try { await access(join(homedir(), '.ralph/config.yml')); throw new Error('Use a clean runner account without ~/.ralph/config.yml'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lockPath = join(runDir, 'supervisor.lock');
  const lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  await lock.close();
  try {
    if (action === 'resume') await saveState(runDir, state);
    const control = join(runDir, 'control');
    const config = materializeConfig(parse(await readFile(join(control, 'harness/ralph.yml'), 'utf8')), control);
    // Resume starts a new event ledger; our persisted activation budget remains authoritative.
    config.event_loop.max_iterations = state.limits.iterations - state.activations;
    config.event_loop.starting_event = state.lastEvent ?? initialEvent(state.taskProfile);
    if (action === 'resume') {
      config.event_loop.starting_event = state.lastEvent ?? 'plan.start';
      const previous = join(runDir, 'ralph-history', randomUUID());
      await mkdir(join(runDir, 'ralph-history'), { recursive: true });
      await rename(join(runDir, 'workspace/.ralph'), previous);
      await mkdir(join(runDir, 'workspace/.ralph'), { recursive: true });
      await cp(join(previous, 'agent'), join(runDir, 'workspace/.ralph/agent'), { recursive: true });
    }
    config.event_loop.max_runtime_seconds = Math.max(1, Math.floor(state.remainingMs / 1000));
    await writeFile(join(runDir, 'ralph.yml'), stringify(config));
    await writeFile(join(runDir, 'task.md'), state.task);
    await mkdir(join(runDir, 'workspace/.ralph/agent'), { recursive: true });
    try {
      await writeFile(join(runDir, 'workspace/.ralph/agent/scratchpad.md'),
        '# Task progress\n\n' + state.task + '\n', { flag: 'wx' });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const result = await command([join(control, 'harness/bin/ralph'), 'run',
      '-c', join(runDir, 'ralph.yml'), '-P', join(runDir, 'task.md'), '--autonomous', '--no-auto-merge'],
    { cwd: join(runDir, 'workspace'), env: { ...process.env, WORLD_AGENT_RUN: runDir },
      timeoutMs: state.remainingMs, log: join(runDir, 'ralph.log') });
    state = await loadState(runDir);
    state.remainingMs = Math.max(0, state.remainingMs - result.elapsedMs);
    if (result.interrupted) { state.status = 'interrupted'; state.reason = 'Supervisor interrupted'; }
    else if (state.status !== 'ready-for-review' &&
      (result.timedOut || state.activations >= state.limits.iterations || state.consecutiveFailures >= state.limits.failures)) {
      state.status = 'exhausted'; state.reason = 'Execution budget exhausted';
    } else if (state.status !== 'blocked') {
      try { await candidateGate(runDir); if (result.code !== 0) throw new Error('Ralph exited unsuccessfully'); }
      catch (error) { state.status = 'failed'; state.reason = error.message; }
    }
    state.finishedAt = new Date().toISOString();
    await saveState(runDir, state);
    const workspace = join(runDir, 'workspace');
    git(['add', '-N', '.'], workspace);
    const patch = await command(['git', '-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', '--binary', state.workspaceBaseline],
      { cwd: workspace, stream: false, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    if (patch.code !== 0) throw new Error('Candidate patch export failed');
    await writeFile(join(runDir, 'candidate.patch'), patch.output);
    console.log(JSON.stringify({ id: state.id, status: state.status, reason: state.reason, artifact: join(runDir, 'candidate.patch'), costUsd: null }, null, 2));
    if (state.status !== 'ready-for-review') process.exitCode = 1;
  } finally {
    await cleanupContainers(state.id);
    await unlink(lockPath);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(errorExit);
