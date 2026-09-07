import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorktree } from './worktree.mjs';
import { command, git, repoRoot, errorExit } from './lib.mjs';
import { launchJob } from './job.mjs';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    parent: { type: 'string' }, slug: { type: 'string' }, profile: { type: 'string', default: 'acceptance' },
    'task-profile': { type: 'string', default: 'feature' }, sessions: { type: 'string', default: 'persistent' },
    image: { type: 'string' }, 'auth-file': { type: 'string' },
    'worker-model': { type: 'string' }, 'lead-model': { type: 'string' }, 'reasoning-effort': { type: 'string' },
    model: { type: 'string' }, seconds: { type: 'string' }, iterations: { type: 'string' },
    background: { type: 'boolean', default: false }, workflow: { type: 'string' },
    'oracle-model': { type: 'string' }, 'otel-endpoint': { type: 'string' },
  } });
  const goal = positionals.join(' ').trim();
  if (!goal) throw new Error('Usage: npm run agent:goal -- "<goal>" [--parent <PR>] [--profile check|acceptance]');
  let base = 'main';
  if (values.parent) {
    if (!/^[1-9][0-9]*$/.test(values.parent)) throw new Error('Parent must be a PR number in this repository');
    const result = await command(['gh', 'pr', 'view', values.parent, '--json', 'headRefName,isCrossRepository,state'], { stream: false });
    if (result.code !== 0) throw new Error(result.output);
    const parent = JSON.parse(result.stdout);
    if (parent.isCrossRepository || parent.state !== 'OPEN') throw new Error('Parent must be an open same-repository PR');
    base = parent.headRefName;
  }
  git(['fetch', 'origin']);
  const name = values.slug ?? ('goal-' + goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36).replace(/-+$/, '') + '-' + randomUUID().slice(0, 8));
  const worktree = await createWorktree(name, 'origin/' + base);
  const task = join(worktree, '.agents/state/goal.md');
  await mkdir(join(worktree, '.agents/state'), { recursive: true });
  await writeFile(task, goal + '\n', { mode: 0o600 });
  console.log('Task worktree: ' + worktree + '\nPR base: ' + base);
  const args = [process.execPath, join(repoRoot, 'scripts/agent/run.mjs'), 'start', '--interview', '--task-file', task];
  for (const key of ['profile', 'task-profile', 'sessions', 'model', 'seconds', 'iterations', 'image', 'auth-file', 'worker-model', 'lead-model', 'oracle-model', 'reasoning-effort', 'workflow', 'otel-endpoint']) if (values[key]) args.push('--' + key, values[key]);
  const env = { ...process.env, WORLD_AGENT_BASE: base, WORLD_AGENT_PARENT: values.parent ?? '' };
  if (values.background) {
    console.log(JSON.stringify(await launchJob(args, { cwd: worktree, env }), null, 2));
  } else {
  const result = await command(args, { cwd: worktree, timeoutMs: (Number(values.seconds ?? 3600) + 1300) * 1000,
    env });
  process.exitCode = result.code ?? 1;
  }
} catch (error) { errorExit(error); }
