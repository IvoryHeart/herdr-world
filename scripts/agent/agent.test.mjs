import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, fingerprint, verify, assertReceipt, command, repoRoot } from './lib.mjs';
import { createWorktree } from './worktree.mjs';
import { copyCandidate, dockerArgs } from './environment.mjs';
import { saveState, candidateGate, checkBudget, parseResponse } from './run-state.mjs';
import { materializeConfig } from './run.mjs';
import { proposeRuleset } from './github-rules.mjs';
import { parse, stringify } from '../../harness/node_modules/yaml/dist/index.js';

const temporaryDirectories = [];
async function temporary(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}
after(async () => { for (const dir of temporaryDirectories) await rm(dir, { recursive: true, force: true }); });

async function fixture() {
  const dir = await temporary('world-agent-test-');
  git(['init', '-b', 'main'], dir);
  await writeFile(join(dir, '.gitignore'), '.agents/\nignored.txt\n');
  await writeFile(join(dir, 'source.txt'), 'baseline\n');
  git(['add', '.'], dir);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Baseline'], dir);
  return dir;
}
test('worktrees resolve one shared primary directory from linked checkouts and preserve dirty work', async () => {
  const dir = await fixture();
  await writeFile(join(dir, 'source.txt'), 'private uncommitted work\n');
  const first = await createWorktree('first', 'HEAD', dir);
  const second = await createWorktree('second', 'HEAD', first);
  assert.equal(second, join(dir, '.agents/worktrees/second'));
  assert.equal(await readFile(join(dir, 'source.txt'), 'utf8'), 'private uncommitted work\n');
  assert.equal(git(['branch', '--show-current'], second), 'agent/second');
  await assert.rejects(createWorktree('../escape', 'HEAD', dir), /slug/);
  await assert.rejects(createWorktree('first', 'HEAD', dir));
});
test('fingerprint covers untracked source, deletions, symlink targets and content; ignores runtime state', async () => {
  const dir = await fixture();
  const baseline = await fingerprint(dir);
  await writeFile(join(dir, 'ignored.txt'), 'runtime');
  assert.equal(await fingerprint(dir), baseline);
  await writeFile(join(dir, 'new.txt'), 'new');
  assert.notEqual(await fingerprint(dir), baseline);
  const beforeLink = await fingerprint(dir);
  await symlink('source.txt', join(dir, 'link'));
  assert.notEqual(await fingerprint(dir), beforeLink);
});
test('verification receipts reject stale, failed and insufficient evidence but survive a content-identical commit', async () => {
  const dir = await fixture();
  const receipt = await verify({ cwd: dir, commands: [[process.execPath, '-e', 'process.exit(0)']], stream: false });
  await assertReceipt(dir, receipt);
  await writeFile(join(dir, 'source.txt'), 'changed\n');
  await assert.rejects(assertReceipt(dir, receipt), /stale/);
  const refreshed = await verify({ cwd: dir, commands: [[process.execPath, '-e', 'process.exit(0)']], stream: false });
  git(['add', '.'], dir);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Changed'], dir);
  await assertReceipt(dir, refreshed);
  const failed = await verify({ cwd: dir, commands: [[process.execPath, '-e', 'process.exit(7)']], stream: false });
  assert.equal(failed.status, 'failed');
  await assert.rejects(assertReceipt(dir, failed), /failed/);
  await assert.rejects(assertReceipt(dir, { ...refreshed, profile: 'harness' }), /insufficient/);
});
test('a check that changes source invalidates its own receipt', async () => {
  const dir = await fixture();
  const result = await verify({ cwd: dir, commands: [[process.execPath, '-e', "require('fs').writeFileSync('source.txt','mutated')"]], stream: false });
  assert.equal(result.status, 'failed');
});
test('command timeout kills execution and records a failure', async () => {
  const result = await command([process.execPath, '-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100, stream: false });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});
test('candidate completion requires acceptance, QA, review and verification for the current content', async () => {
  const runDir = await temporary('world-agent-gate-');
  const source = await fixture();
  await copyCandidate(source, join(runDir, 'workspace'));
  const hash = await fingerprint(join(runDir, 'workspace'));
  const state = { status: 'ready-for-review', requirements: { hash: 'requirements' },
    qaPlan: { hash: 'qa-plan', requirementsHash: 'requirements' },
    review: { event: 'review.passed', fingerprint: hash, requirementsHash: 'requirements' },
    qa: { event: 'qa.passed', fingerprint: hash, requirementsHash: 'requirements', planHash: 'qa-plan' },
    verification: { status: 'passed', fingerprint: hash, requirementsHash: 'requirements' } };
  await saveState(runDir, { ...state, verification: null });
  await assert.rejects(candidateGate(runDir), /missing/);
  await saveState(runDir, state);
  await candidateGate(runDir);
  await writeFile(join(runDir, 'workspace/source.txt'), 'post-review mutation');
  await assert.rejects(candidateGate(runDir), /stale/);
});
test('response routing cannot claim another role event or empty success', () => {
  assert.throws(() => parseResponse('{"event":"review.passed","summary":"done"}', 'implementer'), /Invalid/);
  assert.throws(() => parseResponse('{"event":"plan.ready","summary":""}', 'planner'), /Invalid/);
  assert.equal(parseResponse('{"event":"task.blocked","summary":"Needs owner decision","acceptance":[],"specialists":[]}', 'planner').event, 'task.blocked');
});
test('iteration, elapsed-time and repeated-failure budgets remain binding on resume', () => {
  const state = { limits: { iterations: 4, failures: 3 }, activations: 2, consecutiveFailures: 0, deadline: 200 };
  checkBudget(state, 100);
  for (const over of [{ activations: 4 }, { consecutiveFailures: 3 }, { deadline: 99 }]) {
    assert.throws(() => checkBudget({ ...state, ...over }, 100), /exhausted/);
  }
});
test('workspace copy refuses external symlinks and does not copy git credentials/remotes', async () => {
  const source = await fixture();
  const parent = await temporary('world-agent-copy-');
  await copyCandidate(source, join(parent, 'clean'));
  assert.equal(git(['remote'], join(parent, 'clean')), '');
  await symlink('/outside/private', join(source, 'bad'));
  await assert.rejects(copyCandidate(source, join(parent, 'bad')), /escapes/);
});
test('container argv separates read-only review, authless checks and publishing authority', () => {
  const common = { control: '/control', name: 'world-agent-fixture', readOnly: true };
  const verifier = dockerArgs({ id: 'fixture', image: 'fixture-image' }, '/candidate', common);
  assert(verifier.includes('none'));
  assert(verifier.includes('type=bind,src=/candidate,dst=/workspace,readonly'));
  assert(!verifier.some(arg => arg.includes('docker.sock') || arg.includes('auth.json') || arg.includes('GH_TOKEN')));
  const worker = dockerArgs({ id: 'fixture', image: 'fixture-image' }, '/candidate', { ...common, authFile: '/private/model-auth', network: 'bridge' });
  assert(worker.some(arg => arg.endsWith('auth.json,readonly')));
  assert(worker.includes('type=bind,src=/candidate/.ralph,dst=/workspace/.ralph,readonly'));
});
test('production Ralph config routes a complete loop using deterministic stand-ins', { timeout: 30000 }, async () => {
  const workspace = await fixture();
  const control = await temporary('world-ralph-control-');
  await mkdir(join(control, 'scripts/agent'), { recursive: true });
  const config = parse(await readFile(join(repoRoot, 'harness/ralph.yml'), 'utf8'));
  materializeConfig(config, control);
  // This stand-in uses the real pinned engine and production topology; it is not a model eval.
  const ralph = join(repoRoot, 'harness/bin/ralph');
  await writeFile(join(control, 'scripts/agent/backend.mjs'), `import {execFileSync} from 'node:child_process';
const events={coordinator:'plan.start',product:'requirements.ready',planner:'plan.ready','qa-planner':'qa.planned',implementer:'candidate.ready',reviewer:'review.passed',qa:'qa.passed',verifier:'candidate.verified'};
const role=process.argv[2];
const fs=await import('node:fs');
const completed=fs.existsSync('verified');
if(role==='verifier')fs.writeFileSync('verified','yes');
execFileSync(${JSON.stringify(ralph)},['emit',completed&&role==='coordinator'?'LOOP_COMPLETE':events[role],'fixture']);
console.log('fixture '+role);
`);
  await writeFile(join(control, 'scripts/agent/gate.mjs'), "import { existsSync } from 'node:fs'; if (!existsSync('verified')) process.exit(1);\n");
  const configPath = join(control, 'ralph.yml');
  await writeFile(configPath, stringify(config));
  const result = await command([ralph, 'run', '-c', configPath, '-p', 'Fixture task', '--autonomous', '--no-auto-merge'],
    { cwd: workspace, stream: false, timeoutMs: 20000 });
  assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(join(workspace, 'verified'), 'utf8'), 'yes');
});

test('structured backend stdout remains parseable when diagnostics arrive on stderr', async () => {
  const result = await command([process.execPath, '-e', 'process.stdout.write("{\\\"ok\\\":"); process.stderr.write("diagnostic\\n"); setTimeout(() => process.stdout.write("true}\\n"), 10)'], { stream: false });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true });
  assert.match(result.stderr, /diagnostic/);
});
test('GitHub policy updates preserve existing checks, bypass actors and stronger approval counts', () => {
  const current = { id: 1, name: 'branch-locking', target: 'branch', enforcement: 'active',
    bypass_actors: [{ actor_id: 7, actor_type: 'Integration', bypass_mode: 'always' }],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' },
      { type: 'pull_request', parameters: { required_approving_review_count: 2, required_review_thread_resolution: true } },
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Existing check', integration_id: 42 }] } }] };
  const original = structuredClone(current);
  const updated = proposeRuleset(current, { approvingReviews: 1, dismissStaleReviews: true,
    requireLastPushApproval: true, strictChecks: true, requiredCheck: 'Delivery checks' });
  assert.deepEqual(current, original);
  assert.deepEqual(updated.bypass_actors, current.bypass_actors);
  assert.deepEqual(updated.conditions, current.conditions);
  assert.equal(updated.rules[2].parameters.required_approving_review_count, 2);
  assert.equal(updated.rules[2].parameters.required_review_thread_resolution, true);
  assert.deepEqual(updated.rules[3].parameters.required_status_checks,
    [{ context: 'Existing check', integration_id: 42 }, { context: 'Delivery checks' }]);
  assert.deepEqual(proposeRuleset(updated, { approvingReviews: 1, dismissStaleReviews: true,
    requireLastPushApproval: true, strictChecks: true, requiredCheck: 'Delivery checks' }), updated);
});

test('timeout also stops descendants that created a separate process group', async () => {
  const dir = await temporary('world-agent-descendants-');
  const detached = "setTimeout(() => require('fs').writeFileSync('escaped', 'bad'), 1000)";
  const parent = "require('child_process').spawn(process.execPath, ['-e', " + JSON.stringify(detached) + "], { detached: true, stdio: 'ignore' }); setInterval(() => {}, 1000)";
  // Linux cancellation must work even when spawning ps would fail or stall.
  const env = process.platform === 'linux' ? { ...process.env, PATH: '/unavailable-process-tools' } : process.env;
  const result = await command([process.execPath, '-e', parent], { cwd: dir, env, stream: false, timeoutMs: 500 });
  assert.equal(result.timedOut, true);
  await new Promise(resolve => setTimeout(resolve, 800));
  await assert.rejects(access(join(dir, 'escaped')), { code: 'ENOENT' });
});
