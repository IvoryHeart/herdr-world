import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, fingerprint, jsonFile, command, repoRoot, verify } from './lib.mjs';
import { copyCandidate } from './environment.mjs';
import { recordTask, recordInteractive, readTask, deliveryEvidence, draftEvidence, executionMarkdown } from './task.mjs';
import { copyReferenceImages } from './references.mjs';
import { modelArguments } from './model.mjs';
import { acceptResponse } from './workflow.mjs';
import { saveState } from './run-state.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'world-task-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(['init', '-b', 'agent/fixture'], root);
  await writeFile(join(root, '.gitignore'), '.agents/\n');
  await writeFile(join(root, 'source.mjs'), 'export const answer = 42;\n');
  git(['add', '.'], root); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'], root);
  return root;
}
async function accepted(t) {
  const root = await fixture(t), id = randomUUID(), runDir = join(root, '.agents/runs', id);
  await copyCandidate(root, join(runDir, 'workspace'));
  const current = await fingerprint(root);
  const state = { id, status: 'ready-for-review', sourceRevision: git(['rev-parse', 'HEAD'], root), task: 'Keep answer 42',
    workflow: 'two-history', delivery: { worktree: root, base: 'main', parent: null }, models: {},
    turns: [{ role: 'implementer', sessionId: 'lead', code: 0 },
      { role: 'reviewer', sessionId: 'review', code: 0, event: 'review.passed' },
      { role: 'qa', sessionId: 'review', code: 0, event: 'qa.passed' }] };
  acceptResponse(state, 'planner', { event: 'plan.ready', summary: 'Preserve answer', acceptance: [{ id: 'answer', criterion: 'Answer is 42' }], specialists: [] }, current, current);
  acceptResponse(state, 'qa-planner', { event: 'qa.planned', summary: 'Check answer', scenarios: [{ id: 'value', acceptanceIds: ['answer'], steps: 'Read answer', expected: '42' }] }, current, current);
  acceptResponse(state, 'reviewer', { event: 'review.passed', summary: 'Correct' }, current, current);
  acceptResponse(state, 'qa', { event: 'qa.passed', summary: 'Observed', results: [{ scenarioId: 'value', status: 'passed', evidence: 'answer === 42' }] }, current, current);
  state.verification = { status: 'passed', fingerprint: current, requirementsHash: state.requirements.hash };
  await saveState(runDir, state);
  await recordTask(root, { mode: 'ralph', runId: id, base: 'main' });
  return { root, runDir, state };
}
test('a passing code receipt without a recorded workflow cannot publish', async t => {
  const root = await fixture(t);
  await verify({ cwd: root, commands: [[process.execPath, '-e', '']], stream: false });
  await writeFile(join(root, '.agents/state/body.md'), 'Fixture');
  const result = await command([process.execPath, join(repoRoot, 'scripts/agent/deliver.mjs'), '--title', 'Fixture', '--body-file', '.agents/state/body.md'], { cwd: root, stream: false });
  assert.notEqual(result.code, 0); assert.match(result.output, /No task execution record/);
});
test('delivery requires exact source, current QA, correct parent and an independent review history', async t => {
  const { root, runDir, state } = await accepted(t);
  const evidence = await deliveryEvidence(root, 'main');
  assert.equal(evidence.mode, 'ralph'); assert.equal(evidence.review, 'passed');
  assert.equal(evidence.usageCoverage, 'unavailable'); assert.equal(evidence.roles[0].input, null);
  assert(!executionMarkdown(evidence).includes('/tmp/'));
  await assert.rejects(deliveryEvidence(root, 'wrong-parent'), /parent branch/);
  state.turns[1].sessionId = 'lead'; await saveState(runDir, state);
  await assert.rejects(deliveryEvidence(root), /Independent native/);
  state.turns[1].sessionId = 'review'; state.qa.planHash = 'stale'; await saveState(runDir, state);
  await assert.rejects(deliveryEvidence(root), /missing, failed, or stale/);
  state.qa.planHash = state.qaPlan.hash; await saveState(runDir, state);
  await writeFile(join(root, 'source.mjs'), 'export const answer = 0;\n');
  await assert.rejects(deliveryEvidence(root), /differs from the reviewed/);
});
test('blocked runs and copied task markers cannot authorize another candidate', async t => {
  const { root, runDir, state } = await accepted(t);
  state.status = 'exhausted'; await saveState(runDir, state);
  await assert.rejects(deliveryEvidence(root), /missing, failed, or stale/);
  const marker = await readTask(root); marker.branch = 'agent/elsewhere'; await jsonFile(join(root, '.agents/state/task.json'), marker);
  await assert.rejects(deliveryEvidence(root), /different worktree or branch/);
});
test('interactive exceptions are explicit and cannot replace a recorded Ralph task', async t => {
  const root = await fixture(t);
  await assert.rejects(recordInteractive(root, 'convenience', 'Small change'), /Interactive work needs/);
  git(['branch', 'agent/parent'], root);
  await recordInteractive(root, 'harness-maintenance', 'Owner requested harness changes', 'agent/parent');
  assert.equal((await readTask(root)).base, 'agent/parent');
  assert.match(executionMarkdown(await deliveryEvidence(root)), /not an autonomous harness trial/);
  await recordTask(root, { mode: 'ralph', runId: randomUUID() });
  await assert.rejects(recordInteractive(root, 'owner-request', 'Switch mode'), /Cannot silently replace/);
});

