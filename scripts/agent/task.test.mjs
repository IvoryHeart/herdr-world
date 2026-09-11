import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, git, repoRoot } from './lib.mjs';
import { readTask, recordInteractive, recordNative, recordTask } from './task.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'world-native-task-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(['init', '-b', 'agent/fixture'], root);
  await writeFile(join(root, 'source.mjs'), 'export const answer = 42;\n');
  git(['add', '.'], root);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'], root);
  return root;
}

test('native records resolve and retain the actual parent commit', async t => {
  const root = await fixture(t);
  git(['branch', 'agent/parent'], root);
  const parent = git(['rev-parse', 'agent/parent^{commit}'], root);
  const task = await recordNative(root, {
    reason: 'owner-request', note: 'Owner authorized native work', parent: 'agent/parent',
  });
  assert.equal(task.mode, 'native');
  assert.equal(task.parent, 'agent/parent');
  assert.equal(task.parentRevision, parent);
  assert.equal(task.baseRevision, parent);
  assert.deepEqual(await readTask(root), task);
});

test('recording again keeps the parent revision stable while the parent ref moves', async t => {
  const root = await fixture(t);
  git(['branch', 'agent/parent'], root);
  const parent = git(['rev-parse', 'agent/parent^{commit}'], root);
  await recordNative(root, { reason: 'owner-request', note: 'Start native work', parent: 'agent/parent' });
  await writeFile(join(root, 'source.mjs'), 'export const answer = 43;\n');
  git(['add', 'source.mjs'], root);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Candidate'], root);
  git(['branch', '-f', 'agent/parent', 'HEAD'], root);
  const resumed = await recordNative(root, { reason: 'owner-request', note: 'Resume native work' });
  assert.equal(resumed.parent, 'agent/parent');
  assert.equal(resumed.parentRevision, parent);
});

test('interactive remains a native compatibility alias and task records do not gate source changes', async t => {
  const root = await fixture(t);
  git(['branch', 'agent/parent'], root);
  await recordInteractive(root, 'harness-maintenance', 'Retire unused harness', 'agent/parent');
  await writeFile(join(root, 'source.mjs'), 'export const answer = 0;\n');
  const task = await readTask(root);
  assert.equal(task.mode, 'native');
  assert.equal(task.reason, 'harness-maintenance');
  assert.equal((await readFile(join(root, 'source.mjs'), 'utf8')).trim(), 'export const answer = 0;');
});

test('native records reject missing or stale parent commits and main branches', async t => {
  const root = await fixture(t);
  await assert.rejects(recordTask(root, {}), /--parent/);
  git(['branch', 'agent/parent'], root);
  await assert.rejects(recordTask(root, { parent: 'agent/parent', parentRevision: 'HEAD' }), /does not match/);
  git(['branch', '-M', 'main'], root);
  await assert.rejects(recordNative(root, { reason: 'owner-request', note: 'No', parent: 'HEAD' }), /non-main/);
});

test('task CLI can report a durable native record without invoking a runner', async t => {
  const root = await fixture(t);
  git(['branch', 'agent/parent'], root);
  await recordNative(root, { reason: 'owner-request', note: 'CLI fixture', parent: 'agent/parent' });
  const result = await command([process.execPath, join(repoRoot, 'scripts/agent/task.mjs'), 'status'], {
    cwd: root, stream: false, env: { ...process.env, NODE_PATH: undefined },
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(JSON.parse(result.stdout).mode, 'native');
});

test('command cancellation stops a detached child process group', async t => {
  const root = await mkdtemp(join(tmpdir(), 'world-command-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'marker.txt');
  const helper = join(root, 'helper.mjs');
  const child = `import { appendFile } from 'node:fs/promises';
await appendFile(${JSON.stringify(marker)}, 'started\\n');
setTimeout(() => appendFile(${JSON.stringify(marker)}, 'alive\\n'), 250);
setInterval(() => {}, 1000);`;
  await writeFile(helper, `import { command } from ${JSON.stringify(join(repoRoot, 'scripts/agent/lib.mjs'))};
await command([process.execPath, '--input-type=module', '-e', ${JSON.stringify(child)}], { stream: false });
`);
  const runner = spawn(process.execPath, [helper], { cwd: root, stdio: 'ignore' });
  let started = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await access(marker); started = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  assert.equal(started, true, 'detached child did not start');
  runner.kill('SIGTERM');
  await once(runner, 'exit');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.doesNotMatch(await readFile(marker, 'utf8'), /alive/);
});
