// Harbor owns the outer container and held-out verifier; reuse the production loop.
import { readFile, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from '../../harness/node_modules/yaml/dist/index.js';
import { command, fingerprint, git } from './lib.mjs';
import { saveState, loadState, candidateGate } from './run-state.mjs';
import { materializeConfig } from './run.mjs';
import { prepareDependencies } from './environment.mjs';
import { resolveModels, initialEvent } from './workflow.mjs';

const runDir = '/tmp/world-harbor-run';
await mkdir(runDir, { recursive: true });
await symlink('/workspace', join(runDir, 'workspace'));
await symlink('/control', join(runDir, 'control'));
const state = {
  schemaVersion: 2, id: 'harbor', environment: 'harbor', status: 'preparing',
  sourceRevision: git(['rev-parse', 'HEAD']), sourceFingerprint: await fingerprint(),
  workspaceBaseline: git(['rev-parse', 'HEAD']), model: process.argv[2], profile: 'check', taskProfile: process.argv[3] ?? process.env.WORLD_TASK_PROFILE ?? 'routine',
  models: resolveModels(JSON.parse(await readFile('/control/harness/models.json')), { model: process.argv[2] }),
  task: await readFile('/tmp/world-task.md', 'utf8'), limits: { iterations: 24, failures: 3, seconds: 2300 },
  deadline: Date.now() + 2300000, activations: 0, consecutiveFailures: 0, turns: [], costUsd: null,
};
state.lastEvent = initialEvent(state.taskProfile);
await saveState(runDir, state);
const prepared = await prepareDependencies(state, '/workspace', '/control');
if (prepared.code !== 0) throw new Error('Harbor dependency preparation failed');
const config = materializeConfig(parse(await readFile('/control/harness/ralph.yml','utf8')), '/control');
config.event_loop.starting_event = state.lastEvent;
config.event_loop.max_runtime_seconds = Math.max(1, Math.floor((state.deadline - Date.now())/1000));
await writeFile(join(runDir,'ralph.yml'), stringify(config));
await mkdir('/workspace/.ralph/agent', { recursive: true });
await writeFile('/workspace/.ralph/agent/scratchpad.md', '# Task progress\n\n' + state.task + '\n');
const result = await command(['/opt/harness/bin/ralph', 'run', '-c', join(runDir,'ralph.yml'),
  '-P', '/tmp/world-task.md', '--autonomous', '--no-auto-merge'],
  { env: { ...process.env, WORLD_AGENT_RUN: runDir }, timeoutMs: Math.max(1, state.deadline-Date.now()), log:'/logs/agent/ralph.log' });
const final = await loadState(runDir);
if (final.status !== 'blocked') {
  try { await candidateGate(runDir); } catch { final.status = result.timedOut ? 'exhausted' : 'failed'; }
}
await writeFile('/logs/agent/world-run.json', JSON.stringify(final, null, 2));
// Harbor's separate verifier determines task reward, including legitimate blocked outcomes.
