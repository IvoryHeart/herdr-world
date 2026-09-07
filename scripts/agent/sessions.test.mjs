import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, command } from './lib.mjs';
import { contextDelta, openSession, saveSession, observeSessionLine, snapshotTree, writeDelta, sessionGroups, validateSessionGroups } from './sessions.mjs';
import { modelArguments } from './model.mjs';
import { dockerArgs } from './environment.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'world-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  git(['init', '-b', 'candidate'], workspace);
  await writeFile(join(workspace, 'source.txt'), 'baseline\n');
  await writeFile(join(workspace, '.gitignore'), '.agents/\n');
  git(['add', '.'], workspace);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'], workspace);
  return { root, workspace, state: { id: 'fixture', sessionMode: 'persistent', sessionGroups } };
}
test('role histories reuse related read-only work while isolating builder and Oracle', async t => {
  const { root, state } = await fixture(t);
  const qa = await openSession(root, state, 'qa-planner');
  observeSessionLine(qa, JSON.stringify({ type: 'thread.started', thread_id: '11111111-1111-1111-1111-111111111111' }));
  const reviewer = await openSession(root, state, 'reviewer');
  assert.equal(reviewer.resumed, true);
  assert.equal(reviewer.home, qa.home);
  assert.equal((await openSession(root, state, 'qa')).home, qa.home);
  assert.notEqual((await openSession(root, state, 'implementer')).home, qa.home);
  assert.notEqual((await openSession(root, state, 'oracle')).home, qa.home);
  assert.throws(() => validateSessionGroups({ ...sessionGroups, implementer: 'review' }), /boundaries/);
  await assert.rejects(openSession(root, { ...state, id: 'another-run' }, 'reviewer'), /another run/);
});
test('candidate snapshots include new files and deletions without changing the task index', async t => {
  const { root, workspace, state } = await fixture(t);
  const session = await openSession(root, state, 'reviewer');
  const baseline = git(['rev-parse', 'HEAD'], workspace);
  const initialStatus = git(['status', '--porcelain'], workspace);
  session.meta.lastTree = await snapshotTree(root, workspace);
  assert.equal(git(['status', '--porcelain'], workspace), initialStatus);
  await rm(join(workspace, 'source.txt'));
  await writeFile(join(workspace, 'other.txt'), 'new defect\n');
  const dirtyStatus = git(['status', '--porcelain'], workspace);
  const changed = await snapshotTree(root, workspace);
  const delta = await writeDelta(root, workspace, session, changed, 2);
  assert.match(delta.changedPaths, /other.txt/);
  assert.match(delta.changedPaths, /source.txt/);
  assert.match(await readFile(join(root, 'handovers/delta-2.patch'), 'utf8'), /new defect/);
  assert.equal(git(['status', '--porcelain'], workspace), dirtyStatus);
  git(['add', '-A'], workspace);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Ralph landing'], workspace);
  const fresh = await openSession(root, { ...state, sessionMode: 'fresh' }, 'reviewer');
  const afterLanding = await writeDelta(root, workspace, fresh, changed, 3, baseline);
  assert.match(afterLanding.changedPaths, /other.txt/);
  assert.match(afterLanding.changedPaths, /source.txt/);
});
test('context updates retain explicit resets without repeating unchanged decisions', () => {
  const previous = { task: 'Fix cap', plan: { files: ['helper.ts'] }, feedback: 'old finding' };
  assert.deepEqual(contextDelta(previous, { ...previous, feedback: null }), { feedback: null });
  assert.deepEqual(contextDelta(null, previous), previous);
});
test('thread identity is durable before an interrupted model process exits', async t => {
  const { root, state } = await fixture(t);
  const session = await openSession(root, state, 'reviewer'); saveSession(session);
  const id = '22222222-2222-2222-2222-222222222222';
  const result = await command([process.execPath, '-e',
    'process.stdout.write(JSON.stringify({type:"thread.started",thread_id:' + JSON.stringify(id) + '})+"\\n");setInterval(()=>{},1000)'],
  { stream: false, timeoutMs: 500, onStdoutLine: line => observeSessionLine(session, line) });
  assert.equal(result.timedOut, true);
  const resumed = await openSession(root, state, 'reviewer');
  assert.equal(resumed.meta.threadId, id); assert.equal(resumed.resumed, true);
  observeSessionLine(resumed, JSON.stringify({ type: 'thread.started', thread_id: '33333333-3333-3333-3333-333333333333' }));
  assert.match(resumed.error, /different thread/);
});
test('persistent invocation mounts only its own home and resumes the exact ID with current role schema', async t => {
  const { root, state } = await fixture(t);
  const session = await openSession(root, state, 'qa-planner');
  observeSessionLine(session, JSON.stringify({ type: 'thread.started', thread_id: '44444444-4444-4444-4444-444444444444' }));
  const reviewer = await openSession(root, state, 'qa');
  const args = modelArguments('qa', { model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' }, reviewer);
  assert(args.includes('resume')); assert(args.includes(session.meta.threadId));
  assert(args.includes('/control/harness/schemas/qa.json')); assert(!args.includes('--ephemeral'));
  const mounts = dockerArgs({ image: 'fixture' }, '/candidate', {
    sessionHome: reviewer.home, handovers: '/run/handovers', control: '/control', authFile: '/auth', readOnly: true, name: 'fixture',
  });
  assert(mounts.includes('type=bind,src=' + reviewer.home + ',dst=/agent-home'));
  assert(mounts.includes('type=bind,src=/auth,dst=/agent-home/auth.json,readonly'));
  assert(mounts.includes('type=bind,src=/run/handovers,dst=/handover,readonly'));
  assert(mounts.includes('type=bind,src=/candidate,dst=/workspace,readonly'));
  assert(!mounts.some(arg => arg.includes('/sessions/builder')));
  const fresh = await openSession(root, { ...state, sessionMode: 'fresh' }, 'qa');
  const freshArgs = modelArguments('qa', { model: 'fixture', reasoningEffort: 'xhigh' }, fresh);
  assert(!freshArgs.includes('resume')); assert(freshArgs.includes('--ephemeral'));
});
