// Product regression comparisons: frozen briefs/source/checks, isolated workers and
// an authless evaluator. No reference patch or browser acceptance suite reaches a worker.
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { command, git, repoRoot, jsonFile, fingerprint, assertSourceParents } from '../scripts/agent/lib.mjs';
import { copyCandidate, inContainer } from '../scripts/agent/environment.mjs';
import { recoverUsage, readLedger } from '../scripts/agent/usage.mjs';
import { groupUsage } from '../scripts/agent/metrics.mjs';

export async function seedMutations(workspace, entry) {
  for (const mutation of entry.mutations) {
    const path = join(workspace, mutation.path), source = await readFile(path, 'utf8');
    const occurrences = source.split(mutation.from).length - 1;
    if (!occurrences || (mutation.occurrence === undefined && occurrences !== 1)) throw new Error('Seed no longer applies unambiguously: ' + mutation.path);
    await writeFile(path, source.replace(mutation.from, mutation.to));
  }
}
async function grade(prepared, candidate, entry, directory, image) {
  const reference = join(prepared, 'reference'), workspace = join(directory, 'grading');
  await copyCandidate(reference, workspace);
  // Candidate source executes only after dependency setup, without model auth or network.
  const state = { id: 'product-grade-' + Date.now(), image };
  let result = await inContainer(state, workspace, ['bash', '-c', 'npm ci && npm ci --prefix web && npx --no-install playwright install chromium'],
    { control: reference, network: 'bridge', stream: false, timeoutMs: 180000, log: join(directory, 'prepare-grader.log') });
  if (result.code !== 0) return { status: 'environment-failed', code: result.code };
  // copyCandidate validates symlinks before anything is selected for grading.
  const safe = join(directory, 'candidate-source'); await copyCandidate(candidate, safe);
  await rm(join(workspace, 'web/src'), { recursive: true });
  await cp(join(safe, 'web/src'), join(workspace, 'web/src'), { recursive: true, verbatimSymlinks: true });
  // These checks and all build/test configuration come from the frozen reference.
  await cp(join(reference, 'web/src', entry.unit), join(workspace, 'web/src', entry.unit));
  for (const [index, argv] of [
    ['npm', 'run', 'test:web', '--', entry.unit], ['npm', 'run', 'build:web'],
    ['node_modules/.bin/playwright', 'test', '--grep', entry.browser, '--reporter=json'],
  ].entries()) {
    result = await inContainer(state, workspace, argv, { control: reference, stream: false, timeoutMs: 180000,
      log: join(directory, 'grade-' + index + '.log') });
    if (result.code !== 0) return { status: 'failed', check: index, code: result.code };
  }
  return { status: 'passed', code: 0 };
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    prepared: { type: 'string' }, cases: { type: 'string' }, variants: { type: 'string', default: 'two-history,full' },
    model: { type: 'string' }, 'reasoning-effort': { type: 'string', default: 'high' },
    seconds: { type: 'string', default: '3600' }, attempts: { type: 'string', default: '1' }, 'otel-endpoint': { type: 'string' },
  } });
  const action = positionals[0];
  if (action === 'prepare') {
    const parent = join(repoRoot, 'evals/.prepared'); await mkdir(parent, { recursive: true });
    const prepared = await mkdtemp(join(parent, 'product-'));
    await copyCandidate(repoRoot, join(prepared, 'reference'), { exclude: ['evals/'] });
    // Executable runner dependencies are frozen alongside source, never host user configuration.
    for (const path of ['harness/node_modules', 'harness/bin']) await cp(join(repoRoot, path), join(prepared, 'reference', path), { recursive: true, verbatimSymlinks: true });
    const cases = JSON.parse(await readFile(join(repoRoot, 'evals/product-cases.json'))).cases;
    await jsonFile(join(prepared, 'inputs.json'), { sourceRevision: git(['rev-parse', 'HEAD']), sourceFingerprint: await fingerprint(repoRoot), cases });
    console.log(prepared); return;
  }
  if (!['controls', 'run'].includes(action) || !values.prepared) throw new Error('Usage: eval:product prepare | controls --prepared DIR | run --prepared DIR --model MODEL [--cases ID,ID]');
  const prepared = resolve(values.prepared), inputs = JSON.parse(await readFile(join(prepared, 'inputs.json')));
  const cases = values.cases ? inputs.cases.filter(c => values.cases.split(',').includes(c.id)) : inputs.cases;
  if (!cases.length || (values.cases && values.cases.split(',').some(id => !inputs.cases.some(c => c.id === id)))) throw new Error('Unknown/empty product case selection');
  const variants = values.variants.split(','), seconds = Number(values.seconds), attempts = Number(values.attempts);
  if (variants.some(v => !['two-history', 'full'].includes(v)) || !Number.isInteger(seconds) || seconds < 300 || seconds > 7200
    || !Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new Error('Use known workflows, 300–7200 seconds and 1–3 attempts');
  if (action === 'run' && !values.model) throw new Error('Select one explicit model to hold model allocation constant across workflow variants');
  const inspected = await command(['docker', 'image', 'inspect', 'herdr-world-agent:1', '--format', '{{.Id}}'], { stream: false });
  if (inspected.code !== 0) throw new Error('Build agent:image first');
  const image = inspected.stdout.trim(), reference = join(prepared, 'reference');
  const jobs = join(repoRoot, 'evals/jobs'); await mkdir(jobs, { recursive: true });
  const job = await mkdtemp(join(jobs, 'product-'));
  const report = { kind: 'product-regression-trials', action, sourceRevision: inputs.sourceRevision,
    sourceFingerprint: inputs.sourceFingerprint, image, model: values.model ?? null, reasoningEffort: values['reasoning-effort'],
    seconds, startedAt: new Date().toISOString(), trials: [], costUsd: null };
  console.log('Product trial report: ' + join(job, 'report.json'));
  await jsonFile(join(job, 'report.json'), report);
  for (const entry of cases) for (let attempt = 1; attempt <= (action === 'controls' ? 1 : attempts); attempt++) {
    // Alternate order across attempts so one workflow is not always first.
    const order = action === 'controls' ? ['reference', 'mutant'] : attempt % 2 ? variants : [...variants].reverse();
    for (const variant of order) {
      const directory = join(job, entry.id + '-' + variant + '-' + attempt), workspace = join(directory, 'workspace');
      await copyCandidate(reference, workspace, { exclude: [entry.browserFile] });
      if (variant !== 'reference') await seedMutations(workspace, entry);
      git(['add', '.'], workspace); git(['-c', 'user.name=Evaluation', '-c', 'user.email=eval@example.invalid', 'commit', '--allow-empty', '-qm', 'Trial input'], workspace);
      const task = join(directory, 'brief.md'); await writeFile(task, entry.brief + '\n');
      const started = Date.now(); let candidate = workspace, state, usage, events = [], result;
      if (action === 'run') {
        const args = [process.execPath, join(reference, 'scripts/agent/run.mjs'), 'start', '--task-file', task,
          '--workflow', variant, '--model', values.model, '--reasoning-effort', values['reasoning-effort'], '--seconds', String(seconds),
          '--task-profile', entry.taskProfile, '--profile', 'acceptance', '--image', image];
        if (values['otel-endpoint']) args.push('--otel-endpoint', values['otel-endpoint']);
        result = await command(args, { cwd: workspace, stream: false, timeoutMs: (seconds + 1300) * 1000, log: join(directory, 'runner.log') });
        const runBase = join(workspace, '.agents/runs'), [id] = await readdir(runBase);
        const runDir = join(runBase, id); state = JSON.parse(await readFile(join(runDir, 'run.json')));
        candidate = join(runDir, 'workspace'); usage = await recoverUsage(runDir); events = await readLedger(runDir);
      }
      const executionMs = Date.now() - started;
      const graded = await grade(prepared, candidate, entry, directory, image);
      const firstPatch = events.find(e => e.type === 'candidate.changed');
      const trial = { case: entry.id, variant, attempt, executionMs, gradingMs: Date.now() - started - executionMs,
        status: state?.status ?? 'control', autonomousSuccess: state ? state.status === 'ready-for-review' && graded.status === 'passed' : null,
        grade: graded, timeToFirstPatchMs: firstPatch ? Date.parse(firstPatch.timestamp) - Date.parse(state.startedAt) : null,
        timeouts: usage?.attempts.filter(a => a.timedOut).length ?? null, interventions: 0, monitoringModelWakeups: 0,
        usage: usage?.usage ?? null, usageLowerBound: usage?.lowerBound ?? null,
        byModel: usage ? groupUsage(usage.attempts, 'model') : null, byRole: usage ? groupUsage(usage.attempts, 'role') : null, costUsd: null };
      report.trials.push(trial); await jsonFile(join(job, 'report.json'), report);
      console.log(JSON.stringify({ case: entry.id, variant, grade: graded.status, autonomousSuccess: trial.autonomousSuccess }));
      // Keep source, private native histories, checks and logs; discard only this trial's generated caches.
      const roots = new Set([workspace, candidate, join(directory, 'grading')]);
      if (state) {
        const runDir = resolve(candidate, '..'); roots.add(join(runDir, 'control'));
        for (const name of await readdir(runDir)) if (/^verification-\d+$/.test(name)) roots.add(join(runDir, name));
      }
      for (const root of roots) for (const path of ['node_modules', 'web/node_modules', 'harness/node_modules', '.agents/cache', 'web/dist', 'bridge/target', 'vendor/herdr-compat/target']) {
        await assertSourceParents(root, path);
        await rm(join(root, path), { recursive: true, force: true });
      }
      if (graded.status === 'environment-failed' || (action === 'controls' ? (variant === 'reference') !== (graded.status === 'passed') : !trial.autonomousSuccess)) process.exitCode = 1;
      if (result?.interrupted) { report.interrupted = true; await jsonFile(join(job, 'report.json'), report); return; }
    }
  }
  report.finishedAt = new Date().toISOString(); await jsonFile(join(job, 'report.json'), report);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