test('interactive tasks require a real parent and retain its revision when that branch advances', async t => {
  const root = await fixture(t);
  await assert.rejects(recordInteractive(root, 'owner-request', 'Native task'), /--base/);
  assert.equal(await readTask(root), null);
  await assert.rejects(recordInteractive(root, 'owner-request', 'Native task', 'missing-parent'));
  assert.equal(await readTask(root), null);
  git(['branch', 'agent/parent'], root);
  const parent = git(['rev-parse', 'HEAD'], root);
  const first = await recordInteractive(root, 'owner-request', 'Native task', 'agent/parent');
  assert.equal(first.baseRevision, parent);
  await writeFile(join(root, 'source.mjs'), 'export const answer = 43;\n');
  git(['add', 'source.mjs'], root);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Change'], root);
  git(['branch', '-f', 'agent/parent', 'HEAD'], root);
  const resumed = await recordInteractive(root, 'owner-request', 'Continue task');
  assert.equal(resumed.base, 'agent/parent');
  assert.equal(resumed.baseRevision, parent);
  await assert.rejects(recordInteractive(root, 'owner-request', 'Continue with another parent', 'HEAD'), /different parent/);
  assert.equal((await readTask(root)).baseRevision, parent);
  git(['checkout', '-b', 'agent/different-task'], root);
  await assert.rejects(recordInteractive(root, 'owner-request', 'Different task'), /different worktree or branch/);
});
test('checked delivery appends provenance before publishing to a fixture remote', async t => {
  const { root } = await accepted(t);
  const origin = join(root, '.agents/origin.git'); git(['init', '--bare', origin], root); git(['remote', 'add', 'origin', origin], root);
  const bin = join(root, '.agents/bin'); await mkdir(bin);
  await writeFile(join(bin, 'gh'), '#!/usr/bin/env node\nconst fs=require("fs"); const a=process.argv; fs.writeFileSync(".agents/published-body.md",fs.readFileSync(a[a.indexOf("--body-file")+1])); console.log("https://example.invalid/pull/1");\n');
  await chmod(join(bin, 'gh'), 0o755);
  await verify({ cwd: root, commands: [[process.execPath, '-e', '']], stream: false });
  await writeFile(join(root, '.agents/body.md'), 'Fixture PR');
  const result = await command([process.execPath, join(repoRoot, 'scripts/agent/deliver.mjs'), '--title', 'Fixture', '--body-file', '.agents/body.md'],
    { cwd: root, stream: false, env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
  assert.equal(result.code, 0, result.output);
  assert.match(await readFile(join(root, '.agents/published-body.md'), 'utf8'), /Execution: \*\*Ralph\*\*/);
  assert.equal(JSON.parse(await readFile(join(root, '.agents/state/execution.json'))).qa, 'passed');
});
test('private image references survive continuation without entering source or exposing original filenames', async t => {
  const root = await fixture(t), control = join(root, '.agents/control'), before = await fingerprint(root);
  const file = join(root, '.agents/owner-reference.png'); await mkdir(join(root, '.agents'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV2kAAAAASUVORK5CYII=', 'base64');
  await writeFile(file, png);
  const first = await copyReferenceImages([file], control);
  const next = await copyReferenceImages([file], control, first);
  assert.deepEqual(await readFile(join(control, first[0].file)), png);
  assert.equal(next[1].file, 'references/image-2.png'); assert.equal(await fingerprint(root), before);
  const args = modelArguments('intake', { model: 'fixture', reasoningEffort: 'high' }, { resumed: true, meta: { threadId: 'fixture' } }, null, ['/control/' + first[0].file]);
  assert.deepEqual(args.slice(args.indexOf('--image'), args.indexOf('--image') + 2), ['--image', '/control/references/image-1.png']);
  assert(!JSON.stringify(first).includes('owner-reference'));
  await assert.rejects(copyReferenceImages(Array(5).fill(file), control), /at most four/);
  await writeFile(join(root, '.agents/text'), 'not an image');
  await assert.rejects(copyReferenceImages([join(root, '.agents/text')], control), /PNG, JPEG or WebP/);
  await symlink(file, join(root, '.agents/link'));
  await assert.rejects(copyReferenceImages([join(root, '.agents/link')], control));
});

test('draft visibility cannot claim accepted delivery or publish a moving worktree', async t => {
  const { root, runDir, state } = await accepted(t);
  state.status = 'interrupted'; state.verification = null; await saveState(runDir, state);
  const draft = await draftEvidence(root, 'main');
  assert(draft.draft); assert.match(executionMarkdown(draft), /incomplete draft/);
  await assert.rejects(deliveryEvidence(root), /missing, failed, or stale/);
  state.status = 'running'; await saveState(runDir, state);
  await assert.rejects(draftEvidence(root), /Pause at a coherent checkpoint/);
});
