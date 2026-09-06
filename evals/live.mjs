// Saved-auth trials using the production Docker boundary and the same frozen Harbor tasks.
// Only the evaluator reads graders/reference solutions; workers receive the source archive.
import { readFile, writeFile, mkdir, cp, readdir, lstat, access, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { command, git, jsonFile, repoRoot, fingerprint, assertSourceParents, errorExit } from '../scripts/agent/lib.mjs';
import { inContainer, prepareDependencies } from '../scripts/agent/environment.mjs';
import { writeSchemas, cleanupContainers } from '../scripts/agent/run.mjs';
import { resolveModels } from '../scripts/agent/workflow.mjs';
import { artifactFor } from './task-artifacts.mjs';

async function main() {
  const { values } = parseArgs({ options: {
    prepared: { type: 'string' }, cases: { type: 'string' }, variants: { type: 'string', default: 'baseline,ralph' },
    attempts: { type: 'string', default: '1' }, seconds: { type: 'string', default: '1800' },
    model: { type: 'string' }, 'worker-model': { type: 'string' }, 'lead-model': { type: 'string' },
    'auth-file': { type: 'string' }, 'jobs-dir': { type: 'string', default: 'evals/jobs' },
    'keep-caches': { type: 'boolean', default: false },
  } });
  if (!values.prepared || !values.cases) throw new Error('Usage: eval:live -- --prepared PREPARED_TASKS --cases ID,ID [--variants baseline,ralph] [--attempts 1] [--seconds 1800]');
  const attempts = Number(values.attempts), seconds = Number(values.seconds);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5 || !Number.isInteger(seconds) || seconds < 30 || seconds > 3600) throw new Error('Use 1–5 attempts and 30–3600 seconds per trial');
  const variants = [...new Set(values.variants.split(','))];
  if (variants.some(v => !['baseline', 'ralph'].includes(v))) throw new Error('Variants: baseline,ralph');
  const prepared = resolve(values.prepared);
  const ids = [...new Set(values.cases.split(','))];
  const entries = await Promise.all(ids.map(async id => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid case ID');
    return JSON.parse(await readFile(join(prepared, id, 'tests/case.json')));
  }));
  const source = JSON.parse(await readFile(join(dirname(prepared), 'inputs.json')));
  const authFile = resolve(values['auth-file'] ?? join(homedir(), '.codex/auth.json'));
  await access(authFile);
  const inspect = await command(['docker', 'image', 'inspect', 'herdr-world-agent:1', '--format', '{{.Id}}'], { stream: false });
  if (inspect.code !== 0) throw new Error('Build the execution image with agent:image');
  const models = resolveModels(JSON.parse(await readFile(join(repoRoot, 'harness/models.json'))), {
    model: values.model, workerModel: values['worker-model'], leadModel: values['lead-model'],
  });
  const job = resolve(values['jobs-dir'], 'live-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(job, { recursive: true, mode: 0o700 });
  // Freeze executable controls once, so edits during a long job cannot change later variants.
  const harnessSource = join(job, 'harness-source');
  await mkdir(join(harnessSource, 'scripts'), { recursive: true });
  await cp(join(repoRoot, 'harness'), join(harnessSource, 'harness'), { recursive: true, verbatimSymlinks: true });
  await cp(join(repoRoot, 'scripts/agent'), join(harnessSource, 'scripts/agent'), { recursive: true });
  const report = { schemaVersion: 1, kind: 'live-model-trials', source, harnessRevision: git(['rev-parse', 'HEAD'], repoRoot),
    harnessFingerprint: await fingerprint(repoRoot), models, image: inspect.output.trim(), attempts, seconds,
    variants, cases: ids, startedAt: new Date().toISOString(), costUsd: null, trials: [] };
  await jsonFile(join(job, 'report.json'), report);
  console.log('Live trial report: ' + join(job, 'report.json'));
  trials: for (const entry of entries) for (let attempt = 1; attempt <= attempts; attempt++) for (const variant of variants) {
    const trialDir = join(job, entry.id + '-' + variant + '-' + attempt);
    const workspace = join(trialDir, 'workspace');
    await mkdir(workspace, { recursive: true });
    const unpack = await command(['tar', '-xf', join(prepared, entry.id, 'environment/repo.tar'), '-C', workspace], { stream: false });
    if (unpack.code !== 0) throw new Error('Source extraction failed');
    if (entry.mutant) {
      const helper = join(workspace, 'web/src/terminalReconnectPolicy.ts');
      const text = await readFile(helper, 'utf8');
      if (!text.includes('Math.min(')) throw new Error('Seed mutation no longer applies');
      await writeFile(helper, text.replace('Math.min(', 'Math.max('));
    }
    if (entry.kind === 'knowledge') await writeFile(join(workspace, 'docs/eval-knowledge.md'), 'The bridge cannot authenticate browsers.\nHerdr owns runtime topology.\n');
    git(['init', '-b', 'agent/eval'], workspace); git(['add', '.'], workspace);
    git(['-c', 'user.name=Evaluation', '-c', 'user.email=eval@example.invalid', 'commit', '-qm', 'Frozen evaluation input'], workspace);
    const instruction = await readFile(join(prepared, entry.id, 'instruction.md'), 'utf8');
    const taskFile = join(trialDir, 'task.md'); await writeFile(taskFile, instruction);
    const started = Date.now();
    let result, candidate = workspace, runState, usage = null;
    console.log('Starting ' + entry.id + ' / ' + variant + ' / attempt ' + attempt);
    if (variant === 'ralph') {
      const args = [process.execPath, join(harnessSource, 'scripts/agent/run.mjs'), 'start', '--task-file', taskFile,
        '--task-profile', entry.taskProfile ?? 'routine', '--seconds', String(seconds), '--auth-file', authFile, '--image', report.image];
      for (const option of ['model', 'worker-model', 'lead-model']) if (values[option]) args.push('--' + option, values[option]);
      result = await command(args, { cwd: workspace, stream: false, timeoutMs: (seconds + 1250) * 1000, log: join(trialDir, 'runner.log') });
      const runBase = join(workspace, '.agents/runs');
      try {
        const [id] = await readdir(runBase);
        runState = JSON.parse(await readFile(join(runBase, id, 'run.json')));
        candidate = join(runBase, id, 'workspace');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (result.interrupted && runState) await cleanupContainers(runState.id);
    } else {
      const control = join(trialDir, 'control');
      await mkdir(join(control, 'scripts'), { recursive: true });
      await cp(join(harnessSource, 'harness'), join(control, 'harness'), { recursive: true, verbatimSymlinks: true });
      await cp(join(harnessSource, 'scripts/agent'), join(control, 'scripts/agent'), { recursive: true });
      await writeSchemas(control);
      await mkdir(join(workspace, '.ralph/agent'), { recursive: true });
      const state = { id: 'eval-' + randomUUID(), image: report.image, profile: 'check' };
      result = await prepareDependencies(state, workspace, control);
      if (result.code === 0) result = await inContainer(state, workspace,
        ['/opt/harness/node_modules/.bin/codex', 'exec', '--json', '--ephemeral', '--ignore-user-config',
          '--sandbox', 'danger-full-access', '--model', models.implementer.model,
          '-c', 'model_reasoning_effort=' + JSON.stringify(models.implementer.reasoningEffort), '-'],
        { control, authFile, network: 'bridge', input: instruction, stream: false, timeoutMs: seconds * 1000, log: join(trialDir, 'baseline.jsonl') });
      for (const line of result.stdout.split('\n')) {
        try { const item = JSON.parse(line); if (item.type === 'turn.completed') usage = item.usage; } catch { /* private diagnostics */ }
      }
    }
    const artifacts = join(trialDir, 'artifacts'); await mkdir(artifacts);
    const [sourceArtifact, targetArtifact] = artifactFor(entry);
    try {
      await assertSourceParents(candidate, sourceArtifact);
      const path = join(candidate, sourceArtifact), stat = await lstat(path);
      if (!stat.isFile() || stat.size > 1000000) throw new Error('Unsafe or oversized candidate artifact');
      await cp(path, join(artifacts, targetArtifact));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Grader runs without network, model auth, source repository, or writable candidate artifacts.
    const graded = await command(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
      '--cap-drop=ALL', '--cap-add=SETUID', '--cap-add=SETGID', '--security-opt=no-new-privileges',
      '--pids-limit=64', '--memory=512m', '--cpus=1', '--tmpfs', '/tmp:rw,size=64m',
      '--tmpfs', '/logs/verifier:rw,size=16m',
      '--mount', 'type=bind,src=' + join(prepared, entry.id, 'tests') + ',dst=/tests,readonly',
      '--mount', 'type=bind,src=' + artifacts + ',dst=/candidate,readonly',
      report.image, 'python3', '/tests/grade.py', '/tests/case.json', '/candidate'],
    { stream: false, timeoutMs: 60000, log: join(trialDir, 'grader.log') });
    const grade = graded.code === 0 ? Number(graded.stdout.match(/reward=([01])\s*$/)?.[1] ?? 0) : null;
    const trial = { case: entry.id, variant, attempt, elapsedMs: Date.now() - started, code: result.code,
      reward: grade, status: result.interrupted ? 'interrupted' : runState?.status ?? (result.code === 0 ? 'completed' : 'failed'),
      reason: result.interrupted ? 'Evaluation interrupted' : runState?.reason ?? null, activations: runState?.activations ?? 1,
      oracleConsultations: runState?.oracle?.consultations ?? 0, taskProfile: entry.taskProfile ?? 'routine',
      turns: runState?.turns ?? [{ role: 'baseline', ...models.implementer, usage }],
      acceptance: runState?.requirements?.criteria ?? null, qa: runState?.qa?.results ?? null, costUsd: null };
    report.trials.push(trial); await jsonFile(join(job, 'report.json'), report);
    console.log(JSON.stringify({ case: entry.id, variant, reward: grade, status: trial.status, elapsedMs: trial.elapsedMs }));
    if (!values['keep-caches']) {
      // Retain source, patches, controls and logs; discard only this completed trial's generated dependencies/builds.
      const roots = new Set([workspace, candidate, join(trialDir, 'control')]);
      if (runState) {
        const runDir = dirname(candidate);
        roots.add(join(runDir, 'control'));
        for (const name of await readdir(runDir)) if (/^verification-\d+$/.test(name)) roots.add(join(runDir, name));
      }
      for (const root of roots) for (const path of ['node_modules', 'web/node_modules', 'harness/node_modules', '.agents/cache', 'bridge/target', 'vendor/herdr-compat/target']) {
        await assertSourceParents(root, path);
        await rm(join(root, path), { recursive: true, force: true });
      }
      trial.cachesPruned = true;
      await jsonFile(join(job, 'report.json'), report);
    }
    if (result.interrupted) { report.interrupted = true; break trials; }
  }
  report.finishedAt = new Date().toISOString();
  await jsonFile(join(job, 'report.json'), report);
  console.log('Report: ' + join(job, 'report.json'));
  if (report.interrupted || report.trials.some(t => t.reward !== 1 || (t.variant === 'ralph' && t.status !== 'ready-for-review'))) process.exitCode = 1;
}
main().catch(errorExit);
