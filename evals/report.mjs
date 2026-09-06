import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.argv[2] ?? 'evals/jobs');
let live;
try { live = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (live?.kind === 'live-model-trials') {
  for (const trial of live.trials) {
    try { trial.regrade = JSON.parse(await readFile(join(directory, `${trial.case}-${trial.variant}-${trial.attempt}`, 'regrade.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const variants = live.variants.map(variant => {
    const trials = live.trials.filter(t => t.variant === variant);
    const usages = trials.flatMap(t => t.turns).map(t => t.usage).filter(Boolean);
    return { variant, trials: trials.length, gradedPasses: trials.filter(t => t.reward === 1).length,
      readyForReview: trials.filter(t => t.status === 'ready-for-review').length,
      elapsedSeconds: trials.reduce((n, t) => n + t.elapsedMs / 1000, 0),
      inputTokens: usages.reduce((n, u) => n + (u.input_tokens ?? 0), 0),
      outputTokens: usages.reduce((n, u) => n + (u.output_tokens ?? 0), 0), costUsd: null };
  });
  console.log(JSON.stringify({ source: live.source, harnessFingerprint: live.harnessFingerprint,
    models: live.models, variants, trials: live.trials.map(({ case: task, variant, reward, status, reason, oracleConsultations, regrade }) =>
      ({ task, variant, reward, status, reason, oracleConsultations, regrade })) }, null, 2));
  process.exit(0);
}
const job = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(directory, 'lock.json'), 'utf8'));
const elapsedSeconds = job.finished_at && job.started_at
  ? (Date.parse(job.finished_at) - Date.parse(job.started_at)) / 1000 : null;
const trials = [];
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  try {
    const trial = JSON.parse(await readFile(join(directory, entry.name, 'result.json'), 'utf8'));
    trials.push({ task: trial.task_name ?? entry.name.split('__')[0],
      rewards: trial.verifier_result?.rewards ?? null,
      error: trial.exception_info?.exception_type ?? null });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(JSON.stringify({
  schemaVersion: 1,
  harbor: lock.harbor,
  agents: [...new Map((lock.trials ?? []).map(t => {
    const a = { name: t.agent.name ?? t.agent.import_path, model: t.agent.model_name ?? null };
    return [JSON.stringify(a), a];
  })).values()],
  tasks: (lock.trials ?? []).map(t => ({ name: t.task.name, digest: t.task.digest })),
  trialCount: job.n_total_trials, errors: job.stats.n_errored_trials, retries: job.stats.n_retries,
  elapsedSeconds, inputTokens: job.stats.n_input_tokens, outputTokens: job.stats.n_output_tokens,
  costUsd: job.stats.cost_usd ?? null, evals: job.stats.evals, trials,
}, null, 2));
