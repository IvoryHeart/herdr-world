import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, cp, access, open, unlink, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { parse, stringify } from '../../harness/node_modules/yaml/dist/index.js';
import { command, repoRoot, primaryCheckout, git, fingerprint, errorExit, jsonFile } from './lib.mjs';
import { loadState, saveState, checkBudget, candidateGate } from './run-state.mjs';
import { copyCandidate, prepareDependencies } from './environment.mjs';
import { roleEvents, responseSchema, resolveModels, initialEvent, taskProfiles, invalidateCandidate } from './workflow.mjs';
import { validateSessionGroups, fullSessionGroups } from './sessions.mjs';
import { budgetPolicy } from './budgets.mjs';
import { recoverUsage, recordEvent, readLedger, attemptsFromLedger } from './usage.mjs';
import { telemetryConfig, flushTelemetry, localTelemetryEndpoint } from './telemetry.mjs';
import { launchJob } from './job.mjs';
import { recordTask } from './task.mjs';
import { copyReferenceImages } from './references.mjs';

export async function writeSchemas(control) {
  await mkdir(join(control, 'harness/schemas'), { recursive: true });
  for (const role of Object.keys(roleEvents)) await writeFile(join(control, 'harness/schemas', role + '.json'), JSON.stringify(responseSchema(role)));
}
export function materializeConfig(config, control, seconds) {
  config.cli.args[0] = join(control, config.cli.args[0]);
  for (const hat of Object.values(config.hats)) hat.backend.args[0] = join(control, hat.backend.args[0]);
  for (const hook of config.hooks.events['pre.loop.complete']) hook.command[1] = join(control, hook.command[1]);
  // The backend owns stage deadlines; the custom adapter must not retain a 15-minute cap.
  if (seconds) config.adapters.claude.timeout = seconds + 30;
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
    sessions: { type: 'string' }, interview: { type: 'boolean', default: false },
    workflow: { type: 'string' }, 'oracle-model': { type: 'string' }, 'otel-endpoint': { type: 'string' },
    background: { type: 'boolean', default: false },
    'reference-image': { type: 'string', multiple: true },
  } });
  const action = positionals[0] ?? 'start';
  if (values.background) {
    if (!['start', 'resume'].includes(action)) throw new Error('Only start/resume can run in the background');
    console.log(JSON.stringify(await launchJob([process.execPath, fileURLToPath(import.meta.url),
      ...process.argv.slice(2).filter(arg => arg !== '--background')]), null, 2));
    return;
  }
  const runBase = join(primaryCheckout(), '.agents/runs');
  let runDir, state;
  if (['resume', 'status'].includes(action)) {
    if (!/^[a-f0-9-]{36}$/.test(positionals[1] ?? '')) throw new Error('Supply a recorded run ID');
    runDir = join(runBase, positionals[1]);
    state = await loadState(runDir);
    if (action === 'status') {
      const attempts = attemptsFromLedger(await readLedger(runDir));
      const active = attempts.findLast(a => !a.finished);
      let activity;
      if (active?.sessionGroup) {
        try { activity = JSON.parse(await readFile(join(runDir, 'sessions', active.sessionGroup, 'session.json'), 'utf8')).lastActivityAt; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      console.log(JSON.stringify({ id: state.id, status: state.status, reason: state.reason,
        activations: state.activations, remainingMs: state.status === 'running' ? Math.max(0, state.deadline - Date.now()) : state.remainingMs,
        active: active ? { role: active.role, elapsedMs: active.elapsedMs, lastActivityAt: activity ?? null,
          quietForMs: activity ? Math.max(0, Date.now() - Date.parse(activity)) : null } : null,
        stageSpentMs: Object.fromEntries([...new Set(attempts.map(a => a.stage))].map(stage =>
          [stage, attempts.filter(a => a.stage === stage).reduce((n, a) => n + a.elapsedMs, 0)])),
        models: state.models, profile: state.profile, taskProfile: state.taskProfile,
        sessions: state.sessions, sessionMode: state.sessionMode, workflow: state.workflow, budgets: state.budgets,
        lastEvent: state.lastEvent, intake: state.intake, delivery: state.delivery }, null, 2));
      return;
    }
    if (!['interrupted', 'failed', 'blocked'].includes(state.status)) throw new Error('This outcome cannot resume; start a new authorized run');
    if (values.model || values.image || values.iterations || values.seconds || values.profile || values['auth-file']
      || values['worker-model'] || values['lead-model'] || values['oracle-model'] || values.workflow || values['otel-endpoint']
      || values['reasoning-effort'] || values['task-profile'] || values.sessions || values.interview) {
      throw new Error('Resume preserves the original model, environment and limits; start a new run to change them');
    }
    if (state.intake?.questions?.length && !values['task-file']) throw new Error('Answer the recorded questions with resume <id> --task-file <answers.md>');
    if (![3, 4].includes(state.schemaVersion)) throw new Error('This run uses the previous workflow; start a new run with the updated harness');
    if (values['task-file']) {
      const clarification = await readFile(values['task-file'], 'utf8');
      if (!clarification.trim()) throw new Error('Owner clarification cannot be empty');
      state.task += '\n\nOwner clarification:\n' + clarification;
      state.requirements = null; state.qaPlan = null; state.plan = null;
      state.lastEvent = initialEvent(state.taskProfile);
      if (state.intake) state.intake.ready = false;
    } else if (state.status === 'blocked') state.lastEvent = state.requirements ? 'plan.start' : initialEvent(state.taskProfile);
    else if (['review.passed', 'qa.passed', 'candidate.verified', 'LOOP_COMPLETE', 'qa.start'].includes(state.lastEvent)) state.lastEvent = 'candidate.ready';
    state.deadline = Date.now() + state.remainingMs;
    checkBudget(state);
    state.status = 'running';
    if (values['reference-image']?.length && !values['task-file']) throw new Error('Add reference images with the owner clarification --task-file');
    // Preserve the last failure as context until a successful role turn clears it.
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
    const policy = JSON.parse(await readFile(join(repoRoot, 'harness/models.json')));
    const workflow = values.workflow ?? 'two-history';
    const models = resolveModels(policy, {
      model: values.model, workerModel: values['worker-model'], leadModel: values['lead-model'], oracleModel: values['oracle-model'],
      reasoningEffort: values['reasoning-effort'], workflow,
    });
    const sessionMode = values.sessions ?? 'persistent';
    if (!['persistent', 'fresh'].includes(sessionMode)) throw new Error('Sessions must be persistent or fresh');
    const id = randomUUID();
    runDir = join(runBase, id);
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    const image = values.image ?? 'herdr-world-agent:1';
    const inspect = await command(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], { stream: false, timeoutMs: 15000 });
    if (inspect.code !== 0) throw new Error('Build the execution image first: npm run agent:image');
    const authFile = resolve(values['auth-file'] ?? join(homedir(), '.codex/auth.json'));
    await access(authFile);
    const limits = { iterations: positive(values.iterations, 24, 64), seconds: positive(values.seconds, 3600, 86400), failures: 3 };
    state = { schemaVersion: 4, id, status: 'preparing', sourceRevision: git(['rev-parse', 'HEAD']),
      sourceFingerprint: await fingerprint(), model: values.model ?? null, models, taskProfile, lastEvent: initialEvent(taskProfile), image: inspect.output.trim(), profile, authFile,
      sessionMode, workflow, budgets: budgetPolicy(limits.seconds),
      telemetry: telemetryConfig(values['otel-endpoint'] ?? process.env.WORLD_AGENT_OTEL_ENDPOINT ?? await localTelemetryEndpoint(primaryCheckout())),
      sessionGroups: validateSessionGroups(workflow === 'full' ? fullSessionGroups : policy.sessionGroups), sessions: {},
      task: await readFile(values['task-file'], 'utf8'), intake: values.interview ? { ready: false } : null,
      delivery: { worktree: process.cwd(), base: process.env.WORLD_AGENT_BASE ?? 'main', parent: process.env.WORLD_AGENT_PARENT ?? null }, limits, activations: 0, consecutiveFailures: 0,
      turns: [], costUsd: null, remainingMs: limits.seconds * 1000, startedAt: new Date().toISOString() };
    const control = join(runDir, 'control');
    await mkdir(join(control, 'scripts'), { recursive: true });
    await cp(join(repoRoot, 'harness'), join(control, 'harness'), { recursive: true, verbatimSymlinks: true });
    await cp(join(repoRoot, 'scripts/agent'), join(control, 'scripts/agent'), { recursive: true });
    await writeSchemas(control);
    state.referenceImages = await copyReferenceImages(values['reference-image'] ?? [], control);
    await copyCandidate(process.cwd(), join(runDir, 'workspace'));
    state.workspaceBaseline = git(['rev-parse', 'HEAD'], join(runDir, 'workspace'));
    await saveState(runDir, state);
    await recordTask(process.cwd(), { mode: 'ralph', runId: id, base: state.delivery.base, parent: state.delivery.parent });
    console.log('Execution: Ralph\nRun ID: ' + id + '\nWorkflow: ' + workflow);
    if (process.env.WORLD_AGENT_JOB_DIR) {
      const path = join(process.env.WORLD_AGENT_JOB_DIR, 'job.json');
      await jsonFile(path, { ...JSON.parse(await readFile(path, 'utf8')), runId: state.id });
    }
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
    if (action === 'resume') {
      // Owner input may extend the control packet only while this supervisor owns the run.
      if (values['reference-image']?.length) state.referenceImages = await copyReferenceImages(values['reference-image'], join(runDir, 'control'), state.referenceImages);
      await saveState(runDir, state);
    }
    const control = join(runDir, 'control');
    await mkdir(join(runDir, 'workspace/.ralph/agent'), { recursive: true });
    if (state.intake && !state.intake.ready) {
      const { conductIntake } = await import(pathToFileURL(join(control, 'scripts/agent/intake.mjs')));
      await conductIntake(runDir, state);
      if (state.status !== 'running') {
        console.log(JSON.stringify({ id: state.id, status: state.status, reason: state.reason, questions: state.intake.questions,
          resume: 'npm run agent:run -- resume ' + state.id + ' --task-file <answers.md>' }, null, 2));
        process.exitCode = 1;
        return;
      }
    }
    const config = materializeConfig(parse(await readFile(join(control, 'harness/ralph.yml'), 'utf8')), control, state.limits.seconds);
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
      timeoutMs: state.remainingMs, graceMs: state.budgets ? 10000 : 0, log: join(runDir, 'ralph.log') });
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
    const usage = await recoverUsage(runDir, { interrupted: true });
    // Include attempts whose adapter was killed before it could save a turn row.
    state = await loadState(runDir);
    for (const attempt of usage.attempts.filter(a => a.role !== 'verifier')) {
      const turn = state.turns.find(t => t.attemptId === attempt.attemptId);
      if (turn) { turn.usage = attempt.usage; turn.usageCoverage = attempt.coverage; }
      else state.turns.push({ role: attempt.role, model: attempt.model, reasoningEffort: attempt.reasoningEffort,
        attemptId: attempt.attemptId, elapsedMs: attempt.elapsedMs, code: attempt.code, usage: attempt.usage,
        usageCoverage: attempt.coverage, recovered: true, costUsd: null, sessionGroup: attempt.sessionGroup });
    }
    await saveState(runDir, state);
    recordEvent(runDir, 'run.stopped', { runId: state.id, status: state.status });
    await flushTelemetry(runDir, state.telemetry);
    await unlink(lockPath);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(errorExit);
