import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { budgetPolicy, stageAllowance } from './budgets.mjs';
import { recordEvent, readLedger, recoverUsage, nativeReader, usageConsumer, summarizeUsage, normalizeUsage } from './usage.mjs';
import { telemetryConfig, telemetryArguments, flushTelemetry, otlpLogs } from './telemetry.mjs';
import { command, git } from './lib.mjs';
import { writableFixture } from './fixture.mjs';
import { launchJob, waitJob } from './job.mjs';
import { openSession, sessionGroups, fullSessionGroups } from './sessions.mjs';
import { reconcileResponses } from './metrics.mjs';

async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'world-efficiency-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
const tokens = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10, reasoning_output_tokens: 4 };
function response(id, timestamp, extra = {}) {
  return { type: 'token_usage_record', timestamp, payload: { response_id: id, thread_id: 'thread', turn_id: 'turn', usage: tokens,
    thread_token_usage: { input_tokens: 999999 }, ...extra } };
}
test('stage ceilings reserve implementation/review time and charge attempts across resume', () => {
  const state = { deadline: 3600000, budgets: budgetPolicy(3600) };
  const spent = [{ stage: 'preparation', elapsedMs: 530000 }];
  assert.equal(stageAllowance(state, 'planner', spent, 1000).timeoutMs, 10000);
  assert.equal(stageAllowance(state, 'implementer', spent, 1000).timeoutMs, 1620000);
  assert.equal(stageAllowance(state, 'reviewer', spent, 1000).timeoutMs, 720000);
  assert.equal(stageAllowance(state, 'verifier', spent, 1000).timeoutMs, 540000);
  assert.equal(stageAllowance(state, 'oracle', [], 1000).timeoutMs, 180000);
  assert.equal(stageAllowance(state, 'planner', [{ stage: 'preparation', elapsedMs: 540000 }], 1000).timeoutMs, 0);
  assert.equal(stageAllowance(state, 'implementer', [], 3599500).timeoutMs, 500);
  assert.equal(stageAllowance(JSON.parse(JSON.stringify(state)), 'planner', spent, 1000).timeoutMs, 10000);
});
test('lead resumes across read-only planning and implementation, full mode retains isolated builder', async t => {
  const dir = await temporary(t), state = { id: 'fixture', activations: 1, sessionGroups };
  assert.equal((await openSession(dir, state, 'planner')).home, (await openSession(dir, state, 'implementer')).home);
  assert.notEqual((await openSession(dir, { ...state, sessionGroups: fullSessionGroups }, 'implementer')).home,
    (await openSession(dir, state, 'reviewer')).home);
  const fresh = { ...state, sessionMode: 'fresh' };
  assert.notEqual((await openSession(dir, fresh, 'planner')).home, (await openSession(dir, { ...fresh, activations: 2 }, 'planner')).home);
});
test('recovery accounts for killed and compacted responses without counting cumulative/resumed replay twice', async t => {
  const dir = await temporary(t), home = 'sessions/lead/home';
  await mkdir(join(dir, home, 'sessions/date'), { recursive: true });
  const a = { runId: 'fixture', role: 'planner', model: 'fixture-model', sessionGroup: 'lead', home, stage: 'preparation' };
  recordEvent(dir, 'attempt.started', { ...a, attemptId: 'first', timestamp: '2026-01-01T00:00:00Z' });
  recordEvent(dir, 'attempt.finished', { attemptId: 'first', code: 0, timestamp: '2026-01-01T00:01:00Z' });
  recordEvent(dir, 'turn.summary', { attemptId: 'first', usage: { ...tokens, input_tokens: 200 } });
  recordEvent(dir, 'attempt.started', { ...a, role: 'implementer', stage: 'implementation', attemptId: 'second', timestamp: '2026-01-01T00:02:00Z' });
  const journal = [response('one', '2026-01-01T00:00:10Z'), response('compaction', '2026-01-01T00:00:50Z'),
    response('two', '2026-01-01T00:02:10Z'), response('one', '2026-01-01T00:00:10Z'),
    { type: 'event_msg', payload: { prompt: 'NEVER EXPORT THIS', total_token_usage: tokens } }];
  await writeFile(join(dir, home, 'sessions/date/run.jsonl'), journal.map(r => JSON.stringify(r)).join('\n') + '\n');
  let summary = await recoverUsage(dir, { interrupted: true, now: Date.parse('2026-01-01T00:03:00Z') });
  assert.equal(summary.responses, 3); assert.equal(summary.usage.input_tokens, 300);
  assert.equal(summary.usage.output_tokens, 30); assert.equal(summary.lowerBound, true);
  assert.equal(summary.attempts[1].elapsedMs, 60000); assert.equal(summary.attempts[1].recovered, true);
  assert.equal(summary.attempts[1].usage.input_tokens, 100);
  summary = await recoverUsage(dir, { interrupted: true }); assert.equal(summary.responses, 3);
  assert(!JSON.stringify(await readLedger(dir)).includes('NEVER EXPORT THIS'));
  assert.equal(normalizeUsage({ ...tokens, cached_input_tokens: 101 }), null);
});
test('native reader waits for complete records, ignores symlinks and consumes only new bytes', async t => {
  const dir = await temporary(t), home = join(dir, 'home'); await mkdir(join(home, 'sessions'), { recursive: true });
  const path = join(home, 'sessions/run.jsonl'), line = JSON.stringify(response('one', '2026-01-01T00:00:10Z'));
  await writeFile(path, line.slice(0, 70));
  const attempt = { attemptId: 'attempt', timestamp: '2026-01-01T00:00:00Z' };
  const consume = usageConsumer(dir, [attempt], []), read = nativeReader();
  await read(home, consume); assert.equal((await readLedger(dir)).length, 0);
  await appendFile(path, line.slice(70) + '\n'); await read(home, consume); await read(home, consume);
  assert.equal((await readLedger(dir)).filter(r => r.type === 'response.usage').length, 1);
  await writeFile(join(dir, 'outside.jsonl'), JSON.stringify(response('outside', '2026-01-01T00:00:11Z')) + '\n');
  await symlink(join(dir, 'outside.jsonl'), join(home, 'sessions/link.jsonl')); await read(home, consume);
  assert.equal((await readLedger(dir)).length, 1);
});
test('command streams its private log before completion and allows checkpoint plus graceful shutdown', async t => {
  const dir = await temporary(t), log = join(dir, 'turn.jsonl');
  let visible = false, checkpoints = 0;
  const result = await command([process.execPath, '-e',
    'console.log("started"); process.on("SIGINT",()=>{console.log("flushed");process.exit(0)});setInterval(()=>{},1000)'],
  { stream: false, log, timeoutMs: 1000, graceMs: 100, checkpointMs: 200,
    onCheckpoint: async () => { checkpoints++; visible = (await readFile(log, 'utf8')).includes('started'); } });
  assert(visible); assert(checkpoints >= 1); assert(result.timedOut); assert.match(result.stdout, /flushed/);
});
test('a detached backend cannot overwrite final state after its parent exits during graceful cancellation', async t => {
  const dir = await temporary(t);
  const worker = "process.on('SIGINT',()=>setTimeout(()=>require('fs').writeFileSync('late-state','bad'),200));setInterval(()=>{},1000)";
  const parent = "require('child_process').spawn(process.execPath,['-e'," + JSON.stringify(worker) +
    "],{detached:true,stdio:'ignore'});process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)";
  const result = await command([process.execPath, '-e', parent], { cwd: dir, stream: false, timeoutMs: 1000, graceMs: 100 });
  assert(result.timedOut);
  await new Promise(resolve => setTimeout(resolve, 300));
  await assert.rejects(readFile(join(dir, 'late-state')), { code: 'ENOENT' });
});
test('checkpoint failure is reported without an unhandled rejection or an escaped worker', async () => {
  const result = await command([process.execPath, '-e', 'setInterval(()=>{},1000)'], { stream: false, timeoutMs: 200,
    checkpointMs: 50, onCheckpoint: async () => { throw new Error('Snapshot unavailable'); } });
  assert(result.timedOut); assert.equal(result.checkpointError, 'Snapshot unavailable');
});
test('OTEL config is explicit and exports only allow-listed usage/lifecycle fields with retry', async t => {
  const dir = await temporary(t), requests = []; let fail = true;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body)); res.writeHead(fail ? 503 : 200, { 'content-type': 'application/json' }); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = telemetryConfig('http://127.0.0.1:' + server.address().port);
  assert(config.hostGateway); assert.match(config.workerEndpoint, /host.docker.internal/);
  assert(telemetryArguments(config).some(a => a.startsWith('otel.metrics_exporter={')));
  assert(telemetryArguments().includes('otel.exporter="none"'));
  assert.throws(() => telemetryConfig('http://user:secret@example.invalid'), /credentials/);
  recordEvent(dir, 'response.usage', { runId: 'fixture', responseId: 'response', usage: normalizeUsage(tokens), prompt: 'PRIVATE', home: '/PRIVATE' });
  assert.equal((await flushTelemetry(dir, config)).status, 'pending');
  fail = false; assert.equal((await flushTelemetry(dir, config)).sent, 1);
  await flushTelemetry(dir, config); assert.equal(requests.length, 2);
  assert(!JSON.stringify(requests).includes('PRIVATE'));
  assert.equal(requests[1].resourceLogs[0].scopeLogs[0].logRecords[0].attributes.find(a => a.key === 'input_tokens').value.intValue, '100');
  assert(!JSON.stringify(otlpLogs([{ timestamp: new Date().toISOString(), type: 'checkpoint', delta: 'PRIVATE' }])).includes('PRIVATE'));
});
test('writable fixture permits Vite dependency temp writes without changing prepared source', async t => {
  const dir = await temporary(t), source = join(dir, 'source'); await mkdir(join(source, 'web/node_modules/.vite-temp'), { recursive: true });
  git(['init', '-b', 'fixture'], source);
  await writeFile(join(source, '.gitignore'), 'web/node_modules/\n'); await writeFile(join(source, 'source.txt'), 'baseline');
  git(['add', '.'], source); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'], source);
  await writeFile(join(source, 'web/node_modules/.vite-temp/config.mjs'), 'original');
  const fixture = await writableFixture(source, dir);
  await writeFile(join(fixture, 'web/node_modules/.vite-temp/config.mjs'), 'new');
  assert.equal(await readFile(join(source, 'web/node_modules/.vite-temp/config.mjs'), 'utf8'), 'original');
});
test('background supervisor completes without a model observer and wait returns on completion', async t => {
  const dir = await temporary(t);
  const job = await launchJob([process.execPath, '-e', 'setTimeout(()=>console.log("done"),200)'], { cwd: dir, root: dir });
  const state = await waitJob(job.directory, { timeoutMs: 5000 });
  assert.equal(state.status, 'completed'); assert.equal(state.code, 0);
  assert.match(await readFile(join(job.directory, 'supervisor.log'), 'utf8'), /done/);
});
test('usage summaries disclose missing attempts instead of replacing them with zero measured cost', () => {
  const summary = summarizeUsage([{ type: 'attempt.started', timestamp: new Date().toISOString(), attemptId: 'killed', role: 'implementer' }]);
  assert.equal(summary.attempts[0].coverage, 'missing'); assert.equal(summary.attempts[0].usage, null);
  assert.equal(summary.lowerBound, true); assert.equal(summary.costUsd, null);
});
test('OTEL reconciliation deduplicates retries and rejects missing/mismatched response usage', () => {
  const row = { responseId: 'one', usage: normalizeUsage(tokens) };
  assert.equal(reconcileResponses([row, row], [row, row]).status, 'matched');
  assert.deepEqual(reconcileResponses([row], []).missing, ['one']);
  assert.deepEqual(reconcileResponses([row], [{ ...row, usage: { ...row.usage, output_tokens: 1 } }]).mismatched, ['one']);
  assert.deepEqual(reconcileResponses([], [row]).unexpected, ['one']);
});
