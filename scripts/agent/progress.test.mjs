import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { releaseArchive } from '../../harness/install-ralph.mjs';
import { buildRecap, readJobRecap, startRecaps, recapIntervalMs } from './progress.mjs';
import { roleInstructions } from './model.mjs';
import { launchJob, waitJob } from './job.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'world-recap-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
const bytes = Buffer.from('synthetic pinned archive');
const sha256 = createHash('sha256').update(bytes).digest('hex');
test('pinned download retries transient errors, then reuses only checksum-verified cache', async t => {
  const cacheDirectory = await temporary(t); let calls = 0; const pauses = [];
  const options = { url: 'https://example.invalid/archive', sha256, cacheDirectory,
    fetcher: async () => { calls++; return calls < 3 ? new Response('', { status: 500 }) : new Response(bytes); },
    pause: async ms => pauses.push(ms) };
  assert.deepEqual(await releaseArchive(options), bytes);
  assert.deepEqual(pauses, [1000, 2000]); assert.equal(calls, 3);
  assert.deepEqual(await releaseArchive({ ...options, fetcher: () => assert.fail('cached archive must work offline') }), bytes);
  await writeFile(join(cacheDirectory, sha256 + '.tar.xz'), 'corrupt cache');
  assert.deepEqual(await releaseArchive(options), bytes); assert.equal(calls, 4);
});
test('download retries are bounded and permanent/checksum failures do not retry or install', async t => {
  const cacheDirectory = await temporary(t); let calls = 0;
  const options = { url: 'https://example.invalid/archive', sha256, cacheDirectory, pause: async () => {} };
  await assert.rejects(releaseArchive({ ...options, fetcher: async () => { calls++; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); } }), /fetch failed/);
  assert.equal(calls, 3); calls = 0;
  await assert.rejects(releaseArchive({ ...options, fetcher: async () => { calls++; return new Response('', { status: 404 }); } }), /404/);
  assert.equal(calls, 1); calls = 0;
  await assert.rejects(releaseArchive({ ...options, fetcher: async () => { calls++; return new Response('wrong bytes'); } }), /checksum/);
  assert.equal(calls, 1);
  await assert.rejects(readFile(join(cacheDirectory, sha256 + '.tar.xz')), { code: 'ENOENT' });
});
test('recaps distinguish long checks from model time, deduplicate usage and never decide a stall', () => {
  const state = { id: 'fixture', status: 'running', startedAt: '2026-01-01T00:00:00Z', remainingMs: 600000, pair: { handoffs: 3 },
    health: { inspectedAt: '2026-01-01T00:00:00Z', disks: [{ path: '/PRIVATE', level: 'warning', availableBytes: 10 }] } };
  const response = { type: 'response.usage', responseId: 'one', role: 'pair-a', model: 'fixture', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } };
  const rows = [{ type: 'attempt.started', role: 'pair-a', attemptId: 'a', timestamp: '2026-01-01T00:00:00Z' }, response, response,
    { type: 'attempt.finished', attemptId: 'a', timestamp: '2026-01-01T00:01:00Z' },
    { type: 'check.started', command: 'test:e2e', timestamp: '2026-01-01T00:01:00Z' }];
  const before = JSON.stringify(state);
  const recap = buildRecap(state, rows, { now: Date.parse('2026-01-01T00:21:00Z') });
  assert.equal(recap.active.kind, 'check'); assert.equal(recap.active.elapsedMs, 1200000);
  assert.equal(recap.modelRemainingMs, 600000); assert.equal(recap.usage.byRoleAndModel['pair-a/fixture'].input, 100);
  assert.equal(recap.status, 'running'); assert.equal(recap.blockedReason, null);
  assert(!JSON.stringify(recap).includes('/PRIVATE')); assert.equal(JSON.stringify(state), before);
  assert.equal(buildRecap(state, rows.slice(0, 3), { now: Date.parse('2026-01-01T00:01:00Z') }).modelRemainingMs, 540000);
  assert.equal(buildRecap({ ...state, status: 'interrupted' }, rows).active, null);
});
test('scheduled recaps use no model, flush on stop and report a lost observation without failing the job', async t => {
  const dir = await temporary(t), messages = []; let reads = 0, firstObserved, secondObserved;
  const first = new Promise(resolve => { firstObserved = resolve; });
  const second = new Promise(resolve => { secondObserved = resolve; });
  // Production has a child process to keep Node alive. Drive the unreferenced
  // recap timer explicitly here instead of depending on incidental test-runner I/O.
  t.mock.timers.enable({ apis: ['setInterval'] });
  assert.equal(recapIntervalMs, 300000);
  const stop = startRecaps(dir, { read: async () => { reads++; if (reads === 1) throw new Error('temporary read failure'); return { status: 'running', sequence: reads }; },
    emit: text => { messages.push(text); if (messages.length === 1) firstObserved(); if (messages.length === 2) secondObserved(); } });
  try {
    t.mock.timers.tick(recapIntervalMs - 1); assert.equal(reads, 0);
    t.mock.timers.tick(1); await first;
    await new Promise(resolve => setImmediate(resolve)); // Drain the first publication's cleanup.
    t.mock.timers.tick(recapIntervalMs); await second;
  } finally { await stop(); }
  assert.match(messages[0], /unavailable/);
  assert.equal(JSON.parse(await readFile(join(dir, 'recap.json'))).sequence, reads);
  assert.equal(reads, 3); // Failed observation, successful observation, final flush.
  t.mock.timers.tick(recapIntervalMs); assert.equal(reads, 3);
});
test('background completion persists a final recap and manual recap reads a linked run without mutation', async t => {
  const root = await temporary(t);
  const job = await launchJob([process.execPath, '-e', 'console.log("done")'], { cwd: root, root });
  await waitJob(job.directory, { timeoutMs: 5000 });
  // The job status transition precedes its final observation; wait for the supervisor to exit.
  for (let i = 0; i < 100; i++) {
    try { await readFile(join(job.directory, 'recap.json')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  assert.equal(JSON.parse(await readFile(join(job.directory, 'recap.json'))).jobStatus, 'completed');
  const id = '00000000-0000-4000-8000-000000000001', run = join(root, '.agents/runs', id);
  await mkdir(run, { recursive: true });
  const source = JSON.stringify({ id, status: 'blocked', reason: 'Fixture decision needed' });
  await writeFile(join(run, 'run.json'), source);
  await writeFile(join(job.directory, 'job.json'), JSON.stringify({ id: job.id, status: 'needs-attention', runId: id }));
  assert.equal((await readJobRecap(job.directory)).blockedReason, 'Fixture decision needed');
  assert.equal(await readFile(join(run, 'run.json'), 'utf8'), source);
});
test('both partner prompts receive the same maintained protocol without affecting other roles', async t => {
  const root = await temporary(t), dir = join(root, 'harness/roles'); await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries({ 'pair-a': 'A', 'pair-b': 'B', pair: 'Shared protocol', oracle: 'Advice' })) await writeFile(join(dir, name + '.md'), text);
  assert.equal(await roleInstructions(root, 'pair-a'), 'A\nShared protocol');
  assert.equal(await roleInstructions(root, 'pair-b'), 'B\nShared protocol');
  assert.equal(await roleInstructions(root, 'oracle'), 'Advice');
});
