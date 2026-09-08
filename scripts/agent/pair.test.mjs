import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptResponse, evidenceCurrent } from './workflow.mjs';
import { stageAllowance } from './budgets.mjs';
import { verifyPair, failureKind } from './pair-checks.mjs';
import { otlpLogs } from './telemetry.mjs';
import { readLedger } from './usage.mjs';
import { diskHealth, measureStorage } from './pair-health.mjs';
import { claimWorktree, carryRecovery } from './recovery.mjs';
import { git, fingerprint, jsonFile } from './lib.mjs';
import { candidateGate } from './run-state.mjs';
import { pairSessionGroups, validateSessionGroups } from './sessions.mjs';

const evidence = [{ acceptanceId: 'answer', evidence: 'Executed the answer assertion; observed 42.' }];
const reply = (event = 'pair.handoff', findings = []) => ({ event, summary: 'Concrete candidate evidence.', findings, evidence });
const fresh = () => ({ workflow: 'pair', task: 'Answer is 42', activations: 1, consecutiveFailures: 0,
  requirements: { hash: 'criteria', criteria: [{ id: 'answer', criterion: 'Answer is 42' }] } });
function turn(state, role, response, before = 'fixed', after = before) {
  state.activations++;
  return acceptResponse(state, role, response, before, after);
}
test('latest edits require the other partner; clean review goes straight to checks and lead', () => {
  const state = fresh();
  assert.equal(turn(state, 'pair-a', reply(), 'base', 'fixed').event, 'pair.b');
  assert.throws(() => turn(state, 'pair-a', reply('pair.accepted')), /other partner/);
  assert.equal(turn(state, 'pair-b', reply('pair.accepted')).event, 'pair.agreed');
  assert(evidenceCurrent(state, 'fixed'));
  assert.throws(() => turn(state, 'lead', { event: 'lead.accepted', summary: 'Done' }), /verified source/);
  state.verification = { status: 'passed', fingerprint: 'fixed' };
  assert.equal(turn(state, 'lead', { event: 'lead.accepted', summary: 'Scope and evidence checked.' }).event, 'candidate.verified');
  assert.equal(state.status, 'ready-for-review');
});
test('a reviewer can fix but must hand off; previous authorship does not forbid later review', () => {
  const state = fresh();
  turn(state, 'pair-a', reply(), 'base', 'first');
  turn(state, 'pair-b', reply(), 'first', 'fixed');
  assert.throws(() => turn(state, 'pair-b', reply('pair.accepted')), /other partner/);
  assert.equal(turn(state, 'pair-a', reply('pair.accepted')).event, 'pair.agreed');
  assert.equal(state.pair.approval.role, 'pair-a');
  assert.throws(() => turn(state, 'pair-b', reply('pair.accepted'), 'fixed', 'changed'), /unchanged proposal/);
  assert(!evidenceCurrent(state, 'changed'));
});
test('missing evidence cannot pass and unchanged model turns do not invalidate verification', () => {
  const state = fresh(); turn(state, 'pair-a', reply(), 'base', 'fixed');
  assert.throws(() => turn(state, 'pair-b', { ...reply('pair.accepted'), evidence: [] }), /every criterion/);
  turn(state, 'pair-b', reply('pair.accepted'));
  state.verification = { status: 'passed', fingerprint: 'fixed' };
  turn(state, 'pair-a', reply('oracle.requested'));
  assert.equal(state.verification.status, 'passed');
  assert.equal(turn(state, 'oracle', { event: 'oracle.advised', summary: 'Concrete answer.' }).event, 'pair.a');
});
test('repeated unresolved findings get one lead intervention then pause, despite source churn', () => {
  const state = fresh(), finding = [{ id: 'wrong-owner', detail: 'Action resolves a different host.' }];
  let previous = 'base';
  for (let i = 0; i < 3; i++) {
    const current = 'candidate-' + i;
    const next = turn(state, i % 2 ? 'pair-b' : 'pair-a', reply('pair.handoff', finding), previous, current);
    assert.equal(next.event, i === 2 ? 'lead.start' : i % 2 ? 'pair.a' : 'pair.b');
    previous = current;
  }
  assert.equal(turn(state, 'lead', { event: 'lead.resume', summary: 'Trace host ownership at the action boundary.' }, previous).event, 'pair.b');
  turn(state, 'pair-b', reply('pair.handoff', finding), previous, 'next');
  assert.equal(turn(state, 'pair-a', reply('pair.handoff', finding), 'next', 'again').event, 'task.blocked');
});
test('pair budgets remove stage shares and do not ration long commands to nine minutes', () => {
  const state = { workflow: 'pair', remainingMs: 30000, commandTimeoutMs: 2700000, deadline: 0 };
  assert.equal(stageAllowance(state, 'pair-a').timeoutMs, 30000);
  assert.equal(stageAllowance(state, 'verifier').timeoutMs, 2700000);
  assert.equal(failureKind({ code: 0, timedOut: true }), 'timeout');
  assert.equal(failureKind({ code: 1, output: 'ENOSPC' }), 'infrastructure');
  assert.equal(failureKind({ code: 1, output: 'expected 42, got 0' }), 'assertion');
  assert.equal(diskHealth({ bavail: 3, bsize: 1024 ** 3, files: 10000, ffree: 2000 }).level, 'warning');
  assert.equal(diskHealth({ bavail: 1, bsize: 1024 ** 3, files: 10000, ffree: 2000 }).level, 'critical');
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'world-pair-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(['init', '-b', 'main'], root);
  await writeFile(join(root, '.gitignore'), '.agents/\n.ralph/\n');
  await writeFile(join(root, 'answer.mjs'), 'export const answer = 42;\n');
  git(['add', '.'], root); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'], root);
  const workspace = join(root, '.agents/.worktrees/task');
  git(['worktree', 'add', '-b', 'agent/pair', workspace], root);
  const runDir = join(root, '.agents/runs/fixture'); await mkdir(runDir, { recursive: true });
  await symlink(workspace, join(runDir, 'workspace'));
  const current = await fingerprint(workspace), state = { ...fresh(), id: 'fixture', status: 'running', image: 'fixture',
    profile: 'acceptance', remainingMs: 30000, commandTimeoutMs: 2700000, workspaceBaseline: git(['rev-parse', 'HEAD'], workspace) };
  turn(state, 'pair-a', reply(), current, current); turn(state, 'pair-b', reply('pair.accepted'), current, current);
  return { root, workspace, runDir, state, current };
}
test('verification resumes only the timed-out command, reuses passed checks and spends no model budget', async t => {
  const { runDir, state, current } = await fixture(t), calls = [];
  let timeout = true;
  const execute = async (_state, _workspace, argv, options) => {
    calls.push(argv.at(-1)); assert.equal(options.timeoutMs, 2700000);
    return { code: 0, timedOut: timeout && argv.at(-1) === 'test:e2e', elapsedMs: 1100000, output: '' };
  };
  const prepare = async () => ({ code: 0 });
  assert.equal((await verifyPair(runDir, state, { execute, prepare })).event, 'task.blocked');
  assert.equal(state.remainingMs, 30000);
  assert.deepEqual(calls, ['check', 'test:e2e']);
  timeout = false;
  assert.equal((await verifyPair(runDir, state, { execute, prepare })).event, 'lead.start');
  assert.deepEqual(calls, ['check', 'test:e2e', 'test:e2e', 'test:security', 'test:independence']);
  assert.equal(state.verification.status, 'passed');
  await verifyPair(runDir, state, { execute, prepare }); assert.equal(calls.length, 5);
  turn(state, 'lead', { event: 'lead.accepted', summary: 'Inspected.' }, current);
  await jsonFile(join(runDir, 'run.json'), state); await candidateGate(runDir);
  await measureStorage(runDir, join(runDir, 'workspace'), 'stop');
  const storage = (await readLedger(runDir)).find(row => row.type === 'storage.measured');
  const attributes = otlpLogs([storage]).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
  assert.equal(attributes.find(attribute => attribute.key === 'runId').value.stringValue, state.id);
  assert(attributes.some(attribute => attribute.key === 'workspaceBytes'));
  state.pair.leadApproval = null; await jsonFile(join(runDir, 'run.json'), state);
  await assert.rejects(candidateGate(runDir), /Lead acceptance/);
});
test('infrastructure retry is deterministic; assertion failure returns to the pair', async t => {
  const { runDir, state } = await fixture(t); state.profile = 'check'; let count = 0;
  const prepare = async () => ({ code: 0 });
  let next = await verifyPair(runDir, state, { prepare, execute: async () => ({ code: ++count === 1 ? 1 : 0, output: 'ECONNRESET', elapsedMs: 10 }) });
  assert.equal(next.event, 'lead.start'); assert.equal(count, 2);
  state.checks = {};
  next = await verifyPair(runDir, state, { prepare, execute: async () => ({ code: 1, output: 'assertion failed', elapsedMs: 10 }) });
  assert.equal(next.event, 'pair.a'); assert.equal(state.pair.approval, null);
});
test('one supervisor owns the worktree; releasing it retains every source file', async t => {
  const { workspace } = await fixture(t);
  const release = await claimWorktree(workspace, 'one');
  await assert.rejects(claimWorktree(workspace, 'two'), /already has a supervisor/);
  await release(); const next = await claimWorktree(workspace, 'two'); await next();
  assert.match(await readFile(join(workspace, 'answer.mjs'), 'utf8'), /42/);
  assert.deepEqual(validateSessionGroups(pairSessionGroups), pairSessionGroups);
  assert.throws(() => validateSessionGroups({ ...pairSessionGroups, 'pair-b': 'pair-a' }), /independent/);
});
test('legacy recovery imports a pending patch and retains histories without modifying old evidence', async t => {
  const { root, workspace, runDir, state } = await fixture(t);
  const oldDir = join(root, '.agents/runs/old'); await mkdir(join(oldDir, 'sessions/lead', 'home', 'sessions'), { recursive: true });
  const patch = 'diff --git a/answer.mjs b/answer.mjs\n--- a/answer.mjs\n+++ b/answer.mjs\n@@ -1 +1 @@\n-export const answer = 42;\n+export const answer = 43;\n';
  await writeFile(join(oldDir, 'candidate.patch'), patch);
  await writeFile(join(oldDir, 'sessions/lead', 'home', 'sessions', 'transcript'), 'Retained native history');
  await jsonFile(join(oldDir, 'sessions/lead/session.json'), { threadId: '12345678-1234-1234-1234-123456789abc', runId: 'old', group: 'lead', lastTree: 'unavailable-tree' });
  const old = { directory: oldDir, state: { id: 'old', workflow: 'two-history', remainingMs: 25000, requirements: state.requirements } };
  await carryRecovery(old, runDir, state);
  assert.match(await readFile(join(workspace, 'answer.mjs'), 'utf8'), /43/);
  assert.equal(await readFile(join(oldDir, 'candidate.patch'), 'utf8'), patch);
  const meta = JSON.parse(await readFile(join(runDir, 'sessions/pair-a/session.json')));
  assert.equal(meta.threadId, '12345678-1234-1234-1234-123456789abc'); assert.equal(meta.lastTree, null);
  assert.equal(state.lastEvent, 'pair.a'); assert.equal(state.recovery.previousRemainingMs, 25000);
  assert.equal(state.pair.approval, undefined);
});
